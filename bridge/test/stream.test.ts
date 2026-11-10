import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyApp } from "../src/stream.js";
import { DEFAULT_STREAM_POLICY } from "../src/config.js";
import { startBridge, startSim, nextPort, waitFor, sleep } from "./helpers.js";

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-capture.mjs");

test("stream policy: exclusion always wins, allow list is silent, others ask", () => {
  const p = { allowApps: [...DEFAULT_STREAM_POLICY.allowApps, "1Password"], excludeApps: DEFAULT_STREAM_POLICY.excludeApps };
  assert.equal(classifyApp(p, "Code", "com.microsoft.VSCode"), "allowed");
  assert.equal(classifyApp(p, "Terminal", "com.apple.Terminal"), "allowed");
  assert.equal(classifyApp(p, "Safari", "com.apple.Safari"), "ask");
  assert.equal(classifyApp(p, "1Password", "com.1password.1password"), "excluded");
  assert.equal(classifyApp(p, "Mail", "com.apple.mail"), "excluded");
});

test("window list hides titles of excluded apps; allow-listed window streams without asking", async () => {
  const b = await startBridge(nextPort(), { CLAUDEXR_CAPTURE_BIN: FAKE });
  const sim = await startSim(b, { permission: "deny" });
  try {
    const list = (await b.call("xr_stream", { action: "windows" })).text;
    assert.match(list, /11 Code "hub.ts — bridge" \[allowed\]/);
    assert.match(list, /12 Safari "Docs" \[ask\]/);
    assert.match(list, /13 1Password \[excluded\]/);
    assert.equal(list.includes("Bank login") || list.includes("secret plans"), false);
    const r = await b.call("xr_stream", { action: "window", id: 11 });
    assert.match(r.text, /^Streaming \w+ "Code – hub.ts — bridge"/);
    assert.equal(sim.lines.some((l) => l.includes("show permission")), false, "no approval for allow-listed apps");
    await waitFor(() => sim.lines.filter((l) => l.startsWith("[sim] video")).length > 3);
    assert.ok(sim.lines.some((l) => l.includes('"state":"live"')));
    assert.match((await b.call("xr_stream", { action: "stop" })).text, /Stopped 1/);
  } finally {
    sim.close();
    await b.close();
  }
});

test("excluded apps can never be streamed; other apps and the display need XR approval", async () => {
  const b = await startBridge(nextPort(), { CLAUDEXR_CAPTURE_BIN: FAKE });
  const sim = await startSim(b, { permission: "deny" });
  try {
    const ex = await b.call("xr_stream", { action: "window", id: 13 });
    assert.equal(ex.isError, true);
    assert.match(ex.text, /exclusion list/);
    assert.match((await b.call("xr_stream", { action: "window", id: 12 })).text, /Not approved.*Safari.*denied in the headset/);
    assert.ok(sim.lines.some((l) => l.includes("show permission") && l.includes("Strömma fönster")));
    assert.equal(sim.lines.some((l) => l.startsWith("[sim] video")), false);
    sim.close();
    await sleep(200);
    const allow = await startSim(b, { permission: "allow", pairing: sim.pairing });
    assert.match((await b.call("xr_stream", { action: "display" })).text, /^Streaming/);
    assert.ok(allow.lines.some((l) => l.includes("Spegla hela Mac-skärmen")));
    await waitFor(() => allow.lines.some((l) => l.startsWith("[sim] video")));
    allow.close();
  } finally {
    await b.close();
  }
});

test("frames stop while the Mac is locked (paused) and resume afterwards", async () => {
  const b = await startBridge(nextPort(), { CLAUDEXR_CAPTURE_BIN: FAKE, FAKE_PAUSE_AFTER: "5" });
  const sim = await startSim(b);
  try {
    await b.call("xr_stream", { action: "window", id: 11 });
    await waitFor(() => sim.lines.some((l) => l.includes('"state":"paused"')));
    const atPause = sim.lines.filter((l) => l.startsWith("[sim] video")).length;
    await sleep(200); // fake helper keeps writing frames while paused: the bridge must drop them
    assert.ok(sim.lines.filter((l) => l.startsWith("[sim] video")).length <= atPause + 1);
    await waitFor(() => sim.lines.findLastIndex((l) => l.includes('"state":"live"')) > sim.lines.findIndex((x) => x.includes('"state":"paused"')));
    await waitFor(() => sim.lines.filter((l) => l.startsWith("[sim] video")).length > atPause + 2);
  } finally {
    sim.close();
    await b.close();
  }
});

test("screen calibration sends marker geometry to the headset and returns its result", async () => {
  const b = await startBridge(nextPort(), { CLAUDEXR_CAPTURE_BIN: FAKE });
  const sim = await startSim(b);
  try {
    const r = await b.call("xr_stream", { action: "calibrate" });
    assert.equal(r.text, "Calibrated (12 detections).");
    const line = sim.lines.find((l) => l.startsWith("[sim] calibrate"))!;
    // 982 pt * 0.6 = 589 pt; 302 mm / 1512 pt -> 0.1176 m marker; screen 0.302 x 0.196 m
    assert.match(line, /CLAUDEXR-CAL-\w{7} marker 0\.118 m, screen 0\.302x0\.196 m/);
  } finally {
    sim.close();
    await b.close();
  }
});

test("without the Mac helper, streaming reports how to build it", async () => {
  const b = await startBridge(nextPort(), { CLAUDEXR_CAPTURE_BIN: "/nonexistent/claudexr-capture" });
  const sim = await startSim(b);
  try {
    const r = await b.call("xr_stream", { action: "windows" });
    assert.equal(r.isError, true);
    assert.match(r.text, /swift build -c release/);
  } finally {
    sim.close();
    await b.close();
  }
});

test("video flow control: no acks -> at most MAX_IN_FLIGHT (3) frames in flight, drops + IDR request + bitrate down", async () => {
  const dir = (await import("./helpers.js")).tmpDir();
  const log = path.join(dir, "fake.log");
  const b = await startBridge(nextPort(), { CLAUDEXR_CAPTURE_BIN: FAKE, FAKE_LOG: log, FAKE_FRAME_MS: "20" });
  const sim = await startSim(b, { video: "noack" });
  try {
    await b.call("xr_stream", { action: "window", id: 11 });
    await sleep(1500);
    const vids = sim.lines.filter((l) => l.startsWith("[sim] video ") && l.includes("seq="));
    // Lost acks expire after 1 s, so a few more may trickle through, but never a growing queue.
    assert.ok(vids.length >= 2 && vids.length <= 9, `${vids.length} frames delivered without acks`);
    const st = (await b.local("/status")).streams[0];
    assert.ok(st.dropped > 20, `dropped ${st.dropped}`);
    const fl = fs.readFileSync(log, "utf8");
    assert.match(fl, /\["stdin","K"\]|\\"cmd\\":\\"key\\"/, "IDR requested from the encoder");
    assert.match(fl, /\["stdin","B \d+"\]|\\"cmd\\":\\"bitrate\\"/, "bitrate adapted");
    assert.match(fl, /"--max-width","1446"|\\"maxWidth\\":1446/, "stream sized to the panel (0.9 m at 1.1 m), not full screen");
  } finally {
    sim.close();
    await b.close();
  }
});

test("video never blocks control: xr_ask answers while frames flow; control socket carries no video", async () => {
  const b = await startBridge(nextPort(), { CLAUDEXR_CAPTURE_BIN: FAKE, FAKE_FRAME_MS: "5" });
  const sim = await startSim(b, { pick: 2 });
  try {
    await b.call("xr_stream", { action: "window", id: 11 });
    await waitFor(() => sim.lines.filter((l) => l.startsWith("[sim] video ")).length > 20);
    const t = Date.now();
    assert.equal((await b.call("xr_ask", { q: "Q?", opts: ["a", "b"], timeout: 10 })).text, 'Chose 2: "b"');
    assert.ok(Date.now() - t < 1500, `${Date.now() - t} ms`);
    assert.equal(sim.lines.some((l) => l.includes("UNEXPECTED binary")), false);
    const st = (await b.local("/status")).streams[0];
    assert.ok(st.sent > 20 && st.rttMs >= 0);
  } finally {
    sim.close();
    await b.close();
  }
});

test("video socket requires the active headset's token", async () => {
  const b = await startBridge(nextPort(), { CLAUDEXR_CAPTURE_BIN: FAKE });
  const sim = await startSim(b, { video: "none" });
  try {
    const { WebSocket } = await import("ws");
    const v = new WebSocket(`wss://127.0.0.1:${b.port}/video`, { rejectUnauthorized: false });
    await new Promise((r) => v.on("open", r));
    v.send(JSON.stringify({ type: "video_hello", token: "x".repeat(43) }));
    const code = await new Promise<number>((r) => v.on("close", (c) => r(c)));
    assert.equal(code, 4003);
  } finally {
    sim.close();
    await b.close();
  }
});
