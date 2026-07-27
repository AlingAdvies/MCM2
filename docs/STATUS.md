# MCM2 — actuele status

## Laatst bijgewerkt
2026-07-27

## Doel
Transdev Vendor IT Compliance Survey als eerste verticale MVP-slice.

## Actieve blokkades

- **P0:** de runtime database role heeft `BYPASSRLS`. RLS is momenteel geen effectieve tenant-isolatiegrens, ongeacht hoe correct de policies zelf zijn. Bevestigd via `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user;` tegen de actieve connectie.
- **P0:** tenantcontext komt nog blind uit client-input (`X-Tenant-Id`-header of query-parameter), zonder koppeling aan geverifieerde identiteit. Acceptabel als tijdelijke, expliciet erkende uitzondering zolang er geen externe/tweede tenant is — niet acceptabel zodra de Transdev-pilot echte externe leveranciers krijgt.
- **P1:** ORM-keuze Prisma 6 versus Drizzle is nog open. Prisma 7 is geblokkeerd voor verdere featurebouw wegens een bevestigd, reproduceerbaar conflict tussen Jest-tests, de Prisma 7 Client Engine/generator-output en de gecompileerde Docker-productiebuild.
- CI dekt nog uitsluitend format/lint/typecheck (zie hieronder). Geen geautomatiseerde tests, Docker-build of migratietest in CI — expliciet uitgesteld tot na de Prisma 6/Drizzle-spike (ADR-007).
- Geen branch-protection op `main`: technisch geblokkeerd, niet vergeten. GitHub Branch Protection op een privérepository vereist een betaald plan (Pro/Team) voor de organisatie `AlingAdvies`; dat is nu niet actief (bevestigd via de GitHub API op 2026-07-27: `403 Upgrade to GitHub Pro or make this repository public`). Tot een upgrade is geregeld, is "nooit rechtstreeks op main werken" (MCM2-CLAUDE.md §10) uitsluitend een werkregel, geen technische afdwinging — een falende CI-check of een directe push naar `main` wordt nu niet door GitHub tegengehouden.
- Vijf Transdev-klantvragen nog open: exportformaat, of toelichting bij bepaalde survey-antwoordopties verplicht is, upload-validatie-eisen voor het certificaat, welke van de vijf vragen welk vraagtype heeft, en de SMTP-verbindingsdetails voor `contractmanagement@transdev.nl` (expliciet nog "volgt").
- Interne-authenticatie-spike (Cognito+Entra ID via een Microsoft-zakelijk account van de eigenaar) nog niet uitgevoerd — bepaalt of een volwaardige federatie haalbaar is binnen de deadline, of dat een tijdelijk vereenvoudigd alternatief nodig is.

## Aantoonbaar werkend

- NestJS-skeleton en health-check-endpoint: gebouwd, getest, gecommit.
- Docker Compose-stack (mcm2-api + minio + valkey): opgezet, health-check via Docker geverifieerd.
- Eerste Prisma-schema (Tenant, User, Vendor-cluster, AuditEvent + ref-lookups) en migratie: uitgevoerd tegen de Supabase `clm-enterprise`-database, inclusief RLS-policies (`USING`+`WITH CHECK`) en seed-data.
- WSL2 en Docker Desktop: werkend op de ontwikkelmachine.
- Vier database-rollen (`clm_api`, `clm_admin`, `clm_readonly`, `clm_audit_reader`) bestaan in de database met `rolbypassrls=false` — geverifieerd via `pg_roles`-query. Ontbrekend: koppeling aan een inlogbare gebruiker.
- CI-workflow `.github/workflows/ci.yml` (GitHub Actions): format-check, lint-check en typecheck op elke PR/push naar `main`. Groen bevestigd zowel lokaal als in GitHub Actions zelf (run `30239546165`, 2026-07-27, na de eerste push naar `origin/main`). Zie ADR-007.
- Repository staat op GitHub: `https://github.com/AlingAdvies/MCM2` (privé), remote `origin`, aangemaakt en voor het eerst gepusht op 2026-07-27. Hiervoor bestond alleen een lokale repository zonder remote.

## Niet als bewezen beschouwen

- RLS-tenant-isolatie zolang de runtime-role nog `BYPASSRLS` heeft (zie P0 hierboven) — een eerdere "RLS werkt"-verificatie in deze projectgeschiedenis was vals-positief (lege tabel, geen bewijs van daadwerkelijke blokkade).
- Elke aanname uit `docs/context/PROJECT-HISTORY-2026-07-24.md` die alleen op historische sessienotities berust: **historisch gemeld; opnieuw verifiëren bij de volgende technische fase.** Dit geldt met name voor:
  - de exacte Prisma-7-generatorinstellingen (voorwaardelijk aan een ORM-keuze die nog niet definitief is);
  - of het `mvm-api-pilot`-wachtwoordlek inmiddels is opgelost (nooit definitief bevestigd);
  - de exacte Supabase-tier/backup-garanties (nooit expliciet geverifieerd, zie ADR-002).

## Huidige branch en Git-status

- Branch: `main`. Working tree schoon (geverifieerd via `git status` op 2026-07-27).
- `chore/restructure-project-context` is inmiddels in `main` opgegaan (laatste commit op die lijn: `beb3e66`, "docs(fase0): archiveer opdrachtinstructie en eerdere techstack-evaluatie") en bestaat niet meer als losse branch.
- Open branch: `feat/fase0-skeleton-vendors` (commit `4581edd`, "wip(fase0): Taak 6 tussenstand") — **bewust geparkeerd op 2026-07-27**, niet mergen zonder herbeoordeling. Bevat `TenantMiddleware` die de tenant blind afleidt uit een ongeverifieerde `X-Tenant-Id`-header of een `?tenant=`-query-param — dit is exact het patroon dat P0 als kritiek aanmerkt en dat MCM2-CLAUDE.md §6 verbiedt ("vertrouw nooit blind op X-Tenant-Id, queryparameters..."). Ook `withTenant()` gebruikt `$executeRawUnsafe` met stringinterpolatie van `tenantId` (met voorafgaande UUID-regex-validatie) in plaats van een geparametriseerde aanpak. Deze branch is bovendien fors verouderd t.o.v. `main` (mist de volledige documentatieherstructurering en de CI-workflow van 2026-07-24/27). Herbeoordelen ná P0: het `withTenant`-transactiepatroon (`SET LOCAL` binnen `$transaction`) is bruikbaar als uitgangspunt; de header-gebaseerde tenant-afleiding niet.

## Eerstvolgende goedgekeurde stap

Geen featurebouw, ORM-migratie of productievoorstel totdat P0 is afgerond. Eerstvolgende toegestane acties, in volgorde:

1. P0-securityherstel: inlogbare gebruiker koppelen aan de bestaande `clm_api`-rol, wachtwoordrotatie, tenantcontext-verificatie herontwerpen.
2. Na P0: de goedgekeurde, beperkte technical spike (Prisma 6 vs. Drizzle) tegen de Transdev-survey-slice.
3. Beantwoorden van de vijf resterende Transdev-klantvragen (kan parallel, is geen technische afhankelijkheid).

## Belangrijke verwijzingen

- Architectuurreview: `docs/architecture-review/2026-07-24/` (00 t/m 09)
- Actieve ADR's: `docs/adr/`, inclusief ADR-007 (CI-platform: GitHub Actions; eerste CI-scope: format/lint/typecheck, test/build bewust uitgesteld tot na de ORM-spike)
- Runbooks: `docs/runbooks/` (nog leeg — eerste runbooks volgen zodra de bijbehorende functionaliteit bestaat)
- Historisch projectcontextdocument: `docs/context/PROJECT-HISTORY-2026-07-24.md`
- Volledig gearchiveerd, vervangen instructiebestand: `docs/archive/MCM2-CLAUDE-2026-07-24-pre-restructure.md`
