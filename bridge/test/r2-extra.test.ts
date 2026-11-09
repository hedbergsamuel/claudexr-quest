// Review 2 follow-ups: exclusivity survives layout changes; the certificate ID is shown on the Mac.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startBridge, startSim, nextPort, waitFor } from "./helpers.js";
import { shortFingerprint } from "../src/pairing.js";

test("xr_panel layout cannot bring other panels back while an approval is pending", async () => {
  const b = await startBridge(nextPort());
  const sim = await startSim(b, { silent: true });
  try {
    const id = /Shown (\w+)/.exec((await b.call("xr_show", { type: "text", body: "x" })).text)![1];
    const hook = b.local("/hook/permission", { hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "ls" } });
    await waitFor(() => sim.lines.some((l) => l.includes("show permission")));
    await b.call("xr_panel", { action: "layout", mode: "review" });
    const st = await b.local("/status");
    assert.equal(st.openPanels.find((p: { id: string }) => p.id === id).minimized, true);
    const card = st.openPanels.find((p: { kind: string }) => p.kind === "permission");
    await b.call("xr_panel", { action: "close", id: card.id });
    assert.deepEqual(await hook, {});
  } finally {
    sim.close();
    await b.close();
  }
});

test("pairing shows a short certificate ID on the Mac that matches what the headset sees", async () => {
  const b = await startBridge(nextPort());
  const sim = await startSim(b);
  try {
    const line = b.daemon.stderrLines.find((l) => l.includes("PAIRING CODE"))!;
    assert.match(line, new RegExp(`Headset must show ID ${shortFingerprint(sim.pairing.fingerprint!)}`));
  } finally {
    sim.close();
    await b.close();
  }
});
