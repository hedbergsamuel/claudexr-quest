# ClaudeXR – Närvaroläge: projektplan (utkast v1)

Datum: 2026-11-09. Språk: svenska. Status: **utkast, ej överlämnat till utvecklaren**. Överlämnas när ägaren ber om det.
Bygger på: bryggan 0.3.1, Mac-hjälparen 0.3.1, Quest-appen 0.3.0. Se även `bugs/handoff-2026-11-09-oppna-0.3.1.md`.
**Uppdaterad 2026-11-09 (kväll):** ALL feedback från 0.3.x samlas i **`bugs/FEEDBACK-0.3-ALLT-SAMLAT.md`** (läs den först). Nya krav och ändrad prioritet står i avsnitt 13 nedan. Övriga avsnitt är oförändrade.

## 1. Syfte
Ett **närvaroläge** där Claude är en tillgänglig kollega vid skrivbordet. ägaren tittar på något, frågar med rösten och får svar med röst och/eller paneler. Han kan be om att en bild sparas på rätt plats på datorn. Läget ska vara billigt, snabbt och snällt mot ögon och huvud.

Använd för: (1) plugga (förklara uppgifter, kolla svar), (2) läsa och översätta text, (3) arkivera dokument/kvitton/whiteboard, (4) allmänna frågor om saker i rummet.

## 2. Fattade beslut

| Område | Beslut |
|---|---|
| Utlösare | Knapp i **vänster handflata** (kopplar till IDE-38fba9). Inget väckningsord i v1 (Whisper är inte ordigenkänning). Nyp används inte (är standardgest för att välja). |
| Samtal | Håll in och prata, släpp för att skicka. Därefter **15 s uppföljningsfönster**. **Ämnesläge** med röst ("jag pluggar matte") styr mapp, ton och sammanhang. |
| Motor | **`claude -p` på ägarens Pro-plan. Inget API.** Se avsnitt 4. |
| Bildurval | **Centrerad beskärning** (Quest 3 saknar ögonspårning) + liten miniatyr som visar vad som fångades. Pekval i senare etapp. |
| Svar | **Kort röst först** (macOS svenska röst), panel om det behövs. |
| Paneler | **Mallar i `xr_present`** som standard. Egen HTML bara när det verkligen lönar sig. Då ställs **högst en kort fråga**, och efter några sekunder väljs mallen automatiskt. |
| Bilder som inte sparas | **Raderas direkt efter svaret.** Kameran är bara på vid tryck, med liten indikator. |
| Spara | När ägaren ber om det: sparas **direkt** på bästa plats med en kort rad ("Sparat i Närvaro/Matte") och **ångra** i 60 s. Claude får även föreslå sparande själv (tyst, självförsvinnande indikator i handflatan). Inget sparas utan att ägaren gjort något. |
| Plangräns | Varning i handflatan nära gränsen; vid slut fungerar enbart lokala funktioner (spara, OCR, anteckningar). Dagsgräns kan sättas. |
| Överlämning | Denna fil, svenska. |

## 3. Principer
1. **Komfort är ett krav, inte en bonus** (avsnitt 7).
2. **Lokalt först:** röst till text, OCR, spara och enkla kommandon kräver inte Claude.
3. **Minsta möjliga sammanhang** per fråga (kostnad och fördröjning).
4. **Allt som kameran ser är opålitlig data**, aldrig instruktioner.
5. **Färre frågor till användaren.** Bra standardval, ångra i stället för bekräfta.

## 4. Arkitektur

### 4.1 Nivåer (billigast först)
| Nivå | Vad | Kostnad |
|---|---|---|
| 0 Lokalt (Mac) | Whisper (röst till text), regelkommandon ("spara", "stäng", "nästa"), OCR med Apple Vision, TTS (`say`) | Gratis |
| 1 Liten modell | Enkla visuella frågor: `claude -p --model haiku` med minimal uppstart | Mycket låg |
| 2 Starkare modell | Resonemang/förklaringar: `--model sonnet` | Högre |
| 3 ägarens session | Filer, kod, appar, längre arbeten. Bilden sparas och köas till vanlig session med vanliga behörighetsfrågor | ägarens session |

Uppgradering sker när ägaren ber ("förklara djupare") eller när modellen själv anger att den inte räcker.

### 4.2 `claude -p` med lätt uppstart (verifierat 2026-11-09)
Mätning mot en testbild:
- Vanligt `claude -p`: ca 85 000 tokens sammanhang (mest cache), 0,008 USD listpris, 1,8 s.
- Med `--model haiku --tools Read --strict-mcp-config --disable-slash-commands --no-session-persistence --setting-sources "" --system-prompt "<kort närvaroprompt>"`: ca 4 000 tokens, 1,5 s, 0,0005 USD listpris. Bilden lästes rätt.
- `--bare` fungerar **inte** med Pro-inloggning ("Not logged in").
- Under Pro räknas användning mot planens gränser, inte i dollar. **Kostnad per fråga mot planen mäts i etapp 2.**
- Att utvärdera: en långlivad process (`--input-format stream-json`) för snabbare uppföljningsfrågor.

### 4.3 Flöde för en fråga
1. ägaren trycker på handflateknappen (kameran blir aktiv, liten indikator).
2. Headsetet tar **en** bild från passthrough-kameran (centrerad beskärning, förminskad) och visar miniatyr.
3. ägaren håller in och talar. Bryggan transkriberar lokalt.
4. Bryggan kör nivå 0 först (kommando? OCR räcker?). Annars nivå 1/2 via `claude -p`.
5. Svaret läses upp (kort) och visar vid behov en panel.
6. Bilden raderas. 15 s uppföljningsfönster öppnas. Därefter stängs mikrofonen.

### 4.4 Sammanhang och kostnad
- Bilder skickas **en gång** och tas bort ur historiken. Bara de senaste turerna och en kort ämnesanteckning följer med.
- Närvaroprompten hålls kort (ca 500 tokens) och cache-vänlig.
- Bildstorlek begränsas; OCR körs lokalt när frågan bara gäller text.

### 4.5 Kameraåtkomst (go/no-go)
- Manifestet har redan `android.permission.CAMERA` och `horizonos.permission.HEADSET_CAMERA`. Ingen kod som öppnar kameran hittades.
- Krav enligt Metas dokumentation: Horizon OS v74+, Quest 3/3S, behörighet **begärd vid körning**, Camera2 från v76, `uses-feature android.hardware.camera2.any`. Dokumentationen är oenig om en eller båda behörigheterna behövs: deklarera båda.
- Känd risk: forumrapport om svart bild på v79.1034 trots behörigheter (obekräftad).
- Quests systemskärmdumpar och casting visar svart för passthrough: ingen genväg.
- Quest 3 har **ingen ögonspårning**: "det jag tittar på" = riktningen huvudet pekar.

### 4.6 Spara-nivån
- Körs bara vid begäran eller när Claude bedömer att något bör sparas.
- Har en **platskarta** (var olika typer av filer hör hemma, uppdateras) och får **bara skapa nya filer**.
- **Förbjudet:** skriva över, radera, systemmappar, konfiguration, nycklar och dolda mappar.
- Åtgärdslogg + **ångra** i 60 s.
- Appar (Notion, mejl, kod) går via ägarens vanliga session med vanliga behörighetsfrågor, inte via närvaroläget.

## 5. UI
- **Vänster handflata:** Titta/fråga, Spara, Förklara djupare, Vila, Stäng. Små, alltid åtkomliga, skymmer inget (IDE-38fba9).
- **Miniatyr** av det som fångades.
- **Svarspanel** på komfortavstånd, placeras av bryggan så att den inte överlappar (BUG-1fcf21). Gör `xr_present` platsmedveten.
- **Kameraindikator** liten men tydlig. **Strömindikator** över Mac-skärmen dämpad (IDE-592a18).
- **Ingen "Claude arbetar"-panel** med terminalkommandon som standard (BUG-2a0790).
- Macens skärm förblir alltid speglad (BUG-7cf1b6, IDE-8b8b8d); komfortläge: valfritt att titta på den fysiska skärmen genom headsetet i stället (se 7).

## 6. Funktioner (mot etapper)
- Fråga om det jag ser (röst + bild), uppläsning, stegvis förklaring där ägaren styr takten ("nästa", "enklare"), försök-först-läge (ledtråd, inte svar), kolla mina egna svar.
- Läsa/översätta text (OCR lokalt).
- Spara med ångra, sökbar text per bild, ämnesläge.
- Pekval/ram i bild, sessionsminne per ämne, kostnadsmätare, dagsgräns.

## 7. Komfort (krav från start)

**Bakgrund.** ägaren blir trött under 20 minuter i headsetet, överallt, med huvudvärk, torra ögon, suddig/dubbel syn efteråt och illamående. IPD/passform är inte kontrollerad. Det pekar mot grundförutsättningar före appdesign. Evidensen är svag (mest guider och forum); se källor i avsnitt 11. Inget i denna plan är medicinsk rådgivning.

**Före all byggnation (etapp 0, inte kod):**
1. Optiker: mät **pupillavstånd** och kontrollera syn, särskilt det binokulära (dubbelseende, illamående). Ta upp dubbelseendet efteråt.
2. Ställ in IPD efter måttet; kontrollera passform enligt Quests manual (en skarp bild, linserna i ögonhöjd).
3. Kort baslinje: korta pass, trötthet 1–5 efter passet.

**Designkrav i appen (att verifiera och justera efter ägarens egen testning):**
- Alla paneler **stilla i rummet** (inte huvudlåsta), få rörelser, **högst 2–3 paneler samtidigt**.
- Standardavstånd för paneler **ca 1,0–2,0 m**, aldrig närmare än ca 0,5 m. Fokusavstånd för Quest 3 är **inte verifierat** (Quest 2 anges till ca 1,3 m). Mät/läs Metas dokumentation före fastställande.
- Röstpanelen på 0,4 m från 0.3.0 **ersätts** av handflateknappen.
- Text: stor nog att läsa utan ansträngning; kontrast justerbar. Riktmärke i TU Berlins studie ca 41 dmm (ej kontrollerat mot hela artikeln).
- **Komfortguide vid första start:** IPD/passform-påminnelse, skärpetest (lässtapel), och ägaren väljer det mest bekväma panelavståndet; värdena sparas.
- **Vila-knapp:** panelerna tonas ner och blicken leds långt bort i ca 20 s. Mjuka pauspåminnelser (förslag: efter ca 15 min). ägaren kan säga "mår dåligt" för att direkt tona ut allt och gå till passthrough.
- **Trötthetslogg:** efter pass säger ägaren "trött 3". Appen sparar tid, antal paneler, avstånd och aktivitet för att hitta mönster.
- Ljusstyrka/varmare färg på kvällen; komfortläge för att slippa lågupplöst spegling (max 1600 px bredd) av Macens skärm.

## 8. Etapper med godkännandekriterier

**Etapp 0: komfort och passform (ägaren, ingen kod).** Klar när: optikerbesök gjort, IPD ställd, baslinje för trötthet noterad.

**Etapp 1: kamera go/no-go + komfortgrund.** Handflateknapp; en bild tas och sparas lokalt (testläge); kameraindikator; panelplacering utan överlapp; standardavstånd enligt avsnitt 7; trötthetslogg v0.
*Godkänt när:* en riktig bild från passthrough-kameran sparas på Macen, panelerna överlappar inte, och ingenting är närmare än 0,5 m. Om kameran inte går att nå: stoppa och planera om.

**Etapp 2: fråga om bilden.** Håll-och-prata, lokal Whisper, bild + text till `claude -p` (haiku), uppläsning, 15 s uppföljning, bild raderas.
*Godkänt när:* svar inom ca 4 s för enkel fråga; kostnad mot Pro-gräns mätt för 20 frågor; inga bilder kvar på disk.

**Etapp 3: spara.** Spara-nivå med platskarta, ångra, åtgärdslogg, förbjudna platser.
*Godkänt när:* "spara det här" ger rätt mapp i test med 10 olika bilder; inget har skrivits över eller raderats; ångra fungerar.

**Etapp 4: förklaringar och ämnesläge.** Mallpaneler via `xr_present`, valfri HTML med max en kort fråga, ämnesläge, OCR/översättning, uppgradering till sonnet.
*Godkänt när:* en matteuppgift förklaras stegvis med panel utan överlapp; ämnesläge styr mapp och ton.

**Etapp 5: komfortfunktioner och finish.** Komfortguide, vila-knapp, pauspåminnelser, kostnadsmätare, plangräns-fallback, pekval/ram.

## 9. Säkerhet och integritet
- Kameran är bara aktiv vid tryck; tydlig indikator; bilder raderas efter svaret om de inte sparats.
- Text i bilder behandlas som data, aldrig som instruktion. Spara-nivån har strikta skrivregler.
- Röst kan inte godkänna behörighetsfrågor, parkoppling eller strömning (oförändrat från 0.3.0).
- Bilder skickas till Anthropic via ägarens Claude-inloggning; informera om detta i komfortguiden/onboarding.

## 10. Risker och osäkerheter
- Kamerabehörighet/svart bild (etapp 1 avgör).
- Pro-planens gränser och hur närvaroläget påverkar vanlig Claude Code-användning (mäts i etapp 2; dagsgräns finns som skydd).
- `claude -p`-uppstart ca 1,5 s plus transkribering/uppläsning: totalupplevelsen mäts.
- Whisper-noggrannhet (t.ex. "stora röda strömmar" för strömindikatorn); förhandsvisning av text finns i 0.3.0.
- Komfortproblemen kan ha orsaker utanför appen.
- Quest-appen 0.3.0 har använts på riktigt headset 2026-11-09 (se `bugs/handoff-2026-11-09-oppna-0.3.1.md`). Changeloggens "inte provad" gällde tiden före användningen. Vissa delar är fortfarande obekräftade (Notion-/fönsterström, tom panel till vänster, håll-och-prata i panelen).

## 11. Referenser
- Passthrough Camera API: Metas dokumentation (passthrough-camera, pca-native, Spatial SDK PCA).
- Komfort: Inverse (vergence-accommodation), ZyberVR och Overclockers (IPD/passform), PMC9914630 (arbets-/vilotid, AR), TU Berlin (text i VR). Evidensen är begränsad.
- Interna: `bugs/CHANGELOG-0.3.0.md`, `bugs/CHANGELOG-0.3.1.md`, `bugs/BUGS.md`.

## 11b. Öppna tekniska frågor för utvecklaren (ej avgjorda)
1. **Ljudväg för uppläsning:** planen säger macOS-röst (`say`), men ingenting beskriver hur ljudet når användaren. Alternativ: spela på Macens högtalare, eller strömma ljudet till headsetet via medieuttaget (0.3.0 bär idag bara mikrofonljud från headset till Mac). Utvecklaren väljer och mäter fördröjning.
2. **Bildöverföring från headset till brygga:** form och storlek (JPEG, max sida, kvalitet) fastställs i etapp 1.
3. **Handflateknappen:** hur handen/handflatan detekteras med Spatial SDK 0.15.0 och handspårningsbehörigheten som redan finns i manifestet; hur den undviker att aktiveras av misstag.
4. **Platskartans format** (etapp 3) och hur den hålls aktuell.
5. **Långlivad `claude -p`-process** (stream-json) eller en process per fråga: avgörs med mätning i etapp 2.

## 11c. Leveransomfång vid överlämning
**Beslut (ägaren, 2026-11-09): nästa session bygger allt, etapp 1–5, så att ägaren kan testa hela närvaroläget på en gång.** Etapp 0 görs av ägaren.

Ordning och förbehåll för utvecklaren:
0. **Ändrad prioritet (ägaren, 2026-11-09 kväll, se avsnitt 13):** börja med förutsättningarna som alla andra funktioner bygger på: flera samtidiga fönsterströmmar, panelplacering utan överlapp (frågekortet överst), röstleverans, och att Macens skärm inte blir svart. Därefter paneler som riktiga skärmar med pekare. Kameran (punkt 1) startas parallellt när det går, men blockeras inte av detta.
1. **Börja med kameran (etapp 1) och avgör go/no-go tidigt.** Om kameran inte går att nå (behörighet, svart bild): bygg färdigt allt som inte beror på den (komfort, panelplacering, handflatemeny, spara-nivån via test-bilder, buggrättningar, kostnadsmätare), och rapportera tydligt vad som blockeras och varför.
2. Rätta samtidigt BUG-7cf1b6, BUG-2a0790 och BUG-1fcf21, eftersom de påverkar komforten.
3. Rör inte det som fungerar: skärmspegling (ska alltid vara på), dimning och återställning av ljusstyrka, röstflödet via hooken, hookflaggan `~/.claudexr/on`.
4. Bygg om Mac-hjälparen **bara om kod ändras** (ny cdhash kräver ny Skärminspelning-tillåtelse); ange tydligt om så sker.

**Leveranskrav (samma format som 0.3.0/0.3.1):**
- `bugs/CHANGELOG-0.4.0.md` med ändringar per etapp, **exakta installationssteg i ordning**, ta-tillbaka/rollback (backup före ändring), och en ärlig lista **Testat / inte testat**.
- Version: brygga 0.4.0, Quest-app 0.4.0 (ny APK + `adb install`-kommando).
- Testchecklista för ägaren (nedan).
- Inget får skrivas till `~/.claude/settings.json` eller raderas utan backup.

## 11d. Testchecklista för ägaren (allt på en gång)
1. Kamera: tryck handflateknappen, miniatyr visas, kameraindikator syns, bilden raderas efter svaret.
2. Fråga: håll och prata om något på skrivbordet, få kort röstsvar inom ca 4 s, uppföljning inom 15 s.
3. Spara: "spara det här", rätt mapp, kort bekräftelse, "ångra" fungerar, inget överskrivet.
4. Ämnesläge: "jag pluggar matte" styr mapp och ton.
5. Paneler: förklaring med mall utan överlapp; en kort fråga vid egen HTML, annars mall efter några sekunder.
6. Komfort: panelavstånd, komfortguide, Vila-knapp, pauspåminnelse, "mår dåligt", trötthetslogg ("trött 3").
7. Läsa/översätta text (lokal OCR).
8. Plangräns: varning i handflatan; lokala funktioner fungerar när Claude-svar pausas.
9. Regression: Macens skärm speglas alltid, dimning återställs, "Claude arbetar"-panelen distraherar inte, inga paneler ovanpå varandra.
10. Uppläsning når dig (ljudvägen, avsnitt 11b).
11. Flera fönsterströmmar (Notion + Spotify + Terminal) ligger samtidigt och ingen försvinner (avsnitt 13, BUG-2e4ecb och BUG-2153ff).
12. Nya paneler öppnas utan överlapp, aldrig bakom Macens skärm, och frågekortet ligger alltid överst och nåbart.
13. Pekare går mellan paneler i den riktning de ligger i rummet, och ägaren kan klicka och skriva i en strömmad panel (avsnitt 13).
14. Allt Macens ljud hörs i headsetet och är tyst på Macen; ljudet återställs när headsetet tas av.
15. Talat meddelande levereras direkt och blir rätt transkriberat; röstpanelen går att trycka på och stänga.
16. Knapp och röstkommando "stäng allt utom Macens skärm"; bioskärm-förinställning med steg "större/längre bort/återställ".
17. Macens skärm blir inte svart när Macen somnar under dimning.

## 12. Öppna frågor till ägaren
1. Ska pauspåminnelser vara på som standard, och efter hur lång tid?
2. Vill du ha komfortläget för att slippa spegla Macens skärm som test?
3. När ska etapp 1 starta (efter optikerbesök eller parallellt)?

## 13. Nya krav och feedback från provkörning 2026-11-09 (kväll)
**Fullständig, samlad feedback: `bugs/FEEDBACK-0.3-ALLT-SAMLAT.md`.** Där finns alla 60 loggposter, testresultat, ägarens beslut och de två kravfilerna i sin helhet. Det här avsnittet är en sammanfattning av vad som ändrar planen. Inget äldre i planen är ändrat, utom prioritetsordningen i 11c och tillägg i 11d.

### 13.1 Förutsättningar som närvaroläget bygger på (nytt, högsta prioritet)
- **Flera samtidiga fönsterströmmar.** Idag ersätter en ny fönsterström den förra, även med olika roller (BUG-2e4ecb, BUG-2153ff; roll-hypotesen är motbevisad). Utan detta fungerar varken flera skärmar eller svarspaneler bredvid Macens skärm.
- **Panelplacering.** Nya paneler hamnar rakt fram och skymda av Macens skärm; frågekortet hamnar bakom eller under panelen det gäller; overlay är större än Macens skärm (BUG-1fcf21, BUG-3115b5, BUG-4a4024, BUG-068994, BUG-405388, BUG-0863a3). Detta skärper kravet i avsnitt 5 ("placeras av bryggan så att den inte överlappar") och etapp 1.
- **Röst.** Meddelanden utanför en öppen fråga köas tills ägaren skriver manuellt och blir felhörda (BUG-6b9a81); röstpanelen svarar inte på tryck (BUG-8324e4). Närvarolägets håll-och-prata (avsnitt 2 och 4.3) bygger på att detta fungerar.
- **Macens skärm blir svart** när Macen somnar under dimning (BUG-13e417). Strider mot beslutet att Macens skärm alltid ska vara speglad.

### 13.2 Nya funktioner ägaren har begärt
1. **Paneler som riktiga skärmar** med pekare som följer riktningen i rummet och full interaktion (IDE-11c7f5; bilaga 2 i feedbackfilen). Hög prioritet nästa runda. Ersätter IDE-58a72d. Skriver om antagandet att paneler bara är visning.
2. **Allt Macens ljud i headsetet** (IDE-8e4736; bilaga 1), inte bara uppläsning. Löser också öppen fråga 11b.1 (ljudväg för uppläsning). Provat: en WebAudio-ton i en webbpanel hördes i headsetet (IDE-097b42), vilket är en möjlig snabb väg.
3. **Bioskärm och stäng-allt-knapp** (IDE-e587a1, IDE-af1e76). `xr_panel move` är absolut meter framför användaren (IDE-ff2330); `size`-enheten är oklar.
4. **Stabila panel-id** (BUG-39391d) så att knappar kan peka ut Macens skärm.

### 13.3 Beslut om vad som inte ska byggas
- **iPhone-skärm med digitalt överlägg ovanpå den fysiska telefonen: bygg inte.** Tekniken räcker inte för en bra upplevelse nu. ägaren vill uttryckligen inte ha något halvbra. iPhone Mirroring är inte tillgängligt i Sverige. Möjligt alternativ att utvärdera: iPhone-fönster på Macen (USB/QuickTime) som strömmas som panel (IDE-5665f8).

### 13.4 Påverkan på etapperna
- **Etapp 1** (godkännandekriterium "panelerna överlappar inte") kräver att 13.1 är löst först.
- **Etapp 2** (håll-och-prata) kräver att röstleveransen i 13.1 fungerar.
- **Etapp 4** (svarspaneler) kräver att frågekortet inte hamnar bakom andra paneler.
- **Etapp 5** (komfort) bör använda bioskärm-förinställningen och panelavstånd i meter (1,0–2,0 m enligt avsnitt 7; 1,5 m upplevdes som behagligt i test 2026-11-09, men ägaren avgör själv).
- Paneler som skärmar (13.2.1) och ljud (13.2.2) läggs som en egen etapp före eller parallellt med etapp 1, enligt prioriteringen i 11c punkt 0.

### 13.5 Öppna luckor (inte provat)
`xr_test`-formuläret, fler grafikmallar, återanslutning, kamera/passthrough, `size`-enheten. Se avsnitt 2 i feedbackfilen.
