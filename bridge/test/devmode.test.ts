import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startBridge, startSim, nextPort, waitFor } from "./helpers.js";

test("dev mode: bug/idea notes with auto context, dedupe, BUGS.md, export, masking", async () => {
  const b = await startBridge(nextPort());
  const sim = await startSim(b);
  try {
    assert.ok((await b.toolNames()).includes("xr_dev"));
    const r1 = await b.call("xr_dev", { action: "bug", title: "Panel hamnar bakom soffan", comp: "quest-app", sev: "hög", desc: "token=abcdefghijkl123", steps: ["öppna xr_show", "titta"] });
    assert.match(r1.text, /^Saved BUG-/);
    const r2 = await b.call("xr_dev", { action: "bug", title: "panel hamnar bakom  soffan", comp: "quest-app" });
    assert.match(r2.text, /^Counted as repeat of BUG-/);
    await b.call("xr_dev", { action: "idea", title: "Snabbare parkoppling", desc: "QR i stället för kod", prio: "låg", comp: "brygga" });
    const list = (await b.call("xr_dev", { action: "list" })).text;
    assert.match(list, /BUG-\w+ bug hög quest-app ×2: Panel hamnar bakom soffan/);
    const jsonl = fs.readFileSync(path.join(b.bugsDir, "reports.jsonl"), "utf8");
    assert.equal(jsonl.includes("abcdefghijkl123"), false, "secrets masked");
    assert.match(jsonl, /"appVersion":"sim-0.2.0"/);
    const md = fs.readFileSync(path.join(b.bugsDir, "BUGS.md"), "utf8");
    assert.match(md, /### hög[\s\S]*Panel hamnar bakom soffan\*\* \(quest-app, 2×/);
    const ex = (await b.call("xr_dev", { action: "export" })).text;
    const file = ex.replace("Handoff written: ", "");
    const handoff = fs.readFileSync(file, "utf8");
    assert.match(handoff, /## Svenska[\s\S]*Steg för att återskapa[\s\S]*## English[\s\S]*Steps to reproduce/);
    assert.match(handoff, /Loggutdrag \/ log excerpt/);
  } finally {
    sim.close();
    await b.close();
  }
});

test("dev mode: timeouts are logged automatically without the model", async () => {
  const b = await startBridge(nextPort());
  const sim = await startSim(b, { silent: true });
  try {
    await b.call("xr_ask", { q: "Q?", opts: ["a", "b"], timeout: 5 });
    await waitFor(() => fs.existsSync(path.join(b.bugsDir, "reports.jsonl")));
    assert.match(fs.readFileSync(path.join(b.bugsDir, "reports.jsonl"), "utf8"), /"type":"auto".*Timeout: ingen respons på ask-panel/);
  } finally {
    sim.close();
    await b.close();
  }
});

test("XR_DEV_MODE=0: no dev tool, no bug files, everything else works", async () => {
  const b = await startBridge(nextPort(), { XR_DEV_MODE: "0" });
  const sim = await startSim(b, { pick: 2, silent: false });
  try {
    const names = await b.toolNames();
    assert.equal(names.includes("xr_dev"), false);
    assert.deepEqual(names.sort(), ["xr_ask", "xr_panel", "xr_present", "xr_show", "xr_status", "xr_stream", "xr_test"]);
    assert.equal((await b.call("xr_ask", { q: "Q?", opts: ["a", "b"], timeout: 10 })).text, 'Chose 2: "b"');
    assert.match((await b.call("xr_present", { template: "kpi", data: { value: 1, label: "x" } })).text, /^Shown/);
    assert.equal(fs.existsSync(b.bugsDir), false);
  } finally {
    sim.close();
    await b.close();
  }
});
