// 0.4.1 punkt 3: röstkanalen är avstängd som standard (mätt i kod), tåligare svarsmatchning på svenska.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { correctTerms, matchAB, matchLocalCommand, matchOption, matchVerdict, stripFiller, VoiceInbox } from "../src/voice.js";
import { VoiceRouter } from "../src/voiceroute.js";
import { loadConfig } from "../src/config.js";
import { startBridge, startSim, nextPort, waitFor, tmpDir } from "./helpers.js";

const pcm = (s = 1) => Buffer.alloc(16000 * 2 * s, 0);
function fakeStt() {
  const dir = tmpDir();
  const said = path.join(dir, "said.txt");
  fs.writeFileSync(said, "");
  return { env: { CLAUDEXR_STT_ENGINE: "command", CLAUDEXR_STT_COMMAND: `cat '${said}' # {wav}` }, say: (t: string) => fs.writeFileSync(said, t) };
}
const states = (lines: string[]) => lines.filter((l) => l.startsWith("[sim] voice_state")).map((l) => l.split(" ")[2]);

test("mätning: en ny router utan kanal-poll väljer aldrig 'channel'; bara en poll (take) gör kanalen levande", () => {
  let t = 1_000_000;
  const inbox = new VoiceInbox(10 * 60_000, () => t);
  const r = new VoiceRouter(inbox, () => t);
  assert.equal(inbox.channelAlive(), false);
  assert.equal(r.route(), "queued");
  r.note({ session_id: "s1", hook_event_name: "UserPromptSubmit" });
  assert.equal(r.route(), "working");
  inbox.take();
  assert.equal(r.route(), "channel");
  t += 6_000; // ingen poll på 5 s = kanalen räknas som död
  assert.equal(r.route(), "working");
});

test("konfig: röstkanalen är av som standard och slås på med CLAUDEXR_VOICE_CHANNEL=1", () => {
  const old = process.env.CLAUDEXR_VOICE_CHANNEL;
  const oldDir = process.env.CLAUDEXR_STATE_DIR;
  try {
    process.env.CLAUDEXR_STATE_DIR = tmpDir(); // aldrig användarens riktiga ~/.claudexr
    delete process.env.CLAUDEXR_VOICE_CHANNEL;
    assert.equal(loadConfig().voice.channel, false);
    process.env.CLAUDEXR_VOICE_CHANNEL = "1";
    assert.equal(loadConfig().voice.channel, true);
    process.env.CLAUDEXR_VOICE_CHANNEL = "0";
    assert.equal(loadConfig().voice.channel, false);
  } finally {
    if (oldDir === undefined) delete process.env.CLAUDEXR_STATE_DIR;
    else process.env.CLAUDEXR_STATE_DIR = oldDir;
    if (old === undefined) delete process.env.CLAUDEXR_VOICE_CHANNEL;
    else process.env.CLAUDEXR_VOICE_CHANNEL = old;
  }
});

test("standardbrygga: kanalens poll tar inget och gör inte kanalen levande; meddelandet köas för hookarna", async () => {
  const stt = fakeStt();
  const b = await startBridge(nextPort(), stt.env);
  const sim = await startSim(b);
  await waitFor(() => sim.lines.some((l) => l.includes("media socket open")), 5000);
  try {
    const first = await b.local("/command", { op: "voice_take" });
    assert.equal(first.data.disabled, true);
    stt.say("hej från rösten");
    sim.ws.speak!(pcm());
    await waitFor(() => states(sim.lines).includes("queued"), 6000);
    assert.ok(!states(sim.lines).includes("sent"), "utan påslagen kanal får headsetet aldrig 'Skickat (röstkanalen)'");
    const again = await b.local("/command", { op: "voice_take" });
    assert.deepEqual(again.data.messages, [], "en kanal som inte är påslagen tömmer aldrig inkorgen");
    const st = await b.local("/status");
    assert.equal(st.voice.channelEnabled, false);
    assert.equal(st.voice.queued, 1);
  } finally {
    sim.close();
    await b.close();
  }
});

test("svar med utfyllnadsord: alternativ, fungerar/fungerar inte, A/B", () => {
  const labels = ["Mörkt tema", "Ljust tema", "Behåll"];
  assert.equal(matchOption("Okej, nummer två tack", labels), 1);
  assert.equal(matchOption("Ja, den första", labels), 0);
  assert.equal(matchOption("trean", labels), 2);
  assert.equal(matchOption("Alternativet tre.", labels), 2);
  assert.equal(matchOption("ljust tema tack", labels), 1);
  assert.equal(matchOption("fyran", labels), null, "bara så många alternativ som finns");
  assert.equal(matchOption("jag vet inte riktigt", labels), null);

  assert.equal(matchVerdict("Ja, det funkar."), "works");
  assert.equal(matchVerdict("okej det fungerar bra"), "works");
  assert.equal(matchVerdict("Det funkar inte."), "broken");
  assert.equal(matchVerdict("Nej, det funkar inte"), "broken");
  assert.equal(matchVerdict("nej det funkar"), null, "motsägelsefullt = fritt svar, aldrig 'works'");
  assert.equal(matchVerdict("det funkar inte alls tack"), "broken");
  assert.equal(matchVerdict("det funkar men knappen är fel"), null, "hela yttrandet krävs");

  assert.equal(matchAB("Den andra, tack."), "b");
  assert.equal(matchAB("okej alternativ a"), "a");
  assert.equal(matchAB("ingen av dom"), "neither");
  assert.equal(matchAB("a eller b"), null);
});

test("stripFiller och nya felhörningar; kommandon kräver fortfarande hela yttrandet", () => {
  assert.equal(stripFiller("ja okej nummer två tack"), "nummer två");
  assert.equal(correctTerms("klaud stäng hedsetet"), "Claude stäng headsetet");
  assert.equal(matchLocalCommand("Okej, stäng alla paneler nu tack"), "close_all");
  assert.equal(matchLocalCommand("ja godkänn allt tack"), null);
});
