# ClaudeXR – user feedback, interpreted (EN)

Companion to `handoff-2026-11-09T11-49-48.md`, whose English section only has translated labels; the bug and idea text there is still Swedish. This file is the full English version. Reporter: ägaren (Quest 3, app/bridge 0.2.0). Session: 2026-11-09.

## Requested changes, in the user's priority order

### 1. Orphaned blank panel to the left of the user that cannot be removed (bug, high)
- **Observed:** After `xr_stream display` and `xr_stream window` were started and restarted several times, a blank/idle panel remained to the left of the user.
- **Why it cannot be removed:** `xr_panel list` reports 0 panels, `xr_panel close id:<id>` returns "Not found" for every stream panel id, and `xr_stream stop` returns "Stopped 0".
- **Likely cause:** Restarting a stream creates a new panel and the old panel is not released. Stream panels also appear to be missing from the panel registry.
- **Wanted:** Every panel, stream panels included, is listed and closable. A restart replaces the old panel. A "close all" that also covers streams, and an on-headset escape hatch for orphans.

### 2. The Mac screen should always be streamed and overlaid on the physical screen (feature, high)
- The full-display stream should be persistent and anchored on top of the physical Mac screen.
- **Observed:** Starting a window stream (Notion) made the display stream disappear, so only one stream seems to be allowed at a time.
- **Wanted:** A request from any Claude chat to open a per-app or per-window panel (Notion, for example) must never stop or replace the display stream. Window panels are added next to it. If concurrent streams are a hard limit, return a clear message instead of silently dropping the display stream.

### 3. Dim the physical Mac display to brightness 0 while streaming (feature, medium)
- The reason is that the user looks at the stream, so the physical panel is wasted and distracting.
- **Safety requirement:** Store the original brightness and restore it when the stream stops, the headset disconnects (heartbeat lost / code 1006) or the bridge crashes. Offer an opt-out. A Mac stuck at brightness 0 is unacceptable.

### 4. Voice mode did not work at all (bug, high) and should be redesigned (feature, high)
- **Observed:** The user held the mic button, spoke and released, and nothing reached the chat. A second attempt collided with the "I heard this" confirmation window and failed.
- **Evidence from the bridge log (not in the user's words):** Transcription latency is very high. One clip of 198 KB took 56 s, another of 960 KB took 49 s, and several short clips took 2–4 s. This probably explains "nothing happened", because the result arrives long after release, and the late result then collides with the next attempt or the confirmation window. The log also shows "headset heartbeat lost" and disconnects (code 1006) at 11:47 and 11:48.
- **Wanted redesign:**
  - Tapping the mic icon opens a large panel very close to the head (within finger reach).
  - The user presses and holds it with a finger to speak. Releasing sends the transcript straight to the chat.
  - Show a visible state (listening / transcribing / sent) so it is never silent while waiting.
  - Do not stack a second confirmation window on top. Instead offer a preview of the recognised text with send/cancel (see idea 6).

## Additional improvements the user approved

5. A status bar that is always visible and shows what is being streamed and whether the mic is listening.
6. Voice preview: show the recognised text with send/cancel before it goes to the chat. This also removes the collision with the "I heard this" window.
7. Audio and haptic feedback when the mic starts and stops, so the user knows the press registered.

Not selected by the user: an on-headset panic button (close all panels and restore brightness). It is still worth considering as part of the brightness safety requirement in 3.

## Other findings from this session

- **Window stream is blank while reporting success:** `xr_stream window 178` (Notion) answers "Streaming" but the panel stays black. `xr_stream windows` keeps listing Notion, Claude and Proton VPN as `[ask]` while Terminal is `[allowed]`, even after the user granted every permission in macOS Screen & System Audio Recording. The user had no way to tell where to approve it. Wanted: a clear prompt or error naming the app or window that is waiting for approval.
- **ScreenCaptureKit errors in the helper:** `-3801 user declined TCCs` at 11:33, and `-3805 application connection being interrupted` three times (11:36–11:40). After each, the helper logs `Assertion failed: (did_initialize), function CGS_REQUIRE_INIT, CGInitialization.c line 44`. That points to the capture helper crashing and restarting, not only a permission problem.
- **Dropped frames:** Display stream at 8 Mbps showed `sent 923, dropped 151` (about 16 % dropped).
- **Connection drops:** Two "heartbeat lost" disconnects with code 1006 within a minute. `xr_present` then answered "XR not connected" while the user was still wearing the headset.
- **Interpretation note:** Several of the user's messages are voice transcripts. Spoken wording such as "vilar skärm / vilarpanel" probably means a blank or idle panel, so it should be treated as an uncertain transcription.
