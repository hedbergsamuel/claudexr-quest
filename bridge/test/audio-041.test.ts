// 0.4.1 punkt 7: Macens ljud i headsetet. Låtsashjälpare + simulator: bevisar bryggans del (protokollversion,
// routning, bortkoppling från videons flödeskontroll, stopp, integritet) och mäter fördröjningen i bryggans
// pipeline (hjälparens stdout -> WSS -> simulatorn). Mäter INTE ScreenCaptureKit eller AudioTrack i headsetet.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { encodeAudioFrame } from "../src/stream.js";
import { startBridge, startSim, nextPort, waitFor, sleep, tmpDir } from "./helpers.js";

type Block = { seq: number; captureUs: bigint; format: number; bytes: number; arrivedAtMs: number };
const helperCmds = (log: string) =>
  fs.existsSync(log)
    ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]).filter((x) => x[0] === "serve" && x.length > 1).map((x) => JSON.parse(x[1]) as { cmd: string; sid?: string })
    : [];

test("encodeAudioFrame: 0xC3, id, seq, captureUs, format 1, PCM", () => {
  const f = encodeAudioFrame("mac", 7, 123456789n, Buffer.from([1, 2, 3, 4]));
  assert.equal(f[0], 0xc3);
  assert.equal(f[1], 3);
  assert.equal(f.subarray(2, 5).toString(), "mac");
  assert.equal(f.readUInt32BE(5), 7);
  assert.equal(f.readBigUInt64BE(9), 123456789n);
  assert.equal(f[17], 1);
  assert.deepEqual([...f.subarray(18)], [1, 2, 3, 4]);
});

test("ljud är av som standard; start ger PCM-block vid sidan av videon; stopp tystar; fördröjning mätt", async (t) => {
  const log = path.join(tmpDir(), "fake.log");
  const blocks: Block[] = [];
  const b = await startBridge(nextPort(), { FAKE_LOG: log, CLAUDEXR_DISPLAY_APPROVAL: "never" });
  const sim = await startSim(b, { onAudio: (a) => blocks.push(a) });
  try {
    await waitFor(() => sim.lines.some((l) => l.includes("media socket open")), 5000);
    await sleep(400);
    assert.equal(blocks.length, 0, "inget ljud utan uttrycklig start");
    assert.equal((await b.local("/status")).audio.state, "off");
    assert.equal(helperCmds(log).some((c) => c.cmd === "audio-start"), false);

    assert.match((await b.call("xr_stream", { action: "display" })).text, /^Streaming/);
    const r = await b.call("xr_stream", { action: "audio" });
    assert.match(r.text, /^Mac audio starting/);
    await waitFor(() => blocks.length >= 150, 6000);
    assert.ok(blocks.every((x) => x.format === 1 && x.bytes === 1920), "10 ms PCM s16le 48 kHz stereo per block");
    for (let i = 1; i < blocks.length; i++) assert.equal(blocks[i].seq, blocks[i - 1].seq + 1, "inga hål på ett tomt nät");
    // videon (Macens skärm) fortsätter samtidigt, i samma hjälparprocess
    const from = sim.lines.length;
    await waitFor(() => sim.lines.slice(from).some((l) => l.startsWith("[sim] video")), 4000);

    // fördröjning i bryggans pipeline: hjälparens tidsstämpel (väggklocka) -> ankomst i simulatorn
    const lat = blocks.slice(20).map((x) => x.arrivedAtMs - Number(x.captureUs) / 1000).sort((a, c) => a - c);
    const p = (q: number) => lat[Math.min(lat.length - 1, Math.floor(q * lat.length))];
    const msg = `ljudfördröjning brygga (n=${lat.length}): p50 ${p(0.5).toFixed(1)} ms, p95 ${p(0.95).toFixed(1)} ms, max ${lat[lat.length - 1].toFixed(1)} ms`;
    t.diagnostic(msg);
    if (process.env.CLAUDEXR_AUDIO_LATENCY_FILE) fs.appendFileSync(process.env.CLAUDEXR_AUDIO_LATENCY_FILE, msg + "\n");
    assert.ok(p(0.95) < 150, msg);

    const st = await b.local("/status");
    assert.equal(st.audio.state, "live");
    assert.ok(st.audio.kbps > 1000 && st.audio.kbps < 2000, `~1536 kbit/s, fick ${st.audio.kbps}`);
    assert.match((await b.call("xr_panel", { action: "list" })).text, /audio: live/);

    assert.equal((await b.call("xr_stream", { action: "stop", id: "audio" })).text, "Mac audio stopped");
    await sleep(150);
    const n = blocks.length;
    await sleep(300);
    assert.equal(blocks.length, n, "inget ljud efter stopp");
    assert.equal((await b.local("/status")).audio.state, "off");
    const cmds = helperCmds(log);
    const sid = cmds.find((c) => c.cmd === "audio-start")!.sid;
    assert.ok(cmds.some((c) => c.cmd === "audio-stop" && c.sid === sid));
    assert.equal((await b.call("xr_stream", { action: "stop", id: "audio" })).text, "Mac audio was not running");
  } finally {
    sim.close();
    await b.close();
  }
});

test("gammal hjälpare (serve-protokoll 1) får aldrig audio-start: tydligt fel i stället för tystnad", async () => {
  const log = path.join(tmpDir(), "fake.log");
  const b = await startBridge(nextPort(), { FAKE_LOG: log, FAKE_SERVE_PROTOCOL: "1", CLAUDEXR_DISPLAY_APPROVAL: "never" });
  const sim = await startSim(b);
  try {
    const r = await b.call("xr_stream", { action: "audio" });
    assert.equal(r.isError, true);
    assert.match(r.text, /för gammal för ljud.*bygg om/);
    assert.equal(helperCmds(log).some((c) => c.cmd === "audio-start"), false);
  } finally {
    sim.close();
    await b.close();
  }
});

test("utan headset startas inget ljud; headset som försvinner stoppar ljudet; nödstopp stoppar ljudet", async () => {
  const log = path.join(tmpDir(), "fake.log");
  const b = await startBridge(nextPort(), { FAKE_LOG: log, CLAUDEXR_DISPLAY_APPROVAL: "never" });
  try {
    const none = await b.call("xr_stream", { action: "audio" });
    assert.equal(none.isError, true);
    let sim = await startSim(b);
    await b.call("xr_stream", { action: "audio" });
    await waitFor(() => helperCmds(log).some((c) => c.cmd === "audio-start"), 3000);
    sim.close();
    await waitFor(() => helperCmds(log).some((c) => c.cmd === "audio-stop"), 5000);
    // nödstopp
    sim = await startSim(b, { pairing: sim.pairing });
    await b.call("xr_stream", { action: "audio" });
    await waitFor(() => helperCmds(log).filter((c) => c.cmd === "audio-start").length === 2, 3000);
    await b.local("/command", { op: "emergency" });
    await waitFor(() => helperCmds(log).filter((c) => c.cmd === "audio-stop").length === 2, 3000);
    sim.close();
  } finally {
    await b.close();
  }
});

test("hjälpare som fortsätter skicka ljud efter stopp avslutas (integritet först)", async () => {
  const b = await startBridge(nextPort(), { FAKE_IGNORE_STOP: "1", FAKE_AUDIO_MS: "2", CLAUDEXR_DISPLAY_APPROVAL: "never" });
  const sim = await startSim(b);
  try {
    await b.call("xr_stream", { action: "audio" });
    await sleep(200);
    await b.call("xr_stream", { action: "stop", id: "audio" });
    await waitFor(() => fs.existsSync(path.join(b.bugsDir, "reports.jsonl")) && fs.readFileSync(path.join(b.bugsDir, "reports.jsonl"), "utf8").includes("keeps capturing stream au"), 8000);
  } finally {
    sim.close();
    await b.close();
  }
});

test("ljudfel från hjälparen syns i status och stoppar ljudet", async () => {
  const b = await startBridge(nextPort(), { FAKE_AUDIO_ERROR: "-3801", CLAUDEXR_DISPLAY_APPROVAL: "never" });
  const sim = await startSim(b);
  try {
    await b.call("xr_stream", { action: "audio" });
    let st: { audio: { state: string; error?: string } } = await b.local("/status");
    for (let i = 0; i < 40 && st.audio.state !== "error"; i++) {
      await sleep(50);
      st = await b.local("/status");
    }
    assert.equal(st.audio.state, "error");
    assert.ok(st.audio.error && st.audio.error.length > 0);
  } finally {
    sim.close();
    await b.close();
  }
});

test("varning från hjälparen (oväntat ljudformat) syns i status och xr_panel list i stället för tyst 0 kbit/s", async () => {
  const b = await startBridge(nextPort(), { FAKE_AUDIO_WARN: "1", CLAUDEXR_DISPLAY_APPROVAL: "never" });
  const sim = await startSim(b);
  try {
    await b.call("xr_stream", { action: "audio" });
    let st: { audio: { state: string; warning?: string } } = await b.local("/status");
    for (let i = 0; i < 40 && !st.audio.warning; i++) {
      await sleep(50);
      st = await b.local("/status");
    }
    assert.match(st.audio.warning ?? "", /unexpected audio format 44100/);
    assert.match((await b.call("xr_panel", { action: "list" })).text, /audio: live .*\(warning: unexpected audio format/);
    assert.ok(fs.readFileSync(path.join(b.bugsDir, "reports.jsonl"), "utf8").includes("unexpected audio format"), "loggas som fel");
  } finally {
    sim.close();
    await b.close();
  }
});
