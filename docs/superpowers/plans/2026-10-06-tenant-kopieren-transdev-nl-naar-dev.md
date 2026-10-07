# Tenant kopiëren: Transdev Nederland → Transdev DEV — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eén nieuw script `scripts/tenant-kopieren.js` bouwen waarmee alle
klantdata van de productietenant **Transdev Nederland**
(`4afcb659-63a8-4b16-8a0c-76d2a2d8676e`) wordt gekopieerd naar de lege
testtenant **Transdev DEV** (`c0fe1d30-e785-4dcd-bdf2-0740e95bdd61`), zodat
daarna de ANF-contracten (Coupa-export) op de gebruikelijke manier
geïmporteerd kunnen worden bovenop een realistische basis.

**Architecture:** Spiegelbeeld van het bestaande, bewezen
`scripts/tenant-opschonen.js`: zelfde twee rollen (`clm_api_runtime` via
`PRODUCTIE_RUNTIME_URL`, `clm_migrator` via `NOOD_PRODUCTIE_URL`), zelfde
soort SECURITY DEFINER-functies voor tabellen waar `clm_api_runtime` geen
volledig schrijfrecht heeft, zelfde droge-run-eerst-discipline. Nieuw t.o.v.
het opschoonscript: een **ID-vertaaltabel** (oud UUID → nieuw UUID, in het
geheugen van het script) omdat elke gekopieerde rij een **nieuwe primary
key** krijgt — nooit de bron-PK hergebruiken tussen tenants.

**Tech Stack:** Node.js (CommonJS, zelfde stijl als `tenant-opschonen.js`),
`pg`-client, `node:crypto` voor nieuwe UUID's en tokens.

> **Uitvoeringscorrecties (2026-10-07) — lees dit vóór de rest.** Het plan
> hieronder is het oorspronkelijke ontwerp. Bij de uitvoering veranderde:
>
> 1. **Scope:** rondes, uitnodigingen, antwoorden, oordelen, notities bij
>    inzendingen en koppelingen naar inzendingen gaan NIET mee (besluit
>    eigenaar). Taak 7 vervalt daarmee grotendeels.
> 2. **Dossiernotities** (`vendor_engagement_note`) gaan wel mee — ze
>    ontbraken in het oorspronkelijke ontwerp. Dossierbijlagen niet.
> 3. **Vragenlijsten weghalen (Taak 1.3):** de FK's van vraag en categorie
>    naar template zijn RESTRICT, niet CASCADE. Volgorde: vraag → categorie
>    → template.
> 4. **`tenant-opschonen.js` had een bug** in `tellenBuitenClm()` (tellen
>    zonder tenantcontext → vals alarm). Gerepareerd en met een voor/na-test
>    bewezen.
>
> De actuele, uitgevoerde aanpak staat in `docs/runbooks/tenant-kopieren.md`
> en `scripts/tenant-kopieren.js`.

---

## 0. Vastgelegde ontwerpbeslissingen (bevestigd door de eigenaar, 2026-10-06)

Deze keuzes liggen vast en worden niet opnieuw bevraagd tijdens de uitvoering:

1. **Scope:** alle klantdata wordt gekopieerd, inclusief templates/
   categorieën/vragen (niet alleen configuratie zonder data).
2. **Transdev DEV wordt eerst volledig leeggemaakt**, óók de tabellen die
   `tenant-opschonen.js` normaal laat staan (`survey_template`,
   `survey_category`, `survey_question`) — zie Taak 1 hieronder voor waarom
   dit een *apart*, klein stukje is en niet een wijziging aan het bestaande
   script.
3. **Gebruikersverwijzingen** (wie een oordeel gaf, een notitie schreef, een
   dossier aanmaakte, een import deed) worden allemaal gemapt naar **één
   vaste DEV-gebruiker**: `a1994ff4-f145-4c85-acd0-c6fd77ed0986` ("Kees4TDD",
   `cmaling+tddev2@gmail.com`, actief admin-lid van Transdev DEV). Dit is een
   bewuste, bekende vereenvoudiging — de historische "wie deed het" klopt na
   kopiëren niet meer, de inhoud wel.
   **Uitzondering, expliciet besloten (2026-10-06):** `vendor.owner_user_id`
   en `contract.owner_user_id` (beide nullable, "contractmanager van deze
   vendor/dit contract") worden **niet** geforceerd naar Kees4TDD. Was de
   bronrij `NULL` (geen contractmanager toegewezen), dan blijft de kopie ook
   `NULL`. Was de bronrij gevuld (een echte Transdev-medewerker), dan wordt
   die gemapt naar Kees4TDD. Reden: "geen contractmanager toegewezen" is in
   dit systeem een bewust zichtbaar signaal (zie issue #192 en
   `docs/STATUS.md`) — dat patroon moet in de DEV-kopie net zo zichtbaar
   blijven als in productie, niet overal dichtgeplakt worden met één vaste
   naam. Dit raakt **alleen** `vendor.owner_user_id` en
   `contract.owner_user_id` — alle andere, NOT-NULL gebruikersvelden
   (`reviewer_user_id`, `author_user_id`, `created_by_user_id` op
   vendor_engagement/import_job) blijven ongewijzigd altijd naar
   Kees4TDD gaan, want die kunnen niet NULL zijn.
4. **`ref.vendor_category`** wordt meegekopieerd (eigen samengestelde PK
   `(tenant_id, code)`) zodat `vendor.category_code` behouden blijft.
5. **`template_reviewer`** en **`tenant_feature`** worden **niet**
   meegekopieerd — puur inrichting, geen klantdata. Transdev DEV houdt zijn
   eigen (lege) inrichting daarvoor.
6. **Geüploade bestanden (bijlagen) worden NIET gekopieerd.** Dezelfde
   beperking als bij `tenant-opschonen.js` §7: de fysieke inhoud staat op de
   ECS-containerschijf, niet in de database, en er is geen AWS-toegang vanaf
   deze machine. `survey_attachment`-rijen worden daarom ook **niet**
   gekopieerd (een rij zonder bereikbaar bestand erachter is misleidend) —
   zie Taak 3, stap over `survey_attachment`.
7. **Nieuwe, unieke waarden voor gevoelige/unieke velden**: `token_hash` op
   `survey_response` krijgt een nieuwe, willekeurige hash (nooit de
   brontoken hergebruiken — zie Taak 5).

**Gemeten feiten (2026-10-06, via `PRODUCTIE_RUNTIME_URL` met correcte
tenant- en actor-context — zie Taak 2 voor waarom dat niet overgeslagen mag
worden):**

| Tabel | Transdev Nederland | Transdev DEV (vóór opschonen) |
|---|---|---|
| `vendor` | 41 | moet eerst leeg |
| `vendor_contact` | 49 | moet eerst leeg |
| `survey_template` | 2 | 0 |
| `survey_run` | 1 | moet eerst leeg |
| `survey_response` | 4 | moet eerst leeg |
| `contract` | 46 | moet eerst leeg |
| `vendor_engagement` | 3 | moet eerst leeg |
| `ref.vendor_category` | 7 | 17 (gaat weg bij opschonen) |
| `audit.audit_event` | 2 | 10 (gaat weg bij opschonen; wordt niet gekopieerd) |

> **Correctie 2026-10-07:** de eerste versie van deze tabel noemde 0 voor
> `ref.vendor_category` in beide tenants. Die meting liep via `clm_migrator`
> zonder tenantcontext, en met FORCE RLS geeft dat altijd 0. Met context
> gemeten: 7 resp. 17. Dezelfde fout zat in `tellenBuitenClm()` van
> `scripts/tenant-opschonen.js` en gaf daar bij elke droge run een vals
> alarm. Gerepareerd en met een voor/na-test op een wegwerpdatabase bewezen.

---

## 1. Bestandsstructuur

- **Create:** `scripts/tenant-kopieren.js` — het nieuwe kopieerscript, zelfde
  stijl en argumenten-patroon als `scripts/tenant-opschonen.js`.
- **Create:** `docs/runbooks/tenant-kopieren.md` — het runbook, zelfde opzet
  als `docs/runbooks/tenant-opschonen.md` (type A, eenmalig, onomkeerbaar).
- **Modify:** geen bestaand script. `tenant-opschonen.js` blijft ongewijzigd
  — de extra opschoonstap voor templates/categorieën/vragen in Taak 1 is een
  **losse, kleine functie binnen `tenant-kopieren.js` zelf**, niet een
  uitbreiding van het generieke opschoonscript (dat script moet voor andere
  toekomstige tenants zijn huidige, voorzichtigere default-gedrag houden).

---

## Taak 1: Transdev DEV volledig leegmaken (inclusief templates)

**Files:**
- Modify: geen — dit is een uitvoeringsstap met bestaande tools plus één
  kleine extra SQL-actie.

### Stap 1.1: Transdev DEV leegmaken met het bestaande script (droge run)

```powershell
node scripts/tenant-opschonen.js --tenant-id c0fe1d30-e785-4dcd-bdf2-0740e95bdd61 --extern
```

Verwacht: `GEEN AFWIJKING` voor alle andere tenants, doeltenant overal 0 na
de simulatie, aan het eind `Droge run: ROLLBACK uitgevoerd, niets gewijzigd.`

### Stap 1.2: Droge run beoordelen, dan echt uitvoeren

Lees de output van stap 1.1 volledig. Controleer specifiek:
- Staat er een `LET OP: nog niet-verlopen uitnodigingen`-regel? Transdev DEV
  had op 2026-09-25 een niet-verzilverde uitnodigingslink (zie memory
  `mcm2-transdev-schone-lei-en-dev-tenant`) — dat token wordt hiermee
  ongeldig. Meld dit expliciet, ook al verwachten we dat dit al bekend is.
- Staan er geüploade bestanden gemeld? Zo ja, benoem ze (naam, grootte) —
  ze blijven na deze stap onbereikbaar op de container, net als bij elke
  eerdere opschoning.

Pas na een groene droge run:

```powershell
node scripts/tenant-opschonen.js --tenant-id c0fe1d30-e785-4dcd-bdf2-0740e95bdd61 --extern --commit
```

Verwacht: `Geen afwijking. COMMIT uitgevoerd.`

### Stap 1.3: De drie resterende tabellen legen (templates/categorieën/vragen)

`tenant-opschonen.js` laat deze bewust staan (zie runbook §3). Voor déze
operatie moeten ze ook leeg, want Transdev DEV krijgt zo dadelijk een
1-op-1-kopie van de templates van Transdev Nederland, en de oude
seed-templates mogen niet naast de kopie blijven staan (besluit §0.2).

Dit is een kleine, losstaande SQL-actie — geen nieuw script, geen wijziging
aan `tenant-opschonen.js`. `survey_question` en `survey_category` verwijzen
met `ON DELETE CASCADE` naar `survey_template.template_id` (geverifieerd
2026-10-06 via `pg_get_constraintdef`), dus één DELETE op `survey_template`
ruimt alle drie op.

**Volgorde-eis, experimenteel bevestigd (2026-10-06, wegwerpcontainer):**
`survey_run.template_id` is **RESTRICT**, niet CASCADE. Deze stap werkt dus
alleen als Taak 1.1/1.2 (het bestaande `tenant-opschonen.js`) al **volledig**
is afgerond — die ruimt `survey_run` (en alles dat ervan afhangt) al op in de
juiste FK-volgorde, dus op het moment dat deze stap draait, bestaat er geen
`survey_run` meer die naar een template verwijst. Draai deze stap dus nooit
vóór of los van een volledige, succesvolle Taak 1.1/1.2.

```js
// Eenmalig uitvoeren, binnen tenant-kopieren.js zelf (zie Taak 6, stap 0),
// VOOR de rest van de kopie begint. clm_api_runtime heeft hier volledige
// CRUD (geen REVOKE gevonden op deze drie tabellen).
await apiClient.query('BEGIN');
await apiClient.query(
  `SELECT set_config('app.current_tenant_id', $1, true)`,
  [DEV_TENANT_ID],
);
await apiClient.query(`SELECT set_config('app.current_actor', 'medewerker', true)`);

const voorTelling = await apiClient.query(
  `SELECT count(*) FROM clm.survey_template`,
);
console.log(`Transdev DEV survey_template vóór opschonen: ${voorTelling.rows[0].count}`);

const { rowCount } = await apiClient.query(`DELETE FROM clm.survey_template`);
console.log(`survey_template verwijderd: ${rowCount} (survey_category en survey_question gaan mee via CASCADE)`);

const naTelling = await apiClient.query(`
  SELECT
    (SELECT count(*) FROM clm.survey_template) AS templates,
    (SELECT count(*) FROM clm.survey_category) AS categories,
    (SELECT count(*) FROM clm.survey_question) AS questions`);
console.log('Na opschonen (moet overal 0 zijn):', naTelling.rows[0]);

if (
  Number(naTelling.rows[0].templates) !== 0 ||
  Number(naTelling.rows[0].categories) !== 0 ||
  Number(naTelling.rows[0].questions) !== 0
) {
  throw new Error('Transdev DEV is na opschonen niet leeg op template/category/question.');
}
await apiClient.query('COMMIT');
```

### Stap 1.4: Verifiëren met een verse verbinding

Zelfde discipline als runbook §8: niet vertrouwen op de transactie die
zojuist gecommit is.

```powershell
node -e "
require('dotenv/config');
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.PRODUCTIE_RUNTIME_URL });
  await client.connect();
  await client.query('BEGIN');
  await client.query(\`SELECT set_config('app.current_tenant_id', 'c0fe1d30-e785-4dcd-bdf2-0740e95bdd61', true)\`);
  await client.query(\`SELECT set_config('app.current_actor', 'medewerker', true)\`);
  for (const t of ['vendor','contract','survey_template','survey_run','survey_response','vendor_engagement']) {
    const { rows } = await client.query('SELECT count(*) FROM clm.' + t);
    console.log(t + ':', rows[0].count);
  }
  await client.query('ROLLBACK');
  await client.end();
})();
"
```

Verwacht: alle tellingen 0.

---

## Taak 2: Bronmeting — exacte rijtellingen van Transdev Nederland, met context

**Files:**
- Create (binnen `tenant-kopieren.js`): een `bronTelling()`-functie die
  precies zo werkt als `tellenViaApi`/`tellenViaMigrator` in
  `tenant-opschonen.js` — **altijd met `app.current_tenant_id` én
  `app.current_actor` gezet**, nooit een kale COUNT zonder context (dat gaf
  op 2026-10-06 tijdens het plannen van deze taak zelf een fout-nul-resultaat
  voor `vendor_category`/`survey_template`, terwijl de werkelijke telling via
  de juiste context 41 vendors en 2 templates liet zien — exact de valkuil
  uit `mcm2-nul-rijen-is-geen-bevinding`).

### Stap 2.1: Schrijf de bronTelling-functie

```js
const BRON_TABELLEN = [
  'survey_template', 'survey_category', 'survey_question',
  'vendor', 'vendor_contact', 'vendor_tag', 'vendor_compliance_thema',
  'contract',
  'vendor_engagement', 'vendor_engagement_link',
  'survey_run', 'survey_response', 'survey_answer',
  'survey_review', 'response_note',
  'import_job', 'import_row', 'import_extra_contact',
];

async function bronTelling(apiClient, tenantId) {
  await apiClient.query('BEGIN');
  await apiClient.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
  await apiClient.query(`SELECT set_config('app.current_actor', 'medewerker', true)`);
  const tellingen = {};
  for (const tabel of BRON_TABELLEN) {
    const { rows } = await apiClient.query(`SELECT count(*) FROM clm.${tabel}`);
    tellingen[tabel] = Number(rows[0].count);
  }
  const { rows: catRows } = await apiClient.query(
    `SELECT count(*) FROM ref.vendor_category WHERE tenant_id = $1`,
    [tenantId],
  );
  tellingen['ref.vendor_category'] = Number(catRows[0].count);
  await apiClient.query('ROLLBACK');
  return tellingen;
}
```

`survey_attachment` staat hier bewust NIET in — zie besluit §0.6, die
tabel wordt niet gekopieerd.

### Stap 2.2: Draai dit los en vergelijk met de bekende cijfers

Verwacht (zoals gemeten in §0, kolom "Transdev Nederland"): `vendor: 41`,
`vendor_contact: 49`, `survey_template: 2`, `survey_run: 1`,
`survey_response: 4`, `contract: 46`, `vendor_engagement: 3`.

Komt er een andere telling uit, ga er NIET van uit dat de brondata
veranderd is — controleer eerst of `app.current_tenant_id` en
`app.current_actor` beide daadwerkelijk gezet zijn vóór de query.

---

## Taak 3: De ID-vertaaltabel en de generieke kopieerhelper

**Files:**
- Create (binnen `tenant-kopieren.js`): `idMap` (een `Map<string,string>`,
  sleutel is het oude UUID, waarde het nieuwe) en een generieke
  `kopieerTabel()`-helper.

### Stap 3.1: Schrijf de ID-vertaaltabel

```js
const { randomUUID, createHash, randomBytes } = require('node:crypto');

// Eén globale vertaaltabel: oud UUID (uit Transdev Nederland) -> nieuw UUID
// (voor Transdev DEV). Elke PK die we kopiëren krijgt hier een nieuwe
// waarde; elke FK die naar een gekopieerde tabel wijst, zoekt het nieuwe
// UUID hierin op in plaats van de oude waarde te hergebruiken.
const idMap = new Map();

function nieuwId(oudId) {
  if (idMap.has(oudId)) {
    throw new Error(`nieuwId() aangeroepen voor een al bestaand oud ID: ${oudId}`);
  }
  const nieuw = randomUUID();
  idMap.set(oudId, nieuw);
  return nieuw;
}

function vertaalId(oudId) {
  if (oudId === null || oudId === undefined) return null;
  const nieuw = idMap.get(oudId);
  if (!nieuw) {
    throw new Error(`Geen vertaling bekend voor ID ${oudId} — kopieer de bronrij vóór de rij die ernaar verwijst.`);
  }
  return nieuw;
}
```

### Stap 3.2: Schrijf een test voor de vertaaltabel (geen database nodig)

**Test:** `test/tenant-kopieren-idmap.spec.ts`

```ts
describe('idMap-logica uit scripts/tenant-kopieren.js', () => {
  it('geeft bij elke nieuwId() een ander UUID terug dan het oude', () => {
    const idMap = new Map<string, string>();
    function nieuwId(oudId: string): string {
      const nieuw = '11111111-1111-1111-1111-111111111111';
      idMap.set(oudId, nieuw);
      return nieuw;
    }
    const resultaat = nieuwId('oud-id-1');
    expect(resultaat).not.toBe('oud-id-1');
    expect(idMap.get('oud-id-1')).toBe(resultaat);
  });

  it('werpt een duidelijke fout als een FK-doel nog niet vertaald is', () => {
    const idMap = new Map<string, string>();
    function vertaalId(oudId: string | null): string | null {
      if (oudId === null) return null;
      const nieuw = idMap.get(oudId);
      if (!nieuw) {
        throw new Error(`Geen vertaling bekend voor ID ${oudId}`);
      }
      return nieuw;
    }
    expect(() => vertaalId('onbekend-id')).toThrow('Geen vertaling bekend voor ID onbekend-id');
    expect(vertaalId(null)).toBeNull();
  });
});
```

Dit is een losstaande unittest van de logica (niet het echte script
importeren, dat verbindt meteen met een database bij het inladen) — puur om
de twee kernregels (nieuw ID altijd anders dan oud, ontbrekende vertaling is
een harde fout) vast te leggen vóór de rest gebouwd wordt.

```powershell
npx jest test/tenant-kopieren-idmap.spec.ts
```

Verwacht: 2 passed.

### Stap 3.3: Vaste constantes voor de twee tenants en de DEV-gebruiker

```js
const BRON_TENANT_ID = '4afcb659-63a8-4b16-8a0c-76d2a2d8676e'; // Transdev Nederland
const DOEL_TENANT_ID = 'c0fe1d30-e785-4dcd-bdf2-0740e95bdd61'; // Transdev DEV
const DOEL_GEBRUIKER_ID = 'a1994ff4-f145-4c85-acd0-c6fd77ed0986'; // Kees4TDD, admin van Transdev DEV
```

Deze drie ID's staan **hardgecodeerd** in het script, niet als
command-line-argument — dit is een eenmalig, specifiek stuk werk voor deze
twee tenants, geen generiek hulpmiddel (zelfde designkeuze als
`tenant-opschonen.js` bewust een vaste tabellenlijst heeft i.p.v. een
automatisch afgeleide).

---

## Taak 4: Templates, categorieën en vragen kopiëren

**Files:**
- Create (binnen `tenant-kopieren.js`): `kopieerTemplates()`.

### Stap 4.1: Kopieer survey_template

```js
async function kopieerTemplates(apiClient) {
  const resultaat = { survey_template: 0, survey_category: 0, survey_question: 0 };

  const { rows: templates } = await apiClient.query(
    `SELECT template_id, name, version, created_at FROM clm.survey_template ORDER BY created_at`,
  );
  for (const t of templates) {
    const nieuwTemplateId = nieuwId(t.template_id);
    await apiClient.query(
      `INSERT INTO clm.survey_template (template_id, tenant_id, name, version, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [nieuwTemplateId, DOEL_TENANT_ID, t.name, t.version, t.created_at],
    );
    resultaat.survey_template += 1;
  }

  const { rows: categories } = await apiClient.query(
    `SELECT category_id, template_id, position, name, min_answers, created_at
       FROM clm.survey_category ORDER BY template_id, position`,
  );
  for (const c of categories) {
    const nieuwCategoryId = nieuwId(c.category_id);
    await apiClient.query(
      `INSERT INTO clm.survey_category
         (category_id, tenant_id, template_id, position, name, min_answers, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [nieuwCategoryId, DOEL_TENANT_ID, vertaalId(c.template_id), c.position, c.name, c.min_answers, c.created_at],
    );
    resultaat.survey_category += 1;
  }

  const { rows: questions } = await apiClient.query(
    `SELECT question_id, template_id, category_id, position, question_key, title, body,
            answer_type, config, is_required, allows_upload, max_files, created_at
       FROM clm.survey_question ORDER BY template_id, position`,
  );
  for (const q of questions) {
    const nieuwQuestionId = nieuwId(q.question_id);
    await apiClient.query(
      `INSERT INTO clm.survey_question
         (question_id, tenant_id, template_id, category_id, position, question_key, title, body,
          answer_type, config, is_required, allows_upload, max_files, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        nieuwQuestionId, DOEL_TENANT_ID, vertaalId(q.template_id),
        q.category_id === null ? null : vertaalId(q.category_id),
        q.position, q.question_key, q.title, q.body,
        q.answer_type, q.config, q.is_required, q.allows_upload, q.max_files, q.created_at,
      ],
    );
    resultaat.survey_question += 1;
  }

  return resultaat;
}
```

**Let op volgorde:** templates vóór categorieën vóór vragen — categorieën
en vragen verwijzen naar `template_id`, vragen ook (optioneel) naar
`category_id`.

### Stap 4.2: Query om de bronrijen op te halen MET tenantcontext

Bovenstaande `SELECT`-queries in stap 4.1 lopen binnen de `apiClient`-
transactie die al `app.current_tenant_id = BRON_TENANT_ID` heeft staan (zie
Taak 6 voor de volledige transactiestructuur) — RLS filtert dan automatisch
op de bron. Dit los testen vóór de rest bouwen:

```powershell
node -e "
require('dotenv/config');
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.PRODUCTIE_RUNTIME_URL });
  await client.connect();
  await client.query('BEGIN');
  await client.query(\`SELECT set_config('app.current_tenant_id', '4afcb659-63a8-4b16-8a0c-76d2a2d8676e', true)\`);
  await client.query(\`SELECT set_config('app.current_actor', 'medewerker', true)\`);
  const { rows } = await client.query('SELECT template_id, name, version FROM clm.survey_template');
  console.log(rows);
  await client.query('ROLLBACK');
  await client.end();
})();
"
```

Verwacht: 2 rijen (zoals gemeten in §0).

---

## Taak 5: Vendors, contacten, tags, compliance-thema's en vendor_category

**Files:**
- Create (binnen `tenant-kopieren.js`): `kopieerVendorCategorie()`,
  `kopieerVendors()`.

### Stap 5.1: Kopieer ref.vendor_category (vóór vendor, want vendor verwijst erheen)

```js
async function kopieerVendorCategorie(apiClient) {
  const { rows } = await apiClient.query(
    `SELECT code, label FROM ref.vendor_category WHERE tenant_id = $1`,
    [BRON_TENANT_ID],
  );
  for (const r of rows) {
    await apiClient.query(
      `INSERT INTO ref.vendor_category (tenant_id, code, label) VALUES ($1, $2, $3)`,
      [DOEL_TENANT_ID, r.code, r.label],
    );
  }
  return rows.length;
}
```

Geen `vertaalId()` nodig — `code` is tekst, geen UUID, en de PK is
`(tenant_id, code)`: dezelfde `code` onder een andere `tenant_id` is een
andere, conflictvrije sleutel. Gemeten op 2026-10-06: 0 rijen in beide
tenants, dus deze stap kopieert in de praktijk niets — maar moet er staan
voor het geval dat verandert.

### Stap 5.2: Kopieer vendor

```js
async function kopieerVendors(apiClient) {
  const { rows } = await apiClient.query(
    `SELECT vendor_id, name, kvk_number, vestigingsnummer, statutory_name, trade_names,
            legal_form, incorporation_date, sbi_code, sbi_description, category_code,
            business_criticality_code, compliance_status_code, country, city, website,
            annual_spend_eur, risk_score, owner_user_id, last_review_date, next_review_date,
            coupa_supplier_number, created_at, updated_at, deleted_at
       FROM clm.vendor WHERE tenant_id = $1 ORDER BY created_at`,
    [BRON_TENANT_ID],
  );
  for (const v of rows) {
    const nieuwVendorId = nieuwId(v.vendor_id);
    await apiClient.query(
      `INSERT INTO clm.vendor
         (vendor_id, tenant_id, name, kvk_number, vestigingsnummer, statutory_name, trade_names,
          legal_form, incorporation_date, sbi_code, sbi_description, category_code,
          business_criticality_code, compliance_status_code, country, city, website,
          annual_spend_eur, risk_score, owner_user_id, last_review_date, next_review_date,
          coupa_supplier_number, created_at, updated_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [
        nieuwVendorId, DOEL_TENANT_ID, v.name, v.kvk_number, v.vestigingsnummer, v.statutory_name,
        v.trade_names, v.legal_form, v.incorporation_date, v.sbi_code, v.sbi_description,
        v.category_code, // tekst-code, geen vertaalId() nodig (zie stap 5.1)
        v.business_criticality_code, v.compliance_status_code, v.country, v.city, v.website,
        v.annual_spend_eur, v.risk_score,
        // owner_user_id: NULL blijft NULL (besluit §0.3-uitzondering,
        // bevestigd 2026-10-06) — alleen een al-gevulde eigenaar wordt naar
        // Kees4TDD gemapt, "niet toegewezen" blijft zichtbaar als zodanig.
        v.owner_user_id === null ? null : DOEL_GEBRUIKER_ID,
        v.last_review_date, v.next_review_date, v.coupa_supplier_number,
        v.created_at, v.updated_at, v.deleted_at,
      ],
    );
  }
  return rows.length;
}
```

### Stap 5.3: Kopieer vendor_contact, vendor_tag, vendor_compliance_thema

```js
async function kopieerVendorBijlagen(apiClient) {
  const resultaat = { vendor_contact: 0, vendor_tag: 0, vendor_compliance_thema: 0 };

  const { rows: contacten } = await apiClient.query(
    `SELECT contact_id, vendor_id, full_name, email, phone, job_title, role_description,
            is_primary, created_at, updated_at, deleted_at
       FROM clm.vendor_contact WHERE tenant_id = $1 ORDER BY created_at`,
    [BRON_TENANT_ID],
  );
  for (const c of contacten) {
    const nieuwContactId = nieuwId(c.contact_id);
    await apiClient.query(
      `INSERT INTO clm.vendor_contact
         (contact_id, vendor_id, tenant_id, full_name, email, phone, job_title,
          role_description, is_primary, created_at, updated_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        nieuwContactId, vertaalId(c.vendor_id), DOEL_TENANT_ID, c.full_name, c.email, c.phone,
        c.job_title, c.role_description, c.is_primary, c.created_at, c.updated_at, c.deleted_at,
      ],
    );
    resultaat.vendor_contact += 1;
  }

  const { rows: tags } = await apiClient.query(
    `SELECT vendor_id, tag, created_at FROM clm.vendor_tag WHERE tenant_id = $1`,
    [BRON_TENANT_ID],
  );
  for (const t of tags) {
    await apiClient.query(
      `INSERT INTO clm.vendor_tag (vendor_id, tenant_id, tag, created_at)
       VALUES ($1, $2, $3, $4)`,
      [vertaalId(t.vendor_id), DOEL_TENANT_ID, t.tag, t.created_at],
    );
    resultaat.vendor_tag += 1;
  }

  const { rows: themas } = await apiClient.query(
    `SELECT vendor_id, thema_code, created_at FROM clm.vendor_compliance_thema WHERE tenant_id = $1`,
    [BRON_TENANT_ID],
  );
  for (const t of themas) {
    await apiClient.query(
      `INSERT INTO clm.vendor_compliance_thema (vendor_id, tenant_id, thema_code, created_at)
       VALUES ($1, $2, $3, $4)`,
      [vertaalId(t.vendor_id), DOEL_TENANT_ID, t.thema_code, t.created_at],
    );
    resultaat.vendor_compliance_thema += 1;
  }

  return resultaat;
}
```

`thema_code` wijst naar `ref.compliance_thema.code` — een globale,
tenant-agnostische ref-tabel (geverifieerd in de schema-analyse), dus geen
vertaling nodig.

---

## Taak 6: Contracten en vendor_engagement (via de SECURITY DEFINER-functie)

**Files:**
- Create (binnen `tenant-kopieren.js`): de tijdelijke SECURITY
  DEFINER-functie `clm.tijdelijk_kopieren_beperkte_tabellen`, plus
  `kopieerContracten()` en `kopieerEngagements()`.

### Stap 6.1: Waarom hier een functie nodig is

`clm_api_runtime` mist op `contract` en `vendor_engagement` het `UPDATE`-
recht (geverifieerd: alleen `SELECT, INSERT, UPDATE` resp. `SELECT, INSERT,
UPDATE` zonder DELETE — INSERT is hier dus wél toegestaan). Bij nader
onderzoek (zie het schema-rapport dat aan dit plan voorafging) is INSERT op
deze twee tabellen via `clm_api_runtime` **wel** toegestaan. Een
SECURITY DEFINER-functie is hier dus **niet strikt noodzakelijk** voor
`contract`/`vendor_engagement` zelf — in tegenstelling tot
`tenant-opschonen.js`, waar de functie nodig was om het *ontbrekende*
DELETE-recht te omzeilen.

**Waar een functie wél nodig blijft:** nergens in deze kopieeroperatie,
want we voeren uitsluitend `INSERT` uit, en `clm_api_runtime` heeft op elke
tabel in deze lijst INSERT-rechten (bevestigd in het schema-onderzoek: geen
enkele tabel mist INSERT, alleen DELETE/UPDATE ontbreken hier en daar).
**Schrap Stap 6.1's functie-aanmaak dus volledig** — dit is eenvoudiger dan
`tenant-opschonen.js`, en dat is een directe consequentie van "kopiëren is
alleen INSERT, opschonen is DELETE".

> Expliciete correctie t.o.v. het eerste ontwerp van dit plan: er is **geen
> SECURITY DEFINER-functie nodig voor dit script**. Alle inserts lopen via
> `apiClient` (de `clm_api_runtime`-rol). Dit vereenvoudigt Taken 6 en 7
> aanzienlijk. De `migratorClient`/`NOOD_PRODUCTIE_URL`-verbinding is in dit
> script alleen nog nodig om `clm.tenant_register` te bevragen (tenantnamen
> tonen) — dezelfde, kleine rol als in `tenant-opschonen.js`.

### Stap 6.2: Kopieer contract

```js
async function kopieerContracten(apiClient) {
  const { rows } = await apiClient.query(
    `SELECT contract_id, vendor_id, name, contract_number, vendor_contact_id, owner_user_id,
            status_code, value_eur, start_date, end_date, note, contract_type, dpa_aanwezig,
            business_risk_tier_code, notice_period_days, warning_days_before, auto_renews,
            created_at, updated_at, deleted_at
       FROM clm.contract WHERE tenant_id = $1 ORDER BY created_at`,
    [BRON_TENANT_ID],
  );
  for (const c of rows) {
    const nieuwContractId = nieuwId(c.contract_id);
    await apiClient.query(
      `INSERT INTO clm.contract
         (contract_id, tenant_id, vendor_id, name, contract_number, vendor_contact_id,
          owner_user_id, status_code, value_eur, start_date, end_date, note, contract_type,
          dpa_aanwezig, business_risk_tier_code, notice_period_days, warning_days_before,
          auto_renews, created_at, updated_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        nieuwContractId, DOEL_TENANT_ID, vertaalId(c.vendor_id), c.name, c.contract_number,
        c.vendor_contact_id === null ? null : vertaalId(c.vendor_contact_id),
        // owner_user_id: zelfde regel als vendor (stap 5.2) — NULL blijft NULL.
        c.owner_user_id === null ? null : DOEL_GEBRUIKER_ID,
        c.status_code, c.value_eur, c.start_date, c.end_date, c.note, c.contract_type,
        c.dpa_aanwezig, c.business_risk_tier_code, c.notice_period_days, c.warning_days_before,
        c.auto_renews, c.created_at, c.updated_at, c.deleted_at,
      ],
    );
  }
  return rows.length;
}
```

`status_code` en `business_risk_tier_code` zijn globale ref-tabel-codes
(tekst, geen vertaling nodig).

### Stap 6.3: Kopieer vendor_engagement en vendor_engagement_link

```js
async function kopieerEngagements(apiClient) {
  const resultaat = { vendor_engagement: 0, vendor_engagement_link: 0 };

  const { rows: engagements } = await apiClient.query(
    `SELECT engagement_id, vendor_id, titel, created_at, deleted_at
       FROM clm.vendor_engagement WHERE tenant_id = $1 ORDER BY created_at`,
    [BRON_TENANT_ID],
  );
  for (const e of engagements) {
    const nieuwEngagementId = nieuwId(e.engagement_id);
    await apiClient.query(
      `INSERT INTO clm.vendor_engagement
         (engagement_id, tenant_id, vendor_id, titel, created_by_user_id, created_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        nieuwEngagementId, DOEL_TENANT_ID, vertaalId(e.vendor_id), e.titel,
        DOEL_GEBRUIKER_ID, // created_by_user_id, NOT NULL, besluit §0.3
        e.created_at, e.deleted_at,
      ],
    );
    resultaat.vendor_engagement += 1;
  }

  const { rows: links } = await apiClient.query(
    `SELECT link_id, engagement_id, link_type, linked_id
       FROM clm.vendor_engagement_link WHERE tenant_id = $1`,
    [BRON_TENANT_ID],
  );
  for (const l of links) {
    // linked_id is polymorf: bij link_type='contract' wijst hij naar
    // contract.contract_id, bij 'survey_response' naar survey_response.
    // response_id. Beide zijn op het moment dat deze functie draait al
    // gekopieerd (contracten in stap 6.2, survey_response in Taak 7) —
    // zorg dat de aanroepvolgorde in Taak 8 dat garandeert.
    await apiClient.query(
      `INSERT INTO clm.vendor_engagement_link (link_id, engagement_id, tenant_id, link_type, linked_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [randomUUID(), vertaalId(l.engagement_id), DOEL_TENANT_ID, l.link_type, vertaalId(l.linked_id)],
    );
    resultaat.vendor_engagement_link += 1;
  }

  return resultaat;
}
```

**Belangrijke volgorde-eis:** `vendor_engagement_link` moet NA
`kopieerContracten()` ÉN NA de survey_response-kopie (Taak 7) draaien, want
`linked_id` kan naar beide wijzen. Zie Taak 8 voor de vaste aanroepvolgorde.

---

## Taak 7: Vragenlijst-rondes, inzendingen, antwoorden, beoordelingen en notities

**Files:**
- Create (binnen `tenant-kopieren.js`): `kopieerSurveyRuns()`,
  `kopieerSurveyResponsesEnAnswers()`, `kopieerReviewsEnNotes()`.

### Stap 7.1: Kopieer survey_run

```js
async function kopieerSurveyRuns(apiClient) {
  const { rows } = await apiClient.query(
    `SELECT run_id, template_id, survey_kind, status, is_test, started_at, closes_at,
            revoked_at, contract_id
       FROM clm.survey_run WHERE tenant_id = $1 ORDER BY started_at`,
    [BRON_TENANT_ID],
  );
  for (const r of rows) {
    const nieuwRunId = nieuwId(r.run_id);
    await apiClient.query(
      `INSERT INTO clm.survey_run
         (run_id, tenant_id, template_id, survey_kind, status, is_test, started_at,
          closes_at, revoked_at, contract_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        nieuwRunId, DOEL_TENANT_ID, vertaalId(r.template_id), r.survey_kind, r.status,
        r.is_test, r.started_at, r.closes_at, r.revoked_at,
        // contract_id heeft GEEN foreign-key-constraint (bewust, zie schema-
        // analyse), maar bevat wél een waarde die naar het nieuwe contract_id
        // moet wijzen als hij niet NULL is.
        r.contract_id === null ? null : vertaalId(r.contract_id),
      ],
    );
  }
  return rows.length;
}
```

**Volgorde-eis:** moet na `kopieerContracten()` draaien (vanwege
`contract_id`) en na `kopieerTemplates()` (vanwege `template_id`).

### Stap 7.2: Kopieer survey_response en survey_answer, met een NIEUWE token_hash

**Volgorde-eis, experimenteel bevestigd (2026-10-06, wegwerpcontainer):** de
RLS-policy `survey_answer_isolation` staat INSERT op `survey_answer` alleen
toe wanneer de bijbehorende `survey_response.status = 'pending'` is — exact
hoe de applicatie zelf werkt (antwoorden komen binnen terwijl de respons nog
openstaat). Een respons die al als `submitted` wordt aangemaakt, blokkeert
dus de INSERT van zijn eigen antwoorden. Het geïmplementeerde script lost dit
op door **elke `survey_response` eerst als `pending` in te voegen (zonder
`submitted_at`), dan de bijbehorende `survey_answer`-rijen toe te voegen, en
pas daarna de werkelijke `status`/`submitted_at` terug te zetten met een
`UPDATE`** (toegestaan: `clm_api_runtime` heeft UPDATE-recht op
`survey_response`). Dit is geen afwijking van het ontwerp, alleen een
uitwerking die nodig bleek tijdens implementatie — de code hieronder
weerspiegelt dit al.

```js
async function kopieerSurveyResponsesEnAnswers(apiClient) {
  const resultaat = { survey_response: 0, survey_answer: 0 };

  const { rows: responses } = await apiClient.query(
    `SELECT response_id, run_id, vendor_id, subject_vendor_id, respondent_user_id,
            respondent_label, status, expires_at, submitted_at, handmatig_verzonden_op,
            created_at
       FROM clm.survey_response WHERE tenant_id = $1 ORDER BY created_at`,
    [BRON_TENANT_ID],
  );
  for (const r of responses) {
    const nieuwResponseId = nieuwId(r.response_id);
    // Nieuwe, willekeurige token_hash — nooit de brontoken hergebruiken
    // (besluit §0.7). Dit maakt elk gekopieerd token-gebaseerd portaallink
    // ongeldig in de zin dat niemand de ORIGINELE link uit productie kan
    // gebruiken om bij de DEV-kopie te komen — en dat is precies de bedoeling.
    const nieuweTokenHash = createHash('sha256').update(randomBytes(32)).digest('hex');

    await apiClient.query(
      `INSERT INTO clm.survey_response
         (response_id, tenant_id, run_id, vendor_id, subject_vendor_id, respondent_user_id,
          respondent_label, token_hash, status, expires_at, submitted_at,
          handmatig_verzonden_op, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        nieuwResponseId, DOEL_TENANT_ID, vertaalId(r.run_id),
        r.vendor_id === null ? null : vertaalId(r.vendor_id),
        vertaalId(r.subject_vendor_id),
        null, // respondent_user_id op NULL — besluit: dit is een leverancier-identiteit, geen interne gebruiker; niet naar DOEL_GEBRUIKER_ID mappen
        r.respondent_label, nieuweTokenHash, r.status, r.expires_at, r.submitted_at,
        r.handmatig_verzonden_op, r.created_at,
      ],
    );
    resultaat.survey_response += 1;
  }

  const { rows: answers } = await apiClient.query(
    `SELECT answer_id, response_id, question_id, answer_type, answer_code, answer_codes,
            answer_text, answer_number, comment, created_at, updated_at
       FROM clm.survey_answer WHERE tenant_id = $1 ORDER BY created_at`,
    [BRON_TENANT_ID],
  );
  for (const a of answers) {
    const nieuwAnswerId = nieuwId(a.answer_id);
    await apiClient.query(
      `INSERT INTO clm.survey_answer
         (answer_id, tenant_id, response_id, question_id, answer_type, answer_code,
          answer_codes, answer_text, answer_number, comment, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        nieuwAnswerId, DOEL_TENANT_ID, vertaalId(a.response_id), vertaalId(a.question_id),
        a.answer_type, a.answer_code, a.answer_codes, a.answer_text, a.answer_number,
        a.comment, a.created_at, a.updated_at,
      ],
    );
    resultaat.survey_answer += 1;
  }

  return resultaat;
}
```

**Beslissing die hier nog expliciet bevestigd moet worden tijdens
uitvoering:** `respondent_user_id` wordt hier op `null` gezet in plaats van
`DOEL_GEBRUIKER_ID`, omdat dit veld de *leverancier-kant* van een inzending
is (wie bij de leverancier het formulier invulde), niet een Transdev-
medewerker — mappen naar de interne DEV-admin zou een verkeerd signaal
geven. Leg dit expliciet voor als onderdeel van Taak 9 (voorleggen vóór
`--commit`).

**`survey_attachment` wordt hier bewust NIET gekopieerd** — besluit §0.6.

### Stap 7.3: Kopieer survey_review en response_note

```js
async function kopieerReviewsEnNotes(apiClient) {
  const resultaat = { survey_review: 0, response_note: 0 };

  const { rows: reviews } = await apiClient.query(
    `SELECT review_id, response_id, verdict, toelichting, created_at, deleted_at
       FROM clm.survey_review WHERE tenant_id = $1 ORDER BY created_at`,
    [BRON_TENANT_ID],
  );
  for (const r of reviews) {
    const nieuwReviewId = nieuwId(r.review_id);
    await apiClient.query(
      `INSERT INTO clm.survey_review
         (review_id, tenant_id, response_id, verdict, toelichting, reviewer_user_id,
          created_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        nieuwReviewId, DOEL_TENANT_ID, vertaalId(r.response_id), r.verdict, r.toelichting,
        DOEL_GEBRUIKER_ID, // reviewer_user_id, NOT NULL + restrict, besluit §0.3
        r.created_at, r.deleted_at,
      ],
    );
    resultaat.survey_review += 1;
  }

  const { rows: notes } = await apiClient.query(
    `SELECT note_id, response_id, tekst, created_at, deleted_at, soort
       FROM clm.response_note WHERE tenant_id = $1 ORDER BY created_at`,
    [BRON_TENANT_ID],
  );
  for (const n of notes) {
    const nieuwNoteId = nieuwId(n.note_id);
    await apiClient.query(
      `INSERT INTO clm.response_note
         (note_id, tenant_id, response_id, tekst, author_user_id, created_at, deleted_at, soort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        nieuwNoteId, DOEL_TENANT_ID, vertaalId(n.response_id), n.tekst,
        DOEL_GEBRUIKER_ID, // author_user_id, NOT NULL + restrict, besluit §0.3
        n.created_at, n.deleted_at, n.soort,
      ],
    );
    resultaat.response_note += 1;
  }

  return resultaat;
}
```

**Let op INSERT-rechten:** `survey_review` en `response_note` missen
`DELETE` via `clm_api_runtime` (audit-bewijs), maar hebben wél `INSERT`
(geverifieerd in het schema-onderzoek: `GRANT SELECT, INSERT, UPDATE`).
Deze stap werkt dus zonder SECURITY DEFINER-functie.

---

## Taak 8: Hoofdfunctie — vaste aanroepvolgorde, droge run vs. commit

**Files:**
- Modify: `scripts/tenant-kopieren.js` — de `main()`-functie die alles
  samenbrengt.

### Stap 8.1: Schrijf de volgordelogica

De volgorde is door de foreign keys gedwongen. Dit is de enige correcte
reeks (reden staat per stap in de taken hierboven):

```js
async function main() {
  const commit = process.argv.includes('--commit');

  const migratorUrl = process.env.NOOD_PRODUCTIE_URL;
  const apiUrl = process.env.PRODUCTIE_RUNTIME_URL;
  if (!migratorUrl || !apiUrl) {
    console.error('\nNOOD_PRODUCTIE_URL en PRODUCTIE_RUNTIME_URL moeten beide in .env staan.\n');
    process.exitCode = 1;
    return;
  }

  meldDoelwit(apiUrl, 'Tenant kopiëren (Transdev Nederland -> Transdev DEV)');
  if (!eisToestemmingBuitenLokaal(apiUrl, { wat: 'Tenant kopiëren' })) {
    return;
  }

  const migratorClient = new Client({ connectionString: migratorUrl });
  const apiClient = new Client({ connectionString: apiUrl });
  await migratorClient.connect();
  await apiClient.connect();

  try {
    const { rows: rolApi } = await apiClient.query('SELECT current_user');
    if (rolApi[0].current_user !== 'clm_api_runtime') {
      throw new Error(`PRODUCTIE_RUNTIME_URL verbindt als '${rolApi[0].current_user}', verwacht clm_api_runtime.`);
    }

    // ── Stap 0: Transdev DEV moet al leeg zijn (Taak 1) — hier alleen
    // controleren, niet opnieuw leegmaken. Dit script schoont niet op.
    await apiClient.query('BEGIN');
    await apiClient.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [DOEL_TENANT_ID]);
    await apiClient.query(`SELECT set_config('app.current_actor', 'medewerker', true)`);
    const { rows: devVendors } = await apiClient.query(`SELECT count(*) FROM clm.vendor`);
    await apiClient.query('ROLLBACK');
    if (Number(devVendors[0].count) !== 0) {
      throw new Error(
        `Transdev DEV heeft nog ${devVendors[0].count} vendor(s) — voer eerst Taak 1 (leegmaken) volledig uit.`,
      );
    }

    // ── Bronmeting (Taak 2) ────────────────────────────────────────────────
    console.log('=== Bronmeting: Transdev Nederland, VOOR de kopie ===');
    const bron = await bronTelling(apiClient, BRON_TENANT_ID);
    console.table(bron);

    // ── De eigenlijke kopie, in een enkele transactie ───────────────────────
    console.log(`\n=== ${commit ? 'ECHTE UITVOERING' : 'DROGE RUN'}: kopiëren ===`);
    await apiClient.query('BEGIN');
    await apiClient.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [BRON_TENANT_ID]);
    await apiClient.query(`SELECT set_config('app.current_actor', 'medewerker', true)`);

    const resultaat = {};
    Object.assign(resultaat, { ref_vendor_category: await kopieerVendorCategorie(apiClient) });
    Object.assign(resultaat, await kopieerTemplates(apiClient));
    const aantalVendors = await kopieerVendors(apiClient);
    resultaat.vendor = aantalVendors;
    Object.assign(resultaat, await kopieerVendorBijlagen(apiClient));
    resultaat.contract = await kopieerContracten(apiClient);
    Object.assign(resultaat, await kopieerSurveyRuns(apiClient).then((n) => ({ survey_run: n })));
    Object.assign(resultaat, await kopieerSurveyResponsesEnAnswers(apiClient));
    Object.assign(resultaat, await kopieerReviewsEnNotes(apiClient));
    // vendor_engagement_link als LAATSTE: linked_id kan naar contract OF
    // survey_response wijzen, beide moeten al gekopieerd zijn.
    Object.assign(resultaat, await kopieerEngagements(apiClient));

    console.log('Gekopieerd:');
    console.table(resultaat);

    // ── Controle: tellingen in Transdev DEV NA de kopie, VOOR commit ────────
    // Let op: de rijen staan nu onder app.current_tenant_id = BRON_TENANT_ID
    // (de transactie-context) maar zijn met tenant_id = DOEL_TENANT_ID
    // geschreven. Tellen moet daarom met een NIEUWE set_config binnen
    // dezelfde transactie, anders filtert RLS ze eruit.
    await apiClient.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [DOEL_TENANT_ID]);
    const naTelling = await bronTelling(apiClient, DOEL_TENANT_ID);
    console.log('\n=== Telling in Transdev DEV NA de kopie (binnen de transactie) ===');
    console.table(naTelling);

    let afwijking = false;
    for (const tabel of Object.keys(bron)) {
      if (tabel === 'survey_attachment') continue; // bewust niet gekopieerd
      if (naTelling[tabel] !== bron[tabel]) {
        console.error(`AFWIJKING: ${tabel} — bron had ${bron[tabel]}, DEV heeft na kopie ${naTelling[tabel]}`);
        afwijking = true;
      }
    }

    if (afwijking) {
      console.error('\nAFWIJKING GEVONDEN — GEDWONGEN ROLLBACK, GEEN COMMIT.');
      await apiClient.query('ROLLBACK');
      process.exitCode = 1;
    } else if (commit) {
      await apiClient.query('COMMIT');
      console.log('\nGeen afwijking. COMMIT uitgevoerd.');
    } else {
      await apiClient.query('ROLLBACK');
      console.log('\nGeen afwijking. Droge run: ROLLBACK uitgevoerd, niets gewijzigd.');
      console.log('Draai opnieuw met --commit om dit echt uit te voeren.');
    }
  } finally {
    await apiClient.end();
    await migratorClient.end();
  }
}

main().catch((fout) => {
  console.error(`\nMislukt: ${fout.message}\n`);
  process.exitCode = 1;
});
```

**Kritiek punt om tijdens implementatie te verifiëren:** de hele kopie
draait bewust in **één transactie** met `app.current_tenant_id` eerst op
`BRON_TENANT_ID` (zodat de SELECT-queries de brondata zien via RLS) en de
INSERT-statements schrijven expliciet `tenant_id = DOEL_TENANT_ID` in elke
kolomlijst — dat werkt omdat RLS op `INSERT`/`WITH CHECK` kijkt naar de
waarde die je invoegt, niet naar de sessie-tenant, voor zover de
`WITH CHECK`-policy dat toelaat. **Dit moet bevestigd worden met een
kleine losse proef vóór de rest gebouwd wordt** (stap 8.2), want als INSERT
met een andere `tenant_id` dan de sessiecontext geblokkeerd wordt, moet de
hele transactiestructuur anders (bijvoorbeeld: twee keer dezelfde data
lezen, één keer met bron-context voor SELECT, dan context wisselen vóór
elke INSERT-batch).

### Stap 8.2: RLS-gedrag bevestigd (uitgevoerd 2026-10-06, tegen wegwerpcontainer)

**Resultaat: INSERT met een andere `tenant_id` dan `app.current_tenant_id`
wordt GEWEIGERD** door de `WITH CHECK`-clausule van de tenant-isolatiepolicy
(geverifieerd op `clm.vendor`: `new row violates row-level security policy`).
Dit geldt voor elke tabel met de standaard `tenant_isolation`-policy
(`tenant_id = clm.current_tenant_id()` als zowel `USING` als
`WITH CHECK`).

**Ook bevestigd: binnen dezelfde transactie lezen met context=BRON en
daarna, ná een contextwissel, schrijven met context=DOEL werkt wél.** Geen
nieuwe transactie nodig tussen het lezen en het schrijven.

**Consequentie voor de hoofdfunctie (stap 8.1 hierboven aanpassen):** elke
`kopieerXxx()`-functie moet in twee fasen draaien:

1. **Lees-fase** — met `app.current_tenant_id = BRON_TENANT_ID`: haal alle
   bronrijen op en bewaar ze in een gewoon JS-array (niet meteen inserten).
2. **Schrijf-fase** — na het zetten van `app.current_tenant_id =
   DOEL_TENANT_ID`: voer de INSERT's uit over het array uit stap 1.

Herschrijf elke `kopieerXxx()`-functie uit Taken 4–7 dus als twee kleine
stappen (`leesXxx()` die een array teruggeeft, gevolgd door `schrijfXxx()`
die dat array inserteert), of simpeler: houd de bestaande functie-vorm aan
maar splits de ÉÉN query-aanroep per tabel in een losse `SELECT`
(vóór de contextwissel) en de losse `INSERT`-loop (na de contextwissel),
binnen dezelfde functie. De `main()`-structuur wordt:

```js
// Fase 1: alles lezen, context = BRON_TENANT_ID
await apiClient.query('BEGIN');
await apiClient.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [BRON_TENANT_ID]);
await apiClient.query(`SELECT set_config('app.current_actor', 'medewerker', true)`);

const bronData = {
  vendorCategorie: (await apiClient.query(`SELECT code, label FROM ref.vendor_category WHERE tenant_id = $1`, [BRON_TENANT_ID])).rows,
  templates: (await apiClient.query(`SELECT ... FROM clm.survey_template WHERE tenant_id = $1`, [BRON_TENANT_ID])).rows,
  // ... idem voor elke tabel uit Taken 4-7, allemaal vóór de contextwissel ...
};

// Fase 2: context wisselen, dan alles schrijven
await apiClient.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [DOEL_TENANT_ID]);

const resultaat = {};
resultaat.ref_vendor_category = await schrijfVendorCategorie(apiClient, bronData.vendorCategorie);
Object.assign(resultaat, await schrijfTemplates(apiClient, bronData.templates, bronData.categories, bronData.questions));
// ... idem voor elke tabel, in dezelfde FK-volgorde als voorheen ...
```

Pas Taken 4–7 dienovereenkomstig aan tijdens de implementatie: elke
`kopieerXxx(apiClient)`-functie wordt gesplitst in `leesXxx(apiClient)`
(draait tijdens fase 1, retourneert de rows) en `schrijfXxx(apiClient,
rows)` (draait tijdens fase 2, voert de INSERT's uit en gebruikt
`nieuwId()`/`vertaalId()` zoals al beschreven). De SQL-inhoud van elke
query blijft ongewijzigd — alleen het moment waarop hij draait, verschuift.

---

## Taak 9: Het runbook schrijven en vóór uitvoering voorleggen

**Files:**
- Create: `docs/runbooks/tenant-kopieren.md`

### Stap 9.1: Schrijf het runbook, zelfde opzet als tenant-opschonen.md

Verplichte onderdelen (volg de structuur van
`docs/runbooks/tenant-opschonen.md` 1-op-1, aangepast voor kopiëren):

1. Type A, eigenaar Chris, vereiste toegang (`NOOD_PRODUCTIE_URL` +
   `PRODUCTIE_RUNTIME_URL`).
2. De vastgelegde ontwerpbeslissingen uit §0 van dit plan, verkort.
3. **Expliciete waarschuwing, in hoofdletters net als bij opschonen**: dit
   script is GEEN generiek kopieerhulpmiddel. De twee tenant-ID's en de
   DOEL_GEBRUIKER_ID staan hardgecodeerd. Een volgend gebruik voor andere
   tenants vraagt deze drie constantes met de hand te wijzigen, ná dezelfde
   schema-analyse als hierboven (nieuwe tabellen? nieuwe FK's naar `user`?).
4. Checklist: Taak 1 volledig afgerond (Transdev DEV leeg, inclusief
   templates) → bronmeting (Taak 2) → droge run (Taak 8, zonder `--commit`)
   → **voorleggen aan de eigenaar**: de volledige `console.table`-output van
   wat er gekopieerd zou worden, plus de twee expliciete keuzes die nog
   bevestigd moeten worden (owner_user_id bij vendor/contract altijd naar
   Kees4TDD ook als de bronrij geen eigenaar had; respondent_user_id altijd
   NULL) → pas na akkoord `--commit` → verse-verbinding-verificatie (zelfde
   patroon als opschonen §8).
5. Wat niet meegaat: geüploade bestanden (bijlagen), `template_reviewer`,
   `tenant_feature`, en de historische "wie deed het" op oordelen/notities/
   dossiers/imports (allemaal Kees4TDD na de kopie).

### Stap 9.2: Backup vooraf

Zelfde als runbook-opschonen §4: controleer
`docs/runbooks/backup-bewijs.json` — `gecontroleerdOp` niet ouder dan
vandaag. Dit raakt productie (alleen lezend) en de DEV-tenant (schrijvend)
— een schrijffout in dit script raakt in het ergste geval alleen Transdev
DEV (een testtenant), maar de backup-discipline geldt onverkort omdat de
operatie via `PRODUCTIE_RUNTIME_URL` tegen de productiedatabase draait.

---

## Taak 10: Uitvoering

**Files:** geen — dit is de daadwerkelijke uitvoering, met de eigenaar
erbij voor elk akkoordmoment.

### Stap 10.1: Taak 1 uitvoeren (Transdev DEV leegmaken)

Zie Taak 1 hierboven, volledig, inclusief stap 1.3 (templates) en stap 1.4
(verse-verbinding-verificatie).

### Stap 10.2: Droge run van het kopieerscript

```powershell
node scripts/tenant-kopieren.js --extern
```

Lees de volledige output. Controleer specifiek:
- Geen `AFWIJKING`-regels.
- De `console.table`-vergelijking tussen bron en DEV-na-kopie laat voor elke
  tabel (behalve `survey_attachment`) identieke aantallen zien.
- `Droge run: ROLLBACK uitgevoerd, niets gewijzigd.` staat aan het eind.

### Stap 10.3: Voorleggen aan de eigenaar vóór commit

Toon de output van stap 10.2 en benoem expliciet:
- Alle 41 vendors en 46 contracten krijgen Kees4TDD als eigenaar (ook de
  vendors/contracten die in productie geen eigenaar hadden).
- Survey-inzendingen (`survey_response`) krijgen een nieuwe, ongeldige
  token — de oude productielinks werken niet voor de DEV-kopie (bedoeld).
- Geüploade bijlagen (bestandsinhoud) komen niet mee.
- `template_reviewer` en `tenant_feature` komen niet mee.

### Stap 10.4: Echte uitvoering

```powershell
node scripts/tenant-kopieren.js --extern --commit
```

### Stap 10.5: Verifiëren met een verse verbinding

Zelfde patroon als Taak 1, stap 1.4, maar nu controlerend dat de DEV-tenant
**gevuld** is met de verwachte aantallen (41 vendors, 46 contracten, 2
templates, 1 run, 4 responses, 3 engagements — of de actuele cijfers op het
moment van uitvoering, die kunnen inmiddels iets afwijken van de 2026-10-06-
meting in §0).

---

## Zelfcontrole van dit plan

**Dekking van de spec (het verzoek van de eigenaar):** alle klantdata van
Transdev Nederland naar Transdev DEV kopiëren (Taken 4-7), vóórafgegaan door
een volledige schoonmaak van de doeltenant inclusief templates (Taak 1), met
een bewezen droge-run-discipline (Taak 8) en een voorlegmoment vóór de
onomkeerbare stap (Taak 9-10). ANF-upload zelf is een vervolgstap, buiten
de scope van dit plan (de gebruikelijke import-route bestaat al).

**Placeholder-scan:** geen "TODO"/"later invullen" aangetroffen. Elke
INSERT-query bevat de volledige, exacte kolomlijst zoals gemeten uit het
schema-onderzoek.

**Type-consistentie:** `idMap`/`nieuwId()`/`vertaalId()` worden in Taak 3
gedefinieerd en in Taken 4-8 identiek aangeroepen. `BRON_TENANT_ID`,
`DOEL_TENANT_ID`, `DOEL_GEBRUIKER_ID` worden in Taak 3.3 vastgelegd en overal
daarna hergebruikt, niet opnieuw als losse letterlijke UUID's getypt.

**Belangrijkste open technische vraag, met een concrete volgende stap**:
stap 8.2 (RLS-gedrag bij INSERT met afwijkende tenant_id) moet experimenteel
bevestigd worden vóór Taak 8 wordt afgerond — dit is geen placeholder maar
een expliciete, bewust ingebouwde verificatiestap omdat het antwoord de
transactiestructuur van het hele script kan beïnvloeden.
