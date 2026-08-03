#!/usr/bin/env node
// Zet de demo-omgeving op, of laat hem met rust als hij al draait.
//
// ── Waarom dit bestaat ───────────────────────────────────────────────────────
//
// De demo-database is een container met een naam en een poort, net als de
// wegwerpdatabases van de teststraat. Dat maakte hem kwetsbaar voor een
// opruimactie: één `docker rm -f` over alle containers en de demo-data was weg,
// inclusief de koppeling van een echte Entra-identiteit aan een demo-gebruiker.
// Dat is op 2026-08-03 twee keer gebeurd.
//
// Dit script maakt "de demo staat klaar" één commando in plaats van een reeks
// stappen die telkens herhaald moeten worden. Het is idempotent: draait de
// container al, dan blijft hij staan met zijn data.
//
// ── Wat dit NIET doet ────────────────────────────────────────────────────────
//
// Geen productiedata, geen bestaande database aanraken, en niets verwijderen
// zonder `--opnieuw`. De demo-omgeving is bewust wegwerpbaar, maar niet per
// ongeluk.
//
// Gebruik:
//   npm run demo:start      opzetten of laten staan
//   npm run demo:start -- --opnieuw   weggooien en opnieuw opbouwen
//   npm run demo:stop       container verwijderen
//   npm run demo:status     draait hij, en wat zit erin?

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Vaste naam, poort en label.
 *
 * De poort is bewust een andere dan die van de teststraat: 55440 hoort bij een
 * handmatige `npm run verify`, 55441 bij `verify:volledig` en 55500 bij de
 * OTAP-doorloop. Vier poorten, vier doelen — dat voorkomt dat het ene script
 * de database van het andere leegruimt.
 */
const NAAM = 'mcm2demo';
const POORT = 55450;
const IMAGE = 'postgres:17.6';

/**
 * Een label, zodat de container te herkennen is als iets dat blijft staan.
 *
 * Een opruimactie kan hierop filteren:
 *   docker rm -f $(docker ps -aq --filter "label!=mcm2.rol=demo")
 */
const LABEL = 'mcm2.rol=demo';

const DEMO_TENANT_ID = 'dededede-0000-4000-8000-000000000001';

const isWindows = process.platform === 'win32';

function draai(commando, argumenten, opties = {}) {
  const resultaat = spawnSync(commando, argumenten, {
    encoding: 'utf8',
    shell: isWindows,
    stdio: opties.toon ? 'inherit' : 'pipe',
    env: { ...process.env, ...(opties.env ?? {}) },
    input: opties.invoerBestand
      ? fs.readFileSync(opties.invoerBestand, 'utf8')
      : undefined,
  });

  return {
    ok: resultaat.status === 0,
    uitvoer: (resultaat.stdout ?? '') + (resultaat.stderr ?? ''),
  };
}

function containerBestaat() {
  const { uitvoer } = draai('docker', [
    'ps',
    '-a',
    '--filter',
    `name=^${NAAM}$`,
    '--format',
    '{{.Names}}',
  ]);

  return uitvoer.trim() === NAAM;
}

function containerDraait() {
  const { uitvoer } = draai('docker', [
    'ps',
    '--filter',
    `name=^${NAAM}$`,
    '--format',
    '{{.Names}}',
  ]);

  return uitvoer.trim() === NAAM;
}

/**
 * Wacht tot Postgres écht klaar is.
 *
 * Twee opeenvolgende geslaagde queries, niet één `pg_isready`. Het
 * postgres-image start tijdens de eerste initialisatie een tijdelijke server
 * die alleen op de Unix-socket luistert; pg_isready meldt die als gereed,
 * waarna het image herstart. Een query die daartussen valt faalt met een
 * melding over een ontbrekende socket — die naar de verkeerde oorzaak wijst.
 * Dezelfde bevinding als in verify-volledig.js (2026-08-03).
 */
function wachtOpDatabase(maxSeconden = 60) {
  let opeenvolgendGoed = 0;

  for (let poging = 0; poging < maxSeconden; poging += 1) {
    const gereed = draai('docker', [
      'exec',
      NAAM,
      'psql',
      '-U',
      'postgres',
      '-tAc',
      '"SELECT 1"',
    ]);

    opeenvolgendGoed = gereed.ok ? opeenvolgendGoed + 1 : 0;

    if (opeenvolgendGoed >= 2) {
      return true;
    }

    draai(
      isWindows ? 'timeout' : 'sleep',
      isWindows ? ['/t', '1', '/nobreak'] : ['1'],
    );
  }

  return false;
}

function migratieUrl() {
  return `postgresql://clm_migrator:pw@localhost:${POORT}/postgres`;
}

function runtimeUrl() {
  return `postgresql://clm_api_runtime:pw@localhost:${POORT}/postgres`;
}

function stop() {
  if (!containerBestaat()) {
    console.log(`De demo-container '${NAAM}' bestaat niet.`);
    return true;
  }

  const weg = draai('docker', ['rm', '-f', NAAM]);

  if (!weg.ok) {
    console.error(`Verwijderen mislukt:\n${weg.uitvoer.trim()}`);
    return false;
  }

  console.log(`Demo-container '${NAAM}' verwijderd.`);
  return true;
}

function status() {
  if (!containerDraait()) {
    console.log(
      containerBestaat()
        ? `De demo-container '${NAAM}' bestaat maar draait niet. Start hem met: npm run demo:start`
        : `Er is geen demo-omgeving. Zet hem op met: npm run demo:start`,
    );
    return true;
  }

  const telling = draai('docker', [
    'exec',
    NAAM,
    'psql',
    '-U',
    'clm_migrator',
    '-d',
    'postgres',
    '-tAc',
    `"SET app.current_tenant_id = '${DEMO_TENANT_ID}';` +
      ` SELECT (SELECT count(*) FROM clm.vendor) || ' leveranciers, ' ||` +
      ` (SELECT count(*) FROM clm.\\"user\\") || ' gebruikers, ' ||` +
      ` (SELECT count(*) FROM clm.survey_response) || ' responses'"`,
  ]);

  console.log(`Demo-omgeving draait op poort ${POORT}.`);

  if (telling.ok) {
    // De SET geeft zelf ook een regel; alleen de laatste niet-lege telt.
    const regels = telling.uitvoer
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);

    console.log(`  Inhoud: ${regels[regels.length - 1]}`);
  }

  // Of er een echte Entra-identiteit aan hangt. Bewust zonder de oid zelf af
  // te drukken: dat is een persoonsgegeven, en de vraag is of er één ís.
  const gekoppeld = draai('docker', [
    'exec',
    NAAM,
    'psql',
    '-U',
    'clm_migrator',
    '-d',
    'postgres',
    '-tAc',
    `"SET app.current_tenant_id = '${DEMO_TENANT_ID}';` +
      ` SELECT count(*) FROM clm.\\"user\\"` +
      ` WHERE external_subject IS NOT NULL AND external_subject NOT LIKE 'demo:%'"`,
  ]);

  if (gekoppeld.ok) {
    const regels = gekoppeld.uitvoer
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);

    const aantal = Number(regels[regels.length - 1]);

    console.log(
      aantal > 0
        ? `  Inloggen: ${aantal} gebruiker(s) gekoppeld aan een echt Entra-account.`
        : '  Inloggen: nog geen echte identiteit gekoppeld — alle gebruikers zijn placeholders.',
    );
  }

  console.log(`\n  DATABASE_URL="${runtimeUrl()}"`);

  return true;
}

function start(opnieuw) {
  if (opnieuw && containerBestaat() && !stop()) {
    return false;
  }

  if (containerDraait()) {
    console.log(
      `De demo-omgeving draait al op poort ${POORT}. De data blijft staan.\n` +
        'Opnieuw opbouwen: npm run demo:start -- --opnieuw',
    );
    return status();
  }

  // Bestaat maar gestopt (bijvoorbeeld na een herstart van Docker Desktop):
  // starten in plaats van opnieuw opbouwen, want de data zit er nog in.
  if (containerBestaat()) {
    console.log('Container bestond al maar stond stil — starten…');

    const gestart = draai('docker', ['start', NAAM]);

    if (!gestart.ok) {
      console.error(`Starten mislukt:\n${gestart.uitvoer.trim()}`);
      return false;
    }

    if (!wachtOpDatabase()) {
      console.error('De database kwam niet op tijd omhoog.');
      return false;
    }

    console.log('Demo-omgeving is weer beschikbaar, met de bestaande data.');
    return status();
  }

  console.log('Demo-omgeving opzetten…');

  const gestart = draai('docker', [
    'run',
    '-d',
    '--name',
    NAAM,
    '--label',
    LABEL,
    '-e',
    'POSTGRES_PASSWORD=pw',
    '-p',
    `${POORT}:5432`,
    IMAGE,
  ]);

  if (!gestart.ok) {
    console.error(
      `Container starten mislukt:\n${gestart.uitvoer.trim()}\n\n` +
        `Draait Docker? Is poort ${POORT} vrij?`,
    );
    return false;
  }

  if (!wachtOpDatabase()) {
    console.error(
      `Postgres in ${NAAM} accepteerde binnen 60 seconden geen twee` +
        ` opeenvolgende queries. Bekijk 'docker logs ${NAAM}'.`,
    );
    return false;
  }

  const rollen = draai(
    'docker',
    ['exec', '-i', NAAM, 'psql', '-U', 'postgres', '-q'],
    { invoerBestand: path.join('db', 'roles', 'bootstrap-roles.sql') },
  );

  if (!rollen.ok) {
    console.error(`Rollen aanmaken mislukt:\n${rollen.uitvoer.trim()}`);
    return false;
  }

  draai('docker', [
    'exec',
    NAAM,
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-q',
    '-c',
    `"ALTER ROLE clm_migrator WITH PASSWORD 'pw';` +
      ` ALTER ROLE clm_api_runtime WITH PASSWORD 'pw';"`,
  ]);

  console.log('Migraties toepassen…');

  const migraties = draai('npm', ['run', 'migrate:deploy'], {
    env: { MIGRATION_DATABASE_URL: migratieUrl() },
  });

  if (!migraties.ok) {
    console.error(`Migraties mislukt:\n${migraties.uitvoer.trim()}`);
    return false;
  }

  console.log('Demo-data inlezen…');

  const seed = draai('npm', ['run', 'seed:demo'], {
    env: { DATABASE_URL: runtimeUrl() },
  });

  if (!seed.ok) {
    console.error(`Seeden mislukt:\n${seed.uitvoer.trim()}`);
    return false;
  }

  console.log('');
  status();

  console.log(
    '\nInloggen met een echt Entra-account vraagt één koppeling —' +
      '\nzie docs/STATUS.md, "Demo-tenant".',
  );

  return true;
}

function main() {
  const argumenten = process.argv.slice(2);
  const opdracht = argumenten.find((a) => !a.startsWith('--')) ?? 'start';

  const uitkomst =
    opdracht === 'stop'
      ? stop()
      : opdracht === 'status'
        ? status()
        : start(argumenten.includes('--opnieuw'));

  process.exit(uitkomst ? 0 : 1);
}

main();
