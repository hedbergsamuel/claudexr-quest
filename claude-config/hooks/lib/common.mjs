// Shared helpers for the ClaudeXR command-hook shims. All hook LOGIC lives in the bridge
// (bridge/src/hookapi.ts); these shims only forward the hook input to it. Preferred setup is
// `type: "http"` hooks pointing straight at the bridge (no Node start per call); see README.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PORT = Number(process.env.CLAUDEXR_PORT || 47800);
export const LOCAL_PORT = Number(process.env.CLAUDEXR_LOCAL_PORT || PORT + 1);
export const STATE_DIR = process.env.CLAUDEXR_STATE_DIR || path.join(os.homedir(), ".claudexr");

export function readStdin(maxWaitMs = 500) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("{}");
    let buf = "";
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => resolve(buf || "{}"));
    setTimeout(() => resolve(buf || "{}"), maxWaitMs);
  });
}

/** Secret for the bridge's loopback API (written by the bridge, mode 0600). */
export function localToken() {
  try {
    return fs.readFileSync(path.join(STATE_DIR, "local-token"), "utf8").trim();
  } catch {
    return "";
  }
}

/** POST raw hook input to the bridge. Resolves the parsed JSON or null on any error (timeoutMs 0 = none). */
export function forward(name, body, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: LOCAL_PORT,
        path: `/hook/${name}`,
        method: "POST",
        headers: { authorization: `Bearer ${localToken()}`, "content-type": "application/json" },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve(res.statusCode === 200 ? JSON.parse(buf) : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    if (timeoutMs > 0) req.setTimeout(timeoutMs, () => req.destroy());
    req.on("error", () => resolve(null));
    req.end(body);
  });
}

/** Run a shim: forward stdin, print the bridge's JSON output if it is non-empty. Never fails the hook. */
export async function runShim(name, timeoutMs) {
  try {
    const out = await forward(name, await readStdin(), timeoutMs);
    if (out && typeof out === "object" && Object.keys(out).length) process.stdout.write(JSON.stringify(out));
  } catch {}
  process.exit(0);
}
