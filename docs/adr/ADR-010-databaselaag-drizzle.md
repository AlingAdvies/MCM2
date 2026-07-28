# ADR-010 — Databaselaag: Drizzle in plaats van Prisma

**Datum:** 2026-07-28
**Status:** besloten en uitgevoerd
**Vervangt:** de openstaande ORM-keuze uit MCM2-CLAUDE.md §5 (P1) en Issue #5
**Raakt:** Issue #2 (opgelost), Issue #20 (gedeeltelijk opgelost)

---

## Context

Prisma 7 stond sinds de architectuurreview van 2026-07-24 als **geblokkeerd** voor verdere
featurebouw, wegens een reproduceerbaar conflict tussen Jest-tests, de Prisma 7 Client
Engine/generator-output en de gecompileerde Docker-productiebuild (MCM2-CLAUDE.md §5, P1).

De voorgeschreven route was een vergelijkende spike tussen Prisma 6 en Drizzle tegen de
Transdev-survey-slice (Issue #5). Die spike heeft **niet** plaatsgevonden. De eigenaar heeft op
2026-07-28 rechtstreeks voor Drizzle gekozen. Deze ADR legt dat besluit vast én levert de
onderbouwing die de spike had moeten opleveren, door de zeven criteria uit §5 aantoonbaar te
toetsen op de daadwerkelijke omzetting in plaats van op een apart proefproject.

### Bevinding die de omvang bepaalde

Bij de inventarisatie bleek dat **geen enkele regel applicatiecode Prisma gebruikte**. Er was geen
`PrismaClient`-import in `src/`; de bestaande RLS-isolatietest praat rechtstreeks via `pg`. Prisma
vervulde feitelijk twee rollen: migratietooling, en een gegenereerde client die niemand aanriep.

Twee gevolgen:

1. De omzetting raakte geen werkende applicatielogica — aanzienlijk kleiner en veiliger dan
   vooraf ingeschat.
2. Het Prisma 7-conflict uit §5 was op dat moment **niet reproduceerbaar**: er was geen code die
   het kon uitlokken. Het zou terugkeren zodra Prisma daadwerkelijk in gebruik genomen werd — wat
   de blokkade juist verhinderde. Dat is geen weerlegging van de oorspronkelijke bevinding, maar
   het betekent wel dat een directe "Prisma 7 faalt, Drizzle niet"-vergelijking op dit moment niet
   te maken was.

---

## Besluit

De databaselaag wordt **Drizzle ORM 0.45.2** met **drizzle-kit 0.31.10**. Prisma is volledig
verwijderd: pakketten, schema, migratiehistorie, gegenereerde client en configuratie.

Versies zijn exact gepind (geen `^`), conform §11.

---

## Toetsing aan de zeven criteria uit §5

Alle onderstaande uitkomsten zijn daadwerkelijk uitgevoerd op 2026-07-28, tegen een verse
Postgres 18.2-container — niet beredeneerd.

| # | Criterium | Uitkomst |
|---|---|---|
| 1 | Betrouwbare Docker production build | ✅ **Bewezen, inclusief opstarten.** De bestaande Dockerfile bouwde de app niet eens (`npm install` + `start:dev`), waardoor dit criterium voorheen voor géén enkele ORM toetsbaar was. Nu een multi-stage build met `npm ci`, non-root gebruiker en een image die het gecompileerde resultaat draait. Geverifieerd: image start, verbindt als `clm_api_runtime`, `/health` antwoordt `HTTP 200`. |
| 2 | Tests zonder experimentele Node-vlaggen | ✅ 1 unit-test en 13 e2e-tests groen, gewone `jest`/`ts-jest`, geen vlaggen, geen workarounds. Drizzle genereert geen aparte client-engine, dus de generator-/moduleconflicten van Prisma 7 bestaan hier structureel niet. |
| 3 | RLS read/write-isolatie met twee tenants | ✅ De bestaande `tenant-rls-isolation.e2e-spec.ts` slaagt **ongewijzigd** tegen de Drizzle-database (5 tests). Aanvullend een nieuwe test via de Drizzle-querylaag zelf (6 tests), inclusief cross-tenant write die door `WITH CHECK` wordt geweigerd. |
| 4 | `SET LOCAL` + tenantqueries in dezelfde transactie/connectie | ✅ `DatabaseService.withTenant()` opent één transactie, zet de context als eerste statement, voert alles op dezelfde connectie uit. Getest inclusief het niet-lekken van context naar een volgende transactie. |
| 5 | Migraties op een lege testdatabase | ✅ Twee keer volledig doorlopen op een verse container: rollen-bootstrap → migraties via `clm_migrator` → tests via `clm_api_runtime`. Grants geverifieerd (`clm_api` heeft geen DELETE op audit). |
| 6 | Begrijpelijke documentatie, lage herstel-/onderhoudslast | ✅ Het schema is gewone TypeScript (`src/db/schema.ts`), geen aparte schemataal en geen generatiestap vóór het typechecken. Voor een eigenaar die zelf moet kunnen onderhouden is dat winst. |
| 7 | Geen fragiele module-, import- of generator-workarounds | ✅ Geen generatiestap in de build, geen `postinstall`, geen aparte engine-binary. Het migratiescript is bewust plain JavaScript (`scripts/migrate.js`), zodat het werkt zonder ts-node of module-resolutie-afhankelijkheid. |

### Belangrijkste aandachtspunt: RLS is handwerk

`drizzle-kit generate` produceert **uitsluitend** tabellen, indexen en foreign keys. RLS, policies,
functies, triggers en seed-data komen er niet uit. Die zijn handmatig overgenomen in
`drizzle/0000_baseline_bestaand_schema.sql`, functioneel identiek aan de oorspronkelijke
Prisma-migratie.

> **Gevolg voor elke volgende schemawijziging:** een gegenereerde migratie bevat nooit automatisch
> RLS voor een nieuwe tabel. Elke nieuwe tenantgebonden tabel vereist handmatig
> `ENABLE ROW LEVEL SECURITY` plus een policy met zowel `USING` als `WITH CHECK` (§7). Dit staat
> als waarschuwing in de migratie zelf.

Dit is geen nadeel van Drizzle specifiek — Prisma deed dit evenmin, daar stond dezelfde SQL ook
met de hand in de migratie. Het is wel een blijvend aandachtspunt dat expliciet vastgelegd moet
zijn, omdat de securitylaag anders afhangt van wat een generator toevallig ondersteunt.

---

## Gevolgen

### Opgelost als bijvangst

- **Issue #2** (P0): `pg` en `@types/pg` zijn nu expliciete, exact gepinde dependencies. Ze werden
  eerder impliciet gebruikt door de RLS-test zonder gedeclareerd te zijn.
- **Issue #20** (gedeeltelijk): de Dockerfile gebruikt nu `npm ci`, een multi-stage build en een
  non-root gebruiker. Wat nog rest: het pinnen van de base-image op een exacte patchversie
  (`node:24-alpine` volgt `.nvmrc`, dat zelf `24` zegt).

### Nieuwe structuur

| Was | Is |
|---|---|
| `prisma/schema.prisma` | `src/db/schema.ts` |
| `prisma/migrations/` | `drizzle/` |
| `prisma/roles/bootstrap-roles.sql` | `db/roles/bootstrap-roles.sql` (rollen staan los van de ORM) |
| `prisma.config.ts` | `drizzle.config.ts` |
| `npm run migrate:deploy` (Prisma) | `npm run migrate:deploy` (`scripts/migrate.js`) |
| — | `npm run db:generate`, `npm run db:check` |

De Prisma-migratiehistorie is niet meegenomen: `drizzle/0000_baseline_bestaand_schema.sql` is een
baseline die het bestaande schema volledig opnieuw opbouwt. De oude migraties blijven raadpleegbaar
in de git-historie (tot commit `dddc13b`).

### Openstaand risico: de bestaande Supabase-database

De omzetting is **uitsluitend getest op verse, lege databases**. De bestaande Supabase-database
`clm-enterprise` bevat de Prisma-migratiehistorie in `public._prisma_migrations` en tabellen die
door Prisma zijn aangemaakt. Drizzle kent die historie niet en zou bij een `migrate` de baseline
opnieuw willen toepassen.

Dit is **niet opgelost en niet getest**. Voordat er tegen de echte database gemigreerd wordt, moet
worden bepaald hoe Drizzle's `__drizzle_migrations`-tabel daar wordt geïnitialiseerd zonder de
baseline daadwerkelijk uit te voeren. Zie het bijbehorende issue.

### CI

De workflow heeft nu drie jobs: `quality` (format/lint/typecheck/unit tests), `docker-build`
(productie-image bouwen én starten) en `rls-isolation` (migraties op een lege database + beide
isolatietests). De `docker-build`-job controleert expliciet dat de container start tot aan de
configuratiecontrole — een image die bouwt maar niet draait was precies het Prisma 7-probleem.

---

## Overwogen alternatieven

**Prisma 6 (terugvallen op een oudere major).** Zou het generator-probleem mogelijk omzeilen, maar
lost de onderliggende bezwaren niet op: een aparte schemataal, een generatiestap vóór het
typechecken, en een engine-binary in de productie-image. Bovendien is teruggaan naar een oudere
major structureel een schuld, geen oplossing.

**Drizzle naast Prisma laten bestaan.** Verworpen: twee migratiesystemen op één database is een
bron van fouten, en het levert precies de dubbele laag op die de eigenaar wilde vermijden.

**Alsnog de vergelijkende spike uitvoeren.** Verworpen door de eigenaar op grond van de
deadline (1 september 2026). Deze ADR compenseert dat door de zeven criteria op de echte omzetting
te toetsen — strenger dan een proefproject, want het is de daadwerkelijke code.

---

## Reviewmoment

Herzien wanneer:

- de migratie tegen de bestaande Supabase-database aan de orde is (zie openstaand risico);
- de survey-tabellen uit het leverancierstoken-ontwerp zijn toegevoegd — dat is de eerste
  substantiële schemawijziging via Drizzle, en de eerste keer dat de handmatige RLS-stap in de
  praktijk wordt uitgevoerd;
- er alsnog een generator-, module- of buildprobleem opduikt dat aan Drizzle toe te schrijven is.
