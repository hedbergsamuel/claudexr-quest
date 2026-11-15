// Simulated Quest headset. Connects like the real app (WSS + pairing) and answers panels.
//
//   npm run sim                         # wss://127.0.0.1:47800/headset, pair if needed, auto-answer
//   npm run sim -- --discover           # find the bridge via mDNS (_claudexr._tcp)
//   npm run sim -- --interactive        # answer questions (and type the pairing code) in this terminal
//   npm run sim -- --pick 2 --verdict broken --choice b --permission deny --delay 500
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { TLSSocket } from "node:tls";
import { WebSocket } from "ws";
import { Bonjour } from "bonjour-service";
import { BridgeToHeadset, DEFAULT_PORT, MDNS_TYPE, PROTOCOL_VERSION, WS_PATH } from "../src/protocol.js";
import { pairingMac } from "../src/pairing.js";

type ShowMsg = Extract<BridgeToHeadset, { type: "show" }>;

export interface SimPairing {
  token?: string;
  fingerprint?: string;
}

export interface SimOptions {
  url?: string;
  discover?: boolean;
  pick?: number; // 1-based option for xr_ask
  choice?: "a" | "b" | "neither";
  verdict?: "works" | "broken";
  permission?: "allow" | "deny" | "silent";
  delayMs?: number;
  interactive?: boolean;
  dismiss?: boolean;
  silent?: boolean;
  /** pairing state (token + pinned fingerprint); mutated on successful pairing */
  pairing?: SimPairing;
  /** returns the code shown on the Mac (tests read it from the loopback /pairing endpoint) */
  getCode?: () => Promise<string>;
  appVersion?: string;
  /** answer for "Jag hörde: …" confirmation cards (default send) */
  heard?: "send" | "cancel";
  /** do not answer the voice preview automatically (tests call ws.decide) */
  noDecision?: boolean;
  /** video socket behaviour: ack every frame (default), never ack (to test flow control), or no socket */
  video?: "ack" | "noack" | "none";
  log?: (line: string) => void;
}

export async function discoverBridge(timeoutMs = 5000): Promise<string> {
  const bonjour = new Bonjour();
  try {
    return await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("no _claudexr._tcp service found")), timeoutMs);
      bonjour.find({ type: MDNS_TYPE }, (svc) => {
        const host = svc.addresses?.find((a) => a.includes(".")) ?? svc.host;
        clearTimeout(t);
        const scheme = svc.txt?.tls === "1" ? "wss" : "ws";
        resolve(`${scheme}://${host}:${svc.port}${svc.txt?.path ?? WS_PATH}`);
      });
    });
  } finally {
    bonjour.destroy();
  }
}

export async function runSim(opts: SimOptions): Promise<WebSocket> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const url = opts.url ?? (opts.discover ? await discoverBridge() : `wss://127.0.0.1:${DEFAULT_PORT}${WS_PATH}`);
  const pairing = opts.pairing ?? {};
  log(`[sim] connecting to ${url}`);
  // Self-signed cert: trust is established by pinning the fingerprint, like the Quest app.
  const ws = new WebSocket(url, { rejectUnauthorized: false });
  const rl = opts.interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  let fingerprint = "";
  let lastPreviewId = "";
  const send = (m: unknown) => ws.send(JSON.stringify(m));

  ws.on("upgrade", (res) => {
    const sock = res.socket as TLSSocket;
    const raw = sock.getPeerCertificate?.()?.raw;
    fingerprint = raw ? crypto.createHash("sha256").update(raw).digest("hex") : "";
  });
  ws.on("open", () => {
    if (pairing.fingerprint && pairing.fingerprint !== fingerprint) {
      log("[sim] certificate fingerprint changed: refusing to talk to this bridge");
      ws.close(4002, "fingerprint mismatch");
      return;
    }
    if (pairing.token) send({ type: "hello", protocol: PROTOCOL_VERSION, token: pairing.token, device: "Simulated Quest 3", app: "headset-sim", appVersion: opts.appVersion ?? "sim-0.2.0" });
    else send({ type: "pair_request", device: "Simulated Quest 3" });
  });
  ws.on("message", async (raw, isBinary) => {
    if (isBinary) return log("[sim] UNEXPECTED binary frame on the control socket");
    const msg = JSON.parse(raw.toString()) as BridgeToHeadset;
    switch (msg.type) {
      case "pair_code_shown": {
        const code = opts.getCode ? await opts.getCode() : rl ? (await rl.question("Pairing code shown on the Mac> ")).replace(/\s/g, "") : "";
        const nonce = crypto.randomBytes(16).toString("hex");
        send({ type: "pair_confirm", device: "Simulated Quest 3", nonce, mac: await pairingMac(code, fingerprint, nonce) });
        return;
      }
      case "pair_ok":
        pairing.token = msg.token;
        pairing.fingerprint = fingerprint;
        log("[sim] paired");
        send({ type: "hello", protocol: PROTOCOL_VERSION, token: msg.token, device: "Simulated Quest 3", app: "headset-sim", appVersion: opts.appVersion ?? "sim-0.2.0" });
        return;
      case "pair_failed":
        return log(`[sim] pairing failed: ${msg.reason}`);
      case "unauthorized":
        log(`[sim] unauthorized: ${msg.reason}`);
        pairing.token = undefined;
        if (opts.getCode || rl) send({ type: "pair_request", device: "Simulated Quest 3" });
        return;
      case "welcome":
        if (opts.video !== "none") openVideo();
        return log(`[sim] connected to ${msg.server} ${msg.bridgeVersion} on ${msg.host} (dev ${msg.devMode})`);
      case "clear":
        return log(`[sim] clear ${msg.id ?? msg.role ?? "all"}`);
      case "voice_panel":
        // like the app: the voice panel follows the bridge and reports its state back
        log(`[sim] voice_panel ${msg.open ? "open" : "closed"}`);
        return send({ type: "voice_panel", open: msg.open === true });
      case "voice_state":
        log(`[sim] voice_state ${msg.state} ${short(msg)}`);
        // The preview in the voice panel: Skicka / Avbryt (answered like the real app, on the control socket).
        if (msg.state === "preview" && msg.id && !opts.noDecision) {
          send({ type: "voice_decision", id: msg.id, send: (opts.heard ?? "send") === "send" });
          log(`[sim] heard-confirm ${opts.heard ?? "send"}`);
        } else if (msg.state === "preview" && msg.id) lastPreviewId = msg.id;
        return;
      case "calibrate":
        log(`[sim] calibrate ${msg.payload} marker ${msg.markerSizeM.toFixed(3)} m, screen ${msg.screen.widthM.toFixed(3)}x${msg.screen.heightM.toFixed(3)} m`);
        // The real app detects the QR with the passthrough camera; the simulator just reports success.
        send({ type: "calibration_result", requestId: msg.requestId, ok: true, detections: 12, residualPx: 1.1 });
        return;
      case "show":
        break;
      default:
        return log(`[sim] ${msg.type} ${short(msg)}`);
    }
    log(`[sim] show ${msg.panel.kind} id=${msg.id} role=${msg.role} ${short(msg.panel)}`);
    if (msg.panel.kind === "heard") {
      send({ type: "response", id: msg.id, data: { send: (opts.heard ?? "send") === "send" } });
      return log(`[sim] heard-confirm ${opts.heard ?? "send"}`);
    }
    if (msg.panel.kind === "listen") return; // waits for push-to-talk
    if (!msg.awaitingResponse || opts.silent) return;
    if (msg.panel.kind === "permission" && opts.permission === "silent") return;
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.dismiss) {
      send({ type: "dismissed", id: msg.id });
      return log(`[sim] dismissed ${msg.id}`);
    }
    const data = rl ? await askHuman(rl, msg) : autoAnswer(msg, opts);
    send({ type: "response", id: msg.id, data });
    log(`[sim] answered ${msg.id}: ${JSON.stringify(data)}`);
  });
  // Separate video socket with per-frame acks (credit-based flow control on the bridge).
  let video: WebSocket | null = null;
  const openVideo = () => {
    video?.close();
    const v = new WebSocket(url.replace(/\/headset$/, "/video"), { rejectUnauthorized: false });
    video = v;
    v.on("open", () => v.send(JSON.stringify({ type: "video_hello", token: pairing.token })));
    v.on("message", (raw, isBinary) => {
      if (!isBinary) return;
      const b = raw as Buffer;
      const idLen = b.readUInt8(1);
      const id = b.subarray(2, 2 + idLen).toString();
      const seq = b.readUInt32BE(2 + idLen);
      const flags = b.readUInt8(2 + idLen + 12);
      log(`[sim] video ${id} seq=${seq} key=${flags & 1} bytes=${b.length - (2 + idLen + 13)}`);
      if (opts.video !== "noack") v.send(JSON.stringify({ type: "ack", s: id, seq }));
    });
    v.on("close", (c) => log(`[sim] video closed (${c})`));
    v.on("open", () => log("[sim] media socket open"));
    v.on("error", () => {});
  };
  // Push-to-talk like the Quest app: voice_start, 100 ms PCM chunks, voice_end (on the media socket).
  (ws as WebSocket & { speak?: (pcm: Buffer, panelId?: string) => void }).speak = (pcm, panelId) => {
    const v = video;
    if (!v) return log("[sim] no media socket");
    const id = crypto.randomBytes(4).toString("hex");
    v.send(JSON.stringify({ type: "voice_start", id, ...(panelId ? { panelId } : {}) }));
    for (let o = 0; o < pcm.length; o += 3200) v.send(Buffer.concat([Buffer.from([0xa1, id.length]), Buffer.from(id), pcm.subarray(o, o + 3200)]));
    v.send(JSON.stringify({ type: "voice_end", id }));
  };
  Object.assign(ws, {
    emergency: () => send({ type: "emergency_close" }),
    restartDisplay: () => send({ type: "restart_display" }),
    decide: (ok: boolean) => send({ type: "voice_decision", id: lastPreviewId, send: ok }),
  });
  (ws as WebSocket & { micDenied?: () => void }).micDenied = () => video?.send(JSON.stringify({ type: "voice_error", reason: "mic_denied" }));
  ws.on("close", (code) => {
    video?.close();
    log(`[sim] disconnected (${code})`);
  });
  ws.on("error", (e) => log(`[sim] error ${e.message}`));
  return ws;
}

/** JSON for logs with long strings (html) shortened. */
const short = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "string" && x.length > 120 ? `${x.slice(0, 60)}…(${x.length})` : x));

function autoAnswer(msg: ShowMsg, o: SimOptions): Record<string, unknown> {
  const p = msg.panel;
  if (p.kind === "ask") return { choiceIndex: Math.min((o.pick ?? 1) - 1, p.options.length - 1) };
  if (p.kind === "compare") return { choice: o.choice ?? "a" };
  if (p.kind === "permission") return { decision: o.permission ?? "deny" };
  if (p.kind === "test") {
    const verdict = o.verdict ?? "works";
    return { verdict, checked: p.checklist.map(() => verdict === "works") };
  }
  return {};
}

async function askHuman(rl: readline.Interface, msg: ShowMsg): Promise<Record<string, unknown>> {
  const p = msg.panel;
  if (p.kind === "ask") {
    console.log(`\n? ${p.question}`);
    p.options.forEach((o, i) => console.log(`  ${i + 1}) ${o.label}${o.description ? " - " + o.description : ""}`));
    return { choiceIndex: Number(await rl.question("choice> ")) - 1 };
  }
  if (p.kind === "compare") return { choice: (await rl.question("a / b / neither> ")).trim() };
  if (p.kind === "permission") {
    console.log(`\n${p.title}\n  ${p.tool}: ${p.subject}${p.diff ? "\n" + p.diff : ""}`);
    return { decision: (await rl.question("allow / deny> ")).trim() === "allow" ? "allow" : "deny" };
  }
  if (p.kind === "test") {
    console.log(`\nTEST: ${p.title}\n${p.instructions}`);
    const checked: boolean[] = [];
    for (const c of p.checklist) checked.push((await rl.question(`  ${c}? (y/n)> `)).trim().startsWith("y"));
    return { verdict: (await rl.question("works / broken> ")).trim() === "works" ? "works" : "broken", checked };
  }
  return {};
}

// CLI (pairing is remembered in ~/.claudexr/sim-pairing.json)
if (process.argv[1]?.endsWith("headset-sim.ts")) {
  const a = process.argv.slice(2);
  const val = (k: string) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
  const file = path.join(process.env.CLAUDEXR_STATE_DIR || path.join(os.homedir(), ".claudexr"), "sim-pairing.json");
  let pairing: SimPairing = {};
  try {
    pairing = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  runSim({
    url: val("--url"),
    discover: a.includes("--discover"),
    pick: val("--pick") ? Number(val("--pick")) : undefined,
    choice: val("--choice") as SimOptions["choice"],
    verdict: val("--verdict") as SimOptions["verdict"],
    permission: val("--permission") as SimOptions["permission"],
    delayMs: val("--delay") ? Number(val("--delay")) : undefined,
    // The pairing code is only shown on the Mac (notification / bridge log): type it here.
    interactive: true,
    dismiss: a.includes("--dismiss"),
    silent: a.includes("--silent"),
    pairing,
  })
    .then((ws) => ws.on("close", () => fs.writeFileSync(file, JSON.stringify(pairing), { mode: 0o600 })))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
  process.on("SIGINT", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(pairing), { mode: 0o600 });
    process.exit(0);
  });
}
