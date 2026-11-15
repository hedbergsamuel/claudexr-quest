// The hub owns the ports:
//  * TLS port (LAN): the headset WebSocket (/headset). Only paired headsets get past "hello".
//  * Loopback HTTP port: /status, /command, /event, /pairing for hooks and other bridge processes.
import http from "node:http";
import https from "node:https";
import os from "node:os";
import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ChildProcess, spawn } from "node:child_process";
import QRCode from "qrcode";
import { WebSocketServer, WebSocket } from "ws";
import {
  BridgeToHeadset,
  CommandResult,
  HeadsetToBridge,
  HubCommand,
  LayoutMode,
  ScreenPreset,
  MDNS_TYPE,
  PROTOCOL_VERSION,
  PanelInfo,
  PanelPlacement,
  PanelSpec,
  Role,
  WS_PATH,
  VIDEO_PATH,
  VoiceUiState,
  XrStatus,
} from "./protocol.js";
import { lanAddresses } from "./net.js";
import { log, logError, onError, recentLog } from "./log.js";
import { BRIDGE_VERSION, XrConfig, stateDir } from "./config.js";
import { TlsIdentity } from "./tls.js";
import { PairingStore } from "./pairing.js";
import { ActivityTracker } from "./activity.js";
import { StreamManager, StreamHandle, classifyApp, streamWidthFor, describeStreamError, encodeAudioFrame } from "./stream.js";
import { XrFlag } from "./flag.js";
import { CaffeinateAdapter, KeepAwake, type KeepAwakeAdapter } from "./keepawake.js";
import { BrightnessGuard, HelperBrightnessAdapter, realDimAllowed } from "./brightness.js";
import { VideoFlow } from "./videoflow.js";
import { InputGate, InputRouter, NullInputSink, type Rect } from "./input.js";
import { correctTerms, matchAB, matchCommand, matchOption, matchVerdict, transcribePcm, LocalCommand, SAMPLE_RATE, VoiceInbox } from "./voice.js";
import { VoiceRouter } from "./voiceroute.js";
import { BugStore, Component } from "./devmode.js";
import { maskSecrets } from "./mask.js";
import { renderText } from "./present.js";
import { ContextHook, buildPermissionPanel, decisionOutput, trimEvent } from "./hookapi.js";
import { rewriteLocalUrl } from "./net.js";

interface OpenPanel {
  msg: Extract<BridgeToHeadset, { type: "show" }>;
  resolve?: (r: CommandResult) => void;
  timer?: NodeJS.Timeout;
  createdAt: number;
  updatedAt: number;
  shownAt: number;
  placement?: PanelPlacement;
  size?: { widthM: number; heightM: number };
  movedByUser: boolean;
  minimized: boolean;
  streamId?: string;
  autoKey?: string;
}

interface HeadsetConn {
  ws: WebSocket;
  authed: boolean;
  device?: string;
  app?: string;
  appVersion?: string;
  since: Date;
  remoteAddress?: string;
  alive: boolean;
  pingSentAt?: number;
  deviceId?: string;
  /** Mac address the headset reached us on (used to rewrite localhost URLs, review patch 10) */
  localAddress?: string;
  pairRequests: number;
  firstMsgTimer?: NodeJS.Timeout;
  missedPongs: number;
  lastSeen: number;
}

/** Largest control frame accepted from a headset (answers are tiny; blocks memory-exhaustion frames). */
export const MAX_HEADSET_FRAME = 256 * 1024;
/** A connection must send a valid first message within this time. */
export const FIRST_MESSAGE_DEADLINE_MS = 10_000;
const MAX_COMMAND_BYTES = 1024 * 1024;

/** Keep peer-supplied strings short and printable: they end up in Claude's context (review S6). */
export function cleanPeerString(v: unknown, max = 64): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/[^\x20-\x7E\u00A0-\u024F]/g, "").trim().slice(0, max);
  return s || undefined;
}

const isLoopbackHost = (host: string | undefined, port: number) =>
  !!host && ["127.0.0.1", "localhost", "[::1]"].some((h) => host === h || host === `${h}:${port}`);

/** Only http(s) URLs may be opened in the headset's WebViews (review patch 11). */
export const isWebUrl = (u: string) => /^https?:\/\//i.test(u);

export interface HubOptions {
  port: number;
  localPort: number;
  host?: string;
  config: XrConfig;
  tls: TlsIdentity;
  pairing: PairingStore;
  bugs?: BugStore;
  /** injectable for tests (default: the helper adapter, only when display.dim is on and the real-dim guard allows it) */
  brightness?: BrightnessGuard;
  /** håller Macen vaken medan displaystömmen lever (BUG-13e417); injicerbar för tester */
  keepAwake?: KeepAwakeAdapter;
  /** hook on/off flag (default: <CLAUDEXR_FLAG_DIR|CLAUDEXR_STATE_DIR|~/.claudexr>/on); injectable for tests */
  flag?: XrFlag;
  /** extra loopback routes (e.g. "/mcp"); called after the token/Host/Origin checks */
  routes?: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>>;
}

const STALE_MS = Number(process.env.CLAUDEXR_STALE_MIN || 15) * 60_000;
const UNAUTH_TIMEOUT_MS = 180_000;
const MAX_VISIBLE = 6;
const STREAM_READY_MS = Number(process.env.CLAUDEXR_STREAM_READY_MS || 8000);
/** the headset must have acked a frame this recently, otherwise the physical display is lit again */
const DIM_STALL_MS = 8000;
/** 0.4.1: drop an audio block when this much is already waiting in the /video socket (~0.3 s of PCM at 1.5 Mbit/s; later audio is useless) */
const AUDIO_MAX_BUFFERED = 64 * 1024;
type HudMsg = Extract<BridgeToHeadset, { type: "hud" }>;

/** Begripligt kalibreringsfel som säger vad användaren ska göra (BUG-cc393a). */
export function calibrationHint(err: string): string {
  const e = err.toLowerCase();
  if (e === "timeout")
    return "Kalibreringen fick ingen träff inom 45 s. Titta på Macens skärm med headsetet (rutmönstret ska synas stort), ta bort fönster som täcker mitten och kontrollera att Quest-appen har kameratillstånd. Försök igen.";
  if (e.includes("camera_disconnected")) return "Headsetets kamera var inte tillgänglig. Starta om Quest-appen och försök igen.";
  if (e.includes("marker_not_found")) return "Rutmönstret syntes inte. Titta rakt mot Macens skärm på 0,5–1 m avstånd och försök igen.";
  if (e === "aborted") return "Kalibreringen avbröts.";
  return err;
}

export class XrHub {
  private tlsServer: https.Server;
  private localServer = http.createServer((req, res) => this.onLocalHttp(req, res));
  private wss = new WebSocketServer({ noServer: true, maxPayload: MAX_HEADSET_FRAME });
  private conns = new Set<HeadsetConn>();
  // Video has its own socket so it can never delay control messages (review P1).
  private videoWss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 }); // acks + push-to-talk audio chunks
  private voice = new Map<string, { chunks: Buffer[]; bytes: number; target?: string; startedAt: number }>();
  private voiceDecisions = new Map<string, (send: boolean) => void>();
  private sttQueue: Promise<void> = Promise.resolve();
  /** 0.4.0: the headset's near voice panel is open (reported by the app; a system panel, not in this.panels) */
  private voicePanelOpen = false;
  readonly voiceInbox = new VoiceInbox();
  /** 0.4.0 (BUG-6b9a81): delivers spoken messages into the running session through hooks (see voiceroute.ts). */
  readonly voiceRouter = new VoiceRouter(this.voiceInbox, Date.now, (n, via) => {
    if (via !== "prompt") this.toast(n > 1 ? `✓ Claude fick ${n} röstmeddelanden` : "✓ Claude fick röstmeddelandet", "done");
  });
  readonly brightness?: BrightnessGuard;
  private readonly keepAwake: KeepAwake;
  private displaySuppressed = false;
  private displayApproved = false;
  private displayStarting = false;
  private displayFailures = 0;
  private displayNextTry = 0;
  private displayWarnedNoHelper = false;
  private dimHoldUntil = 0;
  private dimCheckTimer?: NodeJS.Timeout;
  private videoWs: WebSocket | null = null;
  private flows = new Map<string, VideoFlow>();
  /** 0.4.1: audio blocks sent / dropped (socket backed up) */
  private audioSeq = 0;
  private audioDropped = 0;
  private audioLastError?: string;
  /** 0.4.1 (punkt 6): main display in global Mac points, known after calibration or after the input gate opened */
  private displayRectPt?: Rect;
  /** 0.4.1 (punkt 6): input gate + mapping. The sink sends nothing to the Mac (no CGEvent in 0.4.1). */
  readonly input = new InputRouter(new InputGate(), new NullInputSink(), (id) => this.inputTarget(id));
  private headset: HeadsetConn | null = null;
  private panels = new Map<string, OpenPanel>();
  private heartbeat?: NodeJS.Timeout;
  private layoutMode: LayoutMode = "review";
  private latency: XrStatus["latency"] = {};
  readonly activity = new ActivityTracker();
  readonly streams: StreamManager;
  private contextHook = new ContextHook();
  private calibrations = new Map<string, (r: Record<string, unknown>) => void>();
  private markerProc: ChildProcess | null = null;
  port = 0;
  localPort = 0;
  /** secret for the loopback API (also written to <stateDir>/local-token, mode 0600) */
  readonly localToken: string;
  /** 0.3.1: the hooks only run while this file exists (see flag.ts) */
  readonly flag: XrFlag;

  constructor(private readonly o: HubOptions) {
    this.tlsServer = https.createServer({ key: o.tls.key, cert: o.tls.cert }, (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ server: "claudexr-bridge", protocol: PROTOCOL_VERSION, ws: WS_PATH }));
    });
    this.tlsServer.on("upgrade", (req, socket, head) => {
      const p = (req.url ?? "").split("?")[0];
      if (p === VIDEO_PATH && req.headers.origin === undefined) {
        this.videoWss.handleUpgrade(req, socket, head, (ws) => this.onVideoSocket(ws));
        return;
      }
      if (p !== WS_PATH) return socket.destroy();
      // Browsers always send Origin on WebSocket upgrades; the Quest app (OkHttp) and the simulator don't.
      if (req.headers.origin !== undefined) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return socket.destroy();
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onHeadset(ws, req));
    });
    this.streams = new StreamManager(
      o.config.captureBin,
      {
        onState: (h, reason) => this.onStreamState(h, reason),
        onFrame: (id, pts, flags, payload) => {
          this.flowFor(id).onFrame(pts, flags, payload);
          const h = this.streams.streams.get(id);
          if (h) this.maybeDimSoon(h);
        },
        onAudio: (captureUs, pcm) => this.sendAudio(captureUs, pcm),
        onAudioState: (state, reason) => {
          if (state === "error") {
            this.audioLastError = reason;
            logError("ljud", reason ?? "Macens ljud stoppades av ett fel");
          }
          log(`audio: ${state}${reason ? ` (${reason})` : ""}`);
          this.updateHud();
        },
      },
      o.config.helperMode ?? "shared",
    );
    this.brightness =
      o.brightness ??
      (o.config.display.dim && realDimAllowed(process.env, o.config.captureBin)
        ? new BrightnessGuard(new HelperBrightnessAdapter(o.config.captureBin), stateDir(), o.config.display.dimLevel)
        : undefined);
    this.keepAwake = new KeepAwake(o.keepAwake ?? (!process.env.CLAUDEXR_STATE_DIR ? new CaffeinateAdapter() : { start: () => false, stop: () => {} }));
    if (o.bugs) onError((m) => o.bugs!.autoLog(m, componentOf(m), this.devContext(false)));
    this.localToken = loadOrCreateLocalToken();
    this.flag = o.flag ?? new XrFlag();
  }

  /** The hook flag follows the headset (0.3.1). Never throws: a read-only flag dir must not take the bridge down. */
  private flagOn(reason: string) {
    try {
      this.flag.on(reason);
    } catch (e) {
      logError("hooks", `could not create ${this.flag.file}: ${(e as Error).message}`);
    }
  }

  /** Synchronous (also used by process exit/signal handlers). */
  flagOffSync() {
    try {
      this.flag.off();
    } catch (e) {
      logError("hooks", `could not remove ${this.flag.file}: ${(e as Error).message}`);
    }
  }

  listen(): Promise<void> {
    const listenOne = (srv: http.Server | https.Server, port: number, host: string) =>
      new Promise<number>((resolve, reject) => {
        const onErr = (e: Error) => reject(e);
        srv.once("error", onErr);
        srv.listen(port, host, () => {
          srv.off("error", onErr);
          const a = srv.address();
          resolve(typeof a === "object" && a ? a.port : port);
        });
      });
    // Safety first: a brightness value saved by an earlier run (crash, SIGKILL) is put back before anything else.
    // Independent of display.dim: a user who switches dimming off after a crash must still get the screen back.
    try {
      const g =
        this.brightness ??
        (realDimAllowed(process.env, this.o.config.captureBin)
          ? new BrightnessGuard(new HelperBrightnessAdapter(this.o.config.captureBin), stateDir(), this.o.config.display.dimLevel)
          : undefined);
      g?.restoreStale();
    } catch (e) {
      logError("brightness", (e as Error).message);
    }
    return (async () => {
      // Loopback first: it decides which process is the hub.
      this.localPort = await listenOne(this.localServer, this.o.localPort, "127.0.0.1");
      try {
        this.port = await listenOne(this.tlsServer, this.o.port, this.o.host ?? "0.0.0.0");
      } catch (e) {
        await new Promise<void>((r) => this.localServer.close(() => r()));
        throw e;
      }
      this.heartbeat = setInterval(() => this.tick(), 10_000);
      // 0.3.1: both ports are ours, so this IS the daemon (a second instance that hit EADDRINUSE never gets here and
      // cannot delete a live flag). No headset can be connected yet: a flag still lying around is stale (crash, SIGKILL,
      // or a manual `xr on` from before the restart).
      if (this.flag.isOn()) log("removing a stale hook flag (no headset connected at daemon start)");
      this.flagOffSync();
    })();
  }

  /** Synchronous (also used by process exit/signal handlers). */
  restoreBrightnessSync(): boolean {
    try {
      return this.brightness ? this.brightness.restore() : true;
    } catch (e) {
      logError("brightness", (e as Error).message);
      return false;
    }
  }

  async close(): Promise<void> {
    this.voiceRouter.cancelAll();
    clearInterval(this.heartbeat);
    clearTimeout(this.dimCheckTimer);
    this.keepAwake.set(false);
    this.restoreBrightnessSync();
    this.flagOffSync();
    this.streams.shutdown();
    this.markerProc?.kill();
    for (const p of this.panels.values()) clearTimeout(p.timer);
    for (const c of this.conns) c.ws.terminate();
    this.videoWs?.terminate();
    for (const c of this.videoWss.clients) c.terminate();
    this.wss.close();
    this.videoWss.close();
    // Keep-alive and pending (long-poll) HTTP connections must not hold up shutdown.
    this.localServer.closeAllConnections?.();
    this.tlsServer.closeAllConnections?.();
    await Promise.all([
      new Promise<void>((r) => this.tlsServer.close(() => r())),
      new Promise<void>((r) => this.localServer.close(() => r())),
    ]);
  }

  // ---------------- status ----------------

  private panelInfo(p: OpenPanel): PanelInfo {
    return {
      id: p.msg.id,
      kind: p.msg.panel.kind,
      role: p.msg.role,
      title: panelTitle(p.msg.panel),
      awaiting: !!p.resolve,
      size: p.size,
      placement: p.placement,
      movedByUser: p.movedByUser,
      createdAt: new Date(p.createdAt).toISOString(),
      updatedAt: new Date(p.updatedAt).toISOString(),
      stale: !p.resolve && !p.streamId && Date.now() - p.updatedAt > STALE_MS, // levande strömpaneler är aldrig stale (BUG-7cf1b6)
      minimized: p.minimized,
      ...(p.streamId ? { streamId: p.streamId } : {}),
    };
  }

  status(): XrStatus {
    const h = this.headset;
    return {
      connected: this.isConnected(),
      paired: !!h?.authed,
      device: h?.device,
      app: h?.app,
      appVersion: h?.appVersion,
      connectedSince: h?.since.toISOString(),
      remoteAddress: h?.remoteAddress,
      openPanels: [...this.panels.values()].map((p) => this.panelInfo(p)),
      layoutMode: this.layoutMode,
      pairedDevices: this.o.pairing.list(),
      devMode: this.o.config.devMode,
      latency: this.latency,
      activity: this.activity.snapshot(),
      display: {
        alwaysOn: this.o.config.display.alwaysOn,
        suppressed: this.displaySuppressed,
        approved: this.displayApproved || this.o.config.display.approval === "never",
        dimmed: !!this.brightness?.dimmed,
        dimEnabled: !!this.brightness,
      },
      mic: { listening: this.voice.size > 0, panelOpen: this.voicePanelOpen },
      voice: { ...this.voiceRouter.info(), channelEnabled: !!this.o.config.voice.channel },
      helperMode: this.streams.helperMode(),
      audio: this.audioStatus(),
      input: this.input.stats(),
      streams: [...this.streams.streams.values()].map((s) => ({
        streamId: s.streamId,
        title: s.title,
        state: s.state,
        source: s.source,
        panelId: s.panelId,
        maxWidth: s.maxWidth,
        kbps: Math.round(s.bitrate / 1000),
        ...(this.flows.get(s.streamId)?.stats() ?? {}),
      })),
      bridge: {
        version: BRIDGE_VERSION,
        host: os.hostname(),
        port: this.port,
        localPort: this.localPort,
        lanAddresses: lanAddresses(),
        mdnsType: `_${MDNS_TYPE}._tcp`,
        pid: process.pid,
        tlsFingerprint: this.o.tls.fingerprint,
      },
    };
  }

  /** Context attached to bug reports (dev mode). Masked; no panel contents. */
  devContext(withLog = true): Record<string, unknown> {
    const s = this.status();
    return {
      timestamp: new Date().toISOString(),
      bridgeVersion: BRIDGE_VERSION,
      appVersion: s.appVersion ?? null,
      device: s.device ?? null,
      connected: s.connected,
      paired: s.paired,
      pairedDevices: s.pairedDevices.length,
      layoutMode: s.layoutMode,
      panels: s.openPanels.map((p) => ({ id: p.id, kind: p.kind, role: p.role, title: maskSecrets(p.title ?? ""), stale: p.stale, minimized: p.minimized, movedByUser: p.movedByUser })),
      latency: s.latency,
      streams: s.streams,
      lastHookActivity: this.activity.lastEvent ?? null,
      ...(withLog ? { recentLog: recentLog(40) } : {}),
    };
  }

  // ---------------- commands ----------------

  async execute(cmd: HubCommand, signal?: AbortSignal): Promise<CommandResult> {
    switch (cmd.op) {
      case "show":
        return this.show(cmd.role, cmd.panel, cmd.wait, cmd.timeoutMs, signal, cmd.widthM, cmd.heightM);
      case "screen":
        return this.screenPreset(cmd.preset);
      case "clear":
        // xr_panel close "all" lämnar Macens skärm (BUG-7cf1b6); "everything" stänger även den.
        return cmd.id === "everything" ? this.clear("all", cmd.role) : this.clear(cmd.id, cmd.role, cmd.id === "all" || (!cmd.id && !cmd.role));
      case "update":
        return this.update(cmd);
      case "layout":
        return this.layout(cmd.mode);
      case "event": {
        const ev = cmd.event;
        if (typeof ev.diff_preview === "string" && ev.diff_preview) this.autoPanel("diff", `Ändring: ${String(ev.file ?? "")}`, renderText(`Senaste ändring · ${String(ev.file ?? "")}`, maskSecrets(ev.diff_preview), "diff"));
        if (typeof ev.test_output === "string" && ev.test_output) this.autoPanel("tests", "Testresultat", renderText(`Testresultat · ${maskSecrets(String(ev.test_command ?? ""))}`, maskSecrets(ev.test_output), "log"));
        // Dev mode: XR tool failures are logged automatically (no model involvement).
        if (ev.hook_event_name === "PostToolUseFailure" && String(ev.tool_name ?? "").startsWith("mcp__claudexr")) {
          this.o.bugs?.autoLog(`Verktygsfel ${String(ev.tool_name).split("__").pop()}: ${maskSecrets(String(ev.error ?? "")).slice(0, 200)}`, "brygga", this.devContext(false));
        }
        const u = this.activity.handle(ev);
        if (u && this.isConnected()) {
          this.send({ type: "activity", activity: u.snapshot });
          if (u.toast) this.send({ type: "toast", ...u.toast });
        }
        return { status: "updated" };
      }
      case "list_windows": {
        const wins = await this.streams.listWindows();
        return {
          status: "answered",
          data: {
            windows: wins.map((w) => {
              const access = classifyApp(this.o.config.stream, w.app, w.bundleId);
              // Never reveal titles of excluded apps (mail subjects, password entries...).
              return access === "excluded" ? { id: w.id, app: w.app, access } : { ...w, title: maskSecrets(w.title), access };
            }),
          },
        };
      }
      case "stream_start":
        return this.startStream(cmd, signal);
      case "stream_stop":
        return this.stopStreams(cmd.streamId);
      case "emergency":
        return this.emergency();
      case "audio_start": {
        if (!this.isConnected()) return { status: "error", data: { error: "Headsetet är inte anslutet: ljudet startas inte." } };
        this.audioLastError = undefined;
        const r = await this.streams.startAudio(this.o.config.stream.excludeApps.filter((x) => x.includes(".")));
        if (!r.ok) return { status: "error", data: { error: r.error } };
        return { status: "updated", data: { audio: "starting", sid: r.sid, format: "pcm_s16le_48000_2" } };
      }
      case "audio_stop":
        return { status: "cleared", data: { stopped: this.streams.stopAudio() } };
      case "voice_take": {
        // 0.4.1: off by default. A channel that is not enabled never marks itself alive and never takes messages.
        if (!this.o.config.voice.channel) return { status: "answered", data: { messages: [], disabled: true } };
        const items = this.voiceInbox.take();
        return { status: "answered", data: { messages: items.map((m) => ({ id: m.id, text: m.text })) } };
      }
      case "calibrate":
        return this.calibrate(cmd.timeoutMs, signal);
      case "unpair": {
        const n = this.o.pairing.unpair(cmd.deviceId);
        if (this.headset && (!cmd.deviceId || this.headset.deviceId === cmd.deviceId)) this.headset.ws.close(4001, "unpaired");
        return { status: "cleared", data: { removed: n } };
      }
    }
  }

  isConnected(): boolean {
    return !!this.headset && this.headset.authed && this.headset.ws.readyState === WebSocket.OPEN;
  }

  private show(
    role: Role,
    panel: PanelSpec,
    wait: boolean,
    timeoutMs: number,
    signal?: AbortSignal,
    widthM?: number,
    heightM?: number,
    /** stable id (stream panels): the same source always gets the same panel id (BUG-39391d) */
    fixedId?: string,
  ): Promise<CommandResult> {
    if (!this.isConnected()) return Promise.resolve({ status: "not_connected" });
    const bad = webUrls(panel).find((u) => !isWebUrl(u));
    if (bad) return Promise.resolve({ status: "error", data: { error: `only http(s) URLs can be shown (got ${bad.slice(0, 40)})` } });
    panel = this.rewriteLocal(panel);
    const id = fixedId ?? randomUUID().slice(0, 8);
    if (fixedId && this.panels.has(fixedId)) this.removePanel(fixedId, true); // a leftover with the same id: replace it
    const msg = { type: "show" as const, id, role, awaitingResponse: wait, panel };
    // Panels are not replaced automatically; autoTidy() keeps the room readable (max 6 expanded).
    const now = Date.now();
    // Review 2 R2-01: while an approval card is pending, nothing else may sit next to or in front of it
    // (a transparent HTML panel placed over the card could show a fake command above the real buttons).
    const exclusive = panel.kind === "permission";
    const open: OpenPanel = { msg, createdAt: now, updatedAt: now, shownAt: now, movedByUser: false, minimized: !exclusive && this.permissionPending() };
    if (widthM && heightM) open.size = { widthM, heightM };
    this.panels.set(id, open);
    this.send(msg);
    if (exclusive || open.minimized) this.sendLayoutForApproval();
    else this.autoTidy();
    if (widthM && heightM) this.send({ type: "update", id, widthM, heightM });
    if (!wait) return Promise.resolve({ status: "shown", panelId: id });

    return new Promise<CommandResult>((resolve) => {
      open.resolve = (r) => {
        if (r.status === "answered" && panel.kind === "ask") this.latency.lastAskRoundTripMs = Date.now() - open.shownAt;
        resolve(r);
      };
      open.timer = setTimeout(() => {
        this.removePanel(id, true);
        log(`panel ${id} (${panel.kind}) timed out`);
        this.o.bugs?.autoLog(`Timeout: ingen respons på ${panel.kind}-panel inom ${Math.round(timeoutMs / 1000)} s`, "quest-app", this.devContext(false));
        resolve({ status: "timeout", panelId: id });
      }, timeoutMs);
      // The caller went away (e.g. the user answered the permission prompt in the terminal).
      signal?.addEventListener("abort", () => {
        if (this.panels.get(id)?.resolve) {
          this.removePanel(id, true);
          resolve({ status: "dismissed", panelId: id });
        }
      });
    });
  }

  /** localhost -> the Mac address the headset actually connected to (review patch 10). */
  lanHost(): string | undefined {
    return process.env.CLAUDEXR_LAN_HOST || this.headset?.localAddress || lanAddresses()[0];
  }

  private rewriteLocal(p: PanelSpec): PanelSpec {
    const host = this.lanHost();
    const fix = (u: string) => rewriteLocalUrl(u, host);
    if (p.kind === "preview") return { ...p, url: fix(p.url) };
    if (p.kind === "test" && p.url) return { ...p, url: fix(p.url) };
    if (p.kind === "compare") return { ...p, a: { ...p.a, url: fix(p.a.url) }, b: { ...p.b, url: fix(p.b.url) } };
    return p;
  }

  private update(cmd: Extract<HubCommand, { op: "update" }>): CommandResult {
    const p = this.panels.get(cmd.id);
    if (!p) return { status: "not_found", panelId: cmd.id };
    // Review 2 R2-01: approval and "Jag hörde" cards are read-only. Otherwise the model could retitle,
    // shrink or move a live approval card ("Säkert: kör testerna") while the real command is unchanged.
    if (p.msg.panel.kind === "permission" || p.msg.panel.kind === "heard")
      return { status: "error", panelId: cmd.id, data: { error: "approval cards are read-only (close it to answer in the terminal)" } };
    let panel: PanelSpec | undefined;
    if (cmd.panel || cmd.title) {
      const { body, ...rest } = (cmd.panel ?? {}) as Partial<PanelSpec> & { body?: string };
      const merged = { ...p.msg.panel, ...rest, kind: p.msg.panel.kind } as PanelSpec;
      if (body !== undefined) {
        if (merged.kind === "preview" && !isWebUrl(body)) return { status: "error", data: { error: "only http(s) URLs can be shown" } };
        applyBody(merged, body, cmd.title, this.lanHost());
      }
      if (cmd.title) {
        if (merged.kind === "ask") merged.question = cmd.title;
        else (merged as { title?: string }).title = cmd.title;
      }
      p.msg.panel = panel = merged;
    }
    if (cmd.role) p.msg.role = cmd.role;
    if (cmd.widthM && cmd.heightM) p.size = { widthM: cmd.widthM, heightM: cmd.heightM };
    p.updatedAt = Date.now();
    p.minimized = this.permissionPending();
    this.send({ type: "update", id: cmd.id, role: cmd.role, panel, widthM: cmd.widthM, heightM: cmd.heightM, placement: cmd.placement });
    return { status: "updated", panelId: cmd.id };
  }

  /** Bioskärm-förinställning för Macens skärm (IDE-e587a1). Måten att ändra storlek/avstånd utan att gissa enheter. */
  private screenPreset(preset: ScreenPreset): CommandResult {
    if (![...this.streams.streams.values()].some((h) => h.source === "display")) return { status: "not_found", data: { error: "Macens skärm speglas inte just nu (xr_stream display)" } };
    this.send({ type: "screen_preset", preset });
    return { status: "updated", data: { preset } };
  }

  private layout(mode: LayoutMode): CommandResult {
    this.layoutMode = mode;
    const list = [...this.panels.values()].sort((a, b) => a.updatedAt - b.updatedAt);
    const newest = list[list.length - 1];
    const newestPrimary = [...list].reverse().find((p) => p.msg.role === "primary" || p.msg.role === "compare");
    const approval = this.permissionPending();
    for (const p of list) {
      const awaiting = !!p.resolve;
      p.minimized =
        // R2-01: while an approval card is pending, no layout change may bring other panels back.
        (approval && p.msg.panel.kind !== "permission" && p.msg.role !== "overlay") ||
        (!awaiting &&
          p.msg.role !== "overlay" &&
          (mode === "tidy" ? Date.now() - p.updatedAt > STALE_MS : mode === "focus" ? p !== newestPrimary : mode === "present" ? p !== newest : false));
    }
    const ids = list.filter((p) => p.minimized).map((p) => p.msg.id);
    this.send({ type: "layout", mode, ids });
    return { status: "updated", data: { mode, minimized: ids } };
  }

  /**
   * Close panels. No selector or id "all" = EVERYTHING including streams (the display stream too, which then
   * stays off until the next headset connection or xr_stream display / "Starta skärmen").
   * id may be a panel id or a stream id (stream panels are in the registry and listed by xr_panel list).
   */
  private clear(id?: string, role?: Role, keepDisplay = false): CommandResult {
    const all = id === "all" || (!id && !role);
    // 0.4.0 (BUG-8324e4): the voice panel is a system panel in the headset; "voice" closes it, and so does "all".
    if ((id === "voice" || all) && this.isConnected() && (this.voicePanelOpen || id === "voice")) {
      this.send({ type: "voice_panel", open: false });
      const was = this.voicePanelOpen;
      this.voicePanelOpen = false;
      if (id === "voice") return { status: "cleared", data: { cleared: was ? ["voice"] : [], streamsStopped: [] } };
    }
    const isDisplayPanel = (pid: string) => {
      const sid = this.panels.get(pid)?.streamId;
      return !!sid && this.streams.streams.get(sid)?.source === "display";
    };
    const ids = [...this.panels.keys()].filter((pid) => {
      const p = this.panels.get(pid)!;
      if (keepDisplay && isDisplayPanel(pid)) return false;
      if (all) return true;
      if (id) return pid === id || p.streamId === id;
      return p.msg.role === role;
    });
    const stoppedStreams: string[] = [];
    for (const pid of ids) {
      const p = this.panels.get(pid);
      if (!p) continue;
      p.resolve?.({ status: "dismissed", panelId: pid });
      if (p.streamId) stoppedStreams.push(...this.stopStreamQuiet(p.streamId));
      this.removePanel(pid, false);
    }
    if (all && keepDisplay) {
      for (const h of this.streams.streams.values()) if (h.source !== "display") stoppedStreams.push(...this.stopStreamQuiet(h.streamId));
    } else if (all) stoppedStreams.push(...this.stopStreamQuiet()); // streams whose panel is already gone (orphans)
    else if (id && !ids.length) {
      // not a panel id: maybe a stream id/key whose panel was lost
      const hs = this.matchStreams(id);
      for (const h of hs) stoppedStreams.push(...this.stopStreamQuiet(h.streamId));
    }
    if (this.isConnected()) {
      if (all && !keepDisplay) {
        this.send({ type: "clear" });
        this.send({ type: "sync", ids: [] });
      } else for (const pid of ids) this.send({ type: "clear", id: pid });
    }
    this.updateDim();
    this.updateHud();
    const found = ids.length > 0 || stoppedStreams.length > 0 || all;
    return { status: found ? "cleared" : "not_found", panelId: found ? undefined : id, data: { cleared: ids, streamsStopped: stoppedStreams } };
  }

  /** Stop streams (all when no id) without a result message; remembers that the display was stopped on purpose. */
  private stopStreamQuiet(streamId?: string): string[] {
    const hs = streamId ? [this.streams.streams.get(streamId)].filter((x): x is StreamHandle => !!x) : [...this.streams.streams.values()];
    for (const h of hs) if (h.source === "display") this.displaySuppressed = true;
    return this.streams.stop(streamId);
  }

  private matchStreams(sel: string): StreamHandle[] {
    return [...this.streams.streams.values()].filter((h) => h.streamId === sel || h.panelId === sel || h.key === sel || h.key === `window:${sel}`);
  }

  /**
   * xr_stream stop: no id = all WINDOW streams (the display stream stays on); "display" = the display stream;
   * "all" = everything; otherwise a stream id, panel id or window id.
   */
  private stopStreams(sel?: string): CommandResult {
    const all = [...this.streams.streams.values()];
    const s = sel?.trim();
    let targets: StreamHandle[];
    if (!s) targets = all.filter((h) => h.source === "window");
    else if (s === "all") targets = all;
    else if (s === "display") targets = all.filter((h) => h.source === "display");
    else targets = this.matchStreams(s);
    if (s && !targets.length) return { status: "not_found", data: { error: `no stream matches "${s}" (ids: xr_panel list)` } };
    const stopped: string[] = [];
    for (const h of targets) stopped.push(...this.stopStreamQuiet(h.streamId));
    this.updateDim();
    this.updateHud();
    const displayKept = [...this.streams.streams.values()].some((h) => h.source === "display");
    return { status: "cleared", data: { stopped, displayKept } };
  }

  /** Panic button / "close everything": panels, streams (display too), brightness. */
  private emergency(): CommandResult {
    this.input.off("emergency");
    this.streams.stopAudio();
    const r = this.clear();
    this.displaySuppressed = true;
    this.voice.clear();
    for (const [, d] of this.voiceDecisions) d(false);
    this.voiceDecisions.clear();
    this.restoreBrightnessSync();
    this.updateHud();
    log("emergency close: all panels and streams closed, brightness restored");
    return { status: "cleared", data: { ...(r.data ?? {}), brightnessRestored: !this.brightness?.hasSavedFile() } };
  }

  private removePanel(id: string, notifyHeadset: boolean) {
    const p = this.panels.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    p.resolve = undefined;
    this.panels.delete(id);
    if (notifyHeadset && this.isConnected()) this.send({ type: "clear", id });
    // The last approval card is gone: bring the room back as it was.
    if (p.msg.panel.kind === "permission" && !this.permissionPending()) this.layout(this.layoutMode);
  }

  private permissionPending(): boolean {
    for (const p of this.panels.values()) if (p.msg.panel.kind === "permission" && p.resolve) return true;
    return false;
  }

  /** Minimize everything except pending approval cards (and the overlay stream on the real screen). */
  private sendLayoutForApproval() {
    for (const p of this.panels.values()) if (p.msg.panel.kind !== "permission" && p.msg.role !== "overlay") p.minimized = true;
    this.send({ type: "layout", mode: this.layoutMode, ids: [...this.panels.values()].filter((p) => p.minimized).map((p) => p.msg.id) });
  }

  // ---------------- streaming ----------------

  private async startStream(cmd: Extract<HubCommand, { op: "stream_start" }> & { auto?: boolean }, signal?: AbortSignal): Promise<CommandResult> {
    if (!this.isConnected()) return { status: "not_connected" };
    const policy = this.o.config.stream;
    let title: string;
    let app: string | undefined;
    let needsApproval: boolean;
    let approvalSubject = "";
    if (cmd.source === "window") {
      const wins = await this.streams.listWindows();
      const w = wins.find((x) => x.id === cmd.windowId);
      if (!w) return { status: "not_found", data: { error: `window ${cmd.windowId} not found (use xr_stream windows)` } };
      const access = classifyApp(policy, w.app, w.bundleId);
      if (access === "excluded") return { status: "error", data: { error: `"${w.app}" is on the exclusion list and can never be streamed.` } };
      title = `${w.app} – ${maskSecrets(w.title)}`;
      approvalSubject = `${w.app} – ${w.title}`;
      app = w.app;
      needsApproval = access === "ask";
    } else {
      title = "Macens skärm";
      approvalSubject = title;
      // The whole display needs explicit approval: one tap per daemon run ("once"), then it restarts silently.
      needsApproval = !this.displayApproved && this.o.config.display.approval !== "never";
    }
    if (!this.streams.available()) return { status: "error", data: { error: `Mac helper not found at ${this.o.config.captureBin}. Build it on the Mac: cd mac-helper && ./build.sh` } };
    const key = cmd.source === "window" ? `window:${cmd.windowId}` : `display:${cmd.displayId ?? "main"}`;
    const live = [...this.streams.streams.values()].filter((h) => h.state !== "stopped" && h.state !== "error");
    const existing = live.find((h) => h.key === key);
    if (live.length - (existing ? 1 : 0) >= this.o.config.maxStreams) {
      return {
        status: "error",
        data: { error: `Max ${this.o.config.maxStreams} simultaneous streams (display + windows). Stop one first: xr_stream stop id:<stream or panel id>. Active: ${live.map((h) => `${h.streamId} "${h.title}"`).join(", ")}` },
      };
    }
    if (cmd.source === "display") this.displayStarting = true;
    try {
      if (needsApproval) {
        const r = await this.show(
          "primary",
          {
            kind: "permission",
            title: cmd.source === "window" ? "Strömma fönster till headsetet?" : "Spegla hela Mac-skärmen?",
            tool: "Skärmströmning",
            subject: approvalSubject,
            detail:
              cmd.source === "display"
                ? "Appar på uteslutningslistan döljs i speglingen. Strömmen pausas när Macen låses. Du slipper fråga igen tills daemonen startas om."
                : "Strömmen pausas när Macen låses. Du kan stoppa den med ✕ på panelen.",
            warnings: [],
          },
          true,
          60_000,
          signal,
        );
        if (r.status !== "answered" || r.data?.decision !== "allow") {
          const why = r.status === "answered" ? "denied in the headset" : r.status === "timeout" ? "no answer in the headset within 60 s" : r.status === "not_connected" ? "headset not connected" : "the card was closed";
          return { status: "dismissed", data: { reason: why, declined: true, subject: approvalSubject, error: `"${approvalSubject}" needs a tap on the approval card in the headset ([ask] = not on the allow list): ${why}.` } };
        }
      }
      if (cmd.source === "display") {
        this.displaySuppressed = false;
        this.displayApproved = true;
      }
      // A restart replaces the old stream and its panel (never two streams of the same source). The panel keeps
      // its id (see streamPanelId) and, if the user had moved it, its place in the room.
      const prev = existing?.panelId ? this.panels.get(existing.panelId) : this.panels.get(streamPanelId(key));
      const prevPlace = prev?.movedByUser && prev.placement?.position ? prev.placement : undefined;
      if (existing) this.streams.stop(existing.streamId);
      const role: Role = cmd.role ?? (cmd.source === "display" ? "overlay" : "side");
      const widthM = cmd.widthM ?? (cmd.source === "display" ? 0.6 : 0.9);
      const distanceM = role === "overlay" ? 0.65 : role === "primary" ? 1.2 : 1.1;
      let h: StreamHandle;
      try {
        h = this.streams.start({
          title,
          key,
          source: cmd.source,
          windowId: cmd.windowId,
          displayId: cmd.displayId,
          excludeBundles: policy.excludeApps.filter((x) => x.includes(".")),
          fps: cmd.fps ?? 30,
          bitrateMbps: cmd.bitrateMbps ?? 12,
          // Stream at the resolution the panel can actually show (~1150-1600 px), not full screen size.
          maxWidth: cmd.maxWidth ?? streamWidthFor(widthM, distanceM),
        });
      } catch (e) {
        return { status: "error", data: { error: (e as Error).message } };
      }
      this.updateHud();
      // Do not answer "Streaming" until the helper is live AND has produced a picture (0.2.0 returned at once and
      // left a blank panel when e.g. the window was minimized or macOS refused capture).
      const ready = await this.awaitStreamReady(h, STREAM_READY_MS, signal);
      if (!ready.ok) {
        this.streams.stop(h.streamId);
        this.updateHud();
        return { status: "error", data: { error: ready.error, code: h.errorCode, subject: approvalSubject } };
      }
      const shown = await this.show(role, { kind: "stream", title, streamId: h.streamId, source: cmd.source, app, width: 0, height: 0 }, false, 0, undefined, undefined, undefined, streamPanelId(key));
      const p = shown.panelId ? this.panels.get(shown.panelId) : undefined;
      if (p) {
        p.streamId = h.streamId;
        h.panelId = p.msg.id;
        p.size = { widthM, heightM: widthM * 0.625 };
        this.send({ type: "update", id: p.msg.id, widthM, heightM: widthM * 0.625 });
        if (prevPlace && role !== "overlay") {
          p.placement = prevPlace;
          p.movedByUser = true;
          this.send({ type: "update", id: p.msg.id, placement: prevPlace });
        }
        // The panel appears after the stream is live: tell it the current state/size right away.
        this.send({ type: "stream_state", streamId: h.streamId, state: h.state, width: h.width, height: h.height });
        this.flowFor(h.streamId).resync();
        // The stream may have died while the panel was being created: never leave an orphan.
        if (h.state === "stopped" || h.state === "error") this.removePanel(p.msg.id, true);
      }
      this.updateHud();
      return { status: "shown", panelId: shown.panelId, data: { streamId: h.streamId, title, approvedInXr: needsApproval, replaced: !!existing } };
    } finally {
      if (cmd.source === "display") this.displayStarting = false;
    }
  }

  private async awaitStreamReady(h: StreamHandle, timeoutMs: number, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; error: string }> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (signal?.aborted) return { ok: false, error: "cancelled" };
      if (h.state === "error" || h.state === "stopped") return { ok: false, error: describeStreamError(h.errorCode, h.errorMessage, h.title) };
      if (h.state === "paused" || (h.state === "live" && h.framesOut > 0)) return { ok: true };
      await new Promise((r) => setTimeout(r, 40));
    }
    const s = Math.round(timeoutMs / 1000);
    return {
      ok: false,
      error:
        h.state === "starting"
          ? `The Mac helper did not start within ${s} s for "${h.title}" (macOS may be waiting for screen-recording permission for the helper/daemon: System Settings → Privacy & Security → Screen & System Audio Recording).`
          : `No picture from "${h.title}" within ${s} s: the window is probably minimized or on another Space/desktop (ScreenCaptureKit sends nothing for those). Show it on screen and try again.`,
    };
  }

  /** Keeps a display stream running while the headset is connected (auto-restart with backoff). */
  async ensureDisplay(): Promise<void> {
    const cfg = this.o.config.display;
    if (!cfg.alwaysOn || this.displaySuppressed || this.displayStarting || !this.isConnected()) return;
    if ([...this.streams.streams.values()].some((h) => h.source === "display" && h.state !== "stopped" && h.state !== "error")) return;
    if (!this.streams.available()) {
      if (!this.displayWarnedNoHelper) {
        this.displayWarnedNoHelper = true;
        log("display stream: Mac helper not built, the screen is not mirrored (cd mac-helper && ./build.sh)");
      }
      return;
    }
    if (Date.now() < this.displayNextTry) return;
    try {
      const r = await this.startStream({ op: "stream_start", source: "display", timeoutMs: 60_000, auto: true });
      if (r.status === "shown") {
        this.displayFailures = 0;
      } else if (r.status === "dismissed" && r.data?.declined) {
        this.displaySuppressed = true;
        this.toast("Skärmspegling avstängd (inte godkänd). Tryck Starta skärmen när du vill.", "attention");
      } else if (r.status !== "not_connected") {
        this.displayFailures++;
        this.displayNextTry = Date.now() + Math.min(5 * 60_000, 5_000 * 3 ** Math.min(this.displayFailures - 1, 4));
        logError("spegling", `display stream could not start (${this.displayFailures}): ${String(r.data?.error ?? r.status)}`);
        if (this.displayFailures === 1 || this.displayFailures === 3) this.toast(`Skärmen kunde inte startas: ${String(r.data?.error ?? r.status).slice(0, 160)}`, "attention");
      }
    } catch (e) {
      this.displayFailures++;
      this.displayNextTry = Date.now() + Math.min(5 * 60_000, 5_000 * 3 ** Math.min(this.displayFailures - 1, 4));
      logError("spegling", `display stream: ${(e as Error).message}`);
    }
  }

  private scheduleDisplay(ms = 1500) {
    const t = setTimeout(() => void this.ensureDisplay(), ms);
    t.unref?.();
  }

  private onStreamState(h: StreamHandle, reason?: string) {
    this.send({ type: "stream_state", streamId: h.streamId, state: h.state, reason, width: h.width, height: h.height });
    if (h.state === "stopped" || h.state === "error") this.flows.delete(h.streamId);
    if (h.state === "live") this.flows.get(h.streamId)?.resync();
    if ((h.state === "stopped" || h.state === "error") && h.panelId && this.panels.has(h.panelId)) this.removePanel(h.panelId, true);
    if (h.state === "error") this.toast(`Ström "${h.title}": ${reason ?? "fel"}`.slice(0, 220), "attention");
    // Any state change can mean the physical screen must light up again (paused/locked/secure input/stopped).
    this.updateDim();
    this.updateHud();
    if (h.source === "display" && (h.state === "stopped" || h.state === "error")) this.scheduleDisplay();
  }

  // ---------------- dimming of the physical display (see brightness.ts) ----------------

  private displayStream(): StreamHandle | undefined {
    return [...this.streams.streams.values()].find((h) => h.source === "display");
  }

  /** Dim only while the headset really shows the display stream (frames acked recently); otherwise restore. */
  private updateDim() {
    const d = this.displayStream();
    this.keepAwake.set(!!d && d.state !== "stopped" && d.state !== "error" && this.isConnected());
    const g = this.brightness;
    if (!g) return;
    const flow = d ? this.flows.get(d.streamId) : undefined;
    const flowing = !!flow && flow.lastAckAt > 0 && Date.now() - flow.lastAckAt < DIM_STALL_MS && !!this.videoWs && this.videoWs.readyState === WebSocket.OPEN;
    const want = this.isConnected() && !!d && d.state === "live" && flowing && Date.now() >= this.dimHoldUntil;
    try {
      if (want && !g.dimmed) {
        if (g.dim()) this.updateHud();
      } else if (!want && (g.dimmed || g.hasSavedFile())) {
        // A stall (headset stopped acking while "live") must not leave the user with a dark screen: restore, and
        // wait 30 s before dimming again so it cannot flap.
        if (this.isConnected() && d?.state === "live" && !flowing) this.dimHoldUntil = Date.now() + 30_000;
        g.restore();
        this.updateHud();
      }
    } catch (e) {
      logError("brightness", (e as Error).message);
    }
  }

  private maybeDimSoon(h: StreamHandle) {
    if (!this.brightness || this.brightness.dimmed || h.source !== "display" || this.dimCheckTimer) return;
    this.dimCheckTimer = setTimeout(() => {
      this.dimCheckTimer = undefined;
      this.updateDim();
    }, 1000);
    this.dimCheckTimer.unref?.();
  }

  // ---------------- status line (HUD) in the headset ----------------

  private updateHud() {
    if (!this.isConnected()) return;
    const hs = [...this.streams.streams.values()];
    const d = hs.find((h) => h.source === "display");
    const displayState: HudMsg["displayState"] = d ? (d.state === "stopped" ? "off" : d.state) : this.displaySuppressed || !this.o.config.display.alwaysOn ? "off" : this.displayStarting ? "starting" : "off";
    const dot = (h: StreamHandle) => (h.state === "live" ? "●" : h.state === "paused" ? "⏸" : h.state === "error" ? "✕" : "…");
    const short = (t: string) => (t.length > 22 ? t.slice(0, 21) + "…" : t);
    const parts = hs.map((h) => `${h.source === "display" ? "Skärm" : short(h.title.split(" – ")[0])} ${dot(h)}`);
    const text = [parts.length ? `Ström: ${parts.join(" · ")}` : "Ingen ström", `Mikrofon: ${this.voice.size ? "lyssnar" : "av"}`, this.brightness?.dimmed ? "Macens skärm dimmad" : ""].filter(Boolean).join(" | ");
    this.send({
      type: "hud",
      text,
      streams: hs.map((h) => ({ streamId: h.streamId, title: h.title, source: h.source, state: h.state })),
      micListening: this.voice.size > 0,
      dimmed: !!this.brightness?.dimmed,
      displayState,
    });
  }

  /**
   * 0.4.1: audio goes on the /video socket WITHOUT VideoFlow (no credits, no keyframe waits). When the socket is
   * backed up (video IDR, weak Wi-Fi) the block is dropped instead of queued: late audio is worse than a gap.
   */
  private sendAudio(captureUs: bigint, pcm: Buffer) {
    const ws = this.videoWs;
    if (!this.isConnected() || !ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > AUDIO_MAX_BUFFERED) {
      this.audioDropped++;
      return;
    }
    ws.send(encodeAudioFrame("mac", this.audioSeq++, captureUs, pcm));
  }

  /**
   * Target rectangle on the Mac for a panel. Only the main display stream ("display", streamed from display 0 =
   * main) has one: its origin is (0,0) in global points. Window panels: null until the helper reports window
   * frames (origin), which it does not yet. Everything else: null.
   */
  private inputTarget(panelId: string): Rect | null {
    if (panelId !== "display" || !this.panels.has("display")) return null;
    return this.displayRectPt ?? null;
  }

  private async loadDisplayRect() {
    try {
      const d = await this.streams.runJson<{ widthPt: number; heightPt: number }>(["display-info"]);
      if (d.widthPt > 0 && d.heightPt > 0) this.displayRectPt = { x: 0, y: 0, w: d.widthPt, h: d.heightPt };
    } catch (e) {
      log("input: display-info failed:", (e as Error).message);
    }
  }

  private audioStatus() {
    const a = this.streams.audio;
    const secs = a ? Math.max(1, (Date.now() - a.startedAt) / 1000) : 1;
    return {
      state: a?.state ?? (this.audioLastError ? "error" : "off"),
      frames: a?.framesOut ?? 0,
      dropped: this.audioDropped,
      kbps: a ? Math.round((a.bytesOut * 8) / secs / 1000) : 0,
      ...(this.audioLastError && !a ? { error: this.audioLastError } : {}),
    };
  }

  private flowFor(id: string): VideoFlow {
    let f = this.flows.get(id);
    if (!f) {
      f = new VideoFlow(id, {
        requestKeyframe: () => this.streams.requestKeyframe(id),
        setBitrate: (bps) => this.streams.setBitrate(id, bps),
        bitrate: () => this.streams.streams.get(id)?.bitrate ?? 0,
        maxBitrate: () => this.streams.streams.get(id)?.maxBitrate ?? 0,
        send: (frame) => {
          if (!this.isConnected() || !this.videoWs || this.videoWs.readyState !== WebSocket.OPEN) return false;
          this.videoWs.send(frame);
          return true;
        },
      });
      this.flows.set(id, f);
    }
    return f;
  }

  /** /video socket: authenticated with the same token, must belong to the active headset. */
  private onVideoSocket(ws: WebSocket) {
    let authed = false;
    const timer = setTimeout(() => !authed && ws.terminate(), FIRST_MESSAGE_DEADLINE_MS);
    ws.on("message", (raw, isBinary) => {
      if (isBinary) {
        if (authed) this.onVoiceChunk(raw as Buffer);
        return;
      }
      let m: { type?: unknown; token?: unknown; s?: unknown; seq?: unknown; id?: unknown; panelId?: unknown; reason?: unknown };
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!m || typeof m !== "object") return;
      try {
        if (!authed) {
          const dev = m.type === "video_hello" ? this.o.pairing.authenticate(m.token) : null;
          if (!dev || !this.headset?.authed || dev.deviceId !== this.headset.deviceId) return void ws.close(4003, "unauthorized");
          authed = true;
          clearTimeout(timer);
          this.videoWs?.close(4000, "replaced");
          this.videoWs = ws;
          for (const id of this.streams.streams.keys()) this.flowFor(id).resync();
          return;
        }
        if (typeof m.type === "string" && m.type.startsWith("voice_")) return this.onVoiceControl(m as Record<string, unknown>);
        const f = typeof m.s === "string" ? this.flows.get(m.s) : undefined;
        if (m.type === "ack" && f && typeof m.seq === "number") f.ack(m.seq);
        else if (m.type === "idr" && f) f.resync();
      } catch (e) {
        log("video socket error:", (e as Error).message);
      }
    });
    ws.on("close", () => {
      clearTimeout(timer);
      if (this.videoWs === ws) this.videoWs = null;
    });
    ws.on("error", () => {});
  }

  // ---------------- push-to-talk voice (see voice.ts for the security model) ----------------

  /** Panels a spoken answer may go to. Never permission/approval cards. */
  private voiceTarget(id?: string): OpenPanel | undefined {
    const ok = (p: OpenPanel | undefined) => !!p && !!p.resolve && ["ask", "test", "compare", "listen"].includes(p.msg.panel.kind);
    if (id !== undefined) {
      const p = this.panels.get(id);
      return ok(p) ? p : undefined;
    }
    return [...this.panels.values()].filter(ok).sort((a, b) => b.shownAt - a.shownAt)[0];
  }

  private toast(text: string, level: "info" | "done" | "attention" = "info") {
    this.send({ type: "toast", text, level, sound: false });
  }

  private voiceState(id: string, state: VoiceUiState, extra: { text?: string; target?: string; detail?: string; autoSendMs?: number } = {}) {
    this.send({ type: "voice_state", id, state, ...extra });
    this.updateHud();
  }

  /** Sessions whose "end" never arrived (headset removed mid-press, socket died) must not block voice forever. */
  private expireVoice() {
    const limit = (this.o.config.voice.maxSeconds + 10) * 1000;
    for (const [id, v] of this.voice) {
      if (Date.now() - v.startedAt > limit) {
        this.voice.delete(id);
        this.voiceState(id, "error", { detail: "Mikrofonsessionen tog slut (släpp inte kom fram)" });
      }
    }
  }

  private onVoiceControl(m: Record<string, unknown>) {
    const id = String(m.id ?? "").slice(0, 16);
    if (m.type === "voice_start") {
      this.expireVoice();
      if (this.voice.size > 3) {
        // Stuck sessions (never ended) are dropped instead of silently ignoring every new press.
        const oldest = [...this.voice.keys()][0];
        this.voice.delete(oldest);
      }
      const target = typeof m.panelId === "string" ? m.panelId : undefined;
      if (target !== undefined && !this.voiceTarget(target)) {
        // e.g. a permission card: voice can never approve anything.
        this.toast("Rösten kan inte svara på det här kortet: tryck på en knapp.", "attention");
        this.voiceState(id, "error", { detail: "Rösten kan inte svara på det här kortet: tryck på en knapp." });
        return;
      }
      this.voice.set(id, { chunks: [], bytes: 0, target, startedAt: Date.now() });
      this.voiceState(id, "listening");
    } else if (m.type === "voice_cancel") {
      if (this.voice.delete(id)) this.voiceState(id, "cancelled");
    } else if (m.type === "voice_end") {
      const v = this.voice.get(id);
      this.voice.delete(id);
      if (!v) return;
      this.voiceState(id, "transcribing");
      // One transcription at a time (parallel whisper runs fight for the CPU and made 2-4 s clips take 50 s).
      this.sttQueue = this.sttQueue.then(() => this.processVoice(id, v)).catch((e) => {
        logError("röst", (e as Error).message);
        this.voiceState(id, "error", { detail: "Taligenkänningen misslyckades: " + (e as Error).message.slice(0, 120) });
      });
    } else if (m.type === "voice_error") {
      const reason = String(m.reason ?? "error").slice(0, 40);
      log(`voice error from headset: ${reason}`);
      this.voice.clear();
      this.voiceState(id || "-", "error", { detail: reason === "mic_denied" ? "Mikrofonen är nekad i headsetet (Inställningar → Appar → ClaudeXR → Behörigheter)" : `Mikrofonen kunde inte startas (${reason})` });
      for (const p of this.panels.values()) {
        if (p.resolve && p.msg.panel.kind === "listen") {
          p.resolve({ status: "error", panelId: p.msg.id, data: { error: `microphone unavailable in the headset (${reason})` } });
          this.removePanel(p.msg.id, true);
        }
      }
    }
  }

  /** [0xA1][u8 idLen][id][s16le mono 16 kHz PCM] */
  private onVoiceChunk(b: Buffer) {
    if (b.length < 3 || b[0] !== 0xa1) return;
    const idLen = b[1];
    const v = this.voice.get(b.subarray(2, 2 + idLen).toString("ascii"));
    if (!v) return;
    const pcm = b.subarray(2 + idLen);
    if (v.bytes + pcm.length > this.o.config.voice.maxSeconds * SAMPLE_RATE * 2) return; // cap length
    v.chunks.push(Buffer.from(pcm));
    v.bytes += pcm.length;
  }

  /** Where a confirmed spoken text will go (shown in the preview). */
  private voiceDestination(target?: string): string {
    const t = target !== undefined ? this.voiceTarget(target) : this.voiceTarget();
    if (t) return `Svar på: ${(panelTitle(t.msg.panel) ?? t.msg.panel.kind).slice(0, 80)}`;
    return "Chatten (Claude)";
  }

  private async processVoice(id: string, v: { chunks: Buffer[]; bytes: number; target?: string }) {
    if (v.bytes < SAMPLE_RATE * 2 * 0.3) return this.voiceState(id, "error", { detail: "För kort: håll in medan du talar" });
    const t0 = Date.now();
    let text: string;
    try {
      text = await transcribePcm(this.o.config.voice, this.o.config.captureBin, Buffer.concat(v.chunks));
    } catch (e) {
      const ms = Date.now() - t0;
      logError("röst", `${(e as Error).message} (${ms} ms for ${(v.bytes / (SAMPLE_RATE * 2)).toFixed(1)} s of audio)`);
      return this.voiceState(id, "error", { detail: /timed out/.test((e as Error).message) ? `Taligenkänningen tog för lång tid (> ${Math.round(this.o.config.voice.timeoutMs / 1000)} s). Prova en kortare mening.` : "Taligenkänningen misslyckades (se loggen)" });
    }
    log(`voice: transcribed ${v.bytes} bytes (${(v.bytes / (SAMPLE_RATE * 2)).toFixed(1)} s) in ${Date.now() - t0} ms`);
    if (!text) return this.voiceState(id, "error", { detail: "Jag hörde inget" });
    // (c) fixed local commands, no model, no tokens. Only when not answering a specific card.
    const cmd = v.target === undefined ? matchCommand(text) : null;
    if (cmd) {
      this.runLocalCommand(cmd.cmd);
      // A tolerant match is never silent: the user sees which command was understood.
      return this.voiceState(id, "sent", { text, detail: cmd.exact ? "Kommando utfört" : `Kommando utfört: ${cmd.phrase}` });
    }
    // Known mishearings of product words ("maken" -> "Macen"); the user sees the result in the preview.
    text = correctTerms(text, this.o.config.voice.corrections);
    // Preview with Skicka / Avbryt in the voice panel (no second "Jag hörde" card that could collide with it).
    const autoMs = this.o.config.voice.autoSendMs;
    const dest = this.voiceDestination(v.target);
    this.voiceState(id, "preview", { text, target: dest, autoSendMs: autoMs });
    const send = await new Promise<boolean>((resolve) => {
      const done = (x: boolean) => {
        clearTimeout(timer);
        clearTimeout(auto);
        this.voiceDecisions.delete(id);
        resolve(x);
      };
      const timer = setTimeout(() => done(false), this.o.config.voice.previewTimeoutMs);
      const auto = autoMs > 0 ? setTimeout(() => done(true), autoMs) : undefined;
      this.voiceDecisions.set(id, done);
    });
    if (!send) {
      this.o.bugs?.autoLog(`Möjlig feltolkning av röst (avbruten): "${text.slice(0, 120)}"`, "röst", this.devContext(false));
      return this.voiceState(id, "cancelled", { text });
    }
    const target = v.target !== undefined ? this.voiceTarget(v.target) : this.voiceTarget();
    if (target) {
      const tid = target.msg.id;
      const title = (panelTitle(target.msg.panel) ?? target.msg.panel.kind).slice(0, 60);
      target.resolve?.({ status: "answered", panelId: tid, data: voiceAnswer(target.msg.panel, text) });
      this.removePanel(tid, true);
      return this.voiceState(id, "sent", { text, detail: `Svarade på: ${title}` });
    }
    // No question waits: the message goes to the chat (voice channel if it is running, otherwise next prompt).
    const { route } = this.voiceRouter.add(text);
    log(`voice: message routed via ${route}`);
    if (route === "channel") return this.voiceState(id, "sent", { text, detail: "Skickat till chatten (röstkanalen)" });
    if (route === "rewake") return this.voiceState(id, "sent", { text, detail: "Claude väcks och får meddelandet nu" });
    if (route === "working") return this.voiceState(id, "sent", { text, detail: "Claude arbetar och får det vid nästa steg (några sekunder)" });
    this.voiceState(id, "queued", { text, detail: "Claude är inte igång just nu. Meddelandet följer med din nästa prompt i terminalen (sparas i 10 min)." });
  }

  private runLocalCommand(cmd: LocalCommand) {
    log(`voice command: ${cmd}`);
    switch (cmd) {
      case "close_all":
        this.clear();
        return this.toast("✓ Stängde alla paneler", "done");
      case "cinema":
      case "screen_bigger":
      case "screen_smaller":
      case "screen_farther":
      case "screen_closer":
      case "screen_reset": {
        const preset = cmd === "cinema" ? "cinema" : cmd.slice("screen_".length);
        const r = this.screenPreset(preset as ScreenPreset);
        return this.toast(r.status === "updated" ? "✓ Macens skärm justerad" : "Macens skärm speglas inte", r.status === "updated" ? "done" : "attention");
      }
      case "close_others":
        this.clear("all", undefined, true);
        return this.toast("✓ Stängde allt utom Macens skärm", "done");
      case "recenter":
        this.send({ type: "recenter" });
        return this.toast("✓ Centrerat", "done");
      case "focus":
      case "review":
        this.layout(cmd);
        return this.toast(cmd === "focus" ? "✓ Fokusläge" : "✓ Visar alla", "done");
      case "pause_streams": {
        // The Mac screen stays on (0.3.0); only window streams stop. "stäng alla paneler" closes everything.
        const r = this.stopStreams();
        const n = (r.data?.stopped as string[] | undefined)?.length ?? 0;
        return this.toast(n ? `✓ Stoppade ${n} fönsterström(mar), skärmen kvar` : "Inga fönsterströmmar igång", "done");
      }
      case "status": {
        const s = this.status();
        const a = s.activity?.state === "working" ? "arbetar" : s.activity?.state === "waiting" ? "väntar på dig" : s.activity?.state === "done" ? "klar" : "vilar";
        return this.toast(`Claude ${a} · ${s.openPanels.length} paneler · ${s.streams.length} strömmar`);
      }
    }
  }

  // ---------------- screen calibration ----------------

  private async calibrate(timeoutMs: number, signal?: AbortSignal): Promise<CommandResult> {
    if (!this.isConnected()) return { status: "not_connected" };
    type DisplayInfo = { widthPt: number; heightPt: number; widthMm: number; heightMm: number; widthPx: number; heightPx: number };
    const d = await this.streams.runJson<DisplayInfo>(["display-info"]);
    if (!(d.widthMm > 0 && d.widthPt > 0)) return { status: "error", data: { error: "display-info returned no physical size" } };
    this.displayRectPt = { x: 0, y: 0, w: d.widthPt, h: d.heightPt };
    const payload = "CLAUDEXR-CAL-" + randomBytes(8).toString("hex").toUpperCase().slice(0, 7);
    const qr = QRCode.create(payload, { version: 2, errorCorrectionLevel: "M" });
    const n = qr.modules.size; // 25 for version 2
    const bits = Array.from({ length: n * n }, (_, i) => (qr.modules.get(Math.floor(i / n), i % n) ? "1" : "0")).join("");
    const sizePt = Math.round(Math.min(d.widthPt, d.heightPt) * 0.6);
    const mmPerPt = d.widthMm / d.widthPt;
    const requestId = randomUUID().slice(0, 8);
    const seconds = Math.ceil(timeoutMs / 1000);
    this.markerProc?.kill();
    this.markerProc = spawn(this.o.config.captureBin, ["show-marker", "--modules", String(n), "--bits", bits, "--size-pt", String(sizePt), "--seconds", String(seconds)], { stdio: "ignore" });
    this.markerProc.on("error", (e) => logError("spegling", "show-marker failed:", e.message));
    const result = await new Promise<Record<string, unknown>>((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: "timeout" }), timeoutMs);
      const done = (r: Record<string, unknown>) => {
        clearTimeout(timer);
        this.calibrations.delete(requestId);
        resolve(r);
      };
      this.calibrations.set(requestId, done);
      signal?.addEventListener("abort", () => done({ ok: false, error: "aborted" }));
      this.send({
        type: "calibrate",
        requestId,
        payload,
        modules: n,
        markerSizeM: (sizePt * mmPerPt) / 1000,
        screen: { widthM: d.widthMm / 1000, heightM: d.heightMm / 1000, markerOffsetM: { x: 0, y: 0 }, widthPx: d.widthPx, heightPx: d.heightPx },
        seconds,
      });
    });
    this.markerProc?.kill();
    this.markerProc = null;
    if (!result.ok) logError("spegling", `screen calibration failed: ${result.error}`);
    if (!result.ok) result.error = calibrationHint(String(result.error ?? ""));
    return { status: result.ok ? "answered" : "error", data: result };
  }

  // ---------------- headset connection ----------------

  private send(msg: BridgeToHeadset) {
    if (this.isConnected()) this.headset!.ws.send(JSON.stringify(msg));
  }

  /** Model-free housekeeping: minimize stale panels and keep at most MAX_VISIBLE panels expanded. */
  private autoTidy() {
    const visible = [...this.panels.values()].filter((p) => !p.minimized && !p.resolve && !p.streamId && p.msg.role !== "overlay");
    const toMin = new Set<OpenPanel>(visible.filter((p) => Date.now() - p.updatedAt > STALE_MS));
    const rest = visible.filter((p) => !toMin.has(p)).sort((a, b) => a.updatedAt - b.updatedAt);
    while (rest.length > MAX_VISIBLE) toMin.add(rest.shift()!);
    if (!toMin.size) return;
    for (const p of toMin) p.minimized = true;
    this.send({ type: "layout", mode: this.layoutMode, ids: [...this.panels.values()].filter((p) => p.minimized).map((p) => p.msg.id) });
  }

  /** Bridge-owned panels fed directly by hooks (no model tokens): latest diff, latest test output. */
  private autoPanel(key: string, title: string, html: string) {
    if (!this.isConnected() || !this.o.config.autoPanels) return;
    const existing = [...this.panels.values()].find((p) => p.autoKey === key);
    if (existing) {
      this.update({ op: "update", id: existing.msg.id, panel: { kind: "html", html, title } as never });
      return;
    }
    void this.show("log", { kind: "html", title, html, size: "medium" }, false, 0).then((r) => {
      const p = r.panelId ? this.panels.get(r.panelId) : undefined;
      if (p) p.autoKey = key;
    });
  }

  private tick() {
    this.autoTidy();
    for (const c of this.conns) {
      if (!c.authed && Date.now() - c.since.getTime() > UNAUTH_TIMEOUT_MS) c.ws.close(4003, "pairing timeout");
    }
    this.expireVoice();
    this.updateDim();
    const h = this.headset;
    if (!h) return;
    // 0.3.0: two missed pings (~20-30 s) before the connection is declared dead (a Quest that dozes for a moment
    // or a busy Wi-Fi no longer triggers an immediate code 1006). Any message from the headset counts as alive.
    if (!h.alive) {
      h.missedPongs++;
      if (h.missedPongs >= 2) {
        log(`headset heartbeat lost (no answer for ${Math.round((Date.now() - h.lastSeen) / 1000)} s), terminating connection`);
        h.ws.terminate();
        return;
      }
    } else h.missedPongs = 0;
    if (h.authed && this.isConnected()) {
      this.send({ type: "sync", ids: [...this.panels.keys()] });
      void this.ensureDisplay();
    }
    h.alive = false;
    h.pingSentAt = Date.now();
    h.ws.ping();
  }

  private onHeadset(ws: WebSocket, req: http.IncomingMessage) {
    const conn: HeadsetConn = {
      ws,
      authed: false,
      since: new Date(),
      remoteAddress: req.socket.remoteAddress?.replace(/^::ffff:/, ""),
      localAddress: req.socket.localAddress?.replace(/^::ffff:/, ""),
      alive: true,
      pairRequests: 0,
      missedPongs: 0,
      lastSeen: Date.now(),
    };
    this.conns.add(conn);
    conn.firstMsgTimer = setTimeout(() => ws.terminate(), FIRST_MESSAGE_DEADLINE_MS);
    ws.on("pong", () => {
      conn.alive = true;
      conn.lastSeen = Date.now();
      if (conn.pingSentAt) this.latency.wsRttMs = Date.now() - conn.pingSentAt;
    });
    ws.on("message", (raw, isBinary) => {
      if (isBinary) return;
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      // Validate every frame (review S1: a bare "null" used to crash the process).
      if (!msg || typeof msg !== "object" || Array.isArray(msg) || typeof (msg as { type?: unknown }).type !== "string") {
        log("ignoring malformed message from headset");
        return;
      }
      clearTimeout(conn.firstMsgTimer);
      conn.alive = true;
      conn.lastSeen = Date.now();
      try {
        const r = this.onHeadsetMessage(conn, msg as HeadsetToBridge);
        if (r instanceof Promise) r.catch((e) => log("error handling headset message:", (e as Error).message));
      } catch (e) {
        // Never let one bad frame take down the bridge.
        log("error handling headset message:", (e as Error).message);
      }
    });
    ws.on("close", (code) => {
      clearTimeout(conn.firstMsgTimer);
      this.o.pairing.release(conn);
      this.conns.delete(conn);
      if (this.headset === conn) {
        log(`headset disconnected (code ${code})`);
        this.headset = null;
        this.voicePanelOpen = false;
        this.flagOffSync(); // heartbeat lost / 1006 / unpair all end up here
        // Privacy: never keep streaming into a headset that is gone.
        this.input.off("headset_gone");
        this.streams.stopAudio();
        this.streams.stop();
        this.videoWs?.close(4000, "headset gone");
        // The physical screen must light up again at once, and half-finished voice input is dropped.
        this.restoreBrightnessSync();
        this.voice.clear();
        for (const [, d] of this.voiceDecisions) d(false);
        this.voiceDecisions.clear();
        if (code !== 1000 && code !== 4000 && code !== 4001) logError("brygga", `Anslutningen till headsetet bröts (kod ${code})`);
      }
    });
    ws.on("error", (e) => log("headset socket error:", e.message));
  }

  private sendTo(conn: HeadsetConn, msg: BridgeToHeadset) {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(msg));
  }

  private async onHeadsetMessage(conn: HeadsetConn, msg: HeadsetToBridge): Promise<void> {
    // --- allowed before authentication ---
    if (msg.type === "pair_request") {
      if (conn.authed) return;
      if (++conn.pairRequests > 3) return void conn.ws.close(4004, "too many pairing requests");
      const r = this.o.pairing.requestCode(cleanPeerString(msg.device, 40) ?? "headset", conn, conn.remoteAddress);
      if ("error" in r) this.sendTo(conn, { type: "pair_failed", reason: r.error });
      else this.sendTo(conn, { type: "pair_code_shown", expiresInS: r.expiresInS });
      return;
    }
    if (msg.type === "pair_confirm") {
      if (conn.authed) return;
      const r = await this.o.pairing.confirm(conn, cleanPeerString(msg.device, 40) ?? "headset", String(msg.nonce ?? ""), String(msg.mac ?? ""), conn.remoteAddress);
      if ("error" in r) {
        log(`pairing attempt failed: ${r.error}`);
        this.sendTo(conn, { type: "pair_failed", reason: r.error });
      } else this.sendTo(conn, { type: "pair_ok", token: r.token, deviceId: r.deviceId });
      return;
    }
    if (msg.type === "hello") {
      const dev = this.o.pairing.authenticate(msg.token);
      if (!dev) {
        log(`rejected unpaired headset from ${conn.remoteAddress}`);
        this.sendTo(conn, { type: "unauthorized", reason: msg.token ? "unknown_token" : "not_paired" });
        return;
      }
      if (this.headset && this.headset !== conn) this.headset.ws.close(4000, "replaced");
      conn.authed = true;
      conn.device = cleanPeerString(msg.device) ?? cleanPeerString(dev.name);
      conn.app = cleanPeerString(msg.app);
      conn.appVersion = cleanPeerString(msg.appVersion, 24);
      conn.deviceId = dev.deviceId;
      this.headset = conn;
      this.flagOn("headset");
      log(`headset connected: ${conn.device} ${conn.appVersion ?? ""} from ${conn.remoteAddress}`);
      // "open" lets the app keep panels it already shows (no WebView reloads on reconnect, review patch 09).
      // 0.3.0: stream panels are included (a stream that survived a quick reconnect keeps its panel; orphans are swept).
      const openIds = [...this.panels.values()].map((p) => p.msg.id);
      this.send({ type: "welcome", protocol: PROTOCOL_VERSION, server: "claudexr-bridge", host: os.hostname(), bridgeVersion: BRIDGE_VERSION, devMode: this.o.config.devMode, open: openIds });
      for (const p of this.panels.values()) {
        this.send(p.msg);
        if (p.size) this.send({ type: "update", id: p.msg.id, widthM: p.size.widthM, heightM: p.size.heightM });
        const sh = p.streamId ? this.streams.streams.get(p.streamId) : undefined;
        if (sh) {
          this.send({ type: "stream_state", streamId: sh.streamId, state: sh.state, width: sh.width, height: sh.height });
          this.flows.get(sh.streamId)?.resync();
        }
      }
      this.send({ type: "activity", activity: this.activity.snapshot() });
      // The always-on display stream starts. A display that was stopped ON PURPOSE (panel closed, "Stäng allt",
      // xr_stream stop, declined card) stays off across reconnects (a 1006 must not undo the panic button):
      // only "Starta skärmen", xr_stream display or a daemon restart bring it back.
      this.displayFailures = 0;
      this.displayNextTry = 0;
      this.updateHud();
      this.scheduleDisplay(300);
      return;
    }
    // Only the current, authenticated headset may answer or report (review S4).
    if (!conn.authed || conn !== this.headset) {
      log(`ignoring "${String((msg as { type?: string }).type).slice(0, 20)}" from a connection that is not the active headset`);
      return;
    }
    if ("id" in msg && msg.id !== undefined && typeof msg.id !== "string") return;
    // --- authenticated ---
    switch (msg.type) {
      case "response": {
        const p = this.panels.get(msg.id);
        if (p?.resolve) {
          const data = msg.data && typeof msg.data === "object" && !Array.isArray(msg.data) ? msg.data : {};
          p.resolve({ status: "answered", panelId: msg.id, data });
          this.removePanel(msg.id, true);
        }
        return;
      }
      case "dismissed": {
        const p = this.panels.get(msg.id);
        if (!p) return;
        p.resolve?.({ status: "dismissed", panelId: msg.id });
        if (p.streamId) this.stopStreamQuiet(p.streamId); // the user closed it: the display stays off until "Starta skärmen"
        this.removePanel(msg.id, false);
        this.updateDim();
        this.updateHud();
        return;
      }
      case "panel_moved": {
        const p = this.panels.get(msg.id);
        if (!p) return;
        p.placement = msg.placement;
        if (msg.widthM && msg.heightM) p.size = { widthM: msg.widthM, heightM: msg.heightM };
        p.movedByUser = true;
        return;
      }
      case "calibration_result":
        this.calibrations.get(msg.requestId)?.({ ...msg });
        return;
      case "request_calibration":
        // The user pressed "Kalibrera skärm" in the headset (a physical action).
        void this.calibrate(45_000).catch((e) => logError("spegling", "calibration:", (e as Error).message));
        return;
      case "voice_decision":
        this.voiceDecisions.get(String(msg.id))?.(msg.send === true);
        return;
      case "close_others":
        this.runLocalCommand("close_others");
        return;
      case "voice_panel":
        this.voicePanelOpen = msg.open === true;
        return;
      case "emergency_close":
        this.emergency();
        this.toast("✓ Allt stängt, ljusstyrkan återställd", "done");
        return;
      case "input_gate":
        // Only this message (sent by the app for a physical button press) can open the gate. Voice and MCP have no path.
        if (msg.on === true) {
          this.input.enable("headset-button");
          if (!this.displayRectPt) void this.loadDisplayRect();
          this.toast("Inmatning till Macen: PÅ (testläge, inget skickas ännu)", "attention");
        } else {
          this.input.off("headset");
          this.toast("Inmatning till Macen: AV", "done");
        }
        return;
      case "pointer":
        this.input.handle(msg.event);
        return;
      case "restart_display":
        this.displaySuppressed = false;
        this.displayFailures = 0;
        this.displayNextTry = 0;
        this.toast("Startar skärmen…");
        void this.ensureDisplay();
        return;
      case "app_log":
        if (msg.level === "error") logError("quest-app", `app: ${msg.message}`);
        else log(`app: ${msg.message}`);
        return;
    }
  }

  // ---------------- Claude Code hooks (http hooks or command shims) ----------------

  /** Returns the hook's JSON output; {} means "no output" (silent / no decision). Never throws. */
  async hook(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    try {
      switch (name) {
        case "context":
          this.voiceRouter.note(input);
          return this.contextHook.handle(input, this.status(), this.voiceRouter.forPrompt());
        case "activity":
          this.voiceRouter.note(input);
          await this.execute({ op: "event", event: trimEvent(input) });
          // 0.4.0: a spoken message that waits is handed to the working session here (PostToolUse / Stop).
          return this.voiceRouter.forHook(input);
        case "permission": {
          // FAIL-CLOSED: a decision is returned only for an explicit tap in the paired headset.
          if (input.hook_event_name && input.hook_event_name !== "PermissionRequest") return {};
          if (!this.o.config.xrPermissions || fs.existsSync(path.join(stateDir(), "permissions-off"))) return {};
          const { panel, approvable, reason } = buildPermissionPanel(input);
          if (!approvable) {
            log(`permission request not offered in XR: ${reason}`);
            return {};
          }
          const r = await this.execute({ op: "show", role: "primary", panel, wait: true, timeoutMs: this.o.config.permissionTimeoutS * 1000 }, signal);
          return r.status === "answered" ? decisionOutput(r.data?.decision) : {};
        }
        default:
          return {};
      }
    } catch (e) {
      log("hook error:", (e as Error).message);
      return {};
    }
  }

  // ---------------- loopback HTTP ----------------

  private onLocalHttp(req: http.IncomingMessage, res: http.ServerResponse) {
    const json = (code: number, body: unknown) => {
      if (res.writableEnded) return;
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const path = (req.url ?? "").split("?")[0];
    // Review S3: DNS rebinding (foreign Host), browsers (any Origin), and anything without the secret.
    if (!isLoopbackHost(req.headers.host, this.localPort)) return json(403, { error: "bad host" });
    if (req.headers.origin !== undefined) return json(403, { error: "browser requests are not allowed" });
    if (!checkBearer(req.headers.authorization, this.localToken)) return json(401, { error: "missing or wrong token" });
    const route = this.o.routes?.[path];
    if (route) {
      if (req.method === "POST" && String(req.headers["content-type"] ?? "").split(";")[0].trim() !== "application/json") return json(415, { error: "application/json required" });
      route(req, res).catch((e) => {
        log("route error:", (e as Error).message);
        json(500, { error: "internal error" });
      });
      return;
    }
    if (req.method === "GET" && path === "/status") return json(200, this.status());
    // Never hand out the pairing code over HTTP (it is shown on the Mac only).
    if (req.method === "GET" && path === "/pairing") return json(200, { pending: this.o.pairing.hasPendingCode(), paired: this.o.pairing.list() });
    if (req.method === "POST" && (path === "/command" || path === "/event" || path.startsWith("/hook/"))) {
      const ctype = String(req.headers["content-type"] ?? "").split(";")[0].trim();
      if (ctype !== "application/json") return json(415, { error: "application/json required" });
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (c: string) => {
        body += c;
        if (body.length > MAX_COMMAND_BYTES) {
          json(413, { error: "too large" });
          req.destroy();
        }
      });
      req.on("end", async () => {
        const ac = new AbortController();
        res.on("close", () => {
          if (!res.writableFinished) ac.abort();
        });
        try {
          const parsed = JSON.parse(body);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json(400, { error: "JSON object required" });
          if (path === "/hook/voicewait") {
            // Long poll for the asyncRewake Stop hook: plain text (the hook prints it and exits 2), 204 = nothing.
            const text = await this.voiceRouter.wait(parsed, ac.signal);
            if (res.writableEnded || res.destroyed) return;
            res.writeHead(text ? 200 : 204, { "content-type": "text/plain; charset=utf-8" });
            return void res.end(text);
          }
          if (path.startsWith("/hook/")) return json(200, await this.hook(path.slice(6), parsed, ac.signal));
          const cmd: HubCommand = path === "/event" ? { op: "event", event: parsed } : parsed;
          json(200, await this.execute(cmd, ac.signal));
        } catch (e) {
          json(400, { status: "error", data: { error: String((e as Error).message ?? e) } });
        }
      });
      return;
    }
    json(404, { error: "not found" });
  }
}

/**
 * Stable panel id for a stream (BUG-39391d): "display" for the Mac screen ("display-<id>" for another display) and
 * "win-<window id>" for a window. The id survives restarts of the stream, so tools, buttons and voice commands can
 * always point at the Mac screen with id "display". (The stream id still changes per start: it names one encoder run.)
 */
export function streamPanelId(key: string): string {
  if (key === "display:main") return "display";
  const [kind, n] = key.split(":");
  return kind === "display" ? `display-${n}` : `win-${n}`;
}

/** xr_panel update body: interpreted according to the panel kind. */
function applyBody(p: PanelSpec, body: string, title: string | undefined, lanHost: string | undefined) {
  switch (p.kind) {
    case "preview":
      p.url = rewriteLocalUrl(body, lanHost);
      break;
    case "html":
      p.html = p.format && p.format !== "html" ? renderText(title ?? p.title, body, p.format) : body;
      break;
    case "text":
      p.content = body;
      break;
    case "ask":
      p.context = body;
      break;
    case "test":
      p.instructions = body;
      break;
  }
}

function checkBearer(header: string | undefined, token: string): boolean {
  const m = /^Bearer\s+(\S+)$/.exec(header ?? "");
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Secret for the loopback API, shared with hooks and the MCP client via a 0600 file. */
export function loadOrCreateLocalToken(): string {
  const file = path.join(stateDir(), "local-token");
  let t = "";
  try {
    t = fs.readFileSync(file, "utf8").trim();
  } catch {}
  if (t.length < 32) {
    t = randomBytes(32).toString("base64url");
    fs.writeFileSync(file, t + "\n", { mode: 0o600 });
  }
  fs.chmodSync(file, 0o600); // also fixes a file created/copied with wider permissions
  // Review 2 R2-08: ready-made header file for Claude Code's MCP `headersHelper` ("cat <file>"), so the
  // token never has to be pasted into ~/.claude.json / settings.json (often synced or shared).
  const headers = path.join(stateDir(), "mcp-headers.json");
  fs.writeFileSync(headers, JSON.stringify({ Authorization: `Bearer ${t}` }) + "\n", { mode: 0o600 });
  fs.chmodSync(headers, 0o600);
  return t;
}

/** A confirmed spoken answer, mapped onto the panel's answer format. Marked voice:true. */
function voiceAnswer(p: PanelSpec, text: string): Record<string, unknown> {
  switch (p.kind) {
    case "ask": {
      const i = matchOption(text, p.options.map((o) => o.label));
      return i === null ? { text, voice: true } : { choiceIndex: i, voice: true, text };
    }
    case "test": {
      const v = matchVerdict(text);
      return v ? { verdict: v, checked: [], voice: true } : { verdict: "unknown", note: text, checked: [], voice: true };
    }
    case "compare": {
      const c = matchAB(text);
      return c ? { choice: c, voice: true } : { text, voice: true };
    }
    default:
      return { text, voice: true };
  }
}

function webUrls(p: PanelSpec): string[] {
  if (p.kind === "preview") return [p.url];
  if (p.kind === "test") return p.url ? [p.url] : [];
  if (p.kind === "compare") return [p.a.url, p.b.url];
  return [];
}

function componentOf(msg: string): Component {
  const m = msg.match(/^\[([^\]]+)\]/);
  const c = m?.[1];
  return (["brygga", "quest-app", "spegling", "hooks", "skills/presentation"] as const).find((x) => x === c) ?? "brygga";
}

export function panelTitle(p: PanelSpec): string | undefined {
  switch (p.kind) {
    case "ask":
      return p.question;
    case "preview":
      return p.title ?? p.url;
    case "compare":
      return p.title ?? p.question;
    case "listen":
      return p.prompt;
    case "heard":
      return `Jag hörde: ${p.text}`;
    default:
      return p.title;
  }
}
