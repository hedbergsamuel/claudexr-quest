// 0.4.1 punkt 8: konfigurerbart verktyg för headsetet (adb | metavr | hzdb). Bara argumentlistor och utskrift:
// testerna kör aldrig adb/metavr/hzdb, och modulen startar inga processer.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { deviceCommand, parseDeviceTool, shellLine, DEVICE_ACTIONS, DEVICE_TOOLS } from "../src/devicetool.js";
import { tmpDir } from "./helpers.js";

test("adb: samma kommandon som README hittills", () => {
  assert.deepEqual(deviceCommand("adb", "install").argv, ["adb", "install", "-r", "app/build/outputs/apk/debug/app-debug.apk"]);
  assert.deepEqual(deviceCommand("adb", "reverse").argv, ["adb", "reverse", "tcp:47800", "tcp:47800"]);
  assert.deepEqual(deviceCommand("adb", "launch-wired").argv, ["adb", "shell", "am", "start", "-n", "com.claudexr.quest/.MainActivity", "--es", "bridge_url", "wss://127.0.0.1:47800/headset"]);
  assert.deepEqual(deviceCommand("adb", "launch").argv, ["adb", "shell", "am", "start", "-n", "com.claudexr.quest/.MainActivity"]);
  for (const a of DEVICE_ACTIONS) assert.equal(deviceCommand("adb", a).confirmed, true);
});

test("metavr/hzdb: dokumenterade kommandon bekräftade, reverse markerat OBEKRÄFTAT", () => {
  for (const t of ["metavr", "hzdb"] as const) {
    assert.deepEqual(deviceCommand(t, "install", { apk: "x.apk" }).argv, [t, "app", "install", "-r", "x.apk"]);
    assert.equal(deviceCommand(t, "install").confirmed, true);
    assert.deepEqual(deviceCommand(t, "launch").argv, [t, "app", "launch", "com.claudexr.quest"]);
    const url = deviceCommand(t, "launch", { bridgeUrl: "wss://10.0.0.2:47800/headset" });
    assert.deepEqual(url.argv.slice(1, 3), ["shell", "am"], "extras går bara via shell");
    const r = deviceCommand(t, "reverse", { port: 48000 });
    assert.deepEqual(r.argv, [t, "adb", "reverse", "tcp:48000", "tcp:48000"]);
    assert.equal(r.confirmed, false);
    assert.match(r.note!, /NOT CONFIRMED/);
    assert.equal(deviceCommand(t, "reverse-remove").confirmed, false);
    assert.deepEqual(deviceCommand(t, "wifi-connect", { ip: "192.168.1.9" }).argv, [t, "device", "connect", "192.168.1.9"]);
  }
});

test("parseDeviceTool och shellLine", () => {
  assert.equal(parseDeviceTool(" HZDB "), "hzdb");
  assert.equal(parseDeviceTool("rm -rf"), undefined);
  assert.equal(parseDeviceTool(undefined), undefined);
  assert.deepEqual(DEVICE_TOOLS, ["adb", "metavr", "hzdb"]);
  assert.equal(shellLine(["adb", "install", "-r", "my app.apk"]), "adb install -r 'my app.apk'");
  assert.equal(shellLine(["a", "it's"]), `a 'it'\\''s'`);
});

const cli = (args: string[], env: Record<string, string> = {}) =>
  execFileSync(process.execPath, ["--import", "tsx", path.join("src", "index.ts"), "quest-cmds", ...args], {
    env: { ...process.env, CLAUDEXR_STATE_DIR: tmpDir(), CLAUDEXR_QUIET: "1", ...env },
    encoding: "utf8",
  });

test("quest-cmds skriver bara ut kommandon; verktyg från flagga, miljö eller config.json; trådat läge", () => {
  const out = cli(["--wired"]);
  assert.match(out, /med adb \(trådat läge via USB\)/);
  assert.match(out, /^adb reverse tcp:47800 tcp:47800$/m);
  assert.match(out, /bridge_url wss:\/\/127\.0\.0\.1:47800\/headset/);
  assert.match(out, /Avsluta trådat läge: adb reverse --remove tcp:47800/);
  const hz = cli(["--wired"], { CLAUDEXR_DEVICE_TOOL: "hzdb" });
  assert.match(hz, /^# OBEKRÄFTAT: hzdb adb reverse tcp:47800 tcp:47800/m);
  assert.match(hz, /^hzdb app install -r /m);
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ deviceTool: "metavr" }));
  assert.match(cli([], { CLAUDEXR_STATE_DIR: dir }), /med metavr \(Wi-Fi\/LAN\)/);
  assert.match(cli(["--tool", "adb"], { CLAUDEXR_STATE_DIR: dir }), /med adb/);
  assert.throws(() => cli(["--tool", "fastboot"]), (e: { status?: number; stdout?: string }) => e.status === 2 && /Okänt verktyg/.test(e.stdout ?? ""));
});
