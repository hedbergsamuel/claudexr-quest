// Runtime configuration and on-disk state locations.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickWhisperModel, type VoiceConfig } from "./voice.js";
import { parseDeviceTool, type DeviceTool } from "./devicetool.js";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Root of the "Meta XR" folder (bridge/dist/src -> bridge/src -> root). */
export const PROJECT_ROOT = path.resolve(here, fs.existsSync(path.join(here, "..", "package.json")) ? "../.." : "../../..");

export const BRIDGE_VERSION = "0.4.1";

/** "~/x" -> "<home>/x" (config paths are not passed through a shell, so "~" is never expanded otherwise). */
export function expandHome(p: string): string;
export function expandHome(p: string | undefined): string | undefined;
export function expandHome(p: string | undefined): string | undefined {
  if (!p) return p;
  return p === "~" ? os.homedir() : p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

/**
 * A bare program name ("whisper-cli") is looked up in PATH and in the Homebrew prefixes: a launchd agent
 * starts with PATH=/usr/bin:/bin:/usr/sbin:/sbin and would not find Homebrew tools (review 2 R2-03).
 */
export function resolveBin(name: string, extraDirs = ["/opt/homebrew/bin", "/usr/local/bin"]): string {
  const p = expandHome(name);
  if (p.includes("/")) return p;
  for (const dir of [...(process.env.PATH ?? "").split(path.delimiter), ...extraDirs]) {
    if (!dir) continue;
    const f = path.join(dir, p);
    try {
      fs.accessSync(f, fs.constants.X_OK);
      return f;
    } catch {}
  }
  return p;
}

export function stateDir(): string {
  const dir = process.env.CLAUDEXR_STATE_DIR || path.join(os.homedir(), ".claudexr");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export interface StreamPolicy {
  /** Apps that Claude may stream without asking (match on bundle id or app name, case-insensitive). */
  allowApps: string[];
  /** Apps that can never be streamed, not even with approval. */
  excludeApps: string[];
}

/** 0.3.0: the Mac screen is always streamed (anchored over the physical screen) and the physical panel is dimmed. */
export interface DisplayConfig {
  /** keep a display stream running whenever the headset is connected (auto-restart on errors) */
  alwaysOn: boolean;
  /** "once" = one tap in XR per daemon run, then it restarts silently; "never" = no tap (the config is the consent) */
  approval: "once" | "never";
  /** dim the physical display to dimLevel while the display stream is live (original value is restored; see brightness.ts) */
  dim: boolean;
  dimLevel: number;
}

export interface XrConfig {
  devMode: boolean;
  display: DisplayConfig;
  /** hard limit of simultaneous streams (display + windows) */
  maxStreams: number;
  /** 0.4.0: "shared" = one helper process for all streams (default); "perStream" = 0.3.x behaviour (rollback) */
  helperMode: "shared" | "perStream";
  stream: StreamPolicy;
  bugsDir: string;
  captureBin: string;
  /** bridge-owned panels fed by hooks: latest diff + latest test output */
  autoPanels: boolean;
  /** offer PermissionRequest approvals in XR (off switch: false here or <stateDir>/permissions-off) */
  xrPermissions: boolean;
  permissionTimeoutS: number;
  voice: VoiceConfig;
  /** 0.4.1 (punkt 8): program for headset install/launch/wired mode: adb (default) | metavr | hzdb. Only printed, never run by the bridge. */
  deviceTool: DeviceTool;
}

export const DEFAULT_STREAM_POLICY: StreamPolicy = {
  allowApps: [
    "com.microsoft.VSCode", "Visual Studio Code", "Code",
    "com.apple.Terminal", "Terminal",
    "com.googlecode.iterm2", "iTerm2", "iTerm",
    "com.apple.dt.Xcode", "Xcode",
    "com.google.android.studio", "Android Studio",
  ],
  excludeApps: [
    // password managers
    "com.1password.1password", "com.agilebits.onepassword7", "1Password", "1Password 7",
    "com.bitwarden.desktop", "Bitwarden", "com.lastpass.LastPass", "LastPass",
    "com.dashlane.dashlanephonefinal", "Dashlane", "in.sinew.Enpass-Desktop", "Enpass",
    "com.apple.Passwords", "Passwords", "Lösenord", "com.apple.keychainaccess", "Keychain Access", "Nyckelringsåtkomst",
    // communication
    "com.apple.MobileSMS", "Messages", "Meddelanden", "com.apple.mail", "Mail",
    // system auth dialogs
    "com.apple.SecurityAgent", "SecurityAgent", "com.apple.LocalAuthentication.UIAgent",
  ],
};

/**
 * Config file: <stateDir>/config.json (created with defaults on first run, user-editable).
 * XR_DEV_MODE env (0/1, false/true) overrides config.devMode.
 */
export function loadConfig(): XrConfig {
  const file = path.join(stateDir(), "config.json");
  let raw: Partial<{ deviceTool: string; helperMode: string; devMode: boolean; display: Partial<DisplayConfig>; maxStreams: number; stream: Partial<StreamPolicy>; bugsDir: string; captureBin: string; autoPanels: boolean; xrPermissions: boolean; permissionTimeoutS: number; voice: Partial<VoiceConfig> }> = {};
  if (fs.existsSync(file)) {
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      raw = {};
    }
  } else {
    const initial = { devMode: true, autoPanels: true, stream: DEFAULT_STREAM_POLICY };
    try {
      fs.writeFileSync(file, JSON.stringify(initial, null, 2) + "\n", { mode: 0o600 });
    } catch {
      /* read-only home: use defaults */
    }
  }
  const env = process.env.XR_DEV_MODE;
  const devMode = env !== undefined ? !/^(0|false|off|no)$/i.test(env) : raw.devMode ?? true;
  return {
    devMode,
    stream: {
      allowApps: raw.stream?.allowApps ?? DEFAULT_STREAM_POLICY.allowApps,
      // The default exclusions always apply; the config file can only add to them.
      excludeApps: [...new Set([...DEFAULT_STREAM_POLICY.excludeApps, ...(raw.stream?.excludeApps ?? [])])],
    },
    display: {
      alwaysOn: process.env.CLAUDEXR_ALWAYS_DISPLAY ? process.env.CLAUDEXR_ALWAYS_DISPLAY !== "0" : raw.display?.alwaysOn ?? true,
      approval: (process.env.CLAUDEXR_DISPLAY_APPROVAL ?? raw.display?.approval) === "never" ? "never" : "once",
      dim: process.env.CLAUDEXR_DIM ? process.env.CLAUDEXR_DIM !== "0" : raw.display?.dim ?? true,
      dimLevel: Math.max(0, Math.min(0.5, Number(raw.display?.dimLevel ?? 0))),
    },
    maxStreams: Math.max(1, Math.min(8, Number(process.env.CLAUDEXR_MAX_STREAMS ?? raw.maxStreams ?? 4))),
    helperMode: (process.env.CLAUDEXR_HELPER_MODE ?? raw.helperMode) === "perStream" ? "perStream" : "shared",
    deviceTool: parseDeviceTool(process.env.CLAUDEXR_DEVICE_TOOL ?? raw.deviceTool) ?? "adb",
    voice: {
      engine: (process.env.CLAUDEXR_STT_ENGINE as VoiceConfig["engine"]) || raw.voice?.engine || "whisper-cpp",
      whisperBin: resolveBin(process.env.CLAUDEXR_WHISPER_BIN || raw.voice?.whisperBin || "whisper-cli"), // brew install whisper-cpp
      // 0.4.0: without an explicit choice, the best model found in <state>/models (Swedish-tuned or larger before base).
      whisperModel: expandHome(process.env.CLAUDEXR_WHISPER_MODEL || raw.voice?.whisperModel || pickWhisperModel(path.join(stateDir(), "models")) || path.join(stateDir(), "models", "ggml-base.bin")),
      command: process.env.CLAUDEXR_STT_COMMAND || raw.voice?.command,
      autoSendMs: Number(process.env.CLAUDEXR_VOICE_AUTOSEND_MS ?? raw.voice?.autoSendMs ?? 0),
      maxSeconds: raw.voice?.maxSeconds ?? 30,
      timeoutMs: Number(process.env.CLAUDEXR_VOICE_TIMEOUT_MS ?? raw.voice?.timeoutMs ?? 25_000),
      fast: raw.voice?.fast ?? true,
      // 0.4.0: "sv" by default. "auto" guessed wrong on short clips ("Macen syns" -> "Ja, maken sings"); set "auto" or "en" in config.json if you speak English.
      language: process.env.CLAUDEXR_VOICE_LANGUAGE || raw.voice?.language || "sv",
      vocabulary: raw.voice?.vocabulary,
      corrections: raw.voice?.corrections,
      previewTimeoutMs: raw.voice?.previewTimeoutMs ?? 120_000,
      channel: process.env.CLAUDEXR_VOICE_CHANNEL ? process.env.CLAUDEXR_VOICE_CHANNEL === "1" : raw.voice?.channel === true,
    },
    xrPermissions: process.env.CLAUDEXR_XR_PERMISSIONS ? process.env.CLAUDEXR_XR_PERMISSIONS !== "0" : raw.xrPermissions ?? true,
    permissionTimeoutS: Number(process.env.CLAUDEXR_PERMISSION_TIMEOUT || raw.permissionTimeoutS || 120),
    autoPanels: process.env.CLAUDEXR_AUTO_PANELS ? process.env.CLAUDEXR_AUTO_PANELS === "1" : raw.autoPanels ?? true,
    bugsDir: expandHome(process.env.CLAUDEXR_BUGS_DIR || raw.bugsDir || path.join(PROJECT_ROOT, "bugs")),
    captureBin: expandHome(
      process.env.CLAUDEXR_CAPTURE_BIN || raw.captureBin || path.join(PROJECT_ROOT, "mac-helper", ".build", "release", "claudexr-capture"),
    ),
  };
}
