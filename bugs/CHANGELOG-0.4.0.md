# ClaudeXR 0.4.0 (bygge under natten 2026-11-10)

**Ärligt först: ingenting är testat i headsetet och ingenting är installerat.** Mac-hjälparen är byggd men aldrig körd.
Allt nedan är kod som kompilerar och har enhetstester med låtsashjälpare. Nytt arbete är markerat med status.

## Ändringar per punkt

### 1. Flera samtidiga fönsterströmmar (BUG-2e4ecb, BUG-2153ff, BUG-9e3e1b, BUG-552260)
- Orsak (ur loggen, ej en kodrad): bryggan startade en hjälparprocess per ström plus `list-windows`; när en ny process
  använde ScreenCaptureKit avbröt macOS de andra (`SCStreamErrorDomain -3805`, 9 gånger i loggen strax före varje försvunnen ström). Obekräftat på riktig Mac.
- Lösning: Mac-hjälparen får `serve` (EN process för alla strömmar), bryggan kör `helperMode: shared` som standard.
  Reservläge `perStream` om hjälparen är gammal. Rollback: `CLAUDEXR_HELPER_MODE=perStream` eller `"helperMode": "perStream"` i `config.json`.
- Fasta panel-id: Macens skärm `display`, fönster `win-<id>` (BUG-39391d).
- Detaljer: `docs/STATUS.md`.

### 2. Panelplacering (BUG-1fcf21, BUG-3115b5, BUG-4a4024, BUG-068994, BUG-405388, BUG-0863a3)
- Quest-appen: `PlacementPlanner` (ren matematik, enhetstestad) planerar i synfältet: inga överlapp, inget bakom/under Macens skärm
  (tangentbordsytan räknas som upptagen), frågekort närmast (1,0 m), stora paneler flyttas längre bort i stället för att fylla vyn.
- `xr_panel move` dokumenterat som ABSOLUTA meter framför användaren, `size` = meter (IDE-ff2330, i verktygsbeskrivning och SKILL.md).
- Obevisat i headset: själva placeringen i rummet.

### 3. Röstleverans: EJ KLAR (se `bugs/PLAN-0.4-EJ-KLART.md`). Stabila id är klara (punkt 1).

### 4. Macens skärm (BUG-13e417, BUG-7cf1b6)
- Bryggan kör `caffeinate -d -i -w <bryggans pid>` så länge skärmströmmen lever (`bridge/src/keepawake.ts`, startas bara utan `CLAUDEXR_STATE_DIR`, dvs aldrig i tester). Omstart av strömmen och återställd ljusstyrka vid tappad ström fanns redan och är oförändrade.
- Strömpaneler räknas aldrig som stale och städas inte bort av autoTidy; hookens text säger "aldrig Macens skärm".
- `xr_panel close id:all` lämnar nu Macens skärm kvar. `id:everything` stänger även den. Nödknappen "Stäng allt" stänger fortfarande allt.
  **Beteendeändring**: tidigare stängde `all` även skärmen.

### 5. Stäng utom skärmen, bioskärm (IDE-af1e76, IDE-e587a1, IDE-ff2330)
- Knapp "Stäng utom skärmen" i systempanelen, röst ("stäng allt utom skärmen", "stäng alla paneler utom Macens skärm"), meddelande `close_others`.
- Bioskärm: `xr_panel action:screen preset:cinema|bigger|smaller|farther|closer|reset`, röst ("bioskärm", "större skärm", "mindre skärm", "längre bort", "närmare", "återställ"), Quest `PanelManager.screenPreset` (1,8 m bred, 2,0 m bort som start). `reset` återgår till kalibrerad plats. Obevisat i headset, siffrorna är gissade startvärden.

### 6. Paneler som skärmar (IDE-11c7f5): endast tunt gränssnitt
- `bridge/src/input.ts`: koordinatmappning och `InputGate` (av som standard, röst/MCP kan inte slå på). Inte inkopplat. Resten: "ej klart".

### 7–9: ej byggda (ljud, trådat läge, närvaroläge). Orsaker i `bugs/PLAN-0.4-EJ-KLART.md`.

### 10. Kalibrering (BUG-cc393a): begripliga felmeddelanden (`calibrationHint`). Orsaken till timeouten är obekräftad.

### Versioner
Brygga 0.4.0, Quest-appen 0.4.0 (versionCode 5), Mac-hjälparen 0.4.0.

## Installationssteg (i ordning, när du är vaken)
1. Granska `git log` i `ClaudeXR-natt` (ett litet commit per delmoment).
2. Bygg hjälparen: `cd mac-helper && ./build.sh`. **Ny cdhash: tillåt Skärminspelning för `claudexr-capture` på nytt** (Systeminställningar → Integritet och säkerhet).
3. Bygg bryggan: `cd bridge && npm ci && npm run build`. Kopiera till `~/Library/Application Support/ClaudeXR` enligt din vanliga rutin och starta om daemonen (`xr`-rutinen / `install-daemon.sh`).
4. Bygg Quest-appen: `cd quest-app && ./gradlew :app:assembleDebug`, installera med `adb install -r` (kabel).
5. Uppdatera skillen: kopiera `claude-config/skills/xr-presenter/SKILL.md`.
6. Prova i ordningen: (a) skärm + två fönsterströmmar samtidigt, (b) öppna fem paneler och se att inget överlappar, (c) säg "bioskärm" / "återställ", (d) tryck "Stäng utom skärmen".

## Ta tillbaka / rollback
- Strömmar: `CLAUDEXR_HELPER_MODE=perStream` (0.3.x-läge, utan ombyggd hjälpare).
- Allt: gå tillbaka till commit `7100331` (utgångsläget) eller installera den gamla mappen `Meta XR` igen.
- Håll-vaken: `caffeinate` dör med bryggan; inget att ångra.

## Testat / inte testat
**Testat (automatiskt):**
- Quest: `./gradlew :app:testDebugUnitTest` grönt (PlacementPlanner), `assembleDebug` bygger.
- Brygga: `npm run typecheck` rent. Enskilda testfiler körda och gröna: display, keepawake (inkl. röstkommandon), input, voice, streams-multi-040. Resultat per fil för övriga: se avsnittet "Sista testkörning" nedan.
- `hookgate-031.test.ts` ("generated hook command works end to end") **faller redan på utgångsläget** (commit bfcae81), alltså inte orsakat av nattens ändringar; orsak ej utrönt (troligen miljö/curl). Efter det felet hänger hela `npm test` i den här miljön, så jag körde testfilerna var för sig.

**Inte testat:** allt i headsetet; Mac-hjälparens `serve` på riktig Mac; `caffeinate` i drift; om flera strömmar faktiskt lever samtidigt; placering i rummet; bioskärm; knappen och röstkommandona; kalibreringsfelen.

## Sista testkörning
2026-11-10 ca 04:40, testfil för testfil (`node --import tsx --test <fil>`, `TMPDIR=.natt-state/tmp`): alla 24 filer gröna, utom `hookgate-031.test.ts` som hoppades över (faller redan på utgångsläget). `stream.test.ts` hade tre kontroller som förväntade 0.3.x-protokollet (`stdin K`, `B n`, `--max-width`); de godtar nu även `serve`-protokollet (JSON-rader). Ingen test använder 47800/47801 (de körs på 48xxx).
