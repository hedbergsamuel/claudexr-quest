# ClaudeXR 0.3.0: ändringslogg och installationssteg

Datum: 2026-11-09. Utgår från överlämningarna `handoff-2026-11-09-user-feedback-EN.md` och `handoff-2026-11-09T11-49-48.md`.
Version: bryggan 0.3.0, Mac-hjälparen 0.3.0 (Info.plist), Quest-appen versionName 0.3.0 / versionCode 4.

**Läs först: det här är inte provkört på ett riktigt headset.** Allt som rör Quest-appen (röstpanel, närplacering, HUD, orphan-städning, haptik) är bara kompilerat och enhetstestat. Allt som rör riktiga macOS-tjänster (ScreenCaptureKit, ljusstyrka, tillståndsdialoger) är kompilerat men aldrig kört mot den riktiga skärmen. Se "Testat / inte testat" längst ned.

## Installationssteg (gör i den här ordningen)

```bash
# 1) Mac-hjälparen (ny cdhash => macOS kan kräva ny Skärminspelning-tillåtelse, se punkt 2)
cd "/Users/<användare>/Downloads/Meta XR/mac-helper" && ./build.sh

# 2) Bryggan
cd "/Users/<användare>/Downloads/Meta XR/bridge" && npm ci && npm run build && npm test && npm run install-daemon

# 3) Quest-appen (USB eller Wi-Fi-adb, se README "Quest 3")
export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"
adb install -r "/Users/<användare>/Downloads/Meta XR/quest-app/app/build/outputs/apk/debug/app-debug.apk"
# (bygga om APK:n: cd quest-app && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew --offline :app:assembleDebug)
```

Efter steg 1-2, gör detta en gång:
1. Systeminställningar → Integritet och säkerhet → **Skärm- och systemljudsinspelning**: tillåt `claudexr-capture` och `node` (ta bort gamla poster och lägg till på nytt om skärmströmmen ger `-3801`). Starta om daemonen (`launchctl kickstart -k gui/$(id -u)/com.claudexr.bridge`).
2. Daemonens plist byts ut av `install-daemon` (ProcessType Background är borttaget, se punkt 4/5). Kontrollera att `~/Library/Application Support/ClaudeXR/bridge/bin/claudexr-capture` finns efter installationen (kopieras från `mac-helper/.build/release`). Bygg alltså hjälparen FÖRE `install-daemon`.
3. Första gången du ansluter headsetet visas ett XR-kort "Spegla hela Mac-skärmen?". Tryck Tillåt en gång. Därefter startar skärmen om av sig själv (tills daemonen startas om). Vill du slippa kortet: `"display": {"approval": "never"}` i `~/.claudexr/config.json`.

Nödåterställning av ljusstyrka (om något mot förmodan lämnar skärmen mörk): `node "$HOME/Library/Application Support/ClaudeXR/bridge/dist/src/index.js" restore-brightness`, eller tryck **Stäng allt** i headsetets statuspanel, eller stäng av dimningen: `"display": {"dim": false}`.

## Per överlämningspunkt

### 1. Föräldralösa/tomma strömpaneler (hög)
Orsaksanalys: strömpaneler FANNS i bryggans register (`hub.ts` lade dem där), men (a) Quest-appens **aktivitetspanel "Vilar"** (system-panel till vänster, yaw −62°, synlig så fort appen är CONNECTED, ingen stäng-knapp, inte i bryggans register) matchar användarens "vilar-/vilande panel" till vänster exakt, och kan därför aldrig listas eller stängas via `xr_panel`; (b) vid återanslutning skickade bryggan aldrig om strömpaneler och ströminställningen "omstart" skapade en ny panel utan att alltid ta bort den gamla; (c) headsetet tog inte bort strömpaneler när kontrollsocketen föll. Åtgärder:
- Bryggan: `xr_panel list` visar nu strömpaneler (`stream:<id>`), strömmar och display-/mik-läge. `xr_panel close id:<panel- eller strömid>` och `id:"all"` fungerar och stoppar tillhörande strömmar. `close` utan filter = allt inklusive strömmar. En omstart (`xr_stream window/display` på samma källa) **ersätter** den gamla strömmen och panelen. `xr_stream stop` stänger panelen (utan id: bara fönsterströmmar; `id:display` / `id:all`).
- Bryggan skickar `sync` (alla kända panel-id:n) var 10:e sekund och vid anslutning: headsetet tar bort allt annat (orphan-sopare). Strömpaneler ingår i `welcome.open`.
- Om en ström dör innan panelen finns, eller medan panelen skapas, tas panelen bort direkt (ingen blank panel).
- Quest: aktivitetspanelen är dold när Claude vilar och har ✕; "Stäng allt" (nödknapp) rensar lokalt (med "ledger" över alla entiteter som sopar läckor), döljer aktivitets-/röstpaneler och skickar `emergency_close` till bryggan (stänger alla paneler och strömmar, återställer ljusstyrka). Strömpaneler tas bort direkt när anslutningen tappas.

### 2. Macens skärm alltid strömmad, förankrad över skärmen (hög)
- Display-strömmen startas automatiskt när headsetet ansluter (`display.alwaysOn`, standard på), startas om automatiskt med backoff (5 s, 15 s, 45 s … max 5 min) och ersätts/stoppas aldrig av fönsterströmmar. Roll `overlay` = förankrad över den kalibrerade fysiska skärmen (kalibrering som förut; utan kalibrering fallback-plats).
- Godkännande: ett XR-tryck per daemonkörning (`approval: "once"`), `"never"` tar bort kortet. Nekas kortet stängs automatisk spegling av (ingen tjat). En display som stängts med flit (nekat kort, ✕ på panelen, `xr_stream stop id:display|all`, `xr_panel close all`, **Stäng allt**) förblir av även efter återanslutning (en 1006 ångrar alltså inte nödknappen) tills du trycker **Starta skärmen**, kör `xr_stream display` eller startar om daemonen.
- Flera samtidiga strömmar: gräns 4 (`maxStreams`), tydligt fel som listar aktiva strömmar om den nås.
- `xr_stream window/display` svarar inte längre "Streaming" förrän hjälparen är live OCH har producerat en bild (8 s). Annars tydligt fel som namnger fönstret: macOS nekar skärminspelning (-3801, med exakt väg i Systeminställningar), anslutningen avbröts (-3805), eller "ingen bild från <app – fönster> (minimerat / annat skrivbord)". Ingen blank panel lämnas kvar.
- **`[ask]` är inte ett macOS-tillstånd**: det betyder "inte på tillåtelselistan, kräver ett tryck på ett XR-godkännandekort". Det står nu i utskriften av `xr_stream windows` och i verktygsbeskrivningen, och vid nekat/utebliven godkänning heter felet `Not approved: "<app – fönster>" needs a tap on the approval card in the headset ...`.
- **Blank ström trots "Streaming" (orsak)**: ScreenCaptureKit skickar bara nya bilder när innehållet ändras. Ett stillastående fönster gav en enda bild (som headsetet inte hunnit ta emot) och en IDR-begäran ("K") kunde inte besvaras eftersom ingen ny bild kom. Mac-hjälparen sparar nu senaste bilden, kodar om den vid "K" och var 500 ms vid tystnad.
- **CGS_REQUIRE_INIT / -3805 (orsaksanalys, åtgärd obekräftad på hårdvara)**: hjälparen är en ren kommandoradsprocess utan fönsterserveranslutning; första CoreGraphics-/ScreenCaptureKit-anropet utlöser `Assertion failed: (did_initialize), CGS_REQUIRE_INIT`, och strömmar dör med -3805. Åtgärd: `NSApplication.shared` (policy `.prohibited`) initieras före allt annat och `app.run()` driver körslingan. **-3801** ("user declined TCCs") betyder att macOS avvisar *processen* som kör hjälparen. Trolig orsak: hjälparen är ad hoc-signerad, så varje ombyggnad ger en ny cdhash och den gamla tillåtelsen gäller inte längre; dessutom kan tillståndet ha getts åt fel process (launchd → node, inte din terminal). `mac-helper/build.sh` signerar med fast identifier `com.claudexr.capture`, men utan Developer ID-certifikat ändras cdhash ändå vid kodändring: tillåt om efter varje ombyggnad. Hjälparen kontrollerar `CGPreflightScreenCaptureAccess()` men bara som VARNING (`tcc_preflight_false`) och försöker ändå: förkontrollen är opålitlig när ansvarig process är en annan binär (launchd → node → hjälparen), och 0.2.0 fick ju igenom en ström i den kedjan. Ett verkligt nekande kommer som -3801 från ScreenCaptureKit.

### 3. Dimma den fysiska skärmen (medel)
- Ny modul `bridge/src/brightness.ts` (injicerbar adapter; riktig adapter = `claudexr-capture brightness get|set` via DisplayServices, inbyggd skärm). På som standard (`display.dim`), avstängbar (`"display": {"dim": false}` eller `CLAUDEXR_DIM=0`), nivå `dimLevel` (0).
- Originalvärdet sparas i `~/.claudexr/brightness-saved.json` (0600) INNAN skärmen dimmas; filen skrivs med `wx` och skrivs aldrig över; dimning två gånger sparar aldrig "0". Dimning sker först när headsetet har kvitterat en bildruta av display-strömmen (aldrig mot ett blankt headset) och bryts om kvittenserna uteblir i 8 s.
- Återställs: vid stream-stopp/fel, paus (låst Mac, Secure Input), headsetfrånkoppling (inkl. heartbeat lost/1006), stallad video, `emergency_close` ("Stäng allt"), SIGTERM/SIGINT/SIGHUP, `exit`, `uncaughtException`, `unhandledRejection` (alla synkront via `execFileSync`), vid nästa daemonstart om en kvarlämnad fil finns, även om du under tiden satt `dim:false` (SIGKILL/krasch/strömavbrott; launchd startar om inom ~10 s), och manuellt med `restore-brightness` (fungerar utan daemon).
- Begränsning: bara den inbyggda skärmen (externa monitorer har inget API här). SIGKILL går inte att fånga: skärmen är mörk tills launchd startat om daemonen (≈10 s) eller du kör `restore-brightness`.
- Hård spärr: den riktiga hjälparen används aldrig för dimning när `CLAUDEXR_STATE_DIR` är överskriven (tester/sandlådor) om inte `CLAUDEXR_ALLOW_REAL_DIM=1`. Alla tester använder en falsk hjälpare (ljusstyrka i en fil). Den riktiga ljusstyrkan har inte ändrats under utvecklingen (endast `brightness get` kördes).

### 4. Röstläge (hög)
Orsaksanalys (från loggen och koden):
- **Latens 56 s för 198 KB / 49 s för 960 KB**: daemonens plist hade `ProcessType Background` + `LowPriorityIO`, och barnprocesser (whisper-cli, claudexr-capture) ärver klassen: macOS kör dem på effektivitetskärnorna med låg prioritet. Dessutom kördes flera transkriberingar parallellt, lång tystnad skickades med och whisper körde standardkodning med temperaturåterfall (upp till 6 omkörningar på brus). Åtgärder: plisten har inte längre Background/LowPriorityIO (`Interactive`), transkriberingar körs en i taget, tystnad klipps (`trimSilence`), whisper körs med `-bs 1 -nf -t N` (`voice.fast`), hård timeout 25 s (processen dödas; användaren ser "tog för lång tid"), valfritt fast språk (`voice.language: "sv"`). **Jag kunde inte mäta whisper här** (modellen ligger i ~/.claudexr och jag har inte rört den). Mät själv: `node "$HOME/Library/Application Support/ClaudeXR/bridge/dist/src/index.js" voice-bench bridge/test/fixtures/jfk.wav`.
- **"Ingenting hände"**: (a) rösttext kunde bara ges som svar på en öppen fråga (xr_ask/xr_test/listen). Utan fråga visades en kort toast och texten försvann. (b) Mediasocketen (som bär ljudet) återanslöts aldrig om den föll medan kontrollsocketen levde. (c) Fastnade en session (släpp kom aldrig fram) blockerade tre sådana alla nya tryck. (d) "Jag hörde"-kortet var en vanlig panel som kolliderade med nästa försök. Åtgärder: se nedan.
- Nytt flöde: tryck på 🎤 öppnar en stor röstpanel (0,50 × 0,40 m) ca 0,4 m framför huvudet (inom räckhåll). Håll in den stora knappen för att tala (ton + haptik best effort vid start/stopp), släpp: statusen går **Lyssnar → Transkriberar → Förhandsvisning (uppfattad text + Skicka/Avbryt) → Skickat/Köat** (och Fel med förklaring: för kort, hörde inget, timeout, mikrofon nekad). Ingen separat "Jag hörde"-panel längre. Frågekortens egna mik-knappar använder samma röstpanel för förhandsvisningen.
- **Leverans till chatten** (viktig begränsning): det går fortfarande inte att skicka in text säkert i en körande, interaktiv Claude Code-terminal. Bekräftad text går (1) som svar till öppen fråga, annars (2) till en kö som levereras med nästa prompt via UserPromptSubmit-hooken ("Voice message … speech, may be misheard", en gång), eller (3) direkt via den valfria **röstkanalen**: `claude mcp add claudexr-voice -- node "<sökväg>/dist/src/index.js" --voice-channel` och starta Claude Code med `--dangerously-load-development-channels server:claudexr-voice` (Claude Codes "channels", research preview, kräver interaktiv session). Röstkanalen är **otestad mot en riktig Claude Code-session**. Headsetet visar ärligt "Skickat (röstkanalen)" respektive "Köat".
- Säkerhet oförändrad: rösten kan aldrig godkänna behörighetsfrågor, parkoppling eller strömning; kanalen deklarerar aldrig permission-relay.
- Statusrad (HUD) i statuspanelen: vad som strömmas (Skärm ●, fönster ●), "Mikrofon: lyssnar/av", "Macens skärm dimmad".

### 5. Övrigt
- **Tappade bildrutor (sent 923 / dropped 151, 14 %)**: orsak = kreditgräns 2 + varje släppt ruta tvingar fram väntan på nästa IDR (min 500 ms ⇒ ~15 rutor). Nu gräns 3 och IDR-intervall 250 ms; dessutom kodar hjälparen om senaste bilden vid IDR-begäran så att väntan inte blir evig på stilla skärmar. Förväntad effekt: tydligt färre drop, ej mätt på riktig länk. Adaptiv bitrate fanns redan (−20 % vid drop, +10 %/s vid RTT < 60 ms).
- **Heartbeat lost / 1006**: bryggan kräver nu två missade pingar (~20-30 s) och räknar alla meddelanden från headsetet som liv; loggen anger hur länge tystnaden varit. Daemonens bakgrundsklass (punkt 4) kan ha fördröjt pongarna. Quest: kontrollsocketen stängs när headsetet tas av (appen pausas), så enstaka 1006 vid avtagning är normalt.
- **[ask]-dialog/felrad**: se punkt 2 (namngivet fönster i felet, förklaring i `xr_stream windows`).
- **Testisolering**: testerna körs mot egna daemoner (slumpad port från 48100, egen temp-state-katalog, mDNS och notiser av, falsk Mac-hjälpare som standard, `ALWAYS_DISPLAY`/`DIM` av som standard). `install-daemon.sh`-testet kör med `HOME` i en temp-katalog (kontrollerat: den riktiga plisten och `~/Library/Application Support/ClaudeXR/bridge` är orörda, senast ändrade 12:25 före mitt arbete).
- **Pairing-dialoger i tester**: på macOS ignorerade testdaemonerna `CLAUDEXR_PAIR_CONFIRM=auto` och öppnade riktiga "Parkoppla headset"-dialoger på skärmen. Det inträffade under de första testkörningarna tidigt i arbetet (jag hade ingen anledning att tro att testdaemonerna ens kunde öppna dialoger på macOS) och stoppades när koordinatorn varnade. Åtgärdat: `auto`/`deny` gäller nu även på macOS när en egen state-katalog är satt (tester/sandlådor); kontrollerat med att inga `osascript`-processer uppstår under en hel testkörning.

## Testat / inte testat

Testat (Mac, denna maskin):
- `tsc` utan fel; `npm run build` OK; `npm test`: **102 tester, 100 pass, 0 fail, 2 hoppade** (mDNS-upptäckt som inte går i testmiljön, och riktig whisper-körning som kräver `CLAUDEXR_TEST_WHISPER_BIN/MODEL`). Före 0.3.0 var det 73 tester.
- Nya tester: brightness (enhetstester med minnesadapter + falsk hjälpare: dimning, dubbel dimning, kvarlämnad fil, skriv-över-skydd, fel, hård spärr), display (alltid-på, godkännande en gång, stopp-semantik, ersättning, stäng på strömid/all, sync, blank-/TCC-fel, strömgräns, dimning/återställning vid stopp, frånkoppling, nödknapp, SIGTERM, kvarlämnad fil vid start, ingen dimning utan kvittens, avstängd dimning), röst (trimSilence, inkorg, förhandsvisning/kö/hook, röstkanal-poll, avbryt, hängande STT-timeout, tomt/kort tal).
- Mac-hjälparen: `swift build -c release` (scratch-sökväg) utan kompileringsfel; `display-info` och `brightness get` kördes. Quest-appen: `./gradlew --offline :app:testDebugUnitTest :app:assembleDebug` OK, 12 JVM-tester, APK byggd.

INTE testat:
- Quest-appen på ett riktigt headset: närpanelens placering/nåbarhet, håll-knappens gest, fingerpoke (ingen ISDK-beroende tillagd), ton/haptik (Quest kan ignorera Android-Vibrator; SDK 0.15.0 har inget publikt kontrollerhaptik-API), HUD-layout, orphan-sopare/ledger, medie-återanslutning, om "Vilar-panelen" verkligen var den kvarlämnade panelen.
- Mac-hjälparen mot riktig skärminspelning: `stream`, omkodning av stilla bild, `list-windows`, varningen `tcc_preflight_false` och -3801-vägen, NSApplication-fixen mot -3805/CGS-assertion, `brightness set` (kördes aldrig), DisplayServices på din Mac-modell, TCC-beteende efter ombyggnad.
- Riktig dimning/återställning på din skärm (endast logik + falsk hjälpare testade), launchd-startad daemon med ny plist, `restore-brightness` mot riktig hjälpare.
- Whisper-latens efter åtgärderna (ingen modell användes), röstkanalen mot Claude Code, UserPromptSubmit-leverans i en riktig session.
- Bildruteförlust efter ändrad kreditgräns på riktig Wi-Fi-länk.
