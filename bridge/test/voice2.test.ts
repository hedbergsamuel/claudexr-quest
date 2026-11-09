import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { trimSilence, VoiceInbox } from "../src/voice.js";
import { startBridge, startSim, nextPort, waitFor, sleep, tmpDir } from "./helpers.js";

const pcm = (s = 1) => Buffer.alloc(16000 * 2 * s, 0);
function fakeStt() {
  const dir = tmpDir();
  const said = path.join(dir, "said.txt");
  fs.writeFileSync(said, "");
  return { env: { CLAUDEXR_STT_ENGINE: "command", CLAUDEXR_STT_COMMAND: `cat '${said}' # {wav}` }, say: (t: string) => fs.writeFileSync(said, t) };
}
const mediaReady = (sim: { lines: string[] }) => waitFor(() => sim.lines.some((l) => l.includes("media socket open")), 5000);
const states = (lines: string[]) => lines.filter((l) => l.startsWith("[sim] voice_state")).map((l) => l.split(" ")[2]);

function tone(seconds: number, amp = 8000) {
  const b = Buffer.alloc(Math.floor(16000 * seconds) * 2);
  for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(Math.sin(i / 5) * amp), i * 2);
  return b;
}
const noise = (seconds: number) => {
  const b = Buffer.alloc(Math.floor(16000 * seconds) * 2);
  for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(((i * 7919) % 41) - 20, i * 2);
  return b;
};

test("trimSilence cuts leading/trailing silence, keeps the speech and a short pad, leaves pure silence alone", () => {
  const clip = Buffer.concat([noise(2), tone(0.6), noise(3)]);
  const t = trimSilence(clip);
  assert.ok(t.length < clip.length * 0.4, `trimmed ${clip.length} -> ${t.length}`);
  assert.ok(t.length >= tone(0.6).length, "the speech is kept");
  assert.equal(trimSilence(pcm(2)).length, pcm(2).length, "pure silence untouched (the engine decides)");
  assert.equal(trimSilence(Buffer.alloc(100)).length, 100);
});

test("voice inbox: expires, is taken once, and defers to a live channel", () => {
  let now = 0;
  const inbox = new VoiceInbox(10_000, () => now);
  inbox.add("hej");
  assert.equal(inbox.size, 1);
  assert.deepEqual(inbox.takeForHook().map((m) => m.text), ["hej"]);
  assert.equal(inbox.takeForHook().length, 0);
  inbox.add("a");
  now += 11_000;
  assert.equal(inbox.size, 0, "expired");
  inbox.add("b");
  assert.deepEqual(inbox.take().map((m) => m.text), ["b"]);
  inbox.add("c");
  assert.equal(inbox.channelAlive(), true);
  assert.equal(inbox.takeForHook().length, 0, "a live channel gets it, not the hook");
  now += 6000;
  assert.deepEqual(inbox.takeForHook().map((m) => m.text), ["c"]);
});

test("push-to-talk with no question open: preview -> Skicka -> queued, delivered once on the next prompt (hook context)", async () => {
  const stt = fakeStt();
  const b = await startBridge(nextPort(), stt.env);
  const sim = await startSim(b);
  await mediaReady(sim);
  try {
    stt.say("kör testerna igen");
    sim.ws.speak!(pcm());
    await waitFor(() => states(sim.lines).includes("queued"), 6000);
    assert.deepEqual(states(sim.lines).slice(0, 4), ["listening", "transcribing", "preview", "queued"]);
    assert.ok(sim.lines.some((l) => l.includes("voice_state queued") && l.includes("nästa prompt")));
    const h1 = await b.local("/hook/context", { hook_event_name: "UserPromptSubmit", session_id: "s1" });
    const ctx = h1.hookSpecificOutput.additionalContext as string;
    assert.match(ctx, /Voice message.*speech, may be misheard.*"kör testerna igen"/s);
    const h2 = await b.local("/hook/context", { hook_event_name: "UserPromptSubmit", session_id: "s1" });
    assert.equal(JSON.stringify(h2).includes("kör testerna"), false, "delivered once");
  } finally {
    sim.close();
    await b.close();
  }
});

test("with the voice channel polling, a confirmed message is 'sent' and handed to the channel (not queued for the hook)", async () => {
  const stt = fakeStt();
  const b = await startBridge(nextPort(), stt.env);
  const sim = await startSim(b);
  await mediaReady(sim);
  try {
    await b.local("/command", { op: "voice_take" }); // the channel announces itself by polling
    stt.say("hej från rösten");
    sim.ws.speak!(pcm());
    await waitFor(() => states(sim.lines).includes("sent"), 6000);
    assert.match(sim.lines.find((l) => l.includes("voice_state sent"))!, /röstkanalen/);
    const r = await b.local("/command", { op: "voice_take" });
    assert.deepEqual(r.data.messages.map((m: { text: string }) => m.text), ["hej från rösten"]);
  } finally {
    sim.close();
    await b.close();
  }
});

test("Avbryt in the preview delivers nothing", async () => {
  const stt = fakeStt();
  const b = await startBridge(nextPort(), stt.env);
  const sim = await startSim(b, { heard: "cancel" });
  await mediaReady(sim);
  try {
    stt.say("radera allt");
    sim.ws.speak!(pcm());
    await waitFor(() => states(sim.lines).includes("cancelled"), 6000);
    const r = await b.local("/command", { op: "voice_take" });
    assert.deepEqual(r.data.messages, []);
  } finally {
    sim.close();
    await b.close();
  }
});

test("a speech engine that hangs is killed after the timeout: the user sees an error state, the next press still works", async () => {
  const dir = tmpDir();
  const said = path.join(dir, "said.txt");
  fs.writeFileSync(said, "");
  const script = path.join(dir, "stt.sh");
  fs.writeFileSync(script, `#!/bin/sh\nif [ -f '${dir}/hang' ]; then sleep 20; fi\ncat '${said}'\n`, { mode: 0o755 });
  const b = await startBridge(nextPort(), { CLAUDEXR_STT_ENGINE: "command", CLAUDEXR_STT_COMMAND: `${script} {wav}`, CLAUDEXR_VOICE_TIMEOUT_MS: "800" });
  const sim = await startSim(b);
  await mediaReady(sim);
  try {
    fs.writeFileSync(path.join(dir, "hang"), "");
    sim.ws.speak!(pcm());
    const t0 = Date.now();
    await waitFor(() => states(sim.lines).includes("error"), 6000);
    assert.ok(Date.now() - t0 < 4000, "no 50-second silence");
    assert.match(sim.lines.find((l) => l.includes("voice_state error"))!, /tog för lång tid/);
    fs.rmSync(path.join(dir, "hang"));
    said && fs.writeFileSync(said, "nu funkar det");
    sim.ws.speak!(pcm());
    await waitFor(() => states(sim.lines).includes("queued"), 6000);
  } finally {
    sim.close();
    await b.close();
  }
});

test("too short or empty speech gives an explicit error state instead of silence", async () => {
  const stt = fakeStt();
  const b = await startBridge(nextPort(), stt.env);
  const sim = await startSim(b);
  await mediaReady(sim);
  try {
    sim.ws.speak!(Buffer.alloc(3200)); // 0.1 s
    await waitFor(() => states(sim.lines).includes("error"), 4000);
    assert.match(sim.lines.find((l) => l.includes("voice_state error"))!, /För kort/);
    stt.say("");
    sim.ws.speak!(pcm());
    await waitFor(() => states(sim.lines).filter((s) => s === "error").length === 2, 4000);
    assert.ok(sim.lines.some((l) => l.includes("Jag hörde inget")));
  } finally {
    sim.close();
    await b.close();
  }
});
