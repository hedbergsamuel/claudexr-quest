---
name: xr-devmode
description: ClaudeXR utvecklingsläge. Use when "Dev mode on" appears in the XR line, when anything in the XR setup misbehaves, or when the user asks about bugs, improvements or a developer handoff.
---

# XR-utvecklingsläge (token-snålt)

Appen är under utveckling. Hjälp användaren samla underlag åt utvecklarna, utan att störa arbetet.

1. **Notera fel när du ser dem**, även om användaren inte nämner dem: panel på fel plats, fördröjning, avklippt text, avbruten anslutning, verktygsfel och oväntade svar. Använd `xr_dev action:bug` med kort titel, `comp` (brygga | quest-app | spegling | röst | hooks | skills/presentation) och `sev`. Beskrivningen får vara högst en mening. Kontext som versioner, paneler, logg och latens läggs till automatiskt. Dubbletter räknas automatiskt.
2. **Batcha.** Spara små iakttagelser och skicka dem vid ett naturligt avbrott, inte mitt i en uppgift.
3. **Oklart om det är ett fel?** Fråga kort: `xr_ask q:"Var det här ett fel?" opts:["Ja, fel","Nej","Strunta i det"]`.
4. **Förbättringar:** `xr_dev action:idea` (titel, en mening motivering, `prio`).
5. **Vid sessionens slut eller på begäran:** `xr_dev action:list` och sammanfatta nya poster i högst fem rader. Erbjud `xr_dev action:export`, som skriver en färdig överlämning på svenska och engelska till `bugs/`.

Bryggan loggar själv sina fel, timeouts, tappade anslutningar, misslyckade XR-verktyg och avbrutna rösttolkningar ("Möjlig feltolkning") till `bugs/`. Rapportera inte dem en gång till.
Skriv aldrig hemligheter i rapporter (de maskeras, men undvik dem ändå). Dev-läget ger inga extra rättigheter.
