# Legacy Discovery Plan — `mvm-api-pilot` en Supabase `clm-enterprise`

**Status:** read-only inventarisatieplan. Niets in dit document is een goedkeuring — elk artefact hieronder moet expliciet gevalideerd worden vóór hergebruik, ook al is het al eerder "als bron gebruikt" bij MCM2.

---

## Classificatiecategorieën

- **Hergebruiken** — technisch en securitymatig gevalideerd, direct overnemen (code, SQL, of concept).
- **Herbouwen** — concept/intentie is goed, implementatie moet opnieuw (bijv. omdat een patroon nooit is afgemaakt).
- **Alleen functionele referentie** — laat zien wat het systeem moet doen, niet hoe het technisch moet.
- **Uitfaseren** — niet meenemen, expliciet afgeschreven.

---

## A. `mvm-api-pilot` (C#/.NET-pilot)

| Artefact | Locatie | Classificatie | Onderbouwing |
|---|---|---|---|
| Endpoint-vorm/business-logica (VendorsController, etc.) | `Controllers/V2/` | **Alleen functionele referentie** | Al zo vastgelegd in `MCM2-CLAUDE.md` vóór deze review — endpoint-vorm 1-op-1 navertalen, niet de C#-code overnemen. Geen aanleiding gevonden om dit te wijzigen. |
| `NESTJS_MIGRATION_PLAN.md` | repository-root | **Uitfaseren voor hostingbeslissingen, functionele referentie voor endpoint-volgorde** | Noemt "Azure Container Apps" — achterhaald volgens eerdere sessie-vaststelling in `MCM2-CLAUDE.md`. Endpoint-volgorde (vendor → contract → task → issue → cert → interaction) blijft bruikbaar. |
| SQL-migraties `Database/migrations/001–015` | `Database/migrations/` | **Herbouwen, met één belangrijke hergebruik-kandidaat** | Zie sectie C hieronder — het rollenmodel-ontwerp (`001_extensions_schemas_roles.sql`) is conceptueel correct en gedeeltelijk al aanwezig in de levende database, maar nooit operationeel afgemaakt (geen inlogbare gebruiker gekoppeld). De overige 16 migraties beschrijven een schema dat groter is dan wat MCM2 nu nodig heeft (contract, task, issue, requirement, risk_measure, interaction, scheduled_meeting, document — allemaal buiten de huidige Fase 0/Transdev-survey-scope) — bruikbaar als **functionele referentie** voor toekomstige entiteiten, niet als bron om nu te migreren. |
| `TenantInterceptor.cs` | `Data/TenantInterceptor.cs` | **Alleen functionele referentie** | Beschrijft het `SET LOCAL app.current_tenant_id`-patroon — het patroon zelf is al correct overgenomen in MCM2's `withTenant()`-helper (zie 03-data-security-and-rls.md). De C#-implementatie zelf wordt niet overgenomen (andere taal), alleen het principe. |
| `ClmDbContext.cs` / EF Core-modellen | `Data/`, `Models/Clm/` | **Alleen functionele referentie** | Toont welke velden/relaties bedoeld waren per entiteit — bruikbaar bij het uitbreiden van het MCM2-schema met nieuwe entiteiten, niet als technische bron (andere ORM/taal). |
| `appsettings.Development.json` (bevat wachtwoord in leesbare tekst) | repository-root | **Uitfaseren, apart beveiligingsrisico** | Al eerder in dit project genoteerd als "bekend, niet-blokkerend aandachtspunt" — zie Openstaande legacy-actie hieronder. Niet gecommit in de huidige git-HEAD (eerder geverifieerd), mogelijk wel in eerdere commits — niet geverifieerd in deze review. |
| `node_modules/` binnen een C#-project | repository-root | **Uitfaseren** | Aanwezigheid van een `node_modules`-map in een .NET-project is zelf een signaal van projectvervuiling/experimenten — geen architectuurwaarde, puur opruimen bij gelegenheid (niet urgent, niet onderdeel van MCM2). |

## B. Supabase `clm-enterprise` (database, hier "mcm_supabase" genoemd in de opdracht)

| Artefact | Classificatie | Onderbouwing |
|---|---|---|
| Project zelf (regio, Session Pooler-configuratie) | **Hergebruiken, met openstaand controlepunt** | Al in gebruik, Postgres 17.6 bevestigd. Openstaand: Supabase-tier/backup-garanties nog niet geverifieerd (zie 03/06, PR2). |
| Schema-indeling `clm`/`ref`/`audit`/`notification`/`staging` (concept, uit `001_extensions_schemas_roles.sql`) | **Hergebruiken (concept), herbouwen (inhoud)** | De vijf-schema-indeling is een doordacht, NIS2/DORA-gemotiveerd ontwerp — waardevol om aan te houden. MCM2 gebruikt nu alleen `clm`/`ref`/`audit`; `notification` en `staging` zijn nog niet nodig voor de Transdev-survey-slice (zie 08-transdev-mvp-scope.md) — later toevoegen indien nodig. |
| Rollen `clm_api`, `clm_admin`, `clm_readonly`, `clm_audit_reader` | **Hergebruiken, direct bruikbaar na één ontbrekende stap** | **Concreet geverifieerd tijdens deze discovery (read-only `pg_roles`-query):** alle vier rollen bestaan nog in de database (overleefden de eerdere schema-drop, want rollen zijn cluster-breed), met `rolcanlogin=false` en `rolbypassrls=false` — precies zoals bedoeld. **Ontbrekend, geverifieerd via grep over alle 17 migratiebestanden:** nergens een `GRANT clm_api TO <inlogbare-gebruiker>`-statement. De rol is dus nooit operationeel gekoppeld aan een verbinding — dit verklaart waarom zowel `mvm-api-pilot` als (per overname) MCM2 tot nu toe via de kale `postgres`-superuser-rol verbonden, ondanks een correct rollenontwerp op papier. **Dit is de directe, concrete invulling van de P0-securityherstelactie** (zie geactualiseerde 06-prioritized-roadmap.md): een inlogbare rol aanmaken, `GRANT clm_api TO` die rol, en `DATABASE_URL` daarop laten wijzen — geen nieuw ontwerp nodig, alleen afmaken wat al correct opgezet was. |
| RLS-policies uit `010_rls.sql` | **Alleen functionele referentie voor MCM2's huidige 4-modellen-schema; herbouwen voor de rest** | MCM2's eigen migratie (Taak 5) heeft al eigen, gelijkwaardige RLS-policies (USING + WITH CHECK) voor de huidige 4 modellen — niet uit dit bestand gekopieerd maar zelfstandig, consistent opgesteld. De overige RLS-policies in `010_rls.sql` (voor contract, task, requirement, etc.) zijn relevant zodra die entiteiten gebouwd worden — dan als referentie raadplegen, niet blind overnemen zonder de "USING + WITH CHECK, altijd beide"-regel opnieuw te toetsen (de C#-pilot had hier zelf al een bekende inconsistentie, zie MCM2-CLAUDE.md Database-regel 3). |
| Seed-/referentiedata (vendor_category, business_criticality, compliance_status) | **Hergebruiken (concept), reeds opnieuw ingevoerd** | MCM2's eigen migratie bevat al vergelijkbare seed-data, onafhankelijk heringevoerd — geen actie nodig. |
| Daadwerkelijke productie-/testdata die vóór de schema-drop in de database stond | **Uitgefaseerd (feitelijk, onomkeerbaar)** | Reeds gedropt na expliciete bevestiging in een eerdere sessie (zie 07-decision-log.md, ADR-004) — puur ter documentatie hier vermeld, geen actie meer mogelijk of nodig. |

## C. Hoe oude RLS-, tenant- en credentialpatronen worden gevalideerd vóór overname

Geen enkel patroon uit `mvm-api-pilot`/de bestaande database wordt overgenomen zonder de volgende validatiestappen:

1. **RLS-policy-patroon (`USING`/`WITH CHECK`):** het patroon zelf (vergelijken met `clm.current_tenant_id()`-sessievariabele) is functioneel gevalideerd — MCM2's eigen migratie past het al correct toe. Vóór uitbreiding naar nieuwe entiteiten: elke nieuwe policy expliciet controleren op aanwezigheid van **beide** clausules (Database-regel 3 in `MCM2-CLAUDE.md`), niet aannemen dat het legacy-bestand dit consistent deed (bekende inconsistentie in migratie 014 van de C#-pilot, al eerder gedocumenteerd).
2. **Tenant-resolutiepatroon (`SET LOCAL app.current_tenant_id`):** technisch gevalideerd (transactiegrens correct in `withTenant()`), maar de **bovenstroomse bron** van de tenant-waarde (hoe wordt `tenantId` vastgesteld vóór het de transactie ingaat) is **niet gevalideerd** — noch in de C#-pilot (`TenantInterceptor` nam vermoedelijk ook een waarde aan zonder verificatie, niet in deze discovery geverifieerd of dat zo was), noch in MCM2 nu (bevestigd probleem, zie 03-data-security-and-rls.md). Dit patroon wordt **niet** overgenomen zoals het was — het moet worden herbouwd met een verificatiestap (Cognito-JWT of gelijkwaardig) vóór het als voldoende beschouwd wordt voor de Transdev-pilot.
3. **Credential-/rolpatroon:** **niet** overnemen als "werkt al" — expliciet geverifieerd dat het rolontwerp nooit operationeel is afgemaakt (zie sectie B hierboven). Validatiestap vóór gebruik: na het koppelen van een inlogbare gebruiker aan `clm_api`, een expliciete test die bevestigt dat `rolbypassrls=false` én dat de rol daadwerkelijk **geen** rechten heeft buiten wat gegrant is (bijv. een `INSERT`-poging op een tabel waar `clm_api` geen recht op heeft, moet falen).
4. **Multi-schema-migratiepatroon:** de C#-pilot gebruikte EF Core-migraties (ander mechanisme dan de ORM-kandidaten in 04-orm-decision-record.md) — dit patroon wordt niet technisch overgenomen, wel als functionele referentie voor welke schema's/tabellen/relaties uiteindelijk nodig zijn.

## Openstaande legacy-actie (niet blokkerend voor MCM2, wel te plannen)

`mvm-api-pilot/appsettings.Development.json` bevat een Supabase-wachtwoord in leesbare tekst (al eerder gedocumenteerd in `MCM2-CLAUDE.md` als bekend aandachtspunt). Dit wachtwoord hoort bij dezelfde `postgres`-superuser-rol die nu ook voor MCM2 in gebruik is (en die geroteerd wordt als onderdeel van de P0-actie, zie geactualiseerde 06-prioritized-roadmap.md) — de rotatie lost dus dit legacy-lek in dezelfde beweging op, mits de rotatie daadwerkelijk wordt uitgevoerd en niet alleen de nieuwe `clm_api`-rol wordt toegevoegd naast het bestaande wachtwoord.

## Samenvattend classificatie-overzicht

| Categorie | Aantal artefacten | Voorbeelden |
|---|---|---|
| Hergebruiken | 3 | Supabase-project zelf, schema-indeling (concept), rollen `clm_api` e.a. (na afmaken) |
| Herbouwen | 2 | SQL-migraties 002-015 (te grote scope, andere ORM-tooling), tenant-verificatie-bovenstroom |
| Alleen functionele referentie | 5 | Endpoint-vorm C#, NESTJS_MIGRATION_PLAN.md (endpoint-volgorde), TenantInterceptor-principe, EF Core-modellen, RLS-policy-referentie voor toekomstige entiteiten |
| Uitfaseren | 3 | appsettings.Development.json-wachtwoord, node_modules in C#-project, NESTJS_MIGRATION_PLAN.md's Azure-aanname |
