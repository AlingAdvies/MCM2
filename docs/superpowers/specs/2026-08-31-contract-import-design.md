# Contract-import met vendor/contact find-or-create — design

**Datum:** 2026-08-31
**Aanleiding:** `docs/import_functie_prompt_1_0.txt` (oorspronkelijk gevraagd als
admin-only vendor-CSV-import), herzien nadat bleek dat de eerste echte
kolommenlijst een contract-import is met negen kolommen verspreid over
`contract`, `vendor` en `vendor_contact`.

**Status:** vastgesteld, klaar om te bouwen.

---

## 0. Scope-correctie t.o.v. de oorspronkelijke briefing

De oorspronkelijke vraag ("start uitsluitend met import van
leveranciers/vendors") paste niet meer zodra de daadwerkelijke
kolommenlijst bekend werd:

```
contract.contract_number   contract.contract_type   contract.end_date
contract.name               contract.note             contract.start_date
contract.vendor_contact_id
vendor.category_code   vendor.coupa_supplier_number   vendor.name
vendor_contact.email   vendor_contact.full_name
```

`contract.vendor_id` is `notNull()` — elke rij vereist dus een
gevonden-of-aangemaakte vendor. `vendor_contact_id` is nullable en wijst
naar een bestaande `vendor_contact`-rij; de CSV levert email+naam los, dus
ook daar is find-or-create nodig. Dit is per saldo een **contract-import
met vendor- en contactpersoon-koppeling als bijproduct**, niet een
vendor-import.

## 1. Matchbeslissingen (bevestigd door de eigenaar)

| Entiteit | Matchsleutel | Bij geen match | Bij match met afwijkende gegevens |
|---|---|---|---|
| **Vendor** | `coupa_supplier_number`, binnen de tenant | Nieuwe vendor (`name`, `coupaSupplierNumber`, `categoryCode`) | Nooit bijwerken — waarschuwing `vendor_afwijkt` |
| **Vendor_contact** | `email` + `full_name` samen, binnen die vendor | Nieuwe contactpersoon bij die vendor | n.v.t. (geen ander veld om af te wijken) |
| **Contract** | — (altijd nieuw) | create_only | n.v.t. |

**Geen matchsleutel voor vendor beschikbaar** (leeg `coupa_supplier_number`
in de CSV): elke zo'n rij maakt een **nieuwe** vendor aan — bewust geen
terugval op naam-matching (schrijfvarianten zijn onbetrouwbaar). Preview
toont hierbij een waarschuwing.

**Contactpersoon-model:** een via deze import aangemaakte `vendor_contact`
verschijnt op het bestaande leverancier-detailscherm, kaart
"Contactpersonen" — bevestigd door de eigenaar, geen apart concept nodig.
Losstaand, niet in scope van deze import: de spec-intentie dat een lege
`contract.vendor_contact_id` automatisch de primaire (`is_primary`)
contactpersoon van de vendor gebruikt (`2026-08-22-contractmanagement-design.md`
§2.1) bleek bij onderzoek **niet geïmplementeerd** in `ContractService` —
een gat tussen ontwerp en code, hier alleen gedocumenteerd, niet opgelost.

## 2. CSV-contract v1

| CSV-kolom | Doel-veld | Verplicht | Validatie |
|---|---|---|---|
| `contract.name` | `contract.name` | **Ja**, blokkerend | niet-lege tekst |
| `contract.contract_number` | `contract.contractNumber` | Nee | vrije tekst |
| `contract.contract_type` | `contract.contractType` | Nee | vrije tekst |
| `contract.start_date` | `contract.startDate` | Nee | `DD-MM-YYYY`, waarschuwing bij ongeldig |
| `contract.end_date` | `contract.endDate` | Nee | idem |
| `contract.note` | `contract.note` | Nee | vrije tekst |
| `vendor.name` | matchcontext / nieuwe vendor.name | **Ja**, blokkerend | niet-lege tekst |
| `vendor.category_code` | vendor.categoryCode | Nee | moet bestaan in `ref.vendor_category` voor de tenant; anders waarschuwing `categorie_onbekend`, veld blijft leeg |
| `vendor.coupa_supplier_number` | matchsleutel + vendor.coupaSupplierNumber | Nee | leeg ⇒ altijd nieuwe vendor + waarschuwing |
| `vendor_contact.email` | matchsleutel-deel + vendor_contact.email | Nee, maar samen met full_name | grove e-mailvorm |
| `vendor_contact.full_name` | matchsleutel-deel + vendor_contact.fullName | Nee, maar samen met email | niet-lege tekst indien email ingevuld |

**Bevindingcodes (nieuw t.o.v. `leverancier-import-schema.ts`):**
- `vendor_afwijkt` (niet-blokkerend)
- `categorie_onbekend` (niet-blokkerend)
- `contactgegevens_onvolledig` (niet-blokkerend) — alleen email óf alleen
  full_name ingevuld

## 3. Datamodel

```sql
CREATE TABLE clm.import_job (
    job_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES clm.tenant(tenant_id),
    import_type         text NOT NULL,              -- 'contract' in v1
    created_by_user_id  uuid NOT NULL REFERENCES clm."user"(user_id),
    filename            text NOT NULL,
    file_hash           text NOT NULL,
    row_count           integer NOT NULL,
    status              text NOT NULL,              -- 'preview' | 'bevestigd'
    created_at          timestamptz NOT NULL DEFAULT now(),
    confirmed_at        timestamptz
);

CREATE TABLE clm.import_row (
    row_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES clm.tenant(tenant_id),
    job_id              uuid NOT NULL REFERENCES clm.import_job(job_id) ON DELETE CASCADE,
    row_number          integer NOT NULL,
    raw_data            jsonb NOT NULL,
    normalized_data     jsonb NOT NULL,
    findings            jsonb NOT NULL,
    importable          boolean NOT NULL,
    result              text,                       -- 'created' | 'skipped' | 'failed'
    created_contract_id uuid REFERENCES clm.contract(contract_id),
    created_vendor_id   uuid REFERENCES clm.vendor(vendor_id),
    matched_vendor_id   uuid REFERENCES clm.vendor(vendor_id),
    created_contact_id  uuid REFERENCES clm.vendor_contact(contact_id),
    matched_contact_id  uuid REFERENCES clm.vendor_contact(contact_id)
);
```

Vier aparte kolommen voor vendor/contact (created vs. matched) — bewust
gekozen zodat preview én resultaatscherm expliciet kunnen tonen wat nieuw
is versus hergebruikt (eigenaar-besluit).

RLS: `ENABLE`/`FORCE ROW LEVEL SECURITY` + `USING/WITH CHECK (tenant_id =
clm.current_tenant_id())` op beide tabellen, naar het patroon van
`ref.vendor_category` (migratie 0034). Verplichte regels in
`src/db/rechten-contract.ts` voor beide tabellen.

**Audit:** `ContractImportAuditService.leg(tx, { tenantId, actie:
'contract_import_bevestigd', entityId: jobId, details: {
aangemaakteContracten, aangemaakteVendors, hergebruikteVendors,
aangemaakteContacten, hergebruikteContacten, overgeslagen } })` — binnen
dezelfde transactie als de bevestiging, naar `survey-audit.service.ts`.

## 4. Verwerking per rij (bevestigen)

Eén transactie voor de **hele** job (niet per batch) — bevestigd door de
eigenaar. Bij een fout: volledige rollback, `import_job.status` blijft
`'preview'`.

```
per rij, binnen dezelfde tx:
  1. vind vendor op coupa_supplier_number (indien ingevuld)
     → gevonden: vergelijk name/category_code → evt. vendor_afwijkt-waarschuwing, GEEN update
     → niet ingevuld of niet gevonden: nieuwe vendor
  2. als email én full_name ingevuld:
     vind vendor_contact op (vendor_id, email, full_name)
     → gevonden: hergebruik
     → niet gevonden: nieuwe vendor_contact bij deze vendor
     als maar één van beide ingevuld: contactgegevens_onvolledig-waarschuwing, geen contact gekoppeld
  3. maak het contract aan (altijd nieuw) met vendor_id uit stap 1,
     vendor_contact_id uit stap 2 (of null)
```

Matches van eerdere rijen in dezelfde import moeten zichtbaar zijn voor
latere rijen (rij 5 vindt een vendor die rij 2 in dezelfde batch aanmaakte)
— werkt vanzelf binnen één doorlopende transactie, expliciet getest.

## 5. Autorisatie en tenantkeuze

Geen nieuw mechanisme. Platformbeheerder wisselt eerst naar de doeltenant
via het bestaande `POST /platform/sessie/wisselen`. De import-routes
draaien op `@UseGuards(TenantContextGuard, PlatformAdminGuard)` en werken
op `sessie.tenantId` — geen `tenantId`-veld in de import-request zelf
(MCM2-CLAUDE.md §6).

## 6. Frontend

Eén pagina, drie stappen zonder aparte wizard-component:

1. **Bestand kiezen** — kaal `<input type="file" accept=".csv">` + knop
   "Bestand analyseren" → `POST /admin/contract-import/preview`.
2. **Preview** — platte tabel (regel, contract, vendor, status), rood voor
   geblokkeerd, amber voor waarschuwing, geen kleur voor OK. Knop "N rijen
   importeren" → `POST /admin/contract-import/:jobId/bevestigen`.
3. **Resultaat** — samenvatting uit de audit-details (aantallen
   aangemaakt/hergebruikt per entiteit), knoppen terug naar leveranciers of
   nieuwe import.

Route: `/beheer/platform/contract-import` (platform-namespace, want dit is
platformbeheer-only). Geen kolom-mapping-UI, geen inline rij-bewerking,
geen geschiedenispagina in v1 — audit blijft wel in de database voor
later gebruik.

**Nieuwe frontend-bestanden:**
```
src/app/beheer/platform/contract-import/page.tsx
src/core/services/contractImportService.ts
src/core/models/contractImport.ts
```

## 7. Bestanden — backend

**Nieuw:**
```
drizzle/0035_contract_import.sql
src/contract-import/contract-import.module.ts
src/contract-import/contract-import.controller.ts
src/contract-import/contract-import.service.ts
src/contract-import/contract-import-schema.ts
src/contract-import/contract-import-audit.service.ts
test/contract-import-preview.e2e-spec.ts
test/contract-import-bevestigen.e2e-spec.ts
test/contract-import-matching.e2e-spec.ts
test/contract-import-autorisatie.e2e-spec.ts
db/seeds/voorbeeld-contracten-coupa.csv
```

**Wijzigen:**
```
src/db/schema.ts               — importJob, importRow
src/db/rechten-contract.ts     — regels voor beide nieuwe tabellen
src/app.module.ts              — ContractImportModule registreren
drizzle/meta/_journal.json     — entry voor 0035
```

**Niet aangeraakt:** `vendor.service.ts`, `contract.service.ts`,
`leverancier-import-schema.ts`, `csv-lezer.ts` (laatste twee blijven
bestaan voor een eventuele toekomstige vendor-only-import, zie §9).

## 8. Testplan

- **Matching:** dubbele coupa_supplier_number binnen één import (hergebruik
  binnen dezelfde tx), afwijkende naam bij match (waarschuwing, geen
  update), twee contacten met gelijk email maar andere naam (twee rijen),
  identieke email+naam (één rij, twee contracten eraan), ontbrekend
  coupa-nummer (altijd nieuwe vendor), onvolledige contactgegevens.
- **Autorisatie:** geen platformbeheerder → 403; ingetrokken
  platformbeheerder binnen dezelfde sessie → 403 op de eerstvolgende
  aanroep.
- **Tenantisolatie:** import-job van tenant A niet zichtbaar/leesbaar
  vanuit tenant B.
- **Rollback:** gesimuleerde fout halverwege bevestigen → nul nieuwe
  rijen, job blijft `'preview'`.
- **Idempotency:** tweede bevestiging op dezelfde job → 409.
- **Validatie:** blokkerende/niet-blokkerende bevindingen, lege
  koprij-herkenning (hergebruik van bestaande CSV-lezer-tests).
- **Vanzelf meelopend:** `schema-conformiteit.e2e-spec.ts`,
  `rechten-contract.e2e-spec.ts`.

## 9. Niet in scope van dit issue

- Vendor-only-import (het oorspronkelijke eerste ontwerp) — `csv-lezer.ts`
  en `leverancier-import-schema.ts` blijven ongebruikt maar intact voor
  wanneer die apart gebouwd wordt.
- De ontbrekende "primaire contactpersoon als fallback"-logica in
  `ContractService` (spec-gat, alleen gedocumenteerd in §1).
- Tenant-admin (niet-platformbeheerder) zelf laten importeren — v1 is
  platformbeheerder-only, conform de oorspronkelijke briefing.
- Kolom-mapping-UI, geschiedenispagina van eerdere imports.
