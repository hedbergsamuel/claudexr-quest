# ClaudeXR v0.3.1: Claude Code i ditt rum (Meta Quest 3)

Claude Code på din Mac kan visa kort, paneler, förhandsvisningar, dashboards och skarpa kopior av Mac-fönster i ditt rum (passthrough). Du svarar genom att peka och nypa, eller genom att hålla in mikrofonknappen och tala. Svaren går tillbaka till Claude som verktygsresultat.

> **Nytt i 0.3.0** (se `bugs/CHANGELOG-0.3.0.md` för allt, inklusive vad som är otestat på headset): Macens skärm strömmas alltid och dimmas (med nödåterställning), strömpaneler listas/stängs/ersätts, tydliga fel för blanka fönsterströmmar och macOS-tillstånd, ny röstpanel nära huvudet med förhandsvisning, `restore-brightness`, valfri röstkanal. Konfiguration i `~/.claudexr/config.json`: `"display": {"alwaysOn": true, "approval": "once"|"never", "dim": true, "dimLevel": 0}`, `"maxStreams": 4`, `"voice": {"timeoutMs": 25000, "fast": true, "language": "auto"}`.

## Arkitektur

```
 ┌──────────────────────────── Mac ─────────────────────────────────────────────┐
 │  Claude Code (alla sessioner)                                                 │
 │    ├─ MCP över HTTP ──────► http://127.0.0.1:47801/mcp      ┐                 │
 │    └─ hooks command (flagga)► http://127.0.0.1:47801/hook/* │ Bearer-token    │
 │                                                             ▼                 │
 │  ClaudeXR-daemon (launchd, EN process: bridge/dist/src/index.js)              │
 │    • xr_*-verktyg, mallar, aktivitet, städning, buggrapporter (dev-läge)      │
 │    • lokal taligenkänning (whisper.cpp / Apple on-device)                     │
 │    • claudexr-capture (Swift): ScreenCaptureKit → H.264, QR-markör, Apple STT │
 │  wss://:47800/headset (kontroll)   wss://:47800/video (video + ljud, ack)     │
 │  Bonjour _claudexr._tcp (tls=1)                                               │
 └───────────────▲───────────────────────────────▲──────────────────────────────┘
                 │ TLS, fastnålat certifikat, parkopplad token
 ┌───────────────┴───────────────────────────────┴──────────────────────────────┐
 │  Quest 3: ClaudeXR-appen (Meta Spatial SDK 0.15.0, Kotlin)                    │
 │  paneler (kort, WebView, HTML-mallar, video), statuspanel, godkännandekort,   │
 │  tryck-och-tala, kalibrering mot Mac-skärmen (passthrough-kamera, QR)         │
 └──────────────────────────────────────────────────────────────────────────────┘
```

## Snabbstart (i den här ordningen)

```bash
# 1) Bryggan som daemon
cd "/Users/<användare>/Downloads/Meta XR/bridge"
npm ci && npm run build && npm test
npm run install-daemon      # kopierar till ~/Library/Application Support/ClaudeXR/bridge och startar launchd-agenten
tail -f ~/Library/Logs/ClaudeXR/bridge.log   # loggar (Ctrl-C för att sluta titta)

# 2) Registrera i Claude Code (ingen token hamnar i Claudes konfiguration)
node "$HOME/Library/Application Support/ClaudeXR/bridge/dist/src/index.js" print-config
#   → kör raden "claude mcp add-json --scope user claudexr '…'" (läser token via headersHelper)
#   → hookarna (0.3.1: bara aktiva när headsetet är på; backup + --dry-run, se "Hookar och strömbrytare" nedan):
node "$HOME/Library/Application Support/ClaudeXR/bridge/dist/src/index.js" install-hooks --dry-run
node "$HOME/Library/Application Support/ClaudeXR/bridge/dist/src/index.js" install-hooks
#   → lägg till deny-reglerna nedan i ~/.claude/settings.json

# 3) Skills och CLAUDE.md
mkdir -p ~/.claude/skills && cp -R ../claude-config/skills/xr-presenter ../claude-config/skills/xr-devmode ~/.claude/skills/
#   → klistra in claude-config/CLAUDE.md.snippet i ~/.claude/CLAUDE.md

# 4) Quest-appen (Android Studios JDK)
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"
cd "/Users/<användare>/Downloads/Meta XR/quest-app" && ./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk

# 5) Mac-hjälparen (spegling, kalibrering, Apple-tal)
cd "/Users/<användare>/Downloads/Meta XR/mac-helper" && swift build -c release

# 6) Röst (lokal taligenkänning)
brew install whisper-cpp
mkdir -p ~/.claudexr/models && curl -L -o ~/.claudexr/models/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
shasum -a 256 ~/.claudexr/models/ggml-base.bin   # jämför med SHA256 på filens sida på huggingface.co
launchctl kickstart -k gui/$(id -u)/com.claudexr.bridge   # starta om daemonen
```

Starta sedan ClaudeXR på headsetet och parkoppla (se nedan).

## Gör före första användning
1. `cd bridge && npm test` ska ge 0 fail (senast 0.3.1: 124 tester, 122 pass, 0 fail, 2 hoppade).
2. Installera daemonen med `npm run install-daemon`. Den körs från en fastlåst kopia i `~/Library/Application Support/ClaudeXR/bridge`, så Claude kan inte ändra koden som daemonen kör genom att redigera projektmappen. **Kör installationen igen efter varje uppdatering du litar på** (`npm run build` räcker inte längre).
3. Kör `print-config` och registrera MCP-servern. Kör sedan `install-hooks` (ingen `CLAUDEXR_TOKEN` i `~/.zshrc` behövs längre). Lägg också in deny-regler i `~/.claude/settings.json` så att Claude inte kan läsa token eller ändra den installerade kopian:
   ```json
   "permissions": { "deny": [
     "Read(~/.claudexr/**)", "Edit(~/.claudexr/**)",
     "Edit(~/Library/Application Support/ClaudeXR/**)", "Edit(~/Library/LaunchAgents/com.claudexr.bridge.plist)",
     "Bash(launchctl:*)" ] }
   ```
4. Sätt `"devMode": false` i `~/.claudexr/config.json` om du inte felsöker.
5. Verifiera whisper-modellen med checksumma (`shasum -a 256`) mot värdet på filens sida på huggingface.co i stället för att lita blint på `curl -L`. Jag har inte kunnat hämta och kontrollera hashen härifrån.
6. Bygg mac-helper på Macen (`swift build -c release`) och åtgärda eventuella kompileringsfel, eftersom koden är okompilerad. Kontrollera sedan **vilket program** som får "Skärm- och systemljudsinspelning" och "Taligenkänning".
7. Parkoppla Quest. Jämför **ID:t** (till exempel `AB12-CD34`) och IP-adressen i Mac-dialogen med det som headsetet visar. Neka om något inte stämmer.
8. Testa fail-closed en gång: stoppa daemonen (`launchctl bootout gui/$(id -u)/com.claudexr.bridge`), be Claude köra ett kommando som kräver lov och kontrollera att terminalfrågan kommer direkt. Starta igen med `npm run install-daemon`.

## Installation i detalj

### Daemonen
- `npm run install-daemon` kopierar `dist`, `node_modules` (och `claudexr-capture` om den är byggd) till `~/Library/Application Support/ClaudeXR/bridge`, skriver `~/Library/LaunchAgents/com.claudexr.bridge.plist` (absoluta sökvägar till node och whisper-cli, PATH satt för launchd) och startar den. Agenten har `KeepAlive`, `ProcessType Interactive` (sedan 0.3.0; Background gjorde röst och video långsamma) och Umask 077. Den installerar också `~/bin/xr` (0.3.1). I vila tar den ~110 MB RAM och ~0 % CPU (mätt i Linux-VM:en).
- Starta om: `launchctl kickstart -k gui/$(id -u)/com.claudexr.bridge`. Status: `node "$HOME/Library/Application Support/ClaudeXR/bridge/dist/src/index.js" status`. Loggar: `~/Library/Logs/ClaudeXR/bridge.log` (privat, inte längre i /tmp).
- Sökvägar i `~/.claudexr/config.json` får börja med `~` (till exempel `"voice": {"model": "~/.claudexr/models/ggml-base.bin"}`).
- Avinstallera: `npm run uninstall-daemon`. Inställningar och parkopplingar i `~/.claudexr` ligger kvar.
- Efter ny kod: `npm run build && npm run install-daemon` (daemonen kör den installerade kopian, inte projektmappen).
- **Reservläge:** `node dist/src/index.js --stdio` är en stdio-MCP som vidarebefordrar till daemonen. Använd det vid felsökning, eller om din Claude Code-version inte klarar HTTP-MCP: `claude mcp add claudexr -- node "…/bridge/dist/src/index.js" --stdio`.

### Claude Code: MCP och hooks
`print-config` skriver ut:
1. `claude mcp add-json --scope user claudexr '{"type":"http","url":"http://127.0.0.1:47801/mcp","headersHelper":"cat '…/.claudexr/mcp-headers.json'","timeout":900000}'`. Token skrivs alltså inte in i Claudes konfiguration. `headersHelper` körs när servern ansluter och igen vid 401, så ett token-byte kräver ingen ny registrering. `timeout` gör att långa xr_ask inte avbryts i förtid.
2. Hookarna (0.3.1) är **command-hookar som bara körs när headsetet är på**, se "Hookar och strömbrytare" nedan. `print-config` visar dem, men enklast är `install-hooks`. Vill du ha token direkt i MCP-posten (det gamla sättet): `print-config --inline-token`.
- Om daemonen inte körs (eller headsetet är av) gör hookarna ingenting och ger inget fel. Claude Code fungerar då som vanligt, eftersom terminalen alltid gäller.
- Token finns i `~/.claudexr/local-token` och `~/.claudexr/mcp-headers.json` (båda 0600). Hookarna läser filen varje gång de körs, så ett token-byte (ta bort `local-token`, starta om daemonen) slår igenom direkt för hookarna; MCP-posten läser `mcp-headers.json` via `headersHelper`.
- **Lång väntan:** xr_ask och xr_test väntar som standard högst 110 s, eftersom Claude Code flyttar MCP-anrop som pågått i 2 min till bakgrunden. Vill du att Claude alltid ska vänta kan du sätta `"env": {"CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS": "0"}` i settings.

### Hookar och strömbrytare (0.3.1)
- Varje ClaudeXR-hook är en command-hook som börjar med `[ -f "$HOME/.claudexr/on" ] || exit 0` och sedan kör `curl -sf -m <timeout-1> -X POST http://127.0.0.1:47801/hook/<context|activity|permission> -H "Authorization: Bearer $(cat "$HOME/.claudexr/local-token" 2>/dev/null)" … --data-binary @- || exit 0`. Utan flaggfilen: inget nätverksanrop, inget hook-fel. Svaret från bryggan skrivs oförändrat till stdout (så PermissionRequest-besluten når Claude Code).
- **Flaggan sköts av bryggan:** skapas (atomiskt) när ett autentiserat headset ansluter, tas bort när det kopplas från (även heartbeat lost / kod 1006 och avparkoppling), när daemonen avslutas och när daemonen startar (kvarlämnad flagga efter krasch/SIGKILL/strömavbrott rensas). Katalogen kan flyttas med `CLAUDEXR_FLAG_DIR` (utan den följer den `CLAUDEXR_STATE_DIR`, så en testdaemon kan aldrig röra riktiga `~/.claudexr/on`).
- **Manuellt:** `xr on | xr off | xr status` (wrappern installeras av `install-daemon` i `~/bin/xr`; annars `node …/index.js xr on`). Manuell `on` gäller tills headsetet kopplas från eller daemonen startas om; manuell `off` gäller tills headsetet ansluter igen (flaggan ändras bara vid anslutning/frånkoppling, inte periodiskt).
- **Installeraren:** `node …/index.js install-hooks [--dry-run] [--settings <fil>] [--port <n>]`. Gör backup `settings.json.bak-claudexr-<tidsstämpel>` (0600) före skrivning, skriver atomiskt, är idempotent, ersätter gamla ClaudeXR-http-hookar (url `127.0.0.1:<port>/hook/…`) och äldre gated command-hookar med de nya och rör aldrig andra hookar. `--dry-run` visar en diff och skriver ingenting. Token skrivs aldrig in i settings.json och skrivs aldrig ut (en gammal inline-token i en gammal hook maskas i diffen).
- Token står i `curl`-kommandoraden medan hooken körs (några millisekunder, loopback, samma användare kan se den via `ps`). Förut låg samma hemlighet i Claude-processens miljö.

### Quest 3
1. **Utvecklarläge:** gå med i eller skapa en organisation på developers.meta.com/horizon. I appen Meta Horizon på telefonen väljer du **Enheter → Quest 3 → Inställningar för headset → Utvecklarläge → På** och startar om headsetet.
2. **USB:** anslut headsetet och tillåt USB-felsökning i headsetet. `adb devices` ska visa det.
3. **Wi-Fi-adb (valfritt):** `adb tcpip 5555`, sedan `adb shell ip route | awk '{print $9}'` och `adb connect <ip>:5555`.
4. **Bygg och installera** med kommandona i snabbstarten. Appen finns under **Bibliotek → Okända källor → ClaudeXR**.
5. **Tillstånd** som appen frågar efter: rumsskanning (placering mot väggar), kamera (bara vid skärmkalibrering) och mikrofon (bara för tryck-och-tala).

### Parkoppling (första gången)
1. Starta appen. Den hittar Macen via Bonjour och visar ett knappsats-kort.
2. Macen visar en **8-siffrig kod** som notis (och i loggen). Skriv in den i headsetet. Samma IP-adress kan be om högst 3 koder per 5 minuter.
3. Macen frågar **"Parkoppla headset … från 192.168.x.y? ID AB12-CD34"**. Headsetets knappsats visar **"Macen ska visa ID …"**. Svara **Tillåt** bara om ID:t och IP-adressen stämmer. Ett annat ID betyder att något sitter emellan.
4. Klart. Headsetet sparar token och certifikatets fingeravtryck, så nästa gång ansluter det direkt till senast kända adress.
- Glöm alla headset: `node dist/src/index.js unpair`. I appen: **Koppla från** visas om certifikatet har ändrats.

### Mac-hjälparen och macOS-tillstånd
- `swift build -c release` ger `mac-helper/.build/release/claudexr-capture` (Xcode Command Line Tools räcker).
- **Skärminspelning** (Systeminställningar → Integritet och säkerhet → Skärm- och systemljudsinspelning): tillåt `node` (daemonen) och/eller `claudexr-capture` när macOS frågar.
- **Taligenkänning:** behövs bara om du väljer Apple-motorn.
- **Notiser** från "Script Editor"/osascript används för parkopplingskoden.

### Kalibrera skärmöverlägget
Tryck på **Kalibrera skärm** i statuspanelen (eller låt Claude köra `xr_stream action:calibrate`). Macen visar en stor QR-kod i några sekunder. Titta på skärmen och håll huvudet stilla. Headsetet hittar koden med passthrough-kameran (bilderna lämnar aldrig headsetet) och lägger spegelpanelen över den riktiga skärmen. Finjustera med **Justera** (pilar 5 mm, närmare/längre 3 mm, storlek 0,5 %, rotation 0,3°) och **Spara**. Placeringen sparas relativt rummets MRUK-ankare. SDK 0.15.0 saknar publika beständiga spatial anchors, och utan rumsskanning gäller placeringen bara till nästa recenter.
**Precision:** Meta anger att kamerabilden är 1280×960 (mindre än det synliga passthrough-fältet). Räkna med ungefär någon centimeters fel. Det är otestat på hårdvara.

## Verktygen (tokensnålt hopslagna)

| Verktyg | Gör | Ersätter (v0.1/uppdragstext) |
|---|---|---|
| `xr_status` | Anslutning och panellista | xr_status |
| `xr_ask` | Välj 1 av 2–4 (tryck eller tal). Två alternativ med `url` ger A/B. `listen:true` väntar på ett talat besked | xr_ask, xr_compare, xr_listen |
| `xr_test` | "Prova det här" med checklista: funkar eller fel (tryck eller tal) | xr_test |
| `xr_show` | `url` (live-sida, localhost går bra, enhetsram), `html` (reserv), `text`/`diff`/`log`/`md` | xr_preview, xr_show |
| `xr_present` | Kompakt JSON → inbyggd mall: dashboard, kpi, comparison, timeline, flow, slides, choice-cards, diff, checklist, table | (nytt) |
| `xr_panel` | `list`, `update` (titel, innehåll, roll, storlek, flytta), `close`, `layout` (review, focus, present, tidy) | xr_list_panels, xr_update_panel, xr_close_panel, xr_layout, xr_clear |
| `xr_stream` | `windows`, `window id`, `display` (omstart ersätter), `stop [id\|display\|all]` (utan id: bara fönsterströmmar), `calibrate` | xr_list_windows, xr_stream_window, xr_stop_stream, xr_calibrate_screen |
| `xr_dev` (dev-läge) | `bug`, `idea`, `list`, `export` | xr_report_bug, xr_note_improvement, xr_list_reports, xr_export_bug_report |

Det bryggan sköter **utan modellen** (noll tokens): statuspanelen (vad Claude gör, uppgiftslista, senaste steg), aviseringar med ljud när Claude är klar eller väntar, panelen "senaste ändring" (diff) och "testresultat" direkt från hooks, städning (inaktuella paneler minimeras, högst 6 expanderade), layoutlägen, röstkommandon och felloggning i dev-läge.

## Röst

- **Tryck-och-tala:** håll in 🎤 (på ett frågekort, testkort, lyssnarkort eller i statuspanelen) medan du talar och släpp. Mikrofonen är bara på medan du håller in, och då visas **"● Mikrofonen är på"** i rummet. Inget ljud sparas: det transkriberas i minnet och ligger som tillfällig fil bara under själva igenkänningen.
- **Taligenkänningen körs lokalt på Macen**, aldrig i molnet. Motorn väljs i `~/.claudexr/config.json` under `"voice": {"engine": "whisper-cpp" | "apple" | "command", "whisperBin": "whisper-cli", "whisperModel": "~/.claudexr/models/ggml-base.bin", "autoSendMs": 0}`. whisper.cpp känner av svenska och engelska automatiskt (`-l auto`). `apple` använder SFSpeechRecognizer on-device via `claudexr-capture stt-apple`.
- **"Jag hörde: …"** visas med **Skicka/Avbryt** innan något går till Claude. Med `autoSendMs` > 0 skickas texten automatiskt efter så många millisekunder, om du inte avbryter.
- **Tre användningar:** (a) svara på xr_ask och xr_test med rösten (alternativet matchas, annars skickas fritt svar), (b) `xr_ask listen:true`, där Claude väntar på ett talat besked, (c) lokala kommandon som bryggan utför själv: *stäng alla paneler, centrera, fokusläge, visa alla, visa status, pausa strömmen* (även på engelska). Hela yttrandet måste matcha.
- **Säkerhet:** rösten kan **aldrig** godkänna behörighetsfrågor, parkoppling, strömning av nya fönster eller något annat som utökar vad som körs eller visas. Det kräver alltid ett fysiskt tryck. Uppfattad text behandlas som okontrollerad indata (TV, andra personer). Den citeras för Claude som "User said (speech, may be misheard)" och tolkas aldrig som instruktion till bryggan utöver de fasta kommandona.
- **Begränsning:** det går inte att säkert skicka in text i en redan öppen, interaktiv Claude Code-terminal. Därför finns röst som svar på frågor, `listen` och lokala kommandon. En fristående röststyrd session (Claude Agent SDK) är ett möjligt framtida steg.

## Säkerhet och hotmodell

**Skyddar mot:** andra enheter på samma Wi-Fi, webbsidor i din webbläsare och avlyssning av nätverket.
- **Headset ↔ Mac:** TLS (WSS) med självsignerat certifikat vars SHA-256-fingeravtryck nålas fast i headsetet vid parkopplingen. Oparkopplade klienter får bara parkoppla. Alla ramar valideras, ramstorleken är begränsad, tysta anslutningar stängs efter 10 s och bara det aktiva headsetet får svara.
- **Parkoppling:** 8-siffrig kod som bara visas på Macen, bunden till den anslutning som bad om den, med högst 5 försök och 2 minuters giltighet. Beviset är PBKDF2 (200 000 iterationer) över koden, certifikatets fingeravtryck och en nonce. Därefter krävs **bekräftelse i en dialog på Macen**. Token sparas bara hashad på Macen.
- **Loopback-API:t (47801):** Bearer-token från en 0600-fil, Host måste vara 127.0.0.1 eller localhost (skyddar mot DNS-rebinding), alla anrop med Origin-huvud avvisas (webbläsare) och bara JSON accepteras. Koden lämnas aldrig ut över HTTP.
- **Godkännanden i XR (PermissionRequest):** fail-closed. Medan ett godkännande väntar är kortet **skrivskyddat och ensamt**: Claude kan inte ändra det, lägga paneler över det eller ordna om layouten, och andra paneler döljs. Knapparna aktiveras först efter 1 s (skyddar mot oavsiktliga tryck), och långa begäranden har **"Läs allt ↓"**. Alla parametrar visas, även okända ("Övriga parametrar"), och osynliga tecken spärrar begäran från XR. Bara ett uttryckligt tryck i det parkopplade headsetet ger ett beslut. Timeout, frånkoppling, fel eller avstängt läge gör att terminalfrågan gäller som vanligt. Kortet visar **exakt** det som körs, utan maskering eller klippning, och **varnar** för misstänkta mönster (pipe till curl/nc, `~/.ssh`, nyckelring, env-hemligheter, `curl | sh`, sudo, rc-filer med mera). Begäranden som inte kan visas exakt (över 20 000 tecken, osynliga eller bidi-tecken, diff över 600 rader) erbjuds inte i XR. Hooken lägger aldrig till regler och ändrar aldrig läget, och Claude Codes deny-regler gäller ändå. Stäng av: skapa `~/.claudexr/permissions-off` eller sätt `"xrPermissions": false` i config. Slå på igen: ta bort filen eller flaggan.
- **Strömning:** uteslutningslistan (lösenordshanterare, Nyckelringsåtkomst, Meddelanden, Mail och liknande) kan aldrig strömmas, och i helskärmsläget svärtas de appar ut. Appar på tillåtelselistan (VS Code, Terminal, iTerm, Xcode, Android Studio) får Claude öppna utan att fråga. Alla andra fönster och hela skärmen kräver ett tryck i XR. Strömmen pausas (inga bilder, panelen döljs) när Macen låses eller skärmsläckaren startar. Panelen visar alltid **● STRÖMMAR**. Ändra listorna i `~/.claudexr/config.json`: `"stream": {"allowApps": [...], "excludeApps": [...]}`. Standarduteslutningarna gäller alltid, och listan kan bara utökas.
- **Kvarstående risker:** någon som redan kör kod som din användare på Macen kan läsa token. Väljer du att godkänna en parkoppling från en främmande enhet får den samma makt som ditt headset. Terminalfönster på tillåtelselistan kan visa hemligheter i headsetet. Godkännanden visar exakt text, men du måste fortfarande läsa den.
- **Terminal och iTerm på tillåtelselistan:** de kan visa lösenord och tokens i headsetet. Skydd: mac-helper pausar strömmen automatiskt medan macOS har *Secure Event Input* på (lösenordsfrågor i Terminal/iTerm, `sudo` med "Secure Keyboard Entry"). Det är okompilerat och otestat. Vill du inte ta risken tar du bort dem ur `"stream": {"allowApps": [...]}`.
- **Möjlig framtida härdning (inte gjord):** OCR-baserad utsvärtning av hemligheter i strömmen, och godkännanden som bara gäller per session.

## Strömning (tittande, ingen styrning)
- Separat videosocket med **kreditbaserad flödeskontroll**: högst 2 okvitterade bildrutor. Vid trängsel släpps bildrutor vid källan, en IDR begärs direkt och bitraten sänks (och höjs igen när länken är snabb). Kontrollmeddelanden blockeras aldrig av video.
- Upplösningen anpassas efter hur stor panelen faktiskt syns (ungefär 1150–1600 px, aldrig full 2560 px i onödan). Kodningen sker i hårdvara med låg latens (VideoToolbox) och avkodningen i hårdvara med KEY_LOW_LATENCY direkt till panelens Surface.

## Hålla användningen låg (Pro-plan)
- **Mätt (tecken/3,6 ≈ tokens):** verktygsdefinitionerna var ≈ 1 520 tokens i v0.1.1 (7 verktyg) och är nu ≈ 1 030 (7 verktyg, dev-läge av) eller ≈ 1 200 (8 med dev-läge), trots betydligt mer funktion. CLAUDE.md-snippet: 165 → 136 ord (≈ 200 tokens, inklusive dev-blocket). Skillbeskrivningar: ≈ 60 tokens vardera i listan, och resten laddas först när de behövs. Hooken: v0.1.1 lade ≈ 60 tokens till **varje** prompt även utan headset. Nu blir det **0 utan headset** och en rad (≈ 55 tokens) bara när tillståndet ändras.
- `xr_present` med kompakt JSON kostar några hundra utdata-tokens i stället för tusentals för fri HTML.
- **Tips:** välj modell per session (`/model`), mät med `/context`, stäng av servern tillfälligt med `/mcp` (eller `claude mcp remove claudexr`), stäng av dev-läget (nedan) när du inte testar, och låt bryggan visa diff och testresultat automatiskt i stället för att be Claude göra det.

## Utvecklingsläge
Standard är **på**. Claude antecknar fel och idéer kort (`xr_dev`), och bryggan loggar själv fel, timeouts, tappade anslutningar, misslyckade XR-verktyg och avbrutna rösttolkningar. Allt hamnar i `bugs/reports.jsonl` (källan) och den genererade `bugs/BUGS.md`. `xr_dev action:export` skriver en överlämning på svenska och engelska (`bugs/handoff-*.md`). Hemligheter maskeras. Dev-läget ger inga extra rättigheter.

### Ta bort utvecklingsläget
- **Stäng av:** sätt `"devMode": false` i `~/.claudexr/config.json` (eller `XR_DEV_MODE=0` i plistens EnvironmentVariables) och starta om daemonen. Då försvinner `xr_dev`, ingen loggning sker till `bugs/` och allt annat fungerar som vanligt (det är testat).
- **Ta bort helt:** gör ovanstående, ta också bort `~/.claude/skills/xr-devmode` och blocket mellan `<!-- XR-DEVMODE:START -->` och `<!-- XR-DEVMODE:END -->` i din CLAUDE.md. Mappen `bugs/` kan raderas.

## Felsökning
| Problem | Åtgärd |
|---|---|
| "Söker efter Macen…" | Samma Wi-Fi? Är daemonen igång (`node dist/src/index.js status`)? Tillåt Lokalt nätverk för node. Gästnät blockerar ofta mDNS. Manuell adress: `adb shell am start -n com.claudexr.quest/.MainActivity --es bridge_url wss://<mac-ip>:47800/headset` |
| Ingen parkopplingskod | Titta i `~/Library/Logs/ClaudeXR/bridge.log`. Notiser kan vara avstängda för osascript |
| Röst fungerar i terminalen men inte i daemonen | Kör `npm run install-daemon` igen (letar upp whisper-cli i Homebrew-sökvägarna) eller sätt `"voice": {"bin": "/opt/homebrew/bin/whisper-cli"}` |
| "Fel certifikat" i appen | `~/.claudexr/bridge-*.pem` har bytts. Tryck **Koppla från** och parkoppla igen |
| Claude använder inte XR | Kör `/mcp` (claudexr ansluten?), kontrollera att hooks är inlagda och att headsetet visar grön prick |
| Förhandsvisning tom | Dev-servern måste lyssna på 0.0.0.0 (`--host`). Bara http(s) är tillåtet |
| Röst gör inget | `which whisper-cli`, modellfilen finns? Kontrollera mikrofontillståndet i headsetet. Se loggen |
| Strömning misslyckas | Bygg mac-helper och ge tillstånd för skärminspelning |

## Testat och otestat (ärligt)

**Testat i Linux-VM:en (ARM64) på din Mac:**
- Bryggan: `tsc` utan fel och `npm test` (0.3.1) **122 PASS, 0 fail** plus 2 hoppade. Review 2 lade till regressionstester för skrivskyddade och ensamma godkännandekort, all-parametrar/osynliga tecken/linjär riskanalys, `~`-expansion och whisper-sökning, headersHelper i print-config, layoutens ensamhet och cert-ID (whisper-testet kräver miljövariabler). Testerna startar den riktiga daemonen och pratar MCP över HTTP med SDK:ns klient. De täcker: parkoppling (fel kod, 5 försök, bunden till anslutning, Mac-bekräftelse, MITM med annat certifikat, beständighet, fingeravtryck), WS-härdning (null-ramar, Origin, för stora ramar, tysta anslutningar, enhetsnamn), loopback-skydd (token, Host, Origin, JSON), alla verktyg, avbrott via notifications/cancelled, flera sessioner mot en daemon, stdio-reservläget, auto-städning, hooks via shim och http, godkännandeintegritet, maskering inklusive ReDoS, mallar, strömningspolicy, flödeskontroll (utan kvittenser högst 2 i luften, IDR-begäran, ABR, video blockerar inte kontroll), kalibreringsflödet, dev-läge på och av, samt röst (kommandon, Jag hörde, listen, mikrofon nekad, säkerhetsregeln).
- **Riktig lokal taligenkänning:** whisper.cpp (byggt i VM:en, modell base) transkriberade en inspelad fil genom hela kedjan: simulerat headset → mediasocket → daemon → whisper → `xr_ask listen` (~2 s).
- E2E med rå JSON-RPC över HTTP: PASS.
- Quest-appen: all Kotlin kompilerar mot Meta Spatial SDK 0.15.0 (0 fel). JVM-tester 10/10 (inklusive cert-ID-formatet) (protokoll, PBKDF2-beviset ger samma värde som bryggan, kalibreringsmatematiken återskapar en syntetisk markörpose med under 3 mm fel). Gradle-manifestet PASS.

**Otestat:**
- **Ingen APK är byggd** (aapt2 går inte att köra i ARM-VM:en). Inget av v0.2.0 har körts på Quest 3: parkopplingskort, WSS med fastnålat certifikat på Android, förvärmt ask-kort, HTML/CSP, permission-kort, videoavkodning och latens, kalibrering mot riktig skärm (kameraposer, precision), mikrofon och tryck-och-tala-gester, WifiLock, snabb återanslutning.
- **mac-helper (Swift) är inte kompilerad och inte körd** (ingen macOS i VM:en): skärminspelning, H.264-kodning, låsdetektering, QR-markör, Apple-tal och review 2-fixarna (paus vid Secure Event Input, datakapplöpning, gränskontroll i blockbufferten).
- Review 2 på Quest (kompilerar, inte körd): video-kvittens efter avkodning och IDR vid tappad bild, 1 s armering och "Läs allt", mikrofon och kamera stoppas i onPause, cert-ID på knappsatsen.
- Installationsskriptet (fastlåst kopia, privat logg, launchd-PATH) är inte kört på macOS.
- Daemonen är inte körd under riktig launchd eller macOS. Dialogen och notisen för parkoppling är inte testade. Claude Codes faktiska http-hooks (före 0.3.1; nu gated command-hookar, se 'Hookar och strömbrytare') och HTTP-MCP är testade mot SDK:n och dokumentationen, inte mot din Claude Code-version.

## Mappar
| Mapp | Innehåll |
|---|---|
| `bridge/` | Daemonen (TypeScript), simulerat headset (`sim/`), tester (`test/`), `scripts/install-daemon.sh` |
| `claude-config/` | Skills (`xr-presenter`, `xr-devmode`), CLAUDE.md-snippet, hooks-exempel (http och kommando-shims), plist-mall |
| `quest-app/` | Android-projektet (Spatial SDK 0.15.0) |
| `mac-helper/` | Swift-CLI `claudexr-capture` |
| `bugs/` | Buggrapporter i dev-läge (skapas vid behov) |
| `PROGRESS.md` | Byggloggen, med NÄSTA STEG överst |
| `REVIEW.md`, `review/` | Granskningen. Status per fynd finns i PROGRESS.md |
