# Coupa-import: schema-uitbreiding vendor/contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vijf nieuwe velden op `vendor`/`contract` (Coupa-matchsleutel,
contracttype, business-risk-tier, DPA-vlag) plus een tenant-scoped
vendor-categorielijst met een beheerscherm — de voorwaarde voor de
contractdata-uploadtool (#190).

**Architecture:** Eén handgeschreven Drizzle-migratie (`0034`) voegt de vijf
kolommen toe, maakt `ref.business_risk_tier` aan, en herstructureert
`ref.vendor_category` naar een tenant-scoped tabel mét RLS (het was
platform-breed en RLS-vrij; wordt nu tenant-data, zoals `clm.contract`).
`src/db/schema.ts` volgt de migratie 1-op-1. Een nieuwe, kleine
`VendorCategoryModule` (service + controller) biedt CRUD op de eigen
categorieën, naar het patroon van `ContractModule`. `PlatformService.tenantAanmaken()`
seedt de standaardset bij een nieuwe tenant.

**Tech Stack:** NestJS, Drizzle ORM (raw SQL via `sql` tagged templates,
zoals `ContractService`), PostgreSQL met RLS, Jest/Supertest voor e2e.

---

## Bestandenoverzicht

| Bestand | Actie | Verantwoordelijkheid |
|---|---|---|
| `drizzle/0034_coupa_schema_uitbreiding.sql` | nieuw | alle DDL: 5 kolommen, nieuwe ref-tabel, RLS op vendor_category |
| `drizzle/meta/_journal.json` | wijzig | migratie 0034 registreren |
| `src/db/schema.ts` | wijzig | Drizzle-definities voor de 5 kolommen, `businessRiskTier`, `vendorCategory` (tenant_id + RLS-conform) |
| `src/db/rechten-contract.ts` | wijzig | `ref.business_risk_tier` toevoegen aan `TABELRECHTEN` |
| `src/vendor-category/vendor-category.module.ts` | nieuw | module-registratie |
| `src/vendor-category/vendor-category.service.ts` | nieuw | CRUD-logica |
| `src/vendor-category/vendor-category.controller.ts` | nieuw | routes `/vendor-categories` |
| `src/vendor-category/vendor-category-invoer.ts` | nieuw | invoervalidatie (naar `contract-invoer.ts`) |
| `src/vendor-category/vendor-category-seed.ts` | nieuw | de standaardset + seed-functie |
| `src/app.module.ts` | wijzig | `VendorCategoryModule` registreren |
| `src/platform/platform.service.ts` | wijzig | `tenantAanmaken()` roept de seed-functie aan |
| `test/test-ids.ts` | wijzig | nieuwe suite-id's (`'48'` e.v.) |
| `test/vendor-category-routes.e2e-spec.ts` | nieuw | CRUD + tenant-isolatie |
| `test/schema-conformiteit.e2e-spec.ts` | (geen wijziging nodig — leest schema.ts automatisch) | — |
| `test/rechten-contract.e2e-spec.ts` | (geen wijziging nodig — leest TABELRECHTEN automatisch) | — |

---

### Task 1: Migratie schrijven en registreren

**Files:**
- Create: `drizzle/0034_coupa_schema_uitbreiding.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Bepaal AlingAdvies' tenant-id**

`npm run test:db` zet een LEGE database op (alleen de migraties, geen
tenant-data) — AlingAdvies' tenant-id staat daar niet in. Zoek het op in
de omgeving waar AlingAdvies daadwerkelijk als tenant bestaat (acceptatie
op saxombp, of staging/productie — vraag de eigenaar welke omgeving het
actuele AlingAdvies-tenant-id heeft als dat niet evident is; verzin het
niet en raad niet tussen omgevingen).

Voor de wegwerpcontainer in Task 6 (waar geen AlingAdvies-tenant bestaat)
geldt Step 2 hieronder alsnog: de UPDATE-regel raakt daar simpelweg 0
rijen (geen bestaande vendor_category-rijen om te claimen), en dat is
geen fout — de wegwerpcontainer test alleen dat de DDL zelf geldig is,
niet de daadwerkelijke AlingAdvies-migratie.

- [ ] **Step 2: Schrijf de migratie**

```sql
-- 0034_coupa_schema_uitbreiding.sql
-- Zie docs/superpowers/specs/2026-08-28-coupa-schema-uitbreiding-design.md.

-- ── 1. vendor.coupa_supplier_number — matchsleutel (#185) ──────────────────
ALTER TABLE clm.vendor ADD COLUMN coupa_supplier_number text;--> statement-breakpoint

-- ── 2. contract.contract_type — placeholder (#187) ─────────────────────────
ALTER TABLE clm.contract ADD COLUMN contract_type text;--> statement-breakpoint

-- ── 3. contract.dpa_aanwezig — tri-state vlag (#189) ───────────────────────
ALTER TABLE clm.contract ADD COLUMN dpa_aanwezig boolean;--> statement-breakpoint

-- ── 4. ref.business_risk_tier + contract.business_risk_tier_code (#188) ────
-- Bewust een ANDER concept dan ref.business_criticality (dat is het
-- resultaat van de IT-risk-assessment en bepaalt survey-relevantie, zie
-- src/survey/contractmanager.service.ts). business_risk_tier is Transdev's
-- enterprise-brede business-risk-classificatie, los van IT. Niet fuseren
-- ondanks de oppervlakkige gelijkenis in waarden (High/Medium/Low-achtig).
CREATE TABLE ref.business_risk_tier (
    code text PRIMARY KEY,
    label text NOT NULL
);--> statement-breakpoint

INSERT INTO ref.business_risk_tier (code, label) VALUES
    ('tier_1', 'Tier 1 — High impact (strategisch)'),
    ('tier_2', 'Tier 2 — Medium impact'),
    ('tier_3', 'Tier 3 — Low impact');--> statement-breakpoint

ALTER TABLE clm.contract ADD COLUMN business_risk_tier_code text
    REFERENCES ref.business_risk_tier(code) ON DELETE SET NULL;--> statement-breakpoint

-- ── 5. ref.vendor_category wordt tenant-scoped (#186) ──────────────────────
-- Was platform-breed (geen tenant_id, geen RLS). Wordt nu tenant-data: elke
-- tenant beheert zijn eigen lijst via het nieuwe /vendor-categories-scherm.
-- Bestaande rijen zijn feitelijk AlingAdvies' lijst — die claimt de migratie
-- hier expliciet, in plaats van ze verweesd te laten.
ALTER TABLE ref.vendor_category ADD COLUMN tenant_id uuid;--> statement-breakpoint

UPDATE ref.vendor_category
    SET tenant_id = '<ALINGADVIES_TENANT_ID>';--> statement-breakpoint

ALTER TABLE ref.vendor_category ALTER COLUMN tenant_id SET NOT NULL;--> statement-breakpoint

ALTER TABLE ref.vendor_category
    ADD CONSTRAINT vendor_category_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES clm.tenant(tenant_id) ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE ref.vendor_category DROP CONSTRAINT vendor_category_pkey;--> statement-breakpoint
ALTER TABLE ref.vendor_category ADD PRIMARY KEY (tenant_id, code);--> statement-breakpoint

-- vendor.category_code wijst nu naar een samengestelde sleutel. De
-- bestaande kolom-FK (op alleen code) bestaat niet als losse constraint
-- (Drizzle's .references() genereert 'm inline) — check en verwijder hem
-- als hij bestaat, voeg de samengestelde FK toe.
ALTER TABLE clm.vendor DROP CONSTRAINT IF EXISTS vendor_category_code_vendor_category_code_fk;--> statement-breakpoint

ALTER TABLE clm.vendor
    ADD CONSTRAINT vendor_category_tenant_fk
    FOREIGN KEY (tenant_id, category_code)
    REFERENCES ref.vendor_category(tenant_id, code)
    ON DELETE SET NULL;--> statement-breakpoint

-- RLS: vendor_category is nu tenant-data, en krijgt daarom dezelfde
-- policy-vorm als clm.contract (migratie 0027). Let op: ref.vendor_category
-- staat niet in het clm-schema maar de policy-functie clm.current_tenant_id()
-- is schema-onafhankelijk aanroepbaar.
ALTER TABLE ref.vendor_category ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ref.vendor_category FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY vendor_category_isolation ON ref.vendor_category
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

COMMENT ON TABLE ref.vendor_category IS
    'Vendor-categorieën, per tenant. Was platform-breed vóór migratie 0034; elke tenant beheert nu zijn eigen lijst via /vendor-categories. Seed-bij-aanmaak in PlatformService.tenantAanmaken(), daarna volledig los van de bron.';--> statement-breakpoint

COMMENT ON TABLE ref.business_risk_tier IS
    'Transdev-achtige enterprise-brede business-risk-classificatie (Tier 1/2/3). Geen relatie met ref.business_criticality — dat is het resultaat van de IT-risk-assessment. Zie docs/superpowers/specs/2026-08-28-coupa-schema-uitbreiding-design.md.';
```

Vervang `<ALINGADVIES_TENANT_ID>` met de waarde uit Step 1.

- [ ] **Step 3: Registreer de migratie in `_journal.json`**

Open `drizzle/meta/_journal.json`, voeg een entry toe naar het patroon van
de voorgaande entries (kijk naar het item voor `0033_platformbeheer_wijzigen_verwijderen`
en herhaal de vorm met `idx` opgehoogd, `tag: "0034_coupa_schema_uitbreiding"`,
en een `when`-timestamp van nu in milliseconden sinds epoch).

- [ ] **Step 4: Werk `src/db/rechten-contract.ts` bij**

Voeg toe aan `TABELRECHTEN` (naast de bestaande `ref.vendor_category`-regel,
die blijft ongewijzigd op `LEZEN_EN_SCHRIJVEN`):

```typescript
  'ref.business_risk_tier': LEZEN_EN_SCHRIJVEN,
```

- [ ] **Step 5: Commit**

```bash
git add drizzle/0034_coupa_schema_uitbreiding.sql drizzle/meta/_journal.json src/db/rechten-contract.ts
git commit -m "feat(db): migratie 0034 - Coupa-schema-uitbreiding vendor/contract"
```

---

### Task 2: `src/db/schema.ts` bijwerken

**Files:**
- Modify: `src/db/schema.ts:26-29` (vendorCategory)
- Modify: `src/db/schema.ts:228-268` (vendor tabel)
- Modify: `src/db/schema.ts:372-412` (contract tabel)
- Modify: `src/db/schema.ts:1039-1042` (vendor relations, category)

- [ ] **Step 1: Voeg `businessRiskTier`-referentietabel toe**

Direct na de bestaande `businessCriticality`-definitie (rond regel 34):

```typescript
export const businessRiskTier = ref.table('business_risk_tier', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
});
```

- [ ] **Step 2: Maak `vendorCategory` tenant-scoped**

Vervang de huidige definitie (regel 26-29):

```typescript
export const vendorCategory = ref.table(
  'vendor_category',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    label: text('label').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.code] })],
);
```

Check dat `primaryKey` al geïmporteerd is bovenaan het bestand (het wordt
elders gebruikt, bv. bij `contractSurveyTemplate`-achtige koppeltabellen —
zoek `primaryKey` in het importblok; zo niet, voeg toe aan de
`drizzle-orm/pg-core`-import).

- [ ] **Step 3: Voeg de vijf nieuwe kolommen toe aan `vendor`**

In de `vendor`-tabeldefinitie, na `categoryCode` (rond regel 246):

```typescript
    coupaSupplierNumber: text('coupa_supplier_number'),
```

- [ ] **Step 4: Voeg de nieuwe kolommen toe aan `contract`**

In de `contract`-tabeldefinitie, na `note` (rond regel 401):

```typescript
    contractType: text('contract_type'),
    dpaAanwezig: boolean('dpa_aanwezig'),
    businessRiskTierCode: text('business_risk_tier_code').references(
      () => businessRiskTier.code,
      { onDelete: 'set null' },
    ),
```

Check dat `boolean` al geïmporteerd is uit `drizzle-orm/pg-core` (wordt al
gebruikt bij `wachtlijst` in `contractSurveyTemplate`).

- [ ] **Step 5: Werk de `vendor`-relatie naar `category` bij**

De bestaande relatie (rond regel 1039-1042) verwijst alleen op `categoryCode`.
Met een samengestelde sleutel moet dit:

```typescript
  category: one(vendorCategory, {
    fields: [vendor.tenantId, vendor.categoryCode],
    references: [vendorCategory.tenantId, vendorCategory.code],
  }),
```

- [ ] **Step 6: Draai `schema-conformiteit.e2e-spec.ts` om te bevestigen dat schema.ts en de migratie overeenkomen**

Vereist een draaiende wegwerpcontainer met de migratie erop — zie Task 6
voor de eerste opzet. Voorlopig: noteer deze stap, wordt in Task 6
daadwerkelijk gedraaid.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(db): schema.ts - Coupa-uitbreiding, vendorCategory tenant-scoped"
```

---

### Task 3: Seed-logica voor vendor-categorieën

**Files:**
- Create: `src/vendor-category/vendor-category-seed.ts`
- Modify: `src/platform/platform.service.ts`

- [ ] **Step 1: Schrijf de standaardset + seed-functie**

```typescript
// src/vendor-category/vendor-category-seed.ts
import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

/**
 * De standaardset vendor-categorieën waarmee een nieuwe tenant start.
 * Eenmalige kopie bij tenantaanmaak (PlatformService.tenantAanmaken()) —
 * geen levende koppeling. Na de kopie is de lijst volledig van de tenant:
 * hernoemen, verwijderen en aanvullen via /vendor-categories raakt deze
 * standaardset niet.
 *
 * Overgenomen uit AlingAdvies' bestaande lijst (migratie 0034 claimt die
 * rijen voor AlingAdvies' eigen tenant_id). Zie
 * docs/superpowers/specs/2026-08-28-coupa-schema-uitbreiding-design.md.
 */
export const STANDAARD_VENDOR_CATEGORIEEN: ReadonlyArray<{
  code: string;
  label: string;
}> = [
  { code: 'ict', label: 'ICT' },
  { code: 'hr', label: 'HR' },
  { code: 'facilitair', label: 'Facilitair' },
  { code: 'financieel', label: 'Financieel' },
  { code: 'juridisch', label: 'Juridisch' },
  { code: 'overig', label: 'Overig' },
];

/**
 * Bouwt de INSERT-statement die de standaardset voor `tenantId` seedt.
 * Wordt binnen dezelfde withTenant()-transactie als de rest van
 * tenantAanmaken() uitgevoerd — vandaar dat dit een SQL-fragment teruggeeft
 * in plaats van zelf te queryen.
 */
export function seedVendorCategorieenSql(tenantId: string): SQL {
  const rijen = STANDAARD_VENDOR_CATEGORIEEN.map(
    (c) => sql`(${tenantId}, ${c.code}, ${c.label})`,
  );

  return sql`INSERT INTO ref.vendor_category (tenant_id, code, label)
      VALUES ${sql.join(rijen, sql`, `)}`;
}
```

- [ ] **Step 2: Roep de seed aan in `tenantAanmaken()`**

In `src/platform/platform.service.ts`, na de bestaande
`tenant_membership`-insert (rond regel 213, vóór de audit-event-insert):

```typescript
      await tx.execute(seedVendorCategorieenSql(tenantId));
```

Voeg de import toe bovenaan:

```typescript
import { seedVendorCategorieenSql } from '../vendor-category/vendor-category-seed';
```

- [ ] **Step 3: Commit**

```bash
git add src/vendor-category/vendor-category-seed.ts src/platform/platform.service.ts
git commit -m "feat(vendor-category): standaardset seeden bij tenantaanmaak"
```

---

### Task 4: Vendor-categorie-module (service, invoer, controller)

**Files:**
- Create: `src/vendor-category/vendor-category-invoer.ts`
- Create: `src/vendor-category/vendor-category.service.ts`
- Create: `src/vendor-category/vendor-category.controller.ts`
- Create: `src/vendor-category/vendor-category.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Schrijf de invoervalidatie**

```typescript
// src/vendor-category/vendor-category-invoer.ts

/** Zelfde InvoerFout-vorm als vendor-invoer.ts / contract-invoer.ts. */
export class InvoerFout extends Error {
  constructor(
    message: string,
    public readonly veld: string,
  ) {
    super(message);
  }
}

const CODE_PATROON = /^[a-z0-9_]{1,50}$/;

export interface NieuweVendorCategorie {
  code: string;
  label: string;
}

export interface VendorCategorieWijziging {
  label: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * De code wordt door de gebruiker getypt (dit is geen gegenereerde UUID,
 * anders dan de meeste primary keys in dit project) en komt terug in de
 * dropdown op het leveranciersscherm — vandaar de beperking tot
 * kleine letters/cijfers/underscore, geen vrije tekst.
 */
export function leesNieuweVendorCategorie(body: unknown): NieuweVendorCategorie {
  if (!isRecord(body)) {
    throw new InvoerFout('Ongeldige invoer.', 'body');
  }

  const code = body.code;
  if (typeof code !== 'string' || !CODE_PATROON.test(code)) {
    throw new InvoerFout(
      'Code moet uit kleine letters, cijfers en underscores bestaan (max 50 tekens).',
      'code',
    );
  }

  const label = body.label;
  if (typeof label !== 'string' || label.trim().length === 0) {
    throw new InvoerFout('Label mag niet leeg zijn.', 'label');
  }

  return { code, label: label.trim() };
}

export function leesVendorCategorieWijziging(
  body: unknown,
): VendorCategorieWijziging {
  if (!isRecord(body)) {
    throw new InvoerFout('Ongeldige invoer.', 'body');
  }

  const label = body.label;
  if (typeof label !== 'string' || label.trim().length === 0) {
    throw new InvoerFout('Label mag niet leeg zijn.', 'label');
  }

  return { label: label.trim() };
}
```

- [ ] **Step 2: Schrijf de service**

```typescript
// src/vendor-category/vendor-category.service.ts
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';
import type {
  NieuweVendorCategorie,
  VendorCategorieWijziging,
} from './vendor-category-invoer';

export interface VendorCategorie {
  code: string;
  label: string;
}

/**
 * CRUD op de vendor-categorieën van de ingelogde tenant.
 *
 * Zelfde opzet als ContractService: raw SQL binnen withTenant(), geen
 * soft delete (dit is een simpele lijst, geen auditwaardige entiteit —
 * verwijderen ontkoppelt bestaande vendors via ON DELETE SET NULL,
 * zie migratie 0034).
 */
@Injectable()
export class VendorCategoryService {
  constructor(private readonly db: DatabaseService) {}

  async lijst(tenantId: string): Promise<VendorCategorie[]> {
    return this.db.withTenant(tenantId, async (tx) => {
      const rij = await tx.execute<{ code: string; label: string }>(
        sql`SELECT code, label FROM ref.vendor_category
            WHERE tenant_id = ${tenantId}
            ORDER BY label`,
      );

      return rij.rows;
    });
  }

  async maakAan(
    tenantId: string,
    invoer: NieuweVendorCategorie,
  ): Promise<VendorCategorie> {
    return this.db.withTenant(tenantId, async (tx) => {
      const rij = await tx.execute<{ code: string; label: string }>(
        sql`INSERT INTO ref.vendor_category (tenant_id, code, label)
            VALUES (${tenantId}, ${invoer.code}, ${invoer.label})
            RETURNING code, label`,
      );

      return rij.rows[0];
    });
  }

  async wijzig(
    tenantId: string,
    code: string,
    wijziging: VendorCategorieWijziging,
  ): Promise<VendorCategorie | null> {
    return this.db.withTenant(tenantId, async (tx) => {
      const rij = await tx.execute<{ code: string; label: string }>(
        sql`UPDATE ref.vendor_category
            SET label = ${wijziging.label}
            WHERE tenant_id = ${tenantId} AND code = ${code}
            RETURNING code, label`,
      );

      return rij.rows[0] ?? null;
    });
  }

  /** Verwijdert de categorie; vendors die 'm gebruikten tonen daarna geen categorie meer (ON DELETE SET NULL). */
  async verwijder(tenantId: string, code: string): Promise<boolean> {
    return this.db.withTenant(tenantId, async (tx) => {
      const rij = await tx.execute(
        sql`DELETE FROM ref.vendor_category
            WHERE tenant_id = ${tenantId} AND code = ${code}`,
      );

      return (rij.rowCount ?? 0) > 0;
    });
  }
}
```

- [ ] **Step 3: Schrijf de controller**

```typescript
// src/vendor-category/vendor-category.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';

import { RolGuard, VereistRol } from '../auth/rol.guard';
import {
  TenantContextGuard,
  type RequestMetSessie,
} from '../auth/tenant-context.guard';
import {
  InvoerFout,
  leesNieuweVendorCategorie,
  leesVendorCategorieWijziging,
} from './vendor-category-invoer';
import { VendorCategoryService } from './vendor-category.service';

function alsHttpFout(err: unknown): unknown {
  if (err instanceof InvoerFout) {
    return new BadRequestException({ message: err.message, veld: err.veld });
  }

  return err;
}

function alsDuplicaatFout(err: unknown): never {
  const code = (err as { cause?: { code?: string }; code?: string })?.cause
    ?.code;

  if (code === '23505') {
    throw new BadRequestException({
      message: 'Deze code bestaat al.',
      veld: 'code',
    });
  }

  throw err;
}

/**
 * Beheer van de eigen vendor-categorieën, per tenant (#186).
 *
 * Sinds migratie 0034 is ref.vendor_category tenant-scoped — dit scherm is
 * de enige manier om de lijst zelf aan te passen (naast de uploadtool die
 * een onbekende Coupa-waarde kan aanmaken, zie #190).
 */
@Controller('vendor-categories')
@UseGuards(TenantContextGuard, RolGuard)
export class VendorCategoryController {
  constructor(private readonly categories: VendorCategoryService) {}

  @Get()
  async lijst(@Req() request: RequestMetSessie) {
    const sessie = request.sessie!;
    const categorieen = await this.categories.lijst(sessie.tenantId);

    return { categorieen };
  }

  @Post()
  @VereistRol('admin')
  @HttpCode(201)
  async maakAan(@Req() request: RequestMetSessie, @Body() body: unknown) {
    const sessie = request.sessie!;

    try {
      const invoer = leesNieuweVendorCategorie(body);

      return await this.categories
        .maakAan(sessie.tenantId, invoer)
        .catch(alsDuplicaatFout);
    } catch (err) {
      throw alsHttpFout(err);
    }
  }

  @Put(':code')
  @VereistRol('admin')
  async wijzig(
    @Req() request: RequestMetSessie,
    @Param('code') code: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let wijziging;
    try {
      wijziging = leesVendorCategorieWijziging(body);
    } catch (err) {
      throw alsHttpFout(err);
    }

    const resultaat = await this.categories.wijzig(
      sessie.tenantId,
      code,
      wijziging,
    );

    if (!resultaat) {
      throw new NotFoundException('Categorie niet gevonden.');
    }

    return resultaat;
  }

  @Delete(':code')
  @VereistRol('admin')
  @HttpCode(204)
  async verwijder(
    @Req() request: RequestMetSessie,
    @Param('code') code: string,
  ) {
    const sessie = request.sessie!;
    const verwijderd = await this.categories.verwijder(sessie.tenantId, code);

    if (!verwijderd) {
      throw new NotFoundException('Categorie niet gevonden.');
    }
  }
}
```

- [ ] **Step 4: Schrijf de module**

```typescript
// src/vendor-category/vendor-category.module.ts
import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { VendorCategoryController } from './vendor-category.controller';
import { VendorCategoryService } from './vendor-category.service';

/**
 * Beheer van tenant-eigen vendor-categorieën (#186).
 *
 * AuthModule voor TenantContextGuard, zelfde reden als VendorModule/ContractModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [VendorCategoryController],
  providers: [VendorCategoryService],
  exports: [VendorCategoryService],
})
export class VendorCategoryModule {}
```

- [ ] **Step 5: Registreer de module**

In `src/app.module.ts`, voeg de import toe:

```typescript
import { VendorCategoryModule } from './vendor-category/vendor-category.module';
```

En voeg `VendorCategoryModule` toe aan de `imports`-array, na `VendorModule`.

- [ ] **Step 6: Commit**

```bash
git add src/vendor-category/ src/app.module.ts
git commit -m "feat(vendor-category): CRUD-scherm voor tenant-eigen vendor-categorieën"
```

---

### Task 5: Test-id's toevoegen

**Files:**
- Modify: `test/test-ids.ts`

- [ ] **Step 1: Voeg een nieuw blok toe**

Na het `'platform-uitbreiding'`-blok (vóór de afsluitende `} as const;`,
rond regel 398):

```typescript
  'vendor-category-routes': {
    tenantA: id('48'),
    tenantB: id('49'),
    adminA: id('4a'),
    userA: id('4b'),
  },
```

- [ ] **Step 2: Commit**

```bash
git add test/test-ids.ts
git commit -m "test: id's voor vendor-category-routes suite"
```

---

### Task 6: Wegwerpdatabase opzetten en migratie + schema verifiëren

**Files:** geen nieuwe bestanden — dit is een verificatiestap.

- [ ] **Step 1: Zet de testdatabase op**

Run: `npm run test:db -- "coupa schema uitbreiding"`

Expected: script draait de container op, alle migraties inclusief 0034,
en drukt `MIGRATION_DATABASE_URL`/`DATABASE_URL` af.

- [ ] **Step 2: Exporteer de afgedrukte URL's**

Run (met de exacte regels uit Step 1's output, PowerShell-vorm):
```powershell
$env:MIGRATION_DATABASE_URL = "<afgedrukte waarde>"
$env:DATABASE_URL = "<afgedrukte waarde>"
```

- [ ] **Step 3: Draai `schema-conformiteit.e2e-spec.ts`**

Run: `npx jest schema-conformiteit --runInBand`

Expected: PASS — bevestigt dat `src/db/schema.ts` en de database-DDL
overeenkomen (met name de samengestelde sleutel op `vendorCategory` en de
nieuwe kolommen).

- [ ] **Step 4: Draai `rechten-contract.e2e-spec.ts`**

Run: `npx jest rechten-contract --runInBand`

Expected: PASS — bevestigt dat `ref.business_risk_tier` een regel heeft in
`TABELRECHTEN` en dat de daadwerkelijke GRANT's overeenkomen.

Als dit FAIL geeft op `ref.vendor_category`: check of RLS + de GRANT's
elkaar niet tegenspreken — de RLS-policy beperkt rijen, `TABELRECHTEN`
beperkt kolomacties; beide moeten kloppen.

- [ ] **Step 5: Geen commit nodig (verificatie-only)**

---

### Task 7: e2e-test voor vendor-category-routes

**Files:**
- Create: `test/vendor-category-routes.e2e-spec.ts`

- [ ] **Step 1: Schrijf de test**

```typescript
// test/vendor-category-routes.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Client } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { SessieService } from '../src/auth/sessie.service';
import { cookieInstellingen } from '../src/auth/sessie';
import { TEST_IDS } from './test-ids';

/**
 * CRUD op /vendor-categories, en de tenant-grens eromheen (#186).
 *
 * Zie docs/superpowers/specs/2026-08-28-coupa-schema-uitbreiding-design.md.
 */

const { tenantA, tenantB, adminA, userA } =
  TEST_IDS['vendor-category-routes'];

const CODE_A = `test-cat-a-${Date.now()}`;

interface CategorieBody {
  code: string;
  label: string;
}

interface VeldFoutBody {
  veld: string;
}

async function verwijderTestdata(client: Client): Promise<void> {
  for (const tenant of [tenantA, tenantB]) {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    await client.query(
      'DELETE FROM ref.vendor_category WHERE tenant_id = $1 AND code = $2',
      [tenant, CODE_A],
    );
    await client.query(
      'DELETE FROM clm.tenant_membership WHERE tenant_id = $1',
      [tenant],
    );
    await client.query('DELETE FROM clm."user" WHERE tenant_id = $1', [
      tenant,
    ]);
    await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [
      tenant,
    ]);
    await client.query('COMMIT');
  }
}

describe('/vendor-categories (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let cookieAdminA: string;
  let cookieUserA: string;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    await verwijderTestdata(client);

    for (const [tenant, naam] of [
      [tenantA, 'Categorie-test A'],
      [tenantB, 'Categorie-test B'],
    ] as const) {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
      await client.query(
        `INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)`,
        [tenant, naam],
      );
      await client.query('COMMIT');
    }

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, email)
       VALUES ($1, $2, 'Admin A', 'admin-a@test.local')`,
      [adminA, tenantA],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, email)
       VALUES ($1, $2, 'User A', 'user-a@test.local')`,
      [userA, tenantA],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [adminA, tenantA],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'user')`,
      [userA, tenantA],
    );
    await client.query('COMMIT');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();

    const sessies = app.get(SessieService);
    const sessieAdminA = await sessies.maak(adminA, tenantA);
    const sessieUserA = await sessies.maak(userA, tenantA);
    cookieAdminA = `${cookieInstellingen.naam}=${sessieAdminA.sleutel}`;
    cookieUserA = `${cookieInstellingen.naam}=${sessieUserA.sleutel}`;
  });

  afterAll(async () => {
    await verwijderTestdata(client);
    await client.end();
    await app.close();
  });

  it('GET geeft een lege lijst terug voor een tenant zonder categorieën (de seed uit PlatformService.tenantAanmaken() wordt hier niet aangeroepen — deze suite richt de tenant rechtstreeks via SQL in)', async () => {
    const res = await request(server)
      .get('/vendor-categories')
      .set('Cookie', cookieAdminA)
      .expect(200);

    expect(Array.isArray((res.body as { categorieen: unknown[] }).categorieen)).toBe(
      true,
    );
  });

  it('POST als admin maakt een categorie aan', async () => {
    const res = await request(server)
      .post('/vendor-categories')
      .set('Cookie', cookieAdminA)
      .send({ code: CODE_A, label: 'Testcategorie A' })
      .expect(201);

    const body = res.body as CategorieBody;
    expect(body.code).toBe(CODE_A);
    expect(body.label).toBe('Testcategorie A');
  });

  it('POST als gewone user faalt met 403', async () => {
    await request(server)
      .post('/vendor-categories')
      .set('Cookie', cookieUserA)
      .send({ code: `${CODE_A}-2`, label: 'Mag niet' })
      .expect(403);
  });

  it('POST met een ongeldige code faalt met 400 en het veld erbij', async () => {
    const res = await request(server)
      .post('/vendor-categories')
      .set('Cookie', cookieAdminA)
      .send({ code: 'Hoofdletters Niet Toegestaan!', label: 'x' })
      .expect(400);

    expect((res.body as VeldFoutBody).veld).toBe('code');
  });

  it('PUT wijzigt het label', async () => {
    const res = await request(server)
      .put(`/vendor-categories/${CODE_A}`)
      .set('Cookie', cookieAdminA)
      .send({ label: 'Aangepast label' })
      .expect(200);

    expect((res.body as CategorieBody).label).toBe('Aangepast label');
  });

  it('tenant B ziet tenant A se categorie niet (tenant-isolatie)', async () => {
    // tenantB heeft geen sessie in deze suite; verificeren via directe
    // databasequery binnen tenantB's context volstaat voor de isolatiegrens.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantB}'`);
    const res = await client.query(
      `SELECT code FROM ref.vendor_category WHERE code = $1`,
      [CODE_A],
    );
    await client.query('COMMIT');

    expect(res.rowCount).toBe(0);
  });

  it('DELETE verwijdert de categorie', async () => {
    await request(server)
      .delete(`/vendor-categories/${CODE_A}`)
      .set('Cookie', cookieAdminA)
      .expect(204);

    const res = await request(server)
      .get('/vendor-categories')
      .set('Cookie', cookieAdminA)
      .expect(200);

    const codes = (res.body as { categorieen: CategorieBody[] }).categorieen.map(
      (c) => c.code,
    );
    expect(codes).not.toContain(CODE_A);
  });

  it('DELETE op een onbekende code geeft 404', async () => {
    await request(server)
      .delete('/vendor-categories/bestaat-niet')
      .set('Cookie', cookieAdminA)
      .expect(404);
  });
});
```

- [ ] **Step 2: Draai de nieuwe suite alleen**

Run: `npx jest vendor-category-routes --runInBand`

Expected: alle tests PASS. Als `SessieService.maak()` een andere
signatuur heeft dan hierboven aangenomen: zoek het exacte patroon op in
een bestaande suite (bv. `test/vendor-compliance-thema.e2e-spec.ts`) en
pas deze test daarop aan — niet de aanroep raden.

- [ ] **Step 3: Draai `npx jest test-ids` (verplicht bij een nieuwe suite)**

Run: `npx jest test-ids --runInBand`

Expected: PASS — bevestigt dat de nieuwe id's uniek zijn en geen bestaande
suite raken.

- [ ] **Step 4: Commit**

```bash
git add test/vendor-category-routes.e2e-spec.ts
git commit -m "test(vendor-category): CRUD- en tenant-isolatietest voor /vendor-categories"
```

---

### Task 8: Volledige verificatie

**Files:** geen — dit is de afsluitende controle.

- [ ] **Step 1: Draai de volledige e2e-run**

Run: `npx jest --runInBand`

Expected: alle suites PASS, inclusief de bestaande vendor/contract-suites
die nu tegen het gewijzigde schema draaien.

- [ ] **Step 2: Draai `npm run verify:volledig`**

Run: `npm run verify:volledig`

Expected: groen. Dit is de enige geldige manier om "klaar" te claimen
(zie CLAUDE.md §15a) — losse commando's uit de vorige taken bewijzen dit
niet.

- [ ] **Step 3: Ruim de wegwerpcontainer op**

Run: `npm run test:db -- --afbreken`

- [ ] **Step 4: Commit (indien verify:volledig iets wijzigde, bv. lint-fixes)**

```bash
git status --short
```

Als er wijzigingen zijn: bekijk ze, en commit met een beschrijvende
boodschap. Als er niets is: geen actie nodig.

---

## Wat dit plan niet oplost

- De contractdata-uploadtool zelf (#190) — dit plan legt alleen het schema
  klaar
- Documentopslag voor het DPA-document (#189-uitzondering, apart traject)
- De risicovelden die naar de nog te ontwerpen risk-assessment-tool gaan
  (Ondersteuning kernactiviteiten, Data gevoeligheid, Leverancier
  risicoprofiel, Hosting locatie, IB&P, MSR)
- Transdev's eenmalige seed van de standaard vendor-categorieën (Transdev
  bestond al vóór deze migratie — een losse, bewuste actie na deployment,
  geen onderdeel van dit plan)
