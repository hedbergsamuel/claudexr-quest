import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn, ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import { runSim, SimOptions, SimPairing } from "../sim/headset-sim.js";
import { fileURLToPath } from "node:url";

const FAKE_CAPTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-capture.mjs");

let portCounter = 48100 + Math.floor(Math.random() * 400) * 2;
export const nextPort = () => (portCounter += 2);

export function tmpDir(prefix = "claudexr-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export interface BridgeHandle {
  port: number;
  stateDir: string;
  bugsDir: string;
  client: Client;
  daemon: DaemonHandle;
  call(name: string, args?: Record<string, unknown>): Promise<{ text: string; isError?: boolean }>;
  toolNames(): Promise<string[]>;
  local(pathname: string, body?: unknown): Promise<any>;
  token(): string;
  pairingCode(): string;
  close(): Promise<void>;
}

export interface DaemonHandle {
  proc: ChildProcess;
  stderrLines: string[];
  exited: Promise<number | null>;
}

/** Start the daemon (the real production entry point) and wait until its loopback API answers. */
export async function startDaemon(port: number, env: Record<string, string>, stateDir: string): Promise<DaemonHandle> {
  const proc = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    env: {
      ...(process.env as Record<string, string>),
      CLAUDEXR_PORT: String(port),
      CLAUDEXR_LOCAL_PORT: String(port + 1),
      CLAUDEXR_STATE_DIR: stateDir,
      CLAUDEXR_BUGS_DIR: path.join(stateDir, "bugs"),
      CLAUDEXR_FLAG_DIR: path.join(stateDir, "flag"), // 0.3.1: tests never touch the real ~/.claudexr/on
      CLAUDEXR_NO_MDNS: "1",
      CLAUDEXR_NO_NOTIFY: "1",
      CLAUDEXR_QUIET: "1",
      CLAUDEXR_PAIR_CONFIRM: "auto", // non-macOS: auto-confirm pairing on the "Mac" side
      // 0.3.0 safety: tests NEVER use the real capture helper, never dim the real display and do not start the
      // always-on display stream unless a test asks for it.
      CLAUDEXR_CAPTURE_BIN: FAKE_CAPTURE,
      CLAUDEXR_ALWAYS_DISPLAY: "0",
      CLAUDEXR_DIM: "0",
      ...env,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  // The pairing code is only printed to the daemon's stderr (the Mac-side display).
  const stderrLines: string[] = [];
  proc.stderr!.on("data", (d: Buffer) => stderrLines.push(...d.toString().split("\n")));
  const exited = new Promise<number | null>((r) => proc.on("exit", (c) => r(c)));
  const start = Date.now();
  for (;;) {
    if (proc.exitCode !== null) break;
    try {
      const token = fs.readFileSync(path.join(stateDir, "local-token"), "utf8").trim();
      const r = await fetch(`http://127.0.0.1:${port + 1}/status`, { headers: { authorization: `Bearer ${token}` } });
      if (r.ok) break;
    } catch {}
    if (Date.now() - start > 15_000) throw new Error("daemon did not start: " + stderrLines.join("\n"));
    await new Promise((r) => setTimeout(r, 50));
  }
  return { proc, stderrLines, exited };
}

/** An MCP client session over Streamable HTTP, like Claude Code with `--transport http`. */
export async function mcpClient(port: number, stateDir: string): Promise<Client> {
  const token = fs.readFileSync(path.join(stateDir, "local-token"), "utf8").trim();
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port + 1}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  return client;
}

export async function startBridge(port: number, extraEnv: Record<string, string> = {}, stateDir = tmpDir(), existing?: DaemonHandle): Promise<BridgeHandle> {
  const bugsDir = path.join(stateDir, "bugs");
  const daemon = existing ?? (await startDaemon(port, extraEnv, stateDir));
  const client = await mcpClient(port, stateDir);
  const token = () => fs.readFileSync(path.join(stateDir, "local-token"), "utf8").trim();
  const local = async (pathname: string, body?: unknown) => {
    const headers = { authorization: `Bearer ${token()}`, "content-type": "application/json" };
    const r = await fetch(`http://127.0.0.1:${port + 1}${pathname}`, body === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(body) });
    return r.json();
  };
  return {
    port,
    stateDir,
    bugsDir,
    client,
    daemon,
    local,
    token,
    pairingCode: () => {
      const line = [...daemon.stderrLines].reverse().find((l) => l.includes("PAIRING CODE"));
      return line ? /: (\d{4}) (\d{4})/.exec(line)!.slice(1).join("") : "00000000";
    },
    async call(name, args = {}) {
      const r = (await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 })) as { content: { text: string }[]; isError?: boolean };
      return { text: r.content[0].text, isError: r.isError };
    },
    async toolNames() {
      return (await client.listTools()).tools.map((t) => t.name);
    },
    async close() {
      await client.close().catch(() => {});
      if (!existing) {
        daemon.proc.kill("SIGTERM");
        await daemon.exited;
      }
    },
  };
}

export interface SimHandle {
  ws: WebSocket & { speak?: (pcm: Buffer, panelId?: string) => void; micDenied?: () => void; emergency?: () => void; restartDisplay?: () => void; decide?: (send: boolean) => void };
  lines: string[];
  pairing: SimPairing;
  close(): void;
}

/** Start a simulated headset; pairs automatically (reads the code from the loopback /pairing endpoint). */
export async function startSim(b: { port: number; pairingCode?: () => string }, opts: SimOptions = {}): Promise<SimHandle> {
  const lines: string[] = [];
  const pairing = opts.pairing ?? {};
  const ws = await runSim({
    url: `wss://127.0.0.1:${b.port}/headset`,
    log: (l) => lines.push(l),
    pairing,
    getCode: async () => {
      await waitFor(() => (b.pairingCode?.() ?? "00000000") !== "00000000", 3000).catch(() => {});
      return b.pairingCode?.() ?? "00000000";
    },
    ...opts,
  });
  await waitFor(() => lines.some((l) => l.includes("connected to claudexr-bridge")), 8000);
  return { ws, lines, pairing, close: () => ws.close() };
}

export async function waitFor(cond: () => boolean, ms = 5000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
