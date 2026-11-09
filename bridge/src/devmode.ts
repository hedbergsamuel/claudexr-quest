// Development mode: bug reports and improvement notes collected while the app is being used.
// Storage: <bugsDir>/reports.jsonl (append-only source of truth) + generated BUGS.md.
// Everything written here is secret-masked. Can be switched off with XR_DEV_MODE=0.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { maskDeep, maskSecrets } from "./mask.js";

export const COMPONENTS = ["brygga", "quest-app", "spegling", "röst", "hooks", "skills/presentation", "okänd"] as const;
export type Component = (typeof COMPONENTS)[number];
export const SEVERITIES = ["kritisk", "hög", "medel", "låg"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Report {
  id: string;
  type: "bug" | "improvement" | "auto";
  title: string;
  component: Component;
  severity?: Severity;
  priority?: "hög" | "medel" | "låg";
  description?: string;
  steps?: string[];
  expected?: string;
  actual?: string;
  motivation?: string;
  createdAt: string;
  lastSeen: string;
  count: number;
  context?: Record<string, unknown>;
}

type Line = { op: "add"; report: Report } | { op: "repeat"; id: string; at: string; context?: Record<string, unknown> };

const SEV_ORDER: Record<string, number> = { kritisk: 0, hög: 1, medel: 2, låg: 3 };

export class BugStore {
  readonly file: string;
  readonly md: string;
  private lastAuto = new Map<string, number>();

  constructor(readonly dir: string) {
    this.file = path.join(dir, "reports.jsonl");
    this.md = path.join(dir, "BUGS.md");
  }

  /** Fold the JSONL log into current reports. */
  all(): Report[] {
    if (!fs.existsSync(this.file)) return [];
    const map = new Map<string, Report>();
    for (const raw of fs.readFileSync(this.file, "utf8").split("\n")) {
      if (!raw.trim()) continue;
      let l: Line;
      try {
        l = JSON.parse(raw);
      } catch {
        continue;
      }
      if (l.op === "add") map.set(l.report.id, { ...l.report });
      else if (l.op === "repeat") {
        const r = map.get(l.id);
        if (r) {
          r.count++;
          r.lastSeen = l.at;
        }
      }
    }
    return [...map.values()];
  }

  /** Add a report, or count a repeat when an open report has the same normalized title + component. */
  add(input: Omit<Report, "id" | "createdAt" | "lastSeen" | "count">): { report: Report; duplicateOf?: string } {
    const now = new Date().toISOString();
    const masked = maskDeep(input);
    const dup = this.all().find((r) => r.type === masked.type && r.component === masked.component && norm(r.title) === norm(masked.title));
    if (dup) {
      this.append({ op: "repeat", id: dup.id, at: now });
      this.render();
      return { report: { ...dup, count: dup.count + 1, lastSeen: now }, duplicateOf: dup.id };
    }
    const report: Report = { ...masked, id: shortId(masked.type), createdAt: now, lastSeen: now, count: 1 };
    this.append({ op: "add", report });
    this.render();
    return { report };
  }

  /** Automatic, model-free logging of bridge errors. Rate-limited per message (60 s). */
  autoLog(message: string, component: Component, context?: Record<string, unknown>) {
    const key = norm(message);
    const now = Date.now();
    if ((this.lastAuto.get(key) ?? 0) > now - 60_000) return;
    this.lastAuto.set(key, now);
    this.add({ type: "auto", title: message.slice(0, 160), component, severity: "medel", context });
  }

  private append(l: Line) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(this.file, JSON.stringify(l) + "\n");
  }

  /** Regenerate BUGS.md grouped by severity and component. */
  render(): string {
    const reports = this.all();
    const bugs = reports.filter((r) => r.type !== "improvement").sort(bySeverity);
    const ideas = reports.filter((r) => r.type === "improvement");
    const out: string[] = ["# Buggar och förbättringar (genererad, redigera inte för hand)", "", `Källa: reports.jsonl · ${new Date().toISOString()}`, ""];
    out.push("## Buggar", "");
    for (const sev of SEVERITIES) {
      const group = bugs.filter((b) => (b.severity ?? "medel") === sev);
      if (!group.length) continue;
      out.push(`### ${sev}`, "");
      for (const c of COMPONENTS) {
        for (const b of group.filter((g) => g.component === c)) {
          out.push(`- **[${b.id}] ${b.title}** (${c}${b.type === "auto" ? ", automatiskt loggad" : ""}, ${b.count}×, senast ${b.lastSeen.slice(0, 16)})`);
          if (b.description) out.push(`  - ${b.description.replace(/\n/g, " ")}`);
        }
      }
      out.push("");
    }
    out.push("## Förbättringsidéer", "");
    for (const i of ideas.sort((a, b) => (SEV_ORDER[a.priority ?? "medel"] ?? 2) - (SEV_ORDER[b.priority ?? "medel"] ?? 2))) {
      out.push(`- **[${i.id}] ${i.title}** (${i.component}, prioritet ${i.priority ?? "medel"})${i.motivation ? `: ${i.motivation.replace(/\n/g, " ")}` : ""}`);
    }
    const text = out.join("\n") + "\n";
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.md, text);
    return text;
  }

  /** Developer handoff in Swedish and English. Written to <bugsDir>/handoff-<date>.md and returned. */
  exportHandoff(extraContext: Record<string, unknown>, recentLog: string[]): { file: string; text: string } {
    const reports = this.all();
    const bugs = reports.filter((r) => r.type !== "improvement").sort(bySeverity);
    const ideas = reports.filter((r) => r.type === "improvement");
    const L: string[] = [];
    const item = (r: Report, en: boolean) => {
      L.push(`#### [${r.id}] ${r.title}`);
      L.push(`- ${en ? "Component" : "Komponent"}: ${r.component} · ${en ? "Severity" : "Allvarlighet"}: ${r.severity ?? "medel"} · ${en ? "Seen" : "Sett"} ${r.count}× (${r.createdAt.slice(0, 16)} – ${r.lastSeen.slice(0, 16)})`);
      if (r.description) L.push(`- ${en ? "Description" : "Beskrivning"}: ${r.description}`);
      if (r.steps?.length) L.push(`- ${en ? "Steps to reproduce" : "Steg för att återskapa"}:`, ...r.steps.map((s, i) => `  ${i + 1}. ${s}`));
      if (r.expected) L.push(`- ${en ? "Expected" : "Förväntat"}: ${r.expected}`);
      if (r.actual) L.push(`- ${en ? "Actual" : "Faktiskt"}: ${r.actual}`);
      if (r.context) L.push(`- ${en ? "Context" : "Kontext"}: \`${JSON.stringify(compactContext(r.context))}\``);
      L.push("");
    };
    const section = (en: boolean) => {
      L.push(en ? "## English" : "## Svenska", "");
      L.push(en ? "### Summary" : "### Sammanfattning");
      L.push(
        en
          ? `${bugs.length} bug(s) (${bugs.filter((b) => b.type === "auto").length} auto-logged) and ${ideas.length} improvement idea(s). Prioritized by severity, then component.`
          : `${bugs.length} bugg(ar) (${bugs.filter((b) => b.type === "auto").length} automatiskt loggade) och ${ideas.length} förbättringsidé(er). Prioriterat efter allvarlighet, sedan komponent.`,
        "",
      );
      L.push(en ? "### Prioritized bugs" : "### Prioriterade buggar", "");
      bugs.forEach((b) => item(b, en));
      L.push(en ? "### Improvement ideas" : "### Förbättringsidéer", "");
      for (const i of ideas) L.push(`- [${i.id}] ${i.title} (${i.priority ?? "medel"}, ${i.component})${i.motivation ? ` – ${i.motivation}` : ""}`);
      L.push("");
    };
    L.push(`# ClaudeXR – utvecklaröverlämning / developer handoff`, "", `Genererad / generated: ${new Date().toISOString()}`, "");
    L.push("```json", JSON.stringify(compactContext(extraContext), null, 2), "```", "");
    section(false);
    section(true);
    L.push("## Loggutdrag / log excerpt (bridge, masked)", "", "```", ...recentLog.map(maskSecrets), "```", "");
    const text = maskSecrets(L.join("\n"));
    const file = path.join(this.dir, `handoff-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.md`);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(file, text);
    return { file, text };
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[0-9a-f]{8,}|\d+/g, "#").replace(/\s+/g, " ").trim();
const shortId = (t: Report["type"]) => (t === "improvement" ? "IDE-" : t === "auto" ? "AUTO-" : "BUG-") + randomUUID().slice(0, 6);
const bySeverity = (a: Report, b: Report) => (SEV_ORDER[a.severity ?? "medel"] ?? 2) - (SEV_ORDER[b.severity ?? "medel"] ?? 2) || COMPONENTS.indexOf(a.component) - COMPONENTS.indexOf(b.component);

function compactContext(c: Record<string, unknown>): Record<string, unknown> {
  const { recentLog: _l, ...rest } = c as Record<string, unknown> & { recentLog?: unknown };
  return rest;
}
