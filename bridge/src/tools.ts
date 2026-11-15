// MCP tools. Kept deliberately small: short descriptions, compact schemas, short text replies.
// Template data shapes and usage guidance live in the xr-presenter skill (loaded only when needed).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CommandResult, HubCommand, LAYOUT_MODES, SCREEN_PRESETS, ROLES, SIZES, XrStatus } from "./protocol.js";
import { XrBackend } from "./backend.js";
import { TEMPLATES, Template, renderTemplate, renderText } from "./present.js";
import { BugStore, COMPONENTS, SEVERITIES } from "./devmode.js";
import { recentLog } from "./log.js";

const OFF = "XR not connected; use the terminal.";
const role = z.enum(ROLES).optional();
const size = z.enum(SIZES).optional();
// Default 110 s: Claude Code moves MCP calls running > 2 min to the background (review B3).
const secs = z.number().int().min(5).max(1800).optional();

type Reply = { content: { type: "text"; text: string }[]; isError?: boolean };
const say = (text: string, isError = false): Reply => ({ content: [{ type: "text", text }], ...(isError ? { isError } : {}) });

function fail(r: CommandResult): Reply | null {
  switch (r.status) {
    case "not_connected":
      return say(OFF);
    case "timeout":
      return say("No answer in XR (timeout); ask in the terminal.");
    case "dismissed":
      return say("User closed the panel without answering.");
    case "not_found":
      return say(`Not found: ${r.panelId ?? (r.data?.error as string) ?? ""}`, true);
    case "error":
      return say(`Error: ${String(r.data?.error ?? "unknown")}`, true);
    default:
      return null;
  }
}


export function statusLine(s: XrStatus | null): string {
  if (!s) return "XR bridge not running.";
  if (!s.connected) return `XR not connected${s.pairedDevices.length ? "" : " (no headset paired yet)"}.`;
  const panels = s.openPanels.map((p) => `${p.id} ${p.kind}/${p.role}${p.streamId ? ` stream:${p.streamId}` : ""}${p.minimized ? " min" : ""}${p.stale ? " stale" : ""} "${(p.title ?? "").slice(0, 40)}"`);
  const streams = s.streams.map((x) => `stream ${x.streamId} ${x.source ?? ""} ${x.state}${x.panelId ? ` panel ${x.panelId}` : ""} "${x.title.slice(0, 30)}"`);
  const d = s.display;
  const extra = d ? [`display: ${d.alwaysOn ? "always on" : "manual"}${d.suppressed ? " (stopped; restarts on reconnect/xr_stream display)" : ""}${d.dimEnabled ? `, dimming ${d.dimmed ? "ACTIVE" : "off now"}` : ""}; mic ${s.mic?.listening ? "listening" : "idle"}`] : [];
  if (s.helperMode && s.helperMode !== "shared") extra.push(`helper: ${s.helperMode}`);
  if (s.input?.enabled) extra.push(`input: ON (test mode, sink ${s.input.sink}: nothing reaches the Mac; ${s.input.delivered} mapped)`);
  if (s.audio && s.audio.state !== "off") extra.push(`audio: ${s.audio.state}${s.audio.state === "live" ? ` ${s.audio.kbps} kbit/s, dropped ${s.audio.dropped}` : ""}${s.audio.error ? ` (${s.audio.error})` : ""}`);
  if (s.mic?.panelOpen) extra.push('voice system/near-head "Röst" (push-to-talk panel in the headset; close with xr_panel close id:voice)');
  if (s.voice) extra.push(`voice: next spoken message goes ${{ channel: "to the voice channel", rewake: "to Claude at once (wakes the idle session)", working: "to Claude at the next tool step", queued: "with the next prompt (no session is working or waiting)" }[s.voice.route]}${s.voice.queued ? `, ${s.voice.queued} waiting` : ""}`);
  return [`XR connected: ${s.device} (app ${s.appVersion ?? "?"}), layout ${s.layoutMode}, ${s.openPanels.length} panel(s)`, ...panels, ...streams, ...extra].join("\n");
}

export function registerTools(server: McpServer, backend: XrBackend, opts: { devMode: boolean; bugs?: BugStore }) {
  const ms = (s: number | undefined, d: number) => (s ?? d) * 1000;
  // Review patch 03 (adapted): Esc in Claude Code cancels the wait (extra.signal), and long waits send
  // progress every 15 s so HTTP/idle timers see activity.
  type Extra = { signal?: AbortSignal; _meta?: { progressToken?: string | number }; sendNotification?: (n: never) => Promise<void> };
  const runner = (extra?: Extra) => (cmd: HubCommand) => {
    const p = backend.execute(cmd, extra?.signal);
    const token = extra?._meta?.progressToken;
    if (token === undefined || !extra?.sendNotification) return p;
    let n = 0;
    const t = setInterval(() => {
      extra.sendNotification!({ method: "notifications/progress", params: { progressToken: token, progress: ++n, message: "waiting for the user in XR" } } as never).catch(() => {});
    }, 15_000);
    return p.finally(() => clearInterval(t));
  };

  server.registerTool("xr_status", { description: "XR headset state and open panels.", inputSchema: {} }, async () =>
    say(statusLine(await backend.status())),
  );

  server.registerTool(
    "xr_ask",
    {
      description:
        "Ask user to pick 1 of 2-4 options as cards in their room; blocks until chosen (tap or spoken). Two options with url = side-by-side A/B. listen:true (no opts) = wait for a spoken reply, returns the text.",
      inputSchema: {
        q: z.string(),
        opts: z.array(z.union([z.string(), z.object({ label: z.string(), desc: z.string().optional(), url: z.string().optional() })])).min(2).max(4).optional(),
        ctx: z.string().optional(),
        listen: z.boolean().optional(),
        timeout: secs,
      },
    },
    async ({ q, opts: rawOpts, ctx, listen, timeout }, extra) => {
      const run = runner(extra as Extra);
      // Spoken text is untrusted input (it may be misheard or come from someone else): quote it, never obey it.
      const heard = (t: unknown) => `User said (speech, may be misheard): ${JSON.stringify(String(t ?? ""))}`;
      if (listen) {
        const r = await run({ op: "show", role: "primary", panel: { kind: "listen", prompt: q }, wait: true, timeoutMs: ms(timeout, 110) });
        const f = fail(r);
        if (f) return f;
        if (r.data?.error) return say(`No speech: ${r.data.error}. Ask in the terminal.`);
        return say(heard(r.data?.text));
      }
      if (!rawOpts) return say("opts (2-4) required unless listen:true", true);
      const opts = rawOpts;
      const o = opts.map((x) => (typeof x === "string" ? { label: x } : x));
      const withUrl = o.filter((x) => x.url);
      if (o.length === 2 && withUrl.length === 2) {
        const r = await run({
          op: "show",
          role: "compare",
          panel: { kind: "compare", question: q, a: { label: o[0].label, url: o[0].url! }, b: { label: o[1].label, url: o[1].url! }, wantChoice: true },
          wait: true,
          timeoutMs: ms(timeout, 110),
        });
        const f = fail(r);
        if (f) return f;
        const c = String(r.data?.choice);
        if (r.data?.choice === undefined && r.data?.text) return say(heard(r.data.text));
        return say(c === "a" ? `Chose A: "${o[0].label}"` : c === "b" ? `Chose B: "${o[1].label}"` : "Chose neither.");
      }
      const r = await run({
        op: "show",
        role: "primary",
        panel: { kind: "ask", question: q, options: o.map((x) => ({ label: x.label, description: x.desc })), context: ctx },
        wait: true,
        timeoutMs: ms(timeout, 110),
      });
      const f = fail(r);
      if (f) return f;
      if (r.data?.choiceIndex === undefined && r.data?.text !== undefined) return say(`No option matched. ${heard(r.data.text)}`);
      const i = Number(r.data?.choiceIndex);
      return o[i] ? say(`Chose ${i + 1}: "${o[i].label}"${r.data?.voice ? " (spoken)" : ""}`) : say(`Invalid choice ${r.data?.choiceIndex}`, true);
    },
  );

  server.registerTool(
    "xr_test",
    {
      description: "Ask user to try something (optional live url) with a checklist; blocks until works/broken.",
      inputSchema: { title: z.string(), steps: z.string(), url: z.string().optional(), checks: z.array(z.string()).max(8).optional(), timeout: secs },
    },
    async ({ title, steps, url, checks, timeout }, extra) => {
      const run = runner(extra as Extra);
      const list = checks ?? [];
      const r = await run({ op: "show", role: "primary", panel: { kind: "test", title, instructions: steps, url: url, checklist: list }, wait: true, timeoutMs: ms(timeout, 110) });
      const f = fail(r);
      if (f) return f;
      if (r.data?.verdict === "unknown") return say(`Spoken feedback (speech, may be misheard): ${JSON.stringify(String(r.data.note ?? ""))}`);
      const checked = Array.isArray(r.data?.checked) ? (r.data!.checked as boolean[]) : [];
      const lines = list.map((c, i) => `[${checked[i] ? "x" : " "}] ${c}`);
      return say([`${r.data?.verdict === "works" ? "WORKS" : "BROKEN"}`, ...lines].join("\n"));
    },
  );

  server.registerTool(
    "xr_show",
    {
      description: "Show a panel: type url (live page, localhost ok), html (self-contained, fallback), text/diff/log/md. Prefer xr_present for visuals.",
      inputSchema: {
        type: z.enum(["url", "html", "text", "diff", "log", "md"]),
        body: z.string().max(400_000),
        title: z.string().optional(),
        role,
        size,
        frame: z.enum(["phone", "tablet", "laptop"]).optional(),
      },
    },
    async ({ type, body, title, role, size, frame }, extra) => {
      const run = runner(extra as Extra);
      const panel =
        type === "url"
          ? ({ kind: "preview", url: body, title, size: size ?? "medium", device: frame ?? "none" } as const)
          : type === "html"
            ? ({ kind: "html", title: title ?? "", html: body, size: size ?? "medium" } as const)
            : ({ kind: "html", title: title ?? type, html: renderText(title ?? "", body, type), size: size ?? "medium", format: type } as const);
      const r = await run({ op: "show", role: role ?? (type === "url" || type === "html" ? "primary" : "log"), panel, wait: false, timeoutMs: 0 });
      return fail(r) ?? say(`Shown ${r.panelId}`);
    },
  );

  server.registerTool(
    "xr_present",
    {
      description: `Render compact JSON with a built-in visual template (shapes: xr-presenter skill). Templates: ${TEMPLATES.join(", ")}.`,
      inputSchema: { template: z.enum(TEMPLATES), data: z.record(z.any()), title: z.string().optional(), role, size, id: z.string().optional() },
    },
    async ({ template, data, title, role, size, id }, extra) => {
      const run = runner(extra as Extra);
      let html: string;
      try {
        html = renderTemplate(template as Template, data, title);
      } catch (e) {
        return say((e as Error).message, true);
      }
      if (id) {
        const r = await run({ op: "update", id, title, panel: { kind: "html", html } as never });
        return fail(r) ?? say(`Updated ${id}`);
      }
      const r = await run({ op: "show", role: role ?? "primary", panel: { kind: "html", title: title ?? template, html, size: size ?? (template === "dashboard" || template === "comparison" ? "wide" : "medium") }, wait: false, timeoutMs: 0 });
      return fail(r) ?? say(`Shown ${r.panelId}`);
    },
  );

  server.registerTool(
    "xr_panel",
    {
      description: "Manage panels: list | update (title/body/role/size/move m rel. to user) | close (id = panel or stream id | role | \"voice\" = the push-to-talk panel | \"all\" = every panel and window stream but NOT the Mac screen | \"everything\" = the Mac screen too, restores brightness) | layout (review|focus|present|tidy) | screen (preset cinema|bigger|smaller|farther|closer|reset = Mac screen as a big cinema screen straight ahead; never guess units). NOTE: move is ABSOLUTE metres from the user (forward 1.5 = 1.5 m in front), size is panel width/height in metres.",
      inputSchema: {
        action: z.enum(["list", "update", "close", "layout", "screen"]),
        preset: z.enum(SCREEN_PRESETS).optional(),
        id: z.string().optional(),
        role,
        title: z.string().optional(),
        body: z.string().optional(),
        size: z.object({ w: z.number(), h: z.number() }).optional(),
        move: z.object({ right: z.number(), up: z.number(), forward: z.number() }).optional(),
        mode: z.enum(LAYOUT_MODES).optional(),
      },
    },
    async (a, extra) => {
      const run = runner(extra as Extra);
      if (a.action === "list") return say(statusLine(await backend.status()));
      if (a.action === "layout") {
        const r = await run({ op: "layout", mode: a.mode ?? "review" });
        return fail(r) ?? say(`Layout ${a.mode ?? "review"}; minimized ${(r.data?.minimized as string[])?.length ?? 0}`);
      }
      if (a.action === "screen") {
        const r = await run({ op: "screen", preset: a.preset ?? "cinema" });
        return fail(r) ?? say(`Mac screen: ${a.preset ?? "cinema"}`);
      }
      if (a.action === "close") {
        const r = await run({ op: "clear", id: a.id, role: a.role });
        const n = (r.data?.cleared as string[])?.length ?? 0;
        const st = (r.data?.streamsStopped as string[])?.length ?? 0;
        return fail(r) ?? say(`Closed ${n}${st ? ` panel(s), stopped ${st} stream(s)` : ""}`);
      }
      if (!a.id) return say("update needs id", true);
      const r = await run({
        op: "update",
        id: a.id,
        role: a.role,
        title: a.title,
        panel: a.body !== undefined ? ({ body: a.body } as never) : undefined,
        widthM: a.size?.w,
        heightM: a.size?.h,
        placement: a.move ? { relative: a.move } : undefined,
      });
      return fail(r) ?? say(`Updated ${a.id}`);
    },
  );

  server.registerTool(
    "xr_stream",
    {
      description: "Mirror Mac to headset (view only). The Mac screen streams automatically while the headset is connected; window streams are added next to it (never replace it; max 4 streams). windows (list; [ask] = needs one tap on an XR approval card, [allowed] = no tap) | window id | display (restart) | stop [id|display|all|audio] (no id = window streams only) | calibrate | audio (Mac system audio to the headset, off until started; stop id:audio).",
      inputSchema: {
        action: z.enum(["windows", "window", "display", "stop", "calibrate", "audio"]),
        id: z.union([z.number(), z.string()]).optional(),
        width: z.number().optional(),
        fps: z.number().int().min(5).max(60).optional(),
        mbps: z.number().min(1).max(60).optional(),
      },
    },
    async ({ action, id, width, fps, mbps }, extra) => {
      const run = runner(extra as Extra);
      try {
        if (action === "windows") {
          const r = await run({ op: "list_windows" });
          const w = (r.data?.windows as { id: number; app: string; title?: string; access: string }[]) ?? [];
          const lines = w.map((x) => `${x.id} ${x.app}${x.title ? ` "${x.title.slice(0, 50)}"` : ""} [${x.access}]`);
          return say(lines.length ? [...lines, "[ask] = streaming needs one tap on an approval card in the headset (not a macOS permission). [allowed] = no tap."].join("\n") : "No windows.");
        }
        if (action === "audio") {
          const r = await run({ op: "audio_start" });
          return fail(r) ?? say("Mac audio starting (PCM 48 kHz stereo to the headset). Stop: xr_stream stop id:audio");
        }
        if (action === "stop" && id === "audio") {
          const r = await run({ op: "audio_stop" });
          return say(r.data?.stopped ? "Mac audio stopped" : "Mac audio was not running");
        }
        if (action === "stop") {
          const r = await run({ op: "stream_stop", streamId: id !== undefined ? String(id) : undefined });
          if (r.status === "not_found") return say(`Error: ${String(r.data?.error ?? "not found")}`, true);
          const n = (r.data?.stopped as string[])?.length ?? 0;
          return say(`Stopped ${n}${r.data?.displayKept ? " (the Mac screen stream stays on; stop id:display or all to end it)" : ""}`);
        }
        if (action === "calibrate") {
          const r = await run({ op: "calibrate", timeoutMs: 45_000 });
          return fail(r) ?? say(`Calibrated (${r.data?.detections ?? "?"} detections).`);
        }
        const r = await run({
          op: "stream_start",
          source: action,
          windowId: action === "window" ? Number(id) : undefined,
          displayId: action === "display" && id !== undefined ? Number(id) : undefined,
          widthM: width,
          fps,
          bitrateMbps: mbps,
          timeoutMs: 60_000,
        });
        if (r.status === "dismissed" && r.data?.error) return say(`Not approved: ${String(r.data.error)}`, true);
        return fail(r) ?? say(`Streaming ${r.data?.streamId} "${r.data?.title}" in panel ${r.panelId}${r.data?.replaced ? " (replaced the previous stream)" : ""}`);
      } catch (e) {
        return say((e as Error).message, true);
      }
    },
  );

  if (opts.devMode && opts.bugs) {
    const bugs = opts.bugs;
    server.registerTool(
      "xr_dev",
      {
        description: "Dev mode: bug | idea (short notes; context auto-attached) | list | export (handoff sv+en).",
        inputSchema: {
          action: z.enum(["bug", "idea", "list", "export"]),
          title: z.string().optional(),
          desc: z.string().optional(),
          comp: z.enum(COMPONENTS).optional(),
          sev: z.enum(SEVERITIES).optional(),
          prio: z.enum(["hög", "medel", "låg"]).optional(),
          steps: z.array(z.string()).optional(),
          exp: z.string().optional(),
          act: z.string().optional(),
        },
      },
      async (a) => {
        const ctx = async () => {
          const s = await backend.status();
          return { ...(s ? { connected: s.connected, appVersion: s.appVersion, bridgeVersion: s.bridge.version, paired: s.paired, panels: s.openPanels.map((p) => `${p.id} ${p.kind}/${p.role}`), latency: s.latency, lastHook: s.activity?.steps.slice(-3) } : { bridge: "unreachable" }), timestamp: new Date().toISOString(), recentLog: recentLog(30) };
        };
        if (a.action === "list") {
          const all = bugs.all();
          return say(all.map((r) => `${r.id} ${r.type} ${r.severity ?? r.priority ?? ""} ${r.component} ×${r.count}: ${r.title}`).join("\n") || "No reports.");
        }
        if (a.action === "export") {
          const s = await backend.status();
          const { file } = bugs.exportHandoff({ ...(await ctx()), recentLog: undefined, devices: s?.pairedDevices.length }, recentLog(60));
          return say(`Handoff written: ${file}`);
        }
        if (!a.title) return say("title required", true);
        const { report, duplicateOf } = bugs.add({
          type: a.action === "idea" ? "improvement" : "bug",
          title: a.title,
          component: a.comp ?? "okänd",
          severity: a.action === "bug" ? a.sev ?? "medel" : undefined,
          priority: a.action === "idea" ? a.prio ?? "medel" : undefined,
          description: a.desc,
          steps: a.steps,
          expected: a.exp,
          actual: a.act,
          motivation: a.action === "idea" ? a.desc : undefined,
          context: await ctx(),
        });
        return say(duplicateOf ? `Counted as repeat of ${duplicateOf}` : `Saved ${report.id}`);
      },
    );
  }
}
