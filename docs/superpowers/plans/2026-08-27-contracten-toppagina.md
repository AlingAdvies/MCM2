# Contracten-toppagina Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een tenant-brede contractenlijst (`/beheer/contracten`) met eigen
sidebar-item. Een klik op een contract navigeert naar het bestaande
leveranciersscherm met dat contract al opengeklapt — geen aparte
detailpagina.

**Architecture:** Nieuwe backend-route `GET /contracts` (tenant-breed, leest
uit het bestaande `clm.contract`-model, geen nieuwe tabellen/velden) naast
de bestaande vendor-gescoped route. Frontend: nieuwe lijstpagina +
sidebar-item, en een kleine aanpassing aan het bestaande
`Contracten.tsx`/leveranciersscherm om een initieel opengeklapt contract via
een query-param te ondersteunen.

**Tech Stack:** NestJS, Drizzle (raw SQL, geen migratie nodig), PostgreSQL
met RLS, Jest e2e tegen een wegwerpcontainer, Next.js in de zusterrepo
`MCM2-frontend`.

**Spec:** `docs/superpowers/specs/2026-08-27-contracten-toppagina-design.md`

---

## Vooraf — testdatabase

```powershell
npm run test:db -- "contracten-toppagina"
```

Exporteer de twee getoonde variabelen (`MIGRATION_DATABASE_URL`,
`DATABASE_URL`) in de shell waarin de backendtaken hierna draaien. Bij een
volgende sessie op dezelfde container: `npm run test:db -- "contracten-toppagina" --hergebruik`.

---

### Taak 1: Backend — `ContractService.lijstTenantBreed()`

**Files:**
- Modify: `src/contract/contract.service.ts`

- [x] **Step 1: Bekijk het bestaande `lijst()` als sjabloon**

```powershell
Get-Content src/contract/contract.service.ts | Select-String -Pattern "async lijst" -Context 0,40
```

- [x] **Step 2: Voeg het nieuwe interface toe**

In `src/contract/contract.service.ts`, direct na `ContractSamenvatting`
(regel ~20-35):

```ts
export interface ContractTenantBreed extends ContractSamenvatting {
  vendorId: string;
  vendorNaam: string;
  valueEur: string | null;
}
```

- [x] **Step 3: Voeg de nieuwe methode toe**

Direct na de bestaande `lijst()`-methode (na regel ~191, vóór `maakAan`):

```ts
  /**
   * Alle actieve contracten van de tenant, ongeacht leverancier — voor de
   * contracten-toppagina (issue #173). Dichtstbijzijnde einddatum eerst: een
   * tenant-breed overzicht beantwoordt primair "wat loopt er binnenkort af",
   * anders dan de vendor-gescoped lijst() hierboven (nieuwste eerst).
   */
  async lijstTenantBreed(tenantId: string): Promise<ContractTenantBreed[]> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const resultaat = await tx.execute<
          ContractRij & { vendor_id: string; vendor_naam: string; value_eur: string | null }
        >(
          sql`SELECT c.contract_id, c.vendor_id, c.name, c.contract_number,
                     c.vendor_contact_id, c.owner_user_id, c.status_code,
                     c.value_eur, c.start_date, c.end_date, c.created_at,
                     c.notice_period_days, c.warning_days_before, c.auto_renews,
                     vc.full_name AS vendor_contact_naam,
                     u.full_name AS owner_naam,
                     v.name AS vendor_naam
                FROM clm.contract c
                LEFT JOIN clm.vendor_contact vc ON vc.contact_id = c.vendor_contact_id
                LEFT JOIN clm."user" u ON u.user_id = c.owner_user_id
                JOIN clm.vendor v ON v.vendor_id = c.vendor_id
               WHERE c.deleted_at IS NULL AND v.deleted_at IS NULL
               ORDER BY c.end_date ASC NULLS LAST`,
        );

        return resultaat.rows.map((r) => ({
          contractId: r.contract_id,
          vendorId: r.vendor_id,
          vendorNaam: r.vendor_naam,
          name: r.name,
          contractNumber: r.contract_number,
          vendorContactId: r.vendor_contact_id,
          ownerUserId: r.owner_user_id,
          statusCode: r.status_code,
          valueEur: r.value_eur,
          startDate: r.start_date,
          endDate: r.end_date,
          vendorContactNaam: r.vendor_contact_naam,
          ownerGebruikerNaam: r.owner_naam,
          createdAt: alsTekst(r.created_at),
          noticePeriodDays: r.notice_period_days,
          warningDaysBefore: r.warning_days_before,
          autoRenews: r.auto_renews,
        }));
      },
      'medewerker',
    );
  }
```

- [x] **Step 4: Typecheck**

```powershell
npx tsc --noEmit
```

Verwacht: geen fouten.

- [x] **Step 5: Commit**

```bash
git add src/contract/contract.service.ts
git commit -m "feat(contract): ContractService.lijstTenantBreed() voor de contracten-toppagina"
```

---

### Taak 2: Backend — route `GET /contracts`

**Files:**
- Create: `src/contract/contracts-overzicht.controller.ts`
- Modify: `src/contract/contract.module.ts`
- Test: `test/contracten-overzicht.e2e-spec.ts`

- [x] **Step 1: Bekijk `contract.module.ts`**

```powershell
Get-Content src/contract/contract.module.ts
```

- [x] **Step 2: Registreer de test-ids**

In `test/test-ids.ts`, na het laatste blok (vóór de afsluitende `} as const;`):

```ts
  'contracten-overzicht': {
    tenant: id('3d'),
    admin: id('3e'),
    reviewer: id('3f'),
    andereTenant: id('40'),
  },
```

- [x] **Step 3: Schrijf de falende e2e-tests**

Maak `test/contracten-overzicht.e2e-spec.ts`, naar het patroon van
`test/tenant-leden.e2e-spec.ts` (imports, `migratieUrl()`, `SessieService`,
`cookieParser`, opruimen):

```ts
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
 * GET /contracts (issue #173): tenant-breed contractenoverzicht. Dekt de
 * tegenproeven uit
 * docs/superpowers/specs/2026-08-27-contracten-toppagina-design.md §5.
 */

const { tenant, admin, reviewer, andereTenant } =
  TEST_IDS['contracten-overzicht'];

const STEMPEL = Date.now();
const SUBJECT_ADMIN = `oid-co-admin-${STEMPEL}`;
const SUBJECT_REVIEWER = `oid-co-reviewer-${STEMPEL}`;

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

async function opruimen(migratieClient: Client): Promise<void> {
  for (const t of [tenant, andereTenant]) {
    await migratieClient.query('BEGIN');
    await migratieClient.query(`SET LOCAL app.current_tenant_id = '${t}'`);
    await migratieClient.query('DELETE FROM clm.contract WHERE tenant_id = $1', [t]);
    await migratieClient.query('DELETE FROM clm.vendor WHERE tenant_id = $1', [t]);
    await migratieClient.query('DELETE FROM clm.tenant_membership WHERE tenant_id = $1', [t]);
    await migratieClient.query('DELETE FROM clm."user" WHERE tenant_id = $1', [t]);
    await migratieClient.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [t]);
    await migratieClient.query('COMMIT');
  }
}

describe('GET /contracts — tenant-breed overzicht (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let migratieClient: Client;
  let adminCookie: string;
  let reviewerCookie: string;
  const cookieNaam = cookieInstellingen().naam;

  let vendorAId: string;
  let vendorBId: string;
  let contract1Id: string;
  let contract2Id: string;
  let contractAndereTenantId: string;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    migratieClient = new Client({ connectionString: migratieUrl() });
    await migratieClient.connect();
    await opruimen(migratieClient);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenant, 'contracten-overzicht-test'],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, email, external_subject)
       VALUES ($1, $2, $3, $4, $5), ($6, $2, $7, $8, $9)`,
      [
        admin, tenant, 'Anna Admin', 'anna@contracten-overzicht-test.nl', SUBJECT_ADMIN,
        reviewer, tenant, 'Rob Reviewer', 'rob@contracten-overzicht-test.nl', SUBJECT_REVIEWER,
      ],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin'), ($3, $2, 'reviewer')`,
      [admin, tenant, reviewer],
    );

    const vendorRijA = await client.query<{ vendor_id: string }>(
      `INSERT INTO clm.vendor (tenant_id, name) VALUES ($1, $2) RETURNING vendor_id`,
      [tenant, 'Leverancier A'],
    );
    vendorAId = vendorRijA.rows[0].vendor_id;
    const vendorRijB = await client.query<{ vendor_id: string }>(
      `INSERT INTO clm.vendor (tenant_id, name) VALUES ($1, $2) RETURNING vendor_id`,
      [tenant, 'Leverancier B'],
    );
    vendorBId = vendorRijB.rows[0].vendor_id;

    const c1 = await client.query<{ contract_id: string }>(
      `INSERT INTO clm.contract (tenant_id, vendor_id, name, value_eur, end_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING contract_id`,
      [tenant, vendorAId, 'Contract Een', '1000.00', '2027-01-01'],
    );
    contract1Id = c1.rows[0].contract_id;
    const c2 = await client.query<{ contract_id: string }>(
      `INSERT INTO clm.contract (tenant_id, vendor_id, name, value_eur, end_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING contract_id`,
      [tenant, vendorBId, 'Contract Twee', '2000.00', '2026-06-01'],
    );
    contract2Id = c2.rows[0].contract_id;
    await client.query('COMMIT');

    // Een tweede tenant met eigen data — nodig om de RLS-tegenproef
    // (spec §5, tegenproef 2) echt te laten bewijzen dat de query niet
    // per ongeluk tenants samenvoegt. Zonder deze rijen zou de eerdere
    // "totaal is 2"-aanname ook slagen bij een bug die alle tenants toont,
    // zolang die andere tenant toevallig leeg is.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${andereTenant}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [andereTenant, 'contracten-overzicht-andere-tenant-test'],
    );
    const vendorRijAndereTenant = await client.query<{ vendor_id: string }>(
      `INSERT INTO clm.vendor (tenant_id, name) VALUES ($1, $2) RETURNING vendor_id`,
      [andereTenant, 'Leverancier Andere Tenant'],
    );
    const cAndereTenant = await client.query<{ contract_id: string }>(
      `INSERT INTO clm.contract (tenant_id, vendor_id, name, end_date)
       VALUES ($1, $2, $3, $4) RETURNING contract_id`,
      [
        andereTenant,
        vendorRijAndereTenant.rows[0].vendor_id,
        'Contract Andere Tenant',
        '2026-12-01',
      ],
    );
    contractAndereTenantId = cAndereTenant.rows[0].contract_id;
    await client.query('COMMIT');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();

    const sessies = app.get(SessieService);
    const adminSessie = await sessies.aanmaken(SUBJECT_ADMIN);
    adminCookie = `${cookieNaam}=${adminSessie!.token}`;
    const reviewerSessie = await sessies.aanmaken(SUBJECT_REVIEWER);
    reviewerCookie = `${cookieNaam}=${reviewerSessie!.token}`;
  });

  afterAll(async () => {
    await app.close();
    await opruimen(migratieClient);
    await client.end();
    await migratieClient.end();
  });

  it('toont contracten van meerdere leveranciers, gesorteerd op einddatum', async () => {
    const respons = await request(server)
      .get('/contracts')
      .set('Cookie', adminCookie);

    expect(respons.status).toBe(200);
    const contracten = (respons.body as { contracten: { contractId: string; vendorNaam: string }[] })
      .contracten;
    const ids = contracten.map((c) => c.contractId);
    expect(ids).toContain(contract1Id);
    expect(ids).toContain(contract2Id);
    // Contract Twee (2026-06-01) hoort vóór Contract Een (2027-01-01).
    expect(ids.indexOf(contract2Id)).toBeLessThan(ids.indexOf(contract1Id));
  });

  it('een reviewer krijgt 200 — lezen mag iedereen', async () => {
    const respons = await request(server)
      .get('/contracts')
      .set('Cookie', reviewerCookie);

    expect(respons.status).toBe(200);
  });

  it('toont het echte valueEur, niet leeg', async () => {
    const respons = await request(server)
      .get('/contracts')
      .set('Cookie', adminCookie);

    const contracten = (respons.body as { contracten: { contractId: string; valueEur: string | null }[] })
      .contracten;
    const gevonden = contracten.find((c) => c.contractId === contract1Id);
    expect(gevonden?.valueEur).toBe('1000.00');
  });

  it('toont geen contracten van een andere tenant (RLS-tegenproef)', async () => {
    const respons = await request(server)
      .get('/contracts')
      .set('Cookie', adminCookie);

    const contracten = (respons.body as { contracten: { contractId: string }[] }).contracten;
    const ids = contracten.map((c) => c.contractId);

    // Positief: de eigen twee contracten staan er wél in (dekt hierboven
    // ook al, maar zonder deze regel zou een lege lijst deze test laten
    // slagen om de verkeerde reden).
    expect(ids).toContain(contract1Id);
    expect(ids).toContain(contract2Id);
    // Negatief: het contract van de andere tenant staat er niet in, ook al
    // bestaat het echt in de database.
    expect(ids).not.toContain(contractAndereTenantId);
    expect(contracten.length).toBe(2);
  });
});
```

- [x] **Step 4: Run, verwacht FAIL**

```powershell
npx jest --config ./test/jest-e2e.json test/contracten-overzicht.e2e-spec.ts
```

Verwacht: FAIL — de route bestaat nog niet (404).

- [x] **Step 5: Implementeer de controller**

Maak `src/contract/contracts-overzicht.controller.ts`:

```ts
import { Controller, Get, Req, UseGuards } from '@nestjs/common';

import { RolGuard } from '../auth/rol.guard';
import {
  TenantContextGuard,
  type RequestMetSessie,
} from '../auth/tenant-context.guard';
import { ContractService } from './contract.service';

/**
 * Contracten van de hele tenant, ongeacht leverancier (issue #173) — het
 * tenant-brede tegenhanger van ContractController, die altijd onder een
 * vendor-pad hangt. Geen `@VereistRol`: lezen mag elke geldige sessie,
 * consistent met de vendor-gescoped lijst en de andere tenant-brede
 * overzichten (leveranciers, vragenlijsten).
 */
@Controller('contracts')
@UseGuards(TenantContextGuard, RolGuard)
export class ContractsOverzichtController {
  constructor(private readonly contracts: ContractService) {}

  @Get()
  async lijst(@Req() request: RequestMetSessie) {
    const sessie = request.sessie!;
    const contracten = await this.contracts.lijstTenantBreed(
      sessie.tenantId,
    );
    return { contracten };
  }
}
```

- [x] **Step 6: Registreer in `contract.module.ts`**

Voeg `ContractsOverzichtController` toe aan `controllers`, naast de
bestaande `ContractController`.

- [x] **Step 7: Run, verwacht PASS**

```powershell
npx jest --config ./test/jest-e2e.json test/contracten-overzicht.e2e-spec.ts
```

- [x] **Step 8: Volledige e2e-run**

```powershell
npx jest --config ./test/jest-e2e.json
```

- [x] **Step 9: Commit**

```bash
git add src/contract/contracts-overzicht.controller.ts src/contract/contract.module.ts test/contracten-overzicht.e2e-spec.ts test/test-ids.ts
git commit -m "feat(contract): route GET /contracts — tenant-breed overzicht (issue #173)"
```

---

### Taak 3: Backend — `verify:volledig`

- [x] **Step 1**

```powershell
npm run verify:volledig
```

Verwacht: groen. Diagnosticeer en fix elk falen vóór verdergaan (conform
CLAUDE.md, "verify:volledig tussentijds draaien").

- [x] **Step 2: Commit eventuele fixes apart**

```bash
git add -A
git commit -m "fix: verify:volledig-bevindingen na GET /contracts"
```

---

### Taak 4: Frontend — API-client

**Files:**
- Modify: `src/core/services/contractService.ts`
- Modify: `src/core/models/contract.ts`

- [ ] **Step 1: Voeg het nieuwe model toe**

In `src/core/models/contract.ts`, na de bestaande `Contract`-interface:

```ts
export interface ContractTenantBreed extends Contract {
  vendorNaam: string;
}
```

- [ ] **Step 2: Voeg de mock-data toe**

Bekijk `src/data/contract.mock.ts` voor het bestaande `MOCK_CONTRACTEN`-
patroon, en voeg een `vendorNaam`-afgeleide export toe:

```ts
// Onderaan contract.mock.ts, na MOCK_CONTRACTEN:
export const MOCK_CONTRACTEN_TENANT_BREED: ContractTenantBreed[] =
  MOCK_CONTRACTEN.map((c) => ({
    ...c,
    vendorNaam:
      MOCK_VENDORS.find((v) => v.vendorId === c.vendorId)?.name ??
      'Onbekende leverancier',
  }));
```

Controleer vooraf of `MOCK_VENDORS` al geïmporteerd is in dat bestand — zo
niet, voeg `import { MOCK_VENDORS } from './vendor.mock';` toe (pas het pad
aan als het bestand elders staat — zoek met
`Get-ChildItem -Recurse -Filter vendor.mock.ts`).

- [ ] **Step 3: Voeg de service-functie toe**

In `src/core/services/contractService.ts`, na `haalContracten`:

```ts
export async function haalContractenTenantBreed(): Promise<
  ContractTenantBreed[]
> {
  if (gebruiktMockData) {
    return MOCK_CONTRACTEN_TENANT_BREED;
  }

  const antwoord = await haalOp<{ contracten: ContractTenantBreed[] }>(
    '/contracts',
  );
  return antwoord.contracten;
}
```

Voeg `ContractTenantBreed` en `MOCK_CONTRACTEN_TENANT_BREED` toe aan de
bestaande imports bovenaan het bestand.

- [ ] **Step 4: Typecheck**

```powershell
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/core/services/contractService.ts src/core/models/contract.ts src/data/contract.mock.ts
git commit -m "feat(contract): API-client voor het tenant-brede contractenoverzicht"
```

---

### Taak 5: Frontend — `/beheer/contracten`-lijstpagina + sidebar-item

**Files:**
- Create: `src/app/beheer/contracten/page.tsx`
- Modify: `src/shared/components/layout/Sidebar.tsx`
- Test: `e2e/contracten-overzicht.spec.ts`

- [ ] **Step 1: Bekijk het statusfilter-patroon**

```powershell
Get-Content "src/app/beheer/status/page.tsx"
```

Let op regels 115-121 (state), 175-177 (filteren/sorteren), en
298-330 (klikbare badges met `aria-pressed`).

- [ ] **Step 2: Schrijf de falende Playwright-test**

Maak `e2e/contracten-overzicht.spec.ts`, naar het patroon van
`e2e/tenant-leden.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

/**
 * /beheer/contracten (issue #173): tenant-breed contractenoverzicht, en de
 * navigatie naar het leveranciersscherm met een uitgeklapt contract.
 */

const COOKIE = process.env.BEHEER_COOKIE;
const PAGINA = '/beheer/contracten';

test.describe('Contractenoverzicht', () => {
  test.beforeEach(async ({ context, page }) => {
    test.skip(
      !COOKIE,
      'BEHEER_COOKIE ontbreekt. Draai `npm run verify:volledig` in de backend-repo.',
    );

    const [naam, ...rest] = COOKIE!.split('=');

    await context.addCookies([
      {
        name: naam,
        value: rest.join('='),
        url:
          page.url() !== 'about:blank' ? page.url() : 'http://localhost:3000',
      },
    ]);
  });

  test('is bereikbaar via het menu', async ({ page }) => {
    await page.goto('/beheer');
    await page.getByRole('link', { name: 'Contracten' }).click();
    await expect(page).toHaveURL(/\/beheer\/contracten$/);
  });

  test('toont een tabel met contracten, inclusief leveranciersnaam', async ({
    page,
  }) => {
    await page.goto(PAGINA);
    await expect(page.getByTestId('contract-overzicht-rij').first()).toBeVisible();
  });

  test('filtert op status via klikbare badges', async ({ page }) => {
    await page.goto(PAGINA);
    const eersteFilter = page.getByTestId(/^contract-status-filter-/).first();
    await eersteFilter.click();
    await expect(eersteFilter).toHaveAttribute('aria-pressed', 'true');
  });

  test('een klik op een contract gaat naar het leveranciersscherm, opengeklapt', async ({
    page,
  }) => {
    await page.goto(PAGINA);
    const eersteRij = page.getByTestId('contract-overzicht-rij').first();
    await eersteRij.click();

    await expect(page).toHaveURL(/\/beheer\/leveranciers\/[^/]+\?contract=/);
    await expect(page.getByTestId('contract-detail')).toBeVisible();
  });
});
```

- [ ] **Step 3: Run, verwacht FAIL**

```powershell
npx playwright test e2e/contracten-overzicht.spec.ts
```

Verwacht: FAIL — pagina en menu-item bestaan nog niet.

- [ ] **Step 4: Bouw de pagina**

Maak `src/app/beheer/contracten/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { haalContractenTenantBreed } from '@/core/services/contractService';
import type { ContractTenantBreed } from '@/core/models/contract';
import { AppLayout } from '@/shared/components/layout/AppLayout';

const STATUS_LABEL: Record<string, string> = {
  actief: 'Actief',
  verlopen: 'Verlopen',
  opgezegd: 'Opgezegd',
};

const STATUS_KLEUR: Record<string, string> = {
  actief: 'bg-green-100 text-green-800',
  verlopen: 'bg-red-100 text-red-800',
  opgezegd: 'bg-slate-100 text-slate-700',
};

function dagenTotEinde(endDate: string | null): {
  tekst: string;
  klasse: string;
} | null {
  if (!endDate) return null;
  const dagen = Math.round(
    (new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  if (dagen < 0) {
    return { tekst: `${Math.abs(dagen)}d verlopen`, klasse: 'text-red-700' };
  }
  if (dagen <= 90) {
    return { tekst: `${dagen}d resterend`, klasse: 'text-amber-700' };
  }
  return { tekst: `${dagen}d resterend`, klasse: 'text-ink-muted' };
}

export default function ContractenOverzichtPagina() {
  const router = useRouter();
  const [contracten, setContracten] = useState<ContractTenantBreed[]>([]);
  const [laden, setLaden] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  useEffect(() => {
    let actief = true;
    void haalContractenTenantBreed().then((c) => {
      if (actief) {
        setContracten(c);
        setLaden(false);
      }
    });
    return () => {
      actief = false;
    };
  }, []);

  const statussen = [...new Set(contracten.map((c) => c.statusCode).filter(Boolean))] as string[];
  const gefilterd = contracten.filter(
    (c) => !statusFilter || c.statusCode === statusFilter,
  );

  return (
    <AppLayout
      titel="Contracten"
      ondertitel={`${gefilterd.length} van ${contracten.length} contracten`}
    >
      {statussen.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {statussen.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() =>
                setStatusFilter((huidig) => (huidig === s ? null : s))
              }
              aria-pressed={statusFilter === s}
              data-testid={`contract-status-filter-${s}`}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-brand-primary text-white'
                  : 'bg-card text-ink-muted hover:bg-surface'
              }`}
            >
              {STATUS_LABEL[s] ?? s}
            </button>
          ))}
        </div>
      )}

      {laden && <p className="text-xs text-ink-muted">Bezig met laden…</p>}

      {!laden && gefilterd.length === 0 && (
        <p className="text-xs text-ink-muted">Geen contracten gevonden.</p>
      )}

      {!laden && gefilterd.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-line bg-card">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface text-ink-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Contract</th>
                <th className="px-3 py-2 font-medium">Leverancier</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Einddatum</th>
                <th className="px-3 py-2 font-medium">Waarde</th>
              </tr>
            </thead>
            <tbody>
              {gefilterd.map((contract) => {
                const indicator = dagenTotEinde(contract.endDate);
                return (
                  <tr
                    key={contract.contractId}
                    data-testid="contract-overzicht-rij"
                    onClick={() =>
                      router.push(
                        `/beheer/leveranciers/${contract.vendorId}?contract=${contract.contractId}`,
                      )
                    }
                    className="cursor-pointer border-t border-line hover:bg-surface"
                  >
                    <td className="px-3 py-2 font-medium text-ink">
                      {contract.name}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/beheer/leveranciers/${contract.vendorId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-brand-primary hover:underline"
                      >
                        {contract.vendorNaam}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {contract.statusCode && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            STATUS_KLEUR[contract.statusCode] ??
                            'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {STATUS_LABEL[contract.statusCode] ??
                            contract.statusCode}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div>{contract.endDate ?? '—'}</div>
                      {indicator && (
                        <div className={`text-[10px] ${indicator.klasse}`}>
                          {indicator.tekst}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-ink-muted">
                      {contract.valueEur ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppLayout>
  );
}
```

- [ ] **Step 5: Voeg het sidebar-item toe**

In `src/shared/components/layout/Sidebar.tsx`, importeer een passend icoon
(bijv. `FileSignature` uit `lucide-react`) en voeg toe aan `MENU`, tussen
Leveranciers en Vragenlijsten:

```ts
  {
    href: '/beheer/contracten',
    label: 'Contracten',
    icon: FileSignature,
  },
```

Geen `vereistRol` — zelfde afweging als de andere lijst-items (lezen mag
iedereen, de backend bepaalt de echte grens).

- [ ] **Step 6: Run, verwacht PASS voor de eerste drie tests**

```powershell
npx playwright test e2e/contracten-overzicht.spec.ts -g "bereikbaar|tabel|filtert"
```

De vierde test (klik → leveranciersscherm) faalt hier nog — dat is Taak 6.

- [ ] **Step 7: Commit**

```bash
git add src/app/beheer/contracten/page.tsx src/shared/components/layout/Sidebar.tsx e2e/contracten-overzicht.spec.ts
git commit -m "feat(contract): lijstpagina /beheer/contracten + sidebar-item"
```

---

### Taak 6: Frontend — uitklappen via query-param op het leveranciersscherm

**Files:**
- Modify: `src/app/beheer/leveranciers/[id]/Contracten.tsx`
- Modify: `src/app/beheer/leveranciers/[id]/page.tsx`

- [ ] **Step 1: Bekijk de huidige `opengeklapt`-state**

Regel 115 in `Contracten.tsx`: `const [opengeklapt, setOpengeklapt] = useState<string | null>(null);`

- [ ] **Step 2: Voeg een prop toe voor de initiële waarde**

In `Contracten.tsx`, pas de functiesignatuur aan:

```tsx
export function Contracten({
  vendorId,
  contactenVanVendor,
  onContactpersoonAangemaakt,
  scrollHaakId = 'contracten-sectie',
  initieelOpengeklapt = null,
}: {
  vendorId: string;
  contactenVanVendor: Contactpersoon[];
  onContactpersoonAangemaakt: () => void | Promise<void>;
  scrollHaakId?: string;
  initieelOpengeklapt?: string | null;
}) {
  const [contracten, setContracten] = useState<Contract[]>([]);
  const [laden, setLaden] = useState(true);
  const [gebruikers, setGebruikers] = useState<
    { userId: string; naam: string }[]
  >([]);
  const [opengeklapt, setOpengeklapt] = useState<string | null>(
    initieelOpengeklapt,
  );
```

(Vervang alleen de `useState<string | null>(null)`-regel voor
`opengeklapt` en de functiesignatuur; de rest van het component blijft
ongewijzigd.)

- [ ] **Step 3: Voeg auto-scroll toe wanneer er een initiële waarde is**

Direct na de bestaande `useEffect(() => { void laad(); }, [laad]);`, voeg
een tweede `useEffect` toe:

```tsx
  useEffect(() => {
    if (initieelOpengeklapt) {
      document
        .getElementById(scrollHaakId)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // Eenmalig bij het laden van de pagina — geen dependency op
    // initieelOpengeklapt zelf, want die verandert na de eerste render niet
    // (de gebruiker klikt niet twee keer op dezelfde link binnen één sessie
    // van dit component).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 4: Geef de query-param door vanuit het leveranciersscherm**

`src/app/beheer/leveranciers/[id]/page.tsx` is al een Client Component
(`'use client'` op regel 1, gebruikt al `useParams`/`useRouter` uit
`next/navigation`), dus `useSearchParams` is direct bruikbaar.

Voeg toe aan de bestaande import van `next/navigation`:

```tsx
import { useParams, useRouter, useSearchParams } from 'next/navigation';
```

En binnen de component-functie, vóór de `return`:

```tsx
  const zoekParams = useSearchParams();
  const initieelContractId = zoekParams.get('contract');
```

Zoek de `<Contracten`-aanroep (rond regel 154) en breid hem uit:

```tsx
              <Contracten
                vendorId={vendor.vendorId}
                contactenVanVendor={vendor.contacten}
                onContactpersoonAangemaakt={laad}
                scrollHaakId={CONTRACTEN_SECTIE_ID}
                initieelOpengeklapt={initieelContractId}
              />
```

- [ ] **Step 5: Run de Playwright-test uit Taak 5, nu volledig**

```powershell
npx playwright test e2e/contracten-overzicht.spec.ts
```

Verwacht: alle 4 tests slagen.

- [ ] **Step 6: Volledige Playwright-suite (regressie-check)**

```powershell
npx playwright test
```

- [ ] **Step 7: Typecheck, format, lint**

```powershell
npx tsc --noEmit
npm run format
npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add "src/app/beheer/leveranciers/[id]/Contracten.tsx" "src/app/beheer/leveranciers/[id]/page.tsx"
git commit -m "feat(contract): contract opengeklapt via ?contract=-query-param op het leveranciersscherm"
```

---

### Taak 7: Frontend — "andere contracten bij deze leverancier"

**Files:**
- Modify: `src/app/beheer/leveranciers/[id]/Contracten.tsx`
- Modify: `e2e/contracten.spec.ts` (bestaand bestand, nieuwe test toevoegen)

- [ ] **Step 1: Bekijk waar het uitgeklapte contract-detail eindigt**

In `Contracten.tsx`, de `ContractRijen`-functie: het blok na
`<SurveyTemplateKoppelingBlok .../>` (rond regel 600-604), binnen de
`{opengeklapt && (...)}`-tak.

- [ ] **Step 2: Schrijf de falende test**

Voeg toe aan `e2e/contracten.spec.ts` (zoek eerst het bestaande
`maakEnOpen()`-hulpfunctiepatroon in dat bestand):

```ts
test('toont andere contracten bij dezelfde leverancier', async ({ page }) => {
  const { vendorId } = await maakEnOpen(page);

  // Tweede contract bij dezelfde leverancier aanmaken.
  await page.getByTestId('open-nieuw-contract').click();
  await page.locator('#nieuw-contract-name').fill(`Tweede contract ${Date.now()}`);
  await page.getByTestId('voeg-contract-toe').click();

  // Eerste contractrij uitklappen — "andere contracten" moet het tweede tonen.
  await page.getByTestId('contract-rij').first().click();
  await expect(page.getByTestId('gerelateerd-contract')).toHaveCount(1);
});
```

Pas de exacte opzet aan naar wat `maakEnOpen()` in dat bestand werkelijk
teruggeeft (bekijk het bestand eerst — de exacte returnwaarde is niet
gegarandeerd `{ vendorId }`).

- [ ] **Step 3: Run, verwacht FAIL**

```powershell
npx playwright test e2e/contracten.spec.ts -g "andere contracten"
```

- [ ] **Step 4: Implementeer**

In `Contracten.tsx`, geef `ContractRijen` de volledige contractenlijst mee
zodat het de overige kan filteren. Pas de aanroep in `Contracten` aan:

```tsx
              <ContractRijen
                key={contract.contractId}
                contract={contract}
                vendorId={vendorId}
                contactenVanVendor={contactenVanVendor}
                gebruikers={gebruikers}
                opengeklapt={opengeklapt === contract.contractId}
                andereContracten={contracten.filter(
                  (c) => c.contractId !== contract.contractId,
                )}
                onKlik={() =>
                  setOpengeklapt((v) =>
                    v === contract.contractId ? null : contract.contractId,
                  )
                }
                onKlikAnder={(contractId) => setOpengeklapt(contractId)}
                onGewijzigd={laad}
                onContactpersoonAangemaakt={onContactpersoonAangemaakt}
              />
```

Pas de `ContractRijen`-signatuur aan:

```tsx
function ContractRijen({
  contract,
  vendorId,
  contactenVanVendor,
  gebruikers,
  opengeklapt,
  andereContracten,
  onKlik,
  onGewijzigd,
  onContactpersoonAangemaakt,
}: {
  contract: Contract;
  vendorId: string;
  contactenVanVendor: Contactpersoon[];
  gebruikers: { userId: string; naam: string }[];
  opengeklapt: boolean;
  andereContracten: Contract[];
  onKlik: () => void;
  onGewijzigd: () => void | Promise<void>;
  onContactpersoonAangemaakt: () => void | Promise<void>;
}) {
```

Voeg, direct na `<SurveyTemplateKoppelingBlok .../>` binnen het
`{opengeklapt && (...)}`-blok, toe:

```tsx
            {andereContracten.length > 0 && (
              <div className="mt-4 border-t border-line pt-3">
                <p className="mb-2 text-xs font-medium text-ink">
                  Andere contracten bij deze leverancier
                </p>
                <ul className="flex flex-col gap-1">
                  {andereContracten.map((c) => (
                    <li key={c.contractId}>
                      <button
                        type="button"
                        onClick={() => onKlikAnder(c.contractId)}
                        data-testid="gerelateerd-contract"
                        className="text-xs text-brand-primary hover:underline"
                      >
                        {c.name}
                        {c.statusCode && ` — ${CONTRACT_STATUS_LABEL[c.statusCode] ?? c.statusCode}`}
                        {c.endDate && ` (t/m ${c.endDate})`}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
```

`onKlikAnder` is een nieuwe, verplichte prop op `ContractRijen` — voeg hem
toe aan de destructuring en het type-object uit Step 4 hierboven:

```tsx
function ContractRijen({
  contract,
  vendorId,
  contactenVanVendor,
  gebruikers,
  opengeklapt,
  andereContracten,
  onKlik,
  onKlikAnder,
  onGewijzigd,
  onContactpersoonAangemaakt,
}: {
  contract: Contract;
  vendorId: string;
  contactenVanVendor: Contactpersoon[];
  gebruikers: { userId: string; naam: string }[];
  opengeklapt: boolean;
  andereContracten: Contract[];
  onKlik: () => void;
  onKlikAnder: (contractId: string) => void;
  onGewijzigd: () => void | Promise<void>;
  onContactpersoonAangemaakt: () => void | Promise<void>;
}) {
```

Geef hem door vanuit `Contracten` (dezelfde plek als `andereContracten` in
Step 4 hierboven), zodat een klik op een gerelateerd contract het huidige
inklapt en het geklikte contract openklapt:

```tsx
                onKlikAnder={(contractId) => setOpengeklapt(contractId)}
```

- [ ] **Step 5: Run, verwacht PASS**

```powershell
npx playwright test e2e/contracten.spec.ts -g "andere contracten"
```

- [ ] **Step 6: Volledige Playwright-suite**

```powershell
npx playwright test
```

- [ ] **Step 7: Typecheck, format, lint**

```powershell
npx tsc --noEmit
npm run format
npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add "src/app/beheer/leveranciers/[id]/Contracten.tsx" e2e/contracten.spec.ts
git commit -m "feat(contract): 'andere contracten bij deze leverancier' binnen het uitgeklapte contract"
```

---

### Taak 8: Volledige verificatie

- [ ] **Step 1: Backend**

```powershell
cd C:\DEV\Work\MCM2
npm run verify:volledig
```

- [ ] **Step 2: Frontend, los**

```powershell
cd ..\MCM2-frontend
npm run format:check
npm run lint
npx tsc --noEmit
npx playwright test
```

- [ ] **Step 3: Handmatige doorloop**

```powershell
cd ..\MCM2
npm run demo
```

Log in, ga naar "Contracten" in het menu, controleer de lijst, filter op
status, klik een contract aan en bevestig dat het leveranciersscherm opent
met dat contract al uitgeklapt en gescrold in beeld.

- [ ] **Step 4: `docs/STATUS.md` bijwerken**

Korte entry: issue #173/#171 gebouwd, backend + frontend, welke branch,
verify-status.

---

## Na dit plan — REQUIRED: superpowers:finishing-a-development-branch

Volg die skill voor de opties in **beide** repositories.

**Herinnering:** een verzoek om dit "in productie te krijgen" impliceert
eerst `npm run deploy:staging` met een zichtbare rookproef, vóór de
`productie-aws.yml`-workflow start (zie memory
`mcm2-productie-impliceert-staging-eerst`).
