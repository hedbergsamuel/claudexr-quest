import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTemplate, renderText, TEMPLATES, Template } from "../src/present.js";

const SAMPLES: Record<Template, Record<string, unknown>> = {
  dashboard: { kpis: [{ label: "Users", value: "1 204", delta: "+12%" }, { label: "Errors", value: 3, delta: "-2", good: true }], charts: [{ type: "bar", title: "Per day", labels: ["Mo", "Tu"], values: [3, 5] }, { type: "pie", labels: ["A", "B"], values: [1, 3] }], conclusion: "Growing" },
  kpi: { value: "42 ms", label: "p95 latency", delta: "-8 ms", good: true },
  comparison: { a: { title: "REST", points: ["simple"] }, b: { title: "gRPC", points: ["fast"], tag: "Recommended" }, verdict: "B" },
  timeline: { items: [{ when: "Mon", title: "Design", done: true }, { when: "Tue", title: "Build" }] },
  flow: { steps: ["Fetch", { title: "Parse", detail: "JSON" }, "Render"] },
  slides: { slides: [{ title: "Intro", bullets: ["a", "b"] }, { title: "End", bullets: ["c"], note: "fin" }] },
  "choice-cards": { cards: [{ title: "Minimal", text: "clean", mock: { type: "phone", lines: ["Header", "List"] } }, { title: "Rich", tag: "new" }] },
  diff: { file: "a.ts", diff: "@@ -1 +1 @@\n-old\n+new" },
  checklist: { items: [{ text: "Build", done: true }, "Test"] },
  table: { columns: ["Name", "Value"], rows: [["a", 1], ["b", 2]] },
};

test("every template renders self-contained HTML (no external resources)", () => {
  for (const t of TEMPLATES) {
    const html = renderTemplate(t, SAMPLES[t], "Title");
    assert.match(html, /^<!doctype html>/);
    assert.equal(/(src|href)=["']?https?:/i.test(html), false, `${t} must not load external resources`);
    assert.ok(html.length < 30_000, `${t} too large`);
  }
  assert.match(renderTemplate("dashboard", { charts: [{ type: "line", labels: ["a", "b", "c"], values: [1, 3, 2] }] }), /<polyline/);
});

test("escapes user content and reports the expected data shape on bad input", () => {
  const html = renderTemplate("kpi", { value: "<script>alert(1)</script>", label: "x" });
  assert.equal(html.includes("<script>alert"), false);
  assert.throws(() => renderTemplate("timeline", { foo: 1 }), /should be \{items:\[\{when,title/);
});

test("renderText colours diffs and keeps monospace logs", () => {
  assert.match(renderText("p", "+a\n-b\n@@ x", "diff"), /class="add">\+a.*class="del">-b/s);
  assert.match(renderText("l", "line <1>", "log"), /<pre>line &lt;1&gt;<\/pre>/);
});

test("a typical presentation call is small (token budget)", () => {
  const call = JSON.stringify({ template: "dashboard", title: "Build health", data: SAMPLES.dashboard });
  assert.ok(call.length < 600, `call is ${call.length} chars`);
});
