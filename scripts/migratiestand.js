#!/usr/bin/env node
'use strict';

/**
 * Leest de migratiestand terug uit een database. Uitsluitend SELECT.
 *
 * ── Waarom dit bestaat ───────────────────────────────────────────────────────
 *
 * "Migraties voltooid" is geen bewijs. Op 2026-08-07 betekende die melding dat
 * er niets was gebeurd — de migratie stond niet in `_journal.json` en Drizzle
 * sloeg hem stil over. In Issue #86 betekende hij dat het op de verkéérde
 * database was gebeurd. Beide keren klopte de melding over iets anders dan waar
 * hij over leek te gaan.
 *
 * Het runbook eist daarom: lees het resultaat terug uit de database. Dit script
 * maakt dat uitvoerbaar in een pipeline, waar niemand meekijkt.
 *
 * ── Waarom een apart script en geen query in de workflow ─────────────────────
 *
 * Een `psql`-aanroep in YAML is niet te testen en niet te lezen. Belangrijker:
 * de vergelijking hoort ergens te staan waar hij toegelicht kan worden. Een
 * onveranderd getal ná een migratie is niet altijd fout — bij een uitrol zonder
 * nieuwe migraties is dat juist correct. Wat wél altijd fout is: nul.
 *
 * ── Gebruik ──────────────────────────────────────────────────────────────────
 *
 *   node scripts/migratiestand.js                     # print het aantal
 *   node scripts/migratiestand.js --verwacht 26       # faalt bij afwijking
 *   node scripts/migratiestand.js --minstens 26       # faalt bij minder
 *   node scripts/migratiestand.js --volgens-journal   # vergelijkt met de repo
 *
 * Die laatste is de bruikbaarste in een pipeline: hij leest het verwachte
 * aantal uit `drizzle/meta/_journal.json` in plaats van uit een getal dat
 * iemand in een workflow heeft getypt. Zo'n getal veroudert bij de volgende
 * migratie, en dan faalt de controle om de verkeerde reden — of erger, hij
 * blijft groen terwijl er iets ontbreekt.
 *
 * Leest MIGRATION_DATABASE_URL. `clm_api_runtime` mag niet bij het
 * drizzle-schema (ADR-009), dus de migratierol is hier nodig — lezen alleen.
 */

require('dotenv/config');

const { Client } = require('pg');

const { meldDoelwit } = require('./db-doelwit.js');

const url = process.env.MIGRATION_DATABASE_URL;

if (!url) {
  console.error(
    'MIGRATION_DATABASE_URL ontbreekt. De migratietabel staat in het\n' +
      'drizzle-schema, en clm_api_runtime mag daar niet bij (ADR-009).',
  );
  process.exit(1);
}

/**
 * Geen `eisToestemmingBuitenLokaal` hier, en dat is een bewuste afwijking van
 * de andere scripts.
 *
 * Die rem beschermt tegen ongewild *schrijven* op een echte database. Dit
 * script doet uitsluitend `SELECT count(*)`. Een leesquery tegen staging of
 * productie is precies wat je wilt kunnen doen zonder een vlag die je went
 * eraan mee te geven — en dat wennen is het echte risico dat het runbook
 * beschrijft.
 *
 * Het doelwit wordt wél altijd gemeld, want een meting op de verkeerde database
 * is een verkeerde meting. Dat was de fout van 2026-08-10.
 */
meldDoelwit(url, 'Migratiestand lezen');

function leesGetal(vlag) {
  const index = process.argv.indexOf(vlag);
  if (index === -1) return null;

  const waarde = Number(process.argv[index + 1]);
  return Number.isInteger(waarde) && waarde >= 0 ? waarde : null;
}

async function main() {
  const client = new Client({
    connectionString: url,
    // Supabase en RDS eisen TLS. `rejectUnauthorized: false` omdat de
    // pooler een certificaat aanbiedt dat niet in de standaardketen van Node
    // zit; dezelfde afweging als in platformbeheerder-inrichten.js.
    ssl: /supabase|amazonaws|neon/.test(url)
      ? { rejectUnauthorized: false }
      : undefined,
    connectionTimeoutMillis: 30_000,
  });

  try {
    await client.connect();
  } catch (fout) {
    console.error(`\nGeen verbinding met de database: ${fout.message}\n`);
    process.exit(1);
  }

  let aantal;

  try {
    const uitkomst = await client.query(
      'SELECT count(*)::int AS aantal FROM drizzle.__drizzle_migrations',
    );
    aantal = uitkomst.rows[0].aantal;
  } catch (fout) {
    // Een ontbrekende tabel is iets anders dan een verbindingsfout, en de
    // oorzaak verschilt: nooit gemigreerd, of geen rechten op het schema.
    console.error(
      `\nKon de migratietabel niet lezen: ${fout.message}\n` +
        'Is deze database ooit gemigreerd, en leest dit de migratierol?\n',
    );
    await client.end();
    process.exit(1);
  }

  await client.end();

  console.log(`Migraties op deze database: ${aantal}`);

  if (aantal === 0) {
    console.error(
      '\nNUL migraties. Dat is nooit goed na een uitrol: het betekent dat de\n' +
        'migratiestap niets heeft gedaan, of tegen een andere database praatte.\n',
    );
    process.exit(1);
  }

  // Het verwachte aantal uit de repository zelf, niet uit een getal dat iemand
  // heeft ingetypt. `migrate()` leest exact dit bestand; wat erin staat is dus
  // per definitie wat er na een geslaagde uitrol op de database hoort te staan.
  if (process.argv.includes('--volgens-journal')) {
    const journal = JSON.parse(
      require('node:fs').readFileSync(
        require('node:path').join(
          __dirname,
          '..',
          'drizzle',
          'meta',
          '_journal.json',
        ),
        'utf8',
      ),
    );

    const verwachtUitJournal = journal.entries.length;

    if (aantal !== verwachtUitJournal) {
      console.error(
        `\nDe database staat op ${aantal}, het journal telt ${verwachtUitJournal}.\n` +
          (aantal < verwachtUitJournal
            ? 'Er zijn migraties NIET toegepast. Dat is precies de fout die\n' +
              '"Migraties voltooid" verborg op 2026-08-07.\n'
            : 'De database loopt vóór op de repository. Draait hier een nieuwere\n' +
              'versie, of wijst dit naar de verkeerde database?\n'),
      );
      process.exit(1);
    }

    console.log(`Gelijk aan het journal (${verwachtUitJournal}).`);
  }

  const verwacht = leesGetal('--verwacht');

  if (verwacht !== null && aantal !== verwacht) {
    console.error(
      `\nVerwacht ${verwacht}, gevonden ${aantal}.\n` +
        'Wijkt de stand af, dan is deze database niet gelijk aan de bron.\n',
    );
    process.exit(1);
  }

  const minstens = leesGetal('--minstens');

  if (minstens !== null && aantal < minstens) {
    console.error(
      `\nVerwacht minstens ${minstens}, gevonden ${aantal}.\n` +
        'Er ontbreken migraties op deze database.\n',
    );
    process.exit(1);
  }
}

main().catch((fout) => {
  console.error(`\nOnverwachte fout: ${fout.message}\n`);
  process.exit(1);
});
