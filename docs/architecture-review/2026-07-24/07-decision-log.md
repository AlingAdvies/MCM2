# Decision Log — MCM2 (ADR-light)

Architectuurkeuzes uit deze en eerdere sessies, in ADR-light-vorm. Bijwerken zodra nieuwe besluiten genomen worden.

---

## ADR-001 — Backendtaal en framework: TypeScript + NestJS

**Context:** MCM2 vervangt de C#/.NET-pilot (`mvm-api-pilot`). Eigenaar wil één primaire backendtaal, modulaire monolith.
**Opties:** NestJS (TypeScript), Express (TypeScript, minder structuur), .NET voortzetten.
**Besluit:** NestJS, TypeScript. **Status: vastgesteld, niet heroverwogen in deze review — geen aanleiding gevonden om dit te wijzigen.**
**Argumenten:** modulaire structuur past bij de gewenste domeinindeling; sluit aan bij de frontend-taal (TypeScript/Next.js), verkleint de cognitieve overhead voor een klein team.
**Gevolgen:** C#-pilot dient als functionele spec, niet als technische bron.
**Reviewmoment:** geen aanleiding, tenzij een toekomstige teamuitbreiding andere taalvoorkeuren met zich meebrengt.

---

## ADR-002 — Database: Supabase PostgreSQL (bestaand project hergebruikt)

**Context:** `mvm-api-pilot` gebruikte al twee Supabase-projecten; `clm-enterprise` (project-ref `agojesdovwsupidwlevh`) bevat het volledige Hay CDM-schema.
**Opties:** nieuw Supabase-project, hetzelfde project hergebruiken (nieuw schema), zelfbeheerde Postgres.
**Besluit:** hetzelfde Supabase-project, schone herbouw van het schema (`clm`/`ref`/`audit`), oude schema-inhoud gedropt na expliciete bevestiging (zie hieronder, ADR-004).
**Status:** vastgesteld. **Toets in deze review:** Supabase's security-, logging-, backup- en dataverwerkingsmodel is **niet volledig geverifieerd** — zie 06-prioritized-roadmap.md (backup/restore-test, PR2) en 03-data-security-and-rls.md (rollenmodel). Dit is een openstaand controlepunt, geen bevestigd akkoord.
**Reviewmoment:** vóór productie — bevestig Supabase-backup-tier en -garanties expliciet.

---

## ADR-003 — Multi-schema-indeling: `clm` / `ref` / `audit`

**Context:** Hay CDM-schema-conventie, overgenomen uit de C#-pilot-specificatie.
**Besluit:** drie Postgres-schemas: `clm` (kerndata), `ref` (tenant-agnostische lookup-tabellen, bewust geen RLS), `audit` (append-only audit-trail).
**Status:** vastgesteld. **Gevolg, ontdekt in deze review:** deze indeling is de directe oorzaak van de multi-schema-migratieproblemen bij zowel Drizzle als Kysely (zie 04-orm-decision-record.md) — de schema-indeling zelf wordt niet heroverwogen, maar de ORM-keuze moet hiertegen getoetst worden.
**Reviewmoment:** na de spike uit ADR-006.

---

## ADR-004 — Bestaande database-inhoud gedropt vóór schone herbouw

**Context:** bij het genereren van de eerste Prisma-migratie bleek de database al het volledige, gevulde `mvm-api-pilot`-schema te bevatten (tientallen tabellen).
**Besluit:** `DROP SCHEMA audit/clm/ref CASCADE`, expliciet uitgevoerd als zichtbare SQL (niet via `prisma migrate reset`), na twee aparte bevestigingsvragen aan de eigenaar (inhoud wegwerpbaar? definitieve go?).
**Status:** uitgevoerd, onomkeerbaar. **Gevolg:** geen — dit was een eenmalige, bewust bevestigde actie voorafgaand aan deze review, niet heroverwogen.

---

## ADR-005 — ORM: Prisma (aanvankelijk), vervolgens heropening van de vraag

**Context:** Prisma gekozen bij aanvang vanwege type-veiligheid en "fool-proof voor niet-technische opdrachtgever". Tijdens implementatie bleek Prisma 7 een structureel conflict te geven tussen Jest en de gecompileerde Docker-build.
**Tussenstap (niet-definitief):** een eerder document in dezelfde sessie (`docs/superpowers/specs/2026-07-24-techstack-evaluatie-drizzle.md`) beval Drizzle aan, gebaseerd op onvolledig onderzoek (multi-schema-migratiegedrag van Drizzle was toen niet getoetst).
**Huidige status:** **heropend, nog niet definitief.** Zie ADR-006.
**Reviewmoment:** direct, via de voorgestelde spike.

---

## ADR-006 — Spike vóór definitieve ORM-keuze

**Context:** geen van de vijf onderzochte opties (Prisma 7, Prisma 6, Drizzle, Kysely, kaal `pg`) is zonder voorbehoud geschikt voor de multi-schema-eis. Zie volledige beslismatrix in 04-orm-decision-record.md.
**Besluit:** vóór een definitieve keuze wordt een tijdgebonden (twee werkdagen) technische spike uitgevoerd: Prisma 6 en Drizzle beide getoetst tegen het concrete Transdev-survey-schema (vendor, contactpersoon, template, ronde, response, certificaat-attachment) met de drie Postgres-schemas en de RLS/`SET LOCAL`-transactie-eis, inclusief de striktere dubbele-toegangsniveau-RLS-test voor het externe token-pad — zie geactualiseerde 04-orm-decision-record.md.
**Status:** voorgesteld, **wacht op goedkeuring van de eigenaar** — zie 06-prioritized-roadmap.md, BP1.
**Gevolgen:** blokkeert BP2 (definitieve ORM-implementatie) in de roadmap totdat uitgevoerd.
**Reviewmoment:** direct na de spike-uitkomst — dit ADR wordt dan vervangen door een definitief ADR-006b met de daadwerkelijke keuze.

---

## ADR-007 — Tenant-resolutie via client-header (tijdelijk, risico erkend)

**Context:** `TenantMiddleware` leidt de tenant af uit `X-Tenant-Id`-header of `?tenant=`-query, zonder identiteitsverificatie. Dit was een bewuste, pragmatische keuze voor Fase 0 (nog geen Cognito).
**Besluit (impliciet, nu expliciet erkend):** dit patroon blijft **tijdelijk** aanvaardbaar zolang er geen externe/tweede tenant is, maar is **niet geschikt** zodra dat wel het geval is.
**Status:** **actief risico, expliciet gemarkeerd, niet stilzwijgend voortgezet.** Zie 03-data-security-and-rls.md en 06-prioritized-roadmap.md (P3, blokkerend besluit).
**Reviewmoment:** vóór eerste pilot met een externe/tweede tenant — geen uitzondering.

---

## ADR-008 — Databaserol: momenteel superuser-equivalent (`rolbypassrls: true`)

**Context:** geen aparte runtime-rol was opgezet; `DATABASE_URL` verwijst naar de Supabase-standaard `postgres`-rol.
**Besluit (impliciet, nu expliciet erkend als fout):** dit was geen bewuste architectuurkeuze maar een omissie — ontdekt tijdens deze review via directe verificatie (`pg_roles`-query).
**Status:** **te corrigeren, Now-prioriteit** (zie 06-prioritized-roadmap.md, N1/N2). Geen ADR die dit rechtvaardigt; wordt vervangen door een rollenmodel-ADR zodra N1 is uitgevoerd.
**Reviewmoment:** direct.

---

## ADR-009 — Redis vervangen door Valkey

**Context:** Redis Ltd. wijzigde de licentie van Redis (RSALv2/SSPL) vanaf versie 7.4, niet langer een vrije open-sourcelicentie.
**Besluit:** `valkey/valkey:8.1-alpine` in plaats van `redis:*` — Linux Foundation BSD-3-fork, protocolcompatibel, geen codewijziging nodig (`REDIS_URL`-naamgeving ongewijzigd).
**Status:** vastgesteld, geïmplementeerd in `docker-compose.yml`. **Niet heroverwogen in deze review** — geen aanleiding gevonden om dit te wijzigen.
**Reviewmoment:** geen.

---

## ADR-010 — Node.js-versie: 24 (Active LTS)

**Context:** oorspronkelijk plan noemde `node:20-alpine`; Node 24 is inmiddels de actieve LTS, consistent met de dev-machine.
**Besluit:** `node:24-alpine` in Dockerfile.
**Status:** vastgesteld, geïmplementeerd. **Openstaand gebrek, ontdekt in deze review:** geen `.nvmrc`/`engines`-veld in `package.json` om dit ook lokaal af te dwingen.
**Reviewmoment:** bij P0-7-opvolging (zie 06-prioritized-roadmap.md, P0-categorie).
