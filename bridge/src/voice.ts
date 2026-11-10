// Push-to-talk voice: local speech-to-text on the Mac and model-free voice commands.
//
// SECURITY: transcribed text is UNTRUSTED input (it can come from a TV or another person). It is only
// ever (a) matched against a fixed list of local commands that can only hide/close/re-arrange things,
// (b) offered as an answer to a question Claude explicitly asked (xr_ask/xr_test/listen), after the
// user confirmed "Jag hörde: …" (unless auto-send is configured). Voice can NEVER resolve permission
// requests, pairing, or approval to stream a window: those need a physical tap.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface VoiceConfig {
  /** "whisper-cpp" (default), "apple" (claudexr-capture stt-apple, on-device) or "command" (custom; {wav} placeholder) */
  engine: "whisper-cpp" | "apple" | "command";
  whisperBin: string;
  whisperModel: string;
  command?: string;
  /** 0 = always ask "Skicka/Avbryt"; > 0 = send automatically after this many ms unless cancelled */
  autoSendMs: number;
  maxSeconds: number;
  /** hard limit for one transcription (the child process is killed); 0.2.0 waited up to 60 s */
  timeoutMs: number;
  /** whisper: greedy decoding without temperature fallback (-bs 1 -nf): several times faster on noisy clips */
  fast: boolean;
  /** whisper -l value: "auto" (sv/en detection) or a fixed language such as "sv" (faster, no detection pass) */
  language: string;
  /** how long the previewed transcript waits for Skicka/Avbryt */
  previewTimeoutMs: number;
}

export const SAMPLE_RATE = 16_000;

/** 16-bit mono little-endian PCM -> WAV container. */
export function pcmToWav(pcm: Buffer, rate = SAMPLE_RATE): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Run the configured local STT engine on a WAV file. Never uses the network. */
export function transcribe(cfg: VoiceConfig, captureBin: string, wavPath: string): Promise<string> {
  let bin: string;
  let args: string[];
  if (cfg.engine === "apple") {
    bin = captureBin;
    args = ["stt-apple", wavPath, "--lang", "auto"];
  } else if (cfg.engine === "command" && cfg.command) {
    bin = "/bin/sh";
    args = ["-c", cfg.command.replaceAll("{wav}", `'${wavPath.replace(/'/g, "")}'`)];
  } else {
    bin = cfg.whisperBin;
    // -l auto: Swedish/English detection; -nt: no timestamps; -np: no progress output.
    // fast: -bs 1 (greedy) and -nf (no temperature fallback; on noise the fallback retried up to 6 times).
    args = ["-m", cfg.whisperModel, "-f", wavPath, "-l", cfg.language || "auto", "-nt", "-np", "-t", String(Math.max(2, Math.min(8, os.availableParallelism?.() ?? 4)))];
    if (cfg.fast) args.push("-bs", "1", "-nf");
  }
  return new Promise((resolve, reject) =>
    execFile(bin, args, { timeout: cfg.timeoutMs > 0 ? cfg.timeoutMs : 25_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        const timedOut = (err as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
        return reject(new Error(timedOut ? `STT (${cfg.engine}) timed out after ${cfg.timeoutMs} ms` : `STT (${cfg.engine}) failed: ${err.message}`));
      }
      let text = stdout.trim();
      if (cfg.engine === "apple") {
        try {
          text = String(JSON.parse(text).text ?? "");
        } catch {
          /* plain text */
        }
      }
      // whisper prints "[BLANK_AUDIO]" or "(music)" style tags for non-speech.
      resolve(text.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().slice(0, 1000));
    }),
  );
}

const live = new Set<string>();

/**
 * Cut leading/trailing silence (and cap the total length) before transcription: less audio = less work,
 * and whisper no longer hallucinates on long silent tails. 20 ms frames, adaptive threshold from the
 * clip's own noise floor, 200 ms padding. Returns the input when nothing clearly louder than the floor exists.
 */
export function trimSilence(pcm: Buffer, rate = SAMPLE_RATE): Buffer {
  const frame = Math.floor(rate * 0.02) * 2;
  const n = Math.floor(pcm.length / frame);
  if (n < 10) return pcm;
  const rms: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let o = i * frame; o < (i + 1) * frame; o += 2) {
      const v = pcm.readInt16LE(o);
      sum += v * v;
    }
    rms.push(Math.sqrt(sum / (frame / 2)));
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.2)];
  const peak = sorted[sorted.length - 1];
  if (peak < 200 || peak < floor * 3) return pcm; // nothing speech-like: let the engine decide
  const thr = Math.max(floor * 2.5, peak * 0.06, 120);
  let first = rms.findIndex((v) => v >= thr);
  let last = rms.length - 1 - [...rms].reverse().findIndex((v) => v >= thr);
  if (first < 0) return pcm;
  const pad = 10; // 200 ms
  first = Math.max(0, first - pad);
  last = Math.min(rms.length - 1, last + pad);
  return pcm.subarray(first * frame, (last + 1) * frame);
}

/** The STT engines read a file, so audio exists on disk (mode 0600) only while it is transcribed. */
export async function transcribePcm(cfg: VoiceConfig, captureBin: string, rawPcm: Buffer): Promise<string> {
  const pcm = trimSilence(rawPcm);
  if (pcm.length < SAMPLE_RATE * 2 * 0.15) return "";
  const file = path.join(os.tmpdir(), `claudexr-voice-${randomUUID()}.wav`);
  live.add(file);
  fs.writeFileSync(file, pcmToWav(pcm), { mode: 0o600 });
  try {
    return await transcribe(cfg, captureBin, file);
  } finally {
    fs.rmSync(file, { force: true }); // no audio is kept
    live.delete(file);
  }
}

/** Remove audio left behind by a crash/kill (called at start-up and on shutdown). */
export function cleanupVoiceFiles() {
  for (const f of live) fs.rmSync(f, { force: true });
  try {
    for (const f of fs.readdirSync(os.tmpdir())) if (f.startsWith("claudexr-voice-")) fs.rmSync(path.join(os.tmpdir(), f), { force: true });
  } catch {}
}

export const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFC")
    .replace(/[.,!?;:"'«»…]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(hej |hey |ok |okej )?claude /, "");

export type LocalCommand = "close_all" | "close_others" | "cinema" | "screen_bigger" | "screen_smaller" | "screen_farther" | "screen_closer" | "screen_reset" | "recenter" | "focus" | "review" | "status" | "pause_streams";

// Whole-utterance matches only (a TV saying "…and then close all panels and approve…" does not match).
const COMMANDS: Record<LocalCommand, string[]> = {
  close_all: ["stäng alla paneler", "stäng alla", "stäng allt", "rensa", "rensa allt", "close all panels", "close all", "close everything", "clear all", "clear panels"],
  close_others: ["stäng allt utom skärmen", "stäng allt utom macens skärm", "stäng alla utom skärmen", "stäng alla utom macens skärm", "stäng alla paneler utom skärmen", "stäng alla paneler utom macens skärm", "stäng allt utom macen", "close all except the screen", "close all but the screen", "close everything except the screen", "close all panels except the screen"],
  cinema: ["bioskärm", "bioskärmen", "bio", "cinema", "cinema screen", "bioläge"],
  screen_bigger: ["större skärm", "större skärmen", "skärmen större", "gör skärmen större", "bigger screen", "make the screen bigger"],
  screen_smaller: ["mindre skärm", "mindre skärmen", "skärmen mindre", "gör skärmen mindre", "smaller screen", "make the screen smaller"],
  screen_farther: ["längre bort", "skärmen längre bort", "flytta skärmen längre bort", "farther away", "move the screen back"],
  screen_closer: ["närmare", "skärmen närmare", "flytta skärmen närmare", "closer", "move the screen closer"],
  screen_reset: ["återställ", "återställ skärmen", "återställ placeringen", "reset screen", "reset the screen"],
  recenter: ["centrera", "centrera paneler", "centrera panelerna", "recenter", "re center", "center", "centre", "center panels"],
  focus: ["fokusläge", "fokus", "fokusera", "focus", "focus mode"],
  review: ["visa alla", "normalläge", "visa alla paneler", "show all", "review mode", "normal mode"],
  status: ["visa status", "status", "show status", "what's the status", "whats the status"],
  pause_streams: ["pausa strömmen", "pausa strömning", "pausa strömningen", "stoppa strömmen", "stoppa strömning", "pause stream", "pause the stream", "pause streaming", "stop stream", "stop streaming"],
};

export function matchLocalCommand(text: string): LocalCommand | null {
  const n = normalize(text);
  for (const [cmd, phrases] of Object.entries(COMMANDS) as [LocalCommand, string[]][]) if (phrases.includes(n)) return cmd;
  return null;
}

const ORDINALS: string[][] = [
  ["1", "ett", "en", "etta", "första", "one", "first", "alternativ ett", "option one"],
  ["2", "två", "tvåa", "andra", "two", "second", "alternativ två", "option two"],
  ["3", "tre", "trea", "tredje", "three", "third", "alternativ tre", "option three"],
  ["4", "fyra", "fyra", "fjärde", "four", "fourth", "alternativ fyra", "option four"],
];

/** Which option was meant: by number word, or by the option's label being said. null = free answer. */
export function matchOption(text: string, labels: string[]): number | null {
  const n = normalize(text).replace(/^(nummer|number|alternativ|option) /, "");
  for (let i = 0; i < Math.min(labels.length, 4); i++) if (ORDINALS[i].includes(n)) return i;
  const hits = labels.map((l, i) => ({ i, l: normalize(l) })).filter(({ l }) => l.length >= 2 && (n === l || n.includes(l)));
  if (hits.length === 1) return hits[0].i;
  // the longest label wins when one contains another ("Dark" vs "Dark blue")
  if (hits.length > 1) return hits.sort((a, b) => b.l.length - a.l.length)[0].i;
  return null;
}

export function matchVerdict(text: string): "works" | "broken" | null {
  const n = normalize(text);
  if (/^(det )?(funkar|fungerar|fungerade|funkade|ser bra ut|works|it works|working|looks good|ok|okej)( bra)?$/.test(n)) return "works";
  if (/^(det )?(funkar inte|fungerar inte|trasig|trasigt|fel|broken|it's broken|its broken|doesn't work|does not work|not working)$/.test(n)) return "broken";
  return null;
}

export function matchAB(text: string): "a" | "b" | "neither" | null {
  const n = normalize(text);
  if (/^(a|alternativ a|option a|den första|the first one|första)$/.test(n)) return "a";
  if (/^(b|be|alternativ b|option b|den andra|the second one|andra)$/.test(n)) return "b";
  if (/^(ingen|ingen av dem|neither|none)$/.test(n)) return "neither";
  return null;
}

/**
 * Spoken messages the user confirmed (Skicka) but that no question was waiting for. They are delivered to
 * Claude (a) by the optional voice channel (stdio MCP, `--voice-channel`) or (b) as context on the next prompt
 * (UserPromptSubmit hook). Always framed as untrusted speech by the consumers.
 */
export interface InboxMessage {
  id: string;
  text: string;
  at: number;
}

export class VoiceInbox {
  private items: InboxMessage[] = [];
  private lastChannelPoll = -Infinity;
  constructor(private readonly ttlMs = 10 * 60_000, private readonly now: () => number = Date.now) {}

  add(text: string): InboxMessage {
    const m = { id: randomUUID().slice(0, 8), text: text.slice(0, 1000), at: this.now() };
    this.items.push(m);
    if (this.items.length > 20) this.items.shift();
    return m;
  }

  private prune() {
    const t = this.now() - this.ttlMs;
    this.items = this.items.filter((m) => m.at >= t);
  }

  /** Channel consumer: returns and removes everything pending. Marks the channel as alive. */
  take(): InboxMessage[] {
    this.lastChannelPoll = this.now();
    this.prune();
    const out = this.items;
    this.items = [];
    return out;
  }

  /** Hook consumer: pending messages are delivered once (removed), unless a live channel will take them. */
  takeForHook(): InboxMessage[] {
    this.prune();
    if (this.channelAlive()) return [];
    const out = this.items;
    this.items = [];
    return out;
  }

  channelAlive(): boolean {
    return this.now() - this.lastChannelPoll < 5_000;
  }

  get size(): number {
    this.prune();
    return this.items.length;
  }
}
