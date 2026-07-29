#!/usr/bin/env node
/**
 * OTAP-doorloop: bewijst dat de volledige keten werkt (Issue #18).
 *
 * Draait tegen de stack uit docker-compose.otap.yml — beide onderdelen als
 * PRODUCTIE-image, niet in ontwikkelmodus. Dat onderscheid is het hele punt:
 * een dev-server die werkt bewijst niets over het artefact dat uitgerold wordt.
 *
 * Wat er gecontroleerd wordt, in volgorde van afhankelijkheid:
 *
 *   1. Database bereikbaar en rollen aanwezig
 *   2. Migratieketen volledig toegepast, RLS op alle tenantgebonden tabellen
 *   3. Backend-image draait en bedient /health
 *   4. Backend weigert een onbekend token met 404
 *   5. Backend accepteert een geldig token en geeft de juiste status
 *   6. Backend weigert een ronde die niet 'active' is (migratie 0006)
 *   7. Frontend-image draait en serveert het portaal
 *   8. De frontend praat met de echte backend, niet met mock data
 *
 * Elke stap faalt hard. Een groene doorloop betekent dat de keten
 * browser → frontend → backend → database aantoonbaar werkt.
 */

'use strict';

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');

// Binnen de db-container: poort 5432, niet de 55500 die naar de host is
// gemapt. Die mapping bestaat alleen buiten de container.
const DB = 'postgresql://postgres:otap_pw@localhost:5432/postgres';
const API = 'http://localhost:5001';
const FRONTEND = 'http://localhost:3000';

let stap = 0;
const fouten = [];

function meld(tekst) {
  process.stdout.write(`${tekst}\n`);
}

function ok(tekst) {
  meld(`  ✓ ${tekst}`);
}

function fout(tekst) {
  meld(`  ✗ ${tekst}`);
  fouten.push(tekst);
}

function kop(tekst) {
  stap += 1;
  meld(`\n${stap}. ${tekst}`);
}

/** Voert psql uit in de db-container. Geeft de kale uitvoer terug. */
function sql(query) {
  return execFileSync(
    'docker',
    ['compose', '-f', 'docker-compose.otap.yml', 'exec', '-T', 'db',
     'psql', DB, '-tAc', query],
    { encoding: 'utf8' },
  ).trim();
}

async function http(url, opties = {}) {
  const res = await fetch(url, { ...opties, redirect: 'manual' });
  const tekst = await res.text();
  return { status: res.status, tekst };
}

async function main() {
  meld('OTAP-doorloop — volledige keten in productievorm\n');
  meld('Stack: docker-compose.otap.yml (db + api + frontend)');

  // ── 1. Database ─────────────────────────────────────────────────────────
  kop('Database bereikbaar en rollen aanwezig');

  const rollen = sql(
    "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'clm\\_%'",
  );
  if (Number(rollen) >= 6) {
    ok(`${rollen} clm-rollen aanwezig`);
  } else {
    fout(`Verwachtte minstens 6 clm-rollen, vond er ${rollen}`);
  }

  const bypass = sql(
    "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'clm_api_runtime'",
  );
  if (bypass === 'f') {
    ok('clm_api_runtime heeft geen BYPASSRLS');
  } else {
    fout('clm_api_runtime kan RLS omzeilen — tenant-isolatie is waardeloos');
  }

  // ── 2. Migraties ────────────────────────────────────────────────────────
  kop('Migratieketen volledig toegepast');

  const migraties = sql('SELECT count(*) FROM drizzle.__drizzle_migrations');
  if (Number(migraties) >= 7) {
    ok(`${migraties} migraties toegepast`);
  } else {
    fout(`Verwachtte minstens 7 migraties, vond er ${migraties}`);
  }

  const zonderRls = sql(`
    SELECT count(*) FROM pg_tables t
     WHERE t.schemaname = 'clm'
       AND EXISTS (SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = 'clm' AND c.table_name = t.tablename
                      AND c.column_name = 'tenant_id')
       AND NOT t.rowsecurity`);
  if (zonderRls === '0') {
    ok('elke tenantgebonden tabel heeft RLS');
  } else {
    fout(`${zonderRls} tenantgebonden tabel(len) zonder RLS`);
  }

  const zonderCheck = sql(`
    SELECT count(*) FROM pg_policies
     WHERE schemaname = 'clm' AND (qual IS NULL OR with_check IS NULL)`);
  if (zonderCheck === '0') {
    ok('elke policy heeft zowel USING als WITH CHECK');
  } else {
    fout(`${zonderCheck} policy/policies mist USING of WITH CHECK`);
  }

  // ── 3. Backend draait ───────────────────────────────────────────────────
  kop('Backend-image draait');

  const health = await http(`${API}/health`);
  if (health.status === 200) {
    ok('/health antwoordt 200');
  } else {
    fout(`/health gaf ${health.status}`);
  }

  // ── 4-6. Backend-gedrag ─────────────────────────────────────────────────
  kop('Backend weigert een onbekend token');

  const onbekend = await http(`${API}/survey/respond?t=${'x'.repeat(43)}`);
  if (onbekend.status === 404) {
    ok('onbekend token → 404');
  } else {
    fout(`onbekend token gaf ${onbekend.status}, verwacht 404`);
  }

  // Testdata aanmaken via de database: de beheerroutes bestaan nog niet.
  //
  // Eerst de responses van een vorige doorloop weggooien. Zonder dit slaat
  // ON CONFLICT DO NOTHING de insert stilzwijgend over — de rij bestaat dan
  // nog met de tokenhash van de vórige run, en de doorloop faalt met een
  // misleidende "geldig token gaf 404". Zelf tegengekomen bij de tweede run.
  sql(`DELETE FROM clm.survey_response
        WHERE tenant_id = '11111111-1111-1111-1111-111111111111'`);

  const token = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const tokenDraft = crypto.randomBytes(32).toString('base64url');
  const hashDraft = crypto.createHash('sha256').update(tokenDraft).digest('hex');

  sql(`
    INSERT INTO clm.tenant (tenant_id, name)
    VALUES ('11111111-1111-1111-1111-111111111111', 'OTAP')
    ON CONFLICT DO NOTHING;

    INSERT INTO clm.vendor (vendor_id, tenant_id, name)
    VALUES ('22222222-2222-2222-2222-222222222222',
            '11111111-1111-1111-1111-111111111111', 'OTAP Leverancier')
    ON CONFLICT DO NOTHING;

    INSERT INTO clm.survey_template (template_id, tenant_id, name)
    VALUES ('33333333-3333-3333-3333-333333333333',
            '11111111-1111-1111-1111-111111111111', 'OTAP lijst')
    ON CONFLICT DO NOTHING;

    INSERT INTO clm.survey_run (run_id, tenant_id, template_id, status)
    VALUES ('44444444-4444-4444-4444-444444444444',
            '11111111-1111-1111-1111-111111111111',
            '33333333-3333-3333-3333-333333333333', 'active')
    ON CONFLICT DO NOTHING;

    INSERT INTO clm.survey_run (run_id, tenant_id, template_id, status)
    VALUES ('55555555-5555-5555-5555-555555555555',
            '11111111-1111-1111-1111-111111111111',
            '33333333-3333-3333-3333-333333333333', 'draft')
    ON CONFLICT DO NOTHING;

    INSERT INTO clm.survey_response
      (tenant_id, run_id, vendor_id, subject_vendor_id, token_hash, expires_at)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '44444444-4444-4444-4444-444444444444',
            '22222222-2222-2222-2222-222222222222',
            '22222222-2222-2222-2222-222222222222',
            '${hash}', now() + interval '30 days')
    ON CONFLICT DO NOTHING;

    INSERT INTO clm.survey_response
      (tenant_id, run_id, vendor_id, subject_vendor_id, token_hash, expires_at)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '55555555-5555-5555-5555-555555555555',
            '22222222-2222-2222-2222-222222222222',
            '22222222-2222-2222-2222-222222222222',
            '${hashDraft}', now() + interval '30 days')
    ON CONFLICT DO NOTHING;
  `);

  kop('Backend accepteert een geldig token');

  const geldig = await http(`${API}/survey/respond?t=${token}`);
  if (geldig.status === 200) {
    ok('geldig token → 200');
    if (!geldig.tekst.includes('11111111')) {
      ok('respons lekt geen tenant-ID');
    } else {
      fout('respons bevat een tenant-ID');
    }
  } else {
    fout(`geldig token gaf ${geldig.status}, verwacht 200`);
  }

  kop('Backend weigert een ronde in draft (migratie 0006)');

  const draft = await http(`${API}/survey/respond?t=${tokenDraft}`);
  if (draft.status === 410) {
    ok('draft-ronde → 410');
    if (draft.tekst.includes('nog niet opengesteld')) {
      ok('melding onderscheidt "nog niet open" van "gesloten"');
    } else {
      fout('melding maakt het onderscheid niet zichtbaar');
    }
  } else {
    fout(`draft-ronde gaf ${draft.status}, verwacht 410`);
  }

  // ── 7-8. Frontend ───────────────────────────────────────────────────────
  kop('Frontend-image draait en serveert het portaal');

  const home = await http(FRONTEND);
  if (home.status === 200) {
    ok('startpagina antwoordt 200');
  } else {
    fout(`startpagina gaf ${home.status}`);
  }

  if (home.tekst.includes('Live backend')) {
    ok('frontend draait op de echte backend, niet op mock data');
  } else {
    fout('frontend draait op mock data — NEXT_PUBLIC_API_URL niet ingebakken');
  }

  const portaal = await http(`${FRONTEND}/portal/survey/${token}`);
  if (portaal.status === 200) {
    ok('portaalroute antwoordt 200');
  } else {
    fout(`portaalroute gaf ${portaal.status}`);
  }

  // ── Uitkomst ────────────────────────────────────────────────────────────
  meld('\n' + '='.repeat(62));
  if (fouten.length === 0) {
    meld('OTAP-doorloop GESLAAGD — de volledige keten werkt.');
    meld('='.repeat(62));
    process.exit(0);
  }

  meld(`OTAP-doorloop GEFAALD — ${fouten.length} probleem/problemen:`);
  for (const f of fouten) meld(`  - ${f}`);
  meld('='.repeat(62));
  process.exit(1);
}

main().catch((err) => {
  meld(`\nOnverwachte fout: ${err.message}`);
  process.exit(1);
});
