# ClaudeXR: utvecklingsstatus

**0.4.1 KLAR i kod (2026-11-15):** punkt 3 (röstkanal opt-in, mätt: startas inte som standard; svensk svarsmatchning), 7 (Macens ljud: audio-start i serve, PCM över /video, AudioTrack), 8 (verktygsval adb|metavr|hzdb, `quest-cmds`, trådat läge dokumenterat, reverse via hzdb OBEKRÄFTAT), 6 (InputRouter bakom InputGate, NullInputSink, ingen CGEvent). Version 0.4.1 överallt. Brygga `npm test` 171 pass/0 fail/2 skipped, typecheck rent, Quest assembleDebug + 22 JVM-tester gröna, hjälparen kompilerad (aldrig körd). Detaljer: `bugs/CHANGELOG-0.4.1.md`, logg: `.natt-state/UTVECKLING-LOGG.md`.

**Nästa steg:** allt kvarvarande kräver hårdvara. Gör listan "Kräver ägaren 0.4.1" nedan i ordning. Därefter i kod: knapp + pekar-ray i Quest-appen för input_gate/pointer (punkt 6, efter headset-test), CGEvent-mottagare i hjälparen (efter godkänd Hjälpmedel-behörighet), Opus om PCM visar sig för tungt, punkt 9 (närvaroläge) efter kamerans go/no-go.

### Kräver ägaren 0.4.1
1. Bygg och installera hjälparen (`cd mac-helper && ./build.sh`), tillåt "Skärm- och systemljudsinspelning" på nytt. Kör sedan `xr_stream action:audio` medan musik spelar: hörs ljudet, hur stor är fördröjningen mot bilden, glapp? Prova att låsa Macen (ljudet ska tystna).
2. Bekräfta om ljud från uteslutna appar (t.ex. Mail/Meddelanden-ljud) hörs i headsetet. Om ja: säg till, då behövs ett filter.
3. Bygg/installera bryggan och Quest-appen 0.4.1 (`quest-cmds` skriver ut installationskommandot för valt verktyg).
4. Installera om hookarna (`install-hooks --dry-run`, granska, sedan skarpt) för att få `voicewait`/direktväckning; prova att säga något när Claude är ledig.
5. Vill du ha röstkanalen: `"voice": {"channel": true}` och starta Claude Code med `--dangerously-load-development-channels server:claudexr-voice`; titta i daemonloggen på raden "voice channel: client capabilities".
6. Kör `hzdb adb --help` (eller `metavr adb --help`) och se om `reverse` finns. Om ja: prova `quest-cmds --tool hzdb --wired` med kabel.
7. En kvarlämnad testdaemon från en tidigare körning (pid 5118, `node --import tsx src/index.ts` i ClaudeXR-natt/bridge, `CLAUDEXR_PORT=48842`, låtsashjälpare, tillståndsmapp under .natt-state/tmp) ger portkrockar i ungefär var femte testkörning: `kill 5118`. Det är INTE den riktiga bryggan. (Nattutvecklaren fick inte avsluta den.)
8. Godkänn eller avböj nästa steg för punkt 6: CGEvent-styrning kräver Hjälpmedel-behörighet för hjälparen.

# Nattens framsteg (ClaudeXR 0.4.0)

Uppdateras löpande. Nästa körning: läs den här filen och `git log --oneline`, fortsätt där det står "Nästa steg".

## Läge just nu
- **Fas 2 klar 2026-11-10 ~04:45.** Slutrapport: `bugs/CHANGELOG-0.4.0.md`. Ej klart och varför: `bugs/PLAN-0.4-EJ-KLART.md`.
- Fas 2 gjorde: punkt 2 committad, 4 (håll vaken, close all lämnar skärmen, stale), 5 (stäng utom skärmen, bioskärm), 6 (bara input.ts), 10 (kalibreringsfel), versionshöjning, README/SKILL.
- Inget är installerat, inget är testat i headsetet, Mac-hjälparen är byggd men aldrig körd.

## Punkt 1: flera samtidiga fönsterströmmar: KLAR i kod, obevisad på riktig Mac

### Orsaken (hittad i `bugs/reports.jsonl`, inte i en kodrad)
Bryggan 0.3.x startade **en hjälparprocess per ström** (`claudexr-capture stream ...`) och dessutom en kort process
`claudexr-capture list-windows` inför varje fönsterström. Loggen visar att felet
`SCStreamErrorDomain -3805 "application connection being interrupted"` (AUTO-12648a, 9 gånger) kommer **sekunderna
före** varje rapport om att en ström försvann:

| -3805 loggat | Rapport strax efter |
|---|---|
| 17:30:28 | 17:30:41 BUG-2e4ecb (Spotify ersatte Notion) |
| 17:41:53 | 17:42:50 AUTO-30e7ab (gammalt panel-id "Not found") |
| 18:10:11 | 18:10:30 BUG-2153ff (Code ersatte Terminal trots olika roller) |
| 17:26:31, 17:27:50, 18:16:46, 11:36–11:40 | start av fönsterströmmar (Notion/Spotify) |

Kalibrering (`show-marker`, `display-info`) och dimning (`brightness`) kör också hjälparen som egen process, men
gav aldrig -3805. Slutsats: **när en ny hjälparprocess använder ScreenCaptureKit avbryter macOS strömmarna i de
hjälparprocesser som redan kör** (alla har samma signatur-id `com.claudexr.capture`). De dör, bryggan tar bort deras
paneler, Macens skärm startas om automatiskt (nytt id varje gång = BUG-39391d, BUG-9e3e1b), och kvar blir bara den
nyaste fönsterströmmen. Roller har ingenting med saken att göra, vilket stämmer med ägarens test.

Obekräftat: om det är `list-windows`-processen eller den nya `stream`-processen som utlöser avbrottet, och exakt
varför macOS gör så. Det går inte att avgöra utan att köra hjälparen. Lösningen tar bort båda.

### Lösningen
- **Mac-hjälparen:** nytt kommando `serve` (`Serve.swift`): EN process äger alla strömmar och fönsterlistan.
  Kommandon som JSON-rader på stdin, bildrutor märkta med ström-id på stdout. Ett fel i en ström avslutar bara den
  strömmen. `stream` och `list-windows` finns kvar oförändrade i beteende.
- **Bryggan:** `StreamManager` kör som standard i läget `shared` (en hjälparprocess). Fönsterlistan hämtas ur samma
  process. Reservläge: är hjälparen äldre än 0.4.0 (saknar `serve`) faller bryggan tillbaka till 0.3.x-sättet,
  loggar det som fel och visar `helper: perStream (old helper: rebuild ...)` i `xr_status`.
  Rollback utan ombyggnad: `CLAUDEXR_HELPER_MODE=perStream` eller `"helperMode": "perStream"` i `config.json`.
- **Integritet:** en ström som fortsätter skicka efter stopp får hela hjälparprocessen avslutad. Hjälparen avslutas
  3 s efter sista strömmen, så nästa start får en färsk process (plockar upp ändrade skärminspelningstillstånd).
- **Stabila panel-id (BUG-39391d, del av punkt 3):** Macens skärm har alltid panel-id `display`, fönster `win-<fönster-id>`.
  Omstart av en ström behåller id och, om ägaren flyttat panelen, platsen i rummet.

### Testat
- `bridge/test/streams-multi-040.test.ts` (6 tester, låtsashjälpare): skärm + två fönster lever samtidigt i en
  process, en ström som dör tar inte med sig de andra, stabila id, reservläge för gammal hjälpare, rollback-växel,
  integritetsskyddet. Alla gröna.
- Hjälparen kompilerar (`./build.sh --build-path .natt-state/helper-build`). **Aldrig körd.**

### Inte testat (kräver ägaren)
- Att flera strömmar faktiskt lever samtidigt på riktig Mac med nya hjälparen. Det är hela poängen och är obevisat.
- `serve`-läget i Swift är otestat i drift (stopp av en ström, lås/skärmsläckare per ström, fel -3801).
- **Ombyggd hjälpare = ny cdhash = Skärminspelning måste tillåtas på nytt** (plan 11c punkt 4).
- BUG-552260 (blank Notion-ruta trots "Streaming") rapporterades på 0.2.0; 0.3.0 väntar redan på första bildrutan
  innan den svarar "Streaming". Trolig följd av samma -3805. Obekräftat.

## Punkt 2: panelplacering: KLAR i kod (PlacementPlanner), obevisad i headset
## Punkt 3: röstleverans: EJ PÅBÖRJAD

## Till fas 2 (mekaniskt arbete, lämnat med flit)
- Skriv `bugs/CHANGELOG-0.4.0.md` (ändringar per punkt, installationssteg, rollback, Testat / inte testat). Underlag står i den här filen.
- Höj versionsnummer: `bridge/package.json`, `BRIDGE_VERSION` i `bridge/src/config.ts`, Quest-appens `versionName`/`versionCode`, hjälparens README.
- Uppdatera `README.md`, `mac-helper/README.md` och `claude-config/skills/xr-presenter/SKILL.md` med: `serve`, stabila id (`display`, `win-<id>`), `helperMode`.
- Kör hela `npm test` och `npm run typecheck` en sista gång; bygg Quest-appen (`./gradlew :app:assembleDebug --offline`).

## Beslut jag har fattat själv
1. En delad hjälparprocess i stället för att försöka laga processerna var för sig: det är det normala sättet att
   använda ScreenCaptureKit och tar bort båda tänkbara utlösare.
2. Stabila id som fasta namn (`display`, `win-178`) i stället för alias: enklast att förklara och fungerar i alla verktyg.
3. Tester körs med `TMPDIR=.natt-state/tmp` så att inget skrivs utanför arbetsmappen.
