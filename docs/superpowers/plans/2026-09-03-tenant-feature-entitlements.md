# Per-tenant feature-entitlements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Platformbeheerders kunnen per tenant een optionele feature (te
beginnen met de contractmodule) aan- of uitzetten; de frontend toont de
feature alleen als hij aanstaat.

**Architecture:** Nieuwe tabel `clm.tenant_feature` (RLS voor lezen binnen
de eigen tenant, schrijven alleen via de platformbeheer-servicelaag), een
`FeatureModule` met `TenantFeatureService`, twee nieuwe routes op de
bestaande `PlatformController` (erft `TenantContextGuard` +
`PlatformAdminGuard`), en een `features`-veld op het bestaande
`GET /auth/sessie`-antwoord. Featuredefinities staan vast in de code
(`feature-registry.ts`); alleen de aan/uit-status per tenant staat in de
database.

**Tech Stack:** NestJS, Drizzle (handgeschreven SQL-migraties, geen
`db:generate` — zie CLAUDE.md), Postgres met RLS, Jest + Supertest voor
e2e.

---

## Referentiedocument

Ontwerp: `docs/superpowers/specs/2026-09-03-tenant-feature-entitlements-design.md`.
Lees dat document voor de volledige afwegingen (§1–§8) vóór je begint —
dit plan herhaalt niet elke beslissing, alleen de bouwstappen.

## Belangrijk vóór je begint

- Zorg voor een wegwerpdatabase via `npm run test:db -- "tenant-feature-entitlements"`
  (nooit handmatig rollen/wachtwoorden raden — zie CLAUDE.md). Het script
  drukt aan het eind de `MIGRATION_DATABASE_URL`/`DATABASE_URL`-regels af;
  exporteer die in je shell voordat je migraties of tests draait.
- Draai na Taak 8 zowel `npx jest test-ids` als de volledige e2e-run
  (`npm run test:e2e` of het equivalent in `package.json` — controleer de
  scriptnaam, verzin hem niet). Alle e2e-suites delen één database.

---

### Taak 1: Migratie — `clm.tenant_feature` aanmaken

**Files:**
- Create: `drizzle/0038_tenant_feature.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Stap 1: Schrijf de migratie**

```sql
-- Migratie 0038: per-tenant feature-entitlements (spec
-- docs/superpowers/specs/2026-09-03-tenant-feature-entitlements-design.md).
--
-- Geen rij voor een tenant/feature-combinatie betekent: uit. `enabled` heeft
-- bewust geen kolom-default — elke rij ontstaat via een expliciete
-- handeling (deze migratie, of een platformbeheerder die schakelt).

CREATE TABLE clm.tenant_feature (
    tenant_id    uuid NOT NULL REFERENCES clm.tenant(tenant_id) ON DELETE CASCADE,
    feature_key  text NOT NULL,
    enabled      boolean NOT NULL,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   uuid REFERENCES clm."user"(user_id),
    CONSTRAINT tenant_feature_pkey PRIMARY KEY (tenant_id, feature_key)
);--> statement-breakpoint

COMMENT ON TABLE clm.tenant_feature IS
    'Welke optionele features een tenant mag gebruiken (platformbeheer-schakelaar). Geen rij = uit.';--> statement-breakpoint

CREATE INDEX tenant_feature_tenant_id_idx ON clm.tenant_feature(tenant_id);--> statement-breakpoint

ALTER TABLE clm.tenant_feature ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.tenant_feature FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Lezen: elke tenant ziet alleen zijn eigen rijen (voor GET /auth/sessie).
-- clm.current_tenant_id() leest de sessievariabele app.current_tenant_id,
-- gezet door DatabaseService.withTenant() — zelfde functie als elke andere
-- RLS-policy in dit schema gebruikt (zie migratie 0000).
CREATE POLICY tenant_feature_isolation ON clm.tenant_feature
    USING (tenant_id = clm.current_tenant_id());--> statement-breakpoint

-- Schrijven: via de gewone tenant-runtime (clm_api/clm_admin), net als
-- clm.contract — anders dan clm.platform_admin (migratie 0020), dat de
-- runtime-rol nooit schrijft: hier moet de platformbeheerder juist via de
-- webapplicatie kunnen schakelen (spec §5, PlatformController-routes). De
-- echte grens is PlatformAdminGuard op de route, niet de databaserol; RLS
-- houdt bovendien elke tenant bij zijn eigen rijen, ook al kan clm_api er
-- technisch bij. Geen DELETE: schakelen is altijd een update van `enabled`,
-- een rij verdwijnt nooit.
REVOKE DELETE ON clm.tenant_feature FROM clm_api, clm_admin;--> statement-breakpoint

-- Bestaande tenants behouden de contractmodule (spec §4): zonder deze stap
-- verdwijnt de module bij uitrol voor Transdev, AlingAdvies, demo, Bizaline
-- en Platformbeheer.
INSERT INTO clm.tenant_feature (tenant_id, feature_key, enabled)
SELECT tenant_id, 'contractmodule', true
FROM clm.tenant
WHERE deleted_at IS NULL;
```

- [ ] **Stap 2: Voeg de migratie toe aan `drizzle/meta/_journal.json`**

Open `drizzle/meta/_journal.json`, kopieer het laatste entry-object
(idx 37) en voeg erna toe:

```json
    {
      "idx": 38,
      "version": "7",
      "when": 1787068800012,
      "tag": "0038_tenant_feature",
      "breakpoints": true
    }
```

Zonder deze stap slaat Drizzle de migratie stilzwijgend over (CLAUDE.md
§"Een handgeschreven migratie moet in `drizzle/meta/_journal.json`").

- [ ] **Stap 3: Draai de migratie op de wegwerpdatabase**

Run: `npm run migrate:deploy` (met `MIGRATION_DATABASE_URL` gezet naar de
wegwerpcontainer uit `npm run test:db`).

Expected: geen foutmelding. Controleer daarna in de database zelf — niet op
de melding vertrouwen (CLAUDE.md §4):

```sql
SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
  FROM information_schema.columns WHERE table_schema='clm' AND table_name='tenant_feature';
```

Expected: `tenant_id, feature_key, enabled, updated_at, updated_by`.

- [ ] **Stap 4: Bevestig dat bestaande tenants de contractmodule hebben**

```sql
SELECT COUNT(*) FROM clm.tenant_feature WHERE feature_key = 'contractmodule' AND enabled = true;
```

Expected: gelijk aan het aantal niet-verwijderde rijen in `clm.tenant` op
dat moment (op een verse wegwerpdatabase meestal 0, tenzij er al
testtenants zijn aangemaakt — dat is verwacht, geen fout).

- [ ] **Stap 5: Commit**

```bash
git add drizzle/0038_tenant_feature.sql drizzle/meta/_journal.json
git commit -m "feat(features): migratie clm.tenant_feature + bestaande tenants behouden contractmodule"
```

---

### Taak 2: Schema — Drizzle-definitie van `tenant_feature`

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Stap 1: Voeg de tabel toe aan `src/db/schema.ts`**

Zoek de plek na `export const contract = clm.table(...)` (rond regel 482,
vóór de `importJob`-sectie) en voeg toe:

```ts
// ─── clm schema: per-tenant feature-entitlements ───────────────────────────
// Zie docs/superpowers/specs/2026-09-03-tenant-feature-entitlements-design.md,
// migratie 0038. Geen rij voor een tenant/feature-combinatie betekent: uit.

export const tenantFeature = clm.table(
  'tenant_feature',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'cascade' }),
    featureKey: text('feature_key').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: uuid('updated_by').references(() => user.userId),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.featureKey] }),
    index('tenant_feature_tenant_id_idx').on(t.tenantId),
  ],
);
```

- [ ] **Stap 2: Controleer dat `boolean`, `primaryKey`, `index`, `text`, `uuid`, `timestamp` al geïmporteerd zijn bovenaan `schema.ts`**

Run: `grep -n "^import" src/db/schema.ts | grep drizzle-orm`

Expected: alle bovenstaande functienamen komen voor in de import van
`drizzle-orm/pg-core` (ze worden al door `contract` en `tenantMembership`
gebruikt). Zo niet, voeg de ontbrekende toe aan de bestaande import.

- [ ] **Stap 3: Compileer**

Run: `npx tsc --noEmit`

Expected: geen fouten.

- [ ] **Stap 4: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(features): Drizzle-schema voor clm.tenant_feature"
```

---

### Taak 3: Feature-registry

**Files:**
- Create: `src/features/feature-registry.ts`
- Test: `src/features/feature-registry.spec.ts`

- [ ] **Stap 1: Schrijf de falende test**

```ts
import { FEATURE_KEYS, isFeatureKey } from './feature-registry';

describe('feature-registry', () => {
  it('bevat contractmodule als geldige feature-sleutel', () => {
    expect(FEATURE_KEYS).toContain('contractmodule');
  });

  it('herkent een geldige sleutel', () => {
    expect(isFeatureKey('contractmodule')).toBe(true);
  });

  it('wijst een onbekende sleutel af', () => {
    expect(isFeatureKey('onbestaande-feature')).toBe(false);
  });

  it('wijst een niet-string af', () => {
    expect(isFeatureKey(123)).toBe(false);
    expect(isFeatureKey(undefined)).toBe(false);
  });
});
```

- [ ] **Stap 2: Run de test, verwacht een fout**

Run: `npx jest src/features/feature-registry.spec.ts`
Expected: FAIL — `Cannot find module './feature-registry'`.

- [ ] **Stap 3: Implementeer**

```ts
/**
 * Welke features schakelbaar zijn per tenant (platformbeheer-entitlements).
 *
 * Vaste lijst in de code, aan/uit-status in de database (`clm.tenant_feature`).
 * Een `feature_key` zonder bijbehorende code is hierdoor onmogelijk — zie
 * docs/superpowers/specs/2026-09-03-tenant-feature-entitlements-design.md §3.
 *
 * Een nieuwe schakelbare feature: één regel toevoegen aan `FEATURE_KEYS`.
 */
export const FEATURE_KEYS = ['contractmodule'] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export function isFeatureKey(waarde: unknown): waarde is FeatureKey {
  return (
    typeof waarde === 'string' &&
    (FEATURE_KEYS as readonly string[]).includes(waarde)
  );
}
```

- [ ] **Stap 4: Run de test, verwacht succes**

Run: `npx jest src/features/feature-registry.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Stap 5: Commit**

```bash
git add src/features/feature-registry.ts src/features/feature-registry.spec.ts
git commit -m "feat(features): feature-registry met contractmodule"
```

---

### Taak 4: `TenantFeatureService`

**Files:**
- Create: `src/features/tenant-feature.service.ts`
- Test: `test/tenant-feature.e2e-spec.ts` (deel 1 — servicelaag via de module, geen HTTP)

De service heeft geen zinvolle unit-testlaag zonder een echte database (hij
bestaat vrijwel volledig uit SQL via `withTenant`), dus dit wordt direct als
e2e-test tegen de wegwerpdatabase geschreven, in dezelfde suite als Taak 6.
Deze taak bouwt de service; Taak 6 voegt de eerste teststappen toe zodra de
module er is. Schrijf hier alvast de service met complete implementatie —
zonder test-first, omdat de e2e-opzet (app, guards, cookies) toch pas in
Taak 6 bestaat. De volledige testdekking staat in Taak 6 en 7.

- [ ] **Stap 1: Schrijf `TenantFeatureService`**

```ts
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';
import { FeatureKey } from './feature-registry';

/**
 * Leest en schrijft `clm.tenant_feature` (spec
 * docs/superpowers/specs/2026-09-03-tenant-feature-entitlements-design.md).
 *
 * `lijst()` draait binnen de tenantcontext van de opvrager zelf (gebruikt
 * door GET /auth/sessie — elke tenant leest alleen zijn eigen rijen, RLS
 * dwingt dat af). `zetten()` draait binnen de tenantcontext van de tenant
 * die de platformbeheerder wijzigt — dezelfde figuur als
 * `PlatformService.tenantWijzigen()`: de tenant in de invoer is "waar je
 * iets aan doet", niet "wie je bent".
 */
@Injectable()
export class TenantFeatureService {
  constructor(private readonly db: DatabaseService) {}

  async lijst(tenantId: string): Promise<FeatureKey[]> {
    return this.db.withTenant(tenantId, async (tx) => {
      const { rows } = await tx.execute<{ feature_key: string }>(
        sql`SELECT feature_key FROM clm.tenant_feature
             WHERE tenant_id = ${tenantId} AND enabled = true`,
      );

      return rows.map((r) => r.feature_key as FeatureKey);
    });
  }

  async zetten(
    tenantId: string,
    featureKey: FeatureKey,
    enabled: boolean,
    updatedByUserId: string,
  ): Promise<void> {
    await this.db.withTenant(tenantId, async (tx) => {
      await tx.execute(
        sql`INSERT INTO clm.tenant_feature
              (tenant_id, feature_key, enabled, updated_at, updated_by)
            VALUES (${tenantId}, ${featureKey}, ${enabled}, now(), ${updatedByUserId})
            ON CONFLICT (tenant_id, feature_key)
            DO UPDATE SET enabled = ${enabled}, updated_at = now(), updated_by = ${updatedByUserId}`,
      );

      await tx.execute(
        sql`INSERT INTO audit.audit_event
              (tenant_id, action_type, entity_type, entity_id, new_values)
            VALUES (${tenantId}, 'tenant_feature_gewijzigd', 'tenant_feature', ${tenantId},
                    ${JSON.stringify({ featureKey, enabled })}::jsonb)`,
      );
    });
  }
}
```

- [ ] **Stap 2: Compileer**

Run: `npx tsc --noEmit`
Expected: geen fouten.

- [ ] **Stap 3: Commit**

```bash
git add src/features/tenant-feature.service.ts
git commit -m "feat(features): TenantFeatureService (lijst/zetten, audit-log)"
```

---

### Taak 5: `FeatureModule` en routes op `PlatformController`

**Files:**
- Create: `src/features/feature.module.ts`
- Modify: `src/platform/platform.controller.ts`
- Modify: `src/platform/platform.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Stap 1: Schrijf `FeatureModule`**

```ts
import { Module } from '@nestjs/common';

import { TenantFeatureService } from './tenant-feature.service';

/**
 * Per-tenant feature-entitlements (spec
 * docs/superpowers/specs/2026-09-03-tenant-feature-entitlements-design.md).
 *
 * Exporteert TenantFeatureService voor PlatformModule (de schakelroutes) en
 * AuthModule (het features-veld op GET /auth/sessie).
 */
@Module({
  providers: [TenantFeatureService],
  exports: [TenantFeatureService],
})
export class FeatureModule {}
```

- [ ] **Stap 2: Registreer `FeatureModule` in `src/app.module.ts`**

Voeg de import toe naast de andere modules (alfabetisch, na `DatabaseModule`
en vóór `HealthModule` past bij de bestaande volgorde):

```ts
import { FeatureModule } from './features/feature.module';
```

En voeg `FeatureModule` toe aan de `imports`-array van `AppModule` (naast
`ContractModule`, `ContractImportModule`).

- [ ] **Stap 3: Importeer `FeatureModule` in `PlatformModule`**

Open `src/platform/platform.module.ts`, voeg `FeatureModule` toe aan
`imports` en injecteer `TenantFeatureService` niet opnieuw als provider —
hij komt via de export van `FeatureModule` binnen.

- [ ] **Stap 4: Voeg de twee routes toe aan `PlatformController`**

Open `src/platform/platform.controller.ts`. Voeg de import toe:

```ts
import { FEATURE_KEYS, isFeatureKey } from '../features/feature-registry';
import { TenantFeatureService } from '../features/tenant-feature.service';
```

Voeg `TenantFeatureService` toe aan de constructor:

```ts
constructor(
  private readonly platform: PlatformService,
  private readonly uitnodigingen: UitnodigingVerzender,
  private readonly sessies: SessieService,
  private readonly features: TenantFeatureService,
) {}
```

Voeg de twee routes toe (na `tenantDeactiveren`, vóór `supportToegang` —
beide bestaan al binnen `PlatformController` en erven de klasseniveau-guards
`TenantContextGuard` + `PlatformAdminGuard`, dus geen extra guard nodig):

```ts
/**
 * Welke features een tenant heeft (per-tenant feature-entitlements,
 * spec 2026-09-03).
 */
@Get('tenants/:id/features')
async tenantFeatures(@Param('id') id: string) {
  const bestaat = await this.platform.tenantLezen(id);

  if (!bestaat) {
    throw new NotFoundException('Onbekende tenant.');
  }

  const features = await this.features.lijst(id);

  return { features };
}

/**
 * Eén feature aan- of uitzetten voor een tenant (per-tenant
 * feature-entitlements, spec 2026-09-03).
 */
@Put('tenants/:id/features/:featureKey')
async tenantFeatureZetten(
  @Param('id') id: string,
  @Param('featureKey') featureKey: string,
  @Body() body: unknown,
  @Req() request: RequestMetSessie,
) {
  if (!isFeatureKey(featureKey)) {
    throw new BadRequestException({
      veld: 'featureKey',
      melding: `Onbekende feature. Geldige waarden: ${FEATURE_KEYS.join(', ')}.`,
    });
  }

  const enabled = (body as { enabled?: unknown })?.enabled;

  if (typeof enabled !== 'boolean') {
    throw new BadRequestException({
      veld: 'enabled',
      melding: 'enabled is verplicht en moet een boolean zijn.',
    });
  }

  const bestaat = await this.platform.tenantLezen(id);

  if (!bestaat) {
    throw new NotFoundException('Onbekende tenant.');
  }

  const sessie = request.sessie!;
  await this.features.zetten(id, featureKey, enabled, sessie.userId);

  return { featureKey, enabled };
}
```

- [ ] **Stap 5: Compileer**

Run: `npx tsc --noEmit`
Expected: geen fouten.

- [ ] **Stap 6: Commit**

```bash
git add src/features/feature.module.ts src/app.module.ts src/platform/platform.module.ts src/platform/platform.controller.ts
git commit -m "feat(features): platformroutes om tenant-features te lezen en te zetten"
```

---

### Taak 6: E2e-test — schakelroutes (test-ids + suite)

**Files:**
- Modify: `test/test-ids.ts`
- Create: `test/tenant-feature-routes.e2e-spec.ts`

- [ ] **Stap 1: Voeg test-ids toe**

Open `test/test-ids.ts`, voeg na het `'contract-import'`-blok (laatste
entry, merk `4d`) toe:

```ts
  'tenant-feature-routes': {
    tenant: id('4e'),
    beheerder: id('4f'),
    klantAdmin: id('50'),
  },
```

- [ ] **Stap 2: Schrijf de falende e2e-test**

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Client } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { cookieInstellingen } from '../src/auth/sessie';
import { SessieService } from '../src/auth/sessie.service';
import { TEST_IDS } from './test-ids';

/**
 * Platformroutes voor per-tenant feature-entitlements (spec
 * docs/superpowers/specs/2026-09-03-tenant-feature-entitlements-design.md).
 *
 * Zelfde kernvraag als platform-routes.e2e-spec.ts: kan een gewone
 * tenant-admin deze routes aanroepen (moet niet — 403), en doet de route
 * wat hij belooft voor een echte platformbeheerder.
 */

const {
  tenant: TENANT,
  beheerder: USER_BEHEERDER,
  klantAdmin: USER_KLANT_ADMIN,
} = TEST_IDS['tenant-feature-routes'];

const SUBJECT_BEHEERDER = `oid-featureroutes-beheer-${Date.now()}`;
const SUBJECT_KLANT_ADMIN = `oid-featureroutes-klant-${Date.now()}`;

function migratieUrl(): string {
  const runtime = process.env.DATABASE_URL;
  if (!runtime) throw new Error('DATABASE_URL ontbreekt.');

  const doel = new URL(runtime);
  const expliciet = process.env.MIGRATION_DATABASE_URL;

  if (expliciet) {
    const gegeven = new URL(expliciet);
    if (gegeven.host === doel.host && gegeven.pathname === doel.pathname) {
      return expliciet;
    }
  }

  doel.username = 'clm_migrator';
  return doel.toString();
}

interface FeaturesAntwoord {
  features: string[];
}

describe('Platformroutes: tenant-features (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let migratieClient: Client;
  let cookieBeheerder: string;
  let cookieKlantAdmin: string;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [TENANT, `featureroutes-${Date.now()}`],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, email, external_subject)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        USER_BEHEERDER,
        TENANT,
        'Featureroutes Beheerder',
        `${SUBJECT_BEHEERDER}@voorbeeld.nl`,
        SUBJECT_BEHEERDER,
      ],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [USER_BEHEERDER, TENANT],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, email, external_subject)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        USER_KLANT_ADMIN,
        TENANT,
        'Gewone Klantadmin',
        `${SUBJECT_KLANT_ADMIN}@voorbeeld.nl`,
        SUBJECT_KLANT_ADMIN,
      ],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'user')`,
      [USER_KLANT_ADMIN, TENANT],
    );
    await client.query('COMMIT');

    migratieClient = new Client({ connectionString: migratieUrl() });
    await migratieClient.connect();
    await migratieClient.query(
      `INSERT INTO clm.platform_admin (user_id, toelichting)
       VALUES ($1, 'e2e tenant-feature-routes') ON CONFLICT DO NOTHING`,
      [USER_BEHEERDER],
    );

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();

    const sessies = app.get(SessieService);
    const cookieNaam = cookieInstellingen().naam;

    const sessieBeheerder = await sessies.aanmaken(SUBJECT_BEHEERDER);
    const sessieKlantAdmin = await sessies.aanmaken(SUBJECT_KLANT_ADMIN);
    expect(sessieBeheerder).not.toBeNull();
    expect(sessieKlantAdmin).not.toBeNull();

    cookieBeheerder = `${cookieNaam}=${sessieBeheerder!.token}`;
    cookieKlantAdmin = `${cookieNaam}=${sessieKlantAdmin!.token}`;
  }, 30000);

  afterAll(async () => {
    await app.close();

    // clm.tenant_feature heeft FORCE ROW LEVEL SECURITY (migratie 0038) —
    // ook clm_migrator (owner) moet de tenantcontext zetten, anders ziet
    // deze DELETE geen rijen en faalt de user-verwijdering hieronder op de
    // achterblijvende foreign key (updated_by).
    await migratieClient.query('BEGIN');
    await migratieClient.query(
      `SET LOCAL app.current_tenant_id = '${TENANT}'`,
    );
    await migratieClient.query(
      'DELETE FROM clm.tenant_feature WHERE tenant_id = $1',
      [TENANT],
    );
    await migratieClient.query('COMMIT');

    await migratieClient.query(
      'DELETE FROM audit.audit_event WHERE tenant_id = $1',
      [TENANT],
    );
    await migratieClient.query(
      'DELETE FROM clm.platform_admin WHERE user_id = $1',
      [USER_BEHEERDER],
    );

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
    await client.query(
      'DELETE FROM clm.tenant_membership WHERE tenant_id = $1',
      [TENANT],
    );
    await client.query('DELETE FROM clm."user" WHERE tenant_id = $1', [
      TENANT,
    ]);
    await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [
      TENANT,
    ]);
    await client.query('COMMIT');

    await migratieClient.end();
    await client.end();
  }, 30000);

  it('geeft een lege featurelijst voor een verse tenant', async () => {
    const antwoord = await request(server)
      .get(`/platform/tenants/${TENANT}/features`)
      .set('Cookie', cookieBeheerder)
      .expect(200);

    expect((antwoord.body as FeaturesAntwoord).features).toEqual([]);
  });

  it('zet een feature aan en toont die daarna in de lijst', async () => {
    await request(server)
      .put(`/platform/tenants/${TENANT}/features/contractmodule`)
      .set('Cookie', cookieBeheerder)
      .send({ enabled: true })
      .expect(200);

    const antwoord = await request(server)
      .get(`/platform/tenants/${TENANT}/features`)
      .set('Cookie', cookieBeheerder)
      .expect(200);

    expect((antwoord.body as FeaturesAntwoord).features).toEqual([
      'contractmodule',
    ]);
  });

  it('zet een feature weer uit', async () => {
    await request(server)
      .put(`/platform/tenants/${TENANT}/features/contractmodule`)
      .set('Cookie', cookieBeheerder)
      .send({ enabled: false })
      .expect(200);

    const antwoord = await request(server)
      .get(`/platform/tenants/${TENANT}/features`)
      .set('Cookie', cookieBeheerder)
      .expect(200);

    expect((antwoord.body as FeaturesAntwoord).features).toEqual([]);
  });

  it('legt het schakelen vast in de audit trail', async () => {
    await request(server)
      .put(`/platform/tenants/${TENANT}/features/contractmodule`)
      .set('Cookie', cookieBeheerder)
      .send({ enabled: true })
      .expect(200);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
    const { rows } = await client.query<{
      new_values: { featureKey: string; enabled: boolean };
    }>(
      `SELECT new_values FROM audit.audit_event
        WHERE tenant_id = $1 AND action_type = 'tenant_feature_gewijzigd'
        ORDER BY created_at DESC LIMIT 1`,
      [TENANT],
    );
    await client.query('COMMIT');

    expect(rows).toHaveLength(1);
    expect(rows[0].new_values.featureKey).toBe('contractmodule');
    expect(rows[0].new_values.enabled).toBe(true);
  });

  it('weigert een onbekende featureKey met 400', async () => {
    await request(server)
      .put(`/platform/tenants/${TENANT}/features/onbestaande-feature`)
      .set('Cookie', cookieBeheerder)
      .send({ enabled: true })
      .expect(400);
  });

  it('weigert een niet-boolean enabled-waarde met 400', async () => {
    await request(server)
      .put(`/platform/tenants/${TENANT}/features/contractmodule`)
      .set('Cookie', cookieBeheerder)
      .send({ enabled: 'ja' })
      .expect(400);
  });

  it('geeft 404 op een onbekende tenant', async () => {
    await request(server)
      .get('/platform/tenants/00000000-0000-0000-0000-0000000000ff/features')
      .set('Cookie', cookieBeheerder)
      .expect(404);
  });

  // ── De deur ────────────────────────────────────────────────────────────

  it('weigert lezen zonder sessie met 401', async () => {
    await request(server)
      .get(`/platform/tenants/${TENANT}/features`)
      .expect(401);
  });

  it('weigert schakelen voor een gewone tenant-admin met 403', async () => {
    // De belangrijkste test van deze suite: een geldige sessie, een echte
    // admin binnen zijn eigen tenant — maar geen platformbeheerder. Zonder
    // deze grens zou elke klantbeheerder zelf een niet-gekochte feature
    // kunnen aanzetten voor zijn eigen tenant.
    const antwoord = await request(server)
      .put(`/platform/tenants/${TENANT}/features/contractmodule`)
      .set('Cookie', cookieKlantAdmin)
      .send({ enabled: true })
      .expect(403);

    expect(JSON.stringify(antwoord.body)).toContain('platformbeheer');
  });

  it('weigert lezen voor een gewone tenant-admin met 403', async () => {
    await request(server)
      .get(`/platform/tenants/${TENANT}/features`)
      .set('Cookie', cookieKlantAdmin)
      .expect(403);
  });
});
```

- [ ] **Stap 3: Run de test, verwacht een fout**

Run: `npx jest test/tenant-feature-routes.e2e-spec.ts -i`
Expected: FAIL — de routes bestaan nog niet als Taak 5 nog niet gedaan is,
of PASS als Taak 5 al voltooid is (dit plan voert taken in volgorde uit,
dus normaliter is Taak 5 al klaar en slaagt deze suite meteen — controleer
in dat geval dat elke test echt uitgevoerd wordt, niet overgeslagen).

- [ ] **Stap 4: Los eventuele fouten op, run opnieuw tot alles slaagt**

Run: `npx jest test/tenant-feature-routes.e2e-spec.ts -i`
Expected: PASS, 10 tests.

- [ ] **Stap 5: Bewaak dat de nieuwe test-ids uniek zijn**

Run: `npx jest test-ids`
Expected: PASS.

- [ ] **Stap 6: Commit**

```bash
git add test/test-ids.ts test/tenant-feature-routes.e2e-spec.ts
git commit -m "test(features): e2e-dekking voor de tenant-feature-platformroutes"
```

---

### Taak 7: `GET /auth/sessie` uitbreiden met `features`

**Files:**
- Modify: `src/auth/auth.controller.ts`
- Modify: `src/auth/auth.module.ts`
- Modify: `test/sessie-route.e2e-spec.ts`

- [ ] **Stap 1: Update de bestaande sessie-test naar de nieuwe vorm (rood zetten)**

Open `test/sessie-route.e2e-spec.ts`. Werk de `SessieBody`-interface bij:

```ts
interface SessieBody {
  naam: string;
  tenantNaam: string;
  rol: string;
  isPlatformbeheerder: boolean;
  features: string[];
}
```

Werk de test `'geeft de naam, tenantnaam, rol en platformbeheerstatus bij
een geldige sessie'` bij:

```ts
  it('geeft de naam, tenantnaam, rol, platformbeheerstatus en features bij een geldige sessie', async () => {
    const antwoord = await request(server)
      .get('/auth/sessie')
      .set('Cookie', `${cookieNaam}=${token}`)
      .expect(200);

    expect(antwoord.body).toEqual({
      naam: VOLLEDIGE_NAAM,
      tenantNaam: TENANT_NAAM,
      rol: 'admin',
      isPlatformbeheerder: false,
      features: [],
    });
  });
```

Werk de test `'stuurt geen tenantId, userId of sessieId mee'` bij — het
veldenoverzicht moet `features` bevatten:

```ts
    expect(Object.keys(body).sort()).toEqual([
      'features',
      'isPlatformbeheerder',
      'naam',
      'rol',
      'tenantNaam',
    ]);
```

- [ ] **Stap 2: Run de test, bevestig dat hij nu faalt**

Run: `npx jest test/sessie-route.e2e-spec.ts -i`
Expected: FAIL — het antwoord van de route bevat nog geen `features`-veld.

- [ ] **Stap 3: Importeer `FeatureModule` in `AuthModule`**

Open `src/auth/auth.module.ts`, voeg `FeatureModule` toe aan `imports`.

- [ ] **Stap 4: Voeg `features` toe aan `GET /auth/sessie`**

Open `src/auth/auth.controller.ts`. Voeg de import toe:

```ts
import { TenantFeatureService } from '../features/tenant-feature.service';
```

Voeg `TenantFeatureService` toe aan de constructor van `AuthController`
(zoek de bestaande constructor, injecteer ernaast — volg het patroon van
de al bestaande `DatabaseService`-injectie in dit bestand).

In `huidigeSessie()`, na de `isPlatformbeheerder`-oproep, voeg toe:

```ts
    const features = await this.tenantFeatures.lijst(sessie.tenantId);
```

En breid het return-object uit:

```ts
    return {
      naam: profiel.naam,
      tenantNaam: profiel.tenantNaam,
      rol: sessie.role,
      isPlatformbeheerder: isBeheerder,
      features,
    };
```

(Constructorparameter heet `tenantFeatures` om niet te botsen met de
`features`-lokale variabele — pas de exacte naam aan het patroon van de
bestaande constructor-parameters in dit bestand aan.)

- [ ] **Stap 5: Compileer**

Run: `npx tsc --noEmit`
Expected: geen fouten.

- [ ] **Stap 6: Run de sessie-test opnieuw, verwacht succes**

Run: `npx jest test/sessie-route.e2e-spec.ts -i`
Expected: PASS, alle tests (inclusief de twee bijgewerkte).

- [ ] **Stap 7: Voeg een gerichte test toe: features komen door naar de sessie**

Voeg toe aan `test/sessie-route.e2e-spec.ts`, na de bestaande
`isPlatformbeheerder`-test:

```ts
  it('toont een aangezette feature in de sessie', async () => {
    const migratieUrlWaarde = migratieUrl();
    const migratie = new Client({ connectionString: migratieUrlWaarde });
    await migratie.connect();

    try {
      await migratie.query(
        `INSERT INTO clm.tenant_feature (tenant_id, feature_key, enabled, updated_by)
         VALUES ($1, 'contractmodule', true, $2)`,
        [TENANT, USER],
      );

      const antwoord = await request(server)
        .get('/auth/sessie')
        .set('Cookie', `${cookieNaam}=${token}`)
        .expect(200);

      const body = antwoord.body as SessieBody;
      expect(body.features).toEqual(['contractmodule']);
    } finally {
      await migratie.query(
        'DELETE FROM clm.tenant_feature WHERE tenant_id = $1',
        [TENANT],
      );
      await migratie.end();
    }
  });
```

- [ ] **Stap 8: Run de volledige suite, verwacht succes**

Run: `npx jest test/sessie-route.e2e-spec.ts -i`
Expected: PASS, alle tests.

- [ ] **Stap 9: Commit**

```bash
git add src/auth/auth.controller.ts src/auth/auth.module.ts test/sessie-route.e2e-spec.ts
git commit -m "feat(features): GET /auth/sessie toont actieve tenant-features"
```

---

### Taak 8: Volledige verificatie

**Files:** geen wijzigingen — alleen draaien en controleren.

- [ ] **Stap 1: Bekijk `package.json` voor het echte verify-commando**

Run: `(Get-Content package.json | ConvertFrom-Json).scripts` (PowerShell)
of `node -e "console.log(Object.keys(require('./package.json').scripts))"`.

Gebruik het commando dat je daar aantreft — geen commando verzinnen
(CLAUDE.md §2). Waarschijnlijk `npm run verify:volledig`, maar bevestig dit
uit de daadwerkelijke `package.json` van dit moment.

- [ ] **Stap 2: Draai het volledige verify-commando**

Run: het commando uit Stap 1.
Expected: alle stappen (lint, typecheck, unit, e2e) slagen. Los elke
faling op vóórdat je verder gaat — een gedeeltelijk groene run bewijst
niets (CLAUDE.md "Groen is alleen groen via verify").

- [ ] **Stap 3: Draai expliciet de volledige e2e-run nogmaals in isolatie**

Run: `npx jest --config test/jest-e2e.json -i` (of het equivalent — check
de exacte testrunner-config-naam in `package.json`/`test/`).
Expected: alle suites slagen, inclusief de nieuwe en de aangepaste. Dit
bevestigt dat de nieuwe suite (Taak 6) geen andere, langer bestaande suite
laat omvallen door de gedeelde database (CLAUDE.md §5 over e2e-suites).

- [ ] **Stap 4: Handmatige steekproef op een wegwerpdatabase**

Bevestig met een directe query dat de contractmodule na de migratie nog
steeds actief staat voor een handmatig aangemaakte testtenant (niet alleen
via de teststubs):

```sql
SELECT feature_key, enabled FROM clm.tenant_feature;
```

Expected: minstens de rijen die de e2e-suites hebben aangemaakt en
opgeruimd — een lege tabel na een volledige testrun is normaal (afterAll
ruimt op), geen fout.

---

## Wat dit plan niet bouwt

Zoals vastgelegd in spec §8: geen backend-blokkade op de contractroutes
zelf, geen tenant-admin-schakellaag, geen pakket-/prijslogica, geen
frontend-UI (aparte taak in de MCM2-frontend-repo — meld dit expliciet
als frontend-consequentie zodra dit plan wordt uitgevoerd, conform
CLAUDE.md §0b over de gekoppelde frontend-repo).
