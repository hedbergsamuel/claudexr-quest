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
