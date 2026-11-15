import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function bridge(port, env = {}) {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["../dist/src/index.js"], cwd: new URL(".", import.meta.url).pathname,
    env: { ...process.env, CLAUDEXR_PORT: String(port), CLAUDEXR_NO_MDNS: "1", CLAUDEXR_QUIET: "1", ...env }, stderr: "pipe" });
  const client = new Client({ name: "rv", version: "0" });
  await client.connect(transport);
  const errs = []; transport.stderr?.on("data", (d) => errs.push(String(d)));
  return { client, transport, errs, call: (name, args = {}, opts = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 600000, ...opts }), close: () => client.close() };
}
export function ws(port, { hello = true, device = "Sim", headers, onShow, maxPayload } = {}) {
  return new Promise((resolve, reject) => {
    const s = new WebSocket(`ws://127.0.0.1:${port}/headset`, { headers });
    s.msgs = [];
    s.on("message", (raw) => { const m = JSON.parse(raw.toString()); s.msgs.push(m); if (m.type === "show" && onShow) onShow(m, s); if (m.type === "welcome") resolve(s); });
    s.on("open", () => { if (hello) s.send(JSON.stringify({ type: "hello", protocol: 1, device })); else resolve(s); });
    s.on("error", reject);
  });
}
