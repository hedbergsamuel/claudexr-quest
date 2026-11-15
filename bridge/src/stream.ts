// Screen/window streaming via the macOS helper (mac-helper/, ScreenCaptureKit + VideoToolbox).
// The helper writes H.264 Annex-B access units on stdout framed as
//   [u32 BE length of the rest][u64 BE pts in µs][u8 flags (1 = keyframe)][payload]
// and JSON event lines on stderr ({"event":"started"|"paused"|"resumed"|"error", ...}).
// Control on the helper's stdin (one command per line): "K" = force an IDR frame now,
// "B <bits/s>" = change the target bitrate.
// Frames go to the headset on a SEPARATE WebSocket (/video) with credit-based flow control (see
// VideoFlow in hub.ts), so video can never delay control messages:
//   [0xC2][u8 idLen][id ascii][u32 BE seq][u64 BE captureUs][u8 flags][payload]
import { spawn, execFile, ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { StreamPolicy } from "./config.js";
import { log, logError } from "./log.js";

export interface WindowInfo {
  id: number;
  title: string;
  app: string;
  bundleId: string;
  pid: number;
  width: number;
  height: number;
  onScreen: boolean;
}

export type Access = "excluded" | "allowed" | "ask";

export function classifyApp(policy: StreamPolicy, app: string, bundleId: string): Access {
  const match = (list: string[]) =>
    list.some((x) => {
      const l = x.toLowerCase();
      return l === app.toLowerCase() || l === bundleId.toLowerCase();
    });
  if (match(policy.excludeApps)) return "excluded"; // exclusion always wins
  if (match(policy.allowApps)) return "allowed";
  return "ask";
}

export interface StreamHandle {
  streamId: string;
  title: string;
  source: "window" | "display";
  /** "display:main" | "display:<id>" | "window:<id>": a restart with the same key replaces the old stream */
  key: string;
  /** frames the helper has produced (also while the headset drops them) */
  framesOut: number;
  lastFrameAt: number;
  startedAt: number;
  errorCode?: string;
  errorMessage?: string;
  pausedReason?: string;
  state: "starting" | "live" | "paused" | "stopped" | "error";
  width: number;
  height: number;
  /** perStream mode only: this stream's own helper process (shared mode: one process for all, see StreamManager) */
  proc?: ChildProcess;
  panelId?: string;
  maxWidth: number;
  bitrate: number;
  maxBitrate: number;
}

/**
 * Human-readable reason for a helper error. Names the app/window (title) so the user knows what to approve.
 * -3801: macOS (TCC) refuses screen capture for the process that runs the helper.
 * -3805: the connection to the capture service was interrupted (often right after a TCC change or sleep).
 */
export function describeStreamError(code: string | undefined, message: string | undefined, title: string): string {
  const m = message ?? "";
  if (code === "-3801" || code === "tcc_denied" || /declined TCC/i.test(m))
    return `macOS nekar skärminspelning för "${title}": öppna Systeminställningar → Integritet och säkerhet → Skärm- och systemljudsinspelning, tillåt "claudexr-capture" och "node" (efter ombyggnad av hjälparen måste det göras om) och starta om daemonen.`;
  if (code === "-3805" || /connection being interrupted/i.test(m))
    return `Anslutningen till macOS skärminspelning avbröts för "${title}" (-3805). Det händer ofta direkt efter ändrade skärminspelningstillstånd eller när Macen väckts ur vila. Strömmen startas om automatiskt.`;
  if (/CGS_REQUIRE_INIT|did_initialize/i.test(m)) return `Mac-hjälparen kunde inte ansluta till fönsterservern (CGS_REQUIRE_INIT): installera 0.3.0-hjälparen (swift build -c release i mac-helper).`;
  if (/not found/i.test(m)) return `Fönstret hittades inte längre: ${m}`;
  return m || "okänt fel i Mac-hjälparen";
}

export interface StreamCallbacks {
  onState(s: StreamHandle, reason?: string): void;
  onFrame(streamId: string, ptsUs: bigint, flags: number, payload: Buffer): void;
  /** 0.4.1: one block of Mac system audio (PCM s16le, 48 kHz, stereo). captureUs = the helper's timestamp. */
  onAudio?(captureUs: bigint, pcm: Buffer): void;
  onAudioState?(state: AudioState, reason?: string): void;
}

/** 0.4.1 (punkt 7): flag bit for an audio frame in the serve stdout protocol (Serve.swift / AudioCapture.swift). */
export const FLAG_AUDIO = 0x80;
/** serve protocol version that knows `audio-start` (an older helper silently ignores unknown commands) */
export const SERVE_PROTOCOL_AUDIO = 2;
export const AUDIO_RATE = 48_000;
export const AUDIO_CHANNELS = 2;
export type AudioState = "starting" | "live" | "paused" | "stopped" | "error";

export interface AudioHandle {
  sid: string;
  state: AudioState;
  startedAt: number;
  framesOut: number;
  bytesOut: number;
  lastFrameAt: number;
  error?: string;
}

/**
 * How the Mac helper is run (0.4.0):
 *  "shared"    = ONE long-lived `claudexr-capture serve` process owns every capture and the window list (default).
 *  "perStream" = one helper process per stream (0.3.x). Kept as fallback/rollback only: separate helper processes
 *                interrupt each other's ScreenCaptureKit streams (-3805), so every new window stream (and even
 *                `list-windows`) killed the streams that were already running (BUG-2e4ecb, BUG-2153ff, BUG-9e3e1b).
 */
export type HelperMode = "shared" | "perStream";

interface StartOpts {
  title: string;
  key?: string;
  source: "window" | "display";
  windowId?: number;
  displayId?: number;
  excludeBundles: string[];
  fps: number;
  bitrateMbps: number;
  maxWidth: number;
}

type HelperEvent = { event?: string; sid?: string; rid?: string; protocol?: number; reason?: string; width?: number; height?: number; message?: string; code?: number | string; windows?: WindowInfo[] };

interface ServeProc {
  proc: ChildProcess;
  ready: boolean;
  /** protocol number from serve_ready (1 = 0.4.0, 2 = 0.4.1 with audio) */
  protocol: number;
  readyWaiters: (() => void)[];
  lists: Map<string, { resolve: (w: WindowInfo[]) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>;
  /** frames that arrived for a sid we no longer know (a capture that did not stop) */
  stray: Map<string, number>;
  idleTimer?: NodeJS.Timeout;
}

/** A shared helper without streams is ended after this long, so the next start gets a fresh process (new TCC state). */
const SERVE_IDLE_MS = Number(process.env.CLAUDEXR_SERVE_IDLE_MS || 3000);
const STRAY_RESEND_STOP = 60;
const STRAY_KILL = 600;

export class StreamManager {
  streams = new Map<string, StreamHandle>();
  private serve?: ServeProc;
  /** the installed helper is older than 0.4.0 (no `serve` command): per-stream processes are used instead */
  private serveUnsupported = false;
  private opts = new Map<string, StartOpts>();
  /** handles that live in the shared helper */
  private shared = new Set<string>();

  constructor(private readonly bin: string, private readonly cb: StreamCallbacks, private readonly mode: HelperMode = "shared") {}

  available(): boolean {
    return fs.existsSync(this.bin);
  }

  /** "shared" | "perStream" | "perStream (old helper)": shown in xr_status so a missing rebuild is visible. */
  helperMode(): string {
    return this.mode === "perStream" ? "perStream" : this.serveUnsupported ? "perStream (old helper: rebuild mac-helper for several simultaneous streams)" : "shared";
  }

  private useShared(): boolean {
    return this.mode === "shared" && !this.serveUnsupported;
  }

  private helperMissing(): Error {
    return new Error(
      `Mac helper not found at ${this.bin}. Build it on the Mac: cd mac-helper && swift build -c release`,
    );
  }

  runJson<T>(args: string[], timeoutMs = 10_000): Promise<T> {
    if (!this.available()) return Promise.reject(this.helperMissing());
    return new Promise((resolve, reject) => {
      execFile(this.bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`${args[0]} failed: ${stderr || err.message}`));
        try {
          resolve(JSON.parse(stdout) as T);
        } catch (e) {
          reject(new Error(`${args[0]}: invalid JSON from helper`));
        }
      });
    });
  }

  /**
   * Shared mode: the list comes from the SAME process as the captures. (A separate `list-windows` process is one of
   * the things that interrupted running streams in 0.3.x.)
   */
  listWindows(): Promise<WindowInfo[]> {
    if (!this.useShared()) return this.runJson<WindowInfo[]>(["list-windows"]);
    if (!this.available()) return Promise.reject(this.helperMissing());
    const sv = this.ensureServe();
    const rid = randomUUID().slice(0, 8);
    return new Promise<WindowInfo[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        sv.lists.delete(rid);
        this.scheduleServeIdle();
        reject(new Error("list-windows failed: no answer from the Mac helper within 10 s"));
      }, 10_000);
      sv.lists.set(rid, { resolve, reject, timer });
      this.serveSend(sv, { cmd: "list", rid });
    });
  }

  // ---------------- shared helper process ----------------

  private serveSend(sv: ServeProc, cmd: Record<string, unknown>) {
    sv.proc.stdin?.write(JSON.stringify(cmd) + "\n");
  }

  private ensureServe(): ServeProc {
    if (this.serve) {
      clearTimeout(this.serve.idleTimer);
      return this.serve;
    }
    const proc = spawn(this.bin, ["serve"], { stdio: ["pipe", "pipe", "pipe"] });
    proc.stdin!.on("error", () => {});
    const sv: ServeProc = { proc, ready: false, protocol: 0, readyWaiters: [], lists: new Map(), stray: new Map() };
    this.serve = sv;
    const q = new ByteQueue();
    proc.stdout!.on("data", (chunk: Buffer) => {
      q.push(chunk);
      for (;;) {
        if (q.length < 4) break;
        const len = q.peekUInt32BE();
        if (len < 10 || len > 16 * 1024 * 1024) {
          logError("spegling", `bad frame length ${len} from the shared helper, restarting it`);
          proc.kill("SIGTERM");
          return;
        }
        if (q.length < 4 + len) break;
        const frame = q.take(4 + len);
        const sidLen = frame.readUInt8(4);
        if (sidLen > 32 || 5 + sidLen + 9 > frame.length) {
          logError("spegling", "bad frame header from the shared helper, restarting it");
          proc.kill("SIGTERM");
          return;
        }
        const sid = frame.toString("ascii", 5, 5 + sidLen);
        const o = 5 + sidLen;
        if (frame.readUInt8(o + 8) & FLAG_AUDIO) {
          this.onAudioFrame(sv, sid, frame.readBigUInt64BE(o), frame.subarray(o + 9));
          continue;
        }
        const h = this.streams.get(sid);
        if (!h || !this.shared.has(sid)) {
          this.onStrayFrame(sv, sid);
          continue;
        }
        h.framesOut++;
        h.lastFrameAt = Date.now();
        // Paused streams must not leak frames even if the helper misbehaves.
        if (h.state === "live") this.cb.onFrame(sid, frame.readBigUInt64BE(o), frame.readUInt8(o + 8), frame.subarray(o + 9));
      }
    });
    this.readEvents(proc, (ev) => {
      if (ev.event === "serve_ready") {
        sv.ready = true;
        sv.protocol = typeof ev.protocol === "number" ? ev.protocol : 1;
        for (const w of sv.readyWaiters.splice(0)) w();
        return;
      }
      if (this.audio && ev.sid === this.audio.sid) return this.onAudioEvent(ev);
      if (ev.event === "windows" || ev.event === "list_error") {
        const l = sv.lists.get(ev.rid ?? "");
        if (!l) return;
        sv.lists.delete(ev.rid ?? "");
        clearTimeout(l.timer);
        if (ev.event === "windows") l.resolve(ev.windows ?? []);
        else l.reject(new Error(`list-windows failed: ${ev.message ?? "unknown error"}`));
        this.scheduleServeIdle();
        return;
      }
      if (ev.event === "warning") return void log("helper:", ev.message ?? "");
      if (ev.sid === undefined) {
        if (ev.event === "error") logError("spegling", `helper error: ${ev.message}`);
        return;
      }
      if (ev.event === "stopped" || ev.event === "audio_stopped") sv.stray.delete(ev.sid);
      const h = this.streams.get(ev.sid);
      if (!h || !this.shared.has(ev.sid)) return;
      if (ev.event === "stopped") {
        // The helper ended the capture on its own (we did not ask: stop() removes the handle first).
        this.forget(h);
        this.setState(h, "stopped");
        this.scheduleServeIdle();
        return;
      }
      this.onHelperEvent(h, ev);
      if (ev.event === "error") {
        // In the shared helper an error ends only this capture; the others keep running.
        this.forget(h);
        this.scheduleServeIdle();
      }
    });
    proc.on("error", (e) => this.onServeGone(sv, null, e.message));
    proc.on("exit", (code) => this.onServeGone(sv, code));
    return sv;
  }

  private onServeGone(sv: ServeProc, code: number | null, spawnError?: string) {
    if (this.serve === sv) this.serve = undefined;
    clearTimeout(sv.idleTimer);
    for (const w of sv.readyWaiters.splice(0)) w();
    const a = this.audio;
    if (a && a.state !== "stopped" && a.state !== "error") {
      this.audio = undefined;
      a.state = "error";
      a.error = spawnError ?? `the Mac helper ended (exit ${code})`;
      this.cb.onAudioState?.("error", `Mac-hjälparen avslutades; ljudet stoppades (${a.error}).`);
    }
    const mine = [...this.shared].map((id) => this.streams.get(id)).filter((h): h is StreamHandle => !!h);
    const lists = [...sv.lists.values()];
    sv.lists.clear();
    // An older helper (0.3.x) does not know "serve": it prints its usage and exits with 2 before "serve_ready".
    if (!sv.ready && code === 2 && !spawnError) {
      if (!this.serveUnsupported) {
        this.serveUnsupported = true;
        logError(
          "spegling",
          "Mac-hjälparen är äldre än 0.4.0 (saknar kommandot serve): flera samtidiga fönsterströmmar fungerar inte förrän den byggs om (cd mac-helper && ./build.sh, tillåt sedan skärminspelning på nytt). Kör tills dess som i 0.3.x.",
        );
      }
      for (const l of lists) {
        clearTimeout(l.timer);
        this.runJson<WindowInfo[]>(["list-windows"]).then(l.resolve, l.reject);
      }
      for (const h of mine) {
        this.shared.delete(h.streamId);
        const o = this.opts.get(h.streamId);
        if (o && h.state === "starting") this.spawnPerStream(h, o);
      }
      return;
    }
    for (const l of lists) {
      clearTimeout(l.timer);
      l.reject(new Error(`list-windows failed: the Mac helper ended (${spawnError ?? `exit ${code}`})`));
    }
    if (mine.length && code) logError("spegling", `capture helper exited with code ${code}`);
    for (const h of mine) {
      this.forget(h);
      if (h.state !== "stopped" && h.state !== "error") {
        h.errorMessage = spawnError ?? `the Mac helper ended (exit ${code})`;
        this.setState(h, "error", spawnError ? `could not start the helper: ${spawnError}` : `Mac-hjälparen avslutades (exit ${code}); strömmen "${h.title}" stoppades.`);
      }
    }
  }

  /** A capture we stopped keeps sending: ask again, and as a last resort end the whole helper (privacy first). */
  private onStrayFrame(sv: ServeProc, sid: string, audio = false) {
    const n = (sv.stray.get(sid) ?? 0) + 1;
    sv.stray.set(sid, n);
    if (n === STRAY_RESEND_STOP) this.serveSend(sv, { cmd: audio ? "audio-stop" : "stop", sid });
    else if (n === STRAY_KILL) {
      logError("spegling", `the Mac helper keeps capturing stream ${sid} after stop: ending the helper process`);
      sv.proc.kill("SIGTERM");
    }
  }

  /** No streams and no pending list: end the shared helper soon (a fresh process picks up changed permissions). */
  private scheduleServeIdle() {
    const sv = this.serve;
    if (!sv) return;
    clearTimeout(sv.idleTimer);
    if (this.shared.size || sv.lists.size || this.audio) return;
    sv.idleTimer = setTimeout(() => {
      if (this.serve !== sv || this.shared.size || sv.lists.size || this.audio) return;
      this.serve = undefined;
      sv.proc.stdin?.end(); // the helper exits when its stdin closes
      const t = setTimeout(() => sv.proc.kill("SIGTERM"), 2000);
      t.unref?.();
      sv.proc.once("exit", () => clearTimeout(t));
    }, SERVE_IDLE_MS);
    sv.idleTimer.unref?.();
  }

  private forget(h: StreamHandle) {
    this.streams.delete(h.streamId);
    this.shared.delete(h.streamId);
    this.opts.delete(h.streamId);
  }

  // ---------------- 0.4.1: Mac system audio (punkt 7) ----------------

  audio?: AudioHandle;

  /**
   * Start system audio in the shared helper. Needs serve protocol >= 2 (0.4.1 helper): an older helper ignores
   * unknown commands, so the version is checked first instead of waiting for audio that never comes.
   * Audio is OFF until this is called; it is never started automatically.
   */
  async startAudio(excludeBundles: string[], readyTimeoutMs = 5000): Promise<{ ok: boolean; sid?: string; error?: string }> {
    if (this.audio && (this.audio.state === "live" || this.audio.state === "starting" || this.audio.state === "paused")) return { ok: true, sid: this.audio.sid };
    if (!this.useShared()) return { ok: false, error: "Ljud kräver den delade Mac-hjälparen (helperMode shared, hjälpare 0.4.1)." };
    if (!this.available()) return { ok: false, error: this.helperMissing().message };
    const sv = this.ensureServe();
    if (!sv.ready) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, readyTimeoutMs);
        sv.readyWaiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    if (this.serve !== sv || !sv.ready) {
      this.scheduleServeIdle();
      return { ok: false, error: "Mac-hjälparen svarade inte (serve_ready saknas)." };
    }
    if (sv.protocol < SERVE_PROTOCOL_AUDIO) {
      this.scheduleServeIdle();
      return { ok: false, error: `Mac-hjälparen är för gammal för ljud (protokoll ${sv.protocol}, kräver ${SERVE_PROTOCOL_AUDIO}): bygg om (cd mac-helper && ./build.sh) och tillåt skärm- och systemljudsinspelning på nytt.` };
    }
    const sid = `au${randomUUID().slice(0, 6)}`;
    this.audio = { sid, state: "starting", startedAt: Date.now(), framesOut: 0, bytesOut: 0, lastFrameAt: 0 };
    this.serveSend(sv, { cmd: "audio-start", sid, excludeBundles });
    return { ok: true, sid };
  }

  /** Stop system audio. Returns true if something was running. */
  stopAudio(): boolean {
    const a = this.audio;
    if (!a) return false;
    this.audio = undefined;
    // Stray audio frames after this are counted like stray video frames (resend stop, then end the helper).
    if (this.serve) this.serveSend(this.serve, { cmd: "audio-stop", sid: a.sid });
    if (a.state !== "stopped" && a.state !== "error") this.cb.onAudioState?.("stopped");
    this.scheduleServeIdle();
    return true;
  }

  private onAudioFrame(sv: ServeProc, sid: string, captureUs: bigint, pcm: Buffer) {
    const a = this.audio;
    if (!a || a.sid !== sid) return this.onStrayFrame(sv, sid, true);
    if (a.state === "starting") {
      a.state = "live";
      this.cb.onAudioState?.("live");
    }
    if (a.state !== "live") return; // paused (locked Mac): nothing leaks even if the helper misbehaves
    a.framesOut++;
    a.bytesOut += pcm.length;
    a.lastFrameAt = Date.now();
    this.cb.onAudio?.(captureUs, pcm);
  }

  private onAudioEvent(ev: HelperEvent) {
    const a = this.audio!;
    if (ev.event === "audio_started" && a.state === "starting") {
      a.state = "live";
      this.cb.onAudioState?.("live");
    } else if (ev.event === "paused") {
      a.state = "paused";
      this.cb.onAudioState?.("paused", ev.reason);
    } else if (ev.event === "resumed" && a.state === "paused") {
      a.state = "live";
      this.cb.onAudioState?.("live");
    } else if (ev.event === "error" || ev.event === "audio_stopped") {
      this.audio = undefined;
      a.state = ev.event === "error" ? "error" : "stopped";
      a.error = ev.message;
      this.cb.onAudioState?.(a.state, ev.event === "error" ? describeStreamError(ev.code === undefined ? undefined : String(ev.code), ev.message, "Macens ljud") : undefined);
      this.scheduleServeIdle();
    }
  }

  /** End the shared helper (bridge shutdown). */
  shutdown() {
    this.stopAudio();
    this.stop();
    const sv = this.serve;
    this.serve = undefined;
    if (!sv) return;
    clearTimeout(sv.idleTimer);
    for (const l of sv.lists.values()) {
      clearTimeout(l.timer);
      l.reject(new Error("bridge is shutting down"));
    }
    sv.lists.clear();
    sv.proc.kill("SIGTERM");
  }

  // ---------------- events shared by both modes ----------------

  private readEvents(proc: ChildProcess, onEvent: (ev: HelperEvent) => void) {
    let errBuf = "";
    proc.stderr!.on("data", (chunk: Buffer) => {
      errBuf += chunk.toString();
      let nl: number;
      while ((nl = errBuf.indexOf("\n")) >= 0) {
        const line = errBuf.slice(0, nl).trim();
        errBuf = errBuf.slice(nl + 1);
        if (!line) continue;
        let ev: HelperEvent;
        try {
          ev = JSON.parse(line);
        } catch {
          log("helper:", line);
          continue;
        }
        if (ev && typeof ev === "object") onEvent(ev);
      }
    });
  }

  private onHelperEvent(h: StreamHandle, ev: HelperEvent) {
    if (ev.event === "started") {
      h.width = ev.width ?? 0;
      h.height = ev.height ?? 0;
      this.setState(h, "live");
    } else if (ev.event === "paused") {
      h.pausedReason = ev.reason;
      this.setState(h, "paused", ev.reason);
    } else if (ev.event === "resumed") {
      h.pausedReason = undefined;
      this.setState(h, "live");
    } else if (ev.event === "error") {
      h.errorCode = ev.code !== undefined ? String(ev.code) : /Code=(-?\d+)/.exec(ev.message ?? "")?.[1];
      h.errorMessage = ev.message;
      logError("spegling", `helper error: ${ev.message}`);
      this.setState(h, "error", describeStreamError(h.errorCode, ev.message, h.title));
    }
  }

  start(opts: StartOpts): StreamHandle {
    if (!this.available()) throw this.helperMissing();
    const bitrate = Math.round(opts.bitrateMbps * 1_000_000);
    const h: StreamHandle = {
      streamId: randomUUID().slice(0, 8),
      title: opts.title,
      source: opts.source,
      key: opts.key ?? (opts.source === "window" ? `window:${opts.windowId}` : `display:${opts.displayId ?? "main"}`),
      framesOut: 0,
      lastFrameAt: 0,
      startedAt: Date.now(),
      state: "starting",
      width: 0,
      height: 0,
      maxWidth: opts.maxWidth,
      bitrate,
      maxBitrate: bitrate,
    };
    this.streams.set(h.streamId, h);
    this.opts.set(h.streamId, opts);
    if (this.useShared()) {
      const sv = this.ensureServe();
      this.shared.add(h.streamId);
      this.serveSend(sv, {
        cmd: "start",
        sid: h.streamId,
        ...(opts.source === "window" ? { window: opts.windowId } : { display: opts.displayId ?? 0, excludeBundles: opts.excludeBundles }),
        fps: opts.fps,
        bitrate,
        maxWidth: opts.maxWidth,
      });
    } else this.spawnPerStream(h, opts);
    return h;
  }

  /** 0.3.x way: one helper process for this stream. */
  private spawnPerStream(h: StreamHandle, opts: StartOpts) {
    const args = ["stream"];
    if (opts.source === "window") args.push("--window", String(opts.windowId));
    else args.push("--display", String(opts.displayId ?? 0), "--exclude-bundles", opts.excludeBundles.join(","));
    args.push("--fps", String(opts.fps), "--bitrate", String(h.bitrate), "--max-width", String(opts.maxWidth));
    const proc = spawn(this.bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    proc.stdin!.on("error", () => {});
    h.proc = proc;

    // Review P1: no Buffer.concat per chunk (O(n^2) on big keyframes): keep chunks, copy once per frame.
    const q = new ByteQueue();
    proc.stdout!.on("data", (chunk: Buffer) => {
      q.push(chunk);
      for (;;) {
        if (q.length < 4) break;
        const len = q.peekUInt32BE();
        if (len < 9 || len > 16 * 1024 * 1024) {
          logError("spegling", `bad frame length ${len}, stopping stream ${h.streamId}`);
          this.stop(h.streamId);
          return;
        }
        if (q.length < 4 + len) break;
        const frame = q.take(4 + len);
        const pts = frame.readBigUInt64BE(4);
        const flags = frame.readUInt8(12);
        // Paused streams must not leak frames even if the helper misbehaves.
        h.framesOut++;
        h.lastFrameAt = Date.now();
        if (h.state === "live") this.cb.onFrame(h.streamId, pts, flags, frame.subarray(13));
      }
    });
    this.readEvents(proc, (ev) => this.onHelperEvent(h, ev));
    proc.on("error", (e) => {
      h.errorMessage = e.message;
      if (h.state !== "stopped" && h.state !== "error") this.setState(h, "error", `could not start the helper: ${e.message}`);
    });
    proc.on("exit", (code) => {
      if (h.state !== "stopped" && h.state !== "error") {
        if (code) logError("spegling", `capture helper exited with code ${code}`);
        this.setState(h, code ? "error" : "stopped", code ? `exit ${code}` : undefined);
      }
      if (this.streams.get(h.streamId) === h) this.forget(h);
    });
  }

  /** Ask the encoder for an IDR frame (after drops or a decoder reset). */
  requestKeyframe(streamId: string) {
    const h = this.streams.get(streamId);
    if (!h) return;
    if (this.shared.has(streamId)) this.serve && this.serveSend(this.serve, { cmd: "key", sid: streamId });
    else h.proc?.stdin?.write("K\n");
  }

  setBitrate(streamId: string, bps: number) {
    const h = this.streams.get(streamId);
    if (!h) return;
    h.bitrate = Math.round(bps);
    if (this.shared.has(streamId)) this.serve && this.serveSend(this.serve, { cmd: "bitrate", sid: streamId, bps: h.bitrate });
    else h.proc?.stdin?.write(`B ${h.bitrate}\n`);
  }

  private setState(h: StreamHandle, s: StreamHandle["state"], reason?: string) {
    h.state = s;
    this.cb.onState(h, reason);
  }

  stop(streamId?: string): string[] {
    const ids = streamId ? [streamId] : [...this.streams.keys()];
    const stopped: string[] = [];
    for (const id of ids) {
      const h = this.streams.get(id);
      if (!h) continue;
      const wasShared = this.shared.has(id);
      this.forget(h);
      this.setState(h, "stopped");
      if (wasShared) this.serve && this.serveSend(this.serve, { cmd: "stop", sid: id });
      else h.proc?.kill("SIGTERM");
      stopped.push(id);
    }
    if (stopped.length) this.scheduleServeIdle();
    return stopped;
  }
}

/**
 * 0.4.1: audio block for the headset's /video socket. Bypasses VideoFlow (no credits, no keyframes):
 *   [0xC3][u8 idLen][id ascii][u32 BE seq][u64 BE captureUs][u8 format (1 = PCM s16le 48 kHz stereo)][pcm]
 */
export function encodeAudioFrame(id: string, seq: number, captureUs: bigint, pcm: Buffer): Buffer {
  const b = Buffer.from(id, "ascii");
  const head = Buffer.alloc(2 + b.length + 13);
  head.writeUInt8(0xc3, 0);
  head.writeUInt8(b.length, 1);
  b.copy(head, 2);
  head.writeUInt32BE(seq >>> 0, 2 + b.length);
  head.writeBigUInt64BE(captureUs, 2 + b.length + 4);
  head.writeUInt8(1, 2 + b.length + 12);
  return Buffer.concat([head, pcm]);
}

/** Video frame for the headset's /video socket. */
export function encodeVideoFrame(streamId: string, seq: number, captureUs: bigint, flags: number, payload: Buffer): Buffer {
  const id = Buffer.from(streamId, "ascii");
  const head = Buffer.alloc(2 + id.length + 13);
  head.writeUInt8(0xc2, 0);
  head.writeUInt8(id.length, 1);
  id.copy(head, 2);
  head.writeUInt32BE(seq >>> 0, 2 + id.length);
  head.writeBigUInt64BE(captureUs, 2 + id.length + 4);
  head.writeUInt8(flags, 2 + id.length + 12);
  return Buffer.concat([head, payload]);
}

/**
 * Stream width in pixels that the eye can actually resolve on the panel (review e2): angular size
 * x ~25 px/degree (Quest 3) x 1.3 for crisp text, clamped to 960..1600.
 */
export function streamWidthFor(widthM: number, distanceM: number): number {
  const deg = (2 * Math.atan(widthM / 2 / Math.max(distanceM, 0.2)) * 180) / Math.PI;
  const px = Math.round(deg * 25 * 1.3);
  return Math.min(1600, Math.max(960, px - (px % 2)));
}

/** FIFO of Buffers with O(1) push and one copy per take. */
class ByteQueue {
  private chunks: Buffer[] = [];
  length = 0;
  push(b: Buffer) {
    this.chunks.push(b);
    this.length += b.length;
  }
  peekUInt32BE(): number {
    const head = this.chunks[0].length >= 4 ? this.chunks[0] : Buffer.concat(this.chunks, Math.min(this.length, 4));
    return head.readUInt32BE(0);
  }
  take(n: number): Buffer {
    const out = Buffer.allocUnsafe(n);
    let off = 0;
    while (off < n) {
      const c = this.chunks[0];
      const k = Math.min(c.length, n - off);
      c.copy(out, off, 0, k);
      off += k;
      if (k === c.length) this.chunks.shift();
      else this.chunks[0] = c.subarray(k);
    }
    this.length -= n;
    return out;
  }
}
