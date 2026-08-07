#!/usr/bin/env node
// Markeert een database als wegwerp, zodat de e2e-tests er tegen mogen draaien.
//
// Aanleiding: op 2026-08-07 draaiden de e2e-suites tegen de demo-database en
// wisten die leeg. Migratie 0019 zet elke database standaard op 'beschermd';
// dit script is de enige manier om dat om te zetten.
//
// ── Waarom dit een apart script is en geen vlag ──────────────────────────────
//
// Omdat het een handeling moet zijn die je bewust doet en die je terugziet in
// je terminalhistorie. Een omgevingsvariabele die 'wegwerp' afdwingt zou in een
// .env belanden en daarna nooit meer opvallen — precies hoe MIGRATION_DATABASE_URL
// stilzwijgend naar productie bleef wijzen (Issue #86).
//
// ── Wat het weigert ──────────────────────────────────────────────────────────
//
// Een niet-lokale host, tenzij --extern. Een database op Supabase als wegwerp
// markeren is bijna altijd een vergissing, en als het dat niet is, hoort het
// zichtbaar te zijn.
require('dotenv').config();

const { Client } = require('pg');

const { meldDoelwit, eisToestemmingBuitenLokaal } = require('./db-doelwit.js');

const url = process.env.MIGRATION_DATABASE_URL;

if (!url) {
  console.error(
    'MIGRATION_DATABASE_URL ontbreekt. Markeren gaat via de clm_migrator-rol:\n' +
      'clm_api_runtime mag clm.omgeving alleen lezen, en dat is opzet.',
  );
  process.exit(1);
}

meldDoelwit(url, 'Markeren als wegwerp');

if (!eisToestemmingBuitenLokaal(url, { wat: 'Markeren als wegwerp' })) {
  process.exit(1);
}

const toelichting = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0];

async function main() {
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const { rows } = await client.query(
      `UPDATE clm.omgeving
          SET soort = 'wegwerp',
              toelichting = $1,
              gemarkeerd_op = now()
        WHERE id = true
      RETURNING soort, toelichting`,
      [toelichting ?? `Gemarkeerd op ${new Date().toISOString()}`],
    );

    if (rows.length === 0) {
      // Onbereikbaar zolang migratie 0019 is toegepast: die zet de rij neer.
      // Toch expliciet, want een stille no-op zou "gemarkeerd" melden terwijl
      // de tests daarna alsnog weigeren — met een melding die naar de
      // verkeerde oorzaak wijst.
      throw new Error(
        'clm.omgeving heeft geen rij. Is migratie 0019 toegepast?',
      );
    }

    console.log(`Gemarkeerd als '${rows[0].soort}'.`);
    console.log('De e2e-tests mogen nu tegen deze database draaien.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Markeren mislukt:', err.message);
  process.exit(1);
});
