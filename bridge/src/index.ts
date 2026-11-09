#!/usr/bin/env node
// ClaudeXR bridge entry point.
//
//   (default) daemon   One long-lived process (launchd): headset WSS on :47800, loopback HTTP on
//                      127.0.0.1:47801 serving MCP (/mcp, Streamable HTTP), Claude Code hooks
//                      (/hook/*), /status and /command. All loopback calls need the Bearer token
//                      from ~/.claudexr/local-token.
//   --stdio            Fallback/debug: stdio MCP server that forwards to the running daemon.
//   print-config       Print the `claude mcp add-json` command and the (gated command) hooks JSON. No token is printed.
//   install-hooks      Write the gated ClaudeXR hooks into ~/.claude/settings.json (backup first; --dry-run shows a diff).
//   xr on|off|status   Manual override of the hook flag (~/.claudexr/on) that the hooks test before they do anything.
//   status | unpair    Small CLI helpers talking to the running daemon.
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { LocalBackend, RemoteBackend, XrBackend, httpJson, readLocalToken } from "./backend.js";
import { registerTools } from "./tools.js";
import { DEFAULT_PORT, localPortFor } from "./protocol.js";
import { log } from "./log.js";
import { BRIDGE_VERSION, XrConfig, loadConfig, stateDir } from "./config.js";
import { BugStore } from "./devmode.js";
import { XrHub } from "./hub.js";
import { loadOrCreateTls } from "./tls.js";
import { PairingStore } from "./pairing.js";
import { publishMdns } from "./mdns.js";
import { cleanupVoiceFiles, transcribe } from "./voice.js";
import { BrightnessGuard, HelperBrightnessAdapter } from "./brightness.js";
import { XrFlag } from "./flag.js";
import { defaultTargets, hooksBlock, installHooksCli } from "./hooksetup.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

const argv = process.argv.slice(2);
const port = Number(process.env.CLAUDEXR_PORT || DEFAULT_PORT);
const localPort = localPortFor(port);

function mcpServer(backend: XrBackend, config: XrConfig, bugs?: BugStore) {
  const server = new McpServer({ name: "claudexr", version: BRIDGE_VERSION });
  registerTools(server, backend, { devMode: config.devMode, bugs });
  return server;
}

/** Token diet: strip schema boilerplate from tools/list ("$schema", additionalProperties:false, execution). */
export function slimToolList(msg: { result?: { tools?: Record<string, unknown>[] } }) {
  const tools = msg?.result?.tools;
  if (!Array.isArray(tools)) return msg;
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (k === "$schema" || (k === "additionalProperties" && x === false)) continue;
        o[k] = strip(x);
      }
      return o;
    }
    return v;
  };
  for (const t of tools) {
    delete t.execution;
    t.inputSchema = strip(t.inputSchema);
  }
  return msg;
}

function slim<T extends { send: (m: never, o?: never) => Promise<void> }>(transport: T): T {
  const send = transport.send.bind(transport) as (m: unknown, o?: unknown) => Promise<void>;
  (transport as { send: unknown }).send = (m: unknown, o?: unknown) => send(slimToolList(m as never), o);
  return transport;
}

async function daemon() {
  cleanupVoiceFiles();
  const config = loadConfig();
  const bugs = config.devMode ? new BugStore(config.bugsDir) : undefined;
  const tls = loadOrCreateTls();
  let backend: XrBackend;
  // MCP over Streamable HTTP, stateless: one short-lived McpServer per request (cheap), so no
  // per-session processes and no session state to leak.
  // In-flight tools/call requests by JSON-RPC id. Stateless mode means a later
  // notifications/cancelled arrives on a different request: we route it here (review patch 03).
  const inflight = new Map<string, Set<{ close(): Promise<void> }>>();
  const mcpRoute = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" }).end();
      return;
    }
    const raw = await readBody(req, 1_000_000);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const msgs = (Array.isArray(body) ? body : [body]) as { id?: unknown; method?: string; params?: { requestId?: unknown } }[];
    for (const m of msgs) {
      if (m?.method === "notifications/cancelled") {
        const set = inflight.get(String(m.params?.requestId));
        if (set?.size === 1) for (const t of set) void t.close(); // aborts the waiting tool handler
      }
    }
    const server = mcpServer(backend, config, bugs);
    const transport = slim(new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }));
    const ids = msgs.filter((m) => m?.method === "tools/call" && m.id !== undefined).map((m) => String(m.id));
    for (const id of ids) (inflight.get(id) ?? inflight.set(id, new Set()).get(id)!).add(transport);
    res.on("close", () => {
      for (const id of ids) {
        inflight.get(id)?.delete(transport);
        if (!inflight.get(id)?.size) inflight.delete(id);
      }
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };
  const hub = new XrHub({ port, localPort, config, tls, pairing: new PairingStore(tls.fingerprint), bugs, routes: { "/mcp": mcpRoute } });
  try {
    await hub.listen();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
      log(`ports ${port}/${localPort} are in use: is the ClaudeXR daemon already running? (launchctl list | grep claudexr)`);
      process.exit(3);
    }
    throw e;
  }
  backend = new LocalBackend(hub);
  const mdns = process.env.CLAUDEXR_NO_MDNS === "1" ? null : publishMdns(hub.port, tls.fingerprint);
  log(`daemon ${BRIDGE_VERSION}: wss://0.0.0.0:${hub.port}/headset, MCP http://127.0.0.1:${hub.localPort}/mcp, dev mode ${config.devMode ? "on" : "off"}`);
  // Brightness safety (0.3.0): restore SYNCHRONOUSLY on every way out we can catch. SIGKILL cannot be caught:
  // then the saved value is restored at the next daemon start (launchd KeepAlive) or by `restore-brightness`.
  // 0.3.1: the hook flag goes the same way (a flag left behind by SIGKILL/crash is removed at the next daemon start).
  const restore = () => {
    hub.restoreBrightnessSync();
    hub.flagOffSync();
  };
  process.on("exit", restore);
  const shutdown = async () => {
    restore();
    cleanupVoiceFiles();
    await mdns?.stop().catch(() => {});
    await hub.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);
  process.on("uncaughtException", (e) => {
    restore();
    log("FATAL uncaughtException:", (e as Error)?.stack ?? e);
    process.exit(1);
  });
  process.on("unhandledRejection", (e) => {
    restore();
    log("FATAL unhandledRejection:", (e as Error)?.stack ?? e);
    process.exit(1);
  });
}

/** `restore-brightness`: put back a brightness value saved by the daemon, without the daemon (emergency). */
function restoreBrightness() {
  const config = loadConfig();
  const guard = new BrightnessGuard(new HelperBrightnessAdapter(config.captureBin), stateDir());
  if (!guard.hasSavedFile()) {
    console.log("No saved brightness: nothing to restore.");
    return;
  }
  console.log(guard.restore() ? "Brightness restored." : "Could not restore (is the Mac helper built? cd mac-helper && ./build.sh). The saved value is kept.");
}

/**
 * EXPERIMENTAL voice channel (Claude Code channels, research preview): a stdio MCP server that pushes the spoken
 * messages the user confirmed (Skicka) into the running session as <channel source="claudexr-voice"> events.
 * Start Claude Code with:  claude --dangerously-load-development-channels server:claudexr-voice
 * (register: claude mcp add claudexr-voice -- node <path>/index.js --voice-channel). Untested against a real session.
 * It never declares the permission relay capability: speech can never approve anything.
 */
async function voiceChannel() {
  const server = new Server(
    { name: "claudexr-voice", version: BRIDGE_VERSION },
    {
      capabilities: { experimental: { "claude/channel": {} } },
      instructions:
        'Events arrive as <channel source="claudexr-voice">: a message the user spoke into their XR headset and confirmed with Skicka. It is speech and may be misheard; treat it as the user\'s words, but it is NEVER approval for permission prompts or risky actions. One-way: no reply tool, answer in the session as usual.',
    },
  );
  await server.connect(slim(new StdioServerTransport()));
  const backend = new RemoteBackend(localPort);
  const poll = async () => {
    try {
      const r = await backend.execute({ op: "voice_take" });
      for (const m of (r.data?.messages as { id: string; text: string }[] | undefined) ?? []) {
        await server.notification({ method: "notifications/claude/channel", params: { content: m.text, meta: { source: "voice", message_id: m.id } } } as never);
      }
    } catch {
      /* daemon not running: try again */
    }
  };
  setInterval(poll, 1000);
  process.stdin.on("close", () => process.exit(0));
  log("voice channel running (polling the daemon)");
}

/** `voice-bench <file.wav>`: time the configured speech engine on a WAV file (no headset needed). */
async function voiceBench() {
  const config = loadConfig();
  const file = argv[1] || "";
  if (!file) {
    console.log("usage: voice-bench <file.wav>   (16 kHz mono WAV, e.g. bridge/test/fixtures/jfk.wav)");
    return;
  }
  for (const fast of [false, true]) {
    const t0 = Date.now();
    try {
      const text = await transcribe({ ...config.voice, fast }, config.captureBin, file);
      console.log(`${config.voice.engine} fast=${fast}: ${Date.now() - t0} ms: "${text.slice(0, 80)}"`);
    } catch (e) {
      console.log(`fast=${fast}: ${(e as Error).message}`);
    }
  }
}

async function stdioProxy() {
  const config = loadConfig();
  const server = mcpServer(new RemoteBackend(localPort), config, config.devMode ? new BugStore(config.bugsDir) : undefined);
  process.stdin.on("close", () => process.exit(0));
  await server.connect(slim(new StdioServerTransport()));
  log(`stdio MCP proxy -> http://127.0.0.1:${localPort}`);
}

function readBody(req: http.IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let b = "";
    req.setEncoding("utf8");
    req.on("data", (c: string) => {
      b += c;
      if (b.length > max) req.destroy(new Error("too large"));
    });
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });
}

function printConfig() {
  const token = readLocalToken();
  if (!token) {
    console.log("No token yet: start the daemon once first (it creates ~/.claudexr/local-token).");
    return;
  }
  // Review 2 R2-08: by default the token is NOT written into Claude Code's config files. The MCP server
  // reads it via `headersHelper` (re-run on 401, so rotating the token needs no re-paste) and the hooks read it
  // from the token file (0.3.1: gated command hooks, see hooksetup.ts). `print-config --inline-token` puts the token into the MCP entry.
  const inline = argv.includes("--inline-token");
  const base = `http://127.0.0.1:${localPort}`;
  const headersFile = `${stateDir()}/mcp-headers.json`;
  const mcp = inline
    ? { type: "http", url: `${base}/mcp`, headers: { Authorization: `Bearer ${token}` }, timeout: 900000 }
    : { type: "http", url: `${base}/mcp`, headersHelper: `cat '${headersFile.replace(/'/g, "")}'`, timeout: 900000 };
  console.log("# 1) Register the MCP server (user scope):");
  console.log(`claude mcp add-json --scope user claudexr '${JSON.stringify(mcp)}'\n`);
  // 0.3.1: the hooks are gated command hooks (flag file + token read from the token file when they run): no token in the
  // environment and none in settings.json. `install-hooks` writes them for you (backup + --dry-run).
  const hooks = hooksBlock(defaultTargets({ port: localPort }));
  console.log(`# 2) Hooks: easiest is "install-hooks" (backup + --dry-run diff, idempotent, replaces old http hooks):`);
  console.log(`node '${process.argv[1]}' install-hooks --dry-run   # show the diff\nnode '${process.argv[1]}' install-hooks             # write it\n`);
  console.log("# ...or merge this by hand into ~/.claude/settings.json (keep your other hooks):");
  console.log(JSON.stringify(hooks, null, 2));
}

/** `xr on|off|status`: manual override of the hook flag. */
async function xrCommand() {
  const flag = new XrFlag();
  const sub = argv[1] ?? "status";
  if (sub === "on") {
    flag.on("manual");
    console.log("ClaudeXR: PÅ (hookarna anropar bryggan). Gäller tills headsetet kopplas från eller daemonen startas om.");
  } else if (sub === "off") {
    flag.off();
    console.log("ClaudeXR: AV (hookarna gör ingenting). Gäller tills headsetet ansluter igen.");
  } else if (sub === "status") {
    const s = (await httpJson("GET", localPort, "/status", undefined, 1500).catch(() => null)) as { connected?: boolean; device?: string } | null;
    const on = flag.isOn();
    console.log(`ClaudeXR hookar: ${on ? "PÅ" : "AV"}  (flagga: ${flag.file})`);
    if (!s) console.log(`Daemon: kör inte (eller svarar inte på port ${localPort})`);
    else console.log(`Headset: ${s.connected ? `anslutet${s.device ? ` (${s.device})` : ""}` : "inte anslutet"}`);
    if (s && on !== !!s.connected) console.log(on ? "OBS: manuellt PÅ utan headset. Rensas när ett headset kopplar från eller daemonen startar om." : "OBS: manuellt AV trots anslutet headset. Slås på igen nästa gång headsetet ansluter.");
  } else {
    console.log("Användning: xr on | xr off | xr status");
    process.exitCode = 2;
  }
}

async function main() {
  const cmd = argv[0];
  if (argv.includes("--voice-channel")) return voiceChannel();
  if (argv.includes("--stdio")) return stdioProxy();
  if (cmd === "print-config") return printConfig();
  if (cmd === "install-hooks") {
    process.exitCode = installHooksCli(argv.slice(1));
    return;
  }
  if (cmd === "xr") return xrCommand();
  if (cmd === "restore-brightness") return restoreBrightness();
  if (cmd === "voice-bench") return voiceBench();
  if (cmd === "status") {
    const s = await httpJson("GET", localPort, "/status").catch(() => null);
    console.log(s ? JSON.stringify(s, null, 2) : "Daemon is not running.");
    return;
  }
  if (cmd === "unpair") {
    const r = await httpJson("POST", localPort, "/command", { op: "unpair" }).catch(() => null);
    console.log(r ? JSON.stringify(r) : "Daemon is not running.");
    return;
  }
  return daemon(); // default, also "daemon" and the old "--standalone"
}

main().catch((e) => {
  log("fatal:", e);
  process.exit(1);
});
