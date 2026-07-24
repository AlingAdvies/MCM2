# Fase 0 — NestJS-skeleton, schone eerste migratie, Vendors CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een werkend NestJS-skeleton met Docker Compose, de eerste schone Prisma-migratie (tenant/user/vendor + RLS), en een volledige Vendors CRUD-endpoint, zodat MVM_V2 lokaal tegen MCM2 kan draaien voor het eerst.

**Architecture:** NestJS-app met een `TenantMiddleware` die per request `SET LOCAL app.current_tenant_id` zet (RLS-mechanisme identiek aan `mvm-api-pilot`), Prisma als ORM tegen de bestaande Supabase-database (nieuw schema náást het oude, zie Taak 1), en een `vendors`-module die 1-op-1 de vorm van `VendorsController.cs` volgt.

**Tech Stack:** NestJS 10, TypeScript, Prisma ORM, PostgreSQL (Supabase Session Pooler), class-validator/class-transformer, Jest, Docker Compose (api + minio + redis).

**Spec:** `docs/superpowers/specs/2026-07-24-fase0-skeleton-vendors-design.md`

---

## Voorwaarden

- Feature-branch `feat/fase0-skeleton-vendors` (nog aan te maken in Taak 1 — `main` bevat nu alleen `MCM2-CLAUDE.md` en de spec).
- `.env` met een Supabase-connectiestring is nodig om tegen de echte database te migreren; voor CI/lokale tests draait alles tegen een Postgres-container (`docker-compose.yml`), niet tegen Supabase direct.
- Node.js LTS en Docker Desktop moeten lokaal beschikbaar zijn.

---

## Taak 1: Projectskelet — NestJS init, feature-branch, basisconfig

**Files:**
- Create: `package.json`, `tsconfig.json`, `nest-cli.json`
- Create: `src/main.ts`, `src/app.module.ts`
- Create: `.env.example`, `.gitignore`
- Create: `.eslintrc.js`, `.prettierrc`

- [ ] **Step 1: Feature-branch aanmaken**

```bash
cd C:/DEV/Work/MCM2
git checkout -b feat/fase0-skeleton-vendors
```

- [ ] **Step 2: NestJS-project scaffolden**

```bash
npx @nestjs/cli new . --package-manager npm --skip-git --language TypeScript
```

Als de CLI vraagt om een leeg/niet-leeg-directory te bevestigen (er staat al `MCM2-CLAUDE.md` en `docs/`), bevestigen met "yes, continue".

- [ ] **Step 3: `.gitignore` aanvullen**

Voeg toe aan de door NestJS gegenereerde `.gitignore`:

```gitignore
.env
.env.local
node_modules/
dist/
coverage/
```

- [ ] **Step 4: `.env.example` aanmaken**

```env
# Database (Supabase Session Pooler — zelfde project als mvm-api-pilot, apart schema)
DATABASE_URL="postgresql://postgres.PROJECT_REF:PASSWORD@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?schema=public"

# API
PORT=5001

# Object storage (lokaal: MinIO, later: AWS S3 — zelfde env-var-namen)
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=mcm2-documents

# Queue (BullMQ)
REDIS_URL=redis://localhost:6379

# Feature flags
FEATURE_VENDORS_ENABLED=false
```

- [ ] **Step 5: Dependencies installeren**

```bash
npm install @prisma/client class-validator class-transformer
npm install -D prisma
```

- [ ] **Step 6: `src/main.ts` — ValidationPipe globaal instellen**

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors();
  const port = process.env.PORT ?? 5001;
  await app.listen(port);
}
bootstrap();
```

- [ ] **Step 7: Build en start verifiëren**

Run: `npm run build`
Expected: geen TypeScript-fouten, `dist/main.js` aangemaakt.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(fase0): NestJS-skeleton met globale validatie

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Taak 2: Health-check endpoint

**Files:**
- Create: `src/health/health.module.ts`
- Create: `src/health/health.controller.ts`
- Test: `test/health.e2e-spec.ts`

- [ ] **Step 1: Schrijf de falende e2e-test**

```typescript
// test/health.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('HealthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok status', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
      });
  });
});
```

- [ ] **Step 2: `supertest` installeren als dev-dependency (als nog niet aanwezig)**

```bash
npm install -D supertest @types/supertest
```

- [ ] **Step 3: Run test, verifieer dat die faalt**

Run: `npm run test:e2e -- health.e2e-spec.ts`
Expected: FAIL — `Cannot GET /health` (404) of module-resolutiefout.

- [ ] **Step 4: `src/health/health.controller.ts`**

```typescript
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
```

- [ ] **Step 5: `src/health/health.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

- [ ] **Step 6: Registreer `HealthModule` in `src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';

@Module({
  imports: [HealthModule],
})
export class AppModule {}
```

- [ ] **Step 7: Run test, verifieer dat die slaagt**

Run: `npm run test:e2e -- health.e2e-spec.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/health test/health.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(health): health-check endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Taak 3: Docker Compose — api + minio + redis

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

- [ ] **Step 1: `Dockerfile`**

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npx prisma generate

EXPOSE 5001

CMD ["npm", "run", "start:dev"]
```

- [ ] **Step 2: `.dockerignore`**

```
node_modules
dist
.git
.env
```

- [ ] **Step 3: `docker-compose.yml`**

```yaml
services:
  mcm2-api:
    build: .
    ports:
      - "5001:5001"
    env_file:
      - .env
    volumes:
      - .:/app
      - /app/node_modules
    depends_on:
      - redis

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - minio-data:/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  minio-data:
```

- [ ] **Step 4: Lokaal `.env` aanmaken (niet gecommit) en stack starten**

```bash
cp .env.example .env
```

Vul `DATABASE_URL` handmatig in met de echte Supabase-connectiestring (vraag deze op als die niet al lokaal bekend is — niet hardcoden, niet in de plan-tekst zetten).

Run: `docker-compose up --build`
Expected: drie containers starten (`mcm2-api`, `minio`, `redis`), geen crash-loop.

- [ ] **Step 5: Verifieer health-check via Docker**

Run: `curl http://localhost:5001/health`
Expected: `{"status":"ok"}`

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "$(cat <<'EOF'
chore(fase0): Docker Compose met api, minio en redis

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Taak 4: Prisma-schema — tenant, user, ref-tabellen, vendor-cluster, audit_event

**Files:**
- Create: `prisma/schema.prisma`
- Modify: `.env.example` (al gedaan in Taak 1 — `DATABASE_URL` staat er al)

Dit is de kern van de "schone herbouw" — zie spec sectie 3. Prisma-schema als single source of truth; `prisma migrate dev` genereert de SQL-migratie.

- [ ] **Step 1: `prisma/schema.prisma` — generator, datasource, en alle modellen**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── ref schema: lookup-tabellen ──────────────────────────────────────────

model VendorCategory {
  code String @id
  label String

  vendors Vendor[]

  @@map("vendor_category")
  @@schema("ref")
}

model BusinessCriticality {
  code  String @id
  label String

  vendors Vendor[]

  @@map("business_criticality")
  @@schema("ref")
}

model ComplianceStatus {
  code  String @id
  label String

  vendors Vendor[]

  @@map("compliance_status")
  @@schema("ref")
}

// ─── clm schema: fundament ────────────────────────────────────────────────

model Tenant {
  tenantId  String   @id @default(uuid()) @map("tenant_id") @db.Uuid
  name      String   @unique
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  users   User[]
  vendors Vendor[]

  @@map("tenant")
  @@schema("clm")
}

model User {
  userId    String    @id @default(uuid()) @map("user_id") @db.Uuid
  tenantId  String    @map("tenant_id") @db.Uuid
  fullName  String    @map("full_name")
  email     String?
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime? @map("updated_at") @db.Timestamptz
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz

  tenant        Tenant   @relation(fields: [tenantId], references: [tenantId])
  ownedVendors  Vendor[] @relation("VendorOwner")

  @@map("user")
  @@schema("clm")
}

// ─── clm schema: vendor-cluster ───────────────────────────────────────────

model Vendor {
  vendorId                String    @id @default(uuid()) @map("vendor_id") @db.Uuid
  tenantId                String    @map("tenant_id") @db.Uuid
  name                    String
  kvkNumber                String?   @map("kvk_number")
  vestigingsnummer         String?
  statutoryName            String?   @map("statutory_name")
  tradeNames               String[]  @map("trade_names")
  legalForm                String?   @map("legal_form")
  incorporationDate        DateTime? @map("incorporation_date") @db.Date
  sbiCode                  String?   @map("sbi_code")
  sbiDescription            String?   @map("sbi_description")
  categoryCode              String?   @map("category_code")
  businessCriticalityCode   String?   @map("business_criticality_code")
  complianceStatusCode      String?   @map("compliance_status_code")
  country                   String    @default("NL")
  city                      String?
  website                   String?
  annualSpendEur            Decimal?  @map("annual_spend_eur") @db.Decimal(15, 2)
  riskScore                 Int?      @map("risk_score") @db.SmallInt
  ownerUserId                String?   @map("owner_user_id") @db.Uuid
  lastReviewDate             DateTime? @map("last_review_date") @db.Date
  nextReviewDate              DateTime? @map("next_review_date") @db.Date
  createdAt                  DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt                  DateTime? @map("updated_at") @db.Timestamptz
  deletedAt                  DateTime? @map("deleted_at") @db.Timestamptz

  tenant             Tenant                @relation(fields: [tenantId], references: [tenantId])
  owner               User?                 @relation("VendorOwner", fields: [ownerUserId], references: [userId])
  category            VendorCategory?       @relation(fields: [categoryCode], references: [code])
  businessCriticality BusinessCriticality?  @relation(fields: [businessCriticalityCode], references: [code])
  complianceStatus    ComplianceStatus?     @relation(fields: [complianceStatusCode], references: [code])
  contacts            VendorContact[]
  tags                VendorTag[]

  @@unique([tenantId, kvkNumber])
  @@map("vendor")
  @@schema("clm")
}

model VendorContact {
  contactId       String    @id @default(uuid()) @map("contact_id") @db.Uuid
  vendorId        String    @map("vendor_id") @db.Uuid
  tenantId        String    @map("tenant_id") @db.Uuid
  fullName        String    @map("full_name")
  email           String?
  phone           String?
  jobTitle        String?   @map("job_title")
  roleDescription String?   @map("role_description")
  isPrimary       Boolean   @default(false) @map("is_primary")
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime? @map("updated_at") @db.Timestamptz
  deletedAt       DateTime? @map("deleted_at") @db.Timestamptz

  vendor Vendor @relation(fields: [vendorId], references: [vendorId], onDelete: Cascade)

  @@map("vendor_contact")
  @@schema("clm")
}

model VendorTag {
  vendorId  String   @map("vendor_id") @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  tag       String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  vendor Vendor @relation(fields: [vendorId], references: [vendorId], onDelete: Cascade)

  @@id([vendorId, tag])
  @@map("vendor_tag")
  @@schema("clm")
}

// ─── audit schema ──────────────────────────────────────────────────────────

model AuditEvent {
  auditEventId String   @id @default(uuid()) @map("audit_event_id") @db.Uuid
  tenantId     String   @map("tenant_id") @db.Uuid
  actionType   String   @map("action_type")
  entityType   String   @map("entity_type")
  entityId     String   @map("entity_id") @db.Uuid
  oldValues    Json?    @map("old_values")
  newValues    Json?    @map("new_values")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@map("audit_event")
  @@schema("audit")
}
```

- [ ] **Step 2: Multi-schema preview feature aanzetten**

Prisma vereist een preview-flag voor meerdere Postgres-schemas. Voeg toe aan de `generator client`-block bovenin `prisma/schema.prisma`:

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema"]
}
```

En aan de `datasource db`-block:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["clm", "ref", "audit"]
}
```

- [ ] **Step 3: Prisma-client genereren en valideren**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

Run: `npx prisma generate`
Expected: `Generated Prisma Client` zonder fouten.

- [ ] **Step 4: Eerste migratie genereren tegen de Supabase-database**

```bash
npx prisma migrate dev --name init_tenant_vendor_audit --create-only
```

`--create-only` genereert de SQL zonder meteen uit te voeren — zo kan de RLS-SQL (Taak 5) er eerst aan toegevoegd worden vóór de migratie draait.

Expected: nieuw bestand `prisma/migrations/<timestamp>_init_tenant_vendor_audit/migration.sql`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "$(cat <<'EOF'
feat(db): eerste schone Prisma-migratie voor tenant, user, vendor-cluster en audit_event

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Taak 5: RLS-policies en Hay CDM-triggers toevoegen aan de migratie

**Files:**
- Modify: `prisma/migrations/<timestamp>_init_tenant_vendor_audit/migration.sql`

Prisma genereert geen RLS/policies/triggers — dit SQL-stuk wordt handmatig toegevoegd aan het einde van het gegenereerde migratiebestand, vóór het uitvoeren.

- [ ] **Step 1: Voeg toe aan het einde van `migration.sql`**

```sql
-- =============================================================================
-- Row Level Security — tenant isolatie
-- Principe: de NestJS-app zet aan het begin van elke request-transactie:
--   SET LOCAL app.current_tenant_id = '<uuid>';
-- Alle policies vergelijken tenant_id met deze sessie-variabele.
-- =============================================================================

CREATE OR REPLACE FUNCTION clm.current_tenant_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID
$$;

COMMENT ON FUNCTION clm.current_tenant_id() IS
    'Leest tenant_id uit de PostgreSQL sessie-variabele app.current_tenant_id, gezet door TenantMiddleware.';

-- updated_at trigger-functie
CREATE OR REPLACE FUNCTION clm.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_updated_at
    BEFORE UPDATE ON clm."user"
    FOR EACH ROW EXECUTE FUNCTION clm.set_updated_at();

CREATE TRIGGER trg_vendor_updated_at
    BEFORE UPDATE ON clm.vendor
    FOR EACH ROW EXECUTE FUNCTION clm.set_updated_at();

CREATE TRIGGER trg_vendor_contact_updated_at
    BEFORE UPDATE ON clm.vendor_contact
    FOR EACH ROW EXECUTE FUNCTION clm.set_updated_at();

-- RLS inschakelen
ALTER TABLE clm.tenant         ENABLE ROW LEVEL SECURITY;
ALTER TABLE clm."user"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE clm.vendor         ENABLE ROW LEVEL SECURITY;
ALTER TABLE clm.vendor_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE clm.vendor_tag     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_event  ENABLE ROW LEVEL SECURITY;

-- Policies — elke tabel krijgt zowel USING als WITH CHECK (Database-regel 3)
CREATE POLICY tenant_isolation ON clm.tenant
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());

CREATE POLICY user_isolation ON clm."user"
    USING (tenant_id = clm.current_tenant_id() AND deleted_at IS NULL)
    WITH CHECK (tenant_id = clm.current_tenant_id());

CREATE POLICY vendor_isolation ON clm.vendor
    USING (tenant_id = clm.current_tenant_id() AND deleted_at IS NULL)
    WITH CHECK (tenant_id = clm.current_tenant_id());

CREATE POLICY vendor_contact_isolation ON clm.vendor_contact
    USING (tenant_id = clm.current_tenant_id() AND deleted_at IS NULL)
    WITH CHECK (tenant_id = clm.current_tenant_id());

CREATE POLICY vendor_tag_isolation ON clm.vendor_tag
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());

CREATE POLICY audit_event_tenant_isolation ON audit.audit_event
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());

-- ref-schema: bewust geen RLS (tenant-agnostische lookup-data)

-- Seed-data voor lookup-tabellen
INSERT INTO ref.vendor_category (code, label) VALUES
    ('other', 'Overig'),
    ('it_services', 'IT-diensten'),
    ('consultancy', 'Consultancy');

INSERT INTO ref.business_criticality (code, label) VALUES
    ('low', 'Laag'),
    ('medium', 'Gemiddeld'),
    ('high', 'Hoog');

INSERT INTO ref.compliance_status (code, label) VALUES
    ('no_requirements', 'Geen vereisten'),
    ('compliant', 'Voldoet'),
    ('non_compliant', 'Voldoet niet');

-- Demo-tenant voor lokale ontwikkeling (fallback in TenantMiddleware)
INSERT INTO clm.tenant (tenant_id, name) VALUES
    (gen_random_uuid(), 'demo');
```

- [ ] **Step 2: Migratie uitvoeren**

```bash
npx prisma migrate dev
```

Expected: migratie draait zonder fouten, Prisma-client wordt opnieuw gegenereerd.

- [ ] **Step 3: Verifieer RLS werkt via psql of Supabase SQL-editor (alleen lezen/debuggen, geen DDL — zie Database-regel 1)**

```sql
SET app.current_tenant_id = (SELECT tenant_id FROM clm.tenant WHERE name = 'demo');
SELECT count(*) FROM clm.vendor;  -- verwacht: 0 (nog geen vendors)

RESET app.current_tenant_id;
SELECT count(*) FROM clm.vendor;  -- verwacht: 0 rijen (RLS blokkeert zonder sessie-tenant)
```

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations
git commit -m "$(cat <<'EOF'
feat(db): RLS-policies, Hay CDM-triggers en seed-data voor Fase 0-schema

Elke clm.*-tabel krijgt zowel USING als WITH CHECK (consistent, in
tegenstelling tot de bekende inconsistentie in mvm-api-pilot migratie 014).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Taak 6: PrismaService + TenantMiddleware + TenantContext

**Files:**
- Create: `src/prisma/prisma.service.ts`
- Create: `src/prisma/prisma.module.ts`
- Create: `src/common/tenant/tenant-context.ts`
- Create: `src/common/tenant/tenant.middleware.ts`
- Create: `src/common/tenant/tenant.module.ts`
- Test: `src/common/tenant/tenant.middleware.spec.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: `src/prisma/prisma.service.ts`**

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

- [ ] **Step 2: `src/prisma/prisma.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 3: `src/common/tenant/tenant-context.ts`**

Request-scoped opslag via `AsyncLocalStorage`, zodat elke laag (service, Prisma-call) de actieve tenant kan lezen zonder hem overal handmatig door te geven.

```typescript
import { AsyncLocalStorage } from 'async_hooks';

export interface TenantStore {
  tenantId: string;
}

export const tenantStorage = new AsyncLocalStorage<TenantStore>();

export function getCurrentTenantId(): string {
  const store = tenantStorage.getStore();
  if (!store) {
    throw new Error('Geen actieve tenant-context — TenantMiddleware is niet uitgevoerd voor dit request.');
  }
  return store.tenantId;
}
```

- [ ] **Step 4: Schrijf de falende test voor `TenantMiddleware`**

```typescript
// src/common/tenant/tenant.middleware.spec.ts
import { NotFoundException } from '@nestjs/common';
import { TenantMiddleware } from './tenant.middleware';
import { PrismaService } from '../../prisma/prisma.service';

describe('TenantMiddleware', () => {
  const VALID_UUID = '11111111-1111-1111-1111-111111111111';

  function buildRequest(overrides: Partial<{ headers: Record<string, string>; query: Record<string, string> }> = {}) {
    return {
      headers: overrides.headers ?? {},
      query: overrides.query ?? {},
    } as any;
  }

  it('resolves tenant from X-Tenant-Id header when it is a valid UUID', async () => {
    const prisma = { tenant: { findFirst: jest.fn() } } as unknown as PrismaService;
    const middleware = new TenantMiddleware(prisma);
    const req = buildRequest({ headers: { 'x-tenant-id': VALID_UUID } });
    const next = jest.fn();

    await middleware.use(req, {} as any, next);

    expect(req.tenantId).toBe(VALID_UUID);
    expect(next).toHaveBeenCalled();
  });

  it('resolves tenant by name from ?tenant query param', async () => {
    const findFirst = jest.fn().mockResolvedValue({ tenantId: VALID_UUID, name: 'acme' });
    const prisma = { tenant: { findFirst } } as unknown as PrismaService;
    const middleware = new TenantMiddleware(prisma);
    const req = buildRequest({ query: { tenant: 'acme' } });
    const next = jest.fn();

    await middleware.use(req, {} as any, next);

    expect(findFirst).toHaveBeenCalledWith({ where: { name: 'acme' } });
    expect(req.tenantId).toBe(VALID_UUID);
    expect(next).toHaveBeenCalled();
  });

  it('falls back to "demo" tenant when neither header nor query is given', async () => {
    const findFirst = jest.fn().mockResolvedValue({ tenantId: VALID_UUID, name: 'demo' });
    const prisma = { tenant: { findFirst } } as unknown as PrismaService;
    const middleware = new TenantMiddleware(prisma);
    const req = buildRequest();
    const next = jest.fn();

    await middleware.use(req, {} as any, next);

    expect(findFirst).toHaveBeenCalledWith({ where: { name: 'demo' } });
    expect(req.tenantId).toBe(VALID_UUID);
  });

  it('throws NotFoundException when the resolved tenant name does not exist', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = { tenant: { findFirst } } as unknown as PrismaService;
    const middleware = new TenantMiddleware(prisma);
    const req = buildRequest({ query: { tenant: 'onbekend' } });
    const next = jest.fn();

    await expect(middleware.use(req, {} as any, next)).rejects.toThrow(NotFoundException);
    expect(next).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run test, verifieer dat die faalt**

Run: `npm run test -- tenant.middleware.spec.ts`
Expected: FAIL — `Cannot find module './tenant.middleware'`

- [ ] **Step 6: `src/common/tenant/tenant.middleware.ts`**

```typescript
import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request & { tenantId?: string }, res: Response, next: NextFunction) {
    const headerValue = req.headers['x-tenant-id'];
    if (typeof headerValue === 'string' && UUID_REGEX.test(headerValue)) {
      req.tenantId = headerValue;
      return next();
    }

    const tenantName = (req.query.tenant as string | undefined) ?? 'demo';
    const tenant = await this.prisma.tenant.findFirst({ where: { name: tenantName } });

    if (!tenant) {
      throw new NotFoundException({ error: `Tenant '${tenantName}' niet gevonden.` });
    }

    req.tenantId = tenant.tenantId;
    next();
  }
}
```

- [ ] **Step 7: Run test, verifieer dat die slaagt**

Run: `npm run test -- tenant.middleware.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 8: `src/common/tenant/tenant.module.ts` — middleware toepassen en RLS-sessievariabele zetten**

De middleware zet `req.tenantId`; een interceptor (hier als tweede middleware-achtige stap via Prisma `$use` in `PrismaService`) moet vervolgens `SET LOCAL app.current_tenant_id` uitvoeren binnen dezelfde databaseverbinding als de request-handler. Prisma's `$transaction` met een callback garandeert dezelfde connectie voor `SET LOCAL` en de daaropvolgende queries.

```typescript
// src/common/tenant/tenant.module.ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantMiddleware } from './tenant.middleware';

@Module({})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
```

- [ ] **Step 9: Helper om een RLS-bewuste transactie te draaien — `src/prisma/with-tenant.ts`**

```typescript
import { PrismaService } from './prisma.service';
import { Prisma } from '@prisma/client';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withTenant<T>(
  prisma: PrismaService,
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!UUID_REGEX.test(tenantId)) {
    throw new Error(`Ongeldige tenant-id: '${tenantId}'`);
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    return fn(tx);
  });
}
```

De UUID-validatie vóór het bouwen van de SQL-string sluit SQL-injectie via de tenant-waarde uit — `SET LOCAL` accepteert geen query-parameters, dus validatie is hier de vervanging daarvoor (zelfde beperking als de C#-pilot, nu wel met een expliciete check in plaats van impliciet vertrouwen op `Guid.TryParse` eerder in de keten).

- [ ] **Step 10: Registreer `PrismaModule` en `TenantModule` in `src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { TenantModule } from './common/tenant/tenant.module';

@Module({
  imports: [HealthModule, PrismaModule, TenantModule],
})
export class AppModule {}
```

- [ ] **Step 11: Commit**

```bash
git add src/prisma src/common/tenant src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(tenant): TenantMiddleware met header/query/demo-resolutie en RLS-transactiehelper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Taak 7: FeatureFlagGuard

**Files:**
- Create: `src/common/feature-flags/feature-flag.guard.ts`
- Create: `src/common/feature-flags/feature-flag.decorator.ts`
- Test: `src/common/feature-flags/feature-flag.guard.spec.ts`

- [ ] **Step 1: Schrijf de falende test**

```typescript
// src/common/feature-flags/feature-flag.guard.spec.ts
import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagGuard } from './feature-flag.guard';

describe('FeatureFlagGuard', () => {
  function buildContext(): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({}) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  afterEach(() => {
    delete process.env.FEATURE_VENDORS_ENABLED;
  });

  it('allows the request when the flag env-var is "true"', () => {
    process.env.FEATURE_VENDORS_ENABLED = 'true';
    const reflector = { getAllAndOverride: () => 'FEATURE_VENDORS_ENABLED' } as unknown as Reflector;
    const guard = new FeatureFlagGuard(reflector);

    expect(guard.canActivate(buildContext())).toBe(true);
  });

  it('throws ServiceUnavailableException when the flag env-var is missing or false', () => {
    const reflector = { getAllAndOverride: () => 'FEATURE_VENDORS_ENABLED' } as unknown as Reflector;
    const guard = new FeatureFlagGuard(reflector);

    expect(() => guard.canActivate(buildContext())).toThrow(ServiceUnavailableException);
  });

  it('allows the request when no feature flag is declared on the route', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const guard = new FeatureFlagGuard(reflector);

    expect(guard.canActivate(buildContext())).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verifieer dat die faalt**

Run: `npm run test -- feature-flag.guard.spec.ts`
Expected: FAIL — module niet gevonden

- [ ] **Step 3: `src/common/feature-flags/feature-flag.decorator.ts`**

```typescript
import { SetMetadata } from '@nestjs/common';

export const FEATURE_FLAG_KEY = 'featureFlag';
export const RequireFeatureFlag = (envVarName: string) => SetMetadata(FEATURE_FLAG_KEY, envVarName);
```

- [ ] **Step 4: `src/common/feature-flags/feature-flag.guard.ts`**

```typescript
import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_FLAG_KEY } from './feature-flag.decorator';

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const envVarName = this.reflector.getAllAndOverride<string | undefined>(FEATURE_FLAG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!envVarName) {
      return true;
    }

    if (process.env[envVarName] === 'true') {
      return true;
    }

    throw new ServiceUnavailableException({
      error: `Functionaliteit is uitgeschakeld (feature flag ${envVarName} staat uit).`,
    });
  }
}
```

- [ ] **Step 5: Run test, verifieer dat die slaagt**

Run: `npm run test -- feature-flag.guard.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/common/feature-flags
git commit -m "$(cat <<'EOF'
feat(feature-flags): FeatureFlagGuard met env-var-gestuurde aan/uit-schakeling

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Taak 8: Centrale HttpExceptionFilter (NL-foutmeldingen)

**Files:**
- Create: `src/common/filters/http-exception.filter.ts`
- Test: `src/common/filters/http-exception.filter.spec.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Schrijf de falende test**

```typescript
// src/common/filters/http-exception.filter.spec.ts
import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  function buildHost(jsonSpy: jest.Mock, statusSpy: jest.Mock): ArgumentsHost {
    return {
      switchToHttp: () => ({
        getResponse: () => ({ status: statusSpy.mockReturnValue({ json: jsonSpy }) }),
        getRequest: () => ({ url: '/api/v2/vendors' }),
      }),
    } as unknown as ArgumentsHost;
  }

  it('wraps a string message into { error } shape', () => {
    const statusSpy = jest.fn();
    const jsonSpy = jest.fn();
    const filter = new HttpExceptionFilter();
    const exception = new HttpException('Vendor niet gevonden.', HttpStatus.NOT_FOUND);

    filter.catch(exception, buildHost(jsonSpy, statusSpy));

    expect(statusSpy).toHaveBeenCalledWith(404);
    expect(jsonSpy).toHaveBeenCalledWith({ error: 'Vendor niet gevonden.' });
  });

  it('passes through an already-shaped { error } object response', () => {
    const statusSpy = jest.fn();
    const jsonSpy = jest.fn();
    const filter = new HttpExceptionFilter();
    const exception = new HttpException({ error: 'Tenant niet gevonden.' }, HttpStatus.NOT_FOUND);

    filter.catch(exception, buildHost(jsonSpy, statusSpy));

    expect(jsonSpy).toHaveBeenCalledWith({ error: 'Tenant niet gevonden.' });
  });

  it('joins class-validator message arrays into one string', () => {
    const statusSpy = jest.fn();
    const jsonSpy = jest.fn();
    const filter = new HttpExceptionFilter();
    const exception = new HttpException(
      { message: ['name moet ingevuld zijn', 'country moet 2 letters zijn'] },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, buildHost(jsonSpy, statusSpy));

    expect(jsonSpy).toHaveBeenCalledWith({
      error: 'name moet ingevuld zijn, country moet 2 letters zijn',
    });
  });
});
```

- [ ] **Step 2: Run test, verifieer dat die faalt**

Run: `npm run test -- http-exception.filter.spec.ts`
Expected: FAIL — module niet gevonden

- [ ] **Step 3: `src/common/filters/http-exception.filter.ts`**

```typescript
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const body = exception.getResponse();

    let errorMessage: string;

    if (typeof body === 'string') {
      errorMessage = body;
    } else if (typeof body === 'object' && body !== null && 'error' in body) {
      errorMessage = (body as { error: string }).error;
    } else if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = (body as { message: string | string[] }).message;
      errorMessage = Array.isArray(message) ? message.join(', ') : message;
    } else {
      errorMessage = exception.message;
    }

    response.status(status).json({ error: errorMessage });
  }
}
```

- [ ] **Step 4: Run test, verifieer dat die slaagt**

Run: `npm run test -- http-exception.filter.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Registreer globaal in `src/main.ts`**

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors();
  const port = process.env.PORT ?? 5001;
  await app.listen(port);
}
bootstrap();
```

- [ ] **Step 6: Commit**

```bash
git add src/common/filters src/main.ts
git commit -m "$(cat <<'EOF'
feat(errors): centrale HttpExceptionFilter met { error } foutvorm

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Taak 9: AuditService

**Files:**
- Create: `src/audit/audit.service.ts`
- Create: `src/audit/audit.module.ts`
- Test: `src/audit/audit.service.spec.ts`

- [ ] **Step 1: Schrijf de falende test**

```typescript
// src/audit/audit.service.spec.ts
import { AuditService } from './audit.service';
import { Prisma } from '@prisma/client';

describe('AuditService', () => {
  it('writes an audit event with the given action, entity and values via the tx client', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const tx = { auditEvent: { create } } as unknown as Prisma.TransactionClient;
    const service = new AuditService();

    await service.record(tx, {
      tenantId: '11111111-1111-1111-1111-111111111111',
      actionType: 'vendor.created',
      entityType: 'vendor',
      entityId: '22222222-2222-2222-2222-222222222222',
      newValues: { name: 'Acme BV' },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: '11111111-1111-1111-1111-111111111111',
        actionType: 'vendor.created',
        entityType: 'vendor',
        entityId: '22222222-2222-2222-2222-222222222222',
        oldValues: undefined,
        newValues: { name: 'Acme BV' },
      },
    });
  });
});
```

- [ ] **Step 2: Run test, verifieer dat die faalt**

Run: `npm run test -- audit.service.spec.ts`
Expected: FAIL — module niet gevonden

- [ ] **Step 3: `src/audit/audit.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface RecordAuditEventInput {
  tenantId: string;
  actionType: string;
  entityType: string;
  entityId: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  async record(tx: Prisma.TransactionClient, input: RecordAuditEventInput): Promise<void> {
    await tx.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        actionType: input.actionType,
        entityType: input.entityType,
        entityId: input.entityId,
        oldValues: input.oldValues,
        newValues: input.newValues,
      },
    });
  }
}
```

- [ ] **Step 4: Run test, verifieer dat die slaagt**

Run: `npm run test -- audit.service.spec.ts`
Expected: PASS

- [ ] **Step 5: `src/audit/audit.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```

- [ ] **Step 6: Registreer in `src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { TenantModule } from './common/tenant/tenant.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [HealthModule, PrismaModule, TenantModule, AuditModule],
})
export class AppModule {}
```

- [ ] **Step 7: Commit**

```bash
git add src/audit src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(audit): AuditService die audit-events binnen dezelfde RLS-transactie schrijft

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Taak 10: Vendors DTO's (class-validator)

**Files:**
- Create: `src/vendors/dto/create-vendor.dto.ts`
- Create: `src/vendors/dto/update-vendor.dto.ts`
- Create: `src/vendors/dto/vendor-response.dto.ts`

- [ ] **Step 1: `src/vendors/dto/create-vendor.dto.ts`**

```typescript
import { IsString, IsOptional, IsNumber, IsUUID, MinLength } from 'class-validator';

export class CreateVendorDto {
  @IsString()
  @MinLength(1, { message: 'Name is verplicht.' })
  name: string;

  @IsOptional()
  @IsString()
  kvkNumber?: string;

  @IsOptional()
  @IsString()
  vestigingsnummer?: string;

  @IsOptional()
  @IsString()
  statutaireNaam?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsNumber()
  annualSpend?: number;

  @IsOptional()
  @IsNumber()
  riskScore?: number;

  @IsOptional()
  @IsString()
  complianceStatus?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string;
}
```

- [ ] **Step 2: `src/vendors/dto/update-vendor.dto.ts`**

```typescript
import { PartialType } from '@nestjs/mapped-types';
import { CreateVendorDto } from './create-vendor.dto';

export class UpdateVendorDto extends PartialType(CreateVendorDto) {}
```

`@nestjs/mapped-types` installeren indien nog niet aanwezig:

```bash
npm install @nestjs/mapped-types
```

- [ ] **Step 3: `src/vendors/dto/vendor-response.dto.ts`**

```typescript
export interface PrimaryContactResponseDto {
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
}

export interface VendorResponseDto {
  id: string;
  tenantId: string;
  name: string;
  kvkNumber: string | null;
  vestigingsnummer: string | null;
  statutaireNaam: string | null;
  handelsnamen: string[];
  rechtsvorm: string | null;
  category: string;
  businessCriticality: string;
  annualSpend: number | null;
  riskScore: number;
  complianceStatus: string;
  ownerId: string | null;
  ownerName: string | null;
  primaryContact: PrimaryContactResponseDto | null;
  country: string;
  city: string | null;
  contractCount: number;
  activeContractCount: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/vendors/dto
git commit -m "$(cat <<'EOF'
feat(vendors): DTO's voor create/update/response

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Taak 11: VendorsService — mapping en business-logica

**Files:**
- Create: `src/vendors/vendors.service.ts`
- Test: `src/vendors/vendors.service.spec.ts`

- [ ] **Step 1: Schrijf de falende tests**

```typescript
// src/vendors/vendors.service.spec.ts
import { NotFoundException } from '@nestjs/common';
import { VendorsService } from './vendors.service';
import { AuditService } from '../audit/audit.service';

describe('VendorsService', () => {
  const TENANT_ID = '11111111-1111-1111-1111-111111111111';
  const VENDOR_ID = '22222222-2222-2222-2222-222222222222';

  function buildTx(overrides: Record<string, any> = {}) {
    return {
      vendor: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        ...overrides.vendor,
      },
    } as any;
  }

  function buildAuditService() {
    return { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  }

  it('throws NotFoundException when the vendor does not exist on getById', async () => {
    const tx = buildTx();
    const service = new VendorsService(buildAuditService());

    await expect(service.getById(tx, TENANT_ID, VENDOR_ID)).rejects.toThrow(NotFoundException);
  });

  it('maps a created vendor row to the response DTO shape', async () => {
    const createdRow = {
      vendorId: VENDOR_ID,
      tenantId: TENANT_ID,
      name: 'Acme BV',
      kvkNumber: null,
      vestigingsnummer: null,
      statutoryName: null,
      tradeNames: [],
      legalForm: null,
      categoryCode: 'other',
      businessCriticalityCode: null,
      annualSpendEur: null,
      riskScore: null,
      complianceStatusCode: 'no_requirements',
      ownerUserId: null,
      country: 'NL',
      city: null,
      createdAt: new Date('2026-07-24T00:00:00.000Z'),
      updatedAt: null,
      owner: null,
      contacts: [],
      tags: [],
    };
    const tx = buildTx({ vendor: { create: jest.fn().mockResolvedValue(createdRow) } });
    const audit = buildAuditService();
    const service = new VendorsService(audit);

    const result = await service.create(tx, TENANT_ID, { name: 'Acme BV' } as any);

    expect(result.id).toBe(VENDOR_ID);
    expect(result.name).toBe('Acme BV');
    expect(result.category).toBe('other');
    expect(result.businessCriticality).toBe('medium');
    expect(result.riskScore).toBe(0);
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ actionType: 'vendor.created', entityType: 'vendor', entityId: VENDOR_ID }),
    );
  });
});
```

- [ ] **Step 2: Run test, verifieer dat die faalt**

Run: `npm run test -- vendors.service.spec.ts`
Expected: FAIL — module niet gevonden

- [ ] **Step 3: `src/vendors/vendors.service.ts`**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { VendorResponseDto } from './dto/vendor-response.dto';

const VENDOR_INCLUDE = {
  owner: true,
  contacts: { where: { isPrimary: true, deletedAt: null } },
  tags: true,
} satisfies Prisma.VendorInclude;

type VendorWithRelations = Prisma.VendorGetPayload<{ include: typeof VENDOR_INCLUDE }>;

@Injectable()
export class VendorsService {
  constructor(private readonly auditService: AuditService) {}

  async list(tx: Prisma.TransactionClient, tenantId: string): Promise<VendorResponseDto[]> {
    const vendors = await tx.vendor.findMany({
      where: { tenantId, deletedAt: null },
      include: VENDOR_INCLUDE,
    });
    return vendors.map((v) => this.toResponseDto(v));
  }

  async getById(tx: Prisma.TransactionClient, tenantId: string, vendorId: string): Promise<VendorResponseDto> {
    const vendor = await tx.vendor.findFirst({
      where: { vendorId, tenantId, deletedAt: null },
      include: VENDOR_INCLUDE,
    });
    if (!vendor) {
      throw new NotFoundException({ error: `Vendor '${vendorId}' niet gevonden.` });
    }
    return this.toResponseDto(vendor);
  }

  async create(tx: Prisma.TransactionClient, tenantId: string, dto: CreateVendorDto): Promise<VendorResponseDto> {
    const vendor = await tx.vendor.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        kvkNumber: dto.kvkNumber,
        vestigingsnummer: dto.vestigingsnummer,
        statutoryName: dto.statutaireNaam,
        website: dto.website,
        categoryCode: dto.category ?? 'other',
        country: dto.country ?? 'NL',
        city: dto.city,
        annualSpendEur: dto.annualSpend,
        riskScore: dto.riskScore,
        complianceStatusCode: dto.complianceStatus ?? 'no_requirements',
        ownerUserId: dto.ownerId,
      },
      include: VENDOR_INCLUDE,
    });

    await this.auditService.record(tx, {
      tenantId,
      actionType: 'vendor.created',
      entityType: 'vendor',
      entityId: vendor.vendorId,
      newValues: { name: vendor.name, categoryCode: vendor.categoryCode, country: vendor.country },
    });

    return this.toResponseDto(vendor);
  }

  async update(
    tx: Prisma.TransactionClient,
    tenantId: string,
    vendorId: string,
    dto: UpdateVendorDto,
  ): Promise<VendorResponseDto> {
    const existing = await tx.vendor.findFirst({ where: { vendorId, tenantId, deletedAt: null } });
    if (!existing) {
      throw new NotFoundException({ error: `Vendor '${vendorId}' niet gevonden.` });
    }

    const oldSnapshot = {
      name: existing.name,
      categoryCode: existing.categoryCode,
      complianceStatusCode: existing.complianceStatusCode,
      riskScore: existing.riskScore,
    };

    const vendor = await tx.vendor.update({
      where: { vendorId },
      data: {
        name: dto.name?.trim(),
        kvkNumber: dto.kvkNumber,
        vestigingsnummer: dto.vestigingsnummer,
        statutoryName: dto.statutaireNaam,
        website: dto.website,
        categoryCode: dto.category,
        country: dto.country,
        city: dto.city,
        annualSpendEur: dto.annualSpend,
        riskScore: dto.riskScore,
        complianceStatusCode: dto.complianceStatus,
        ownerUserId: dto.ownerId,
        updatedAt: new Date(),
      },
      include: VENDOR_INCLUDE,
    });

    await this.auditService.record(tx, {
      tenantId,
      actionType: 'vendor.updated',
      entityType: 'vendor',
      entityId: vendor.vendorId,
      oldValues: oldSnapshot,
      newValues: {
        name: vendor.name,
        categoryCode: vendor.categoryCode,
        complianceStatusCode: vendor.complianceStatusCode,
        riskScore: vendor.riskScore,
      },
    });

    return this.toResponseDto(vendor);
  }

  async softDelete(tx: Prisma.TransactionClient, tenantId: string, vendorId: string): Promise<void> {
    const existing = await tx.vendor.findFirst({ where: { vendorId, tenantId, deletedAt: null } });
    if (!existing) {
      throw new NotFoundException({ error: `Vendor '${vendorId}' niet gevonden.` });
    }

    await tx.vendor.update({
      where: { vendorId },
      data: { deletedAt: new Date(), updatedAt: new Date() },
    });

    await this.auditService.record(tx, {
      tenantId,
      actionType: 'vendor.deleted',
      entityType: 'vendor',
      entityId: vendorId,
      oldValues: { name: existing.name },
    });
  }

  private toResponseDto(vendor: VendorWithRelations): VendorResponseDto {
    const primary = vendor.contacts.find((c) => c.isPrimary) ?? null;
    return {
      id: vendor.vendorId,
      tenantId: vendor.tenantId,
      name: vendor.name,
      kvkNumber: vendor.kvkNumber,
      vestigingsnummer: vendor.vestigingsnummer,
      statutaireNaam: vendor.statutoryName,
      handelsnamen: vendor.tradeNames,
      rechtsvorm: vendor.legalForm,
      category: vendor.categoryCode ?? 'other',
      businessCriticality: vendor.businessCriticalityCode ?? 'medium',
      annualSpend: vendor.annualSpendEur ? Number(vendor.annualSpendEur) : null,
      riskScore: vendor.riskScore ?? 0,
      complianceStatus: vendor.complianceStatusCode ?? 'no_requirements',
      ownerId: vendor.ownerUserId,
      ownerName: vendor.owner?.fullName ?? null,
      primaryContact: primary
        ? { name: primary.fullName, email: primary.email, phone: primary.phone, role: primary.roleDescription }
        : null,
      country: vendor.country,
      city: vendor.city,
      contractCount: 0,
      activeContractCount: 0,
      tags: vendor.tags.map((t) => t.tag),
      createdAt: vendor.createdAt.toISOString(),
      updatedAt: (vendor.updatedAt ?? vendor.createdAt).toISOString(),
    };
  }
}
```

`contractCount`/`activeContractCount` blijven hardcoded op 0 — Fase 0 heeft nog geen `contract`-tabel (zie spec sectie 4).

- [ ] **Step 4: Run test, verifieer dat die slaagt**

Run: `npm run test -- vendors.service.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/vendors/vendors.service.ts src/vendors/vendors.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(vendors): VendorsService met CRUD-logica en DTO-mapping

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Taak 12: VendorsController + VendorsModule

**Files:**
- Create: `src/vendors/vendors.controller.ts`
- Create: `src/vendors/vendors.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: `src/vendors/vendors.controller.ts`**

```typescript
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { withTenant } from '../prisma/with-tenant';
import { VendorsService } from './vendors.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { FeatureFlagGuard } from '../common/feature-flags/feature-flag.guard';
import { RequireFeatureFlag } from '../common/feature-flags/feature-flag.decorator';

@Controller('api/v2/vendors')
@UseGuards(FeatureFlagGuard)
@RequireFeatureFlag('FEATURE_VENDORS_ENABLED')
export class VendorsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vendorsService: VendorsService,
  ) {}

  @Get()
  async list(@Req() req: Request & { tenantId: string }) {
    return withTenant(this.prisma, req.tenantId, (tx) => this.vendorsService.list(tx, req.tenantId));
  }

  @Get(':id')
  async getById(@Req() req: Request & { tenantId: string }, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.prisma, req.tenantId, (tx) => this.vendorsService.getById(tx, req.tenantId, id));
  }

  @Post()
  async create(@Req() req: Request & { tenantId: string }, @Body() dto: CreateVendorDto) {
    return withTenant(this.prisma, req.tenantId, (tx) => this.vendorsService.create(tx, req.tenantId, dto));
  }

  @Put(':id')
  async update(
    @Req() req: Request & { tenantId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVendorDto,
  ) {
    return withTenant(this.prisma, req.tenantId, (tx) => this.vendorsService.update(tx, req.tenantId, id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: Request & { tenantId: string }, @Param('id', ParseUUIDPipe) id: string) {
    await withTenant(this.prisma, req.tenantId, (tx) => this.vendorsService.softDelete(tx, req.tenantId, id));
  }
}
```

- [ ] **Step 2: `src/vendors/vendors.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { VendorsController } from './vendors.controller';
import { VendorsService } from './vendors.service';

@Module({
  controllers: [VendorsController],
  providers: [VendorsService],
})
export class VendorsModule {}
```

- [ ] **Step 3: Registreer in `src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { TenantModule } from './common/tenant/tenant.module';
import { AuditModule } from './audit/audit.module';
import { VendorsModule } from './vendors/vendors.module';

@Module({
  imports: [HealthModule, PrismaModule, TenantModule, AuditModule, VendorsModule],
})
export class AppModule {}
```

- [ ] **Step 4: Build verifiëren**

Run: `npm run build`
Expected: geen TypeScript-fouten.

- [ ] **Step 5: Commit**

```bash
git add src/vendors/vendors.controller.ts src/vendors/vendors.module.ts src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(vendors): VendorsController met volledige CRUD achter feature flag

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Taak 13: E2e-tests — Vendors CRUD

**Files:**
- Create: `test/vendors/vendors.e2e-spec.ts`

Deze test draait tegen de echte (lokale Docker) database, met `FEATURE_VENDORS_ENABLED=true` gezet via `process.env` vóór het opzetten van de test-app.

- [ ] **Step 1: Schrijf de e2e-test**

```typescript
// test/vendors/vendors.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Vendors (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let demoTenantId: string;

  beforeAll(async () => {
    process.env.FEATURE_VENDORS_ENABLED = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    const demoTenant = await prisma.tenant.findFirstOrThrow({ where: { name: 'demo' } });
    demoTenantId = demoTenant.tenantId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/v2/vendors creates a vendor and GET returns it in the list', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v2/vendors')
      .set('X-Tenant-Id', demoTenantId)
      .send({ name: 'E2E Test Vendor' })
      .expect(201);

    expect(createRes.body.name).toBe('E2E Test Vendor');
    expect(createRes.body.category).toBe('other');
    const vendorId = createRes.body.id;

    const listRes = await request(app.getHttpServer())
      .get('/api/v2/vendors')
      .set('X-Tenant-Id', demoTenantId)
      .expect(200);

    expect(listRes.body.some((v: { id: string }) => v.id === vendorId)).toBe(true);
  });

  it('GET /api/v2/vendors/:id returns 404 with NL error for unknown vendor', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v2/vendors/00000000-0000-0000-0000-000000000000')
      .set('X-Tenant-Id', demoTenantId)
      .expect(404);

    expect(res.body.error).toContain('niet gevonden');
  });

  it('PUT /api/v2/vendors/:id partially updates only the given fields', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v2/vendors')
      .set('X-Tenant-Id', demoTenantId)
      .send({ name: 'Update Test Vendor', city: 'Utrecht' })
      .expect(201);

    const vendorId = createRes.body.id;

    const updateRes = await request(app.getHttpServer())
      .put(`/api/v2/vendors/${vendorId}`)
      .set('X-Tenant-Id', demoTenantId)
      .send({ city: 'Amsterdam' })
      .expect(200);

    expect(updateRes.body.city).toBe('Amsterdam');
    expect(updateRes.body.name).toBe('Update Test Vendor');
  });

  it('DELETE /api/v2/vendors/:id soft-deletes — vendor disappears from list but row remains', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v2/vendors')
      .set('X-Tenant-Id', demoTenantId)
      .send({ name: 'Delete Test Vendor' })
      .expect(201);

    const vendorId = createRes.body.id;

    await request(app.getHttpServer())
      .delete(`/api/v2/vendors/${vendorId}`)
      .set('X-Tenant-Id', demoTenantId)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v2/vendors/${vendorId}`)
      .set('X-Tenant-Id', demoTenantId)
      .expect(404);
  });

  it('POST /api/v2/vendors without name returns 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v2/vendors')
      .set('X-Tenant-Id', demoTenantId)
      .send({})
      .expect(400);

    expect(res.body.error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tegen lokale Docker-database**

Run: `docker-compose up -d` (als nog niet actief), dan `npm run test:e2e -- vendors.e2e-spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 3: Commit**

```bash
git add test/vendors
git commit -m "$(cat <<'EOF'
test(vendors): e2e-tests voor volledige CRUD

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Taak 14: Tenant-isolatietest (Database-regel 4, verplicht vóór "migratie voltooid")

**Files:**
- Create: `test/vendors/vendors.tenant-isolation.e2e-spec.ts`

- [ ] **Step 1: Schrijf de test**

```typescript
// test/vendors/vendors.tenant-isolation.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Vendors tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    process.env.FEATURE_VENDORS_ENABLED = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    const tenantA = await prisma.tenant.create({ data: { name: `isolation-test-a-${Date.now()}` } });
    const tenantB = await prisma.tenant.create({ data: { name: `isolation-test-b-${Date.now()}` } });
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await app.close();
  });

  it('a vendor created for tenant A is invisible in tenant B list (read isolation)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v2/vendors')
      .set('X-Tenant-Id', tenantAId)
      .send({ name: 'Tenant A Vendor' })
      .expect(201);

    const vendorId = createRes.body.id;

    const listAsB = await request(app.getHttpServer())
      .get('/api/v2/vendors')
      .set('X-Tenant-Id', tenantBId)
      .expect(200);

    expect(listAsB.body.some((v: { id: string }) => v.id === vendorId)).toBe(false);
  });

  it('tenant B cannot read tenant A vendor by id (404, not leaked)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v2/vendors')
      .set('X-Tenant-Id', tenantAId)
      .send({ name: 'Tenant A Vendor Detail' })
      .expect(201);

    const vendorId = createRes.body.id;

    await request(app.getHttpServer())
      .get(`/api/v2/vendors/${vendorId}`)
      .set('X-Tenant-Id', tenantBId)
      .expect(404);
  });

  it('tenant B cannot update tenant A vendor (blocked at RLS level, surfaces as 404)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v2/vendors')
      .set('X-Tenant-Id', tenantAId)
      .send({ name: 'Tenant A Vendor Write Test' })
      .expect(201);

    const vendorId = createRes.body.id;

    await request(app.getHttpServer())
      .put(`/api/v2/vendors/${vendorId}`)
      .set('X-Tenant-Id', tenantBId)
      .send({ name: 'Hijacked' })
      .expect(404);

    const originalStillIntact = await request(app.getHttpServer())
      .get(`/api/v2/vendors/${vendorId}`)
      .set('X-Tenant-Id', tenantAId)
      .expect(200);

    expect(originalStillIntact.body.name).toBe('Tenant A Vendor Write Test');
  });
});
```

- [ ] **Step 2: Run test**

Run: `npm run test:e2e -- vendors.tenant-isolation.e2e-spec.ts`
Expected: PASS (3 tests) — bevestigt dat RLS-policies daadwerkelijk cross-tenant read/write blokkeren.

- [ ] **Step 3: Commit**

```bash
git add test/vendors/vendors.tenant-isolation.e2e-spec.ts
git commit -m "$(cat <<'EOF'
test(vendors): tenant-isolatietest conform Database-regel 4

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Taak 15: GitHub Actions CI — lint, typecheck, test, migratie-tegen-lege-db, docker build

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/postgres?schema=public
      FEATURE_VENDORS_ENABLED: 'true'

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npm run build

      - name: Run migrations against a clean database
        run: npx prisma migrate deploy

      - name: Unit tests
        run: npm run test

      - name: E2e tests
        run: npm run test:e2e

      - name: Build Docker image
        run: docker build -t mcm2-api:ci .
```

- [ ] **Step 2: Lokaal `npm run lint` en `npm run build` verifiëren voordat gepusht wordt**

Run: `npm run lint`
Expected: geen fouten (of automatisch te fixen met `npm run lint -- --fix`).

Run: `npm run build`
Expected: geen TypeScript-fouten.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: GitHub Actions workflow voor lint, typecheck, test, migratie-check en docker build

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Taak 16: Lokale end-to-end verificatie + MVM_V2-koppeling

Geen nieuwe bestanden — dit is de handmatige verificatiestap vóór de branch als "klaar" geldt (Guardrails-checklist).

- [ ] **Step 1: Volledige stack starten**

```bash
docker-compose up --build
```

Expected: `mcm2-api`, `minio`, `redis` draaien zonder fouten.

- [ ] **Step 2: Feature flag lokaal aanzetten in `.env`**

```env
FEATURE_VENDORS_ENABLED=true
```

Herstart de `mcm2-api`-container (`docker-compose restart mcm2-api`).

- [ ] **Step 3: Handmatige curl-verificatie**

```bash
curl http://localhost:5001/health
curl http://localhost:5001/api/v2/vendors
curl -X POST http://localhost:5001/api/v2/vendors -H "Content-Type: application/json" -d '{"name":"Handmatige Test BV"}'
```

Expected: health geeft `{"status":"ok"}`, vendors-lijst en create werken zonder foutmelding.

- [ ] **Step 4: MVM_V2 lokaal herwijzen (alleen env-var, geen codewijziging)**

In `MVM_V2/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5001
```

Start MVM_V2 lokaal (`npm run dev` in die map, poort 3000/3002/3004 — zie `C:\dev\CLAUDE.md`) en open de Vendors-pagina in de browser.

- [ ] **Step 5: Visueel bevestigen dat de Vendors-pagina in MVM_V2 data toont uit MCM2**

Verwacht: de zojuist aangemaakte "Handmatige Test BV" (of eerdere e2e-testvendors, als die niet zijn opgeruimd) verschijnt in de lijst.

Als de pagina een ander veldnamenformaat verwacht dan `VendorResponseDto` levert: noteer het verschil, dit is een bug in Taak 11 (DTO-mapping), niet iets om in de frontend te patchen.

- [ ] **Step 6: Testdata opruimen**

```bash
docker-compose down -v
```

Dit verwijdert de lokale MinIO/Redis-volumes; de Supabase-database blijft staan (bevat nu wel test-vendors uit e2e-runs — acceptabel voor Fase 0, opschonen is geen blocker voor deze branch).

---

## Self-Review Checklist (uitgevoerd door de planschrijver)

- **Spec coverage:** projectstructuur (Taak 1, 3), tenant-resolutie/RLS (Taak 4–6), database-schema (Taak 4–5), Vendors-endpoints inclusief feature flag (Taak 7, 10–12), foutafhandeling (Taak 8), testplan inclusief tenant-isolatie (Taak 13–14), CI (Taak 15), MVM_V2-koppeling (Taak 16). Audit-logging (Taak 9) expliciet gedekt. Alles uit de spec heeft een taak.
- **Placeholder-scan:** geen TBD/TODO in de plan-stappen; elke stap bevat volledige code.
- **Type-consistentie:** `VendorResponseDto`-veldnamen in Taak 10 komen overeen met wat `VendorsService.toResponseDto` in Taak 11 teruggeeft en wat de e2e-tests in Taak 13–14 controleren (`id`, `name`, `category`, `city`, etc.). `withTenant`-signatuur (Taak 6) komt overeen met het gebruik in `VendorsController` (Taak 12).
- **Buiten scope, bewust:** contract/document/notification/staging-tabellen, Cognito-auth, AWS-specifieke code — zoals in de spec vastgelegd.
