// stdout belongs to the MCP stdio transport: all logging must go to stderr.
// The last lines are kept in memory for bug reports (dev mode), already secret-masked.
import { maskSecrets } from "./mask.js";

const RING_MAX = 200;
const ring: string[] = [];
type ErrorListener = (message: string) => void;
const errorListeners: ErrorListener[] = [];

export function log(...args: unknown[]) {
  const line = maskSecrets(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  ring.push(`${new Date().toISOString()} ${line}`);
  if (ring.length > RING_MAX) ring.shift();
  if (process.env.CLAUDEXR_QUIET === "1") return;
  console.error("[claudexr]", line);
}

/** Log an error and notify listeners (dev mode records these automatically as bug entries). */
export function logError(component: string, ...args: unknown[]) {
  log(`ERROR [${component}]`, ...args);
  const msg = maskSecrets(args.map(String).join(" "));
  for (const l of errorListeners) {
    try {
      l(`[${component}] ${msg}`);
    } catch {
      /* never let a listener break logging */
    }
  }
}

export function onError(l: ErrorListener) {
  errorListeners.push(l);
}

export function recentLog(n = 50): string[] {
  return ring.slice(-n);
}
