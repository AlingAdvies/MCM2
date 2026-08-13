#!/usr/bin/env node
'use strict';

/**
 * Maakt een tenant aan via de échte platformroute, met een echte Entra-login.
 *
 * ── Waarom dit script bestaat ────────────────────────────────────────────────
 *
 * `POST /platform/tenants` vraagt een sessiecookie van een platformbeheerder.
 * Er is **geen platformbeheerscherm** in de frontend — gemeten op 2026-08-13
 * geven `/beheer/platform`, `/platform` en `/beheer/tenants` alle drie 404. De
 * route bestaat alleen in de backend.
 *
 * Zonder dit script blijven er twee wegen over, en geen van beide deugt:
 *
 *   1. Een sessiecookie uit de browser kopiëren en ergens plakken. Dat is acht
 *      uur lang een volledige sleutel tot het account van de eigenaar, en hij
 *      belandt dan in een chatgeschiedenis of terminalhistorie.
 *   2. De tenant rechtstreeks in de database zetten. Dan is er geen auditspoor,
 *      en juist dát spoor is de opbrengst (plan §5.1). Dat ontbrak bij de
 *      AlingAdvies-tenant die op 2026-08-10 verloren ging.
 *
 * Dit script neemt de eerste weg weg: de sessie ontstaat hier, wordt hier
 * gebruikt, en verdwijnt daarna. Het cookie komt nergens in beeld.
 *
 * ── Wat het bewust NIET doet ─────────────────────────────────────────────────
 *
 * **Geen tenant in de database schrijven.** Het roept de HTTP-route aan, net
 * als een scherm zou doen. Een script dat het eromheen doet, maakt precies de
 * test zinloos die hier bewezen moet worden.
 *
 * **Geen gebruiker of membership aanmaken.** `echte-login.js` doet dat wél,
 * maar dat is een testfixture. Hier moet de ingelogde persoon al
 * platformbeheerder zijn; is hij dat niet, dan hoort dit te stoppen met een
 * 403 in plaats van dat stilzwijgend te repareren.
 *
 * **De `oid` wordt nergens afgedrukt of gelogd.** Persoonsgegeven. Je ziet óf
 * het werkte, niet wie je bent. Zelfde regel als in
 * `platformbeheerder-inrichten.js`.
 *
 * ── Gebruik ──────────────────────────────────────────────────────────────────
 *
 *   npm run build          # het script leest de cookienaam uit dist/
 *
 *   API_URL=https://saxombp.tail4b29b.ts.net/productie/api/backend \
 *   DATABASE_URL=<productie> \
 *   node scripts/tenant-aanmaken.js --naam "AlingAdvies" \
 *        --admin-naam "Kees Maling" --admin-email kees@alingadvies.nl --extern
 *
 * `--extern` is nodig zodra de database zich `beschermd` noemt. Dat is één
 * bewust woord extra op een handeling die je zelden doet, en het staat in je
 * terminalhistorie.
 */

require('dotenv/config');

const { createServer } = require('node:http');
const { createHash, randomBytes } = require('node:crypto');

const { Client } = require('pg');

const { meldDoelwit, eisOnbeschermdeDatabase } = require('./db-doelwit.js');

const API_URL = process.env.API_URL ?? 'http://localhost:5001';

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
    naam: argument('naam'),
    adminNaam: argument('admin-naam'),
    adminEmail: argument('admin-email'),
  };

  const ontbreekt = Object.entries(invoer)
    .filter(([, waarde]) => !waarde)
    .map(([sleutel]) => sleutel);

  if (ontbreekt.length > 0) {
    console.error(
      `\nOntbrekende argumenten: ${ontbreekt.join(', ')}.\n` +
        '\nGebruik:\n' +
        '  node scripts/tenant-aanmaken.js --naam "..." \\\n' +
        '       --admin-naam "..." --admin-email "..."\n',
    );
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error('\nDATABASE_URL ontbreekt.\n');
    process.exit(1);
  }

  // Het doelwit noemen vóór er iets gebeurt. Op 2026-08-06 meldde een script
  // "Migraties draaien als rol clm_migrator" en daarna "voltooid" — beide waar,
  // geen van beide verklapte dat het productie raakte (Issue #86).
  meldDoelwit(url, 'Tenant aanmaken via de platformroute');

  // De rem vóór de inlogserver start, zodat je niet eerst inlogt om daarna te
  // horen dat het niet mag. Zelfde volgorde als platformbeheerder-inrichten.js.
  if (!(await eisOnbeschermdeDatabase(url, { wat: 'Tenant aanmaken' }))) {
    process.exit(1);
  }

  for (const naam of [
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

    // Een browser vraagt uit zichzelf van alles op (favicon, prefetch). Zonder
    // deze controle sluit de server zichzelf af op zo'n verzoek — dat kostte
    // bij echte-login.js drie mislukte pogingen.
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
      // poging mee. Ruis, geen aanval.
      antwoord
        .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(
          '<h1>Oude poging</h1><p>Gebruik de nieuwste link uit de terminal.</p>',
        );
      console.log('  (verouderd verzoek genegeerd — oude browsertab)');
      return;
    }

    antwoord
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end('<h1>Gelukt</h1><p>Zie de terminal. Dit venster kan dicht.</p>');

    void voltooi(
      binnen.searchParams.get('code'),
      verifier,
      invoer,
      url,
    ).finally(() => server.close());
  });

  server.listen(Number(redirect.port), () => {
    melding('');
    melding('Open deze link en log in als platformbeheerder:');
    melding('');
    melding(`${autorisatie}?${parameters.toString()}`);
    melding('');
    melding('(Federatief account? Gebruik de knop van uw eigen organisatie,');
    melding(' niet het wachtwoordveld — anders volgt AADSTS50056.)');
    melding('');
  });
}

/** Wisselt de code in en leest de identiteit uit het ID-token. */
async function leesIdentiteit(code, verifier) {
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

  if (!respons.ok) {
    throw new Error(`Token-endpoint gaf ${respons.status}.`);
  }

  const tokens = await respons.json();

  if (!tokens.id_token) {
    throw new Error('Geen id_token in het antwoord.');
  }

  // Alleen uitlezen, niet verifiëren: de backend doet de echte verificatie bij
  // elk verzoek. Dit script gebruikt de oid uitsluitend om de sessie te maken.
  const deel = tokens.id_token.split('.')[1];
  const claims = JSON.parse(Buffer.from(deel, 'base64url').toString('utf8'));

  return { externalSubject: claims.oid ?? claims.sub };
}

async function voltooi(code, verifier, invoer, url) {
  const identiteit = await leesIdentiteit(code, verifier);

  melding('  1  ingelogd bij Entra        OK');

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    // ── Sessie maken via de échte databasefunctie ────────────────────────────
    //
    // Dezelfde functie die de applicatie gebruikt. Geen membership aanmaken:
    // wie hier geen sessie krijgt, hoort geen tenant te kunnen aanmaken.
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token, 'utf8').digest('hex');

    const sessie = await client.query(
      'SELECT tenant_id, role FROM clm.sessie_aanmaken($1, $2, $3::interval)',
      [hash, identiteit.externalSubject, '1 hour'],
    );

    if (sessie.rows.length === 0) {
      console.error(
        '\n  2  sessie aanmaken          MISLUKT: geen membership.\n' +
          '     Deze gebruiker hoort in een tenant te zitten. Draai eerst\n' +
          '     `npm run platform:inrichten`.\n',
      );
      process.exitCode = 1;
      return;
    }

    melding(`  2  sessie aangemaakt        OK (rol: ${sessie.rows[0].role})`);

    // De cookienaam volgt de configuratie van de backend, niet een vaste
    // waarde. Een verkeerde naam geeft een 401 die niet verklapt dát het om de
    // naam gaat — kostte bij de eerste echte login een half uur.
    const { cookieInstellingen } = require('../dist/auth/sessie');
    const cookieNaam = cookieInstellingen().naam;

    // ── De platformroute aanroepen ──────────────────────────────────────────
    const antwoord = await fetch(`${API_URL}/platform/tenants`, {
      method: 'POST',
      headers: {
        Cookie: `${cookieNaam}=${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(invoer),
    });

    const tekst = await antwoord.text();

    if (!antwoord.ok) {
      console.error(
        `\n  3  POST /platform/tenants  MISLUKT: ${antwoord.status}`,
      );
      console.error(`     ${tekst}`);

      if (antwoord.status === 401) {
        console.error(
          '\n     401 betekent hier: het cookie kwam niet aan of de sessie\n' +
            `     is ongeldig. Verwachte cookienaam: ${cookieNaam}.\n` +
            '     Draait de backend met dezelfde SESSIE_COOKIE_INSECURE?\n',
        );
      }

      if (antwoord.status === 403) {
        console.error(
          '\n     403 betekent: ingelogd, maar geen platformbeheerder.\n' +
            '     Draai `npm run platform:inrichten`.\n',
        );
      }

      process.exitCode = 1;
      return;
    }

    const tenant = JSON.parse(tekst);

    melding('  3  POST /platform/tenants   OK');
    melding('');
    melding(
      `     tenant-id      ${tenant.tenantId ?? tenant.tenant_id ?? '?'}`,
    );
    melding(`     mail verstuurd ${tenant.mailVerstuurd ? 'ja' : 'NEE'}`);
    melding('');
    melding(`     ${tenant.melding ?? ''}`);
    melding('');
    melding(
      '  ── DE UITNODIGINGSLINK BESTAAT MAAR ÉÉN KEER ──────────────────',
    );
    melding('');
    melding(`  ${tenant.uitnodigingslink ?? '(geen link in het antwoord)'}`);
    melding('');
    melding('  Geen enkele route kan hem opnieuw tonen. Bewaar hem nu.');
    melding('');
  } finally {
    await client.end();
  }
}

void main();
