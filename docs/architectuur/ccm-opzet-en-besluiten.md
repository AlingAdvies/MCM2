# CCM in MCM2 — opzet en besluiten

Context voor werk aan de concessiemodule. Compact en normatief: wat is besloten, wat ligt vast,
en in welke volgorde het gebouwd wordt. Achtergrond en onderbouwing staan in het
architectuurdocument (Claude Docs, concept v0.3); deze pagina is de werkversie voor in de repo.

Laatst bijgewerkt: 31 oktober 2026, werkwijze demo en MVP toegevoegd (§6). Status: besluit over
de plaatsing genomen, afscherming voorgesteld in ADR-018, nog niets van gebouwd.

---

## 1. Wat CCM is

Concessiemanagement voor Transdev: per concessie de geldende stand van afspraken ontsluiten
(contract, vigerende plannen, geaccordeerde afwijkingen, lopende thema's), plus de contactgegevens
van de stakeholders rond die concessie. Alleen de uitvoeringsfase, alleen interne gebruikers van
Transdev. Het systeem ontsluit; het beoordeelt niet.

## 2. Besluit

**CCM wordt een module binnen MCM2**, in een eigen schema `concessie`, uitgeleverd via een
entitlement en alleen aangezet voor de tenant Transdev. Geen aparte codebase, geen aparte
applicatie, geen derde repository.

Reden: er zijn geen andere klanten voor CCM in beeld. Daarmee is het een feature voor één klant en
geen product. Eén pipeline en een geteste beveiligingsruggengraat erven in plaats van namaken
wegen dan zwaarder dan scheiden.

**Niet besloten:** of Transdev ooit een eigen omgeving (eigen deployment, eigen database) krijgt.
Vandaag is Transdev een tenant in de ene productieomgeving. Dat blijft zo tot er een concrete
aanleiding is (zie §10).

## 3. Zes voorwaarden

Ze gelden als harde regels bij elke wijziging.

1. **Eigen schema `concessie`**; migraties in dezelfde keten (`drizzle/` met het ene journal) als
   de rest. Een concessiemigratie wijzigt geen bestaande tabellen in `clm`, `ref` of `audit`.
2. **Alles van Transdev moet als geheel naar een eigen omgeving kunnen.** Dat is het scenario
   waar de plaatsing op is afgestemd, en het kan omdat alle gegevens tenantgebonden zijn. Vreemde
   sleutels van `concessie` naar `clm` zijn daarom toegestaan; ze gaan bij zo'n verhuizing mee.
3. `TENANT_SCHEMAS` en de conformiteitstest generiek maken vóór de eerste concessietabel (§6).
4. **Twee afschermingsgrenzen, elk met de sterkte die past (ADR-018).** Tussen tenants hard, in de
   database (RLS met FORCE, zoals overal). Tussen concessies redelijk, in de applicatie: één
   centrale controle op elke route en één dekkende test.
5. `concessiemodule` als entitlement. De centrale controle uit voorwaarde 4 controleert ook het
   entitlement aan de achterkant; alleen het menu verbergen is niet genoeg.
6. **Hergebruik waar het hetzelfde concept is**: dossier/kwestie, bijlagen en de .msg-afhandeling,
   het standscherm. Geen Transdev-specifieke logica in de bestaande `clm`-code; wat CCM-specifiek
   is, staat in de module.

## 4. Wat er nu staat (geverifieerd tegen de code)

- **Repos.** `MCM2` (NestJS, achterkant) en `MCM2-frontend` (Next.js, voorkant), twee containers.
- **Database.** PostgreSQL 17.6 bij Supabase, eu-west-1. Schema's `clm`, `ref`, `audit`
  (`src/db/schema.ts`). Staging is een tweede Supabase-project, alleen migraties.
- **Afscherming.** Tenantcontext uitsluitend uit een server-side gehashte lookup; `withTenant()` in
  `src/db/database.service.ts` zet `app.current_tenant_id` en `app.current_actor`. De database
  kent geen gebruikers-id. RLS met FORCE (`drizzle/0011_force_row_level_security.sql`).
  Runtime-rol `clm_api_runtime` zonder `BYPASSRLS`, `clm_migrator` als eigenaar. Tien
  `SECURITY DEFINER`-functies met vaste `search_path`.
- **Rechten.** `src/db/rechten-contract.ts` legt per object vast wat de applicatierol mag. Bestaat
  omdat `ALTER DEFAULT PRIVILEGES` lokaal aanvulde wat productie miste (incident 8 augustus 2026).
- **Modules.** `src/features/feature-registry.ts`: `FEATURE_KEYS = ['contractmodule', 'nis2module']`,
  aan of uit per tenant in `clm.tenant_feature`. De achterkant controleert de vlag nu niet; hij
  verbergt alleen menu-items.
- **Bestanden.** S3-bucket, privé en versleuteld; `/health` meldt of de bijlagenopslag op S3 staat.
- **Identiteit.** OIDC met PKCE tegen Entra External ID; sessiecookie met SHA-256-hash in de database.
- **Uitrol.** GitHub Actions naar ECS, images uit GHCR getagd met de korte commit-SHA. Vier remmen
  voor productie, waarvan één menselijk akkoord.
- **Bewijs.** `test/schema-conformiteit.e2e-spec.ts` controleert RLS en FORCE per tenantgebonden tabel;
  `test/tenant-rls-isolation.e2e-spec.ts` en `test/actor-context.e2e-spec.ts` toetsen de isolatie.

## 5. Wat CCM toevoegt

**Schema `concessie`**, op hoofdlijnen — dit is een indeling, geen ontwerp:

| Groep | Waarvoor |
| --- | --- |
| Concessie | Naam, opdrachtgever, looptijd, kenmerk, status |
| Document | De contractset en losse stukken, met soort, datum en vindplaats |
| Afspraak | Afspraken en correspondentie; zie het peildatummodel hieronder |
| Plan | De jaarlijkse plannen per concessie, met cyclus en vigerende versie |
| Stakeholdercontact | Organisatie, naam, functie, telefoon en e-mail, gegroepeerd naar type |

Wie welke concessie ziet, is geen eigen tabel: dat is de rolbezetting uit ADR-019 (gebruiker,
functie, concessie, vanaf en tot), met `concessie_id` als extra objectsoort. Een functie met het
kenmerk "centraal" ziet alle concessies.

Elke tabel krijgt een `tenant_id`, zodat hij meeloopt in de bestaande RLS-verificatie en tenantcontext.

**Het peildatummodel is het eigenlijke ontwerpwerk.** De kernvraag is "wat geldt nu", en de use
case vraagt ook "wat gold op datum X". Daarvoor moet een afspraak minstens dragen: wanneer
besloten, vanaf wanneer geldig (en eventueel tot), waarvan hij afwijkt of wat hij vervangt, en
de rangorde van het stuk (in het voorbeeldcontract art. 5.4 en 20.8). Dit wordt uitgewerkt met de
pilot, vóór de tabellen. Eerst toetsen of dossier/kwestie (open/afgerond, uitkomst, bijlagen) laag
3 en 4 kan dragen, voordat er een tweede afspraaksysteem komt.

**Toegang (ADR-018).** Tussen tenants: RLS met FORCE, ongewijzigd. Tussen concessies: één
centrale controle in de applicatie (entitlement aan, gebruiker toegewezen, anders 404), lijsten en
zoekresultaten gefilterd in dezelfde query, toewijzen en intrekken in de audit trail. Eén test
roept elke concessieroute aan met een gebruiker zonder toewijzing en verwacht 404. Achtergrondwerk
(tekstextractie, zoekindex) leest binnen de tenant zonder concessiefilter.

**Documentmodel.** De huidige bijlagengrenzen (10 MB, tien bijlagen per dossier,
`src/vendor/vendor-engagement-bestand-validatie.ts`) gelden voor dossiers en passen niet bij een
contractset. Voor de formele stukken komt een documentmodel met ruimere grenzen; mail en
correspondentie lopen waar het kan via het bestaande dossier.

**Zoeken.** Bestaat nog niet en is de kern van de belofte. Postgres full-text eerst, `pgvector`
later. Vereist tekstextractie uit pdf en .msg. Resultaten filteren op toegewezen concessies.

## 6. Volgorde van werken

0. **Pilot op HWGO met de accountmanager**: de twee schermen samen vullen, en daaruit het
   peildatummodel en de zoekbehoefte afleiden. Nog geen tabellen.

Daarna, vóór de eerste concessietabel, in deze volgorde:

1. **Schemalijst generiek maken.** `TENANT_SCHEMAS` in `src/db/schema-inventory.ts` is een vaste lijst
   van drie namen, en `test/schema-conformiteit.e2e-spec.ts` heeft daarnaast vier queries met
   `('clm', 'ref', 'audit')` letterlijk erin (regels 54, 72, 355 en 406). Zonder aanpassing valt
   `concessie` buiten de controle op RLS, FORCE en onbekende tabellen — zonder dat er iets rood
   wordt. Leid de schemalijst af uit het Drizzle-schema, zoals het bestand dat voor tabellen al doet,
   en gebruik hem op alle vier plekken.
2. **Rechtencontract uitbreiden.** Elke nieuwe tabel krijgt een expliciete regel in
   `src/db/rechten-contract.ts`, en de migratie geeft de `GRANT`s expliciet. Niet vertrouwen op
   `ALTER DEFAULT PRIVILEGES`.
3. **Backupverwachting bijwerken.** `docs/runbooks/backup-verwachting.json` hoort bij elke
   schemawijziging mee, anders meldt de dagelijkse volledigheidscontrole groen terwijl tabellen ontbreken.

Daarna de eerste migratie voor `concessie`, samen met de centrale toegangscontrole en de dekkende
test uit ADR-018. De rolbezetting per concessie (ADR-019) is pas nodig bij de tweede concessie:
zolang alleen HWGO bestaat, ziet wie de module ziet die concessie.

### Werkwijze: eerst een demo op dummy-data, dan de MVP in stukjes

Afgesproken met de eigenaar op 31 oktober 2026. Twee fases, elk met een eigen ritme.

**Fase 1: demo op dummy-data, alleen lokaal.** De schermen worden gebouwd in de echte frontend
(`MCM2-frontend`), met de bestaande componenten en design tokens, zodat de demo eruitziet als het
eindresultaat. De gegevens komen uit `src/data/concessie.mock.ts` via de bestaande mockstand
(`NEXT_PUBLIC_MOCK_DATA=1`, zie `src/core/api/client.ts`). Geen achterkant, geen migraties, geen
uitrol; alles op één feature-branch, met `main` regelmatig erin.

- Begin met de twee pilotschermen: concessie-overzicht en standscherm per concessie.
- De dummy-data is verzonnen. Het mockbestand staat in een publieke repo: geen echte namen,
  contactgegevens of contractteksten.
- Per scherm toetsen of het binnen de bestaande opbouw te realiseren is (dossier/kwestie,
  bijlagen, standscherm, ADR-019). Wat een mock gratis belooft maar in het echt het zware werk is,
  zoals zoeken en "wat gold op datum X", staat in de demo zichtbaar als "nog te toetsen".
- De fase eindigt met een uitgeschreven MVP: welke schermen, welke gegevens, wat er bewust nog
  niet in zit. Samen met de vorm van het mockbestand is dat de invoer voor het datamodel.

**Fase 2: de MVP in stukjes door de keten.** Elk afgerond stukje gaat naar `main` (beide repo's
samen) en via staging en rookproef naar productie. Daar staat `concessiemodule` aan voor een eigen
tenant (Transdev DEV of AlingAdvies) en uit voor Transdev Nederland. Wie het eindresultaat wil
zien, ziet het daar, in de echte omgeving. In gebruik nemen is daarna alleen de schakelaar
"Modules" in platformbeheer, zonder uitrol.

- De centrale controle op het entitlement aan de achterkant (voorwaarde 5) zit in het eerste
  stukje, niet later. Zonder die controle is halfaf CCM-code op productie bereikbaar voor
  Transdev-gebruikers.
- Tabellen gaan pas naar `main` als het model na de pilot redelijk vastligt. Een migratie op
  productie draai je niet terug.
- Een account hoort bij één tenant. Een Transdev-gebruiker kan met het eigen account dus niet in
  Transdev DEV meekijken: daar demonstreert de eigenaar zelf.
- Voor demo's met documenten moet uploaden in de lokale demo eerst werken; dat faalt nu
  (verwacht nog een lokale opslagdienst).

## 7. Conventies binnen de module

- Eigen map aan de achterkant en een eigen deel van de schermen aan de voorkant.
- Gebruikt de gedeelde kern: inloggen, sessie, tenantcontext, audit, bestandsopslag; en het
  dossier/kwestie-concept waar het past.
- Nederlandstalige namen in code en database, zoals de rest van MCM2.
- Elke tabel: `tenant_id`, RLS met FORCE, een regel in het rechtencontract, een expliciete `GRANT`.
- Domeincode opent geen eigen databaseclient; alles via `withTenant()`.
- Elke concessieroute loopt door de centrale toegangscontrole.
- `concessiemodule` toevoegen aan `FEATURE_KEYS` en per tenant aanzetten in `clm.tenant_feature`.

## 8. Wat niet doen

- Geen tweede rolmodel naast dat van MCM2. Concessies gebruiken de functies en rolbezetting uit
  ADR-019, net als contracten; wat iemand mag, blijft de tenantrol.
- Geen afscherming tussen concessies in de database en geen gebruikers-id in `withTenant()` voor
  deze module (ADR-018).
- Geen tweede dossier- of uploadmechanisme bouwen zolang het bestaande het concept dekt.
- Geen Transdev-specifieke logica in bestaande `clm`-code.

## 9. Open punten

- Het peildatummodel van een afspraak (§5), uit te werken met de pilot.
- Het datamodel van `concessie`: kolommen, sleutels en indexen.
- Het zoekontwerp, inclusief tekstextractie uit pdf en .msg.
- Het documentmodel voor de formele stukken: soorten, grenzen aan omvang en aantal.
- Welke functies "centraal" zijn, en welke functies bij concessiemanagement horen (ADR-019).
- Of `ref` ook opzoeklijsten voor concessies moet bevatten, of dat die in `concessie` horen.

## 10. Wanneer dit besluit heropend wordt

- Er komt een tweede klant voor CCM in beeld. Dat is een extra tenant, geen splitsing.
- Transdev krijgt om contractuele of commerciële redenen een eigen omgeving. Dat splitst de uitlevering,
  niet de codebase: dezelfde code, een eigen deployment en database met alle Transdev-gegevens
  (voorwaarde 2).
- Er komen gebruikers van buiten Transdev in de module; dan heropent ook ADR-018.
- Experimentele migraties blijken een risico voor de productiedatabase. De eerste stap is dan niet de
  codebase splitsen maar de database: dezelfde code, een eigen instantie.

---

Zie ook: `docs/ARCHITECTUUR.md` (normatieve platformgaranties), `docs/adr/` (ADR-002, 003, 009, 010,
011, 013, 015, 016, 017, 018, 019), `docs/advies/uitgangspunten-concessiemanagement.md`,
`docs/superpowers/specs/2026-10-26-contract-leesscherm-design.md` (ontwerpprincipes van de schermen),
`docs/architectuur/2026-10-30-architectuur-mcm2-ccm-met-pakketten-v2.png` (plaat, concept v2; v1 is de eerder gedeelde versie).
