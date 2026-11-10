// 0.4.0 punkt 3 (BUG-6b9a81): direktleverans av talade meddelanden, tålig kommandomatchning, bättre svensk taltolkning.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { correctTerms, editDistance, matchCommand, matchLocalCommand, pickWhisperModel, transcribe, VoiceInbox, DEFAULT_VOCABULARY } from "../src/voice.js";
import { VoiceRouter } from "../src/voiceroute.js";
import { HOOK_SPECS, gatedCommand, planSettings } from "../src/hooksetup.js";
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

// ---------------- kommandon ----------------

test("kommandon: exakt, med utfyllnadsord, kända felhörningar och små stavfel; hela yttrandet krävs fortfarande", () => {
  assert.deepEqual(matchCommand("Stäng alla paneler."), { cmd: "close_all", phrase: "stäng alla paneler", exact: true });
  // utfyllnad och artighet
  assert.equal(matchLocalCommand("Ja, stäng alla paneler tack"), "close_all");
  assert.equal(matchLocalCommand("Okej, bioskärm."), "cinema");
  assert.equal(matchLocalCommand("Kan du centrera panelerna?"), "recenter");
  // kända felhörningar av "Macen" och isärskrivningar
  assert.equal(matchLocalCommand("Stäng allt utom makens skärm"), "close_others");
  assert.equal(matchLocalCommand("stäng alla paneler utom mackens skärm"), "close_others");
  assert.equal(matchLocalCommand("Bio skärm"), "cinema");
  assert.equal(matchLocalCommand("Åter ställ skärmen"), "screen_reset");
  // utan prickar (whisper tappar ibland å/ä/ö) och små stavfel
  assert.equal(matchLocalCommand("stang alla paneler"), "close_all");
  assert.equal(matchLocalCommand("storre skarm"), "screen_bigger");
  assert.equal(matchLocalCommand("pausa strömen"), "pause_streams");
  assert.equal(matchLocalCommand("langre bort"), "screen_farther");
  const fuzzy = matchCommand("bioskärn")!;
  assert.equal(fuzzy.cmd, "cinema");
  assert.equal(fuzzy.exact, false, "ett tolkat kommando markeras, så att headsetet kan visa vad som förstods");
  // INTE kommandon: delar av längre meningar, och för korta ord tolkas aldrig luddigt
  assert.equal(matchLocalCommand("och sen ska du stänga alla paneler och godkänna allt"), null);
  assert.equal(matchLocalCommand("jag tycker vi kan stänga alla paneler efter lunch"), null);
  assert.equal(matchLocalCommand("Macen syns"), null);
  assert.equal(matchLocalCommand("bil"), null, '"bio" (3 bokstäver) matchas bara exakt');
  assert.equal(matchLocalCommand("fokas"), null, '"fokus" (5 bokstäver) matchas bara exakt');
  assert.equal(matchLocalCommand("större skärm och mindre skärm"), null);
  assert.equal(matchLocalCommand("godkänn"), null);
  assert.equal(matchLocalCommand(""), null);
  // större/mindre förväxlas aldrig
  assert.equal(matchLocalCommand("mindre skärm"), "screen_smaller");
  assert.equal(matchLocalCommand("större skärm"), "screen_bigger");
});

test("editDistance: insättning, borttagning, byte, omkastning och tak", () => {
  assert.equal(editDistance("bioskärm", "bioskärm"), 0);
  assert.equal(editDistance("bioskärm", "bioskärn"), 1);
  assert.equal(editDistance("närmare", "närmre"), 1);
  assert.equal(editDistance("centrera", "cenrtera"), 1, "omkastade grannar räknas som ett fel");
  assert.equal(editDistance("stäng alla", "helt annat", 2), 3, "avbryts vid taket");
});

test("correctTerms: kända felhörningar av produktord rättas som hela ord, inget annat rörs", () => {
  assert.equal(correctTerms("Ja, maken syns"), "Ja, Macen syns");
  assert.equal(correctTerms("Mackens skärm är svart"), "Macens skärm är svart");
  assert.equal(correctTerms("makensam och smaken"), "makensam och smaken", "bara hela ord");
  assert.equal(correctTerms("kör testerna igen"), "kör testerna igen");
  assert.equal(correctTerms("maken syns", {}), "maken syns", "tom lista = av");
  assert.equal(correctTerms("hej klåd", { klåd: "Claude" }), "hej Claude");
});

test("pickWhisperModel: svensktränad eller större modell väljs före base; engelska modeller väljs aldrig", () => {
  const dir = tmpDir();
  assert.equal(pickWhisperModel(path.join(dir, "saknas")), undefined);
  assert.equal(pickWhisperModel(dir), undefined);
  for (const f of ["ggml-base.bin", "ggml-base.en.bin", "readme.txt"]) fs.writeFileSync(path.join(dir, f), "");
  assert.equal(pickWhisperModel(dir), path.join(dir, "ggml-base.bin"));
  fs.writeFileSync(path.join(dir, "ggml-small.bin"), "");
  assert.equal(pickWhisperModel(dir), path.join(dir, "ggml-small.bin"));
  fs.writeFileSync(path.join(dir, "ggml-large-v3-turbo.bin"), "");
  assert.equal(pickWhisperModel(dir), path.join(dir, "ggml-large-v3-turbo.bin"));
  fs.writeFileSync(path.join(dir, "ggml-kb-whisper-large.bin"), "");
  assert.equal(pickWhisperModel(dir), path.join(dir, "ggml-kb-whisper-large.bin"));
});

test("whisper anropas med språk sv och ordlistan som startprompt (låtsas-whisper som skriver ut sina argument)", async () => {
  const dir = tmpDir();
  const bin = path.join(dir, "fake-whisper.sh");
  fs.writeFileSync(bin, '#!/bin/sh\nprintf "%s|" "$@"\n', { mode: 0o755 });
  const cfg = { engine: "whisper-cpp" as const, whisperBin: bin, whisperModel: "/m.bin", autoSendMs: 0, maxSeconds: 30, timeoutMs: 5000, fast: true, language: "sv", previewTimeoutMs: 1000 };
  const out = await transcribe(cfg, "", "/x.wav");
  assert.match(out, /-l\|sv\|/);
  assert.ok(out.includes(`--prompt|${DEFAULT_VOCABULARY}|`), out);
  const off = await transcribe({ ...cfg, vocabulary: "" }, "", "/x.wav");
  assert.ok(!off.includes("--prompt"), "tom ordlista stänger av prompten");
  const own = await transcribe({ ...cfg, vocabulary: "Knivverket, Landeriet" }, "", "/x.wav");
  assert.ok(own.includes("--prompt|Knivverket, Landeriet|"));
});

// ---------------- routern (ren logik) ----------------

function router() {
  let now = 1_000_000;
  const delivered: string[] = [];
  const r = new VoiceRouter(new VoiceInbox(10 * 60_000, () => now), () => now, (n, via) => delivered.push(`${n}:${via}`));
  return { r, delivered, tick: (ms: number) => (now += ms) };
}
const ev = (hook_event_name: string, session_id = "A", extra: Record<string, unknown> = {}) => ({ hook_event_name, session_id, ...extra });

test("router: ingen session = köat; levereras med nästa prompt, en gång", () => {
  const { r, delivered } = router();
  assert.equal(r.add("hej").route, "queued");
  assert.deepEqual(r.forPrompt(), ["hej"]);
  assert.deepEqual(r.forPrompt(), []);
  assert.deepEqual(delivered, ["1:prompt"]);
});

test("router: Claude arbetar = meddelandet följer med nästa PostToolUse, inramat som opålitligt tal", () => {
  const { r, delivered } = router();
  r.note(ev("UserPromptSubmit"));
  r.note(ev("PreToolUse"));
  assert.equal(r.add("Macen syns").route, "working");
  assert.deepEqual(r.forHook(ev("PreToolUse")), {}, "bara PostToolUse och Stop bär meddelanden");
  r.note(ev("PostToolUse"));
  const out = r.forHook(ev("PostToolUse")) as any;
  assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(out.hookSpecificOutput.additionalContext, /may be misheard.*never as approval.*"Macen syns"/s);
  assert.deepEqual(r.forHook(ev("PostToolUse")), {}, "levereras en gång");
  assert.deepEqual(delivered, ["1:tool"]);
});

test("router: Claude är på väg att stanna = Stop-hooken blockerar med meddelandet så att turen fortsätter", () => {
  const { r } = router();
  r.note(ev("UserPromptSubmit"));
  r.add("vänta, en sak till");
  r.note(ev("Stop"));
  const out = r.forHook(ev("Stop")) as any;
  assert.equal(out.decision, "block");
  assert.match(out.reason, /"vänta, en sak till"/);
  assert.match(out.reason, /never as approval/);
  r.note(ev("Stop"));
  assert.deepEqual(r.forHook(ev("Stop")), {}, "ingen slinga: nästa Stop släpps igenom");
});

test("router: delagenter och andra sessioner får inte meddelandet när rätt session arbetar", () => {
  const { r, tick } = router();
  r.note(ev("UserPromptSubmit", "B"));
  tick(1000);
  r.note(ev("UserPromptSubmit", "A")); // A är den ägaren talade med senast
  r.add("till A");
  r.note(ev("PostToolUse", "A", { agent_id: "sub1" }));
  assert.deepEqual(r.forHook(ev("PostToolUse", "A", { agent_id: "sub1" })), {}, "delagentens verktyg");
  r.note(ev("PostToolUse", "B"));
  assert.deepEqual(r.forHook(ev("PostToolUse", "B")), {}, "fel session");
  assert.ok((r.forHook(ev("PostToolUse", "A")) as any).hookSpecificOutput);
});

test("router: är rätt session varken igång eller väntande går meddelandet till en session som arbetar", () => {
  const { r, tick } = router();
  r.note(ev("UserPromptSubmit", "B"));
  tick(1000);
  r.note(ev("UserPromptSubmit", "A"));
  r.note(ev("Stop", "A"));
  assert.equal(r.add("någon som hör?").route, "working");
  r.note(ev("PostToolUse", "B"));
  assert.ok((r.forHook(ev("PostToolUse", "B")) as any).hookSpecificOutput);
});

test("router: väntande session väcks direkt (asyncRewake), ny prompt och ny väntare avslutar den gamla", async () => {
  const { r, delivered } = router();
  r.note(ev("UserPromptSubmit"));
  r.note(ev("Stop"));
  const w = r.wait(ev("Stop"));
  assert.equal(r.info().waiters, 1);
  assert.equal(r.add("är du där").route, "rewake");
  const text = await w;
  assert.match(text, /Voice message.*may be misheard.*"är du där".*Respond to it now/s);
  assert.equal(r.info().queued, 0);
  assert.deepEqual(delivered, ["1:rewake"]);
  // en ny väntare ersätter den gamla; en ny prompt avslutar väntaren utan text
  const w1 = r.wait(ev("Stop"));
  const w2 = r.wait(ev("Stop"));
  assert.equal(await w1, "");
  r.note(ev("UserPromptSubmit"));
  assert.equal(await w2, "");
  assert.equal(r.info().waiters, 0);
  // avbruten anslutning (curl dog) tar bort väntaren
  const ac = new AbortController();
  const w3 = r.wait(ev("Stop"), ac.signal);
  ac.abort();
  assert.equal(await w3, "");
  assert.equal(r.add("x").route, "queued", "en död väntare väljs aldrig");
});

test("router: det som sades mellan Stop och väntarens start levereras direkt av väntaren", async () => {
  const { r } = router();
  r.note(ev("UserPromptSubmit"));
  r.note(ev("Stop"));
  r.add("hann precis");
  assert.match(await r.wait(ev("Stop")), /"hann precis"/);
});

test("router: röstkanalen går före hookarna", () => {
  const { r } = router();
  r.note(ev("UserPromptSubmit"));
  r.inbox.take(); // kanalen pollar
  assert.equal(r.add("via kanalen").route, "channel");
  r.note(ev("PostToolUse"));
  assert.deepEqual(r.forHook(ev("PostToolUse")), {});
  assert.deepEqual(r.inbox.take().map((m) => m.text), ["via kanalen"]);
});

// ---------------- hookinstallationen ----------------

test("install-hooks: Stop får en voicewait-hook med asyncRewake och lång tidsgräns; idempotent", () => {
  const spec = HOOK_SPECS.find((s) => s.name === "voicewait")!;
  assert.equal(spec.event, "Stop");
  const T = { port: 48999, flagPath: "$HOME/.claudexr/on", tokenPath: "$HOME/.claudexr/local-token" };
  const s = planSettings({}, T).settings as any;
  const stop = s.hooks.Stop.flatMap((g: any) => g.hooks);
  const vw = stop.find((h: any) => h.command.includes("/hook/voicewait"));
  assert.equal(vw.asyncRewake, true);
  assert.equal(vw.timeout, spec.timeout);
  assert.ok(vw.command.startsWith('[ -f "$HOME/.claudexr/on" ] || exit 0; '), "samma flagga som övriga hookar");
  assert.match(vw.command, /exit 2$/);
  assert.ok(stop.some((h: any) => h.command.includes("/hook/activity") && h.asyncRewake === undefined));
  assert.equal(planSettings(s, T).changed, false);
});

function runHook(home: string, command: string, input: string) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const p = spawn("sh", ["-c", command], { env: { PATH: process.env.PATH, HOME: home } });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (c) => (stdout += c));
    p.stderr.on("data", (c) => (stderr += c));
    const timer = setTimeout(() => p.kill("SIGKILL"), 15_000);
    p.on("close", (status) => (clearTimeout(timer), resolve({ status, stdout, stderr })));
    p.stdin.end(input);
  });
}

test("voicewait-kommandot: text = stderr + exit 2 (väcker modellen); tomt svar, fel eller ingen flagga = tyst exit 0", async () => {
  const home = tmpDir("claudexr-home-");
  fs.mkdirSync(path.join(home, ".claudexr"));
  fs.writeFileSync(path.join(home, ".claudexr", "local-token"), "TESTTOKEN\n", { mode: 0o600 });
  let reply: { status: number; body: string } = { status: 200, body: 'Voice message: "hej $(echo pwned) `x`"' };
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    seen.push(`${req.url} ${req.headers.authorization}`);
    req.resume();
    req.on("end", () => res.writeHead(reply.status, { "content-type": "text/plain; charset=utf-8" }).end(reply.body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const cmd = gatedCommand({ port: (server.address() as { port: number }).port, flagPath: "$HOME/.claudexr/on", tokenPath: "$HOME/.claudexr/local-token" }, "voicewait", 20);
  try {
    const off = await runHook(home, cmd, "{}");
    assert.deepEqual([off.status, off.stdout, off.stderr, seen.length], [0, "", "", 0], "utan flaggan görs inget anrop");
    fs.writeFileSync(path.join(home, ".claudexr", "on"), "x\n");
    const hit = await runHook(home, cmd, '{"hook_event_name":"Stop","session_id":"s"}');
    assert.equal(hit.status, 2);
    assert.equal(hit.stdout, "");
    assert.equal(hit.stderr, 'Voice message: "hej $(echo pwned) `x`"\n', "texten skrivs ut ordagrant, inget tolkas av skalet");
    assert.equal(seen[0], "/hook/voicewait Bearer TESTTOKEN");
    reply = { status: 204, body: "" };
    const none = await runHook(home, cmd, "{}");
    assert.deepEqual([none.status, none.stdout, none.stderr], [0, "", ""]);
    reply = { status: 401, body: "nej" };
    const bad = await runHook(home, cmd, "{}");
    assert.deepEqual([bad.status, bad.stdout, bad.stderr], [0, "", ""]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

// ---------------- hela vägen genom bryggan ----------------

test("bryggan: tal medan Claude arbetar levereras på nästa PostToolUse; headsetet får besked före och efter", async () => {
  const stt = fakeStt();
  const b = await startBridge(nextPort(), stt.env);
  const sim = await startSim(b);
  await mediaReady(sim);
  try {
    await b.local("/hook/context", { hook_event_name: "UserPromptSubmit", session_id: "s1" });
    await b.local("/hook/activity", { hook_event_name: "PreToolUse", session_id: "s1", tool_name: "Bash", tool_input: { command: "ls" } });
    stt.say("Ja, maken syns");
    sim.ws.speak!(pcm());
    await waitFor(() => states(sim.lines).includes("sent"), 6000);
    const sent = sim.lines.find((l) => l.includes("voice_state sent"))!;
    assert.match(sent, /nästa steg/);
    assert.match(sim.lines.find((l) => l.includes("voice_state preview"))!, /Macen syns/, "felhörningen rättad redan i förhandsvisningen");
    assert.match((await b.call("xr_status")).text, /voice: next spoken message goes to Claude at the next tool step, 1 waiting/);
    const sub = await b.local("/hook/activity", { hook_event_name: "PostToolUse", session_id: "s1", agent_id: "a1", tool_name: "Read", tool_input: {} });
    assert.deepEqual(sub, {}, "inte till en delagent");
    const out = await b.local("/hook/activity", { hook_event_name: "PostToolUse", session_id: "s1", tool_name: "Bash", tool_input: { command: "ls" } });
    assert.match(out.hookSpecificOutput.additionalContext, /"Ja, Macen syns"/);
    assert.match(out.hookSpecificOutput.additionalContext, /never as approval/);
    await waitFor(() => sim.lines.some((l) => l.includes("Claude fick röstmeddelandet")), 3000);
    assert.deepEqual(await b.local("/hook/activity", { hook_event_name: "Stop", session_id: "s1" }), {}, "inget kvar: Stop släpps igenom");
    const h = await b.local("/hook/context", { hook_event_name: "UserPromptSubmit", session_id: "s1" });
    assert.equal(JSON.stringify(h).includes("Macen syns"), false, "levererat en gång");
  } finally {
    sim.close();
    await b.close();
  }
});

test("bryggan: tal när Claude är stilla väcker sessionen via /hook/voicewait; kräver token; tolkat kommando visas", async () => {
  const stt = fakeStt();
  const b = await startBridge(nextPort(), stt.env);
  const sim = await startSim(b);
  await mediaReady(sim);
  const url = `http://127.0.0.1:${b.port + 1}/hook/voicewait`;
  const post = (token: string, body: unknown, signal?: AbortSignal) => fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body), signal });
  try {
    assert.equal((await post("fel", {})).status, 401);
    await b.local("/hook/context", { hook_event_name: "UserPromptSubmit", session_id: "s1" });
    await b.local("/hook/activity", { hook_event_name: "Stop", session_id: "s1" });
    const waiting = post(b.token(), { hook_event_name: "Stop", session_id: "s1" });
    for (let i = 0; (await b.local("/status")).voice.waiters !== 1; i++) {
      assert.ok(i < 100, "väntaren registrerades aldrig");
      await sleep(30);
    }
    assert.match((await b.call("xr_status")).text, /wakes the idle session/);
    stt.say("kör testerna igen");
    sim.ws.speak!(pcm());
    const res = await waiting;
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Voice message.*may be misheard.*"kör testerna igen".*Respond to it now/s);
    await waitFor(() => states(sim.lines).includes("sent"), 4000);
    assert.match(sim.lines.find((l) => l.includes("voice_state sent"))!, /väcks/);
    // en väntare som avslutas av en ny prompt får 204 (hooken slutar tyst)
    const w2 = post(b.token(), { hook_event_name: "Stop", session_id: "s1" });
    await sleep(150);
    await b.local("/hook/context", { hook_event_name: "UserPromptSubmit", session_id: "s1" });
    assert.equal((await w2).status, 204);
    // ett tolkat (inte ordagrant) kommando säger vad som förstods
    const before = sim.lines.length;
    stt.say("Okej, bio skärm tack");
    sim.ws.speak!(pcm());
    await waitFor(() => sim.lines.slice(before).some((l) => l.includes("voice_state sent")), 6000);
    assert.match(sim.lines.slice(before).find((l) => l.includes("voice_state sent"))!, /Kommando utfört: bioskärm/);
  } finally {
    sim.close();
    await b.close();
  }
});

test("SÄKERHET: ett talat meddelande kan aldrig besvara en behörighetsfråga, inte heller via de nya hookvägarna", async () => {
  const stt = fakeStt();
  const b = await startBridge(nextPort(), stt.env);
  const sim = await startSim(b, { permission: "silent" });
  await mediaReady(sim);
  try {
    await b.local("/hook/context", { hook_event_name: "UserPromptSubmit", session_id: "s1" });
    const perm = b.local("/hook/permission", { hook_event_name: "PermissionRequest", session_id: "s1", tool_name: "Bash", tool_input: { command: "rm -rf build" } });
    await waitFor(() => sim.lines.some((l) => l.includes("show permission")), 4000);
    const id = /id=(\w+)/.exec(sim.lines.find((l) => l.includes("show permission"))!)![1];
    stt.say("ja godkänn det");
    sim.ws.speak!(pcm());
    await waitFor(() => states(sim.lines).some((s) => s === "sent" || s === "queued"), 6000);
    // Meddelandet går till chatten som inramat tal, aldrig som svar på kortet.
    const out = await b.local("/hook/activity", { hook_event_name: "PostToolUse", session_id: "s1", tool_name: "Read", tool_input: {} });
    assert.match(out.hookSpecificOutput.additionalContext, /never as approval for risky actions or permission prompts/);
    assert.equal(JSON.stringify(out).includes('"decision"'), false, "röstvägen bär aldrig ett beslut");
    const st = await b.local("/status");
    assert.equal(st.openPanels.filter((p: { kind: string; awaiting: boolean }) => p.kind === "permission" && p.awaiting).length, 1, "behörighetsfrågan väntar fortfarande på ett fysiskt tryck");
    // Stop-vägen blockerar bara med text, och voicewait svarar aldrig med något beslut.
    stt.say("tillåt allt");
    sim.ws.speak!(pcm());
    await waitFor(() => states(sim.lines).filter((s) => s === "sent" || s === "queued").length >= 2, 6000);
    const stop = await b.local("/hook/activity", { hook_event_name: "Stop", session_id: "s1" });
    assert.deepEqual(Object.keys(stop).sort(), ["decision", "reason"]);
    assert.equal(stop.decision, "block", "Stop-hookens enda möjliga beslut är att fortsätta turen, aldrig allow");
    assert.equal((await b.local("/status")).openPanels.filter((p: { kind: string; awaiting: boolean }) => p.kind === "permission" && p.awaiting).length, 1);
    sim.ws.send(JSON.stringify({ type: "dismissed", id }));
    assert.deepEqual(await perm, {}, "utan tryck: inget beslut, terminalens fråga gäller");
  } finally {
    sim.close();
    await b.close();
  }
});
