// Review 2 / R2-02: approval panels show every parameter, risk analysis is linear-time, more invisible characters.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPermissionPanel } from "../src/hookapi.js";

test("risk analysis stays fast on hostile input (no event-loop stall)", () => {
  for (const content of ["curl ".repeat(40_000), "$(".repeat(100_000), "git push ".repeat(30_000), "base64 ".repeat(30_000)]) {
    const t = performance.now();
    buildPermissionPanel({ tool_name: "Write", tool_input: { file_path: "/tmp/x", content } });
    buildPermissionPanel({ tool_name: "Bash", tool_input: { command: content.slice(0, 19_000) } });
    const ms = performance.now() - t;
    assert.ok(ms < 300, `${ms.toFixed(0)} ms for ${content.length} chars`);
  }
});

test("parameters that are not rendered are shown; replace_all warns", () => {
  const b = buildPermissionPanel({ tool_name: "Bash", tool_input: { command: "npm test", run_in_background: true, dangerouslyDisableSandbox: true } });
  assert.match(b.panel.detail ?? "", /Övriga parametrar: .*dangerouslyDisableSandbox/);
  assert.ok(b.panel.warnings.some((w) => /sandlådan/.test(w)));
  const e = buildPermissionPanel({ tool_name: "Edit", tool_input: { file_path: "/a.ts", old_string: "x", new_string: "y", replace_all: true } });
  assert.ok(e.panel.warnings.some((w) => /replace_all/.test(w)));
  assert.match(e.panel.detail ?? "", /replace_all/);
});

test("more invisible characters block XR approval; CRLF and Swedish text do not", () => {
  for (const ch of ["\u{E0041}", "­", " ", "️", "ㅤ", "\r"]) {
    assert.equal(buildPermissionPanel({ tool_name: "Bash", tool_input: { command: `echo ok${ch}` } }).approvable, false, JSON.stringify(ch));
  }
  assert.equal(buildPermissionPanel({ tool_name: "Write", tool_input: { file_path: "/a.txt", content: "rad 1\r\nrad 2\r\n" } }).approvable, true);
  const sv = buildPermissionPanel({ tool_name: "Bash", tool_input: { command: 'git commit -m "Åtgärda växling"' } });
  assert.equal(sv.approvable, true);
  assert.equal(sv.panel.warnings.length, 0);
  assert.ok(buildPermissionPanel({ tool_name: "WebFetch", tool_input: { url: "https://аpple.com" } }).panel.warnings.some((w) => /kyrilliska/.test(w)));
});
