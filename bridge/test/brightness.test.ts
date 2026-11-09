import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrightnessAdapter, BrightnessGuard, HelperBrightnessAdapter, realDimAllowed } from "../src/brightness.js";
import { tmpDir } from "./helpers.js";

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-capture.mjs");

/** In-memory display: the REAL brightness is never touched in these tests. */
class MemoryDisplay implements BrightnessAdapter {
  sets: number[] = [];
  failSet = false;
  constructor(public value: number | null = 0.7) {}
  getSync() {
    return this.value;
  }
  setSync(v: number) {
    if (this.failSet) return false;
    this.sets.push(v);
    this.value = v;
    return true;
  }
}

test("dim saves the original first, restore puts it back and removes the file", () => {
  const dir = tmpDir();
  const d = new MemoryDisplay(0.7);
  const g = new BrightnessGuard(d, dir, 0);
  assert.equal(g.dim(), true);
  assert.equal(d.value, 0);
  assert.equal(JSON.parse(fs.readFileSync(g.file, "utf8")).original, 0.7);
  assert.equal(fs.statSync(g.file).mode & 0o777, 0o600);
  assert.equal(g.restore(), true);
  assert.equal(d.value, 0.7);
  assert.equal(fs.existsSync(g.file), false);
  assert.equal(g.dimmed, false);
});

test("dim twice, restore once: the original is never overwritten with 0", () => {
  const dir = tmpDir();
  const d = new MemoryDisplay(0.55);
  const g = new BrightnessGuard(d, dir, 0);
  g.dim();
  g.dim();
  g.dim();
  assert.deepEqual(d.sets, [0], "set to the dim level only once");
  assert.equal(JSON.parse(fs.readFileSync(g.file, "utf8")).original, 0.55);
  g.restore();
  assert.equal(d.value, 0.55);
});

test("a leftover file from a crashed run is restored at start and removed", () => {
  const dir = tmpDir();
  const d = new MemoryDisplay(0); // the screen is still dark from the previous run
  fs.writeFileSync(path.join(dir, "brightness-saved.json"), JSON.stringify({ original: 0.9, dimmedTo: 0, savedAt: "x", pid: 1 }));
  const g = new BrightnessGuard(d, dir, 0);
  assert.equal(g.restoreStale(), true);
  assert.equal(d.value, 0.9);
  assert.equal(fs.existsSync(g.file), false);
});

test("the saved file is never overwritten while it exists (dim after a stale file restores first)", () => {
  const dir = tmpDir();
  const d = new MemoryDisplay(0);
  fs.writeFileSync(path.join(dir, "brightness-saved.json"), JSON.stringify({ original: 0.8, dimmedTo: 0, savedAt: "x", pid: 1 }));
  const g = new BrightnessGuard(d, dir, 0);
  assert.equal(g.dim(), true);
  assert.equal(JSON.parse(fs.readFileSync(g.file, "utf8")).original, 0.8, "kept 0.8, not the dark 0");
  g.restore();
  assert.equal(d.value, 0.8);
});

test("failure handling: unreadable value, failed set, failed restore, already dark", () => {
  const dir = tmpDir();
  const unreadable = new BrightnessGuard(new MemoryDisplay(null), dir, 0);
  assert.equal(unreadable.dim(), false);
  assert.equal(unreadable.hasSavedFile(), false, "nothing saved, nothing dimmed");

  const d = new MemoryDisplay(0.6);
  d.failSet = true;
  const g = new BrightnessGuard(d, dir, 0);
  assert.equal(g.dim(), false);
  assert.equal(g.hasSavedFile(), false, "a failed set leaves no file");

  d.failSet = false;
  assert.equal(g.dim(), true);
  d.failSet = true;
  assert.equal(g.restore(), false);
  assert.equal(g.hasSavedFile(), true, "kept for the next attempt");
  d.failSet = false;
  assert.equal(g.restore(), true);
  assert.equal(d.value, 0.6);

  const dark = new BrightnessGuard(new MemoryDisplay(0), tmpDir(), 0);
  assert.equal(dark.dim(), false, "already dark (the user's choice): nothing to do");
  assert.equal(dark.hasSavedFile(), false);
});

test("corrupt saved file is removed instead of blocking forever", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "brightness-saved.json"), "{nope");
  const g = new BrightnessGuard(new MemoryDisplay(0.5), dir, 0);
  assert.equal(g.restoreStale(), true);
  assert.equal(g.hasSavedFile(), false);
});

test("hard guard: the real helper is never used for dimming when the state dir is overridden (tests/sandboxes)", () => {
  assert.equal(realDimAllowed({ CLAUDEXR_STATE_DIR: "/tmp/x" }, "/path/claudexr-capture"), false);
  assert.equal(realDimAllowed({ CLAUDEXR_STATE_DIR: "/tmp/x" }, "/t/fake-capture.mjs"), true);
  assert.equal(realDimAllowed({}, "/path/claudexr-capture"), true);
  assert.equal(realDimAllowed({ CLAUDEXR_STATE_DIR: "/tmp/x", CLAUDEXR_ALLOW_REAL_DIM: "1" }, "/path/claudexr-capture"), true);
});

test("helper adapter talks to the (fake) helper: get/set round trip through a file", () => {
  const dir = tmpDir();
  const file = path.join(dir, "fake-brightness");
  process.env.FAKE_BRIGHTNESS_FILE = file;
  try {
    const a = new HelperBrightnessAdapter(FAKE);
    assert.equal(a.getSync(), 0.8);
    assert.equal(a.setSync(0.25), true);
    assert.equal(a.getSync(), 0.25);
    const g = new BrightnessGuard(a, dir, 0);
    assert.equal(g.dim(), true);
    assert.equal(a.getSync(), 0);
    g.restore();
    assert.equal(a.getSync(), 0.25);
    delete process.env.FAKE_BRIGHTNESS_FILE;
    assert.equal(new HelperBrightnessAdapter(FAKE).getSync(), null, "unsupported display: no dimming");
    assert.equal(new HelperBrightnessAdapter("/nonexistent/helper").getSync(), null);
  } finally {
    delete process.env.FAKE_BRIGHTNESS_FILE;
  }
});
