import { test } from "node:test";
import assert from "node:assert/strict";
import { InputGate, mapToTarget } from "../src/input.js";

test("mapToTarget mappar panelkoordinater till målrektangel", () => {
  assert.deepEqual(mapToTarget(0.5, 0.5, { x: 100, y: 200, w: 400, h: 200 }), { x: 300, y: 300 });
  assert.equal(mapToTarget(1.2, 0.5, { x: 0, y: 0, w: 1, h: 1 }), null);
  assert.equal(mapToTarget(NaN, 0, { x: 0, y: 0, w: 1, h: 1 }), null);
});

test("InputGate: av som standard, röst och MCP kan inte slå på, off() fungerar alltid", () => {
  const g = new InputGate();
  assert.equal(g.allow(), false);
  assert.equal(g.enable("voice"), false);
  assert.equal(g.enable("mcp"), false);
  assert.equal(g.enabled, false);
  assert.equal(g.enable("headset-button"), true);
  assert.equal(g.allow(), true);
  g.sensitive = true;
  assert.equal(g.allow(), false);
  g.off();
  assert.equal(g.enabled, false);
});
