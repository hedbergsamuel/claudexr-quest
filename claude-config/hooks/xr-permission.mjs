#!/usr/bin/env node
// PermissionRequest (command-hook shim; logic: bridge/src/hookapi.ts buildPermissionPanel).
// FAIL-CLOSED: prints a decision only after an explicit tap in the paired headset. Shows the request
// exactly (never masked/clipped); requests that cannot be shown exactly go to the terminal prompt.
// Off switch: ~/.claudexr/permissions-off, or "xrPermissions": false in ~/.claudexr/config.json.
import { runShim } from "./lib/common.mjs";
runShim("permission", 0);
