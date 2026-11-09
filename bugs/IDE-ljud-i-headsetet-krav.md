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
