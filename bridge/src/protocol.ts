// Wire protocol between the bridge and the Quest app (JSON text frames + binary video frames over WSS).
// Keep this file in sync with quest-app/.../Protocol.kt.

export const PROTOCOL_VERSION = 2;
export const WS_PATH = "/headset";
export const VIDEO_PATH = "/video";
export const MDNS_TYPE = "claudexr"; // advertised as _claudexr._tcp
export const DEFAULT_PORT = 47800; // TLS (LAN, headset only)
export const localPortFor = (port: number) => Number(process.env.CLAUDEXR_LOCAL_PORT || port + 1); // loopback HTTP

/** Layout roles. The headset app decides where each role lives in the room. */
export const ROLES = ["primary", "compare", "log", "side", "overlay"] as const;
export type Role = (typeof ROLES)[number];

export const SIZES = ["small", "medium", "large", "wide"] as const;
export type Size = (typeof SIZES)[number];

export const SCREEN_PRESETS = ["cinema", "bigger", "smaller", "farther", "closer", "reset"] as const;
export type ScreenPreset = (typeof SCREEN_PRESETS)[number];
export const LAYOUT_MODES = ["review", "focus", "present", "tidy"] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];

export interface AskOption {
  label: string;
  description?: string;
}

/** Panel payloads that the bridge asks the headset to show. */
export type PanelSpec =
  | { kind: "ask"; question: string; options: AskOption[]; context?: string }
  | { kind: "preview"; url: string; title?: string; size: Size; device?: "none" | "phone" | "tablet" | "laptop" }
  | {
      kind: "compare";
      title?: string;
      question?: string;
      a: { label: string; url: string };
      b: { label: string; url: string };
      wantChoice: boolean;
    }
  | { kind: "test"; title: string; instructions: string; url?: string; checklist: string[] }
  | { kind: "text"; title: string; content: string; format: "text" | "diff" | "log" | "markdown" }
  | { kind: "html"; title: string; html: string; size: Size; format?: "html" | "text" | "diff" | "log" | "md" }
  | {
      kind: "permission";
      title: string;
      tool: string;
      /** EXACTLY what will run / be written (never masked or clipped; review S2) */
      subject: string;
      detail?: string;
      diff?: string;
      /** suspicious patterns, shown prominently */
      warnings: string[];
    }
  | { kind: "stream"; title: string; streamId: string; source: "window" | "display"; app?: string; width: number; height: number }
  /** "Hold to talk" card for xr_ask listen:true */
  | { kind: "listen"; prompt: string }
  /** "Jag hörde: …" confirmation before a spoken answer is delivered (Skicka / Avbryt) */
  | { kind: "heard"; text: string; target: string; autoSendMs: number };

export type PanelKind = PanelSpec["kind"];

export interface PanelPlacement {
  /** metres in the app's world space (LOCAL_FLOOR), as reported by the headset */
  position?: { x: number; y: number; z: number };
  /** metres relative to the user's current head pose (yaw only): used by xr_update_panel */
  relative?: { right: number; up: number; forward: number };
  yawDeg?: number;
}

export interface PanelInfo {
  id: string;
  kind: PanelKind;
  role: Role;
  title?: string;
  awaiting: boolean;
  size?: { widthM: number; heightM: number };
  placement?: PanelPlacement;
  movedByUser: boolean;
  createdAt: string;
  updatedAt: string;
  /** not updated for a while: candidate for closing */
  stale: boolean;
  minimized: boolean;
  /** stream panels only */
  streamId?: string;
}

// ---- bridge -> headset ----
export type BridgeToHeadset =
  | { type: "welcome"; protocol: number; server: string; host: string; bridgeVersion: string; devMode: boolean; open: string[] }
  | { type: "pair_code_shown"; expiresInS: number }
  | { type: "pair_ok"; token: string; deviceId: string }
  | { type: "pair_failed"; reason: string }
  | { type: "unauthorized"; reason: string }
  | { type: "show"; id: string; role: Role; awaitingResponse: boolean; panel: PanelSpec }
  | { type: "update"; id: string; role?: Role; panel?: PanelSpec; widthM?: number; heightM?: number; placement?: PanelPlacement }
  | { type: "clear"; id?: string; role?: Role }
  | { type: "layout"; mode: LayoutMode; ids?: string[] }
  | { type: "screen_preset"; preset: ScreenPreset }
  | { type: "activity"; activity: ActivitySnapshot }
  | { type: "toast"; text: string; level: "info" | "done" | "attention"; sound: boolean }
  | { type: "stream_state"; streamId: string; state: "starting" | "live" | "paused" | "stopped" | "error"; reason?: string; width?: number; height?: number }
  | { type: "calibrate"; requestId: string; payload: string; modules: number; markerSizeM: number; screen: ScreenGeometry; seconds: number }
  | { type: "ping"; t: number }
  | { type: "recenter" }
  /** 0.4.0: open/close the near voice panel (BUG-8324e4: it could not be closed from Claude's side) */
  | { type: "voice_panel"; open: boolean }
  /** 0.3.0: every panel id the bridge knows (streams included). The headset removes any other panel (orphan sweeper). */
  | { type: "sync"; ids: string[] }
  /** 0.3.0: voice pipeline state for the near-head voice panel (listening -> transcribing -> preview -> sent|queued). */
  | { type: "voice_state"; id?: string; state: VoiceUiState; text?: string; target?: string; detail?: string; autoSendMs?: number }
  /** 0.3.0: always-visible status line (what is streamed, mic, dimming). */
  | { type: "hud"; text: string; streams: HudStream[]; micListening: boolean; dimmed: boolean; displayState: "live" | "starting" | "paused" | "off" | "error" };

export type VoiceUiState = "idle" | "listening" | "transcribing" | "preview" | "sent" | "queued" | "cancelled" | "error";

export interface HudStream {
  streamId: string;
  title: string;
  source: "window" | "display";
  state: "starting" | "live" | "paused" | "stopped" | "error";
}

export interface ScreenGeometry {
  widthM: number;
  heightM: number;
  /** marker centre relative to the screen centre, metres, +x right, +y up */
  markerOffsetM: { x: number; y: number };
  widthPx: number;
  heightPx: number;
}

// ---- headset -> bridge ----
export type HeadsetToBridge =
  | { type: "hello"; protocol: number; token?: string; device?: string; app?: string; appVersion?: string }
  | { type: "pair_request"; device?: string }
  | { type: "pair_confirm"; device?: string; nonce: string; mac: string }
  | { type: "response"; id: string; data: Record<string, unknown> }
  | { type: "dismissed"; id: string }
  | { type: "panel_moved"; id: string; placement: PanelPlacement; widthM?: number; heightM?: number }
  | { type: "calibration_result"; requestId: string; ok: boolean; error?: string; detections?: number; residualPx?: number }
  | { type: "pong"; t: number }
  | { type: "app_log"; level: "info" | "warn" | "error"; message: string }
  | { type: "request_calibration" }
  /** 0.3.0: user confirmed (send=true) or cancelled the previewed transcript */
  | { type: "voice_decision"; id: string; send: boolean }
  /** 0.3.0: panic button: close every panel and stream, restore brightness */
  | { type: "emergency_close" }
  | { type: "close_others" }
  /** 0.4.0: the near voice panel was opened/closed in the headset (so xr_panel list shows it and close id:voice works) */
  | { type: "voice_panel"; open: boolean }
  /** 0.3.0: "Starta skärmen": (re)start the always-on display stream */
  | { type: "restart_display" };

/** Outcome of a command, as seen by the MCP tools. */
export type CommandStatus = "answered" | "shown" | "updated" | "cleared" | "dismissed" | "timeout" | "not_connected" | "not_found" | "error";

export interface CommandResult {
  status: CommandStatus;
  panelId?: string;
  data?: Record<string, unknown>;
}

export interface ActivitySnapshot {
  state: "idle" | "working" | "waiting" | "done";
  session?: string;
  todos: { text: string; status: "pending" | "in_progress" | "completed" }[];
  steps: { at: string; text: string }[];
  updatedAt: string;
}

export interface XrStatus {
  connected: boolean;
  paired: boolean;
  device?: string;
  app?: string;
  appVersion?: string;
  connectedSince?: string;
  remoteAddress?: string;
  openPanels: PanelInfo[];
  layoutMode: LayoutMode;
  pairedDevices: { deviceId: string; name: string; pairedAt: string; lastSeen?: string }[];
  devMode: boolean;
  latency: { wsRttMs?: number; lastAskRoundTripMs?: number };
  activity?: ActivitySnapshot;
  streams: { streamId: string; title: string; state: string; source?: string; panelId?: string; maxWidth?: number; kbps?: number; sent?: number; dropped?: number; rttMs?: number }[];
  /** 0.3.0 */
  display?: { alwaysOn: boolean; suppressed: boolean; approved: boolean; dimmed: boolean; dimEnabled: boolean };
  mic?: { listening: boolean; panelOpen?: boolean };
  /** 0.4.0: spoken messages waiting for Claude and where the next one would go (see voiceroute.ts) */
  voice?: { queued: number; route: "channel" | "rewake" | "working" | "queued"; waiters: number };
  /** 0.4.0: "shared" (one helper process, several streams) or "perStream ..." (old helper / rollback) */
  helperMode?: string;
  bridge: { version: string; host: string; port: number; localPort: number; lanAddresses: string[]; mdnsType: string; pid: number; tlsFingerprint: string };
}

/** A command as sent from the MCP layer to the hub (possibly over loopback HTTP from a second bridge process). */
export type HubCommand =
  | { op: "show"; role: Role; panel: PanelSpec; wait: boolean; timeoutMs: number; widthM?: number; heightM?: number }
  | { op: "clear"; id?: string; role?: Role }
  | { op: "update"; id: string; role?: Role; title?: string; panel?: Partial<PanelSpec>; widthM?: number; heightM?: number; placement?: PanelPlacement }
  | { op: "layout"; mode: LayoutMode }
  | { op: "screen"; preset: ScreenPreset }
  | { op: "event"; event: Record<string, unknown> }
  | { op: "list_windows" }
  | { op: "stream_start"; source: "window" | "display"; windowId?: number; displayId?: number; widthM?: number; fps?: number; bitrateMbps?: number; maxWidth?: number; role?: Role; timeoutMs: number }
  /** streamId: stream id | panel id | "display" | "all" | omitted (= all window streams; the display stream stays) */
  | { op: "stream_stop"; streamId?: string }
  /** 0.3.0 emergency/cleanup: close every panel and stream (display too), restore brightness */
  | { op: "emergency" }
  /** voice channel (stdio) polls confirmed spoken messages that no question was waiting for */
  | { op: "voice_take" }
  | { op: "calibrate"; timeoutMs: number }
  | { op: "unpair"; deviceId?: string };
