#!/usr/bin/env node
'use strict';

/**
 * Meet welke claims de identity provider werkelijk levert.
 *
 * ── Waarom dit script bestaat ────────────────────────────────────────────────
 *
 * De code koppelt een gebruiker op de `oid`-claim. Dat is de juiste keuze
 * volgens de Microsoft-documentatie — `sub` verschilt per applicatie, `email`
 * verandert — maar het is nooit gemeten. Die aanname staat sinds 2026-07-27 in
 * de documentatie en is de laatste onbewezen schakel in de identiteitslaag.
 *
 * Dit script draait één echte login en toont wat er binnenkomt. Eén keer, met
 * een mens erbij; daarna is het antwoord bekend en is dit script overbodig.
 *
 * ── Waarom niet gewoon in het applicatielog ──────────────────────────────────
 *
 * Een ID-token bevat persoonsgegevens: naam, e-mailadres, en identifiers die
 * naar één persoon herleidbaar zijn. Die horen niet in een log dat blijft
 * staan, wordt doorgestuurd of in een backup belandt.
 *
 * Vandaar dit aparte script: het toont de claims op het scherm, schrijft niets
 * weg, en maskeert de waarden waar de vórm genoeg is om de vraag te
 * beantwoorden. Wat je wilt weten is "bestaat oid en is hij stabiel", niet
 * "welke oid heeft Kees".
 *
 * ── Gebruik ──────────────────────────────────────────────────────────────────
 *
 *   node scripts/claims-meten.js
 *
 * Opent een luisterende server op de redirect-URI, drukt een inloglink af, en
 * wacht tot de browser terugkomt. Stopt daarna vanzelf.
 */

require('dotenv/config');

const { createServer } = require('node:http');
const { createHash, randomBytes } = require('node:crypto');

const VERPLICHT = [
  'OIDC_ISSUER',
  'OIDC_TOKEN_ENDPOINT',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_REDIRECT_URI',
];

/**
 * Claims waarvan de wáárde niet ter zake doet, alleen of ze bestaan en welke
 * vorm ze hebben. Bij de rest is de waarde zelf informatief (bijvoorbeeld
 * `tid`, dat gewoon het tenant-ID is en al bekend).
 */
const PERSOONSGEGEVEN = new Set([
  'oid',
  'sub',
  'email',
  'name',
  'preferred_username',
  'given_name',
  'family_name',
  'upn',
]);

/** Toont genoeg om de vraag te beantwoorden, niet meer. */
function maskeer(naam, waarde) {
  if (!PERSOONSGEGEVEN.has(naam) || typeof waarde !== 'string') {
    return JSON.stringify(waarde);
  }

  if (waarde.length <= 8) {
    return `"${waarde.slice(0, 2)}…" (${waarde.length} tekens)`;
  }

  return `"${waarde.slice(0, 4)}…${waarde.slice(-4)}" (${waarde.length} tekens)`;
}

function main() {
  const ontbreekt = VERPLICHT.filter((naam) => !process.env[naam]?.trim());

  if (ontbreekt.length > 0) {
    console.error(`Configuratie onvolledig: ${ontbreekt.join(', ')}`);
    console.error('Zie .env.example, sectie Identity.');
    process.exit(1);
  }

  const redirect = new URL(process.env.OIDC_REDIRECT_URI);
  const poort = Number(redirect.port || 80);

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
    const url = new URL(verzoek.url, `http://localhost:${poort}`);

    if (url.pathname !== redirect.pathname) {
      antwoord.writeHead(404).end('Niet gevonden');
      return;
    }

    const fout = url.searchParams.get('error');

    if (fout) {
      const beschrijving = url.searchParams.get('error_description') ?? '';
      antwoord
        .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end('<h1>Inloggen mislukt</h1><p>Zie de terminal.</p>');

      console.error(`\nEntra weigerde de inlogpoging (${fout}):`);
      console.error(beschrijving);
      // De AADSTS-code in de beschrijving benoemt het probleem exact; zonder
      // die code is een configuratiefout niet te vinden.
      server.close();
      process.exitCode = 1;
      return;
    }

    if (url.searchParams.get('state') !== state) {
      antwoord.writeHead(400).end('State komt niet overeen.');
      console.error('\nState komt niet overeen — inlogpoging afgebroken.');
      server.close();
      process.exitCode = 1;
      return;
    }

    const code = url.searchParams.get('code');

    antwoord
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(
        '<h1>Gelukt</h1><p>De claims staan in de terminal. Dit venster kan dicht.</p>',
      );

    void wisselIn(code, verifier).finally(() => server.close());
  });

  server.listen(poort, () => {
    console.log('');
    console.log('Open deze link in je browser en log in:');
    console.log('');
    console.log(`${autorisatie}?${parameters.toString()}`);
    console.log('');
    console.log(`Wachten op de terugkeer op ${process.env.OIDC_REDIRECT_URI} …`);
  });
}

async function wisselIn(code, verifier) {
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

  const antwoord = await respons.json();

  if (!respons.ok) {
    console.error(`\nCode inwisselen mislukt (${respons.status}):`);
    console.error(antwoord.error_description ?? antwoord.error ?? 'onbekend');
    process.exitCode = 1;
    return;
  }

  if (typeof antwoord.id_token !== 'string') {
    console.error('\nGeen id_token in het antwoord. Ontbreekt de openid-scope?');
    process.exitCode = 1;
    return;
  }

  // Alleen de payload uitlezen, niet verifiëren: dat doet de applicatie zelf
  // (IdTokenVerificateur). Hier gaat het om de vraag wélke claims er zijn.
  const payload = JSON.parse(
    Buffer.from(antwoord.id_token.split('.')[1], 'base64url').toString('utf8'),
  );

  console.log('\n─────────────────────────────────────────────────────');
  console.log('Claims uit het ID-token');
  console.log('─────────────────────────────────────────────────────\n');

  for (const [naam, waarde] of Object.entries(payload).sort()) {
    console.log(`  ${naam.padEnd(22)} ${maskeer(naam, waarde)}`);
  }

  console.log('\n─────────────────────────────────────────────────────');
  console.log('Waar het om ging');
  console.log('─────────────────────────────────────────────────────\n');

  const oid = payload.oid;

  if (typeof oid === 'string' && oid.trim() !== '') {
    console.log('  oid aanwezig      JA — de koppeling in de code klopt.');
    console.log('                    clm.user.external_subject hoort deze');
    console.log('                    waarde te bevatten.');
  } else {
    console.log('  oid aanwezig      NEE — dit breekt de aanname in');
    console.log('                    id-token-verificatie.ts. De code weigert');
    console.log('                    het token en niemand kan inloggen.');
    console.log('                    Alternatief kiezen en vastleggen.');
  }

  const issuerKlopt = payload.iss === process.env.OIDC_ISSUER;

  console.log(
    `  issuer klopt      ${issuerKlopt ? 'JA' : 'NEE — OIDC_ISSUER moet worden: ' + payload.iss}`,
  );
  console.log(
    `  audience klopt    ${payload.aud === process.env.OIDC_CLIENT_ID ? 'JA' : 'NEE (aud=' + payload.aud + ')'}`,
  );
  console.log('');
}

main();
