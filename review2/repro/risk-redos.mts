import { buildPermissionPanel, riskWarnings } from "./src/hookapi.ts";
const cases: [string, string][] = [
  ["curl x 4000 one line (20 kB)", "curl ".repeat(4000)],
  ["curl x 40000 one line (200 kB, Write content)", "curl ".repeat(40000)],
  ["$( x 20000", "$(".repeat(20000)],
  ["rm -r x 5000", "rm -r ".repeat(5000)],
  ["5 MB normal text", "const a = 1;\n".repeat(400000)],
];
for (const [n, s] of cases) {
  const t = performance.now();
  buildPermissionPanel({ tool_name: "Write", tool_input: { file_path: "/tmp/x", content: s } });
  console.log(n, (performance.now() - t).toFixed(0), "ms");
}
