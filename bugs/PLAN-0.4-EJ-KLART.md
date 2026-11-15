# Det som INTE är klart i 0.4.0, och varför (fas 2)

> **Uppdatering 0.4.1 (2026-11-15):** punkt 3, 7 och 8 är byggda i kod och punkt 6 är inkopplad bakom grinden
> (utan CGEvent). Inget av det är bevisat i headset eller på riktig Mac. Se `bugs/CHANGELOG-0.4.1.md`. Texten nedan
> gäller 0.4.0.

Skriven av nattutvecklaren (fas 2). Principen: hellre "inte klart, beror på X" än något halvbra.

## Punkt 3: röstleverans (BUG-6b9a81, BUG-8324e4, BUG-82a49d, BUG-36fba1): EJ BYGGD
Beror på: en designändring som fas 1 inte hann med. Talat meddelande utanför en öppen fråga köas till nästa prompt
(`VoiceInbox`, `channelAlive()` i `hub.ts`). Direktleverans kräver en lyssnande röstkanal i Claude-sessionen och bättre
svensk transkribering (felhörningen "Macen syns" → "Ja, maken sings"). Båda kräver test med riktig session och riktigt tal.
Nästa steg: mät först om röstkanalen (`channelAlive`) startas som standard; välj sedan transkriberingsmodell med svenska.

## Punkt 6: paneler som riktiga skärmar (IDE-11c7f5, bilaga 2): ENDAST GRÄNSSNITT
Byggt: `bridge/src/input.ts` (koordinatmappning panel → målrektangel, `InputGate`: av som standard, bara fysisk knapp i
headsetet kan slå på, röst och MCP nekas, `sensitive` stänger vid lösenordsfält), enhetstestat. **Inte inkopplat.**
Inte klart, beror på:
1. CGEvent-insprutning i Mac-hjälparen kräver Hjälpmedel-behörighet och riktig Mac. Får inte köras under natten.
2. Virtuella skärmar per panel och synk av macOS skärmarrangemang ändrar Macens skärmar. Förbjudet att bygga för körning under natten och omöjligt att verifiera utan Mac.
3. Pekare i headsetet (ray från kontroll/hand mot panelens quad) kräver Spatial SDK-test med hårdvara.
4. Skarp text i panelens egen upplösning: beror på mätning i headsetet.
Rekommenderad ordning när ägaren är vaken: (a) verifiera att flera strömmar lever (punkt 1), (b) Hjälpmedel-behörighet och ett
enda `move`-event från bryggan, (c) pekare i headsetet, (d) virtuella skärmar sist.

## Punkt 7: Macens ljud i headsetet (IDE-8e4736, IDE-097b42): EJ BYGGD
Beror på: ljudfångst från hela Macen (ScreenCaptureKit `capturesAudio` i hjälparen, eller en virtuell ljudenhet som BlackHole)
kräver riktig körning och skärminspelningsbehörighet; ändring av Macens ljudutgång är förbjuden under natten. Idén i IDE-097b42
(WebAudio/Opus i en webbpanel) är obeprövad. Förslag: `serve` får ett kommando `audio-start` som skickar Opus-ramar märkta
`a:<strömid>` på samma stdout-protokoll, och Quest-appen spelar via `AudioTrack`. Mät fördröjning (mål < 150 ms) före allt annat.

## Punkt 8: trådat läge via USB (IDE-8fc855, IDE-a56e94): EJ BYGGD
Villkoret var att punkt 1–7 först är klara. De är det inte (3, 6 och 7 saknas), och tunneln (`adb reverse`) kräver kabel
och `adb` mot headsetet, vilket är förbjudet under natten.

## Punkt 9: närvaroläget (etapp 1–5): EJ BYGGT
Planens första steg är kameran som go/no-go. Det går inte att avgöra utan headset (Passthrough Camera API, behörighet,
bildfrekvens). Inget byggs före ett ja. Kamerabilder är opålitlig data, aldrig instruktioner (plan avsnitt 3). iPhone-överlägg ska inte byggas.

## Punkt 10: övrigt
- BUG-cc393a (kalibrering): bara bättre felmeddelanden (`calibrationHint`). Orsaken till själva timeouten är obekräftad.
- Panelplacering (punkt 2): PlacementPlanner + enhetstester gröna, men hela placeringen är obevisad i headsetet.
