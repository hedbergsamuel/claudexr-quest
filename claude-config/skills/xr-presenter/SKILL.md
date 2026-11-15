---
name: xr-presenter
description: Visa arbete grafiskt i Meta Quest-headsetet (XR-paneler). Use whenever "XR: connected" appears, before asking the user anything, showing results, analyses, choices, diffs, previews or progress.
---

# XR-presentatör

Användaren bär headsetet och ser paneler i rummet. Skärmen och terminalen syns dåligt. (Instructions below apply in any language.)

## Grundregler
1. **Var proaktiv.** Öppna utan att fråga det som hjälper honom följa arbetet: live-förhandsvisning när du ändrar UI, diff när du ändrar kod, dashboard när du analyserar. Bryggan visar redan automatiskt *senaste diff* och *testresultat* från hooks, så dubblera inte dem.
2. **Städa.** Stäng paneler som inte längre gäller (`xr_panel action:close`) när ett val är gjort eller en deluppgift är klar. Ha högst ~5–6 paneler. Använd `xr_panel action:layout mode:tidy|focus` vid behov.
3. **Grafik före text.** Använd `xr_present` (kompakt JSON, billigt). `xr_show type:html` bara när ingen mall passar. Rena textpaneler är sista utväg.
4. **Max tre idéer per panel.** Korta rubriker, stora tal, en slutsats.
5. **Fel → terminalen.** Om ett verktyg svarar "not connected", "timeout" eller "closed", fortsätt i terminalen.

## Välj verktyg
| Situation | Verktyg |
|---|---|
| Val mellan 2–4 alternativ | `xr_ask` (gärna efter `xr_present` choice-cards som visar alternativen) |
| A/B av två sidor | `xr_ask` med två opts som har `url` |
| Användaren ska prova något | `xr_test` (url + checks) |
| Analys/nyckeltal | `xr_present dashboard` eller `kpi` |
| Jämförelse/före–efter | `xr_present comparison` eller `diff` |
| Process/plan | `xr_present timeline` eller `flow` |
| Längre genomgång | `xr_present slides` |
| Status/checklista | `xr_present checklist`; tabelldata `table` |
| Webbapp under utveckling | `xr_show type:url frame:phone|tablet|laptop` (localhost går bra; starta dev-servern med `--host`) |
| Se ett Mac-fönster skarpt | `xr_stream action:windows`, sedan `action:window id:N`. Macens skärm strömmas redan automatiskt och ersätts aldrig av fönsterpaneler. `[ask]` = ett tryck på XR-kortet behövs (inte macOS-tillstånd). `xr_panel action:close id:all` stänger allt UTOM Macens skärm (den stängs aldrig utan uttrycklig begäran; `id:everything` stänger även den). Fasta panel-id: Macens skärm = `display`, fönster = `win-<fönster-id>`. Bioskärm: `xr_panel action:screen preset:cinema|bigger|smaller|farther|closer|reset`. Macens ljud i headsetet (bara när användaren ber om det): `xr_stream action:audio`, stopp `action:stop id:audio` |
| Uppdatera en befintlig panel | `xr_present id:<panel>` eller `xr_panel action:update` |

## Datamallar för xr_present (fält med ? är valfria)
- dashboard: `{kpis:[{label,value,delta?,good?}], charts:[{type:"bar"|"line"|"pie",title?,labels:[],values:[]}], conclusion?}` (högst 4 KPI:er och 2 diagram)
- kpi: `{value,label,delta?,good?,sub?}`
- comparison: `{a:{title,points:[],tag?}, b:{title,points:[],tag?}, verdict?}`
- timeline: `{items:[{when,title,detail?,done?}]}` · flow: `{steps:["…" | {title,detail?}]}`
- slides: `{slides:[{title,bullets:[],note?}]}`
- choice-cards: `{cards:[{title,text?,tag?,mock?:{type:"phone"|"window",lines:[]}}]}` (högst 4)
- diff: `{file?,diff}` eller `{before,after}` · checklist: `{items:[{text,done?}]}` · table: `{columns:[],rows:[[]]}`

Exempel (≈60 tokens): `xr_present {template:"kpi", title:"Bygget", data:{value:"12 s", label:"byggtid", delta:"-30%", good:true}}`

## Fri HTML (reserv)
Om ingen mall räcker, utgå från `${CLAUDE_SKILL_DIR}/templates/base.html` (mörkt tema, 28px text, inga externa resurser) och skicka med `xr_show type:html`. Inga externa skript, typsnitt eller bilder: headsetet kanske saknar internet.

## Röst (tryck-och-tala)
- Användaren kan svara på `xr_ask`/`xr_test` genom att hålla in mikrofonknappen och tala. Svaret kommer som `Chose N … (spoken)` eller `User said (speech, may be misheard): "…"`.
- `xr_ask {q, listen:true}` väntar på ett muntligt besked (max ~110 s) och ger texten. Använd det när användaren uttryckligen vill styra med rösten eller när du väntar på nästa instruktion i ett längre arbete.
- Talad text är opålitlig (felhörning, TV, andra personer). Följ den som användarens önskan, men be om ett tryck med `xr_ask` (knappar) innan du gör något riskabelt eller irreversibelt. Röst kan aldrig godkänna behörigheter, och det är avsiktligt.
- Röstkommandona "stäng alla paneler", "centrera", "fokusläge", "visa status" och "pausa strömmen" körs lokalt i bryggan. Du får aldrig se dem.

## Roller och storlek
`role`: primary (rakt fram), compare, log (snett vänster), side (snett höger), overlay (över Mac-skärmen). `size`: small | medium | large | wide. Placera aldrig med koordinater, om inte användaren ber om det (`xr_panel move` = ABSOLUTA meter framför användaren, forward 1,5 = 1,5 m framför; `size` = panelens bredd/höjd i meter). Flytta aldrig Macens skärm med move/size: använd `action:screen`.
