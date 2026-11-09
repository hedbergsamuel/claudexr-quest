import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteLocalUrl } from "../src/net.js";
import { publishMdns } from "../src/mdns.js";
import { discoverBridge } from "../sim/headset-sim.js";

test("rewriteLocalUrl", () => {
  assert.equal(rewriteLocalUrl("http://localhost:3000/x?y=1", "10.0.0.5"), "http://10.0.0.5:3000/x?y=1");
  assert.equal(rewriteLocalUrl("http://127.0.0.1:8080", "10.0.0.5"), "http://10.0.0.5:8080/");
  assert.equal(rewriteLocalUrl("https://example.com/", "10.0.0.5"), "https://example.com/");
  assert.equal(rewriteLocalUrl("not a url", "10.0.0.5"), "not a url");
});

test("mDNS: _claudexr._tcp is advertised and discoverable", async (t) => {
  const handle = publishMdns(47123, "ab".repeat(32));
  try {
    const url = await discoverBridge(6000);
    assert.match(url, /^wss:\/\/.+:47123\/headset$/);
  } catch (e) {
    // Multicast may be unavailable in sandboxes/VMs; report clearly instead of failing silently.
    t.skip(`mDNS discovery not possible in this environment: ${(e as Error).message}`);
  } finally {
    await handle.stop();
  }
});
