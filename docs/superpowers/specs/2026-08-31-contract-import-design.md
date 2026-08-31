# Contract-import met vendor/contact find-or-create — design

**Datum:** 2026-08-31
**Aanleiding:** `docs/import_functie_prompt_1_0.txt` (oorspronkelijk gevraagd als
admin-only vendor-CSV-import), herzien nadat bleek dat de eerste echte
kolommenlijst een contract-import is met negen kolommen verspreid over
`contract`, `vendor` en `vendor_contact`.

**Status:** v1 gebouwd en getest tegen een gefabriceerd voorbeeldbestand.
Bij het eerste gebruik tegen een echt Transdev-testbestand (31-08, na
publicatie van v1) bleken drie punten niet te kloppen — zie §10.

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

## 10. Bevindingen bij het eerste echte gebruik (31-08) en de fixes

Getest tegen een echt Transdev-testbestand (`Transdev_Test_upload_02.csv`,
puntkomma-gescheiden, negen rijen). Drie punten bleken niet te kloppen:

**10.1 Datumformaat te strikt — FOUT, gefixt.**
`leesContractDatum()` eiste `\d{2}-\d{2}-\d{4}` (verplichte voorloopnul).
Een echte export schrijft zonder voorloopnul (`1-4-2019`, `9-5-2025`). Regex
verruimd naar `\d{1,2}-\d{1,2}-\d{4}`, ISO-opbouw via `padStart(2, '0')`.
Regressietest toegevoegd.

**10.2 Onbekende categorie — gedrag herzien.**
v1 liet `vendor.category_code` stilzwijgend leeg als de code niet bestond
in `ref.vendor_category` voor de tenant (zichtbaar noch in preview, noch in
het resultaat). Bij een echte export (`ICT`, `Vastgoed & Facility
Management`) is dat vrijwel altijd het geval — de bron gebruikt vrije
tekst, de tenant-tabel gebruikt korte codes. **Besluit eigenaar (31-08):
een onbekende categorie wordt automatisch aangemaakt** in
`ref.vendor_category` voor de tenant (code = genormaliseerde slug van de
tekst, label = de originele tekst), in plaats van genegeerd. Een mens kan
later opschonen/samenvoegen via het bestaande `/vendor-categories`-scherm.

**10.3 Meerdere contactgegevens per contract — nieuw, apart vastgelegd.**
Het CSV-contract (§7) ging uit van precies één e-mail + één naam per
contract. Een echte export heeft vaak meerdere contactkanalen: een
persoon-e-mail, een afdelings-e-mail, een compliance-URL. Volledig
"meerdere contactpersonen per contract" bouwen (nieuw datamodel) is bewust
**niet** in deze ronde gedaan — besluit eigenaar: "een upload zal meestal
tijdens een onboarding gebeuren [...] we kunnen volstaan met een
waarschuwing en een hulptabel om de extra contactpersonen per contract op
te lijsten, zodat deze handmatig kunnen worden toegevoegd."

**Gekozen CSV-conventie:** genummerde kolommen —
`vendor_contact.email_2`, `vendor_contact.full_name_2` (en `_3`, `_4`, ...)
naast het bestaande primaire paar (`vendor_contact.email`,
`vendor_contact.full_name`, zonder suffix).

**Nieuwe tabel `clm.import_extra_contact`:** per `import_row`, de
extra contactgegevens die niet in het primaire paar pasten (e-mail en/of
naam, als tekst — geen `vendor_contact`-rij, geen koppeling). Zichtbaar na
bevestigen als aparte lijst ("N extra contactgegevens gevonden, handmatig
te verwerken"), buiten het reguliere find-or-create-pad.

**Aanvankelijk niet opgelost, later alsnog** (zie §11): het testbestand had
ook dubbele, niet-genummerde kopnamen (`vendor_contact.email` twee keer) —
die kregen bij deze eerste ronde nog "laatste wint, onzichtbaar"-gedrag.
Na een tweede preview-poging met de eigenaar bleek dit gedrag te grof; §11
beschrijft de definitieve oplossing (laatste voorkomen = primair, eerdere
voorkomens = zichtbaar in extraContacten).

## 11. Tweede ronde bevindingen (31-08, na de eerste preview met de eigenaar)

Bij het daadwerkelijk previewen van het herstelde §10-gedrag tegen hetzelfde
Transdev-testbestand bleken drie punten nog niet te kloppen.

**11.1 Alleen-email of alleen-naam werd nog steeds overgeslagen — FOUT,
gecorrigeerd.** §10 loste de datum/categorie/extra-contact-punten op, maar
de oorspronkelijke v1-regel — een contactpersoon met alleen email óf alleen
naam is "onvolledig" en wordt niet aangemaakt — stond nog overeind. Besluit
eigenaar: **beide gevallen moeten gewoon een contactpersoon opleveren.**
`contactgegevens_onvolledig` is verwijderd als bevindingcode.

Gevolg: `clm.vendor_contact.full_name` is `NOT NULL` (bestaand schema, niet
gewijzigd) — alleen-email kan dus niet als een kale `full_name: null`-rij
worden opgeslagen. Opgelost door bij het ontbreken van een naam het
e-mailadres zelf als voorlopige naam te gebruiken (`vindOfMaakContact()`),
met een `IS NOT DISTINCT FROM`-matchquery zodat een NULL-e-mailveld (bij
alleen-naam-rijen) de hergebruik-matching niet breekt — `=` geeft bij NULL
altijd NULL, nooit true, en zou elke import een nieuw contact hebben laten
aanmaken in plaats van het bestaande te hergebruiken.

**11.2 `contract.vendor_contact_id` bevat in de praktijk een naam, geen
ID — nieuwe alias toegevoegd.** De kolom is voor een echte ID-verwijzing
bedoeld (en heet zo, correct, naar de databasekolom
`clm.contract.vendor_contact_id`), maar Transdev's export vult hem met een
naam ("Bart Philips"). Besluit eigenaar: **alleen gebruiken als
`vendor_contact.full_name` zelf leeg is, en alleen als de waarde geen
geldig UUID is** (anders zou het een echte, toekomstige ID-verwijzing
kunnen zijn). Geïmplementeerd als naverwerking in `maakInvoer()`, ná de
gewone kolomdoorloop — de conditie ("is `contactFullName` al gevuld door
een andere kolom") is pas dan bekend.

**11.3 Dubbele `vendor_contact.email`-kolommen: eerste of laatste is
primair? Omgedraaid van eerste naar LAATSTE.** De eerste implementatie
(§10.3) liet het eerste voorkomen primair blijven. Bij het echte
Transdev-bestand bleek dat averechts: de eerste van twee gelijknamige
kolommen is daar meestal leeg of een compliance-URL, de tweede bevat het
echte adres. Besluit eigenaar: **het laatste voorkomen van een dubbele
kopnaam is primair**, elk eerder voorkomen wordt een genummerd extra
contact (`extraContacten`). Technisch: eerst een volledige doorloop van de
koprij om alle indexen per veld te verzamelen (pass 1), dan pas toewijzen
op basis van welke index de laatste is (pass 2) — dat kon niet in één
doorloop, want bij de eerste kolom is nog niet bekend of er nog een tweede
komt.

**Resultaat op het echte testbestand** (9 rijen): van "9 importeerbaar, 7
met waarschuwing" (§10-stand, met email/naam als afzonderlijke, vaak
'onvolledige' velden) naar dezelfde 9 importeerbaar maar nu met correcte
matching — 7 rijen met een geldig of invalide e-mailadres, 4 rijen met een
herkende naam (via `contract.vendor_contact_id` of het reguliere
naamveld), en de resterende brondatafouten (compliance-URL's in een
e-mailveld, een tekstlabel i.p.v. adres) blijven zichtbaar als
`email_ongeldig`-waarschuwing in plaats van stilzwijgend verloren te gaan
of de rij te blokkeren.

## 12. Derde ronde bevindingen (31-08, na functioneel testen van het scherm)

Bij het daadwerkelijk doorlopen van preview → bevestigen → contractdetail
in de browser bleken twee losse punten niet te kloppen.

**12.1 `vendor.business_criticality_code` en `contract.business_risk_tier_code`
werden helemaal niet geïmporteerd — ontbrekend, niet gebouwd.** Deze twee
kolommen staan wel in het originele Transdev-testbestand en in het
databaseschema (beide bestaande velden, elders al gebruikt), maar stonden
gewoonweg niet in `KOLOM_ALIASSEN` — een omissie bij het bouwen van v1, geen
regressie.

**Belangrijk verschil met vendor-categorie (§10.2):** beide referentietabellen
(`ref.business_criticality`, `ref.business_risk_tier`) zijn **platform-breed**
(geen `tenant_id`, geen RLS) — de import mag hier dus, anders dan bij
vendor-categorie, **geen nieuwe waarden aanmaken**. Besluit eigenaar:
losse duidingsfuncties per veld op basis van sleutelwoorden/patroon:
- `duidBusinessCriticality()`: 'Hoog'/'High' → `high`, 'Gemiddeld'/'Midden'/
  'Medium' → `medium`, 'Laag'/'Low' → `low`, 'Kritiek'/'Critical' → `critical`.
- `duidBusinessRiskTier()`: zoekt het patroon `Tier\s*([123])` in de tekst en
  gebruikt alleen het cijfer — 'Tier 2  Medium impact' → `tier_2`, de rest
  van de tekst wordt genegeerd.

Een niet-herkende waarde blokkeert de rij niet — het veld blijft leeg, met
een nieuwe, niet-blokkerende bevindingcode (`business_criticality_onbekend`,
`business_risk_tier_onbekend`) zodat het zichtbaar is in de preview.

**12.2 Het contract-bewerkformulier toonde Contracttype/Business-risk-tier/
DPA altijd leeg — een pre-existing frontend-bug, los van de import.** Bij
het narekenen bleek de backend het veld wél correct op te slaan en terug te
geven (geverifieerd rechtstreeks in de database); het probleem zat in
`uitContract()` in `MCM2-frontend/.../Contracten.tsx` — die conversiefunctie
(database-object → formulierwaarden) mapte `contractType`,
`businessRiskTierCode` en `dpaAanwezig` nooit door, ondanks dat het
`Contract`/`ContractInvoer`-model deze drie velden al langer kende (sinds de
Coupa-schema-uitbreiding, migratie 0034, 28-08). Dit gat bestond dus al vóór
de contract-import er was — het viel alleen nooit op omdat er nog nooit
data met deze drie velden was ingevoerd om het bewerkformulier mee te
testen. Gefixt door de drie ontbrekende regels toe te voegen aan
`uitContract()`.
