#!/usr/bin/env node
'use strict';

/**
 * Richt saxombp in als acceptatie- en productieserver.
 *
 * Draait één keer. Daarna doet `npm run deploy:acceptatie` het werk.
 *
 * ── Wat dit neerzet ─────────────────────────────────────────────────────────
 *
 *   /opt/mcm2/docker-compose.omgeving.yml   één bestand, twee omgevingen
 *   /opt/mcm2/acceptatie.env                poorten, wachtwoord, imagenamen
 *   /opt/mcm2/productie.env                 idem, andere waarden
 *
 * De wachtwoorden worden hier gegenereerd en staan alléén op de server, in
 * bestanden met rechten 600. Ze komen niet in git, niet in de terminalhistorie
 * en niet in dit script.
 *
 * ── Wat dit NIET aanraakt ───────────────────────────────────────────────────
 *
 * De Saxo-app. Die draait onder PM2 als gebruiker `cmaling` op poort 8080 en
 * 8081; deze omgevingen gebruiken 3010/5011 en 3020/5021 plus databasepoorten
 * op 127.0.0.1. Er is geen overlap, en dit script stopt niets dat al draait.
 *
 * ── Gebruik ─────────────────────────────────────────────────────────────────
 *
 *   npm run deploy:inrichten            controleert en zet klaar
 *   npm run deploy:inrichten -- --toon  laat zien wat er zou gebeuren
 */

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = 'root@saxombp';
const SERVER_MAP = '/opt/mcm2';
const PROJECT_DIR = path.resolve(__dirname, '..');

// De poorten van de Saxo-app. Dit script mag er nooit een van claimen.
const BEZET_DOOR_SAXO = [8080, 8081];

const OMGEVINGEN = [
  {
    naam: 'acceptatie',
    apiPoort: 5011,
    frontendPoort: 3010,
    dbPoort: 55460,
    project: 'mcm2-acceptatie',
  },
  {
    // Staging heeft GEEN dbPoort: de database staat bij Supabase
    // (`clm-staging3`). Dat is de reden dat staging bestaat — productie draait
    // Postgres bij AWS in Ierland achter een connection pooler, en een
    // repetitie in een lokale container bewijst het verkeerde (§1 van het
    // OTAP-plan).
    //
    // Gevolg: `DATABASE_URL` en `MIGRATION_DATABASE_URL` staan hier niet
    // vooringevuld. Die connectiestrings zijn geheimen en horen niet uit een
    // script te komen — zelfde afweging als bij OIDC_CLIENT_SECRET.
    naam: 'staging',
    apiPoort: 5031,
    frontendPoort: 3030,
    dbPoort: null,
    project: 'mcm2-staging',
  },
  {
    naam: 'productie',
    apiPoort: 5021,
    frontendPoort: 3020,
    dbPoort: 55470,
    project: 'mcm2-productie',
  },
];

const toonAlleen = process.argv.includes('--toon');

function opServer(commando, { stil = true } = {}) {
  const res = spawnSync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', SERVER, commando],
    { encoding: 'utf8' },
  );

  return {
    ok: res.status === 0,
    uit: (res.stdout || '').trim(),
    fout: (res.stderr || '').trim(),
  };
}

function stop(bericht, hint) {
  console.error(`\nGESTOPT: ${bericht}\n`);
  if (hint) console.error(`${hint}\n`);
  process.exit(1);
}

/** Een wachtwoord dat nergens anders bestaat en niet te raden is. */
function wachtwoord() {
  return crypto.randomBytes(24).toString('base64url');
}

function main() {
  console.log('');
  console.log(`Server inrichten: ${SERVER}`);
  console.log('');

  // ── 1. Bereikbaar en heeft Docker? ──────────────────────────────────────
  console.log('1/4  Server bereikbaar en Docker aanwezig?');

  const check = opServer(
    'docker --version && docker compose version | head -1 && systemctl is-active docker',
  );

  if (!check.ok) {
    stop(
      'De server is niet bereikbaar, of Docker ontbreekt.',
      `${check.fout}\n\nDocker installeren:\n  ssh ${SERVER} 'apt-get update && apt-get install -y docker.io docker-compose-v2'`,
    );
  }

  for (const regel of check.uit.split('\n')) {
    console.log(`     ${regel}`);
  }

  // ── 2. Botsen de poorten met iets dat al draait? ─────────────────────────
  //
  // Dit is de belangrijkste controle van dit script. De server draait de
  // Saxo-app; een poortbotsing zou die stukmaken, en dat mag onder geen enkele
  // omstandigheid gebeuren.
  console.log('');
  console.log('2/4  Poorten vrij? (de Saxo-app mag niet geraakt worden)');

  const teClaimen = OMGEVINGEN.flatMap((o) => [
    o.apiPoort,
    o.frontendPoort,
    o.dbPoort,
  ]);

  const overlap = teClaimen.filter((p) => BEZET_DOOR_SAXO.includes(p));
  if (overlap.length > 0) {
    stop(
      `Deze opzet zou poort ${overlap.join(', ')} claimen, en daar draait de Saxo-app.`,
      'Pas de poortnummers in dit script aan. Dit hoort niet te kunnen gebeuren.',
    );
  }

  const inGebruik = opServer(
    `ss -tln 2>/dev/null | grep -oE ':(${teClaimen.join('|')})\\b' | sort -u | tr -d ':'`,
  );

  const bezet = inGebruik.uit.split('\n').filter(Boolean);

  if (bezet.length > 0) {
    stop(
      `Poort ${bezet.join(', ')} is al in gebruik op de server.`,
      `Kijk wat het is:\n  ssh ${SERVER} "ss -tlnp | grep -E ':(${bezet.join('|')})'"\n\n` +
        'Is het een oude MCM2-omgeving, dan kan die weg:\n' +
        `  ssh ${SERVER} 'cd ${SERVER_MAP} && docker compose -p mcm2-acceptatie down'`,
    );
  }

  console.log(`     Alle ${teClaimen.length} poorten vrij: ${teClaimen.join(', ')}`);
  console.log(`     Saxo-app op ${BEZET_DOOR_SAXO.join(' en ')} blijft ongemoeid.`);

  // ── 3. Bestaat er al een inrichting? ────────────────────────────────────
  console.log('');
  console.log('3/4  Bestaande inrichting?');

  const bestaand = opServer(
    `ls ${SERVER_MAP}/*.env 2>/dev/null | xargs -n1 basename 2>/dev/null || true`,
  );

  const alAanwezig = bestaand.uit.split('\n').filter(Boolean);

  if (alAanwezig.length > 0) {
    console.log(`     Al aanwezig: ${alAanwezig.join(', ')}`);
    console.log(
      '     Die worden NIET overschreven — anders veranderen de databasewachtwoorden',
    );
    console.log(
      '     en kan geen enkele draaiende omgeving nog bij zijn eigen data.',
    );
  } else {
    console.log('     Nog niets ingericht.');
  }

  if (toonAlleen) {
    console.log('');
    console.log('--toon: hier stopt het. Er is niets gewijzigd.');
    console.log('');
    console.log('Zou aanmaken:');
    console.log(`  ${SERVER_MAP}/docker-compose.omgeving.yml`);
    for (const o of OMGEVINGEN) {
      if (!alAanwezig.includes(`${o.naam}.env`)) {
        console.log(
          `  ${SERVER_MAP}/${o.naam}.env   (api ${o.apiPoort}, frontend ${o.frontendPoort}, db ${o.dbPoort})`,
        );
      }
    }
    console.log('');
    return;
  }

  // ── 4. Neerzetten ───────────────────────────────────────────────────────
  console.log('');
  console.log('4/4  Bestanden neerzetten');

  const maak = opServer(`mkdir -p ${SERVER_MAP} && chmod 700 ${SERVER_MAP}`);
  if (!maak.ok) stop(`Kon ${SERVER_MAP} niet aanmaken.`, maak.fout);

  // Het compose-bestand mag wél overschreven worden: het bevat geen geheimen
  // en hoort gelijk te lopen met de repository.
  const composePad = path.join(PROJECT_DIR, 'deploy', 'docker-compose.omgeving.yml');
  const compose = fs.readFileSync(composePad, 'utf8');

  const kopieer = spawnSync(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      SERVER,
      `cat > ${SERVER_MAP}/docker-compose.omgeving.yml`,
    ],
    { input: compose, encoding: 'utf8' },
  );

  if (kopieer.status !== 0) {
    stop('Kon het compose-bestand niet kopiëren.', kopieer.stderr);
  }

  console.log('     docker-compose.omgeving.yml');

  // De databaserollen komen niet uit de migratieketen maar uit dit script
  // (ADR-009). Zonder deze rollen bestaat `clm_migrator` niet en faalt de
  // eerste migratie op een authenticatiefout.
  const rollenPad = path.join(PROJECT_DIR, 'db', 'roles', 'bootstrap-roles.sql');
  const rollen = fs.readFileSync(rollenPad, 'utf8');

  const rollenKopie = spawnSync(
    'ssh',
    ['-o', 'BatchMode=yes', SERVER, `cat > ${SERVER_MAP}/rollen.sql`],
    { input: rollen, encoding: 'utf8' },
  );

  if (rollenKopie.status !== 0) {
    stop('Kon bootstrap-roles.sql niet kopiëren.', rollenKopie.stderr);
  }

  console.log('     rollen.sql (uit db/roles/bootstrap-roles.sql)');

  const repoBasis = 'ghcr.io/alingadvies';

  for (const o of OMGEVINGEN) {
    if (alAanwezig.includes(`${o.naam}.env`)) {
      console.log(`     ${o.naam}.env — bestond al, ongemoeid gelaten`);
      continue;
    }

    // Eén keer genereren en hergebruiken: het wachtwoord staat zowel los in
    // DB_WACHTWOORD (voor de databasecontainer) als in DATABASE_URL (voor de
    // applicatie). Twee aanroepen zouden twee verschillende wachtwoorden
    // opleveren, en dan start de api met een string die nergens op slaat.
    const dbWachtwoord = o.dbPoort === null ? null : wachtwoord();

    const inhoud = [
      `# Omgeving: ${o.naam.toUpperCase()} — aangemaakt ${new Date().toISOString().slice(0, 10)}`,
      '#',
      '# Dit bestand staat ALLEEN op deze server en nergens in git.',
      '# Het databasewachtwoord hieronder is hier gegenereerd; overschrijf het',
      '# nooit zonder de bijbehorende database opnieuw op te bouwen — anders kan',
      '# de omgeving niet meer bij zijn eigen data.',
      '',
      `COMPOSE_PROJECT_NAME=${o.project}`,
      ...(o.dbPoort === null
        ? [
            '# Deze omgeving heeft GEEN eigen databasecontainer — de database',
            '# staat bij Supabase. DATABASE_URL hieronder moet met de hand',
            '# ingevuld worden met de runtime-connectiestring; dat is een',
            '# geheim en hoort niet uit dit script te komen.',
            '#',
            '# DB_WACHTWOORD en DB_POORT staan er leeg bij omdat het',
            '# compose-bestand ze noemt. Zonder die regels waarschuwt docker',
            '# compose over lege variabelen, en zo n waarschuwing leidt af van',
            '# meldingen die er wel toe doen.',
            'DB_WACHTWOORD=',
            'DB_POORT=',
            'DATABASE_URL=',
          ]
        : [
            `DB_WACHTWOORD=${dbWachtwoord}`,
            `DB_POORT=${o.dbPoort}`,
            '',
            '# De runtime-rol tegen de eigen databasecontainer. Zelfde',
            '# wachtwoord als hierboven; alleen omgevingen met een externe',
            '# database wijken hiervan af.',
            `DATABASE_URL=postgresql://clm_api_runtime:${dbWachtwoord}@db:5432/postgres`,
          ]),
      `API_POORT=${o.apiPoort}`,
      `FRONTEND_POORT=${o.frontendPoort}`,
      '',
      '# Waar de browser de frontend bereikt. De backend gebruikt dit als',
      '# CORS_ORIGIN; klopt het niet, dan geeft elk beheerscherm een 401 terwijl',
      '# de backend zelf prima draait.',
      `FRONTEND_URL=http://saxombp:${o.frontendPoort}`,
      '',
      '# De images, zonder tag. De tag komt van deploy.js.',
      `GHCR_API=${repoBasis}/mcm2/api`,
      `GHCR_FRONTEND=${repoBasis}/mcm2-frontend/web`,
      '',
      '# Wordt door docker compose gevuld vanuit deploy.js.',
      'API_IMAGE=',
      'FRONTEND_IMAGE=',
      '',
      '# ── Inloggen via Microsoft Entra (Issue #7) ────────────────────────────',
      '#',
      '# LEEG NEERGEZET, EN DAT IS OPZET. Dit script kent het client-secret',
      '# niet en hoort het niet uit een .env te vissen: een geheim kopiëren is',
      '# een handeling die je bewust doet, niet een bijwerking van inrichten.',
      '#',
      '# Zolang deze leeg zijn, geeft /auth/login een 500 met in het serverlog:',
      '#   "Identity-configuratie onvolledig. Ontbrekende variabelen: …"',
      '# Dat overkwam acceptatie op 2026-08-10 — de variabelen ontbraken hier',
      '# helemaal, dus stond er niets dat erop wees dat ze nodig waren.',
      '#',
      '# Invullen: de eerste vier en het secret staan in de lokale .env',
      '# (zie .env.example §Identity). Daarna de container herstarten.',
      '#',
      '# LET OP de redirect: die loopt via de FRONTEND, niet naar de backend.',
      '# De backend zet bij /auth/login een pogingcookie en leest dat bij',
      '# /auth/callback terug; lopen die over verschillende herkomsten, dan',
      '# stuurt de browser het cookie niet mee en mislukt élke login op een',
      '# ontbrekende state. Dit adres moet ook als redirect-URI in de',
      '# app-registratie bij Entra staan, anders weigert Microsoft de poging',
      '# met AADSTS50011.',
      'OIDC_ISSUER=',
      'OIDC_TOKEN_ENDPOINT=',
      'OIDC_JWKS_URI=',
      'OIDC_CLIENT_ID=',
      'OIDC_CLIENT_SECRET=',
      `OIDC_REDIRECT_URI=http://saxombp:${o.frontendPoort}/api/backend/auth/callback`,
      '',
      '# Waar de gebruiker landt na in- en uitloggen. Zonder deze twee valt de',
      "# backend terug op '/' — en dat is de backend-poort, waar geen scherm staat.",
      `NA_LOGIN_URL=http://saxombp:${o.frontendPoort}/beheer`,
      `NA_LOGOUT_URL=http://saxombp:${o.frontendPoort}/`,
      '',
      '# ── Waar links naartoe wijzen (Issue #132) ────────────────────────────',
      '#',
      '# Beide de FRONTEND, want beide zijn adressen die een ontvanger in zijn',
      '# browser opent. PORTAAL_BASIS_URL is de leverancierskant',
      '# (/portal/survey/<token>), UITNODIGING_BASIS_URL de beheerderskant',
      '# (/api/backend/auth/login?uitnodiging=<token>).',
      '#',
      '# Ontbraken tot 2026-08-10 allebei in dit script. Gevolg: elke uitgerolde',
      '# omgeving gaf een uitnodigingslink naar localhost — een adres dat daar',
      '# niet bestaat. Het token bestaat maar één keer en is niet opnieuw uit te',
      '# geven, dus zo’n link is niet te repareren.',
      `PORTAAL_BASIS_URL=http://saxombp:${o.frontendPoort}`,
      `UITNODIGING_BASIS_URL=http://saxombp:${o.frontendPoort}`,
      '',
    ].join('\n');

    const schrijf = spawnSync(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        SERVER,
        `cat > ${SERVER_MAP}/${o.naam}.env && chmod 600 ${SERVER_MAP}/${o.naam}.env`,
      ],
      { input: inhoud, encoding: 'utf8' },
    );

    if (schrijf.status !== 0) {
      stop(`Kon ${o.naam}.env niet schrijven.`, schrijf.stderr);
    }

    console.log(
      `     ${o.naam}.env — api ${o.apiPoort}, frontend ${o.frontendPoort}, db ${o.dbPoort}`,
    );
  }

  // Controleren dat de Saxo-app nog draait. Dit script raakt hem niet aan,
  // maar dat vaststellen is beter dan aannemen.
  const saxo = opServer(
    `ss -tln 2>/dev/null | grep -cE ':(${BEZET_DOOR_SAXO.join('|')})\\b'`,
  );

  console.log('');
  console.log(
    saxo.uit === String(BEZET_DOOR_SAXO.length)
      ? `Saxo-app: nog steeds actief op ${BEZET_DOOR_SAXO.join(' en ')}.`
      : `LET OP: verwachtte ${BEZET_DOOR_SAXO.length} Saxo-poorten, vond er ${saxo.uit}.`,
  );

  console.log('');
  console.log('KLAAR. De server is ingericht.');
  console.log('');
  console.log('Volgende stap — een image uitrollen naar acceptatie:');
  console.log('  npm run deploy:acceptatie');
  console.log('');
  console.log('Dat vraagt wel dat CI eerst een image gepubliceerd heeft naar');
  console.log('GHCR; dat gebeurt bij de eerstvolgende merge naar main.');
  console.log('');
}

main();
