# Att bidra till ClaudeXR

Tack för att du vill hjälpa till. Den här guiden beskriver hur du kommer igång, hur vi arbetar, vad som måste vara grönt innan en ändring går in och vilka regler som gäller för säkerhet. Läs den hela en gång. Det mesta du undrar över kring bygge och installation står i `README.md`, och var utvecklingen står just nu står i `docs/STATUS.md`.

## Innehåll

1. [Vad ClaudeXR är](#1-vad-claudexr-är)
2. [Läget just nu: vad som är bevisat och inte](#2-läget-just-nu-vad-som-är-bevisat-och-inte)
3. [Det här behöver du](#3-det-här-behöver-du)
4. [Kom igång](#4-kom-igång)
5. [Projektets uppbyggnad](#5-projektets-uppbyggnad)
6. [Arbetsflöde: grenar, commits och pull requests](#6-arbetsflöde-grenar-commits-och-pull-requests)
7. [Tester och kvalitetskrav](#7-tester-och-kvalitetskrav)
8. [Kodkonventioner](#8-kodkonventioner)
9. [Säkerhetsregler (obligatoriska)](#9-säkerhetsregler-obligatoriska)
10. [Arbeta utan headset eller riktig Mac](#10-arbeta-utan-headset-eller-riktig-mac)
11. [Buggrapporter och utvecklingsläget](#11-buggrapporter-och-utvecklingsläget)
12. [Dokumentation, versioner och releaser](#12-dokumentation-versioner-och-releaser)
13. [Vanliga fallgropar](#13-vanliga-fallgropar)
14. [Arbeta med AI-assistans](#14-arbeta-med-ai-assistans)
15. [Checklista innan du öppnar en pull request](#15-checklista-innan-du-öppnar-en-pull-request)
16. [Hjälp, frågor och licens](#16-hjälp-frågor-och-licens)

---

## 1. Vad ClaudeXR är

ClaudeXR visar Claude Codes arbete i ett Meta Quest 3-headset: paneler i rummet för förhandsvisning, diff, aktivitet och godkännanden, Macens skärm och fönster som video, och röststyrning. Systemet har fyra delar:

| Del | Språk | Roll |
|---|---|---|
| **Bryggan** (`bridge/`) | TypeScript (Node ≥ 20) | Daemon på Macen. Talar MCP och hookar mot Claude Code, WSS mot headsetet, startar och styr Mac-hjälparen, hanterar röst, parkoppling och buggrapporter. |
| **Quest-appen** (`quest-app/`) | Kotlin, Meta Spatial SDK 0.15.0 | Visar paneler, spelar upp video och ljud, tar emot tal och sköter kalibrering mot Macens skärm. |
| **Mac-hjälparen** (`mac-helper/`) | Swift (`claudexr-capture`) | ScreenCaptureKit till H.264, systemljud, QR-markör för kalibrering, Apples taligenkänning. |
| **Claude-konfiguration** (`claude-config/`) | JSON, Markdown, Node | Skills, hook-skript, exempelinställningar och mallar. |

Arkitekturdiagrammet finns i `README.md` under "Arkitektur". Kort: Claude Code pratar med bryggan över loopback (`127.0.0.1:47801`), headsetet pratar med bryggan över TLS (`wss://:47800`), och bryggan startar Mac-hjälparen som en egen process.

## 2. Läget just nu: vad som är bevisat och inte

Var ärlig om detta i alla ändringar och pull requests. Läs "Testat och otestat" i `README.md` och `bugs/CHANGELOG-0.4.1.md` innan du börjar.

- **Bevisat med automatiska tester:** bryggans logik (protokoll, parkoppling, godkännanden, strömhantering mot en låtsashjälpare, röstrouting, installationsverktyg), Quest-appens rena logik (JVM-enhetstester) och att allt kompilerar.
- **Aldrig körd på riktig hårdvara:** Mac-hjälparens `serve`-läge och ljudfångst, flera samtidiga fönsterströmmar, ljuduppspelning i headsetet, tryck-för-att-prata och placering av paneler i rummet.
- **Inte byggt:** styrning av Macen från headsetet (CGEvent, pekare, virtuella skärmar) och närvaroläget. Gränssnittet `input.ts` finns men skickar ingenting till Macen.

Skriv aldrig att något "fungerar" om det bara har kompilerat eller passerat simulatorn. Skriv vad som är testat och hur.

## 3. Det här behöver du

**Minst, för bryggan och dess tester:**
- macOS (bryggan och hjälparen är byggda för Mac)
- Node.js 20 eller nyare och npm
- Git

**För hela kedjan:**
- Xcode eller Command Line Tools med Swift 5.9 (hjälparen kräver macOS 13 eller nyare)
- Android Studio med dess JDK. Quest-appen använder `compileSdk` och `minSdk` 34 och Android Studios inbyggda JDK
- Ett verktyg för att nå headsetet: `adb` (Android platform-tools), eller Metas `metavr`/`hzdb`
- En Quest 3 med utvecklarläge påslaget (kräver en organisation på developers.meta.com/horizon)
- Claude Code installerat och inloggat
- Valfritt för röst: `brew install whisper-cpp` och en whisper-modell. Se "Röst" i `README.md`

Du kan arbeta mycket utan headset, se [avsnitt 10](#10-arbeta-utan-headset-eller-riktig-mac).

## 4. Kom igång

### 4.1 Hämta koden

Repot är privat. Be ägaren bjuda in dig på GitHub, acceptera inbjudan och klona sedan:

```bash
git clone https://github.com/hedbergsamuel/claudexr-quest.git
cd claudexr-quest
```

Där i den här guiden står `~/ClaudeXR` menas din egen klon, vart den än ligger.

### 4.2 Bryggan

```bash
cd bridge
npm ci
npm run build
npm run typecheck
```

Hela testsviten tar ungefär 2,5 minuter:

```bash
mkdir -p ../.natt-state/tmp   # mappen är ignorerad av git
export TMPDIR="$PWD/../.natt-state/tmp"
timeout 590 npm test
```

**Viktigt om tidsgränsen.** Kör aldrig sviten med en tidsgräns under 300 sekunder. Node-testrunnern markerar då alla filer som inte hunnit köras som `cancelled` med felet "Promise resolution is still pending but the event loop has already resolved". Det ser ut som en hängning men är bara en avbruten körning. Testerna körs en fil i taget (`--test-concurrency=1`).

Du kan köra en enskild testfil för snabb återkoppling:

```bash
timeout 120 node --import tsx --test test/voice-delivery-040.test.ts
```

Det finns också ett simulerat headset (`npm run sim`) och ett rått JSON-RPC-test (`npm run e2e`).

### 4.3 Quest-appen

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
cd quest-app
./gradlew :app:assembleDebug --offline      # bygg
./gradlew :app:testDebugUnitTest --offline  # JVM-enhetstester (22 st vid 0.4.1)
```

Första bygget behöver nätverk för att hämta beroenden. Utan `--offline` tar du det. `quest-app/local.properties` är personlig och ska inte checkas in.

Installation i headsetet beskrivs i `README.md` ("Quest 3") och i `bridge`: `node dist/src/index.js quest-cmds` skriver ut rätt kommandon för ditt verktyg (`adb`, `metavr` eller `hzdb`) utan att köra dem.

### 4.4 Mac-hjälparen

```bash
cd mac-helper
./build.sh                                   # bygger och signerar ad hoc
./build.sh --build-path /tmp/min-hjalpare    # bygg till annan mapp, lämnar .build orörd
```

Hjälparen ska inte köras utan att du förstår vad den gör: den kräver behörigheten "Skärm- och systemljudsinspelning" och startar skärmfångst. Läs `mac-helper/README.md` först. En ombyggd hjälpare får ny cdhash, och då måste behörigheten tillåtas på nytt (se [fallgropar](#13-vanliga-fallgropar)).

### 4.5 Installera hela systemet för eget bruk

Följ "Snabbstart" och "Installation i detalj" i `README.md`. Gör det på en dator där du får ändra Claude Codes inställningar, och använd `install-hooks --dry-run` för att granska ändringarna innan du kör skarpt. Bryggan startas manuellt eller som launchd-agent via `npm run install-daemon`.

## 5. Projektets uppbyggnad

```
bridge/                 Daemonen (TypeScript)
  src/                  Källkod: hub.ts (kärnan), protocol.ts, tools.ts, stream.ts,
                        videoflow.ts, voice*.ts, pairing.ts, tls.ts, input.ts,
                        devicetool.ts, hooksetup.ts, mask.ts, ...
  test/                 Tester (*.test.ts), en fil per område
  sim/                  Simulerat headset
  scripts/              Hjälpskript (install-daemon.sh, e2e)
quest-app/              Android-projektet
  app/src/main/java/com/claudexr/quest/
                        BridgeConnection, PanelManager, PlacementPlanner,
                        VideoDecoder, MacAudioPlayer, VoiceRecorder, ui/ ...
mac-helper/             Swift-CLI claudexr-capture
  Sources/claudexr-capture/
                        Serve.swift (en process för alla strömmar), Capture.swift,
                        AudioCapture.swift, Marker.swift, AppleSTT.swift ...
claude-config/          Skills (xr-presenter, xr-devmode), hooks, exempelinställningar,
                        CLAUDE.md-snippet, mallar
bugs/                   Buggrapporter, changelogs och överlämningar
docs/
  STATUS.md             Var utvecklingen står och vad som kräver hårdvara
  historik/             Gamla granskningar och byggloggar (arkiv)
plan/                   Planer
```

Protokollet mellan bryggan och Quest-appen definieras på två ställen som måste hållas i takt: `bridge/src/protocol.ts` och `quest-app/.../Protocol.kt`. Ändrar du ett meddelande ska du ändra båda i samma pull request och lägga till ett test i bryggan.

## 6. Arbetsflöde: grenar, commits och pull requests

**Behandla `main` som skyddad, även om GitHub inte tvingar det.** Pusha aldrig direkt till `main` och aldrig med `--force`.

1. Skapa en gren från aktuell `main`: `git switch -c typ/kort-beskrivning`. Använd typ som `funktion/`, `fix/`, `docs/` eller `stad/`, till exempel `fix/ljud-glapp` eller `funktion/audio-latensmatning`.
2. Gör små, sammanhängande ändringar. En logisk ändring per commit.
3. Kör kontrollerna i [avsnitt 7](#7-tester-och-kvalitetskrav).
4. Pusha grenen och öppna en pull request mot `main`. Beskriv vad som ändrats, varför, och uttryckligen **Testat** och **Inte testat** (se mallen i [avsnitt 15](#15-checklista-innan-du-öppnar-en-pull-request)).
5. Någon annan granskar. Åtgärda kommentarer med nya commits, inte genom att skriva om historiken efter att granskningen börjat.
6. Ägaren eller en granskare slår ihop pull requesten.

**Commit-meddelanden** skrivs på svenska. Första raden är en kort sammanfattning i presens eller som ett substantiv. Ange gärna området först, som historiken gör:

```
Punkt 7: Macens ljud i headsetet (audio-start i serve, PCM över /video, AudioTrack i Quest)
BUG-cc393a: begripliga kalibreringsfel
Städning: historik till docs/historik
```

Lägg en tom rad och en förklaring efter första raden när *varför* inte är uppenbart. Referera till buggrapporter med deras id (`BUG-…`, `AUTO-…`, `IDE-…`) från `bugs/`.

Checka inte in byggresultat, APK-filer, modeller, loggar eller något annat som genereras. `.gitignore` täcker det vanliga. Bli du osäker: kör `git status` och läs listan innan `git add`.

## 7. Tester och kvalitetskrav

Det här ska vara grönt innan du öppnar en pull request, för de delar du rört:

| Del | Kommando | Krav |
|---|---|---|
| Bryggan | `npm run typecheck` | Inga fel |
| Bryggan | `timeout 590 npm test` | 0 fel, 0 cancelled |
| Quest-appen | `./gradlew :app:assembleDebug --offline` | `BUILD SUCCESSFUL` |
| Quest-appen | `./gradlew :app:testDebugUnitTest --offline` | Alla gröna |
| Mac-hjälparen | `./build.sh --build-path <mapp>` | Kompilerar |

**Skriv tester för ny logik.** Nya bryggtester läggs som `bridge/test/<område>.test.ts` och använder Nodes inbyggda testrunner (`node:test`). Följ gärna en befintlig testfil med liknande uppgift som förebild.

**Tester får aldrig röra dina riktiga inställningar.** Bryggan styrs av miljövariabler som låter testerna isolera sig. Det viktiga är `CLAUDEXR_STATE_DIR` (tillståndsmapp), `CLAUDEXR_PORT` (port), `CLAUDEXR_BUGS_DIR` (buggrapporter) och `CLAUDEXR_FLAG_DIR`. Sätt dem alltid till en tillfällig mapp i tester. Ett test som anropar `loadConfig()` mot den riktiga `~/.claudexr` är ett fel. Avsluta också alltid testdaemoner du startar, eftersom en kvarlämnad daemon kan ge falska fel som "missing or wrong token".

**Gör testerna deterministiska.** Undvik att vänta på riktig tid och riktiga portar. Använd låtsashjälparen och simulatorn. Ett test som faller ungefär var femte körning är ett fel som ska lagas, inte köras om tills det blir grönt.

**Mät, gissa inte.** Påstår du att något är snabbare, tystare eller mer stabilt ska det finnas en mätning eller ett test. Skriv i pull requesten vad du mätte och vad som *inte* ingick i mätningen (till exempel att simulatorn inte mäter Mac-hjälparens ljudfångst).

## 8. Kodkonventioner

Följ stilen i filen du ändrar. Några regler som gäller överallt:

**TypeScript (bryggan)**
- ES-moduler (`"type": "module"`). Importer av egna filer skrivs med `.js`-ändelse, som i resten av koden.
- `strict` typning. `npm run typecheck` måste vara rent. Undvik `any`.
- All data som kommer utifrån (headsetet, hookar, MCP, hjälparen) valideras innan den används, i regel med `zod` eller med de befintliga ramvalideringarna. Lita inte på typer från nätverket.
- Begränsa storlekar: ramar, köer och buffrar ska ha tak. Hellre att något släpps (som ljudblock över 64 KB buffert) än att minnet växer.
- Logga aldrig rådata som kan innehålla hemligheter. Skicka text genom `maskSecrets` (`bridge/src/mask.ts`) innan den loggas eller visas.
- Användarvänd text (felmeddelanden, status, rapporter) skrivs på svenska och ska säga vad användaren kan göra, inte bara vad som gick fel.

**Kotlin (Quest-appen)**
- Håll logik som går att testa utan Android (till exempel `PlacementPlanner`, `CalibrationMath`, `RoleLayout`) i rena klasser med JVM-tester.
- Blockera inte huvudtråden. Ljud, video och nätverk körs på egna trådar.
- Lägg till nya meddelanden i `Protocol.kt` i takt med `protocol.ts`.

**Swift (Mac-hjälparen)**
- Ett fel i en ström ska bara avsluta den strömmen, inte hela `serve`-processen.
- Nya kommandon i `serve` ska dokumenteras i `mac-helper/README.md` och få ett matchande hanteringsfall i bryggan samt ett test mot låtsashjälparen.

**Allmänt**
- Ändra inte beteende, filformat eller protokoll i förbifarten i en annan ändring. Gör det i en egen pull request.
- Låt bli att lägga till beroenden utan att diskutera det först. Varje beroende är en ytterligare yta för säkerhetsproblem.

## 9. Säkerhetsregler (obligatoriska)

ClaudeXR ger en AI-agent ögon och händer i en persons dator och rum. Därför är säkerhet ingen detalj här. Hotmodellen står i `README.md` under "Säkerhet och hotmodell". Läs den. Reglerna nedan får du aldrig bryta, och en pull request som gör det avvisas.

1. **Inga hemligheter i repot.** Checka aldrig in token, privata nycklar, certifikat, `config.json` från `~/.claudexr`, `paired.json`, loggar med innehåll från din dator eller dina Claude-inställningar. Det gäller även i kommentarer, testdata och exempel. Läckta hemligheter i git-historiken måste anses kompromissade och bytas, även om du tar bort dem efteråt.
2. **Fail-closed.** Är något oklart, inaktuellt eller fel ska resultatet vara att det *nekas*. Godkännanden (PermissionRequest) som väntar är skrivskyddade och ensamma i rummet. Gör inte undantag.
3. **Styrning av Macen är avstängd som standard.** `InputGate` i `bridge/src/input.ts` är av som standard. Bara en fysisk knapp i headsetet får slå på den, aldrig röst, MCP eller en hook. Den stängs vid lösenordsfält. Kringgå den inte.
4. **Uteslutningslistan är absolut.** Lösenordshanterare, Nyckelringsåtkomst, Meddelanden, Mail och liknande får aldrig strömmas, och får inte kunna sättas på tillåtelselistan av något annat än användaren själv.
5. **Extern data är data, inte instruktioner.** Text från webbsidor, filer, kamerabilder, taligenkänning och verktygssvar får aldrig tolkas som kommandon till Claude eller bryggan. Detta gäller särskilt röst: tal kan höras fel och räknas aldrig som godkännande av en riskfylld åtgärd.
6. **Nätverk.** Loopback-API:t kräver Bearer-token, kontrollerar `Host` och avvisar anrop med `Origin`. Headsetanslutningen använder TLS med fastnålat certifikat. Försvaga ingen av dessa kontroller och lägg inte till nya portar eller lyssnare utan en genomtänkt motivering i pull requesten.
7. **Rör inte användarens miljö i tester eller skript.** Skript får inte ändra `~/.claude`, `~/.claudexr`, launchd-agenter, Macens skärmar, ljudutgång eller behörigheter utan att användaren uttryckligen kör dem. `install-hooks` har `--dry-run` av ett skäl: behåll den egenskapen.
8. **Privat rapportering av sårbarheter.** Hittar du ett säkerhetsproblem: skriv inte en öppen issue med detaljer. Kontakta ägaren direkt eller använd GitHubs "Report a vulnerability" under repots Security-flik om den är aktiverad. Beskriv vad som går att göra, vad som krävs och förslag på åtgärd.

## 10. Arbeta utan headset eller riktig Mac

Mycket av arbetet går att göra utan hårdvara, och det är ofta det bästa sättet att komma igång.

**Går bra utan hårdvara**
- All bryggslogik och dess tester: `npm test`, `npm run sim`, `npm run e2e`.
- Quest-appens ren logik via JVM-tester.
- Att kompilera Quest-appen och Mac-hjälparen.
- Dokumentation, tillstånds- och felhantering, protokolländringar och verktygsval (`quest-cmds`).

**Kräver en Quest 3 och/eller riktig Mac**
- Att flera fönsterströmmar faktiskt lever samtidigt med `serve`-läget.
- Ljudfångst, fördröjning och glapp, och att uteslutna appars ljud verkligen utesluts.
- Placering av paneler, tryck-för-att-prata och kalibrering mot Macens skärm.
- Allt som rör behörigheter i macOS.

Har du ingen hårdvara: skriv koden och testerna du kan, och lista tydligt under **Inte testat** i pull requesten vad som återstår. Det som återstår läggs som en punkt under "Kräver ägaren"-listan i `docs/STATUS.md`, så att den som har headsetet vet exakt vad som ska provas.

Har du hårdvara: kör gärna sådant som står i den listan och rapportera resultatet som en kommentar eller ett nytt avsnitt i `bugs/`.

## 11. Buggrapporter och utvecklingsläget

Bryggan har ett utvecklingsläge som samlar buggar och idéer med kontext (versioner, paneler, loggar, fördröjning) automatiskt. Det styrs av `xr_dev` (verktyget i Claude Code) och skills `xr-devmode`.

- Rapporter hamnar i `bugs/`. `bugs/reports.jsonl` är den löpande listan, `bugs/BUGS.md` en läsbar sammanfattning och `bugs/handoff-*.md` är exporterade överlämningar på svenska och engelska.
- Rapporter får inte innehålla hemligheter. Bryggan maskerar vad den kan, men kontrollera själv innan du checkar in en rapport.
- Bryggan loggar själv sina fel, timeouts och tappade anslutningar. Rapportera inte det en gång till för hand.
- Lägg varje bugg med en komponent (`brygga`, `quest-app`, `spegling`, `röst`, `hooks`, `skills/presentation`) och allvarlighetsgrad. Beskriv felet i en mening och hur man återskapar det.

Hittar du en bugg du inte tänker laga själv: öppna en issue på GitHub med samma uppgifter, så den inte försvinner.

## 12. Dokumentation, versioner och releaser

**Dokumentation ska följa koden.** Ändrar du beteende, kommandon, miljövariabler eller protokoll ska du i samma pull request uppdatera:
- `README.md` (installation, verktyg, säkerhet)
- `mac-helper/README.md` om hjälparen ändras
- `claude-config/skills/xr-presenter/SKILL.md` om verktygens beteende ändras
- `docs/STATUS.md`: "Nästa steg" överst och "Kräver ägaren"-listan
- En ny post i den aktuella `bugs/CHANGELOG-x.y.z.md`

Varje changelog har samma struktur: ändringar per punkt, installationssteg, hur man backar (rollback), och en ärlig lista **Testat / inte testat**.

**Versionsnummer** finns på flera ställen och höjs tillsammans:
- `bridge/package.json` (`version`)
- `BRIDGE_VERSION` i `bridge/src/config.ts`
- Quest-appens `versionName` och `versionCode` i `quest-app/app/build.gradle.kts`
- `mac-helper/Sources/claudexr-capture/Info.plist` och hjälparens README

Använd en patchversion (0.4.x) för fel och små förbättringar och en minorversion (0.x.0) när protokollet eller installationen ändras på ett sätt som kräver att användaren gör något.

**Releaser** görs av ägaren: höj version, skriv changelog, kontrollera att alla tester är gröna, tagga (`git tag v0.4.2`) och pusha taggen. Bygg-artefakter (APK, hjälparens binär) checkas inte in i repot.

## 13. Vanliga fallgropar

- **"Hängande" tester.** Nästan alltid en för kort tidsgräns, se [4.2](#42-bryggan). Titta efter `cancelled` och efter en kvarlämnad testdaemon.
- **Skärminspelningsbehörigheten försvinner.** Hjälparen är signerad ad hoc, så varje ombyggnad ger ny cdhash och macOS kan kräva att "Skärm- och systemljudsinspelning" tillåts på nytt. Ta bort den gamla posten och lägg till igen om felet `-3801` dyker upp.
- **En process per ström dödar de andra.** När flera hjälparprocesser använder ScreenCaptureKit avbryter macOS de som redan körs (`-3805`). Därför äger EN `serve`-process alla strömmar. Gå inte tillbaka till en process per ström. Reservläget (`helperMode: perStream`) finns bara som nödutgång.
- **Bonjour fungerar inte över USB.** I trådat läge måste appen startas med `bridge_url=wss://127.0.0.1:47800/headset`. `reverse` via `metavr`/`hzdb` är obekräftat, se `README.md`.
- **Test och live-installation delar port och tillstånd om du är slarvig.** Isolera alltid med miljövariablerna i [avsnitt 7](#7-tester-och-kvalitetskrav). Stäng aldrig av eller byt ut din egen live-brygga för att något test krånglar.
- **Tillfälliga mappar växer.** Byggen och testtemporärer kan bli gigabytestora. Rensa `mac-helper/.build`, `.natt-state/tmp` och motsvarande då och då. De är återskapbara.
- **Protokollet har två sidor.** Ändrar du bara `protocol.ts` men inte `Protocol.kt` (eller tvärtom) får du fel som bara syns i headsetet.

## 14. Arbeta med AI-assistans

Projektet byggs till stor del med Claude Code, och du får gärna använda AI-verktyg. Samma krav gäller oavsett vem som skrivit koden:

- Du ansvarar för det du skickar in. Läs diffen, kör testerna själv och förstå ändringen.
- Låt aldrig en agent installera saker på din dator, köra Mac-hjälparen, ändra skärmar, ljud eller behörigheter, eller pusha, utan att du uttryckligen har sagt ja. Sätt uttryckliga gränser i uppdraget, och be om delrapporter i stället för att låta ett långt arbete gå tyst.
- Be agenten rapportera vad som är *testat* och vad som är *obevisat*. En agent som säger "klart" betyder inte att det är verifierat i headsetet.
- Lägg till `Co-Authored-By` i commit-meddelandet när en AI har skrivit en väsentlig del, så att historiken är ärlig.
- Ge aldrig en agent tillgång till din token, dina nycklar eller `~/.claudexr`.

## 15. Checklista innan du öppnar en pull request

Kopiera in detta i beskrivningen och bocka av:

```markdown
## Vad och varför
(en eller två meningar)

## Ändringar
-

## Testat
- [ ] `npm run typecheck` rent
- [ ] `timeout 590 npm test`: 0 fel, 0 cancelled
- [ ] `./gradlew :app:assembleDebug --offline` och `testDebugUnitTest --offline` gröna (om Quest-appen rörts)
- [ ] Mac-hjälparen kompilerar (om den rörts)
- Annat jag testade, och hur:

## Inte testat
(headset, riktig Mac, behörigheter ... var specifik)

## Säkerhet
- [ ] Inga hemligheter, personuppgifter eller sökvägar från min dator i ändringen
- [ ] Ingen säkerhetsregel i avsnitt 9 försvagad (annars förklaras det här)

## Dokumentation
- [ ] README / SKILL.md / docs/STATUS.md / changelog uppdaterade där det behövs
- [ ] Version höjd på alla ställen (om det är en release)
```

## 16. Hjälp, frågor och licens

- **Frågor om hur något fungerar:** öppna en issue med etiketten fråga, eller skriv i pull requesten du arbetar med. Börja med `README.md`, `docs/STATUS.md` och changelogs i `bugs/`.
- **Vet du inte var du ska börja:** ta en punkt ur "Nästa steg" i `docs/STATUS.md`, eller en öppen bugg i `bugs/BUGS.md`.
- **Licens:** Projektet har ännu ingen licensfil. Fråga ägaren innan du återanvänder koden utanför det här projektet.
- **Uppförande:** var vänlig, kritisera koden och inte personen, och säg ifrån om något är oklart i stället för att gissa. Det gäller särskilt kring säkerhet och hårdvara, där en gissning kan kosta någon sin skärm eller sina hemligheter.
