# Runbook — Transdev Nederland naar Transdev DEV kopiëren

**Type:** A — eenmalige databasehandeling, onomkeerbaar
**Eigenaar:** de eigenaar (Chris)
**Laatste update:** 2026-10-07
**Vereiste toegang:** `PRODUCTIE_RUNTIME_URL` én `NOOD_PRODUCTIE_URL` in `.env`, Node
**Duur:** een uur, waarvan leegmaken en droge runs het meeste kosten

> **Uitgevoerd op 2026-10-07.** Transdev DEV bevat sindsdien een kopie van
> Transdev Nederland zonder rondes en uitnodigingen, als basis voor de
> ANF-MVP. Ontwerp en schema-analyse:
> `docs/superpowers/plans/2026-10-06-tenant-kopieren-transdev-nl-naar-dev.md`.

---

## Dit is GEEN generiek kopieerhulpmiddel

`scripts/tenant-kopieren.js` heeft drie hardgecodeerde constantes:
brontenant (Transdev Nederland), doeltenant (Transdev DEV) en één vaste
doelgebruiker (Kees4TDD, admin van Transdev DEV). Wie het voor andere
tenants wil gebruiken, wijzigt die drie met de hand, ná een nieuwe
schema-analyse: nieuwe tabellen met tenantdata, nieuwe FK's naar `user`,
nieuwe RLS-policies met een extra voorwaarde in `WITH CHECK`.

---

## Wat er wel en niet meegaat

**Wel:** `ref.vendor_category`, `survey_template`/`category`/`question`,
`vendor` met `vendor_contact`/`vendor_tag`/`vendor_compliance_thema`,
`contract` (inclusief `beheer`), `clm.werkingsgebied` met
`clm.contract_werkingsgebied` (sinds migratie 0046, #234), `vendor_engagement`
met `vendor_engagement_note`, en dossierkoppelingen
(`vendor_engagement_link`) van het type `contract`.

**Niet:**

| Wat | Waarom |
|---|---|
| `survey_run`, `survey_response`, `survey_answer`, `survey_review`, `response_note`, en koppelingen naar een inzending | Besluit eigenaar 07-10: DEV is een experimenteerplek; echte leveranciersuitnodigingen daarin geven verwarring met de echte klantomgeving |
| `survey_attachment`, `vendor_engagement_attachment` | De bestanden staan op de ECS-container, niet in de database, en zijn van de werkmachine niet bereikbaar (zie `tenant-opschonen.md` §7) |
| `template_reviewer`, `tenant_feature` | Inrichting, geen klantdata |
| `audit.audit_event` | Het auditspoor hoort bij de tenant waar het gebeurde |

**Gebruikersverwijzingen:** NOT NULL-velden (`vendor_engagement.
created_by_user_id`, `vendor_engagement_note.created_by_user_id`) worden
Kees4TDD. `vendor.owner_user_id` en `contract.owner_user_id` blijven `NULL`
als ze in de bron `NULL` waren — "geen contractmanager" moet zichtbaar
blijven (issue #192). Een gevulde eigenaar wordt Kees4TDD.

**Elke primary key** krijgt een nieuw UUID; het script houdt een
vertaaltabel oud→nieuw bij voor alle foreign keys.

---

## Waarom het script werkt zoals het werkt

1. **Twee fasen in één transactie.** RLS weigert een INSERT met een andere
   `tenant_id` dan `app.current_tenant_id`. Daarom eerst alles lezen met
   context = bron, dan context wisselen naar doel, dan schrijven. Geverifieerd
   op een wegwerpcontainer.
2. **Alleen INSERT.** Het script bevat geen UPDATE, DELETE, TRUNCATE, ALTER
   of DROP. Daardoor is geen SECURITY DEFINER-functie nodig (anders dan bij
   opschonen) en kan de bron niet gewijzigd worden.
3. **Controle vóór commit.** Het script telt de doeltenant na de kopie
   tegen een verwachting (gekopieerde tabellen gelijk aan de bron, uitgesloten
   tabellen 0) en telt de bron opnieuw. Eén afwijking → gedwongen ROLLBACK.
4. **Tellen altijd mét tenant- én actorcontext.** Zonder context geeft FORCE
   RLS 0 rijen — ook voor `clm_migrator`, ook met een expliciete `WHERE`.
   Deze fout zat tot 07-10 in `tellenBuitenClm()` van
   `tenant-opschonen.js` en gaf daar elke droge run een vals alarm.

---

## Stap 1 — Transdev DEV volledig leegmaken

### 1.1 — Opschoonscript, droge run en daarna echt

```powershell
node scripts/tenant-opschonen.js --tenant-id c0fe1d30-e785-4dcd-bdf2-0740e95bdd61 --extern
node scripts/tenant-opschonen.js --tenant-id c0fe1d30-e785-4dcd-bdf2-0740e95bdd61 --extern --commit
```

Leg vóór de commit aan de eigenaar voor: openstaande uitnodigingen (krijgen
die leveranciers straks een foutmelding?) en geüploade bestanden (blijven als
wees op de container).

### 1.2 — Vragenlijsten apart weghalen

Het opschoonscript laat `survey_template`/`category`/`question` bewust
staan. Hier moeten ze weg. **Alle drie de FK's zijn RESTRICT** (gemeten
07-10 op productie — níet CASCADE), dus in deze volgorde, en pas ná een
volledige stap 1.1 (`survey_run.template_id` is ook RESTRICT):

```js
require('dotenv/config');
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.PRODUCTIE_RUNTIME_URL });
  await c.connect();
  await c.query('BEGIN');
  await c.query(`SELECT set_config('app.current_tenant_id', 'c0fe1d30-e785-4dcd-bdf2-0740e95bdd61', true)`);
  await c.query(`SELECT set_config('app.current_actor', 'medewerker', true)`);
  for (const t of ['survey_question', 'survey_category', 'survey_template']) {
    console.log(t, (await c.query(`DELETE FROM clm.${t}`)).rowCount);
  }
  const { rows } = await c.query(`
    SELECT (SELECT count(*) FROM clm.survey_template) AS t,
           (SELECT count(*) FROM clm.survey_category) AS c,
           (SELECT count(*) FROM clm.survey_question) AS q`);
  if (Object.values(rows[0]).some((n) => Number(n) !== 0)) await c.query('ROLLBACK');
  else await c.query('COMMIT');
  console.log(rows[0]);
  await c.end();
})();
```

### 1.3 — Verifiëren met een verse verbinding

Tel de kerntabellen van Transdev DEV met tenant- én actorcontext. Verwacht:
overal 0. Controleer ook dat het actieve admin-lidmaatschap er nog is (ook
die telling mét context — zonder context krijg je 0 en een vals alarm).

---

## Stap 2 — Kopiëren

```powershell
node scripts/tenant-kopieren.js --extern            # droge run
node scripts/tenant-kopieren.js --extern --commit   # echt, na akkoord
```

Het script weigert te starten als de doeltenant niet leeg is. Leg de
controletabel uit de droge run voor aan de eigenaar, inclusief wat niet
meegaat en wie eigenaar wordt.

## Stap 3 — Verifiëren met een verse verbinding

Tel beide tenants opnieuw, los van het script. De bron moet exact gelijk
zijn aan de bronmeting; de doeltenant gelijk aan de kolom "verwacht". Neem
een inhoudelijke steekproef (contract → leverancier → contactpersoon, dossier
→ notitie) in beide tenants naast elkaar.

---

## Uitvoering 2026-10-07 — resultaat

| | Transdev Nederland | Transdev DEV |
|---|---|---|
| vendor / vendor_contact | 41 / 49 | 41 / 49 |
| contract | 46 | 46 |
| survey_template / survey_question | 2 / 38 | 2 / 38 |
| vendor_engagement / note | 3 / 3 | 3 / 3 |
| ref.vendor_category | 7 | 7 |
| survey_run / survey_response | 1 / 4 | 0 / 0 |
| bijlagen (survey + dossier) | 1 + 3 | 0 |

Alle 41 vendors en 46 contracten hadden in de bron geen contractmanager en
staan in DEV dus ook op "niet toegewezen". Achtergebleven als wees op de
container: het ISO27001-bestand (KIWA) uit de oude inhoud van Transdev DEV.

---

## Checklist

- [ ] Backup van vandaag gecontroleerd (`docs/runbooks/backup-bewijs.json`)
- [ ] Stap 1.1 — opschonen: droge run groen, voorgelegd, commit
- [ ] Stap 1.2 — vragenlijsten weg in de volgorde vraag → categorie → template
- [ ] Stap 1.3 — verse verificatie, mét context
- [ ] Stap 2 — droge run groen, voorgelegd, commit
- [ ] Stap 3 — verse verificatie van beide tenants plus inhoudelijke steekproef
