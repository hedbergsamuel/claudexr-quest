import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { WebSocket } from "ws";
import { startBridge, startSim, nextPort, waitFor, sleep } from "./helpers.js";
import { pairingMac } from "../src/pairing.js";

function rawClient(port: number) {
  const ws = new WebSocket(`wss://127.0.0.1:${port}/headset`, { rejectUnauthorized: false });
  const msgs: any[] = [];
  ws.on("message", (m) => msgs.push(JSON.parse(m.toString())));
  return { ws, msgs, open: new Promise((r) => ws.on("open", r)), send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

test("unpaired clients are rejected and cannot see or answer panels", async () => {
  const b = await startBridge(nextPort());
  const c = rawClient(b.port);
  try {
    await c.open;
    c.send({ type: "hello", protocol: 2, device: "evil" });
    await waitFor(() => c.msgs.some((m) => m.type === "unauthorized"));
    c.send({ type: "hello", protocol: 2, token: "x".repeat(43) });
    await waitFor(() => c.msgs.filter((m) => m.type === "unauthorized").length === 2);
    assert.match((await b.call("xr_status")).text, /not connected/);
    assert.equal((await b.call("xr_ask", { q: "Q?", opts: ["a", "b"] })).text, "XR not connected; use the terminal.");
    c.send({ type: "response", id: "whatever", data: { choiceIndex: 0 } }); // ignored
  } finally {
    c.ws.close();
    await b.close();
  }
});

test("wrong pairing codes fail, 5 attempts burn the code, the code is never sent to the headset", async () => {
  const b = await startBridge(nextPort());
  const c = rawClient(b.port);
  try {
    await c.open;
    c.send({ type: "pair_request", device: "attacker" });
    await waitFor(() => c.msgs.some((m) => m.type === "pair_code_shown"));
    await waitFor(() => b.pairingCode() !== "00000000");
    assert.equal(JSON.stringify(c.msgs).includes(b.pairingCode()), false, "code must never be sent to the headset");
    assert.equal(JSON.stringify(await b.local("/pairing")).includes(b.pairingCode()), false, "code must never be served over HTTP");
    for (let i = 0; i < 5; i++) c.send({ type: "pair_confirm", nonce: crypto.randomBytes(16).toString("hex"), mac: "0".repeat(64) });
    await waitFor(() => c.msgs.some((m) => m.reason === "too_many_attempts"), 8000);
    assert.equal((await b.local("/pairing")).pending, false);
  } finally {
    c.ws.close();
    await b.close();
  }
});

test("MAC is bound to the certificate fingerprint (MITM with another cert fails)", async () => {
  const b = await startBridge(nextPort());
  const c = rawClient(b.port);
  try {
    await c.open;
    c.send({ type: "pair_request", device: "x" });
    await waitFor(() => c.msgs.some((m) => m.type === "pair_code_shown"));
    await waitFor(() => b.pairingCode() !== "00000000");
    const nonce = crypto.randomBytes(16).toString("hex");
    c.send({ type: "pair_confirm", nonce, mac: await pairingMac(b.pairingCode(), "f".repeat(64), nonce) }); // attacker's cert fingerprint
    await waitFor(() => c.msgs.some((m) => m.type === "pair_failed" && m.reason === "wrong_code"));
  } finally {
    c.ws.close();
    await b.close();
  }
});

test("pairing persists across bridge restarts; token is stored hashed; fingerprint is pinned", async () => {
  const port = nextPort();
  const b1 = await startBridge(port);
  const sim = await startSim(b1);
  const token = sim.pairing.token!;
  sim.close();
  await b1.close();
  const stored = fs.readFileSync(path.join(b1.stateDir, "paired.json"), "utf8");
  assert.equal(stored.includes(token), false);
  assert.match(stored, /"tokenHash"/);

  const b2 = await startBridge(port, {}, b1.stateDir);
  try {
    const sim2 = await startSim(b2, { pairing: { ...sim.pairing }, getCode: async () => assert.fail("must not pair again") });
    assert.match((await b2.call("xr_status")).text, /^XR connected/);
    sim2.close();
    // A headset that pinned another fingerprint refuses to talk to this bridge.
    const lines: string[] = [];
    const { runSim } = await import("../sim/headset-sim.js");
    const ws = await runSim({ url: `wss://127.0.0.1:${port}/headset`, pairing: { token, fingerprint: "0".repeat(64) }, log: (l) => lines.push(l) });
    await waitFor(() => lines.some((l) => l.includes("fingerprint changed")));
    ws.close();
  } finally {
    await b2.close();
  }
});

test("loopback API is not exposed on the LAN/TLS port; unpair kicks the headset", async () => {
  const b = await startBridge(nextPort());
  const sim = await startSim(b);
  try {
    const r = await new Promise<string>((resolve) => {
      const https = require("node:https");
      https.get({ host: "127.0.0.1", port: b.port, path: "/status", rejectUnauthorized: false }, (res: any) => {
        let d = "";
        res.on("data", (c: string) => (d += c));
        res.on("end", () => resolve(d));
      });
    });
    assert.equal(JSON.parse(r).server, "claudexr-bridge");
    assert.equal(r.includes("openPanels"), false);
    await b.local("/command", { op: "unpair" });
    await waitFor(() => sim.lines.some((l) => l.includes("disconnected (4001)")));
    await sleep(100);
    assert.equal((await b.local("/status")).pairedDevices.length, 0);
  } finally {
    sim.close();
    await b.close();
  }
});

test("pairing code is bound to the connection that asked for it; Mac confirmation is required", async () => {
  const b = await startBridge(nextPort(), { CLAUDEXR_PAIR_CONFIRM: "deny" });
  const victim = rawClient(b.port);
  const thief = rawClient(b.port);
  try {
    await victim.open;
    await thief.open;
    victim.send({ type: "pair_request", device: "Quest 3" });
    await waitFor(() => victim.msgs.some((m) => m.type === "pair_code_shown"));
    thief.send({ type: "pair_request", device: "evil" });
    await waitFor(() => thief.msgs.some((m) => m.type === "pair_failed" && m.reason === "busy"));
    await waitFor(() => b.pairingCode() !== "00000000");
    const nonce = crypto.randomBytes(16).toString("hex");
    // a different connection cannot use the code even if it knows it
    thief.send({ type: "pair_confirm", nonce, mac: "0".repeat(64) });
    await waitFor(() => thief.msgs.some((m) => m.reason === "not_your_code"));
    // correct code from the right connection, but the Mac user says no
    const fp = (victim.ws as any)._socket.getPeerCertificate().raw;
    const fingerprint = crypto.createHash("sha256").update(fp).digest("hex");
    victim.send({ type: "pair_confirm", nonce, mac: await pairingMac(b.pairingCode(), fingerprint, nonce) });
    await waitFor(() => victim.msgs.some((m) => m.reason === "denied_on_mac"), 8000);
    assert.equal((await b.local("/status")).pairedDevices.length, 0);
  } finally {
    victim.ws.close();
    thief.ws.close();
    await b.close();
  }
});
