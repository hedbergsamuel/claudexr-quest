// B2: video frames and control messages on one WebSocket over a link slower than the stream bitrate.
// Client reads at LINK_MBPS (simulated by pausing the TCP socket); server sends 12 Mbit/s of "video" at 30 fps.
// Measures how late a small control message (e.g. a permission prompt) arrives, with and without a drop policy.
import { WebSocketServer, WebSocket } from "ws";
const LINK_MBPS = Number(process.argv[2] || 8), DROP = process.argv[3] === "drop", ACK = process.argv[3] === "ack";
const wss = new WebSocketServer({ port: 0 });
const port = await new Promise((r) => wss.on("listening", () => r(wss.address().port)));
wss.on("connection", (ws) => {
  let n = 0, dropped = 0, inflight = 0;
  ws.on("message", () => inflight--); // headset acks every frame it has received
  const frame = Buffer.alloc(50_000); // 50 kB * 30 fps = 12 Mbit/s
  const v = setInterval(() => {
    n++;
    if (DROP && ws.bufferedAmount > 2 * frame.length && n % 30 !== 0) { dropped++; return; } // keep keyframes (every 30th)
    if (ACK && inflight >= 2 && n % 30 !== 0) { dropped++; return; } // credit-based: max 2 frames in flight
    inflight++;
    ws.send(frame);
  }, 33);
  const c = setInterval(() => ws.send(JSON.stringify({ type: "ctl", t: Date.now() })), 1000);
  setTimeout(() => { clearInterval(v); clearInterval(c); console.log(`frames sent=${n - dropped} dropped=${dropped} bufferedAmount at end=${(ws.bufferedAmount/1e6).toFixed(1)} MB`); }, 10_000);
});
const ws = new WebSocket(`ws://127.0.0.1:${port}`);
const lat = [];
ws.on("message", (d, bin) => { if (!bin) lat.push(Date.now() - JSON.parse(d).t); else ws.send("a"); });
ws.on("open", () => {
  const sock = ws._socket; let budget = 0;
  // token bucket: allow LINK_MBPS of reading
  sock.on("data", (b) => { budget -= b.length; if (budget < 0) { sock.pause(); } });
  setInterval(() => { budget = Math.min(budget + LINK_MBPS * 1e6 / 8 / 100, LINK_MBPS * 1e6 / 8 / 50); if (budget > 0) sock.resume(); }, 10);
});
setTimeout(() => { console.log(`link ${LINK_MBPS} Mbit/s, policy=${ACK ? "ack-credit(2 in flight)" : DROP ? "drop-when-bufferedAmount" : "send-everything"}: control msg latency ms = ${lat.join(", ")}`); process.exit(0); }, 11_000);
