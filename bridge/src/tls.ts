// Self-signed TLS identity of the bridge. The headset pins the certificate's SHA-256 fingerprint
// at pairing time, so no CA is involved. Generated once with the system openssl/LibreSSL.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { stateDir } from "./config.js";
import { log } from "./log.js";

export interface TlsIdentity {
  key: string;
  cert: string;
  /** Lowercase hex SHA-256 of the DER certificate (what the headset pins). */
  fingerprint: string;
}

export function loadOrCreateTls(): TlsIdentity {
  const dir = stateDir();
  const keyFile = path.join(dir, "bridge-key.pem");
  const certFile = path.join(dir, "bridge-cert.pem");
  if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) {
    log("creating TLS identity in", dir);
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyFile, "-out", certFile, "-days", "3650", "-subj", "/CN=claudexr-bridge"],
      { stdio: "ignore" },
    );
    fs.chmodSync(keyFile, 0o600);
  }
  const cert = fs.readFileSync(certFile, "utf8");
  return { key: fs.readFileSync(keyFile, "utf8"), cert, fingerprint: certFingerprint(cert) };
}

export function certFingerprint(pem: string): string {
  return new crypto.X509Certificate(pem).fingerprint256.replace(/:/g, "").toLowerCase();
}
