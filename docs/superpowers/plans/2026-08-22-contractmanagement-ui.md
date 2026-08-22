# Contractmanagement UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De contractmanagement-backend (migratie 0027, `ContractModule`)
bruikbaar maken vanuit het scherm: een `Contracten`-sectie op
`/beheer/leveranciers/[id]` in `MCM2-frontend`, plus de twee ontbrekende
backend-routes die dat scherm nodig heeft (tenant-gebruikers,
survey-templatekoppeling). Afgesloten met een **verplichte preview
conform het bestaande protocol**, niet met "de tests zijn groen".

**Architecture:** Backend-uitbreidingen volgen exact het patroon van
`VendorController`/`ContractController` (raw SQL, `withTenant`,
`RolGuard`). Frontend volgt exact het patroon van
`Contactpersonen`/`ContactRij` op hetzelfde scherm — inline bewerken, een
los CRUD-blok voor de survey-koppeling, en de bestaande mock/live-schakelaar
(`NEXT_PUBLIC_API_URL`) zodat het scherm ook zonder draaiende backend te
beoordelen is.

**Tech Stack:** NestJS/Drizzle (backend, dit repo), Next.js/React/Playwright
(frontend, `MCM2-frontend`), Jest voor backend-e2e.

**Specs:**
- `docs/superpowers/specs/2026-08-22-contractmanagement-design.md` (datamodel)
- `docs/superpowers/specs/2026-08-22-contractmanagement-ui-design.md` (dit plan)

**Twee repo's.** Taken 1–4 zijn in `c:\DEV\Work\MCM2` (backend), taken 5–9
in `c:\DEV\Work\MCM2-frontend`. Beide op een eigen feature-branch — niet
tegelijk op main. Taak 10 is de preview, taak 11 het samenvoegen.

---

## Task 1: `GET /tenant/gebruikers` — lijst voor de contractbeheerder-dropdown

**Files (backend):**
- Modify: `src/tenant/tenant.service.ts`
- Modify: `src/tenant/tenant.controller.ts`
- Test: `test/tenant-gebruikers.e2e-spec.ts`
- Modify: `test/test-ids.ts`

- [ ] **Step 1: Voeg een testblok toe aan `test/test-ids.ts`**

Na het `'contract-routes'`-blok:

```typescript
  'tenant-gebruikers': {
    tenant: id('2a'),
    adminUser: id('2b'),
    reviewerUser: id('2c'),
    andereTenant: id('2d'),
  },
```

- [ ] **Step 2: Controleer op botsingen**

```bash
npx jest test/test-ids.spec.ts
```

Verwacht: PASS. Bij een botsing: kies het eerstvolgende vrije tweeletter-merk
(zoek met `grep -oE "id\\('[0-9a-f]{2}'\\)" test/test-ids.ts | sort -u`),
niet zomaar een waarde die toevallig onbezet líjkt.

- [ ] **Step 3: Schrijf de service-methode**

In `src/tenant/tenant.service.ts`, toevoegen aan de bestaande
`TenantService`-klasse:

```typescript
export interface TenantGebruiker {
  userId: string;
  naam: string;
}
```

```typescript
  /**
   * De gebruikers van de eigen tenant, voor een keuzelijst (bv. de
   * contractbeheerder-dropdown). Alleen id en naam — geen e-mailadres of rol,
   * dat is meer dan een dropdown nodig heeft.
   */
  async gebruikers(tenantId: string): Promise<TenantGebruiker[]> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const resultaat = await tx.execute<{
          user_id: string;
          full_name: string;
        }>(
          sql`SELECT user_id, full_name FROM clm."user"
             WHERE deleted_at IS NULL
             ORDER BY full_name`,
        );

        return resultaat.rows.map((r) => ({
          userId: r.user_id,
          naam: r.full_name,
        }));
      },
      'medewerker',
    );
  }
```

- [ ] **Step 4: Voeg de route toe aan `TenantController`**

```typescript
  /** De gebruikers van de eigen tenant, voor een keuzelijst. */
  @Get('gebruikers')
  async gebruikersLijst(@Req() request: RequestMetSessie) {
    const gebruikers = await this.tenants.gebruikers(request.sessie!.tenantId);
    return { gebruikers };
  }
```

Geen `@VereistRol`: lezen mag iedereen met een sessie, zelfde als
`GET /tenant/instellingen` hierboven — het is een keuzelijst, geen
gevoelige data.

- [ ] **Step 5: Compileer**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Schrijf de e2e-test**

`test/tenant-gebruikers.e2e-spec.ts`, volgt het patroon van
`contract-routes.e2e-spec.ts` (zie dat bestand voor de volledige
`beforeAll`/`afterAll`-opzet met `migratieUrl()`/`verwijderTestdata`).
Kernassertions:

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

const { tenant, adminUser, reviewerUser, andereTenant } =
  TEST_IDS['tenant-gebruikers'];

const STEMPEL = Date.now();
const SUBJECT_ADMIN = `oid-tg-admin-${STEMPEL}`;
const SUBJECT_REVIEWER = `oid-tg-reviewer-${STEMPEL}`;

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
    await migratieClient.query(
      'DELETE FROM clm.tenant_membership WHERE tenant_id = $1',
      [t],
    );
    await migratieClient.query('DELETE FROM clm."user" WHERE tenant_id = $1', [
      t,
    ]);
    await migratieClient.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [
      t,
    ]);
    await migratieClient.query('COMMIT');
  }
}

describe('Tenant-gebruikers (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let migratieClient: Client;
  let adminCookie: string;
  const cookieNaam = cookieInstellingen().naam;

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
      [tenant, 'tenant-gebruikers-test'],
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
  });

  afterAll(async () => {
    await app.close();
    await opruimen(migratieClient);
    await client.end();
    await migratieClient.end();
  });

  it('geeft de gebruikers van de eigen tenant, met naam', async () => {
    const respons = await request(server)
      .get('/tenant/gebruikers')
      .set('Cookie', adminCookie);

    expect(respons.status).toBe(200);
    const namen = (
      respons.body as { gebruikers: { naam: string }[] }
    ).gebruikers.map((g) => g.naam);
    expect(namen).toContain('Anna Admin');
    expect(namen).toContain('Rob Reviewer');
  });

  it('reviewer mag ook lezen — het is een keuzelijst, geen gevoelige data', async () => {
    const sessies = app.get(SessieService);
    const reviewerSessie = await sessies.aanmaken(SUBJECT_REVIEWER);
    const reviewerCookie = `${cookieNaam}=${reviewerSessie!.token}`;

    const respons = await request(server)
      .get('/tenant/gebruikers')
      .set('Cookie', reviewerCookie);

    expect(respons.status).toBe(200);
  });

  it('geeft 401 zonder sessie', async () => {
    await request(server).get('/tenant/gebruikers').expect(401);
  });
});
```

- [ ] **Step 7: Draai deze suite geïsoleerd tegen een wegwerpcontainer**

Volg `docs/runbooks/commandos-en-omgeving.md` voor het opzetten van de
container (zie het vorige plan, Task 1 Step 3, voor het volledige
commando-recept). Daarna:

```bash
npx jest test-ids
DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55440/postgres" \
MIGRATION_DATABASE_URL="postgresql://clm_migrator:pw@localhost:55440/postgres" \
npx jest --config test/jest-e2e.json --forceExit tenant-gebruikers
```

Verwacht: alle tests slagen.

- [ ] **Step 8: Commit**

```bash
git add src/tenant/tenant.service.ts src/tenant/tenant.controller.ts test/tenant-gebruikers.e2e-spec.ts test/test-ids.ts
git commit -m "feat(tenant): GET /tenant/gebruikers — lijst voor keuzelijsten

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Survey-templatekoppeling — routes op `clm.contract_survey_template`

**Files (backend):**
- Modify: `src/contract/contract.service.ts`
- Modify: `src/contract/contract-invoer.ts`
- Modify: `src/contract/contract.controller.ts`
- Test: uitbreiding van `test/contract-routes.e2e-spec.ts`

- [ ] **Step 1: Voeg service-methodes toe aan `ContractService`**

In `src/contract/contract.service.ts`:

```typescript
export interface SurveyTemplateKoppeling {
  templateIds: string[];
}
```

```typescript
  /** Welke vragenlijst-templates aan dit contract gekoppeld zijn. */
  async surveyTemplates(
    tenantId: string,
    vendorId: string,
    contractId: string,
  ): Promise<SurveyTemplateKoppeling | null> {
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

        const resultaat = await tx.execute<{ survey_template_id: string }>(
          sql`SELECT survey_template_id FROM clm.contract_survey_template
             WHERE contract_id = ${contractId}
             ORDER BY created_at`,
        );

        return {
          templateIds: resultaat.rows.map((r) => r.survey_template_id),
        };
      },
      'medewerker',
    );
  }

  /**
   * Vervangt de volledige set gekoppelde templates in één transactie.
   *
   * Geen diff (verwijderen wat wegvalt, toevoegen wat nieuw is): bij een klein
   * aantal templates per contract is "alles weg, alles opnieuw" even correct
   * en eenvoudiger. Zie spec §3.2.
   */
  async zetSurveyTemplates(
    tenantId: string,
    vendorId: string,
    contractId: string,
    templateIds: string[],
  ): Promise<SurveyTemplateKoppeling | null> {
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

        await tx.execute(
          sql`DELETE FROM clm.contract_survey_template
             WHERE contract_id = ${contractId}`,
        );

        for (const templateId of templateIds) {
          await tx.execute(
            sql`INSERT INTO clm.contract_survey_template
                  (contract_id, survey_template_id, tenant_id)
                VALUES (${contractId}, ${templateId}, ${tenantId})`,
          );
        }

        this.logger.log(
          `Survey-templates gekoppeld aan contract ${contractId}: ${templateIds.length}.`,
        );

        return { templateIds };
      },
      'medewerker',
    );
  }
```

- [ ] **Step 2: Voeg invoer-validatie toe aan `contract-invoer.ts`**

```typescript
/** Leest de body van PUT .../contracts/:id/survey-templates. */
export function leesSurveyTemplateKoppeling(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Er is geen koppeling meegestuurd.');
  }

  const ruw = body as Record<string, unknown>;

  if (!('templateIds' in ruw)) {
    throw new InvoerFout('templateIds', 'templateIds is verplicht.');
  }

  if (!Array.isArray(ruw.templateIds)) {
    throw new InvoerFout('templateIds', 'templateIds moet een lijst zijn.');
  }

  const UUID_PATROON =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  for (const waarde of ruw.templateIds) {
    if (typeof waarde !== 'string' || !UUID_PATROON.test(waarde)) {
      throw new InvoerFout('templateIds', 'Een van de id\'s is ongeldig.');
    }
  }

  // Dubbele ids negeren, niet weigeren: een dubbelklik in de checkbox-lijst
  // is een UI-detail, geen fout van de gebruiker.
  return [...new Set(ruw.templateIds as string[])];
}
```

- [ ] **Step 3: Voeg routes toe aan `ContractController`**

```typescript
  @Get(':id/survey-templates')
  async surveyTemplates(
    @Req() request: RequestMetSessie,
    @Param('vendorId') vendorId: string,
    @Param('id') id: string,
  ) {
    const sessie = request.sessie!;

    const koppeling = await this.contracts.surveyTemplates(
      sessie.tenantId,
      leesUuid(vendorId),
      leesUuid(id),
    );

    if (!koppeling) {
      throw new NotFoundException('Contract niet gevonden.');
    }

    return koppeling;
  }

  @Put(':id/survey-templates')
  @VereistRol('admin')
  async zetSurveyTemplates(
    @Req() request: RequestMetSessie,
    @Param('vendorId') vendorId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let templateIds: string[];

    try {
      templateIds = leesSurveyTemplateKoppeling(body);
    } catch (err) {
      throw alsHttpFout(err);
    }

    const koppeling = await this.contracts
      .zetSurveyTemplates(sessie.tenantId, leesUuid(vendorId), leesUuid(id), templateIds)
      .catch(alsRefFout);

    if (!koppeling) {
      throw new NotFoundException('Contract niet gevonden.');
    }

    return koppeling;
  }
```

Voeg `Put` toe aan de `@nestjs/common`-import bovenaan het bestand, en
`leesSurveyTemplateKoppeling` aan de import uit `./contract-invoer`.

- [ ] **Step 4: Compileer**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Breid `test/contract-routes.e2e-spec.ts` uit**

Voeg toe aan de bestaande suite (na de laatste `it(...)`):

```typescript
  it('koppelt en ontkoppelt vragenlijst-templates aan een contract', async () => {
    // Eerst een template aanmaken om aan te koppelen — direct via de
    // database, want dit is geen backendtaak van deze suite.
    const templateResultaat = await client.query<{ template_id: string }>(
      `INSERT INTO clm.survey_template (tenant_id, name, version)
       VALUES ($1, $2, 1) RETURNING template_id`,
      [tenant, `Testvragenlijst-${STEMPEL}`],
    );
    const templateId = templateResultaat.rows[0].template_id;

    const aangemaakt = await request(server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie)
      .send({ name: 'Contract met vragenlijst' });
    const contractId = alsContract(aangemaakt.body).contractId;

    const gekoppeld = await request(server)
      .put(`/vendors/${vendorId}/contracts/${contractId}/survey-templates`)
      .set('Cookie', adminCookie)
      .send({ templateIds: [templateId] });

    expect(gekoppeld.status).toBe(200);
    expect(
      (gekoppeld.body as { templateIds: string[] }).templateIds,
    ).toEqual([templateId]);

    const opgehaald = await request(server)
      .get(`/vendors/${vendorId}/contracts/${contractId}/survey-templates`)
      .set('Cookie', adminCookie);

    expect(
      (opgehaald.body as { templateIds: string[] }).templateIds,
    ).toEqual([templateId]);

    // Ontkoppelen: lege lijst is geldig.
    const ontkoppeld = await request(server)
      .put(`/vendors/${vendorId}/contracts/${contractId}/survey-templates`)
      .set('Cookie', adminCookie)
      .send({ templateIds: [] });

    expect(ontkoppeld.status).toBe(200);
    expect(
      (ontkoppeld.body as { templateIds: string[] }).templateIds,
    ).toEqual([]);
  });

  it('reviewer kan geen templates koppelen (403)', async () => {
    const aangemaakt = await request(server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie)
      .send({ name: 'Contract zonder reviewer-koppeling' });
    const contractId = alsContract(aangemaakt.body).contractId;

    const respons = await request(server)
      .put(`/vendors/${vendorId}/contracts/${contractId}/survey-templates`)
      .set('Cookie', reviewerCookie)
      .send({ templateIds: [] });

    expect(respons.status).toBe(403);
  });
```

Ook: voeg `DELETE FROM clm.contract_survey_template WHERE tenant_id = $1`
en `DELETE FROM clm.survey_template WHERE tenant_id = $1` toe aan
`verwijderTestdata` in datzelfde bestand, vóór de `DELETE FROM clm.contract`
-regel (foreign key: `contract_survey_template` verwijst naar `contract`,
dus moet eerst weg).

- [ ] **Step 6: Draai de volledige suite geïsoleerd**

```bash
DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55440/postgres" \
MIGRATION_DATABASE_URL="postgresql://clm_migrator:pw@localhost:55440/postgres" \
npx jest --config test/jest-e2e.json --forceExit contract-routes
```

Verwacht: alle tests slagen (de 8 bestaande plus de 2 nieuwe).

- [ ] **Step 7: Commit**

```bash
git add src/contract/contract.service.ts src/contract/contract-invoer.ts src/contract/contract.controller.ts test/contract-routes.e2e-spec.ts
git commit -m "feat(contract): routes voor de survey-templatekoppeling

GET/PUT .../contracts/:id/survey-templates. PUT vervangt de hele set in
één transactie, conform spec §3.2.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Namen in plaats van alleen id's op `ContractDetail`

**Files (backend):**
- Modify: `src/contract/contract.service.ts`

- [ ] **Step 1: Breid `ContractDetail` en `ContractSamenvatting` uit**

```typescript
export interface ContractSamenvatting {
  contractId: string;
  name: string;
  contractNumber: string | null;
  statusCode: string | null;
  startDate: string | null;
  endDate: string | null;
  vendorContactNaam: string | null;
  ownerGebruikerNaam: string | null;
  createdAt: string;
}
```

En hetzelfde paar velden op `ContractDetail`.

- [ ] **Step 2: Pas de queries aan met een LEFT JOIN**

In `lijst()`:

```typescript
        const resultaat = await tx.execute<ContractRij>(
          sql`SELECT c.contract_id, c.name, c.contract_number, c.status_code,
                     c.start_date, c.end_date, c.created_at,
                     vc.full_name AS vendor_contact_naam,
                     u.full_name AS owner_naam
                FROM clm.contract c
                LEFT JOIN clm.vendor_contact vc ON vc.contact_id = c.vendor_contact_id
                LEFT JOIN clm."user" u ON u.user_id = c.owner_user_id
               WHERE c.vendor_id = ${vendorId} AND c.deleted_at IS NULL
               ORDER BY c.created_at DESC`,
        );
```

Update `ContractRij` met `vendor_contact_naam: string | null` en
`owner_naam: string | null`, en de mapping in de return met
`vendorContactNaam: r.vendor_contact_naam` /
`ownerGebruikerNaam: r.owner_naam`.

Zelfde patroon in `detailBinnenTransactie()`.

- [ ] **Step 3: Compileer, en draai de bestaande contract-routes-suite opnieuw**

```bash
npx tsc --noEmit
DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55440/postgres" \
MIGRATION_DATABASE_URL="postgresql://clm_migrator:pw@localhost:55440/postgres" \
npx jest --config test/jest-e2e.json --forceExit contract-routes
```

Verwacht: nog steeds alle tests groen (de bestaande assertions checken geen
volledige objectgelijkheid, dus de extra velden breken niets).

- [ ] **Step 4: Commit**

```bash
git add src/contract/contract.service.ts
git commit -m "feat(contract): naam van contactpersoon en beheerder in lijst en detail

Voorkomt een n+1-lookup per rij in de UI, zelfde reden als
VendorService.lijst() zijn subquery.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Backend volledig verifiëren vóór de frontend begint

**Files:** geen wijzigingen — alleen controleren.

- [ ] **Step 1: Volledige e2e-run tegen de wegwerpcontainer**

```bash
DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55440/postgres" \
MIGRATION_DATABASE_URL="postgresql://clm_migrator:pw@localhost:55440/postgres" \
npx jest --config test/jest-e2e.json --forceExit
```

Verwacht: alle suites groen, inclusief `schema-conformiteit` en
`rechten-contract` (die laatste vangt een vergeten REVOKE/GRANT — zie
§1b van `MCM2-CLAUDE.md`, geschreven na precies deze fout op migratie 0027).

- [ ] **Step 2: `npm run verify:volledig`**

Zelfde procedure als in het vorige plan (Task 7): controleer eerst of
poort 5001/3000 vrij zijn (`netstat -ano | findstr ":5001 "` /
`":3000 "`), sluit een eigen achtergebleven dev-server af indien nodig, en
draai:

```bash
npm run verify:volledig
```

Dit bouwt ook een frontend-image uit de **huidige** `MCM2-frontend`-checkout
— zorg dat die op `main` staat en actueel is
(`cd ../MCM2-frontend && git checkout main && git pull`), anders test deze
stap een oude frontend-stand.

Verwacht: groen. Als `backup-verwachting.json` rood geeft (nieuwe tabellen
niet genoemd): dat gebeurt hier niet meer, want dat is al gedaan in het
vorige plan — maar controleer het toch, voor het geval er ondertussen een
andere migratie is bijgekomen.

---

## Task 5: Frontend — modellen en service voor contracten

**Files (`MCM2-frontend`):**
- Create: `src/core/models/contract.ts`
- Create: `src/core/services/contractService.ts`
- Create: `src/data/contract.mock.ts`

Volgt exact het patroon van `vendor.ts`/`vendorService.ts`/`vendor.mock.ts`.

- [ ] **Step 1: Schrijf `src/core/models/contract.ts`**

```typescript
/**
 * Contracten bij een leverancier, zoals de beheerkant ze kent.
 *
 * Bewust een eigen model, geen kopie van het databaseschema — zelfde
 * redenering als vendor.ts.
 */

export interface Contract {
  contractId: string;
  vendorId: string;
  name: string;
  contractNumber: string | null;
  vendorContactId: string | null;
  vendorContactNaam: string | null;
  ownerUserId: string | null;
  ownerGebruikerNaam: string | null;
  statusCode: string | null;
  valueEur: string | null;
  startDate: string | null;
  endDate: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string | null;
}

/** Wat het aanmaak-/bewerkformulier opstuurt. */
export interface ContractInvoer {
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

export type ContractSchrijfResultaat =
  | { ok: true; waarde: Contract }
  | { ok: false; soort: 'veld'; veld: string; melding: string }
  | { ok: false; soort: 'geenRechten'; melding: string }
  | { ok: false; soort: 'algemeen'; melding: string };

/** Een gebruiker van de tenant, voor de contractbeheerder-dropdown. */
export interface TenantGebruiker {
  userId: string;
  naam: string;
}

/** Eén vragenlijst-template, voor de checkbox-lijst. */
export interface SurveyTemplateOptie {
  templateId: string;
  naam: string;
}
```

- [ ] **Step 2: Schrijf `src/data/contract.mock.ts`**

```typescript
import type { Contract } from '@/core/models/contract';

export const MOCK_CONTRACTEN: Contract[] = [
  {
    contractId: 'mock-contract-1',
    vendorId: 'mock-vendor-1',
    name: 'Hosting 2024-2027',
    contractNumber: 'ERP-4711',
    vendorContactId: null,
    vendorContactNaam: null,
    ownerUserId: null,
    ownerGebruikerNaam: 'Anna Admin',
    statusCode: 'actief',
    valueEur: '12000.00',
    startDate: '2024-01-01',
    endDate: '2027-12-31',
    note: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
  },
];

export const MOCK_TENANT_GEBRUIKERS = [
  { userId: 'mock-user-1', naam: 'Anna Admin' },
  { userId: 'mock-user-2', naam: 'Rob Reviewer' },
];

export const MOCK_SURVEY_TEMPLATES = [
  { templateId: 'mock-template-1', naam: 'Transdev Annual Vendor IT Risk' },
];
```

- [ ] **Step 3: Schrijf `src/core/services/contractService.ts`**

```typescript
import {
  ApiFout,
  gebruiktMockData,
  haalOp,
  verstuur,
  verwijder,
  wijzig,
} from '@/core/api/client';
import type {
  Contract,
  ContractInvoer,
  ContractSchrijfResultaat,
  SurveyTemplateOptie,
  TenantGebruiker,
} from '@/core/models/contract';
import {
  MOCK_CONTRACTEN,
  MOCK_SURVEY_TEMPLATES,
  MOCK_TENANT_GEBRUIKERS,
} from '@/data/contract.mock';

/** Mock-opslag binnen de sessie — zelfde patroon als vendorService.ts. */
const mockToegevoegd: Contract[] = [];
const mockKoppelingen = new Map<string, string[]>();

function leesVeld(body: unknown): string | null {
  if (body && typeof body === 'object' && 'veld' in body) {
    const veld = (body as { veld: unknown }).veld;
    return typeof veld === 'string' ? veld : null;
  }
  return null;
}

function alsSchrijfResultaat(err: unknown): ContractSchrijfResultaat {
  if (err instanceof ApiFout) {
    if (err.status === 403) {
      return {
        ok: false,
        soort: 'geenRechten',
        melding: 'U heeft geen rechten om dit te wijzigen.',
      };
    }
    const veld = leesVeld(err.body);
    if (veld) {
      return { ok: false, soort: 'veld', veld, melding: err.message };
    }
  }
  return {
    ok: false,
    soort: 'algemeen',
    melding: 'Er ging iets mis. Probeer het opnieuw.',
  };
}

export async function haalContracten(vendorId: string): Promise<Contract[]> {
  if (gebruiktMockData) {
    return [
      ...mockToegevoegd.filter((c) => c.vendorId === vendorId),
      ...MOCK_CONTRACTEN.filter((c) => c.vendorId === vendorId),
    ];
  }

  const antwoord = await haalOp<{ contracten: Contract[] }>(
    `/vendors/${vendorId}/contracts`,
  );
  return antwoord.contracten;
}

export async function maakContractAan(
  vendorId: string,
  invoer: ContractInvoer,
): Promise<ContractSchrijfResultaat> {
  if (gebruiktMockData) {
    const nieuw: Contract = {
      contractId: `mock-nieuw-${Date.now()}`,
      vendorId,
      name: invoer.name ?? '',
      contractNumber: invoer.contractNumber ?? null,
      vendorContactId: invoer.vendorContactId ?? null,
      vendorContactNaam: null,
      ownerUserId: invoer.ownerUserId ?? null,
      ownerGebruikerNaam: null,
      statusCode: invoer.statusCode ?? null,
      valueEur: invoer.valueEur ?? null,
      startDate: invoer.startDate ?? null,
      endDate: invoer.endDate ?? null,
      note: invoer.note ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    mockToegevoegd.unshift(nieuw);
    return { ok: true, waarde: nieuw };
  }

  try {
    const waarde = await verstuur<Contract>(
      `/vendors/${vendorId}/contracts`,
      invoer,
    );
    return { ok: true, waarde };
  } catch (err) {
    return alsSchrijfResultaat(err);
  }
}

export async function wijzigContract(
  vendorId: string,
  contractId: string,
  invoer: ContractInvoer,
): Promise<ContractSchrijfResultaat> {
  if (gebruiktMockData) {
    const bestaand = mockToegevoegd.find((c) => c.contractId === contractId);
    if (bestaand) {
      Object.assign(bestaand, invoer);
      return { ok: true, waarde: bestaand };
    }
    return {
      ok: false,
      soort: 'algemeen',
      melding: 'Mock-contract niet gevonden.',
    };
  }

  try {
    const waarde = await wijzig<Contract>(
      `/vendors/${vendorId}/contracts/${contractId}`,
      invoer,
    );
    return { ok: true, waarde };
  } catch (err) {
    return alsSchrijfResultaat(err);
  }
}

export async function verwijderContract(
  vendorId: string,
  contractId: string,
): Promise<{ ok: true } | { ok: false; melding: string }> {
  if (gebruiktMockData) {
    const idx = mockToegevoegd.findIndex((c) => c.contractId === contractId);
    if (idx >= 0) mockToegevoegd.splice(idx, 1);
    return { ok: true };
  }

  try {
    await verwijder(`/vendors/${vendorId}/contracts/${contractId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiFout) {
      return { ok: false, melding: err.message };
    }
    return { ok: false, melding: 'Er ging iets mis.' };
  }
}

export async function haalTenantGebruikers(): Promise<TenantGebruiker[]> {
  if (gebruiktMockData) {
    return MOCK_TENANT_GEBRUIKERS;
  }
  const antwoord = await haalOp<{ gebruikers: TenantGebruiker[] }>(
    '/tenant/gebruikers',
  );
  return antwoord.gebruikers;
}

export async function haalSurveyTemplates(): Promise<SurveyTemplateOptie[]> {
  if (gebruiktMockData) {
    return MOCK_SURVEY_TEMPLATES;
  }
  const antwoord = await haalOp<{
    vragenlijsten: { templateId: string; naam: string }[];
  }>('/admin/survey/templates');
  return antwoord.vragenlijsten.map((v) => ({
    templateId: v.templateId,
    naam: v.naam,
  }));
}

export async function haalGekoppeldeTemplates(
  vendorId: string,
  contractId: string,
): Promise<string[]> {
  if (gebruiktMockData) {
    return mockKoppelingen.get(contractId) ?? [];
  }
  const antwoord = await haalOp<{ templateIds: string[] }>(
    `/vendors/${vendorId}/contracts/${contractId}/survey-templates`,
  );
  return antwoord.templateIds;
}

export async function zetGekoppeldeTemplates(
  vendorId: string,
  contractId: string,
  templateIds: string[],
): Promise<{ ok: true } | { ok: false; melding: string }> {
  if (gebruiktMockData) {
    mockKoppelingen.set(contractId, templateIds);
    return { ok: true };
  }

  try {
    await wijzig(
      `/vendors/${vendorId}/contracts/${contractId}/survey-templates`,
      { templateIds },
    );
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiFout) {
      return { ok: false, melding: err.message };
    }
    return { ok: false, melding: 'Er ging iets mis.' };
  }
}
```

**Let op bij Step 3:** controleer of `wijzig()` in `client.ts` een PUT of
PATCH stuurt — als het HTTP-werkwoord van `wijzig()` niet overeenkomt met
wat `PUT .../survey-templates` verwacht, gebruik dan `verstuur()` met een
expliciete methode-optie, of voeg een kleine `zetData()`-variant toe aan
`client.ts` die PUT gebruikt. Controleer dit vóór je verdergaat — gok niet.

```bash
grep -n "method:" src/core/api/client.ts
```

- [ ] **Step 4: Compileer**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/core/models/contract.ts src/core/services/contractService.ts src/data/contract.mock.ts
git commit -m "feat(contract): modellen, service en mockdata voor contracten

Zelfde patroon als vendorService.ts: mock/live-schakelaar via
gebruiktMockData, ContractSchrijfResultaat met vier uitkomsten.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Frontend — `Contracten`-sectie op het vendor-detailscherm

**Files (`MCM2-frontend`):**
- Modify: `src/app/beheer/leveranciers/[id]/page.tsx`

- [ ] **Step 1: Voeg de import toe**

```typescript
import type { Contract, ContractInvoer } from '@/core/models/contract';
import {
  haalContracten,
  haalGekoppeldeTemplates,
  haalSurveyTemplates,
  haalTenantGebruikers,
  maakContractAan,
  verwijderContract,
  wijzigContract,
  zetGekoppeldeTemplates,
} from '@/core/services/contractService';
```

- [ ] **Step 2: Plaats de sectie in de hoofdcomponent**

In `LeverancierDetailPagina`, ná `<Contactpersonen ... />` en vóór
`<VendorUitvraagPaneel ... />`:

```typescript
          <Contracten vendorId={vendor.vendorId} contactenVanVendor={vendor.contacten} />
```

- [ ] **Step 3: Bouw het `Contracten`-component**

Volgt het patroon van `Contactpersonen`/`ContactRij` (zie het bestaande
bestand voor het volledige `verwerk()`/`veldFoutVoor()`-hulpapparaat, dat
ongewijzigd hergebruikt wordt):

```typescript
// ── Contracten ───────────────────────────────────────────────────────────

const CONTRACT_STATUS_LABEL: Record<string, string> = {
  actief: 'Actief',
  verlopen: 'Verlopen',
  opgezegd: 'Opgezegd',
};

const CONTRACT_STATUS_KLEUR: Record<string, string> = {
  actief: 'bg-green-100 text-green-800',
  verlopen: 'bg-red-100 text-red-800',
  opgezegd: 'bg-slate-100 text-slate-700',
};

/** Dagen tot (positief) of sinds (negatief) de einddatum. Null zonder datum. */
function dagenTotEinde(endDate: string | null): number | null {
  if (!endDate) return null;
  const verschil =
    new Date(endDate).getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.round(verschil / (1000 * 60 * 60 * 24));
}

function EindeIndicator({ contract }: { contract: Contract }) {
  const dagen = dagenTotEinde(contract.endDate);
  if (dagen === null) return null;

  if (dagen < 0) {
    return (
      <span className="text-xs text-red-700">{Math.abs(dagen)}d verlopen</span>
    );
  }
  if (contract.statusCode === 'actief' && dagen <= 90) {
    return <span className="text-xs text-amber-700">{dagen}d resterend</span>;
  }
  return null;
}

function Contracten({
  vendorId,
  contactenVanVendor,
}: {
  vendorId: string;
  contactenVanVendor: Contactpersoon[];
}) {
  const [contracten, setContracten] = useState<Contract[]>([]);
  const [laden, setLaden] = useState(true);
  const [gebruikers, setGebruikers] = useState<
    { userId: string; naam: string }[]
  >([]);

  const laad = useCallback(async () => {
    setLaden(true);
    try {
      const [c, g] = await Promise.all([
        haalContracten(vendorId),
        haalTenantGebruikers(),
      ]);
      setContracten(c);
      setGebruikers(g);
    } finally {
      setLaden(false);
    }
  }, [vendorId]);

  useEffect(() => {
    void laad();
  }, [laad]);

  return (
    <section
      aria-labelledby="contracten-kop"
      className="mb-8 rounded-lg border border-line bg-card p-6"
    >
      <h2 id="contracten-kop" className="mb-4 text-lg font-semibold text-brand-dark">
        Contracten{' '}
        <span
          data-testid="aantal-contracten"
          className="text-sm font-normal text-ink-muted"
        >
          ({contracten.length})
        </span>
      </h2>

      {laden && <p className="text-sm text-ink-muted">Bezig met laden…</p>}

      {!laden && contracten.length === 0 && (
        <p className="mb-6 text-sm text-ink-muted">
          Er is nog geen contract bij deze leverancier.
        </p>
      )}

      {!laden && contracten.length > 0 && (
        <ul className="mb-6 divide-y divide-line rounded border border-line">
          {contracten.map((contract) => (
            <ContractRij
              key={contract.contractId}
              contract={contract}
              vendorId={vendorId}
              contactenVanVendor={contactenVanVendor}
              gebruikers={gebruikers}
              onGewijzigd={laad}
            />
          ))}
        </ul>
      )}

      <NieuwContractFormulier
        vendorId={vendorId}
        contactenVanVendor={contactenVanVendor}
        gebruikers={gebruikers}
        onAangemaakt={laad}
      />
    </section>
  );
}
```

- [ ] **Step 4: Bouw `ContractRij` — weergave, inline bewerken, verwijderen**

```typescript
function ContractRij({
  contract,
  vendorId,
  contactenVanVendor,
  gebruikers,
  onGewijzigd,
}: {
  contract: Contract;
  vendorId: string;
  contactenVanVendor: Contactpersoon[];
  gebruikers: { userId: string; naam: string }[];
  onGewijzigd: () => void | Promise<void>;
}) {
  const [bewerkt, setBewerkt] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [veldFout, setVeldFout] = useState<{
    veld: string;
    melding: string;
  } | null>(null);
  const [bevestigVerwijderen, setBevestigVerwijderen] = useState(false);
  const [waarden, setWaarden] = useState<ContractInvoer>(() => uitContract(contract));

  function beginBewerken() {
    setWaarden(uitContract(contract));
    setFout(null);
    setVeldFout(null);
    setBewerkt(true);
  }

  async function bewaar(gebeurtenis: React.FormEvent) {
    gebeurtenis.preventDefault();
    setBezig(true);
    setFout(null);
    setVeldFout(null);

    const uitkomst = await wijzigContract(vendorId, contract.contractId, waarden);
    setBezig(false);

    verwerk(uitkomst, {
      opGelukt: async () => {
        setBewerkt(false);
        await onGewijzigd();
      },
      opVeldFout: setVeldFout,
      opAlgemeneFout: setFout,
    });
  }

  async function verwijderDeze() {
    setBezig(true);
    const uitkomst = await verwijderContract(vendorId, contract.contractId);
    setBezig(false);

    if (uitkomst.ok) {
      await onGewijzigd();
      return;
    }
    setBevestigVerwijderen(false);
    setFout(uitkomst.melding);
  }

  if (bewerkt) {
    return (
      <li data-testid="contract-rij" className="px-4 py-4">
        <ContractFormuliervelden
          waarden={waarden}
          onWijzig={setWaarden}
          contactenVanVendor={contactenVanVendor}
          gebruikers={gebruikers}
          veldFout={veldFout}
          idPrefix={`bewerk-${contract.contractId}`}
        />

        <SurveyTemplateKoppelingBlok
          vendorId={vendorId}
          contractId={contract.contractId}
        />

        {fout && (
          <p
            role="alert"
            data-testid="bewerk-contract-fout"
            className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {fout}
          </p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={bewaar}
            disabled={bezig}
            data-testid="bewaar-contract"
            className="rounded bg-brand-primary px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {bezig ? 'Bezig…' : 'Opslaan'}
          </button>
          <button
            type="button"
            onClick={() => setBewerkt(false)}
            data-testid="annuleer-contract"
            className="rounded border border-line px-4 py-2 text-sm text-ink transition hover:bg-surface"
          >
            Annuleren
          </button>
        </div>
      </li>
    );
  }

  return (
    <li
      data-testid="contract-rij"
      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{contract.name}</p>
        <p className="text-xs text-ink-muted">
          {contract.contractNumber ?? 'geen contractnummer'}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          {[contract.vendorContactNaam, contract.ownerGebruikerNaam]
            .filter(Boolean)
            .join(' · ') || 'geen contactpersoon of beheerder'}
        </p>
      </div>

      <div className="flex items-center gap-3">
        {contract.statusCode && (
          <span
            data-testid="contract-status"
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${CONTRACT_STATUS_KLEUR[contract.statusCode] ?? 'bg-slate-100 text-slate-700'}`}
          >
            {CONTRACT_STATUS_LABEL[contract.statusCode] ?? contract.statusCode}
          </span>
        )}
        <div className="text-right text-xs">
          <div className="text-ink-muted">
            {contract.startDate ?? '—'} – {contract.endDate ?? '—'}
          </div>
          <EindeIndicator contract={contract} />
        </div>

        <button
          type="button"
          onClick={beginBewerken}
          aria-label={`${contract.name} bewerken`}
          data-testid="bewerk-contract"
          className="rounded border border-line p-1.5 text-ink transition hover:bg-surface"
        >
          <Pencil size={13} />
        </button>

        {bevestigVerwijderen ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-muted">Zeker?</span>
            <button
              type="button"
              onClick={() => void verwijderDeze()}
              disabled={bezig}
              data-testid="verwijder-contract-bevestig"
              className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:brightness-95"
            >
              Ja
            </button>
            <button
              type="button"
              onClick={() => setBevestigVerwijderen(false)}
              className="rounded border border-line px-2 py-1 text-xs text-ink hover:bg-surface"
            >
              Nee
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setBevestigVerwijderen(true)}
            aria-label={`${contract.name} verwijderen`}
            data-testid="verwijder-contract"
            className="rounded border border-line p-1.5 text-red-700 transition hover:bg-red-50"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </li>
  );
}

function uitContract(contract: Contract): ContractInvoer {
  return {
    name: contract.name,
    contractNumber: contract.contractNumber ?? '',
    vendorContactId: contract.vendorContactId ?? '',
    ownerUserId: contract.ownerUserId ?? '',
    statusCode: contract.statusCode ?? '',
    valueEur: contract.valueEur ?? '',
    startDate: contract.startDate ?? '',
    endDate: contract.endDate ?? '',
    note: contract.note ?? '',
  };
}
```

- [ ] **Step 5: Bouw `ContractFormuliervelden` (gedeeld door bewerken en aanmaken)**

```typescript
function ContractFormuliervelden({
  waarden,
  onWijzig,
  contactenVanVendor,
  gebruikers,
  veldFout,
  idPrefix,
}: {
  waarden: ContractInvoer;
  onWijzig: (w: ContractInvoer) => void;
  contactenVanVendor: Contactpersoon[];
  gebruikers: { userId: string; naam: string }[];
  veldFout: { veld: string; melding: string } | null;
  idPrefix: string;
}) {
  function veld<K extends keyof ContractInvoer>(sleutel: K, waarde: string) {
    onWijzig({ ...waarden, [sleutel]: waarde });
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Veld
        id={`${idPrefix}-name`}
        label="Naam"
        verplicht
        waarde={waarden.name ?? ''}
        onWijzig={(w) => veld('name', w)}
        fout={veldFoutVoor(veldFout, 'Naam')}
      />
      <Veld
        id={`${idPrefix}-contractNumber`}
        label="Contractnummer"
        waarde={waarden.contractNumber ?? ''}
        onWijzig={(w) => veld('contractNumber', w)}
        fout={veldFoutVoor(veldFout, 'Contractnummer')}
      />
      <Keuzeveld
        id={`${idPrefix}-statusCode`}
        label="Status"
        waarde={waarden.statusCode ?? ''}
        keuzes={[
          { code: 'actief', label: 'Actief' },
          { code: 'verlopen', label: 'Verlopen' },
          { code: 'opgezegd', label: 'Opgezegd' },
        ]}
        onWijzig={(w) => veld('statusCode', w)}
      />
      <Veld
        id={`${idPrefix}-startDate`}
        label="Begindatum"
        type="date"
        waarde={waarden.startDate ?? ''}
        onWijzig={(w) => veld('startDate', w)}
        fout={veldFoutVoor(veldFout, 'Begindatum')}
      />
      <Veld
        id={`${idPrefix}-endDate`}
        label="Einddatum"
        type="date"
        waarde={waarden.endDate ?? ''}
        onWijzig={(w) => veld('endDate', w)}
        fout={veldFoutVoor(veldFout, 'Einddatum')}
      />
      <Veld
        id={`${idPrefix}-valueEur`}
        label="Waarde (EUR)"
        waarde={waarden.valueEur ?? ''}
        onWijzig={(w) => veld('valueEur', w)}
        fout={veldFoutVoor(veldFout, 'Waarde')}
      />
      <Keuzeveld
        id={`${idPrefix}-vendorContactId`}
        label="Contactpersoon"
        waarde={waarden.vendorContactId ?? ''}
        keuzes={contactenVanVendor.map((c) => ({
          code: c.contactId,
          label: c.fullName,
        }))}
        onWijzig={(w) => veld('vendorContactId', w)}
      />
      <Keuzeveld
        id={`${idPrefix}-ownerUserId`}
        label="Contractbeheerder"
        waarde={waarden.ownerUserId ?? ''}
        keuzes={gebruikers.map((g) => ({ code: g.userId, label: g.naam }))}
        onWijzig={(w) => veld('ownerUserId', w)}
      />
      <div className="sm:col-span-3">
        <label
          htmlFor={`${idPrefix}-note`}
          className="mb-1 block text-sm font-medium text-ink"
        >
          Notitie
        </label>
        <textarea
          id={`${idPrefix}-note`}
          value={waarden.note ?? ''}
          onChange={(e) => veld('note', e.target.value)}
          rows={2}
          className="w-full rounded border border-line px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
        />
      </div>
    </div>
  );
}
```

**Controleer vóór dit compileert of `Keuzeveld` een `keuzes`-prop van de
vorm `{ code, label }[]` verwacht** (zie het gebruik bij
`CATEGORIEEN`/`keuzesMetHuidige` bovenin het bestaande bestand) — pas de
vorm aan als die afwijkt, gok niet.

- [ ] **Step 6: Bouw `NieuwContractFormulier`**

```typescript
function NieuwContractFormulier({
  vendorId,
  contactenVanVendor,
  gebruikers,
  onAangemaakt,
}: {
  vendorId: string;
  contactenVanVendor: Contactpersoon[];
  gebruikers: { userId: string; naam: string }[];
  onAangemaakt: () => void | Promise<void>;
}) {
  const [waarden, setWaarden] = useState<ContractInvoer>({});
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [veldFout, setVeldFout] = useState<{
    veld: string;
    melding: string;
  } | null>(null);

  async function voegToe(gebeurtenis: React.FormEvent) {
    gebeurtenis.preventDefault();
    setBezig(true);
    setFout(null);
    setVeldFout(null);

    const uitkomst = await maakContractAan(vendorId, waarden);
    setBezig(false);

    verwerk(uitkomst, {
      opGelukt: async () => {
        setWaarden({});
        await onAangemaakt();
      },
      opVeldFout: setVeldFout,
      opAlgemeneFout: setFout,
    });
  }

  return (
    <form onSubmit={voegToe} noValidate className="border-t border-line pt-5">
      <p className="mb-3 text-sm font-medium text-ink">Contract toevoegen</p>

      <ContractFormuliervelden
        waarden={waarden}
        onWijzig={setWaarden}
        contactenVanVendor={contactenVanVendor}
        gebruikers={gebruikers}
        veldFout={veldFout}
        idPrefix="nieuw-contract"
      />

      {fout && (
        <p
          role="alert"
          data-testid="nieuw-contract-fout"
          className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {fout}
        </p>
      )}

      <button
        type="submit"
        disabled={bezig}
        data-testid="voeg-contract-toe"
        className="mt-5 rounded border border-brand-primary px-4 py-2 text-sm font-medium text-brand-primary transition hover:bg-brand-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {bezig ? 'Bezig…' : 'Toevoegen'}
      </button>
    </form>
  );
}
```

- [ ] **Step 7: Compileer**

```bash
npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add src/app/beheer/leveranciers/\[id\]/page.tsx
git commit -m "feat(contract): Contracten-sectie op het vendor-detailscherm

Lijst met inline bewerken/verwijderen, statusbadge, dagen-resterend/
verlopen-indicator. Patroon van Contactpersonen/ContactRij.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Frontend — het losse survey-templatekoppeling-blok

**Files (`MCM2-frontend`):**
- Modify: `src/app/beheer/leveranciers/[id]/page.tsx`

- [ ] **Step 1: Bouw `SurveyTemplateKoppelingBlok`**

Eigen state, eigen knop, eigen foutmelding — los van de rest van het
contractformulier, conform spec §4.3.

```typescript
function SurveyTemplateKoppelingBlok({
  vendorId,
  contractId,
}: {
  vendorId: string;
  contractId: string;
}) {
  const [templates, setTemplates] = useState<
    { templateId: string; naam: string }[]
  >([]);
  const [gekoppeld, setGekoppeld] = useState<Set<string>>(new Set());
  const [laden, setLaden] = useState(true);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [gelukt, setGelukt] = useState(false);

  useEffect(() => {
    let actief = true;

    void (async () => {
      setLaden(true);
      const [alle, huidig] = await Promise.all([
        haalSurveyTemplates(),
        haalGekoppeldeTemplates(vendorId, contractId),
      ]);
      if (!actief) return;
      setTemplates(alle);
      setGekoppeld(new Set(huidig));
      setLaden(false);
    })();

    return () => {
      actief = false;
    };
  }, [vendorId, contractId]);

  function schakel(templateId: string) {
    setGelukt(false);
    setGekoppeld((vorig) => {
      const nieuw = new Set(vorig);
      if (nieuw.has(templateId)) {
        nieuw.delete(templateId);
      } else {
        nieuw.add(templateId);
      }
      return nieuw;
    });
  }

  async function koppelen() {
    setBezig(true);
    setFout(null);
    setGelukt(false);

    const uitkomst = await zetGekoppeldeTemplates(
      vendorId,
      contractId,
      [...gekoppeld],
    );

    setBezig(false);

    if (uitkomst.ok) {
      setGelukt(true);
      return;
    }
    setFout(uitkomst.melding);
  }

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="mb-2 text-sm font-medium text-ink">
        Van toepassing zijnde vragenlijst(en)
      </p>

      {laden && <p className="text-xs text-ink-muted">Bezig met laden…</p>}

      {!laden && templates.length === 0 && (
        <p className="text-xs text-ink-muted">
          Er zijn nog geen vragenlijsten aangemaakt.
        </p>
      )}

      {!laden && templates.length > 0 && (
        <div className="mb-3 flex flex-col gap-1.5">
          {templates.map((t) => (
            <label
              key={t.templateId}
              className="flex items-center gap-2 text-sm text-ink"
            >
              <input
                type="checkbox"
                data-testid="survey-template-checkbox"
                checked={gekoppeld.has(t.templateId)}
                onChange={() => schakel(t.templateId)}
              />
              {t.naam}
            </label>
          ))}
        </div>
      )}

      {fout && (
        <p
          role="alert"
          data-testid="survey-koppeling-fout"
          className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800"
        >
          {fout}
        </p>
      )}

      {gelukt && (
        <p
          role="status"
          data-testid="survey-koppeling-gelukt"
          className="mb-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-800"
        >
          Opgeslagen.
        </p>
      )}

      <button
        type="button"
        onClick={() => void koppelen()}
        disabled={bezig || laden}
        data-testid="koppel-survey-templates"
        className="rounded border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
      >
        {bezig ? 'Bezig…' : 'Vragenlijsten koppelen'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Compileer**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/app/beheer/leveranciers/\[id\]/page.tsx
git commit -m "feat(contract): los blok voor de survey-templatekoppeling

Eigen 'Vragenlijsten koppelen'-knop, eigen foutmelding — los van het
contractformulier zelf, conform spec §4.3.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Frontend e2e-tests (Playwright)

**Files (`MCM2-frontend`):**
- Create: `e2e/contracten.spec.ts`

Volgt het patroon van `e2e/vendor-detail.spec.ts` (zie dat bestand voor de
volledige `beforeEach`/`afterEach`-opzet met `BEHEER_COOKIE` en opruimen via
de API).

- [ ] **Step 1: Schrijf de suite**

```typescript
import { expect, test } from '@playwright/test';

/**
 * De Contracten-sectie op het leveranciersdetailscherm.
 *
 * Zelfde opzet als vendor-detail.spec.ts: een draaiende stack en een geldig
 * BEHEER_COOKIE, opruimen via de API en niet via de UI.
 */

const COOKIE = process.env.BEHEER_COOKIE;

let teller = 0;
function uniekeNaam() {
  teller += 1;
  return `Contracttest ${Date.now()}${teller}`;
}

test.describe('Contracten', () => {
  let vendorId: string;

  test.beforeEach(async ({ context, page, request }) => {
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

    const aangemaakt = await request.post('/api/backend/vendors', {
      headers: { Cookie: COOKIE! },
      data: { name: `Contracttest-vendor-${Date.now()}` },
    });
    const body = (await aangemaakt.json()) as { vendorId: string };
    vendorId = body.vendorId;
  });

  test.afterEach(async ({ request }) => {
    if (!COOKIE || !vendorId) return;
    await request
      .delete(`/api/backend/vendors/${vendorId}`, {
        headers: { Cookie: COOKIE },
      })
      .catch(() => undefined);
  });

  test('maakt een contract aan en toont het in de lijst', async ({ page }) => {
    await page.goto(`/beheer/leveranciers/${vendorId}`);

    const naam = uniekeNaam();
    await page.getByLabel('Naam', { exact: true }).nth(1).fill(naam);
    // nth(1): het eerste "Naam"-veld hoort bij Stamgegevens, het tweede bij
    // Contracten. Zie ARIA-labels in ContractFormuliervelden.
    await page.getByTestId('voeg-contract-toe').click();

    await expect(page.getByTestId('contract-rij').first()).toContainText(naam);
  });

  test('toont status en einddatum-indicator', async ({ page, request }) => {
    await request.post(`/api/backend/vendors/${vendorId}/contracts`, {
      headers: { Cookie: COOKIE! },
      data: {
        name: uniekeNaam(),
        statusCode: 'actief',
        endDate: new Date(Date.now() + 30 * 86400000)
          .toISOString()
          .slice(0, 10),
      },
    });

    await page.goto(`/beheer/leveranciers/${vendorId}`);

    await expect(page.getByTestId('contract-status').first()).toHaveText(
      'Actief',
    );
    await expect(page.getByTestId('contract-rij').first()).toContainText(
      'd resterend',
    );
  });

  test('koppelt een vragenlijst-template en bewaart de keuze', async ({
    page,
    request,
  }) => {
    const templateResultaat = await request.post(
      '/api/backend/admin/survey/templates',
      {
        headers: { Cookie: COOKIE! },
        data: { name: uniekeNaam(), version: 1 },
      },
    );
    // Als er geen route bestaat om een template via de API aan te maken,
    // gebruik dan een bestaande seed-template (zie db/seeds) in plaats van
    // dit verzoek — controleer dit vóór de test draait, gok niet.
    test.skip(
      templateResultaat.status() >= 400,
      'Geen route om een testtemplate aan te maken — gebruik een seed-template.',
    );

    await page.goto(`/beheer/leveranciers/${vendorId}`);
    await page.getByTestId('voeg-contract-toe').click();
    await page.getByTestId('bewerk-contract').first().click();

    await page.getByTestId('survey-template-checkbox').first().check();
    await page.getByTestId('koppel-survey-templates').click();

    await expect(page.getByTestId('survey-koppeling-gelukt')).toBeVisible();

    await page.reload();
    await page.getByTestId('bewerk-contract').first().click();
    await expect(
      page.getByTestId('survey-template-checkbox').first(),
    ).toBeChecked();
  });

  test('verwijdert een contract na bevestiging', async ({ page, request }) => {
    const naam = uniekeNaam();
    await request.post(`/api/backend/vendors/${vendorId}/contracts`, {
      headers: { Cookie: COOKIE! },
      data: { name: naam },
    });

    await page.goto(`/beheer/leveranciers/${vendorId}`);
    await page.getByTestId('verwijder-contract').first().click();
    await page.getByTestId('verwijder-contract-bevestig').click();

    await expect(page.getByTestId('contract-rij')).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Draai deze suite specifiek**

Vereist een draaiende stack met `BEHEER_COOKIE` gezet — zie de opmerking
bovenin het testbestand. In de praktijk gebeurt dit via
`npm run verify:volledig` in de backend-repo (Task 9), niet los.

- [ ] **Step 3: Commit**

```bash
git add e2e/contracten.spec.ts
git commit -m "test(contract): Playwright-suite voor de Contracten-sectie

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Volledige verificatie — beide repo's samen

**Files:** geen wijzigingen — alleen controleren.

- [ ] **Step 1: Backend-e2e nogmaals, met de frontend-wijzigingen erbij**

```bash
cd c:\DEV\Work\MCM2
DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55440/postgres" \
MIGRATION_DATABASE_URL="postgresql://clm_migrator:pw@localhost:55440/postgres" \
npx jest --config test/jest-e2e.json --forceExit
```

- [ ] **Step 2: `npm run verify:volledig`, nu met de nieuwe frontend-branch**

Volgens `docs/superpowers/plans/2026-08-22-contractmanagement.md` Task 7,
Step 1 wordt dit script normaliter tegen `MCM2-frontend`'s huidige checkout
gedraaid. Voor dit plan is dat de nieuwe contract-UI-branch — commit eerst
alles in `MCM2-frontend` (Taken 5–8 hierboven), dan pas draaien:

```bash
cd c:\DEV\Work\MCM2
npm run verify:volledig
```

Controleer eerst of poort 5001/3000 vrij zijn, zoals in het vorige plan.

Verwacht: groen, inclusief de nieuwe `e2e/contracten.spec.ts`-suite in de
Playwright-browsertests.

- [ ] **Step 3: Als iets rood is, fix het waar het hoort**

Bij twijfel: `superpowers:systematic-debugging`. Niet een test aanpassen om
hem groen te krijgen tenzij de test zelf aantoonbaar fout is.

---

## Task 10: Preview — verplicht, conform het bestaande protocol

**Dit is geen optionele stap.** Volgens de memory
`mcm2-demo-link-incognito-hard-reload` (21-08, expliciet en dwingend
vastgesteld door de eigenaar): bij elke frontend-wijziging altijd
proactief een preview aanbieden vóórdat er gemerged wordt, en exact de
onderstaande procedure volgen — geen kortere weg.

- [ ] **Step 1: Bevestig dat dit een frontend-zichtbare wijziging is**

Ja — dat is precies waarom dit plan bestaat (in tegenstelling tot het
vorige, backend-only plan). Geen uitzondering van toepassing.

- [ ] **Step 2: Start de demo-stack met de juiste branches**

```bash
cd c:\DEV\Work\MCM2
npm run demo -- --branch <naam-van-de-contract-ui-branch>
```

**Backend blijft op de branch met de contractmanagement-backend**
(taken 1–4 van dit plan, of `main` als die inmiddels gemerged is) — niet
op `main` als de backend-wijzigingen daar nog niet in zitten. Dit is de
"expliciete reden om ook de backend te wisselen" die de memory noemt: de
frontend-sectie roept routes aan die pas met deze backend-branch bestaan.

- [ ] **Step 3: Bij een bezette poort**

Zoek en ruim eerst op (`netstat -ano | findstr ":5001 "` / `":3000 "`, dan
`Stop-Process -Id <pid> -Force`) — nooit doordrukken of een tweede instantie
ernaast starten.

- [ ] **Step 4: Wacht op de volledige "5/5 Sessie en zelfcontrole"-melding**

Controleer expliciet de regels `Backend: ...` en `Frontend: ...` — dat
bevestigt dat precies de juiste branches draaien. Geen link geven vóór die
regels gezien zijn.

- [ ] **Step 5: Geef de link samen met deze twee instructies, nooit los**

- Open in een **incognito/privévenster**.
- **Ctrl+Shift+R** (harde herlaad) vóór het inloggen.

- [ ] **Step 6: Vraag de eigenaar expliciet te controleren**

Minimaal: een contract aanmaken, de statusbadge en dagen-indicator zien,
een vragenlijst koppelen en de koppeling na een herlaadactie terugzien,
een contract verwijderen. Dit is het moment waarop "compleet genoeg om te
testen" (§1a van `MCM2-CLAUDE.md`) daadwerkelijk getoetst wordt door een
mens, niet alleen door tests.

- [ ] **Step 7: Na afloop**

```bash
npm run demo:af
```

---

## Task 12: Contactpersoon en survey-koppeling direct bij het aanmaken

**Toegevoegd 22-08, ná de eerste preview van Task 10.** Twee punten uit de
vervolgopmerkingen ("21-08 II" in `docs/opmerkingen Vendor IT survey.txt`)
zijn klein genoeg om nog in dezelfde bouwronde mee te nemen, vóór er
gemerged wordt — zelfde branches, geen nieuw datamodel, dus geen nieuwe
OTAP-doorloop nodig. De twee grotere punten (navigatie, dashboard) zijn
losse issues geworden: #171, #172.

**Files (`MCM2-frontend`):**
- Modify: `src/app/beheer/leveranciers/[id]/page.tsx`

- [ ] **Step 1: Contactpersoon direct aanmaken — toggle naast de dropdown**

In `NieuwContractFormulier`, een schakelaar naast de bestaande
contactpersoon-dropdown. Aangevinkt: de dropdown verdwijnt, drie extra
velden (naam, e-mail, functie) verschijnen. Bij opslaan: eerst
`voegContactToe` (bestaande route/service uit `vendorService.ts`, al
gebruikt door de Contactpersonen-sectie hierboven), dan het contract met
het net teruggekregen `contactId`.

```typescript
function NieuwContractFormulier({
  vendorId,
  contactenVanVendor,
  gebruikers,
  onAangemaakt,
}: {
  vendorId: string;
  contactenVanVendor: Contactpersoon[];
  gebruikers: { userId: string; naam: string }[];
  onAangemaakt: () => void | Promise<void>;
}) {
  const [waarden, setWaarden] = useState<ContractInvoer>({});
  const [nieuweContactpersoon, setNieuweContactpersoon] = useState(false);
  const [contactVelden, setContactVelden] = useState({
    fullName: '',
    email: '',
    jobTitle: '',
  });
  const [gekoppeldeTemplates, setGekoppeldeTemplates] = useState<Set<string>>(
    new Set(),
  );
  const [templates, setTemplates] = useState<
    { templateId: string; naam: string }[]
  >([]);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [veldFout, setVeldFout] = useState<{
    veld: string;
    melding: string;
  } | null>(null);

  useEffect(() => {
    void haalSurveyTemplates().then(setTemplates);
  }, []);

  async function voegToe(gebeurtenis: React.FormEvent) {
    gebeurtenis.preventDefault();
    setBezig(true);
    setFout(null);
    setVeldFout(null);

    let invoer = waarden;

    // Eerst de nieuwe contactpersoon aanmaken, als die optie aanstaat. Faalt
    // dat, dan wordt het contract niet aangemaakt — een contract met een
    // verwijzing naar een contactpersoon die niet bestaat is erger dan geen
    // contract.
    if (nieuweContactpersoon) {
      if (!contactVelden.fullName.trim()) {
        setVeldFout({
          veld: 'contactNaam',
          melding: 'Vul de naam van de nieuwe contactpersoon in.',
        });
        setBezig(false);
        return;
      }

      const contactUitkomst = await voegContactToe(vendorId, {
        fullName: contactVelden.fullName,
        email: contactVelden.email.trim() || null,
        jobTitle: contactVelden.jobTitle.trim() || null,
      });

      if (!contactUitkomst.ok) {
        setBezig(false);
        if (contactUitkomst.soort === 'veld') {
          setVeldFout({
            veld: contactUitkomst.veld,
            melding: contactUitkomst.melding,
          });
        } else {
          setFout(contactUitkomst.melding);
        }
        return;
      }

      invoer = { ...waarden, vendorContactId: contactUitkomst.waarde.contactId };
    }

    const uitkomst = await maakContractAan(vendorId, invoer);

    if (!uitkomst.ok) {
      setBezig(false);
      verwerk(uitkomst, {
        opGelukt: () => undefined,
        opVeldFout: setVeldFout,
        opAlgemeneFout: setFout,
      });
      return;
    }

    // Contract staat er. Als er templates zijn aangevinkt: meteen koppelen,
    // vóór de gebruiker het resultaat ziet. Twee aanroepen, één actie voor
    // de gebruiker.
    if (gekoppeldeTemplates.size > 0) {
      await zetGekoppeldeTemplates(vendorId, uitkomst.waarde.contractId, [
        ...gekoppeldeTemplates,
      ]);
    }

    setBezig(false);
    setWaarden({});
    setNieuweContactpersoon(false);
    setContactVelden({ fullName: '', email: '', jobTitle: '' });
    setGekoppeldeTemplates(new Set());
    await onAangemaakt();
  }

  return (
    <form onSubmit={voegToe} noValidate className="border-t border-line pt-5">
      <p className="mb-3 text-sm font-medium text-ink">Contract toevoegen</p>

      <ContractFormuliervelden
        waarden={waarden}
        onWijzig={setWaarden}
        contactenVanVendor={contactenVanVendor}
        gebruikers={gebruikers}
        veldFout={veldFout}
        idPrefix="nieuw-contract"
        // Bij een nieuwe contactpersoon toont het formulier de dropdown niet
        // — die twee horen niet tegelijk zichtbaar te zijn, anders is
        // onduidelijk welke wint.
        verbergContactDropdown={nieuweContactpersoon}
      />

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setNieuweContactpersoon((v) => !v)}
          data-testid="toggle-nieuwe-contactpersoon"
          className="text-xs font-medium text-brand-primary hover:underline"
        >
          {nieuweContactpersoon
            ? '← kies een bestaande contactpersoon'
            : '+ of maak een nieuwe contactpersoon aan'}
        </button>

        {nieuweContactpersoon && (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Veld
              id="nieuw-contract-contactNaam"
              label="Naam"
              verplicht
              waarde={contactVelden.fullName}
              onWijzig={(w) =>
                setContactVelden((v) => ({ ...v, fullName: w }))
              }
              fout={veldFoutVoor(veldFout, 'contactNaam')}
            />
            <Veld
              id="nieuw-contract-contactEmail"
              label="E-mailadres"
              type="email"
              waarde={contactVelden.email}
              onWijzig={(w) => setContactVelden((v) => ({ ...v, email: w }))}
            />
            <Veld
              id="nieuw-contract-contactFunctie"
              label="Functie"
              waarde={contactVelden.jobTitle}
              onWijzig={(w) =>
                setContactVelden((v) => ({ ...v, jobTitle: w }))
              }
            />
          </div>
        )}
      </div>

      {templates.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-sm font-medium text-ink">
            Van toepassing zijnde vragenlijst(en)
          </p>
          <div className="flex flex-col gap-1.5">
            {templates.map((t) => (
              <label
                key={t.templateId}
                className="flex items-center gap-2 text-sm text-ink"
              >
                <input
                  type="checkbox"
                  data-testid="nieuw-contract-survey-checkbox"
                  checked={gekoppeldeTemplates.has(t.templateId)}
                  onChange={() =>
                    setGekoppeldeTemplates((vorig) => {
                      const nieuw = new Set(vorig);
                      if (nieuw.has(t.templateId)) {
                        nieuw.delete(t.templateId);
                      } else {
                        nieuw.add(t.templateId);
                      }
                      return nieuw;
                    })
                  }
                />
                {t.naam}
              </label>
            ))}
          </div>
        </div>
      )}

      {fout && (
        <p
          role="alert"
          data-testid="nieuw-contract-fout"
          className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {fout}
        </p>
      )}

      <button
        type="submit"
        disabled={bezig}
        data-testid="voeg-contract-toe"
        className="mt-5 rounded border border-brand-primary px-4 py-2 text-sm font-medium text-brand-primary transition hover:bg-brand-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {bezig ? 'Bezig…' : 'Toevoegen'}
      </button>
    </form>
  );
}
```

**Nodig: `voegContactToe` importeren** uit `@/core/services/vendorService`
(al elders in dit bestand geïmporteerd voor de Contactpersonen-sectie —
hergebruiken, niet opnieuw definiëren).

- [ ] **Step 2: Voeg `verbergContactDropdown` toe aan `ContractFormuliervelden`**

Kleine uitbreiding van de props uit Task 6 Step 5:

```typescript
function ContractFormuliervelden({
  waarden,
  onWijzig,
  contactenVanVendor,
  gebruikers,
  veldFout,
  idPrefix,
  verbergContactDropdown = false,
}: {
  waarden: ContractInvoer;
  onWijzig: (w: ContractInvoer) => void;
  contactenVanVendor: Contactpersoon[];
  gebruikers: { userId: string; naam: string }[];
  veldFout: { veld: string; melding: string } | null;
  idPrefix: string;
  verbergContactDropdown?: boolean;
}) {
```

En de bestaande `Keuzeveld`-blok voor `vendorContactId` wrap in
`{!verbergContactDropdown && ( ... )}`.

- [ ] **Step 3: Compileer**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Breid `e2e/contracten.spec.ts` uit met twee tests**

```typescript
  test('maakt direct een nieuwe contactpersoon aan bij het contract', async ({
    page,
  }) => {
    await maakEnOpen(page);

    await page.getByTestId('toggle-nieuwe-contactpersoon').click();
    await page.locator('#nieuw-contract-name').fill(`Contract-nc-${Date.now()}`);
    await page
      .locator('#nieuw-contract-contactNaam')
      .fill(`Nieuw Contact ${Date.now()}`);
    await page.getByTestId('voeg-contract-toe').click();

    await expect(page.getByTestId('contract-rij').first()).toBeVisible();

    // De nieuwe contactpersoon moet ook in de Contactpersonen-sectie
    // verschijnen — bewijst dat dezelfde route is gebruikt, niet een kopie.
    await expect(page.getByTestId('contact-rij')).not.toHaveCount(0);
  });

  test('koppelt meteen een vragenlijst bij het aanmaken', async ({
    page,
  }) => {
    await maakEnOpen(page);

    const checkboxen = page.getByTestId('nieuw-contract-survey-checkbox');
    const aantal = await checkboxen.count();
    test.skip(
      aantal === 0,
      'Geen vragenlijst-templates aanwezig op deze database.',
    );

    await page.locator('#nieuw-contract-name').fill(`Contract-vl-${Date.now()}`);
    await checkboxen.first().check();
    await page.getByTestId('voeg-contract-toe').click();

    await expect(page.getByTestId('contract-rij').first()).toBeVisible();

    await page.getByTestId('bewerk-contract').first().click();
    await expect(
      page.getByTestId('survey-template-checkbox').first(),
    ).toBeChecked();
  });
```

- [ ] **Step 5: Prettier, lint, compileer**

```bash
npx prettier --write "src/app/beheer/leveranciers/[id]/page.tsx" "e2e/contracten.spec.ts"
npx eslint "src/app/beheer/leveranciers/[id]/page.tsx" "e2e/contracten.spec.ts" --max-warnings=0
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add "src/app/beheer/leveranciers/[id]/page.tsx" e2e/contracten.spec.ts
git commit -m "feat(contract): contactpersoon en vragenlijst direct bij aanmaken

21-08 II punt 3+4: een toggle om een nieuwe contactpersoon aan te maken
i.p.v. te kiezen uit bestaande, en de survey-templatekoppeling al zichtbaar
in het aanmaakformulier zelf i.p.v. pas na opslaan.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Tweede, korte preview-ronde**

Herhaal Task 10 (Steps 2–6) met de bijgewerkte frontend-branch — het is
dezelfde branch, dus geen nieuwe `--branch`-naam nodig, alleen opnieuw
`npm run demo -- --branch feat/contractmanagement-scherm` na deze commit.

---

## Task 13: Een vragenlijst daadwerkelijk kunnen versturen vanuit een contract

**Toegevoegd 22-08, tijdens de tweede preview-ronde.** De eigenaar
ontdekte dat de survey-templatekoppeling (Task 2/12) een doodlopend
register was: er bestond geen weg van "dit contract heeft vragenlijst X
aangevinkt" naar "stuur die vragenlijst nu naar de contactpersoon van dit
contract". Bij het uitzoeken bleek het gat groter dan verwacht:
`survey_run.contract_id` — de kolom die migratie 0007 al op 2026-08-14
klaarzette precies voor dit doel — wordt nergens ingevuld. Niet in
`RondeBeheerService.maakRonde()`, niet in de route, niet in het
uitnodigen-scherm.

Dit is geen nieuw datamodel, alleen het vullen van een kolom die al
bestaat en het doortrekken van een `contractId` door een keten die al
bestaat. Blijft binnen dezelfde twee branches.

**Files (backend, `c:\DEV\Work\MCM2`):**
- Modify: `src/survey/ronde-invoer.ts`
- Modify: `src/survey/ronde-beheer.service.ts`
- Test: uitbreiding van de bestaande e2e-suite voor rondes (zoek met
  `grep -rn "maakRonde\|POST.*runs" test/*.e2e-spec.ts` naar de juiste
  suite vóór je een nieuwe schrijft — hergebruik het bestaande bestand)

- [ ] **Step 1: `NieuweRonde` krijgt een optioneel `contractId`**

In `src/survey/ronde-invoer.ts`:

```typescript
export interface NieuweRonde {
  templateId: string;
  surveyKind: RondeSoort;
  /** Wanneer de ronde sluit. Null betekent: geen sluitdatum. */
  closesAt: Date | null;
  isTest: boolean;
  /** Op welk contract deze ronde betrekking heeft. Optioneel — zie migratie 0007. */
  contractId: string | null;
}
```

En in `leesNieuweRonde()`, ná de bestaande velden:

```typescript
  return {
    templateId,
    surveyKind: soort as RondeSoort,
    closesAt: leesSluitdatum(invoer.closesAt),
    isTest: invoer.isTest === true,
    contractId:
      invoer.contractId === undefined || invoer.contractId === null
        ? null
        : leesUuid(invoer.contractId, 'contractId'),
  };
```

- [ ] **Step 2: `RondeBeheerService.maakRonde()` schrijft de kolom**

In `src/survey/ronde-beheer.service.ts`, de bestaande INSERT uitbreiden:

```typescript
        const aangemaakt = await tx.execute<RunRij>(
          sql`INSERT INTO clm.survey_run
                  (tenant_id, template_id, survey_kind, status, closes_at,
                   is_test, contract_id)
              VALUES (${tenantId}, ${invoer.templateId}, ${invoer.surveyKind},
                      'draft', ${invoer.closesAt?.toISOString() ?? null},
                      ${invoer.isTest}, ${invoer.contractId})
              RETURNING run_id, template_id, status, survey_kind, is_test,
                        closes_at, contract_id`,
        );
```

**Let op:** als het contract bij een andere tenant hoort dan de sessie, of
niet bestaat, faalt dit met een foreign-key-fout (`contract_id` heeft geen
FK naar een tenant-gefilterde subset — de FK zelf verwijst simpelweg naar
`clm.contract.contract_id`). Voeg daarom eerst een controle toe, zelfde
patroon als de bestaande template-controle iets hoger in dezelfde
methode:

```typescript
        if (invoer.contractId) {
          const contracten = await tx.execute<{ contract_id: string }>(
            sql`SELECT contract_id FROM clm.contract
               WHERE contract_id = ${invoer.contractId}
                 AND deleted_at IS NULL`,
          );

          if (contracten.rows.length === 0) {
            throw new NotFoundException('Dit contract bestaat niet.');
          }
        }
```

Plaats dit vóór de `INSERT`, ná de bestaande template/vragen-controles.
RLS filtert automatisch op tenant (net als de template-check hierboven al
doet) — een contract van een andere tenant levert dus gewoon nul rijen op,
niet een lek.

Voeg `contractId: r.contract_id` toe aan het teruggegeven object in
`RondeGestart` (interface uitbreiden met `contractId: string | null`, en
de `RunRij`-interface met `contract_id: string | null`).

- [ ] **Step 3: Compileer**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Zoek en breid de bestaande e2e-suite voor rondes uit**

```bash
grep -rln "maakRonde\|POST.*admin/survey/runs" test/*.e2e-spec.ts
```

Voeg in dat bestand een test toe die bevestigt dat `contractId` wordt
opgeslagen en teruggegeven, en één die bevestigt dat een onbekend
`contractId` een 404 geeft — volg het bestaande testpatroon in dat
bestand exact (tenant-opzet, cookie, opruimen), niet een nieuw patroon
verzinnen.

- [ ] **Step 5: Draai die suite geïsoleerd, dan de volledige e2e-run**

```bash
DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55440/postgres" \
MIGRATION_DATABASE_URL="postgresql://clm_migrator:pw@localhost:55440/postgres" \
npx jest --config test/jest-e2e.json --forceExit
```

- [ ] **Step 6: Prettier, lint, commit**

```bash
git add src/survey/ronde-invoer.ts src/survey/ronde-beheer.service.ts test/<gevonden-bestand>.e2e-spec.ts
git commit -m "feat(survey): survey_run.contract_id daadwerkelijk vullen

Kolom bestond sinds migratie 0007 maar werd nergens geschreven. Nu vult
maakRonde() hem als er een contractId wordt meegestuurd, met een 404 bij
een onbekend contract.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

**Files (frontend, `MCM2-frontend`):**
- Modify: `src/core/services/vragenlijstService.ts`
- Modify: `src/app/beheer/vragenlijsten/uitnodigen/page.tsx`
- Modify: `src/app/beheer/leveranciers/[id]/page.tsx`

- [ ] **Step 7: `maakRonde()` stuurt `contractId` mee**

In `src/core/services/vragenlijstService.ts`:

```typescript
export async function maakRonde(invoer: {
  templateId: string;
  closesAt?: string | null;
  isTest?: boolean;
  contractId?: string | null;
}): Promise<RondeGestart> {
```

De rest van de functie ongewijzigd — `invoer` gaat al in zijn geheel als
body mee.

- [ ] **Step 8: Het uitnodigen-scherm leest `?contractId=` en voegt het toe aan `start()`**

In `src/app/beheer/vragenlijsten/uitnodigen/page.tsx`, ná de bestaande
`gekozenIds`-regel:

```typescript
  const contractId = parameters.get('contractId');
```

In `start()`, de aanroep naar `maakRonde` uitbreiden:

```typescript
      const ronde = await maakRonde({
        templateId,
        closesAt: sluitdatum ? new Date(sluitdatum).toISOString() : null,
        contractId,
      });
```

Toon daarnaast, wanneer `contractId` gezet is, een korte regel in de
`kiezen`-stap die bevestigt vanuit welk contract dit uitnodigen komt —
zonder dat is voor de gebruiker niet zichtbaar of de koppeling meekomt.
Plaats dit vlak boven de bestaande template-keuze:

```typescript
      {contractId && (
        <p
          data-testid="uitnodigen-vanuit-contract"
          className="mb-4 rounded border border-line bg-surface px-3 py-2 text-xs text-ink-muted"
        >
          Deze uitnodiging wordt gekoppeld aan het contract waar u vandaan
          kwam.
        </p>
      )}
```

- [ ] **Step 9: Knop op het contract — per gekoppelde vragenlijst een "Uitnodigen"-link**

In `SurveyTemplateKoppelingBlok` (in
`src/app/beheer/leveranciers/[id]/page.tsx`), een link toevoegen naast
elke aangevinkte checkbox die naar het uitnodigen-scherm springt met de
juiste parameters. De component heeft `vendorId` en `contractId` al als
props — voeg toe, ná de bestaande checkbox-lijst:

```typescript
      {!laden &&
        [...gekoppeld].map((templateId) => {
          const template = templates.find((t) => t.templateId === templateId);
          if (!template) return null;

          return (
            <Link
              key={templateId}
              href={`/beheer/vragenlijsten/uitnodigen?leveranciers=${vendorId}&contractId=${contractId}&templateId=${templateId}`}
              data-testid="uitnodigen-vanuit-contract-knop"
              className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-brand-primary hover:underline"
            >
              → {template.naam} nu uitnodigen
            </Link>
          );
        })}
```

Plaats dit ná de checkbox-lijst en vóór de foutmelding/knop-blok. Voeg
`import Link from 'next/link';` toe als die nog niet bovenaan het bestand
staat (die is er al, gebruikt door `LeverancierDetailPagina` zelf —
hergebruiken).

**Let op:** het uitnodigen-scherm (Step 8) leest ook `templateId` uit de
querystring niet automatisch voor — controleer of dat scherm die
parameter al oppikt (`parameters.get('templateId')`) of dat er een regel
bij moet om `setTemplateId` te initialiseren vanuit de querystring, zoals
al gebeurt voor `alleLijsten.length === 1`. Gok niet, lees de bestaande
`useEffect` in dat bestand na voordat je hier verdergaat.

- [ ] **Step 10: Compileer, prettier, lint**

```bash
npx tsc --noEmit
npx prettier --write "src/core/services/vragenlijstService.ts" "src/app/beheer/vragenlijsten/uitnodigen/page.tsx" "src/app/beheer/leveranciers/[id]/page.tsx"
npx eslint "src/core/services/vragenlijstService.ts" "src/app/beheer/vragenlijsten/uitnodigen/page.tsx" "src/app/beheer/leveranciers/[id]/page.tsx" --max-warnings=0
```

- [ ] **Step 11: Playwright-test: van contract naar verstuurde uitnodiging**

Uitbreiding van `e2e/contracten.spec.ts`:

```typescript
  test('stuurt een vragenlijst rechtstreeks vanuit een gekoppeld contract', async ({
    page,
  }) => {
    await maakEnOpen(page);

    const checkboxen = page.getByTestId('nieuw-contract-survey-checkbox');
    const aantal = await checkboxen.count();
    test.skip(
      aantal === 0,
      'Geen vragenlijst-templates aanwezig op deze database.',
    );

    await page
      .locator('#nieuw-contract-name')
      .fill(`Contract-uitnodigen-${Date.now()}`);
    await checkboxen.first().check();
    await page.getByTestId('voeg-contract-toe').click();
    await expect(page.getByTestId('contract-rij').first()).toBeVisible();

    await page.getByTestId('bewerk-contract').first().click();
    await page.getByTestId('uitnodigen-vanuit-contract-knop').first().click();

    await expect(
      page.getByTestId('uitnodigen-vanuit-contract'),
    ).toBeVisible();
  });
```

- [ ] **Step 12: Commit**

```bash
git add src/core/services/vragenlijstService.ts "src/app/beheer/vragenlijsten/uitnodigen/page.tsx" "src/app/beheer/leveranciers/[id]/page.tsx" e2e/contracten.spec.ts
git commit -m "feat(contract): vanuit een gekoppelde vragenlijst rechtstreeks kunnen uitnodigen

Sluit het gat dat de eigenaar vond tijdens de tweede preview: de
survey-templatekoppeling was een doodlopend register zonder een weg naar
het daadwerkelijk versturen. Elke gekoppelde vragenlijst op een contract
krijgt nu een link naar het bestaande uitnodigen-scherm, met leverancier
en vragenlijst voorgeselecteerd en contract_id meegegeven.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 13: Derde, korte preview-ronde**

Herhaal Task 10 (Steps 2–6) opnieuw. Controleer specifiek: vanuit een
contract op "→ … nu uitnodigen" klikken, de melding "gekoppeld aan het
contract" zien, de ronde afmaken, en — als er tijd voor is — in de
database bevestigen dat `survey_run.contract_id` daadwerkelijk gevuld is:

```sql
SELECT run_id, contract_id FROM clm.survey_run WHERE contract_id IS NOT NULL ORDER BY started_at DESC LIMIT 1;
```

---

## Task 11: Samenvoegen — pas na akkoord op de preview

**Niet uitvoeren zonder expliciet akkoord van de eigenaar op Task 10 (en,**
**als Task 12/13 zijn uitgevoerd, ook op de latere preview-rondes daar).**

- [ ] **Step 1: Volg `superpowers:finishing-a-development-branch`**

Voor beide repo's apart: backend-branch (taken 1–4) en frontend-branch
(taken 5–8, eventueel 12). Presenteer de opties (PR, direct mergen, branch
parkeren) zoals die skill voorschrijft — niet zelf beslissen.

---

## Self-review

**Spec-dekking (tegen `docs/superpowers/specs/2026-08-22-contractmanagement-ui-design.md`):**

- §3.1 `GET /tenant/gebruikers` — Task 1. ✅
- §3.2 survey-templatekoppeling-routes — Task 2. ✅ PUT vervangt de hele
  set, geen diff, zoals de spec voorschrijft.
- §3.3 namen i.p.v. alleen id's — Task 3. ✅
- §4.1 lijst met statusbadge en dagen-indicator — Task 6, `ContractRij`
  en `EindeIndicator`. ✅
- §4.2 bewerk-/aanmaakformulier met alle genoemde velden, één
  opslaan-actie — Task 6, `ContractFormuliervelden`. ✅ Contactpersoon en
  contractbeheerder zijn inbegrepen (expliciet bevestigd tijdens de
  brainstorm, in afwijking van het aanvankelijke voorstel in de spec-tekst
  zelf — de spec-tekst noemt dit ook, zie §3.3 daar).
- §4.3 los blok, eigen knop voor de survey-koppeling — Task 7,
  `SurveyTemplateKoppelingBlok`. ✅ Eigen "bezig"/foutmelding, aparte
  `PUT`-aanroep.
- §4.4 "wat dit scherm niet doet" — geen ronde-start-knop, geen
  tijdlijn/CATS-fasen, geen bulk-acties: dit plan bouwt niets daarvan. ✅

**Placeholder-scan:** geen TBD/TODO. Twee plekken vragen wel een expliciete
controle tijdens uitvoering in plaats van blind te kopiëren (Task 5 Step 3:
HTTP-werkwoord van `wijzig()`; Task 5 Step 5: vorm van `Keuzeveld`-props) —
dat zijn bewuste "controleer dit, gok niet"-instructies, geen onvolledige
stappen: de stap zelf zegt precies wat te doen als de aanname niet klopt.

**Type-consistentie:** `ContractInvoer`/`Contract` in
`src/core/models/contract.ts` (Task 5) komen overeen met wat
`contractService.ts` (Task 5) en de UI-componenten (Task 6–7) gebruiken.
Backend-veldnamen (`vendorContactId`, `ownerUserId`, `statusCode`, etc.)
zijn identiek aan wat `ContractService`/`ContractDetail` in het
backend-plan (`2026-08-22-contractmanagement.md`) al vastlegde.

**Scope-check:** twee repo's, elf taken, gegroepeerd in vier fasen
(backend §1–4, frontend-bouw §5–8, verificatie §9, preview §10, afronden
§11) — elke fase levert zelfstandig verifieerbare voortgang op. Groot
genoeg om subagent-driven uitvoering te overwegen per taak, maar niet
zodanig dat het decompositie in aparte plannen nodig had.
