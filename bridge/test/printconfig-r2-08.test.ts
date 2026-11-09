// Review 2 / R2-08: print-config keeps the token out of Claude Code's config files by default.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { startDaemon, nextPort, tmpDir } from "./helpers.js";

test("print-config uses headersHelper + gated command hooks (token from file); the header file is 0600", async () => {
  const sd = tmpDir();
  const port = nextPort();
  const d = await startDaemon(port, {}, sd);
  try {
    const token = fs.readFileSync(path.join(sd, "local-token"), "utf8").trim();
    const hf = path.join(sd, "mcp-headers.json");
    assert.equal(fs.statSync(hf).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(hf, "utf8")).Authorization, `Bearer ${token}`);
    const env = { ...process.env, CLAUDEXR_STATE_DIR: sd, CLAUDEXR_PORT: String(port) };
    const out = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", "print-config"], { env, encoding: "utf8" }).stdout;
    assert.ok(!out.includes(token), "token printed into the config");
    assert.match(out, /headersHelper/);
    // 0.3.1: hooks are gated command hooks that read the token FILE when they run (no env var, no allowedEnvVars)
    assert.ok(!out.includes("CLAUDEXR_TOKEN") && !out.includes("allowedEnvVars"));
    assert.match(out, /local-token/);
    assert.match(out, /\[ -f /);
    const inline = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", "print-config", "--inline-token"], { env, encoding: "utf8" }).stdout;
    assert.ok(inline.includes(token));
    // The helper command really produces the header JSON.
    const helper = /"headersHelper":"([^"]+)"/.exec(out)![1];
    const h = spawnSync("sh", ["-c", helper], { encoding: "utf8" });
    assert.equal(JSON.parse(h.stdout).Authorization, `Bearer ${token}`);
  } finally {
    d.proc.kill("SIGTERM");
    await d.exited;
  }
});
