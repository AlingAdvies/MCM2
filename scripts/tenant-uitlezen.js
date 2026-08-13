#!/usr/bin/env node
'use strict';

/**
 * Leest uit wat er in de tenant van je eigen sessie staat. UITSLUITEND SELECT.
 *
 * ── Waarom dit script bestaat ────────────────────────────────────────────────
 *
 * Op 2026-08-13 meldde `POST /platform/tenants` een **409**: de tenant
 * `AlingAdvies` bestaat al op productie. Datzelfde uur was er nog gemeten dat
 * productie *nul* tenants had — en die meting was fout:
 *
 *     RLS op clm.tenant : true (force: true)
 *     clm_migrator      : BYPASSRLS = false
 *
 * Nul rijen betekende dus "je mag niets zien", niet "er staat niets". Dat is
 * exact de meetfout die op 2026-08-10 de vorige AlingAdvies-tenant het leven
 * kostte: een query zonder tenantcontext gaf nul, dat werd gelezen als "de
 * database is leeg", en op die diagnose is opgeruimd.
 *
 * Vandaar dit script: kijken vóór er iets gebeurt, en kijken lángs de weg die
 * de applicatie zelf gebruikt — mét tenantcontext, via de HTTP-routes. Een
 * directe databasequery zou dezelfde blinde vlek hebben.
 *
 * ── Wat het bewust NIET doet ─────────────────────────────────────────────────
 *
 * **Niets schrijven.** Geen INSERT, geen UPDATE, geen DELETE, geen seed. Het
 * enige dat het achterlaat is een sessierij in `clm.sessie`, en die verloopt
 * vanzelf.
 *
 * **Geen conclusie trekken over "leeg".** Het drukt af wat het ziet. Of dat
 * betekent dat er niets staat, is een oordeel voor een mens — en dat oordeel
 * ging op 10-08 mis.
 *
 * ── Gebruik ──────────────────────────────────────────────────────────────────
 *
 *   npm run build
 *
 *   API_URL=https://saxombp.tail4b29b.ts.net/productie/api/backend \
 *   DATABASE_URL=<productie> \
 *   node scripts/tenant-uitlezen.js
 */

require('dotenv/config');

const { createServer } = require('node:http');
const { createHash, randomBytes } = require('node:crypto');

const { Client } = require('pg');

const { meldDoelwit } = require('./db-doelwit.js');

const API_URL = process.env.API_URL ?? 'http://localhost:5001';

function melding(regel) {
  console.log(regel);
}

async function main() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error('\nDATABASE_URL ontbreekt.\n');
    process.exit(1);
  }

  // Geen `eisOnbeschermdeDatabase` hier: dit script leest uitsluitend, en
  // lezen tegen een beschermde database is precies wat je zonder drempel wilt
  // kunnen doen. Zelfde afweging als bij `migratiestand.js` en
  // `productie-poort.js` — zie het runbook, "Waar de controle overal geldt".
  meldDoelwit(url, 'Tenant uitlezen (alleen lezen)');

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

    if (!binnen.searchParams.has('code') && !binnen.searchParams.has('error')) {
      antwoord.writeHead(204).end();
      return;
    }

    const fout = binnen.searchParams.get('error');

    if (fout) {
      antwoord
        .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end('<h1>Mislukt</h1><p>Zie de terminal.</p>');
      console.error(`\nEntra weigerde: ${fout}`);
      server.close();
      process.exitCode = 1;
      return;
    }

    if (binnen.searchParams.get('state') !== state) {
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

    void voltooi(binnen.searchParams.get('code'), verifier, url).finally(() =>
      server.close(),
    );
  });

  server.listen(Number(redirect.port), () => {
    melding('');
    melding('Open deze link en log in:');
    melding('');
    melding(`${autorisatie}?${parameters.toString()}`);
    melding('');
    melding('(Federatief account? Gebruik de knop van uw eigen organisatie.)');
    melding('');
  });
}

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
  const deel = tokens.id_token.split('.')[1];
  const claims = JSON.parse(Buffer.from(deel, 'base64url').toString('utf8'));

  return { externalSubject: claims.oid ?? claims.sub };
}

/** Haalt één route op en vat het antwoord samen. Faalt nooit hard. */
async function haal(pad, cookie) {
  try {
    const antwoord = await fetch(`${API_URL}${pad}`, {
      headers: { Cookie: cookie },
    });

    if (!antwoord.ok) {
      return { pad, status: antwoord.status, data: null };
    }

    return { pad, status: antwoord.status, data: await antwoord.json() };
  } catch (fout) {
    return { pad, status: 0, fout: fout.message, data: null };
  }
}

async function voltooi(code, verifier, url) {
  const identiteit = await leesIdentiteit(code, verifier);

  melding('  1  ingelogd bij Entra        OK');

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token, 'utf8').digest('hex');

    const sessie = await client.query(
      'SELECT tenant_id, role FROM clm.sessie_aanmaken($1, $2, $3::interval)',
      [hash, identiteit.externalSubject, '1 hour'],
    );

    if (sessie.rows.length === 0) {
      console.error(
        '\n  2  sessie aanmaken          MISLUKT: geen membership.\n',
      );
      process.exitCode = 1;
      return;
    }

    const tenantId = sessie.rows[0].tenant_id;

    melding(`  2  sessie aangemaakt        OK (rol: ${sessie.rows[0].role})`);
    melding('');
    melding(`     tenant van je sessie: ${tenantId}`);

    const { cookieInstellingen } = require('../dist/auth/sessie');
    const cookie = `${cookieInstellingen().naam}=${token}`;

    // ── Wat staat er in deze tenant? ────────────────────────────────────────
    const tenant = await haal(`/platform/tenants/${tenantId}`, cookie);
    const vendors = await haal('/vendors', cookie);
    // `admin/survey/templates`, niet `survey/templates` — opgezocht in
    // vragenlijst-beheer.controller.ts:77, niet gereconstrueerd.
    const templates = await haal('/admin/survey/templates', cookie);

    melding('');
    melding('  ── Gelezen via de applicatie, mét tenantcontext ──────────────');
    melding('');

    if (tenant.data) {
      melding(`     naam            ${tenant.data.naam ?? '?'}`);
      melding(`     aangemaakt      ${tenant.data.aangemaaktOp ?? '?'}`);
      melding(`     leden           ${tenant.data.aantalLeden ?? '?'}`);
    } else {
      melding(`     /platform/tenants/:id  gaf ${tenant.status}`);
    }

    melding(
      `     leveranciers    ${
        vendors.data
          ? (vendors.data.vendors?.length ?? '?')
          : `(${vendors.status})`
      }`,
    );
    // Het veld heet `vragenlijsten`, niet `templates` — opgezocht in
    // vragenlijst-beheer.controller.ts:101.
    melding(
      `     vragenlijsten   ${
        templates.data
          ? (templates.data.vragenlijsten?.length ?? '?')
          : `(${templates.status})`
      }`,
    );

    melding('');
    melding('  Dit is wat de applicatie ziet. Nul betekent hier écht nul —');
    melding('  de tenantcontext staat, anders dan bij een kale databasequery.');
    melding('');
  } finally {
    await client.end();
  }
}

void main();
