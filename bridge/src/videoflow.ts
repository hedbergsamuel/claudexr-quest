// Credit-based flow control for one video stream (review P1).
//
// The headset acks every frame it has handed to its decoder. At most MAX_IN_FLIGHT frames may be
// un-acked; when the link can't keep up, frames are DROPPED at the source (never queued), the
// stream waits for the next IDR (requested from the encoder at once), and the bitrate steps down.
// Result: latency stays bounded (~2 frame times + RTT) instead of growing with a queue.
import { encodeVideoFrame } from "./stream.js";

// 0.3.0: 3 (was 2). With 2, a single late ack (Wi-Fi jitter, a big IDR) dropped a frame and, because every drop
// forces a wait for the next IDR, ~15 frames: 151 of 1074 frames (14 %) were lost at 8 Mbit/s with 17 ms RTT.
export const MAX_IN_FLIGHT = 3;
const IDR_MIN_INTERVAL_MS = 250;
const ACK_LOST_MS = 1000;

export interface FlowControls {
  requestKeyframe(): void;
  setBitrate(bps: number): void;
  bitrate(): number;
  maxBitrate(): number;
  /** returns false if there is no video socket */
  send(frame: Buffer): boolean;
  now?(): number;
}

export class VideoFlow {
  private seq = 0;
  private inFlight = new Map<number, number>();
  private needKey = true;
  private lastIdr = -Infinity;
  private lastDrop = 0;
  private lastAdjust = 0;
  rttMs = 0;
  sent = 0;
  dropped = 0;
  lastSentAt = 0;
  /** last time the headset acked a frame (0 = never): proof that it actually shows video */
  lastAckAt = 0;

  constructor(private readonly streamId: string, private readonly c: FlowControls) {}

  private now() {
    return this.c.now ? this.c.now() : Date.now();
  }

  onFrame(captureUs: bigint, flags: number, payload: Buffer) {
    const now = this.now();
    const key = (flags & 1) === 1;
    // Lost acks must not stall the stream forever.
    for (const [s, t] of this.inFlight) if (now - t > ACK_LOST_MS) this.inFlight.delete(s);
    if (this.needKey && !key) return this.drop(now);
    if (this.inFlight.size >= MAX_IN_FLIGHT) {
      this.needKey = true;
      return this.drop(now);
    }
    const seq = ++this.seq;
    if (!this.c.send(encodeVideoFrame(this.streamId, seq, captureUs, flags, payload))) {
      this.needKey = true;
      return this.drop(now);
    }
    this.inFlight.set(seq, now);
    this.needKey = false;
    this.sent++;
    this.lastSentAt = now;
  }

  ack(seq: number) {
    const now = this.now();
    this.lastAckAt = now;
    const t = this.inFlight.get(seq);
    if (t !== undefined) this.rttMs = this.rttMs ? this.rttMs * 0.8 + (now - t) * 0.2 : now - t;
    for (const s of [...this.inFlight.keys()]) if (s <= seq) this.inFlight.delete(s);
    this.adapt(now);
  }

  /** The decoder lost sync (or a new surface): restart from an IDR. */
  resync() {
    this.needKey = true;
    this.inFlight.clear();
    this.askIdr(this.now());
  }

  private drop(now: number) {
    this.dropped++;
    this.lastDrop = now;
    this.askIdr(now);
    this.adapt(now);
  }

  private askIdr(now: number) {
    if (now - this.lastIdr < IDR_MIN_INTERVAL_MS) return;
    this.lastIdr = now;
    this.c.requestKeyframe();
  }

  /** Adaptive bitrate: -20 % after drops, +10 % per second when clean and fast, within [2 Mbit/s, max]. */
  private adapt(now: number) {
    if (now - this.lastAdjust < 1000) return;
    const b = this.c.bitrate();
    if (this.lastDrop > this.lastAdjust) this.c.setBitrate(Math.max(2_000_000, b * 0.8));
    else if (this.rttMs > 0 && this.rttMs < 60 && b < this.c.maxBitrate()) this.c.setBitrate(Math.min(this.c.maxBitrate(), b * 1.1));
    this.lastAdjust = now;
  }

  stats() {
    return { sent: this.sent, dropped: this.dropped, rttMs: Math.round(this.rttMs), inFlight: this.inFlight.size };
  }
}
