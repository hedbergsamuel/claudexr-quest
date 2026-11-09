import { test } from "node:test";
import assert from "node:assert/strict";
import { startBridge, startSim, nextPort, waitFor, sleep } from "./helpers.js";

test("xr_status: not connected, then connected (after pairing)", async () => {
  const b = await startBridge(nextPort());
  try {
    assert.match((await b.call("xr_status")).text, /not connected \(no headset paired yet\)/);
    const sim = await startSim(b);
    const s = await b.call("xr_status");
    assert.match(s.text, /^XR connected: Simulated Quest 3 \(app sim-0\.2\.0\)/);
    sim.close();
  } finally {
    await b.close();
  }
});

test("xr_ask: returns the chosen option; A/B with urls uses the compare panel", async () => {
  const b = await startBridge(nextPort());
  const sim = await startSim(b, { pick: 3, choice: "b", delayMs: 100 });
  try {
    const r = await b.call("xr_ask", { q: "Which layout?", opts: [{ label: "Grid", desc: "3 columns" }, "List", "Cards"], timeout: 10 });
    assert.equal(r.text, 'Chose 3: "Cards"');
    assert.ok(sim.lines.find((l) => l.startsWith("[sim] show ask"))?.includes('"description":"3 columns"'));
    const ab = await b.call("xr_ask", { q: "Header?", opts: [{ label: "Bold", url: "https://example.com/a" }, { label: "Thin", url: "https://example.com/b" }], timeout: 10 });
    assert.equal(ab.text, 'Chose B: "Thin"');
  } finally {
    sim.close();
    await b.close();
  }
});

test("xr_ask: fallback when no headset; timeout; dismiss", async () => {
  const b = await startBridge(nextPort());
  try {
    assert.equal((await b.call("xr_ask", { q: "Q?", opts: ["a", "b"] })).text, "XR not connected; use the terminal.");
    const silent = await startSim(b, { silent: true });
    const t = await b.call("xr_ask", { q: "Q?", opts: ["a", "b"], timeout: 5 });
    assert.match(t.text, /timeout/);
    await waitFor(() => silent.lines.some((l) => l.startsWith("[sim] clear")));
    silent.close();
    await sleep(200);
    const dis = await startSim(b, { dismiss: true, pairing: silent.pairing });
    assert.match((await b.call("xr_ask", { q: "Q?", opts: ["a", "b"], timeout: 10 })).text, /closed the panel/);
    dis.close();
  } finally {
    await b.close();
  }
});

test("xr_ask survives a headset reconnect (panel re-sent)", async () => {
  const b = await startBridge(nextPort());
  const first = await startSim(b, { silent: true });
  try {
    const pending = b.call("xr_ask", { q: "Still there?", opts: ["yes", "no"], timeout: 20 });
    await waitFor(() => first.lines.some((l) => l.startsWith("[sim] show ask")));
    first.close();
    await sleep(300);
    const second = await startSim(b, { pick: 1, pairing: first.pairing });
    assert.equal((await pending).text, 'Chose 1: "yes"');
    second.close();
  } finally {
    await b.close();
  }
});

test("xr_test, xr_show (url rewrite, text), xr_present", async () => {
  const b = await startBridge(nextPort(), { CLAUDEXR_LAN_HOST: "192.168.1.50" });
  const sim = await startSim(b, { verdict: "broken" });
  try {
    const t = await b.call("xr_test", { title: "Login", steps: "Try logging in", checks: ["Form shows", "Redirects"], timeout: 10 });
    assert.equal(t.text, "BROKEN\n[ ] Form shows\n[ ] Redirects");
    assert.match((await b.call("xr_show", { type: "url", body: "http://localhost:5173/app", frame: "phone" })).text, /^Shown \w+/);
    await waitFor(() => sim.lines.some((l) => l.includes('"url":"http://192.168.1.50:5173/app"') && l.includes('"device":"phone"')));
    assert.match((await b.call("xr_show", { type: "diff", body: "+a\n-b", title: "patch" })).text, /^Shown/);
    await waitFor(() => sim.lines.some((l) => l.includes('"format":"diff"')));
    const p = await b.call("xr_present", { template: "kpi", data: { value: "42 ms", label: "p95" } });
    assert.match(p.text, /^Shown/);
    const bad = await b.call("xr_present", { template: "table", data: {} });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /should be \{columns/);
  } finally {
    sim.close();
    await b.close();
  }
});

test("xr_panel: list, update, user move is reported back, layout, close", async () => {
  const b = await startBridge(nextPort());
  const sim = await startSim(b);
  try {
    const shown = await b.call("xr_show", { type: "text", body: "hello", title: "Notes", role: "side" });
    const id = shown.text.split(" ")[1];
    assert.match((await b.call("xr_panel", { action: "list" })).text, new RegExp(`${id} html/side "Notes"`));
    assert.equal((await b.call("xr_panel", { action: "update", id, title: "Notes 2", body: "changed", size: { w: 0.8, h: 0.5 }, move: { right: 0.3, up: 0, forward: 1 } })).text, `Updated ${id}`);
    await waitFor(() => sim.lines.some((l) => l.startsWith("[sim] update") && l.includes("Notes 2") && l.includes('"relative"')));
    // The user grabs and moves the panel in the headset: the bridge state follows.
    sim.ws.send(JSON.stringify({ type: "panel_moved", id, placement: { position: { x: 1, y: 1.2, z: -0.5 } }, widthM: 0.8, heightM: 0.5 }));
    await sleep(150);
    const st = await b.local("/status");
    const p = st.openPanels.find((x: { id: string }) => x.id === id);
    assert.equal(p.movedByUser, true);
    assert.deepEqual(p.placement.position, { x: 1, y: 1.2, z: -0.5 });
    assert.match((await b.call("xr_panel", { action: "layout", mode: "present" })).text, /^Layout present/);
    assert.equal((await b.call("xr_panel", { action: "update", id: "nope" })).isError, true);
    assert.equal((await b.call("xr_panel", { action: "close", id })).text, "Closed 1");
    // The user closes a panel in the headset: it disappears from the bridge state.
    const s2 = (await b.call("xr_show", { type: "text", body: "x" })).text.split(" ")[1];
    sim.ws.send(JSON.stringify({ type: "dismissed", id: s2 }));
    await sleep(150);
    assert.equal((await b.local("/status")).openPanels.length, 0);
  } finally {
    sim.close();
    await b.close();
  }
});

test("auto-tidy keeps at most 6 panels expanded", async () => {
  const b = await startBridge(nextPort());
  const sim = await startSim(b);
  try {
    for (let i = 0; i < 8; i++) await b.call("xr_show", { type: "text", body: `p${i}`, title: `P${i}` });
    const st = await b.local("/status");
    assert.equal(st.openPanels.length, 8);
    const expanded = st.openPanels.filter((p: { minimized: boolean }) => !p.minimized);
    assert.equal(expanded.length, 6);
    // the two oldest were collapsed
    assert.deepEqual(st.openPanels.filter((p: { minimized: boolean }) => p.minimized).map((p: { title: string }) => p.title).sort(), ["P0", "P1"]);
    await waitFor(() => sim.lines.some((l) => l.startsWith("[sim] layout")));
  } finally {
    sim.close();
    await b.close();
  }
});

test("one daemon serves several Claude sessions; a second daemon refuses to start", async () => {
  const port = nextPort();
  const a = await startBridge(port);
  const b2 = await startBridge(port, {}, a.stateDir, a.daemon); // second MCP session, same daemon
  const sim = await startSim(a, { pick: 2 });
  try {
    assert.match((await b2.call("xr_status")).text, /^XR connected/);
    assert.equal((await b2.call("xr_ask", { q: "Q?", opts: ["a", "b"], timeout: 10 })).text, 'Chose 2: "b"');
    const { startDaemon } = await import("./helpers.js");
    const dup = await startDaemon(port, {}, a.stateDir).catch(() => null);
    assert.equal(await dup!.exited, 3, "second daemon exits with code 3 (ports in use)");
  } finally {
    sim.close();
    await b2.close();
    await a.close();
  }
});

test("stdio fallback forwards to the running daemon", async () => {
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const a = await startBridge(nextPort());
  const sim = await startSim(a, { pick: 1 });
  const c = new Client({ name: "stdio", version: "0" });
  try {
    await c.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/index.ts", "--stdio"], env: { ...(process.env as Record<string, string>), CLAUDEXR_PORT: String(a.port), CLAUDEXR_STATE_DIR: a.stateDir, CLAUDEXR_QUIET: "1" }, stderr: "ignore" }));
    const r = (await c.callTool({ name: "xr_ask", arguments: { q: "Q?", opts: ["x", "y"], timeout: 10 } })) as { content: { text: string }[] };
    assert.equal(r.content[0].text, 'Chose 1: "x"');
  } finally {
    await c.close();
    sim.close();
    await a.close();
  }
});

test("cancelling a waiting xr_ask removes the card from the headset (review patch 03)", async () => {
  const a = await startBridge(nextPort());
  const sim = await startSim(a, { silent: true });
  try {
    const ac = new AbortController();
    const p = a.client.callTool({ name: "xr_ask", arguments: { q: "Q?", opts: ["x", "y"], timeout: 60 } }, undefined, { signal: ac.signal }).catch((e) => e);
    await waitFor(() => sim.lines.some((l) => l.startsWith("[sim] show ask")));
    ac.abort();
    await p;
    await waitFor(() => sim.lines.some((l) => l.startsWith("[sim] clear")));
    assert.equal((await a.local("/status")).openPanels.length, 0);
  } finally {
    sim.close();
    await a.close();
  }
});
