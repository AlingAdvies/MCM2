#!/usr/bin/env node
'use strict';

/**
 * Eén commando voor een klaarstaande, lokale wegwerp-testdatabase.
 *
 * ── Waarom dit bestaat ───────────────────────────────────────────────────────
 *
 * Op 2026-08-25 kostte het testen van één feature (audit-bewijsvoering) drie
 * losse, herhaalde incidenten die geen van alle over de nieuwe code gingen:
 *
 *   1. `MIGRATION_DATABASE_URL`/`DATABASE_URL` wezen naar de `postgres`-
 *      superuser-rol in plaats van `clm_migrator`/`clm_api_runtime`. Die
 *      superuser heeft BYPASSRLS (ADR-008 verbiedt dat voor de app-rol) —
 *      tests draaiden dus tegen een database die zijn eigen RLS-garantie
 *      niet toetste, en later bleek een tabel door de verkeerde rol
 *      aangemaakt (`rechten-contract.e2e-spec.ts` faalde daardoor apart).
 *   2. De wachtwoorden van `clm_migrator`/`clm_api_runtime` moesten
 *      handmatig gezet worden, elke keer opnieuw geraden/opgezocht.
 *   3. Migraties en de wegwerp-markering (`markeer-wegwerp.js`) waren losse,
 *      makkelijk vergeten stappen ná het aanmaken van de container.
 *
 * Dit script doet alle vier de stappen — container, rollen, migraties,
 * markering — in de vaste volgorde die CI ook gebruikt (zie
 * .github/workflows/ci.yml, "Rollen aanmaken en wachtwoorden zetten"), zodat
 * er nooit meer geraden hoeft te worden welke rol welk wachtwoord heeft.
 *
 * ── Wat het NIET doet ────────────────────────────────────────────────────────
 *
 * Geen productie- of stagingdatabase aanraken — dit script kent alleen een
 * lokale Docker-container als doelwit, er is geen manier om er een extern
 * adres aan mee te geven. Voor die databases blijven de bestaande remmen in
 * db-doelwit.js gelden.
 *
 * Gebruik:
 *   node scripts/test-db-opzetten.js "waarvoor"
 *     → nieuwe container mcm2-testdb op poort 55440 (of --poort <n>)
 *   node scripts/test-db-opzetten.js "waarvoor" --hergebruik
 *     → bestaande container mcm2-testdb hergebruiken (rollen/migraties/
 *       markering opnieuw toepassen, idempotent)
 *   node scripts/test-db-opzetten.js --afbreken
 *     → de container stoppen en verwijderen
 *
 * Drukt aan het eind de exacte env-regels af om te kopiëren/exporteren.
 */

const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');

const CONTAINER = 'mcm2-testdb';
const WACHTWOORD_MIGRATOR = 'testpw_migrator';
const WACHTWOORD_RUNTIME = 'testpw_runtime';
const PROJECT_DIR = path.join(__dirname, '..');

function vlagWaarde(naam, standaard) {
  const idx = process.argv.indexOf(naam);
  if (idx === -1) return standaard;
  const waarde = process.argv[idx + 1];
  return waarde && !waarde.startsWith('--') ? waarde : standaard;
}

const poort = vlagWaarde('--poort', '55440');
const hergebruik = process.argv.includes('--hergebruik');
const afbreken = process.argv.includes('--afbreken');
const toelichting =
  process.argv.slice(2).find((a) => !a.startsWith('--') && a !== poort) ??
  `test-db-opzetten.js, ${new Date().toISOString()}`;

function draai(commando, args, opties = {}) {
  const resultaat = spawnSync(commando, args, {
    stdio: opties.stil ? 'pipe' : 'inherit',
    encoding: 'utf8',
    ...opties,
  });

  if (resultaat.status !== 0 && !opties.magFalen) {
    console.error(`\nMislukt: ${commando} ${args.join(' ')}`);
    if (opties.stil) console.error(resultaat.stderr || resultaat.stdout);
    process.exit(1);
  }

  return resultaat;
}

function containerBestaat() {
  const r = spawnSync(
    'docker',
    ['ps', '-a', '--filter', `name=^${CONTAINER}$`, '--format', '{{.Names}}'],
    { encoding: 'utf8' },
  );
  return r.stdout.trim() === CONTAINER;
}

function containerDraait() {
  const r = spawnSync(
    'docker',
    ['ps', '--filter', `name=^${CONTAINER}$`, '--format', '{{.Names}}'],
    { encoding: 'utf8' },
  );
  return r.stdout.trim() === CONTAINER;
}

async function wachtTotGezond(superuserUrl, pogingen = 30) {
  const { Client } = require('pg');

  for (let i = 0; i < pogingen; i += 1) {
    const client = new Client({ connectionString: superuserUrl });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return true;
    } catch {
      await client.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

async function main() {
  if (afbreken) {
    if (containerBestaat()) {
      draai('docker', ['rm', '-f', CONTAINER]);
      console.log(`Container ${CONTAINER} verwijderd.`);
    } else {
      console.log(`Container ${CONTAINER} bestond niet.`);
    }
    return;
  }

  const superuserUrl = `postgresql://postgres:postgres@127.0.0.1:${poort}/postgres`;
  const migratorUrl = `postgresql://clm_migrator:${WACHTWOORD_MIGRATOR}@127.0.0.1:${poort}/postgres`;
  const runtimeUrl = `postgresql://clm_api_runtime:${WACHTWOORD_RUNTIME}@127.0.0.1:${poort}/postgres`;

  if (containerBestaat()) {
    if (!hergebruik) {
      console.error(
        `\nContainer ${CONTAINER} bestaat al. Geef --hergebruik mee om hem opnieuw\n` +
          `in te richten (rollen/migraties/markering, idempotent), of ruim hem eerst\n` +
          `op: node scripts/test-db-opzetten.js --afbreken\n`,
      );
      process.exit(1);
    }

    if (!containerDraait()) {
      draai('docker', ['start', CONTAINER]);
    }

    console.log(`1/4  Container ${CONTAINER} hergebruikt (poort ${poort}).`);
  } else {
    console.log(`1/4  Nieuwe container ${CONTAINER} op poort ${poort}…`);
    draai('docker', [
      'run',
      '-d',
      '--name',
      CONTAINER,
      '-e',
      'POSTGRES_PASSWORD=postgres',
      '-p',
      `127.0.0.1:${poort}:5432`,
      'postgres:17.6',
    ]);
  }

  console.log('     Wachten tot de database verbindingen accepteert…');
  const gezond = await wachtTotGezond(superuserUrl);
  if (!gezond) {
    console.error('\nDe database accepteert na 30 pogingen nog geen verbinding.');
    process.exit(1);
  }

  console.log('2/4  Rollen aanmaken en wachtwoorden zetten…');
  // `docker exec -i ... -f /dev/stdin` met een input-buffer via spawnSync bleek
  // op deze machine stil te falen (geen foutmelding, geen effect) — vermoedelijk
  // een buffering-eigenaardigheid tussen Node en de Docker CLI op Windows.
  // Kopiëren naar een pad in de container en van daaruit uitvoeren is
  // robuuster: het is dezelfde aanpak als de bestaande scripts al gebruiken
  // voor pg_dump/pg_restore (zie saxombp-backup-productie.sh).
  draai('docker', [
    'cp',
    path.join(PROJECT_DIR, 'db', 'roles', 'bootstrap-roles.sql'),
    `${CONTAINER}:/tmp/bootstrap-roles.sql`,
  ]);
  draai('docker', [
    'exec',
    CONTAINER,
    'psql',
    '-U',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-f',
    '/tmp/bootstrap-roles.sql',
  ]);

  draai('docker', [
    'exec',
    CONTAINER,
    'psql',
    '-U',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `ALTER ROLE clm_migrator PASSWORD '${WACHTWOORD_MIGRATOR}'; ALTER ROLE clm_api_runtime PASSWORD '${WACHTWOORD_RUNTIME}';`,
  ]);

  console.log('3/4  Migraties toepassen (als clm_migrator)…');
  // `npm` is op Windows een .cmd-bestand — spawnSync heeft daarvoor
  // `shell: true` nodig, anders faalt de aanroep zelf stil (geen stdout/
  // stderr, alleen een non-zero exitcode). Zelfde soort .cmd-eigenaardigheid
  // als eerder gedocumenteerd voor Taakplanner-taken (backupcontrole.md).
  // Veilig hier: alle argumenten zijn vaste, hardgecodeerde strings, geen
  // invoer van een gebruiker of bestand die geëscaped zou moeten worden.
  draai('npm', ['run', 'migrate:deploy'], {
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      MIGRATION_DATABASE_URL: migratorUrl,
      DATABASE_URL: migratorUrl,
    },
    cwd: PROJECT_DIR,
  });

  console.log('4/4  Markeren als wegwerp…');
  draai(
    process.platform === 'win32' ? 'node' : 'node',
    ['scripts/markeer-wegwerp.js', toelichting],
    {
      env: { ...process.env, MIGRATION_DATABASE_URL: migratorUrl },
      cwd: PROJECT_DIR,
    },
  );

  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('Klaar. Zet deze twee variabelen voordat je tests draait:\n');
  console.log(`  MIGRATION_DATABASE_URL="${migratorUrl}"`);
  console.log(`  DATABASE_URL="${runtimeUrl}"\n`);
  console.log('PowerShell:');
  console.log(`  $env:MIGRATION_DATABASE_URL = "${migratorUrl}"`);
  console.log(`  $env:DATABASE_URL = "${runtimeUrl}"\n`);
  console.log(`Afbreken: node scripts/test-db-opzetten.js --afbreken`);
  console.log('──────────────────────────────────────────────────────────────');
}

main().catch((err) => {
  console.error('\nMislukt:', err.message);
  process.exit(1);
});
