# ADR-002 — Database: Supabase PostgreSQL (`clm-enterprise`, hergebruikt bestaand project)

- Status: **Accepted voor de huidige ontwikkel-/pilotrichting** — expliciet niet gepresenteerd als een volledig afgedane, onvoorwaardelijke productiekeuze. Zie de openstaande controls hieronder.
- Datum: oorspronkelijk besluit vóór 2026-07-24, bevestigd tijdens de architectuurbeoordeling van 2026-07-24
- Context: `mvm-api-pilot` gebruikte al een Supabase-project (`clm-enterprise`, Session Pooler, eu-west-1) met het volledige Hay CDM-schema. MCM2 hergebruikt dit project in plaats van een nieuw project op te zetten, met een schone herbouw van het schema (`clm`/`ref`/`audit`).
- Besluit: Supabase PostgreSQL (project `clm-enterprise`, huidige serverversie 17.6, bevestigd via `SHOW server_version`) blijft de database voor MCM2 in de huidige ontwikkel- en pilotfase.
- Alternatieven overwogen: een nieuw, apart Supabase-project (verworpen — geen functionele reden, extra beheerlast); zelfbeheerde PostgreSQL (verworpen — verhoogt operationele last voor een niet-fulltime-IT-eigenaar, tegen de kernprioriteit "onderhoudbaar zonder specialist" in).

## Openstaande controls (niet-onderhandelbaar vóór dit besluit als volledig afgedaan mag gelden voor productie)

1. **Backup/restore-test:** er is nog geen daadwerkelijke restore-test uitgevoerd om te bevestigen dat een Supabase-backup ook echt herstelbaar is. Zie `docs/architecture-review/2026-07-24/06-prioritized-roadmap.md`, categorie "Before production".
2. **Supabase-tier/SLA:** het huidige Supabase-abonnementsniveau en de bijbehorende garanties (backupfrequentie, uptime-SLA, support-responstijd) zijn nog niet expliciet gecontroleerd en gedocumenteerd tegen wat de Transdev-pilot en latere productie vereisen.
3. **Runtime-role zonder BYPASSRLS:** de huidige runtime-databaseverbinding gebruikt de Supabase-superuser-rol (`rolbypassrls: true`) — dit is een **actieve P0-blokkade**, zie `docs/STATUS.md` en `docs/architecture-review/2026-07-24/03-data-security-and-rls.md`. Dit ADR-besluit voor Supabase als platform is onafhankelijk van deze rolfout, maar de rolfout moet opgelost zijn vóór dit besluit als "veilig geïmplementeerd" mag gelden.
4. **Validatie van het dataverwerkingsmodel:** er is nog geen expliciete, gedocumenteerde toetsing dat Supabase's logging-, encryptie- en dataverwerkingsmodel aantoonbaar voldoet aan de NIS2/ISO27001-groeipad-eisen die voor dit project gelden (zie `MVM_V2/docs/database-schema-kwaliteitsborging.md` voor de oorspronkelijke, nog niet volledig sluitende PII-encryptieclaim).

- Gevolgen: MCM2 bouwt door op de bestaande Supabase-infrastructuur, wat snelheid oplevert (geen nieuwe provisioning nodig), maar de vier controls hierboven blijven expliciet open totdat zij zijn afgerond — dit besluit mag niet gelezen worden als "database volledig productierijp".
- Reviewmoment: vóór elke productiepromotie (niet alleen de Transdev-pilot) — alle vier controls moeten dan aantoonbaar afgerond zijn, elk met een eigen verwijzing naar het bewijs (testresultaat, documentcontrole, of geverifieerde rolconfiguratie).
- Bronnen: `docs/architecture-review/2026-07-24/01-current-state-inventory.md`, `03-data-security-and-rls.md`, `06-prioritized-roadmap.md`; `docs/context/PROJECT-HISTORY-2026-07-24.md`.
