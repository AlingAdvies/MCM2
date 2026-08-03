#!/usr/bin/env node
'use strict';

/**
 * De volledige doorloop: van code tot browser (`npm run verify:volledig`).
 *
 * ── Waarom dit bestaat ───────────────────────────────────────────────────────
 *
 * `npm run verify` bewijst dat de code klopt en dat de backend doet wat hij
 * belooft. Wat het níét bewijst is of de keten áls geheel werkt — of het
 * scherm de juiste route aanroept, of het sessiecookie meekomt, of een
 * aangemaakte leverancier daadwerkelijk terugkomt uit de database.
 *
 * Dat gat is niet theoretisch. Issue #42 en #43 waren allebei fouten die 155
 * backend-tests niet zagen en één blik in de browser wél: een ontbrekend
 * uploadveld en een leesblok met keuzerondjes.
 *
 * Dit script sluit dat gat. Eén commando, van opmaakcontrole tot een browser
 * die een leverancier aanmaakt en hem terugziet.
 *
 * ── Wat het doet ─────────────────────────────────────────────────────────────
 *
 *   1. npm run verify        code, unittests, e2e tegen een wegwerpdatabase
 *   2. stack bouwen          beide productie-images via docker compose
 *   3. migraties + sessie    tenant, gebruiker en een échte sessie
 *   4. browsertest           Playwright tegen de draaiende stack
 *   5. opruimen              altijd, ook na een fout
 *
 * Stap 4 draait tegen de PRODUCTIE-images, niet tegen `next dev`. Dat verschil
 * is de hele reden dat de OTAP-doorloop bestaat: een ontwikkelserver had de
 * EACCES-uploadfout in het productie-image nooit gevonden.
 */

const { spawnSync } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');

const COMPOSE = ['compose', '-f', 'docker-compose.otap.yml'];

/** Vaste id's voor de doorloop. Buiten de reeksen uit test/test-ids.ts. */
const TENANT_ID = '00000000-0000-0000-0000-0000000000d0';
const USER_ID = '00000000-0000-0000-0000-0000000000d1';
const SUBJECT = 'oid-verify-volledig';

const isWindows = process.platform === 'win32';

function draai(commando, argumenten, opties = {}) {
  // Een bestand als stdin doorgeven: psql leest het schema dan van de
  // standaardinvoer, precies zoals het runbook `< bestand.sql` gebruikt.
  const invoer = opties.invoerBestand
    ? readFileSync(opties.invoerBestand, 'utf8')
    : undefined;

  const resultaat = spawnSync(commando, argumenten, {
    stdio: opties.stil || invoer ? 'pipe' : 'inherit',
    shell: isWindows,
    encoding: 'utf8',
    env: { ...process.env, ...(opties.env ?? {}) },
    cwd: opties.cwd,
    input: invoer,
  });

  return {
    ok: resultaat.status === 0,
    uitvoer: (resultaat.stdout ?? '') + (resultaat.stderr ?? ''),
  };
}

/** Draait psql in de databasecontainer. */
function psql(sql, rol = 'postgres') {
  return draai(
    'docker',
    [
      ...COMPOSE,
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      rol,
      // De database expliciet: psql neemt anders de rolnaam als databasenaam
      // en faalt met `database "clm_migrator" does not exist` — een melding
      // die naar de verkeerde oorzaak wijst.
      '-d',
      'postgres',
      '-tAc',
      `"${sql}"`,
    ],
    { stil: true },
  );
}

function kop(nummer, totaal, tekst) {
  console.log(`\n${nummer}/${totaal}  ${tekst}`);
}

function opruimen() {
  console.log('\nOpruimen…');
  draai('docker', [...COMPOSE, 'down', '-v'], { stil: true });
}

/**
 * Wacht tot de stack antwoordt.
 *
 * Bewust pollen op een echte HTTP-reactie en niet op "de container draait":
 * een Next.js-server met een kapotte build start wél en geeft een 500. Dat
 * onderscheid is in dit project al eens misgegaan.
 */
function wachtOpStack(maxSeconden = 120) {
  const einde = Date.now() + maxSeconden * 1000;
  let laatsteFout = '';

  while (Date.now() < einde) {
    const api = draai(
      'curl',
      ['-s', '-o', isWindows ? 'NUL' : '/dev/null', '-w', '%{http_code}', 'http://localhost:5001/health'],
      { stil: true },
    );
    const web = draai(
      'curl',
      ['-s', '-o', isWindows ? 'NUL' : '/dev/null', '-w', '%{http_code}', 'http://localhost:3000/'],
      { stil: true },
    );

    const apiCode = api.uitvoer.trim();
    const webCode = web.uitvoer.trim();

    if (apiCode === '200' && webCode === '200') {
      return { ok: true };
    }

    laatsteFout = `api=${apiCode || 'geen antwoord'} frontend=${webCode || 'geen antwoord'}`;
    draai(isWindows ? 'timeout' : 'sleep', isWindows ? ['/t', '2', '/nobreak'] : ['2'], {
      stil: true,
    });
  }

  return { ok: false, reden: laatsteFout };
}

/** Containernaam voor de wegwerpdatabase van stap 1. */
const TESTDB = 'mcm2-verify-volledig-db';
const TESTDB_POORT = 55441;

/**
 * Start een wegwerpdatabase voor stap 1.
 *
 * Los van de doorloopstack (die draait op 55500) en los van de container die
 * iemand handmatig voor `npm run verify` gebruikt (55440). Drie poorten, drie
 * doelen — dat voorkomt dat deze doorloop andermans database leegruimt.
 */
function startTestDatabase() {
  draai('docker', ['rm', '-f', TESTDB], { stil: true });

  const gestart = draai(
    'docker',
    [
      'run',
      '-d',
      '--name',
      TESTDB,
      '-e',
      'POSTGRES_PASSWORD=pw',
      '-p',
      `${TESTDB_POORT}:5432`,
      'postgres:17.6',
    ],
    { stil: true },
  );

  if (!gestart.ok) {
    return { ok: false, reden: gestart.uitvoer.trim() };
  }

  // Wachten tot Postgres verbindingen accepteert.
  //
  // `pg_isready` alleen is niet genoeg, en dat leverde een onregelmatig
  // falende doorloop op (2026-08-03): het officiële postgres-image start
  // tijdens de eerste initialisatie een *tijdelijke* server die alleen op de
  // Unix-socket luistert. pg_isready meldt die als "accepting connections",
  // waarna het image de server stopt en opnieuw start voor de echte. Een psql
  // die precies daartussen valt, faalt met:
  //
  //   connection to server on socket "/var/run/postgresql/.s.PGSQL.5432"
  //   failed: No such file or directory
  //
  // Een melding die naar de verkeerde oorzaak wijst — hij suggereert dat er
  // geen server draait, terwijl de container gezond is.
  //
  // Daarom een echte query als bewijs van gereedheid, en pas doorgaan als die
  // twee keer achter elkaar slaagt: één keer kan nog de tijdelijke server zijn.
  let opeenvolgendGoed = 0;

  for (let poging = 0; poging < 60; poging += 1) {
    const gereed = draai(
      'docker',
      ['exec', TESTDB, 'psql', '-U', 'postgres', '-tAc', '"SELECT 1"'],
      { stil: true },
    );

    opeenvolgendGoed = gereed.ok ? opeenvolgendGoed + 1 : 0;

    if (opeenvolgendGoed >= 2) {
      const rollen = draai(
        'docker',
        ['exec', '-i', TESTDB, 'psql', '-U', 'postgres', '-q'],
        { stil: true, invoerBestand: 'db/roles/bootstrap-roles.sql' },
      );

      if (!rollen.ok) {
        return { ok: false, reden: rollen.uitvoer.trim() };
      }

      draai(
        'docker',
        [
          'exec',
          TESTDB,
          'psql',
          '-U',
          'postgres',
          '-q',
          '-c',
          '"ALTER ROLE clm_migrator WITH PASSWORD \'pw\'; ALTER ROLE clm_api_runtime WITH PASSWORD \'pw\';"',
        ],
        { stil: true },
      );

      const migraties = draai('npm', ['run', 'migrate:deploy'], {
        stil: true,
        env: {
          MIGRATION_DATABASE_URL: `postgresql://clm_migrator:pw@localhost:${TESTDB_POORT}/postgres`,
        },
      });

      if (!migraties.ok) {
        return { ok: false, reden: migraties.uitvoer.trim() };
      }

      return {
        ok: true,
        url: `postgresql://clm_api_runtime:pw@localhost:${TESTDB_POORT}/postgres`,
      };
    }

    draai(isWindows ? 'timeout' : 'sleep', isWindows ? ['/t', '1', '/nobreak'] : ['1'], {
      stil: true,
    });
  }

  return {
    ok: false,
    reden: `Postgres in ${TESTDB} accepteerde binnen 60 seconden geen twee opeenvolgende queries. Bekijk 'docker logs ${TESTDB}'.`,
  };
}

function stopTestDatabase() {
  draai('docker', ['rm', '-f', TESTDB], { stil: true });
}

/**
 * Bouwt de database vanaf niets op: rollen, wachtwoorden, migraties.
 *
 * Dit hoort bij de doorloop en is geen voorbereiding: het bewijst dat een lege
 * database via de migratieketen tot een werkend schema komt (runbook stap 3).
 *
 * De API is al gestart vóórdat de rollen bestonden en kan daardoor niet
 * verbinden. Herstarten is verplicht — zonder die stap wacht `wachtOpStack()`
 * tevergeefs op een backend die nooit gezond wordt. Dat kostte bij de eerste
 * doorloop tijd, en staat daarom in het runbook.
 */
function bouwDatabaseOp() {
  const rollen = draai(
    'docker',
    [
      ...COMPOSE,
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'postgres',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      '-',
    ],
    { stil: true, invoerBestand: 'db/roles/bootstrap-roles.sql' },
  );

  if (!rollen.ok) {
    return { ok: false, reden: `bootstrap-roles.sql: ${rollen.uitvoer.trim()}` };
  }

  const wachtwoorden = psql(
    "ALTER ROLE clm_migrator WITH PASSWORD 'otap_pw'; ALTER ROLE clm_api_runtime WITH PASSWORD 'otap_pw';",
  );

  if (!wachtwoorden.ok) {
    return { ok: false, reden: wachtwoorden.uitvoer.trim() };
  }

  const migraties = draai('npm', ['run', 'migrate:deploy'], {
    stil: true,
    env: {
      MIGRATION_DATABASE_URL:
        'postgresql://clm_migrator:otap_pw@localhost:55500/postgres',
    },
  });

  if (!migraties.ok) {
    return { ok: false, reden: migraties.uitvoer.trim() };
  }

  console.log('  Migraties toegepast op een lege database.');

  // Zie de uitleg hierboven: zonder deze herstart blijft de API onbereikbaar.
  draai('docker', [...COMPOSE, 'restart', 'api'], { stil: true });

  return { ok: true };
}

/**
 * Zet een tenant, gebruiker en membership klaar, en maakt een échte sessie.
 *
 * Geen nagebootst cookie: `clm.sessie_aanmaken()` doet het werk, inclusief de
 * membershipcontrole. Wat de browsertest daarna gebruikt is dus precies wat
 * een geslaagde inlog zou opleveren — alleen het verkrijgen ervan is
 * overgeslagen, niet de sessie zelf.
 */
function maakSessie() {
  const opzet = [
    `INSERT INTO clm.tenant (tenant_id, name) VALUES ('${TENANT_ID}', 'Doorloop') ON CONFLICT DO NOTHING;`,
    `INSERT INTO clm.\\"user\\" (user_id, tenant_id, full_name, external_subject) VALUES ('${USER_ID}', '${TENANT_ID}', 'Doorloop Beheerder', '${SUBJECT}') ON CONFLICT DO NOTHING;`,
    `INSERT INTO clm.tenant_membership (user_id, tenant_id, role) VALUES ('${USER_ID}', '${TENANT_ID}', 'admin') ON CONFLICT DO NOTHING;`,
  ];

  for (const sql of opzet) {
    // Als eigenaar, want deze tabellen staan onder RLS en er is nog geen
    // tenantcontext. Dit is opzetwerk, geen applicatiecode.
    const uitkomst = psql(
      `SET app.current_tenant_id = '${TENANT_ID}'; ${sql}`,
      'clm_migrator',
    );

    if (!uitkomst.ok) {
      return { ok: false, reden: uitkomst.uitvoer.trim() };
    }
  }

  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token, 'utf8').digest('hex');

  const sessie = psql(
    `SELECT tenant_id FROM clm.sessie_aanmaken('${hash}', '${SUBJECT}', '8 hours'::interval);`,
    'clm_migrator',
  );

  if (!sessie.ok || !sessie.uitvoer.includes(TENANT_ID)) {
    return {
      ok: false,
      reden: `sessie_aanmaken() gaf geen sessie terug: ${sessie.uitvoer.trim()}`,
    };
  }

  // Zelfde naam als cookieInstellingen() kiest wanneer SESSIE_COOKIE_INSECURE
  // aanstaat — en dat staat het in docker-compose.otap.yml, want deze doorloop
  // draait over http.
  return { ok: true, cookie: `mcm2_sessie=${token}` };
}

function main() {
  const stappen = 5;
  let gestart = false;

  try {
    kop(1, stappen, 'Code, unittests en backend-e2e (npm run verify)');

    // DATABASE_URL expliciet meegeven, anders slaat verify de e2e-stap over en
    // meldt hij "GROEN, met overgeslagen stappen" — misleidend in een
    // commando dat volledigheid belooft. De doorloopstack draait op 55500, dus
    // dit is een aparte wegwerpdatabase die er niet mee botst.
    const testDb = startTestDatabase();

    if (!testDb.ok) {
      console.error(`\nROOD: geen testdatabase kunnen starten.\n${testDb.reden}`);
      process.exit(1);
    }

    const verify = draai('npm', ['run', 'verify'], {
      env: { DATABASE_URL: testDb.url },
    });

    stopTestDatabase();

    if (!verify.ok) {
      console.error('\nROOD op stap 1. De rest is niet gedraaid.');
      process.exit(1);
    }

    kop(2, stappen, 'Stack bouwen en starten (productie-images)');

    if (!draai('docker', [...COMPOSE, 'up', '--build', '-d']).ok) {
      console.error('\nROOD: de stack kon niet gestart worden.');
      process.exit(1);
    }

    gestart = true;

    kop(3, stappen, 'Migraties, tenant en sessie klaarzetten');

    const opgebouwd = bouwDatabaseOp();

    if (!opgebouwd.ok) {
      console.error(`\nROOD: de database opbouwen mislukte.\n${opgebouwd.reden}`);
      process.exit(1);
    }

    const gereed = wachtOpStack();

    if (!gereed.ok) {
      console.error(`\nROOD: de stack antwoordt niet (${gereed.reden}).`);
      console.error('Logs: docker compose -f docker-compose.otap.yml logs');
      process.exit(1);
    }

    const sessie = maakSessie();

    if (!sessie.ok) {
      console.error(`\nROOD: geen sessie kunnen maken.\n${sessie.reden}`);
      process.exit(1);
    }

    console.log('  Sessie aangemaakt via clm.sessie_aanmaken().');

    kop(4, stappen, 'Browsertest tegen de draaiende stack');

    const browser = draai('npm', ['run', 'e2e'], {
      env: {
        BEHEER_COOKIE: sessie.cookie,
        PORTAL_URL: 'http://localhost:3000',
      },
      cwd: '../MCM2-frontend',
    });

    if (!browser.ok) {
      console.error('\nROOD op de browsertest.');
      console.error(
        'Playwright bewaart een trace bij een mislukte test:\n' +
          '  cd ../MCM2-frontend && npx playwright show-trace test-results/**/trace.zip',
      );
      process.exit(1);
    }

    kop(5, stappen, 'Opruimen');
    console.log('');
    console.log('GROEN — de hele keten, van code tot browser.');
    console.log('');
    console.log('Wat hiermee bewezen is:');
    console.log('  formulier → API → sessiecookie → guard → RLS → database → lijst');
    console.log('');
  } finally {
    // Ook bij een afgebroken run: een achtergebleven container blokkeert de
    // volgende doorloop op een poort die al bezet is.
    stopTestDatabase();

    if (gestart) {
      opruimen();
    }
  }
}

main();
