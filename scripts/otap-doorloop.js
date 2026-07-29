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
 *   7. De vragenlijst komt uit de database (stap 5 uit de bouwvolgorde)
 *   8. Validatie, bestandsupload en indienen werken end-to-end (stap 6 en 8)
 *   9. Frontend-image draait en serveert het portaal
 *  10. De frontend praat met de echte backend, niet met mock data
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
  // Volgorde is niet vrij: alle survey-tabellen hebben ON DELETE RESTRICT,
  // want een ingediende response is bewijsmateriaal en mag nooit stilzwijgend
  // meeverdwijnen. Antwoorden en bijlagen dus vóór de response zelf.
  //
  // Dit brak bij de doorloop van 2026-07-29, zodra die ook daadwerkelijk ging
  // indienen: de tweede run viel om op de foreign key. Dat de constraint
  // hier in de weg zit, is het bewijs dat hij werkt.
  sql(`DELETE FROM clm.survey_answer
        WHERE tenant_id = '11111111-1111-1111-1111-111111111111'`);
  sql(`DELETE FROM clm.survey_attachment
        WHERE tenant_id = '11111111-1111-1111-1111-111111111111'`);
  sql(`DELETE FROM clm.survey_response
        WHERE tenant_id = '11111111-1111-1111-1111-111111111111'`);

  const token = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const tokenDraft = crypto.randomBytes(32).toString('base64url');
  const hashDraft = crypto.createHash('sha256').update(tokenDraft).digest('hex');
  // Derde token voor de frontendcontrole: het eerste wordt verbruikt door de
  // indiening in stap 8, en het portaal heeft een openstaande link nodig.
  // Eigen leverancier, want UNIQUE (run_id, vendor_id) staat twee responses
  // voor dezelfde leverancier in één ronde niet toe — precies de UC1-garantie.
  const tokenPortaal = crypto.randomBytes(32).toString('base64url');
  const hashPortaal = crypto
    .createHash('sha256')
    .update(tokenPortaal)
    .digest('hex');

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

    INSERT INTO clm.vendor (vendor_id, tenant_id, name)
    VALUES ('66666666-6666-6666-6666-666666666666',
            '11111111-1111-1111-1111-111111111111', 'OTAP Leverancier 2')
    ON CONFLICT DO NOTHING;

    INSERT INTO clm.survey_response
      (tenant_id, run_id, vendor_id, subject_vendor_id, token_hash, expires_at)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '44444444-4444-4444-4444-444444444444',
            '66666666-6666-6666-6666-666666666666',
            '66666666-6666-6666-6666-666666666666',
            '${hashPortaal}', now() + interval '30 days')
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

  // ── 7. De vragenlijst komt uit de database ──────────────────────────────
  //
  // Toegevoegd na de doorloop van 2026-07-29. Tot dan bewees de doorloop
  // alleen dat de tokenlaag werkte; de vragen, de validatie en de upload
  // bestonden nog niet. Zonder deze stappen zegt een groene doorloop niets
  // over wat een leverancier daadwerkelijk doet.
  kop('De vragenlijst komt uit de database (bouwvolgorde stap 5)');

  // De OTAP-testrun wijst standaard naar een lege template. Koppel hem aan de
  // geseede Transdev-vragenlijst — dezelfde weg als een echte tenant: via het
  // importpad, niet via losse INSERTs.
  const templateId = sql(`
    SELECT template_id FROM clm.survey_template
     WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
       AND name = 'transdev-annual-vendor-it-risk'
     LIMIT 1`);

  if (!templateId) {
    fout(
      'vragenlijst niet geseed — draai eerst: ' +
        'DATABASE_URL=... npm run seed:vragenlijsten -- 11111111-1111-1111-1111-111111111111',
    );
  } else {
    sql(`UPDATE clm.survey_run SET template_id = '${templateId}'
          WHERE run_id = '44444444-4444-4444-4444-444444444444'`);

    const vragen = await http(`${API}/survey/respond/questions?t=${token}`);

    if (vragen.status !== 200) {
      fout(`/questions gaf ${vragen.status}, verwacht 200`);
    } else {
      ok('/questions antwoordt 200');

      const lijst = JSON.parse(vragen.tekst);

      if (lijst.questions.length === 9) {
        ok('negen vragen: de acht Transdev-vragen plus het leesblok');
      } else {
        fout(`${lijst.questions.length} vragen, verwacht 9`);
      }

      // Testpunt 32 op ketenniveau: een leesblok hoort als instruction door te
      // komen, anders is de vragenlijst nooit compleet in te dienen.
      if (lijst.questions[0].answerType === 'instruction') {
        ok('het leesblok komt door als instruction');
      } else {
        fout('het leesblok heeft niet het type instruction');
      }

      const upload = lijst.questions.find((v) => v.allowsUpload);
      if (upload && upload.maxFiles === 2) {
        ok(`uploadvraag '${upload.questionKey}' met maximaal 2 bestanden`);
      } else {
        fout('de uploadvraag ontbreekt of heeft een ander maximum');
      }

      if (!vragen.tekst.includes('11111111')) {
        ok('de vragenlijst lekt geen tenant-ID');
      } else {
        fout('de vragenlijst bevat een tenant-ID');
      }
    }
  }

  // ── 8. Validatie, upload en indienen ────────────────────────────────────
  kop('Validatie, bestandsupload en indienen (bouwvolgorde stap 6 en 8)');

  const alleBevestigd = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'].map(
    (k) => ({ questionKey: k, answerType: 'confirmation', answerCode: 'confirmed' }),
  );

  const jsonPost = (pad, body) =>
    http(`${API}${pad}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  // Bevestigen op de uploadvraag zonder bestand moet falen. Dat is de regel
  // waar stap 8 om gebouwd is.
  const zonderBestand = await jsonPost(`/survey/respond?t=${token}`, {
    answers: alleBevestigd,
  });

  if (zonderBestand.status === 422 && zonderBestand.tekst.includes('file_required')) {
    ok('bevestigen zonder certificaat → 422 file_required');
  } else {
    fout(`indienen zonder bestand gaf ${zonderBestand.status}, verwacht 422`);
  }

  // Een bestand dat geen PDF of PNG is, wordt op de inhoud geweigerd — niet op
  // de naam of de meegestuurde Content-Type.
  const nep = new FormData();
  nep.append(
    'file',
    new Blob([Buffer.from('dit is gewoon tekst')], { type: 'application/pdf' }),
    'nep.pdf',
  );
  const nepUpload = await http(
    `${API}/survey/respond/attachment?t=${token}&question=q1`,
    { method: 'POST', body: nep },
  );

  if (nepUpload.status === 422) {
    ok('tekstbestand met .pdf-naam → 422, geweigerd op de bytes');
  } else {
    fout(`nep-PDF gaf ${nepUpload.status}, verwacht 422`);
  }

  // Het echte certificaat. Deze stap legde in de eerste uitvoering een fout
  // bloot die geen enkele test zag: het productie-image draait als non-root en
  // kon geen map aanmaken onder /app. Zie het runbook.
  const echt = new FormData();
  echt.append(
    'file',
    new Blob([Buffer.from('%PDF-1.7\nISO27001 certificaat')], {
      type: 'application/pdf',
    }),
    'certificaat.pdf',
  );
  const upload = await http(
    `${API}/survey/respond/attachment?t=${token}&question=q1`,
    { method: 'POST', body: echt },
  );

  if (upload.status === 201) {
    ok('certificaat geüpload → 201');
    if (upload.tekst.includes('application/pdf')) {
      ok('de server bepaalt zelf het content-type uit de bytes');
    } else {
      fout('het vastgestelde content-type ontbreekt in de respons');
    }
  } else {
    fout(
      `upload gaf ${upload.status}, verwacht 201 — ` +
        `controleer of de uploadmap schrijfbaar is voor de node-gebruiker`,
    );
  }

  const ingediend = await jsonPost(`/survey/respond?t=${token}`, {
    answers: alleBevestigd,
  });

  if (ingediend.status === 200) {
    ok('indienen mét certificaat → 200');
  } else {
    fout(`indienen gaf ${ingediend.status}, verwacht 200`);
  }

  // Éénmaligheid: dezelfde link werkt daarna niet meer.
  const nogmaals = await jsonPost(`/survey/respond?t=${token}`, {
    answers: alleBevestigd,
  });

  if (nogmaals.status === 410) {
    ok('tweede indiening → 410, de link is verbruikt');
  } else {
    fout(`tweede indiening gaf ${nogmaals.status}, verwacht 410`);
  }

  // En alles staat er ook echt: antwoorden, bijlage en auditregel.
  const opgeslagen = sql(`
    SELECT (SELECT count(*) FROM clm.survey_answer)     || '/' ||
           (SELECT count(*) FROM clm.survey_attachment) || '/' ||
           (SELECT count(*) FROM audit.audit_event
             WHERE action_type = 'survey_response_ingediend')`);

  const [antwoorden, bijlagen, audit] = opgeslagen.split('/').map(Number);

  if (antwoorden >= 8 && bijlagen >= 1 && audit >= 1) {
    ok(`vastgelegd: ${antwoorden} antwoorden, ${bijlagen} bijlage(n), ${audit} auditregel(s)`);
  } else {
    fout(
      `onvolledig vastgelegd: ${antwoorden} antwoorden, ${bijlagen} bijlagen, ${audit} auditregels`,
    );
  }

  // ── 9-10. Frontend ──────────────────────────────────────────────────────
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

  // Bewust een ánder token: het eerste is hierboven verbruikt door de
  // indiening, en een verbruikte link hoort in het portaal een 410-scherm te
  // geven. Voor deze controle is een openstaande link nodig.
  const portaal = await http(`${FRONTEND}/portal/survey/${tokenPortaal}`);
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
