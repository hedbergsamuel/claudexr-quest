// Installer for the ClaudeXR hooks in ~/.claude/settings.json (0.3.1).
//
// Every ClaudeXR hook becomes a COMMAND hook that is gated on the flag file the bridge keeps while a headset is on:
//
//   [ -f "$HOME/.claudexr/on" ] || exit 0; curl -sf -m <timeout-1> -X POST <url> \
//     -H "Authorization: Bearer $(cat "$HOME/.claudexr/local-token" 2>/dev/null)" -H "Content-Type: application/json" \
//     --data-binary @- || exit 0
//
// - no flag: no process but the shell, no network call, no hook error;
// - the token is read from the bridge's 0600 token file when the hook runs, so the Claude session needs no
//   CLAUDEXR_TOKEN in its environment and the token never ends up in settings.json;
// - curl prints the daemon's answer unchanged on stdout (PermissionRequest decisions), and any failure is exit 0
//   (fail-closed: the terminal prompt then decides).
// The installer is idempotent, replaces old ClaudeXR http hooks (and older gated commands), never touches other hooks,
// takes a backup first and has --dry-run (diff only).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_PORT, localPortFor } from "./protocol.js";
import { flagDir } from "./flag.js";

const DEFAULT_LOCAL_PORT = DEFAULT_PORT + 1; // 47801

export type HookName = "context" | "activity" | "permission" | "voicewait";
/** How long the background voice waiter lives after a turn (then spoken messages wait for the next prompt again). */
export const VOICEWAIT_TIMEOUT_S = 3600;

export interface HookSpec {
  event: string;
  name: HookName;
  timeout: number;
  /** 0.4.0: background hook that wakes the model when it exits with code 2 (Claude Code `asyncRewake`) */
  asyncRewake?: boolean;
}

/** The 11 ClaudeXR hooks (event -> bridge route), same mapping as print-config had in 0.3.0. */
export const HOOK_SPECS: HookSpec[] = [
  { event: "SessionStart", name: "context", timeout: 3 },
  { event: "UserPromptSubmit", name: "context", timeout: 3 },
  { event: "UserPromptSubmit", name: "activity", timeout: 2 },
  { event: "PermissionRequest", name: "permission", timeout: 150 },
  { event: "PreToolUse", name: "activity", timeout: 2 },
  { event: "PostToolUse", name: "activity", timeout: 2 },
  { event: "PostToolUseFailure", name: "activity", timeout: 2 },
  { event: "Notification", name: "activity", timeout: 2 },
  { event: "Stop", name: "activity", timeout: 2 },
  { event: "TaskCreated", name: "activity", timeout: 2 },
  { event: "TaskCompleted", name: "activity", timeout: 2 },
  // 0.4.0 (BUG-6b9a81): waits in the background after a turn; a spoken message wakes the idle session at once.
  { event: "Stop", name: "voicewait", timeout: VOICEWAIT_TIMEOUT_S, asyncRewake: true },
];

export interface HookTargets {
  /** loopback port of the daemon (default 47801) */
  port: number;
  /** shell expression for the flag file, e.g. $HOME/.claudexr/on */
  flagPath: string;
  /** shell expression for the token file, e.g. $HOME/.claudexr/local-token */
  tokenPath: string;
}

/** "<home>/x" -> "$HOME/x" (so settings.json holds no user name); anything else must be a plain absolute path. */
export function shellPath(p: string, home = os.homedir()): string {
  if (/[\0"$`\\\n]/.test(p) && !p.startsWith("$HOME/")) throw new Error(`unsupported character in path: ${p}`);
  if (p.startsWith("$HOME/")) return p;
  if (!path.isAbsolute(p)) throw new Error(`path must be absolute: ${p}`);
  const h = home.replace(/\/+$/, "");
  return p === h ? "$HOME" : p.startsWith(h + "/") ? `$HOME/${p.slice(h.length + 1)}` : p;
}

export function defaultTargets(o: { port?: number; flagDir?: string; stateDir?: string } = {}): HookTargets {
  const home = os.homedir();
  const port = o.port ?? localPortFor(Number(process.env.CLAUDEXR_PORT || DEFAULT_PORT));
  return {
    port,
    // same directories the daemon uses (CLAUDEXR_FLAG_DIR / CLAUDEXR_STATE_DIR, default ~/.claudexr)
    flagPath: shellPath(path.join(o.flagDir ?? flagDir(), "on"), home),
    tokenPath: shellPath(path.join(o.stateDir ?? (process.env.CLAUDEXR_STATE_DIR || path.join(home, ".claudexr")), "local-token"), home),
  };
}

export function hookUrl(t: HookTargets, name: HookName): string {
  return `http://127.0.0.1:${t.port}/hook/${name}`;
}

/** The gated command for one hook (see header). */
export function gatedCommand(t: HookTargets, name: HookName, timeoutS: number): string {
  const m = Math.max(1, Math.floor(timeoutS) - 1);
  if (name === "voicewait") {
    // Long poll. Output (the framed spoken message) goes to stderr with exit code 2: that is what wakes the model.
    // Empty answer (new prompt, timeout, daemon gone) = exit 0 = nothing happens.
    return (
      `[ -f "${t.flagPath}" ] || exit 0; ` +
      `m=$(curl -sf -m ${Math.max(1, Math.floor(timeoutS) - 10)} -X POST ${hookUrl(t, name)} ` +
      `-H "Authorization: Bearer $(cat "${t.tokenPath}" 2>/dev/null)" ` +
      `-H "Content-Type: application/json" --data-binary @-) || exit 0; ` +
      `[ -n "$m" ] || exit 0; printf '%s\\n' "$m" >&2; exit 2`
    );
  }
  return (
    `[ -f "${t.flagPath}" ] || exit 0; ` +
    `curl -sf -m ${m} -X POST ${hookUrl(t, name)} ` +
    `-H "Authorization: Bearer $(cat "${t.tokenPath}" 2>/dev/null)" ` +
    `-H "Content-Type: application/json" --data-binary @- || exit 0`
  );
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

const URL_RE = /^https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/hook\/(context|activity|permission|voicewait)\/?$/;
const CMD_RE = /\bcurl\b[^\n]*127\.0\.0\.1:(\d+)\/hook\/(context|activity|permission|voicewait)\b/;

/**
 * Is this one of ours (an old ungated http hook, or a gated command from this or the earlier temp script)?
 * Only the daemon's own loopback port counts (default 47801, or --port): another tool's hook on some other port is
 * never claimed, so it can never be repointed at ClaudeXR.
 */
export function claudeXrHookName(h: unknown, ports: number[] = [DEFAULT_LOCAL_PORT]): HookName | null {
  if (!isObj(h)) return null;
  const m = h.type === "http" && typeof h.url === "string" ? URL_RE.exec(h.url) : h.type === "command" && typeof h.command === "string" ? CMD_RE.exec(h.command) : null;
  return m && ports.includes(Number(m[1])) ? (m[2] as HookName) : null;
}

/** Old command shims from claude-config/hooks/ (not touched, only reported). */
export function legacyShim(h: unknown): boolean {
  return isObj(h) && h.type === "command" && typeof h.command === "string" && /claude-config\/hooks\/xr-[\w-]+\.mjs/.test(h.command);
}

export interface PlanResult {
  settings: Json;
  changed: boolean;
  /** ungated http hooks replaced / old gated commands regenerated / duplicates removed / hooks added */
  stats: { converted: number; regenerated: number; removedDuplicates: number; added: number; shimsFound: number };
}

const defaultTimeout = (event: string, name: HookName) => HOOK_SPECS.find((s) => s.event === event && s.name === name)?.timeout ?? (name === "permission" ? 150 : name === "context" ? 3 : 2);

function canonical(t: HookTargets, event: string, name: HookName, old?: Json): Json {
  const to = old && typeof old.timeout === "number" && old.timeout > 0 ? old.timeout : defaultTimeout(event, name);
  const extra: Json = {};
  if (old) for (const [k, v] of Object.entries(old)) if (!["type", "command", "timeout", "url", "headers", "allowedEnvVars"].includes(k)) extra[k] = v;
  const spec = HOOK_SPECS.find((s) => s.event === event && s.name === name);
  return { type: "command", command: gatedCommand(t, name, to), timeout: to, ...extra, ...(spec?.asyncRewake ? { asyncRewake: true } : {}) };
}

/**
 * Pure function: settings in, settings out (the input is not modified).
 * Per event: ClaudeXR hooks are replaced IN PLACE (same group, same position, same timeout), a second ClaudeXR hook with
 * the same route in the same event is dropped (duplicate), and the ones that are missing are appended as one new group.
 * Everything that is not a ClaudeXR hook is left byte for byte as it was.
 */
export function planSettings(input: Json, t: HookTargets): PlanResult {
  const next = structuredClone(input);
  const ports = [...new Set([t.port, DEFAULT_LOCAL_PORT])];
  const nameOf = (h: unknown) => claudeXrHookName(h, ports);
  const stats = { converted: 0, regenerated: 0, removedDuplicates: 0, added: 0, shimsFound: 0 };
  if (next.hooks === undefined) next.hooks = {};
  if (!isObj(next.hooks)) throw new Error('"hooks" in settings.json is not an object');
  const hooks = next.hooks as Json;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) throw new Error(`hooks.${event} is not a list`);
    const seen = new Set<HookName>();
    const out: unknown[] = [];
    for (const g of groups) {
      if (!isObj(g) || !Array.isArray(g.hooks)) {
        out.push(g);
        continue;
      }
      const kept: unknown[] = [];
      let touched = false;
      for (const h of g.hooks) {
        if (legacyShim(h)) stats.shimsFound++;
        const name = nameOf(h);
        if (!name) {
          kept.push(h);
          continue;
        }
        touched = true;
        if (seen.has(name)) {
          stats.removedDuplicates++;
          continue;
        }
        seen.add(name);
        const c = canonical(t, event, name, h as Json);
        if ((h as Json).type === "http") stats.converted++;
        else if (JSON.stringify(c) !== JSON.stringify(h)) stats.regenerated++;
        kept.push(c);
      }
      if (touched && kept.length === 0) continue; // a group that held only duplicates
      out.push(touched ? { ...g, hooks: kept } : g);
    }
    hooks[event] = out;
  }
  const missingByEvent = new Map<string, HookSpec[]>();
  for (const s of HOOK_SPECS) {
    const has = Array.isArray(hooks[s.event]) && (hooks[s.event] as unknown[]).some((g) => isObj(g) && Array.isArray(g.hooks) && g.hooks.some((h) => nameOf(h) === s.name));
    if (!has) missingByEvent.set(s.event, [...(missingByEvent.get(s.event) ?? []), s]);
  }
  for (const [event, specs] of missingByEvent) {
    const list = (Array.isArray(hooks[event]) ? hooks[event] : (hooks[event] = [])) as unknown[];
    list.push({ hooks: specs.map((s) => canonical(t, event, s.name)) });
    stats.added += specs.length;
  }
  const changed = JSON.stringify(next) !== JSON.stringify(input);
  return { settings: next, changed, stats };
}

/** Only the hooks block as print-config shows it. */
export function hooksBlock(t: HookTargets): Json {
  return (planSettings({}, t).settings as Json) ?? {};
}

// ---------------- diff / masking ----------------

/** Bearer tokens in settings written by older print-config --inline-token runs must never reach the terminal. */
export function maskTokens(text: string): string {
  return text.replace(/(Bearer\s+)(?!\$)[A-Za-z0-9_.~+/=-]{16,}/g, "$1***");
}

/** Small unified line diff (3 lines of context). "" when equal. */
export function lineDiff(a: string, b: string, ctx = 3): string {
  const A = a.split("\n");
  const B = b.split("\n");
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const a2 = A.slice(pre, A.length - suf);
  const b2 = B.slice(pre, B.length - suf);
  if (!a2.length && !b2.length) return "";
  type Op = [" " | "-" | "+", string];
  const ops: Op[] = [];
  for (let i = 0; i < pre; i++) ops.push([" ", A[i]]);
  if (a2.length * b2.length > 25_000_000) {
    for (const l of a2) ops.push(["-", l]);
    for (const l of b2) ops.push(["+", l]);
  } else {
    const n = a2.length;
    const m = b2.length;
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a2[i] === b2[j]) (ops.push([" ", a2[i]]), i++, j++);
      else if (L[i + 1][j] >= L[i][j + 1]) ops.push(["-", a2[i++]]);
      else ops.push(["+", b2[j++]]);
    }
    while (i < n) ops.push(["-", a2[i++]]);
    while (j < m) ops.push(["+", b2[j++]]);
  }
  for (let i = A.length - suf; i < A.length; i++) ops.push([" ", A[i]]);
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach(([k], idx) => {
    if (k !== " ") for (let d = -ctx; d <= ctx; d++) if (ops[idx + d]) keep[idx + d] = true;
  });
  const out: string[] = [];
  let last = -2;
  ops.forEach(([k, line], idx) => {
    if (!keep[idx]) return;
    if (idx !== last + 1) out.push("@@");
    out.push(`${k} ${line}`);
    last = idx;
  });
  return out.join("\n");
}

// ---------------- CLI ----------------

export interface InstallOptions {
  settingsPath: string;
  dryRun: boolean;
  targets: HookTargets;
}

export function parseInstallArgs(args: string[]): InstallOptions | { error: string } {
  let settings = path.join(os.homedir(), ".claude", "settings.json");
  let dryRun = false;
  let port: number | undefined;
  let flagDir: string | undefined;
  let stateDir: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const val = () => args[++i] ?? "";
    if (a === "--dry-run") dryRun = true;
    else if (a === "--settings") settings = path.resolve(val());
    else if (a === "--port") port = Number(val());
    else if (a === "--flag-dir") flagDir = path.resolve(val());
    else if (a === "--state-dir") stateDir = path.resolve(val());
    else return { error: `okänt argument: ${a}` };
  }
  if (port !== undefined && !(port > 0 && port < 65536)) return { error: "ogiltig --port" };
  try {
    return { settingsPath: settings, dryRun, targets: defaultTargets({ port, flagDir, stateDir }) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function detectIndent(text: string): string | number {
  const m = /^\{\r?\n([ \t]+)\S/.exec(text);
  return m ? (m[1].includes("\t") ? "\t" : m[1].length) : 2;
}

/** `index.js install-hooks [--dry-run] [--settings <file>] ...`. Returns the process exit code. */
export function installHooksCli(args: string[], out: (s: string) => void = console.log): number {
  const o = parseInstallArgs(args);
  if ("error" in o) {
    out(`install-hooks: ${o.error}`);
    out("Användning: install-hooks [--dry-run] [--settings <fil>] [--port <n>] [--flag-dir <dir>] [--state-dir <dir>]");
    return 2;
  }
  let real = o.settingsPath;
  try {
    real = fs.realpathSync(o.settingsPath); // a symlinked dotfile must stay a symlink
  } catch {}
  let text = "";
  let exists = true;
  try {
    text = fs.readFileSync(real, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      out(`Kan inte läsa ${o.settingsPath}: ${(e as Error).message}`);
      return 1;
    }
    exists = false;
  }
  let parsed: Json = {};
  if (exists && text.trim()) {
    try {
      const v = JSON.parse(text);
      if (!isObj(v)) throw new Error("toppnivån är inte ett objekt");
      parsed = v;
    } catch (e) {
      out(`${o.settingsPath} är inte giltig JSON (${(e as Error).message}). Ingenting ändrat.`);
      return 1;
    }
  }
  let plan: PlanResult;
  try {
    plan = planSettings(parsed, o.targets);
  } catch (e) {
    out(`${o.settingsPath}: ${(e as Error).message}. Ingenting ändrat.`);
    return 1;
  }
  const s = plan.stats;
  out(`Inställningsfil: ${o.settingsPath}${exists ? "" : " (finns inte, skapas)"}`);
  out(`Flaggfil: ${o.targets.flagPath}   Tokenfil: ${o.targets.tokenPath} (innehållet visas aldrig)   Port: ${o.targets.port}`);
  if (s.shimsFound) out(`OBS: ${s.shimsFound} äldre kommandohook(ar) mot claude-config/hooks/xr-*.mjs finns kvar. De är inte gated och rörs inte; ta bort dem för hand.`);
  if (!plan.changed) {
    out("Redan uppdaterad: alla 11 hookar är gated command-hookar. Ingenting att göra.");
    return 0;
  }
  const indent = exists ? detectIndent(text) : 2;
  const before = JSON.stringify(parsed, null, indent);
  const afterText = JSON.stringify(plan.settings, null, indent);
  out(`Ändringar: ${s.converted} http-hook(ar) ersatta, ${s.regenerated} command-hook(ar) uppdaterade, ${s.removedDuplicates} dubblett(er) borttagna, ${s.added} hook(ar) tillagda.`);
  out(maskTokens(lineDiff(before, afterText)));
  if (o.dryRun) {
    out("\n--dry-run: ingenting skrevs (ingen backup, ingen ändring).");
    return 0;
  }
  let backup = "";
  if (exists) {
    backup = `${o.settingsPath}.bak-claudexr-${stamp()}`;
    for (let n = 2; fs.existsSync(backup); n++) backup = `${o.settingsPath}.bak-claudexr-${stamp()}-${n}`;
    fs.copyFileSync(real, backup, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(backup, 0o600);
    out(`\nBackup: ${backup}`);
  }
  const mode = exists ? fs.statSync(real).mode & 0o777 : 0o600;
  fs.mkdirSync(path.dirname(real), { recursive: true });
  const tmp = path.join(path.dirname(real), `.${path.basename(real)}.tmp-claudexr-${process.pid}`);
  fs.writeFileSync(tmp, afterText + "\n", { mode });
  fs.renameSync(tmp, real);
  out(`Skrev ${o.settingsPath}.`);
  // The token file is only inspected (never read): it must exist and be 0600.
  const tokenFile = o.targets.tokenPath.replace(/^\$HOME/, os.homedir());
  try {
    const st = fs.statSync(tokenFile);
    if ((st.mode & 0o777) !== 0o600) {
      fs.chmodSync(tokenFile, 0o600);
      out(`Tokenfilen hade behörighet ${(st.mode & 0o777).toString(8)}: satt till 600.`);
    }
  } catch {
    out(`OBS: tokenfilen ${o.targets.tokenPath} finns inte än. Starta daemonen en gång (den skapar filen). Hookarna gör inget förrän den finns.`);
  }
  out("Starta om öppna Claude Code-sessioner så att de läser de nya hookarna.");
  if (backup) out(`Ångra: cp '${backup}' '${o.settingsPath}'`);
  return 0;
}
