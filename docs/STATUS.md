# MCM2 — actuele status

## Laatst bijgewerkt
2026-07-28 (Drizzle-omzetting uitgevoerd en geverifieerd tegen een verse database — alles hieronder is geverifieerd, niet uit gespreksgeheugen)

## Voor een nieuwe sessie: lees dit eerst

1. Lees `MCM2-CLAUDE.md` volledig (sessiestartprotocol, §14).
2. Lees dit document (`docs/STATUS.md`) volledig — het is de enige actuele waarheid over fase en blockers.
3. Verifieer git-status zelf (`git status`, `git branch -a`) tegen wat hieronder staat — vertrouw niet blind op deze snapshot.
4. Check de open GitHub Issues (`gh issue list --repo AlingAdvies/MCM2 --state open`) voor de actuele backlog — dit document verwijst naar issue-nummers, maar de Issues zelf zijn de bron van waarheid over wat daadwerkelijk nog open staat.
5. **Eerste concrete vervolgstap: Issue #7** (tenantcontext-verificatie) — de enige nog resterende P0-blocker. De volledige stand van zaken staat in het Issue #7-blok onder "Actieve blokkades"; de volgorde t.o.v. andere issues in "Eerstvolgende goedgekeurde stap".

## Doel
Transdev Vendor IT Compliance Survey als eerste verticale MVP-slice.

## Actieve blokkades

- **P0 — databaserol/RLS-bereikbaarheid, opgelost op 2026-07-27:** de runtime database-connectie gebruikte de Supabase-rol `postgres` (`rolbypassrls: true`). Nieuwe login-rol `clm_api_runtime` aangemaakt (`LOGIN`, erft van `clm_api`, `rolbypassrls: false`), `DATABASE_URL` in `.env` bijgewerkt. Tussentijdse extra bevinding: geen van de vier `clm_*`-rollen had ooit `USAGE`-rechten op de schemas `clm`/`ref`/`audit` — hersteld via migratie `20260727053702_grant_schema_and_table_privileges`. Zie ADR-008.
- **P0 — migration-rol en geautomatiseerde RLS-test, opgelost op 2026-07-27:** aparte login-rol `clm_migrator` toegevoegd (los van zowel `postgres` als `clm_api_runtime`), rollen-bootstrap vastgelegd in `prisma/roles/bootstrap-roles.sql` (niet in de Prisma-migratiehistorie, want rollen zijn cluster-breed). De handmatige, ad-hoc RLS-verificatie is vervangen door een geautomatiseerde test (`test/tenant-rls-isolation.e2e-spec.ts`), die nu ook in CI draait tegen een ephemere, wegwerpbare Postgres-container (`.github/workflows/ci.yml`, job `rls-isolation`) — bewust niet tegen de echte Supabase-database, om geen productiegeheim als GitHub Secret te hoeven gebruiken. Zie ADR-009 voor de volledige achtergrond, inclusief waarom dit geen Prisma-probleem was (de rolrechten-kwesties tijdens het bouwen hiervan waren PostgreSQL/Supabase-specifiek, los van de ORM-keuze).
- **P0 — nog open (Issue #7), de zwaarste resterende P0-blocker:** tenantcontext komt nog blind uit client-input (`X-Tenant-Id`-header of query-parameter), zonder koppeling aan geverifieerde identiteit. Acceptabel als tijdelijke, expliciet erkende uitzondering zolang er geen externe/tweede tenant is — niet acceptabel zodra de Transdev-pilot echte externe leveranciers krijgt.

  Issue #7 vraagt om **twee gescheiden mechanismen**, met verschillende voortgang:
  - **Interne beheerder** — identity-infrastructuur staat en werkt. Besluit: Microsoft Entra External ID als CIAM-laag (ADR-006, herzien op 2026-07-27; AWS Cognito losgelaten vóór er resources waren aangemaakt, dus geen opruimwerk). De federatie-PoC is geslaagd: tenant `mcm2ciam.onmicrosoft.com`, federatie met `alingadvies.nl`, end-to-end doorlopen tot een geldige authorization code (`?code=...`, geen error). Volledige configuratie — tenant-ID's, client-ID's, endpoints — plus een gedocumenteerde tijdelijke blokkade die zonder configuratiewijziging verdween: `docs/architecture-review/2026-07-27/01-entra-external-id-poc-bevindingen.md`. **Nog te bouwen:** authorization code server-to-server inwisselen, claims inspecteren, NestJS-guard die de tenantcontext uit het geverifieerde ID-token afleidt.
  - **Externe leverancier** — tokengebaseerde, accountloze survey-linktoegang. Staat volledig los van de CIAM-laag (leveranciers hebben geen Entra-account bij de klant). **Nog niet gestart.**

  Het tijdelijke AWS-account `727732213368` is niet langer nodig voor identity.
- **P0 — nieuw op 2026-07-28 (Issue #25): Drizzle-migratiestand op de bestaande Supabase-database.** De omzetting naar Drizzle is uitsluitend getest op verse, lege Postgres-containers. De Supabase-database `clm-enterprise` bevat nog de Prisma-migratiehistorie (`public._prisma_migrations`); Drizzle kent die niet en zou bij een `migrate:deploy` de baseline opnieuw willen toepassen op tabellen die al bestaan. **Niet uitproberen zonder plan en backup.** Zie ADR-010, sectie "Openstaand risico".
- **P0 — twee overige open issues, niet aangeraakt door het bovenstaande:**
  - **#1** — wachtwoordrotatie van de `postgres`-beheerrol.
  - **#3** — `tsconfig.json` naar strict-mode, module-systeem-inconsistentie oplossen.
  - ~~**#2** — `pg` en `@types/pg` als directe dependency~~ — **afgerond 2026-07-28**, bijvangst van de Drizzle-omzetting.
- ~~**P1:** ORM-keuze Prisma 6 versus Drizzle~~ — **besloten en uitgevoerd op 2026-07-28: Drizzle** (ADR-010, commit `e9df0dc`). De vergelijkende spike uit Issue #5 is niet uitgevoerd; in plaats daarvan zijn de zeven criteria uit MCM2-CLAUDE.md §5 getoetst op de daadwerkelijke omzetting. Prisma is volledig verwijderd. Bevinding die de omvang bepaalde: geen enkele regel applicatiecode gebruikte Prisma, dus het oorspronkelijke Prisma 7-conflict was op dat moment niet reproduceerbaar — er was geen code die het kon uitlokken.
- CI dekt nu format/lint/typecheck, unit tests, een Docker-productiebuild die de image ook daadwerkelijk start, én beide tenant-isolatietests (zie hieronder). De eerdere beperking "geen `docker build` in CI, uitgesteld tot na de ORM-spike" (ADR-007) is daarmee vervallen.
- Geen branch-protection op `main`: technisch geblokkeerd, niet vergeten. GitHub Branch Protection op een privérepository vereist een betaald plan (Pro/Team) voor de organisatie `AlingAdvies`; dat is nu niet actief (bevestigd via de GitHub API op 2026-07-27: `403 Upgrade to GitHub Pro or make this repository public`). Tot een upgrade is geregeld, is "nooit rechtstreeks op main werken" (MCM2-CLAUDE.md §10) uitsluitend een werkregel, geen technische afdwinging — een falende CI-check of een directe push naar `main` wordt nu niet door GitHub tegengehouden.
- Vijf Transdev-klantvragen nog open: exportformaat, of toelichting bij bepaalde survey-antwoordopties verplicht is, upload-validatie-eisen voor het certificaat, welke van de vijf vragen welk vraagtype heeft, en de SMTP-verbindingsdetails voor `contractmanagement@transdev.nl` (expliciet nog "volgt").

## Aantoonbaar werkend

- **Drizzle als databaselaag (2026-07-28, ADR-010, commit `e9df0dc`).** Geverifieerd tegen twee verse Postgres 18.2-containers, niet beredeneerd: migraties draaien op een lege database via `clm_migrator`; de bestaande RLS-isolatietest slaagt **ongewijzigd** (5 tests); een nieuwe test via de Drizzle-querylaag zelf slaagt (6 tests, `test/drizzle-tenant-context.e2e-spec.ts`); de productie-image bouwt, start, verbindt als `clm_api_runtime` en `/health` antwoordt `HTTP 200`; opstarten met een `BYPASSRLS`-rol wordt geweigerd met een expliciete foutmelding; grants correct toegepast (`clm_api` heeft geen DELETE op audit). Prisma is volledig verwijderd — pakketten, schema, migratiehistorie, gegenereerde client en configuratie.
- **Docker-productiebuild (2026-07-28).** De Dockerfile bouwde de app voorheen niet (`npm install` + `start:dev`); nu multi-stage met `npm ci`, non-root gebruiker en `node dist/main`. Dit was criterium 1 uit §5 en voorheen voor géén enkele ORM toetsbaar. Lost Issue #20 gedeeltelijk op; de base-image is nog niet op een exacte patchversie gepind.
- NestJS-skeleton en health-check-endpoint: gebouwd, getest, gecommit.
- Docker Compose-stack (mcm2-api + minio + valkey): opgezet, health-check via Docker geverifieerd.
- Eerste Prisma-schema (Tenant, User, Vendor-cluster, AuditEvent + ref-lookups) en migratie: uitgevoerd tegen de Supabase `clm-enterprise`-database, inclusief RLS-policies (`USING`+`WITH CHECK`) en seed-data.
- WSL2 en Docker Desktop: werkend op de ontwikkelmachine.
- Vier database-rollen (`clm_api`, `clm_admin`, `clm_readonly`, `clm_audit_reader`) bestaan in de database met `rolbypassrls=false`, hebben `USAGE`+tabelrechten op `clm`/`ref`/`audit`, en `clm_api` heeft een inlogbare runtime-rol (`clm_api_runtime`) die de app daadwerkelijk gebruikt. Zie ADR-008.
- Aparte migration-rol `clm_migrator` (LOGIN, geen `BYPASSRLS`), bootstrap vastgelegd in `prisma/roles/bootstrap-roles.sql`. Migraties (`npm run migrate:deploy`/`migrate:status`) lopen voortaan via `clm_migrator`, nooit meer via `postgres`. Volledige keten (bootstrap → migraties → RLS-test) end-to-end geverifieerd op een verse, lokale Postgres 18.2-container. Zie ADR-009.
- Geautomatiseerde cross-tenant RLS-isolatietest (`test/tenant-rls-isolation.e2e-spec.ts`): geen `BYPASSRLS`, geen rijen zonder tenant-context, correcte read/write-isolatie tussen twee tenants, en een cross-tenant write wordt geweigerd door de `WITH CHECK`-policy. Draait lokaal (`npm run test:e2e`) én automatisch in CI tegen een ephemere testdatabase. Zie ADR-009.
- CI-workflow `.github/workflows/ci.yml` (GitHub Actions), twee jobs: `quality` (format-check, lint-check, typecheck) en `rls-isolation` (bootstrap + migraties via `clm_migrator` + RLS-test via `clm_api_runtime` tegen een ephemere Postgres-servicecontainer). Beide jobs groen bevestigd in GitHub Actions zelf (run `30242917733`, 2026-07-27). Zie ADR-007 en ADR-009.
- Repository staat op GitHub: `https://github.com/AlingAdvies/MCM2` (privé), remote `origin`, aangemaakt en voor het eerst gepusht op 2026-07-27. Hiervoor bestond alleen een lokale repository zonder remote.
- **Issue #4 (EntraID-haalbaarheidscheck) afgerond op 2026-07-27:** `kees@alingadvies.nl` heeft Global Administrator in de Entra ID-tenant `alingadvies.nl`, ruim voldoende voor app-registraties; geen Azure-subscription gekoppeld maar dat blokkeert Entra-app-registraties niet. Rechtencheck is tegen `alingadvies.nl` gedaan, niet tegen een Transdev-tenant (geen toegang tot Transdev's Entra-omgeving) — `alingadvies.nl` dient als voorbeeld-/testtenant. De destijds gekozen uitvoeringsvorm (Cognito) is nadien herzien, zie hieronder.
- **ADR-006 herzien op 2026-07-27 (Cognito → Entra External ID):** vóór er een Cognito User Pool werd aangemaakt bleek de tweede cloudlaag (los AWS-account, cross-cloud federatie) onnodige complexiteit t.o.v. Microsoft Entra External ID, dat dezelfde multi-IdP-flexibiliteit biedt binnen het Microsoft-ecosysteem — geen los AWS-account, gratis tot 50.000 MAU. Reden om niet simpelweg "kaal" Entra ID te gebruiken (zoals een ouder platformdocument uit 2026-03-30 voorstelde): MCM2's multi-tenant-toekomst qua identity-providers is onzeker (niet aantoonbaar Microsoft-only), dus een CIAM-laag blijft gewenst. Zie `docs/adr/ADR-006-ciam-laag-entra-external-id.md` (bestandsnaam gewijzigd op 2026-07-27; heette eerder `ADR-006-cognito-als-federatielaag.md`).

## Niet als bewezen beschouwen

- RLS-tenant-isolatie was tot 2026-07-27 niet bewezen zolang de runtime-role nog `BYPASSRLS` had — een eerdere "RLS werkt"-verificatie in deze projectgeschiedenis was vals-positief (lege tabel, geen bewijs van daadwerkelijke blokkade). **Nu aantoonbaar bewezen én geautomatiseerd** (zie hierboven en ADR-009) — niet langer een handmatige, ad-hoc verificatie.
- Elke aanname uit `docs/context/PROJECT-HISTORY-2026-07-24.md` die alleen op historische sessienotities berust: **historisch gemeld; opnieuw verifiëren bij de volgende technische fase.** Dit geldt met name voor:
  - de exacte Prisma-7-generatorinstellingen (voorwaardelijk aan een ORM-keuze die nog niet definitief is);
  - of het `mvm-api-pilot`-wachtwoordlek inmiddels is opgelost (nooit definitief bevestigd);
  - de exacte Supabase-tier/backup-garanties (nooit expliciet geverifieerd, zie ADR-002).

## Huidige branch en Git-status

- **Actieve branch: `feat/issue-5-drizzle-omzetting`** (commit `e9df0dc`). Bevat de volledige Drizzle-omzetting. Nog niet gepusht, nog niet gemerged — wacht op beoordeling door de eigenaar.
- **Open branch: `docs/issue-7-leveranciertoken-ontwerp`** (commit `a083a24`). Bevat het ontwerpdocument voor het tokengebaseerde leverancierspoor van Issue #7, inclusief §5a over de levensduur van de omliggende gegevens. Nog niet gepusht. Geen code, alleen documentatie.
- Branch: `main`, up to date met `origin/main`. Working tree schoon.
- `chore/issue-4-entraid-haalbaarheid` is op 2026-07-27 gemerged naar `main` (vier documentatiecommits: Issue #4-afronding, ADR-006-herziening naar Entra External ID, PoC-bevindingendocument en de bijwerking daarvan naar "geslaagd") en daarna lokaal én op GitHub verwijderd. Daarna is direct op `main` nog een documentatie-consistentieronde gedaan (ADR-006 hernoemd, feitelijke fout over de gebruikte app-registratie gecorrigeerd, Issue #7-status samengevoegd tot één blok), gevolgd door het toevoegen van het sessieafsluitprotocol (MCM2-CLAUDE.md §14b) en de backlog-synchronisatie die daaruit voortkwam.
- `chore/restructure-project-context` is inmiddels in `main` opgegaan (laatste commit op die lijn: `beb3e66`, "docs(fase0): archiveer opdrachtinstructie en eerdere techstack-evaluatie") en bestaat niet meer als losse branch.
- Open branch: `feat/fase0-skeleton-vendors` (commit `4581edd`, "wip(fase0): Taak 6 tussenstand") — **bewust geparkeerd op 2026-07-27**, niet mergen zonder herbeoordeling. Bevat `TenantMiddleware` die de tenant blind afleidt uit een ongeverifieerde `X-Tenant-Id`-header of een `?tenant=`-query-param — dit is exact het patroon dat P0 als kritiek aanmerkt en dat MCM2-CLAUDE.md §6 verbiedt ("vertrouw nooit blind op X-Tenant-Id, queryparameters..."). Ook `withTenant()` gebruikt `$executeRawUnsafe` met stringinterpolatie van `tenantId` (met voorafgaande UUID-regex-validatie) in plaats van een geparametriseerde aanpak. Deze branch is bovendien fors verouderd t.o.v. `main` (mist de volledige documentatieherstructurering en de CI-workflow van 2026-07-24/27). Herbeoordelen ná P0. **Bijgewerkt 2026-07-28:** het `withTenant`-transactiepatroon is inmiddels opnieuw gebouwd op `main`-lijn in `src/db/database.service.ts` (Drizzle-transactie, tenantcontext via `set_config()` met een echte queryparameter in plaats van `$executeRawUnsafe` met stringinterpolatie). Deze branch heeft daarmee nog uitsluitend historische waarde; er valt niets bruikbaars meer uit over te nemen. Kan na beoordeling verwijderd worden.

## Eerstvolgende goedgekeurde stap

De zwaarste P0-punten zijn afgerond: databaserol/RLS-bereikbaarheid, migration-rol en geautomatiseerde RLS-test (ADR-008/ADR-009), en de databaselaag is besloten en omgezet (ADR-010). Er staan nog **vier** issues op `priority:p0`: #7 (tenantcontext-verificatie, het zwaarste), #25 (nieuw, Drizzle-migratiestand op Supabase), #1 en #3. Eerstvolgende toegestane acties, in volgorde — zie de bijbehorende GitHub Issue voor het volledige acceptatiecriterium:

0. **Beoordelen van de twee openstaande branches** (`feat/issue-5-drizzle-omzetting` en `docs/issue-7-leveranciertoken-ontwerp`) en beslissen over mergen. Beide zijn nog niet gepusht.

1. **Issue #7** — tenantcontext-verificatie herontwerpen (van blinde header/query-param naar geverifieerde identiteit + membership) — de enige nog resterende P0-blocker. De identity-infrastructuur staat en werkt (Entra External ID-PoC geslaagd, zie hierboven). Vervolgstap nu concreet: (a) authorization code server-to-server inwisselen voor tokens en de claims inspecteren, (b) NestJS-guard bouwen die het ID-token tegen de JWKS van `mcm2ciam` verifieert en daaruit de tenantcontext afleidt, config-gedreven via environment-variabelen. Daarnaast, als apart spoor binnen hetzelfde issue: het tokengebaseerde mechanisme voor externe leveranciers (nog niet gestart).
2. **Issue #25** — Drizzle-migratiestand initialiseren op de bestaande Supabase-database (P0, nieuw). Blokkeert elke migratie tegen de echte database; raakt gedeelde data, dus vereist een backup-/herstelplan vóór uitvoering.
3. **Issue #1** — wachtwoordrotatie van de `postgres`-beheerrol (P0, niet aangeraakt door de databaserol-fix van 2026-07-27).
4. **Issue #3** — `tsconfig.json` naar strict-mode, module-systeem-inconsistentie oplossen (P0, klein). De eerdere kanttekening hierbij ("kan typefouten blootleggen die per ORM verschillen") is vervallen nu de databaselaag vastligt.
5. ~~**Issue #2** — `pg` en `@types/pg` als directe dependency~~ — **afgerond 2026-07-28**, bijvangst van ADR-010.
6. ~~**Issue #4** — EntraID-federatie haalbaarheidscheck~~ — **afgerond 2026-07-27**, zie hierboven en ADR-006.
7. ~~**Issue #5** — ORM-spike Prisma 6 vs. Drizzle~~ — **besloten 2026-07-28: Drizzle** (ADR-010). De spike zelf is niet uitgevoerd; de zeven criteria zijn op de daadwerkelijke omzetting getoetst. Issue #6 (definitieve ORM-implementatie) is hiermee inhoudelijk afgehandeld.
8. **Issue #15** — beantwoorden van de vijf resterende Transdev-klantvragen (kan parallel, is geen technische afhankelijkheid).

Volledige backlog (alle 24 items, incl. Before production en Later): `gh issue list --repo AlingAdvies/MCM2` of `https://github.com/AlingAdvies/MCM2/issues`.

## Belangrijke verwijzingen

- **Backlog/roadmap: GitHub Issues** (`https://github.com/AlingAdvies/MCM2/issues`), gelabeld met type (`bug`/`enhancement`/`chore`) en prioriteit (`priority:p0`/`priority:before-pilot`/`priority:before-production`/`priority:later`). Vervangt de losse Markdown-roadmap sinds 2026-07-27 (zie `docs/archive/06-prioritized-roadmap-2026-07-24-pre-issues.md` voor de migratieverantwoording en issue-nummer-mapping).
- Architectuurreview: `docs/architecture-review/2026-07-24/` (00, 02-05, 07-09 — 06 is verplaatst naar `docs/archive/`, zie hierboven)
- Actieve ADR's: `docs/adr/`, inclusief ADR-006 (CIAM-laag: Microsoft Entra External ID — herzien op 2026-07-27, AWS Cognito verworpen; bestand heette eerder `ADR-006-cognito-als-federatielaag.md`), ADR-007 (CI-platform: GitHub Actions; eerste CI-scope: format/lint/typecheck, test/build bewust uitgesteld tot na de ORM-spike), ADR-008 (P0-databaserolherstel: clm_api_runtime, ontbrekende schema-grants, tijdelijke clm_admin=clm_api-gelijkstelling), ADR-009 (migration-rol clm_migrator, rollenbootstrap, geautomatiseerde RLS-test in CI via ephemere testdatabase) en ADR-010 (databaselaag Drizzle, Prisma verwijderd; inclusief de toetsing van de zeven §5-criteria en het openstaande Supabase-risico)
- Runbooks: `docs/runbooks/` (nog leeg — eerste runbooks volgen zodra de bijbehorende functionaliteit bestaat)
- Historisch projectcontextdocument: `docs/context/PROJECT-HISTORY-2026-07-24.md`
- Volledig gearchiveerd, vervangen instructiebestand: `docs/archive/MCM2-CLAUDE-2026-07-24-pre-restructure.md`
