# Current State Inventory — MCM2

Feitelijke inventarisatie, Fase A. Alle uitspraken zijn reproduceerbare observaties uit de repository, `package-lock.json`, of direct uitgevoerde (niet-destructieve) commando's op 2026-07-24. Geen aannames zonder markering.

---

## Runtime-omgeving

| Component | Versie | Bron |
|---|---|---|
| Node.js (dev-machine) | v24.13.1 | `node --version` |
| npm | 11.8.0 | `npm --version` |
| Docker | 29.6.2 | `docker --version` |
| PostgreSQL (Supabase `clm-enterprise`) | 17.6 | `SHOW server_version` tegen productie-database |

## Dependencies — exacte geïnstalleerde versies (uit `package-lock.json`)

| Package | Versie |
|---|---|
| @nestjs/common | 11.1.28 |
| @nestjs/core | 11.1.28 |
| @nestjs/platform-express | 11.1.28 |
| @nestjs/cli | 11.0.24 |
| @nestjs/schematics | 11.1.0 |
| @nestjs/testing | 11.1.28 |
| @prisma/client | 7.9.0 |
| @prisma/adapter-pg | 7.9.0 |
| prisma | 7.9.0 |
| pg | 8.22.0 (transitief via @prisma/adapter-pg, niet expliciet in package.json) |
| @types/pg | 8.20.0 (transitief) |
| class-validator | 0.15.1 |
| class-transformer | 0.5.1 |
| typescript | 5.9.3 |
| jest | 30.4.2 |
| ts-jest | 29.4.12 |
| eslint | 9.39.5 |
| dotenv | 17.4.2 |

**Afwijking:** `package.json` declareert `pg`/`@types/pg` niet expliciet, terwijl `src/prisma/prisma.service.ts` en `src/prisma/with-tenant.ts` er indirect van afhankelijk zijn via `@prisma/adapter-pg`. Risico: een toekomstige `@prisma/adapter-pg`-upgrade kan een incompatibele `pg`-versie meebrengen zonder dat dit zichtbaar is in de eigen dependency-lijst.

## Bestandsstructuur (repository-root, relevant voor architectuur)

```
MCM2/
├── src/
│   ├── app.controller.ts, app.service.ts, app.module.ts, main.ts
│   ├── health/                  (health.controller.ts, health.module.ts)
│   ├── prisma/                  (prisma.service.ts, prisma.module.ts, with-tenant.ts, generated-client.ts)
│   └── common/tenant/           (tenant.middleware.ts, tenant.module.ts, tenant-context.ts)
├── test/                        (app.e2e-spec.ts, health.e2e-spec.ts, jest-e2e.json)
├── prisma/
│   ├── schema.prisma
│   └── migrations/20260724140521_init_tenant_vendor_audit/migration.sql
├── generated/prisma/            (gegenereerde Prisma-client, .gitignore'd)
├── docs/
│   └── superpowers/{plans,specs}/
├── Dockerfile, docker-compose.yml, .dockerignore
├── prisma.config.ts
├── package.json, package-lock.json
├── tsconfig.json, tsconfig.build.json, nest-cli.json
├── eslint.config.mjs, .prettierrc
├── .env.example, .env (niet gecommit, .gitignore'd)
└── MCM2-CLAUDE.md
```

**Ontbrekend, expliciet geverifieerd:**
- `.github/workflows/` — bestaat niet (`find .github` gaf "No such file or directory").
- `.github/dependabot.yml` — bestaat niet.
- Geen enkele domeinmodule (vendors, contracts, tasks, issues, certifications) — Fase 0 heeft dit nog niet gebouwd.
- Geen logging/monitoring-library in `package.json` (geen winston, pino, sentry).

## Configuratiebestanden — kernpunten en geconstateerde inconsistenties

**`tsconfig.json`**: `"module": "nodenext"`, `"moduleResolution": "nodenext"`, `"noImplicitAny": false`, `"strictBindCallApply": false`. Dit is niet volledige TypeScript strict-mode.

**`eslint.config.mjs`**: `sourceType: 'commonjs'` — **inconsistent met** `tsconfig.json`'s `module: "nodenext"`. `@typescript-eslint/no-explicit-any` staat op `'off'`; `no-floating-promises` en `no-unsafe-argument` staan op `'warn'`, niet `'error'`.

**`Dockerfile`**: `FROM node:24-alpine`, gebruikt `npm install` (niet `npm ci` — geen gegarandeerde lockfile-reproduceerbaarheid), geen multi-stage build, geen expliciete non-root user, dev-dependencies blijven in de image.

**`docker-compose.yml`**: `mcm2-api` (build lokaal), `minio` op **`minio/minio:latest`** (ongepind — risico op onaangekondigde breaking changes bij herbouw), `valkey` op `valkey/valkey:8.1-alpine` (gepind).

**`prisma/schema.prisma`**: generator-config bevat `moduleFormat = "cjs"` én `importFileExtension = "ts"` — deze laatste instelling is noodzakelijk voor Jest maar **bevestigd incompatibel** met de gecompileerde `dist/`-productiebuild (zie testresultaten hieronder).

## Testresultaten — reproduceerbaar, uitgevoerd op 2026-07-24

| Commando | Resultaat | Detail |
|---|---|---|
| `npx eslint "{src,test}/**/*.ts"` (zonder `--fix`) | **23 errors, 10 warnings** | Merendeel Prettier-formattering; reële signalen: `no-unsafe-assignment`/`no-unsafe-member-access`/`no-unsafe-return` op `any`-getypeerde testmocks in `tenant.middleware.spec.ts`; `no-floating-promises`-warning op `bootstrap()` in `main.ts`. |
| `npm run build` (`nest build`) | **Geslaagd**, geen fouten | |
| `npm test` (unit, Jest) | **5/5 geslaagd** | tenant.middleware.spec.ts (4), app.controller.spec.ts (1) |
| `npm run test:e2e` | **2/2 gefaald** | Beide falen identiek: `TypeError: A dynamic import callback was invoked without --experimental-vm-modules`, veroorzaakt door Prisma 7's WASM-querycompiler die via dynamische `import()` laadt binnen `PrismaService.onModuleInit()` → `$connect()`. Blokkeert elke e2e-test die de volledige `AppModule` opstart. |
| `docker compose config` | **Geslaagd** (validatie) | Bevestigt correcte compose-structuur. *Incident: deze validatie toont geïnterpoleerde omgevingsvariabelen inclusief het database-wachtwoord in leesbare tekst — gemeld, niet herhaald in dit document.* |
| `docker build` | **Niet uitgevoerd** | Bewust overgeslagen: zou het secret-incident kunnen herhalen in build-logs en het reeds bekende `dist/`-crashgedrag (zie hieronder) is al bevestigd via een eerdere `docker-compose up --build` in dezelfde sessie. |
| `node dist/main.js` (eerder in dezelfde sessie bevestigd, niet herhaald voor dit document) | **Crasht** | `Cannot find module './internal/class.ts'` — direct gevolg van `importFileExtension = "ts"` in de Prisma-generatorconfig: de gecompileerde `dist/`-map bevat alleen `.js`-bestanden. |

## Databaserol — geverifieerd

Query `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;` tegen de actieve `DATABASE_URL`-connectie geeft:

```
rolname: 'postgres', rolsuper: false, rolbypassrls: true
```

**`rolbypassrls: true` is bevestigd.** Dit is de Supabase-standaard `postgres`-rol (patroon `postgres.<project-ref>` in de Session Pooler-connectiestring wijst altijd naar deze rol, geen aparte applicatierol). Zie 03-data-security-and-rls.md voor de volledige impactanalyse.

## Frontend-contractinventarisatie (MVM_V2)

Zie 00-executive-summary.md en de sectie Functionele aansluiting in het Fase B-verslag voor volledige details. Kernpunten:
- MVM_V2 draait nu op mock-data (`NEXT_PUBLIC_API_URL` leeg).
- Enige bevestigde endpoint-contract: `GET /api/v2/vendors?tenant=demo`.
- Tenant-waarde inconsistent tussen querystring (`demo`) en UI-constante (`transdev`).
- Geen auth-headers/tokens/cookies in enige service-aanroep.
- Negen andere `/api/v2/<resource>`-endpoints worden door de frontend-servicelaag verwacht (certifications, tasks, issues, interactions, scheduled-meetings, reminders, vendor-document-requirements, manual-compliance-checks, audit-events) — geen van deze is in Fase 0 gebouwd.
- `contractService.ts` heeft geen API-branch — draait altijd op mock.

## Documentatie reeds aanwezig in de repository

- `MCM2-CLAUDE.md` — projectcontext, sessiestatus-geschiedenis, versiebeleid-regel (bijgewerkt na Prisma 7-ontdekking), database-regels, guardrails-checklist.
- `docs/superpowers/specs/2026-07-24-fase0-skeleton-vendors-design.md` — oorspronkelijke design-spec.
- `docs/superpowers/plans/2026-07-24-fase0-skeleton-vendors.md` — 16-taken-implementatieplan (taken 1-5 uitgevoerd, taak 6 gedeeltelijk/ongecommit op moment van deze review).
- `docs/superpowers/specs/2026-07-24-techstack-evaluatie-drizzle.md` — eerder in dezelfde dag opgesteld document dat Drizzle voorstelde; **deze architectuurbeoordeling behandelt die keuze opnieuw, objectief, zonder die eerdere aanbeveling als uitgangspunt te nemen** (expliciete instructie in de opdracht voor deze review).
