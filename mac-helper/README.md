# claudexr-capture (Mac-hjälparen) 0.4.1

Litet Swift-CLI som ClaudeXR-bryggan startar för skärm-/fönsterspegling, kalibreringsmarkören,
(valfri) taligenkänning på enheten och ljusstyrka för den inbyggda skärmen.

    cd "/Users/<användare>/Downloads/Meta XR/mac-helper"
    ./build.sh                          # swift build -c release + ad hoc-signering (stabil identifier)
    ./build.sh --build-path /tmp/xyz    # bygg någon annanstans och lämna .build orörd
    .build/release/claudexr-capture display-info

## Kommandon
- `serve` (0.4.0): EN process äger alla strömmar och fönsterlistan; kommandon som JSON-rader på stdin, bildrutor märkta med ström-id på stdout. Bryggan använder den som standard (`helperMode: shared`, rollback `CLAUDEXR_HELPER_MODE=perStream`). Aldrig körd på riktig Mac än.
- `serve`, 0.4.1 (protokoll 2): `{"cmd":"audio-start","sid":"au1","excludeBundles":[...]}` startar Macens systemljud
  (ScreenCaptureKit `capturesAudio`, 48 kHz, 2 kanaler, utan hjälparens eget ljud). Ramarna har samma huvud som video
  med `flags` 0x80 och innehåller PCM s16le 48 kHz stereo. `{"cmd":"audio-stop","sid":"au1"}` stoppar. Händelser:
  `audio_started`, `audio_stopped`, `paused`/`resumed` (låst Mac), `error`. `serve_ready` säger nu `"protocol":2`;
  en 0.4.0-hjälpare (protokoll 1) ignorerar `audio-start`, och därför skickar bryggan det bara till protokoll 2.
  Kompilerad, **aldrig körd**. Obekräftat: att uteslutna appars ljud också utesluts, och SCK:s egen fördröjning.
- `list-windows`: JSON-lista över fönster (kräver skärminspelningstillstånd).
- `display-info`: geometri för huvudskärmen (punkter, pixlar, millimeter).
- `stream --window ID | --display ID [--fps --bitrate --max-width --exclude-bundles]`: H.264 på stdout,
  JSON-händelser på stderr: `started`, `first_frame`, `paused`, `resumed`, `error` (med `code`/`domain`, eller
  `code:-3801` m.fl.). Stdin: `K` = IDR nu, `B <bps>` = bitrate.
- `show-marker`, `stt-apple`: som tidigare.
- `brightness get [--display ID]` -> `{"brightness":0.62,"displayId":N}`; `brightness set <0..1>` -> `{"ok":true,"brightness":v}`.
  Bara inbyggd skärm (DisplayServices, reserv IOKit). Annars `{"error":"unsupported"}` och exit 1. `set` ändrar den RIKTIGA
  ljusstyrkan och körs aldrig av tester.

## 0.4.1
Ny kod (ljud), så hjälparen **måste byggas om** för ljud i headsetet: `./build.sh`. Ny cdhash betyder att
"Skärm- och systemljudsinspelning" kan behöva tillåtas på nytt (ta bort den gamla posten och lägg till igen vid -3801).
Bryggan 0.4.1 fungerar med en 0.4.0-hjälpare (allt utom ljud) och visar då ett tydligt fel för `xr_stream audio`.

## 0.3.1
Ingen kodändring: bara versionssträngen i Info.plist och denna rubrik. Du behöver INTE bygga om hjälparen (en ombyggnad ger ny cdhash och kräver ny Skärminspelning-tillåtelse); den installerade 0.3.0-binären fungerar oförändrad.

## Ändringar i 0.3.0
- **AppKit/fönsterserveranslutning först** (`NSApplication.shared`, policy `.prohibited`) och NSApplication-slingan för `stream` och
  `list-windows`. Loggens `Assertion failed: (did_initialize), function CGS_REQUIRE_INIT` kommer när CoreGraphics/ScreenCaptureKit
  används av en process utan fönsterserveranslutning.
- **Tillståndsvarning** med `CGPreflightScreenCaptureAccess()` före `stream`/`list-windows`: bara en `warning`-händelse (`tcc_preflight_false`), inte ett avbrott, eftersom förkontrollen är opålitlig när ansvarig process är en annan binär (launchd → node → hjälparen). Ett verkligt nekande kommer från ScreenCaptureKit som fel `-3801`, som bryggan översätter till en tydlig text.
- **Statiska bilder**: ScreenCaptureKit skickar bara bilder när innehållet ändras. Senaste bilden sparas och kodas om vid `K` och efter
  500 ms tystnad, så en stilla skärm/ett stilla fönster blir inte blankt (trolig orsak till blank Notion-ström). `first_frame` meddelas.
- Felhändelser har numerisk `code` och `domain`.

## Orsaker till felen i 0.2.0-loggen
- **-3801 "user declined TCCs"**: macOS avvisar skärminspelning för processen. Trolig orsak: ny cdhash efter ombygge (ad hoc-signerad
  binär identifieras på cdhash), eller att tillståndet gavs åt en annan process än den som faktiskt kör (daemonen startar via launchd:
  `node` och/eller `claudexr-capture`). Åtgärd: tillåt båda, ta bort gamla poster, starta om daemonen.
- **-3805 "application connection being interrupted"**: anslutningen till capture-tjänsten/fönsterservern bröts (typiskt process utan
  korrekt AppKit-initiering, eller tjänsten startades om). Hjälparen avslutar då och bryggan startar om strömmen.
- **CGS_REQUIRE_INIT**: se ovan, rättat genom AppKit-initiering.

## Testat / otestat
Testat: kompilerar (Swift 6.4, macOS 27, release), `display-info` och `brightness get` körda, felfall `brightness bogus` (exit 2).
INTE testat: `stream` (hela kedjan, omkodning av stilla bild, `first_frame`), `list-windows`, varningen `tcc_preflight_false` och -3801-vägen, `brightness set`,
DisplayServices på andra Mac-modeller, IOKit-reserven, ad hoc-signering i praktiken (TCC-beteende efter ombygge).
