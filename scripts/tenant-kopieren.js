#!/usr/bin/env node
'use strict';

/**
 * Kopieert de klantdata van Transdev Nederland naar Transdev DEV, ZONDER
 * vragenlijstrondes en uitnodigingen. Zie `docs/runbooks/tenant-kopieren.md`
 * en `docs/superpowers/plans/2026-10-06-tenant-kopieren-transdev-nl-naar-dev.md`.
 *
 * ── Dit is GEEN generiek script ──────────────────────────────────────────────
 *
 * De drie ID's hieronder (bron, doel, doelgebruiker) zijn hardgecodeerd voor
 * deze ene, eenmalige operatie — zelfde designkeuze als
 * `scripts/tenant-opschonen.js`. Een volgend gebruik vraagt deze constantes
 * met de hand te wijzigen, ná een nieuwe schema-analyse.
 *
 * ── Wat wel en niet meegaat ──────────────────────────────────────────────────
 *
 * Wel: vendor-categorieën, vragenlijsten (template/categorie/vraag), vendors
 * met contacten/tags/compliance-thema's, contracten, dossiers met notities,
 * en dossierkoppelingen naar contracten.
 *
 * Niet (besluit eigenaar 2026-10-07): vragenlijstrondes, uitnodigingen en
 * alles wat daaraan hangt (antwoorden, oordelen, notities bij inzendingen),
 * plus dossierkoppelingen naar een inzending. Transdev DEV is een
 * experimenteerplek; echte leveranciersuitnodigingen daarin geven verwarring
 * met de echte klantomgeving.
 *
 * Ook niet: geüploade bestanden (survey_attachment, vendor_engagement_
 * attachment — de inhoud staat op de ECS-container, niet in de database),
 * template_reviewer en tenant_feature (inrichting), audit.audit_event.
 *
 * ── Twee fasen binnen één transactie ─────────────────────────────────────────
 *
 * RLS weigert een INSERT met een andere tenant_id dan de sessiecontext
 * (geverifieerd 2026-10-06). Daarom eerst alles lezen met context = bron,
 * dan de context wisselen naar doel en pas dan schrijven.
 *
 * ── Gebruik ──────────────────────────────────────────────────────────────────
 *
 *   node scripts/tenant-kopieren.js --extern            # droge run
 *   node scripts/tenant-kopieren.js --extern --commit   # echt
 */

require('dotenv/config');

const { randomUUID } = require('node:crypto');

const { Client } = require('pg');

const { meldDoelwit, eisToestemmingBuitenLokaal } = require('./db-doelwit');

const BRON_TENANT_ID = '4afcb659-63a8-4b16-8a0c-76d2a2d8676e'; // Transdev Nederland
const DOEL_TENANT_ID = 'c0fe1d30-e785-4dcd-bdf2-0740e95bdd61'; // Transdev DEV
const DOEL_GEBRUIKER_ID = 'a1994ff4-f145-4c85-acd0-c6fd77ed0986'; // Kees4TDD, admin van Transdev DEV

// ── ID-vertaling: oud UUID (bron) -> nieuw UUID (doel) ───────────────────────
const idMap = new Map();

function nieuwId(oudId) {
  if (idMap.has(oudId)) {
    throw new Error(
      `nieuwId() aangeroepen voor een al bestaand oud ID: ${oudId}`,
    );
  }
  const nieuw = randomUUID();
  idMap.set(oudId, nieuw);
  return nieuw;
}

function vertaalId(oudId) {
  if (oudId === null || oudId === undefined) return null;
  const nieuw = idMap.get(oudId);
  if (!nieuw) {
    throw new Error(
      `Geen vertaling bekend voor ID ${oudId} — kopieer de bronrij vóór de rij die ernaar verwijst.`,
    );
  }
  return nieuw;
}

// Tabellen die 1-op-1 meegaan: na de kopie moet de doeltelling gelijk zijn
// aan de brontelling.
const GEKOPIEERD = [
  'survey_template',
  'survey_category',
  'survey_question',
  'vendor',
  'vendor_contact',
  'vendor_tag',
  'vendor_compliance_thema',
  'contract',
  'vendor_engagement',
  'vendor_engagement_note',
];

// Tabellen die bewust NIET meegaan: in de doeltenant moeten ze 0 blijven.
const NIET_GEKOPIEERD = [
  'survey_run',
  'survey_response',
  'survey_answer',
  'survey_review',
  'response_note',
  'survey_attachment',
  'vendor_engagement_attachment',
];

async function zetContext(apiClient, tenantId) {
  await apiClient.query(
    `SELECT set_config('app.current_tenant_id', $1, true)`,
    [tenantId],
  );
  await apiClient.query(
    `SELECT set_config('app.current_actor', 'medewerker', true)`,
  );
}

// Altijd mét context: zonder context geeft RLS 0 (FORCE RLS), ook bij een
// expliciete WHERE — zie memory mcm2-nul-rijen-is-geen-bevinding.
async function telling(apiClient, tenantId) {
  await zetContext(apiClient, tenantId);
  const tellingen = {};
  for (const tabel of [...GEKOPIEERD, ...NIET_GEKOPIEERD]) {
    const { rows } = await apiClient.query(`SELECT count(*) FROM clm.${tabel}`);
    tellingen[tabel] = Number(rows[0].count);
  }
  const { rows: links } = await apiClient.query(
    `SELECT count(*) FILTER (WHERE link_type = 'contract') AS contract,
            count(*) FILTER (WHERE link_type <> 'contract') AS overig
       FROM clm.vendor_engagement_link`,
  );
  tellingen['vendor_engagement_link (contract)'] = Number(links[0].contract);
  tellingen['vendor_engagement_link (overig)'] = Number(links[0].overig);
  const { rows: cat } = await apiClient.query(
    `SELECT count(*) FROM ref.vendor_category WHERE tenant_id = $1`,
    [tenantId],
  );
  tellingen['ref.vendor_category'] = Number(cat[0].count);
  return tellingen;
}

// ── Fase 1: lezen, context = BRON_TENANT_ID ──────────────────────────────────

async function lees(apiClient, sql) {
  return (await apiClient.query(sql, [BRON_TENANT_ID])).rows;
}

async function leesAlles(apiClient) {
  return {
    vendorCategorie: await lees(
      apiClient,
      `SELECT code, label FROM ref.vendor_category WHERE tenant_id = $1`,
    ),
    templates: await lees(
      apiClient,
      `SELECT template_id, name, version, created_at
         FROM clm.survey_template WHERE tenant_id = $1 ORDER BY created_at`,
    ),
    categories: await lees(
      apiClient,
      `SELECT category_id, template_id, position, name, min_answers, created_at
         FROM clm.survey_category WHERE tenant_id = $1 ORDER BY template_id, position`,
    ),
    questions: await lees(
      apiClient,
      `SELECT question_id, template_id, category_id, position, question_key, title, body,
              answer_type, config, is_required, allows_upload, max_files, created_at
         FROM clm.survey_question WHERE tenant_id = $1 ORDER BY template_id, position`,
    ),
    vendors: await lees(
      apiClient,
      `SELECT vendor_id, name, kvk_number, vestigingsnummer, statutory_name, trade_names,
              legal_form, incorporation_date, sbi_code, sbi_description, category_code,
              business_criticality_code, compliance_status_code, country, city, website,
              annual_spend_eur, risk_score, owner_user_id, last_review_date, next_review_date,
              coupa_supplier_number, created_at, updated_at, deleted_at
         FROM clm.vendor WHERE tenant_id = $1 ORDER BY created_at`,
    ),
    vendorContacten: await lees(
      apiClient,
      `SELECT contact_id, vendor_id, full_name, email, phone, job_title, role_description,
              is_primary, created_at, updated_at, deleted_at
         FROM clm.vendor_contact WHERE tenant_id = $1 ORDER BY created_at`,
    ),
    vendorTags: await lees(
      apiClient,
      `SELECT vendor_id, tag, created_at FROM clm.vendor_tag WHERE tenant_id = $1`,
    ),
    vendorThemas: await lees(
      apiClient,
      `SELECT vendor_id, thema_code, created_at
         FROM clm.vendor_compliance_thema WHERE tenant_id = $1`,
    ),
    contracten: await lees(
      apiClient,
      `SELECT contract_id, vendor_id, name, contract_number, vendor_contact_id, owner_user_id,
              status_code, value_eur, start_date, end_date, note, contract_type, dpa_aanwezig,
              business_risk_tier_code, notice_period_days, warning_days_before, auto_renews,
              created_at, updated_at, deleted_at
         FROM clm.contract WHERE tenant_id = $1 ORDER BY created_at`,
    ),
    engagements: await lees(
      apiClient,
      `SELECT engagement_id, vendor_id, titel, created_at, deleted_at
         FROM clm.vendor_engagement WHERE tenant_id = $1 ORDER BY created_at`,
    ),
    engagementNotes: await lees(
      apiClient,
      `SELECT note_id, engagement_id, tekst, created_at, deleted_at
         FROM clm.vendor_engagement_note WHERE tenant_id = $1 ORDER BY created_at`,
    ),
    // Alleen koppelingen naar contracten: inzendingen gaan niet mee.
    engagementLinks: await lees(
      apiClient,
      `SELECT engagement_id, link_type, linked_id
         FROM clm.vendor_engagement_link
        WHERE tenant_id = $1 AND link_type = 'contract'`,
    ),
  };
}

// ── Fase 2: schrijven, context = DOEL_TENANT_ID ──────────────────────────────

async function schrijfVendorCategorie(apiClient, rijen) {
  for (const r of rijen) {
    await apiClient.query(
      `INSERT INTO ref.vendor_category (tenant_id, code, label) VALUES ($1, $2, $3)`,
      [DOEL_TENANT_ID, r.code, r.label],
    );
  }
}

async function schrijfTemplates(apiClient, templates, categories, questions) {
  for (const t of templates) {
    await apiClient.query(
      `INSERT INTO clm.survey_template (template_id, tenant_id, name, version, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [nieuwId(t.template_id), DOEL_TENANT_ID, t.name, t.version, t.created_at],
    );
  }
  for (const c of categories) {
    await apiClient.query(
      `INSERT INTO clm.survey_category
         (category_id, tenant_id, template_id, position, name, min_answers, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        nieuwId(c.category_id),
        DOEL_TENANT_ID,
        vertaalId(c.template_id),
        c.position,
        c.name,
        c.min_answers,
        c.created_at,
      ],
    );
  }
  for (const q of questions) {
    await apiClient.query(
      `INSERT INTO clm.survey_question
         (question_id, tenant_id, template_id, category_id, position, question_key, title, body,
          answer_type, config, is_required, allows_upload, max_files, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        nieuwId(q.question_id),
        DOEL_TENANT_ID,
        vertaalId(q.template_id),
        vertaalId(q.category_id),
        q.position,
        q.question_key,
        q.title,
        q.body,
        q.answer_type,
        q.config,
        q.is_required,
        q.allows_upload,
        q.max_files,
        q.created_at,
      ],
    );
  }
}

async function schrijfVendors(apiClient, vendors) {
  for (const v of vendors) {
    await apiClient.query(
      `INSERT INTO clm.vendor
         (vendor_id, tenant_id, name, kvk_number, vestigingsnummer, statutory_name, trade_names,
          legal_form, incorporation_date, sbi_code, sbi_description, category_code,
          business_criticality_code, compliance_status_code, country, city, website,
          annual_spend_eur, risk_score, owner_user_id, last_review_date, next_review_date,
          coupa_supplier_number, created_at, updated_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [
        nieuwId(v.vendor_id),
        DOEL_TENANT_ID,
        v.name,
        v.kvk_number,
        v.vestigingsnummer,
        v.statutory_name,
        v.trade_names,
        v.legal_form,
        v.incorporation_date,
        v.sbi_code,
        v.sbi_description,
        v.category_code,
        v.business_criticality_code,
        v.compliance_status_code,
        v.country,
        v.city,
        v.website,
        v.annual_spend_eur,
        v.risk_score,
        // NULL blijft NULL: "geen contractmanager" moet zichtbaar blijven
        // (besluit eigenaar 2026-10-06).
        v.owner_user_id === null ? null : DOEL_GEBRUIKER_ID,
        v.last_review_date,
        v.next_review_date,
        v.coupa_supplier_number,
        v.created_at,
        v.updated_at,
        v.deleted_at,
      ],
    );
  }
}

async function schrijfVendorBijlagen(apiClient, contacten, tags, themas) {
  for (const c of contacten) {
    await apiClient.query(
      `INSERT INTO clm.vendor_contact
         (contact_id, vendor_id, tenant_id, full_name, email, phone, job_title,
          role_description, is_primary, created_at, updated_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        nieuwId(c.contact_id),
        vertaalId(c.vendor_id),
        DOEL_TENANT_ID,
        c.full_name,
        c.email,
        c.phone,
        c.job_title,
        c.role_description,
        c.is_primary,
        c.created_at,
        c.updated_at,
        c.deleted_at,
      ],
    );
  }
  for (const t of tags) {
    await apiClient.query(
      `INSERT INTO clm.vendor_tag (vendor_id, tenant_id, tag, created_at) VALUES ($1, $2, $3, $4)`,
      [vertaalId(t.vendor_id), DOEL_TENANT_ID, t.tag, t.created_at],
    );
  }
  for (const t of themas) {
    await apiClient.query(
      `INSERT INTO clm.vendor_compliance_thema (vendor_id, tenant_id, thema_code, created_at)
       VALUES ($1, $2, $3, $4)`,
      [vertaalId(t.vendor_id), DOEL_TENANT_ID, t.thema_code, t.created_at],
    );
  }
}

async function schrijfContracten(apiClient, contracten) {
  for (const c of contracten) {
    await apiClient.query(
      `INSERT INTO clm.contract
         (contract_id, tenant_id, vendor_id, name, contract_number, vendor_contact_id,
          owner_user_id, status_code, value_eur, start_date, end_date, note, contract_type,
          dpa_aanwezig, business_risk_tier_code, notice_period_days, warning_days_before,
          auto_renews, created_at, updated_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        nieuwId(c.contract_id),
        DOEL_TENANT_ID,
        vertaalId(c.vendor_id),
        c.name,
        c.contract_number,
        vertaalId(c.vendor_contact_id),
        c.owner_user_id === null ? null : DOEL_GEBRUIKER_ID,
        c.status_code,
        c.value_eur,
        c.start_date,
        c.end_date,
        c.note,
        c.contract_type,
        c.dpa_aanwezig,
        c.business_risk_tier_code,
        c.notice_period_days,
        c.warning_days_before,
        c.auto_renews,
        c.created_at,
        c.updated_at,
        c.deleted_at,
      ],
    );
  }
}

async function schrijfDossiers(apiClient, engagements, notes, links) {
  for (const e of engagements) {
    await apiClient.query(
      `INSERT INTO clm.vendor_engagement
         (engagement_id, tenant_id, vendor_id, titel, created_by_user_id, created_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        nieuwId(e.engagement_id),
        DOEL_TENANT_ID,
        vertaalId(e.vendor_id),
        e.titel,
        DOEL_GEBRUIKER_ID,
        e.created_at,
        e.deleted_at,
      ],
    );
  }
  for (const n of notes) {
    await apiClient.query(
      `INSERT INTO clm.vendor_engagement_note
         (note_id, engagement_id, tenant_id, tekst, created_by_user_id, created_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        randomUUID(),
        vertaalId(n.engagement_id),
        DOEL_TENANT_ID,
        n.tekst,
        DOEL_GEBRUIKER_ID,
        n.created_at,
        n.deleted_at,
      ],
    );
  }
  for (const l of links) {
    await apiClient.query(
      `INSERT INTO clm.vendor_engagement_link (link_id, engagement_id, tenant_id, link_type, linked_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        randomUUID(),
        vertaalId(l.engagement_id),
        DOEL_TENANT_ID,
        l.link_type,
        vertaalId(l.linked_id),
      ],
    );
  }
}

async function tenantNaamOpzoeken(migratorClient, tenantId) {
  const { rows } = await migratorClient.query(
    `SELECT name FROM clm.tenant_register WHERE register_id = $1`,
    [tenantId],
  );
  return rows[0]?.name ?? null;
}

/** Wat er na de kopie in de doeltenant hoort te staan, afgeleid van de bron. */
function verwachtNaKopie(bron) {
  const verwacht = {};
  for (const tabel of GEKOPIEERD) verwacht[tabel] = bron[tabel];
  for (const tabel of NIET_GEKOPIEERD) verwacht[tabel] = 0;
  verwacht['vendor_engagement_link (contract)'] =
    bron['vendor_engagement_link (contract)'];
  verwacht['vendor_engagement_link (overig)'] = 0;
  verwacht['ref.vendor_category'] = bron['ref.vendor_category'];
  return verwacht;
}

async function main() {
  const commit = process.argv.includes('--commit');

  const migratorUrl = process.env.NOOD_PRODUCTIE_URL;
  const apiUrl = process.env.PRODUCTIE_RUNTIME_URL;
  if (!migratorUrl || !apiUrl) {
    console.error(
      '\nNOOD_PRODUCTIE_URL en PRODUCTIE_RUNTIME_URL moeten beide in .env staan.\n',
    );
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
      throw new Error(
        `PRODUCTIE_RUNTIME_URL verbindt als '${rolApi[0].current_user}', verwacht clm_api_runtime.`,
      );
    }

    const bronNaam = await tenantNaamOpzoeken(migratorClient, BRON_TENANT_ID);
    const doelNaam = await tenantNaamOpzoeken(migratorClient, DOEL_TENANT_ID);
    if (!bronNaam)
      throw new Error(`Brontenant ${BRON_TENANT_ID} niet gevonden.`);
    if (!doelNaam)
      throw new Error(`Doeltenant ${DOEL_TENANT_ID} niet gevonden.`);
    console.log(`\nBron: ${bronNaam} (${BRON_TENANT_ID})`);
    console.log(`Doel: ${doelNaam} (${DOEL_TENANT_ID})\n`);

    // ── Vooraf: de doeltenant moet leeg zijn ────────────────────────────────
    await apiClient.query('BEGIN');
    const doelVoor = await telling(apiClient, DOEL_TENANT_ID);
    await apiClient.query('ROLLBACK');
    const nietLeeg = Object.entries(doelVoor).filter(([, n]) => n !== 0);
    if (nietLeeg.length > 0) {
      throw new Error(
        `${doelNaam} is niet leeg — eerst opschonen (runbook stap 1). ` +
          `Niet-leeg: ${nietLeeg.map(([t, n]) => `${t}=${n}`).join(', ')}`,
      );
    }
    console.log(`${doelNaam} is bevestigd leeg.\n`);

    await apiClient.query('BEGIN');

    // ── Fase 1: lezen ────────────────────────────────────────────────────────
    console.log(`=== Bronmeting: ${bronNaam} ===`);
    const bronTelling = await telling(apiClient, BRON_TENANT_ID);
    console.table(bronTelling);
    const bron = await leesAlles(apiClient);

    // ── Fase 2: schrijven ────────────────────────────────────────────────────
    console.log(
      `\n=== ${commit ? 'ECHTE UITVOERING' : 'DROGE RUN'}: schrijven naar ${doelNaam} ===`,
    );
    await zetContext(apiClient, DOEL_TENANT_ID);
    await schrijfVendorCategorie(apiClient, bron.vendorCategorie);
    await schrijfTemplates(
      apiClient,
      bron.templates,
      bron.categories,
      bron.questions,
    );
    await schrijfVendors(apiClient, bron.vendors);
    await schrijfVendorBijlagen(
      apiClient,
      bron.vendorContacten,
      bron.vendorTags,
      bron.vendorThemas,
    );
    await schrijfContracten(apiClient, bron.contracten);
    await schrijfDossiers(
      apiClient,
      bron.engagements,
      bron.engagementNotes,
      bron.engagementLinks,
    );

    // ── Controle binnen de transactie ────────────────────────────────────────
    const naTelling = await telling(apiClient, DOEL_TENANT_ID);
    const verwacht = verwachtNaKopie(bronTelling);
    const vergelijking = {};
    let afwijking = false;
    for (const sleutel of Object.keys(verwacht)) {
      const klopt = naTelling[sleutel] === verwacht[sleutel];
      vergelijking[sleutel] = {
        bron: bronTelling[sleutel],
        verwacht: verwacht[sleutel],
        doel: naTelling[sleutel],
        klopt: klopt ? 'ja' : 'NEE',
      };
      if (!klopt) afwijking = true;
    }
    console.log(`\n=== Controle: ${doelNaam} na de kopie ===`);
    console.table(vergelijking);

    // De bron mag niet veranderd zijn (alleen gelezen, maar toch controleren).
    const bronNa = await telling(apiClient, BRON_TENANT_ID);
    for (const sleutel of Object.keys(bronTelling)) {
      if (bronNa[sleutel] !== bronTelling[sleutel]) {
        console.error(
          `AFWIJKING BRON: ${sleutel} was ${bronTelling[sleutel]}, is nu ${bronNa[sleutel]}`,
        );
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
      console.log(
        '\nGeen afwijking. Droge run: ROLLBACK uitgevoerd, niets gewijzigd.',
      );
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
