#!/usr/bin/env node
// Activity events for the live status panel (command-hook shim; logic: bridge/src/hookapi.ts trimEvent).
// Prints nothing: zero tokens in Claude's context.
import { runShim } from "./lib/common.mjs";
runShim("activity", 800);
