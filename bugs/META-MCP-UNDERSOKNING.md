# Metas utvecklar-MCP för Quest: undersökning (2026-11-15)

Inget installerat, kört eller parkopplat. Bara läsning av webbsidor. Märkning: [KÄLLA] = står i källan, [GISSNING] = min slutsats.

## Sammanfattning och rekommendation

- MCP:n finns och är officiell. Den heter **Meta VR CLI (`metavr`)**, tidigare **Horizon Debug Bridge (`hzdb`)**, och är både en CLI och en MCP-server. Utgivare: Meta. Paket `@meta-quest/hzdb` (npm, permanent alias), plugin `meta-quest/agentic-tools`.
- Den är inte en "parkoppla med headsetet"-MCP i sig. Den pratar med headsetet via ADB-protokollet (eget inbyggt bibliotek, valfri separat adb-binär). Utvecklarläge och USB-felsökning krävs fortfarande. Trådlöst går via ADB över Wi-Fi (`device wifi enable`, `device connect <ip>`).
- **Den ersätter inte ADB som teknik, bara adb-programmet som beroende.** Den innehåller `app install`, `files push/pull` och (enligt en tredjepartskopia av hzdb-skillen) `adb forward` och `adb reverse`. Det är samma mekanismer som ClaudeXR använder idag.
- Slutsats: ClaudeXR kan **inte** slippa utvecklarläge/ADB-kanalen, men kan slippa att användaren installerar `adb` separat, och kan få trådlös installation. Körningen (Quest-appen mot Macens WSS/Bonjour på LAN) behöver varken ADB eller MCP och är oförändrad.
- Rekommendation: bygg inte om ClaudeXR kring MCP:n. Överväg i punkt 8 (trådat läge) att anropa `hzdb`/`metavr` som CLI i stället för `adb` (samma kommandon, inget adb-beroende), och verifiera `reverse` med `--help` innan beslut. MCP-servern är mest användbar som utvecklarhjälp för Claude Code (logg, skärmdump, installera), inte som del av produkten.

## 1. Namn, utgivare, version, installation

- [KÄLLA] Namn: Horizon Debug Bridge (hzdb) i äldre docs, nu omdöpt till Meta VR CLI (`metavr`). `hzdb` och `@meta-quest/hzdb` finns kvar som "permanenta alias". https://developers.meta.com/vr/essentials/metavr-overview/
- [KÄLLA] Presenterades i Unite Seoul-sammanfattningen daterad 22 juli 2026 (eventet 21 juli). https://developers.meta.com/horizon/blog/unite-seoul-2026-meta-quest/
- [KÄLLA] Översiktssidan visar "last_updated" 2026-10-22; inget versionsnummer för CLI:n. MQDH-vägen kräver Meta Quest Developer Hub v6.2.1 eller senare. https://developers.meta.com/horizon/documentation/web/ts-mqdh-mcp/
- [KÄLLA] Installationsvägar: (A) VS Code/Cursor/Antigravity-tillägget "Meta Horizon", (B) MQDH, fliken AI Tools, (C) agentic-tools-plugin, (D) npm/`npx`. Native installer för macOS/Linux/Windows; `npx metavr@latest init` ställer in skills och MCP-konfig. Använd bara en väg åt gången (annars dubbla verktyg).
- [KÄLLA] Node.js 18+ för npm-vägen. Inget konto krävs för att installera/köra MCP-servern; inloggning (öppnar webbläsare) behövs bara för Horizon Store-kommandon.
- [KÄLLA] Apache-2.0 för agentic-tools (32 skills). https://github.com/meta-quest/agentic-tools (min direkthämtning av GitHub och npm gav timeout/403, så uppgifterna kommer via Metas docs och sökträffar).

## 2. Parkoppling med headsetet

- [KÄLLA] USB: datakabel, slå på utvecklarläge och USB-felsökning (Settings > System > Developer), godkänn datorn i headsetet.
- [KÄLLA] Trådlöst: `metavr device wifi enable` (slår på ADB över Wi-Fi) följt av `metavr device connect <ip>` (port 5555 som standard). https://developers.meta.com/vr/essentials/metavr-devices-and-apps/
- [GISSNING] Första `wifi enable` kräver troligen att headsetet redan är anslutet med USB (som `adb tcpip`). Inte bekräftat.
- [KÄLLA] Ingen separat parkoppling via Metakonto eller moln beskrivs. Inget om säkerhetsmodell utöver ADB-godkännande. Docs säger "ingen autentisering" för MCP-servern själv.

## 3. Verktyg

MCP-verktyg som docs listar (uttryckligen "kurerad delmängd", fler kan finnas): `fetch_meta_quest_doc`, `search_doc`, `get_adb_path`, `get_device_logcat`, `stream_device_logcat`, `take_screenshot`, `hex_to_datetime`, `get_perfetto_context`, `load_trace_for_analysis`, `trace_thread_state`, `run_sql_query`, `get_counter_for_gpu_frames`, `meta-assets-search`. Sidan nämner 40+ verktyg totalt (sökresumé, ej verifierat). https://developers.meta.com/horizon/documentation/web/ts-mqdh-mcp/

CLI-kommandon (enligt Metas devices-and-apps-sida):
- `metavr app install x.apk` (`-r`, `-g`, `-t`, `--downgrade`), `app launch` (`--cold-start`, `--wait-for-idle`, `--verify`), `app list/info/stop/clear/uninstall`.
- `metavr files ls/pull/push/mkdir/rm`, `metavr capture screenshot`, `metavr log`, `metavr shell`, `metavr adb ...` (passthrough), `--json` för maskinläsbar utdata.
- Metas sida säger uttryckligen att den **inte dokumenterar `reverse`/`forward`**.
- [KÄLLA, tredjepart, mindre säker] En kopia av hzdb-skillen (https://skills.lc/meta-quest/agentic-tools/meta-quest-agentic-tools-skills-hzdb-cli-skill-md) listar `adb`-gruppen med `forward` ("host -> device") och `reverse` ("device -> host"), plus `adb install`, `push`, `pull`. Behöver bekräftas med `hzdb adb --help`.
- [OSÄKERT] Om MCP-verktygen (inte bara CLI:n) exponerar install, app launch, files och reverse. Den kurerade listan har dem inte, CLI:n har dem. Ta reda på med `hzdb mcp server` + listning av verktyg (gör det inte nu, instruktionen var att inte köra).

## 4. Ersätter den `adb install` och `adb reverse`?

- `adb install`: [KÄLLA] ja, `metavr app install` gör det, utan separat adb-installation (ADB valfritt, "inbyggt enhetsbibliotek").
- `adb reverse` (Quest når Macens localhost): [KÄLLA, svag] troligen via `hzdb adb reverse`; Metas egen sida dokumenterar det inte. Kräver fortfarande ADB-anslutning, alltså kabel eller ADB över Wi-Fi.
- Nätverksåtkomst Quest->Mac utan ADB: ingen sådan funktion hittades. [GISSNING] Det vore ändå onödigt: ClaudeXR använder redan LAN (Bonjour, WSS :47800, fastnålat certifikat). Reverse behövs bara för trådat läge utan Wi-Fi.
- Om ägaren vill slippa ADB helt: det går inte med denna MCP. Installation utan ADB sker via Horizon Store/App Lab eller sideload via MQDH, som i sin tur använder ADB.

## 5. Krav och begränsningar

- Mac: [KÄLLA] native installer och MQDH för macOS. Ingen minsta macOS-version angiven.
- Quest 3 och Horizon OS-version: [KÄLLA] inget sägs om modeller eller minsta OS-version i det jag läste. Utvecklarläge kräver Metas utvecklarkonto-registrering (allmän Quest-kunskap, ej ur dessa sidor).
- Säkerhet: [KÄLLA] ingen autentisering för MCP-servern; destruktiva kommandon (`clear`, `uninstall`, `files rm`) bör bekräftas. [GISSNING] En MCP med skalåtkomst (`shell`, `adb`) till headsetet ger Claude bred behörighet; ska därför bara ligga i ett projekt där det behövs och med behörighetsfrågor på.

## 6. Koppla in i Claude Code

- [KÄLLA] Plugin: `claude plugin marketplace add meta-quest/agentic-tools` och `claude plugin install agentic-tools@meta-quest`, starta om, `/mcp` ska visa `hzos-agentic-tools:hzdb` som ansluten. (Metas Unity-tutorial nämner en annan variant: `meta-vr@meta-quest`.)
- [KÄLLA] Manuell stdio-konfig: kommando `npx -y @meta-quest/hzdb mcp server`. Transport kan också vara sse eller streamable-http.
- [KÄLLA, tredjepart] `hzdb mcp install claude-code` listas som mål (alternativ `--dry-run`, `--force`, `-y`).
- Konflikt: källorna är inte helt konsekventa om namn (hzdb, Meta VR CLI, Meta Quest Agentic). Docs-sidan om MQDH-MCP är markerad som äldre.

## Obesvarat

Exakt verktygslista i MCP-läget, om `reverse` fungerar via hzdb mot Quest 3, om första Wi-Fi-aktiveringen kräver USB, minsta Horizon OS. GitHub och npm gav 403/timeout vid direkthämtning.

## Källor

- https://developers.meta.com/horizon/documentation/web/ts-mqdh-mcp/
- https://developers.meta.com/horizon/blog/unite-seoul-2026-meta-quest/
- https://developers.meta.com/vr/essentials/metavr-overview/
- https://developers.meta.com/vr/essentials/metavr-devices-and-apps/
- https://developers.meta.com/horizon/documentation/spatial-sdk/ts-mqdh-mcp
- https://www.npmjs.com/package/@meta-quest/hzdb (via sökträff)
- https://github.com/meta-quest/agentic-tools (via Unite-bloggen)
- https://skills.lc/meta-quest/agentic-tools/meta-quest-agentic-tools-skills-hzdb-cli-skill-md (tredjepart)
