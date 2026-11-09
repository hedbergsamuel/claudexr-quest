# Nattens framsteg (ClaudeXR 0.4.0)

Uppdateras löpande. Nästa körning: läs den här filen och `git log --oneline`, fortsätt där det står "Nästa steg".

## Läge just nu
- **Fas 1 pågår** (punkt 1–3: flera strömmar, panelplacering, röst och stabila id). Startad 2026-11-10 00:00.
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

## Punkt 2: panelplacering: PÅGÅR
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
