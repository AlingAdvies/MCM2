# Coupa-import: schema-uitbreiding vendor/contract

**Datum:** 2026-08-28
**Aanleiding:** gap-analyse van `docs/Transdev_Gap_Analyse_rev_1.csv` (Coupa-export
Transdev vs. het MCM2-contract-/leveranciersmodel). Vijf schemabeslissingen kwamen
daaruit voort als GitHub-issues #185–#189, samengebracht in deze ene spec omdat ze
dezelfde tabellen raken en in één moeite getest worden. #190 (de uploadtool zelf)
is de opvolger van dit werk — die importeert pas nadat dit schema klaarstaat.

## Scope

Vijf velden, plus één structurele wijziging aan een bestaande referentietabel:

| Issue | Tabel | Veld | Type |
|---|---|---|---|
| #185 | `vendor` | `coupa_supplier_number` | `text`, nullable |
| #186 | `ref.vendor_category` | *(structuurwijziging: `tenant_id` toegevoegd)* | — |
| #187 | `contract` | `contract_type` | `text`, nullable |
| #188 | `contract` | `business_risk_tier_code` | `text` → FK naar nieuwe `ref.business_risk_tier` |
| #189 | `contract` | `dpa_aanwezig` | `boolean`, nullable |

Wat hier **niet** in scope is: de uploadtool zelf (#190), documentopslag voor het
DPA-document (genoemd bij #189 maar bewust een apart, later traject), en de
risicovelden uit Coupa (Ondersteuning kernactiviteiten, Data gevoeligheid,
Leverancier risicoprofiel, Hosting locatie, IB&P, MSR) — die zijn bewust
buitengesloten, ze zijn input voor een nog te ontwerpen risk-assessment-tool.

## #185 — `vendor.coupa_supplier_number`

Matchsleutel tussen Coupa en MCM2. Simpel tekstveld, geen unieke constraint
afgedwongen op databaseniveau (een tenant zonder Coupa gebruikt het veld
gewoon niet — blijft `null`). De uploadtool (#190) gebruikt dit veld om bij
een herhaalde import te herkennen of een leverancier al bestaat, in plaats
van een dubbele vendor aan te maken.

```sql
ALTER TABLE clm.vendor ADD COLUMN coupa_supplier_number text;
```

## #186 — vendor-categorieën worden tenant-scoped

### Huidige situatie

`ref.vendor_category` is een **platform-brede** referentietabel (`code` als
primary key, geen `tenant_id`) — alle tenants delen dezelfde lijst. Er
bestaat geen beheerscherm; de inhoud komt uit seed-data.

### Nieuwe situatie

`ref.vendor_category` krijgt een `tenant_id`-kolom en wordt onderdeel van de
primary key: `(tenant_id, code)`. Elke tenant heeft vanaf nu zijn eigen,
volledig onafhankelijke lijst.

**Seed-bij-aanmaak, geen levende koppeling.** Bij het aanmaken van een
nieuwe tenant (`PlatformService.tenantAanmaken()`,
`src/platform/platform.service.ts`) kopieert de aanmaaklogica een vaste
standaardset categorieën naar de nieuwe tenant, met de nieuwe `tenant_id`.
Vanaf dat moment zijn het gewone rijen van díe tenant: de tenant-beheerder
kan ze via het nieuwe beheerscherm (hieronder) hernoemen, verwijderen of
aanvullen. Er is geen synchronisatie en geen "reset naar standaard" — de
seed is een eenmalige kopie op t=0, daarna volledig los van de bron.

**Bestaande tenants (AlingAdvies, Transdev):**
- AlingAdvies: de migratie zelf zet `tenant_id` op AlingAdvies' eigen
  tenant-id voor de bestaande rijen — geen aparte seed-stap, de rijen
  bestaan al en worden "geclaimd" door de tenant die ze feitelijk al
  gebruikt.
- Transdev: bestond al vóór dit schema er was, dus krijgt de standaardset
  niet automatisch via `tenantAanmaken()`. Vraagt een eenmalige,
  handmatige seed-actie na de migratie (los script of SQL, niet
  onderdeel van de migratie zelf — Transdev's situatie is eenmalig).

### Migratie (schets)

```sql
ALTER TABLE ref.vendor_category ADD COLUMN tenant_id uuid;
UPDATE ref.vendor_category SET tenant_id = '<alingadvies-tenant-id>';
ALTER TABLE ref.vendor_category ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE ref.vendor_category DROP CONSTRAINT vendor_category_pkey;
ALTER TABLE ref.vendor_category ADD PRIMARY KEY (tenant_id, code);
ALTER TABLE ref.vendor_category
  ADD CONSTRAINT vendor_category_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES clm.tenant(tenant_id) ON DELETE CASCADE;
```

`vendor.category_code` blijft een tekstveld; de FK-relatie in Drizzle moet
worden herzien naar een samengestelde sleutel (`tenant_id`, `category_code`)
in plaats van alleen `category_code`, zodat een vendor niet naar een
categorie van een andere tenant kan wijzen.

### Beheerscherm

Nieuw, minimaal CRUD-scherm onder de tenant-instellingen, alleen voor
tenant-admins:
- Lijst van de eigen categorieën (code + label)
- Toevoegen
- Label wijzigen
- Verwijderen

**Verwijdergedrag:** toegestaan, ook als er nog vendors aan gekoppeld zijn.
De bestaande FK (`onDelete: 'set null'`) blijft van kracht — die vendors
tonen daarna "geen categorie". Geen blokkerende check, geen extra
foutafhandeling nodig.

## #187 — `contract.contract_type`

Placeholder-veld, geen referentietabel. Vrije tekst, direct overgenomen uit
Coupa's "Contract type"-kolom (Raamovereenkomst, Dienstenovereenkomst,
Inkoopovereenkomst, ...). Wordt pas relevant als MCM2 breder als
contractmanagement-tool gebruikt gaat worden; nu puur zodat de kolom niet
verloren gaat bij import.

```sql
ALTER TABLE clm.contract ADD COLUMN contract_type text;
```

## #188 — `contract.business_risk_tier_code`

### Twee aparte risicoresultaten — bewust niet samengevoegd

MCM2 kent al `vendor.business_criticality_code` (`ref.business_criticality`,
waarden `medium`/`high`/`critical`). In de code
(`src/survey/contractmanager.service.ts`) is dat veld het resultaat van de
**IT-risk-assessment**: het bepaalt welke leveranciers relevant zijn voor de
vragenlijst-flow.

Coupa's "Contract classification*" (Tier 1 – High impact / Tier 2 – Medium /
Tier 3 – Low impact) is een ánder resultaat: Transdev's
**enterprise-brede business-risk-assessment**, los van IT. Twee
verschillende beoordelingsprocessen, twee verschillende uitkomsten. Het
nieuwe veld heet daarom bewust **niet** `businessCriticality` of iets wat
erop lijkt — de naam `business_risk_tier` maakt het onderscheid expliciet,
zodat niemand later de verleiding voelt de twee te fuseren omdat de
waarden (High/Medium/Low-achtig) toevallig op elkaar lijken.

### Niveau: per contract

De Coupa-sample toont Tier per contract, niet per leverancier — bewust zo
gehouden: dezelfde leverancier kan voor het ene contract kritischer zijn
dan voor het andere.

### Schema

```sql
CREATE TABLE ref.business_risk_tier (
  code text PRIMARY KEY,
  label text NOT NULL
);
INSERT INTO ref.business_risk_tier (code, label) VALUES
  ('tier_1', 'Tier 1 — High impact (strategisch)'),
  ('tier_2', 'Tier 2 — Medium impact'),
  ('tier_3', 'Tier 3 — Low impact');

ALTER TABLE clm.contract ADD COLUMN business_risk_tier_code text
  REFERENCES ref.business_risk_tier(code) ON DELETE SET NULL;
```

Globaal (geen `tenant_id`), net als `business_criticality` — Tier 1/2/3 is
een generieke schaal, geen tenant-specifieke lijst.

## #189 — `contract.dpa_aanwezig`

Kaal Ja/Nee-veld, tri-state (`null` = onbekend — de Coupa-sample laat de
kolom voor veel contracten leeg, dat is geen "nee"). Het achterliggende
document (het DPA zelf, "moet in de app terug te vinden zijn") is expliciet
**niet** in scope — documentopslag/-koppeling aan een contract is een apart,
later te bouwen traject.

```sql
ALTER TABLE clm.contract ADD COLUMN dpa_aanwezig boolean;
```

## Migratiebestand

Één handgeschreven SQL-migratie, in de stijl van `drizzle/0015_survey_review.sql`,
met alle bovenstaande wijzigingen samen — ze raken dezelfde twee tabellen en
horen bij dezelfde afgeronde stap. Moet worden toegevoegd aan
`drizzle/meta/_journal.json` (zonder die stap slaat `migrate:deploy` de
migratie stilzwijgend over, zie `CLAUDE.md` §punt 3).

Volgnummer: eerstvolgende na `0033_platformbeheer_wijzigen_verwijderen.sql`,
dus `0034_coupa_schema_uitbreiding.sql`.

## Testen

- Migratie draaien op een wegwerpcontainer (`npm run test:db -- "coupa schema uitbreiding"`)
- Bestaande vendor/contract-queries blijven werken na de FK-structuurwijziging
  op `vendor_category` — met name de survey-relevantie-query in
  `contractmanager.service.ts:274` (leest `business_criticality_code`, niet
  geraakt door deze wijziging, maar de wijziging op `vendor_category` raakt
  wél elke plek die `category_code` leest of schrijft — controleren)
- Categoriebeheerscherm: toevoegen, hernoemen, verwijderen (incl. dat een
  vendor met de verwijderde categorie daarna `category_code = null` toont)
- Seed-logica: een nieuw aangemaakte tenant krijgt de standaardset; een
  bestaande tenant (getest met een kopie van Transdev's situatie) kan
  achteraf eenmalig geseed worden
- `npx jest test-ids` en de volledige e2e-run (verplicht bij elke
  nieuwe/gewijzigde suite, zie `CLAUDE.md`)

## Wat dit niet oplost

- De uploadtool zelf (#190) — dit schema is de voorwaarde ervoor, geen
  vervanging
- Documentopslag voor het DPA (#189-uitzondering, apart traject)
- De risicovelden die naar de nog te ontwerpen risk-assessment-tool gaan
