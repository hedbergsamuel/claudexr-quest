// Review repro against the v0.2.0 in-progress snapshot (22:48). Not part of the product test suite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { startBridge, nextPort } from "./helpers.js";

test("V1: one 'null' frame from an unauthenticated LAN client kills the bridge", async () => {
  const port = nextPort();
  const b = await startBridge(port);
  const ws = new WebSocket(`wss://127.0.0.1:${port}/headset`, { rejectUnauthorized: false });
  await new Promise((r) => ws.on("open", r));
  ws.send("null");
  await new Promise((r) => setTimeout(r, 500));
  let alive = true;
  try { await b.call("xr_status"); } catch { alive = false; }
  ws.close();
  await b.close().catch(() => {});
  assert.equal(alive, true, "bridge died after a 'null' frame");
});

test("V2: browser-style text/plain POST to loopback /command and foreign Host are accepted", async () => {
  const port = nextPort();
  const b = await startBridge(port);
  try {
    const r = await fetch(`http://127.0.0.1:${port + 1}/command`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ op: "clear" }) });
    const http = await import("node:http");
    const code = await new Promise<number>((resolve) => http.get({ host: "127.0.0.1", port: port + 1, path: "/pairing", headers: { host: "rebind.attacker.example" } }, (res) => { res.resume(); resolve(res.statusCode!); }));
    assert.equal(r.status, 403, `POST text/plain /command -> ${r.status}`);
    assert.equal(code, 403, `GET /pairing with foreign Host -> ${code}`);
  } finally {
    await b.close();
  }
});
