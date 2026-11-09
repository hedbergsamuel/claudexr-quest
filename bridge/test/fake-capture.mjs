#!/usr/bin/env node
// Test double for mac-helper/claudexr-capture (same CLI and output format). Linux/CI only.
import fs from "node:fs";
const [cmd, ...args] = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify([cmd, ...args]) + "\n");

if (cmd === "list-windows") {
  console.log(JSON.stringify([
    { id: 11, title: "hub.ts — bridge", app: "Code", bundleId: "com.microsoft.VSCode", pid: 1, width: 1600, height: 1000, onScreen: true },
    { id: 12, title: "Docs", app: "Safari", bundleId: "com.apple.Safari", pid: 2, width: 1400, height: 900, onScreen: true },
    { id: 13, title: "Bank login – vault", app: "1Password", bundleId: "com.1password.1password", pid: 3, width: 800, height: 600, onScreen: true },
    { id: 14, title: "Re: secret plans", app: "Mail", bundleId: "com.apple.mail", pid: 4, width: 1200, height: 800, onScreen: true },
  ]));
} else if (cmd === "display-info") {
  console.log(JSON.stringify({ displayId: 1, widthPt: 1512, heightPt: 982, widthPx: 3024, heightPx: 1964, widthMm: 302, heightMm: 196 }));
} else if (cmd === "brightness") {
  // Fake display brightness in a file: tests assert dim/restore without ever touching a real display.
  const f = process.env.FAKE_BRIGHTNESS_FILE;
  if (!f) {
    console.log(JSON.stringify({ error: "unsupported" }));
    process.exit(1);
  }
  const cur = () => (fs.existsSync(f) ? Number(fs.readFileSync(f, "utf8")) : 0.8);
  if (args[0] === "get") console.log(JSON.stringify({ brightness: cur(), displayId: 1 }));
  else if (args[0] === "set") {
    if (process.env.FAKE_BRIGHTNESS_FAIL_SET === "1") {
      console.log(JSON.stringify({ error: "set failed" }));
      process.exit(1);
    }
    fs.writeFileSync(f, String(Number(args[1])));
    fs.appendFileSync(f + ".log", args[1] + "\n");
    console.log(JSON.stringify({ ok: true, brightness: Number(args[1]) }));
  }
} else if (cmd === "stream") {
  if (process.env.FAKE_ERROR_CODE) {
    process.stderr.write(JSON.stringify({ event: "error", code: Number(process.env.FAKE_ERROR_CODE), message: process.env.FAKE_ERROR_MESSAGE || "Error Domain=com.apple.ScreenCaptureKit.SCStreamErrorDomain Code=-3801 \"The user declined TCCs for application, window, display capture\"" }) + "\n", () => process.exit(1));
    await new Promise((r) => setTimeout(r, 2000));
  }
  process.stderr.write(JSON.stringify({ event: "started", width: 1600, height: 1000 }) + "\n");
  if (process.env.FAKE_NO_FRAMES === "1") setInterval(() => {}, 1000);
  const pauseAfter = Number(process.env.FAKE_PAUSE_AFTER || 0);
  let n = 0;
  let forceKey = false;
  // Control channel like the real helper: "K" = IDR now, "B <bps>" = bitrate.
  let inBuf = "";
  process.stdin.on("data", (d) => {
    inBuf += d;
    let i;
    while ((i = inBuf.indexOf("\n")) >= 0) {
      const line = inBuf.slice(0, i).trim();
      inBuf = inBuf.slice(i + 1);
      if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(["stdin", line]) + "\n");
      if (line === "K") forceKey = true;
    }
  });
  if (process.env.FAKE_NO_FRAMES !== "1") setInterval(() => {
    n++;
    if (pauseAfter && n === pauseAfter) process.stderr.write(JSON.stringify({ event: "paused", reason: "screen_locked" }) + "\n");
    if (pauseAfter && n === pauseAfter + 10) process.stderr.write(JSON.stringify({ event: "resumed" }) + "\n");
    const key = n === 1 || forceKey;
    forceKey = false;
    const payload = Buffer.from([0, 0, 0, 1, key ? 0x67 : 0x41, n & 0xff]);
    const head = Buffer.alloc(13);
    head.writeUInt32BE(9 + payload.length, 0);
    head.writeBigUInt64BE(BigInt(n * 33333), 4);
    head.writeUInt8(key ? 1 : 0, 12);
    process.stdout.write(Buffer.concat([head, payload]));
  }, Number(process.env.FAKE_FRAME_MS || 30));
} else if (cmd === "show-marker") {
  setTimeout(() => process.exit(0), Number(arg("--seconds") || 5) * 1000);
} else {
  process.stderr.write("unknown command\n");
  process.exit(2);
}
