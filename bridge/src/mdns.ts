// Advertise the bridge on the local network as _claudexr._tcp so the Quest app finds the Mac
// without typing an IP address (Android NsdManager, service type "_claudexr._tcp.").
import os from "node:os";
import { Bonjour } from "bonjour-service";
import { MDNS_TYPE, PROTOCOL_VERSION, WS_PATH } from "./protocol.js";
import { log } from "./log.js";

export interface MdnsHandle {
  stop(): Promise<void>;
}

export function publishMdns(port: number, fingerprint: string): MdnsHandle {
  const bonjour = new Bonjour();
  const name = `ClaudeXR ${os.hostname().replace(/\.local$/, "")}`;
  const service = bonjour.publish({
    name,
    type: MDNS_TYPE,
    port,
    // tls=1: the headset must use wss://. fp: first 16 hex chars of the cert fingerprint (informational;
    // the headset pins the full fingerprint from the TLS handshake at pairing time).
    txt: { v: String(PROTOCOL_VERSION), path: WS_PATH, tls: "1", fp: fingerprint.slice(0, 16) },
  });
  service.on("up", () => log(`mDNS: advertising "${name}" as _${MDNS_TYPE}._tcp on port ${port}`));
  service.on("error", (e: Error) => log("mDNS error:", e.message));
  return {
    stop: () =>
      new Promise<void>((resolve) => {
        bonjour.unpublishAll(() => {
          bonjour.destroy();
          resolve();
        });
      }),
  };
}
