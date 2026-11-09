// The MCP tools talk to an XrBackend. In the daemon the hub runs in-process (LocalBackend); the
// optional stdio fallback (`--stdio`) forwards to the running daemon over loopback HTTP
// (RemoteBackend). Transport (MCP over HTTP or stdio) and bridge logic (XrHub) stay separate.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { CommandResult, HubCommand, XrStatus } from "./protocol.js";
import { XrHub } from "./hub.js";
import { stateDir } from "./config.js";

export interface XrBackend {
  status(): Promise<XrStatus | null>;
  execute(cmd: HubCommand, signal?: AbortSignal): Promise<CommandResult>;
}

export class LocalBackend implements XrBackend {
  constructor(private readonly hub: XrHub) {}
  async status() {
    return this.hub.status();
  }
  execute(cmd: HubCommand, signal?: AbortSignal) {
    return this.hub.execute(cmd, signal);
  }
}

export class RemoteBackend implements XrBackend {
  constructor(private readonly localPort: number) {}
  async status() {
    try {
      return (await httpJson("GET", this.localPort, "/status")) as XrStatus;
    } catch {
      return null;
    }
  }
  async execute(cmd: HubCommand, signal?: AbortSignal) {
    try {
      return (await httpJson("POST", this.localPort, "/command", cmd, 0, signal)) as CommandResult;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ECONNREFUSED") return { status: "error" as const, data: { error: "ClaudeXR daemon is not running (see README: launchctl)" } };
      throw e;
    }
  }
}

/** The hub's loopback secret (created by the daemon; readable only by this user). */
export function readLocalToken(): string {
  try {
    return fs.readFileSync(path.join(stateDir(), "local-token"), "utf8").trim();
  } catch {
    return "";
  }
}

/** Minimal loopback JSON client (no timeout by default: xr_ask may wait for minutes). */
export function httpJson(method: string, port: number, pathname: string, body?: unknown, timeoutMs = 0, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method,
        signal,
        headers: { authorization: `Bearer ${readLocalToken()}`, ...(data ? { "content-type": "application/json" } : {}) },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(buf);
            if ((res.statusCode ?? 500) >= 400 && res.statusCode !== 400) reject(new Error(parsed.error ?? `HTTP ${res.statusCode}`));
            else resolve(parsed);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    if (timeoutMs > 0) req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
