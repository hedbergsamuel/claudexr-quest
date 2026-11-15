# ClaudeXR 0.4.1 (bygge 2026-11-15)

**Ärligt först:** ingenting är installerat och ingenting är testat i headsetet eller på riktig Mac. Mac-hjälparen är
kompilerad men aldrig körd. Ingen `adb`/`hzdb`/`metavr` har körts. Allt nedan är bevisat med tester mot en
låtsashjälpare och ett simulerat headset, och Quest-appen är byggd (inte installerad).

## Ändringar per punkt

### Punkt 3: röst (BUG-6b9a81 m.fl.)
- **Mätt i kod:** röstkanalen startas **inte** som standard. Den finns bara som `index.js --voice-channel` (stdio-MCP)
  och kräver `claude --dangerously-load-development-channels server:claudexr-voice`. Den är inte registrerad i
  `~/.claude.json` och saknas i `claude-config/mcp.example.json`. 0.4.0-hooken `voicewait` (asyncRewake) är inte
  installerad i ägarens `~/.claude/settings.json` (bara läst). Röstmeddelanden går därför via `PostToolUse`, `Stop`
  eller nästa prompt, och direktväckning (`rewake`) fungerar först när hookarna installerats om.
- **Röstkanalen är opt-in:** `"voice": {"channel": true}` eller `CLAUDEXR_VOICE_CHANNEL=1`. När den är avstängd svarar
  `voice_take` med `disabled`, rör inte inkorgen och markerar inte kanalen som levande. Skäl: en kanal som registrerats
  som vanlig MCP-server startas även utan dev-flaggan. Den skulle då tömma inkorgen till notiser som sessionen ignorerar,
  medan headsetet säger "Skickat". Kanalprocessen loggar klientens capabilities (diagnostik).
- `xr_status` visar `voice.channelEnabled`.
- **Svensk svarsmatchning:** utfyllnadsord (ja, okej, tack, nu) tas bort i alternativ, fungerar/fungerar inte och A/B.
  Nya former: ettan, tvåan, trean, fyran, "den andra", "alternativet tre", "nej det funkar inte" och "ingen av dom".
  Motsägelser som "nej det funkar" blir fritt svar. Nya felhörningar: klaud → Claude, hedsetet → headsetet.
  Hela yttrandet krävs fortfarande, och rösten kan fortfarande aldrig godkänna något.

### Punkt 7: Macens ljud i headsetet (IDE-8e4736, IDE-097b42)
- **Mac-hjälparen:** `AudioCapture.swift` och kommandona `audio-start`/`audio-stop` i `serve`. `serve_ready` säger
  `protocol: 2`. ScreenCaptureKit `capturesAudio` (48 kHz, 2 kanaler, utan hjälparens eget ljud) med en 2x2 px
  videoutgång som ignoreras. Float32 konverteras till PCM s16le. Ramarna har samma huvud som video, med `flags` 0x80.
  Ljudet pausas när Macen låses.
- **Bryggan:** ljudet startas bara när protokollet är minst 2. En 0.4.0-hjälpare ignorerar okända kommandon, så den får
  ett tydligt fel ("för gammal för ljud, bygg om") i stället för tystnad. Ljudet skickas som `0xC3`-ramar på
  `/video`-socketen **utanför** videons flödeskontroll. Ett block släpps (och räknas) om socketens buffert är över
  64 KB, eftersom sent ljud är värre än ett glapp. Integritetsskyddet gäller även ljud: hjälparen avslutas om den
  fortsätter skicka efter stopp. Ljudet stoppas vid nödstopp och när headsetet försvinner, och är **av tills det
  startas**.
- **MCP:** `xr_stream action:audio`, stopp `action:stop id:audio`. `xr_status`/`xr_panel list` visar `audio: live N kbit/s`.
- **Quest:** `Protocol.parseAudio` och `MacAudioPlayer`. Uppspelningen använder AudioTrack i `PERFORMANCE_MODE_LOW_LATENCY`
  med en kö på 8 block (det äldsta släpps) och frisläpps efter 1,5 s tystnad. Den är inkopplad i `BridgeConnection`
  och `MainActivity`, och kön töms i `onPause`.
- **Fördröjning (simulator):** i bryggans pipeline (hjälparens stdout → WSS → simulerat headset, loopback) var p50
  0,6 ms och p95 0,9 ms (n=132). ScreenCaptureKits leverans och AudioTracks buffert ingår **inte**, och målet
  < 150 ms totalt är obevisat.
- Varför PCM och inte Opus: ingen codec behövs på någon sida (Quest-bygget är offline utan nya beroenden), det ger
  lägst fördröjning, och ~1,5 Mbit/s är lite på samma LAN som videon. Opus kan komma senare.

### Punkt 8: trådat/trådlöst läge, verktygsval (IDE-8fc855, IDE-a56e94)
- `bridge/src/devicetool.ts` bygger rena argumentlistor för `adb`, `metavr` och `hzdb`. Åtgärderna är devices, install,
  launch, launch-wired, reverse, reverse-remove, wifi-enable och wifi-connect. Varje kommando är märkt `confirmed`.
- Verktyget väljs med `"deviceTool"` i `config.json` eller `CLAUDEXR_DEVICE_TOOL`. Standard är `adb`.
- `node dist/src/index.js quest-cmds [--tool adb|metavr|hzdb] [--wired] [--apk] [--ip] [--url]` **skriver bara ut**
  kommandona. Inget körs.
- **OBEKRÄFTAT: `reverse` via metavr/hzdb.** Metas dokumentation tar inte upp det, och det enda belägget är en
  tredjepartskopia av hzdb-skillen. Raden skrivs därför ut som `# OBEKRÄFTAT:`. Underlag: `bugs/META-MCP-UNDERSOKNING.md`.
- Trådat läge är dokumenterat i README. Det använder `reverse tcp:47800 tcp:47800` och `bridge_url=wss://127.0.0.1:47800/headset`.
  Begränsningar: Bonjour fungerar inte över USB, förhandsvisnings-URL:er blir 127.0.0.1, och bara port 47800 vidarebefordras.
- Inget installationsskript använde `adb` (bara README), så inget skript behövde ändras.

### Punkt 6: paneler som skärmar (IDE-11c7f5): inkopplat gränssnitt, ingen styrning av Macen
- `InputRouter` består av grind, validering (`parsePointer`), mappning och en mottagare. Den enda mottagaren är
  `NullInputSink`, som **skickar ingenting till Macen**. Grinden stängs själv efter 5 minuter utan händelser.
- Headsetmeddelandena `input_gate` (fysisk knapp) och `pointer` hanteras i hubben. MCP, `/event`, `/command` och rösten
  har ingen väg att öppna grinden. Grinden stängs vid nödstopp och när headsetet försvinner.
- Målrektangel finns bara för panelen `display` (huvudskärmen, origo 0,0, punkter från `display-info`). Fönster saknar
  position från hjälparen, så deras händelser släpps.
- Inte byggt (kräver riktig Mac eller headset): CGEvent-insprutning, virtuella skärmar, arrangemangssynk, knapp och
  pekar-ray i Quest-appen.

### Övrigt
- **StreamManager (fel som fanns i 0.4.0):** en hjälparprocess som integritetsskyddet avslutar släpps nu direkt. När en
  process tar slut avslutas bara de strömmar den själv startade (`sv.sids`). Förut kunde en ström som startades direkt
  efter ett avslut misslyckas ("list-windows failed: the Mac helper ended"), och testet streams-multi-040 föll ungefär
  1 gång av 5.

### Versioner
Bryggan 0.4.1, Quest-appen 0.4.1 (versionCode 6), Mac-hjälparen 0.4.1 (Info.plist, README).

## Installationssteg (i ordning)
1. Granska `git log` i `ClaudeXR-natt`. Det finns en commit per punkt.
2. Bygg hjälparen: `cd mac-helper && ./build.sh`. Det behövs för ljud. Ny cdhash betyder att du ska tillåta
   **Skärm- och systemljudsinspelning** för `claudexr-capture` på nytt.
3. Bygg bryggan: `cd bridge && npm ci && npm run build`. Kopiera och starta om daemonen enligt din vanliga rutin
   (`install-daemon.sh`).
4. Installera hookarna igen om du vill ha direktväckning (`voicewait`): `node …/index.js install-hooks --dry-run`,
   granska diffen och kör sedan utan `--dry-run`.
5. Bygg Quest-appen: `cd quest-app && ./gradlew :app:assembleDebug`. Installera med kommandot som
   `node …/index.js quest-cmds` skriver ut (standard `adb install -r …`).
6. Uppdatera skillen genom att kopiera `claude-config/skills/xr-presenter/SKILL.md`.
7. Prova: (a) `xr_stream action:audio` medan något spelar på Macen, lyssna efter fördröjning och glapp, (b) svara
   "okej, nummer två tack" på ett xr_ask-kort, (c) `quest-cmds --tool hzdb --wired` och därefter `hzdb adb --help`.

## Ta tillbaka / rollback
- Ljud: starta det inte (det är av som standard), eller kör `xr_stream action:stop id:audio`. En 0.4.0-hjälpare
  fungerar med bryggan 0.4.1 för allt utom ljud.
- Röstkanalen: den är redan av. Det gamla beteendet får du med `"voice": {"channel": true}`.
- Verktygsval: `"deviceTool": "adb"` (standard).
- Allt: gå tillbaka till commit `9dd6984` (0.4.0 med röstleverans).

## Testat / inte testat
**Testat (automatiskt, 2026-11-15):**
- Bryggan: `npm run typecheck` rent. `timeout 590 npm test`: 172 tester, **170 pass, 0 fail, 0 cancelled, 2 skipped**
  (~160 s). Nya testfiler: `voice-041`, `audio-041`, `devicetool-041`, och utökade `input`, `voice2` och `streams-multi-040`.
- Quest: `./gradlew :app:assembleDebug :app:testDebugUnitTest --offline` grönt, med 22 JVM-tester (ProtocolTest 12
  inklusive ljudblock, PlacementPlanner 9, CalibrationMath 1).
- Mac-hjälparen: `./build.sh --build-path .natt-state/helper-build` kompilerar och signeras ad hoc. **Den har aldrig körts.**

**Inte testat:**
- Allt i headsetet: ljuduppspelning, fördröjning och glapp, AudioTrack i låg latens på Quest 3, att `onPause` tystar.
- Mac-hjälparens `audio-start` på riktig Mac: SCK-ljud, behörighet, format (float32 48 kHz förväntas), om uteslutna
  appars ljud verkligen utesluts, och paus vid låst skärm.
- Röstkanalen mot en riktig Claude Code-session, och vilka capabilities Claude Code annonserar.
- `metavr`/`hzdb` över huvud taget, i synnerhet `reverse`. Trådat läge med fastnålat certifikat mot 127.0.0.1.
- Inmatning: ingenting når Macen än. Knapp och pekare i Quest-appen finns inte.

## Kräver ägaren
Se slutet av `NATT-FRAMSTEG.md` (listan "Kräver ägaren 0.4.1").
