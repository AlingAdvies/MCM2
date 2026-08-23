# Contract opzegtermijn, waarschuwingstermijn, verlengt-automatisch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drie nieuwe velden op `clm.contract` (opzegtermijn, waarschuwingstermijn, verlengt-automatisch), een nieuwe, herbruikbare waarschuwingsberekening die de bestaande urgentiekleur-tussenoplossing vervangt, en de bijbehorende UI, conform
`docs/superpowers/specs/2026-08-23-contract-opzegtermijn-design.md`.

**Architecture:** Backend (`MCM2`): migratie 0029, uitbreiding van `ContractService`/`contract-invoer.ts`/e2e-suite. Frontend (`MCM2-frontend`): `contractUrgentie.ts` wordt vervangen door `contractWaarschuwing.ts` (pure functie, geen React), het contractmodel en -formulier krijgen de drie nieuwe velden, `Contracten.tsx` toont de nieuwe waarschuwingsstaat.

**Tech Stack:** NestJS/Drizzle (handgeschreven migratie) backend, Next.js/React frontend — zelfde stack als de rest van het project, geen nieuwe dependencies.

---

## Bestandsoverzicht

| Bestand | Actie | Verantwoordelijkheid |
|---|---|---|
| `drizzle/0029_contract_opzegtermijn.sql` | Nieuw | Migratie: drie kolommen + CHECK-constraint |
| `drizzle/meta/_journal.json` | Wijzigen | Journal-entry voor migratie 0029 |
| `docs/runbooks/backup-verwachting.json` | Wijzigen | Migratiestand bijwerken naar 0029 |
| `src/contract/contract.service.ts` | Wijzigen | Nieuwe velden in interfaces, SELECT, INSERT, UPDATE |
| `src/contract/contract-invoer.ts` | Wijzigen | Validatie van de drie nieuwe velden |
| `src/contract/contract-invoer.spec.ts` | Wijzigen | Unittests voor de nieuwe validatie |
| `test/contract-routes.e2e-spec.ts` | Wijzigen | E2e-dekking: aanmaken/wijzigen met de nieuwe velden |
| `MCM2-frontend/src/core/models/contract.ts` | Wijzigen | Nieuwe velden op `Contract`/`ContractInvoer` |
| `MCM2-frontend/src/app/beheer/leveranciers/[id]/contractWaarschuwing.ts` | Nieuw (vervangt `contractUrgentie.ts`) | De herbruikbare berekenfunctie |
| `MCM2-frontend/src/app/beheer/leveranciers/[id]/contractUrgentie.ts` | Verwijderen | Vervangen door `contractWaarschuwing.ts` |
| `MCM2-frontend/src/app/beheer/leveranciers/[id]/Contracten.tsx` | Wijzigen | Nieuwe velden in formulier, nieuwe waarschuwingsweergave in de rij |
| `MCM2-frontend/e2e/contracten.spec.ts` | Wijzigen | E2e-dekking voor de nieuwe velden/weergave |

---

### Task 1: Migratie 0029 — drie nieuwe kolommen

**Files:**
- Create: `drizzle/0029_contract_opzegtermijn.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- =============================================================================
-- clm.contract — opzegtermijn, waarschuwingstermijn, verlengt-automatisch.
--
-- Ontwerp: docs/superpowers/specs/2026-08-23-contract-opzegtermijn-design.md
-- Aanleiding: issue #174 — de kale-einddatum-urgentiekleur (tussenoplossing
-- van 23-08) kan geen "opzegtermijn verstreken"-waarschuwing geven zonder
-- deze velden.
--
-- auto_renews krijgt bewust GEEN eigen ref-tabel (anders dan
-- ref.contract_status): drie vaste, niet-tenant-configureerbare waarden
-- rechtvaardigen geen aparte tabel. Zie de spec §3 voor de volledige
-- afweging.
-- =============================================================================

ALTER TABLE clm.contract
    ADD COLUMN notice_period_days  integer,
    ADD COLUMN warning_days_before integer NOT NULL DEFAULT 90,
    ADD COLUMN auto_renews         text;--> statement-breakpoint

ALTER TABLE clm.contract
    ADD CONSTRAINT contract_auto_renews_check
    CHECK (auto_renews IN ('ja', 'nee', 'onbekend') OR auto_renews IS NULL);--> statement-breakpoint

COMMENT ON COLUMN clm.contract.notice_period_days IS
    'Opzegtermijn in dagen vóór end_date. Nullable: niet elk contract heeft dit bekend.';--> statement-breakpoint
COMMENT ON COLUMN clm.contract.warning_days_before IS
    'Hoeveel dagen vóór de referentiedatum (opzegdatum, of end_date zonder opzegtermijn) gewaarschuwd wordt. Instelbaar per contract, default 90.';--> statement-breakpoint
COMMENT ON COLUMN clm.contract.auto_renews IS
    'ja/nee/onbekend — door de contractbeheerder zelf vastgesteld, geen afgeleide waarde. Default onbekend (NULL) bij aanmaken.';
```

- [ ] **Step 2: Voeg de journal-entry toe**

In `drizzle/meta/_journal.json`, na de entry met `"idx": 28`:

```json
    {
      "idx": 29,
      "version": "7",
      "when": 1787068800003,
      "tag": "0029_contract_opzegtermijn",
      "breakpoints": true
    }
```

- [ ] **Step 3: Toets de migratie op een verse wegwerpcontainer**

```powershell
docker run -d --name mcm2test29 -e POSTGRES_PASSWORD=pw -p 127.0.0.1:55442:5432 postgres:17.6
docker exec mcm2test29 pg_isready -U postgres
Get-Content db\roles\bootstrap-roles.sql | docker exec -i mcm2test29 psql -U postgres -q
docker exec mcm2test29 psql -U postgres -d postgres -c "ALTER ROLE clm_migrator WITH PASSWORD 'pw'; ALTER ROLE clm_api_runtime WITH PASSWORD 'pw';"
```

```powershell
$env:MIGRATION_DATABASE_URL="postgresql://clm_migrator:pw@localhost:55442/postgres"
npm run migrate:deploy
Remove-Item Env:\MIGRATION_DATABASE_URL
```

Expected: het script meldt de migratie draait tegen `localhost` (niet
`supabase.com`), en "Migraties voltooid".

- [ ] **Step 4: Bevestig in de database dat de kolommen echt bestaan**

```powershell
docker exec mcm2test29 psql -U postgres -d postgres -t -c "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_schema='clm' AND table_name='contract' AND column_name IN ('notice_period_days','warning_days_before','auto_renews') ORDER BY column_name;"
```

Expected: drie rijen — `auto_renews|text|`,
`notice_period_days|integer|`, `warning_days_before|integer|90`.

- [ ] **Step 5: Markeer de container als wegwerp en draai de bestaande e2e-suite erop**

```powershell
node scripts/markeer-wegwerp.js "toets migratie 0029"
```

```powershell
$env:DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55442/postgres"
npx jest --config test/jest-e2e.json contract-routes --forceExit
Remove-Item Env:\DATABASE_URL
```

Expected: alle bestaande contract-tests slagen nog (de nieuwe kolommen
hebben een default of zijn nullable, dus bestaande INSERT/UPDATE-paden
breken niet).

- [ ] **Step 6: Ruim de toetscontainer op, commit**

```powershell
docker rm -f mcm2test29
```

```bash
git add drizzle/0029_contract_opzegtermijn.sql drizzle/meta/_journal.json
git commit -m "feat(contract): migratie 0029 — opzegtermijn, waarschuwingstermijn, verlengt-automatisch"
```

---

### Task 2: `contract-invoer.ts` — validatie van de drie nieuwe velden

**Files:**
- Modify: `src/contract/contract-invoer.ts`
- Test: `src/contract/contract-invoer.spec.ts`

- [ ] **Step 1: Schrijf de falende tests eerst**

Voeg toe aan `src/contract/contract-invoer.spec.ts`, na de bestaande
`describe('leesNieuwContract', ...)`-tests:

```ts
describe('leesNieuwContract — opzegtermijn en verlengt-automatisch', () => {
  it('accepteert een geldige noticePeriodDays', () => {
    const invoer = leesNieuwContract({
      name: 'Hosting',
      noticePeriodDays: '90',
    });
    expect(invoer.noticePeriodDays).toBe(90);
  });

  it('laat noticePeriodDays leeg zonder invoer', () => {
    const invoer = leesNieuwContract({ name: 'Hosting' });
    expect(invoer.noticePeriodDays).toBeNull();
  });

  it('weigert een negatieve noticePeriodDays', () => {
    expect(() =>
      leesNieuwContract({ name: 'Hosting', noticePeriodDays: '-5' }),
    ).toThrow(InvoerFout);
  });

  it('weigert een niet-numerieke noticePeriodDays', () => {
    expect(() =>
      leesNieuwContract({ name: 'Hosting', noticePeriodDays: 'abc' }),
    ).toThrow(InvoerFout);
  });

  it('vult warningDaysBefore met 90 als het ontbreekt', () => {
    const invoer = leesNieuwContract({ name: 'Hosting' });
    expect(invoer.warningDaysBefore).toBe(90);
  });

  it('accepteert een expliciete warningDaysBefore', () => {
    const invoer = leesNieuwContract({
      name: 'Hosting',
      warningDaysBefore: '30',
    });
    expect(invoer.warningDaysBefore).toBe(30);
  });

  it('weigert een negatieve warningDaysBefore', () => {
    expect(() =>
      leesNieuwContract({ name: 'Hosting', warningDaysBefore: '-1' }),
    ).toThrow(InvoerFout);
  });

  it('accepteert ja/nee/onbekend voor autoRenews', () => {
    for (const waarde of ['ja', 'nee', 'onbekend']) {
      const invoer = leesNieuwContract({ name: 'Hosting', autoRenews: waarde });
      expect(invoer.autoRenews).toBe(waarde);
    }
  });

  it('laat autoRenews null zonder invoer (onbekend is de default)', () => {
    const invoer = leesNieuwContract({ name: 'Hosting' });
    expect(invoer.autoRenews).toBeNull();
  });

  it('weigert een ongeldige waarde voor autoRenews', () => {
    expect(() =>
      leesNieuwContract({ name: 'Hosting', autoRenews: 'misschien' }),
    ).toThrow(InvoerFout);
  });
});
```

- [ ] **Step 2: Draai de tests, verwacht FAIL**

Run: `npx jest contract-invoer`
Expected: FAIL — `invoer.noticePeriodDays` is `undefined` (property bestaat
nog niet op `NieuwContract`), TypeScript-compilatiefouten in de testfile
zelf zijn ook een verwacht "fail"-signaal hier.

- [ ] **Step 3: Voeg de validatiefuncties toe aan `contract-invoer.ts`**

Na `optioneelBedrag`, vóór `controleerDatumVolgorde`:

```ts
function optioneelPositiefGeheelGetal(
  waarde: unknown,
  veld: string,
): number | null {
  if (waarde === undefined || waarde === null || waarde === '') {
    return null;
  }

  const getal =
    typeof waarde === 'number' ? waarde : Number.parseInt(String(waarde), 10);

  if (
    !Number.isInteger(getal) ||
    getal < 0 ||
    String(waarde).trim() !== String(getal)
  ) {
    throw new InvoerFout(veld, `${veld} moet een positief geheel getal zijn.`);
  }

  return getal;
}

const AUTO_RENEWS_WAARDEN = ['ja', 'nee', 'onbekend'] as const;

function optioneelAutoRenews(waarde: unknown, veld: string): string | null {
  if (waarde === undefined || waarde === null || waarde === '') {
    return null;
  }

  if (
    typeof waarde !== 'string' ||
    !AUTO_RENEWS_WAARDEN.includes(waarde as (typeof AUTO_RENEWS_WAARDEN)[number])
  ) {
    throw new InvoerFout(veld, `${veld} moet ja, nee of onbekend zijn.`);
  }

  return waarde;
}
```

- [ ] **Step 4: Werk `leesNieuwContract` bij**

```ts
export function leesNieuwContract(body: unknown): NieuwContract {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Er is geen contract meegestuurd.');
  }

  const ruw = body as Record<string, unknown>;

  const startDate = optioneleDatum(ruw.startDate, 'Begindatum');
  const endDate = optioneleDatum(ruw.endDate, 'Einddatum');
  controleerDatumVolgorde(startDate, endDate);

  const warningDaysBefore = optioneelPositiefGeheelGetal(
    ruw.warningDaysBefore,
    'Waarschuwingstermijn',
  );

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
    noticePeriodDays: optioneelPositiefGeheelGetal(
      ruw.noticePeriodDays,
      'Opzegtermijn',
    ),
    // Default 90 wanneer niet meegestuurd — de spec (§3) eist dat elk
    // contract een waarschuwingstermijn heeft, nooit "geen".
    warningDaysBefore: warningDaysBefore ?? 90,
    autoRenews: optioneelAutoRenews(ruw.autoRenews, 'Verlengt automatisch'),
  };
}
```

- [ ] **Step 5: Werk `leesContractWijziging` bij**

Voeg toe, ná het `note`-blok en vóór `controleerDatumVolgorde(...)`:

```ts
  if ('noticePeriodDays' in ruw) {
    wijziging.noticePeriodDays = optioneelPositiefGeheelGetal(
      ruw.noticePeriodDays,
      'Opzegtermijn',
    );
  }
  if ('warningDaysBefore' in ruw) {
    wijziging.warningDaysBefore = optioneelPositiefGeheelGetal(
      ruw.warningDaysBefore,
      'Waarschuwingstermijn',
    );
  }
  if ('autoRenews' in ruw) {
    wijziging.autoRenews = optioneelAutoRenews(
      ruw.autoRenews,
      'Verlengt automatisch',
    );
  }
```

- [ ] **Step 6: Draai de tests opnieuw, verwacht PASS**

Run: `npx jest contract-invoer`
Expected: alle tests slagen, inclusief de nieuwe uit Step 1.

- [ ] **Step 7: Commit**

```bash
git add src/contract/contract-invoer.ts src/contract/contract-invoer.spec.ts
git commit -m "feat(contract): validatie voor opzegtermijn, waarschuwingstermijn, verlengt-automatisch"
```

---

### Task 3: `contract.service.ts` — de drie velden door de hele service

**Files:**
- Modify: `src/contract/contract.service.ts`

- [ ] **Step 1: Werk de interfaces bij**

`NieuwContract` (na `note?: string | null;`):

```ts
  noticePeriodDays?: number | null;
  warningDaysBefore?: number;
  autoRenews?: string | null;
```

`ContractWijziging` (zelfde toevoeging als `NieuwContract`, alle optioneel
inclusief `warningDaysBefore`):

```ts
  noticePeriodDays?: number | null;
  warningDaysBefore?: number;
  autoRenews?: string | null;
```

`ContractDetail` (na `note: string | null;`):

```ts
  noticePeriodDays: number | null;
  warningDaysBefore: number;
  autoRenews: string | null;
```

`ContractSamenvatting` (na `endDate: string | null;` — nodig voor de
waarschuwingsstaat in de lijstweergave zónder een extra detail-aanroep per
rij):

```ts
  noticePeriodDays: number | null;
  warningDaysBefore: number;
  autoRenews: string | null;
```

`ContractRij` (na `end_date: string | null;`):

```ts
  notice_period_days: number | null;
  warning_days_before: number;
  auto_renews: string | null;
```

`ContractDetailRij` (na `end_date: string | null;`):

```ts
  notice_period_days: number | null;
  warning_days_before: number;
  auto_renews: string | null;
```

- [ ] **Step 2: Werk `lijst()` bij — SELECT en mapping**

```ts
  async lijst(
    tenantId: string,
    vendorId: string,
  ): Promise<ContractSamenvatting[]> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const resultaat = await tx.execute<ContractRij>(
          sql`SELECT c.contract_id, c.name, c.contract_number, c.status_code,
                     c.start_date, c.end_date, c.created_at,
                     c.notice_period_days, c.warning_days_before, c.auto_renews,
                     vc.full_name AS vendor_contact_naam,
                     u.full_name AS owner_naam
                FROM clm.contract c
                LEFT JOIN clm.vendor_contact vc ON vc.contact_id = c.vendor_contact_id
                LEFT JOIN clm."user" u ON u.user_id = c.owner_user_id
               WHERE c.vendor_id = ${vendorId} AND c.deleted_at IS NULL
               ORDER BY c.created_at DESC`,
        );

        return resultaat.rows.map((r) => ({
          contractId: r.contract_id,
          name: r.name,
          contractNumber: r.contract_number,
          statusCode: r.status_code,
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

- [ ] **Step 3: Werk `maakAan()` bij — INSERT**

```ts
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
                 start_date, end_date, note,
                 notice_period_days, warning_days_before, auto_renews)
              VALUES (${tenantId}, ${vendorId}, ${invoer.name.trim()},
                      ${leegIsNull(invoer.contractNumber)},
                      ${invoer.vendorContactId ?? null},
                      ${invoer.ownerUserId ?? null},
                      ${leegIsNull(invoer.statusCode)},
                      ${invoer.valueEur ?? null},
                      ${invoer.startDate ?? null},
                      ${invoer.endDate ?? null},
                      ${leegIsNull(invoer.note)},
                      ${invoer.noticePeriodDays ?? null},
                      ${invoer.warningDaysBefore ?? 90},
                      ${invoer.autoRenews ?? null})
              RETURNING contract_id`,
        );

        const contractId = resultaat.rows[0].contract_id;

        this.logger.log(`Contract aangemaakt (${contractId}).`);

        return this.detailBinnenTransactie(tx, vendorId, contractId);
      },
      'medewerker',
    );
  }
```

- [ ] **Step 4: Werk `wijzig()` bij — UPDATE**

Voeg toe aan de `zetten`-array-opbouw, ná het `note`-blok:

```ts
        if (wijziging.noticePeriodDays !== undefined) {
          zetten.push(
            sql`notice_period_days = ${wijziging.noticePeriodDays}`,
          );
        }
        if (wijziging.warningDaysBefore !== undefined) {
          zetten.push(
            sql`warning_days_before = ${wijziging.warningDaysBefore}`,
          );
        }
        if (wijziging.autoRenews !== undefined) {
          zetten.push(sql`auto_renews = ${wijziging.autoRenews}`);
        }
```

- [ ] **Step 5: Werk `detailBinnenTransactie()` bij — SELECT en mapping**

```ts
  private async detailBinnenTransactie(
    tx: Parameters<Parameters<DatabaseService['withTenant']>[1]>[0],
    vendorId: string,
    contractId: string,
  ): Promise<ContractDetail | null> {
    const resultaat = await tx.execute<ContractDetailRij>(
      sql`SELECT c.contract_id, c.vendor_id, c.name, c.contract_number,
                 c.vendor_contact_id, c.owner_user_id, c.status_code,
                 c.value_eur, c.start_date, c.end_date, c.note,
                 c.notice_period_days, c.warning_days_before, c.auto_renews,
                 c.created_at, c.updated_at,
                 vc.full_name AS vendor_contact_naam,
                 u.full_name AS owner_naam
            FROM clm.contract c
            LEFT JOIN clm.vendor_contact vc ON vc.contact_id = c.vendor_contact_id
            LEFT JOIN clm."user" u ON u.user_id = c.owner_user_id
           WHERE c.contract_id = ${contractId}
             AND c.vendor_id = ${vendorId}
             AND c.deleted_at IS NULL`,
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
      vendorContactNaam: rij.vendor_contact_naam,
      ownerUserId: rij.owner_user_id,
      ownerGebruikerNaam: rij.owner_naam,
      statusCode: rij.status_code,
      valueEur: rij.value_eur,
      startDate: rij.start_date,
      endDate: rij.end_date,
      note: rij.note,
      createdAt: alsTekst(rij.created_at),
      updatedAt: alsTekstOfNull(rij.updated_at),
      noticePeriodDays: rij.notice_period_days,
      warningDaysBefore: rij.warning_days_before,
      autoRenews: rij.auto_renews,
    };
  }
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: geen fouten.

- [ ] **Step 7: Commit**

```bash
git add src/contract/contract.service.ts
git commit -m "feat(contract): opzegtermijn, waarschuwingstermijn, verlengt-automatisch door de service"
```

---

### Task 4: E2e-dekking backend

**Files:**
- Modify: `test/contract-routes.e2e-spec.ts`

- [ ] **Step 1: Bekijk het bestaande patroon rond regel 187 ("admin kan een contract aanmaken")**

Voeg na die test (en vóór "reviewer kan geen contract aanmaken") een nieuwe
test toe:

```ts
  it('admin kan opzegtermijn, waarschuwingstermijn en verlengt-automatisch meegeven', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie)
      .send({
        name: 'Hosting met opzegtermijn',
        endDate: '2027-12-31',
        noticePeriodDays: '90',
        warningDaysBefore: '30',
        autoRenews: 'ja',
      })
      .expect(201);

    expect(response.body.noticePeriodDays).toBe(90);
    expect(response.body.warningDaysBefore).toBe(30);
    expect(response.body.autoRenews).toBe('ja');
  });

  it('warningDaysBefore is 90 wanneer niet meegegeven', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie)
      .send({ name: 'Hosting zonder opgave' })
      .expect(201);

    expect(response.body.warningDaysBefore).toBe(90);
    expect(response.body.noticePeriodDays).toBeNull();
    expect(response.body.autoRenews).toBeNull();
  });

  it('weigert een ongeldige autoRenews-waarde', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie)
      .send({ name: 'Hosting', autoRenews: 'misschien' })
      .expect(400);

    expect(response.body.veld ?? response.body.message).toBeDefined();
  });

  it('admin kan autoRenews wijzigen op een bestaand contract', async () => {
    const aangemaakt = await request(app.getHttpServer() as Server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie)
      .send({ name: 'Wijzigtest', autoRenews: 'onbekend' })
      .expect(201);

    const gewijzigd = await request(app.getHttpServer() as Server)
      .patch(`/vendors/${vendorId}/contracts/${aangemaakt.body.contractId}`)
      .set('Cookie', adminCookie)
      .send({ autoRenews: 'nee' })
      .expect(200);

    expect(gewijzigd.body.autoRenews).toBe('nee');
  });
```

**Let op:** de exacte vorm van `request(...).set('Cookie', adminCookie)` en
de variabelenamen (`vendorId`, `adminCookie`) moeten overeenkomen met wat
er al in het bestand staat — lees de bestaande tests in
`test/contract-routes.e2e-spec.ts` (regel 106–200) voor de precieze
opzet-/cookie-variabelen vóórdat je deze vier tests toevoegt, en pas de
namen aan naar wat daar al gebruikt wordt.

- [ ] **Step 2: Draai de suite tegen een wegwerpdatabase**

```powershell
$env:DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55442/postgres"
npx jest --config test/jest-e2e.json contract-routes --forceExit
Remove-Item Env:\DATABASE_URL
```

Expected: alle tests slagen, inclusief de vier nieuwe.

- [ ] **Step 3: Draai de VOLLEDIGE e2e-suite (niet alleen deze)**

```powershell
$env:DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55442/postgres"
npx jest --config test/jest-e2e.json --forceExit
Remove-Item Env:\DATABASE_URL
```

Expected: geen regressie in andere suites — dit is de stap die botsingen
tussen suites vindt (zie MCM2-CLAUDE.md, "Een nieuwe e2e-suite schrijven").

- [ ] **Step 4: Commit**

```bash
git add test/contract-routes.e2e-spec.ts
git commit -m "test(contract): e2e-dekking voor opzegtermijn, waarschuwingstermijn, verlengt-automatisch"
```

---

### Task 5: `backup-verwachting.json` bijwerken

**Files:**
- Modify: `docs/runbooks/backup-verwachting.json`

- [ ] **Step 1: Werk het `migratiestand`-veld bij**

```json
  "migratiestand": "0029_contract_opzegtermijn",
```

`clm.contract` staat al in de tabellenlijst (sinds migratie 0027) — deze
migratie voegt kolommen toe, geen tabel, dus de tabellenlijst zelf
verandert niet.

- [ ] **Step 2: Draai de onderhoudscontrole**

```powershell
npm run verify:onderhoud
```

Expected: geen klacht over een verouderde migratiestand.

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/backup-verwachting.json
git commit -m "chore(backup): backup-verwachting.json bijgewerkt naar migratie 0029"
```

---

### Task 6: Frontend — `contract.ts`-model uitbreiden

**Files:**
- Modify: `MCM2-frontend/src/core/models/contract.ts`

- [ ] **Step 1: Werk `Contract` bij**

Na `note: string | null;`:

```ts
  noticePeriodDays: number | null;
  warningDaysBefore: number;
  autoRenews: string | null;
```

- [ ] **Step 2: Werk `ContractInvoer` bij**

Na `note?: string | null;`:

```ts
  noticePeriodDays?: number | null;
  warningDaysBefore?: number;
  autoRenews?: string | null;
```

- [ ] **Step 3: Typecheck**

Run: `cd MCM2-frontend && npx tsc --noEmit`
Expected: fouten in `Contracten.tsx` waar `uitContract()` het nieuwe
`ContractInvoer`-type nog niet vult — dat lost Task 8 op. Bevestig hier
alleen dat de foutmeldingen in dat ene bestand zitten, nergens anders.

- [ ] **Step 4: Commit**

```bash
git add src/core/models/contract.ts
git commit -m "feat(contract): opzegtermijn, waarschuwingstermijn, verlengt-automatisch op het model"
```

---

### Task 7: `contractWaarschuwing.ts` — de nieuwe berekenfunctie

**Files:**
- Create: `MCM2-frontend/src/app/beheer/leveranciers/[id]/contractWaarschuwing.ts`
- Delete: `MCM2-frontend/src/app/beheer/leveranciers/[id]/contractUrgentie.ts`

- [ ] **Step 1: Maak `contractWaarschuwing.ts`**

```ts
/**
 * Waarschuwingslogica voor een aflopend contract.
 *
 * Vervangt contractUrgentie.ts volledig (spec 2026-08-23, §4) — geen twee
 * aparte lagen. Kernprincipe: de tool bewaakt tijdigheid (waarschuwt dat
 * een moment nadert), niet of het contract daadwerkelijk automatisch
 * verlengt — dat is een apart, door de beheerder ingevuld feit
 * (`auto_renews`), zie `Contracten.tsx`.
 *
 * Bewust een pure functie zonder React/fetch-afhankelijkheden: issue #148
 * (notificaties per tenant) kan deze berekening later hergebruiken vanuit
 * een backend-notificatiejob. `vandaag` is injecteerbaar in plaats van
 * `new Date()` hardcoded, zodat zowel deze module als een toekomstige
 * server-kant dezelfde functie met een vaste datum kunnen testen/aanroepen.
 */

export type ContractWaarschuwingStaat = 'neutraal' | 'waarschuwing' | 'alarm';

/** Vaste, niet-instelbare grens voor de "bijna te laat"-staat. */
export const ALARM_DREMPEL_DAGEN = 14;

export interface ContractWaarschuwingInvoer {
  endDate: string | null;
  noticePeriodDays: number | null;
  warningDaysBefore: number;
}

export interface ContractWaarschuwingUitkomst {
  staat: ContractWaarschuwingStaat;
  /** Dagen tot de referentiedatum; negatief als die al voorbij is. Null zonder endDate. */
  dagenTotReferentie: number | null;
  /** Of de referentiedatum de opzegdatum is (true) of de kale endDate (false). */
  heeftOpzegtermijn: boolean;
  /** Vaste, korte tekst die het "waarom" benoemt — leeg bij 'neutraal'. */
  tekst: string;
}

function dagenTussen(vandaag: Date, doel: Date): number {
  const verschil =
    doel.getTime() - new Date(vandaag).setHours(0, 0, 0, 0);
  return Math.round(verschil / (1000 * 60 * 60 * 24));
}

/** De referentiedatum: de opzegdatum als noticePeriodDays bekend is, anders endDate zelf. */
function referentiedatum(
  endDate: string,
  noticePeriodDays: number | null,
): Date {
  const eind = new Date(endDate);

  if (noticePeriodDays === null) {
    return eind;
  }

  const opzegdatum = new Date(eind);
  opzegdatum.setDate(opzegdatum.getDate() - noticePeriodDays);
  return opzegdatum;
}

export function berekenContractWaarschuwing(
  invoer: ContractWaarschuwingInvoer,
  vandaag: Date = new Date(),
): ContractWaarschuwingUitkomst {
  const { endDate, noticePeriodDays, warningDaysBefore } = invoer;

  if (!endDate) {
    return {
      staat: 'neutraal',
      dagenTotReferentie: null,
      heeftOpzegtermijn: noticePeriodDays !== null,
      tekst: '',
    };
  }

  const heeftOpzegtermijn = noticePeriodDays !== null;
  const referentie = referentiedatum(endDate, noticePeriodDays);
  const dagen = dagenTussen(vandaag, referentie);

  let staat: ContractWaarschuwingStaat;
  if (dagen <= ALARM_DREMPEL_DAGEN) {
    staat = 'alarm';
  } else if (dagen <= warningDaysBefore) {
    staat = 'waarschuwing';
  } else {
    staat = 'neutraal';
  }

  const tekst = tekstVoor(staat, heeftOpzegtermijn, dagen);

  return { staat, dagenTotReferentie: dagen, heeftOpzegtermijn, tekst };
}

function tekstVoor(
  staat: ContractWaarschuwingStaat,
  heeftOpzegtermijn: boolean,
  dagen: number,
): string {
  if (staat === 'neutraal') {
    return '';
  }

  if (heeftOpzegtermijn) {
    if (dagen < 0) return 'opzegtermijn verstreken';
    if (staat === 'alarm') return 'opzegtermijn bijna verstreken';
    return 'opzegtermijn nadert';
  }

  if (dagen < 0) return 'einddatum verstreken';
  if (staat === 'alarm') return 'geen opzegtermijn bekend — einddatum bijna daar';
  return 'geen opzegtermijn bekend — einddatum nadert';
}

export const WAARSCHUWING_TEKSTKLEUR: Record<ContractWaarschuwingStaat, string> = {
  neutraal: 'text-ink-muted',
  waarschuwing: 'text-amber-700',
  alarm: 'text-red-700',
};
```

- [ ] **Step 2: Verifieer de logica handmatig** (geen Jest in deze repo, zie
  de precedent uit het vorige plan — Task 5 daar)

Create: `C:\Users\cmali\AppData\Local\Temp\claude\<sessiepad>\scratchpad\tmp-verifieer-waarschuwing.mjs`
(gebruik de scratchpad-directory uit de omgeving van de uitvoerende sessie)

```js
// Wegwerpscript: verifieert contractWaarschuwing.ts logica handmatig.
function dagenTussen(vandaag, doel) {
  return Math.round((doel.getTime() - new Date(vandaag).setHours(0,0,0,0)) / 86400000);
}
function referentiedatum(endDate, noticePeriodDays) {
  const eind = new Date(endDate);
  if (noticePeriodDays === null) return eind;
  const d = new Date(eind);
  d.setDate(d.getDate() - noticePeriodDays);
  return d;
}
function bereken({ endDate, noticePeriodDays, warningDaysBefore }, vandaag = new Date()) {
  if (!endDate) return { staat: 'neutraal', dagen: null };
  const ref = referentiedatum(endDate, noticePeriodDays);
  const dagen = dagenTussen(vandaag, ref);
  let staat;
  if (dagen <= 14) staat = 'alarm';
  else if (dagen <= warningDaysBefore) staat = 'waarschuwing';
  else staat = 'neutraal';
  return { staat, dagen };
}
function datumOver(d) { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0,10); }

const gevallen = [
  // Geen opzegtermijn: referentie = endDate zelf
  [{ endDate: datumOver(120), noticePeriodDays: null, warningDaysBefore: 90 }, 'neutraal'],
  [{ endDate: datumOver(45), noticePeriodDays: null, warningDaysBefore: 90 }, 'waarschuwing'],
  [{ endDate: datumOver(10), noticePeriodDays: null, warningDaysBefore: 90 }, 'alarm'],
  [{ endDate: datumOver(-5), noticePeriodDays: null, warningDaysBefore: 90 }, 'alarm'],
  // Met opzegtermijn: referentie = endDate - noticePeriodDays
  // endDate over 200 dagen, opzegtermijn 90 -> referentie over 110 dagen -> neutraal (warning=90)
  [{ endDate: datumOver(200), noticePeriodDays: 90, warningDaysBefore: 90 }, 'neutraal'],
  // endDate over 150 dagen, opzegtermijn 90 -> referentie over 60 dagen -> waarschuwing
  [{ endDate: datumOver(150), noticePeriodDays: 90, warningDaysBefore: 90 }, 'waarschuwing'],
  // endDate over 100 dagen, opzegtermijn 90 -> referentie over 10 dagen -> alarm
  [{ endDate: datumOver(100), noticePeriodDays: 90, warningDaysBefore: 90 }, 'alarm'],
  // endDate over 80 dagen, opzegtermijn 90 -> referentie -10 dagen (al verstreken) -> alarm
  [{ endDate: datumOver(80), noticePeriodDays: 90, warningDaysBefore: 90 }, 'alarm'],
  // aangepaste warningDaysBefore: referentie over 60 dagen, warning=30 -> neutraal
  [{ endDate: datumOver(60), noticePeriodDays: 0, warningDaysBefore: 30 }, 'neutraal'],
];

let fouten = 0;
for (const [invoer, verwacht] of gevallen) {
  const { staat, dagen } = bereken(invoer);
  const ok = staat === verwacht;
  if (!ok) fouten++;
  console.log(`${ok ? 'OK  ' : 'FOUT'} endDate=${invoer.endDate} notice=${invoer.noticePeriodDays} warn=${invoer.warningDaysBefore} -> ${staat} (dagen=${dagen}, verwacht ${verwacht})`);
}
process.exit(fouten > 0 ? 1 : 0);
```

Run: `node tmp-verifieer-waarschuwing.mjs`
Expected: alle negen gevallen "OK". Verwijder het script na een geslaagde
run.

- [ ] **Step 3: Verwijder `contractUrgentie.ts`**

```bash
rm src/app/beheer/leveranciers/[id]/contractUrgentie.ts
```

- [ ] **Step 4: Typecheck en lint**

Run: `npx tsc --noEmit && npx eslint "src/app/beheer/leveranciers/[id]/" --max-warnings 0`
Expected: fouten in `Contracten.tsx` (importeert het verwijderde bestand)
— dat lost Task 8 op.

- [ ] **Step 5: Commit**

```bash
git add "src/app/beheer/leveranciers/[id]/contractWaarschuwing.ts" "src/app/beheer/leveranciers/[id]/contractUrgentie.ts"
git commit -m "feat(contract): contractWaarschuwing.ts vervangt contractUrgentie.ts

Logica handmatig geverifieerd (9 gevallen, allemaal OK). Geen Jest in deze
repo — zie precedent in het vorige plan."
```

---

### Task 8: `Contracten.tsx` — formulier en weergave bijwerken

**Files:**
- Modify: `MCM2-frontend/src/app/beheer/leveranciers/[id]/Contracten.tsx`

Dit bestand bevat: `EindeIndicator` (te vervangen), `uitContract()` (uit te
breiden), `ContractRijen` (de compacte + uitgeklapte weergave, aan te
passen), `ContractFormuliervelden` (drie nieuwe velden), en de
import-regel bovenaan.

- [ ] **Step 1: Werk de import bovenaan bij**

Vervang:

```ts
import {
  contractUrgentie,
  dagenTotEinde,
  URGENTIE_TEKSTKLEUR,
} from './contractUrgentie';
```

Door:

```ts
import {
  berekenContractWaarschuwing,
  WAARSCHUWING_TEKSTKLEUR,
} from './contractWaarschuwing';
```

- [ ] **Step 2: Vervang `EindeIndicator`**

Was:

```tsx
function EindeIndicator({ endDate }: { endDate: string | null }) {
  const dagen = dagenTotEinde(endDate);
  if (dagen === null) return null;

  const urgentie = contractUrgentie(endDate);
  if (urgentie === 'neutraal') return null;

  const tekst = dagen < 0 ? `${Math.abs(dagen)}d verlopen` : `nog ${dagen}d`;

  return (
    <span className={`block text-[10px] ${URGENTIE_TEKSTKLEUR[urgentie]}`}>
      {tekst}
    </span>
  );
}
```

Wordt:

```tsx
function WaarschuwingIndicator({
  endDate,
  noticePeriodDays,
  warningDaysBefore,
}: {
  endDate: string | null;
  noticePeriodDays: number | null;
  warningDaysBefore: number;
}) {
  const uitkomst = berekenContractWaarschuwing({
    endDate,
    noticePeriodDays,
    warningDaysBefore,
  });

  if (uitkomst.staat === 'neutraal') return null;

  return (
    <span
      className={`block text-[10px] ${WAARSCHUWING_TEKSTKLEUR[uitkomst.staat]}`}
    >
      {uitkomst.tekst}
    </span>
  );
}
```

- [ ] **Step 3: Werk `uitContract()` bij**

Was:

```ts
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

Wordt:

```ts
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
    noticePeriodDays: contract.noticePeriodDays,
    warningDaysBefore: contract.warningDaysBefore,
    autoRenews: contract.autoRenews ?? '',
  };
}
```

- [ ] **Step 4: Werk de compacte rij in `ContractRijen` bij**

Vind de `<td>` met de einddatumkleur (zoekpatroon:
`contractUrgentie(contract.endDate)` in de JSX van de niet-uitgeklapte
rij). Was:

```tsx
        <td className="px-4 py-2">
          <span
            className={URGENTIE_TEKSTKLEUR[contractUrgentie(contract.endDate)]}
          >
            {contract.endDate ?? '—'}
          </span>
          <EindeIndicator endDate={contract.endDate} />
        </td>
```

Wordt:

```tsx
        <td className="px-4 py-2">
          <span
            className={
              WAARSCHUWING_TEKSTKLEUR[
                berekenContractWaarschuwing({
                  endDate: contract.endDate,
                  noticePeriodDays: contract.noticePeriodDays,
                  warningDaysBefore: contract.warningDaysBefore,
                }).staat
              ]
            }
          >
            {contract.endDate ?? '—'}
          </span>
          <WaarschuwingIndicator
            endDate={contract.endDate}
            noticePeriodDays={contract.noticePeriodDays}
            warningDaysBefore={contract.warningDaysBefore}
          />
        </td>
```

- [ ] **Step 5: Voeg de drie nieuwe velden toe aan `ContractFormuliervelden`**

Na het `note`-veld (het `<div className="sm:col-span-3">`-blok met de
`<textarea>`), vóór de sluitende `</div>` van de grid:

```tsx
      <Veld
        id={`${idPrefix}-noticePeriodDays`}
        label="Opzegtermijn (dagen)"
        type="number"
        waarde={waarden.noticePeriodDays?.toString() ?? ''}
        onWijzig={(w) =>
          onWijzig({
            ...waarden,
            noticePeriodDays: w === '' ? null : Number.parseInt(w, 10),
          })
        }
        fout={foutVoor('Opzegtermijn')}
      />
      <Veld
        id={`${idPrefix}-warningDaysBefore`}
        label="Waarschuwingstermijn (dagen)"
        type="number"
        waarde={(waarden.warningDaysBefore ?? 90).toString()}
        onWijzig={(w) =>
          onWijzig({
            ...waarden,
            warningDaysBefore: w === '' ? 90 : Number.parseInt(w, 10),
          })
        }
        fout={foutVoor('Waarschuwingstermijn')}
      />
      <Keuzeveld
        id={`${idPrefix}-autoRenews`}
        label="Verlengt automatisch"
        waarde={waarden.autoRenews ?? ''}
        keuzes={[
          { code: 'ja', label: 'Ja' },
          { code: 'nee', label: 'Nee' },
          { code: 'onbekend', label: 'Onbekend' },
        ]}
        onWijzig={(w) => onWijzig({ ...waarden, autoRenews: w })}
      />
```

**Let op:** `Veld`'s `waarde`-prop verwacht `string`, dus
`noticePeriodDays` (een `number | null | undefined` in `ContractInvoer`)
moet hier expliciet naar string omgezet worden — geen kale
`waarden.noticePeriodDays` doorgeven.

- [ ] **Step 6: Voeg de drie velden toe aan de uitgeklapte detailweergave**

In het niet-bewerkstand-blok van `ContractRijen` (het `<div
className="mb-3 grid grid-cols-3 gap-3">`-blok met Contractnummer/
Begindatum/Contactpersoon/Waarde/Notitie), voeg twee `<div>`'s toe naast
de bestaande:

```tsx
                  <div>
                    <span className="text-ink-muted">Opzegtermijn</span>
                    <br />
                    {contract.noticePeriodDays !== null
                      ? `${contract.noticePeriodDays} dagen`
                      : '—'}
                  </div>
                  <div>
                    <span className="text-ink-muted">Verlengt automatisch</span>
                    <br />
                    {contract.autoRenews === 'ja' && 'Ja'}
                    {contract.autoRenews === 'nee' && 'Nee'}
                    {(contract.autoRenews === null ||
                      contract.autoRenews === 'onbekend') &&
                      'Onbekend'}
                  </div>
```

- [ ] **Step 7: Typecheck en lint**

Run: `npx tsc --noEmit && npx eslint "src/app/beheer/leveranciers/[id]/" --max-warnings 0`
Expected: schoon.

- [ ] **Step 8: Prettier**

Run: `npx prettier --check "src/app/beheer/leveranciers/[id]/Contracten.tsx"`
Bij afwijking: `npx prettier --write` op datzelfde pad, dan opnieuw
`--check`.

- [ ] **Step 9: Commit**

```bash
git add "src/app/beheer/leveranciers/[id]/Contracten.tsx"
git commit -m "feat(contract): opzegtermijn, waarschuwingstermijn, verlengt-automatisch in formulier en weergave"
```

---

### Task 9: E2e-dekking frontend

**Files:**
- Modify: `MCM2-frontend/e2e/contracten.spec.ts`

- [ ] **Step 1: Voeg een test toe die de nieuwe velden invult en de
  weergave controleert**

Naar het patroon van de bestaande "toont status en einddatum-indicator"-
test (zoek die op in het bestand voor de exacte `maakEnOpen`/selector-stijl
en volg die precies):

```ts
  test('toont de waarschuwingstekst bij een naderende opzegtermijn', async ({
    page,
  }) => {
    await maakEnOpen(page);

    const naam = `Contract-opzeg-${Date.now()}`;
    const eindDatum = new Date(Date.now() + 100 * 86400000)
      .toISOString()
      .slice(0, 10);

    await page.locator('#nieuw-contract-name').fill(naam);
    await page.locator('#nieuw-contract-endDate').fill(eindDatum);
    await page
      .locator('#nieuw-contract-noticePeriodDays')
      .fill('90');
    await page.getByTestId('voeg-contract-toe').click();

    // endDate over 100 dagen, opzegtermijn 90 -> referentiedatum over 10
    // dagen -> alarm-staat.
    await expect(page.getByTestId('contract-rij').first()).toContainText(
      'opzegtermijn bijna verstreken',
    );
  });

  test('toont "Onbekend" als default voor verlengt automatisch', async ({
    page,
  }) => {
    await maakEnOpen(page);

    const naam = `Contract-onbekend-${Date.now()}`;
    await page.locator('#nieuw-contract-name').fill(naam);
    await page.getByTestId('voeg-contract-toe').click();
    await expect(page.getByTestId('contract-rij').first()).toContainText(naam);

    await page.getByTestId('contract-rij').first().click();
    await expect(page.getByTestId('contract-detail')).toContainText(
      'Onbekend',
    );
  });
```

- [ ] **Step 2: Draai de suite volledig**

```powershell
$env:BEHEER_COOKIE = ... # zoals de bestaande suite-instructies bovenaan het bestand aangeven
npx playwright test e2e/contracten.spec.ts
```

Expected: alle tests slagen, inclusief de twee nieuwe.

- [ ] **Step 3: Commit**

```bash
git add e2e/contracten.spec.ts
git commit -m "test(contract): e2e-dekking voor opzegtermijn-waarschuwing en verlengt-automatisch"
```

---

### Task 10: Preview en handmatige controle

**Files:** geen bestandswijziging — verificatiestap.

- [ ] **Step 1: Herstart de lokale demo-stack met de gewijzigde backend en
  frontend**

De backend-migratie moet vóór het starten al toegepast zijn op de
demo-database (via `npm run demo -- --vers` als de demo-database opnieuw
opgebouwd moet worden, of via een los `migrate:deploy` tegen de bestaande
demo-database als die blijft staan — kies op basis van wat sneller is,
beide zijn geldig).

```powershell
npm run demo
```

- [ ] **Step 2: Loop de spec-punten handmatig na**

- Een contract aanmaken met opzegtermijn 90 en een einddatum over 100
  dagen toont "opzegtermijn bijna verstreken" in rood.
- Een contract zonder opzegtermijn en een einddatum over 40 dagen toont
  "geen opzegtermijn bekend — einddatum nadert" in oranje (bij
  waarschuwingstermijn 90).
- "Verlengt automatisch" staat standaard op "Onbekend" bij een nieuw
  contract, en is te wijzigen naar Ja/Nee in de uitgeklapte rij.
- De waarschuwingstermijn is aanpasbaar per contract en verandert
  zichtbaar het moment waarop de kleur omslaat.

- [ ] **Step 3: Meld het resultaat**

Terugkoppelen aan de eigenaar of de preview klopt met de spec, vóór er
gemerged wordt (git-ritueel: pushen → mergen of bewust parkeren, zowel
backend als frontend apart).

---

## Self-review — dekking tegen de spec

- **§3 Datamodel:** Task 1 — gedekt.
- **§4 Waarschuwingslogica (referentiedatum, drie staten, teksten):**
  Task 7 — gedekt, inclusief de vaste 14-dagen-alarmdrempel.
- **§5 `auto_renews` apart getoond:** Task 8 Step 6 — gedekt.
- **§6 UI (formulier + rij + uitgeklapte rij):** Task 8 — gedekt.
- **§7 Herbruikbaarheid voor #148:** Task 7 — de functie accepteert
  primitieve waarden en een injecteerbare `vandaag`-parameter, geen
  React/fetch-afhankelijkheden — gedekt.
- **§8 Wat ongewijzigd blijft (routes, rest van het scherm):** geen taak
  raakt de routes of de badge-strip/modal/uitklap-structuur — bevestigd,
  geen aparte taak nodig.
- **§9 Test/verificatiestrategie:** Task 2 (unittests), Task 4 (backend
  e2e), Task 7 Step 2 (handmatige verificatie berekenfunctie), Task 9
  (frontend e2e), Task 5 (`backup-verwachting.json`) — gedekt.
