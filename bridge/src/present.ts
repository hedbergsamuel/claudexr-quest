// Built-in presentation templates: Claude sends compact JSON, the bridge renders self-contained HTML
// (dark theme, large text for ~1.2 m, SVG charts, no external resources).

export const TEMPLATES = ["dashboard", "kpi", "comparison", "timeline", "flow", "slides", "choice-cards", "diff", "checklist", "table"] as const;
export type Template = (typeof TEMPLATES)[number];

/** Expected data shape per template (returned to Claude only when its data doesn't fit). */
export const SHAPES: Record<Template, string> = {
  dashboard: '{kpis:[{label,value,delta?,good?}], charts:[{type:"bar"|"line"|"pie",title?,labels:[],values:[]}], conclusion?}',
  kpi: "{value,label,delta?,good?,sub?}",
  comparison: "{a:{title,points:[],tag?},b:{title,points:[],tag?},verdict?}",
  timeline: "{items:[{when,title,detail?,done?}]}",
  flow: "{steps:[{title,detail?}]}",
  slides: "{slides:[{title,bullets:[],note?}]}",
  "choice-cards": "{cards:[{title,text?,tag?,mock?:{type:\"phone\"|\"window\",lines:[]}}]}",
  diff: "{file?,diff} or {before,after}",
  checklist: "{items:[{text,done?}]}",
  table: "{columns:[],rows:[[]]}",
};

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const arr = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
const PALETTE = ["#D97757", "#6CB4EE", "#7FD69B", "#E0B341", "#B58CF0", "#F08A8A"];

const CSS = `
*{box-sizing:border-box;margin:0}html,body{background:#15161a;color:#f2f2f2;font:28px/1.35 -apple-system,Roboto,"Segoe UI",sans-serif;height:100%}
body{padding:36px;overflow:auto}h1{font-size:44px;margin-bottom:24px;font-weight:650}h2{font-size:32px;margin:0 0 12px;font-weight:600}
.muted{color:#a8abb3}.grid{display:grid;gap:24px}.card{background:#22242b;border-radius:22px;padding:26px}
.kpi .v{font-size:64px;font-weight:700;line-height:1.1}.kpi .l{color:#a8abb3;font-size:26px}.up{color:#7FD69B}.down{color:#F08A8A}
.tag{display:inline-block;background:#D97757;color:#111;border-radius:999px;padding:4px 16px;font-size:22px;font-weight:600;margin-bottom:10px}
ul{padding-left:1.1em}li{margin:6px 0}.concl{border-left:8px solid #D97757;padding:18px 24px;background:#22242b;border-radius:14px;margin-top:24px;font-size:30px}
table{border-collapse:collapse;width:100%}td,th{padding:12px 16px;border-bottom:1px solid #33363f;text-align:left}th{color:#a8abb3;font-weight:600}
pre{font:22px/1.4 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word}.add{color:#7FD69B}.del{color:#F08A8A}.hunk{color:#8AB4F8}
svg text{fill:#d8dae0;font-size:20px}
`;

function page(title: string | undefined, body: string, extra = ""): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}${extra}</style></head><body>${title ? `<h1>${esc(title)}</h1>` : ""}${body}</body></html>`;
}

function delta(d: unknown, good?: unknown) {
  if (d === undefined || d === null || d === "") return "";
  const s = String(d);
  const positive = good !== undefined ? !!good : !s.trim().startsWith("-");
  return ` <span class="${positive ? "up" : "down"}">${esc(s)}</span>`;
}

function chart(c: Record<string, unknown>): string {
  const labels = arr<string>(c.labels);
  const values = arr(c.values).map(num).filter((x) => Number.isFinite(x));
  if (!values.length) return "";
  const W = 560, H = 300;
  const max = Math.max(...values, 0) || 1;
  let svg = "";
  if (c.type === "pie") {
    const total = values.reduce((a, b) => a + Math.max(b, 0), 0) || 1;
    let a0 = -Math.PI / 2;
    const cx = 150, cy = 150, r = 130;
    values.forEach((v, i) => {
      const a1 = a0 + (Math.max(v, 0) / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      svg += `<path d="M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z" fill="${PALETTE[i % PALETTE.length]}"/>`;
      svg += `<rect x="320" y="${30 + i * 34}" width="20" height="20" fill="${PALETTE[i % PALETTE.length]}"/><text x="350" y="${47 + i * 34}">${esc(labels[i] ?? "")} ${Math.round((v / total) * 100)}%</text>`;
      a0 = a1;
    });
  } else if (c.type === "line") {
    const step = values.length > 1 ? (W - 60) / (values.length - 1) : 0;
    const pts = values.map((v, i) => `${40 + i * step},${H - 40 - (v / max) * (H - 70)}`).join(" ");
    svg += `<polyline points="${pts}" fill="none" stroke="#D97757" stroke-width="5"/>`;
    values.forEach((v, i) => (svg += `<circle cx="${40 + i * step}" cy="${H - 40 - (v / max) * (H - 70)}" r="6" fill="#D97757"/>`));
    labels.forEach((l, i) => (svg += `<text x="${40 + i * step}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`));
  } else {
    const bw = (W - 40) / values.length;
    values.forEach((v, i) => {
      const h = (Math.max(v, 0) / max) * (H - 80);
      svg += `<rect x="${30 + i * bw + 6}" y="${H - 40 - h}" width="${bw - 12}" height="${h}" rx="6" fill="${PALETTE[i % PALETTE.length]}"/>`;
      svg += `<text x="${30 + i * bw + bw / 2}" y="${H - 46 - h}" text-anchor="middle">${esc(v)}</text>`;
      svg += `<text x="${30 + i * bw + bw / 2}" y="${H - 10}" text-anchor="middle">${esc(labels[i] ?? "")}</text>`;
    });
  }
  return `<div class="card">${c.title ? `<h2>${esc(c.title)}</h2>` : ""}<svg viewBox="0 0 ${W} ${H}" width="100%">${svg}</svg></div>`;
}

function mock(m: Record<string, unknown> | undefined): string {
  if (!m) return "";
  const lines = arr<string>(m.lines).map((l) => `<div style="background:#33363f;border-radius:8px;padding:8px 12px;margin:8px 0;font-size:22px">${esc(l)}</div>`).join("");
  const phone = m.type === "phone";
  return `<div style="margin-top:14px;border:4px solid #44474f;border-radius:${phone ? 34 : 14}px;padding:${phone ? "34px 14px" : "12px"};${phone ? "max-width:260px" : ""}">${phone ? "" : '<div style="height:10px;display:flex;gap:6px;margin-bottom:8px"><i style="width:10px;background:#F08A8A;border-radius:5px"></i><i style="width:10px;background:#E0B341;border-radius:5px"></i><i style="width:10px;background:#7FD69B;border-radius:5px"></i></div>'}${lines}</div>`;
}

function diffHtml(d: Record<string, unknown>): string {
  let text = typeof d.diff === "string" ? d.diff : "";
  if (!text && (d.before !== undefined || d.after !== undefined)) {
    text = [...String(d.before ?? "").split("\n").map((l) => "-" + l), ...String(d.after ?? "").split("\n").map((l) => "+" + l)].join("\n");
  }
  const lines = text.split("\n").slice(0, 400).map((l) => {
    const cls = l.startsWith("@@") ? "hunk" : l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : "";
    return `<span class="${cls}">${esc(l)}</span>`;
  });
  return `${d.file ? `<div class="muted" style="margin-bottom:12px">${esc(d.file)}</div>` : ""}<pre>${lines.join("\n")}</pre>`;
}

/** Render a template. Throws with the expected shape when data doesn't fit. */
export function renderTemplate(template: Template, data: Record<string, unknown>, title?: string): string {
  const fail = () => {
    throw new Error(`data for "${template}" should be ${SHAPES[template]}`);
  };
  switch (template) {
    case "kpi": {
      if (data.value === undefined) fail();
      return page(title, `<div class="card kpi" style="text-align:center;padding:60px"><div class="v" style="font-size:110px">${esc(data.value)}${delta(data.delta, data.good)}</div><div class="l" style="font-size:34px">${esc(data.label)}</div>${data.sub ? `<div class="muted" style="margin-top:16px">${esc(data.sub)}</div>` : ""}</div>`);
    }
    case "dashboard": {
      const kpis = arr<Record<string, unknown>>(data.kpis);
      const charts = arr<Record<string, unknown>>(data.charts);
      if (!kpis.length && !charts.length) fail();
      const k = kpis.slice(0, 4).map((x) => `<div class="card kpi"><div class="v">${esc(x.value)}${delta(x.delta, x.good)}</div><div class="l">${esc(x.label)}</div></div>`).join("");
      const c = charts.slice(0, 2).map(chart).join("");
      return page(title, `${k ? `<div class="grid" style="grid-template-columns:repeat(${Math.min(kpis.length, 4)},1fr)">${k}</div>` : ""}${c ? `<div class="grid" style="grid-template-columns:repeat(${Math.min(charts.length, 2)},1fr);margin-top:24px">${c}</div>` : ""}${data.conclusion ? `<div class="concl">${esc(data.conclusion)}</div>` : ""}`);
    }
    case "comparison": {
      const a = data.a as Record<string, unknown> | undefined, b = data.b as Record<string, unknown> | undefined;
      if (!a || !b) fail();
      const col = (x: Record<string, unknown>, key: string) => `<div class="card">${x.tag ? `<span class="tag">${esc(x.tag)}</span>` : ""}<h2>${esc(key)} · ${esc(x.title)}</h2><ul>${arr(x.points).map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>`;
      return page(title, `<div class="grid" style="grid-template-columns:1fr 1fr">${col(a!, "A")}${col(b!, "B")}</div>${data.verdict ? `<div class="concl">${esc(data.verdict)}</div>` : ""}`);
    }
    case "timeline": {
      const items = arr<Record<string, unknown>>(data.items);
      if (!items.length) fail();
      return page(title, items.map((it) => `<div style="display:flex;gap:22px;margin-bottom:22px"><div style="min-width:30px;padding-top:8px"><div style="width:26px;height:26px;border-radius:13px;background:${it.done ? "#7FD69B" : "#44474f"}"></div></div><div><div class="muted">${esc(it.when)}</div><h2 style="margin:2px 0">${esc(it.title)}</h2>${it.detail ? `<div class="muted">${esc(it.detail)}</div>` : ""}</div></div>`).join(""));
    }
    case "flow": {
      const steps = arr<Record<string, unknown> | string>(data.steps);
      if (!steps.length) fail();
      const boxes = steps.map((s, i) => {
        const o = typeof s === "string" ? { title: s } : s;
        return `<div class="card" style="flex:1;text-align:center"><div class="muted">${i + 1}</div><h2>${esc(o.title)}</h2>${o.detail ? `<div class="muted">${esc(o.detail)}</div>` : ""}</div>`;
      });
      return page(title, `<div style="display:flex;align-items:center;gap:14px">${boxes.join('<div style="font-size:44px;color:#D97757">→</div>')}</div>`);
    }
    case "slides": {
      const slides = arr<Record<string, unknown>>(data.slides);
      if (!slides.length) fail();
      const html = slides.map((s, i) => `<section class="s" style="display:${i ? "none" : "block"}"><h1>${esc(s.title)}</h1><ul style="font-size:36px">${arr(s.bullets).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>${s.note ? `<div class="concl">${esc(s.note)}</div>` : ""}</section>`).join("");
      const nav = `<div style="position:fixed;bottom:24px;right:36px;display:flex;gap:16px;align-items:center"><span id="n" class="muted">1/${slides.length}</span><button onclick="go(-1)">◀</button><button onclick="go(1)">▶</button></div><script>let i=0;const s=document.querySelectorAll('.s');function go(d){s[i].style.display='none';i=(i+d+s.length)%s.length;s[i].style.display='block';document.getElementById('n').textContent=(i+1)+'/'+s.length}</script>`;
      return page(title, html + nav, "button{font-size:34px;padding:10px 28px;border-radius:16px;border:0;background:#2c2e35;color:#f2f2f2}");
    }
    case "choice-cards": {
      const cards = arr<Record<string, unknown>>(data.cards);
      if (!cards.length) fail();
      return page(title, `<div class="grid" style="grid-template-columns:repeat(${Math.min(cards.length, 4)},1fr)">${cards.slice(0, 4).map((c, i) => `<div class="card">${c.tag ? `<span class="tag">${esc(c.tag)}</span>` : ""}<h2>${i + 1}. ${esc(c.title)}</h2>${c.text ? `<div class="muted">${esc(c.text)}</div>` : ""}${mock(c.mock as Record<string, unknown> | undefined)}</div>`).join("")}</div>`);
    }
    case "diff": {
      if (typeof data.diff !== "string" && data.before === undefined && data.after === undefined) fail();
      return page(title, diffHtml(data));
    }
    case "checklist": {
      const items = arr<Record<string, unknown> | string>(data.items);
      if (!items.length) fail();
      return page(title, items.map((x) => {
        const o = typeof x === "string" ? { text: x } : x;
        return `<div class="card" style="margin-bottom:14px;display:flex;gap:18px;align-items:center"><span style="font-size:36px;color:${o.done ? "#7FD69B" : "#6b6e76"}">${o.done ? "✔" : "○"}</span><span>${esc(o.text)}</span></div>`;
      }).join(""));
    }
    case "table": {
      const cols = arr(data.columns);
      const rows = arr<unknown[]>(data.rows);
      if (!cols.length) fail();
      return page(title, `<div class="card"><table><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>${rows.slice(0, 30).map((r) => `<tr>${arr(r).map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table></div>`);
    }
  }
}

/** Free text panels (xr_show text/diff/log/md) use the same look. */
export function renderText(title: string, body: string, format: "text" | "diff" | "log" | "md"): string {
  if (format === "diff") return page(title, diffHtml({ diff: body }));
  if (format === "md") {
    const html = body
      .split("\n")
      .map((l) => (l.startsWith("# ") ? `<h2>${esc(l.slice(2))}</h2>` : l.startsWith("- ") ? `<li>${esc(l.slice(2))}</li>` : l.trim() ? `<p>${esc(l)}</p>` : ""))
      .join("");
    return page(title, html);
  }
  return page(title, `<pre>${esc(body)}</pre>`);
}
