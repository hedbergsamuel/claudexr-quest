// R8: Claude Code cancels xr_ask (user presses Esc) -> MCP notifications/cancelled. Panel stays "awaiting" in the headset.
import { bridge, ws, sleep } from "./lib.mjs";
const port = 48718; const b = await bridge(port);
const h = await ws(port, { device: "Q" });
const ac = new AbortController();
const p = b.call("xr_ask", { question: "Q?", options: ["a", "b"], timeout_seconds: 300 }, { signal: ac.signal }).catch((e) => "client: " + e.message);
await sleep(300); ac.abort(); console.log(await p);
await sleep(300);
const st = JSON.parse((await b.call("xr_status")).content[1].text);
console.log("open panels after cancel:", st.openPanels.map((x) => `${x.kind} awaiting=${x.awaiting}`));
// Second ask in same role: panels stack instead of replacing the orphan
await b.call("xr_ask", { question: "Q2?", options: ["a", "b"], timeout_seconds: 5 }).catch(() => {});
process.exit(0);
