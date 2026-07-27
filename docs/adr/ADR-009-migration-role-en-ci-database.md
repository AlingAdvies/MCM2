# ADR-009 — Rollenbootstrap, migration-rol op verse databases, en geautomatiseerde RLS-test in CI

- Status: Accepted, geïmplementeerd
- Datum: 2026-07-27
- Context: ADR-008 loste P0's databaserol-probleem op voor de bestaande Supabase-database (login-rol `clm_api_runtime`, ontbrekende schema-grants), maar liet twee punten open: (1) er bestond geen aparte migration-rol, los van zowel `postgres` (te breed) als `clm_api_runtime` (te smal voor DDL), en (2) de RLS-isolatieverificatie was handmatig en ad-hoc, geen geautomatiseerde, herhaalbare test. Dit document sluit beide punten.

## Migration-rol: clm_migrator

Een nieuwe rol `clm_migrator` (LOGIN) is toegevoegd, uitsluitend bedoeld voor het uitvoeren van migraties (`prisma migrate deploy`/`status`), nooit voor applicatie-request-verkeer. Rollen zijn cluster-breed (niet database-specifiek) en horen daarom niet in de per-database Prisma-migratiehistorie — ze staan in een apart, versioned bestand: `prisma/roles/bootstrap-roles.sql`. Dit bestand is idempotent (`DO`-blokken met existence-checks) en is de enige bron van waarheid voor welke rollen moeten bestaan, gebruikt door zowel CI als het opzetten van een nieuwe omgeving.

### Ownership: rol maakt eigen objecten aan, geen overdracht

Aanvankelijk is geprobeerd `clm_migrator` retroactief eigenaar te maken van bestaande, door `postgres` geëigende objecten op Supabase (`ALTER ... OWNER TO`). Dat werkte op Supabase na een aantal iteraties (zie git-historie van de migratie `20260727054911_transfer_ownership_to_migrator`), maar bleek niet reproduceerbaar op een verse PostgreSQL-database (CI): de vereisten voor `ALTER TABLE ... OWNER TO` (PostgreSQL-documentatie: *"you must be able to SET ROLE to the new owning role, and that role must have CREATE privilege on the table's schema"*) zijn niet triviaal te vervullen wanneer de migratie zelf al als de doelrol (`clm_migrator`) draait — die rol kan zichzelf niet met `GRANT ... TO <uitvoerder>` tijdelijk extra rechten geven zonder `ADMIN OPTION` op zichzelf, wat een rol normaliter niet heeft.

De uiteindelijke, robuustere aanpak volgt de PostgreSQL-documentatie direct: *"the owner is normally the role that executed the creation statement."* Op elke nieuwe database maakt `clm_migrator` de schema's/tabellen/functies vanaf de eerste migratie zelf aan — dan is hij meteen eigenaar, zonder overdracht. De migratie `20260727054911_transfer_ownership_to_migrator` blijft in de historie staan als **eenmalig, historisch herstel specifiek voor de bestaande Supabase-database** (waar de objecten al bestonden vóórdat `clm_migrator` werd geïntroduceerd); op een verse database is diezelfde migratie een idempotente no-op (`ALTER TABLE x OWNER TO clm_migrator` wanneer `clm_migrator` al eigenaar is, verandert niets en geeft geen fout).

### PostgreSQL 15+ default-privileges-hardening

Sinds PostgreSQL 15 heeft een nieuwe rol standaard geen `CREATE`-recht op de database of het `public`-schema (de impliciete `PUBLIC`-rol kreeg dit niet langer als default — bewuste security-hardening, geen regressie). `bootstrap-roles.sql` geeft `clm_migrator` daarom expliciet `GRANT CREATE ON DATABASE postgres` en `GRANT CREATE ON SCHEMA public`, nodig om zelf `clm`/`ref`/`audit` en de Prisma-boekhoudingstabel `_prisma_migrations` te kunnen aanmaken.

### Niet-bevinding: dit was geen Prisma-probleem

Tijdens het uitzoeken van deze rolrechten-kwesties (`permission denied to grant role`, `permission denied for schema public`, PostgreSQL 16's `ADMIN OPTION`-wijziging) is expliciet gecontroleerd of dit verband hield met het reeds bekende Prisma 7 Jest/Docker-buildconflict (P1, zie `04-orm-decision-record.md`). Dat is niet het geval: dit waren PostgreSQL/Supabase-rolrechten-kwesties, onafhankelijk van welke ORM of migratietool wordt gebruikt — Prisma maakte het probleem alleen zichtbaar omdat het migraties dwingt via één specifieke, consistente rol te laten lopen, in plaats van het weg te laten vallen achter ad-hoc `postgres`-verbindingen.

## Geautomatiseerde RLS-isolatietest

`test/tenant-rls-isolation.e2e-spec.ts` vervangt de eerdere handmatige, ad-hoc verificatie (zie ADR-008) door een herhaalbare Jest-e2e-test die rechtstreeks via `pg` tegen `DATABASE_URL` draait (bewust niet via Prisma's client — vermijdt elke afhankelijkheid van de Prisma 7-generator-issues, en RLS-gedrag is databaselaag-eigen, geen ORM-eigenschap). De test bevestigt: geen `BYPASSRLS`-rol, geen rijen zichtbaar zonder tenant-context, schrijven toegestaan binnen de eigen context, lezen toont uitsluitend de eigen tenant, en een cross-tenant write wordt geweigerd door de `WITH CHECK`-policy.

### Bewuste keuze: niet in CI met de Supabase-database, wel met een ephemere CI-eigen database

Twee opties zijn overwogen om deze test automatisch te laten draaien:

1. **`DATABASE_URL` als GitHub Secret, tegen de echte Supabase-database** — verworpen. Dit zou betekenen dat elke PR (ook van eventuele toekomstige externe bijdragers) een geheim kan gebruiken dat tegen de gedeelde, echte database connect, met een reëel secret-lek-risico bij PR's vanuit forks — een bekend, veelvoorkomend GitHub Actions-beveiligingsprobleem.
2. **Een ephemere Postgres-`service`-container in CI, volledig los van Supabase** — gekozen. Geen productiegeheim nodig, geen risico voor echte klantdata, en de test draait automatisch bij elke PR/push naar `main`. Dit is ook wat `MCM2-CLAUDE.md` §10 al noemt ("migration test tegen lege database") en sluit aan bij de sowieso al vereiste reproduceerbaarheid van migraties op een lege database (§7.3).

`.github/workflows/ci.yml` heeft nu een tweede job (`rls-isolation`, naast `quality`) die: een `postgres:18.2`-servicecontainer start, `prisma/roles/bootstrap-roles.sql` erop toepast (als de container-eigen `postgres`-superuser — die is op een gewone Postgres-container, in tegenstelling tot Supabase, een echte superuser), CI-eigen wachtwoorden zet voor `clm_api_runtime`/`clm_migrator`, migraties toepast via `clm_migrator`, en de RLS-test draait via `clm_api_runtime`. Lokaal end-to-end geverifieerd (Docker, `postgres:18.2`) vóór toevoeging aan CI.

## Gevolgen

- `prisma/roles/bootstrap-roles.sql` is nu de enige bron van waarheid voor welke database-rollen moeten bestaan; toekomstige nieuwe omgevingen (acceptatie, disaster recovery) gebruiken dit script als eerste stap, vóór enige Prisma-migratie.
- CI faalt nu zichtbaar als een toekomstige codewijziging de tenant-isolatie breekt (bijv. een per ongeluk verwijderde policy of ingetrokken grant) — dit was vóór deze ADR niet het geval.
- `test/jest-e2e.setup.ts` (`import 'dotenv/config'`) toegevoegd aan `test/jest-e2e.json` zodat `.env` ook voor e2e-tests wordt geladen — dit ontbrak volledig, ook voor de al bestaande tests.

## Openstaand controlepunt

- De `quality`- en `rls-isolation`-jobs zijn niet verplicht gesteld via branch-protection (zie `docs/STATUS.md` — branch-protection is geblokkeerd door het GitHub-plan van de organisatie, niet door deze wijziging).
- Er is nog geen CI-stap voor `docker build` of de volledige `npm test`/`npm run build` — bewust uitgesteld tot na de Prisma 6/Drizzle-spike (ADR-007).

## Reviewmoment

Bij de Prisma 6/Drizzle-spike (de gekozen ORM kan een ander migratiecommando/-mechanisme vereisen dan `prisma migrate deploy`), en bij het opzetten van de eerste AWS-acceptatieomgeving (dezelfde `bootstrap-roles.sql` zou daar herbruikt moeten worden, met eigen secretbeheer voor de wachtwoorden).

## Bronnen

`MCM2-CLAUDE.md` §5–§7; ADR-008; `docs/architecture-review/2026-07-24/04-orm-decision-record.md`; PostgreSQL-documentatie (`ddl-priv.html`, `sql-altertable.html`, `role-membership.html`, `sql-createrole.html`); Supabase-documentatie (`guides/database/postgres/roles-superuser`).
