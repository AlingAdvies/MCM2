# Werkingsgebied op contracten (#234) — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contracten kunnen koppelen aan één of meer tenant-eigen werkingsgebieden (bijv. ANF, HWGO, Utrecht Binnen) en per contract vastleggen of het centraal of operationeel beheerd wordt, met filters in het contract- en leveranciersoverzicht en ondersteuning in de contract-import.

**Architecture:** Nieuwe tenant-eigen waardenlijst `clm.werkingsgebied` (samengestelde PK `(tenant_id, code)`, zelfde patroon als `ref.vendor_category`) plus koppeltabel `clm.contract_werkingsgebied` (zelfde patroon als `clm.vendor_compliance_thema`) en een kolom `clm.contract.beheer`. Een nieuwe NestJS-module voor het beheer van de lijst; contract-, vendor- en importservice worden uitgebreid. In de frontend verschijnen filter, kolom en formuliervelden **alleen als de tenant minstens één werkingsgebied heeft**: zo ziet alleen Transdev DEV het, zonder feature-schakelaar.

**Tech Stack:** NestJS + Drizzle + handgeschreven SQL-migratie (backend `C:\DEV\Work\MCM2`), Next.js 15 (frontend `C:\DEV\Work\MCM2-frontend`), Jest unit- en e2e-tests.

> **Koerswijziging tijdens uitvoering (2026-10-10, na het bekijken van het
> formulier door de eigenaar):** het veld `beheer` (centraal/operationeel) is
> **geschrapt**, overal: migratie 0046, contractroutes, import, scripts en
> frontend. De eigenaar maakte "CENTRAAL" als werkingsgebied aan en zag dat het
> aparte veld daarmee dubbel was. "Centraal beheerd" = een werkingsgebied dat de
> tenant zelf aanmaakt en aanvinkt; in de import: `ANF, Centraal` in de kolom
> `Werkingsgebied`. Waar hieronder `beheer` staat, is dat historie. Omdat er
> nog niets gemerged of uitgerold was, is 0046 zelf aangepast in plaats van
> een herstelmigratie (alleen de lokale demodatabase had de oude versie; daar
> is de kolom met de hand verwijderd).

---

## 0. Besluiten (intake en ontwerp, eigenaar 2026-10-10)

| Vraag | Besluit |
|---|---|
| Use case | Beide: de operationele manager filtert op zijn gebied, en centraal ziet alles en filtert per gebied of op beheer |
| Gebruik | PC |
| Criticality | Productie via de OTAP-keten; eerste echte gebruik in Transdev DEV (ANF-MVP) |
| Security | **Alleen filteren.** Geen zichtbaarheid per gebied, geen RLS-wijziging buiten de nieuwe tabellen zelf |
| Aan/uit per tenant | **Via de data:** UI-elementen alleen tonen als de tenant ≥1 werkingsgebied heeft. Geen feature-schakelaar (die UI is op 04-09 teruggedraaid en de backend dwingt `tenant_feature` nergens af) |
| `beheer` | **Per contract:** `centraal` / `operationeel` / leeg |
| Koppeling | Op het **contract**, meerdere gebieden per contract. Een leverancier valt in een gebied als minstens één actief contract daarin valt |
| ANF-upload | Wacht tot dit gebouwd is; de import leest dan de kolom `Werkingsgebied` uit `docs/Upload_Transdev_ANF_Coupa_10_10.csv` direct |

**Buiten scope:** zichtbaarheid per gebied; automatisch vertalen van Coupa's `Region or Concession`-waarden (`OV: Stadsregio Arnhem-…`, cijfercodes `810110` enz.). Daarvoor is eerst de codelijst van Transdev nodig.

## 1. Bestandsstructuur

**Backend — nieuw**
- `drizzle/0046_werkingsgebied.sql`: twee tabellen + kolom + RLS + GRANTs
- `src/werkingsgebied/werkingsgebied-invoer.ts` (+ `.spec.ts`): validatie
- `src/werkingsgebied/werkingsgebied.service.ts`: CRUD op de lijst
- `src/werkingsgebied/werkingsgebied.controller.ts`: routes `/werkingsgebieden`
- `src/werkingsgebied/werkingsgebied.module.ts`
- `test/werkingsgebied-routes.e2e-spec.ts`

**Backend — wijzigen**
- `drizzle/meta/_journal.json`
- `src/db/schema.ts`: twee tabellen + `contract.beheer`
- `src/db/rechten-contract.ts`: rechten van de twee nieuwe tabellen
- `src/app.module.ts`: module registreren
- `src/contract/contract.service.ts`, `src/contract/contract-invoer.ts`, `src/contract/contract.controller.ts`
- `src/vendor/vendor.service.ts`: `werkingsgebiedCodes` in de lijst
- `src/contract-import/contract-import-schema.ts` (+ spec), `src/contract-import/contract-import.service.ts`
- `test/test-ids.ts`, `test/contract-import.e2e-spec.ts`
- `scripts/tenant-opschonen.js`, `scripts/tenant-kopieren.js` (+ runbooks): de nieuwe tabellen
- `docs/runbooks/backup-verwachting.json`

**Frontend — nieuw**
- `src/core/models/werkingsgebied.ts`, `src/core/services/werkingsgebiedService.ts`
- `src/app/beheer/werkingsgebieden/page.tsx`

**Frontend — wijzigen**
- `src/core/models/contract.ts` (of waar de contracttypes staan), `src/core/models/vendor.ts`
- `src/core/services/contractService.ts`, mockdata
- `src/shared/components/layout/Sidebar.tsx`
- `src/app/beheer/contracten/page.tsx`, `src/app/beheer/leveranciers/page.tsx`, `src/app/beheer/leveranciers/[id]/Contracten.tsx`

---

## Taak 1: Migratie 0046 en Drizzle-schema

**Files:** create `drizzle/0046_werkingsgebied.sql`; modify `drizzle/meta/_journal.json`, `src/db/schema.ts`, `src/db/rechten-contract.ts`

- [ ] **Stap 1.1: Schrijf de migratie** (stijl van `drizzle/0031_compliance_thema.sql`)

```sql
-- =============================================================================
-- Werkingsgebied op contracten (#234).
--
-- clm.werkingsgebied: tenant-eigen waardenlijst (ANF, HWGO, Utrecht Binnen…),
-- zelfde opzet als ref.vendor_category sinds 0034 (PK (tenant_id, code)).
-- clm.contract_werkingsgebied: koppeling contract <-> werkingsgebied, meerdere
-- per contract (zelfde opzet als clm.vendor_compliance_thema, 0031).
-- clm.contract.beheer: centraal of operationeel beheerd, per contract.
--
-- Expliciete GRANTs: default privileges werken op productie niet betrouwbaar
-- voor nieuwe clm-tabellen (CLAUDE.md punt 8, migratie 0039).
-- =============================================================================

CREATE TABLE clm.werkingsgebied (
    tenant_id  uuid        NOT NULL,
    code       text        NOT NULL,
    label      text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT werkingsgebied_pkey PRIMARY KEY (tenant_id, code),
    CONSTRAINT werkingsgebied_tenant_fk FOREIGN KEY (tenant_id)
        REFERENCES clm.tenant (tenant_id) ON DELETE CASCADE
);--> statement-breakpoint

ALTER TABLE clm.werkingsgebied ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.werkingsgebied FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY werkingsgebied_isolation ON clm.werkingsgebied
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

REVOKE ALL ON clm.werkingsgebied FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON clm.werkingsgebied TO clm_api, clm_admin;--> statement-breakpoint

CREATE TABLE clm.contract_werkingsgebied (
    contract_id         uuid        NOT NULL,
    tenant_id           uuid        NOT NULL,
    werkingsgebied_code text        NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT contract_werkingsgebied_pkey PRIMARY KEY (contract_id, werkingsgebied_code),
    CONSTRAINT contract_werkingsgebied_contract_fk FOREIGN KEY (contract_id)
        REFERENCES clm.contract (contract_id) ON DELETE CASCADE,
    CONSTRAINT contract_werkingsgebied_gebied_fk FOREIGN KEY (tenant_id, werkingsgebied_code)
        REFERENCES clm.werkingsgebied (tenant_id, code) ON DELETE CASCADE,
    CONSTRAINT contract_werkingsgebied_tenant_fk FOREIGN KEY (tenant_id)
        REFERENCES clm.tenant (tenant_id) ON DELETE CASCADE
);--> statement-breakpoint

CREATE INDEX contract_werkingsgebied_tenant_idx ON clm.contract_werkingsgebied (tenant_id);--> statement-breakpoint
CREATE INDEX contract_werkingsgebied_gebied_idx ON clm.contract_werkingsgebied (tenant_id, werkingsgebied_code);--> statement-breakpoint

ALTER TABLE clm.contract_werkingsgebied ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.contract_werkingsgebied FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY contract_werkingsgebied_isolation ON clm.contract_werkingsgebied
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

REVOKE ALL ON clm.contract_werkingsgebied FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON clm.contract_werkingsgebied TO clm_api, clm_admin;--> statement-breakpoint

ALTER TABLE clm.contract
    ADD COLUMN beheer text
    CONSTRAINT contract_beheer_check CHECK (beheer IN ('centraal', 'operationeel'));--> statement-breakpoint

COMMENT ON TABLE clm.werkingsgebied IS
    'Tenant-eigen werkingsgebieden (concessies/organisatie-onderdelen), bijv. ANF, HWGO. #234.';--> statement-breakpoint
COMMENT ON TABLE clm.contract_werkingsgebied IS
    'Koppeling contract <-> werkingsgebied, meerdere per contract. #234.';--> statement-breakpoint
COMMENT ON COLUMN clm.contract.beheer IS
    'Centraal of operationeel beheerd; NULL = niet vastgelegd. #234.';
```

> **Vóór je dit schrijft:** controleer met `grep -n "clm_readonly" drizzle/0031_compliance_thema.sql` dat `clm_readonly` ook daar in de REVOKE staat. Neem de rolnamen over uit 0031 en verzin ze niet.

- [ ] **Stap 1.2: Registreer in het journal.** Voeg na de entry `idx: 45` toe:

```json
    {
      "idx": 46,
      "version": "7",
      "when": 1787068800020,
      "tag": "0046_werkingsgebied",
      "breakpoints": true
    }
```

- [ ] **Stap 1.3: Drizzle-schema.** In `src/db/schema.ts`:
  - Voeg `werkingsgebied` toe naar het voorbeeld van `vendorCategory` (regel ~31-41, `primaryKey({ columns: [t.tenantId, t.code] })`), met `createdAt`.
  - Voeg `contractWerkingsgebied` toe naar het voorbeeld van `vendorComplianceThema` (~363-381). De samengestelde FK declareer je zoals de bestaande `vendor_category_tenant_fk` op `vendor` (zoek `vendor_category_tenant_fk` in schema.ts), met `onDelete('cascade')`.
  - Voeg op `contract` toe: `beheer: text('beheer'), // 'centraal' | 'operationeel' | null — CHECK in 0046`.
  - Gebruik `//`-regelcommentaar, zoals de rest van het bestand.

- [ ] **Stap 1.4: Rechtencontract.** In `src/db/rechten-contract.ts`, naast `'clm.vendor_compliance_thema'`:

```ts
  // clm.werkingsgebied (0046): tenant-eigen lijst, beheerder mag alles.
  'clm.werkingsgebied': LEZEN_EN_SCHRIJVEN,
  // clm.contract_werkingsgebied (0046): koppeling zonder eigen levenscyclus,
  // zelfde redenering als contract_survey_template.
  'clm.contract_werkingsgebied': ['SELECT', 'INSERT', 'DELETE'],
```

- [ ] **Stap 1.5: Verifiëren tegen een wegwerpdatabase**

```powershell
npm run test:db -- "werkingsgebied-migratie"
# exporteer de twee URL's die het script afdrukt
npx jest --config ./test/jest-e2e.json schema-conformiteit rechten-contract --runInBand
```

Verwacht: beide suites groen (ze controleren de nieuwe tabellen automatisch: FORCE RLS, rechten, schema ↔ database).

- [ ] **Stap 1.6: Commit**: `feat(werkingsgebied): migratie 0046 — werkingsgebied, koppeling en contract.beheer`

---

## Taak 2: Backendmodule werkingsgebieden (CRUD)

**Files:** create `src/werkingsgebied/*`, `test/werkingsgebied-routes.e2e-spec.ts`; modify `src/app.module.ts`, `test/test-ids.ts`

- [ ] **Stap 2.1: Invoer + unittest.** `werkingsgebied-invoer.ts` is een kopie van `src/vendor-category/vendor-category-invoer.ts`, met de typenamen `NieuwWerkingsgebied` en `WerkingsgebiedWijziging`, plus één extra functie:

```ts
/** Voor PUT …/contracts/:id/werkingsgebieden — body `{ codes: string[] }`. */
export function leesWerkingsgebiedCodes(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.codes)) {
    throw new InvoerFout('Verwacht een lijst met codes.', 'codes');
  }
  const codes = body.codes.map((c) => {
    if (typeof c !== 'string' || !CODE_PATROON.test(c)) {
      throw new InvoerFout(`Ongeldige code: ${String(c)}`, 'codes');
    }
    return c;
  });
  return [...new Set(codes)];
}
```

Let op: deze `InvoerFout` heeft de volgorde `(message, veld)`, net als het categorieënbestand. Die van `contract-invoer.ts` heeft de omgekeerde volgorde.

`werkingsgebied-invoer.spec.ts` toetst: een geldige nieuwe invoer; een code met hoofdletters of spaties wordt geweigerd; een leeg label wordt geweigerd; `leesWerkingsgebiedCodes` haalt dubbele codes weg, weigert een niet-array en weigert een ongeldige code.

- [ ] **Stap 2.2: Service + controller + module.** Kopieer `vendor-category.service.ts`, `vendor-category.controller.ts` en `vendor-category.module.ts` en vervang:
  - de tabel `ref.vendor_category` door `clm.werkingsgebied`
  - de route `@Controller('vendor-categories')` door `@Controller('werkingsgebieden')`
  - de response-sleutel `{ categorieen }` door `{ werkingsgebieden }`
  - de meldingen "Categorie niet gevonden." door "Werkingsgebied niet gevonden."
  - het commentaar bij `verwijder` door: koppelingen met contracten verdwijnen mee (ON DELETE CASCADE)

  Registreer `WerkingsgebiedModule` in `src/app.module.ts`, naast `VendorCategoryModule`.

- [ ] **Stap 2.3: Test-ID's.** In `test/test-ids.ts`, na `'tenant-feature-routes'`:

```ts
  'werkingsgebied-routes': {
    tenantA: id('51'),
    tenantB: id('52'),
    adminA: id('53'),
    userA: id('54'),
  },
```

- [ ] **Stap 2.4: e2e-suite** `test/werkingsgebied-routes.e2e-spec.ts`, naar het voorbeeld van `test/vendor-category-routes.e2e-spec.ts` (opzet, sessies en opruimen). Tests:
  1. Een admin maakt een gebied aan; `GET /werkingsgebieden` geeft het terug.
  2. Een dubbele code geeft 400 met `veld: 'code'`.
  3. Een `user` (geen admin) krijgt 403 op POST, PATCH en DELETE.
  4. Tenant B ziet de gebieden van tenant A niet.
  5. PATCH wijzigt het label; DELETE geeft 204, en daarna 404 op dezelfde code.

  Lees vóór het schrijven `CLAUDE.md` §"Een nieuwe e2e-suite schrijven". Draai daarna `npx jest test-ids` én de volledige e2e-run.

- [ ] **Stap 2.5: Draaien en committen.** Unittest en de nieuwe suite groen. Commit: `feat(werkingsgebied): beheerroutes voor werkingsgebieden`

---

## Taak 3: Contract: werkingsgebieden en beheer

**Files:** modify `src/contract/contract.service.ts`, `contract-invoer.ts`, `contract.controller.ts`; extend `test/werkingsgebied-routes.e2e-spec.ts`

- [ ] **Stap 3.1: Types.** Voeg toe aan `ContractSamenvatting` (en daarmee `ContractTenantBreed`) en `ContractDetail`:

```ts
  beheer: 'centraal' | 'operationeel' | null;
  werkingsgebiedCodes: string[];
```

Voeg `beheer?: 'centraal' | 'operationeel' | null` toe aan `NieuwContract` en `ContractWijziging`. Breid `ContractRij`/`ContractDetailRij` uit met `beheer: string | null; werkingsgebied_codes: string[] | null;`.

- [ ] **Stap 3.2: SQL.** Voeg in **elke** SELECT in `lijst`, `lijstTenantBreed` en `detailBinnenTransactie` toe:

```sql
c.beheer,
(SELECT array_agg(cw.werkingsgebied_code ORDER BY cw.werkingsgebied_code)
   FROM clm.contract_werkingsgebied cw
  WHERE cw.contract_id = c.contract_id) AS werkingsgebied_codes
```

Neem in elke mapping op: `beheer: r.beheer as ContractSamenvatting['beheer'], werkingsgebiedCodes: r.werkingsgebied_codes ?? []`. Voeg `beheer` toe aan de INSERT in `maakAan` (`${invoer.beheer ?? null}`), en in `wijzig`:

```ts
        if (wijziging.beheer !== undefined) {
          zetten.push(sql`beheer = ${wijziging.beheer}`);
        }
```

- [ ] **Stap 3.3: Invoer.** In `contract-invoer.ts`, naar het voorbeeld van `optioneelAutoRenews`. **Let op de argumentvolgorde `InvoerFout(veld, melding)` in dit bestand:**

```ts
const BEHEER_WAARDEN = ['centraal', 'operationeel'] as const;

function optioneelBeheer(
  waarde: unknown,
  veld: string,
): 'centraal' | 'operationeel' | null {
  if (waarde === undefined || waarde === null || waarde === '') return null;
  if (
    typeof waarde !== 'string' ||
    !BEHEER_WAARDEN.includes(waarde as (typeof BEHEER_WAARDEN)[number])
  ) {
    throw new InvoerFout(veld, `${veld} moet centraal of operationeel zijn.`);
  }
  return waarde as 'centraal' | 'operationeel';
}
```

Gebruik dit in `leesNieuwContract` (`beheer: optioneelBeheer(ruw.beheer, 'Beheer')`) en in `leesContractWijziging` (`if ('beheer' in ruw) wijziging.beheer = optioneelBeheer(ruw.beheer, 'Beheer');`).

- [ ] **Stap 3.4: Koppeling vervangen.** Een nieuwe servicemethode, naar het voorbeeld van `zetSurveyTemplates`:

```ts
  /** Vervangt de volledige set werkingsgebieden van een contract. Null als het contract niet bestaat. */
  async zetWerkingsgebieden(
    tenantId: string,
    vendorId: string,
    contractId: string,
    codes: string[],
  ): Promise<string[] | null> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const bestaat = await tx.execute<{ contract_id: string }>(
          sql`SELECT contract_id FROM clm.contract
             WHERE contract_id = ${contractId}
               AND vendor_id = ${vendorId}
               AND deleted_at IS NULL`,
        );
        if (bestaat.rows.length === 0) return null;

        await tx.execute(
          sql`DELETE FROM clm.contract_werkingsgebied WHERE contract_id = ${contractId}`,
        );
        for (const code of codes) {
          await tx.execute(
            sql`INSERT INTO clm.contract_werkingsgebied (contract_id, tenant_id, werkingsgebied_code)
                VALUES (${contractId}, ${tenantId}, ${code})`,
          );
        }
        return [...codes].sort();
      },
      'medewerker',
    );
  }
```

Route in `contract.controller.ts`, naar het voorbeeld van `PUT :id/survey-templates` (zelfde guards, `@VereistRol('admin', 'user')`): `PUT :id/werkingsgebieden` met body `leesWerkingsgebiedCodes(body)`. Response: `{ werkingsgebiedCodes }`, 404 als `null`. Een onbekende code geeft een FK-schending, code `23503` (lees de code net als in `alsDuplicaatFout` in de vendor-category-controller). Vang die af als **400** `{ message: 'Onbekend werkingsgebied.', veld: 'codes' }`.

- [ ] **Stap 3.5: e2e-tests**, toegevoegd aan `werkingsgebied-routes.e2e-spec.ts` (fixture: een vendor met een contract in tenant A):
  1. PUT met twee bestaande codes; GET op het contractdetail geeft `werkingsgebiedCodes` gesorteerd terug.
  2. PUT met een onbekende code geeft 400 `veld: 'codes'`.
  3. PATCH `{ beheer: 'operationeel' }` wordt bewaard; `{ beheer: 'x' }` geeft 400.
  4. `GET /contracts` (tenant-breed) bevat `werkingsgebiedCodes` en `beheer`.
  5. DELETE van een gebied laat het contract bestaan; daarna is `werkingsgebiedCodes` leeg.

- [ ] **Stap 3.6: Draaien en committen**: `feat(contract): werkingsgebieden en beheer per contract`

---

## Taak 4: Leveranciers: werkingsgebieden via de contracten

**Files:** modify `src/vendor/vendor.service.ts`; extend e2e

- [ ] **Stap 4.1:** Voeg aan `VendorSamenvatting` toe: `werkingsgebiedCodes: string[]` (commentaar: afgeleid uit actieve contracten, zie #234). Voeg in de `lijst()`-SQL toe:

```sql
(SELECT array_agg(DISTINCT cw.werkingsgebied_code ORDER BY cw.werkingsgebied_code)
   FROM clm.contract co
   JOIN clm.contract_werkingsgebied cw ON cw.contract_id = co.contract_id
  WHERE co.vendor_id = v.vendor_id AND co.deleted_at IS NULL) AS werkingsgebied_codes
```

Mapping: `werkingsgebiedCodes: r.werkingsgebied_codes ?? []`. Typ het rijveld in `VendorRij`.

- [ ] **Stap 4.2: e2e-test:** `GET /vendors` geeft de codes van de vendor; een soft-deleted contract telt niet mee.
- [ ] **Stap 4.3: Commit**: `feat(vendor): werkingsgebieden in leverancierslijst`

---

## Taak 5: Contract-import: kolommen Werkingsgebied en Beheer

**Files:** modify `src/contract-import/contract-import-schema.ts` (+ spec), `contract-import.service.ts`; extend `test/contract-import.e2e-spec.ts`

- [ ] **Stap 5.1: Schema.** In `ContractImportInvoer`:

```ts
  /** Ruwe teksten uit de kolom Werkingsgebied, gesplitst op , ; | (leeg = []). */
  werkingsgebieden: string[];
  /** Geduid tegen centraal/operationeel; null bij leeg of onbekend. */
  beheer: 'centraal' | 'operationeel' | null;
```

Geef beide velden in `maakInvoer` een begin: `werkingsgebieden: []` en `beheer: null`. Omdat het geen gewone tekstvelden zijn, horen ze **niet** in `KOLOM_ALIASSEN`. Herken de kolommen apart, net zoals `isVendorContactIdKolom`:

```ts
function isWerkingsgebiedKolom(k: string): boolean {
  return k === 'werkingsgebied' || k === 'contract.werkingsgebied';
}
function isBeheerKolom(k: string): boolean {
  return k === 'beheer' || k === 'contract.beheer';
}

export function splitsWerkingsgebieden(ruw: string): string[] {
  return [...new Set(ruw.split(/[,;|]/).map((d) => d.trim()).filter((d) => d !== ''))];
}

export function duidBeheer(ruw: string | null): 'centraal' | 'operationeel' | null {
  if (ruw === null) return null;
  const t = ruw.trim().toLowerCase();
  if (t.startsWith('centr')) return 'centraal';
  if (t.startsWith('oper') || t.startsWith('regio')) return 'operationeel';
  return null;
}
```

Leg in `beoordeelContractImportbestand` de kolomindexen vast, op dezelfde manier als `vendorContactIdKolomIndex`. Zet ze in `herkendeKolommen` als `'werkingsgebieden'` en `'beheer'`, zodat ze niet meer als onbekend gemeld worden. Vul in `maakInvoer` `invoer.werkingsgebieden = splitsWerkingsgebieden(cel)` en `invoer.beheer = duidBeheer(cel)`. Een niet-lege, niet-herkende beheer-tekst krijgt een nieuwe, niet-blokkerende bevinding `'beheer_onbekend'` ("'x' is geen herkende beheervorm (verwacht centraal/operationeel)."). Voeg die code toe aan `ContractBevindingCode`.

- [ ] **Stap 5.2: Unittests** in `contract-import-schema.spec.ts`:
  - `splitsWerkingsgebieden('ANF; HWGO,ANF')` geeft `['ANF','HWGO']`
  - `duidBeheer('Centraal')` geeft `'centraal'`, `duidBeheer('Regio')` geeft `'operationeel'`, `duidBeheer('x')` geeft `null`
  - Een bestand met de kop `Werkingsgebied` (hoofdletter) heeft `werkingsgebieden: ['ANF']`, en `Werkingsgebied` staat niet meer in `onbekendeKolommen`
  - Beheer `'x'` geeft de bevinding `beheer_onbekend`, niet blokkerend

- [ ] **Stap 5.3: Bevestigen.** In `contract-import.service.ts`: voeg `beheer` toe aan de contract-INSERT (`${invoer.beheer ?? null}`). Voeg na `const contractId = …` toe:

```ts
        for (const gebiedTekst of invoer.werkingsgebieden ?? []) {
          const gebied = await this.vindOfMaakWerkingsgebied(tx, tenantId, gebiedTekst);
          if (gebied.aangemaakt) aangemaakteWerkingsgebieden++;
          await tx.execute(
            sql`INSERT INTO clm.contract_werkingsgebied (contract_id, tenant_id, werkingsgebied_code)
                VALUES (${contractId}, ${tenantId}, ${gebied.code})
                ON CONFLICT DO NOTHING`,
          );
        }
```

`vindOfMaakWerkingsgebied` is een kopie van `vindOfMaakCategorie` (regel ~449-474), op de tabel `clm.werkingsgebied`, en hergebruikt `naarCategorieCode()`. `ANF` wordt dan code `anf` met label `ANF`. De `?? []` is nodig voor oude preview-rijen van vóór deze wijziging: daarin ontbreekt het veld in `normalized_data`. Neem `aangemaakteWerkingsgebieden` op in de audit-teller (naast `aangemaakteCategorieen`) en in het resultaat.

- [ ] **Stap 5.4: e2e-test** in `contract-import.e2e-spec.ts`: een upload met de kolommen `Werkingsgebied` = `ANF` en `Beheer` = `operationeel`, gevolgd door bevestigen. Het gebied `anf` bestaat daarna (label `ANF`), het contract is eraan gekoppeld en heeft `beheer = 'operationeel'`. Een tweede rij met `ANF` maakt het gebied niet opnieuw aan.
- [ ] **Stap 5.5: Echte bestandsproef.** Haal `docs/Upload_Transdev_ANF_Coupa_10_10.csv` door `beoordeelContractImportbestand` (zoals in de sessie van 10-10, via een tijdelijk ts-node-bestand dat je daarna weggooit). Verwacht: 23 importeerbaar, alle rijen `werkingsgebieden: ['ANF']`, alleen `Region or Concession` nog onbekend.
- [ ] **Stap 5.6: Commit**: `feat(contract-import): kolommen Werkingsgebied en Beheer`

---

## Taak 6: Tenantscripts en backup-verwachting bijwerken

**Files:** modify `scripts/tenant-opschonen.js`, `scripts/tenant-kopieren.js`, `docs/runbooks/tenant-opschonen.md`, `docs/runbooks/tenant-kopieren.md`, `docs/runbooks/backup-verwachting.json`

- [ ] **Stap 6.1: tenant-opschonen.js.** Volgens runbook §2: draai de drie zoekopdrachten opnieuw tegen de wegwerpdatabase van Taak 1. Werk daarna de vaste lijsten met de hand bij:
  - `clm.contract_werkingsgebied` gaat via CASCADE mee met `contract`, dus die komt in `ALLEEN_CONTROLEREN`
  - `clm.werkingsgebied` komt in `VIA_API_NA_FUNCTIE`, ná de contracten (`clm_api_runtime` heeft DELETE)

  Bewijs het met een droge run en een commit op een wegwerpdatabase met twee gevulde tenants (zelfde aanpak als 07-10).
- [ ] **Stap 6.2: tenant-kopieren.js.** Neem `werkingsgebied` op na `vendorCategorie`, `contract_werkingsgebied` na de contracten (via `vertaalId(contract_id)`), en `beheer` in de contract-INSERT. Voeg beide tabellen toe aan `GEKOPIEERD`. Bewijs het op een wegwerpdatabase.
- [ ] **Stap 6.3: backup-verwachting.json.** Zet `migratiestand` op `0046_werkingsgebied` en werk `bijgewerkt` bij. **Voeg de twee tabellen nog niet toe aan `tabellen`.** Productie heeft ze pas na de uitrol, en de dagelijkse controle zou ze anders als ontbrekend melden. Schrijf dat in `toelichting` (kip-ei, zie de toelichting bij 0034/0035). Voeg ze toe na de bevestigde productie-uitrol.
- [ ] **Stap 6.4: Commit**: `chore(scripts): tenantscripts kennen werkingsgebied`

---

## Taak 7: Frontend: model, services, beheerscherm

**Files (frontend repo):** create `src/core/models/werkingsgebied.ts`, `src/core/services/werkingsgebiedService.ts`, `src/app/beheer/werkingsgebieden/page.tsx`; modify `Sidebar.tsx`, mocks

- [ ] **Stap 7.1:** `werkingsgebied.ts`: `export interface Werkingsgebied { code: string; label: string; }`. De service is een kopie van `src/core/services/vendorCategoryService.ts`, met endpoint `/werkingsgebieden` en response-sleutel `werkingsgebieden`. In mock-modus geeft hij `[]` terug, zodat de nieuwe UI in mock data verborgen blijft, tenzij je een mock-lijst toevoegt voor de demo.
- [ ] **Stap 7.2:** `page.tsx` is een kopie van `src/app/beheer/vendor-categorieen/page.tsx` (toevoegen, label bij blur bewaren, verwijderen met bevestiging), met de teksten "Werkingsgebieden" en "Concessie of organisatie-onderdeel, bijv. ANF". Toon bij verwijderen: "Contracten in dit gebied verliezen hun koppeling."
- [ ] **Stap 7.3:** Menu-item in `Sidebar.tsx`, naast "Vendor-categorieën", met `vereistRol: ['admin', 'support']`. Kies een passend lucide-icoon (bijv. `MapPin`).
- [ ] **Stap 7.4:** `npx tsc --noEmit`, `npx eslint`, prettier. Commit: `feat(werkingsgebied): beheerscherm werkingsgebieden`

---

## Taak 8: Frontend: contracten en leveranciers

**Files:** modify het contracttypebestand, `vendor.ts`, `contractService.ts`, `contracten/page.tsx`, `leveranciers/page.tsx`, `leveranciers/[id]/Contracten.tsx`, mocks

- [ ] **Stap 8.1: Types en service.** Voeg `beheer` en `werkingsgebiedCodes` toe aan de contracttypes. Zoek ze met `grep -rn "businessRiskTierCode" src/core/models`; verzin geen bestandsnaam. Voeg `werkingsgebiedCodes: string[]` toe aan `VendorSamenvatting`. Vul alle mocks aan; `npx tsc --noEmit` wijst ze aan. In `contractService.ts`: `zetContractWerkingsgebieden(vendorId, contractId, codes)` (PUT, gooit een fout in mock-modus, zelfde patroon als `zetGekoppeldeTemplates`). `beheer` gaat mee in `maakContractAan` en `wijzigContract`.
- [ ] **Stap 8.2: Contractoverzicht** (`contracten/page.tsx`). Haal ook `haalWerkingsgebieden()` op. **Alleen als die lijst niet leeg is**:
  - een select "Alle werkingsgebieden" met de gebieden, die filtert op `contract.werkingsgebiedCodes.includes(code)`
  - een select "Beheer: alle / centraal / operationeel / niet vastgelegd"
  - een kolom "Werkingsgebied" met labels als chips (label opgezocht via code), plus een klein "centraal/operationeel"-merk

  Volg het bestaande filterpatroon (state + filteren in de browser, regels ~59-89 en ~121-154).
- [ ] **Stap 8.3: Leveranciersoverzicht** (`leveranciers/page.tsx`). Alleen bij een niet-lege lijst: een select "Alle werkingsgebieden" naast "Alle normenkaders", met filter in `filterVendors()` op `vendor.werkingsgebiedCodes.includes(code)`.
- [ ] **Stap 8.4: Contractformulier** (`Contracten.tsx`, `ContractFormuliervelden` ~715). Alleen bij een niet-lege lijst:
  - checkboxen per werkingsgebied
  - een select "Beheer" (leeg / centraal / operationeel)

  `beheer` gaat mee in de bestaande opslag (`bewaar` ~320, `NieuwContractFormulier` ~923). Na een geslaagde opslag volgt `zetContractWerkingsgebieden` met de aangevinkte codes.
- [ ] **Stap 8.5: Controleren.** `tsc`, `eslint`, prettier. Daarna de lokale demo-stack (`npm run demo` in de backend-repo) met een in de demo aangemaakt gebied. Doorloop:
  - een gebied aanmaken
  - een contract koppelen, met beheer
  - filteren in beide overzichten
  - het gebied verwijderen, waarna de koppeling weg is
  - een tenant zonder gebieden toont geen filter, kolom of formulierveld

  Volg de vaste demo-procedure uit het geheugen (`mcm2-demo-link-incognito-hard-reload`).
- [ ] **Stap 8.6: Commit**: `feat(contracten): werkingsgebied en beheer in overzicht en formulier`

---

## Taak 9: Afronden en uitrollen

- [ ] **Stap 9.1:** `npm run verify:volledig` in de backend. De bekende Windows-poortfout in stap 3 (55500) noemen; het CI-equivalent moet groen zijn.
- [ ] **Stap 9.2:** Twee feature branches (backend en frontend) en twee PR's. Ze verwijzen naar elkaar en naar #234.
- [ ] **Stap 9.3:** Na het akkoord van de eigenaar: mergen, `deploy:staging` met rookproef, daarna productie via `productie-aws.yml` achter de vier remmen (verse backup gecommit, migratiestand, staging-pariteit, menselijk akkoord). Reken op 30-55 minuten.
- [ ] **Stap 9.4:** Na de productie-uitrol:
  - migratiestand teruglezen met `productie:poort`
  - `verify:omgevingen` (geen `zonderLeesrecht` op de nieuwe tabellen)
  - curl op `/api/backend/health`
  - de tabellen toevoegen aan `backup-verwachting.json` (Taak 6.3)
- [ ] **Stap 9.5:** De eigenaar uploadt `docs/Upload_Transdev_ANF_Coupa_10_10.csv` in Transdev DEV. Daarna controleren:
  - het gebied `ANF` bestaat
  - 23 contracten zijn eraan gekoppeld
  - het ANF-filter werkt in beide overzichten

---

## Zelfcontrole

- **Dekking van de besluiten:**

  | Besluit | Taak |
  |---|---|
  | Alleen filter | Taken 3, 4, 8 |
  | Zichtbaar via de data | Taken 7.1, 8.2-8.4 |
  | Beheer per contract | Taken 3.3, 5, 8 |
  | Meerdere gebieden per contract | Taken 1, 3.4 |
  | Leverancier volgt contracten | Taak 4 |
  | Import | Taak 5 |
  | ANF-bestand | Taken 5.5, 9.5 |

- **Bekende valkuilen expliciet gemaakt:**
  - GRANT in de migratie (CLAUDE.md punt 8)
  - journal-entry
  - de argumentvolgorde van `InvoerFout` verschilt per bestand
  - tenantscripts bijwerken (runbook opschonen §2)
  - backup-verwachting en het kip-ei-probleem
  - tellen altijd mét context
  - e2e-suite-regels
- **Namen:** `werkingsgebied`, `contract_werkingsgebied`, `werkingsgebiedCodes`, `beheer`, `zetWerkingsgebieden` en `leesWerkingsgebiedCodes` worden overal gelijk gebruikt.
