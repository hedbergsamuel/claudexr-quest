#!/usr/bin/env node
// SessionStart + UserPromptSubmit (command-hook shim; logic: bridge/src/hookapi.ts ContextHook).
// Silent (zero tokens) without a connected headset; one short line only when the state changes.
import { runShim } from "./lib/common.mjs";
runShim("context", 1500);
