// Live activity of Claude Code, fed by hooks (POST /event on the loopback port).
// Produces a small snapshot for the headset's status panel and toasts for "done"/"needs you".
import { ActivitySnapshot } from "./protocol.js";
import { maskSecrets } from "./mask.js";

const MAX_STEPS = 8;

export interface ActivityUpdate {
  snapshot: ActivitySnapshot;
  toast?: { text: string; level: "info" | "done" | "attention"; sound: boolean };
}

type Todo = ActivitySnapshot["todos"][number] & { id?: string };

export class ActivityTracker {
  private state: ActivitySnapshot["state"] = "idle";
  private todos: Todo[] = [];
  private steps: ActivitySnapshot["steps"] = [];
  private session?: string;
  private updatedAt = new Date().toISOString();
  lastEvent?: { at: string; event: string; summary: string };

  snapshot(): ActivitySnapshot {
    return {
      state: this.state,
      session: this.session,
      todos: this.todos.map(({ text, status }) => ({ text, status })),
      steps: [...this.steps],
      updatedAt: this.updatedAt,
    };
  }

  handle(e: Record<string, unknown>): ActivityUpdate | null {
    const ev = String(e.hook_event_name ?? "");
    const input = (e.tool_input ?? {}) as Record<string, unknown>;
    const tool = String(e.tool_name ?? "");
    this.session = typeof e.session_id === "string" ? e.session_id.slice(0, 8) : this.session;
    let toast: ActivityUpdate["toast"];

    switch (ev) {
      case "UserPromptSubmit":
        this.state = "working";
        this.step("Ny uppgift från dig");
        break;
      case "PreToolUse":
        this.state = "working";
        this.step(summarizeTool(tool, input));
        break;
      case "PostToolUse":
        this.state = "working";
        this.applyTodoTools(tool, input, (e.tool_response ?? {}) as Record<string, unknown>);
        break;
      case "PostToolUseFailure":
        this.step(`Fel i ${tool}`);
        break;
      case "TaskCreated":
        this.todos.push({ id: String(e.task_id ?? ""), text: maskSecrets(String(e.task_subject ?? "uppgift")), status: "pending" });
        break;
      case "TaskCompleted": {
        const t = this.todos.find((x) => x.id === String(e.task_id ?? ""));
        if (t) t.status = "completed";
        break;
      }
      case "Notification": {
        const type = String(e.notification_type ?? "");
        const msg = maskSecrets(String(e.message ?? "Claude behöver dig"));
        if (["permission_prompt", "idle_prompt", "agent_needs_input", "elicitation_dialog"].includes(type)) {
          this.state = "waiting";
          toast = { text: msg, level: "attention", sound: true };
          this.step(`Väntar: ${msg}`);
        }
        break;
      }
      case "Stop":
        this.state = "done";
        toast = { text: "Claude är klar", level: "done", sound: true };
        this.step("Klar");
        break;
      default:
        return null;
    }
    this.updatedAt = new Date().toISOString();
    this.lastEvent = { at: this.updatedAt, event: ev, summary: this.steps[this.steps.length - 1]?.text ?? ev };
    return { snapshot: this.snapshot(), toast };
  }

  private step(text: string) {
    this.steps.push({ at: new Date().toISOString(), text: maskSecrets(text).slice(0, 140) });
    if (this.steps.length > MAX_STEPS) this.steps.shift();
  }

  private applyTodoTools(tool: string, input: Record<string, unknown>, response: Record<string, unknown>) {
    if (tool === "TodoWrite" && Array.isArray(input.todos)) {
      this.todos = (input.todos as Record<string, unknown>[]).map((t) => ({
        text: maskSecrets(String(t.content ?? t.activeForm ?? "")),
        status: normStatus(t.status),
      }));
    } else if (tool === "TaskUpdate") {
      const id = String(input.taskId ?? input.task_id ?? input.id ?? "");
      const t = this.todos.find((x) => x.id === id);
      if (t && input.status) t.status = normStatus(input.status);
      if (t && typeof input.subject === "string") t.text = maskSecrets(input.subject);
    } else if (tool === "TaskCreate") {
      const id = String(response.taskId ?? response.id ?? "");
      const subject = maskSecrets(String(input.subject ?? input.title ?? "uppgift"));
      if (!this.todos.some((x) => (id && x.id === id) || x.text === subject)) this.todos.push({ id, text: subject, status: "pending" });
    }
  }
}

function normStatus(s: unknown): Todo["status"] {
  return s === "completed" || s === "in_progress" ? s : "pending";
}

/** One readable line per tool call, never the full content (and always masked). */
export function summarizeTool(tool: string, input: Record<string, unknown>): string {
  const short = (v: unknown, n = 80) => {
    const s = String(v ?? "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  };
  const base = (p: unknown) => String(p ?? "").split("/").slice(-2).join("/");
  switch (tool) {
    case "Bash":
      return `$ ${short(maskSecrets(String(input.command ?? "")))}`;
    case "Edit":
    case "MultiEdit":
      return `Redigerar ${base(input.file_path)}`;
    case "Write":
      return `Skriver ${base(input.file_path)}`;
    case "Read":
      return `Läser ${base(input.file_path)}`;
    case "Grep":
    case "Glob":
      return `Söker ${short(input.pattern, 50)}`;
    case "WebFetch":
    case "WebSearch":
      return `Webb: ${short(input.url ?? input.query, 60)}`;
    case "Agent":
    case "Task":
      return `Delagent: ${short(input.description, 60)}`;
    default:
      return tool.startsWith("mcp__") ? `Verktyg ${tool.split("__").slice(1).join(".")}` : tool;
  }
}
