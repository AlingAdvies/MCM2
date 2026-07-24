# MCM2 Fase 0 — NestJS-skeleton, schone eerste migratie, Vendors CRUD

**Datum:** 2026-07-24
**Status:** Goedgekeurd, klaar voor implementatieplan
**OTAP-stap:** Ontwikkel (nieuwe code, feature-branch `feat/fase0-skeleton-vendors`)

---

## Context

MCM2 vervangt de C#-backend (`mvm-api-pilot`) met een NestJS/TypeScript-API, gebouwd zodat een latere migratie naar AWS (ECS Fargate) een configuratiewijziging is, geen herbouw. Dit document beschrijft Fase 0: het allereerste skeleton, plus het eerste verticale slice (Vendors CRUD) om te bewijzen dat de hele keten werkt — Docker → NestJS → Supabase → MVM_V2.

Eerder is besloten (`MVM_V2/docs/database-schema-kwaliteitsborging.md`) dat de database **niet** wordt hergebouwd door de bestaande 16 migraties van `mvm-api-pilot` over te nemen, maar volledig opnieuw wordt opgezet binnen hetzelfde Supabase-project (`clm-enterprise`), met de oude migraties als vetted **specificatie** (niet als bron om te kopiëren) en de daar gevonden fouten (inconsistente RLS, zombie-tabellen) gecorrigeerd. Fase 0 omvat daarom ook de eerste schone migratie.

`VendorsController.cs` (C#-pilot) dient als functionele specificatie voor de endpoint-vorm.

---

## 1. Projectstructuur & tooling

```
MCM2/
├── docker-compose.yml          # api + minio + redis
├── Dockerfile
├── .env.example                 # namen 1-op-1 met latere AWS Secrets Manager
├── prisma/
│   └── schema.prisma            # single source of truth voor het schema
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── prisma/                  # PrismaService (connectie + tenant-context helper)
│   ├── common/
│   │   ├── tenant/               # TenantMiddleware + TenantContext (async-local-storage)
│   │   ├── filters/               # centrale HTTP-exceptionfilter (NL-foutmeldingen zoals de pilot)
│   │   └── feature-flags/         # FeatureFlagGuard (leest env-var per feature)
│   └── vendors/
│       ├── vendors.module.ts
│       ├── vendors.controller.ts
│       ├── vendors.service.ts
│       └── dto/                   # create/update/response DTO's (class-validator)
├── test/
│   └── vendors/                   # e2e: CRUD + tenant-isolatie (2 testtenants)
└── .github/workflows/ci.yml       # lint, typecheck, test, migratie-tegen-lege-db, docker build
```

- **Runtime:** NestJS + TypeScript, Node.js LTS.
- **Database-toegang:** Prisma ORM. Reden: automatisch gegenereerde TypeScript-types uit het schema, compile-time fouten bij een verkeerd veldnaam (kan nooit naar productie), migraties als leesbare, reviewbare bestanden — sluit aan bij de expliciete eis van de opdrachtgever dat latere wijzigingen "fool proof" door een niet-IT'er begeleid moeten kunnen worden (via Claude Code).
- **Validatie:** `class-validator` / `class-transformer` — ontbrekend of verkeerd veld geeft direct een 400 met duidelijke melding, nooit een halve database-write.
- **Containers:** Docker Compose met drie services: `mcm2-api` (poort 5001, hot-reload), `minio` (S3-nabootsing), `redis` (BullMQ, nog ongebruikt in Fase 0 maar wel opgezet voor Fase-consistentie met de architectuur).

---

## 2. Tenant-resolutie & Row Level Security

Overgenomen 1-op-1 uit de C#-pilot se `ResolveTenantId`:
1. `X-Tenant-Id` header (UUID) — hoogste prioriteit.
2. `?tenant` query-parameter (naam, bijv. `demo`) — opgezocht in `clm.tenant`.
3. Fallback naar tenant `"demo"` als geen van beide is meegegeven.

Geïmplementeerd als NestJS `Middleware` (`TenantMiddleware`) die per request:
1. de tenant-UUID resolvet volgens bovenstaande volgorde,
2. binnen de request-transactie `SET LOCAL app.current_tenant_id = '<uuid>'` uitvoert via Prisma (`$executeRaw`, geparametriseerd — nooit stringinterpolatie),
3. de UUID beschikbaar maakt via een request-scoped `TenantContext`.

Dit hergebruikt het RLS-mechanisme van de pilot: een `clm.current_tenant_id()` SQL-functie die policies raadplegen. De eerste migratie neemt dat patroon over, maar **consistent** op elke tabel — met zowel `USING` als `WITH CHECK` (Database-regel 3), inclusief `deleted_at IS NULL`-filtering waar van toepassing. Dit verhelpt de twee bekende inconsistenties uit het kwaliteitsborgingsdocument (ontbrekende `WITH CHECK` op `task`/`issue`; dubbele, tegenstrijdige policy op `vendor_interaction`) — al raken die twee tabellen zelf pas een latere fase.

---

## 3. Database-schema — eerste schone migratie

Scope: precies wat nodig is om Vendors end-to-end te laten werken. Niet de volledige inventaris uit sectie 5 van `database-schema-kwaliteitsborging.md` — die tabellen komen mee zodra het endpoint dat ze nodig heeft aan de beurt is.

**In scope:**
- `clm.tenant` — fundament, alle andere tabellen verwijzen ernaar.
- `clm.user` — minimale kernvelden (geen Cognito-koppeling nu; die velden komen in Fase 2), nodig omdat `vendor.owner_user_id` ernaar verwijst.
- `ref.vendor_category`, `ref.business_criticality`, `ref.compliance_status` — lookup-tabellen waar `clm.vendor` naar verwijst (Hay CDM-principe: classificatie via FK naar ref-tabel, niet als vrije tekst).
- `clm.vendor`, `clm.vendor_address`, `clm.vendor_contact`, `clm.vendor_tag`.
- `audit.audit_event` — minimale auditlogtabel + `AuditService` die synchroon binnen dezelfde transactie schrijft (audit-trail is architectuuronderdeel, niet optioneel — zie Database-regels).
- `clm.current_tenant_id()` functie + RLS-policies (USING + WITH CHECK) op elke tabel hierboven.
- Hay CDM-standaardkolommen (`created_at/by`, `updated_at/by`, `deleted_at/by`) op elke `clm.*`-tabel, plus `set_updated_at`-trigger.

**Buiten scope (latere fase, endpoint-voor-endpoint):** contract, document, notification, staging, interactie/vergadering, task/issue, requirement/risk_measure, en de nog te ontwerpen questionnaire/survey/kpi-tabellen.

**CI-verplichting:** GitHub Actions-stap draait deze migratie tegen een verse, lege Postgres-container (OTAP-Test-stap, Database-regel 2). PR faalt rood bij een fout.

**Tenant-isolatietest:** e2e-test met twee testtenants bevestigt dat cross-tenant lezen én schrijven op `clm.vendor` geblokkeerd is (Database-regel 4), vóór de migratie als voltooid geldt.

---

## 4. Vendors-endpoints

1-op-1 qua vorm met `VendorsController.cs`, camelCase JSON, zelfde velden als `VendorDto`.

| Methode | Pad | Gedrag |
|---|---|---|
| GET | `/api/v2/vendors` | Lijst, verrijkt met primair contact + contract-tellingen (contract bestaat nog niet in Fase 0 — telling blijft 0 tot Fase 1) |
| GET | `/api/v2/vendors/:id` | Detail; 404 met `{ error: "..." }` (NL) als niet gevonden |
| POST | `/api/v2/vendors` | Aanmaken; `name` verplicht (class-validator); audit-event `vendor.created` |
| PUT | `/api/v2/vendors/:id` | Partial update (alleen meegegeven velden); audit-event `vendor.updated` met oud/nieuw-snapshot |
| DELETE | `/api/v2/vendors/:id` | Soft-delete (`deleted_at`), nooit fysiek verwijderen; audit-event `vendor.deleted` |

**Foutafhandeling:** centrale `HttpExceptionFilter` geeft dezelfde `{ error: "..." }`-foutvorm terug als de pilot, zodat MVM_V2 zonder aanpassing kan overschakelen.

**Feature flag:** elk Vendors-endpoint gaat achter een `FeatureFlagGuard` die de env-var `FEATURE_VENDORS_ENABLED` leest, standaard `false`. Zichtbaarheid aanzetten is een losse configuratie-actie na deploy, geen nieuwe release (conform Guardrails-checklist).

---

## 5. Testplan

- **Unit:** `VendorsService` (create/update/delete-logica, DTO-mapping) met gemockte Prisma-client.
- **E2e:** volledige CRUD tegen een testdatabase in Docker.
- **Tenant-isolatie:** 2 testtenants, bevestig cross-tenant read/write geblokkeerd op `clm.vendor`.
- **Health-check:** `GET /health` bevestigt dat api → Postgres-verbinding werkt (MinIO/Redis-checks volgen zodra ze daadwerkelijk gebruikt worden).

---

## 6. MVM_V2-koppeling

Na groene lokale tests wordt `NEXT_PUBLIC_API_URL` lokaal naar `http://localhost:5001` gewezen, zodat de Vendors-pagina in MVM_V2 tegen MCM2 draait. Geen frontendcode wijzigen — alleen de env-var. Frontend blijft op zijn eigen poort (3000/3002/3004, zie `C:\dev\CLAUDE.md`).

---

## Buiten scope van dit document

- Cognito-authenticatie (Fase 2).
- Contract-, document-, en overige endpoints (Fase 1, volgende sessies).
- AWS-specifieke code (Fase 5) — Docker/env-var/S3-API-vorm wordt nu al aangehouden, geen AWS SDK-calls.
- Azure Container Apps (genoemd in het oudere `NESTJS_MIGRATION_PLAN.md` van 2026-05-28) — vervangen door AWS ECS Fargate per besluit van 2026-07-24, zie `MCM2-CLAUDE.md`.
