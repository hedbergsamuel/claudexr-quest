# ClaudeXR 0.3.1: hookarna körs bara när headsetet är på

Datum: 2026-11-09. Bygger på 0.3.0. Version: bryggan 0.3.1, Mac-hjälparen 0.3.1 (bara versionssträngen i Info.plist, **ingen kodändring, bygg inte om den**: en ombyggnad ger ny cdhash och ny Skärminspelning-tillåtelse; 0.3.0-binären fungerar oförändrad). **Quest-appen är orörd: den är kvar på 0.3.0 (versionCode 4)**, ingen ny APK behövs.

## Vad som ändrats

1. **Gated command-hookar i stället för ogated http-hookar.** Alla 11 hookar (SessionStart, UserPromptSubmit x2, PermissionRequest, PreToolUse, PostToolUse, PostToolUseFailure, Notification, Stop, TaskCreated, TaskCompleted) skrivs som command-hookar:
   ```
   [ -f "$HOME/.claudexr/on" ] || exit 0; curl -sf -m <timeout-1> -X POST http://127.0.0.1:47801/hook/<context|activity|permission> -H "Authorization: Bearer $(cat "$HOME/.claudexr/local-token" 2>/dev/null)" -H "Content-Type: application/json" --data-binary @- || exit 0
   ```
   Utan flaggfilen: ingen curl, inget nätverksanrop, inget hook-fel. Med flaggan: bryggans svar skrivs oförändrat till stdout (testat byte för byte för PermissionRequest); HTTP-fel, nedstängd daemon eller saknad tokenfil blir tyst exit 0 (fail-closed, terminalen avgör). Mappning och timeouts som i 0.3.0 (context 3 s, activity 2 s, permission 150 s => `curl -m 149`).
2. **Flaggan `~/.claudexr/on` sköts av bryggan** (ny modul `src/flag.ts`, hubben): skapas atomiskt (temp-fil + rename, 0600) när ett *autentiserat* headset ansluter; tas bort vid frånkoppling (inklusive heartbeat lost/kod 1006 och avparkoppling), vid daemonavslut (SIGTERM/SIGINT/SIGHUP/exit/uncaughtException) och vid daemonstart (kvarlämnad flagga rensas, men först *efter* att portarna är bundna, så en andra daemoninstans som dör med EADDRINUSE aldrig tar bort en levande flagga). Ett byte av headset ("replaced", kod 4000) tar inte bort flaggan. Katalogen styrs av `CLAUDEXR_FLAG_DIR`; utan den används `CLAUDEXR_STATE_DIR` om den är satt (alltså kan en testdaemon aldrig röra riktiga `~/.claudexr/on`), annars `~/.claudexr`. Testhjälparen sätter `CLAUDEXR_FLAG_DIR` uttryckligen.
3. **Token:** hookarna kräver inte längre `CLAUDEXR_TOKEN` i Claude-sessionens miljö (`export` i `~/.zshrc` kan tas bort). Kommandot läser `~/.claudexr/local-token` (0600, sätts av daemonen vid varje start) när hooken körs; token står alltså aldrig i settings.json, loggar, utskrifter eller diffar. Installeraren läser aldrig tokenfilens innehåll, bara behörigheten (och sätter 600 om den avviker). Avvägning att känna till: under de millisekunder curl körs står token i curls kommandorad (synlig via `ps` för samma användare, på loopback). Förut låg samma hemlighet i Claude-processens miljö.
4. **`xr on | xr off | xr status`**: subkommandon i daemonens CLI (`node …/index.js xr on`) och en wrapper `~/bin/xr` som `install-daemon.sh` installerar (en befintlig `~/bin/xr` som inte nämner claudexr lämnas orörd; den gamla tillfälliga `xr-gate-install.sh`-wrappern ersätts eftersom den nämner claudexr; `uninstall-daemon` tar bort wrappern om den är vår). Design: flaggan ändras bara vid headsetets anslutning/frånkoppling och daemonens start/stopp, inte periodiskt. Därför gäller manuell **on** tills headsetet kopplas från eller daemonen startas om, och manuell **off** (medan headsetet är anslutet) tills headsetet ansluter igen. `xr status` visar flagga, om daemonen svarar och om headsetet är anslutet (samt en OBS-rad när de är oense).
5. **Installeraren `install-hooks`** (ny modul `src/hooksetup.ts`): `node …/index.js install-hooks [--dry-run] [--settings <fil>] [--port <n>] [--flag-dir <dir>] [--state-dir <dir>]`.
   - Backup först: `settings.json.bak-claudexr-<ÅÅÅÅMMDD-TTMMSS>` (0600, samma innehåll). Skriver atomiskt (temp + rename), behåller filbehörigheten, följer symlänk (en dotfiles-symlänk förblir symlänk).
   - Idempotent: andra körningen skriver inget och tar ingen backup ("Redan uppdaterad"). Ersätter ClaudeXR-http-hookar (`http://127.0.0.1:<port>/hook/context|activity|permission`) och äldre gated command-hookar (t.ex. från den tillfälliga `xr-gate-install.sh`, som använde `$CLAUDEXR_TOKEN`) på plats, med samma timeout; tar bort dubbletter; lägger till saknade hookar; rör aldrig andra hookar, matchers eller inställningar (testat). Äldre `claude-config/hooks/xr-*.mjs`-shims rapporteras men rörs inte. Bara hookar mot daemonens egen loopback-port (47801 eller `--port`) räknas som ClaudeXR:s; en annan port lämnas orörd.
   - Standard är bara `~/.claude/settings.json`; projekt- eller lokala settingsfiler kräver `--settings <fil>`.
   - `--dry-run` visar en diff (rader med `-`/`+`) och skriver ingenting (ingen backup). Gamla inline-token (`Bearer <lång sträng>`) maskas i diffen.
   - Ogiltig JSON eller oväntad struktur: avbryter utan att skriva.
   - `print-config` skriver nu ut de gatade command-hookarna (och pekar på `install-hooks`) i stället för http-hookar; `CLAUDEXR_TOKEN`-raden är borta. `claude-config/settings.example.json` är regenererad. `install-daemon.sh` skriver ut install-hooks-kommandona men **ändrar aldrig settings.json själv**.

## Installera (exakta kommandon, i den här ordningen)

Inget av detta har körts på din riktiga maskin; jag har bara kört isolerade tester.

```bash
# 1) Bygg, testa, installera daemonen (nya koden + ~/bin/xr). Starta om daemonen sker i install-daemon.
cd "/Users/<användare>/Downloads/Meta XR/bridge" && npm ci && npm run build && npm test && npm run install-daemon

# 2) Titta på vad hookarna skulle bli (skriver ingenting)
node "$HOME/Library/Application Support/ClaudeXR/bridge/dist/src/index.js" install-hooks --dry-run

# 3) Skriv dem (backup görs automatiskt)
node "$HOME/Library/Application Support/ClaudeXR/bridge/dist/src/index.js" install-hooks

# 4) Starta om öppna Claude Code-sessioner (hookar läses vid start). Ta bort export CLAUDEXR_TOKEN ur ~/.zshrc om du vill.
xr status
```
Om du redan körde `~/bin/xr-gate-install.sh` är det lugnt: install-hooks känner igen och ersätter dess hookar. Mac-hjälparen och Quest-appen behöver inte bytas.

## Ta tillbaka

- Strömbrytare av: `xr off` (hookarna gör ingenting) eller `rm ~/.claudexr/on`. Gäller tills headsetet ansluter nästa gång.
- Återställ settings.json: `ls ~/.claude/settings.json.bak-claudexr-*` och `cp ~/.claude/settings.json.bak-claudexr-<tidsstämpel> ~/.claude/settings.json` (installeraren skriver ut exakta raden efter körning). Det ger tillbaka http-hookarna som de var.
- Hela 0.3.0-läget: återställ settings.json enligt ovan, och för daemonen: bygg om från `metaxr-backup-pre-0.3.1.tar.gz` (scratchpad `/private/tmp/claude-501/-Users-<användare>/db35ce98-5628-479c-bcab-748c77e35632/scratchpad/`) och kör `npm run install-daemon`. Observera att en gammal daemon (0.3.0) inte sätter flaggan: med gated hookar skulle då ingenting hända, så återställ settings.json först.
- Ta bort `~/bin/xr`: `npm run uninstall-daemon` (tar bara bort wrappern om den är vår).

## Testat

Alla körningar mot isolerade instanser (slumpad port från 48100, temp-state, temp-HOME, mDNS/notiser av, falsk Mac-hjälpare, `CLAUDEXR_FLAG_DIR` i temp). Aldrig mot port 47801, riktiga `~/.claude/settings.json`, `~/.claudexr`, launchd eller Application Support. Inga processer dödades förutom de egna testdaemonerna.

Nya tester i `bridge/test/hookgate-031.test.ts` (22 st): flaggan (atomisk, kataloger, override), kommandots form, `planSettings` (11 hookar, andra hookar/matchers orörda, idempotens byte för byte, gammal `$CLAUDEXR_TOKEN`-gate ersätts, dubbletter, shims, dålig struktur), diff/maskning, att andra verktygs hookar (annan port) aldrig tas över, installeraren som CLI mot temp-HOME (dry-run skriver inget, backup 0600 med originalinnehåll, idempotent, ogiltig JSON orörd, symlänk bevarad, tokenfilens behörighet satt till 600 utan att innehållet skrivs ut), `print-config`, de *genererade kommandona körda med `sh -c` mot en stubbserver* (utan flagga: 0 anrop och tom stdout; med flagga: token från filen, stdout oförändrad; 401/daemon nere/saknad tokenfil ger tyst exit 0), samt mot en riktig isolerad daemon (kvarlämnad flagga rensas vid start, flaggan följer en autentiserad sim, tas bort vid ren stängning och vid `terminate()` som ger 1006, vid SIGTERM, oautentiserad anslutning sätter ingen flagga, andra daemoninstans exit 3 lämnar flaggan, kommandot autentiserar med token från filen), `xr on/off/status` (även manuell on/off över en anslutning och rensning vid nästa start) och `install-daemon.sh` (wrapper installeras/avinstalleras, främmande `~/bin/xr` orörd; launchctl stubbad, temp-HOME). `printconfig-r2-08` uppdaterad.

Resultat: `tsc` utan fel, `npm run build` OK, `npm test`: **124 tester, 122 pass, 0 fail, 2 hoppade** (samma två som i 0.3.0: mDNS-upptäckt och riktig whisper). Före 0.3.1 var det 102.

## Inte testat / kända begränsningar

- **Installeraren är inte körd mot din riktiga `~/.claude/settings.json`**, bara mot egna kopior/exempel. Kör `--dry-run` först och läs diffen.
- Att Claude Code verkligen kör command-hookarna som förväntat (stdout-JSON från PermissionRequest tolkas som beslut på samma sätt som http-hookens svar) är inte provat i en riktig Claude Code-session; jag har bara verifierat att kommandot skriver bryggans svar oförändrat till stdout. Provkör en permission-fråga med headsetet på, och en med `xr off`.
- Heartbeat-timern (10 s-tick, två missade pingar) testades inte i realtid; kodvägen "heartbeat lost" slutar i samma `close`-hanterare som `terminate()` (1006) och den är testad. En riktig Quest-avtagning/Wi-Fi-tapp är inte provad.
- SIGKILL/strömavbrott går inte att fånga: flaggan ligger kvar tills launchd startat om daemonen (≈10 s, `KeepAlive`) som rensar den vid start. Under mellantiden anropas en död port, hookarna ger tyst exit 0 (`curl -m`, `|| exit 0`).
- Flaggan följer *anslutningen*, inte om headsetet faktiskt sitter på huvudet: appen pausas normalt när headsetet tas av och kontrollsocketen stängs då, men det är inte mätt här.
- Flera Claude-sessioner delar samma flagga (en daemon, en flagga).
- `xr`-wrappern och `install-daemon.sh` är körda bara med stubbad launchctl i temp-HOME.
- `claude-config/settings.command-hooks.example.json` (node-shims) är ogatat och ersatt av `install-hooks`; filen är kvar men ska inte användas.
- Quest-appen och Mac-hjälparens binär är oförändrade och alltså inte omtestade.
