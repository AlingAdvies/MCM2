# MCM2 — actuele status

## Laatst bijgewerkt
2026-07-27

## Doel
Transdev Vendor IT Compliance Survey als eerste verticale MVP-slice.

## Actieve blokkades

- **P0 — databaserol/RLS-bereikbaarheid, opgelost op 2026-07-27:** de runtime database-connectie gebruikte de Supabase-rol `postgres` (`rolbypassrls: true`). Nieuwe login-rol `clm_api_runtime` aangemaakt (`LOGIN`, erft van `clm_api`, `rolbypassrls: false`), `DATABASE_URL` in `.env` bijgewerkt. Tussentijdse extra bevinding: geen van de vier `clm_*`-rollen had ooit `USAGE`-rechten op de schemas `clm`/`ref`/`audit` — hersteld via migratie `20260727053702_grant_schema_and_table_privileges`. Zie ADR-008.
- **P0 — migration-rol en geautomatiseerde RLS-test, opgelost op 2026-07-27:** aparte login-rol `clm_migrator` toegevoegd (los van zowel `postgres` als `clm_api_runtime`), rollen-bootstrap vastgelegd in `prisma/roles/bootstrap-roles.sql` (niet in de Prisma-migratiehistorie, want rollen zijn cluster-breed). De handmatige, ad-hoc RLS-verificatie is vervangen door een geautomatiseerde test (`test/tenant-rls-isolation.e2e-spec.ts`), die nu ook in CI draait tegen een ephemere, wegwerpbare Postgres-container (`.github/workflows/ci.yml`, job `rls-isolation`) — bewust niet tegen de echte Supabase-database, om geen productiegeheim als GitHub Secret te hoeven gebruiken. Zie ADR-009 voor de volledige achtergrond, inclusief waarom dit geen Prisma-probleem was (de rolrechten-kwesties tijdens het bouwen hiervan waren PostgreSQL/Supabase-specifiek, los van de ORM-keuze).
- **P0 — nog open, niet aangeraakt door de twee punten hierboven:** tenantcontext komt nog blind uit client-input (`X-Tenant-Id`-header of query-parameter), zonder koppeling aan geverifieerde identiteit. Acceptabel als tijdelijke, expliciet erkende uitzondering zolang er geen externe/tweede tenant is — niet acceptabel zodra de Transdev-pilot echte externe leveranciers krijgt. Dit is een apart ontwerpvraagstuk (identiteit/membership-verificatie) en de enige nog resterende P0-blocker.
- **P1:** ORM-keuze Prisma 6 versus Drizzle is nog open. Prisma 7 is geblokkeerd voor verdere featurebouw wegens een bevestigd, reproduceerbaar conflict tussen Jest-tests, de Prisma 7 Client Engine/generator-output en de gecompileerde Docker-productiebuild.
- CI dekt format/lint/typecheck én de RLS-isolatietest (zie hieronder). Geen `docker build` of de volledige `npm test`/`npm run build` in CI — expliciet uitgesteld tot na de Prisma 6/Drizzle-spike (ADR-007).
- Geen branch-protection op `main`: technisch geblokkeerd, niet vergeten. GitHub Branch Protection op een privérepository vereist een betaald plan (Pro/Team) voor de organisatie `AlingAdvies`; dat is nu niet actief (bevestigd via de GitHub API op 2026-07-27: `403 Upgrade to GitHub Pro or make this repository public`). Tot een upgrade is geregeld, is "nooit rechtstreeks op main werken" (MCM2-CLAUDE.md §10) uitsluitend een werkregel, geen technische afdwinging — een falende CI-check of een directe push naar `main` wordt nu niet door GitHub tegengehouden.
- Vijf Transdev-klantvragen nog open: exportformaat, of toelichting bij bepaalde survey-antwoordopties verplicht is, upload-validatie-eisen voor het certificaat, welke van de vijf vragen welk vraagtype heeft, en de SMTP-verbindingsdetails voor `contractmanagement@transdev.nl` (expliciet nog "volgt").
- Interne-authenticatie-spike (Cognito+Entra ID via een Microsoft-zakelijk account van de eigenaar) nog niet uitgevoerd — bepaalt of een volwaardige federatie haalbaar is binnen de deadline, of dat een tijdelijk vereenvoudigd alternatief nodig is.

## Aantoonbaar werkend

- NestJS-skeleton en health-check-endpoint: gebouwd, getest, gecommit.
- Docker Compose-stack (mcm2-api + minio + valkey): opgezet, health-check via Docker geverifieerd.
- Eerste Prisma-schema (Tenant, User, Vendor-cluster, AuditEvent + ref-lookups) en migratie: uitgevoerd tegen de Supabase `clm-enterprise`-database, inclusief RLS-policies (`USING`+`WITH CHECK`) en seed-data.
- WSL2 en Docker Desktop: werkend op de ontwikkelmachine.
- Vier database-rollen (`clm_api`, `clm_admin`, `clm_readonly`, `clm_audit_reader`) bestaan in de database met `rolbypassrls=false`, hebben `USAGE`+tabelrechten op `clm`/`ref`/`audit`, en `clm_api` heeft een inlogbare runtime-rol (`clm_api_runtime`) die de app daadwerkelijk gebruikt. Zie ADR-008.
- Aparte migration-rol `clm_migrator` (LOGIN, geen `BYPASSRLS`), bootstrap vastgelegd in `prisma/roles/bootstrap-roles.sql`. Migraties (`npm run migrate:deploy`/`migrate:status`) lopen voortaan via `clm_migrator`, nooit meer via `postgres`. Volledige keten (bootstrap → migraties → RLS-test) end-to-end geverifieerd op een verse, lokale Postgres 18.2-container. Zie ADR-009.
- Geautomatiseerde cross-tenant RLS-isolatietest (`test/tenant-rls-isolation.e2e-spec.ts`): geen `BYPASSRLS`, geen rijen zonder tenant-context, correcte read/write-isolatie tussen twee tenants, en een cross-tenant write wordt geweigerd door de `WITH CHECK`-policy. Draait lokaal (`npm run test:e2e`) én automatisch in CI tegen een ephemere testdatabase. Zie ADR-009.
- CI-workflow `.github/workflows/ci.yml` (GitHub Actions), twee jobs: `quality` (format-check, lint-check, typecheck) en `rls-isolation` (bootstrap + migraties via `clm_migrator` + RLS-test via `clm_api_runtime` tegen een ephemere Postgres-servicecontainer). Beide jobs groen bevestigd in GitHub Actions zelf (run `30242917733`, 2026-07-27). Zie ADR-007 en ADR-009.
- Repository staat op GitHub: `https://github.com/AlingAdvies/MCM2` (privé), remote `origin`, aangemaakt en voor het eerst gepusht op 2026-07-27. Hiervoor bestond alleen een lokale repository zonder remote.

## Niet als bewezen beschouwen

- RLS-tenant-isolatie was tot 2026-07-27 niet bewezen zolang de runtime-role nog `BYPASSRLS` had — een eerdere "RLS werkt"-verificatie in deze projectgeschiedenis was vals-positief (lege tabel, geen bewijs van daadwerkelijke blokkade). **Nu aantoonbaar bewezen én geautomatiseerd** (zie hierboven en ADR-009) — niet langer een handmatige, ad-hoc verificatie.
- Elke aanname uit `docs/context/PROJECT-HISTORY-2026-07-24.md` die alleen op historische sessienotities berust: **historisch gemeld; opnieuw verifiëren bij de volgende technische fase.** Dit geldt met name voor:
  - de exacte Prisma-7-generatorinstellingen (voorwaardelijk aan een ORM-keuze die nog niet definitief is);
  - of het `mvm-api-pilot`-wachtwoordlek inmiddels is opgelost (nooit definitief bevestigd);
  - de exacte Supabase-tier/backup-garanties (nooit expliciet geverifieerd, zie ADR-002).

## Huidige branch en Git-status

- Branch: `main`. Working tree schoon (geverifieerd via `git status` op 2026-07-27).
- `chore/restructure-project-context` is inmiddels in `main` opgegaan (laatste commit op die lijn: `beb3e66`, "docs(fase0): archiveer opdrachtinstructie en eerdere techstack-evaluatie") en bestaat niet meer als losse branch.
- Open branch: `feat/fase0-skeleton-vendors` (commit `4581edd`, "wip(fase0): Taak 6 tussenstand") — **bewust geparkeerd op 2026-07-27**, niet mergen zonder herbeoordeling. Bevat `TenantMiddleware` die de tenant blind afleidt uit een ongeverifieerde `X-Tenant-Id`-header of een `?tenant=`-query-param — dit is exact het patroon dat P0 als kritiek aanmerkt en dat MCM2-CLAUDE.md §6 verbiedt ("vertrouw nooit blind op X-Tenant-Id, queryparameters..."). Ook `withTenant()` gebruikt `$executeRawUnsafe` met stringinterpolatie van `tenantId` (met voorafgaande UUID-regex-validatie) in plaats van een geparametriseerde aanpak. Deze branch is bovendien fors verouderd t.o.v. `main` (mist de volledige documentatieherstructurering en de CI-workflow van 2026-07-24/27). Herbeoordelen ná P0: het `withTenant`-transactiepatroon (`SET LOCAL` binnen `$transaction`) is bruikbaar als uitgangspunt; de header-gebaseerde tenant-afleiding niet.

## Eerstvolgende goedgekeurde stap

P0 is grotendeels afgerond: databaserol/RLS-bereikbaarheid, migration-rol en geautomatiseerde RLS-test zijn klaar (zie hierboven, ADR-008/ADR-009). Eén P0-punt resteert: tenantcontext-verificatie. Geen featurebouw, ORM-migratie of productievoorstel totdat ook dit is afgerond. Eerstvolgende toegestane acties, in volgorde:

1. P0-restpunt (laatste): tenantcontext-verificatie herontwerpen (van blinde header/query-param naar geverifieerde identiteit + membership) — dit is de enige nog resterende P0-blocker.
2. Na volledige P0: de goedgekeurde, beperkte technical spike (Prisma 6 vs. Drizzle) tegen de Transdev-survey-slice.
3. Beantwoorden van de vijf resterende Transdev-klantvragen (kan parallel, is geen technische afhankelijkheid).

## Belangrijke verwijzingen

- Architectuurreview: `docs/architecture-review/2026-07-24/` (00 t/m 09)
- Actieve ADR's: `docs/adr/`, inclusief ADR-007 (CI-platform: GitHub Actions; eerste CI-scope: format/lint/typecheck, test/build bewust uitgesteld tot na de ORM-spike), ADR-008 (P0-databaserolherstel: clm_api_runtime, ontbrekende schema-grants, tijdelijke clm_admin=clm_api-gelijkstelling) en ADR-009 (migration-rol clm_migrator, rollenbootstrap, geautomatiseerde RLS-test in CI via ephemere testdatabase)
- Runbooks: `docs/runbooks/` (nog leeg — eerste runbooks volgen zodra de bijbehorende functionaliteit bestaat)
- Historisch projectcontextdocument: `docs/context/PROJECT-HISTORY-2026-07-24.md`
- Volledig gearchiveerd, vervangen instructiebestand: `docs/archive/MCM2-CLAUDE-2026-07-24-pre-restructure.md`
