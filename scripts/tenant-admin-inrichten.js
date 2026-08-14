#!/usr/bin/env node
'use strict';

/**
 * Voegt een admin toe aan een BESTAANDE tenant, via een echte Entra-login.
 *
 * ── Waarom dit bestaat ────────────────────────────────────────────────────
 *
 * `POST /platform/tenants` (tenant-aanmaken.js) maakt een tenant én zijn
 * eerste admin in één stap, maar dat kan alleen bij het aanmaken. Er is geen
 * applicatieroute om een tweede admin aan een bestaande tenant toe te voegen
 * — precies het gat waar dit script in valt, op dezelfde manier als
 * platformbeheerder-inrichten.js dat voor platform_admin doet.
 *
 * ── Aanleiding (14-08) ────────────────────────────────────────────────────
 *
 * De unieke index `tenant_membership_een_actief_per_gebruiker` staat maar
 * één blijvend (niet-support) membership per gebruiker toe (ADR-015). Eén
 * Entra-identiteit kan dus nooit tegelijk platformbeheerder ZIJN en
 * blijvend admin van een klanttenant. Twee losse identiteiten — twee
 * user-rijen, elk met precies één membership — botsen niet met die
 * constraint, want de index geldt per user_id.
 *
 * ── Wat dit script bewust NIET doet ──────────────────────────────────────
 *
 * Geen tenant aanmaken — hij moet al bestaan (leest hem via
 * clm.tenant_register, dat zonder tenantcontext leesbaar is, ADR-017).
 * Geen mail versturen — dit is een eenmalige handmatige inrichting, geen
 * uitnodigingsstroom. De `oid` wordt nergens afgedrukt of gelogd, zelfde
 * regel als in platformbeheerder-inrichten.js.
 *
 * ── Gebruik ────────────────────────────────────────────────────────────────
 *
 *   npm run build
 *
 *   MIGRATION_DATABASE_URL=<productie> \
 *   node scripts/tenant-admin-inrichten.js --tenant-naam "AlingAdvies" \
 *        --naam "Chris Maling" --email cmaling@gmail.com --extern
 *
 * `--extern` is nodig zodra de database zich `beschermd` noemt — dit script
 * schrijft met de migratierol, dus dezelfde rem als migrate:deploy geldt.
 */

require('dotenv/config');

const { createServer } = require('node:http');
const { createHash, randomBytes } = require('node:crypto');
const { Client } = require('pg');

const { meldDoelwit, eisOnbeschermdeDatabase } = require('./db-doelwit.js');

const url = process.env.MIGRATION_DATABASE_URL;

if (!url) {
  console.error(
    'MIGRATION_DATABASE_URL ontbreekt. Dit script schrijft met de\n' +
      'migratierol, net als platformbeheerder-inrichten.js.',
  );
  process.exit(1);
}

/** Leest een verplicht argument van de opdrachtregel. */
function argument(naam) {
  const index = process.argv.indexOf(`--${naam}`);

  if (index === -1) {
    return undefined;
  }

  const waarde = process.argv[index + 1];

  return !waarde || waarde.startsWith('--') ? undefined : waarde;
}

function melding(regel) {
  console.log(regel);
}

async function main() {
  const invoer = {
    tenantNaam: argument('tenant-naam'),
    naam: argument('naam'),
    email: argument('email'),
  };

  const ontbreekt = Object.entries(invoer)
    .filter(([, waarde]) => !waarde)
    .map(([sleutel]) => sleutel);

  if (ontbreekt.length > 0) {
    console.error(
      `\nOntbrekende argumenten: ${ontbreekt.join(', ')}.\n` +
        '\nGebruik:\n' +
        '  node scripts/tenant-admin-inrichten.js --tenant-naam "..." \\\n' +
        '       --naam "..." --email "..."\n',
    );
    process.exit(1);
  }

  meldDoelwit(url, 'Tenant-admin inrichten');

  if (
    !(await eisOnbeschermdeDatabase(url, { wat: 'Tenant-admin inrichten' }))
  ) {
    process.exit(1);
  }

  for (const naam of [
    'OIDC_ISSUER',
    'OIDC_TOKEN_ENDPOINT',
    'OIDC_CLIENT_ID',
    'OIDC_CLIENT_SECRET',
    'OIDC_REDIRECT_URI',
  ]) {
    if (!process.env[naam]) {
      console.error(`\n${naam} ontbreekt in .env.\n`);
      process.exit(1);
    }
  }

  // De tenant moet al bestaan. tenant_register is zonder tenantcontext
  // leesbaar (ADR-017) — precies om dit soort kip-ei-problemen te vermijden.
  const opzoekClient = new Client({
    connectionString: url,
    ssl: /supabase|amazonaws/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  await opzoekClient.connect();

  let tenantId;
  try {
    const gevonden = await opzoekClient.query(
      'SELECT register_id FROM clm.tenant_register WHERE name = $1',
      [invoer.tenantNaam],
    );

    if (gevonden.rows.length === 0) {
      console.error(
        `\nTenant '${invoer.tenantNaam}' bestaat niet in clm.tenant_register.\n` +
          'Dit script maakt geen tenant aan — gebruik daarvoor\n' +
          'scripts/tenant-aanmaken.js.\n',
      );
      process.exitCode = 1;
      return;
    }

    tenantId = gevonden.rows[0].register_id;
  } finally {
    await opzoekClient.end();
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

    void voltooi(binnen.searchParams.get('code'), verifier, invoer, tenantId).finally(
      () => server.close(),
    );
  });

  server.listen(Number(redirect.port), () => {
    melding('');
    melding(`Open deze link en log in als ${invoer.email}:`);
    melding('');
    melding(`${autorisatie}?${parameters.toString()}`);
    melding('');
    melding('(Federatief account? Gebruik de knop van uw eigen organisatie,');
    melding(' niet het wachtwoordveld — anders volgt AADSTS50056.)');
    melding('');
  });
}

async function voltooi(code, verifier, invoer, tenantId) {
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

  const client = new Client({
    connectionString: url,
    ssl: /supabase|amazonaws/.test(url) ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`);

    // Dezelfde ON CONFLICT-vorm als platformbeheerder-inrichten.js: een
    // tweede run met dezelfde identiteit werkt de naam bij in plaats van te
    // botsen.
    const gebruiker = await client.query(
      `INSERT INTO clm."user" (tenant_id, full_name, external_subject, email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (external_subject) WHERE external_subject IS NOT NULL
         DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING user_id`,
      [
        tenantId,
        identiteit.naam ?? identiteit.email ?? invoer.naam,
        identiteit.externalSubject,
        identiteit.email ?? invoer.email,
      ],
    );

    const userId = gebruiker.rows[0].user_id;

    // De unieke index tenant_membership_een_actief_per_gebruiker staat hier
    // GEEN tweede blijvend membership toe als deze user_id er al een heeft
    // — en dat is precies de bedoeling (ADR-015). Een botsing hier betekent:
    // deze identiteit is al ergens anders blijvend lid, en dat moet eerst
    // bewust opgelost worden, niet stilzwijgend overschreven.
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [userId, tenantId],
    );

    await client.query(
      `INSERT INTO audit.audit_event
         (tenant_id, action_type, entity_type, entity_id, new_values)
       VALUES ($1, 'tenant_admin_ingericht', 'tenant_membership', $2, $3::jsonb)`,
      [
        tenantId,
        userId,
        JSON.stringify({ via: 'tenant-admin-inrichten.js', role: 'admin' }),
      ],
    );

    await client.query('COMMIT');

    melding('  3  membership aangemaakt       OK (rol: admin)');
    melding('');
    melding(`     Deze identiteit kan nu inloggen als admin van '${invoer.tenantNaam}'.`);
    melding('');
  } catch (fout) {
    await client.query('ROLLBACK');
    console.error(`\n  3  vastleggen                MISLUKT: ${fout.message}`);

    if (/tenant_membership_een_actief_per_gebruiker/.test(fout.message)) {
      console.error(
        '\n     Deze identiteit heeft al een blijvend membership elders\n' +
          '     (ADR-015 staat er maar één toe, support uitgezonderd).\n' +
          '     Log in met een andere identiteit, of trek eerst het\n' +
          '     bestaande membership in.\n',
      );
    }

    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void main();
