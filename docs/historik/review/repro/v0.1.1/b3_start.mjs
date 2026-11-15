import { spawn, execSync } from "node:child_process";
import { performance } from "node:perf_hooks";
async function once(port, extra = []) {
  const t0 = performance.now();
  const p = spawn(process.execPath, [...extra, "../dist/src/index.js"], { env: { ...process.env, CLAUDEXR_PORT: String(port), CLAUDEXR_NO_MDNS: "1", CLAUDEXR_QUIET: "1" }, stdio: ["pipe", "pipe", "ignore"] });
  const ready = new Promise((r) => p.stdout.once("data", r));
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "b", version: "0" } } }) + "\n");
  await ready; const ms = performance.now() - t0;
  await new Promise((r) => setTimeout(r, 1500));
  const rss = Number(execSync(`ps -o rss= -p ${p.pid}`).toString()) / 1024;
  return { p, ms, rss };
}
const hub = await once(48790); const cl = await once(48790);
console.log(`hub: start->initialize ${hub.ms.toFixed(0)} ms, RSS ${hub.rss.toFixed(0)} MB | client(forwarder): ${cl.ms.toFixed(0)} ms, RSS ${cl.rss.toFixed(0)} MB`);
hub.p.kill(); cl.p.kill();
