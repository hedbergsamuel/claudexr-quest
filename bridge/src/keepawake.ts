// Håller Macens skärm vaken medan skärmströmmen är aktiv (BUG-13e417).
// Bakgrund: när Macen somnade under dimning försvann displayen ("no display") och ägaren såg bara svart.
// Lösning: `caffeinate -d -i` körs som barnprocess så länge en displaystöm lever. Processen dör med bryggan
// (vi dödar den själva vid stopp/nedstängning; caffeinate -w <pid> gör att den även slutar om bryggan kraschar).
// Den riktiga processen startas aldrig i tester: hubben får en injicerad adapter, och standardadaptern används bara
// när realDimAllowed() tillåter (samma skydd som dimning).
import { spawn, type ChildProcess } from "node:child_process";
import { log, logError } from "./log.js";

export interface KeepAwakeAdapter {
  start(): boolean;
  stop(): void;
}

export class CaffeinateAdapter implements KeepAwakeAdapter {
  private proc?: ChildProcess;
  start(): boolean {
    if (this.proc && this.proc.exitCode === null) return true;
    try {
      // -d: håll displayen vaken, -i: förhindra viloläge, -w: avsluta när bryggans process dör.
      const p = spawn("/usr/bin/caffeinate", ["-d", "-i", "-w", String(process.pid)], { stdio: "ignore" });
      p.on("error", (e) => logError("keepawake", e.message));
      p.unref();
      this.proc = p;
      return true;
    } catch (e) {
      logError("keepawake", (e as Error).message);
      return false;
    }
  }
  stop(): void {
    this.proc?.kill();
    this.proc = undefined;
  }
}

/** Slår på/av hållningen vaken; idempotent. */
export class KeepAwake {
  active = false;
  constructor(private readonly adapter: KeepAwakeAdapter) {}
  set(want: boolean): void {
    if (want && !this.active) {
      this.active = this.adapter.start();
      if (this.active) log("keepawake: Macen hålls vaken medan skärmströmmen är aktiv");
    } else if (!want && this.active) {
      this.adapter.stop();
      this.active = false;
      log("keepawake: av");
    }
  }
}
