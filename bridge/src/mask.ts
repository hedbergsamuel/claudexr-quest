// Best-effort masking of secrets before anything is shown in XR, logged or written to bug reports.
// Keep in sync with claude-config/hooks/lib/mask.mjs (same test vectors in test/mask.test.ts).

const PATTERNS: [RegExp, string][] = [
  // Authorization headers (before the generic key=value rule)
  [/\b(Authorization\s*[:=]\s*)(Bearer\s+|Basic\s+|token\s+)?[^\s'"]+/gi, "$1$2***"],
  // key=value / key: value for secret-looking names
  [/\b([A-Za-z0-9_]{0,48}(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|AUTH)[A-Za-z0-9_]{0,48})(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"']+)/gi, "$1$2***"],
  // Authorization headers
  [/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 ***"],
  // Well-known token formats
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "sk-***"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "gh*_***"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "github_pat_***"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "xox*-***"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA***"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "AIza***"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "eyJ***(jwt)"],
  // URLs with credentials
  // Anchored + bounded scheme (review patch 12): the unanchored (\w+:\/\/) was O(n^2) on long word runs.
  [/\b([A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/)[^\s/:@]+:[^\s/@]+@/g, "$1***:***@"],
  // PEM blocks
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "-----PRIVATE KEY (masked)-----"],
];

export function maskSecrets(text: string): string {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Recursively mask all strings in a JSON-like value. */
export function maskDeep<T>(v: T): T {
  if (typeof v === "string") return maskSecrets(v) as T;
  if (Array.isArray(v)) return v.map(maskDeep) as T;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) o[k] = maskDeep(val);
    return o as T;
  }
  return v;
}
