// Dimming of the physical Mac display while the display stream is shown in the headset (0.3.0).
//
// SAFETY MODEL (a Mac stuck at brightness 0 is unacceptable):
//  * The original value is written to a file (<stateDir>/brightness-saved.json, mode 0600) BEFORE the
//    display is dimmed, and the file is never overwritten while it exists (dimming twice must not save "0").
//  * Restore is SYNCHRONOUS (execFileSync) so it also works inside process "exit", signal and
//    uncaughtException handlers.
//  * A leftover file at the next daemon start (SIGKILL, power loss, crash) is restored first thing.
//  * `node dist/src/index.js restore-brightness` restores from the file without the daemon.
//  * The hub restores on: stream stop/error, pause (locked screen, secure input), headset disconnect,
//    stalled video (no frame for a while), emergency close, and shutdown.
//  * The real brightness is only ever touched through a BrightnessAdapter; tests inject a memory adapter
//    or the fake helper, never the real one.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { log, logError } from "./log.js";

export interface BrightnessAdapter {
  /** 0..1, or null when it cannot be read (then the display is NOT dimmed: restore would be impossible). */
  getSync(): number | null;
  setSync(value: number): boolean;
}

/** Talks to `claudexr-capture brightness get|set` (built-in display; DisplayServices). */
export class HelperBrightnessAdapter implements BrightnessAdapter {
  constructor(private readonly bin: string, private readonly timeoutMs = 3000) {}

  private run(args: string[]): Record<string, unknown> | null {
    try {
      const out = execFileSync(this.bin, args, { timeout: this.timeoutMs, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      return JSON.parse(out.trim().split("\n").pop() ?? "{}");
    } catch {
      return null;
    }
  }

  getSync(): number | null {
    const r = this.run(["brightness", "get"]);
    const b = r?.brightness;
    return typeof b === "number" && b >= 0 && b <= 1 ? b : null;
  }

  setSync(value: number): boolean {
    const r = this.run(["brightness", "set", String(Math.max(0, Math.min(1, value)))]);
    return r?.ok === true;
  }
}

export interface SavedBrightness {
  original: number;
  dimmedTo: number;
  savedAt: string;
  pid: number;
}

export class BrightnessGuard {
  private dimmedNow = false;
  readonly file: string;

  constructor(
    private readonly adapter: BrightnessAdapter,
    stateDir: string,
    private readonly dimLevel = 0,
  ) {
    this.file = path.join(stateDir, "brightness-saved.json");
  }

  get dimmed(): boolean {
    return this.dimmedNow;
  }

  private readSaved(): SavedBrightness | null {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return typeof j?.original === "number" && j.original >= 0 && j.original <= 1 ? (j as SavedBrightness) : null;
    } catch {
      return null;
    }
  }

  hasSavedFile(): boolean {
    return fs.existsSync(this.file);
  }

  /**
   * Dim the display. Returns true when it is dimmed (now or already). Does nothing (false) if the current
   * value cannot be read or the saved file cannot be written, because restoring would not be possible.
   */
  dim(): boolean {
    if (this.dimmedNow) return true;
    // A leftover file from an earlier run is restored FIRST; it is never overwritten with the dimmed value.
    if (this.hasSavedFile()) {
      if (!this.restore()) return false;
    }
    const current = this.adapter.getSync();
    if (current === null) {
      log("brightness: cannot read the current value: not dimming");
      return false;
    }
    if (current <= this.dimLevel + 0.01) return false; // already dark (user's choice): nothing to save or restore
    const saved: SavedBrightness = { original: current, dimmedTo: this.dimLevel, savedAt: new Date().toISOString(), pid: process.pid };
    try {
      fs.writeFileSync(this.file, JSON.stringify(saved) + "\n", { mode: 0o600, flag: "wx" }); // wx: never overwrite
    } catch (e) {
      logError("brightness", `cannot save the original value (${(e as Error).message}): not dimming`);
      return false;
    }
    if (!this.adapter.setSync(this.dimLevel)) {
      fs.rmSync(this.file, { force: true });
      log("brightness: set failed: not dimming");
      return false;
    }
    this.dimmedNow = true;
    log(`brightness: dimmed ${current.toFixed(2)} -> ${this.dimLevel}`);
    return true;
  }

  /**
   * Restore the saved value (synchronous; safe in exit handlers). Returns true when nothing is left to
   * restore. On failure the file is kept so the next start / `restore-brightness` retries.
   */
  restore(): boolean {
    const saved = this.readSaved();
    if (!saved) {
      // Missing or corrupt file: nothing we can restore.
      if (this.hasSavedFile()) fs.rmSync(this.file, { force: true });
      this.dimmedNow = false;
      return true;
    }
    if (this.adapter.setSync(saved.original)) {
      fs.rmSync(this.file, { force: true });
      this.dimmedNow = false;
      log(`brightness: restored to ${saved.original.toFixed(2)}`);
      return true;
    }
    logError("brightness", `could not restore brightness to ${saved.original.toFixed(2)}; will retry (file ${this.file})`);
    return false;
  }

  /** Daemon start: if an earlier run left a saved value behind, put it back. */
  restoreStale(): boolean {
    if (!this.hasSavedFile()) return true;
    log("brightness: a saved value from an earlier run exists: restoring it");
    return this.restore();
  }
}

/**
 * Hard guard for tests and sandboxes: the REAL helper is never used for dimming when the state directory
 * was overridden (tests set CLAUDEXR_STATE_DIR) unless CLAUDEXR_ALLOW_REAL_DIM=1.
 */
export function realDimAllowed(env: NodeJS.ProcessEnv, captureBin: string): boolean {
  if (env.CLAUDEXR_ALLOW_REAL_DIM === "1") return true;
  const isFake = /fake/i.test(path.basename(captureBin));
  if (isFake) return true;
  return !env.CLAUDEXR_STATE_DIR;
}
