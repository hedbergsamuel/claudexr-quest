// R6: no maxPayload/connection limits; pre-hello sockets never pinged or closed.
import { bridge, ws, sleep } from "./lib.mjs";
import { execSync } from "node:child_process";
const port = 48716; const b = await bridge(port);
const pid = (await b.call("xr_status")).content[1] ? JSON.parse((await b.call("xr_status")).content[1].text).bridge.pid : 0;
const rss = () => Number(execSync(`ps -o rss= -p ${pid}`).toString().trim()) / 1024;
console.log("bridge RSS idle MB:", rss().toFixed(1));
const s = await ws(port, { hello: false });
const big = '{"type":"x","pad":"' + "A".repeat(60 * 1024 * 1024) + '"}';
s.send(big); await sleep(1500);
console.log("after one 60 MB frame RSS MB:", rss().toFixed(1), "(accepted, ws default maxPayload=100 MiB)");
const socks = []; for (let i = 0; i < 300; i++) socks.push(await ws(port, { hello: false }));
await sleep(25000);
console.log("pre-hello sockets still open after 25 s (heartbeat ignores them):", socks.filter(x => x.readyState === 1).length, "/ 300");
process.exit(0);
