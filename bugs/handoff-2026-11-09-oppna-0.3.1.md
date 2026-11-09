# ClaudeXR – ren överlämning: det som är öppet i 0.3.1

Skapad 2026-11-09 efter genomgång av `handoff-2026-11-09T16-42-05.md`, `BUGS.md`, `CHANGELOG-0.3.0.md` och `CHANGELOG-0.3.1.md`.
Versioner: brygga 0.3.1, Mac-hjälpare 0.3.1 (kod = 0.3.0), Quest-app 0.3.0.

**Viktigt:** "Åtgärdad i 0.3.0" betyder här att changeloggen beskriver en åtgärd. Changeloggen säger själv att Quest-delen och riktiga macOS-tjänster är provade bara med enhetstester. Därför skiljer jag på *verifierad i praktiken* och *åtgärdad men ej verifierad*.

## A. Öppet och bekräftat i 0.3.0/0.3.1 (sett idag)

| ID | Allvar | Ärende | Kommentar |
|---|---|---|---|
| BUG-7cf1b6 | hög | Claude stängde Macens skärmspegling på en "stale"-flagga | Hooken kallade en live display-ström "stale". Spegling ska aldrig stängas utan uttrycklig begäran. Åtgärd i hook/panellistan: markera display-strömmen som skyddad, och visa aldrig "stale" för den. |
| (ny observation) | hög | `emergency close` 16:41:39 stängde alla paneler och strömmar | Utlösare okänd. Antingen "Stäng allt" i headsetet eller automatik vid frånkoppling. Förklara i loggen vad som utlöste det. Enligt 0.3.0 ska en nödstängd display *förbli av* efter återanslutning, vilket krockar med att spegling "alltid" ska vara på. Bestäm avsikt. |
| BUG-2a0790 | medel | Panelen "Claude arbetar" visar terminalkommandon och distraherar | Samma panel som troligen orsakade BUG-e1fc54 ("Vilar"/aktivitetspanelen till vänster). 0.3.0 döljer den bara när Claude vilar. Önskat: av som standard eller diskret och avstängbar. |
| BUG-1fcf21 | medel | Flera paneler läggs ovanpå varandra | `xr_present`/`xr_show` placerar inte nya paneler fritt. Önskat: Claude eller bryggan räknar ut plats så att inget överlappar. `xr_panel layout tidy` hjälpte inte att förutse placering. |
| AUTO-283d15 | medel | Skärmkalibrering misslyckas: `camera_disconnected` (först 16:19:28, med headset anslutet) | Första förekomsten är äkta (anslutet headset, strömmen live). Upprepningen 16:42:52 kom efter att headsetet tagits av (emergency close 16:41:39) och är förväntad, inte en bugg. |
| AUTO-dcd040 | medel | Skärmkalibrering misslyckas: `timeout` (först 16:19:46, med headset anslutet) | Samma: den första är äkta, upprepningen 16:43:32 kom efter frånkoppling. |
| (ny idé) | låg | Kalibrering ska inte köras eller loggas som fel när inget headset är anslutet | Undviker falska auto-buggar och felräkning (`repeat`). |
| AUTO-eae9dc | medel | Röst feltolkad: "stora röda strömmar" i stället för "strömindikatorn" | Whisper-noggrannhet. Förhandsvisningen (Skicka/Avbryt) i 0.3.0 ska fånga det; kontrollera att den används. |

## B. Öppna förbättringsidéer

| ID | Prio | Idé |
|---|---|---|
| IDE-38fba9 | medel | Statusbaren (centrera, kalibrera, justera, visa status) flyttas till vänster handflata, synlig när användaren tittar på handen. Löser också att den inte skymmer paneler. |
| IDE-592a18 | medel | Strömindikatorn över Mac-skärmen är för stor och röd. Ska vara liten, diskret och dämpad men fortfarande finnas. |
| IDE-743d85 | låg | Ljud/vibration vid mikrofonstart/-stopp. Changeloggen säger "best effort"; Quest kan ignorera Android-Vibrator. Ej verifierat. |

## C. Åtgärdad i 0.3.0, men ej verifierad på riktigt headset (rapporterad i 0.2.0)

| ID | Ärende | Åtgärd enligt changelog | Status |
|---|---|---|---|
| BUG-e459f3 | Strömpaneler saknas i list, kan inte stängas | `xr_panel list` visar strömmar, `close id`/`all` stoppar dem | **Verifierat idag:** `list` visade "Macens skärm", `close` på panel-id stängde panel och ström. |
| BUG-e1fc54 | Tom panel till vänster kan inte tas bort | Aktivitetspanelen "Vilar" dold + ✕; orphan-sopare | Ej verifierat. Misstänkt samma panel som BUG-2a0790, som finns kvar. |
| BUG-552260 | Notion-ström blank trots "Streaming" | Senaste bilden kodas om, svar först efter första bild | Ej provat (ingen fönsterström idag). |
| BUG-9e3e1b | Display-ström försvinner vid fönsterström | Display ersätts aldrig av fönsterströmmar, gräns 4 | Ej provat. |
| BUG-36fba1 | Tryck-och-tala ger ingen respons | Ny röstpanel nära huvudet, förhandsvisning, kö via hook | Delvis: röstmeddelanden har kommit fram idag via hooken. Själva håll-knappen i panelen är ej bekräftad. |
| IDE-eb82dd, IDE-d3aaa2, IDE-8b8b8d, IDE-8015ff, IDE-e6a156, IDE-e3d61e, IDE-a183c2 | Idéer från 0.2.0-sessionen | Implementerade i 0.3.0 enligt changelog | Dimning och återställning syns i loggen idag. Övriga ej provade. |

## D. Troligen lösta eller inte buggar (föreslås stängda)

| ID | Skäl |
|---|---|
| AUTO-382020 (1006, 24×) | Alla 11:47–12:30 under 0.2.0. Inte sedan dess. 0.3.0 kräver två missade pingar. Bevaka. |
| AUTO-1b37d0 (-3801), AUTO-12648a (-3805) | Alla 11:33–11:40 under 0.2.0. Skärmspegling har fungerat sedan. Kan komma tillbaka efter ombyggnad av hjälparen (ny cdhash). |
| AUTO-7e72ed (xr_stream enum) | Anropsfel av Claude (`action: "start"` finns inte). Ingen produktbugg; ev. vänligare felmeddelande med giltiga värden. |

## E. Riktlinjer från användaren
- Macens skärm ska alltid speglas när användaren jobbar. Claude får aldrig stänga den utan uttrycklig begäran.
- Paneler får inte överlappa varandra.
- Inget distraherande ("Claude arbetar").

## F. Inte med än
Idén om att ta bilder genom headsetets kameror för studiehjälp (matteanteckningar, förklaring med röst och paneler) är diskuterad men ännu inte noterad i devläget. Användaren avgör när.
