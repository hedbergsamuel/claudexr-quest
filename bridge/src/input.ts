// Tunt gränssnitt för "paneler som riktiga skärmar" (IDE-11c7f5). INTE inkopplat i hubben och skickar ingenting
// till Macen: ren matematik och en säkerhetsgrind som kan enhetstestas utan hårdvara.
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
