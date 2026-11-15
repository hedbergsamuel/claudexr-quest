// 0.4.1 (punkt 8, IDE-8fc855 / IDE-a56e94): which program talks to the headset for install / launch / wired mode.
//
//   adb     Android platform-tools (what README used up to 0.4.0)
//   metavr  Meta VR CLI (formerly hzdb); talks the ADB protocol with its own library, no separate adb needed
//   hzdb    the permanent alias of metavr (npm @meta-quest/hzdb)
//
// This module only BUILDS argument lists. Nothing here runs a program: the CLI `quest-cmds` prints them for the user
// to run. Sources: bugs/META-MCP-UNDERSOKNING.md. Every command carries `confirmed`:
//   true  = documented by Meta (metavr devices-and-apps page) or plain adb
//   false = NOT CONFIRMED. In particular `reverse` through metavr/hzdb: Meta's page does not document it; only a
//           third-party copy of the hzdb skill lists `adb reverse`. Check `hzdb adb --help` before relying on it.
//
// Wired mode = the headset reaches the bridge over the USB cable: `reverse tcp:47800 tcp:47800` makes the headset's
// 127.0.0.1:47800 the Mac's :47800, and the app is started with bridge_url=wss://127.0.0.1:47800/headset (Bonjour
// does not work over USB). The certificate is pinned by fingerprint, so the host name 127.0.0.1 does not matter
// (unverified in the headset). Limitation: preview URLs that the bridge rewrites to "the address the headset
// connected to" become 127.0.0.1 too, and only port 47800 is reversed.
import { DEFAULT_PORT } from "./protocol.js";

export type DeviceTool = "adb" | "metavr" | "hzdb";
export const DEVICE_TOOLS: DeviceTool[] = ["adb", "metavr", "hzdb"];
export const QUEST_PACKAGE = "com.claudexr.quest";
export const QUEST_ACTIVITY = `${QUEST_PACKAGE}/.MainActivity`;

export type DeviceAction = "devices" | "install" | "launch" | "launch-wired" | "reverse" | "reverse-remove" | "wifi-enable" | "wifi-connect";
export const DEVICE_ACTIONS: DeviceAction[] = ["devices", "install", "launch", "launch-wired", "reverse", "reverse-remove", "wifi-enable", "wifi-connect"];

export interface DeviceCommand {
  action: DeviceAction;
  argv: string[];
  confirmed: boolean;
  note?: string;
}

export interface DeviceOpts {
  apk?: string;
  /** bridge URL for "launch" (LAN mode); default: none (the app finds the Mac via Bonjour) */
  bridgeUrl?: string;
  /** headset IP for "wifi-connect" */
  ip?: string;
  port?: number;
}

export function parseDeviceTool(v: string | undefined): DeviceTool | undefined {
  const t = (v ?? "").trim().toLowerCase();
  return (DEVICE_TOOLS as string[]).includes(t) ? (t as DeviceTool) : undefined;
}

const UNCONFIRMED_REVERSE = "NOT CONFIRMED: reverse via metavr/hzdb is not in Meta's docs; check `<tool> adb --help` first. Fallback: plain adb reverse.";

/** One command for one tool. Pure: returns argv, runs nothing. */
export function deviceCommand(tool: DeviceTool, action: DeviceAction, o: DeviceOpts = {}): DeviceCommand {
  const port = o.port ?? DEFAULT_PORT;
  const apk = o.apk ?? "app/build/outputs/apk/debug/app-debug.apk";
  const wiredUrl = `wss://127.0.0.1:${port}/headset`;
  const start = (url?: string) => ["shell", "am", "start", "-n", QUEST_ACTIVITY, ...(url ? ["--es", "bridge_url", url] : [])];
  if (tool === "adb") {
    switch (action) {
      case "devices":
        return { action, argv: ["adb", "devices"], confirmed: true };
      case "install":
        return { action, argv: ["adb", "install", "-r", apk], confirmed: true };
      case "launch":
        return { action, argv: ["adb", ...start(o.bridgeUrl)], confirmed: true };
      case "launch-wired":
        return { action, argv: ["adb", ...start(wiredUrl)], confirmed: true, note: "run reverse first" };
      case "reverse":
        return { action, argv: ["adb", "reverse", `tcp:${port}`, `tcp:${port}`], confirmed: true };
      case "reverse-remove":
        return { action, argv: ["adb", "reverse", "--remove", `tcp:${port}`], confirmed: true };
      case "wifi-enable":
        return { action, argv: ["adb", "tcpip", "5555"], confirmed: true, note: "needs the USB cable once" };
      case "wifi-connect":
        return { action, argv: ["adb", "connect", `${o.ip ?? "<headset-ip>"}:5555`], confirmed: true };
    }
  }
  // metavr and hzdb take the same arguments (hzdb is the permanent alias).
  switch (action) {
    case "devices":
      return { action, argv: [tool, "adb", "devices"], confirmed: false, note: "via the documented `adb` passthrough; a dedicated device list command was not in the sources" };
    case "install":
      return { action, argv: [tool, "app", "install", "-r", apk], confirmed: true };
    case "launch":
      // `app launch` is documented but passing the bridge_url extra is not: use the documented `shell` instead.
      return o.bridgeUrl
        ? { action, argv: [tool, ...start(o.bridgeUrl)], confirmed: true, note: "documented `shell`; `app launch` cannot pass extras" }
        : { action, argv: [tool, "app", "launch", QUEST_PACKAGE], confirmed: true };
    case "launch-wired":
      return { action, argv: [tool, ...start(wiredUrl)], confirmed: true, note: "run reverse first" };
    case "reverse":
      return { action, argv: [tool, "adb", "reverse", `tcp:${port}`, `tcp:${port}`], confirmed: false, note: UNCONFIRMED_REVERSE };
    case "reverse-remove":
      return { action, argv: [tool, "adb", "reverse", "--remove", `tcp:${port}`], confirmed: false, note: UNCONFIRMED_REVERSE };
    case "wifi-enable":
      return { action, argv: [tool, "device", "wifi", "enable"], confirmed: true, note: "probably needs the USB cable once (unconfirmed)" };
    case "wifi-connect":
      return { action, argv: [tool, "device", "connect", o.ip ?? "<headset-ip>"], confirmed: true };
  }
}

/** Shell-quoted, for printing only. */
export function shellLine(argv: string[]): string {
  return argv.map((a) => (/^[\w@%+=:,./<>-]+$/.test(a) && !/[<>]/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(" ");
}
