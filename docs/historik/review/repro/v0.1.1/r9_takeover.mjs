// R9: when the hub session exits, the client-mode bridge only takes over on its next tool call.
// Meanwhile nothing listens on the port: the headset cannot reconnect and the hook reports "bridge not running",
// which tells Claude NOT to use xr_* tools -> nobody ever triggers the takeover.
import { bridge, ws, sleep } from "./lib.mjs";
const port = 48719; const hub = await bridge(port); const second = await bridge(port);
await hub.close(); await sleep(300);
let ok = 0, fail = 0; const t0 = Date.now();
while (Date.now() - t0 < 6000) { try { const s = await ws(port, { device: "Q" }); s.close(); ok++; } catch { fail++; } await sleep(500); }
console.log(`headset connect attempts during 6 s after hub exit: ok=${ok} fail=${fail}`);
const r = await fetch(`http://127.0.0.1:${port}/status`).then(()=> "reachable", (e) => "unreachable");
console.log("hook view (/status):", r);
process.exit(0);
