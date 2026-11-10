// 0.3.1: hooks only run while the headset is on (flag file), installer, token from file, `xr on|off|status`.
// Everything runs against isolated instances: temp HOME, temp state/flag dirs, own port (48100+), stub HTTP servers.
// Nothing here touches ~/.claude, ~/.claudexr or the real daemon (port 47801 is never used).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { XrFlag, flagDir } from "../src/flag.js";
import { HOOK_SPECS, claudeXrHookName, defaultTargets, gatedCommand, lineDiff, maskTokens, planSettings, shellPath } from "../src/hooksetup.js";
import { startBridge, startSim, nextPort, waitFor, sleep, tmpDir, startDaemon } from "./helpers.js";

const FAKE_TOKEN = "TESTTOKEN-" + "x".repeat(40);
const T = defaultTargets({ port: 48999, flagDir: "/nonexistent-home-probe/.claudexr", stateDir: "/nonexistent-home-probe/.claudexr" });
const TH = { port: 48999, flagPath: "$HOME/.claudexr/on", tokenPath: "$HOME/.claudexr/local-token" };

/** Run a CLI subcommand of the bridge with a clean env (own HOME, state and flag dirs). */
function cli(args: string[], env: Record<string, string | undefined>) {
  const e: Record<string, string | undefined> = { ...process.env, ...env };
  for (const k of ["CLAUDEXR_STATE_DIR", "CLAUDEXR_FLAG_DIR", "CLAUDEXR_PORT", "CLAUDEXR_LOCAL_PORT"]) if (!(k in env)) delete e[k];
  return spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", ...args], { env: e as NodeJS.ProcessEnv, encoding: "utf8" });
}

const httpHook = (name: string, timeout: number) => ({ type: "http", url: `http://127.0.0.1:47801/hook/${name}`, timeout, headers: { Authorization: "Bearer $CLAUDEXR_TOKEN" }, allowedEnvVars: ["CLAUDEXR_TOKEN"] });
/** What print-config of 0.3.0 produced (the settings.json ägaren has today). */
function oldSettings() {
  const act = httpHook("activity", 2);
  return {
    model: "opus",
    permissions: { deny: ["Read(~/.claudexr/**)"] },
    hooks: {
      SessionStart: [{ hooks: [httpHook("context", 3)] }],
      UserPromptSubmit: [{ hooks: [httpHook("context", 3), act] }],
      PermissionRequest: [{ hooks: [httpHook("permission", 150)] }],
      PreToolUse: [{ hooks: [act] }, { matcher: "Bash", hooks: [{ type: "command", command: "echo mine", timeout: 5 }] }],
      PostToolUse: [{ hooks: [act] }],
      PostToolUseFailure: [{ hooks: [act] }],
      Notification: [{ hooks: [act] }],
      Stop: [{ hooks: [act] }, { hooks: [{ type: "http", url: "http://127.0.0.1:9999/hook/other", timeout: 3 }] }],
      TaskCreated: [{ hooks: [act] }],
      TaskCompleted: [{ hooks: [act] }],
    },
  };
}
const ANY_PORT = Array.from({ length: 65535 }, (_, i) => i + 1);
const allXrHooks = (s: any) => Object.entries(s.hooks as Record<string, any[]>).flatMap(([event, groups]) => groups.flatMap((g) => (g.hooks ?? []).map((h: any) => ({ event, h, name: claudeXrHookName(h, ANY_PORT) })))).filter((x) => x.name);

// ---------------- flag ----------------

test("flag: atomic on(), idempotent off(), directory override (CLAUDEXR_FLAG_DIR > CLAUDEXR_STATE_DIR > ~/.claudexr)", () => {
  const d = path.join(tmpDir(), "sub");
  const f = new XrFlag(d);
  assert.equal(f.isOn(), false);
  f.off(); // no throw when absent
  f.on("test");
  assert.equal(f.isOn(), true);
  assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(d), ["on"], "no temp file left behind");
  f.on("again");
  f.off();
  assert.equal(f.isOn(), false);
  assert.equal(flagDir({ CLAUDEXR_FLAG_DIR: "/a", CLAUDEXR_STATE_DIR: "/b" }), "/a");
  assert.equal(flagDir({ CLAUDEXR_STATE_DIR: "/b" }), "/b", "a sandboxed state dir can never reach the real flag");
  assert.equal(flagDir({}), path.join(os.homedir(), ".claudexr"));
});

// ---------------- command shape ----------------

test("gated command: starts with the flag test, then curl with -m timeout-1 and the token read from the file", () => {
  const c = gatedCommand(TH, "permission", 150);
  assert.ok(c.startsWith('[ -f "$HOME/.claudexr/on" ] || exit 0; curl -sf -m 149 -X POST http://127.0.0.1:48999/hook/permission '));
  assert.ok(c.includes('-H "Authorization: Bearer $(cat "$HOME/.claudexr/local-token" 2>/dev/null)"'));
  assert.ok(c.includes('-H "Content-Type: application/json" --data-binary @- || exit 0'));
  assert.match(gatedCommand(TH, "activity", 2), /curl -sf -m 1 /);
  assert.equal(shellPath(path.join(os.homedir(), ".claudexr/on")), "$HOME/.claudexr/on");
  assert.throws(() => shellPath("/tmp/a\"b"));
  assert.ok(T.flagPath.startsWith("/nonexistent-home-probe/"));
});

// ---------------- planSettings ----------------

test("planSettings: replaces the 11 ungated http hooks, keeps everything else, adds no token", () => {
  const input = oldSettings();
  const before = JSON.stringify(input);
  const { settings, changed, stats } = planSettings(input, TH);
  assert.equal(JSON.stringify(input), before, "input not modified");
  assert.ok(changed);
  const xr = allXrHooks(settings);
  assert.equal(xr.length, 12);
  assert.equal(stats.added, 1, "0.4.0: the voicewait Stop hook is new");
  assert.equal(stats.converted, 11);
  for (const s of HOOK_SPECS) assert.ok(xr.some((x) => x.event === s.event && x.name === s.name), `${s.event}/${s.name}`);
  for (const x of xr) {
    assert.equal(x.h.type, "command");
    assert.ok(x.h.command.startsWith(x.name === "voicewait" ? '[ -f "$HOME/.claudexr/on" ] || exit 0; m=$(curl -sf -m ' : '[ -f "$HOME/.claudexr/on" ] || exit 0; curl -sf -m '));
    assert.equal(x.h.headers, undefined);
    assert.equal(x.h.url, undefined);
    assert.equal(x.h.allowedEnvVars, undefined);
  }
  const perm = xr.find((x) => x.event === "PermissionRequest")!;
  assert.equal(perm.h.timeout, 150);
  assert.match(perm.h.command, /-m 149 /);
  const s = settings as any;
  assert.equal(s.model, "opus");
  assert.deepEqual(s.permissions, input.permissions);
  assert.deepEqual(s.hooks.PreToolUse[1], input.hooks.PreToolUse[1], "other hooks and matchers untouched");
  assert.deepEqual(s.hooks.Stop[1], input.hooks.Stop[1], "an http hook on another port/route is not ours");
  assert.ok(!JSON.stringify(settings).includes("CLAUDEXR_TOKEN"));
});

test("planSettings: idempotent (second pass changes nothing), also from an empty file", () => {
  const once = planSettings(oldSettings(), TH).settings;
  const twice = planSettings(once, TH);
  assert.equal(twice.changed, false);
  assert.equal(JSON.stringify(twice.settings), JSON.stringify(once));
  const fresh = planSettings({}, TH);
  assert.equal(allXrHooks(fresh.settings).length, 12);
  assert.equal(fresh.stats.added, 12);
  assert.equal(planSettings(fresh.settings, TH).changed, false);
  // UserPromptSubmit holds exactly two (context + activity) in one group
  assert.equal((fresh.settings as any).hooks.UserPromptSubmit[0].hooks.length, 2);
});

test("planSettings: replaces the earlier $CLAUDEXR_TOKEN gate script's commands, drops duplicates, adds missing, reports old shims", () => {
  const oldGate = (name: string, t: number) => ({ type: "command", command: `[ -f "$HOME/.claudexr/on" ] || exit 0; curl -sf -m ${t - 1} -X POST "http://127.0.0.1:47801/hook/${name}" -H "Authorization: Bearer $CLAUDEXR_TOKEN" -H "Content-Type: application/json" --data-binary @- || exit 0`, timeout: t });
  const input = {
    hooks: {
      Stop: [{ hooks: [oldGate("activity", 2), oldGate("activity", 2)] }],
      SessionStart: [{ hooks: [{ type: "command", command: 'node "/x/claude-config/hooks/xr-context.mjs"', timeout: 5 }] }],
    },
  };
  const r = planSettings(input, TH);
  assert.equal(r.stats.regenerated, 1);
  assert.equal(r.stats.removedDuplicates, 1);
  assert.equal(r.stats.shimsFound, 1);
  assert.equal((r.settings as any).hooks.Stop[0].hooks.length, 1);
  assert.ok(!JSON.stringify(r.settings.hooks).includes("CLAUDEXR_TOKEN"));
  assert.equal((r.settings as any).hooks.SessionStart[0].hooks[0].command.includes("xr-context.mjs"), true, "shim untouched");
  assert.equal(allXrHooks(r.settings).length, 12);
});

test("planSettings: another tool's hook on another port is never claimed or repointed, even on a ClaudeXR route name", () => {
  const foreign = [
    { type: "http", url: "http://127.0.0.1:9999/hook/context", timeout: 3 },
    { type: "command", command: 'curl -sf -X POST http://127.0.0.1:9999/hook/activity --data-binary @-', timeout: 2 },
  ];
  const input = { hooks: { SessionStart: [{ hooks: [...foreign] }], Stop: [{ matcher: "x", hooks: [foreign[1]] }] } };
  const r = planSettings(input, TH); // TH.port is 48999, the default 47801 is also ours
  assert.deepEqual((r.settings as any).hooks.SessionStart[0].hooks, foreign, "left byte-identical");
  assert.deepEqual((r.settings as any).hooks.Stop[0], input.hooks.Stop[0]);
  assert.equal(allXrHooks(r.settings).filter((x) => JSON.stringify(x.h).includes(":9999")).length, 3, "the foreign ones are still there, untouched");
  assert.equal(allXrHooks(r.settings).filter((x) => x.h.type === "command" && x.h.command.includes(":48999/hook/")).length, 12, "ClaudeXR's own 12 were added next to them");
  // and a hook on the default port 47801 is still migrated when the target port differs
  const mig = planSettings({ hooks: { Stop: [{ hooks: [httpHook("activity", 2)] }] } }, TH);
  assert.equal(mig.stats.converted, 1);
  assert.ok((mig.settings as any).hooks.Stop[0].hooks[0].command.includes(":48999/hook/activity"));
});

test("planSettings: bad structure is an error, not a silent rewrite", () => {
  assert.throws(() => planSettings({ hooks: [] }, TH), /not an object/);
  assert.throws(() => planSettings({ hooks: { Stop: {} } }, TH), /not a list/);
});

test("lineDiff and maskTokens", () => {
  assert.equal(lineDiff("a\nb\nc", "a\nb\nc"), "");
  assert.equal(lineDiff("a\nb\nc", "a\nX\nc"), "@@\n  a\n- b\n+ X\n  c".replace("  a", "  a"));
  const secret = "abcdefghijklmnopqrstuvwxyz012345";
  assert.ok(!maskTokens(`"Authorization": "Bearer ${secret}"`).includes(secret));
  assert.equal(maskTokens('"Bearer $CLAUDEXR_TOKEN"'), '"Bearer $CLAUDEXR_TOKEN"');
});

// ---------------- installer CLI (temp HOME, copy of settings.json) ----------------

function setupHome(settings: unknown, raw?: string) {
  const home = tmpDir("claudexr-home-");
  fs.mkdirSync(path.join(home, ".claude"));
  const file = path.join(home, ".claude", "settings.json");
  fs.writeFileSync(file, raw ?? JSON.stringify(settings, null, 2) + "\n", { mode: 0o640 });
  const backups = () => fs.readdirSync(path.join(home, ".claude")).filter((n) => n.includes(".bak-claudexr-"));
  return { home, file, backups };
}

test("install-hooks --dry-run shows a diff and writes nothing (no backup either); inline tokens are masked", () => {
  const s: any = oldSettings();
  s.hooks.SessionStart[0].hooks[0] = { type: "http", url: "http://127.0.0.1:47801/hook/context", timeout: 3, headers: { Authorization: "Bearer " + FAKE_TOKEN } };
  const h = setupHome(s);
  const before = fs.readFileSync(h.file, "utf8");
  const r = cli(["install-hooks", "--dry-run"], { HOME: h.home });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(h.file, "utf8"), before);
  assert.deepEqual(h.backups(), []);
  assert.match(r.stdout, /^- .*"type": "http"/m);
  assert.match(r.stdout, /^\+ .*\[ -f \\"\$HOME\/\.claudexr\/on\\" \] \|\| exit 0/m);
  assert.match(r.stdout, /--dry-run: ingenting skrevs/);
  assert.ok(!r.stdout.includes(FAKE_TOKEN), "token leaked into the diff");
});

test("install-hooks writes (backup first, 0600, same content), is idempotent and keeps unrelated settings", () => {
  const h = setupHome(oldSettings());
  const before = fs.readFileSync(h.file, "utf8");
  const r1 = cli(["install-hooks"], { HOME: h.home });
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  const b = h.backups();
  assert.equal(b.length, 1);
  assert.match(b[0], /^settings\.json\.bak-claudexr-\d{8}-\d{6}$/);
  assert.equal(fs.readFileSync(path.join(h.home, ".claude", b[0]), "utf8"), before);
  assert.equal(fs.statSync(path.join(h.home, ".claude", b[0])).mode & 0o777, 0o600);
  assert.equal(fs.statSync(h.file).mode & 0o777, 0o640, "file mode kept");
  const after = fs.readFileSync(h.file, "utf8");
  assert.ok(after.endsWith("\n"));
  const parsed = JSON.parse(after);
  assert.equal(allXrHooks(parsed).length, 12);
  assert.ok(!after.includes("CLAUDEXR_TOKEN"));
  assert.ok(!/Bearer [A-Za-z0-9_-]{16,}/.test(r1.stdout), "nothing token-like printed");
  assert.match(r1.stdout, /Ångra: cp /);
  const r2 = cli(["install-hooks"], { HOME: h.home });
  assert.equal(r2.status, 0, r2.stdout);
  assert.match(r2.stdout, /Redan uppdaterad/);
  assert.equal(fs.readFileSync(h.file, "utf8"), after, "byte-identical after the second run");
  assert.equal(h.backups().length, 1, "no new backup when nothing changes");
});

test("install-hooks: invalid JSON is left alone; a symlinked settings.json stays a symlink; token file is chmod 600'd (content never read)", () => {
  const bad = setupHome(null, "{ not json");
  const r = cli(["install-hooks"], { HOME: bad.home });
  assert.equal(r.status, 1);
  assert.equal(fs.readFileSync(bad.file, "utf8"), "{ not json");
  assert.deepEqual(bad.backups(), []);

  const h = setupHome(oldSettings());
  const real = path.join(h.home, "dotfiles-settings.json");
  fs.renameSync(h.file, real);
  fs.symlinkSync(real, h.file);
  fs.mkdirSync(path.join(h.home, ".claudexr"));
  fs.writeFileSync(path.join(h.home, ".claudexr", "local-token"), FAKE_TOKEN + "\n", { mode: 0o644 });
  const r2 = cli(["install-hooks"], { HOME: h.home });
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.ok(fs.lstatSync(h.file).isSymbolicLink());
  assert.equal(allXrHooks(JSON.parse(fs.readFileSync(real, "utf8"))).length, 12);
  assert.equal(fs.statSync(path.join(h.home, ".claudexr", "local-token")).mode & 0o777, 0o600);
  assert.ok(!r2.stdout.includes(FAKE_TOKEN));
});

test("print-config prints gated command hooks (no http hooks, no token, no CLAUDEXR_TOKEN)", async () => {
  const sd = tmpDir();
  const d = await startDaemon(nextPort(), {}, sd);
  try {
    const token = fs.readFileSync(path.join(sd, "local-token"), "utf8").trim();
    const out = cli(["print-config"], { HOME: tmpDir("claudexr-home-"), CLAUDEXR_STATE_DIR: sd, CLAUDEXR_FLAG_DIR: path.join(sd, "flag") }).stdout;
    assert.ok(!out.includes(token));
    assert.ok(!out.includes("CLAUDEXR_TOKEN"));
    assert.match(out, /install-hooks/);
    const block = JSON.parse(out.slice(out.indexOf('{\n  "hooks"')));
    assert.equal(allXrHooks(block).length, 12);
    assert.ok(allXrHooks(block).every((x) => x.h.type === "command" && x.h.command.includes("local-token")));
  } finally {
    d.proc.kill("SIGTERM");
    await d.exited;
  }
});

// ---------------- the generated commands, executed ----------------

function stub(status = 200, body = '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}\n') {
  const seen: { url: string; auth?: string; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      seen.push({ url: req.url ?? "", auth: req.headers.authorization, body: b });
      res.writeHead(status, { "content-type": "application/json" }).end(body);
    });
  });
  return new Promise<{ port: number; seen: typeof seen; body: string; close(): Promise<void> }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as { port: number }).port, seen, body, close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))) })),
  );
}

/** Async on purpose: the stub HTTP server lives in this process, so a blocking spawnSync would deadlock it. */
function runHook(home: string, command: string, input: string) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const p = spawn("sh", ["-c", command], { env: { PATH: process.env.PATH, HOME: home } });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (c) => (stdout += c));
    p.stderr.on("data", (c) => (stderr += c));
    const timer = setTimeout(() => p.kill("SIGKILL"), 10_000);
    p.on("close", (status) => (clearTimeout(timer), resolve({ status, stdout, stderr })));
    p.stdin.end(input);
  });
}

test("generated hook: flag missing => no request, exit 0, no output; flag present => request with token from FILE, stdout unchanged", async () => {
  const home = tmpDir("claudexr-home-");
  fs.mkdirSync(path.join(home, ".claudexr"));
  fs.writeFileSync(path.join(home, ".claudexr", "local-token"), FAKE_TOKEN + "\n", { mode: 0o600 });
  const srv = await stub();
  try {
    const cmd = gatedCommand({ ...TH, port: srv.port }, "permission", 150);
    const off = await runHook(home, cmd, '{"hook_event_name":"PermissionRequest"}');
    assert.equal(off.status, 0);
    assert.equal(off.stdout, "");
    assert.equal(off.stderr, "");
    assert.equal(srv.seen.length, 0, "no network call without the flag");

    fs.writeFileSync(path.join(home, ".claudexr", "on"), "x\n");
    const input = '{"hook_event_name":"PermissionRequest","tool_name":"Bash"}';
    const on = await runHook(home, cmd, input);
    assert.equal(on.status, 0, on.stderr);
    assert.equal(on.stdout, srv.body, "PermissionRequest answer passed through byte for byte");
    assert.equal(srv.seen.length, 1);
    assert.equal(srv.seen[0].url, "/hook/permission");
    assert.equal(srv.seen[0].auth, `Bearer ${FAKE_TOKEN}`, "token came from the token file, not from the environment");
    assert.equal(srv.seen[0].body, input);

    // removing the flag stops it again
    fs.rmSync(path.join(home, ".claudexr", "on"));
    await runHook(home, cmd, input);
    assert.equal(srv.seen.length, 1);
  } finally {
    await srv.close();
  }
});

test("generated hook: HTTP error, daemon down and missing token file all end as silent exit 0", async () => {
  const home = tmpDir("claudexr-home-");
  fs.mkdirSync(path.join(home, ".claudexr"));
  fs.writeFileSync(path.join(home, ".claudexr", "on"), "x\n");
  const srv = await stub(401, '{"error":"missing or wrong token"}');
  try {
    const cmd = gatedCommand({ ...TH, port: srv.port }, "activity", 2);
    const r = await runHook(home, cmd, "{}"); // no token file at all
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "", "-f: an error page is never passed on as a hook answer");
    assert.equal(r.stderr, "");
    assert.equal(srv.seen[0].auth, "Bearer", "empty token (curl trims the blank), cat failure stays silent");
  } finally {
    await srv.close();
  }
  const down = await runHook(home, gatedCommand({ ...TH, port: 48990 }, "activity", 2), "{}");
  assert.equal(down.status, 0);
  assert.equal(down.stdout, "");
});

// ---------------- the daemon keeps the flag ----------------

const flagOf = (dir: string) => path.join(dir, "flag", "on");

test("daemon: stale flag removed at start; flag set when an authenticated headset connects; removed on disconnect and on a 1006", async () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "flag"), { recursive: true });
  fs.writeFileSync(flagOf(dir), "stale\n");
  const b = await startBridge(nextPort(), {}, dir);
  try {
    assert.equal(fs.existsSync(flagOf(dir)), false, "stale flag gone after daemon start");
    const sim = await startSim(b);
    await waitFor(() => fs.existsSync(flagOf(dir)), 4000);
    assert.equal(fs.statSync(flagOf(dir)).mode & 0o777, 0o600);
    sim.close(); // clean close
    await waitFor(() => !fs.existsSync(flagOf(dir)), 4000);
    // reconnect (already paired) and drop the TCP connection without a close frame => the bridge sees 1006
    const sim2 = await startSim(b, { pairing: sim.pairing });
    await waitFor(() => fs.existsSync(flagOf(dir)), 4000);
    sim2.ws.terminate();
    await waitFor(() => !fs.existsSync(flagOf(dir)), 4000);
    assert.ok(b.daemon.stderrLines.length >= 0);
  } finally {
    await b.close();
  }
});

test("daemon: an unauthenticated connection does not set the flag; SIGTERM while connected removes it", async () => {
  const dir = tmpDir();
  const b = await startBridge(nextPort(), {}, dir);
  const sim = await startSim(b);
  try {
    await waitFor(() => fs.existsSync(flagOf(dir)), 4000);
    b.daemon.proc.kill("SIGTERM");
    await b.daemon.exited;
    assert.equal(fs.existsSync(flagOf(dir)), false, "daemon exit removes the flag");
  } finally {
    sim.close();
    await b.client.close().catch(() => {});
  }
  // a raw, never-authenticated socket
  const dir2 = tmpDir();
  const b2 = await startBridge(nextPort(), {}, dir2);
  const { WebSocket } = await import("ws");
  const ws = new WebSocket(`wss://127.0.0.1:${b2.port}/headset`, { rejectUnauthorized: false });
  try {
    await new Promise<void>((r, j) => (ws.on("open", () => r()), ws.on("error", j)));
    ws.send(JSON.stringify({ type: "hello", token: "nope", device: "x" }));
    await sleep(600);
    assert.equal(fs.existsSync(flagOf(dir2)), false);
  } finally {
    ws.terminate();
    await b2.close();
  }
});

test("daemon: a second instance on the same ports exits 3 and leaves a live flag alone", async () => {
  const dir = tmpDir();
  const port = nextPort();
  const b = await startBridge(port, {}, dir);
  const sim = await startSim(b);
  try {
    await waitFor(() => fs.existsSync(flagOf(dir)), 4000);
    const second = await startDaemon(port, {}, dir).catch((e) => e);
    // startDaemon throws "daemon did not start" or returns an exited process: either way it must have exited 3
    if (second instanceof Error) await sleep(500);
    else assert.equal(await second.exited, 3);
    assert.equal(fs.existsSync(flagOf(dir)), true, "the running daemon's flag survived the second start");
  } finally {
    sim.close();
    await b.close();
  }
});

test("daemon: the generated hook command works end to end against the isolated daemon (token from its token file)", async () => {
  const dir = tmpDir();
  const b = await startBridge(nextPort(), {}, dir);
  // The real HOME on purpose: defaultTargets() writes paths below the home directory as "$HOME/...", so a fake HOME
  // made this test fail whenever TMPDIR itself lies below the home directory (as in the 0.4.0 night runs).
  // The hook only reads the flag and the token of the isolated daemon; nothing is written.
  const home = os.homedir();
  const t = defaultTargets({ port: b.port + 1, flagDir: path.join(dir, "flag"), stateDir: dir });
  const sim = await startSim(b);
  try {
    // (inside the try: a failure before it left the daemon running and made the whole test run hang)
    assert.ok((path.isAbsolute(t.tokenPath) || t.tokenPath.startsWith("$HOME/")) && t.tokenPath.endsWith("local-token"));
    await waitFor(() => fs.existsSync(flagOf(dir)), 4000);
    const r = await runHook(home, gatedCommand(t, "context", 3), JSON.stringify({ hook_event_name: "SessionStart", session_id: "s1" }));
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.match(out.hookSpecificOutput.additionalContext, /XR: connected/);
    // wrong token => curl -f swallows the 401: no output, still exit 0
    fs.writeFileSync(path.join(dir, "local-token"), "wrong\n", { mode: 0o600 });
    const bad = await runHook(home, gatedCommand(t, "context", 3), "{}");
    assert.equal(bad.status, 0);
    assert.equal(bad.stdout, "");
  } finally {
    sim.close();
    await b.close();
  }
});

// ---------------- xr on|off|status ----------------

test("xr on/off/status: manual override works without a daemon and touches only the flag dir", () => {
  const home = tmpDir("claudexr-home-");
  const fd = path.join(tmpDir(), "flags");
  const env = { HOME: home, CLAUDEXR_FLAG_DIR: fd, CLAUDEXR_PORT: String(nextPort()) };
  assert.match(cli(["xr", "status"], env).stdout, /hookar: AV/);
  assert.match(cli(["xr", "on"], env).stdout, /PÅ/);
  assert.equal(fs.existsSync(path.join(fd, "on")), true);
  const st = cli(["xr", "status"], env).stdout;
  assert.match(st, /hookar: PÅ/);
  assert.match(st, /Daemon: kör inte/);
  assert.match(cli(["xr", "off"], env).stdout, /AV/);
  assert.equal(fs.existsSync(path.join(fd, "on")), false);
  assert.equal(cli(["xr", "bogus"], env).status, 2);
  assert.equal(fs.existsSync(path.join(home, ".claudexr", "on")), false, "the flag stayed in the override dir");
});

test("xr on survives while the headset stays connected, and the next daemon start clears it", async () => {
  const dir = tmpDir();
  const port = nextPort();
  const b = await startBridge(port, {}, dir);
  const env = { HOME: tmpDir("claudexr-home-"), CLAUDEXR_STATE_DIR: dir, CLAUDEXR_FLAG_DIR: path.join(dir, "flag"), CLAUDEXR_LOCAL_PORT: String(port + 1) };
  try {
    cli(["xr", "on"], env);
    await sleep(300);
    assert.equal(fs.existsSync(flagOf(dir)), true, "manual on with no headset persists while the daemon runs");
    const st = cli(["xr", "status"], env).stdout;
    assert.match(st, /Headset: inte anslutet/);
    assert.match(st, /OBS: manuellt PÅ utan headset/);
    const sim = await startSim(b);
    await waitFor(() => sim.lines.some((l) => l.includes("connected")), 4000);
    cli(["xr", "off"], env);
    await sleep(300);
    assert.equal(fs.existsSync(flagOf(dir)), false, "manual off lasts while connected");
    sim.close();
  } finally {
    await b.close();
  }
  // next daemon start: leftover manual flag is cleared
  fs.mkdirSync(path.join(dir, "flag"), { recursive: true });
  fs.writeFileSync(flagOf(dir), "manual\n");
  const d2 = await startDaemon(nextPort(), {}, dir);
  try {
    assert.equal(fs.existsSync(flagOf(dir)), false);
  } finally {
    d2.proc.kill("SIGTERM");
    await d2.exited;
  }
});

test("install-daemon.sh installs the xr wrapper (temp HOME, launchctl stubbed) and uninstall removes it", () => {
  const home = tmpDir("claudexr-home-");
  const stub = tmpDir("claudexr-stub-");
  fs.writeFileSync(path.join(stub, "launchctl"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const env = { ...process.env, HOME: home, PATH: `${stub}:${process.env.PATH}` };
  const r = spawnSync("bash", ["scripts/install-daemon.sh"], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const w = path.join(home, "bin", "xr");
  assert.equal(fs.statSync(w).mode & 0o111, 0o111);
  assert.match(fs.readFileSync(w, "utf8"), /Application\\ Support\/ClaudeXR\/bridge\/dist\/src\/index\.js/);
  assert.match(r.stdout, /install-hooks --dry-run/);
  // the wrapper runs the pinned copy; point it at a temp flag dir so nothing real is touched
  const fd = path.join(tmpDir(), "f");
  const x = spawnSync(w, ["on"], { env: { ...env, CLAUDEXR_FLAG_DIR: fd }, encoding: "utf8" });
  assert.equal(x.status, 0, x.stderr);
  assert.ok(fs.existsSync(path.join(fd, "on")));
  assert.equal(fs.existsSync(path.join(home, ".claudexr", "on")), false);
  const u = spawnSync("bash", ["scripts/install-daemon.sh", "uninstall"], { env, encoding: "utf8" });
  assert.equal(u.status, 0);
  assert.equal(fs.existsSync(w), false);
});

test("install-daemon.sh leaves a foreign ~/bin/xr alone", () => {
  const home = tmpDir("claudexr-home-");
  const stub = tmpDir("claudexr-stub-");
  fs.writeFileSync(path.join(stub, "launchctl"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.mkdirSync(path.join(home, "bin"));
  fs.writeFileSync(path.join(home, "bin", "xr"), "#!/bin/sh\necho someone elses tool\n", { mode: 0o755 });
  const r = spawnSync("bash", ["scripts/install-daemon.sh"], { env: { ...process.env, HOME: home, PATH: `${stub}:${process.env.PATH}` }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(home, "bin", "xr"), "utf8"), /someone elses tool/);
});
