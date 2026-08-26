# Audit-bewijsvoering: relevante leveranciers oplijsten en volgen — ontwerp

## Waarom dit gebouwd wordt

De surveyfunctie in MCM2 is ontstaan nadat een derde-partij-auditor bij Transdev vaststelde dat
de leveranciersbeoordeling niet op orde was. De app moet daarom niet alleen surveys kunnen
versturen en beoordelen, maar Transdev (en later andere tenants) ook in staat stellen om
**aantoonbaar te maken aan een auditor**:

1. welke leveranciers relevant zijn voor welk beoordelingsthema;
2. dat die relevante leveranciers daadwerkelijk zijn beoordeeld, op de voorgeschreven manier;
3. dat de beoordelingsresultaten adequaat zijn vastgelegd.

**Opvolging van een afkeuring (corrigerende maatregelen, herbeoordeling) valt expliciet buiten
deze scope.** De app bewijst dát er beoordeeld is en wát de uitkomst was — niet wat er daarna
met een afkeuring gebeurt.

Vandaag (2026-08-25) bestaat hiervoor al een substantieel fundament: het statusoverzicht
(`/beheer/status`) en het inzendingscherm (`/beheer/status/[responseId]`) — zie
`docs/superpowers/plans/2026-08-07-statuswaarheid-per-vendor.md`. Dit ontwerp bouwt daarop
voort in plaats van het te vervangen. Twee echte gaten zijn gevonden ten opzichte van het
audit-doel, plus een losstaande kleine bug:

- Leveranciers **zonder enige uitnodiging** zijn onzichtbaar in het overzicht — voor een
  auditvraag als "hebben jullie alle relevante leveranciers beoordeeld?" moet je juist ook
  kunnen laten zien wie er nog niet eens gevraagd is.
- Een afgekeurde inzending krijgt dezelfde neutrale badge als een goedgekeurde — een auditor
  moet nu de aparte oordeel-kolom raadplegen om dat te zien.
- Het goedkeur-scherm geeft na een geslaagde actie geen enkele bevestiging, waardoor een
  beheerder niet ziet dat het gelukt is en een tweede keer op "Goedkeuren" kan klikken.

## Scope-overzicht — vier delen

| Deel | Wat | Raakt |
|---|---|---|
| 1 | Compliance-thema op de leverancier (multi-value) | Backend datamodel + migratie, leveranciersdetailscherm |
| 2 | Twee nieuwe afgeleide statussen: `gepland`, `afgekeurd` | `respons-status.ts`, `contractmanager.service.ts` |
| 3 | Statusoverzicht uitgebreid: thema-filter + relevante leveranciers zonder respons | `/beheer/status` (backend + frontend) |
| 4 | Bevestiging na goedkeuren | `/beheer/status/[responseId]` (frontend) |

Delen 2 en 3 zijn onderling afhankelijk (de nieuwe statussen bestaan primair om in het
uitgebreide overzicht getoond te worden) en worden daarom in samenhang gebouwd. Deel 1 is een
voorwaarde voor het thema-filter in deel 3, maar op zichzelf ook direct bruikbaar (thema's
toekennen kan al vóór het filter er is). Deel 4 is volledig onafhankelijk van de andere drie.

---

## Deel 1 — Compliance-thema op de leverancier

### Datamodel

Twee nieuwe tabellen, in dezelfde stijl als de bestaande `ref.*`/`clm.*`-lookup- en
koppeltabellen:

```sql
-- Migratie 0031_compliance_thema.sql (indicatief nummer, bij uitvoering het echte
-- eerstvolgende nummer gebruiken)

CREATE TABLE ref.compliance_thema (
  code  text PRIMARY KEY,
  label text NOT NULL
);

INSERT INTO ref.compliance_thema (code, label) VALUES
  ('cybersecurity', 'Cybersecurity'),
  ('kwaliteit', 'Kwaliteit'),
  ('continuiteit', 'Continuïteit')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE clm.vendor_compliance_thema (
  vendor_id    uuid NOT NULL REFERENCES clm.vendor(vendor_id) ON DELETE CASCADE,
  thema_code   text NOT NULL REFERENCES ref.compliance_thema(code),
  tenant_id    uuid NOT NULL REFERENCES clm.tenant(tenant_id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor_id, thema_code)
);

ALTER TABLE clm.vendor_compliance_thema ENABLE ROW LEVEL SECURITY;
ALTER TABLE clm.vendor_compliance_thema FORCE ROW LEVEL SECURITY;
-- Policy volgens het bestaande tenant-isolatiepatroon (zie bijv. 0027_contract.sql).
```

`ref.compliance_thema` is bewust een losse lookup-tabel — net als `business_criticality` en
`vendor_category` — zodat een tenant-beheerder er later zelf thema's aan kan toevoegen zonder
codewijziging (niet in scope van dit plan, wel een bewuste opening).

De seed-lijst hierboven (Cybersecurity, Kwaliteit, Continuïteit) is een startpunt om mee te
bouwen en te testen; de definitieve lijst voor Transdev wordt met de eigenaar afgestemd vóór
oplevering.

**`tenant_id` op de koppeltabel, niet afgeleid via `vendor_id`.** Dit volgt het patroon van
andere `clm.*`-tabellen (zie `contract`, `response_note`) — een directe kolom houdt de
RLS-policy simpel en gelijkvormig aan de rest van het schema, in plaats van een subquery naar
`vendor` te vereisen.

**Geen koppeling naar `survey_template` of `survey_run`.** Besluit uit de brainstorm: het thema
is een eigenschap van de leverancier, puur een filtercriterium. De vragenlijst zelf blijft
ongewijzigd tenant-breed. Een toekomstige NIS2-module kan hier een koppeling aan
`risk_assessment` toevoegen — expliciet buiten deze scope.

### Frontend — toekennen op het leveranciersdetailscherm

`ClassificatieBadges.tsx` (`MCM2-frontend/src/app/beheer/leveranciers/[id]/`) krijgt een nieuw
element in dezelfde badge-strip: geen `Keuzeveld`-dropdown (die is single-value), maar een
rijtje aanklikbare thema-pills — actief/inactief per thema, direct togglend (vergelijkbaar met
hoe MVM_V2's `Contract.frameworks` als toggle-badges werkt, zie
`MVM_V2/src/app/contracts/new/page.tsx:108-115`, `:220-246`).

Een leverancier zonder toegekend thema toont "Geen thema" in dezelfde stijl als de bestaande
"Categorie onbekend"/"Kritiek: onbekend"-badges — niet een lege ruimte.

### API

- `GET /vendors/:id` (bestaande route) geeft `complianceThemas: string[]` mee in de respons.
- Nieuwe route `PUT /vendors/:id/compliance-themas` met body `{ themaCodes: string[] }` —
  vervangt de volledige set in één keer (simpeler dan losse toggle-endpoints, en de UI stuurt
  toch de complete gewenste staat per klik).

---

## Deel 2 — Twee nieuwe afgeleide statussen

Beide zijn uitbreidingen van de bestaande, berekende status uit `src/survey/respons-status.ts`
— geen opgeslagen statuskolom, dezelfde filosofie als de huidige vijf statussen.

### `afgekeurd`

```
Als laatsteOordeel === 'niet_goed' (en dit het laatste, niet-ingetrokken oordeel is):
  status = 'afgekeurd'
```

Dit is een kleine wijziging in `bepaalStatus()`: de bestaande laatste `return 'beoordeeld'`
wordt vervangen door een check op `laatsteOordeel === 'niet_goed'` vóórdat de algemene
`'beoordeeld'`-uitkomst geldt. `goed` en `nadere_vragen` blijven onder `'beoordeeld'` vallen —
alleen een afkeuring krijgt een eigen status, want dat is wat een auditor er meteen uit moet
kunnen lezen.

`RESPONS_STATUSSEN` groeit van vijf naar zes waarden. `STATUS_LABEL`/`STATUS_KORT` (frontend,
`MCM2-frontend/src/core/models/vragenlijst.ts`) krijgen een zesde regel. De `STIJL`-tabel in
`/beheer/status/page.tsx` krijgt een rode variant, gelijk aan `te_laat` qua kleurintensiteit
maar met een ander icoon (bijv. `XCircle` in plaats van `AlertTriangle`, om de twee rode
statussen — "te laat" versus "afgekeurd" — ook zonder tekst uit elkaar te houden).

### `gepland`

Anders dan `afgekeurd` (een uitbreiding van bestaande logica op een bestaande rij) vraagt
`gepland` een structurele wijziging: het gaat over leveranciers **zonder** een
`clm.survey_response`-rij, terwijl `bepaalStatus()` en de huidige query in
`ContractmanagerService.haal()` allebei uitgaan van een bestaande respons.

```
Een leverancier is 'relevant' wanneer:
  businessCriticalityCode IN ('medium', 'high', 'critical')   -- niet 'low'
  EN (er is geen thema-filter actief, OF de leverancier heeft minstens één van de
      gefilterde thema's)

Een relevante leverancier zonder een survey_response in de actuele ronde
(of zonder enige survey_response ooit) krijgt status 'gepland'.
```

**`business_criticality` heeft vier niveaus** (`low`, `medium`, `high`, `critical` — zie
`drizzle/0000_baseline_bestaand_schema.sql` en `0012_ref_codes_uitbreiden.sql`), niet drie.
`critical` telt mee als relevant, samen met `high` en `medium` — alleen `low` niet.

**Dit is een vaste drempel in de code, geen instelling.** Tijdens de brainstorm kwam de vraag
op of tenants hun eigen labels/aantal-niveaus voor criticaliteit zouden moeten kunnen kiezen
(bijv. universele niveaus 1-4 met een tenant-eigen toelichtingstekst per niveau, in plaats van
de huidige vaste labels laag/gemiddeld/hoog/kritiek). Dat is een waardevol idee, maar raakt
`ref.business_criticality` en elke plek in de app die het vandaag toont of bewerkt (badges,
formulieren, bestaande vendor-data) — te groot voor deze spec. **Bewust apart gehouden als
eigen, latere brainstorm.** Deze spec gebruikt de bestaande vier labels met een vaste drempel
(`medium` en hoger); zodra het niveaus-traject is gebouwd, verschuift deze drempel mee naar
wat daar uitkomt.

**Implementatie: twee losse resultaten samengevoegd, niet één uitgebreide query.** De
bestaande query in `ContractmanagerService.haal()` blijft ongewijzigd (ze levert `StatusItem[]`
voor bestaande responsen). Een nieuwe methode `haalGeplandeVendors()` haalt relevante vendors
op die in **geen enkele** `clm.survey_response` voorkomen:

```sql
SELECT v.vendor_id, v.name AS vendor_naam,
       v.owner_user_id AS eigenaar_user_id, o.full_name AS eigenaar_naam
  FROM clm.vendor v
  LEFT JOIN clm."user" o ON o.user_id = v.owner_user_id
 WHERE v.business_criticality_code IN ('medium', 'high', 'critical')
   AND (${themaFilter}::text[] IS NULL OR EXISTS (
         SELECT 1 FROM clm.vendor_compliance_thema vct
          WHERE vct.vendor_id = v.vendor_id
            AND vct.thema_code = ANY(${themaFilter}::text[])
       ))
   AND NOT EXISTS (
         SELECT 1 FROM clm.survey_response s WHERE s.vendor_id = v.vendor_id
       )
```

Dit resultaat wordt in de service samengevoegd met de bestaande `StatusItem[]`, met status
hardcoded op `'gepland'` en de survey-specifieke velden (`responseId`, `runId`, `templateId`,
`submittedAt`, `closesAt`, `laatsteOordeel`, …) op `null`. `StatusItem.responseId` wordt
daarmee `string | null` — de frontend-tabel linkt bij `gepland` niet door naar een
inzendingscherm (dat bestaat nog niet), maar naar het leveranciersdetailscherm.

**Waarom niet slimmer** (bijv. "leverancier zonder response in de *huidige* ronde, ook al was
er ooit een oudere"): dat vraagt een expliciet rondebegrip per leverancier dat vandaag niet
bestaat, en is nadrukkelijk niet gevraagd. "Nog nooit een enkele respons" is de eenvoudigste,
correcte eerste versie — een relevante leverancier die al eens is beoordeeld en waarvoor de
volgende ronde nog niet is uitgestuurd, valt hiermee tussen wal en schip (hij verdwijnt uit het
overzicht in plaats van als `gepland` te verschijnen). Dat is een bewuste, benoemde beperking,
geen oversight — zie "Bekende beperkingen" onderaan.

---

## Deel 3 — Statusoverzicht uitgebreid

`/beheer/status` (`StatusoverzichtPagina`) blijft één scherm, één centrale waarheid. Twee
toevoegingen:

### Thema-filter

Naast de bestaande "Van mij"/"Hele organisatie"-schakelaar komt een tweede, onafhankelijke
filter: een multi-select op compliance-thema (dezelfde thema's als Deel 1). Leeg/geen selectie
= geen filter (toon alles, zoals nu). Dit filter werkt op **beide** delen van de lijst: het
beperkt zowel welke bestaande responsen getoond worden als welke `gepland`-vendors meetellen.

### Backend

`ContractmanagerService.vanMij()`/`.alles()` krijgen een optioneel `themaCodes: string[]`
argument, doorgegeven aan zowel de bestaande query (extra `EXISTS`-voorwaarde op
`vendor_compliance_thema`, analoog aan `haalGeplandeVendors()`) als de nieuwe
`haalGeplandeVendors()`. De route `GET /survey/status?bereik=...&thema=...` (bestaande route,
uitgebreid met een optionele query-parameter) geeft het samengevoegde resultaat terug.

### Frontend

- Nieuwe filter-UI naast de bereik-schakelaar (checkboxen of pills per thema, consistent met
  Deel 1's toekenning-UI).
- `URGENTIE`-sorteertabel in `page.tsx` krijgt twee nieuwe entries: `afgekeurd` bovenaan
  (urgenter dan `te_laat` — een afkeuring vraagt directe actie), `gepland` onderaan (nog niets
  om nu naar te kijken).
- De samenvattingsregel bovenaan (tellingen per status) toont de twee nieuwe statussen op
  dezelfde manier als de bestaande vijf.
- Een `gepland`-rij in de tabel toont geen "Uitgestuurd"/"Terug ontvangen"/"Sluit op"-datums
  (die bestaan niet) — toont in plaats daarvan de toegekende thema's, zodat meteen duidelijk is
  wáárom deze leverancier in de lijst staat.

---

## Deel 4 — Bevestiging na goedkeuren

Losstaand van de andere drie delen. In `MCM2-frontend/src/app/beheer/status/[responseId]/page.tsx`:

Na een geslaagde `legVast('goedgekeurd')`-aanroep wordt bijgehouden of het **bovenste** (tellende)
oordeel in `oordelen` gelijk is aan `'goedgekeurd'` (dit is al beschikbare state na `laad()`,
geen nieuw veld nodig). Zolang dat zo is, vervangt een bevestigingsblok de hele
"Beoordelen"-sectie (toelichtingveld + de vier knoppen):

```
✓ Goedgekeurd door {reviewerNaam} op {datum}
  [Terug naar het statusoverzicht]
```

Geen automatische navigatie — de beheerder bepaalt zelf wanneer hij het scherm verlaat, en kan
in de tussentijd nog notities lezen of plaatsen (die sectie blijft ongewijzigd zichtbaar). Wordt
het goedgekeurde oordeel via "Intrekken" in "Eerdere oordelen" ingetrokken (bestaande
functionaliteit, ongewijzigd), dan verschijnt de knoppenrij automatisch weer — de conditie is
immers "is het huidige, tellende oordeel een goedkeuring", niet een lokale, losse
`useState`-vlag die uit de pas zou kunnen lopen met de echte data.

---

## Volgorde van bouwen

1. **Deel 1** (thema op leverancier) — kan volledig zelfstandig, levert al waarde (thema's
   toekennen) vóór de rest af is.
2. **Deel 2 + 3 samen** (nieuwe statussen + overzicht-uitbreiding) — afhankelijk van Deel 1 voor
   het thema-filter, maar de `afgekeurd`-status en de basis van `gepland` (zonder filter) kunnen
   ook zonder Deel 1 al gebouwd en getest worden. Praktisch: Deel 1 eerst, dan is er geen
   tussenstap met een niet-werkend filter.
3. **Deel 4** — volledig onafhankelijk, kan op elk moment tussendoor, ook eerder dan de rest.

## Bekende beperkingen (bewust, niet opgelost in dit ontwerp)

- **`gepland` mist het "was al eens beoordeeld, wacht nu op de volgende ronde"-geval.** Zie
  toelichting in Deel 2. Op te lossen zodra er een expliciet rondebegrip per leverancier komt —
  niet nu.
- **Compliance-thema kent geen historie.** Wijzigt een thema-toekenning, dan is niet meer te
  zien wat de toekenning was op het moment van een eerdere audit. Voor Transdev's huidige,
  kleinschalige en handmatige situatie is dat aanvaardbaar; wordt relevant zodra de NIS2-module
  thema's uit een risk-assessment afleidt.
- **De relevantiedrempel op `business_criticality` is vast (`medium` en hoger), niet
  instelbaar.** Tenants kunnen vandaag geen eigen labels of aantal niveaus voor criticaliteit
  kiezen — zie de toelichting in Deel 2. Bewust een eigen, latere brainstorm; niet in deze
  scope.
- **Opvolging van een afkeuring valt buiten scope** — expliciet door de eigenaar benoemd. De
  `afgekeurd`-status maakt zichtbaar dát er een probleem is, niet wat ermee gebeurt.
- **Geen exportfunctie naar een auditrapport.** Dit ontwerp maakt de informatie zichtbaar in de
  app; een geprinte/geëxporteerde bewijslijst voor een auditor is een mogelijke vervolgstap,
  niet in deze scope.
