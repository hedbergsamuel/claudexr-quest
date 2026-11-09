// 0.4.0: several simultaneous streams (BUG-2e4ecb, BUG-2153ff, BUG-9e3e1b, BUG-552260) and stable stream panel ids
// (BUG-39391d). Cause found in bugs/reports.jsonl: every start of a new helper process coincided with a -3805
// ("application connection being interrupted") in the helpers that were already running. The fix is ONE helper
// process ("serve") for all captures and for the window list. These tests use the fake helper only: they prove the
// bridge side (one process, independent streams, fallback, privacy), NOT ScreenCaptureKit's behaviour on a real Mac.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { startBridge, startSim, nextPort, waitFor, sleep, tmpDir } from "./helpers.js";

const spawns = (log: string) =>
  fs.existsSync(log)
    ? fs
        .readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as string[])
    : [];
const videoIds = (lines: string[], from = 0) => new Set(lines.slice(from).filter((l) => l.startsWith("[sim] video")).map((l) => l.split(" ")[2]));
const reports = (b: { bugsDir: string }) => {
  const f = path.join(b.bugsDir, "reports.jsonl");
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
};
const streamIdOf = (text: string) => /^Streaming (\w+) /.exec(text)![1];

test("display + two window streams live at the same time, in ONE helper process; nothing is replaced", async () => {
  const log = path.join(tmpDir(), "fake.log");
  const b = await startBridge(nextPort(), { FAKE_LOG: log, CLAUDEXR_DISPLAY_APPROVAL: "never" });
  const sim = await startSim(b, { permission: "allow" });
  try {
    const d = await b.call("xr_stream", { action: "display" });
    assert.match(d.text, /^Streaming \w+ "Macens skärm" in panel display$/);
    await b.call("xr_stream", { action: "windows" });
    const w1 = await b.call("xr_stream", { action: "window", id: 11 }); // Code (allowed)
    const w2 = await b.call("xr_stream", { action: "window", id: 12 }); // Safari (ask -> the sim taps allow)
    assert.match(w1.text, /in panel win-11$/);
    assert.match(w2.text, /in panel win-12$/);
    assert.equal(/replaced/.test(w1.text + w2.text), false);
    const ids = [d, w1, w2].map((r) => streamIdOf(r.text));
    // every stream keeps delivering frames AFTER the last one was started
    const from = sim.lines.length;
    await waitFor(() => ids.every((id) => videoIds(sim.lines, from).has(id)), 4000);
    const list = (await b.call("xr_panel", { action: "list" })).text;
    for (const id of ["display stream/overlay", "win-11 stream/side", "win-12 stream/side"]) assert.ok(list.includes(id), `${id} missing in:\n${list}`);
    assert.equal((list.match(/ live /g) ?? []).length, 3, list);
    assert.equal(/helper:/.test(list), false, "shared mode is not reported as a problem");
    // exactly one helper process was started, and the window list came from it (no separate list-windows process)
    const sp = spawns(log).filter((x) => x[0] !== "serve" || x.length === 1);
    assert.deepEqual(sp.map((x) => x[0]), ["serve"], JSON.stringify(sp));
    // stopping one window stream leaves the others alone
    assert.match((await b.call("xr_stream", { action: "stop", id: "win-11" })).text, /Stopped 1/);
    const from2 = sim.lines.length;
    await waitFor(() => videoIds(sim.lines, from2).has(ids[0]) && videoIds(sim.lines, from2).has(ids[2]), 4000);
    await sleep(200);
    assert.equal(videoIds(sim.lines, sim.lines.length - 5).has(ids[1]), false, "the stopped stream sends nothing more");
  } finally {
    sim.close();
    await b.close();
  }
});

test("one capture failing (-3805) ends only that stream; the other window stream and its panel stay", async () => {
  const b = await startBridge(nextPort(), { FAKE_FAIL_WINDOW: "11", CLAUDEXR_STREAM_READY_MS: "3000" });
  const sim = await startSim(b, { permission: "allow" });
  try {
    const ok = await b.call("xr_stream", { action: "window", id: 12 });
    const okId = streamIdOf(ok.text);
    await b.call("xr_stream", { action: "window", id: 11 }); // dies after 5 frames
    await waitFor(() => sim.lines.some((l) => l.includes('"state":"error"')), 4000);
    const from = sim.lines.length;
    await waitFor(() => videoIds(sim.lines, from).has(okId), 3000);
    const list = (await b.call("xr_panel", { action: "list" })).text;
    assert.ok(list.includes("win-12 stream/side"), list);
    assert.equal(list.includes("win-11"), false, list);
  } finally {
    sim.close();
    await b.close();
  }
});

test("restarting a stream keeps its panel id (and the place the user moved it to); display is always id \"display\"", async () => {
  const b = await startBridge(nextPort(), { CLAUDEXR_DISPLAY_APPROVAL: "never" });
  const sim = await startSim(b);
  try {
    const first = await b.call("xr_stream", { action: "window", id: 11 });
    sim.ws.send(JSON.stringify({ type: "panel_moved", id: "win-11", placement: { position: { x: 0.9, y: 1.2, z: -1.1 } } }));
    await sleep(100);
    const second = await b.call("xr_stream", { action: "window", id: 11 });
    assert.match(second.text, /in panel win-11 \(replaced the previous stream\)$/);
    assert.notEqual(streamIdOf(first.text), streamIdOf(second.text));
    const st = await b.local("/status");
    const p = st.openPanels.find((x: { id: string }) => x.id === "win-11");
    assert.deepEqual(p.placement, { position: { x: 0.9, y: 1.2, z: -1.1 } });
    assert.equal(st.openPanels.filter((x: { kind: string }) => x.kind === "stream").length, 1);
    await b.call("xr_stream", { action: "display" });
    await b.call("xr_stream", { action: "display" });
    // xr_panel can always address the Mac screen as "display"
    assert.match((await b.call("xr_panel", { action: "update", id: "display", title: "Macens skärm" })).text, /Updated display/);
    assert.equal((await b.local("/status")).openPanels.filter((x: { id: string }) => x.id === "display").length, 1);
  } finally {
    sim.close();
    await b.close();
  }
});

test("an old helper without \"serve\" still streams (0.3.x way) and the status says a rebuild is needed", async () => {
  const log = path.join(tmpDir(), "fake.log");
  const b = await startBridge(nextPort(), { FAKE_NO_SERVE: "1", FAKE_LOG: log });
  const sim = await startSim(b);
  try {
    assert.match((await b.call("xr_stream", { action: "windows" })).text, /11 Code/);
    const r = await b.call("xr_stream", { action: "window", id: 11 });
    assert.match(r.text, /^Streaming/);
    await waitFor(() => videoIds(sim.lines).has(streamIdOf(r.text)), 3000);
    assert.match((await b.call("xr_status")).text, /helper: perStream \(old helper: rebuild/);
    assert.ok(spawns(log).some((x) => x[0] === "stream"));
    assert.ok(reports(b).includes("äldre än 0.4.0"), "the missing rebuild is logged as a report");
  } finally {
    sim.close();
    await b.close();
  }
});

test("rollback switch CLAUDEXR_HELPER_MODE=perStream never starts the shared helper", async () => {
  const log = path.join(tmpDir(), "fake.log");
  const b = await startBridge(nextPort(), { CLAUDEXR_HELPER_MODE: "perStream", FAKE_LOG: log });
  const sim = await startSim(b);
  try {
    assert.match((await b.call("xr_stream", { action: "window", id: 11 })).text, /^Streaming/);
    assert.equal(spawns(log).some((x) => x[0] === "serve"), false);
  } finally {
    sim.close();
    await b.close();
  }
});

test("privacy: a capture that keeps sending after stop gets the helper process ended; a crashed helper ends its streams", async () => {
  const b = await startBridge(nextPort(), { FAKE_IGNORE_STOP: "1", FAKE_FRAME_MS: "2" });
  const sim = await startSim(b);
  try {
    const r = await b.call("xr_stream", { action: "window", id: 11 });
    const id = streamIdOf(r.text);
    await b.call("xr_stream", { action: "stop" });
    const from = sim.lines.length;
    await waitFor(() => reports(b).includes("keeps capturing"), 8000);
    assert.equal(videoIds(sim.lines, from).has(id), false, "no frame of a stopped stream reaches the headset");
    // a new stream starts a fresh helper
    const again = await b.call("xr_stream", { action: "window", id: 11 });
    assert.match(again.text, /^Streaming/);
  } finally {
    sim.close();
    await b.close();
  }
  const c = await startBridge(nextPort(), { FAKE_SERVE_CRASH_AFTER: "40", FAKE_FRAME_MS: "10" });
  const sim2 = await startSim(c);
  try {
    await c.call("xr_stream", { action: "window", id: 11 });
    await waitFor(() => sim2.lines.some((l) => l.includes('"state":"error"')), 5000);
    await waitFor(() => !/win-11/.test(JSON.stringify(sim2.lines.slice(-1))), 1000).catch(() => {});
    const list = (await c.call("xr_panel", { action: "list" })).text;
    assert.equal(list.includes("win-11"), false, list);
  } finally {
    sim2.close();
    await c.close();
  }
});
