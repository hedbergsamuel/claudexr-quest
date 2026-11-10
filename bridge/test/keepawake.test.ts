import { test } from "node:test";
import assert from "node:assert/strict";
import { KeepAwake } from "../src/keepawake.js";

test("KeepAwake startar och stoppar adaptern idempotent", () => {
  const calls: string[] = [];
  const k = new KeepAwake({ start: () => (calls.push("start"), true), stop: () => void calls.push("stop") });
  k.set(false);
  k.set(true);
  k.set(true);
  assert.equal(k.active, true);
  k.set(false);
  k.set(false);
  assert.deepEqual(calls, ["start", "stop"]);
});

test("KeepAwake: misslyckad start ger inte active", () => {
  const k = new KeepAwake({ start: () => false, stop: () => {} });
  k.set(true);
  assert.equal(k.active, false);
});

import { matchLocalCommand } from "../src/voice.js";
test("röstkommandon: bioskärm och stäng allt utom skärmen", () => {
  assert.equal(matchLocalCommand("Bioskärm"), "cinema");
  assert.equal(matchLocalCommand("återställ"), "screen_reset");
  assert.equal(matchLocalCommand("längre bort"), "screen_farther");
  assert.equal(matchLocalCommand("Stäng allt utom macens skärm"), "close_others");
  assert.equal(matchLocalCommand("stäng alla paneler"), "close_all");
});
