// Review 2 / R2-03: launchd PATH and "~" in config paths (README's own example used "~/.claudexr/models/...").
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expandHome, loadConfig, resolveBin } from "../src/config.js";
import { tmpDir } from "./helpers.js";

test("~ is expanded in config paths and bare tool names are found outside launchd's PATH", () => {
  assert.equal(expandHome("~/.claudexr/models/ggml-base.bin"), path.join(os.homedir(), ".claudexr/models/ggml-base.bin"));
  assert.equal(expandHome("/abs/x"), "/abs/x");
  const dir = tmpDir();
  const bin = path.join(dir, "whisper-cli");
  fs.writeFileSync(bin, "#!/bin/sh\n", { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = "/usr/bin:/bin"; // what launchd gives an agent
  try {
    assert.equal(resolveBin("whisper-cli", [dir]), bin);
    assert.equal(resolveBin("does-not-exist", [dir]), "does-not-exist");
  } finally {
    process.env.PATH = saved;
  }
  const sd = tmpDir();
  fs.writeFileSync(path.join(sd, "config.json"), JSON.stringify({ voice: { whisperModel: "~/m.bin" } }));
  const savedSd = process.env.CLAUDEXR_STATE_DIR;
  process.env.CLAUDEXR_STATE_DIR = sd;
  try {
    assert.equal(loadConfig().voice.whisperModel, path.join(os.homedir(), "m.bin"));
  } finally {
    if (savedSd === undefined) delete process.env.CLAUDEXR_STATE_DIR;
    else process.env.CLAUDEXR_STATE_DIR = savedSd;
  }
});

test("install-daemon.sh writes a valid plist with PATH, private log and a pinned copy (launchctl stubbed)", () => {
  const home = tmpDir("claudexr-home-");
  const stub = tmpDir("claudexr-stub-");
  fs.writeFileSync(path.join(stub, "launchctl"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const r = spawnSync("bash", ["scripts/install-daemon.sh"], { env: { ...process.env, HOME: home, PATH: `${stub}:${process.env.PATH}` }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const plist = fs.readFileSync(path.join(home, "Library/LaunchAgents/com.claudexr.bridge.plist"), "utf8");
  const py = spawnSync("python3", ["-c", "import plistlib,sys,json;print(json.dumps(plistlib.loads(sys.stdin.buffer.read())))"], { input: plist, encoding: "utf8" });
  assert.equal(py.status, 0, py.stderr);
  const p = JSON.parse(py.stdout);
  assert.match(p.ProgramArguments[1], /Library\/Application Support\/ClaudeXR\/bridge\/dist\/src\/index\.js$/);
  assert.ok(fs.existsSync(p.ProgramArguments[1]), "pinned copy exists");
  assert.match(p.EnvironmentVariables.PATH, /\/opt\/homebrew\/bin/);
  assert.match(p.StandardErrorPath, /Library\/Logs\/ClaudeXR\/bridge\.log$/);
  assert.equal(p.Umask, 63);
  const u = spawnSync("bash", ["scripts/install-daemon.sh", "uninstall"], { env: { ...process.env, HOME: home, PATH: `${stub}:${process.env.PATH}` }, encoding: "utf8" });
  assert.equal(u.status, 0);
  assert.ok(!fs.existsSync(path.join(home, "Library/Application Support/ClaudeXR/bridge")));
});
