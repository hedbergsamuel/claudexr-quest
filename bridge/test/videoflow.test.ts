import { test } from "node:test";
import assert from "node:assert/strict";
import { VideoFlow, MAX_IN_FLIGHT } from "../src/videoflow.js";

function setup() {
  let now = 0;
  const sent: number[] = [];
  const calls: string[] = [];
  let bitrate = 12_000_000;
  const f = new VideoFlow("s1", {
    requestKeyframe: () => calls.push("K"),
    setBitrate: (b) => {
      bitrate = b;
      calls.push(`B${Math.round(b / 1e6)}`);
    },
    bitrate: () => bitrate,
    maxBitrate: () => 12_000_000,
    send: (buf) => (sent.push(buf.readUInt32BE(2 + 2)), true),
    now: () => now,
  });
  return { f, sent, calls, tick: (ms: number) => (now += ms), bitrate: () => bitrate };
}

test("waits for a keyframe, caps frames in flight, resumes from an IDR after acks", () => {
  const { f, sent, calls, tick } = setup();
  f.onFrame(0n, 0, Buffer.alloc(10)); // P-frame before any keyframe: dropped, IDR requested
  assert.equal(sent.length, 0);
  assert.deepEqual(calls, ["K"]);
  f.onFrame(1n, 1, Buffer.alloc(10));
  for (let i = 1; i < MAX_IN_FLIGHT; i++) f.onFrame(BigInt(i + 1), 0, Buffer.alloc(10));
  f.onFrame(99n, 0, Buffer.alloc(10)); // one more un-acked frame: dropped
  assert.equal(sent.length, MAX_IN_FLIGHT);
  tick(30);
  f.ack(MAX_IN_FLIGHT);
  f.onFrame(100n, 0, Buffer.alloc(10)); // still needs a keyframe after the drop
  assert.equal(sent.length, MAX_IN_FLIGHT);
  f.onFrame(101n, 1, Buffer.alloc(10));
  assert.equal(sent.length, MAX_IN_FLIGHT + 1);
  assert.ok(f.stats().rttMs >= 30);
});

test("bitrate steps down after drops and recovers when the link is fast", () => {
  const { f, tick, bitrate } = setup();
  f.onFrame(0n, 1, Buffer.alloc(1));
  tick(500);
  for (let i = 1; i < MAX_IN_FLIGHT; i++) f.onFrame(0n, 0, Buffer.alloc(1));
  tick(499); // adapt() runs at most once per second
  tick(1);
  f.onFrame(0n, 0, Buffer.alloc(1)); // dropped (cap reached) -> -20 %
  assert.equal(bitrate(), 9_600_000);
  f.ack(MAX_IN_FLIGHT);
  for (let i = 0; i < 25; i++) {
    tick(1100);
    f.onFrame(0n, 1, Buffer.alloc(1));
    tick(10);
    f.ack(f.stats().sent); // seq of the newest frame
  }
  assert.ok(bitrate() > 9_600_000);
});
