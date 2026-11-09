import { test } from "node:test";
import assert from "node:assert/strict";
import { maskSecrets } from "../src/mask.js";

export const VECTORS: [string, RegExp | string][] = [
  ["export OPENAI_API_KEY=sk-abcdefghijklmnopqrstuv", "export OPENAI_API_KEY=***"],
  ["curl -H 'Authorization: Bearer abcdef1234567890xyz' https://x", /^curl -H 'Authorization: [^a-z0-9]*\*\*\*' https:\/\/x$/],
  ["git push https://user:hunter2@github.com/a/b", "git push https://***:***@github.com/a/b"],
  ["push ghp_abcdefghijklmnopqrstuvwxyz0123", "push gh*_***"],
  ["aws AKIAABCDEFGHIJKLMNOP", "aws AKIA***"],
  ["password: 'p4ss w0rd'", "password: ***"],
  ["npm test -- --watch", "npm test -- --watch"],
];

test("masks common secrets and leaves normal commands alone", () => {
  for (const [input, want] of VECTORS) {
    const out = maskSecrets(input);
    if (typeof want === "string") assert.equal(out, want, input);
    else assert.match(out, want, input);
  }
});

test("masking is linear-time on long word runs (no ReDoS, review patch 12)", () => {
  for (const s of ["a".repeat(100_000), "0123456789abcdef".repeat(6_250), "TOKEN".repeat(20_000)]) {
    const t = performance.now();
    maskSecrets(s);
    const ms = performance.now() - t;
    assert.ok(ms < 250, `${ms.toFixed(0)} ms for ${s.length} chars`);
  }
});
