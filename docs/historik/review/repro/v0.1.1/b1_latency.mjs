// B1: xr_ask round trip MCP(stdio) -> bridge -> WS -> instant answer -> back. Hub vs forwarded (second session).
import { bridge, ws, sleep } from "./lib.mjs";
import { performance } from "node:perf_hooks";
const N = Number(process.argv[2] || 300);
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))].toFixed(2); };
const port = 48720; const hub = await bridge(port); const fwd = await bridge(port);
let tShow = 0; const oneWay = [];
const h = await ws(port, { device: "Q", onShow: (m, s) => { oneWay.push(performance.now() - tShow); if (m.awaitingResponse) s.send(JSON.stringify({ type: "response", id: m.id, data: { choiceIndex: 0 } })); } });
for (const [name, b] of [["hub", hub], ["forwarded", fwd]]) {
  for (let i = 0; i < 30; i++) { tShow = performance.now(); await b.call("xr_ask", { question: "q", options: ["a", "b"] }); }
  oneWay.length = 0; const rt = [];
  for (let i = 0; i < N; i++) { const t = performance.now(); tShow = t; await b.call("xr_ask", { question: "q", options: ["a", "b"] }); rt.push(performance.now() - t); }
  console.log(`${name}: xr_ask RTT ms p50=${pct(rt,50)} p99=${pct(rt,99)} max=${pct(rt,100)} | call->headset one-way p50=${pct(oneWay,50)} p99=${pct(oneWay,99)}`);
  const big = "x".repeat(99_000); const st = [];
  for (let i = 0; i < 50; i++) { const t = performance.now(); await b.call("xr_show", { title: "t", content: big }); st.push(performance.now() - t); }
  console.log(`${name}: xr_show 99 kB ms p50=${pct(st,50)} p99=${pct(st,99)}`);
}
process.exit(0);
