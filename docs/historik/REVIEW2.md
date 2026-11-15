# ClaudeXR v0.2.0 – granskning, andra genomgången

**Granskat:** den färdiga v0.2.0. PROGRESS.md: "NÄSTA STEG – Uppdaterad 2026-11-09 02:30, ALLT KLART", och den sista raden var `[02:30] Status för granskningen …`. Ögonblicksbilden togs 02:30 (svensk tid). Det omfattar bridge (daemon, hookapi, pairing, videoflow, stream, voice), claude-config, quest-app (inklusive kalibrering, video och röst), mac-helper (Swift) och README.
**Metod:** Allt kördes på en kopia i VM:ens scratch-katalog. Jag har inte ändrat eller raderat något i projektet. Det jag skrev är `REVIEW2.md` och `review2/`. Swift-koden går inte att kompilera här (det finns ingen macOS-SDK), så jag har bara läst den.

## Sammanfattning

1. v0.2.0 är ett stort steg framåt. De kritiska fynden från första genomgången är åtgärdade och regressionstestade: null-kraschen, CSRF/rebinding, maskering i godkännanden, ReDoS i mask och flödeskontroll för video. Loopback-API:t går inte att nå från webbsidor (Origin, Host och Bearer krävs).
2. **Kritiskt (verifierat):** modellen kan ändra ett **väntande godkännandekort** via `xr_panel update`. Den kan byta rubrik (till exempel till "Säkert: kör testerna (granskat)") och krympa kortet till 5×2 cm medan det riktiga kommandot ligger kvar. Den kan också lägga andra paneler framför kortet. Patch R2-01.
3. **Hög (verifierat):** riskanalysen i godkännanden är O(n²). Ett Write på 200 kB fryser daemonen i **6,5 s** (2 MB skulle ta minuter), och under tiden står alla hooks och headsetet stilla. Parametrar som inte visas (`replace_all`, sandlådeflaggor med mera) godkänns utan att användaren ser dem. Patch R2-02.
4. **Hög:** daemonen körs från arbetskatalogen som Claude själv redigerar. Koden som beslutar om Claudes behörigheter kan alltså ändras av Claude. Loggen med parkopplingskoden ligger läsbar för alla i `/tmp`. launchd hittar inte `whisper-cli` (PATH), och README:s `~/…` expanderas inte. Patch R2-03.
5. **Hög (Quest):** video kvitteras när den tas emot, inte när den avkodats, och kön rymmer 30 ramar. Flödeskontrollen täcker alltså inte en långsam avkodare. Godkänn-knappen är aktiv direkt och utan att användaren har scrollat. Mikrofon och kamera stängs inte i `onPause`. Patch R2-04, R2-05 och R2-06.
6. Mätt: xr_ask-rundresa 0,97 ms (p50) och 5,4 ms (p99) över MCP-HTTP. HTTP-hook 0,3 ms (keep-alive) och 2,5 ms (curl), mot 27 ms med Node-shim. Daemonen startar på 166 ms och tar 102 MB RSS. tools/list är ≈1 200 tokens med dev-läge **på (standard)**.
7. Tester: 63/63 PASS (+1 skip) deterministiskt i 4 körningar. Under hög CPU-last föll två tester en gång (`fetch failed` vid omstart), och `xr_test, xr_show …` föll en gång utan last. Inget av det gick att återskapa isolerat.
8. Jag har skrivit 9 patchar mot v0.2.0 (02:30) plus en staplad variant. Alla kan appliceras var för sig. Staplade ger de 69/69 PASS och Kotlin kompilerar. Swift-patchen är okompilerad.

## Prioriterade fynd

V = verifierat med test eller repro här. D = verifierat i dokumentation eller referenskod. S = bedömning (kräver hårdvara eller Mac). Radnummer avser ögonblicksbilden 02:30.

| # | Allvar | Fil:rad | Problem | Fix | Insats | Status |
|---|---|---|---|---|---|---|
| 1 | **Kritisk** | bridge/src/hub.ts:396-419 (`update`), tools.ts:186-225 (`xr_panel`) | `update` slår ihop godtyckliga fält i alla paneler, även `kind:"permission"`. Modellen (även en annan session eller en subagent som delar daemonen) kan byta **rubrik**, storlek, roll och placering på ett **väntande godkännandekort**. Den kan dessutom lägga en transparent HTML-panel framför kortet med ett falskt kommando ovanför de riktiga knapparna. Med token (loopback) går även `subject` och `warnings` att skriva över. | Godkännande- och "Jag hörde"-kort görs skrivskyddade. Medan ett godkännande väntar minimeras alla andra paneler, nya paneler startar minimerade, och rummet återställs efteråt. | 1 h | V (repro: titeln byttes och kortet krympte till 0,05×0,02 m) – **R2-01** |
| 2 | **Hög** | hookapi.ts:45-66, 118-122 | `[^\n]*` efter upprepade ord i RISKS är O(n²). Write med "curl " × 40 000 (200 kB) tar 6 556 ms, "$(" × 20 000 tar 305 ms. Riskanalysen körs *innan* storleksgränserna. | Gränserna kontrolleras först, och kvantifierarna begränsas ({0,400}). | 30 min | V (risk-redos.mts) – **R2-02** |
| 3 | **Hög** | hookapi.ts:101-117 | Fält som inte renderas visas inte: Edit/MultiEdit `replace_all` (ersätter alla förekomster), Bash `run_in_background`/`timeout` och eventuella sandlådeflaggor (S: Bash-verktyget i Claude Code har haft fältet `dangerouslyDisableSandbox`). Användaren godkänner det hen inte ser. | "Övriga parametrar: {…}" i detaljfältet, varning för replace_all och för att köra utanför sandlådan. | 30 min | V – **R2-02** |
| 4 | Medel | hookapi.ts:43 (DECEPTIVE) | Tagg-tecken U+E0000–E007F, variantväljare, mjukt bindestreck, Hangul-fyllnadstecken, U+2028/2029 och CR saknas. Kyrilliska och grekiska förväxlingstecken varnas inte för. | Utökad klass med `u`-flagga (CRLF tillåts i fildiff). Varning vid kyrilliska och grekiska tecken. | 20 min | V – **R2-02** |
| 5 | **Hög** | scripts/install-daemon.sh, plist | (a) Daemonen kör `bridge/dist` direkt från arbetskatalogen, som Claude redigerar i just det här projektet. Koden som beslutar om behörigheter kan alltså ändras av Claude, och `dist` byggs bara om den saknas (gammal kod kör tyst vidare). (b) Loggen `/tmp/claudexr-bridge.log` är läsbar för alla med umask 022 och innehåller **parkopplingskoden**. (c) launchd ger agenter `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, så `whisper-cli` från Homebrew hittas inte och rösten fungerar inte i daemonläge. (d) `sed`-ersättningen går sönder om sökvägen innehåller `#` eller `&`. | Bygg alltid, kopiera till en fastlåst kopia i `~/Library/Application Support/ClaudeXR/bridge` (inklusive helper-binären), sätt explicit PATH, logga till `~/Library/Logs/ClaudeXR` med Umask 077, XML-escapa plisten och låt avinstallationen ta bort kopian. | 1 h | V (skriptet kört med stubbad launchctl, plisten validerad med plistlib) – **R2-03** |
| 6 | Medel | config.ts:92-107; README:123 | `~` i `whisperModel`, `captureBin` och `bugsDir` expanderas aldrig (execFile går inte via skal), och README:s eget exempel använder `~/.claudexr/models/…`. | `expandHome` och `resolveBin` (söker även i /opt/homebrew/bin och /usr/local/bin). | 20 min | V – **R2-03** |
| 7 | **Hög** | quest PanelManager.kt:215-219, VideoDecoder.kt:16-27 | Ramar kvitteras när de tas emot, inte när de hamnat i MediaCodec, och den lokala kön rymmer 30 ramar (~1 s). När avkodaren inte hinner med (termisk strypning) växer fördröjningen förbi flödeskontrollen. Vid överfull kö eller avkodarfel begärs ingen IDR, så panelen fryser tills nästa GOP (10 s). Ett avkodarfel dödar tråden. | Kvittera efter `queueInputBuffer`, kö på 3, IDR direkt vid tapp, och bygg om avkodaren vid `IllegalStateException`. | 1 h | Kompilerat mot SDK 0.15.0; S för effekten – **R2-04** |
| 8 | **Hög** | quest ui/Panels.kt:209-245 | "Godkänn" är aktiv direkt när kortet dyker upp, och även om innehållet (upp till 20 000 tecken eller 600 diffrader) inte har scrollats fram. En nypning som var menad för panelen som låg där nyss kan godkänna, och "exakt visning" hjälper bara om allt faktiskt har visats. | 1 s fördröjning innan knappen aktiveras, och knappen visar "Läs allt ↓" tills användaren scrollat till slutet. | 30 min | Kompilerat; S – **R2-05** |
| 9 | Medel | quest MainActivity.kt:164-167 | `onPause` släpper bara WifiLock. Tas headsetet av medan push-to-talk hålls in kommer släpp-händelsen aldrig, och mikrofonen spelar in i bakgrunden i upp till 30 s. Kalibreringskameran stängs inte heller. | Avbryt röst (`voice_cancel`) och stäng kameran i `onPause`. | 20 min | Kompilerat, ProtocolTest 9/9 – **R2-06** |
| 10 | Medel | mac-helper Capture.swift:19-20, 116-118, 181, 194-199 | `forceKey`, `paused` och `bitrate` skrivs från stdin-tråden eller main och läses på capture-kön. Det är en datarace, och en IDR-begäran kan gå förlorad. | NSLock och en atomär take-and-clear för IDR. | 20 min | **Okompilerat** – R2-07 |
| 11 | Medel | Capture.swift:146-159 | `CMBlockBufferGetDataPointer` läser `totalLength` byte från första segmentet. Om bufferten inte är sammanhängande läser koden utanför minnet. | `CMBlockBufferCopyDataBytes` och NAL-längd utan memcpy. | 15 min | **Okompilerat** – R2-07 |
| 12 | Medel | AppleSTT.swift:88-105 | `best` muteras samtidigt från flera igenkännare, och en uppgift som rapporterar både slutresultat och fel anropar `group.leave()` två gånger, vilket kraschar. | Lås och "leave once". | 15 min | **Okompilerat** – R2-07 |
| 13 | Medel (integritet) | config.ts:41-45 (allowApps) | Terminal och iTerm strömmas **utan godkännande** (användarens val). Konkreta risker: `cat .env`, `printenv`, `aws configure list`, `gh auth token`, `kubectl get secret -o yaml`, lösenord som klistras in vid `ssh`/`sudo` och tokens i felutskrifter visas i headsetet. Med en annan parkopplad enhet (se #17) skulle de kunna lämna rummet. | **Utan att ta bort funktionen:** (1) R2-07 pausar strömmen automatiskt när *Secure Event Input* är på. Det är på medan lösenordsfält har fokus i macOS-appar. Terminal visar en nyckelsymbol vid lösenordsfrågor, och iTerm2 har en inställning för att slå på det automatiskt vid lösenordsfrågor (S: verifiera med `sudo -v` att flaggan faktiskt slås på). (2) Behåll den röda "● STRÖMMAR"-märkningen i headsetet och lägg till en menyradsindikator på Macen (macOS visar redan sin egen lila inspelningsindikator). (3) Röstkommandot "pausa strömmen" finns. Lägg dessutom till en snabb gest (dubbel nypning på märkningen). (4) Som tillval: on-device OCR (Vision, `VNRecognizeTextRequest` .fast, ~2 fps) med maskens mönster som svärtar eller pausar 5 s vid träff (S: ~10–30 ms CPU per analyserad bild på M-serien). (5) Ett godkännande per session och dag även för tillåtna appar. | 2–6 h | S (1) implementerat i R2-07 |
| 14 | Medel | index.ts:156-184 (`print-config`), README:74-78 | Token klistras in i `~/.claude.json` (`claude mcp add-json`) och `~/.claude/settings.json`. Dessa filer synkas eller delas ofta (dotfiles-repo, säkerhetskopior) och har ofta rättigheter 0644. Byte av token kräver att allt klistras in igen. | Låt MCP använda `headersHelper: "cat ~/.claudexr/mcp-headers.json"` (0600, körs om vid 401) och låt hooks använda `Authorization: Bearer $CLAUDEXR_TOKEN` med `allowedEnvVars`. `--inline-token` behåller den gamla utskriften. | 45 min | V (test), D (headersHelper, `${VAR}`, allowedEnvVars) – **R2-08** |
| 15 | Medel | quest BridgeConnection.kt:55-67, 150-160 | `seenFingerprint` delas mellan alla anslutningar (huvud, video, Bonjour-försök). Vid parkoppling kan beviset och fastnålningen räknas på fingeravtrycket från *en annan* anslutning (ett race). | Ta fingeravtrycket från `response.handshake?.peerCertificates` för just den socketen i `onOpen`. | 30 min | S (race) |
| 16 | Medel | pairing.ts:44-48 | PBKDF2 med 200 000 iterationer ger samma resultat i Kotlin och Node (V: samma hex). På VM:ens ARM-kärna tar den bara **16 ms** per försök, alltså ≈18 CPU-dygn för hela kodrymden. En GPU-farm klarar det betydligt fortare (S: ≈20–40 min per RTX 4090), så MITM-skyddet vilar på 2-minutersfönstret och Mac-dialogen. **PAKE saknas fortfarande.** | Billig och robust förbättring: visa 4 ord eller 6 hex av certifikatets fingeravtryck både i Mac-dialogen och i headsetet vid parkoppling, och låt användaren jämföra (SAS). Det stoppar MITM helt utan PAKE. | 1 h | V (paritet och tid), S (GPU) |
| 17 | Medel | pairing.ts:72-93, hub.ts:874-880 | En angripare på LAN kan hålla parkopplingen "upptagen" och skicka nya notiser var 10:e sekund (ny anslutning, 3 försök per anslutning). Mac-dialogen visar ett enhetsnamn som angriparen styr ("Quest 3"), och IP-adressen är det enda användaren kan känna igen. | Gräns per IP och per minut, visa IP tydligt i dialogen ("från 192.168.1.37, *inte* den adress headsetet brukar ha") och, med #16, fingeravtrycket. | 30 min | S |
| 18 | Låg | index.ts:76-95 | Avbrott kopplas till väntande anrop bara via JSON-RPC-id i stateless-läget. Id:n är små heltal per klient, så ett sent `notifications/cancelled` från session A kan avbryta session B:s anrop med samma id. Skyddet `set.size === 1` hjälper bara när båda är i luften samtidigt. | Kräv en egen header per klient (`X-ClaudeXR-Client`) eller gå över till stateful-sessioner (`Mcp-Session-Id`). | 1 h | S |
| 19 | Låg | hub.ts (processVoice) | Timern för automatisk sändning löser *vilket som helst* väntande "Jag hörde"-kort, inte just sitt eget. | Använd id:t från `show`. | 10 min | V (läsning) |
| 20 | Låg | quest ui/Panels.kt:202 | `update = { loadDataWithBaseURL(…) }` laddar om HTML vid varje omkomposition (flimmer och CPU). `<link rel=dns-prefetch>` omfattas inte av CSP, vilket ger en liten DNS-kanal. | Ladda bara när `spec.html` ändrats (via `tag`). DNS-kanalen är oviktig eftersom modellen redan har innehållet. | 10 min | S |
| 21 | Låg | quest ScreenCalibrator.kt:101-130 | `viewerPose()` (Scene) anropas från kamerans HandlerThread, och Spatial SDK är inte dokumenterat trådsäkert. En ny Y-buffert på 1,2 MB allokeras per bild. | Hämta posen på main eller via en cache uppdaterad i `onSceneTick`. Återanvänd bufferten. | 30 min | S |
| 22 | Info | CalibrationMath.kt:37-38 | `((H − v) − cy)/fy` följer exakt Metas Spatial Scanner-exempel (D). Enhetstestet använder cy = H/2 och kan därför inte avslöja ett konventionsfel. | Kontrollera på hårdvara (se avsnittet om hårdvara). | – | D |
| 23 | Låg | mac-helper (TCC) | Helpern startas av Node-daemonen, så macOS tillskriver troligen skärminspelning och taligenkänning till **node**. Det tillståndet gäller då alla launchd-startade Node-processer. README säger "tillåt node och/eller claudexr-capture". | Kontrollera i Systeminställningar vilket program som får tillståndet. På sikt: helpern som en egen signerad .app eller LaunchAgent. | – | S |
| 24 | Låg | config.ts:84 (`devMode ?? true`) | Dev-läge är på som standard. Det ger ≈170 extra tokens (verktyget xr_dev) plus skill-beskrivningen per session, och buggrapporter skrivs till projektmappen (som Claude läser). | Standard av för daglig användning. | 5 min | V (mätning) |
| 25 | Låg | test/zz-dbg.test.ts | Restfil. `bridge/dist-v011-tmp/` fanns inte längre i ögonblicksbilden. | Ta bort. | 1 min | **R2-09** |

**Bekräftat korrekt (urval):** loopback-API:t kräver Host, ingen Origin och en Bearer jämförd med `timingSafeEqual`. `local-token`, `paired.json`, `config.json` och nyckeln har rättigheter 0600, och `~/.claudexr` har 0700 (V). Godkännandehooken returnerar bara `allow`/`deny` och aldrig `updatedInput` eller `updatedPermissions` (V). Om daemonen inte svarar faller allt tillbaka på terminalfrågan. Svar efter avbrott eller timeout ignoreras, dubbelsvar ignoreras, och vid återanslutning skickas väntande kort igen. Rösten kan inte nå permission-, parkopplings- eller strömningsgodkännanden (`voiceTarget`). whisper körs via `execFile` utan skal, WAV-filer har 0600 och raderas i `finally` och vid start. HTML-panelerna har CSP `default-src 'none'`, ingen navigering, ingen fil- eller innehållsåtkomst och inget JS-gränssnitt. Kotlin och Node beräknar PBKDF2 identiskt.

## Daemon, hooks och fail-closed (fokusfråga 1)

- **Webbsida på Macen:** når inte daemonen. Origin avvisas, Host måste vara loopback och Bearer krävs (V). WSS-porten kräver parkoppling.
- **Annan användare på Macen:** når 127.0.0.1 men behöver token. Den läcker i dag via inklistrade konfigurationsfiler (#14) och via loggen i /tmp (parkopplingskoden, #5).
- **Daemonen nere:** HTTP-hooks får "connection refused", vilket är ett icke-blockerande fel enligt dokumentationen (D), och prompten fortsätter direkt. PermissionRequest ger inget beslut, så terminalfrågan gäller (fail-closed V). MCP-verktygen saknas tills daemonen kör.
- **Daemonen hänger** (till exempel på grund av #2): varje PreToolUse- och PostToolUse-hook väntar i upp till 2 s och kontext-hooken i 3 s per prompt. PermissionRequest väntar i upp till 150 s, men terminalfrågan visas parallellt (D enligt byggarens dokumentationsläsning). Claude Code blockeras alltså inte för gott, men varje verktygsanrop blir sega. Därför är #2 viktig.
- **Krasch:** launchd startar om efter ≥10 s (ThrottleInterval). Väntande kort försvinner och terminalen gäller. Det finns ingen `uncaughtException`-hanterare, vilket är rätt eftersom en omstart är säkrare än att fortsätta i trasigt tillstånd.
- **`--stdio`:** en tunn proxy (RemoteBackend) mot daemonen. Om daemonen är nere returnerar den ett tydligt fel.

## Vad du ska kontrollera innan du klistrar in hooks eller settings i ~/.claude/settings.json

Hooks körs med dina rättigheter och påverkar vad Claude får köra. Läs dem som du läser ett skript från internet.

1. **Använd HTTP-varianten (`print-config`), inte kommando-hooks.** HTTP-hooks kör ingen lokal kod. Kommando-varianten kör `node …/Downloads/Meta XR/claude-config/hooks/*.mjs`, och de filerna kan Claude redigera när det arbetar i projektet, vilket ger kodkörning utanför behörighetsfrågorna.
2. Kontrollera att varje `url` börjar med **`http://127.0.0.1:47801/`** och att inga andra hooks eller kommandon har följt med.
3. Kontrollera att PermissionRequest-hooken **inte** har `"onFailure": "block"`. Annars nekas alla verktyg när daemonen är nere. Den ska heller inte ha `async`.
4. Slå ihop med dina befintliga hooks i stället för att ersätta dem. JSON-sammanslagningen ersätter hela `hooks`-objektet om du klistrar in det rakt av.
5. Klistra inte in token i filer som synkas eller delas. Använd R2-08 (`headersHelper` och `$CLAUDEXR_TOKEN`).
6. Lägg till deny-regler så att Claude inte kan ändra det som beslutar om dess egna rättigheter:
   ```json
   "permissions": { "deny": [
     "Read(~/.claudexr/local-token)", "Read(~/.claudexr/mcp-headers.json)",
     "Edit(~/.claudexr/**)", "Write(~/.claudexr/**)",
     "Edit(~/Library/LaunchAgents/**)", "Write(~/Library/LaunchAgents/**)",
     "Edit(~/Library/Application Support/ClaudeXR/**)", "Write(~/Library/Application Support/ClaudeXR/**)"
   ] }
   ```
   `config.json` styr bland annat `voice.command` (ett skalkommando som daemonen kör), `xrPermissions` och tillåtelselistan för strömning.

## Gör före första användning

1. Applicera R2-01, R2-02, R2-03 och R2-08 (eller `R2-00-all-stacked.patch`). Kör sedan `npm test` (ska ge 69 pass och 1 skip).
2. Installera daemonen med `npm run install-daemon` (efter R2-03 körs den från en fastlåst kopia). Kör installationen igen efter varje uppdatering du litar på.
3. Kör `node …/print-config`. Lägg `export CLAUDEXR_TOKEN=…` i `~/.zshrc`, registrera MCP-servern och slå ihop hooks enligt kontrollistan ovan, inklusive deny-reglerna.
4. Sätt `"devMode": false` i `~/.claudexr/config.json` om du inte felsöker.
5. Verifiera whisper-modellen med checksumma i stället för en blind `curl -L`:
   ```bash
   curl -L -o ~/.claudexr/models/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
   shasum -a 256 ~/.claudexr/models/ggml-base.bin
   # jämför med "SHA256"/"LFS"-värdet på filens sida på huggingface.co (Files → ggml-base.bin),
   # eller med whisper.cpp:s models/download-ggml-model.sh. Lägg in värdet i README när du har kontrollerat det.
   ```
   (Jag har inte kunnat hämta och verifiera hashen härifrån. Förankra värdet i README och låt ett skript kontrollera det.) Modellen läses av whisper.cpp:s egen parser. En utbytt fil är främst en risk för att parsern har fel, inte för direkt kodkörning, men kontrollera ändå.
6. Bygg mac-helper på Macen (`swift build -c release`) och åtgärda eventuella kompileringsfel (koden är okompilerad, se R2-07). Kontrollera sedan **vilket program** som får "Skärm- och systemljudsinspelning" och "Taligenkänning" (#23).
7. Parkoppla Quest, och jämför IP-adressen i Mac-dialogen med headsetets adress (Inställningar → Wi-Fi). Neka om den inte stämmer.
8. Testa fail-closed en gång: stoppa daemonen (`launchctl bootout gui/$(id -u)/com.claudexr.bridge`), be Claude köra ett kommando som kräver lov och kontrollera att terminalfrågan kommer direkt.

## Mätresultat (VM aarch64, 4 kärnor, Node 22.23)

| Mätning | Resultat |
|---|---|
| `npm test` (ögonblicksbild 02:30) | 63 pass, 1 skip, 0 fail i 4 körningar (69 s per körning). Under 4 CPU-slingor föll 2 tester en gång (`fetch failed`, omstarts- och unpair-testerna), och `xr_test, xr_show …` föll en gång utan last. Inget gick att återskapa isolerat → troligen tidskänsliga (port- eller omstartsfönster) |
| Med alla R2-patchar | 69 pass, 1 skip, tsc PASS, kotlinc PASS, JVM-tester 9/9 |
| xr_ask-rundresa (MCP Streamable HTTP, stateless, simulerat headset som svarar direkt) | p50 **0,97 ms**, p99 5,37 ms, max 5,98 ms (n=200). v0.1.1 stdio: 0,30/0,73 ms. Skillnaden saknar praktisk betydelse |
| `/hook/context` | 0,34 ms p50 (fetch keep-alive), 2,5 ms p50 med curl (ny process och anslutning) |
| `/hook/activity` | 0,31 ms (keep-alive), 2,5 ms (curl) |
| Kommando-hook-shim (Node) | **27 ms** p50 |
| Daemonstart till `/status` | 222 ms första gången (inklusive TLS-nyckel), 166 ms varm |
| Daemon RSS i vila | 102 MB (README: ~110 MB) |
| tools/list | 8 verktyg, 4 330 tecken ≈ **1 200 tokens** (dev-läge på, standard). Byggarens mätning med dev av: ≈1 030 |
| CLAUDE.md-snippet | 136 ord, 840 tecken ≈ 210 tokens per session, även utan headset |
| Skills | xr-presenter 4,3 kB ≈ 1 100 tokens när den laddas (beskrivningen ber om laddning "whenever XR: connected"), xr-devmode 1,7 kB |
| Riskanalys i godkännanden, 200 kB Write | **6 556 ms** före och <300 ms efter R2-02 (testet ligger i patchen) |
| PBKDF2 200 000 iterationer | 16 ms (Node) och ~100 ms (JVM inklusive start); samma hex i båda |

## Sådant som bara kan avgöras på hårdvara

- **Kalibreringens konvention (#22):** sätt kalibrerat överlägg på MacBook-skärmen och mät den vertikala förskjutningen med en linjal. Om cy ≠ H/2 och konventionen vore fel skulle felet vara ≈(H − 2·cy)/fy · avstånd, alltså några centimeter vertikalt. Logga `LENS_INTRINSIC_CALIBRATION` och storleken (`adb logcat -s ClaudeXR.Calibration`).
- **Video:** med R2-04, lägg på termisk last och kontrollera att fördröjningen inte växer (OVR Metrics plus kvitto-RTT i `xr_status`).
- **Godkännandekort:** kontrollera att kortet inte går att godkänna av misstag (R2-05) och att andra paneler minimeras (R2-01).
- **TCC-tillskrivning (#23), lås- och secure-input-paus:** öppna `sudo -v` i Terminal under strömning. Med R2-07 ska headsetet visa "PAUSAD".
- **Mikrofonen vid avtagning (R2-06):** håll in push-to-talk, ta av headsetet och kontrollera daemonloggen (`voice_cancel`, ingen transkribering).

## Patchar (`review2/patches/`, inte applicerade)

Alla är skrivna mot ögonblicksbilden 02:30. Alla går att applicera var för sig med `git apply --check` och har kontrollerats mot en ren kopia. `R2-00-all-stacked.patch` innehåller alla nio.

| Patch | Innehåll | Test |
|---|---|---|
| R2-01-approval-card-readonly-and-exclusive | Godkännande- och "Jag hörde"-kort skrivskyddade, andra paneler minimeras medan ett godkännande väntar | test/approval-integrity2.test.ts (hänger eller misslyckas på originalet) |
| R2-02-approval-all-params-linear-risk-invisible-chars | Gränser före regex, begränsade mönster, övriga parametrar och replace_all, utökade osynliga tecken, varning för förväxlingstecken | test/approval-r2-02.test.ts (3 tester, alla misslyckas på originalet) |
| R2-03-daemon-pinned-install-path-log-tilde | Fastlåst installation, alltid bygge, PATH, privat logg, Umask, XML-säker plist, avinstallation, `expandHome` och `resolveBin` | test/config-r2-03.test.ts (kör skriptet med stubbad launchctl och plistlib) |
| R2-04-quest-video-ack-after-decode-idr-on-drop | Kvittens efter `queueInputBuffer`, kö på 3, IDR vid tapp och fel, ombyggnad av avkodaren | kotlinc (MediaCodec kan inte köras på JVM) |
| R2-05-quest-approval-arm-delay-and-read-all | 1 s fördröjning och tvång att läsa allt innan godkännande | kotlinc |
| R2-06-quest-stop-mic-and-camera-on-pause | `voice_cancel` och stängd kamera i onPause | kotlinc + ProtocolTest |
| R2-07-mac-helper-races-blockbuffer-secure-input | Lås, CopyDataBytes, paus vid Secure Event Input, "leave once" i AppleSTT | **okompilerad** |
| R2-08-token-out-of-claude-config-headershelper | `mcp-headers.json` (0600), `headersHelper`, `$CLAUDEXR_TOKEN` med allowedEnvVars, `--inline-token` | test/printconfig-r2-08.test.ts |
| R2-09-remove-zz-dbg-test | Tar bort restfilen | – |

Reproduktionsskript: `review2/repro/risk-redos.mts` (läggs i `bridge/` och körs med `npx tsx ./risk-redos.mts`) och `review2/repro/PairingKdfParity.java` (jämförelse av Kotlin/JVM och Node). Repron för det spoofade godkännandekortet är testet i R2-01.

README behöver uppdateras efter R2-03 och R2-08: loggsökväg, fastlåst installation, `print-config` utan token, deny-reglerna och checksumman för modellen.
