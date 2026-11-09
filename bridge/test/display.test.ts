import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startBridge, startSim, nextPort, waitFor, sleep, tmpDir } from "./helpers.js";

// All of these run isolated daemons (own port, own temp state dir, fake capture helper, fake brightness file).
// Nothing here can reach the real daemon or the real display.

const env = (dir: string, extra: Record<string, string> = {}) => ({
  CLAUDEXR_ALWAYS_DISPLAY: "1",
  CLAUDEXR_DISPLAY_APPROVAL: "never",
  FAKE_BRIGHTNESS_FILE: path.join(dir, "fb"),
  ...extra,
});
const fb = (dir: string) => Number(fs.readFileSync(path.join(dir, "fb"), "utf8"));
async function until(cond: () => Promise<boolean>, ms = 4000) {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error("until timed out");
    await sleep(40);
  }
}
const streamsOf = async (b: { local: (p: string) => Promise<any> }) => (await b.local("/status")).streams as { streamId: string; source: string; state: string; panelId?: string }[];

test("the Mac screen streams as soon as the headset connects; a window stream is added NEXT to it", async () => {
  const dir = tmpDir();
  const b = await startBridge(nextPort(), env(dir));
  const sim = await startSim(b);
  try {
    await waitFor(() => sim.lines.some((l) => l.startsWith("[sim] show stream") && l.includes('"source":"display"')), 8000);
    const r = await b.call("xr_stream", { action: "window", id: 11 });
    assert.match(r.text, /^Streaming/);
    const st = await streamsOf(b);
    assert.deepEqual(st.map((s) => s.source).sort(), ["display", "window"], "display kept");
    const list = (await b.call("xr_panel", { action: "list" })).text;
    assert.match(list, /stream:\w+/, "stream panels are in the registry and listed");
    assert.match(list, /display: always on/);
    assert.equal((await b.local("/status")).openPanels.filter((p: { kind: string }) => p.kind === "stream").length, 2);
  } finally {
    sim.close();
    await b.close();
  }
});

test("approval: one tap per daemon run, a reconnect restarts the display without asking again", async () => {
  const dir = tmpDir();
  const b = await startBridge(nextPort(), env(dir, { CLAUDEXR_DISPLAY_APPROVAL: "once" }));
  const sim = await startSim(b, { permission: "allow" });
  try {
    await waitFor(() => sim.lines.some((l) => l.startsWith("[sim] show stream")), 8000);
    assert.equal(sim.lines.filter((l) => l.includes("show permission") && l.includes("Spegla hela Mac-skärmen")).length, 1);
    sim.close();
    await sleep(300);
    const sim2 = await startSim(b, { permission: "deny", pairing: sim.pairing }); // would refuse if it were asked
    await waitFor(() => sim2.lines.some((l) => l.startsWith("[sim] show stream")), 8000);
    assert.equal(sim2.lines.some((l) => l.includes("show permission")), false);
    sim2.close();
  } finally {
    await b.close();
  }
});

test("declining the display card turns the always-on stream off (no nagging) until 'Starta skärmen'", async () => {
  const dir = tmpDir();
  const b = await startBridge(nextPort(), env(dir, { CLAUDEXR_DISPLAY_APPROVAL: "once" }));
  const sim = await startSim(b, { permission: "deny" });
  try {
    await waitFor(() => sim.lines.some((l) => l.includes("show permission")), 8000);
    await until(async () => (await b.local("/status")).display.suppressed === true, 4000);
    await sleep(2500);
    assert.equal(sim.lines.filter((l) => l.includes("show permission")).length, 1);
    assert.equal((await streamsOf(b)).length, 0);
  } finally {
    sim.close();
    await b.close();
  }
});

test("xr_stream stop: no id stops window streams only; id:display / all end the display (it stays off until restarted)", async () => {
  const dir = tmpDir();
  const b = await startBridge(nextPort(), env(dir));
  const sim = await startSim(b);
  try {
    await waitFor(() => sim.lines.some((l) => l.startsWith("[sim] show stream")), 8000);
    await b.call("xr_stream", { action: "window", id: 11 });
    const r = await b.call("xr_stream", { action: "stop" });
    assert.match(r.text, /Stopped 1.*screen stream stays on/);
    assert.deepEqual((await streamsOf(b)).map((s) => s.source), ["display"]);
    assert.match((await b.call("xr_stream", { action: "stop", id: "display" })).text, /^Stopped 1/);
    await sleep(2500); // the supervisor must NOT bring it back
    assert.equal((await streamsOf(b)).length, 0);
    assert.equal((await b.local("/status")).display.suppressed, true);
    assert.match((await b.call("xr_stream", { action: "display" })).text, /^Streaming/);
    assert.equal((await streamsOf(b)).length, 1);
    assert.match((await b.call("xr_stream", { action: "stop", id: "nope" })).text, /no stream matches/);
  } finally {
    sim.close();
    await b.close();
  }
});

test("restarting a stream REPLACES the old panel (no orphans); streams can be closed by stream id and 'all'", async () => {
  const dir = tmpDir();
  const b = await startBridge(nextPort(), env(dir, { CLAUDEXR_ALWAYS_DISPLAY: "0" }));
  const sim = await startSim(b);
  try {
    const a = await b.call("xr_stream", { action: "window", id: 11 });
    const firstPanel = /panel (\w+)/.exec(a.text)![1];
    const again = await b.call("xr_stream", { action: "window", id: 11 });
    assert.match(again.text, /replaced the previous stream/);
    assert.equal((await b.local("/status")).openPanels.filter((p: { kind: string }) => p.kind === "stream").length, 1);
    assert.ok(sim.lines.some((l) => l.includes(`clear ${firstPanel}`)), "old panel cleared in the headset");
    const sid = (await streamsOf(b))[0].streamId;
    assert.match((await b.call("xr_panel", { action: "close", id: sid })).text, /Closed 1 panel\(s\), stopped 1 stream/);
    assert.equal((await streamsOf(b)).length, 0);
    await b.call("xr_stream", { action: "window", id: 11 });
    await b.call("xr_stream", { action: "display" });
    await b.call("xr_show", { type: "text", body: "x" });
    const all = await b.call("xr_panel", { action: "close", id: "all" });
    assert.match(all.text, /Closed 3 panel\(s\), stopped 2 stream/);
    assert.equal((await b.local("/status")).openPanels.length, 0);
    assert.ok(sim.lines.some((l) => l.includes("[sim] clear all")));
    assert.match(sim.lines.filter((l) => l.startsWith("[sim] sync")).pop() ?? "", /"ids":\[\]/);
  } finally {
    sim.close();
    await b.close();
  }
});

test("the headset is told every panel id (sync) so it can sweep orphans", async () => {
  const b = await startBridge(nextPort(), env(tmpDir(), { CLAUDEXR_ALWAYS_DISPLAY: "0" }));
  const sim = await startSim(b);
  try {
    const shown = (await b.call("xr_show", { type: "text", body: "a" })).text.replace("Shown ", "");
    await b.call("xr_show", { type: "text", body: "b" });
    // sync is sent on every heartbeat tick (10 s): wait for one
    await waitFor(() => sim.lines.some((l) => l.startsWith("[sim] sync") && l.includes(shown)), 15_000);
  } finally {
    sim.close();
    await b.close();
  }
});

test("a window stream that never delivers a picture, or is refused by macOS, gives a clear error naming the window", async () => {
  const b = await startBridge(nextPort(), env(tmpDir(), { CLAUDEXR_ALWAYS_DISPLAY: "0", FAKE_NO_FRAMES: "1", CLAUDEXR_STREAM_READY_MS: "700" }));
  const sim = await startSim(b);
  try {
    const r = await b.call("xr_stream", { action: "window", id: 11 });
    assert.equal(r.isError, true);
    assert.match(r.text, /No picture from "Code – hub\.ts — bridge"/);
    assert.equal((await b.local("/status")).openPanels.length, 0, "no blank panel left behind");
    assert.equal((await streamsOf(b)).length, 0);
  } finally {
    sim.close();
    await b.close();
  }
  const b2 = await startBridge(nextPort(), env(tmpDir(), { CLAUDEXR_ALWAYS_DISPLAY: "0", FAKE_ERROR_CODE: "-3801" }));
  const sim2 = await startSim(b2);
  try {
    const r = await b2.call("xr_stream", { action: "window", id: 11 });
    assert.equal(r.isError, true);
    assert.match(r.text, /Skärm- och systemljudsinspelning/);
    assert.match(r.text, /Code – hub\.ts/);
  } finally {
    sim2.close();
    await b2.close();
  }
});

test("[ask] windows: the denial names the window and says it is an XR card, not a macOS permission", async () => {
  const b = await startBridge(nextPort(), env(tmpDir(), { CLAUDEXR_ALWAYS_DISPLAY: "0" }));
  const sim = await startSim(b, { permission: "deny" });
  try {
    const list = (await b.call("xr_stream", { action: "windows" })).text;
    assert.match(list, /\[ask\] = streaming needs one tap on an approval card in the headset \(not a macOS permission\)/);
    const r = await b.call("xr_stream", { action: "window", id: 12 });
    assert.equal(r.isError, true);
    assert.match(r.text, /Not approved: "Safari – Docs" needs a tap on the approval card in the headset.*denied in the headset/);
  } finally {
    sim.close();
    await b.close();
  }
});

test("a hard limit on simultaneous streams gives a clear message instead of dropping the display", async () => {
  const b = await startBridge(nextPort(), env(tmpDir(), { CLAUDEXR_MAX_STREAMS: "2" }));
  const sim = await startSim(b, { permission: "allow" });
  try {
    await waitFor(() => sim.lines.some((l) => l.startsWith("[sim] show stream")), 8000);
    assert.match((await b.call("xr_stream", { action: "window", id: 11 })).text, /^Streaming/);
    const r = await b.call("xr_stream", { action: "window", id: 12 });
    assert.equal(r.isError, true);
    assert.match(r.text, /Max 2 simultaneous streams/);
    assert.equal((await streamsOf(b)).some((s) => s.source === "display"), true, "display untouched");
  } finally {
    sim.close();
    await b.close();
  }
});

// ---------------- dimming (fake helper: brightness lives in a file) ----------------

test("dim while the display stream is live and acked; restore on stop, headset loss and emergency", async () => {
  const dir = tmpDir();
  const b = await startBridge(nextPort(), env(dir, { CLAUDEXR_DIM: "1" }));
  const sim = await startSim(b);
  try {
    await waitFor(() => fs.existsSync(path.join(dir, "fb")) && fb(dir) === 0, 8000);
    assert.equal((await b.local("/status")).display.dimmed, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(b.stateDir, "brightness-saved.json"), "utf8")).original, 0.8);
    // stop -> restored
    await b.call("xr_stream", { action: "stop", id: "display" });
    await waitFor(() => fb(dir) === 0.8, 3000);
    assert.equal(fs.existsSync(path.join(b.stateDir, "brightness-saved.json")), false);
    // restart, dim again, then the headset disappears -> restored at once
    await b.call("xr_stream", { action: "display" });
    await waitFor(() => fb(dir) === 0, 8000);
    sim.close();
    await waitFor(() => fb(dir) === 0.8, 4000);
    // new connection, dim, then the panic button
    const sim2 = await startSim(b, { pairing: sim.pairing });
    await waitFor(() => fb(dir) === 0, 8000);
    sim2.ws.emergency!();
    await waitFor(() => fb(dir) === 0.8, 4000);
    await until(async () => (await streamsOf(b)).length === 0, 3000);
    sim2.close();
  } finally {
    await b.close();
  }
});

test("no dimming while the headset does not ack video (blank headset must not leave a dark Mac)", async () => {
  const dir = tmpDir();
  const b = await startBridge(nextPort(), env(dir, { CLAUDEXR_DIM: "1" }));
  const sim = await startSim(b, { video: "noack" });
  try {
    await waitFor(() => sim.lines.some((l) => l.startsWith("[sim] show stream")), 8000);
    await sleep(3000);
    assert.ok(!fs.existsSync(path.join(dir, "fb")) || fb(dir) === 0.8, "brightness untouched");
    assert.equal(fs.existsSync(path.join(b.stateDir, "brightness-saved.json")), false);
  } finally {
    sim.close();
    await b.close();
  }
});

test("SIGTERM while dimmed restores the brightness (and a leftover file is restored at the next start)", async () => {
  const dir = tmpDir();
  const b = await startBridge(nextPort(), env(dir, { CLAUDEXR_DIM: "1" }));
  const sim = await startSim(b);
  const stateDir = b.stateDir;
  try {
    await waitFor(() => fs.existsSync(path.join(dir, "fb")) && fb(dir) === 0, 8000);
    b.daemon.proc.kill("SIGTERM");
    await b.daemon.exited;
    assert.equal(fb(dir), 0.8, "restored by the shutdown handler");
    assert.equal(fs.existsSync(path.join(stateDir, "brightness-saved.json")), false);
  } finally {
    sim.close();
    await b.client.close().catch(() => {});
  }
  // Simulate SIGKILL/crash: the display is dark and the saved value is still on disk. The next start repairs it.
  const state2 = tmpDir();
  fs.writeFileSync(path.join(state2, "brightness-saved.json"), JSON.stringify({ original: 0.65, dimmedTo: 0, savedAt: "x", pid: 1 }));
  fs.writeFileSync(path.join(dir, "fb"), "0");
  const b2 = await startBridge(nextPort(), env(dir, { CLAUDEXR_DIM: "1", CLAUDEXR_ALWAYS_DISPLAY: "0" }), state2);
  try {
    assert.equal(fb(dir), 0.65);
    assert.equal(fs.existsSync(path.join(state2, "brightness-saved.json")), false);
  } finally {
    await b2.close();
  }
});

test("dimming can be switched off (display.dim=false / CLAUDEXR_DIM=0)", async () => {
  const dir = tmpDir();
  const b = await startBridge(nextPort(), env(dir, { CLAUDEXR_DIM: "0" }));
  const sim = await startSim(b);
  try {
    await waitFor(() => sim.lines.some((l) => l.startsWith("[sim] show stream")), 8000);
    await sleep(2500);
    assert.equal(fs.existsSync(path.join(dir, "fb")), false, "brightness never touched");
    assert.equal((await b.local("/status")).display.dimEnabled, false);
  } finally {
    sim.close();
    await b.close();
  }
});

test("'Stäng allt' is sticky: a reconnect (e.g. a 1006) does not bring the display or the dimming back; 'Starta skärmen' does", async () => {
  const dir = tmpDir();
  const b = await startBridge(nextPort(), env(dir, { CLAUDEXR_DIM: "1" }));
  const sim = await startSim(b);
  try {
    await waitFor(() => fs.existsSync(path.join(dir, "fb")) && fb(dir) === 0, 8000);
    sim.ws.emergency!();
    await waitFor(() => fb(dir) === 0.8, 4000);
    sim.close();
    await sleep(300);
    const sim2 = await startSim(b, { pairing: sim.pairing });
    await sleep(3500);
    assert.equal((await streamsOf(b)).length, 0, "no display stream after the reconnect");
    assert.equal(fb(dir), 0.8);
    assert.equal(fs.existsSync(path.join(b.stateDir, "brightness-saved.json")), false);
    sim2.ws.restartDisplay!();
    await waitFor(() => sim2.lines.some((l) => l.startsWith("[sim] show stream")), 8000);
    await waitFor(() => fb(dir) === 0, 8000);
    sim2.close();
  } finally {
    await b.close();
  }
});

test("a leftover brightness file is restored at start even when dimming is switched off in the config", async () => {
  const dir = tmpDir();
  const state = tmpDir();
  fs.writeFileSync(path.join(state, "brightness-saved.json"), JSON.stringify({ original: 0.7, dimmedTo: 0, savedAt: "x", pid: 1 }));
  fs.writeFileSync(path.join(dir, "fb"), "0");
  const b = await startBridge(nextPort(), env(dir, { CLAUDEXR_DIM: "0", CLAUDEXR_ALWAYS_DISPLAY: "0" }), state);
  try {
    assert.equal(fb(dir), 0.7);
    assert.equal(fs.existsSync(path.join(state, "brightness-saved.json")), false);
  } finally {
    await b.close();
  }
});
