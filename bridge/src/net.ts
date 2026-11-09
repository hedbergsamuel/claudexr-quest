import os from "node:os";

/** Non-internal IPv4 addresses of this machine (Wi-Fi first on macOS: en0). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  const ifaces = os.networkInterfaces();
  const names = Object.keys(ifaces).sort((a, b) => (a === "en0" ? -1 : b === "en0" ? 1 : a.localeCompare(b)));
  for (const name of names) {
    for (const addr of ifaces[name] ?? []) {
      if (addr.family === "IPv4" && !addr.internal) out.push(addr.address);
    }
  }
  return out;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

/**
 * The headset cannot reach "localhost" on the Mac, so rewrite such URLs to the Mac's LAN address.
 * The dev server itself must listen on all interfaces (e.g. `vite --host`).
 */
export function rewriteLocalUrl(url: string, lanHost: string | undefined): string {
  if (!lanHost) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (LOCAL_HOSTS.has(u.hostname)) {
    u.hostname = lanHost;
    return u.toString();
  }
  return url;
}
