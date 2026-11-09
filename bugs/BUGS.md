# Buggar och förbättringar (genererad, redigera inte för hand)

Källa: reports.jsonl · 2026-11-09T18:35:20.199Z

## Buggar

### hög

- **[BUG-83fe52] xr_panel update move/size gör Macens skärm pyttelite och långt bort; layout present och role primary återställer inte** (brygga, 1×, senast 2026-11-09T17:46)
  - Anrop move {right:0,up:0,forward:2.5} och size {w:3.2,h:1.8} på displaypanelen skickade den "jättelångt bort" och osynlig; enheter för move/size är odokumenterade (förflyttning eller absolut? meter eller annat?), och efteråt rättade varken layout:present eller role:primary placeringen.
- **[BUG-e1fc54] Kvarlämnad tom panel till vänster om användaren kan inte tas bort** (quest-app, 1×, senast 2026-11-09T11:49)
  - En vilande/tom panel ligger kvar till vänster om användaren efter omstartade strömmar och går varken att stänga via xr_panel eller att hitta i list.
- **[BUG-3115b5] Nya paneler med roll primary placeras långt åt höger och ovanpå varandra; xr_test-panelen besvarades inte** (quest-app, 1×, senast 2026-11-09T17:50)
  - Testpaneler (4 xr_present + live-sida) hamnade långt till höger staplade, layout review och tidy rättade inte till det; xr_test "Grafik och live-sida" avslutades med "User closed the panel without answering" (kan bero på att panelen låg under de andra).
- **[BUG-8324e4] Röstpanelen (xr_ask listen:true) reagerar inte på tryck och går inte att stänga** (quest-app, 1×, senast 2026-11-09T17:52)
  - Användaren trycker i röstpanelen utan reaktion; bryggans panellista visar den inte (bara Macens skärm och live-sidan), så den kan inte stängas via xr_panel. Samtidigt fungerar live-sidan (xr_show url) med tryck "jättebra".
- **[BUG-4a4024] Nya paneler öppnas bakom Macens skärm; frågekortet täcker panelen den gäller** (quest-app, 1×, senast 2026-11-09T17:56)
  - Talat svar (kan vara felhört): nya paneler hamnar bakom/skymda av Macens skärm så användaren alltid måste flytta upp dem, xr_ask-formuläret överlappar tabellen den frågar om, och en röstruta öppnas när användaren trycker till svar.
- **[BUG-068994] Roll side ger ingen ny placering: panelen hamnar rakt fram, skymd av Macens skärm** (quest-app, 1×, senast 2026-11-09T17:57)
  - Diff-panelen med role side dök upp rakt framför användaren, skymd av datorskärmen, och frågeformuläret låg ovanpå; innehållet var däremot "väldigt tydligt och bra".
- **[BUG-405388] Placering per roll: overlay för stor och skymmer tangentbordet; frågekortet hamnar bakom eller ovanpå panelen** (quest-app, 1×, senast 2026-11-09T18:08)
  - Testresultat roller: primary rakt fram men skymd av datorn; log snett vänster och synlig; side snett höger och synlig (men tidigare diff med side hamnade rakt fram); compare synlig; overlay över Mac-skärmen men mycket större än den och skymde tangentbordet och frågekortet; i alla tester låg xr_ask-formuläret bakom/under testpanelen och användaren fick flytta det för att svara.
- **[BUG-552260] Fönsterström (Notion) visas blank trots "Streaming"** (spegling, 1×, senast 2026-11-09T11:45)
  - xr_stream window 178 svarar "Streaming" men panelen är tom; fönstret står kvar som [ask] även efter att macOS-rättigheter getts.
- **[BUG-2e4ecb] Ny fönsterström ersätter föregående fönsterström** (spegling, 1×, senast 2026-11-09T17:30)
  - Dokumentationen säger att fönsterströmmar läggs till (max 4), men när en andra xr_stream window startas stängs den första (Notion försvinner när Spotify öppnas och tvärtom). Display-strömmen får också nytt id varje gång. Båda hamnar i rollen side.
- **[BUG-13e417] Macens skärm blir svart: displaypanelen försvann och skärmen somnade medan dimning var aktiv** (spegling, 1×, senast 2026-11-09T18:04)
  - Mitt under testrunden försvann Macens skärm-panel ur listan, användaren såg bara svart, "dimming ACTIVE" stod kvar, xr_stream display gav "no display" eftersom Mac-skärmen sov (Display Asleep: Yes); efter caffeinate -u startade strömmen igen.
- **[BUG-2153ff] Ny fönsterström ersätter föregående fönsterström även när rollerna skiljer sig (roll är inte orsaken)** (spegling, 1×, senast 2026-11-09T18:10)
  - Terminal-ström (panel i side) ändrades till role compare, därefter startades Code-ström; Terminal-panelen och strömmen försvann ändå och bara Code och Macens skärm fanns kvar, och displaypanelens id byttes igen; hypotesen om rollkonflikt är därmed motbevisad.
- **[BUG-36fba1] Röstläge: tryck-och-tala ger ingen respons, kolliderar med "jag hörde"-fönstret** (röst, 1×, senast 2026-11-09T11:48)
  - Användaren höll in mikrofonknappen, talade och släppte utan att något skickades till chatten; vid andra försöket kolliderade det med bekräftelsefönstret "jag hörde detta" och inget fungerade.
- **[BUG-6b9a81] Röstmeddelande utanför öppen fråga skickas inte direkt: "skickas med nästa prompt", användaren måste skriva manuellt** (röst, 1×, senast 2026-11-09T18:06)
  - Användaren sa "Macen syns" med tryck-och-tala när ingen xr_ask lyssnade; headsetet svarade att det skickas med nästa prompt, så användaren skrev manuellt, och först då kom rösttexten (felhörd som "Ja, maken sings") via hook.
- **[BUG-7cf1b6] Claude stängde Macens skärmspegling** (hooks, 1×, senast 2026-11-09T16:38)
  - Hooken flaggade panelen "Macens skärm" som stale och Claude stängde den med xr_panel close, utan att fråga. Skärmen ska alltid speglas när användaren jobbar.

### medel

- **[BUG-e459f3] Strömpaneler saknas i xr_panel list och kan inte stängas** (brygga, 1×, senast 2026-11-09T11:45)
  - Gamla/tomma strömpaneler ligger kvar i rummet men list visar 0 paneler och close på panel-id ger "Not found"; stop ger "Stopped 0".
- **[AUTO-382020] [brygga] Anslutningen till headsetet bröts (kod 1006)** (brygga, automatiskt loggad, 24×, senast 2026-11-09T12:30)
- **[AUTO-7e72ed] Verktygsfel xr_stream: MCP error -32602: Input validation error: Invalid arguments for tool xr_stream: Invalid enum value. Expected 'windows' | 'window' | 'disp** (brygga, automatiskt loggad, 1×, senast 2026-11-09T16:38)
- **[AUTO-30e7ab] Verktygsfel xr_panel: Not found: d6c25f42** (brygga, automatiskt loggad, 1×, senast 2026-11-09T17:42)
- **[BUG-39391d] Panel-id byts varje gång strömmen startar om, så panelen kan inte pekas ut med ett fast id** (brygga, 1×, senast 2026-11-09T17:46)
  - Macens skärm fick nytt panel-id och stream-id vid varje omstart av strömmen (t.ex. d6c25f42, 0b54b69d, 1a2f7eff, f052a8ec); ett xr_panel update med det gamla id:t gav "Not found", vilket drabbar knappar och funktioner som behöver peka ut en panel.
- **[AUTO-312c3f] Verktygsfel xr_stream: Error: timeout** (brygga, automatiskt loggad, 1×, senast 2026-11-09T17:58)
- **[AUTO-5b8f9e] [brightness] could not restore brightness to 0.56; will retry (file /Users/<användare>/.claudexr/brightness-saved.json)** (brygga, automatiskt loggad, 2×, senast 2026-11-09T18:03)
- **[AUTO-0641ca] Verktygsfel xr_stream: Error: Error Domain=claudexr Code=2 "no display" UserInfo={NSLocalizedDescription=no display}** (brygga, automatiskt loggad, 1×, senast 2026-11-09T18:03)
- **[AUTO-1b37d0] [spegling] helper error: Error Domain=com.apple.ScreenCaptureKit.SCStreamErrorDomain Code=-3801 "The user declined TCCs for application, window, display capture** (spegling, automatiskt loggad, 1×, senast 2026-11-09T11:33)
- **[AUTO-12648a] [spegling] helper error: Error Domain=com.apple.ScreenCaptureKit.SCStreamErrorDomain Code=-3805 "Failed during stream due to application connection being interr** (spegling, automatiskt loggad, 9×, senast 2026-11-09T18:16)
- **[BUG-9e3e1b] Display-ström försvinner när en fönsterström startas** (spegling, 1×, senast 2026-11-09T11:45)
  - Hela skärmen försvann ur headsetet efter att en fönsterström startats; osäkert om bara en ström tillåts åt gången.
- **[AUTO-283d15] [spegling] screen calibration failed: camera_disconnected** (spegling, automatiskt loggad, 4×, senast 2026-11-09T17:58)
- **[AUTO-dcd040] [spegling] screen calibration failed: timeout** (spegling, automatiskt loggad, 4×, senast 2026-11-09T17:58)
- **[BUG-2a0790] Panelen "Claude arbetar" distraherar** (spegling, 1×, senast 2026-11-09T16:29)
  - När Claude arbetar öppnas alltid en flik/panel till vänster om användaren med texten "Claude arbetar" som visar terminalkommandon som körs. Användaren tycker den är väldigt onödig och distraherande.
- **[AUTO-61dab8] [spegling] screen calibration failed: marker_not_found** (spegling, automatiskt loggad, 1×, senast 2026-11-09T17:25)
- **[BUG-cc393a] xr_stream calibrate ger timeout** (spegling, 1×, senast 2026-11-09T17:59)
  - xr_stream action:calibrate svarade "Error: timeout" i testrundan; tidigare har kalibrering också fallerat med camera_disconnected och marker_not_found.
- **[AUTO-fe2ae1] [spegling] helper error: Error Domain=com.apple.ScreenCaptureKit.SCStreamErrorDomain Code=-3815 "Failed to find any displays or windows to capture" UserInfo={NS** (spegling, automatiskt loggad, 2×, senast 2026-11-09T18:04)
- **[AUTO-8a0c24] [spegling] helper error: Error Domain=claudexr Code=2 "no display" UserInfo={NSLocalizedDescription=no display}** (spegling, automatiskt loggad, 2×, senast 2026-11-09T18:03)
- **[AUTO-74da89] [spegling] display stream could not start (1): Error Domain=claudexr Code=2 "no display" UserInfo={NSLocalizedDescription=no display}** (spegling, automatiskt loggad, 2×, senast 2026-11-09T18:04)
- **[AUTO-eae9dc] Möjlig feltolkning av röst (avbruten): "Kan du notera i devläget att jag inte tycker om den stora röda strömmar?"** (röst, automatiskt loggad, 1×, senast 2026-11-09T16:22)
- **[AUTO-e4cd61] Möjlig feltolkning av röst (avbruten): "you"** (röst, automatiskt loggad, 1×, senast 2026-11-09T17:51)
- **[BUG-82a49d] Röstsvar på xr_ask listen:true uteblev: panelen stängdes utan svar** (röst, 1×, senast 2026-11-09T17:51)
  - Användaren frågade hur man svarar med rösten, jag startade xr_ask listen:true, och resultatet blev "User closed the panel without answering" (samma som för xr_test tidigare); oklart om användaren hittade mikrofonknappen eller stängde panelen avsiktligt.
- **[AUTO-9b53ff] Möjlig feltolkning av röst (avbruten): "then"** (röst, automatiskt loggad, 1×, senast 2026-11-09T18:15)
- **[AUTO-735ab9] Möjlig feltolkning av röst (avbruten): "Den handlar ganska långt ifrån mig på ett behagligt avstånd, men den skimmdes av datorn."** (röst, automatiskt loggad, 1×, senast 2026-11-09T18:15)
- **[BUG-1fcf21] Flera paneler hamnar ovanpå varandra** (skills/presentation, 2×, senast 2026-11-09T17:50)
  - När flera paneler öppnas samtidigt (jämförelser, presentationer) läggs de ovanpå varandra och användaren måste flytta dem manuellt.
- **[BUG-0863a3] Dashboard-panelen för låg för sitt innehåll (måste scrolla) och hamnar fel vid öppning** (skills/presentation, 1×, senast 2026-11-09T17:55)
  - Användaren (talat svar): "De syns bra", men dashboardpanelen är för låg jämfört med innehållet så det krävs scroll, öppnades inte där användaren ville ha den och överlappade med något (meningen avbröts); samtidigt levererades rösten som text via xr_ask, så rösten fungerade denna gång.

## Förbättringsidéer

- **[IDE-eb82dd] Visa på Macen/headsetet varför [ask]-fönster inte kan strömmas** (okänd, prioritet hög): Användaren visste inte var godkännandet skulle ges; en tydlig dialog eller felrad vid window-ström av [ask]-fönster sparar mycket tid.
- **[IDE-a183c2] Ny röstpanel nära huvudet: peka för att tala, släpp för att skicka** (okänd, prioritet hög): Mikrofonikonen öppnar en stor tryckbar panel mycket nära användarens huvud (inom fingerräckvidd); håll in med fingret för att tala och släpp för att skicka direkt till chatten.
- **[IDE-8b8b8d] Macens skärm strömmas alltid, förankrad över den fysiska skärmen** (okänd, prioritet hög): Display-strömmen ska alltid vara aktiv och ligga ovanpå Macens fysiska skärm, och får aldrig ersättas eller stoppas när en Claude-chatt öppnar en app-/fönsterpanel (t.ex. Notion).
- **[IDE-5221ff] Närvaroläge: Claude vid skrivbordet (kamera, röst, spara)** (quest-app, prioritet hög): Nytt läge där användaren frågar om det hen ser via passthrough-kameran och får svar med röst/paneler, kan spara bilder på rätt plats, och använder claude -p på Pro-plan med nivåer (lokalt, haiku, sonnet, session). Handflateknapp som utlösare. Full plan: Meta XR/plan/narvarolage-plan-utkast-v1.md (etapp 1-5, leveranskrav, testchecklista). Nästa session bygger allt; kameran (etapp 1) avgörs först.
- **[IDE-ff427a] Komfort som krav: pauser, avstånd, trötthetslogg** (skills/presentation, prioritet hög): Användaren blir trött under 20 min (huvudvärk, torra ögon, suddig/dubbel syn, illamående). Appen ska ha: stilla paneler på 1,0-2,0 m (aldrig närmare än 0,5 m, röstpanelen på 0,4 m ersätts), högst 2-3 paneler, komfortguide vid första start, Vila-knapp, pauspåminnelser, 'mår dåligt'-nödutgång till passthrough, trötthetslogg ('trött 3'), valfritt komfortläge utan spegling. Evidens svag; siffror ska justeras efter användarens testning. Se avsnitt 7 i planen.
- **[IDE-58a72d] Interaktiva fönsterpaneler: peka och klicka i strömmat fönster** (okänd, prioritet hög): Idag är fönsterströmmar bara visning; användaren vill flytta muspekaren till t.ex. Spotify i headsetet och styra fönstret direkt för att multitaska.
- **[IDE-8e4736] Macens ljud i headsetet, sömlöst (kravlista i bugs/IDE-ljud-i-headsetet-krav.md)** (okänd, prioritet hög): Spotify och annat Mac-ljud ska spelas i headsetet med tyst Mac, synk, ducking vid tal och volymstyrning; delar ljudväg med Claudes uppläsning.
- **[IDE-11c7f5] HÖG PRIO nästa runda: paneler = flera skärmar, pekare hoppar mellan dem och full interaktion (bugs/IDE-paneler-som-flera-skarmar-krav.md)** (okänd, prioritet hög): Varje panel ska vara en riktig skärm: pekaren följer riktningen i rummet, hoppar in i panelen och användaren kan klicka, skriva och dra i den; ersätter IDE-58a72d, kräver flera samtidiga strömmar.
- **[IDE-af1e76] Knapp "Stäng alla paneler utom Macens skärm" i headsetet** (okänd, prioritet hög): Idag stänger "close all" och rösten "stäng alla paneler" även Macens skärm; användaren vill ha en knapp (och röstkommando) som lämnar kvar Macens skärm och stänger allt annat, inklusive fönsterströmmar och automatiska diff- och ändringspaneler.
- **[IDE-e587a1] Bioskärm-förinställning och återställ-placering för Macens skärm** (okänd, prioritet hög): Användaren vill kunna säga "bioskärm" eller "återställ" och få Macens skärm stor, rakt framför och på skonsamt avstånd för ögonen, utan att jag gissar enheter; bör finnas som förinställning med några storlekssteg (större, längre bort).
- **[IDE-097b42] Ljud spelas i headsetet från webbpanel (WebAudio); möjlig snabb väg för Mac-ljud och uppläsning** (okänd, prioritet hög): Test 2026-11-09: en xr_show url-panel med knapp som spelar en WebAudio-ton hördes i headsetet, så en ljudväg bryggan till headset finns i webbpaneler; utvecklaren kan pröva att strömma Opus/WebRTC-ljud dit innan en egen ljudväg i Quest-appen byggs.
- **[IDE-d3aaa2] xr_panel close all / stäng strömpanel med stream-id** (okänd, prioritet medel): "Stäng alla" gav Not found; ett verktygsstöd för att stänga alla paneler inklusive strömmar behövs.
- **[IDE-8015ff] Dimma den fysiska skärmen till ljusstyrka 0 under strömning** (okänd, prioritet medel): När Macens skärm strömmas till headsetet sätts den fysiska skärmens ljusstyrka till 0; ursprungsvärdet måste återställas när strömmen stoppas, anslutningen bryts eller bryggan kraschar.
- **[IDE-e6a156] Statusrad för ström och mikrofon** (okänd, prioritet medel): Alltid synlig rad som visar vad som strömmas och om mikrofonen lyssnar.
- **[IDE-e3d61e] Förhandsgranska röst innan sändning** (okänd, prioritet medel): Visa uppfattad text med skicka/avbryt innan den går till chatten; löser även kollisionen med "jag hörde"-fönstret.
- **[IDE-592a18] Strömindikatorn över Mac-skärmen är för stor och röd** (spegling, prioritet medel): Statusbaren som visar att skärmen strömmas är stor och röd och tar för mycket uppmärksamhet. Något ska fortfarande indikera att det strömmar, men det ska vara väldigt minimalistiskt (liten, diskret, dämpad färg).
- **[IDE-38fba9] Statusbar i vänster handflata** (quest-app, prioritet medel): Flytta statusbaren (centrera, kalibrera skärmen, justera, visa status) till användarens vänstra handflata, synlig när hen tittar på den.
- **[IDE-ff2330] Dokumentera att xr_panel move är ett absolut avstånd i meter framför användaren (inte en förflyttning)** (okänd, prioritet medel): Test 2026-11-09: forward 0,5 gav en panel "jätte nära", forward 1,5 gav "ganska långt ifrån mig, behagligt avstånd", vilket stämmer med absolut position i meter; size-enheten är fortfarande okänd, och Macens skärm bör inte flyttas med move förrän det är klarlagt (BUG-83fe52).
- **[IDE-5665f8] iPhone Mirroring är inte tillgängligt i Sverige: en annan väg behövs för skarp iPhone-skärm i headsetet** (okänd, prioritet medel): Test 2026-11-09: macOS visade "iPhone Mirroring is not available in your country or region", så iPhone-skärmen kan inte strömmas som panel via den vägen; alternativ att utvärdera är AirPlay/QuickTime-inspelning av iPhone via USB som fönster på Macen som sedan strömmas, utan krav på överlägg på den fysiska telefonen.
- **[IDE-8fc855] Trådat läge: bryggan och headsetet över USB-C (adb reverse) för stabilitet, lägre fördröjning och högre bandbredd** (okänd, prioritet medel): ägaren arbetar stillasittande och har kabel; kan minska tappade anslutningar och ge skarpare ström och jämnare ljud, men löser inte panelplacering eller röstfel; mät först svarstid och tappade anslutningar över adb reverse mot Wi-Fi.
- **[IDE-a56e94] Mätning: USB-kabel ger mycket jämnare svarstid och ca 285 Mbit/s; Wi-Fi 10 ms i snitt men 4-31 ms spridning** (okänd, prioritet medel): Quest 3 via adb: Wi-Fi ping medel 10,2 ms (max 30,6), kabelanrop 17-21 ms inkl. skalstart, kabel push 36 MB/s utan komprimering; stöder trådat läge för stabilitet och bandbredd, men absolut fördröjning över kabel är inte bevisat lägre och appen över adb reverse är inte mätt.
- **[IDE-743d85] Ljud och vibration vid mikrofonstart/-stopp** (okänd, prioritet låg): Signal när mikrofonen börjar och slutar lyssna så användaren vet att knappen registrerades.
