import { test } from "node:test";
import assert from "node:assert/strict";
import { ActivityTracker, summarizeTool } from "../src/activity.js";
import { startBridge, startSim, nextPort, waitFor } from "./helpers.js";

test("activity tracker: steps, todos (TodoWrite + Task tools), toasts, masking", () => {
  const a = new ActivityTracker();
  a.handle({ hook_event_name: "UserPromptSubmit", session_id: "abcdef123456" });
  a.handle({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "API_TOKEN=supersecretvalue123 npm run deploy" } });
  a.handle({ hook_event_name: "PostToolUse", tool_name: "TodoWrite", tool_input: { todos: [{ content: "Build", status: "completed" }, { content: "Test", status: "in_progress" }] } });
  a.handle({ hook_event_name: "TaskCreated", task_id: "t1", task_subject: "Write docs" });
  a.handle({ hook_event_name: "TaskCompleted", task_id: "t1" });
  const n = a.handle({ hook_event_name: "Notification", notification_type: "permission_prompt", message: "Claude needs your permission" });
  assert.equal(n?.toast?.level, "attention");
  const s = a.handle({ hook_event_name: "Stop" })!;
  assert.equal(s.toast?.text, "Claude är klar");
  assert.equal(s.snapshot.state, "done");
  assert.deepEqual(s.snapshot.todos.map((t) => `${t.text}:${t.status}`), ["Build:completed", "Test:in_progress", "Write docs:completed"]);
  const all = JSON.stringify(s.snapshot);
  assert.equal(all.includes("supersecretvalue123"), false);
  assert.match(all, /API_TOKEN=\*\*\*/);
  assert.equal(summarizeTool("Edit", { file_path: "/Users/x/proj/src/app.ts" }), "Redigerar src/app.ts");
});

test("hook events reach the headset (status panel + toast) and auto panels need no model", async () => {
  const b = await startBridge(nextPort());
  const sim = await startSim(b);
  try {
    await b.local("/event", { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/a/b/c.ts" } });
    await waitFor(() => sim.lines.some((l) => l.startsWith("[sim] activity") && l.includes("Läser b/c.ts")));
    await b.local("/event", { hook_event_name: "Stop" });
    await waitFor(() => sim.lines.some((l) => l.startsWith("[sim] toast") && l.includes("Claude är klar")));
    await b.local("/event", { hook_event_name: "PostToolUse", tool_name: "Edit", file: "src/a.ts", diff_preview: "-old\n+new password=hunter2" });
    await waitFor(() => sim.lines.some((l) => l.startsWith("[sim] show html") && l.includes("Ändring: src/a.ts")));
    await b.local("/event", { hook_event_name: "PostToolUse", tool_name: "Edit", file: "src/b.ts", diff_preview: "+x" });
    await waitFor(() => sim.lines.some((l) => l.startsWith("[sim] update") && l.includes("Ändring: src/b.ts")));
    const st = await b.local("/status");
    assert.equal(st.openPanels.length, 1, "auto diff panel is reused, not duplicated");
  } finally {
    sim.close();
    await b.close();
  }
});
