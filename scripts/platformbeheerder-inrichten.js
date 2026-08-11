#!/usr/bin/env node
'use strict';

/**
 * Wijst de eerste platformbeheerder aan (ADR-015, migratie 0020).
 *
 * ── Het kip-ei-probleem dat dit script oplost ────────────────────────────────
 *
 * `clm.platform_admin` verwijst naar een rij in `clm."user"`, en die rij heeft
 * een `external_subject` nodig: de `oid` uit Entra. Die waarde kan niemand
 * verzinnen — hij ontstaat pas bij een echte login. Maar inloggen op de
 * applicatie vraagt een membership, en het aanmaken van tenants vraagt
 * platformbeheer. Zonder dit script komt die cirkel niet rond.
 *
 * Dus: één echte login, en de `oid` gaat rechtstreeks van het ID-token naar de
 * database. Precies zoals `echte-login.js` dat doet — dat script bewees op
 * 2026-07-31 dat de keten sluit; dit script gebruikt dezelfde weg voor een
 * ander doel.
 *
 * ── Wat het opzettelijk NIET doet ────────────────────────────────────────────
 *
 * De `oid` wordt nergens afgedrukt of weggeschreven naar een logbestand. Het is
 * een persoonsgegeven; wat je op het scherm ziet is óf het werkte, niet wie je
 * bent. Zelfde regel als in `claims-meten.js`.
 *
 * Het maakt ook géén tenant aan. Dat kan de applicatie zelf sinds
 * `POST /platform/tenants`, en dat is precies de route die we willen beproeven.
 * Een script dat het alsnog buiten de app om doet, zou die test zinloos maken.
 *
 * ── Gebruik ──────────────────────────────────────────────────────────────────
 *
 *   node scripts/platformbeheerder-inrichten.js
 *
 * Tegen productie draait het alleen met --extern, net als migrate:deploy.
 * De backend hoeft niet te draaien: dit script praat rechtstreeks met de
 * database en met Entra.
 */

require('dotenv/config');

const { createServer } = require('node:http');
const { createHash, randomBytes } = require('node:crypto');
const { Client } = require('pg');

const { meldDoelwit, eisOnbeschermdeDatabase } = require('./db-doelwit.js');

/**
 * De thuistenant van het platformbeheer.
 *
 * Een platformbeheerder heeft een `clm."user"`-rij nodig, en die vraagt een
 * tenant — het schema kent geen gebruiker zonder. Vandaar deze: geen klant,
 * geen demo, maar de plek waar het platformbeheer administratief woont.
 *
 * Hij krijgt bewust een vast, herkenbaar id. Wie hem in een lijst ziet staan
 * moet meteen weten dat het geen klant is.
 */
const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-00000000f1a7';
const PLATFORM_TENANT_NAAM = 'Platformbeheer';

const url = process.env.MIGRATION_DATABASE_URL;

if (!url) {
  console.error(
    'MIGRATION_DATABASE_URL ontbreekt. clm.platform_admin is alleen via de\n' +
      'migratierol te schrijven — clm_api_runtime mag hem lezen, niet vullen\n' +
      '(migratie 0020). Zie .env.example.',
  );
  process.exit(1);
}

meldDoelwit(url, 'Platformbeheerder inrichten');

const VERPLICHT = [
  'OIDC_ISSUER',
  'OIDC_TOKEN_ENDPOINT',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_REDIRECT_URI',
];

const ontbreekt = VERPLICHT.filter((naam) => !process.env[naam]);

if (ontbreekt.length > 0) {
  console.error(`\nIdentity-configuratie onvolledig: ${ontbreekt.join(', ')}.`);
  process.exit(1);
}

function melding(regel) {
  console.log(regel);
}

async function main() {
  // De rem staat binnen main() sinds stap 5: hij vraagt de database zelf of hij
  // beschermd is, en dat is een asynchrone leesquery. Vóór de inlogserver
  // start, zodat je niet eerst inlogt om daarna te horen dat het niet mag.
  if (
    !(await eisOnbeschermdeDatabase(url, { wat: 'Platformbeheerder inrichten' }))
  ) {
    process.exit(1);
  }

  const redirect = new URL(process.env.OIDC_REDIRECT_URI);
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256')
    .update(verifier, 'utf8')
    .digest('base64url');
  const state = randomBytes(16).toString('base64url');

  const autorisatie = process.env.OIDC_TOKEN_ENDPOINT.replace(
    /\/token(\?|$)/,
    '/authorize$1',
  );

  const parameters = new URLSearchParams({
    client_id: process.env.OIDC_CLIENT_ID,
    response_type: 'code',
    redirect_uri: process.env.OIDC_REDIRECT_URI,
    scope: 'openid profile email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    response_mode: 'query',
  });

  const server = createServer((verzoek, antwoord) => {
    const binnen = new URL(verzoek.url, 'http://localhost');

    if (binnen.pathname !== redirect.pathname) {
      antwoord.writeHead(404).end();
      return;
    }

    // Alleen reageren op een echt antwoord van de provider. Een browser vraagt
    // uit zichzelf van alles op (favicon, prefetch); zonder deze controle sloot
    // de server zichzelf af op zo'n verzoek. Zie echte-login.js, waar dit
    // dezelfde drie mislukte pogingen kostte.
    if (!binnen.searchParams.has('code') && !binnen.searchParams.has('error')) {
      antwoord.writeHead(204).end();
      return;
    }

    const fout = binnen.searchParams.get('error');

    if (fout) {
      antwoord
        .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end('<h1>Mislukt</h1><p>Zie de terminal.</p>');
      console.error(
        `\nEntra weigerde: ${fout} — ${binnen.searchParams.get('error_description') ?? ''}`,
      );
      server.close();
      process.exitCode = 1;
      return;
    }

    if (binnen.searchParams.get('state') !== state) {
      // Niet afsluiten: een oude browsertab stuurt de state van een vorige
      // poging mee. Dat is ruis, geen aanval — en stoppen zou de server weghalen
      // vóórdat de echte login binnenkomt.
      antwoord
        .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(
          '<h1>Oude poging</h1><p>Verouderde tab. Gebruik de nieuwste link uit de terminal.</p>',
        );
      console.log('  (verouderd verzoek genegeerd — oude browsertab)');
      return;
    }

    antwoord
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end('<h1>Gelukt</h1><p>Zie de terminal. Dit venster kan dicht.</p>');

    void voltooi(binnen.searchParams.get('code'), verifier).finally(() =>
      server.close(),
    );
  });

  server.listen(Number(redirect.port), () => {
    melding('');
    melding('Open deze link en log in met het account dat platformbeheerder');
    melding('moet worden:');
    melding('');
    melding(`${autorisatie}?${parameters.toString()}`);
    melding('');
    melding('(Federatief account? Gebruik de knop van uw eigen organisatie,');
    melding(' niet het wachtwoordveld — anders volgt AADSTS50056.)');
    melding('');
  });
}

async function voltooi(code, verifier) {
  // ── 1. Code inwisselen ─────────────────────────────────────────────────────
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.OIDC_REDIRECT_URI,
    client_id: process.env.OIDC_CLIENT_ID,
    client_secret: process.env.OIDC_CLIENT_SECRET,
    code_verifier: verifier,
  });

  const respons = await fetch(process.env.OIDC_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  const tokens = await respons.json();

  if (!respons.ok || typeof tokens.id_token !== 'string') {
    console.error(`\nCode inwisselen mislukt: ${JSON.stringify(tokens)}`);
    process.exitCode = 1;
    return;
  }

  melding('  1  code ingewisseld            OK');

  // ── 2. Verifiëren met de échte applicatiecode ──────────────────────────────
  //
  // Niet een eigen controle: dit is dezelfde klasse die in productie draait.
  // Vraagt wel een gebouwde dist/ — vandaar de melding als die ontbreekt.
  let IdTokenVerificateur;
  let leesAuthConfig;

  try {
    ({ IdTokenVerificateur } = require('../dist/auth/id-token-verificatie'));
    ({ leesAuthConfig } = require('../dist/auth/auth.config'));
  } catch {
    console.error(
      '\n  2  token verifiëren          MISLUKT: dist/ ontbreekt.\n' +
        '     Draai eerst: npm run build',
    );
    process.exitCode = 1;
    return;
  }

  let identiteit;

  try {
    identiteit = await new IdTokenVerificateur(leesAuthConfig()).verifieer(
      tokens.id_token,
    );
  } catch (fout) {
    console.error(`\n  2  token verifiëren          MISLUKT: ${fout.message}`);
    process.exitCode = 1;
    return;
  }

  melding('  2  token geverifieerd         OK (handtekening, iss, aud, exp)');

  // ── 3. Gebruiker en platformbeheer vastleggen ──────────────────────────────
  const client = new Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    ssl: /supabase|amazonaws/.test(process.env.MIGRATION_DATABASE_URL)
      ? { rejectUnauthorized: false }
      : undefined,
  });

  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `SET LOCAL app.current_tenant_id = '${PLATFORM_TENANT_ID}'`,
    );

    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [PLATFORM_TENANT_ID, PLATFORM_TENANT_NAAM],
    );

    const gebruiker = await client.query(
      `INSERT INTO clm."user" (tenant_id, full_name, external_subject, email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (external_subject) WHERE external_subject IS NOT NULL
         DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING user_id`,
      [
        PLATFORM_TENANT_ID,
        // Terugval op het e-mailadres en pas dan op een generieke tekst
        // (Issue #133). Een adres zegt wie iemand is; "Platformbeheerder" zegt
        // alleen wat hij doet, en dat is in een audit trail met meer dan één
        // beheerder onbruikbaar.
        //
        // `identiteit.naam` is sinds Issue #133 `undefined` wanneer Entra een
        // plaatsvervanger als "unknown" meestuurt — die kwam hier vroeger
        // gewoon doorheen omdat hij niet leeg is.
        identiteit.naam ?? identiteit.email ?? 'Platformbeheerder',
        identiteit.externalSubject,
        identiteit.email ?? null,
      ],
    );

    const userId = gebruiker.rows[0].user_id;

    // Een membership in de thuistenant: zonder membership levert
    // clm.sessie_aanmaken() niets op en kan deze persoon niet inloggen.
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING`,
      [userId, PLATFORM_TENANT_ID],
    );

    const beheer = await client.query(
      `INSERT INTO clm.platform_admin (user_id, toelichting)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET deleted_at = NULL, toelichting = EXCLUDED.toelichting
       RETURNING (xmax = 0) AS nieuw`,
      [userId, 'Ingericht via scripts/platformbeheerder-inrichten.js'],
    );

    await client.query(
      `INSERT INTO audit.audit_event
         (tenant_id, action_type, entity_type, entity_id, new_values)
       VALUES ($1, 'platformbeheerder_aangewezen', 'platform_admin', $2, $3::jsonb)`,
      [
        PLATFORM_TENANT_ID,
        userId,
        JSON.stringify({ via: 'platformbeheerder-inrichten.js' }),
      ],
    );

    await client.query('COMMIT');

    const nieuw = beheer.rows[0].nieuw;
    melding(
      `  3  platformbeheerder           OK (${nieuw ? 'nieuw' : 'bestond al'})`,
    );
  } catch (fout) {
    await client.query('ROLLBACK');
    console.error(`\n  3  vastleggen                MISLUKT: ${fout.message}`);
    process.exitCode = 1;
    await client.end();
    return;
  }

  // ── 4. Terugleze uit de database ───────────────────────────────────────────
  //
  // "Gelukt" op het scherm bewijst niets; dit project heeft twee keer een
  // geruststellende melding gehad over iets dat niet gebeurd was. Dus: lezen
  // wat er werkelijk staat.
  const controle = await client.query(
    `SELECT count(*)::int AS n
       FROM clm.platform_admin p
       JOIN clm."user" u ON u.user_id = p.user_id
      WHERE u.external_subject = $1 AND p.deleted_at IS NULL`,
    [identiteit.externalSubject],
  );

  await client.end();

  if (controle.rows[0].n !== 1) {
    console.error('\n  4  teruggelezen              MISLUKT: niet gevonden.');
    process.exitCode = 1;
    return;
  }

  melding('  4  teruggelezen               OK');
  melding('');
  melding('─'.repeat(70));
  melding('');
  melding(`  ${identiteit.naam ?? 'Deze gebruiker'} is nu platformbeheerder.`);
  melding('');
  melding('  Volgende stap: een tenant aanmaken via de applicatie.');
  melding('');
  melding('    POST /platform/tenants');
  melding('    { "naam": "...", "adminNaam": "...", "adminEmail": "..." }');
  melding('');
  melding('  Dat is de route die we willen beproeven — vandaar dat dit');
  melding('  script bewust géén klant-tenant aanmaakt.');
  melding('');
  melding('─'.repeat(70));
}

main().catch((fout) => {
  console.error(`\nOnverwachte fout: ${fout.message}`);
  process.exit(1);
});
