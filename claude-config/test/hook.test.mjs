// The functional hook tests live in bridge/test/hooks.test.ts (they need a bridge + simulated headset):
//   cd ../bridge && npm test
// This file only checks that every hook script parses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "hooks");
test("hook scripts are valid JavaScript", () => {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs"))) {
    execFileSync(process.execPath, ["--check", path.join(dir, f)]);
    assert.ok(true, f);
  }
});
