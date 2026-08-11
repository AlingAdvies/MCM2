#!/usr/bin/env node
'use strict';

/**
 * De poort vóór een uitrol naar productie. Weigert, of laat door.
 *
 * ── Waarom een poort en geen checklist ───────────────────────────────────────
 *
 * Stap 4 van het OTAP-plan noemt vier remmen. Drie ervan zijn af te dwingen
 * vóórdat er iets gebeurt, en dit script is die drie:
 *
 *   1. er is een gecontroleerde, actuele backup
 *   2. staging draait op dezelfde migratiestand als de repository
 *   3. productie loopt niet vóór op staging
 *
 * De vierde — een handmatig akkoord — kan een script niet geven; dat is een
 * GitHub Environment met een required reviewer.
 *
 * Een checklist in een runbook wordt overgeslagen op precies de dag dat het
 * ertoe doet. Dit script staat in de weg.
 *
 * ── Waarom staging hier meedoet ──────────────────────────────────────────────
 *
 * "Wat op staging is goedgekeurd, is bit voor bit wat naar productie gaat" (§2
 * van het plan). Dat is een bewering, en tot nu toe controleerde niets hem.
 * Staat staging niet op de stand van de repository, dan is er dus niets
 * beproefd op de database die op productie lijkt — en dan is de belangrijkste
 * reden dat staging bestaat weggevallen.
 *
 * ── Gebruik ──────────────────────────────────────────────────────────────────
 *
 *   node scripts/productie-poort.js
 *
 * Verwacht in de omgeving:
 *   STAGING_MIGRATION_DATABASE_URL     lezen — de stand van staging
 *   PRODUCTIE_MIGRATION_DATABASE_URL   lezen — de stand van productie
 *
 * Beide uitsluitend voor `SELECT count(*)`. Dit script schrijft nergens.
 *
 * Vlaggen:
 *   --backup-max-uren <n>   hoe oud de backupcontrole mag zijn (standaard 36)
 *   --zonder-backup         sla de backuprem over; eist een reden
 *
 * Zie docs/architectuur/plan-otap-straat-met-staging.md §3.4 en
 * docs/runbooks/uitrol-acceptatie-en-productie.md.
 */

require('dotenv/config');

const fs = require('node:fs');
const path = require('node:path');

const { Client } = require('pg');

const BEWIJS_PAD = path.join(
  __dirname,
  '..',
  'docs',
  'runbooks',
  'backup-bewijs.json',
);

const JOURNAL_PAD = path.join(
  __dirname,
  '..',
  'drizzle',
  'meta',
  '_journal.json',
);

/** Standaard even ruim als backup-controle.js: één overgeslagen dag mag. */
const STANDAARD_MAX_UREN = 36;

function leesVlag(naam) {
  const index = process.argv.indexOf(naam);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

/**
 * Rem 1 — is er een gecontroleerde, actuele backup?
 *
 * Let op wat hier getoetst wordt: niet of er een dumpbestand bestaat, maar of
 * de *controle* gedraaid heeft en niets gevonden heeft. Dat onderscheid is de
 * les van 2026-08-04, toen alle dumps keurig vers waren en al maanden negen van
 * de achttien tabellen misten.
 *
 * Het bewijs komt uit `backup-controle.js` op de machine van de eigenaar. Een
 * CI-runner kan niet bij die backup, dus de controle laat een spoor achter in
 * de repository en de runner leest dat.
 */
function toetsBackup(maxUren) {
  if (!fs.existsSync(BEWIJS_PAD)) {
    return {
      goed: false,
      regel: 'Backup: GEEN BEWIJS',
      uitleg:
        'Er staat geen backup-bewijs in de repository.\n\n' +
        'Draai op de machine met de backups:\n' +
        '  npm run backup:controle\n\n' +
        'en commit docs/runbooks/backup-bewijs.json.',
    };
  }

  let bewijs;

  try {
    bewijs = JSON.parse(fs.readFileSync(BEWIJS_PAD, 'utf8'));
  } catch (fout) {
    return {
      goed: false,
      regel: 'Backup: BEWIJS ONLEESBAAR',
      uitleg: `Het bewijsbestand is geen geldige JSON: ${fout.message}`,
    };
  }

  const gecontroleerd = Date.parse(bewijs.gecontroleerdOp);

  if (Number.isNaN(gecontroleerd)) {
    return {
      goed: false,
      regel: 'Backup: BEWIJS ZONDER DATUM',
      uitleg:
        'Het bewijsbestand heeft geen bruikbare `gecontroleerdOp`. ' +
        'Draai de backupcontrole opnieuw.',
    };
  }

  const uren = (Date.now() - gecontroleerd) / 3_600_000;

  if (uren > maxUren) {
    return {
      goed: false,
      regel: `Backup: TE OUD (${Math.round(uren)} uur)`,
      uitleg:
        `De laatste backupcontrole was ${Math.round(uren)} uur geleden; ` +
        `de grens staat op ${maxUren}.\n\n` +
        'Draai op de machine met de backups:\n' +
        '  npm run backup:dump && npm run backup:controle\n\n' +
        'en commit het bijgewerkte bewijs.',
    };
  }

  // Een bewijs dat problemen meldt is geen groen licht. Dit is het geval waar
  // het echt om gaat: de backup bestaat, is vers, en deugt niet.
  if (bewijs.goed !== true) {
    return {
      goed: false,
      regel: 'Backup: CONTROLE MELDDE PROBLEMEN',
      uitleg:
        'De backupcontrole is recent gedraaid en vond problemen:\n' +
        `  ${(bewijs.problemen ?? []).join(', ') || '(niet gespecificeerd)'}\n\n` +
        'Los die eerst op. Een uitrol zonder werkend vangnet is precies wat\n' +
        'deze rem moet tegenhouden.',
    };
  }

  return {
    goed: true,
    regel:
      `Backup: OK (${Math.round(uren)} uur oud, lagen ` +
      `${(bewijs.lagen ?? []).join('+')}, ${bewijs.dumpNaam})`,
  };
}

/** Het aantal migraties dat de repository voorschrijft. */
function journalStand() {
  const journal = JSON.parse(fs.readFileSync(JOURNAL_PAD, 'utf8'));
  return journal.entries.length;
}

/** Leest `count(*)` uit de migratietabel. Uitsluitend SELECT. */
async function migratiestand(url, wat) {
  const client = new Client({
    connectionString: url,
    ssl: /supabase|amazonaws|neon/.test(url)
      ? { rejectUnauthorized: false }
      : undefined,
    connectionTimeoutMillis: 30_000,
  });

  try {
    await client.connect();
    const uitkomst = await client.query(
      'SELECT count(*)::int AS aantal FROM drizzle.__drizzle_migrations',
    );
    return { aantal: uitkomst.rows[0].aantal };
  } catch (fout) {
    return { fout: `${wat}: ${fout.message}` };
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const maxUren = Number(leesVlag('--backup-max-uren') ?? STANDAARD_MAX_UREN);
  const zonderBackup = process.argv.includes('--zonder-backup');

  console.log('');
  console.log('Poort vóór de uitrol naar productie');
  console.log('─'.repeat(70));

  const bevindingen = [];
  const blokkades = [];

  // ── Rem 1: de backup ──────────────────────────────────────────────────────
  if (zonderBackup) {
    // Overslaan mag, maar niet stilzwijgend. Dit is de ontsnappingsklep voor
    // een noodherstel — en die hoort in het log te staan, zodat achteraf
    // navolgbaar is dat er zonder vangnet is uitgerold.
    bevindingen.push('Backup: OVERGESLAGEN (--zonder-backup)');
    console.log(
      '\n  LET OP: de backuprem is bewust overgeslagen. Dit hoort alleen bij\n' +
        '  een noodherstel, en het staat nu in het log van deze run.\n',
    );
  } else {
    const backup = toetsBackup(maxUren);
    bevindingen.push(backup.regel);
    if (!backup.goed) blokkades.push(backup.uitleg);
  }

  // ── Rem 2 en 3: de migratiestanden ────────────────────────────────────────
  const verwacht = journalStand();
  bevindingen.push(`Repository: ${verwacht} migraties in het journal`);

  const stagingUrl = process.env.STAGING_MIGRATION_DATABASE_URL;
  const productieUrl = process.env.PRODUCTIE_MIGRATION_DATABASE_URL;

  if (!stagingUrl || !productieUrl) {
    blokkades.push(
      'STAGING_MIGRATION_DATABASE_URL en/of PRODUCTIE_MIGRATION_DATABASE_URL\n' +
        'ontbreken. Zonder beide is er niets te vergelijken.',
    );
  } else {
    const staging = await migratiestand(stagingUrl, 'staging');
    const productie = await migratiestand(productieUrl, 'productie');

    if (staging.fout) {
      bevindingen.push('Staging: ONBEREIKBAAR');
      blokkades.push(`Staging niet te lezen — ${staging.fout}`);
    } else {
      bevindingen.push(`Staging: ${staging.aantal} migraties`);

      // Staging moet op de stand van de repository staan. Staat hij lager, dan
      // is deze versie daar nooit gedraaid en bewijst "goedgekeurd op staging"
      // niets. Staat hij hoger, dan draait daar iets nieuwers dan wat je nu
      // uitrolt — en dan rol je een oudere versie naar productie.
      if (staging.aantal !== verwacht) {
        blokkades.push(
          `Staging staat op ${staging.aantal}, de repository op ${verwacht}.\n` +
            (staging.aantal < verwacht
              ? 'Deze versie is nooit op staging gedraaid. Er is dus niets\n' +
                'beproefd op een database die op productie lijkt.'
              : 'Staging loopt vóór op deze code. Rol je nu uit, dan gaat er een\n' +
                'oudere versie naar productie dan wat er beproefd is.'),
        );
      }
    }

    if (productie.fout) {
      bevindingen.push('Productie: ONBEREIKBAAR');
      blokkades.push(`Productie niet te lezen — ${productie.fout}`);
    } else {
      bevindingen.push(`Productie: ${productie.aantal} migraties`);

      // Productie mag achterlopen — dat is normaal vlak vóór een uitrol. Wat
      // niet mag: productie vóór op de repository. Dan draait daar iets dat
      // niet uit deze code komt, en overschrijven is dan geen uitrol maar
      // verlies.
      if (productie.aantal > verwacht) {
        blokkades.push(
          `Productie staat op ${productie.aantal}, de repository op ${verwacht}.\n` +
            'Productie loopt VÓÓR op deze code. Dat hoort niet te kunnen:\n' +
            'draait daar iets dat hier niet in zit, of wijst dit naar de\n' +
            'verkeerde database?',
        );
      }
    }
  }

  // ── Uitkomst ──────────────────────────────────────────────────────────────
  console.log('');
  for (const regel of bevindingen) console.log(`  ${regel}`);
  console.log('');

  if (blokkades.length > 0) {
    console.error('─'.repeat(70));
    console.error('');
    console.error(`GEBLOKKEERD — ${blokkades.length} reden(en):`);
    console.error('');
    for (const blokkade of blokkades) {
      console.error(
        blokkade
          .split('\n')
          .map((r) => `  ${r}`)
          .join('\n'),
      );
      console.error('');
    }
    process.exit(1);
  }

  console.log('─'.repeat(70));
  console.log('');
  console.log('  DOOR — de drie automatische remmen geven groen licht.');
  console.log('');
  console.log('  De vierde rem is een mens: het akkoord op de GitHub');
  console.log('  Environment `productie`.');
  console.log('');
}

main().catch((fout) => {
  console.error(`\nOnverwachte fout in de poort: ${fout.message}\n`);
  process.exit(1);
});
