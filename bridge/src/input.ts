// Tunt gränssnitt för "paneler som riktiga skärmar" (IDE-11c7f5). 0.4.1: inkopplat i hubben (InputRouter) men
// skickar FORTFARANDE ingenting till Macen: standardmottagaren är NullInputSink, som bara räknar.
// Det som återstår (ej klart, beror på hårdvara/behörighet): CGEvent-insprutning i Mac-hjälparen (Hjälpmedel-
// behörighet), virtuella skärmar per panel, arrangemangssynk, pekare i headsetet. Se bugs/PLAN-0.4-EJ-KLART.md.

export type PointerEvent =
  | { kind: "move"; panelId: string; u: number; v: number }
  | { kind: "button"; panelId: string; u: number; v: number; button: "left" | "right"; down: boolean }
  | { kind: "scroll"; panelId: string; dx: number; dy: number };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Panelens normaliserade punkt (u,v i 0..1, v nedåt) -> punkt på målskärmens/fönstrets rektangel (punkter). */
export function mapToTarget(u: number, v: number, target: Rect): { x: number; y: number } | null {
  if (![u, v].every(Number.isFinite) || u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { x: target.x + u * target.w, y: target.y + v * target.h };
}

/**
 * Grind för inmatning. Av som standard. Slås bara på av en fysisk handling i headsetet (aldrig av röst, aldrig av
 * Claude) och stängs alltid av med off(). Känsliga ögonblick (lösenordsfält, systemdialoger) hålls utanför
 * genom `sensitive`, som Mac-hjälparen ska sätta när den upptäcker dem.
 */
export class InputGate {
  private on = false;
  sensitive = false;
  /** source måste vara "headset-button"; allt annat (röst, MCP) nekas. */
  enable(source: "headset-button" | "voice" | "mcp"): boolean {
    if (source !== "headset-button") return false;
    this.on = true;
    return true;
  }
  off(): void {
    this.on = false;
  }
  get enabled(): boolean {
    return this.on;
  }
  /** Får en händelse släppas igenom? */
  allow(): boolean {
    return this.on && !this.sensitive;
  }
}

// ---------------- 0.4.1: inkoppling i hubben (utan CGEvent) ----------------

/** En pekarhändelse mappad till Macens koordinater (punkter). */
export type MappedInput =
  | { kind: "move"; panelId: string; x: number; y: number }
  | { kind: "button"; panelId: string; x: number; y: number; button: "left" | "right"; down: boolean }
  | { kind: "scroll"; panelId: string; dx: number; dy: number };

/**
 * Vart mappade händelser tar vägen. 0.4.1 har bara NullInputSink. En riktig mottagare (CGEvent i Mac-hjälparen)
 * kräver Hjälpmedel-behörighet och test på riktig Mac; den byggs inte förrän ägaren godkänt det.
 */
export interface InputSink {
  readonly name: string;
  deliver(ev: MappedInput): void;
}

/** Skickar ingenting någonstans. Sparar de senaste händelserna (för tester och xr_status). */
export class NullInputSink implements InputSink {
  readonly name = "null";
  readonly recent: MappedInput[] = [];
  count = 0;
  deliver(ev: MappedInput): void {
    this.count++;
    this.recent.push(ev);
    if (this.recent.length > 50) this.recent.shift();
  }
}

/** Validerar en pekarhändelse från headsetet (opålitlig indata). null = ogiltig. */
export function parsePointer(raw: unknown): PointerEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.panelId !== "string" || !r.panelId || r.panelId.length > 64) return null;
  const num = (k: string) => (typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : null);
  if (r.kind === "move" || r.kind === "button") {
    const u = num("u");
    const v = num("v");
    if (u === null || v === null) return null;
    if (r.kind === "move") return { kind: "move", panelId: r.panelId, u, v };
    if ((r.button !== "left" && r.button !== "right") || typeof r.down !== "boolean") return null;
    return { kind: "button", panelId: r.panelId, u, v, button: r.button, down: r.down };
  }
  if (r.kind === "scroll") {
    const dx = num("dx");
    const dy = num("dy");
    if (dx === null || dy === null) return null;
    const c = (x: number) => Math.max(-500, Math.min(500, x));
    return { kind: "scroll", panelId: r.panelId, dx: c(dx), dy: c(dy) };
  }
  return null;
}

export type InputOutcome = "delivered" | "gate_off" | "sensitive" | "no_target" | "invalid";

/** Grinden stängs av sig själv efter så här lång tid utan händelser. */
export const INPUT_IDLE_OFF_MS = 5 * 60_000;

/**
 * Grind + mappning + mottagare. Allt som kommer in är opålitligt; inget släpps igenom när grinden är av, när ett
 * känsligt ögonblick pågår, eller när panelen inte har någon känd målrektangel på Macen.
 * En knapp som trycktes ned när grinden stängdes släpps aldrig "upp" på Macen av grinden själv; det får en riktig
 * mottagare lösa (den ska släppa alla nedtryckta knappar vid off).
 */
export class InputRouter {
  delivered = 0;
  dropped = 0;
  private lastEventAt = 0;
  lastOffReason?: string;

  constructor(
    readonly gate: InputGate,
    readonly sink: InputSink,
    private readonly target: (panelId: string) => Rect | null,
    private readonly now: () => number = Date.now,
  ) {}

  /** Bara "headset-button" slår på. Returnerar om grinden är på efteråt. */
  enable(source: "headset-button" | "voice" | "mcp"): boolean {
    const ok = this.gate.enable(source);
    if (ok) {
      this.lastEventAt = this.now();
      this.lastOffReason = undefined;
    }
    return ok;
  }

  off(reason: string): void {
    if (this.gate.enabled) this.lastOffReason = reason;
    this.gate.off();
  }

  handle(raw: unknown): InputOutcome {
    const ev = parsePointer(raw);
    if (!ev) return this.drop("invalid");
    if (this.gate.enabled && this.now() - this.lastEventAt > INPUT_IDLE_OFF_MS) this.off("idle");
    if (!this.gate.enabled) return this.drop("gate_off");
    if (this.gate.sensitive) return this.drop("sensitive");
    this.lastEventAt = this.now();
    if (ev.kind === "scroll") {
      if (!this.target(ev.panelId)) return this.drop("no_target");
      this.sink.deliver(ev);
      this.delivered++;
      return "delivered";
    }
    const rect = this.target(ev.panelId);
    const p = rect ? mapToTarget(ev.u, ev.v, rect) : null;
    if (!p) return this.drop("no_target");
    this.sink.deliver(ev.kind === "move" ? { kind: "move", panelId: ev.panelId, ...p } : { kind: "button", panelId: ev.panelId, ...p, button: ev.button, down: ev.down });
    this.delivered++;
    return "delivered";
  }

  private drop(o: InputOutcome): InputOutcome {
    this.dropped++;
    return o;
  }

  stats() {
    return { enabled: this.gate.enabled, sensitive: this.gate.sensitive, sink: this.sink.name, delivered: this.delivered, dropped: this.dropped, ...(this.lastOffReason ? { lastOff: this.lastOffReason } : {}) };
  }
}
