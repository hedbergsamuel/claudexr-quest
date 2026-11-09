// On/off flag for the ClaudeXR hooks (0.3.1).
//
// The hooks that install-hooks writes into ~/.claude/settings.json are command hooks that start with
//   [ -f "$HOME/.claudexr/on" ] || exit 0
// so without the flag file Claude Code makes no network call at all and shows no hook error. The bridge
// creates the flag when an authenticated headset connects and removes it when the headset is gone
// (disconnect, heartbeat lost / code 1006, unpair, daemon exit, daemon start with no headset).
// `xr on|off|status` is the manual override (it lasts until the next connect/disconnect or daemon start).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where the flag lives. CLAUDEXR_FLAG_DIR wins. Otherwise an overridden CLAUDEXR_STATE_DIR (tests, sandboxes) is used,
 * so that a sandboxed daemon can never touch the real ~/.claudexr/on. Default: ~/.claudexr (what the hook commands test).
 */
export function flagDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDEXR_FLAG_DIR || env.CLAUDEXR_STATE_DIR || path.join(os.homedir(), ".claudexr");
}

export class XrFlag {
  readonly file: string;
  constructor(readonly dir: string = flagDir()) {
    this.file = path.join(dir, "on");
  }

  isOn(): boolean {
    try {
      return fs.statSync(this.file).isFile();
    } catch {
      return false;
    }
  }

  /** Atomic (temp file + rename): a hook never sees a half-written flag. */
  on(reason = "manual"): void {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(this.dir, `.on.tmp-${process.pid}-${Date.now()}`);
    try {
      fs.writeFileSync(tmp, `${reason} ${new Date().toISOString()} pid=${process.pid}\n`, { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (e) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {}
      throw e;
    }
  }

  /** Idempotent, synchronous (also used from process exit handlers). */
  off(): void {
    fs.rmSync(this.file, { force: true });
  }
}
