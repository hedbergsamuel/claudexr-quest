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
  proc: ChildProcess;
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
}

export class StreamManager {
  streams = new Map<string, StreamHandle>();

  constructor(private readonly bin: string, private readonly cb: StreamCallbacks) {}

  available(): boolean {
    return fs.existsSync(this.bin);
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

  listWindows(): Promise<WindowInfo[]> {
    return this.runJson<WindowInfo[]>(["list-windows"]);
  }

  start(opts: {
    title: string;
    key?: string;
    source: "window" | "display";
    windowId?: number;
    displayId?: number;
    excludeBundles: string[];
    fps: number;
    bitrateMbps: number;
    maxWidth: number;
  }): StreamHandle {
    if (!this.available()) throw this.helperMissing();
    const args = ["stream"];
    if (opts.source === "window") args.push("--window", String(opts.windowId));
    else args.push("--display", String(opts.displayId ?? 0), "--exclude-bundles", opts.excludeBundles.join(","));
    args.push("--fps", String(opts.fps), "--bitrate", String(Math.round(opts.bitrateMbps * 1_000_000)), "--max-width", String(opts.maxWidth));
    const proc = spawn(this.bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    proc.stdin!.on("error", () => {});
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
      proc,
      maxWidth: opts.maxWidth,
      bitrate,
      maxBitrate: bitrate,
    };
    this.streams.set(h.streamId, h);

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
    let errBuf = "";
    proc.stderr!.on("data", (chunk: Buffer) => {
      errBuf += chunk.toString();
      let nl: number;
      while ((nl = errBuf.indexOf("\n")) >= 0) {
        const line = errBuf.slice(0, nl).trim();
        errBuf = errBuf.slice(nl + 1);
        if (!line) continue;
        let ev: { event?: string; reason?: string; width?: number; height?: number; message?: string; code?: number | string };
        try {
          ev = JSON.parse(line);
        } catch {
          log("helper:", line);
          continue;
        }
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
    });
    proc.on("error", (e) => {
      h.errorMessage = e.message;
      if (h.state !== "stopped" && h.state !== "error") this.setState(h, "error", `could not start the helper: ${e.message}`);
    });
    proc.on("exit", (code) => {
      if (h.state !== "stopped" && h.state !== "error") {
        if (code) logError("spegling", `capture helper exited with code ${code}`);
        this.setState(h, code ? "error" : "stopped", code ? `exit ${code}` : undefined);
      }
      this.streams.delete(h.streamId);
    });
    return h;
  }

  /** Ask the encoder for an IDR frame (after drops or a decoder reset). */
  requestKeyframe(streamId: string) {
    this.streams.get(streamId)?.proc.stdin?.write("K\n");
  }

  setBitrate(streamId: string, bps: number) {
    const h = this.streams.get(streamId);
    if (!h) return;
    h.bitrate = Math.round(bps);
    h.proc.stdin?.write(`B ${h.bitrate}\n`);
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
      this.setState(h, "stopped");
      h.proc.kill("SIGTERM");
      this.streams.delete(id);
      stopped.push(id);
    }
    return stopped;
  }
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
