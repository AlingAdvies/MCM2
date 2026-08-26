# Audit-bewijsvoering: relevante leveranciers oplijsten en volgen — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transdev (en later andere tenants) kan aan een auditor aantonen dat de relevante
leveranciers op de voorgeschreven manier zijn beoordeeld: welke leveranciers relevant zijn
(business_criticality medium/high/critical + optioneel compliance-thema), wat hun
beoordelingsstatus is (inclusief nieuw: `gepland`, `afgekeurd`), en doorklikken naar de
becommentarieerde inzending.

**Architecture:** Vier grotendeels onafhankelijke delen, gebouwd in volgorde (Deel 1 →
Deel 2+3 samen → Deel 4 kan op elk moment). Deel 1 voegt een nieuwe many-to-many-koppeling toe
(`clm.vendor_compliance_thema`) zonder bestaande tabellen te wijzigen. Deel 2 breidt de
bestaande, berekende status (`respons-status.ts`) uit met twee waarden. Deel 3 voegt een tweede
databronmethode toe aan `ContractmanagerService` en voegt de resultaten samen. Deel 4 is een
losstaande frontend-wijziging op het bestaande inzendingscherm.

**Tech Stack:** NestJS + Drizzle (handgeschreven SQL-migraties) + PostgreSQL met RLS
(backend, `c:/DEV/Work/MCM2`); Next.js 15 + TypeScript (frontend, `c:/DEV/Work/MCM2-frontend`).

**Zie ook:** `docs/superpowers/specs/2026-08-25-audit-bewijsvoering-design.md` (het volledige
ontwerp met de achtergrond en de bewuste scope-beperkingen).

---

## Deel 1 — Compliance-thema op de leverancier

### Task 1: Migratie — `ref.compliance_thema` en `clm.vendor_compliance_thema`

**Files:**
- Create: `drizzle/0031_compliance_thema.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Bepaal het echte migratienummer**

Run: `ls drizzle/*.sql | tail -3`

Het volgende nummer na de hoogste bestaande migratie is het echte nummer voor dit bestand.
Dit plan gaat uit van `0031`, gebaseerd op de stand op 2026-08-25 (hoogste bestaande:
`0030_response_note_soort.sql`). Klopt dat niet meer, gebruik het werkelijke volgende nummer
overal in deze taak (bestandsnaam, journal-entry, code-comments).

- [ ] **Step 2: Schrijf de migratie**

```sql
-- =============================================================================
-- clm.vendor_compliance_thema — compliance-thema's per leverancier.
--
-- Ontwerp: docs/superpowers/specs/2026-08-25-audit-bewijsvoering-design.md, Deel 1.
-- Aanleiding: Transdev moet leveranciers per audit-thema (bijv. Cybersecurity)
-- kunnen oplijsten. business_criticality alleen zegt niets over WAAR een
-- leverancier relevant voor is.
--
-- Multi-value (besluit eigenaar): een leverancier kan tegelijk relevant zijn
-- voor meerdere thema's. Losstaand van survey_template/survey_run — het thema
-- is een eigenschap van de leverancier, puur een filtercriterium.
-- =============================================================================

-- ── 1. ref.compliance_thema — vaste waardenlijst, zelfde patroon als
-- ref.compliance_status / ref.business_criticality / ref.vendor_category.

CREATE TABLE ref.compliance_thema (
    code  text PRIMARY KEY,
    label text NOT NULL
);--> statement-breakpoint

INSERT INTO ref.compliance_thema (code, label) VALUES
    ('cybersecurity', 'Cybersecurity'),
    ('kwaliteit', 'Kwaliteit'),
    ('continuiteit', 'Continuïteit')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint

-- ref-schema: bewust geen RLS (tenant-agnostische lookup-data), zelfde als
-- de andere ref-tabellen.

-- ── 2. clm.vendor_compliance_thema — many-to-many, geen extra kolommen ─────
--
-- Patroon: clm.contract_survey_template (migratie 0027). tenant_id staat
-- direct op de koppeltabel (niet afgeleid via vendor_id) — zelfde reden als
-- daar: een simpele, gelijkvormige RLS-policy zonder subquery naar vendor.

CREATE TABLE clm.vendor_compliance_thema (
    vendor_id  uuid NOT NULL,
    thema_code text NOT NULL,
    tenant_id  uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT vendor_compliance_thema_pkey
        PRIMARY KEY (vendor_id, thema_code)
);--> statement-breakpoint

ALTER TABLE clm.vendor_compliance_thema
    ADD CONSTRAINT vendor_compliance_thema_vendor_id_vendor_vendor_id_fk
    FOREIGN KEY (vendor_id) REFERENCES clm.vendor(vendor_id)
    ON DELETE cascade;--> statement-breakpoint

ALTER TABLE clm.vendor_compliance_thema
    ADD CONSTRAINT vendor_compliance_thema_thema_code_fk
    FOREIGN KEY (thema_code) REFERENCES ref.compliance_thema(code)
    ON DELETE restrict;--> statement-breakpoint

ALTER TABLE clm.vendor_compliance_thema
    ADD CONSTRAINT vendor_compliance_thema_tenant_id_tenant_tenant_id_fk
    FOREIGN KEY (tenant_id) REFERENCES clm.tenant(tenant_id)
    ON DELETE cascade;--> statement-breakpoint

CREATE INDEX vendor_compliance_thema_tenant_id_idx
    ON clm.vendor_compliance_thema USING btree (tenant_id);--> statement-breakpoint

CREATE INDEX vendor_compliance_thema_vendor_id_idx
    ON clm.vendor_compliance_thema USING btree (vendor_id);--> statement-breakpoint

ALTER TABLE clm.vendor_compliance_thema ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.vendor_compliance_thema FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY vendor_compliance_thema_isolation ON clm.vendor_compliance_thema
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

COMMENT ON TABLE clm.vendor_compliance_thema IS
    'Welke compliance-thema''s relevant zijn voor een leverancier (bijv. Cybersecurity). Many-to-many, geen extra velden, geen koppeling naar survey_template — puur een filtercriterium op de leverancier. Zie docs/superpowers/specs/2026-08-25-audit-bewijsvoering-design.md.';--> statement-breakpoint

-- Een koppeling bestaat of niet. Wijzigen heeft geen betekenis — ontkoppelen
-- en opnieuw koppelen wel. Zelfde redenering als contract_survey_template (0027).
REVOKE ALL ON clm.vendor_compliance_thema FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON clm.vendor_compliance_thema TO clm_api, clm_admin;
```

- [ ] **Step 3: Registreer de migratie in `drizzle/meta/_journal.json`**

Open `drizzle/meta/_journal.json`, vind het laatste entry (voor `0030_response_note_soort`),
en voeg er een nieuw entry na toe met hetzelfde formaat (`idx` één hoger, `tag` gelijk aan de
bestandsnaam zonder `.sql`, `when` een Unix-timestamp in milliseconden na de vorige). Zonder
deze stap slaat Drizzle de migratie over — zie MCM2-CLAUDE.md, punt 3 onder "De vier dingen die
het vaakst misgaan".

- [ ] **Step 4: Draai de migratie tegen een lokale wegwerpdatabase**

Zet een eigen container op (nooit tegen staging/productie zonder expliciete stappen — zie
`docs/runbooks/commandos-en-omgeving.md`):

```powershell
docker run -d --name mcm2-audit-plan -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55441:5432 postgres:17.6
```

Wacht een paar seconden tot de container gezond is, markeer hem als wegwerp, en draai de
migraties:

```powershell
$env:MIGRATION_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55441/postgres"
$env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55441/postgres"
npm run migrate:deploy
node scripts/markeer-wegwerp.js "audit-bewijsvoering plan Deel 1"
```

Expected: `migrate:deploy` meldt de nieuwe migratie toegepast, geen fouten.

- [ ] **Step 5: Verifieer de tabel en RLS rechtstreeks**

```powershell
docker exec mcm2-audit-plan psql -U postgres -c "\d clm.vendor_compliance_thema"
docker exec mcm2-audit-plan psql -U postgres -c "SELECT code, label FROM ref.compliance_thema ORDER BY code;"
```

Expected: de tabel bestaat met de vier kolommen, de policy `vendor_compliance_thema_isolation`
staat erop, en er staan drie rijen in `ref.compliance_thema` (`continuiteit`, `cybersecurity`,
`kwaliteit`).

- [ ] **Step 6: Voeg de tabellen toe aan `src/db/schema.ts`**

Zoek de plek na `export const vendorTag` (rond regel 309) en voeg toe:

```typescript
export const complianceThema = ref.table('compliance_thema', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
});

export const vendorComplianceThema = clm.table(
  'vendor_compliance_thema',
  {
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendor.vendorId, { onDelete: 'cascade' }),
    themaCode: text('thema_code')
      .notNull()
      .references(() => complianceThema.code, { onDelete: 'restrict' }),
    tenantId: uuid('tenant_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('vendor_compliance_thema_pkey').on(t.vendorId, t.themaCode),
    index('vendor_compliance_thema_tenant_id_idx').on(t.tenantId),
  ],
);
```

Plaats `complianceThema` bij de andere `ref.table`-definities bovenaan het bestand (naast
`businessCriticality`), en `vendorComplianceThema` bij `vendorTag`.

- [ ] **Step 7: Verifieer dat het project nog compileert**

Run: `npm run build`
Expected: geen TypeScript-fouten.

- [ ] **Step 8: Opruimen en committen**

```powershell
docker rm -f mcm2-audit-plan
git add drizzle/0031_compliance_thema.sql drizzle/meta/_journal.json src/db/schema.ts
git commit -m "feat(vendor): compliance-thema datamodel (migratie 0031)"
```

---

### Task 2: Backend — thema's lezen en schrijven op VendorService

**Files:**
- Modify: `src/vendor/vendor.service.ts`
- Modify: `src/vendor/vendor.controller.ts`
- Modify: `src/vendor/vendor-invoer.ts`
- Test: `test/vendor-compliance-thema.e2e-spec.ts`

Deze taak bouwt voort op de migratie uit Task 1. Als Task 1 nog niet is uitgevoerd, doe dat
eerst.

- [ ] **Step 1: Bekijk de bestaande invoervalidatie**

Run: `cat src/vendor/vendor-invoer.ts`

Dit bestand bevat `leesVendorWijziging`/`InvoerFout` — de vorm die de nieuwe
`leesThemaCodes`-functie moet volgen (gooit `InvoerFout` met een `veld`-property bij ongeldige
invoer).

- [ ] **Step 2: Voeg `leesThemaCodes` toe aan `vendor-invoer.ts`**

Voeg onderaan het bestand toe (na de bestaande exports, zelfde `InvoerFout`-klasse
hergebruiken):

```typescript
/**
 * Leest de gewenste compliance-thema's uit een PUT-body.
 *
 * Verwacht `{ themaCodes: string[] }`. Een leeg array is geldig — dat
 * betekent "geen thema's meer", niet "niet aangeraakt". Duplicaten worden
 * stilzwijgend genegeerd (de primary key zou ze toch weigeren); dat is geen
 * invoerfout, want de UI stuurt de complete gewenste set en kan zelf geen
 * duplicaten produceren via de checkbox-interactie.
 */
export function leesThemaCodes(body: unknown): string[] {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('themaCodes' in body) ||
    !Array.isArray((body as { themaCodes: unknown }).themaCodes)
  ) {
    throw new InvoerFout('themaCodes moet een lijst van codes zijn.', 'themaCodes');
  }

  const codes = (body as { themaCodes: unknown[] }).themaCodes;

  if (!codes.every((c) => typeof c === 'string' && c.trim().length > 0)) {
    throw new InvoerFout('Elke themaCode moet een niet-lege tekst zijn.', 'themaCodes');
  }

  return [...new Set(codes as string[])];
}
```

- [ ] **Step 3: Voeg thema-methoden toe aan `VendorService`**

In `src/vendor/vendor.service.ts`, voeg toe aan `VendorDetail` (na `complianceStatusCode`):

```typescript
  complianceThemaCodes: string[];
```

Voeg een nieuwe rij-interface toe (bij `ContactRij`):

```typescript
interface ThemaRij extends Record<string, unknown> {
  thema_code: string;
}
```

Werk `detailBinnenTransactie` bij om de thema's mee te halen — voeg na het ophalen van
`contacten` toe:

```typescript
    const themas = await tx.execute<ThemaRij>(
      sql`SELECT thema_code FROM clm.vendor_compliance_thema
           WHERE vendor_id = ${vendorId}
           ORDER BY thema_code`,
    );
```

En breid de `return`-waarde uit met:

```typescript
      complianceThemaCodes: themas.rows.map((t) => t.thema_code),
```

Voeg een nieuwe publieke methode toe aan de klasse (na `wijzig`):

```typescript
  /**
   * Vervangt de volledige set compliance-thema's van een leverancier.
   *
   * Geen incrementele toggle-endpoint: de UI stuurt altijd de complete
   * gewenste set (§Deel 1 van de spec), dus "verwijder wat er niet meer in
   * zit, voeg toe wat nieuw is" binnen één transactie is eenvoudiger en heeft
   * geen race condition tussen twee losse toggle-aanroepen.
   *
   * Geeft `null` wanneer de leverancier niet bestaat of niet van deze tenant
   * is — zelfde redenering als wijzig().
   */
  async zetComplianceThemas(
    tenantId: string,
    vendorId: string,
    themaCodes: string[],
  ): Promise<VendorDetail | null> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const bestaat = await tx.execute<{ vendor_id: string }>(
          sql`SELECT vendor_id FROM clm.vendor
             WHERE vendor_id = ${vendorId} AND deleted_at IS NULL`,
        );

        if (bestaat.rows.length === 0) {
          return null;
        }

        await tx.execute(
          sql`DELETE FROM clm.vendor_compliance_thema WHERE vendor_id = ${vendorId}`,
        );

        for (const code of themaCodes) {
          await tx.execute(
            sql`INSERT INTO clm.vendor_compliance_thema (vendor_id, thema_code, tenant_id)
                VALUES (${vendorId}, ${code}, ${tenantId})`,
          );
        }

        this.logger.log(
          `Compliance-thema's bijgewerkt (${vendorId}): ${themaCodes.join(', ') || 'geen'}.`,
        );

        return this.detailBinnenTransactie(tx, vendorId);
      },
      'medewerker',
    );
  }
```

- [ ] **Step 4: Voeg de route toe aan `VendorController`**

Voeg toe na de `wijzig`-route (vóór `@Delete(':id')`):

```typescript
  /**
   * Vervangt de compliance-thema's van een leverancier.
   *
   * PUT, niet PATCH: de body is altijd de complete gewenste set, geen
   * gedeeltelijke wijziging. Een onbekende thema-code geeft een 400 (foreign
   * key-fout omgezet, zelfde patroon als alsRefFout()).
   */
  @Put(':id/compliance-themas')
  @VereistRol('admin')
  async zetComplianceThemas(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let themaCodes: string[];

    try {
      themaCodes = leesThemaCodes(body);
    } catch (err) {
      throw alsHttpFout(err);
    }

    const vendor = await this.vendors
      .zetComplianceThemas(sessie.tenantId, leesUuid(id), themaCodes)
      .catch(alsThemaRefFout);

    if (!vendor) {
      throw new NotFoundException('Leverancier niet gevonden.');
    }

    return vendor;
  }
```

Voeg `Put` toe aan de `@nestjs/common`-import bovenaan, en `leesThemaCodes` aan de import uit
`./vendor-invoer`.

Voeg onderaan het bestand (na `alsRefFout`) een tweede foutvertaler toe:

```typescript
/**
 * Een onbekende thema-code is een gebruikersfout, geen storing.
 *
 * `thema_code` heeft een foreign key naar `ref.compliance_thema`. Een waarde
 * die daar niet in staat geeft een `23503`-fout — zelfde patroon als
 * alsRefFout(), maar met een ander veld in de melding.
 */
function alsThemaRefFout(err: unknown): never {
  const code = (err as { cause?: { code?: string }; code?: string })?.cause
    ?.code;

  if (code === '23503') {
    throw new BadRequestException({
      message: 'Onbekend compliance-thema.',
      veld: 'themaCodes',
    });
  }

  throw err;
}
```

- [ ] **Step 5: Schrijf de e2e-tests**

Reserveer een nieuw blok in `test/test-ids.ts` — voeg toe na `'antwoord-concept-opslaan'`:

```typescript
  'vendor-compliance-thema': {
    tenantA: id('25'),
    tenantB: id('26'),
    userA: id('27'),
  },
```

Schrijf `test/vendor-compliance-thema.e2e-spec.ts`, in dezelfde vorm als
`test/vendor-routes.e2e-spec.ts` (zelfde app-bootstrap, sessie-opzet via `SessieService`,
opruimen in `afterAll`):

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
 * PUT /vendors/:id/compliance-themas — de complete-set-vervanging, en de
 * tenant-grens eromheen.
 */

const { tenantA, tenantB, userA } = TEST_IDS['vendor-compliance-thema'];
const SUBJECT_A = `oid-thema-a-${Date.now()}`;

async function verwijderTestdata(client: Client): Promise<void> {
  for (const tenant of [tenantA, tenantB]) {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    await client.query(
      'DELETE FROM clm.vendor_compliance_thema WHERE tenant_id = $1',
      [tenant],
    );
    await client.query('DELETE FROM clm.vendor WHERE tenant_id = $1', [
      tenant,
    ]);
    await client.query('COMMIT');
  }

  await client.query('DELETE FROM clm.tenant_membership WHERE tenant_id = ANY($1)', [
    [tenantA, tenantB],
  ]);
  await client.query('DELETE FROM clm."user" WHERE tenant_id = ANY($1)', [
    [tenantA, tenantB],
  ]);
  await client.query('DELETE FROM clm.tenant WHERE tenant_id = ANY($1)', [
    [tenantA, tenantB],
  ]);
}

describe('PUT /vendors/:id/compliance-themas', () => {
  let app: INestApplication<App>;
  let client: Client;
  let cookieA: string;
  let vendorId: string;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(client);

    await client.query(
      `INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2), ($3, $4)`,
      [tenantA, `Thema-tenant-A-${Date.now()}`, tenantB, `Thema-tenant-B-${Date.now()}`],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, oidc_subject)
       VALUES ($1, $2, 'Admin A', $3)`,
      [userA, tenantA, SUBJECT_A],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [userA, tenantA],
    );

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    const sessies = app.get(SessieService);
    const sessieA = await sessies.maakAan(userA, tenantA);
    cookieA = `${cookieInstellingen.name}=${sessieA.sleutel}`;

    const aanmaak = await request(app.getHttpServer())
      .post('/vendors')
      .set('Cookie', cookieA)
      .send({ name: `Thema-testvendor-${Date.now()}` });

    vendorId = aanmaak.body.vendorId;
  });

  afterAll(async () => {
    await verwijderTestdata(client);
    await client.end();
    await app.close();
  });

  it('zet een set thema-codes en geeft ze terug in het detail', async () => {
    const res = await request(app.getHttpServer())
      .put(`/vendors/${vendorId}/compliance-themas`)
      .set('Cookie', cookieA)
      .send({ themaCodes: ['cybersecurity', 'kwaliteit'] });

    expect(res.status).toBe(200);
    expect(res.body.complianceThemaCodes.sort()).toEqual([
      'cybersecurity',
      'kwaliteit',
    ]);
  });

  it('vervangt de volledige set, geen samenvoeging', async () => {
    await request(app.getHttpServer())
      .put(`/vendors/${vendorId}/compliance-themas`)
      .set('Cookie', cookieA)
      .send({ themaCodes: ['cybersecurity', 'kwaliteit'] });

    const res = await request(app.getHttpServer())
      .put(`/vendors/${vendorId}/compliance-themas`)
      .set('Cookie', cookieA)
      .send({ themaCodes: ['continuiteit'] });

    expect(res.status).toBe(200);
    expect(res.body.complianceThemaCodes).toEqual(['continuiteit']);
  });

  it('accepteert een lege lijst — betekent "geen thema meer"', async () => {
    await request(app.getHttpServer())
      .put(`/vendors/${vendorId}/compliance-themas`)
      .set('Cookie', cookieA)
      .send({ themaCodes: ['cybersecurity'] });

    const res = await request(app.getHttpServer())
      .put(`/vendors/${vendorId}/compliance-themas`)
      .set('Cookie', cookieA)
      .send({ themaCodes: [] });

    expect(res.status).toBe(200);
    expect(res.body.complianceThemaCodes).toEqual([]);
  });

  it('weigert een onbekende thema-code met een 400', async () => {
    const res = await request(app.getHttpServer())
      .put(`/vendors/${vendorId}/compliance-themas`)
      .set('Cookie', cookieA)
      .send({ themaCodes: ['niet-bestaand-thema'] });

    expect(res.status).toBe(400);
    expect(res.body.veld).toBe('themaCodes');
  });

  it('weigert een leverancier van een andere tenant met 404', async () => {
    const res = await request(app.getHttpServer())
      .put('/vendors/00000000-0000-0000-0000-000000000000/compliance-themas')
      .set('Cookie', cookieA)
      .send({ themaCodes: ['cybersecurity'] });

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 6: Draai de nieuwe suite geïsoleerd**

Zet een eigen wegwerpdatabase op (zie Task 1 Step 4) met de migratie erop, markeer hem als
wegwerp, en:

```powershell
$env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55441/postgres"
npx jest vendor-compliance-thema --runInBand
```

Expected: alle vijf tests slagen.

- [ ] **Step 7: Draai de volledige e2e-run**

```powershell
npx jest test-ids
npm run test:e2e
```

Expected: `test-ids` slaagt (geen dubbele id's), de volledige suite blijft groen. Zie
MCM2-CLAUDE.md §"Een nieuwe e2e-suite schrijven" — een suite die los groen draait kan de
volledige run alsnog rood maken.

- [ ] **Step 8: Committen**

```powershell
git add src/vendor/vendor.service.ts src/vendor/vendor.controller.ts `
  src/vendor/vendor-invoer.ts test/vendor-compliance-thema.e2e-spec.ts test/test-ids.ts
git commit -m "feat(vendor): compliance-thema's lezen en zetten via PUT /vendors/:id/compliance-themas"
```

---

### Task 3: Frontend — thema's tonen en toewijzen op het leveranciersdetailscherm

**Files:**
- Modify: `MCM2-frontend/src/core/models/vendor.ts`
- Modify: `MCM2-frontend/src/core/models/classificatie.ts`
- Modify: `MCM2-frontend/src/core/services/vendorService.ts`
- Modify: `MCM2-frontend/src/app/beheer/leveranciers/[id]/ClassificatieBadges.tsx`

- [ ] **Step 1: Voeg `complianceThemaCodes` toe aan het model**

In `MCM2-frontend/src/core/models/vendor.ts`, voeg toe aan `VendorDetail` (na
`complianceStatusCode`):

```typescript
  /** Compliance-thema's waarvoor deze leverancier relevant is (multi-value). */
  complianceThemaCodes: string[];
```

- [ ] **Step 2: Voeg de thema-lijst toe aan `classificatie.ts`**

In `MCM2-frontend/src/core/models/classificatie.ts`, voeg toe na `COMPLIANCE_STATUS`:

```typescript
/**
 * Compliance-thema's — bron: `ref.compliance_thema`, migratie 0031.
 *
 * Multi-value: een leverancier kan meerdere thema's tegelijk hebben. Anders
 * dan CATEGORIEEN/CRITICALITY/COMPLIANCE_STATUS is dit geen `<select>`-lijst
 * maar togglebare pills — zie ClassificatieBadges.tsx.
 */
export const COMPLIANCE_THEMAS: Keuze[] = [
  { code: 'cybersecurity', label: 'Cybersecurity' },
  { code: 'kwaliteit', label: 'Kwaliteit' },
  { code: 'continuiteit', label: 'Continuïteit' },
];
```

- [ ] **Step 3: Voeg de service-functie toe**

In `MCM2-frontend/src/core/services/vendorService.ts`, voeg toe na `wijzigVendor`:

```typescript
/** Vervangt de volledige set compliance-thema's van een leverancier. */
export async function zetComplianceThemas(
  vendorId: string,
  themaCodes: string[],
): Promise<SchrijfResultaat<VendorDetail>> {
  if (gebruiktMockData) {
    return { ok: true, waarde: mockZetThemas(vendorId, themaCodes) };
  }

  try {
    const waarde = await wijzig<VendorDetail>(
      `/vendors/${vendorId}/compliance-themas`,
      { themaCodes },
    );
    return { ok: true, waarde };
  } catch (fout) {
    return alsSchrijfFout(fout);
  }
}
```

`wijzig()` uit `@/core/api/client` gebruikt een PUT-achtige semantiek voor het bestaande
`wijzigVendor` (PATCH in de backend, maar de client-functienaam maakt geen onderscheid tussen
PATCH/PUT — controleer dit): kijk in `MCM2-frontend/src/core/api/client.ts` welke HTTP-methode
`wijzig()` daadwerkelijk stuurt. Stuurt hij PATCH terwijl de backend-route hierboven `@Put`
verwacht, voeg dan een aparte `zetOp<T>()`-helper toe in `client.ts` die een PUT stuurt (zelfde
vorm als `wijzig()`, alleen de methode anders), en gebruik die hier in plaats van `wijzig()`.

Voeg de mock-tegenhanger toe bij de andere mock-functies onderaan het bestand:

```typescript
function mockZetThemas(vendorId: string, themaCodes: string[]): VendorDetail {
  const detail = mockDetail(vendorId)!;
  detail.complianceThemaCodes = [...new Set(themaCodes)];
  return detail;
}
```

Werk ook `mockDetail()` bij: het object dat daar wordt opgebouwd mist `complianceThemaCodes`.
Voeg toe aan de inline `VendorDetail`-constructie:

```typescript
    complianceThemaCodes: [],
```

- [ ] **Step 4: Bouw de thema-pills in `ClassificatieBadges.tsx`**

Voeg een import toe: `COMPLIANCE_THEMAS` uit `@/core/models/classificatie`, en
`zetComplianceThemas` uit `@/core/services/vendorService`.

Voeg een nieuw blok toe onderaan de badge-strip-`return` (na de categorie-badge, buiten de
bestaande `<button>`-rij maar binnen dezelfde `data-testid="badge-strip"`-container — of als
tweede regel eronder, wat visueel beter past gezien het multi-value karakter):

```tsx
      <div
        className="flex w-full flex-wrap items-center gap-1.5 pt-1"
        data-testid="thema-pills"
      >
        <span className="text-[11px] text-ink-muted">Thema&apos;s:</span>
        {COMPLIANCE_THEMAS.map((thema) => {
          const actief = vendor.complianceThemaCodes.includes(thema.code);

          return (
            <button
              key={thema.code}
              type="button"
              disabled={bezig}
              data-testid={`thema-pill-${thema.code}`}
              aria-pressed={actief}
              onClick={() => void toggleThema(thema.code)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                actief
                  ? 'bg-teal-100 text-teal-800'
                  : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
              }`}
            >
              {thema.label}
            </button>
          );
        })}
      </div>
```

Voeg de bijbehorende handler toe binnen de component, vóór de `return`:

```typescript
  async function toggleThema(code: string) {
    const huidige = vendor.complianceThemaCodes;
    const nieuw = huidige.includes(code)
      ? huidige.filter((c) => c !== code)
      : [...huidige, code];

    setBezig(true);
    const uitkomst = await zetComplianceThemas(vendor.vendorId, nieuw);
    setBezig(false);

    if (uitkomst.ok) {
      onOpgeslagen(uitkomst.waarde);
    }
  }
```

Een leverancier zonder enig thema toont de pills allemaal in de inactieve stijl (geen aparte
"Geen thema"-tekst nodig — de pills zelf zijn altijd zichtbaar, in tegenstelling tot de
single-value badges die leeg kunnen zijn).

- [ ] **Step 5: Handmatige verificatie via de demo-stack**

Volg de bestaande preview-procedure (zie het projectgeheugen
`mcm2-demo-link-incognito-hard-reload`): start de demo-stack met de backend-branch van Task 1/2
en de frontend-branch van deze taak, open `/beheer/leveranciers/[id]` in incognito, klik een
paar thema-pills aan en uit, en herlaad de pagina om te bevestigen dat de staat is opgeslagen
(niet alleen lokaal in de state).

- [ ] **Step 6: Committen**

```powershell
git add src/core/models/vendor.ts src/core/models/classificatie.ts `
  src/core/services/vendorService.ts `
  "src/app/beheer/leveranciers/[id]/ClassificatieBadges.tsx"
git commit -m "feat(vendor): compliance-thema's togglen op het leveranciersdetailscherm"
```

---

## Deel 2 + 3 — Nieuwe statussen en het uitgebreide overzicht

### Task 4: Backend — status `afgekeurd` toevoegen

**Files:**
- Modify: `src/survey/respons-status.ts`
- Modify: `test/respons-status.spec.ts`

- [ ] **Step 1: Schrijf de falende tests eerst**

Voeg toe aan `test/respons-status.spec.ts`, in het `describe('ingediend', ...)`-blok, ná de
bestaande `'is beoordeeld bij het inhoudelijke oordeel %s'`-test:

```typescript
    it('is afgekeurd wanneer het laatste oordeel niet_goed is', () => {
      expect(
        bepaalStatus(feiten({ ...ingediend, laatsteOordeel: 'niet_goed' })),
      ).toBe('afgekeurd');
    });

    it.each(['goed', 'nadere_vragen'])(
      'blijft beoordeeld bij het inhoudelijke oordeel %s (niet afgekeurd)',
      (laatsteOordeel) => {
        expect(bepaalStatus(feiten({ ...ingediend, laatsteOordeel }))).toBe(
          'beoordeeld',
        );
      },
    );
```

Pas de bestaande `it.each(['goed', 'nadere_vragen', 'niet_goed'])`-test aan: haal `'niet_goed'`
uit de array (die valt nu onder de nieuwe test hierboven, niet meer onder de generieke
"beoordeeld bij elk inhoudelijk oordeel"):

```typescript
    it.each(['goed', 'nadere_vragen'])(
      'is beoordeeld bij het inhoudelijke oordeel %s',
      (laatsteOordeel) => {
        expect(bepaalStatus(feiten({ ...ingediend, laatsteOordeel }))).toBe(
          'beoordeeld',
        );
      },
    );
```

(Dit maakt de nieuwe `it.each(['goed', 'nadere_vragen'])`-test hierboven een duplicaat — haal
die dubbele test weer weg, zodat er precies één `it.each`-test voor "blijft beoordeeld" bestaat.)

Pas ook de bestaande test in `describe('het laatste oordeel telt', ...)` aan — deze verwacht nu
`'beoordeeld'` bij een terugval van goedgekeurd naar niet_goed, maar dat moet `'afgekeurd'`
worden:

```typescript
    it('valt terug op afgekeurd als er na goedkeuring een afwijzing komt', () => {
      expect(
        bepaalStatus(feiten({ ...ingediend, laatsteOordeel: 'niet_goed' })),
      ).toBe('afgekeurd');
    });
```

- [ ] **Step 2: Draai de tests, bevestig dat ze falen**

Run: `npx jest respons-status.spec.ts`
Expected: FAIL — `bepaalStatus` geeft nog `'beoordeeld'` terug in plaats van `'afgekeurd'`, en
TypeScript klaagt mogelijk al dat `'afgekeurd'` geen geldige `ResponsStatus` is.

- [ ] **Step 3: Werk `respons-status.ts` bij**

Wijzig `RESPONS_STATUSSEN`:

```typescript
export const RESPONS_STATUSSEN = [
  'opgestuurd',
  'te_laat',
  'terug',
  'beoordeeld',
  'goedgekeurd',
  'afgekeurd',
  'gepland',
] as const;
```

(De `'gepland'`-waarde hoort logisch bij Task 6, maar wordt hier al toegevoegd zodat het type
in één keer compleet is — Task 6 voegt geen nieuwe entry meer toe aan deze array, alleen de
afleidingslogica in de service.)

Wijzig `STATUS_LABEL`:

```typescript
export const STATUS_LABEL: Record<ResponsStatus, string> = {
  opgestuurd: 'Opgestuurd, nog niet terug',
  te_laat: 'Te laat',
  terug: 'Terug, nog niet beoordeeld',
  beoordeeld: 'Beoordeeld, nog niet goedgekeurd',
  goedgekeurd: 'Beoordeeld en goedgekeurd',
  afgekeurd: 'Afgekeurd',
  gepland: 'Nog niet uitgenodigd',
};
```

Wijzig de laatste `return`-tak van `bepaalStatus()`:

```typescript
  // Alleen een goedkeuring als LAATSTE oordeel sluit de inzending af. Een
  // eerdere goedkeuring met daarna een inhoudelijk oordeel telt niet meer.
  if (feiten.laatsteOordeel === 'goedgekeurd') {
    return 'goedgekeurd';
  }

  // Een afkeuring moet voor een auditor in één oogopslag opvallen — vandaar
  // een eigen status in plaats van de neutrale 'beoordeeld'. 'goed' en
  // 'nadere_vragen' blijven onder 'beoordeeld' vallen.
  if (feiten.laatsteOordeel === 'niet_goed') {
    return 'afgekeurd';
  }

  return 'beoordeeld';
```

`'gepland'` wordt hier bewust niet afgeleid — die status ontstaat niet uit `StatusFeiten` (die
gaat over een bestaande respons), maar wordt in Task 6 los toegekend aan leveranciers zonder
respons. `bepaalStatus()` geeft hem dus nooit terug; hij bestaat alleen in de gedeelde
`ResponsStatus`-unie zodat frontend-code met één type kan werken.

- [ ] **Step 4: Draai de tests opnieuw, bevestig dat ze slagen**

Run: `npx jest respons-status.spec.ts`
Expected: PASS, alle tests groen inclusief de nieuwe.

- [ ] **Step 5: Committen**

```powershell
git add src/survey/respons-status.ts test/respons-status.spec.ts
git commit -m "feat(survey): status 'afgekeurd' toegevoegd aan respons-status"
```

---

### Task 5: Backend — `haalGeplandeVendors()` en thema-filter op `ContractmanagerService`

**Files:**
- Modify: `src/survey/contractmanager.service.ts`
- Modify: `src/survey/vragenlijst-beheer.controller.ts`
- Test: `test/statusoverzicht-audit.e2e-spec.ts`

De bestaande route is `GET /admin/survey/mijn-vendors?scope=organisatie` (methode
`VragenlijstBeheerController.mijnVendors()`, `src/survey/vragenlijst-beheer.controller.ts:355`,
klasse-prefix `@Controller('admin/survey')` op regel 78). Responsvorm:
`{ werkvoorraad: StatusItem[], scope: 'organisatie' | 'mij' }` — dus `werkvoorraad`, niet `items`.

- [ ] **Step 2: Voeg `StatusItem.responseId` als nullable toe, en een nieuw veld voor thema's**

In `src/survey/contractmanager.service.ts`, wijzig de `StatusItem`-interface:

```typescript
export interface StatusItem {
  /** Null voor een 'gepland'-item: er is nog geen response om naar te verwijzen. */
  responseId: string | null;
  /** Null voor een 'gepland'-item. */
  runId: string | null;
  /** Null voor een 'gepland'-item. */
  templateId: string | null;
  /** Null voor een 'gepland'-item — er is nog geen vragenlijst gekoppeld. */
  templateNaam: string | null;
  vendorId: string | null;
  vendorNaam: string | null;
  eigenaarUserId: string | null;
  eigenaarNaam: string | null;
  uitgestuurdOp: string | null;
  submittedAt: string | null;
  closesAt: string | null;
  status: ResponsStatus;
  laatsteOordeel: string | null;
  aantalOordelen: number;
  aantalNotities: number;
  /** Toegekende compliance-thema's. Leeg array wanneer er geen zijn. */
  themaCodes: string[];
}
```

Pas de bestaande `.map()` in `haal()` aan om `themaCodes` mee te geven — voeg een subquery toe
aan de SELECT:

```sql
                     (SELECT array_agg(vct.thema_code ORDER BY vct.thema_code)
                        FROM clm.vendor_compliance_thema vct
                       WHERE vct.vendor_id = s.vendor_id)  AS thema_codes,
```

(invoegen na de `aantal_notities`-subquery, vóór `FROM clm.survey_response s`), en breid
`StatusRij` uit met:

```typescript
  thema_codes: string[] | null;
```

en de `.map()`-return met:

```typescript
          themaCodes: r.thema_codes ?? [],
```

- [ ] **Step 3: Voeg het thema-filterargument toe aan `haal()`, `vanMij()`, `alles()`**

Wijzig de signaturen:

```typescript
  async vanMij(
    tenantId: string,
    userId: string,
    themaCodes: string[] = [],
  ): Promise<StatusItem[]> {
    return this.haal(tenantId, userId, themaCodes);
  }

  async alles(
    tenantId: string,
    themaCodes: string[] = [],
  ): Promise<StatusItem[]> {
    return this.haal(tenantId, null, themaCodes);
  }

  private async haal(
    tenantId: string,
    eigenaarUserId: string | null,
    themaCodes: string[],
  ): Promise<StatusItem[]> {
```

Voeg vóór de query-aanroep een omzetting toe, in dezelfde stijl als hoe `eigenaarUserId` al een
nullable parameter is (leeg filter = geen beperking = `NULL`):

```typescript
    const themaFilter = themaCodes.length === 0 ? null : themaCodes;
```

Voeg een extra `WHERE`-voorwaarde toe aan de bestaande query (na de `eigenaarUserId`-conditie),
met `themaFilter` (niet het rauwe `themaCodes`-argument):

```sql
               WHERE (${eigenaarUserId}::uuid IS NULL
                      OR v.owner_user_id = ${eigenaarUserId}::uuid)
                 AND (${themaFilter}::text[] IS NULL
                      OR EXISTS (
                        SELECT 1 FROM clm.vendor_compliance_thema vct
                         WHERE vct.vendor_id = s.vendor_id
                           AND vct.thema_code = ANY(${themaFilter}::text[])
                      ))
```

Dit volgt exact het bestaande patroon van de `eigenaarUserId`-voorwaarde hierboven (een
`NULL`-parameter betekent "geen beperking") in plaats van een JS-boolean als SQL-literal te
interpoleren, wat met Drizzle's `sql`-tag een minder voorspelbare vertaling zou kunnen geven.

- [ ] **Step 4: Voeg `haalGeplandeVendors()` toe**

Voeg een nieuwe publieke methode toe aan `ContractmanagerService`:

```typescript
  /**
   * Relevante leveranciers zonder enige survey_response — status 'gepland'.
   *
   * "Relevant" = business_criticality medium/high/critical, plus (indien
   * themaCodes niet leeg is) minstens één van de gefilterde thema's. Zie
   * docs/superpowers/specs/2026-08-25-audit-bewijsvoering-design.md, Deel 2.
   *
   * Bewuste beperking: "zonder enige response ooit", niet "zonder response in
   * de actuele ronde". Een leverancier die al eens beoordeeld is en op de
   * volgende ronde wacht, verschijnt hier niet — zie de spec voor de
   * toelichting.
   */
  async haalGeplandeVendors(
    tenantId: string,
    eigenaarUserId: string | null,
    themaCodes: string[],
  ): Promise<StatusItem[]> {
    const themaFilter = themaCodes.length === 0 ? null : themaCodes;

    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const resultaat = await tx.execute<{
          vendor_id: string;
          vendor_naam: string;
          eigenaar_user_id: string | null;
          eigenaar_naam: string | null;
          thema_codes: string[] | null;
        }>(
          sql`SELECT v.vendor_id,
                     v.name AS vendor_naam,
                     v.owner_user_id AS eigenaar_user_id,
                     o.full_name AS eigenaar_naam,
                     (SELECT array_agg(vct.thema_code ORDER BY vct.thema_code)
                        FROM clm.vendor_compliance_thema vct
                       WHERE vct.vendor_id = v.vendor_id) AS thema_codes
                FROM clm.vendor v
                LEFT JOIN clm."user" o ON o.user_id = v.owner_user_id
               WHERE v.deleted_at IS NULL
                 AND v.business_criticality_code IN ('medium', 'high', 'critical')
                 AND (${eigenaarUserId}::uuid IS NULL
                      OR v.owner_user_id = ${eigenaarUserId}::uuid)
                 AND (${themaFilter}::text[] IS NULL
                      OR EXISTS (
                        SELECT 1 FROM clm.vendor_compliance_thema vct
                         WHERE vct.vendor_id = v.vendor_id
                           AND vct.thema_code = ANY(${themaFilter}::text[])
                      ))
                 AND NOT EXISTS (
                       SELECT 1 FROM clm.survey_response s
                        WHERE s.vendor_id = v.vendor_id
                     )
               ORDER BY v.name`,
        );

        return resultaat.rows.map((r) => ({
          responseId: null,
          runId: null,
          templateId: null,
          templateNaam: null,
          vendorId: r.vendor_id,
          vendorNaam: r.vendor_naam,
          eigenaarUserId: r.eigenaar_user_id,
          eigenaarNaam: r.eigenaar_naam,
          uitgestuurdOp: null,
          submittedAt: null,
          closesAt: null,
          status: 'gepland' as const,
          laatsteOordeel: null,
          aantalOordelen: 0,
          aantalNotities: 0,
          themaCodes: r.thema_codes ?? [],
        }));
      },
      'medewerker',
    );
  }
```

- [ ] **Step 5: Voeg een samenvoegende methode toe**

```typescript
  /**
   * Het volledige overzicht: bestaande responsen + relevante vendors zonder
   * respons ('gepland'). Dit is wat het statusoverzicht-scherm aanroept.
   */
  async volledigOverzicht(
    tenantId: string,
    eigenaarUserId: string | null,
    themaCodes: string[],
  ): Promise<StatusItem[]> {
    const [bestaand, gepland] = await Promise.all([
      this.haal(tenantId, eigenaarUserId, themaCodes),
      this.haalGeplandeVendors(tenantId, eigenaarUserId, themaCodes),
    ]);

    return [...bestaand, ...gepland];
  }
```

- [ ] **Step 6: Werk `mijnVendors()` bij in `src/survey/vragenlijst-beheer.controller.ts`**

Vervang de bestaande methode (regel 355-369):

```typescript
  @Get('mijn-vendors')
  async mijnVendors(
    @Req() request: RequestMetSessie,
    @Query('scope') scope?: string,
    @Query('thema') thema?: string,
  ) {
    const sessie = request.sessie!;

    const heleOrganisatie = scope === 'organisatie';
    const themaCodes = thema ? thema.split(',').filter(Boolean) : [];

    const werkvoorraad = heleOrganisatie
      ? await this.contractmanagers.volledigOverzicht(sessie.tenantId, null, themaCodes)
      : await this.contractmanagers.volledigOverzicht(
          sessie.tenantId,
          sessie.userId,
          themaCodes,
        );

    return { werkvoorraad, scope: heleOrganisatie ? 'organisatie' : 'mij' };
  }
```

De enige inhoudelijke wijziging: `Query('thema')` erbij, `themaCodes` uitgelezen en
doorgegeven, en `volledigOverzicht()` aangeroepen in plaats van `vanMij()`/`alles()`
rechtstreeks. De responsvorm (`{ werkvoorraad, scope }`) blijft ongewijzigd.

- [ ] **Step 7: Schrijf de e2e-tests**

Reserveer een nieuw blok in `test/test-ids.ts`:

```typescript
  'statusoverzicht-audit': {
    tenant: id('28'),
    user: id('29'),
  },
```

Schrijf `test/statusoverzicht-audit.e2e-spec.ts` (bootstrap-vorm gelijk aan Task 2's suite,
maar met één tenant — dit test geen tenant-isolatie, dat dekt de bestaande
`vendor-routes`-suite al):

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
 * Het uitgebreide statusoverzicht: 'gepland' voor relevante leveranciers
 * zonder respons, en het thema-filter.
 */

const { tenant, user } = TEST_IDS['statusoverzicht-audit'];
const SUBJECT = `oid-statusoverzicht-audit-${Date.now()}`;

async function verwijderTestdata(client: Client): Promise<void> {
  await client.query('BEGIN');
  await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
  await client.query(
    'DELETE FROM clm.vendor_compliance_thema WHERE tenant_id = $1',
    [tenant],
  );
  await client.query('DELETE FROM clm.vendor WHERE tenant_id = $1', [tenant]);
  await client.query('COMMIT');

  await client.query('DELETE FROM clm.tenant_membership WHERE tenant_id = $1', [
    tenant,
  ]);
  await client.query('DELETE FROM clm."user" WHERE tenant_id = $1', [tenant]);
  await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [tenant]);
}

describe('Statusoverzicht — gepland en thema-filter', () => {
  let app: INestApplication<App>;
  let client: Client;
  let cookie: string;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(client);

    await client.query(`INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)`, [
      tenant,
      `Audit-overzicht-tenant-${Date.now()}`,
    ]);
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, oidc_subject)
       VALUES ($1, $2, 'Beheerder', $3)`,
      [user, tenant, SUBJECT],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [user, tenant],
    );

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    const sessies = app.get(SessieService);
    const sessie = await sessies.maakAan(user, tenant);
    cookie = `${cookieInstellingen.name}=${sessie.sleutel}`;
  });

  afterAll(async () => {
    await verwijderTestdata(client);
    await client.end();
    await app.close();
  });

  it('toont een relevante leverancier zonder respons als gepland', async () => {
    const aanmaak = await request(app.getHttpServer())
      .post('/vendors')
      .set('Cookie', cookie)
      .send({ name: `Relevante-vendor-${Date.now()}` });

    await request(app.getHttpServer())
      .patch(`/vendors/${aanmaak.body.vendorId}`)
      .set('Cookie', cookie)
      .send({ businessCriticalityCode: 'high' });

    const res = await request(app.getHttpServer())
      .get('/admin/survey/mijn-vendors?scope=organisatie')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const item = res.body.werkvoorraad.find(
      (i: { vendorId: string }) => i.vendorId === aanmaak.body.vendorId,
    );
    expect(item).toBeDefined();
    expect(item.status).toBe('gepland');
    expect(item.responseId).toBeNull();
  });

  it('toont een leverancier met criticaliteit "low" niet als gepland', async () => {
    const aanmaak = await request(app.getHttpServer())
      .post('/vendors')
      .set('Cookie', cookie)
      .send({ name: `Lage-criticaliteit-vendor-${Date.now()}` });

    await request(app.getHttpServer())
      .patch(`/vendors/${aanmaak.body.vendorId}`)
      .set('Cookie', cookie)
      .send({ businessCriticalityCode: 'low' });

    const res = await request(app.getHttpServer())
      .get('/admin/survey/mijn-vendors?scope=organisatie')
      .set('Cookie', cookie);

    const item = res.body.werkvoorraad.find(
      (i: { vendorId: string }) => i.vendorId === aanmaak.body.vendorId,
    );
    expect(item).toBeUndefined();
  });

  it('filtert gepland-vendors op thema', async () => {
    const aanmaak = await request(app.getHttpServer())
      .post('/vendors')
      .set('Cookie', cookie)
      .send({ name: `Thema-vendor-${Date.now()}` });

    await request(app.getHttpServer())
      .patch(`/vendors/${aanmaak.body.vendorId}`)
      .set('Cookie', cookie)
      .send({ businessCriticalityCode: 'high' });

    await request(app.getHttpServer())
      .put(`/vendors/${aanmaak.body.vendorId}/compliance-themas`)
      .set('Cookie', cookie)
      .send({ themaCodes: ['kwaliteit'] });

    const metFilter = await request(app.getHttpServer())
      .get('/admin/survey/mijn-vendors?scope=organisatie&thema=cybersecurity')
      .set('Cookie', cookie);

    expect(
      metFilter.body.werkvoorraad.find(
        (i: { vendorId: string }) => i.vendorId === aanmaak.body.vendorId,
      ),
    ).toBeUndefined();

    const zonderFilter = await request(app.getHttpServer())
      .get('/admin/survey/mijn-vendors?scope=organisatie&thema=kwaliteit')
      .set('Cookie', cookie);

    expect(
      zonderFilter.body.werkvoorraad.find(
        (i: { vendorId: string }) => i.vendorId === aanmaak.body.vendorId,
      ),
    ).toBeDefined();
  });
});
```

- [ ] **Step 8: Draai de tests geïsoleerd, dan de volledige suite**

```powershell
npx jest statusoverzicht-audit vendor-compliance-thema --runInBand
npx jest test-ids
npm run test:e2e
```

Expected: alle groen.

- [ ] **Step 9: Committen**

```powershell
git add src/survey/contractmanager.service.ts src/survey/*.controller.ts `
  test/statusoverzicht-audit.e2e-spec.ts test/test-ids.ts
git commit -m "feat(survey): 'gepland'-status en thema-filter in het statusoverzicht"
```

---

### Task 6: Frontend — thema-filter en de twee nieuwe statussen op `/beheer/status`

**Files:**
- Modify: `MCM2-frontend/src/core/models/vragenlijst.ts`
- Modify: `MCM2-frontend/src/core/services/vragenlijstService.ts`
- Modify: `MCM2-frontend/src/app/beheer/status/page.tsx`

- [ ] **Step 1: Werk het model bij**

In `MCM2-frontend/src/core/models/vragenlijst.ts`, vind `RESPONS_STATUSSEN`/`ResponsStatus`/
`STATUS_LABEL`/`STATUS_KORT` en `StatusItem`. Werk ze bij zodat ze de backend spiegelen:

Het bestand definieert `ResponsStatus` als een unie van vijf string-literals (regel 226-227,
niet als `RESPONS_STATUSSEN`-array zoals in de backend — de frontend en backend gebruiken hier
elk hun eigen vorm). Wijzig die regel:

```typescript
export type ResponsStatus =
  | 'opgestuurd'
  | 'te_laat'
  | 'terug'
  | 'beoordeeld'
  | 'goedgekeurd'
  | 'afgekeurd'
  | 'gepland';
```

Wijzig `STATUS_LABEL` (voeg de twee nieuwe regels toe, laat de bestaande vijf ongewijzigd):

```typescript
export const STATUS_LABEL: Record<ResponsStatus, string> = {
  opgestuurd: 'Opgestuurd, nog niet terug',
  te_laat: 'Te laat',
  terug: 'Terug, nog niet beoordeeld',
  beoordeeld: 'Beoordeeld, nog niet goedgekeurd',
  goedgekeurd: 'Beoordeeld en goedgekeurd',
  afgekeurd: 'Afgekeurd',
  gepland: 'Nog niet uitgenodigd',
};
```

Wijzig `STATUS_KORT` (voeg de twee nieuwe regels toe, laat de bestaande vijf — inclusief hun
afwijkende bewoording t.o.v. `STATUS_LABEL`, bijv. `terug: 'Wacht op beoordeling'` — ongewijzigd):

```typescript
export const STATUS_KORT: Record<ResponsStatus, string> = {
  opgestuurd: 'Nog niet terug',
  te_laat: 'Te laat',
  terug: 'Wacht op beoordeling',
  beoordeeld: 'Beoordeeld',
  goedgekeurd: 'Goedgekeurd',
  afgekeurd: 'Afgekeurd',
  gepland: 'Gepland',
};
```

Werk `StatusItem` bij — alle bestaande velden zijn `readonly`, dat patroon blijft gehandhaafd:

```typescript
export interface StatusItem {
  readonly responseId: string | null;
  readonly runId: string | null;
  readonly templateId: string | null;
  readonly templateNaam: string | null;
  readonly vendorId: string | null;
  readonly vendorNaam: string | null;
  readonly eigenaarUserId: string | null;
  readonly eigenaarNaam: string | null;
  readonly uitgestuurdOp: string | null;
  readonly submittedAt: string | null;
  readonly closesAt: string | null;
  readonly status: ResponsStatus;
  readonly laatsteOordeel: string | null;
  readonly aantalOordelen: number;
  readonly aantalNotities: number;
  readonly themaCodes: string[];
}
```

- [ ] **Step 2: Werk `haalStatusoverzicht` bij om een thema-filter mee te sturen**

In `MCM2-frontend/src/core/services/vragenlijstService.ts`, vervang de bestaande
`haalStatusoverzicht`-functie:

```typescript
export async function haalStatusoverzicht(
  bereik: Werkvoorraadbereik,
  themaCodes: string[] = [],
): Promise<StatusItem[]> {
  if (gebruiktMockData) {
    // In mock-modus toont "van mij" een deel van de lijst, zodat de schakelaar
    // zichtbaar iets doet. Zonder dat verschil lijkt hij stuk.
    const basis =
      bereik === 'organisatie'
        ? MOCK_STATUSOVERZICHT
        : MOCK_STATUSOVERZICHT.filter((s) => s.eigenaarUserId === 'mock-user-01');

    if (themaCodes.length === 0) {
      return basis;
    }

    return basis.filter((item) =>
      item.themaCodes.some((code) => themaCodes.includes(code)),
    );
  }

  const parameters = new URLSearchParams();
  if (bereik === 'organisatie') {
    parameters.set('scope', 'organisatie');
  }
  if (themaCodes.length > 0) {
    parameters.set('thema', themaCodes.join(','));
  }

  const query = parameters.toString();
  const pad = `/admin/survey/mijn-vendors${query ? `?${query}` : ''}`;

  const antwoord = await haalOp<{ werkvoorraad: StatusItem[] }>(pad);

  return antwoord.werkvoorraad;
}
```

Dit vervangt de losse `pad`-ternary door `URLSearchParams`, zodat `scope` en `thema`
onafhankelijk van elkaar wel of niet meegaan — de oorspronkelijke functie kende alleen twee
vaste paden (met/zonder `?scope=organisatie`).

De mock-data (`MOCK_STATUSOVERZICHT`, geïmporteerd bovenaan het bestand) moet ook een
`themaCodes`-veld per item hebben — anders faalt de `.some()`-aanroep hierboven op `undefined`.
Zoek de definitie op (waarschijnlijk `MCM2-frontend/src/data/*.mock.ts`) en voeg
`themaCodes: []` (of een voorbeeldwaarde zoals `themaCodes: ['cybersecurity']` voor minstens
één item, zodat het filter ook in mockmodus iets zichtbaars doet) toe aan elk mock-item.

- [ ] **Step 3: Voeg de thema-filter-UI toe aan `page.tsx`**

In `MCM2-frontend/src/app/beheer/status/page.tsx`, voeg state toe naast `bereik`:

```typescript
  const [themaFilter, setThemaFilter] = useState<string[]>([]);
```

Importeer `COMPLIANCE_THEMAS` uit `@/core/models/classificatie`.

Werk de `useEffect`-dependency-array en de aanroep van `haalStatusoverzicht` bij:

```typescript
        const gevonden = await haalStatusoverzicht(bereik, themaFilter);
```

en voeg `themaFilter` toe aan de dependency-array van de `useEffect`.

Voeg de filter-UI toe, na de bestaande bereik-schakelaar:

```tsx
      <div
        className="mb-6 flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label="Filter op thema"
        data-testid="thema-filter"
      >
        <span className="text-xs text-ink-muted">Thema:</span>
        {COMPLIANCE_THEMAS.map((thema) => {
          const actief = themaFilter.includes(thema.code);

          return (
            <button
              key={thema.code}
              type="button"
              onClick={() =>
                setThemaFilter((huidig) =>
                  actief
                    ? huidig.filter((c) => c !== thema.code)
                    : [...huidig, thema.code],
                )
              }
              aria-pressed={actief}
              data-testid={`thema-filter-${thema.code}`}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                actief
                  ? 'bg-teal-600 text-white'
                  : 'bg-card text-ink-muted hover:bg-surface'
              }`}
            >
              {thema.label}
            </button>
          );
        })}
      </div>
```

- [ ] **Step 4: Voeg de twee nieuwe statussen toe aan `STIJL`, `URGENTIE` en de samenvatting**

Bekijk eerst de bestaande imports voor iconen (`lucide-react`) — voeg `XCircle` toe.

Werk `STIJL` bij:

```typescript
const STIJL: Record<
  ResponsStatus,
  { klasse: string; Icoon: React.ElementType }
> = {
  opgestuurd: {
    klasse: 'border-line bg-white text-ink-muted',
    Icoon: Clock,
  },
  te_laat: {
    klasse: 'border-red-300 bg-red-50 text-red-800',
    Icoon: AlertTriangle,
  },
  terug: {
    klasse: 'border-amber-300 bg-amber-50 text-amber-800',
    Icoon: FileText,
  },
  beoordeeld: {
    klasse: 'border-blue-300 bg-blue-50 text-blue-800',
    Icoon: CheckCircle2,
  },
  goedgekeurd: {
    klasse: 'border-green-300 bg-green-50 text-green-800',
    Icoon: ShieldCheck,
  },
  afgekeurd: {
    klasse: 'border-red-400 bg-red-100 text-red-900',
    Icoon: XCircle,
  },
  gepland: {
    klasse: 'border-slate-200 bg-slate-50 text-slate-500',
    Icoon: Clock,
  },
};
```

Werk `URGENTIE` bij:

```typescript
  const URGENTIE: Record<ResponsStatus, number> = {
    afgekeurd: 0,
    te_laat: 1,
    terug: 2,
    beoordeeld: 3,
    opgestuurd: 4,
    goedgekeurd: 5,
    gepland: 6,
  };
```

Werk de samenvattingsregel bij — de bestaande array met status-volgorde:

```typescript
            {(
              [
                'afgekeurd',
                'te_laat',
                'terug',
                'beoordeeld',
                'goedgekeurd',
                'gepland',
              ] as ResponsStatus[]
            )
```

- [ ] **Step 5: Pas de tabelrij aan voor `gepland`-items**

In de `<tbody>`-rendering, vervang het blok dat de leverancier-link + templateNaam toont zodat
het werkt zonder `responseId`:

```tsx
                    <td className="px-4 py-3">
                      {item.responseId ? (
                        <Link
                          href={`/beheer/status/${item.responseId}`}
                          className="font-medium text-brand-primary hover:underline"
                        >
                          {item.vendorNaam ?? 'Onbekende leverancier'}
                        </Link>
                      ) : (
                        <Link
                          href={`/beheer/leveranciers/${item.vendorId}`}
                          className="font-medium text-brand-primary hover:underline"
                          data-testid="gepland-naar-leverancier"
                        >
                          {item.vendorNaam ?? 'Onbekende leverancier'}
                        </Link>
                      )}
                      <div className="mt-0.5 text-xs text-ink-muted">
                        {item.templateNaam ??
                          (item.themaCodes.length > 0
                            ? item.themaCodes.join(', ')
                            : '—')}
                      </div>
                    </td>
```

De drie datumkolommen (`Uitgestuurd`, `Terug ontvangen`, `Sluit op`) tonen bij `gepland`
automatisch `—` via de bestaande `datum(null)` — geen aparte wijziging nodig daar.

- [ ] **Step 6: Handmatige verificatie via de demo-stack**

Zelfde procedure als Task 3 Step 5 — controleer specifiek: een leverancier met criticaliteit
hoog/midden/kritiek zonder uitnodiging verschijnt als "Gepland", klikt door naar het
leveranciersdetailscherm; een afgekeurde inzending toont de rode "Afgekeurd"-badge; het
thema-filter beperkt beide delen van de lijst.

- [ ] **Step 7: Committen**

```powershell
git add src/core/models/vragenlijst.ts src/core/services/vragenlijstService.ts `
  src/app/beheer/status/page.tsx
git commit -m "feat(status): thema-filter en statussen 'gepland'/'afgekeurd' in het overzicht"
```

---

## Deel 4 — Bevestiging na goedkeuren

### Task 7: Frontend — bevestigingsblok na een geslaagde goedkeuring

**Files:**
- Modify: `MCM2-frontend/src/app/beheer/status/[responseId]/page.tsx`

Deze taak is volledig onafhankelijk van Taken 1-6 en kan op elk moment, ook eerder, uitgevoerd
worden.

- [ ] **Step 1: Bepaal de "is goedgekeurd"-conditie**

In `ResponsPagina`, na de bestaande `const nietIngediend = ...`-regel, voeg toe:

```typescript
  // Het bovenste (tellende) oordeel bepaalt of het dossier is afgesloten —
  // dezelfde regel als bepaalStatus() in de backend, hier lokaal afgeleid uit
  // `oordelen` (dat is al de bron voor "Eerdere oordelen" en "telt nu").
  // Bewust geen aparte useState: die zou uit de pas kunnen lopen zodra een
  // goedkeuring via "Intrekken" ongedaan wordt gemaakt.
  const isGoedgekeurd = oordelen.length > 0 && oordelen[0].verdict === 'goedgekeurd';
```

- [ ] **Step 2: Vervang de knoppenrij door een bevestigingsblok wanneer goedgekeurd**

Zoek het blok dat begint met `{nietIngediend ? (` in de JSX (rond regel 421). Wijzig de
structuur naar drie takken in plaats van twee:

```tsx
              {nietIngediend ? (
                <p
                  className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
                  data-testid="nog-niet-ingediend"
                >
                  Deze leverancier heeft nog niet ingediend. Er valt pas iets te
                  beoordelen zodra de inzending binnen is. Een notitie plaatsen
                  kan wel.
                </p>
              ) : isGoedgekeurd ? (
                <div
                  className="rounded-lg border border-green-300 bg-green-50 px-4 py-3"
                  data-testid="goedkeuring-bevestiging"
                >
                  <p className="inline-flex items-center gap-1.5 text-sm font-medium text-green-800">
                    <ShieldCheck size={15} />
                    Goedgekeurd door {oordelen[0].reviewerNaam ?? 'onbekend'} op{' '}
                    {moment(oordelen[0].createdAt)}
                  </p>
                  <Link
                    href="/beheer/status"
                    className="mt-2 inline-flex items-center gap-1.5 text-sm text-brand-primary hover:underline"
                    data-testid="terug-na-goedkeuring"
                  >
                    <ArrowLeft size={14} />
                    Terug naar het statusoverzicht
                  </Link>
                </div>
              ) : (
                <div className="rounded-lg border border-line bg-card p-4">
```

De bestaande inhoud van het formulier (toelichtingveld, de vier knoppen, de
"nadere_vragen"-toelichtingstekst) blijft ongewijzigd binnen de derde tak — alleen de openende
`<div className="rounded-lg border border-line bg-card p-4">` verschuift van de `else`-kant van
een `if/else` naar de derde tak van een `if/else if/else`. Sluit de JSX-structuur af met een
extra `)}` waar eerder één stond, aangezien er nu drie takken zijn in plaats van twee.

- [ ] **Step 3: Handmatige verificatie**

Via de demo-stack: keur een inzending goed, bevestig dat de knoppenrij verdwijnt en het groene
blok verschijnt met de juiste naam/datum. Klik "Terug naar het statusoverzicht", bevestig dat
je op `/beheer/status` uitkomt. Ga terug naar de inzending, trek de goedkeuring in via "Eerdere
oordelen" → intrekken, bevestig dat de knoppenrij weer verschijnt.

- [ ] **Step 4: Committen**

```powershell
git add "src/app/beheer/status/[responseId]/page.tsx"
git commit -m "fix(status): bevestiging tonen na goedkeuren i.p.v. stilzwijgend blijven staan"
```

---

## Zelf-review — dekking tegen de spec

| Spec-onderdeel | Taak |
|---|---|
| Deel 1 — datamodel (thema/koppeltabel) | Task 1 |
| Deel 1 — API (GET met thema's, PUT vervangen) | Task 2 |
| Deel 1 — frontend (toekennen op detailscherm) | Task 3 |
| Deel 2 — status `afgekeurd` | Task 4 |
| Deel 2 — status `gepland` | Task 5 (backend-afleiding) |
| Deel 3 — thema-filter backend | Task 5 |
| Deel 3 — thema-filter + statussen frontend | Task 6 |
| Deel 4 — bevestiging na goedkeuren | Task 7 |
| Bekende beperking: business_criticality-drempel vast, niet instelbaar | Bewust niet gebouwd — zie spec |
| Bekende beperking: gepland mist "wacht op volgende ronde"-geval | Bewust niet gebouwd — zie spec |

Geen placeholders gevonden bij nalezen. Type-consistentie gecontroleerd:
`StatusItem.responseId`/`runId`/`templateId`/`templateNaam` zijn overal `string | null`
gemaakt (backend Task 5, frontend Task 6) — geen enkele plek houdt nog de oude, niet-nullable
vorm aan. `ResponsStatus` krijgt zijn twee nieuwe waarden in Task 4 (backend) en Task 6
(frontend) met identieke stringwaarden (`afgekeurd`, `gepland`).
