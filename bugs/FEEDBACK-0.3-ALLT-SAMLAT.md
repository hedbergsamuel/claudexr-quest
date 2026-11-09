# ClaudeXR 0.3.x: ALL FEEDBACK SAMLAD PÅ ETT STÄLLE

Skapad 2026-11-09 på ägarens uttryckliga begäran: "se till att ALL FEEDBACK från den här versionen finns på ett enda ställe". Gäller bryggan 0.3.1, Mac-hjälparen 0.3.1 och Quest-appen 0.3.0.

**Läs den här filen först.** Den är den enda filen nästa utvecklare behöver för feedbacken. Allt nedan är antingen skrivet i filen eller bifogat i sin helhet i bilagorna. Äldre överlämningar i `bugs/` (`handoff-*.md`) och `reports.jsonl` är råmaterial och ska inte ändras. Planen `plan/narvarolage-plan-utkast-v1.md` hänvisar hit (avsnitt 13).

## 0. Läsregler
- "Provat" betyder att ägaren eller Claude gjorde det i headsetet/Macen 2026-11-09. Allt annat är antaganden och markeras som sådana.
- Talade svar från ägaren är transkriberade av Whisper och kan vara felhörda. De återges som sammanfattning, inte ord för ord.
- ägaren vill att utvecklaren **inte bygger något halvbra**. Där tekniken inte räcker står det uttryckligen (se avsnitt 4).

## 1. Prioriterad lista: vad som ska göras först (ägarens prioritet)
1. **Flera samtidiga fönsterströmmar** (BUG-2e4ecb, BUG-2153ff, BUG-9e3e1b, BUG-552260). Förutsättning för allt nedan. Roll-hypotesen är motbevisad: en ny fönsterström ersätter den förra även med olika roller.
2. **Paneler som riktiga skärmar** med pekare som följer riktningen i rummet och full interaktion (IDE-11c7f5, bilaga 2). Hög prioritet nästa runda, uttryckligen "ta begränsningen om visning på allvar".
3. **Panelplacering**: nya paneler hamnar rakt fram och skymda av Macens skärm, frågekortet ligger bakom eller under panelen det gäller, flera paneler hamnar ovanpå varandra (BUG-1fcf21, BUG-3115b5, BUG-4a4024, BUG-068994, BUG-405388, BUG-0863a3).
4. **Röst**: meddelanden utanför en öppen fråga köas tills ägaren skriver manuellt och blir felhörda (BUG-6b9a81, "det måste åtgärdas"), röstpanelen svarar inte på tryck och går inte att stänga (BUG-8324e4), uteblivna svar (BUG-82a49d, BUG-36fba1).
5. **Macens skärm blir svart** när Macen somnar under dimning (BUG-13e417); strömmen försvinner (BUG-7cf1b6).
6. **Ljud från hela Macen i headsetet** (IDE-8e4736, bilaga 1). Ljudväg finns i webbpaneler (IDE-097b42).
7. **Bioskärm/placering** (IDE-e587a1, BUG-83fe52, IDE-ff2330) och **knapp för "stäng allt utom Macens skärm"** (IDE-af1e76).
8. Resten: närvaroläget enligt planen (etapp 1–5), kalibrering (BUG-cc393a), panel-id (BUG-39391d).

## 2. Provat 2026-11-09: resultat

### Fungerar
- **Live-sida (`xr_show url`)**: tryck fungerar "jättebra", knappen räknade sömlöst. Tryckinteraktion fungerar alltså i vanliga webbpaneler.
- **Val med tryck (`xr_ask`)**: fungerar, inklusive A/B med url (ägaren valde A).
- **Talat svar på en öppen fråga**: kommer fram som text (flera gånger), med viss felhörning.
- **Grafikinnehåll**: dashboard och diff beskrevs som "väldigt tydligt och bra".
- **Ljud i headsetet från en webbpanel (WebAudio-ton)**: hördes i headsetet.
- **Rollerna `log` (snett vänster), `side` (snett höger, men inkonsekvent), `compare`**: synliga och på avsedd plats.
- **`xr_panel move` är ett absolut avstånd i meter framför användaren**: 0,5 gav "jätte nära", 1,5 gav "behagligt avstånd" (IDE-ff2330). Enheten för `size` är **inte** klarlagd.

### Fungerar inte
- Se avsnitt 1 och tabellerna B–D.

### Inte provat (öppna luckor, ingen gissning)
- `xr_test` med det inbyggda formuläret (avslutades utan svar, kan bero på att formuläret låg dolt).
- Grafikmallarna `comparison`, `timeline`, `flow`, `slides`, `choice-cards`, `kpi` bortom storlek `small`.
- Flera fönsterströmmar med Notion + Spotify samtidigt utöver det som listas i BUG-2e4ecb/BUG-2153ff.
- Återanslutning efter att headsetet tagits av (anslutningen har tappats 24 gånger, AUTO-382020).
- Kamera/passthrough (planens etapp 1), handflateknapp, Whisper-noggrannhet i skarpt läge.
- `size`-enheten för `xr_panel update`.

## 3. ägarens önskemål (kravlista, sammanfattat från ägarens egna ord)
1. **Paneler = flera skärmar.** När en panel öppnas ska det fungera som flera skärmar. Muspekaren ska följa riktningen så som den upplevs i glasögonen, hoppa in i panelen, och ägaren ska kunna interagera med allt där. Gäller alla speglade fönster, inklusive Macens egen skärm. (Bilaga 2)
2. **Allt ljud från Macen i headsetet**, inte bara Spotify: musik, video, webb, samtal, notiser och Claudes röst. Sömlöst: Macen tyst medan headsetet bär ljudet, återställs vid avtagning/krasch, ducking vid tal, volymstyrning i headsetet. (Bilaga 1)
3. **Bioskärm**: Macens skärm stor, rakt fram, på skonsamt avstånd. ägaren vill ha en förinställning ("bioskärm", "större", "längre bort", "återställ") så att ingen behöver gissa enheter (IDE-e587a1).
4. **Knapp "stäng alla paneler utom Macens skärm"**, även som röstkommando. Idag stänger "close all" och "stäng alla paneler" även Macens skärm (IDE-af1e76).
5. **Paneler ska aldrig hamna ovanpå varandra eller bakom Macens skärm.** Frågekortet ska alltid vara överst och nåbart. ägaren får idag flytta paneler manuellt för att kunna svara.
6. **Röst ska levereras direkt**, inte "med nästa prompt". Transkriberingen måste klara vanlig svenska.
7. **Stabila id:n för paneler** så att knappar och funktioner kan peka ut Macens skärm (BUG-39391d).
8. **Sparad plan: närvaroläget** (etapp 0–5 i planen) ska fortfarande byggas, med ovanstående som förutsättningar.

## 4. Beslut och förhållningssätt (ägaren, 2026-11-09)
- **iPhone-skärmen i headsetet:** ägaren vill att iPhonen känns igen och får en skarp digital skärm ovanpå (passthrough är suddig). **Bedömning: går inte att göra bra nu**, och utvecklaren ska **inte** bygga ett halvbra överlägg. Skäl: telefonen rör sig i handen, handen skymmer, överlägget skulle släpa, och iOS saknar öppen skärmfångst. Inget färdigt för iPhone hittades (MyPhone och Quest Phone Monitor är för Android och spårar ingen telefon). Meta Passthrough Camera API finns, men inget exempel för telefonskärmar, och mobiler kan feltolkas som fjärrkontroller. **iPhone Mirroring är inte tillgängligt i Sverige** ("not available in your country or region", provat). Alternativ att utvärdera: USB/QuickTime-fönster på Macen som strömmas. (IDE-5665f8)
- **Testning:** ägaren vill bara ha tester som har ett tydligt syfte och som kompletterar underlag för att fixa fel eller bygga nya funktioner. Inga tester av sådant som redan har underlag.
- **Inget får skrivas över** i `bugs/` eller planen utan säkerhetskopia. Alla exporter ska bli nya filer.
- **Dev-mode:** buggar och idéer loggas automatiskt i `bugs/reports.jsonl`.
- **XR-hooken:** ägaren bad den 2026-11-09 att XR-hooken stängs av efter sessionen (flaggan `~/.claudexr/on`). Jag fick inte åtkomst till den filen, så ägaren gör det själv: `mv ~/.claudexr/on ~/.claudexr/on.av` (ångra: motsatsen).
- **Språk:** svenska.

## 5. Rutiner som visade sig behövas (att åtgärda eller dokumentera)
- `xr_panel move` är absolut meter framför användaren; `size`-enhet okänd. Dokumentera (IDE-ff2330).
- Panel-id och stream-id byts vid varje omstart av strömmen; ett gammalt id ger "Not found" (BUG-39391d).
- Macen somnar under dimning och strömmen försvinner ("no display"). Tillfällig lösning som fungerade: `caffeinate -u` väcker skärmen, `caffeinate -d` håller den vaken. Bryggan bör göra detta själv (BUG-13e417).
- `xr_stream window` ersätter tidigare fönsterström trots dokumentationen (max 4). `[ask]`-fönster kräver ett tryck på godkännandekortet.

## 6. Alla loggposter (fullständig lista från `reports.jsonl`, 60 poster, 2026-11-09)
Posterna är grupperade efter typ. "Antal" är hur många gånger samma sak har rapporterats. Detaljer (beskrivning, förväntat beteende, steg) finns i `bugs/handoff-2026-11-09T18-17-16.md` och i `bugs/reports.jsonl`.

### B. Buggar (manuellt loggade)

| ID | Komponent | Allvar/prio | Antal | Rubrik |
|---|---|---|---|---|
| BUG-552260 | spegling | hög | 1 | Fönsterström (Notion) visas blank trots "Streaming" |
| BUG-e459f3 | brygga | medel | 1 | Strömpaneler saknas i xr_panel list och kan inte stängas |
| BUG-9e3e1b | spegling | medel | 1 | Display-ström försvinner när en fönsterström startas |
| BUG-36fba1 | röst | hög | 1 | Röstläge: tryck-och-tala ger ingen respons, kolliderar med "jag hörde"-fönstret |
| BUG-e1fc54 | quest-app | hög | 1 | Kvarlämnad tom panel till vänster om användaren kan inte tas bort |
| BUG-1fcf21 | skills/presentation | medel | 2 | Flera paneler hamnar ovanpå varandra |
| BUG-2a0790 | spegling | medel | 1 | Panelen "Claude arbetar" distraherar |
| BUG-7cf1b6 | hooks | hög | 1 | Claude stängde Macens skärmspegling |
| BUG-2e4ecb | spegling | hög | 1 | Ny fönsterström ersätter föregående fönsterström |
| BUG-83fe52 | brygga | hög | 1 | xr_panel update move/size gör Macens skärm pyttelite och långt bort; layout present och role primary återställer inte |
| BUG-39391d | brygga | medel | 1 | Panel-id byts varje gång strömmen startar om, så panelen kan inte pekas ut med ett fast id |
| BUG-3115b5 | quest-app | hög | 1 | Nya paneler med roll primary placeras långt åt höger och ovanpå varandra; xr_test-panelen besvarades inte |
| BUG-82a49d | röst | medel | 1 | Röstsvar på xr_ask listen:true uteblev: panelen stängdes utan svar |
| BUG-8324e4 | quest-app | hög | 1 | Röstpanelen (xr_ask listen:true) reagerar inte på tryck och går inte att stänga |
| BUG-0863a3 | skills/presentation | medel | 1 | Dashboard-panelen för låg för sitt innehåll (måste scrolla) och hamnar fel vid öppning |
| BUG-4a4024 | quest-app | hög | 1 | Nya paneler öppnas bakom Macens skärm; frågekortet täcker panelen den gäller |
| BUG-068994 | quest-app | hög | 1 | Roll side ger ingen ny placering: panelen hamnar rakt fram, skymd av Macens skärm |
| BUG-cc393a | spegling | medel | 1 | xr_stream calibrate ger timeout |
| BUG-13e417 | spegling | hög | 1 | Macens skärm blir svart: displaypanelen försvann och skärmen somnade medan dimning var aktiv |
| BUG-6b9a81 | röst | hög | 1 | Röstmeddelande utanför öppen fråga skickas inte direkt: "skickas med nästa prompt", användaren måste skriva manuellt |
| BUG-405388 | quest-app | hög | 1 | Placering per roll: overlay för stor och skymmer tangentbordet; frågekortet hamnar bakom eller ovanpå panelen |
| BUG-2153ff | spegling | hög | 1 | Ny fönsterström ersätter föregående fönsterström även när rollerna skiljer sig (roll är inte orsaken) |

### C. Idéer och önskemål (manuellt loggade)

| ID | Komponent | Allvar/prio | Antal | Rubrik |
|---|---|---|---|---|
| IDE-eb82dd | okänd |  | 1 | Visa på Macen/headsetet varför [ask]-fönster inte kan strömmas |
| IDE-d3aaa2 | okänd |  | 1 | xr_panel close all / stäng strömpanel med stream-id |
| IDE-a183c2 | okänd |  | 1 | Ny röstpanel nära huvudet: peka för att tala, släpp för att skicka |
| IDE-8b8b8d | okänd |  | 1 | Macens skärm strömmas alltid, förankrad över den fysiska skärmen |
| IDE-8015ff | okänd |  | 1 | Dimma den fysiska skärmen till ljusstyrka 0 under strömning |
| IDE-e6a156 | okänd |  | 1 | Statusrad för ström och mikrofon |
| IDE-e3d61e | okänd |  | 1 | Förhandsgranska röst innan sändning |
| IDE-743d85 | okänd |  | 1 | Ljud och vibration vid mikrofonstart/-stopp |
| IDE-592a18 | spegling |  | 1 | Strömindikatorn över Mac-skärmen är för stor och röd |
| IDE-38fba9 | quest-app |  | 1 | Statusbar i vänster handflata |
| IDE-5221ff | quest-app |  | 1 | Närvaroläge: Claude vid skrivbordet (kamera, röst, spara) |
| IDE-ff427a | skills/presentation |  | 1 | Komfort som krav: pauser, avstånd, trötthetslogg |
| IDE-58a72d | okänd |  | 1 | Interaktiva fönsterpaneler: peka och klicka i strömmat fönster |
| IDE-8e4736 | okänd |  | 1 | Macens ljud i headsetet, sömlöst (kravlista i bugs/IDE-ljud-i-headsetet-krav.md) |
| IDE-11c7f5 | okänd |  | 1 | HÖG PRIO nästa runda: paneler = flera skärmar, pekare hoppar mellan dem och full interaktion (bugs/IDE-paneler-som-flera-skarmar-krav.md) |
| IDE-af1e76 | okänd |  | 1 | Knapp "Stäng alla paneler utom Macens skärm" i headsetet |
| IDE-e587a1 | okänd |  | 1 | Bioskärm-förinställning och återställ-placering för Macens skärm |
| IDE-097b42 | okänd |  | 1 | Ljud spelas i headsetet från webbpanel (WebAudio); möjlig snabb väg för Mac-ljud och uppläsning |
| IDE-ff2330 | okänd |  | 1 | Dokumentera att xr_panel move är ett absolut avstånd i meter framför användaren (inte en förflyttning) |
| IDE-5665f8 | okänd |  | 1 | iPhone Mirroring är inte tillgängligt i Sverige: en annan väg behövs för skarp iPhone-skärm i headsetet |

### D. Automatiskt loggade händelser (bryggan)

| ID | Komponent | Allvar/prio | Antal | Rubrik |
|---|---|---|---|---|
| AUTO-1b37d0 | spegling | medel | 1 | [spegling] helper error: Error Domain=com.apple.ScreenCaptureKit.SCStreamErrorDomain Code=-3801 "The user declined TCCs for application, window, display capture |
| AUTO-12648a | spegling | medel | 9 | [spegling] helper error: Error Domain=com.apple.ScreenCaptureKit.SCStreamErrorDomain Code=-3805 "Failed during stream due to application connection being interr |
| AUTO-382020 | brygga | medel | 24 | [brygga] Anslutningen till headsetet bröts (kod 1006) |
| AUTO-283d15 | spegling | medel | 4 | [spegling] screen calibration failed: camera_disconnected |
| AUTO-dcd040 | spegling | medel | 4 | [spegling] screen calibration failed: timeout |
| AUTO-eae9dc | röst | medel | 1 | Möjlig feltolkning av röst (avbruten): "Kan du notera i devläget att jag inte tycker om den stora röda strömmar?" |
| AUTO-7e72ed | brygga | medel | 1 | Verktygsfel xr_stream: MCP error -32602: Input validation error: Invalid arguments for tool xr_stream: Invalid enum value. Expected 'windows' / 'window' / 'disp |
| AUTO-61dab8 | spegling | medel | 1 | [spegling] screen calibration failed: marker_not_found |
| AUTO-30e7ab | brygga | medel | 1 | Verktygsfel xr_panel: Not found: d6c25f42 |
| AUTO-e4cd61 | röst | medel | 1 | Möjlig feltolkning av röst (avbruten): "you" |
| AUTO-312c3f | brygga | medel | 1 | Verktygsfel xr_stream: Error: timeout |
| AUTO-fe2ae1 | spegling | medel | 2 | [spegling] helper error: Error Domain=com.apple.ScreenCaptureKit.SCStreamErrorDomain Code=-3815 "Failed to find any displays or windows to capture" UserInfo={NS |
| AUTO-5b8f9e | brygga | medel | 2 | [brightness] could not restore brightness to 0.56; will retry (file /Users/<användare>/.claudexr/brightness-saved.json) |
| AUTO-8a0c24 | spegling | medel | 2 | [spegling] helper error: Error Domain=claudexr Code=2 "no display" UserInfo={NSLocalizedDescription=no display} |
| AUTO-74da89 | spegling | medel | 2 | [spegling] display stream could not start (1): Error Domain=claudexr Code=2 "no display" UserInfo={NSLocalizedDescription=no display} |
| AUTO-0641ca | brygga | medel | 1 | Verktygsfel xr_stream: Error: Error Domain=claudexr Code=2 "no display" UserInfo={NSLocalizedDescription=no display} |
| AUTO-9b53ff | röst | medel | 1 | Möjlig feltolkning av röst (avbruten): "then" |
| AUTO-735ab9 | röst | medel | 1 | Möjlig feltolkning av röst (avbruten): "Den handlar ganska långt ifrån mig på ett behagligt avstånd, men den skimmdes av datorn." |

## 7. Detaljer per post (buggar och idéer)

### BUG-552260: Fönsterström (Notion) visas blank trots "Streaming"
- Komponent: spegling · allvar/prio: hög · antal: 1 · loggad: 2026-11-09T11:45:16.741Z
- Beskrivning: xr_stream window 178 svarar "Streaming" men panelen är tom; fönstret står kvar som [ask] även efter att macOS-rättigheter getts.
- Förväntat: Notion-fönstret visas skarpt, eller ett tydligt felmeddelande/begäran om godkännande.
- Steg: xr_stream windows (Notion [ask]) → xr_stream window 178 → Panelen visas svart/blank i headsetet

### BUG-e459f3: Strömpaneler saknas i xr_panel list och kan inte stängas
- Komponent: brygga · allvar/prio: medel · antal: 1 · loggad: 2026-11-09T11:45:16.776Z
- Beskrivning: Gamla/tomma strömpaneler ligger kvar i rummet men list visar 0 paneler och close på panel-id ger "Not found"; stop ger "Stopped 0".
- Förväntat: Strömpaneler listas och går att stänga; omstart ersätter den gamla panelen.
- Steg: Starta xr_stream display flera gånger → xr_panel list visar 0 paneler → xr_panel close id:<panel-id> ger Not found

### BUG-9e3e1b: Display-ström försvinner när en fönsterström startas
- Komponent: spegling · allvar/prio: medel · antal: 1 · loggad: 2026-11-09T11:45:16.798Z
- Beskrivning: Hela skärmen försvann ur headsetet efter att en fönsterström startats; osäkert om bara en ström tillåts åt gången.
- Förväntat: Flera strömmar kan vara aktiva, eller ett tydligt besked om begränsningen.

### BUG-36fba1: Röstläge: tryck-och-tala ger ingen respons, kolliderar med "jag hörde"-fönstret
- Komponent: röst · allvar/prio: hög · antal: 1 · loggad: 2026-11-09T11:48:59.922Z
- Beskrivning: Användaren höll in mikrofonknappen, talade och släppte utan att något skickades till chatten; vid andra försöket kolliderade det med bekräftelsefönstret "jag hörde detta" och inget fungerade.
- Förväntat: Talad text skickas till chatten vid släpp, utan överlappande fönster.
- Steg: Håll in mikrofonknappen och tala → Släpp knappen: inget händer → Försök igen: bekräftelsefönstret 'jag hörde detta' överlappar/kolliderar

### BUG-e1fc54: Kvarlämnad tom panel till vänster om användaren kan inte tas bort
- Komponent: quest-app · allvar/prio: hög · antal: 1 · loggad: 2026-11-09T11:49:44.891Z
- Beskrivning: En vilande/tom panel ligger kvar till vänster om användaren efter omstartade strömmar och går varken att stänga via xr_panel eller att hitta i list.
- Förväntat: Alla paneler, även strömpaneler, listas och går att stänga; inga föräldralösa paneler kvarstår.

### BUG-1fcf21: Flera paneler hamnar ovanpå varandra
- Komponent: skills/presentation · allvar/prio: medel · antal: 2 · loggad: 2026-11-09T16:27:27.168Z
- Beskrivning: När flera paneler öppnas samtidigt (jämförelser, presentationer) läggs de ovanpå varandra och användaren måste flytta dem manuellt.
- Förväntat: Claude ska själv räkna ut var varje panel placeras så att de inte överlappar.

### BUG-2a0790: Panelen "Claude arbetar" distraherar
- Komponent: spegling · allvar/prio: medel · antal: 1 · loggad: 2026-11-09T16:29:20.243Z
- Beskrivning: När Claude arbetar öppnas alltid en flik/panel till vänster om användaren med texten "Claude arbetar" som visar terminalkommandon som körs. Användaren tycker den är väldigt onödig och distraherande.
- Förväntat: Ingen automatisk terminalpanel, eller en diskret/valfri sådan som går att stänga av.

### BUG-7cf1b6: Claude stängde Macens skärmspegling
- Komponent: hooks · allvar/prio: hög · antal: 1 · loggad: 2026-11-09T16:38:49.740Z
- Beskrivning: Hooken flaggade panelen "Macens skärm" som stale och Claude stängde den med xr_panel close, utan att fråga. Skärmen ska alltid speglas när användaren jobbar.
- Förväntat: Skärmspeglingen får aldrig stängas av Claude. Hooken ska inte kalla en live display-stream för stale, och Claude ska aldrig stänga den utan uttrycklig begäran.

### BUG-2e4ecb: Ny fönsterström ersätter föregående fönsterström
- Komponent: spegling · allvar/prio: hög · antal: 1 · loggad: 2026-11-09T17:30:41.594Z
- Beskrivning: Dokumentationen säger att fönsterströmmar läggs till (max 4), men när en andra xr_stream window startas stängs den första (Notion försvinner när Spotify öppnas och tvärtom). Display-strömmen får också nytt id varje gång. Båda hamnar i rollen side.
- Förväntat: Notion och Spotify visas samtidigt som två separata paneler.
- Steg: xr_stream window 178 (Notion) → xr_stream window 40 (Spotify) → xr_panel list: bara Spotify kvar

### BUG-83fe52: xr_panel update move/size gör Macens skärm pyttelite och långt bort; layout present och role primary återställer inte
- Komponent: brygga · allvar/prio: hög · antal: 1 · loggad: 2026-11-09T17:46:01.553Z
- Beskrivning: Anrop move {right:0,up:0,forward:2.5} och size {w:3.2,h:1.8} på displaypanelen skickade den "jättelångt bort" och osynlig; enheter för move/size är odokumenterade (förflyttning eller absolut? meter eller annat?), och efteråt rättade varken layout:present eller role:primary placeringen.
- Förväntat: Panelen hamnar som en bioskärm rakt framför användaren på behagligt avstånd, och det finns ett sätt att återställa standardplacering.
- Steg: xr_panel update id:<displaypanel> move {right:0,up:0,forward:2.5} size {w:3.2,h:1.8} → xr_panel layout mode:present → xr_panel update id:<displaypanel> role:primary → Användaren ser fortfarande panelen pyttelite och långt bort

### BUG-39391d: Panel-id byts varje gång strömmen startar om, så panelen kan inte pekas ut med ett fast id
- Komponent: brygga · allvar/prio: medel · antal: 1 · loggad: 2026-11-09T17:46:01.619Z
- Beskrivning: Macens skärm fick nytt panel-id och stream-id vid varje omstart av strömmen (t.ex. d6c25f42, 0b54b69d, 1a2f7eff, f052a8ec); ett xr_panel update med det gamla id:t gav "Not found", vilket drabbar knappar och funktioner som behöver peka ut en panel.
- Förväntat: Displaypanelen har ett stabilt id eller kan nås via roll (t.ex. "display"), även efter att strömmen startats om.
- Steg: xr_panel list: notera id för Macens skärm → Starta en fönsterström så displaystrommen startar om → xr_panel update med det gamla id:t ger Not found

### BUG-3115b5: Nya paneler med roll primary placeras långt åt höger och ovanpå varandra; xr_test-panelen besvarades inte
- Komponent: quest-app · allvar/prio: hög · antal: 1 · loggad: 2026-11-09T17:50:52.437Z
- Beskrivning: Testpaneler (4 xr_present + live-sida) hamnade långt till höger staplade, layout review och tidy rättade inte till det; xr_test "Grafik och live-sida" avslutades med "User closed the panel without answering" (kan bero på att panelen låg under de andra).
- Förväntat: Varje ny panel får egen plats i synfältet, rakt fram eller bredvid, och en fråga (xr_test/xr_ask) hamnar överst så den går att besvara.
- Steg: Visa 4 xr_present och 1 xr_show url utan role → xr_panel layout mode:review → Panelerna ligger kvar långt till höger över varandra

### BUG-82a49d: Röstsvar på xr_ask listen:true uteblev: panelen stängdes utan svar
- Komponent: röst · allvar/prio: medel · antal: 1 · loggad: 2026-11-09T17:51:59.513Z
- Beskrivning: Användaren frågade hur man svarar med rösten, jag startade xr_ask listen:true, och resultatet blev "User closed the panel without answering" (samma som för xr_test tidigare); oklart om användaren hittade mikrofonknappen eller stängde panelen avsiktligt.
- Förväntat: Det framgår i headsetet hur man talar (knappens plats), och talat svar levereras som text.
- Steg: xr_ask q:... listen:true timeout:110 → Användaren håller in mikrofonknappen och talar → Resultat: User closed the panel without answering

### BUG-8324e4: Röstpanelen (xr_ask listen:true) reagerar inte på tryck och går inte att stänga
- Komponent: quest-app · allvar/prio: hög · antal: 1 · loggad: 2026-11-09T17:52:59.440Z
- Beskrivning: Användaren trycker i röstpanelen utan reaktion; bryggans panellista visar den inte (bara Macens skärm och live-sidan), så den kan inte stängas via xr_panel. Samtidigt fungerar live-sidan (xr_show url) med tryck "jättebra".
- Förväntat: Röstpanelen har en synlig tryck- eller hålla-in-yta som svarar, en stäng-knapp, och finns i xr_panel list så den kan stängas.
- Steg: xr_ask listen:true → Tryck på röstpanelen i headsetet: ingen reaktion → xr_panel list: panelen saknas

### BUG-0863a3: Dashboard-panelen för låg för sitt innehåll (måste scrolla) och hamnar fel vid öppning
- Komponent: skills/presentation · allvar/prio: medel · antal: 1 · loggad: 2026-11-09T17:55:14.463Z
- Beskrivning: Användaren (talat svar): "De syns bra", men dashboardpanelen är för låg jämfört med innehållet så det krävs scroll, öppnades inte där användaren ville ha den och överlappade med något (meningen avbröts); samtidigt levererades rösten som text via xr_ask, så rösten fungerade denna gång.
- Förväntat: Panelhöjden anpassas efter mallens innehåll utan scroll, och nya paneler öppnas fritt från andra.
- Steg: xr_present template:dashboard med 2 kpi och 1 stapeldiagram → xr_ask Test 1 → Användaren svarar muntligt och beskriver scroll och fel placering

### BUG-4a4024: Nya paneler öppnas bakom Macens skärm; frågekortet täcker panelen den gäller
- Komponent: quest-app · allvar/prio: hög · antal: 1 · loggad: 2026-11-09T17:56:48.770Z
- Beskrivning: Talat svar (kan vara felhört): nya paneler hamnar bakom/skymda av Macens skärm så användaren alltid måste flytta upp dem, xr_ask-formuläret överlappar tabellen den frågar om, och en röstruta öppnas när användaren trycker till svar.
- Förväntat: Nya paneler öppnas framför Macens skärm (djup och höjd), och frågekortet placeras separat från innehållet det frågar om.
- Steg: Ha Macens skärm streamad som overlay → xr_present table size:large → xr_ask Test 3: tabellen skymd, formuläret ovanpå tabellen

### BUG-068994: Roll side ger ingen ny placering: panelen hamnar rakt fram, skymd av Macens skärm
- Komponent: quest-app · allvar/prio: hög · antal: 1 · loggad: 2026-11-09T17:57:47.048Z
- Beskrivning: Diff-panelen med role side dök upp rakt framför användaren, skymd av datorskärmen, och frågeformuläret låg ovanpå; innehållet var däremot "väldigt tydligt och bra".
- Förväntat: role side placeras snett höger som dokumentationen säger, och frågekortet ligger separat.
- Steg: xr_present template:diff role:side size:large → xr_ask → Panelen rakt fram och skymd av Macens skärm

### BUG-cc393a: xr_stream calibrate ger timeout
- Komponent: spegling · allvar/prio: medel · antal: 1 · loggad: 2026-11-09T17:59:09.114Z
- Beskrivning: xr_stream action:calibrate svarade "Error: timeout" i testrundan; tidigare har kalibrering också fallerat med camera_disconnected och marker_not_found.
- Förväntat: Kalibreringen genomförs eller ger ett begripligt fel som säger vad användaren ska göra.
- Steg: Macens skärm streamas som overlay → xr_stream action:calibrate → Error: timeout

### BUG-13e417: Macens skärm blir svart: displaypanelen försvann och skärmen somnade medan dimning var aktiv
- Komponent: spegling · allvar/prio: hög · antal: 1 · loggad: 2026-11-09T18:04:32.202Z
- Beskrivning: Mitt under testrunden försvann Macens skärm-panel ur listan, användaren såg bara svart, "dimming ACTIVE" stod kvar, xr_stream display gav "no display" eftersom Mac-skärmen sov (Display Asleep: Yes); efter caffeinate -u startade strömmen igen.
- Förväntat: Bryggan håller skärmen vaken medan strömmen är aktiv, startar om strömmen själv, och återställer dimningen om strömmen tappas.
- Steg: Strömma Macens skärm med dimning aktiv och ingen musrörelse på Macen en stund → Macens skärm somnar, displaypanelen försvinner → xr_stream display: no display; caffeinate -u -t 3 väcker skärmen och strömmen startar

### BUG-6b9a81: Röstmeddelande utanför öppen fråga skickas inte direkt: "skickas med nästa prompt", användaren måste skriva manuellt
- Komponent: röst · allvar/prio: hög · antal: 1 · loggad: 2026-11-09T18:06:27.578Z
- Beskrivning: Användaren sa "Macen syns" med tryck-och-tala när ingen xr_ask lyssnade; headsetet svarade att det skickas med nästa prompt, så användaren skrev manuellt, och först då kom rösttexten (felhörd som "Ja, maken sings") via hook.
- Förväntat: Talat meddelande levereras direkt till pågående session (eller visar tydligt att det köas och hur man skickar det), och transkriptionen är korrekt för vanlig svenska.
- Steg: Ingen xr_ask lyssnar; Claude arbetar med verktyg → Håll in mikrofonknappen och säg 'Macen syns' → Headsetet: skickas med nästa prompt; texten når Claude först när användaren skriver manuellt, felhörd som 'Ja, maken sings'

### BUG-405388: Placering per roll: overlay för stor och skymmer tangentbordet; frågekortet hamnar bakom eller ovanpå panelen
- Komponent: quest-app · allvar/prio: hög · antal: 1 · loggad: 2026-11-09T18:08:03.030Z
- Beskrivning: Testresultat roller: primary rakt fram men skymd av datorn; log snett vänster och synlig; side snett höger och synlig (men tidigare diff med side hamnade rakt fram); compare synlig; overlay över Mac-skärmen men mycket större än den och skymde tangentbordet och frågekortet; i alla tester låg xr_ask-formuläret bakom/under testpanelen och användaren fick flytta det för att svara.
- Förväntat: Frågekortet ligger alltid överst och nåbart, overlay har samma storlek som Mac-skärmen, och primary skyms inte av Mac-skärmen.
- Steg: Ha Macens skärm streamad → xr_present kpi small med role primary, log, side, compare, overlay en i taget → xr_ask efter varje: kortet skymt, overlay för stor

### BUG-2153ff: Ny fönsterström ersätter föregående fönsterström även när rollerna skiljer sig (roll är inte orsaken)
- Komponent: spegling · allvar/prio: hög · antal: 1 · loggad: 2026-11-09T18:10:30.440Z
- Beskrivning: Terminal-ström (panel i side) ändrades till role compare, därefter startades Code-ström; Terminal-panelen och strömmen försvann ändå och bara Code och Macens skärm fanns kvar, och displaypanelens id byttes igen; hypotesen om rollkonflikt är därmed motbevisad.
- Förväntat: Flera fönsterströmmar lever samtidigt, som verktygsbeskrivningen (max 4) säger.
- Steg: xr_stream window 1311 (Terminal) → xr_panel update id:<panel> role:compare → xr_stream window 1321 (Code) → xr_panel list: bara Code och Macens skärm

### IDE-eb82dd: Visa på Macen/headsetet varför [ask]-fönster inte kan strömmas
- Komponent: okänd · allvar/prio: - · antal: 1 · loggad: 2026-11-09T11:45:16.818Z
- Beskrivning: Användaren visste inte var godkännandet skulle ges; en tydlig dialog eller felrad vid window-ström av [ask]-fönster sparar mycket tid.

### IDE-d3aaa2: xr_panel close all / stäng strömpanel med stream-id
- Komponent: okänd · allvar/prio: - · antal: 1 · loggad: 2026-11-09T11:45:16.842Z
- Beskrivning: "Stäng alla" gav Not found; ett verktygsstöd för att stänga alla paneler inklusive strömmar behövs.

### IDE-a183c2: Ny röstpanel nära huvudet: peka för att tala, släpp för att skicka
- Komponent: okänd · allvar/prio: - · antal: 1 · loggad: 2026-11-09T11:48:59.947Z
- Beskrivning: Mikrofonikonen öppnar en stor tryckbar panel mycket nära användarens huvud (inom fingerräckvidd); håll in med fingret för att tala och släpp för att skicka direkt till chatten.

### IDE-8b8b8d: Macens skärm strömmas alltid, förankrad över den fysiska skärmen
- Komponent: okänd · allvar/prio: - · antal: 1 · loggad: 2026-11-09T11:48:59.969Z
- Beskrivning: Display-strömmen ska alltid vara aktiv och ligga ovanpå Macens fysiska skärm, och får aldrig ersättas eller stoppas när en Claude-chatt öppnar en app-/fönsterpanel (t.ex. Notion).

### IDE-8015ff: Dimma den fysiska skärmen till ljusstyrka 0 under strömning
- Komponent: okänd · allvar/prio: - · antal: 1 · loggad: 2026-11-09T11:48:59.990Z
- Beskrivning: När Macens skärm strömmas till headsetet sätts den fysiska skärmens ljusstyrka till 0; ursprungsvärdet måste återställas när strömmen stoppas, anslutningen bryts eller bryggan kraschar.

### IDE-e6a156: Statusrad för ström och mikrofon
- Komponent: okänd · allvar/prio: - · antal: 1 · loggad: 2026-11-09T11:49:44.928Z
- Beskrivning: Alltid synlig rad som visar vad som strömmas och om mikrofonen lyssnar.

### IDE-e3d61e: Förhandsgranska röst innan sändning
- Komponent: okänd · allvar/prio: - · antal: 1 · loggad: 2026-11-09T11:49:44.948Z
- Beskrivning: Visa uppfattad text med skicka/avbryt innan den går till chatten; löser även kollisionen med "jag hörde"-fönstret.

### IDE-743d85: Ljud och vibration vid mikrofonstart/-stopp
- Komponent: okänd · allvar/prio: - · antal: 1 · loggad: 2026-11-09T11:49:44.968Z
- Beskrivning: Signal när mikrofonen börjar och slutar lyssna så användaren vet att knappen registrerades.

### IDE-592a18: Strömindikatorn över Mac-skärmen är för stor och röd
- Komponent: spegling · allvar/prio: - · antal: 1 · loggad: 2026-11-09T16:23:22.346Z
- Beskrivning: Statusbaren som visar att skärmen strömmas är stor och röd och tar för mycket uppmärksamhet. Något ska fortfarande indikera att det strömmar, men det ska vara väldigt minimalistiskt (liten, diskret, dämpad färg).

### IDE-38fba9: Statusbar i vänster handflata
- Komponent: quest-app · allvar/prio: - · antal: 1 · loggad: 2026-11-09T16:34:08.340Z
- Beskrivning: Flytta statusbaren (centrera, kalibrera skärmen, justera, visa status) till användarens vänstra handflata, synlig när hen tittar på den.
- Förväntat: Alltid åtkomlig och kan inte skymma eller döljas av andra paneler.

### IDE-5221ff: Närvaroläge: Claude vid skrivbordet (kamera, röst, spara)
- Komponent: quest-app · allvar/prio: - · antal: 1 · loggad: 2026-11-09T17:16:53.044Z
- Beskrivning: Nytt läge där användaren frågar om det hen ser via passthrough-kameran och får svar med röst/paneler, kan spara bilder på rätt plats, och använder claude -p på Pro-plan med nivåer (lokalt, haiku, sonnet, session). Handflateknapp som utlösare. Full plan: Meta XR/plan/narvarolage-plan-utkast-v1.md (etapp 1-5, leveranskrav, testchecklista). Nästa session bygger allt; kameran (etapp 1) avgörs först.
- Förväntat: Allt i planen byggt och testbart på en gång; CHANGELOG-0.4.0 med installationssteg, rollback och testat/inte testat.

### IDE-ff427a: Komfort som krav: pauser, avstånd, trötthetslogg
- Komponent: skills/presentation · allvar/prio: - · antal: 1 · loggad: 2026-11-09T17:16:53.083Z
- Beskrivning: Användaren blir trött under 20 min (huvudvärk, torra ögon, suddig/dubbel syn, illamående). Appen ska ha: stilla paneler på 1,0-2,0 m (aldrig närmare än 0,5 m, röstpanelen på 0,4 m ersätts), högst 2-3 paneler, komfortguide vid första start, Vila-knapp, pauspåminnelser, 'mår dåligt'-nödutgång till passthrough, trötthetslogg ('trött 3'), valfritt komfortläge utan spegling. Evidens svag; siffror ska justeras efter användarens testning. Se avsnitt 7 i planen.
- Förväntat: Komfort är mätbara krav i varje etapp, inte en bonus.

### IDE-58a72d: Interaktiva fönsterpaneler: peka och klicka i strömmat fönster
- Komponent: okänd · allvar/prio: - · antal: 1 · loggad: 2026-11-09T17:34:40.350Z
- Beskrivning: Idag är fönsterströmmar bara visning; användaren vill flytta muspekaren till t.ex. Spotify i headsetet och styra fönstret direkt för att multitaska.

### IDE-8e4736: Macens ljud i headsetet, sömlöst (kravlista i bugs/IDE-ljud-i-headsetet-krav.md)
- Komponent: okänd · allvar/prio: - · antal: 1 · loggad: 2026-11-09T17:37:16.969Z
- Beskrivning: Spotify och annat Mac-ljud ska spelas i headsetet med tyst Mac, synk, ducking vid tal och volymstyrning; delar ljudväg med Claudes uppläsning.

### IDE-11c7f5: HÖG PRIO nästa runda: paneler = flera skärmar, pekare hoppar mellan dem och full interaktion (bugs/IDE-paneler-som-flera-skarmar-krav.md)
- Komponent: okänd · allvar/prio: - · antal: 1 · loggad: 2026-11-09T17:39:56.719Z
- Beskrivning: Varje panel ska vara en riktig skärm: pekaren följer riktningen i rummet, hoppar in i panelen och användaren kan klicka, skriva och dra i den; ersätter IDE-58a72d, kräver flera samtidiga strömmar.

### IDE-af1e76: Knapp "Stäng alla paneler utom Macens skärm" i headsetet
- Komponent: okänd · allvar/prio: - · antal: 1 · loggad: 2026-11-09T17:41:53.561Z
- Beskrivning: Idag stänger "close all" och rösten "stäng alla paneler" även Macens skärm; användaren vill ha en knapp (och röstkommando) som lämnar kvar Macens skärm och stänger allt annat, inklusive fönsterströmmar och automatiska diff- och ändringspaneler.

### IDE-e587a1: Bioskärm-förinställning och återställ-placering för Macens skärm
- Komponent: okänd · allvar/prio: - · antal: 1 · loggad: 2026-11-09T17:46:01.673Z
- Beskrivning: Användaren vill kunna säga "bioskärm" eller "återställ" och få Macens skärm stor, rakt framför och på skonsamt avstånd för ögonen, utan att jag gissar enheter; bör finnas som förinställning med några storlekssteg (större, längre bort).

### IDE-097b42: Ljud spelas i headsetet från webbpanel (WebAudio); möjlig snabb väg för Mac-ljud och uppläsning
- Komponent: okänd · allvar/prio: - · antal: 1 · loggad: 2026-11-09T18:13:33.872Z
- Beskrivning: Test 2026-11-09: en xr_show url-panel med knapp som spelar en WebAudio-ton hördes i headsetet, så en ljudväg bryggan till headset finns i webbpaneler; utvecklaren kan pröva att strömma Opus/WebRTC-ljud dit innan en egen ljudväg i Quest-appen byggs.

### IDE-ff2330: Dokumentera att xr_panel move är ett absolut avstånd i meter framför användaren (inte en förflyttning)
- Komponent: okänd · allvar/prio: - · antal: 1 · loggad: 2026-11-09T18:16:15.327Z
- Beskrivning: Test 2026-11-09: forward 0,5 gav en panel "jätte nära", forward 1,5 gav "ganska långt ifrån mig, behagligt avstånd", vilket stämmer med absolut position i meter; size-enheten är fortfarande okänd, och Macens skärm bör inte flyttas med move förrän det är klarlagt (BUG-83fe52).

### IDE-5665f8: iPhone Mirroring är inte tillgängligt i Sverige: en annan väg behövs för skarp iPhone-skärm i headsetet
- Komponent: okänd · allvar/prio: - · antal: 1 · loggad: 2026-11-09T18:17:11.221Z
- Beskrivning: Test 2026-11-09: macOS visade "iPhone Mirroring is not available in your country or region", så iPhone-skärmen kan inte strömmas som panel via den vägen; alternativ att utvärdera är AirPlay/QuickTime-inspelning av iPhone via USB som fönster på Macen som sedan strömmas, utan krav på överlägg på den fysiska telefonen.


---

## Bilaga 1: kravlista, Macens ljud i headsetet (IDE-8e4736)

# Idé: Macens ljud i headsetet (sömlöst) – kravlista

Skriven 2026-11-09 på användarens begäran. Gäller bryggan, Mac-hjälparen (spegling) och Quest-appen.
Status: idé, inget byggt. Ingenting här är provat. Allt under "Förslag" är antaganden som utvecklaren ska verifiera.

## Bakgrund
- Användaren multitaskar i headsetet: Notion-panel + Spotify-panel + Claude. Spotify spelar idag på Macens utgång, inte i headsetet (verifierat 2026-11-09).
- 0.3.0 bär bara mikrofonljud headset → Mac. Ljud Mac → headset saknas (se `plan/narvarolage-plan-utkast-v1.md`, öppen fråga 1 "Ljudväg för uppläsning").
- Samma ljudväg behövs för Claudes uppläsning (närvaroläget), så bygg den en gång för båda.

## Omfattning (tillägg efter användarens besked)
Funktionen gäller **allt ljud användaren gör på Macen**, inte bara Spotify: musik, videor, webbläsare, samtal, notiser, Claudes röst, spel, redigeringsprogram med mera. Spotify är bara ett exempel. Därför är standardläget **hela systemljudet**, och per-app-val är ett extra, inte grundkravet.

## Målbild: vad "sömlöst" betyder
1. Användaren sätter på headsetet och hör Macens ljud där, utan att göra något.
2. Macens högtalare tystnar medan headsetet bär ljudet, och kommer tillbaka av sig själv när headsetet tas av eller tappar anslutningen.
3. Ljud och bild hänger ihop (inga synliga läppsynk-fel i strömmade videofönster).
4. Ingen eko- eller återkopplingsljud när användaren pratar.
5. Volym, paus och val av vad som hörs kan styras i headsetet, utan att ta av det.
6. Claudes röst och musik samsas: musiken sänks när Claude eller användaren talar och går tillbaka.

## Krav

### A. Fånga ljud på Macen
- **Standard: fånga hela systemljudet** (allt som spelas på Macen), oberoende av vilka paneler som är öppna. ScreenCaptureKit kan fånga ljud från hela displayen/systemet; verifiera att det täcker alla appar (även skyddat innehåll kan vara tyst, kontrollera).
- Valfritt extra: filtrera bort enstaka appar (t.ex. stäng av notisljud) eller bara ta en app.
- Alternativ om ScreenCaptureKit inte räcker: virtuell ljudenhet (BlackHole eller liknande) för systemljud. Kräver installation, ta bort om möjligt.
- Ljudet får inte hänga på att en fönsterpanel är öppen (annars försvinner det med BUG-2e4ecb när strömmar ersätter varandra).
- Samma behörighet som skärmströmmen (skärminspelning). Inget extra godkännandekort om det går.

### B. Transport
- Komprimera (Opus, 48 kHz, stereo, ca 96–128 kbit/s) och skicka i befintlig anslutning till headsetet, med tidsstämplar delade med bildströmmen.
- Fördröjningsmål: musik helst under 200 ms totalt, högst 300 ms. Video med ljud: ljud och bild inom ±40 ms (justera bildens eller ljudets buffert så de möts).
- Jitter-buffert i Quest-appen som anpassar sig (kort vid bra nät, längre vid dåligt). Inga klick eller hack vid Wi-Fi-svacka: dölj med tystnad eller upprepning, inte skarpa avbrott.
- Fungerar när bryggan kopplas upp igen (kod 1006 har loggats 24 gånger, se AUTO-382020): ljudet ska återupptas utan manuell åtgärd inom några sekunder.

### C. Uppspelning i Quest-appen
- Spela via headsetets högtalare, med möjlighet till rumsljud (ljudet kommer från panelen) eller vanligt stereo. Standard: stereo, valbart.
- Ljudet ska inte hamna i mikrofonen (Quests egen ekoreducering på, och testa med högtalare).
- Behåll ljudet när appen går i bakgrunden eller användaren öppnar Quest-menyn (testa).

### D. Macens utgång (så det blir tyst på Macen)
- Medan ljud skickas: tysta Macens högtalare eller byt utgång till en tyst enhet, och återställ **alltid** efteråt (även vid krasch eller avbrott). Spara ursprunglig utgång och volym på disk så en omstart kan återställa.
- Visa tydligt (statusrad i headsetet) var ljudet spelas: "Ljud: headset" / "Ljud: Mac".
- Om användaren tar av headsetet: Mac-ljudet kommer tillbaka inom 2 s (använd headsetets närhetssensor om den kan läsas, annars tappad anslutning eller vilomeddelande).

### E. Styrning i headsetet
- Volym: reglage på handflata/kontroller eller röst ("sänk", "tystare", "pausa musiken"). Ingen kontroll av Mac-fönstret behövs.
- Uppspelningsstyrning: play/paus/nästa via bryggan (på Macen kan `osascript` styra Spotify; fungerade i sessionen 2026-11-09).
- Standard: allt ljud på. Valfritt: stäng av enskilda appar (t.ex. notiser, webbläsare). Kom ihåg valet.
- Ljud för samtal/möten (Teams, FaceTime): mikrofon och högtalare ska båda gå via headsetet, utan eko. Testa separat.
- Ljud av vid "stäng alla paneler"? Bestäm: förslag att musiken fortsätter, men panelen försvinner.

### F. Samspel med röst och Claude
- Ducking: musik sänks ca 12–18 dB när (a) användaren håller in mikrofonknappen, (b) Claude läser upp, (c) en notis spelas. Tillbaka mjukt (300–500 ms).
- Claudes uppläsning (`say` eller liknande) ska gå i samma ljudväg, inte på Macens högtalare.
- Röstkommandon i bryggan (lokala) ska även gälla ljud: "pausa musiken", "tystare", "ljud på Macen".

### G. Komfort och säkerhet
- Ljudvolymens tak vid start (börja lågt, t.ex. 40 %), så inget smäller vid uppstart.
- Fade in/ut 200 ms vid start, stopp och byte av källa.
- Inga plötsliga volymhopp när annan app (video, notis) kommer in.
- Pausa ljud vid tappad anslutning efter 3 s i stället för att spela brus.
- Logga trötthet och komfort kopplat till ljud vid behov (se IDE-ff427a).

### H. Fel och fallback
- Om ljudvägen inte startar: visa tydligt i headsetet, och låt ljudet stanna på Macen (aldrig tyst överallt).
- Snabbväg som fungerar utan utveckling: Bluetooth-ljud från Mac till Quest eller Quests egen Spotify-app. Oprövat, kan inte styras av bryggan.
- Alla fel loggas som vanligt i `bugs/`, inte tyst.

## Teststeg (ska klaras innan det kallas sömlöst)
0. Prova minst fyra olika källor samtidigt: Spotify, en YouTube-video i Safari, en Macnotis och Claudes uppläsning. Allt hörs i headsetet, inget på Macen.
1. Spotify på Macen, headsetet på: ljud i headsetet, tyst på Macen.
2. Ta av headsetet: ljud tillbaka på Macen inom 2 s, ingen manuell åtgärd.
3. Stäng Wi-Fi 5 s: tystnad, sedan återupptag utan hack eller dubbelt ljud.
4. YouTube-fönster strömmat: läppsynk bra (mät med klapp, högst ±40 ms).
5. Håll in mikrofonknappen: musik sänks, ingen eko i taltolkningen.
6. Claude läser upp ett svar medan musik spelar: svaret hörs tydligt, musik tillbaka efteråt.
7. Starta om bryggan mitt i en låt: ljudet återhämtar sig, Macens utgång är återställd.
8. Krascha hjälparen avsiktligt: Macens utgång och volym återställs.
9. En timmes körning: ingen drift i synk, inget minnesläckage, headsetet inte varmt av ljudet.

## Öppna beslut för utvecklaren
- Hela systemljudet är beslutat som standard (användaren vill ha allt). Öppet: hur filtrerar man enstaka appar, och hur hanteras skyddat innehåll och samtal?
- Rumsljud eller stereo som standard?
- Ska Macens högtalare tystas, eller räcker det att sänka?
- Var ska volymen styras i headsetet (handflata, kontroll, röst)?
- Hur görs ljud-bild-synk när bilden strömmas med varierande fördröjning?
- Ska ljudet fortsätta när alla paneler stängs?

## Koppling
- Samma väg som Claudes uppläsning i närvaroläget (IDE-5221ff, plan öppen fråga 1).
- Närliggande: IDE-58a72d (interaktiva fönsterpaneler), BUG-2e4ecb (fönsterströmmar ersätter varandra: ljud per fönster kräver att flera strömmar kan finnas samtidigt).


---

## Bilaga 2: kravlista, paneler som flera skärmar (IDE-11c7f5)

# Idé (HÖG PRIORITET, nästa runda): Paneler = riktiga skärmar man kan peka och arbeta i

Skriven 2026-11-09 på användarens uttryckliga begäran. Gäller bryggan, Mac-hjälparen (spegling) och Quest-appen.
Status: idé, inget byggt eller provat. Allt under "Förslag" är antaganden som utvecklaren ska verifiera.
Ersätter och skärper IDE-58a72d ("Interaktiva fönsterpaneler"). Användaren vill att detta tas på allvar: "view only" är inte godtagbart som slutläge.

## Vad användaren vill (med egna ord, sammanfattat)
- När en panel öppnas ska det i praktiken fungera som att användaren har **flera skärmar**.
- Användaren flyttar muspekaren **i samma riktning som det upplevs i glasögonen**. Är Spotify-panelen till höger i rummet, går pekaren åt höger.
- Pekaren **hoppar över till panelen** där den finns, som mellan flera monitorer.
- Användaren kan **interagera med allt som finns där** (klicka, skriva, scrolla, dra, högerklicka, genvägar), inte bara titta.
- Gäller alla paneler som speglar Macen (Notion, Spotify, Safari, Terminal, Code, med flera), inte bara utvalda appar.
- Samma sak ska gälla Macens egen skärm i headsetet.

## Hur upplevelsen ska vara (acceptanskriterier)
1. Användaren flyttar musen/styrplattan. Pekaren rör sig i headsetet i samma riktning som musen, utan att tänka på koordinater.
2. När pekaren når kanten på en panel fortsätter den in i grannpanelen **i den riktning panelen faktiskt ligger i rummet** (höger panel = över högerkanten).
3. Panelen som har pekaren markeras tydligt (tunn ram eller ljus kant) så användaren alltid vet var tangentbordet skriver.
4. Klick, dubbelklick, högerklick, scroll, dra och släpp, markera text och tangentbordsgenvägar fungerar i panelen som på en vanlig skärm.
5. Pekaren känns direkt: användaren ska inte märka fördröjning.
6. Funktionen fungerar med flera paneler samtidigt (Notion + Spotify + Terminal + en till), utan att någon försvinner.
7. Utan att användaren behöver be Claude om något. Claude ska inte vara mellanhand.

## Tekniskt förslag (att verifiera)

### 1. Varje panel är en riktig (virtuell) skärm på Macen
- Skapa en virtuell skärm per panel (t.ex. via Apples virtuella skärm-API eller privata CGVirtualDisplay, alternativt verktyg i stil med BetterDisplay/DeskPad), och flytta det aktuella fönstret dit, maximerat.
- Alternativ om virtuella skärmar inte går: behåll fönstret där det är och mappa panelens koordinater till fönstrets rektangel. Då fungerar pekaren, men fönster som överlappar eller flyttas på Macen kräver extra hantering. Utvecklaren väljer och motiverar.
- macOS skärmarrangemang (System Settings > Skärmar) **ska matcha panelernas placering i rummet**. Flyttar användaren en panel i headsetet, uppdateras arrangemanget automatiskt (och tvärtom), så att "åt höger" betyder samma sak överallt. Detta är kärnan i att pekaren ska röra sig i rätt riktning.
- Behåll användarens riktiga skärmar och deras arrangemang orörda: spara och återställ vid avslut/krasch.

### 2. Pekare och inmatning
- Två sätt att peka, båda ska finnas:
  a. **Mac-mus/styrplatta** (som idag): pekaren går mellan virtuella skärmar enligt arrangemanget ovan.
  b. **Direkt pekning i headsetet** (kontroll, hand eller blick + nyp): användaren pekar på panelen, Quest-appen räknar ut position i panelen och skickar klick/rörelse till bryggan, som mappar till rätt skärmkoordinat.
- Skicka musrörelser, klick, scroll och tangenter från Quest-appen till Mac-hjälparen (CGEvent eller motsvarande). Kräver Hjälpmedel-behörighet (Accessibility) på Macen. Begär den en gång, med tydlig förklaring.
- **Rita pekaren lokalt i headsetet**, ovanpå strömbilden, så den inte släpar efter videofördröjningen. Strömmen visar då bilden, men pekaren följer handen eller musen direkt. Synka mot den verkliga pekaren så de inte glider isär.
- Tangentbord: Macens fysiska tangentbord skriver i den fokuserade panelen. Dessutom röstdiktering och ett virtuellt tangentbord i headsetet som reserv.
- Fokus: den panel som pekaren är i får tangentbordsfokus och blir aktivt fönster.

### 3. Strömmen måste klara flera paneler
- Förutsättning: **BUG-2e4ecb** (ny fönsterström ersätter föregående), **BUG-9e3e1b** (displaystrom försvinner) och **BUG-552260** (blank fönsterström) måste vara lösta. Utan flera samtidiga strömmar finns inga "flera skärmar".
- Rimligt mål: minst 4 paneler samtidigt, 30 fps (60 om det går) för aktiv panel, lägre för inaktiva, så bandbredd och värme hålls nere.
- Skarp text: strömma i panelens egen upplösning, inte nedskalad. Läsbarhet på komfortavstånd är ett krav (se IDE-ff427a).
- Fördröjning för klick-till-bild: helst under 100 ms.

### 4. Panelhantering
- Ny panel öppnas = ny virtuell skärm skapas och placeras så att den inte täcker de andra (BUG-1fcf21).
- Stängs panelen: fönstret flyttas tillbaka till användarens riktiga skärm (inte bort eller minimerat), den virtuella skärmen tas bort.
- Användaren kan flytta och ändra storlek på paneler i rummet; arrangemang, upplösning och proportion följer med.
- Möjlighet att "ta tillbaka" alla fönster till Macens riktiga skärm med ett kommando (röst: "samla fönstren").

### 5. Säkerhet och förtroende (viktigt när fjärrstyrning införs)
- Inmatning är **av som standard** tills användaren godkänt det en gång i Macens behörighetsdialog och bekräftat i headsetet. Röst får aldrig godkänna det (samma regel som övrig behörighet).
- Tydlig indikator i headsetet när inmatning är aktiv, och en snabb avstängning (t.ex. röst "släpp kontrollen" eller knapp). Avstängning ska alltid fungera.
- Skydda känsliga ögonblick: lösenordsfält, system-dialoger och behörighetsfrågor ska inte kunna klickas av misstag av ett ostabilt pekarmapp. Överväg bekräftelse eller att pekaren hålls på Macens fysiska mus där.
- Ingen automatisk klickning från Claude i användarens fönster. Claude får bara gå via befintliga verktyg om användaren ber om det.
- Säkra mot att annan person i rummet eller en felhörd röst orsakar klick.
- Skriv aldrig fångade tangenttryck eller skärminnehåll till loggar i `bugs/` (lösenord!). Rapporter får bara innehålla händelser, inte innehåll.

### 6. Komfort (användaren bär detta länge)
- Pekaren och panelerna ska stå still i rummet (ingen drift). Vid drift: omkalibrera snabbt (`xr_stream calibrate` finns).
- Inga plötsliga hopp i pekaren; mjuk acceleration som på Macen.
- Avstånd och storlek ska hålla länge utan ansträngning; trötthetslogg (IDE-ff427a).
- Ljud: allt ljud ska följa med i headsetet (IDE-8e4736), annars bryts upplevelsen av "flera skärmar".

## Teststeg (ska klaras innan det kallas klart)
1. Öppna Notion, Spotify och Terminal som tre paneler (vänster, mitten, höger). Alla syns samtidigt. Ingen försvinner.
2. Flytta musen åt höger: pekaren går från mittenpanelen in i högerpanelen i headsetet, och panelen markeras.
3. Klicka, dubbelklicka, högerklicka, scrolla och dra i varje panel. Allt fungerar.
4. Skriv text och använd genvägar (Cmd+C, Cmd+V, Cmd+Tab) i fokuserad panel.
5. Peka direkt med kontroll/hand på en panel och klicka: rätt element får klicket (testa små knappar, t.ex. Spotifys play-knapp).
6. Flytta en panel i rummet från höger till vänster: musens riktning uppdateras (vänster betyder vänster).
7. Stäng en panel: fönstret kommer tillbaka på Macens riktiga skärm, osynligt för användaren i övrigt.
8. Krascha bryggan eller hjälparen: Macens riktiga skärmar och fönster återställs.
9. Fördröjning: pekaren känns direkt, klick-till-bild under 100 ms (mät).
10. Försök klicka i ett lösenordsfält och en systemdialog: skyddet fungerar enligt beslutet.
11. En timmes användning: ingen pekardrift som inte går att åtgärda, inget synligt värmeproblem, ingen minnesläcka.

## Öppna beslut för utvecklaren
- Virtuella skärmar (stöds privat API stabilt i dagens macOS?) eller mappning av fönsterrektanglar?
- Hur ofta synkas panelens rumsplacering mot macOS skärmarrangemang, och är riktningen alltid entydig i 3D (över/under/framför)?
- Kontroll, hand eller blick som direktpekare? Vilket fungerar bäst med små mål?
- Ska Macens fysiska mus alltid kunna "dra" pekaren ut i rummet, eller bara mellan valda paneler?
- Hur hanteras fullskärmsappar, Spaces/Mission Control och fönster som öppnar menyer utanför fönsterkanten?
- Hur skyddas lösenord och systemdialoger (se avsnitt 5)?

## Koppling
- Bygger på: BUG-2e4ecb, BUG-9e3e1b, BUG-552260 (flera strömmar), BUG-1fcf21 (paneler ovanpå varandra).
- Ersätter IDE-58a72d. Hör ihop med IDE-8e4736 (ljud i headsetet), IDE-8b8b8d (Macens skärm alltid speglad), IDE-ff427a (komfort) och IDE-5221ff (närvaroläge).
- Bör läggas först i nästa runda, före ljud och närvaroläge, eftersom de bygger på flera stabila strömmar.


---

## Tillägg 2026-11-09 (sent): trådat läge, USB-C mellan headset och Mac (idé, ej provat)
ägaren arbetar mest stillasittande vid ett skrivbord och har en USB-C-kabel. Förslag: ett **trådat läge** där bryggan och Quest-appen pratar över USB (t.ex. `adb reverse`/`adb forward`) i stället för Wi-Fi.
- **Sannolik vinst:** stabilare anslutning (kod 1006 har tappats 24 gånger, AUTO-382020), lägre och jämnare fördröjning (uppmätt Wi-Fi-svarstid ca 39 ms), högre bandbredd för skarpare ström än dagens tak (1600 px, ca 12 Mbit/s) och fler samtidiga paneler, jämnare ljudväg, laddning under långa pass.
- **Löser inte:** panelplacering, felhörd röst, Macens skärm som somnar, iPhone-överlägg, och eventuell flaskhals i kodning/avkodning.
- **Förbehåll:** dataförande USB-C-kabel (helst USB 3); utvecklarläge och godkänd USB-felsökning; Metas Link-läge finns så vitt känt inte för Mac, så bygg inte på det. `adb` finns installerat på ägarens Mac (`~/Library/Android/sdk/platform-tools/adb`), inget headset var anslutet vid kontrollen.
- **Föreslaget underlagstest innan bygge:** mät svarstid och tappade anslutningar över `adb reverse` mot Wi-Fi.
- **Status:** inte provat, ingen kabel var ansluten.

### Mätresultat 2026-11-09 (kväll): USB-C-kabel mot Wi-Fi, Quest 3 (serienummer utelämnat)
Utfört med `adb` över USB-C. Rör inte bryggan eller Quest-appen. Temporär testfil i headsetet är borttagen och kontrollerad.
| Mått | Resultat | Kommentar |
|---|---|---|
| Wi-Fi, ping headset → Mac, 30 paket | medel 10,2 ms, min 4,1, max 30,6, mdev 7,4 ms, 0 % förlust | Stor spridning (jitter) |
| Kabel, 50 × `adb shell true` | medel 18,9 ms, min 17,0, max 20,8, p95 20,3 ms | Inkluderar start av skal, alltså en **övre gräns**. Inte jämförbar rakt av med pingen, men spridningen är mycket mindre (ca 4 ms mot ca 26 ms) |
| Kabel, genomströmning (`adb push -Z`, 100 MB slumpdata, 3 försök) | 36 MB/s ≈ 285 Mbit/s, stabilt | Troligen begränsat av headsetets lagring, så ett golv för kabeln. Dagens ström använder ca 12 Mbit/s. Wi-Fi-genomströmning är **inte mätt** (inget iperf) |
- Första genomströmningsmätningen (4570 Mbit/s) var **ogiltig**: nollfylld fil som `adb` komprimerar. Ersatt av mätningen ovan.
- **Slutsats:** kabeln ger mycket jämnare svarstid och mer än tillräcklig bandbredd. Den **absoluta** fördröjningen är inte bevisat lägre än Wi-Fi (pingen var redan låg i snitt). Vinsten är främst jämnhet och bandbredd. Det motsvarar problemen: tappade anslutningar och jitter. Appen över en `adb reverse`-tunnel är **inte** mätt och kräver att utvecklaren bygger tunneln (TLS-certifikat och pairing mot localhost behöver undersökas, bryggan lyssnar på 47800 mot LAN).
- **Wi-Fi-genomströmning är inte mätt.** Försöket 2026-11-09 (ren TCP-överföring med `nc` åt båda hållen, Mac ↔ headset) misslyckades i alla sex försök med "Connection reset" eller timeout; orsaken är ej utredd (möjligen Macens brandvägg eller headsetets `nc`). Beslut (ägaren, 2026-11-09): mäts inte vidare nu, eftersom beslutet om trådat läge vilar på jitter och tappade anslutningar och inte på bandbredd. Mät i stället i själva appen under vanlig användning.
