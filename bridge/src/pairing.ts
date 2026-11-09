// Pairing between the bridge and a headset.
//
// 1. Unpaired headset connects over TLS (it records the server certificate fingerprint) and sends
//    {type:"pair_request", device}.
// 2. The bridge creates an 8-digit one-time code (valid 2 min, 5 attempts, bound to that connection)
//    and shows it ONLY on the Mac (notification + bridge log). It is never served over HTTP.
// 3. The user types the code in the headset; it sends {type:"pair_confirm", nonce, mac} where
//    mac = PBKDF2-SHA256(password=code, salt="claudexr-pair-v2|<fingerprint>|<nonce>", 200 000 it., 32 B) (hex).
//    The fingerprint binds the code to this TLS connection; the slow KDF makes an offline guess of the
//    code (active MITM during pairing) cost CPU-days instead of milliseconds.
// 4. The Mac asks for confirmation ("Pair headset X from 192.168.x.y?") before anything is stored.
// 5. On success the bridge returns a random token; only sha256(token) is stored (paired.json).
//    Later connections send {type:"hello", token}; the headset pins the certificate fingerprint.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { stateDir } from "./config.js";
import { log } from "./log.js";

export interface PairedDevice {
  deviceId: string;
  name: string;
  tokenHash: string;
  pairedAt: string;
  lastSeen?: string;
}

interface PendingCode {
  code: string;
  expires: number;
  attempts: number;
  device: string;
  /** the connection that asked for the code; only it may confirm */
  owner: unknown;
}

export const CODE_DIGITS = 8;
export const KDF_ITERATIONS = 200_000;
const CODE_TTL_MS = 120_000;
const MAX_ATTEMPTS = 5;
const MIN_CODE_INTERVAL_MS = 10_000;

export function pairingMac(code: string, fingerprint: string, nonce: string): Promise<string> {
  return new Promise((resolve, reject) =>
    crypto.pbkdf2(code, `claudexr-pair-v2|${fingerprint}|${nonce}`, KDF_ITERATIONS, 32, "sha256", (e, k) => (e ? reject(e) : resolve(k.toString("hex")))),
  );
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export class PairingStore {
  private file = path.join(stateDir(), "paired.json");
  private devices: PairedDevice[] = [];
  private pending: PendingCode | null = null;
  private lastCodeAt = 0;
  private perIp = new Map<string, number[]>();

  constructor(private readonly fingerprint: string) {
    try {
      this.devices = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      this.devices = [];
    }
  }

  list(): Omit<PairedDevice, "tokenHash">[] {
    return this.devices.map(({ tokenHash: _t, ...d }) => d);
  }

  /** Called when an unpaired headset asks to pair. Returns the code (also shown on the Mac). */
  /** Called when an unpaired headset asks to pair. The code is shown on the Mac only. */
  requestCode(device: string, owner: unknown, ip?: string): { expiresInS: number } | { error: string } {
    const now = Date.now();
    if (this.pending && this.pending.expires > now) {
      if (this.pending.owner !== owner) return { error: "busy" }; // someone else is pairing right now
      return { expiresInS: Math.round((this.pending.expires - now) / 1000) };
    }
    if (now - this.lastCodeAt < MIN_CODE_INTERVAL_MS) return { error: "rate_limited" };
    // Review 2 #17: at most 3 new codes per IP per 5 minutes (no notification spam from one host).
    const key = ip ?? "?";
    const recent = (this.perIp.get(key) ?? []).filter((t) => now - t < 300_000);
    if (recent.length >= 3) return { error: "rate_limited" };
    this.perIp.set(key, [...recent, now]);
    this.lastCodeAt = now;
    const code = crypto.randomInt(0, 10 ** CODE_DIGITS).toString().padStart(CODE_DIGITS, "0");
    this.pending = { code, expires: now + CODE_TTL_MS, attempts: 0, device, owner };
    announceCode(code, device, ip, shortFingerprint(this.fingerprint));
    return { expiresInS: CODE_TTL_MS / 1000 };
  }

  hasPendingCode(): boolean {
    return !!this.pending && this.pending.expires > Date.now();
  }

  /** Forget a pending code (e.g. its connection closed). */
  release(owner: unknown) {
    if (this.pending?.owner === owner) this.pending = null;
  }

  /** Verify the headset's proof, then ask the Mac user. Returns a fresh token on success. */
  async confirm(owner: unknown, device: string, nonce: string, mac: string, ip?: string): Promise<{ token: string; deviceId: string } | { error: string }> {
    const p = this.pending;
    if (!p || p.expires < Date.now()) return { error: "no_active_code" };
    if (p.owner !== owner) return { error: "not_your_code" };
    if (typeof nonce !== "string" || nonce.length < 16 || nonce.length > 128) return { error: "bad_nonce" };
    p.attempts++;
    if (p.attempts > MAX_ATTEMPTS) return { error: "too_many_attempts" };
    const expected = await pairingMac(p.code, this.fingerprint, nonce);
    const ok =
      typeof mac === "string" &&
      mac.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
    if (!ok) {
      if (p.attempts >= MAX_ATTEMPTS) this.pending = null;
      return { error: p.attempts >= MAX_ATTEMPTS ? "too_many_attempts" : "wrong_code" };
    }
    this.pending = null;
    if (!(await confirmOnMac(device, ip, shortFingerprint(this.fingerprint)))) {
      log(`pairing of "${device}" denied on the Mac`);
      return { error: "denied_on_mac" };
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const deviceId = crypto.randomUUID();
    this.devices.push({ deviceId, name: device || "headset", tokenHash: sha256(token), pairedAt: new Date().toISOString() });
    this.save();
    log(`paired new headset "${device}" (${deviceId})`);
    notify("ClaudeXR", `Nytt headset parkopplat: ${device}`);
    return { token, deviceId };
  }

  /** Check a token from hello. Returns the device or null. */
  authenticate(token: unknown): PairedDevice | null {
    if (typeof token !== "string" || token.length < 20) return null;
    const h = sha256(token);
    const d = this.devices.find((x) => crypto.timingSafeEqual(Buffer.from(x.tokenHash), Buffer.from(h)));
    if (d) {
      d.lastSeen = new Date().toISOString();
      this.save();
    }
    return d ?? null;
  }

  unpair(deviceId?: string): number {
    const before = this.devices.length;
    this.devices = deviceId ? this.devices.filter((d) => d.deviceId !== deviceId) : [];
    this.save();
    return before - this.devices.length;
  }

  private save() {
    fs.writeFileSync(this.file, JSON.stringify(this.devices, null, 2), { mode: 0o600 });
  }
}

/**
 * Short form of the certificate fingerprint (review 2 #16): shown on the Mac and in the headset during
 * pairing. If they match, no one is in the middle (the headset computes it from the certificate it sees).
 */
export function shortFingerprint(fp: string): string {
  const h = fp.slice(0, 8).toUpperCase();
  return `${h.slice(0, 4)}-${h.slice(4)}`;
}

function announceCode(code: string, device: string, ip?: string, fp?: string) {
  // Always printed to the bridge's own stderr (the daemon log), regardless of CLAUDEXR_QUIET:
  // this is the Mac-side display of the code. Never sent over the network or HTTP.
  const pretty = `${code.slice(0, 4)} ${code.slice(4)}`;
  // Log line goes to ~/Library/Logs/ClaudeXR (Umask 077 via install-daemon.sh), never to world-readable /tmp.
  console.error(`[claudexr] PAIRING CODE for "${device}"${ip ? ` (${ip})` : ""}: ${pretty} (valid 2 minutes; type it in the headset). Headset must show ID ${fp}`);
  notify("ClaudeXR parkoppling", `Kod: ${pretty} · från ${ip ?? device} · headsetet ska visa ID ${fp}`);
}

/**
 * Explicit consent on the Mac before a new headset is trusted. macOS: a dialog with "Neka" as the
 * default button (auto-denies after 60 s). Other platforms (tests/CI): only when
 * CLAUDEXR_PAIR_CONFIRM=auto is set.
 */
function confirmOnMac(device: string, ip?: string, fp?: string): Promise<boolean> {
  // 0.3.0: "auto" is honoured on macOS too, but ONLY with an overridden state dir (tests/sandboxes). Before,
  // test daemons on a Mac opened real "Parkoppla headset" dialogs on the user's screen.
  if (process.env.CLAUDEXR_PAIR_CONFIRM === "auto" && (process.platform !== "darwin" || !!process.env.CLAUDEXR_STATE_DIR)) return Promise.resolve(true);
  if (process.env.CLAUDEXR_PAIR_CONFIRM === "deny" && (process.platform !== "darwin" || !!process.env.CLAUDEXR_STATE_DIR)) return Promise.resolve(false);
  if (process.platform !== "darwin") return Promise.resolve(false);
  const esc = (s: string) => s.replace(/[\\"]/g, "").slice(0, 60);
  const script = `display dialog "Parkoppla headset \\"${esc(device)}\\"${ip ? ` från ${esc(ip)}` : ""} med ClaudeXR?\\n\\nKontrollera att headsetet visar ID ${fp ?? ""} (annars: Neka). Headsetet kommer att kunna visa paneler och godkänna Claudes åtgärder." buttons {"Neka", "Tillåt"} default button "Neka" with title "ClaudeXR" giving up after 60`;
  return new Promise((resolve) =>
    execFile("osascript", ["-e", script], { timeout: 65_000 }, (err, stdout) => resolve(!err && /button returned:Tillåt/.test(stdout) && !/gave up:true/.test(stdout))),
  );
}

/** macOS notification; silently ignored elsewhere or when disabled (tests). */
function notify(title: string, text: string) {
  if (process.platform !== "darwin" || process.env.CLAUDEXR_NO_NOTIFY === "1") return;
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  execFile("osascript", ["-e", `display notification "${esc(text)}" with title "${esc(title)}" sound name "Glass"`], () => {});
}
