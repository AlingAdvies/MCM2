#!/usr/bin/env node
'use strict';

/**
 * Maakt één tenant leeg zonder de andere te raken. Zie
 * `docs/runbooks/tenant-opschonen.md` voor de volledige uitleg van waarom
 * elke stap hier staat zoals hij staat.
 *
 * ── Dit is geen generiek script ──────────────────────────────────────────────
 *
 * De tabellenlijst en de volgorde hieronder zijn NIET automatisch afgeleid uit
 * de foreign-key-graaf. Ze zijn de letterlijke, hardgecodeerde herhaling van
 * wat op 2026-09-25 daadwerkelijk tegen de Transdev-tenant is uitgevoerd en
 * bewezen — inclusief de drie fouten die pas na expliciet doorvragen aan het
 * licht kwamen (ontbrekende importgeschiedenis-tabellen, ontbrekende tabellen
 * buiten schema clm, geüploade bestanden die niet in de database blijken te
 * staan). Een eerdere versie van dit script probeerde de volgorde automatisch
 * te bepalen uit de FK-graaf — dat introduceerde een NIEUWE bug (een verkeerde
 * volgorde tussen segmenten) in plaats van het beproefde proces te herhalen.
 * Vandaar deze bewust simpele vorm: vaste lijst, vaste volgorde, geen
 * algoritme dat opnieuw fout kan gaan.
 *
 * **Komt er een nieuwe tabel bij die tenant-data bevat?** Werk deze lijst dan
 * met de hand bij, aan de hand van de drie zoekopdrachten in runbook §2 — en
 * voeg de uitkomst hier hardgecodeerd toe, niet als automatische afleiding.
 *
 * ── Twee rollen, en waarom dat niet te vermijden is ──────────────────────────
 *
 * clm_api_runtime is nooit tabel-eigenaar, dus RLS geldt voor die rol altijd
 * — ook op de vier tabellen zonder FORCE ROW LEVEL SECURITY. clm_migrator IS
 * eigenaar en mist daar de RLS-bescherming: een DELETE via die rol zonder
 * tenantcontext raakt alle tenants. Tegelijk mist clm_api_runtime bewust
 * DELETE op vijf tabellen (audit-bewijs, dossiers). SET ROLE tussen beide is
 * geweigerd (geverifieerd 2026-09-25, geen membership-relatie), en twee losse
 * connecties delen geen transactie. De enige weg die overblijft: twee
 * tijdelijke SECURITY DEFINER-functies, eigendom clm_migrator, met tenant_id
 * afgedwongen in de SQL-body — zelfde patroon als clm.resolve_survey_token()
 * (migratie 0003).
 *
 * ── Wat dit script NIET doet ─────────────────────────────────────────────────
 *
 * Geen tenant aanmaken — zie scripts/tenant-aanmaken.js daarvoor. Geen
 * verwijdering van geüploade bestanden op de container: dat kan vanaf deze
 * machine niet (geen AWS-credentials, ECS Exec nergens ingeschakeld), zie
 * runbook §7. Het script toont ze wel, als laatste waarschuwing vóór de
 * echte uitvoering.
 *
 * ── Gebruik ──────────────────────────────────────────────────────────────────
 *
 *   node scripts/tenant-opschonen.js --tenant-id <uuid> --extern
 *
 *   # Droge run (standaard): telt, verwijdert binnen een transactie, telt
 *   # opnieuw, en rolt terug. Niets wordt gewijzigd.
 *
 *   node scripts/tenant-opschonen.js --tenant-id <uuid> --extern --commit
 *
 *   # Echte uitvoering: alleen als de droge run hierboven al groen was.
 *
 * Verwacht `PRODUCTIE_RUNTIME_URL` (clm_api_runtime) en `NOOD_PRODUCTIE_URL`
 * (clm_migrator) in `.env`. `--extern` is vereist zodra het doelwit niet
 * lokaal is — dezelfde vlag als overal elders in dit project.
 */

require('dotenv/config');

const { Client } = require('pg');

const { meldDoelwit, eisToestemmingBuitenLokaal } = require('./db-doelwit');

function leesArgument(naam) {
  const index = process.argv.indexOf(`--${naam}`);
  if (index === -1 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── De vaste, bewezen tabellenlijst — zie runbook §2 en §5 ──────────────────
//
// Volgorde binnen elke lijst is de volgorde waarin de DELETE's daadwerkelijk
// zijn uitgevoerd op 2026-09-25.

// Stap 1: bladeren van survey_response die clm_api_runtime WEL mag
// verwijderen, plus een koppeltabel zonder echte foreign key (linked_id kan
// niet naar twee mogelijke doeltabellen tegelijk verwijzen — migratie 0041).
const VIA_API_VOOR_FUNCTIE = ['survey_answer', 'survey_attachment', 'vendor_engagement_link'];

// Stap 2: clm_api_runtime mist hier bewust DELETE (audit-bewijs, dossiers).
// Moet vóór survey_response/vendor, want deze verwijzen ernaar.
const VIA_FUNCTIE = ['survey_review', 'response_note', 'vendor_engagement', 'import_job', 'contract'];

// Stap 3: de rest, weer via clm_api_runtime. contract_survey_template staat
// hier NIET in — die verdwijnt vanzelf via CASCADE zodra contract weg is.
const VIA_API_NA_FUNCTIE = [
  'survey_response', 'survey_run',
  'vendor_contact', 'vendor_tag', 'vendor_compliance_thema', 'vendor',
];

// Alleen ter controle: geen eigen DELETE, moeten na de operatie op 0 staan.
const ALLEEN_CONTROLEREN = ['contract_survey_template', 'import_row', 'import_extra_contact'];

// Stap 4: buiten schema clm. ref.vendor_category moet ná vendor (verwijzing
// vendor.category_code) — vandaar een tweede functie, ná de vendor-delete.
const BUITEN_CLM = [
  ['audit', 'audit_event'],
  ['ref', 'vendor_category'],
];

const ALLE_TABELLEN = [
  ...VIA_API_VOOR_FUNCTIE,
  ...VIA_FUNCTIE,
  ...VIA_API_NA_FUNCTIE,
  ...ALLEEN_CONTROLEREN,
];

async function tenantNaamOpzoeken(migratorClient, tenantId) {
  const { rows } = await migratorClient.query(
    `SELECT name FROM clm.tenant_register WHERE register_id = $1`,
    [tenantId],
  );
  return rows[0]?.name ?? null;
}

async function alleTenants(migratorClient) {
  const { rows } = await migratorClient.query(
    `SELECT register_id, name FROM clm.tenant_register ORDER BY name`,
  );
  return rows;
}

/** Stap 1 van het runbook: alleen SELECT, altijd met tenant- én actor-context. */
async function tellenViaApi(apiClient, tenantId) {
  await apiClient.query('BEGIN');
  await apiClient.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
  await apiClient.query(`SELECT set_config('app.current_actor', 'medewerker', true)`);
  const tellingen = {};
  for (const tabel of [...VIA_API_VOOR_FUNCTIE, ...VIA_API_NA_FUNCTIE, ...ALLEEN_CONTROLEREN]) {
    const { rows } = await apiClient.query(`SELECT count(*) FROM clm.${tabel}`);
    tellingen[tabel] = Number(rows[0].count);
  }
  await apiClient.query('ROLLBACK');
  return tellingen;
}

/** VIA_FUNCTIE-tabellen hebben FORCE RLS aan — clm_migrator mag hier ook tellen. */
async function tellenViaMigrator(migratorClient, tenantId) {
  await migratorClient.query('BEGIN');
  await migratorClient.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
  await migratorClient.query(`SELECT set_config('app.current_actor', 'medewerker', true)`);
  const tellingen = {};
  for (const tabel of VIA_FUNCTIE) {
    const { rows } = await migratorClient.query(`SELECT count(*) FROM clm.${tabel}`);
    tellingen[tabel] = Number(rows[0].count);
  }
  await migratorClient.query('ROLLBACK');
  return tellingen;
}

async function tellenBuitenClm(migratorClient, tenantId) {
  const tellingen = {};
  for (const [schema, tabel] of BUITEN_CLM) {
    const { rows } = await migratorClient.query(
      `SELECT count(*) FROM ${schema}.${tabel} WHERE tenant_id = $1`,
      [tenantId],
    );
    tellingen[`${schema}.${tabel}`] = Number(rows[0].count);
  }
  return tellingen;
}

async function volledigeTelling(apiClient, migratorClient, tenantId) {
  return {
    ...(await tellenViaApi(apiClient, tenantId)),
    ...(await tellenViaMigrator(migratorClient, tenantId)),
    ...(await tellenBuitenClm(migratorClient, tenantId)),
  };
}

async function main() {
  const tenantId = leesArgument('tenant-id');
  const commit = process.argv.includes('--commit');

  if (!tenantId || !UUID_REGEX.test(tenantId)) {
    console.error('\nGebruik: node scripts/tenant-opschonen.js --tenant-id <uuid> [--extern] [--commit]\n');
    process.exitCode = 1;
    return;
  }

  const migratorUrl = process.env.NOOD_PRODUCTIE_URL;
  const apiUrl = process.env.PRODUCTIE_RUNTIME_URL;

  if (!migratorUrl || !apiUrl) {
    console.error('\nNOOD_PRODUCTIE_URL en PRODUCTIE_RUNTIME_URL moeten beide in .env staan.\n');
    process.exitCode = 1;
    return;
  }

  meldDoelwit(migratorUrl, 'Tenant opschonen (migrator)');
  if (!eisToestemmingBuitenLokaal(migratorUrl, { wat: 'Tenant opschonen' })) {
    return;
  }

  const migratorClient = new Client({ connectionString: migratorUrl });
  const apiClient = new Client({ connectionString: apiUrl });
  await migratorClient.connect();
  await apiClient.connect();

  try {
    const { rows: rolMigrator } = await migratorClient.query('SELECT current_user');
    if (rolMigrator[0].current_user !== 'clm_migrator') {
      throw new Error(`NOOD_PRODUCTIE_URL verbindt als '${rolMigrator[0].current_user}', verwacht clm_migrator.`);
    }
    const { rows: rolApi } = await apiClient.query('SELECT current_user');
    if (rolApi[0].current_user !== 'clm_api_runtime') {
      throw new Error(`PRODUCTIE_RUNTIME_URL verbindt als '${rolApi[0].current_user}', verwacht clm_api_runtime.`);
    }

    const doelNaam = await tenantNaamOpzoeken(migratorClient, tenantId);
    if (!doelNaam) {
      throw new Error(`Tenant-id ${tenantId} niet gevonden in clm.tenant_register.`);
    }
    const tenants = await alleTenants(migratorClient);
    const andereTenants = tenants.filter((t) => t.register_id !== tenantId);

    console.log(
      `\nOp te schonen tenant: ${doelNaam} (${tenantId})\n` +
        `Andere tenants ter controle: ${andereTenants.map((t) => t.name).join(', ')}\n`,
    );

    // ── Stap 3 van het runbook: benoemen wat aandacht vraagt ────────────────
    console.log('=== Wat blijft staan, en wat expliciet aandacht vraagt ===');
    await apiClient.query('BEGIN');
    await apiClient.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
    await apiClient.query(`SELECT set_config('app.current_actor', 'medewerker', true)`);

    for (const tabel of ['survey_template', 'survey_category', 'survey_question']) {
      const { rows } = await apiClient.query(`SELECT count(*) FROM clm.${tabel}`);
      console.log(`  ${tabel}: ${rows[0].count} rijen blijven staan.`);
    }

    const { rows: uitnodigingen } = await apiClient.query(`
      SELECT status, count(*) FILTER (WHERE expires_at > now()) AS nog_geldig, count(*) AS totaal
        FROM clm.survey_response GROUP BY status`);
    const nogGeldig = uitnodigingen.filter((r) => Number(r.nog_geldig) > 0);
    if (nogGeldig.length > 0) {
      console.log(
        '  LET OP: nog niet-verlopen uitnodigingen — ' +
          nogGeldig.map((r) => `${r.status}: ${r.nog_geldig} van ${r.totaal}`).join(', '),
      );
    }

    const { rows: bijlagen } = await apiClient.query(
      `SELECT attachment_id, storage_key, original_name, byte_size FROM clm.survey_attachment`,
    );
    if (bijlagen.length > 0) {
      console.log(
        `  LET OP: ${bijlagen.length} geüploade bestanden staan op de container ` +
          '(/app/var/uploads), NIET in de database. Dit script verwijdert ze NIET ' +
          '— zie runbook §7. Bestanden:',
      );
      for (const b of bijlagen) {
        console.log(`    - ${b.original_name} (${b.byte_size} bytes)`);
      }
    }
    await apiClient.query('ROLLBACK');
    console.log('');

    // ── Nulmeting: doeltenant + alle andere tenants ─────────────────────────
    console.log('=== Nulmeting: aantal rijen per tenant, VOOR de operatie ===');
    const nulmeting = {};
    for (const tenant of [{ register_id: tenantId, name: doelNaam }, ...andereTenants]) {
      nulmeting[tenant.register_id] = await volledigeTelling(apiClient, migratorClient, tenant.register_id);
    }
    console.table(nulmeting);

    // ── De twee tijdelijke SECURITY DEFINER-functies ────────────────────────
    console.log('=== Tijdelijke SECURITY DEFINER-functies aanmaken ===');
    await migratorClient.query(`
      CREATE OR REPLACE FUNCTION clm.tijdelijk_leegmaken_beperkte_tabellen(p_tenant_id uuid)
      RETURNS TABLE(tabel text, aantal bigint)
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = clm, pg_temp
      AS $$
      DECLARE
        n_review bigint; n_note bigint; n_engagement bigint;
        n_import_job bigint; n_contract bigint;
      BEGIN
        DELETE FROM clm.survey_review WHERE tenant_id = p_tenant_id;
        GET DIAGNOSTICS n_review = ROW_COUNT;

        DELETE FROM clm.response_note WHERE tenant_id = p_tenant_id;
        GET DIAGNOSTICS n_note = ROW_COUNT;

        DELETE FROM clm.vendor_engagement WHERE tenant_id = p_tenant_id;
        GET DIAGNOSTICS n_engagement = ROW_COUNT;

        DELETE FROM clm.import_job WHERE tenant_id = p_tenant_id;
        GET DIAGNOSTICS n_import_job = ROW_COUNT;

        DELETE FROM clm.contract WHERE tenant_id = p_tenant_id;
        GET DIAGNOSTICS n_contract = ROW_COUNT;

        RETURN QUERY SELECT 'survey_review'::text, n_review
                     UNION ALL SELECT 'response_note'::text, n_note
                     UNION ALL SELECT 'vendor_engagement'::text, n_engagement
                     UNION ALL SELECT 'import_job'::text, n_import_job
                     UNION ALL SELECT 'contract'::text, n_contract;
      END;
      $$;
    `);
    await migratorClient.query(
      `GRANT EXECUTE ON FUNCTION clm.tijdelijk_leegmaken_beperkte_tabellen(uuid) TO clm_api_runtime`,
    );
    await migratorClient.query(
      `REVOKE EXECUTE ON FUNCTION clm.tijdelijk_leegmaken_beperkte_tabellen(uuid) FROM PUBLIC`,
    );

    await migratorClient.query(`
      CREATE OR REPLACE FUNCTION clm.tijdelijk_leegmaken_buiten_clm(p_tenant_id uuid)
      RETURNS TABLE(tabel text, aantal bigint)
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = clm, audit, ref, pg_temp
      AS $$
      DECLARE n_audit bigint; n_categorie bigint;
      BEGIN
        DELETE FROM audit.audit_event WHERE tenant_id = p_tenant_id;
        GET DIAGNOSTICS n_audit = ROW_COUNT;

        DELETE FROM ref.vendor_category WHERE tenant_id = p_tenant_id;
        GET DIAGNOSTICS n_categorie = ROW_COUNT;

        RETURN QUERY SELECT 'audit.audit_event'::text, n_audit
                     UNION ALL SELECT 'ref.vendor_category'::text, n_categorie;
      END;
      $$;
    `);
    await migratorClient.query(
      `GRANT EXECUTE ON FUNCTION clm.tijdelijk_leegmaken_buiten_clm(uuid) TO clm_api_runtime`,
    );
    await migratorClient.query(
      `REVOKE EXECUTE ON FUNCTION clm.tijdelijk_leegmaken_buiten_clm(uuid) FROM PUBLIC`,
    );
    console.log('Twee functies aangemaakt, EXECUTE alleen voor clm_api_runtime.\n');

    // ── De eigenlijke verwijdering, in de vaste, bewezen volgorde ───────────
    console.log(`=== ${commit ? 'ECHTE UITVOERING' : 'DROGE RUN'}: verwijderen, uitsluitend ${doelNaam} ===`);
    await apiClient.query('BEGIN');
    await apiClient.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
    await apiClient.query(`SELECT set_config('app.current_actor', 'medewerker', true)`);

    const verwijderd = {};
    for (const tabel of VIA_API_VOOR_FUNCTIE) {
      const { rowCount } = await apiClient.query(`DELETE FROM clm.${tabel}`);
      verwijderd[tabel] = rowCount;
    }

    const { rows: functieResultaat } = await apiClient.query(
      `SELECT * FROM clm.tijdelijk_leegmaken_beperkte_tabellen($1)`,
      [tenantId],
    );
    for (const rij of functieResultaat) verwijderd[rij.tabel] = Number(rij.aantal);

    for (const tabel of VIA_API_NA_FUNCTIE) {
      const { rowCount } = await apiClient.query(`DELETE FROM clm.${tabel}`);
      verwijderd[tabel] = rowCount;
    }

    const { rows: buitenResultaat } = await apiClient.query(
      `SELECT * FROM clm.tijdelijk_leegmaken_buiten_clm($1)`,
      [tenantId],
    );
    for (const rij of buitenResultaat) verwijderd[rij.tabel] = Number(rij.aantal);

    const { rowCount: ledenWeg } = await apiClient.query(
      `DELETE FROM clm.tenant_membership WHERE tenant_id = $1 AND deleted_at IS NOT NULL`,
      [tenantId],
    );
    verwijderd['tenant_membership (ingetrokken)'] = ledenWeg;

    console.log('Verwijderd:');
    console.table(verwijderd);

    // ── Controle: echte tellingen na de deletes, binnen dezelfde transactie ──
    console.log('=== Controle: ECHTE tellingen NA de deletes ===');
    async function tellenNaBinnenApiTransactie(tenantIdControle) {
      await apiClient.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantIdControle]);
      const tellingen = {};
      for (const tabel of ALLE_TABELLEN) {
        const { rows } = await apiClient.query(`SELECT count(*) FROM clm.${tabel}`);
        tellingen[tabel] = Number(rows[0].count);
      }
      for (const [schema, tabel] of BUITEN_CLM) {
        const { rows } = await apiClient.query(
          `SELECT count(*) FROM ${schema}.${tabel} WHERE tenant_id = $1`,
          [tenantIdControle],
        );
        tellingen[`${schema}.${tabel}`] = Number(rows[0].count);
      }
      return tellingen;
    }

    const controle = {};
    for (const tenant of [{ register_id: tenantId, name: doelNaam }, ...andereTenants]) {
      controle[tenant.register_id] = await tellenNaBinnenApiTransactie(tenant.register_id);
    }
    console.table(controle);

    const teControleren = [...ALLE_TABELLEN, ...BUITEN_CLM.map(([s, t]) => `${s}.${t}`)];
    let afwijking = false;
    for (const tenant of andereTenants) {
      for (const sleutel of teControleren) {
        if (controle[tenant.register_id][sleutel] !== nulmeting[tenant.register_id][sleutel]) {
          console.error(
            `AFWIJKING: ${tenant.name}.${sleutel} was ${nulmeting[tenant.register_id][sleutel]}, is nu ${controle[tenant.register_id][sleutel]}`,
          );
          afwijking = true;
        }
      }
    }
    for (const sleutel of teControleren) {
      if (controle[tenantId][sleutel] !== 0) {
        console.error(`${doelNaam}.${sleutel} is niet leeg: ${controle[tenantId][sleutel]}`);
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

    await migratorClient.query(`DROP FUNCTION IF EXISTS clm.tijdelijk_leegmaken_beperkte_tabellen(uuid)`);
    await migratorClient.query(`DROP FUNCTION IF EXISTS clm.tijdelijk_leegmaken_buiten_clm(uuid)`);
    console.log('Beide tijdelijke functies opgeruimd (DROP FUNCTION).');
  } finally {
    await apiClient.end();
    await migratorClient.end();
  }
}

main().catch((fout) => {
  console.error(`\nMislukt: ${fout.message}\n`);
  process.exitCode = 1;
});
