# Contractmanagement (basismodule) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een nieuwe `clm.contract`-tabel bouwen (met status-ref-tabel en
survey-templatekoppeling), volledig RLS-beschermd, plus een CRUD-API
(`/vendors/:vendorId/contracts`) zodat een tenant-admin contracten kan
aanmaken, inzien, wijzigen en verwijderen bij een leverancier.

**Architecture:** Eén handgeschreven Drizzle-migratie voegt drie
databaseobjecten toe (`ref.contract_status`, `clm.contract`,
`clm.contract_survey_template`) en legt de FK op het al bestaande
`survey_run.contract_id`. Het Drizzle-schema (`src/db/schema.ts`) wordt
gelijktijdig bijgewerkt zodat `schema-conformiteit.e2e-spec.ts` slaagt. Een
nieuwe `ContractModule` (service + controller + invoer-validatie) volgt
exact het bestaande `VendorModule`-patroon: raw SQL via `DatabaseService.
withTenant()`, handmatige validatie met `InvoerFout`, soft delete.

**Tech Stack:** NestJS, Drizzle (raw SQL via `tx.execute`), PostgreSQL met
RLS, Jest (unit + e2e), TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-22-contractmanagement-design.md`

---

## Voorwaarde vóór Task 1

Deze migratie is handgeschreven, geen `drizzle-kit generate`-output (dat is
kapot, zie Issue #96 / `MCM2-CLAUDE.md`). Elke handgeschreven migratie moet
in `drizzle/meta/_journal.json` staan, anders slaat `migrate:deploy` hem
stilzwijgend over.

De volgende migratie-tag is `0027_contract`. Controleer dit vlak vóór Task 1
begint — als er tussen het schrijven van dit plan en de uitvoering een
andere migratie is bijgekomen, schuift het nummer op:

```bash
ls drizzle/*.sql | tail -3
```

---

## Task 1: Migratie 0027 — `ref.contract_status`, `clm.contract`, `clm.contract_survey_template`

**Files:**
- Create: `drizzle/0027_contract.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- =============================================================================
-- clm.contract — de contractmanagement-basismodule.
--
-- Ontwerp: docs/superpowers/specs/2026-08-22-contractmanagement-design.md
-- Aanleiding: opmerkingen 21-08 punt 2/2a/2c, roadmap-issues #156/#157.
--
-- Lost de belofte van migratie 0007 in: survey_run.contract_id kreeg toen
-- bewust nog geen foreign key, met het commentaar "zodra clm.contract
-- bestaat, is dit één ALTER TABLE erbij". Dat gebeurt hieronder in stap 4.
-- =============================================================================

-- ── 1. ref.contract_status — vaste waardenlijst, zelfde patroon als
-- ref.compliance_status / ref.business_criticality / ref.vendor_category.
--
-- "verlopend" staat hier bewust niet in: dat is een berekende weergavestatus
-- (status = 'actief' AND end_date <= vandaag + 90 dagen), nooit een
-- opgeslagen waarde. Zie spec §2.3 voor de volledige redenering — een
-- opgeslagen "verlopend" zou een achtergrondtaak vereisen die hem bijhoudt,
-- met het risico dat die taak stil achterloopt.

CREATE TABLE ref.contract_status (
    code  text PRIMARY KEY,
    label text NOT NULL
);--> statement-breakpoint

INSERT INTO ref.contract_status (code, label) VALUES
    ('actief', 'Actief'),
    ('verlopen', 'Verlopen'),
    ('opgezegd', 'Opgezegd')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint

-- ref-schema: bewust geen RLS (tenant-agnostische lookup-data), zelfde als
-- de andere ref-tabellen.

-- ── 2. clm.contract ───────────────────────────────────────────────────────
--
-- Patroon: clm.vendor / clm.vendor_contact (0000_baseline_bestaand_schema).
--
-- vendor_contact_id is NULLABLE met applicatie-fallback (niet een
-- database-default): NULL betekent "gebruik de is_primary-contactpersoon
-- van de vendor". Een database-default zou bevriezen op het moment van
-- invoegen; de fallback hoort in de leeslaag. Zie spec §2.1.
--
-- contract_number heeft bewust geen uniekheidseis: het komt uit een extern
-- ERP-systeem dat MCM2 niet controleert.

CREATE TABLE clm.contract (
    contract_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid NOT NULL,
    vendor_id         uuid NOT NULL,
    name              text NOT NULL,
    contract_number   text,
    vendor_contact_id uuid,
    owner_user_id     uuid,
    status_code       text,
    value_eur         numeric(15, 2),
    start_date        date,
    end_date          date,
    note              text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz,
    deleted_at        timestamptz
);--> statement-breakpoint

ALTER TABLE clm.contract
    ADD CONSTRAINT contract_tenant_id_tenant_tenant_id_fk
    FOREIGN KEY (tenant_id) REFERENCES clm.tenant(tenant_id)
    ON DELETE restrict;--> statement-breakpoint

ALTER TABLE clm.contract
    ADD CONSTRAINT contract_vendor_id_vendor_vendor_id_fk
    FOREIGN KEY (vendor_id) REFERENCES clm.vendor(vendor_id)
    ON DELETE cascade;--> statement-breakpoint

ALTER TABLE clm.contract
    ADD CONSTRAINT contract_vendor_contact_id_vendor_contact_contact_id_fk
    FOREIGN KEY (vendor_contact_id) REFERENCES clm.vendor_contact(contact_id)
    ON DELETE set null;--> statement-breakpoint

ALTER TABLE clm.contract
    ADD CONSTRAINT contract_owner_user_id_user_user_id_fk
    FOREIGN KEY (owner_user_id) REFERENCES clm."user"(user_id)
    ON DELETE set null;--> statement-breakpoint

ALTER TABLE clm.contract
    ADD CONSTRAINT contract_status_code_contract_status_code_fk
    FOREIGN KEY (status_code) REFERENCES ref.contract_status(code)
    ON DELETE set null;--> statement-breakpoint

CREATE INDEX contract_tenant_id_idx ON clm.contract USING btree (tenant_id);--> statement-breakpoint
CREATE INDEX contract_vendor_id_idx ON clm.contract USING btree (vendor_id);--> statement-breakpoint

CREATE TRIGGER trg_contract_updated_at
    BEFORE UPDATE ON clm.contract
    FOR EACH ROW EXECUTE FUNCTION clm.set_updated_at();--> statement-breakpoint

ALTER TABLE clm.contract ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.contract FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY contract_isolation ON clm.contract
    USING (tenant_id = clm.current_tenant_id() AND deleted_at IS NULL)
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

COMMENT ON TABLE clm.contract IS
    'Contracten bij een leverancier. vendor_contact_id is nullable: NULL betekent "gebruik de is_primary-contactpersoon van de vendor" (applicatielogica, geen database-default). status_code kent geen "verlopend" — die status is berekend uit end_date, nooit opgeslagen. Zie docs/superpowers/specs/2026-08-22-contractmanagement-design.md.';--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON clm.contract TO clm_api_runtime;--> statement-breakpoint

-- ── 3. clm.contract_survey_template — many-to-many, geen extra kolommen ────
--
-- Welke vragenlijst-templates relevant zijn voor een contract. Geen
-- frequentie- of verplicht/optioneel-veld: dat raakt de nog niet gebouwde
-- rondes/herhaling-feature en is bewust uitgesteld. Zie spec §2.4.

CREATE TABLE clm.contract_survey_template (
    contract_id       uuid NOT NULL,
    survey_template_id uuid NOT NULL,
    tenant_id         uuid NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT contract_survey_template_pkey
        PRIMARY KEY (contract_id, survey_template_id)
);--> statement-breakpoint

ALTER TABLE clm.contract_survey_template
    ADD CONSTRAINT contract_survey_template_contract_id_contract_contract_id_fk
    FOREIGN KEY (contract_id) REFERENCES clm.contract(contract_id)
    ON DELETE cascade;--> statement-breakpoint

ALTER TABLE clm.contract_survey_template
    ADD CONSTRAINT contract_survey_template_survey_template_id_fk
    FOREIGN KEY (survey_template_id) REFERENCES clm.survey_template(template_id)
    ON DELETE cascade;--> statement-breakpoint

CREATE INDEX contract_survey_template_tenant_id_idx
    ON clm.contract_survey_template USING btree (tenant_id);--> statement-breakpoint

ALTER TABLE clm.contract_survey_template ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.contract_survey_template FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY contract_survey_template_isolation ON clm.contract_survey_template
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

COMMENT ON TABLE clm.contract_survey_template IS
    'Welke vragenlijst-templates relevant zijn voor een contract. Many-to-many, geen extra velden. Zie docs/superpowers/specs/2026-08-22-contractmanagement-design.md §2.4.';--> statement-breakpoint

GRANT SELECT, INSERT, DELETE ON clm.contract_survey_template TO clm_api_runtime;--> statement-breakpoint

-- ── 4. survey_run.contract_id krijgt zijn foreign key ──────────────────────
--
-- Migratie 0007 introduceerde de kolom bewust zonder FK. Dit is het
-- aangekondigde vervolg. ON DELETE SET NULL, niet CASCADE of RESTRICT: een
-- survey-ronde is bewijsmateriaal en mag niet verdwijnen als het contract
-- wordt verwijderd — hij verliest alleen de koppeling. Zie spec §2.5.

ALTER TABLE clm.survey_run
    ADD CONSTRAINT survey_run_contract_id_contract_contract_id_fk
    FOREIGN KEY (contract_id) REFERENCES clm.contract(contract_id)
    ON DELETE set null;--> statement-breakpoint

COMMENT ON COLUMN clm.survey_run.contract_id IS
    'Op welk contract deze ronde betrekking heeft. Nullable: een ronde hoeft niet aan een contract te hangen. FK toegevoegd in migratie 0027 zodra clm.contract bestond, zoals migratie 0007 al aankondigde.';
```

- [ ] **Step 2: Voeg de migratie toe aan `drizzle/meta/_journal.json`**

Open `drizzle/meta/_journal.json`, voeg een entry toe ná de laatste
(`0026_tenantregister`). Gebruik een `when`-timestamp die na de vorige komt
(volgende geheel getal is voldoende, het veld is alleen ordening):

```json
    {
      "idx": 27,
      "version": "7",
      "when": 1787068800001,
      "tag": "0027_contract",
      "breakpoints": true
    }
```

- [ ] **Step 3: Draai de migratie tegen een wegwerpcontainer**

Volg `docs/runbooks/commandos-en-omgeving.md` voor het opzetten van een
eigen wegwerpcontainer (nooit tegen staging/productie/demo). Na het opzetten:

```bash
node scripts/markeer-wegwerp.js "contractmanagement-migratie-testen"
npm run migrate:deploy
```

Verwacht: de migratie draait, geen fouten. Lees terug — niet vertrouwen op
de meldingstekst (§4 van `MCM2-CLAUDE.md`):

```sql
SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
  FROM information_schema.columns WHERE table_schema='clm' AND table_name='contract';
```

Verwacht: `contract_id, tenant_id, vendor_id, name, contract_number,
vendor_contact_id, owner_user_id, status_code, value_eur, start_date,
end_date, note, created_at, updated_at, deleted_at`.

- [ ] **Step 4: Commit**

```bash
git add drizzle/0027_contract.sql drizzle/meta/_journal.json
git commit -m "feat(contract): migratie voor clm.contract, ref.contract_status en contract_survey_template

Nieuwe tabellen volgens docs/superpowers/specs/2026-08-22-contractmanagement-design.md.
Legt ook de FK op survey_run.contract_id die migratie 0007 aankondigde.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Drizzle-schema bijwerken (`src/db/schema.ts`)

**Files:**
- Modify: `src/db/schema.ts`

`schema-conformiteit.e2e-spec.ts` leidt de verwachte tabellenlijst af uit dit
bestand via `inventariseerSchema()`. Zonder deze stap meldt die test dat de
database tabellen bevat die niet in het schema staan.

- [ ] **Step 1: Voeg `contractStatus` toe aan het ref-schema-blok**

Zoek de bestaande ref-tabellen (rond regel 27) en voeg toe, direct na
`complianceStatus`:

```typescript
export const contractStatus = ref.table('contract_status', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
});
```

- [ ] **Step 2: Voeg `contract` toe, direct na `vendorTag` (rond regel 304)**

```typescript
export const contract = clm.table(
  'contract',
  {
    contractId: uuid('contract_id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendor.vendorId, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    contractNumber: text('contract_number'),
    // NULL betekent "gebruik de is_primary-contactpersoon van de vendor" —
    // applicatielogica, geen database-default. Zie spec §2.1.
    vendorContactId: uuid('vendor_contact_id').references(
      () => vendorContact.contactId,
      { onDelete: 'set null' },
    ),
    ownerUserId: uuid('owner_user_id').references(() => user.userId, {
      onDelete: 'set null',
    }),
    // Kent geen 'verlopend' — dat is berekend uit end_date, nooit
    // opgeslagen. Zie spec §2.3.
    statusCode: text('status_code').references(() => contractStatus.code, {
      onDelete: 'set null',
    }),
    valueEur: numeric('value_eur', { precision: 15, scale: 2 }),
    startDate: date('start_date'),
    endDate: date('end_date'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('contract_tenant_id_idx').on(t.tenantId),
    index('contract_vendor_id_idx').on(t.vendorId),
  ],
);

export const contractSurveyTemplate = clm.table(
  'contract_survey_template',
  {
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contract.contractId, { onDelete: 'cascade' }),
    surveyTemplateId: uuid('survey_template_id')
      .notNull()
      .references(() => surveyTemplate.templateId, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('contract_survey_template_pkey').on(
      t.contractId,
      t.surveyTemplateId,
    ),
    index('contract_survey_template_tenant_id_idx').on(t.tenantId),
  ],
);
```

`vendorContact` en `surveyTemplate` worden pas later in het bestand
gedefinieerd (`vendorContact` op regel 265, `surveyTemplate` op regel 311) —
dat is geen probleem, Drizzle's `references()` gebruikt een closure die pas
uitgevoerd wordt na module-load, zelfde patroon als `vendor.ownerUserId` dat
al doet met `user` (gedefinieerd vóór `vendor`, dus daar speelt de volgorde
sowieso niet — controleer bij het invoegen dat `contract` ná `vendorContact`
en `surveyTemplate` in het bestand staat, dan is er geen closure-truc nodig).

**Concreet:** plaats het `contract`/`contractSurveyTemplate`-blok dus ná de
definitie van `surveyTemplate` (na regel 335 in het huidige bestand, vóór
`surveyRun` op regel 337), niet bij `vendorTag`. Dat voorkomt elke discussie
over declaratievolgorde.

- [ ] **Step 3: Compileer**

```bash
npx tsc --noEmit
```

Verwacht: geen fouten.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(contract): Drizzle-schema voor clm.contract en contract_survey_template

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `ContractService` — lijst, aanmaken, detail, wijzigen, verwijderen

**Files:**
- Create: `src/contract/contract.service.ts`

Volgt het patroon van `src/vendor/vendor.service.ts` exact: raw SQL via
`tx.execute`, `withTenant(tenantId, fn, 'medewerker')`, soft delete via
`deleted_at`, `leegIsNull()` voor optionele tekst.

- [ ] **Step 1: Schrijf `contract.service.ts`**

```typescript
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';

/**
 * Contracten lezen, aanmaken en wijzigen bij een leverancier.
 *
 * Zelfde opzet als VendorService: raw SQL binnen withTenant(), 'medewerker'
 * als actor, soft delete via deleted_at. Zie
 * docs/superpowers/specs/2026-08-22-contractmanagement-design.md.
 */

export interface ContractSamenvatting {
  contractId: string;
  name: string;
  contractNumber: string | null;
  statusCode: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
}

export interface NieuwContract {
  name: string;
  contractNumber?: string | null;
  vendorContactId?: string | null;
  ownerUserId?: string | null;
  statusCode?: string | null;
  valueEur?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  note?: string | null;
}

export interface ContractDetail {
  contractId: string;
  vendorId: string;
  name: string;
  contractNumber: string | null;
  vendorContactId: string | null;
  ownerUserId: string | null;
  statusCode: string | null;
  valueEur: string | null;
  startDate: string | null;
  endDate: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string | null;
}

/**
 * Wat er gewijzigd mag worden aan een contract. Elk veld optioneel; `null`
 * maakt leeg, `undefined` betekent "niet aangeraakt" — zelfde onderscheid als
 * VendorWijziging.
 */
export interface ContractWijziging {
  name?: string;
  contractNumber?: string | null;
  vendorContactId?: string | null;
  ownerUserId?: string | null;
  statusCode?: string | null;
  valueEur?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  note?: string | null;
}

interface ContractRij extends Record<string, unknown> {
  contract_id: string;
  name: string;
  contract_number: string | null;
  status_code: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: Date | string;
}

interface ContractDetailRij extends Record<string, unknown> {
  contract_id: string;
  vendor_id: string;
  name: string;
  contract_number: string | null;
  vendor_contact_id: string | null;
  owner_user_id: string | null;
  status_code: string | null;
  value_eur: string | null;
  start_date: string | null;
  end_date: string | null;
  note: string | null;
  created_at: Date | string;
  updated_at: Date | string | null;
}

function alsTekst(waarde: Date | string): string {
  return waarde instanceof Date ? waarde.toISOString() : waarde;
}

function alsTekstOfNull(waarde: Date | string | null): string | null {
  return waarde === null ? null : alsTekst(waarde);
}

function leegIsNull(waarde: string | null | undefined): string | null {
  const geknipt = waarde?.trim();
  return geknipt ? geknipt : null;
}

@Injectable()
export class ContractService {
  private readonly logger = new Logger(ContractService.name);

  constructor(private readonly db: DatabaseService) {}

  /** Alle actieve contracten van een leverancier, nieuwste eerst. */
  async lijst(
    tenantId: string,
    vendorId: string,
  ): Promise<ContractSamenvatting[]> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const resultaat = await tx.execute<ContractRij>(
          sql`SELECT contract_id, name, contract_number, status_code,
                     start_date, end_date, created_at
                FROM clm.contract
               WHERE vendor_id = ${vendorId} AND deleted_at IS NULL
               ORDER BY created_at DESC`,
        );

        return resultaat.rows.map((r) => ({
          contractId: r.contract_id,
          name: r.name,
          contractNumber: r.contract_number,
          statusCode: r.status_code,
          startDate: r.start_date,
          endDate: r.end_date,
          createdAt: alsTekst(r.created_at),
        }));
      },
      'medewerker',
    );
  }

  /**
   * Maakt een contract aan bij een leverancier.
   *
   * Geeft `null` als de leverancier niet bestaat of niet van deze tenant is
   * — zelfde redenering als VendorService.detail().
   */
  async maakAan(
    tenantId: string,
    vendorId: string,
    invoer: NieuwContract,
  ): Promise<ContractDetail | null> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const vendorBestaat = await tx.execute<{ vendor_id: string }>(
          sql`SELECT vendor_id FROM clm.vendor
             WHERE vendor_id = ${vendorId} AND deleted_at IS NULL`,
        );

        if (vendorBestaat.rows.length === 0) {
          return null;
        }

        const resultaat = await tx.execute<{ contract_id: string }>(
          sql`INSERT INTO clm.contract
                (tenant_id, vendor_id, name, contract_number,
                 vendor_contact_id, owner_user_id, status_code, value_eur,
                 start_date, end_date, note)
              VALUES (${tenantId}, ${vendorId}, ${invoer.name.trim()},
                      ${leegIsNull(invoer.contractNumber)},
                      ${invoer.vendorContactId ?? null},
                      ${invoer.ownerUserId ?? null},
                      ${leegIsNull(invoer.statusCode)},
                      ${invoer.valueEur ?? null},
                      ${invoer.startDate ?? null},
                      ${invoer.endDate ?? null},
                      ${leegIsNull(invoer.note)})
              RETURNING contract_id`,
        );

        const contractId = resultaat.rows[0].contract_id;

        this.logger.log(`Contract aangemaakt (${contractId}).`);

        return this.detailBinnenTransactie(tx, vendorId, contractId);
      },
      'medewerker',
    );
  }

  /** Eén contract, mits het bij deze vendor en tenant hoort. */
  async detail(
    tenantId: string,
    vendorId: string,
    contractId: string,
  ): Promise<ContractDetail | null> {
    return this.db.withTenant(
      tenantId,
      (tx) => this.detailBinnenTransactie(tx, vendorId, contractId),
      'medewerker',
    );
  }

  /** Wijzigt een contract. Alleen de meegestuurde velden. */
  async wijzig(
    tenantId: string,
    vendorId: string,
    contractId: string,
    wijziging: ContractWijziging,
  ): Promise<ContractDetail | null> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const bestaat = await tx.execute<{ contract_id: string }>(
          sql`SELECT contract_id FROM clm.contract
             WHERE contract_id = ${contractId}
               AND vendor_id = ${vendorId}
               AND deleted_at IS NULL`,
        );

        if (bestaat.rows.length === 0) {
          return null;
        }

        const zetten: SQL[] = [];

        if (wijziging.name !== undefined) {
          zetten.push(sql`name = ${wijziging.name.trim()}`);
        }
        if (wijziging.contractNumber !== undefined) {
          zetten.push(
            sql`contract_number = ${leegIsNull(wijziging.contractNumber)}`,
          );
        }
        if (wijziging.vendorContactId !== undefined) {
          zetten.push(
            sql`vendor_contact_id = ${wijziging.vendorContactId}`,
          );
        }
        if (wijziging.ownerUserId !== undefined) {
          zetten.push(sql`owner_user_id = ${wijziging.ownerUserId}`);
        }
        if (wijziging.statusCode !== undefined) {
          zetten.push(
            sql`status_code = ${leegIsNull(wijziging.statusCode)}`,
          );
        }
        if (wijziging.valueEur !== undefined) {
          zetten.push(sql`value_eur = ${wijziging.valueEur}`);
        }
        if (wijziging.startDate !== undefined) {
          zetten.push(sql`start_date = ${wijziging.startDate}`);
        }
        if (wijziging.endDate !== undefined) {
          zetten.push(sql`end_date = ${wijziging.endDate}`);
        }
        if (wijziging.note !== undefined) {
          zetten.push(sql`note = ${leegIsNull(wijziging.note)}`);
        }

        if (zetten.length > 0) {
          zetten.push(sql`updated_at = now()`);

          await tx.execute(
            sql`UPDATE clm.contract
                 SET ${sql.join(zetten, sql`, `)}
               WHERE contract_id = ${contractId}`,
          );

          this.logger.log(`Contract gewijzigd (${contractId}).`);
        }

        return this.detailBinnenTransactie(tx, vendorId, contractId);
      },
      'medewerker',
    );
  }

  /** Verwijdert een contract — soft delete. */
  async verwijder(
    tenantId: string,
    vendorId: string,
    contractId: string,
  ): Promise<boolean> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const resultaat = await tx.execute<{ contract_id: string }>(
          sql`UPDATE clm.contract
               SET deleted_at = now()
             WHERE contract_id = ${contractId}
               AND vendor_id = ${vendorId}
               AND deleted_at IS NULL
             RETURNING contract_id`,
        );

        if (resultaat.rows.length === 0) {
          return false;
        }

        this.logger.log(`Contract verwijderd (${contractId}).`);
        return true;
      },
      'medewerker',
    );
  }

  private async detailBinnenTransactie(
    tx: Parameters<Parameters<DatabaseService['withTenant']>[1]>[0],
    vendorId: string,
    contractId: string,
  ): Promise<ContractDetail | null> {
    const resultaat = await tx.execute<ContractDetailRij>(
      sql`SELECT contract_id, vendor_id, name, contract_number,
                 vendor_contact_id, owner_user_id, status_code, value_eur,
                 start_date, end_date, note, created_at, updated_at
            FROM clm.contract
           WHERE contract_id = ${contractId}
             AND vendor_id = ${vendorId}
             AND deleted_at IS NULL`,
    );

    const rij = resultaat.rows[0];

    if (!rij) {
      return null;
    }

    return {
      contractId: rij.contract_id,
      vendorId: rij.vendor_id,
      name: rij.name,
      contractNumber: rij.contract_number,
      vendorContactId: rij.vendor_contact_id,
      ownerUserId: rij.owner_user_id,
      statusCode: rij.status_code,
      valueEur: rij.value_eur,
      startDate: rij.start_date,
      endDate: rij.end_date,
      note: rij.note,
      createdAt: alsTekst(rij.created_at),
      updatedAt: alsTekstOfNull(rij.updated_at),
    };
  }
}
```

- [ ] **Step 2: Compileer**

```bash
npx tsc --noEmit
```

Verwacht: geen fouten.

- [ ] **Step 3: Commit**

```bash
git add src/contract/contract.service.ts
git commit -m "feat(contract): ContractService — lijst, aanmaken, detail, wijzigen, verwijderen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Invoer-validatie (`contract-invoer.ts`)

**Files:**
- Create: `src/contract/contract-invoer.ts`
- Test: `src/contract/contract-invoer.spec.ts`

Volgt `src/vendor/vendor-invoer.ts`: handmatige validatie op `unknown`,
`InvoerFout` met veldnaam, ruime regels (alleen evidente vergissingen
tegenhouden).

- [ ] **Step 1: Schrijf de eerste falende test**

```typescript
import { leesNieuwContract, InvoerFout } from './contract-invoer';

describe('leesNieuwContract', () => {
  it('accepteert een minimale geldige invoer (alleen naam)', () => {
    const invoer = leesNieuwContract({ name: 'Hosting 2024-2027' });

    expect(invoer.name).toBe('Hosting 2024-2027');
    expect(invoer.contractNumber).toBeNull();
  });

  it('weigert een lege naam', () => {
    expect(() => leesNieuwContract({ name: '' })).toThrow(InvoerFout);
  });

  it('weigert een ontbrekende naam', () => {
    expect(() => leesNieuwContract({})).toThrow(InvoerFout);
  });

  it('knipt witruimte van de naam', () => {
    const invoer = leesNieuwContract({ name: '  Hosting  ' });
    expect(invoer.name).toBe('Hosting');
  });

  it('accepteert een geldige startDate en endDate (ISO-datum)', () => {
    const invoer = leesNieuwContract({
      name: 'Hosting',
      startDate: '2024-01-01',
      endDate: '2027-12-31',
    });

    expect(invoer.startDate).toBe('2024-01-01');
    expect(invoer.endDate).toBe('2027-12-31');
  });

  it('weigert een endDate vóór de startDate', () => {
    expect(() =>
      leesNieuwContract({
        name: 'Hosting',
        startDate: '2027-01-01',
        endDate: '2024-01-01',
      }),
    ).toThrow(InvoerFout);
  });

  it('weigert een niet-ISO datum', () => {
    expect(() =>
      leesNieuwContract({ name: 'Hosting', startDate: '01-01-2024' }),
    ).toThrow(InvoerFout);
  });

  it('accepteert een geldig geldbedrag', () => {
    const invoer = leesNieuwContract({ name: 'Hosting', valueEur: '1500.50' });
    expect(invoer.valueEur).toBe('1500.50');
  });

  it('weigert een negatief geldbedrag', () => {
    expect(() =>
      leesNieuwContract({ name: 'Hosting', valueEur: '-100' }),
    ).toThrow(InvoerFout);
  });

  it('weigert een niet-numeriek geldbedrag', () => {
    expect(() =>
      leesNieuwContract({ name: 'Hosting', valueEur: 'abc' }),
    ).toThrow(InvoerFout);
  });
});
```

- [ ] **Step 2: Run de test om te zien dat hij faalt**

```bash
npx jest src/contract/contract-invoer.spec.ts
```

Verwacht: FAIL — `Cannot find module './contract-invoer'`.

- [ ] **Step 3: Schrijf de implementatie**

```typescript
import type { NieuwContract, ContractWijziging } from './contract.service';

/**
 * Validatie van wat een browser opstuurt bij het aanmaken/wijzigen van een
 * contract. Zelfde opzet als vendor-invoer.ts: handmatig op `unknown`, ruime
 * regels — wat hier wordt tegengehouden is het soort invoer dat op een
 * vergissing wijst, niet elke denkbare afwijking.
 */

const MAX_NAAM = 200;
const MAX_KORT = 100;
const MAX_NOTITIE = 2000;

export class InvoerFout extends Error {
  constructor(
    readonly veld: string,
    melding: string,
  ) {
    super(melding);
    this.name = 'InvoerFout';
  }
}

function verplichteTekst(
  waarde: unknown,
  veld: string,
  maxLengte: number,
): string {
  if (typeof waarde !== 'string' || waarde.trim() === '') {
    throw new InvoerFout(veld, `${veld} is verplicht.`);
  }

  const geknipt = waarde.trim();

  if (geknipt.length > maxLengte) {
    throw new InvoerFout(
      veld,
      `${veld} mag maximaal ${maxLengte} tekens bevatten.`,
    );
  }

  return geknipt;
}

function optioneleTekst(
  waarde: unknown,
  veld: string,
  maxLengte: number,
): string | null {
  if (waarde === undefined || waarde === null || waarde === '') {
    return null;
  }

  if (typeof waarde !== 'string') {
    throw new InvoerFout(veld, `${veld} moet tekst zijn.`);
  }

  const geknipt = waarde.trim();

  if (geknipt === '') {
    return null;
  }

  if (geknipt.length > maxLengte) {
    throw new InvoerFout(
      veld,
      `${veld} mag maximaal ${maxLengte} tekens bevatten.`,
    );
  }

  return geknipt;
}

function optioneleUuid(waarde: unknown, veld: string): string | null {
  if (waarde === undefined || waarde === null || waarde === '') {
    return null;
  }

  const UUID_PATROON =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (typeof waarde !== 'string' || !UUID_PATROON.test(waarde)) {
    throw new InvoerFout(veld, `${veld} is geen geldige id.`);
  }

  return waarde;
}

const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;

function optioneleDatum(waarde: unknown, veld: string): string | null {
  if (waarde === undefined || waarde === null || waarde === '') {
    return null;
  }

  if (typeof waarde !== 'string' || !ISO_DATUM.test(waarde)) {
    throw new InvoerFout(veld, `${veld} moet een datum zijn (JJJJ-MM-DD).`);
  }

  return waarde;
}

/**
 * Een geldbedrag als tekst, zodat precisie niet verloren gaat via number.
 * Numeriek(15,2) in de database — twee decimalen, geen extra validatie op
 * decimalenaantal hier: de database wijst een te lange waarde zelf af.
 */
function optioneelBedrag(waarde: unknown, veld: string): string | null {
  if (waarde === undefined || waarde === null || waarde === '') {
    return null;
  }

  if (typeof waarde !== 'string' || !/^\d+(\.\d{1,2})?$/.test(waarde)) {
    throw new InvoerFout(veld, `${veld} moet een geldig bedrag zijn.`);
  }

  return waarde;
}

function controleerDatumVolgorde(
  startDate: string | null,
  endDate: string | null,
): void {
  if (startDate && endDate && startDate > endDate) {
    throw new InvoerFout(
      'endDate',
      'De einddatum kan niet vóór de begindatum liggen.',
    );
  }
}

/** Leest en valideert de body van POST /vendors/:vendorId/contracts. */
export function leesNieuwContract(body: unknown): NieuwContract {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Er is geen contract meegestuurd.');
  }

  const ruw = body as Record<string, unknown>;

  const startDate = optioneleDatum(ruw.startDate, 'Begindatum');
  const endDate = optioneleDatum(ruw.endDate, 'Einddatum');
  controleerDatumVolgorde(startDate, endDate);

  return {
    name: verplichteTekst(ruw.name, 'Naam', MAX_NAAM),
    contractNumber: optioneleTekst(
      ruw.contractNumber,
      'Contractnummer',
      MAX_KORT,
    ),
    vendorContactId: optioneleUuid(ruw.vendorContactId, 'Contactpersoon'),
    ownerUserId: optioneleUuid(ruw.ownerUserId, 'Contractbeheerder'),
    statusCode: optioneleTekst(ruw.statusCode, 'Status', MAX_KORT),
    valueEur: optioneelBedrag(ruw.valueEur, 'Waarde'),
    startDate,
    endDate,
    note: optioneleTekst(ruw.note, 'Notitie', MAX_NOTITIE),
  };
}

/** Leest de body van PATCH /vendors/:vendorId/contracts/:id. */
export function leesContractWijziging(body: unknown): ContractWijziging {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Er is geen wijziging meegestuurd.');
  }

  const ruw = body as Record<string, unknown>;
  const wijziging: ContractWijziging = {};

  if ('name' in ruw) {
    wijziging.name = verplichteTekst(ruw.name, 'Naam', MAX_NAAM);
  }
  if ('contractNumber' in ruw) {
    wijziging.contractNumber = optioneleTekst(
      ruw.contractNumber,
      'Contractnummer',
      MAX_KORT,
    );
  }
  if ('vendorContactId' in ruw) {
    wijziging.vendorContactId = optioneleUuid(
      ruw.vendorContactId,
      'Contactpersoon',
    );
  }
  if ('ownerUserId' in ruw) {
    wijziging.ownerUserId = optioneleUuid(
      ruw.ownerUserId,
      'Contractbeheerder',
    );
  }
  if ('statusCode' in ruw) {
    wijziging.statusCode = optioneleTekst(ruw.statusCode, 'Status', MAX_KORT);
  }
  if ('valueEur' in ruw) {
    wijziging.valueEur = optioneelBedrag(ruw.valueEur, 'Waarde');
  }
  if ('startDate' in ruw) {
    wijziging.startDate = optioneleDatum(ruw.startDate, 'Begindatum');
  }
  if ('endDate' in ruw) {
    wijziging.endDate = optioneleDatum(ruw.endDate, 'Einddatum');
  }
  if ('note' in ruw) {
    wijziging.note = optioneleTekst(ruw.note, 'Notitie', MAX_NOTITIE);
  }

  controleerDatumVolgorde(
    wijziging.startDate ?? null,
    wijziging.endDate ?? null,
  );

  return wijziging;
}
```

- [ ] **Step 4: Run de test opnieuw**

```bash
npx jest src/contract/contract-invoer.spec.ts
```

Verwacht: PASS, alle 10 tests groen.

- [ ] **Step 5: Commit**

```bash
git add src/contract/contract-invoer.ts src/contract/contract-invoer.spec.ts
git commit -m "feat(contract): invoer-validatie voor contract aanmaken en wijzigen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `ContractController` + `ContractModule` + registratie in `AppModule`

**Files:**
- Create: `src/contract/contract.controller.ts`
- Create: `src/contract/contract.module.ts`
- Modify: `src/app.module.ts`

Routes onder `/vendors/:vendorId/contracts` — een contract bestaat altijd in
de context van zijn leverancier, zelfde opzet als
`/vendors/:id/contacts`.

- [ ] **Step 1: Schrijf `contract.controller.ts`**

```typescript
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
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
  leesContractWijziging,
  leesNieuwContract,
} from './contract-invoer';
import {
  ContractService,
  type ContractWijziging,
  type NieuwContract,
} from './contract.service';

/**
 * Contractroutes, altijd in de context van een leverancier.
 *
 * Zelfde beveiligingspatroon als VendorController: guards op klasseniveau,
 * schrijven vereist de rol admin.
 */
@Controller('vendors/:vendorId/contracts')
@UseGuards(TenantContextGuard, RolGuard)
export class ContractController {
  constructor(private readonly contracts: ContractService) {}

  @Get()
  async lijst(
    @Req() request: RequestMetSessie,
    @Param('vendorId') vendorId: string,
  ) {
    const sessie = request.sessie!;

    const contracten = await this.contracts.lijst(
      sessie.tenantId,
      leesUuid(vendorId),
    );

    return { contracten };
  }

  @Post()
  @VereistRol('admin')
  @HttpCode(201)
  async maakAan(
    @Req() request: RequestMetSessie,
    @Param('vendorId') vendorId: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let invoer: NieuwContract;

    try {
      invoer = leesNieuwContract(body);
    } catch (err) {
      throw alsHttpFout(err);
    }

    const contract = await this.contracts
      .maakAan(sessie.tenantId, leesUuid(vendorId), invoer)
      .catch(alsRefFout);

    if (!contract) {
      throw new NotFoundException('Leverancier niet gevonden.');
    }

    return contract;
  }

  @Get(':id')
  async detail(
    @Req() request: RequestMetSessie,
    @Param('vendorId') vendorId: string,
    @Param('id') id: string,
  ) {
    const sessie = request.sessie!;

    const contract = await this.contracts.detail(
      sessie.tenantId,
      leesUuid(vendorId),
      leesUuid(id),
    );

    if (!contract) {
      throw new NotFoundException('Contract niet gevonden.');
    }

    return contract;
  }

  @Patch(':id')
  @VereistRol('admin')
  async wijzig(
    @Req() request: RequestMetSessie,
    @Param('vendorId') vendorId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let wijziging: ContractWijziging;

    try {
      wijziging = leesContractWijziging(body);
    } catch (err) {
      throw alsHttpFout(err);
    }

    const contract = await this.contracts
      .wijzig(sessie.tenantId, leesUuid(vendorId), leesUuid(id), wijziging)
      .catch(alsRefFout);

    if (!contract) {
      throw new NotFoundException('Contract niet gevonden.');
    }

    return contract;
  }

  @Delete(':id')
  @VereistRol('admin')
  @HttpCode(204)
  async verwijder(
    @Req() request: RequestMetSessie,
    @Param('vendorId') vendorId: string,
    @Param('id') id: string,
  ) {
    const sessie = request.sessie!;

    const gelukt = await this.contracts.verwijder(
      sessie.tenantId,
      leesUuid(vendorId),
      leesUuid(id),
    );

    if (!gelukt) {
      throw new NotFoundException('Contract niet gevonden.');
    }
  }
}

const UUID_PATROON =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function leesUuid(waarde: string): string {
  if (!UUID_PATROON.test(waarde)) {
    throw new NotFoundException('Niet gevonden.');
  }

  return waarde;
}

function alsHttpFout(err: unknown): unknown {
  if (err instanceof InvoerFout) {
    return new BadRequestException({ message: err.message, veld: err.veld });
  }

  return err;
}

/**
 * Een onbekende status_code, vendor_contact_id of owner_user_id is een
 * gebruikersfout, geen storing. Zelfde vertaling als bij VendorController.
 */
function alsRefFout(err: unknown): never {
  const code = (err as { cause?: { code?: string }; code?: string })?.cause
    ?.code;

  if (code === '23503') {
    throw new BadRequestException({
      message:
        'Onbekende status, contactpersoon of contractbeheerder.',
      veld: 'statusCode',
    });
  }

  throw err;
}
```

- [ ] **Step 2: Schrijf `contract.module.ts`**

```typescript
import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ContractController } from './contract.controller';
import { ContractService } from './contract.service';

/**
 * Contractbeheer bij een leverancier.
 *
 * AuthModule voor TenantContextGuard, zelfde reden als VendorModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [ContractController],
  providers: [ContractService],
  exports: [ContractService],
})
export class ContractModule {}
```

- [ ] **Step 3: Registreer in `AppModule`**

Open `src/app.module.ts`. Voeg de import toe naast `VendorModule`:

```typescript
import { ContractModule } from './contract/contract.module';
```

En voeg `ContractModule` toe aan de `imports`-array, direct na
`VendorModule`.

- [ ] **Step 4: Compileer en start op**

```bash
npx tsc --noEmit
```

Verwacht: geen fouten.

- [ ] **Step 5: Commit**

```bash
git add src/contract/contract.controller.ts src/contract/contract.module.ts src/app.module.ts
git commit -m "feat(contract): ContractController en ContractModule, geregistreerd in AppModule

Routes onder /vendors/:vendorId/contracts, zelfde beveiligingspatroon als
VendorController.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: e2e-testsuite (tenantgrens + rolcontrole)

**Files:**
- Create: `test/contract-routes.e2e-spec.ts`
- Modify: `test/test-ids.ts`

Volgt `test/vendor-detail.e2e-spec.ts`: eigen blok in `TEST_IDS`, admin vs.
reviewer, cross-tenant zichtbaarheid, opruimen vóór en na.

- [ ] **Step 1: Voeg een testblok toe aan `test/test-ids.ts`**

Voeg toe na het `'vendor-detail'`-blok (rond regel 97), vóór
`'tenant-context-guard'`:

```typescript
  'contract-routes': {
    tenant: id('e6'),
    adminUser: id('e7'),
    reviewerUser: id('e8'),
    andereTenant: id('e9'),
    andereUser: id('f7'),
  },
```

- [ ] **Step 2: Controleer dat er geen dubbele ids ontstaan**

```bash
npx jest test/test-ids.spec.ts
```

Verwacht: PASS.

- [ ] **Step 3: Schrijf `test/contract-routes.e2e-spec.ts`**

```typescript
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
 * Contractroutes: tenantgrens en rolcontrole.
 *
 * Zelfde twee vragen als vendor-detail.e2e-spec.ts: kan een reviewer
 * schrijven (moet niet), en kan tenant A bij de contracten van tenant B zien
 * (moet niet).
 */

const { tenant, adminUser, reviewerUser, andereTenant, andereUser } =
  TEST_IDS['contract-routes'];

const STEMPEL = Date.now();
const SUBJECT_ADMIN = `oid-contract-admin-${STEMPEL}`;
const SUBJECT_REVIEWER = `oid-contract-reviewer-${STEMPEL}`;
const SUBJECT_ANDER = `oid-contract-ander-${STEMPEL}`;

interface ContractAntwoord {
  contractId: string;
  vendorId: string;
  name: string;
  contractNumber: string | null;
  statusCode: string | null;
}

function alsContract(body: unknown): ContractAntwoord {
  return body as ContractAntwoord;
}

async function verwijderTestdata(client: Client): Promise<void> {
  for (const t of [tenant, andereTenant]) {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${t}'`);
    await client.query('DELETE FROM clm.contract WHERE tenant_id = $1', [t]);
    await client.query('DELETE FROM clm.vendor_contact WHERE tenant_id = $1', [
      t,
    ]);
    await client.query('DELETE FROM clm.vendor WHERE tenant_id = $1', [t]);
    await client.query(
      'DELETE FROM clm.tenant_membership WHERE tenant_id = $1',
      [t],
    );
    await client.query('DELETE FROM clm."user" WHERE tenant_id = $1', [t]);
    await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [t]);
    await client.query('COMMIT');
  }
}

describe('Contractroutes (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let sessies: SessieService;

  let adminCookie: string;
  let reviewerCookie: string;
  let vendorId: string;

  const cookieNaam = cookieInstellingen().naam;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(client);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenant, 'contract-test'],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
       VALUES ($1, $2, $3, $4), ($5, $2, $6, $7)`,
      [
        adminUser,
        tenant,
        'Anna Admin',
        SUBJECT_ADMIN,
        reviewerUser,
        'Rob Reviewer',
        SUBJECT_REVIEWER,
      ],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin'), ($3, $2, 'reviewer')`,
      [adminUser, tenant, reviewerUser],
    );

    const vendorResultaat = await client.query<{ vendor_id: string }>(
      `INSERT INTO clm.vendor (tenant_id, name) VALUES ($1, $2)
       RETURNING vendor_id`,
      [tenant, `Testleverancier-${STEMPEL}`],
    );
    vendorId = vendorResultaat.rows[0].vendor_id;

    await client.query('COMMIT');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();

    sessies = app.get(SessieService);

    const adminSessie = await sessies.aanmaken(SUBJECT_ADMIN);
    const reviewerSessie = await sessies.aanmaken(SUBJECT_REVIEWER);

    adminCookie = `${cookieNaam}=${adminSessie!.token}`;
    reviewerCookie = `${cookieNaam}=${reviewerSessie!.token}`;
  });

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(client);
    await client.end();
  });

  it('admin kan een contract aanmaken', async () => {
    const respons = await request(server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie)
      .send({ name: 'Hosting 2024-2027', contractNumber: 'ERP-4711' });

    expect(respons.status).toBe(201);
    const contract = alsContract(respons.body);
    expect(contract.name).toBe('Hosting 2024-2027');
    expect(contract.contractNumber).toBe('ERP-4711');
    expect(contract.vendorId).toBe(vendorId);
  });

  it('reviewer kan geen contract aanmaken (403)', async () => {
    const respons = await request(server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', reviewerCookie)
      .send({ name: 'Verboden contract' });

    expect(respons.status).toBe(403);
  });

  it('admin kan de lijst met contracten van de leverancier ophalen', async () => {
    const respons = await request(server)
      .get(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie);

    expect(respons.status).toBe(200);
    expect(Array.isArray(respons.body.contracten)).toBe(true);
    expect(respons.body.contracten.length).toBeGreaterThan(0);
  });

  it('reviewer kan de lijst wél lezen (alleen schrijven is geblokkeerd)', async () => {
    const respons = await request(server)
      .get(`/vendors/${vendorId}/contracts`)
      .set('Cookie', reviewerCookie);

    expect(respons.status).toBe(200);
  });

  it('een tweede tenant ziet de contracten van tenant A niet', async () => {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${andereTenant}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [andereTenant, 'contract-test-ander'],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
       VALUES ($1, $2, $3, $4)`,
      [andereUser, andereTenant, 'Bob Buiten', SUBJECT_ANDER],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [andereUser, andereTenant],
    );
    await client.query('COMMIT');

    const andereSessie = await sessies.aanmaken(SUBJECT_ANDER);
    const andereCookie = `${cookieNaam}=${andereSessie!.token}`;

    // Directe vendor-id van tenant A opvragen vanuit tenant B: RLS filtert
    // 'm weg, dus het scherm ziet niets — geen aparte foutmelding die zou
    // verklappen dat de vendor elders wél bestaat.
    const respons = await request(server)
      .get(`/vendors/${vendorId}/contracts`)
      .set('Cookie', andereCookie);

    expect(respons.status).toBe(200);
    expect(respons.body.contracten).toEqual([]);
  });

  it('wijzigen van een niet-bestaand contract geeft 404', async () => {
    const respons = await request(server)
      .patch(`/vendors/${vendorId}/contracts/00000000-0000-0000-0000-000000000000`)
      .set('Cookie', adminCookie)
      .send({ name: 'Bestaat niet' });

    expect(respons.status).toBe(404);
  });

  it('een contract aanmaken zonder naam geeft 400 met veldnaam', async () => {
    const respons = await request(server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie)
      .send({});

    expect(respons.status).toBe(400);
    expect(respons.body.veld).toBe('Naam');
  });

  it('admin kan een contract verwijderen (soft delete)', async () => {
    const aangemaakt = await request(server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie)
      .send({ name: 'Te verwijderen contract' });

    const contractId = alsContract(aangemaakt.body).contractId;

    const verwijderd = await request(server)
      .delete(`/vendors/${vendorId}/contracts/${contractId}`)
      .set('Cookie', adminCookie);

    expect(verwijderd.status).toBe(204);

    const opgehaald = await request(server)
      .get(`/vendors/${vendorId}/contracts/${contractId}`)
      .set('Cookie', adminCookie);

    expect(opgehaald.status).toBe(404);
  });
});
```

- [ ] **Step 4: Draai de nieuwe suite geïsoleerd tegen een wegwerpcontainer**

Volgens `MCM2-CLAUDE.md` §"Een nieuwe e2e-suite schrijven": eerst
`test-ids`, dan deze suite los, dan de volledige e2e-run.

```bash
npx jest test-ids
npx jest --config ./test/jest-e2e.json contract-routes
```

Verwacht: alle tests in `contract-routes.e2e-spec.ts` slagen (PASS).

- [ ] **Step 5: Draai de volledige e2e-run**

```bash
npm run test:e2e
```

Verwacht: alle suites slagen, inclusief `schema-conformiteit.e2e-spec.ts`
(bewijst dat `clm.contract`, `ref.contract_status` en
`clm.contract_survey_template` zowel in de database als in
`src/db/schema.ts` staan) en `rechten-contract.e2e-spec.ts` (bewijst dat de
nieuwe GRANTs in migratie 0027 kloppen).

Als een andere suite hierdoor rood wordt: dat is een teken dat de gedeelde
testdatabase geraakt is op een onverwachte manier (zie
`MCM2-CLAUDE.md` — "welke suite dan omvalt hangt af van de volgorde"). Zoek
uit welke tabel/rij overlapt vóórdat je verdergaat.

- [ ] **Step 6: Commit**

```bash
git add test/contract-routes.e2e-spec.ts test/test-ids.ts
git commit -m "test(contract): e2e-suite voor contractroutes — tenantgrens en rolcontrole

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Volledige verificatie

**Files:** geen wijzigingen — alleen controleren.

- [ ] **Step 1: Draai de volledige verificatieketen**

```bash
npm run verify:volledig
```

Verwacht: groen. Dit dekt build, lint:check, format:check, typecheck,
unit-tests en e2e-tests in één keer — losse commando's bewijzen niets
(`MCM2-CLAUDE.md` §15a).

- [ ] **Step 2: Als er iets rood is, fix het daar waar het hoort**

Niet de test aanpassen om hem groen te krijgen tenzij de test zelf
aantoonbaar fout is. Bij twijfel: `superpowers:systematic-debugging`.

- [ ] **Step 3: Ruim de wegwerpcontainer op**

Volgens de regel dat elke database `beschermd` is tot hij zich als
`wegwerp` meldt: dit was een eigen, gemarkeerde container (Task 1, Step 3) —
gewoon stoppen/verwijderen, niets om op te schonen in staging/productie/demo.

---

## Self-review

**Spec-dekking (tegen `docs/superpowers/specs/2026-08-22-contractmanagement-design.md`):**

- §2.1 `clm.contract` — Task 1 (migratie) + Task 2 (schema.ts). ✅ alle
  kolommen aanwezig, inclusief de nullable `vendor_contact_id`-fallback als
  toelichting.
- §2.2 `ref.contract_status` — Task 1. ✅ drie codes, geen "verlopend".
- §2.3 "verlopend" berekend, niet opgeslagen — expliciet in de
  migratie-commentaar en de service-laag bevat geen kolom of logica die het
  wél opslaat. ✅ Geen aparte taak nodig: de afwezigheid ván een kolom is de
  implementatie.
- §2.4 `clm.contract_survey_template` — Task 1 + Task 2. ✅ Geen route
  hiervoor gebouwd in dit plan — de spec dekt alleen het datamodel (§5:
  "geen UI/schermen"), dus dat is bewust buiten scope, net als bij het
  contract zelf staat vermeld dat schermen een aparte implementatiestap
  zijn. **Correctie:** de contract-CRUD-routes in Task 5 gaan wél verder dan
  "alleen datamodel" — dat is een bewuste, kleine uitbreiding van de
  planscope t.o.v. de spec, nodig om de feature daadwerkelijk bruikbaar te
  maken en te kunnen e2e-testen (RLS bewijzen vraagt een route). De
  contract_survey_template-koppelroutes zijn wél weggelaten: die hebben geen
  UI-consument in dit plan en worden apart opgepakt zodra de
  rondes-aanmaakflow (roadmap §2.2-vervolg) ze nodig heeft.
- §2.5 FK op `survey_run.contract_id` — Task 1, Step 1, blok 4. ✅
- §4 RLS — Task 1: beide nieuwe tabellen krijgen ENABLE + FORCE + policy met
  USING/WITH CHECK. ✅ Bewezen in Task 7 via `schema-conformiteit.e2e-spec.ts`
  en de bestaande RLS-inventarisatie.
- §5 "wat dit niet doet" — geen bulk-upload, geen automatische
  statuswijziging, geen migratie van bestaande data: dit plan bouwt niets
  van dat. ✅

**Placeholder-scan:** geen TBD/TODO, elke stap heeft volledige code.

**Type-consistentie:** `NieuwContract`/`ContractWijziging`/`ContractDetail`
in `contract.service.ts` (Task 3) komen overeen met wat
`contract-invoer.ts` (Task 4) en `contract.controller.ts` (Task 5)
importeren en gebruiken — veldnamen zijn doorgangen gecheckt
(`vendorContactId`, `ownerUserId`, `statusCode`, `valueEur`, `startDate`,
`endDate`, `note`, `contractNumber`).

**Scope-check:** één samenhangende feature, zeven taken, elke taak levert
zelfstandig testbare voortgang op (migratie → schema → service → validatie
→ API → e2e → verificatie). Geen decompositie in aparte plannen nodig.
