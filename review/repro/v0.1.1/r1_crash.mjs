// R1: one malformed frame ("null") from any LAN client crashes the bridge (and so the MCP server).
import { bridge, ws, sleep } from "./lib.mjs";
const port = 48711; const b = await bridge(port);
const s = await ws(port, { hello: false });
s.send("null");
await sleep(500);
let alive = true; try { await b.call("xr_status", {}, { timeout: 2000 }); } catch (e) { alive = false; console.log("xr_status after 'null' frame failed:", e.message); }
console.log("bridge alive after 'null' frame:", alive);
console.log("stderr:", b.errs.join("").split("\n").filter(l => /TypeError|Cannot read/.test(l)).slice(0,2).join(" | "));
process.exit(0);
