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
