// End-to-end proof with raw JSON-RPC over HTTP (what Claude Code sends with --transport http):
// starts the daemon, pairs a simulated headset, calls xr_status and xr_ask.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { runSim } from "../sim/headset-sim.js";

const port = Number(process.env.CLAUDEXR_PORT || 47899);
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "claudexr-e2e-"));
const daemon = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  env: { ...process.env, CLAUDEXR_PORT: String(port), CLAUDEXR_NO_MDNS: "1", CLAUDEXR_NO_NOTIFY: "1", CLAUDEXR_PAIR_CONFIRM: "auto", CLAUDEXR_STATE_DIR: stateDir, XR_DEV_MODE: "0" },
  stdio: ["ignore", "inherit", "pipe"],
});
// The pairing code is only shown on the Mac side: here, the daemon's stderr.
let code = "";
daemon.stderr!.on("data", (d: Buffer) => {
  process.stderr.write(d);
  const m = /PAIRING CODE.*: (\d{4}) (\d{4})/.exec(d.toString());
  if (m) code = m[1] + m[2];
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let nextId = 1;
async function rpc(method: string, params: unknown): Promise<any> {
  const token = fs.readFileSync(path.join(stateDir, "local-token"), "utf8").trim();
  const req = { jsonrpc: "2.0", id: nextId++, method, params };
  console.log(">>", JSON.stringify(req));
  const r = await fetch(`http://127.0.0.1:${port + 1}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(req),
  });
  const text = await r.text();
  const data = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)));
  const msg = data.find((m) => m.id === req.id) ?? JSON.parse(text);
  console.log("<<", JSON.stringify(msg).slice(0, 300));
  return msg;
}

async function main() {
  for (let i = 0; i < 100 && !fs.existsSync(path.join(stateDir, "local-token")); i++) await sleep(50);
  await sleep(300);
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw-e2e", version: "0" } });
  const tools = await rpc("tools/list", {});
  console.log("tools:", tools.result.tools.map((t: any) => t.name).join(", "));
  await rpc("tools/call", { name: "xr_status", arguments: {} });
  const sim = await runSim({
    url: `wss://127.0.0.1:${port}/headset`,
    pick: 2,
    delayMs: 300,
    getCode: async () => {
      for (let i = 0; i < 50 && !code; i++) await sleep(50);
      return code;
    },
  });
  await sleep(1500);
  await rpc("tools/call", { name: "xr_status", arguments: {} });
  const ask = await rpc("tools/call", { name: "xr_ask", arguments: { q: "Which color theme?", opts: ["Light", "Dark", "Solarized"], timeout: 10 } });
  const text = ask.result.content[0].text as string;
  sim.close();
  daemon.kill();
  if (!text.includes('"Dark"')) {
    console.error("E2E FAILED:", text);
    process.exit(1);
  }
  console.log("\nE2E OK ->", text);
  process.exit(0);
}
main();
