# ADR-002 — Database: Supabase PostgreSQL (`clm-enterprise`, hergebruikt bestaand project)

- Status: **Accepted voor de huidige ontwikkel-/pilotrichting** — expliciet niet gepresenteerd als een volledig afgedane, onvoorwaardelijke productiekeuze. Zie de openstaande controls hieronder.
- Datum: oorspronkelijk besluit vóór 2026-07-24, bevestigd tijdens de architectuurbeoordeling van 2026-07-24
- Context: `mvm-api-pilot` gebruikte al een Supabase-project (`clm-enterprise`, Session Pooler, eu-west-1) met het volledige Hay CDM-schema. MCM2 hergebruikt dit project in plaats van een nieuw project op te zetten, met een schone herbouw van het schema (`clm`/`ref`/`audit`).
- Besluit: Supabase PostgreSQL (project `clm-enterprise`, huidige serverversie 17.6, bevestigd via `SHOW server_version`) blijft de database voor MCM2 in de huidige ontwikkel- en pilotfase.
- Alternatieven overwogen: een nieuw, apart Supabase-project (verworpen — geen functionele reden, extra beheerlast); zelfbeheerde PostgreSQL (verworpen — verhoogt operationele last voor een niet-fulltime-IT-eigenaar, tegen de kernprioriteit "onderhoudbaar zonder specialist" in).

## Openstaande controls (niet-onderhandelbaar vóór dit besluit als volledig afgedaan mag gelden voor productie)

1. **Backup/restore-test:** er is nog geen daadwerkelijke restore-test uitgevoerd om te bevestigen dat een Supabase-backup ook echt herstelbaar is. Zie `docs/architecture-review/2026-07-24/06-prioritized-roadmap.md`, categorie "Before production".
2. **Supabase-tier/SLA:** het huidige Supabase-abonnementsniveau en de bijbehorende garanties (backupfrequentie, uptime-SLA, support-responstijd) zijn nog niet expliciet gecontroleerd en gedocumenteerd tegen wat de Transdev-pilot en latere productie vereisen.
3. ~~**Runtime-role zonder BYPASSRLS**~~ — **AFGEROND op 2026-07-27, bevestigd in de echte omgeving op 2026-07-28.** De runtime-rol is `clm_api_runtime` met `rolbypassrls = false`; migraties lopen via de aparte rol `clm_migrator`. Zie ADR-008 en ADR-009. Bewijs: op 2026-07-28 read-only geverifieerd tegen het `clm-enterprise`-project zelf (niet alleen in CI) — `SELECT current_user, rolbypassrls` levert `clm_api_runtime, false`.
4. **Validatie van het dataverwerkingsmodel:** er is nog geen expliciete, gedocumenteerde toetsing dat Supabase's logging-, encryptie- en dataverwerkingsmodel aantoonbaar voldoet aan de NIS2/ISO27001-groeipad-eisen die voor dit project gelden (zie `MVM_V2/docs/database-schema-kwaliteitsborging.md` voor de oorspronkelijke, nog niet volledig sluitende PII-encryptieclaim).

## Stand van de controls per 2026-07-28

| # | Control | Status |
|---|---|---|
| 1 | Backup/restore-test | ❌ **Nog nooit uitgevoerd.** Zwaarste openstaande risico: onbekend of een backup van deze database herstelbaar is. Runbook geschreven: `docs/runbooks/supabase-verificatie-en-restoretest.md`, stap 1. Issue #19. |
| 2 | Tier/SLA-garanties | ❌ **Nog niet gecontroleerd.** Runbook stap 2. Relevant vóór de Transdev-pilot: op een Free-plan pauzeert Supabase projecten na inactiviteit en zijn backupgaranties beperkt. |
| 3 | Runtime-rol zonder BYPASSRLS | ✅ **Afgerond** en in de echte omgeving bevestigd (zie hierboven). |
| 4 | NIS2/ISO27001-dataverwerkingsmodel | ❌ **Nog niet gedaan.** Documentonderzoek, geen test; valt buiten het runbook. |

**Aanvullend vastgesteld op 2026-07-28 (read-only, tegen de echte database):**

- PostgreSQL-serverversie is **17.6** (CI draait op 18.2). De volledige migratieketen en alle 11 isolatietests zijn ook tegen een lokale 17.6-container gedraaid en slagen — het versieverschil vormt geen risico.
- Het schema in `clm-enterprise` komt **volledig overeen** met de Drizzle-baseline uit ADR-010: negen tabellen, RLS actief op alle zes tenantgebonden tabellen, zes policies met zowel `USING` als `WITH CHECK`, `clm.current_tenant_id()` werkend. Geverifieerd met `scripts/verify-schema.js`. Er is dus geen schema-afdrijving.
- `drizzle.__drizzle_migrations` bestaat nog niet in deze database; de drie Prisma-migraties staan alle drie als afgerond geregistreerd. Zie Issue #25.

- Gevolgen: MCM2 bouwt door op de bestaande Supabase-infrastructuur, wat snelheid oplevert (geen nieuwe provisioning nodig), maar de drie resterende controls blijven expliciet open totdat zij zijn afgerond — dit besluit mag niet gelezen worden als "database volledig productierijp".
- Reviewmoment: vóór elke productiepromotie (niet alleen de Transdev-pilot) — alle vier controls moeten dan aantoonbaar afgerond zijn, elk met een eigen verwijzing naar het bewijs (testresultaat, documentcontrole, of geverifieerde rolconfiguratie).
- Bronnen: `docs/architecture-review/2026-07-24/01-current-state-inventory.md`, `03-data-security-and-rls.md`, `06-prioritized-roadmap.md`; `docs/context/PROJECT-HISTORY-2026-07-24.md`.
