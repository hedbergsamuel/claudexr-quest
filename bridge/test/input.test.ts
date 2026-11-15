import { test } from "node:test";
import assert from "node:assert/strict";
import { InputGate, InputRouter, NullInputSink, mapToTarget, parsePointer, INPUT_IDLE_OFF_MS } from "../src/input.js";
import { startBridge, startSim, nextPort, waitFor, sleep } from "./helpers.js";

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

// ---------------- 0.4.1: InputRouter (punkt 6), utan CGEvent ----------------

test("parsePointer: bara giltiga händelser, scroll begränsas", () => {
  assert.deepEqual(parsePointer({ kind: "move", panelId: "display", u: 0.1, v: 0.2 }), { kind: "move", panelId: "display", u: 0.1, v: 0.2 });
  assert.equal(parsePointer({ kind: "button", panelId: "display", u: 0.1, v: 0.2, button: "middle", down: true }), null);
  assert.equal(parsePointer({ kind: "button", panelId: "display", u: 0.1, v: 0.2, button: "left" }), null);
  assert.equal(parsePointer({ kind: "move", panelId: "x".repeat(65), u: 0, v: 0 }), null);
  assert.equal(parsePointer({ kind: "move", panelId: "display", u: "0", v: 0 }), null);
  assert.equal(parsePointer({ kind: "key", panelId: "display", key: "a" }), null, "tangenter finns inte");
  assert.equal(parsePointer(null), null);
  assert.deepEqual(parsePointer({ kind: "scroll", panelId: "display", dx: 9999, dy: -9999 }), { kind: "scroll", panelId: "display", dx: 500, dy: -500 });
});

test("InputRouter: av = släpps, röst/MCP kan inte slå på, mappning när på, sensitive och tomgång stänger", () => {
  let t = 1000;
  const sink = new NullInputSink();
  const r = new InputRouter(new InputGate(), sink, (id) => (id === "display" ? { x: 0, y: 0, w: 1512, h: 982 } : null), () => t);
  const ev = { kind: "button", panelId: "display", u: 0.5, v: 0.25, button: "left", down: true };
  assert.equal(r.handle(ev), "gate_off");
  assert.equal(r.enable("voice"), false);
  assert.equal(r.enable("mcp"), false);
  assert.equal(r.handle(ev), "gate_off");
  assert.equal(r.enable("headset-button"), true);
  assert.equal(r.handle(ev), "delivered");
  assert.deepEqual(sink.recent[0], { kind: "button", panelId: "display", x: 756, y: 245.5, button: "left", down: true });
  assert.equal(r.handle({ kind: "move", panelId: "win-11", u: 0.5, v: 0.5 }), "no_target", "fönster har ingen känd position än");
  assert.equal(r.handle({ kind: "move", panelId: "display", u: 1.5, v: 0.5 }), "no_target");
  r.gate.sensitive = true;
  assert.equal(r.handle(ev), "sensitive");
  r.gate.sensitive = false;
  t += INPUT_IDLE_OFF_MS + 1;
  assert.equal(r.handle(ev), "gate_off", "stängs efter tomgång");
  assert.equal(r.stats().lastOff, "idle");
  assert.equal(sink.count, 1);
  assert.equal(r.stats().sink, "null");
});

test("hubben: bara headsetets input_gate öppnar grinden; MCP/event kan inte; nödstopp stänger; inget når Macen", async () => {
  const b = await startBridge(nextPort(), { CLAUDEXR_DISPLAY_APPROVAL: "never" });
  const sim = await startSim(b);
  const st = async () => (await b.local("/status")).input as { enabled: boolean; delivered: number; dropped: number; sink: string; lastOff?: string };
  const ptr = (u: number, panelId = "display") => sim.ws.send(JSON.stringify({ type: "pointer", event: { kind: "move", panelId, u, v: 0.5 } }));
  try {
    assert.match((await b.call("xr_stream", { action: "display" })).text, /^Streaming/);
    ptr(0.5);
    await sleep(150);
    assert.deepEqual([(await st()).enabled, (await st()).delivered, (await st()).dropped], [false, 0, 1]);
    // andra vägar än headsetets kontrollsocket kan inte öppna grinden
    await b.local("/event", { type: "input_gate", on: true });
    await b.local("/command", { op: "input_gate", on: true }).catch(() => {});
    assert.equal((await st()).enabled, false);
    sim.ws.send(JSON.stringify({ type: "input_gate", on: true }));
    await waitFor(() => sim.lines.some((l) => l.includes("Inmatning till Macen: PÅ")), 3000).catch(() => {});
    await sleep(500); // display-info från låtsashjälparen
    ptr(0.5);
    ptr(0.5, "win-11");
    await sleep(150);
    const on = await st();
    assert.equal(on.enabled, true);
    assert.equal(on.sink, "null");
    assert.equal(on.delivered, 1);
    assert.equal(on.dropped, 2);
    assert.match((await b.call("xr_panel", { action: "list" })).text, /input: ON \(test mode, sink null/);
    await b.local("/command", { op: "emergency" });
    const off = await st();
    assert.equal(off.enabled, false);
    assert.equal(off.lastOff, "emergency");
  } finally {
    sim.close();
    await b.close();
  }
});
