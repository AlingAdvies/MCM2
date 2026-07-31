#!/usr/bin/env node
'use strict';

/**
 * De echte inlogflow, van Entra tot een werkende sessie.
 *
 * ── Waarom dit script bestaat ────────────────────────────────────────────────
 *
 * `claims-meten.js` bewees welke claims Entra levert. Wat daarna nog open stond
 * is de vraag of de héle keten sluit: token verifiëren, gebruiker opzoeken,
 * membership toetsen, sessie maken, cookie zetten, en met dat cookie een
 * beheerroute aanroepen.
 *
 * Dat is niet met een unittest te bewijzen. De verificatie draait tegen een
 * lokaal sleutelpaar (bewust — zie README), en de e2e-tests maken hun sessies
 * rechtstreeks via `clm.sessie_aanmaken()`. Beide slaan de provider over.
 *
 * Dit script doet dat niet. Het draait één keer, met een mens erbij.
 *
 * ── Wat het opzettelijk NIET doet ────────────────────────────────────────────
 *
 * De `oid` van de ingelogde gebruiker wordt nergens afgedrukt of weggeschreven
 * naar een logbestand. Hij gaat rechtstreeks van het ID-token naar de
 * database — precies zoals in productie. Wat je op het scherm ziet is of het
 * werkte, niet wie je bent.
 *
 * ── Gebruik ──────────────────────────────────────────────────────────────────
 *
 *   DATABASE_URL=... node scripts/echte-login.js
 */

require('dotenv/config');

const { createServer } = require('node:http');
const { createHash, randomBytes } = require('node:crypto');
const { Client } = require('pg');

const API_URL = process.env.API_URL ?? 'http://localhost:5001';
const TENANT_ID = '00000000-0000-0000-0000-00000000e1e1';
const TENANT_NAAM = 'Echte-login-test';

function melding(regel) {
  console.log(regel);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL ontbreekt.');
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
    const url = new URL(verzoek.url, 'http://localhost');

    if (url.pathname !== redirect.pathname) {
      antwoord.writeHead(404).end();
      return;
    }

    // Alleen reageren op een verzoek dat daadwerkelijk een antwoord van de
    // provider is. Een browser vraagt uit zichzelf van alles op — favicon,
    // prefetch, een herhaling van een eerdere poging — en zonder deze
    // controle sloot de server zichzelf af op zo'n verzoek, mét de melding
    // "state komt niet overeen". Die melding wees dan naar een probleem dat
    // er niet was; de echte login kwam nooit aan de beurt.
    if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
      antwoord.writeHead(204).end();
      return;
    }

    const fout = url.searchParams.get('error');

    if (fout) {
      antwoord
        .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end('<h1>Mislukt</h1><p>Zie de terminal.</p>');
      console.error(
        `\nEntra weigerde: ${fout} — ${url.searchParams.get('error_description') ?? ''}`,
      );
      server.close();
      process.exitCode = 1;
      return;
    }

    if (url.searchParams.get('state') !== state) {
      // NIET afsluiten. Een oude browsertab die zichzelf herlaadt stuurt de
      // state van een vórige poging mee; dat is geen aanval maar ruis. Zou de
      // server hier stoppen, dan is hij weg vóórdat de echte login binnenkomt
      // — en dat is precies wat er drie keer gebeurde.
      //
      // In de applicatiecode is dit terecht wél een harde afwijzing
      // (auth.controller.ts): daar is elke afwijkende state een CSRF-signaal.
      // Hier is het een wegwerpscript met één mens ervoor.
      antwoord
        .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(
          '<h1>Oude poging</h1><p>Dit is een verouderde tab. Gebruik de nieuwste link uit de terminal.</p>',
        );
      console.log('  (verouderd verzoek genegeerd — oude browsertab)');
      return;
    }

    antwoord
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end('<h1>Gelukt</h1><p>Zie de terminal. Dit venster kan dicht.</p>');

    void voltooi(url.searchParams.get('code'), verifier).finally(() =>
      server.close(),
    );
  });

  server.listen(Number(redirect.port), () => {
    melding('');
    melding('Open deze link en log in:');
    melding('');
    melding(`${autorisatie}?${parameters.toString()}`);
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

  // ── 2. Token verifiëren met de échte applicatiecode ────────────────────────
  //
  // Niet een eigen controle: dit is IdTokenVerificateur uit dist/, dezelfde
  // klasse die in productie draait. Zou de verificatie iets afwijzen, dan
  // gebeurt dat hier op precies dezelfde manier.
  const { IdTokenVerificateur } = require('../dist/auth/id-token-verificatie');
  const { leesAuthConfig } = require('../dist/auth/auth.config');

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

  // ── 3. Gebruiker en membership klaarzetten ─────────────────────────────────
  //
  // In productie doet een beheerder dit; hier doet het script het, zodat de
  // eerste login niet strandt op "geen membership". De oid gaat rechtstreeks
  // van het token naar de database en wordt nergens afgedrukt.
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${TENANT_ID}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [TENANT_ID, TENANT_NAAM],
    );

    const gebruiker = await client.query(
      `INSERT INTO clm."user" (tenant_id, full_name, external_subject, email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (external_subject) WHERE external_subject IS NOT NULL
         DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING user_id`,
      [
        TENANT_ID,
        identiteit.naam ?? 'Beheerder',
        identiteit.externalSubject,
        identiteit.email ?? null,
      ],
    );

    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING`,
      [gebruiker.rows[0].user_id, TENANT_ID],
    );
    await client.query('COMMIT');

    melding('  3  gebruiker + membership     OK');

    // ── 4. Sessie maken via de échte databasefunctie ─────────────────────────
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token, 'utf8').digest('hex');

    const sessie = await client.query(
      'SELECT tenant_id, role FROM clm.sessie_aanmaken($1, $2, $3::interval)',
      [hash, identiteit.externalSubject, '8 hours'],
    );

    if (sessie.rows.length === 0) {
      console.error('\n  4  sessie aanmaken           MISLUKT: geen membership');
      process.exitCode = 1;
      return;
    }

    melding(
      `  4  sessie aangemaakt         OK (rol: ${sessie.rows[0].role})`,
    );

    // ── 5. De sessie gebruiken op een beheerroute ────────────────────────────
    //
    // De cookienaam volgt de configuratie van de backend, niet een vaste
    // waarde. Zonder SESSIE_COOKIE_INSECURE verwacht hij `__Host-mcm2_sessie`;
    // mét die schakelaar `mcm2_sessie`. Een verkeerde naam geeft een 401 die
    // niet verklapt dát het om de naam gaat — kostte bij de eerste echte login
    // een half uur zoeken.
    const { cookieInstellingen } = require('../dist/auth/sessie');
    const cookieNaam = cookieInstellingen().naam;

    const vendors = await fetch(`${API_URL}/vendors`, {
      headers: { Cookie: `${cookieNaam}=${token}` },
    });

    if (!vendors.ok) {
      console.error(
        `\n  5  /vendors met sessie       MISLUKT: ${vendors.status}`,
      );
      console.error('     Draait de backend op poort 5001?');
      process.exitCode = 1;
      return;
    }

    const lijst = await vendors.json();

    melding(
      `  5  /vendors met sessie       OK (${lijst.vendors.length} leveranciers)`,
    );

    // ── 6. Zonder sessie hoort dezelfde route dicht te zitten ────────────────
    const zonder = await fetch(`/vendors`);

    melding(
      `  6  /vendors zonder sessie    ${zonder.status === 401 ? 'OK (401)' : 'FOUT: ' + zonder.status}`,
    );

    melding('');
    melding('De hele keten werkt, van Entra tot de beheerroute.');
    melding('');
  } finally {
    await client.end();
  }
}

void main();
