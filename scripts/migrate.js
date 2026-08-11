#!/usr/bin/env node
// Voert de Drizzle-migraties uit via de aparte migratierol clm_migrator,
// nooit via de runtime-rol (DATABASE_URL) en nooit via postgres. Zie ADR-009.
//
// Bewust plain JavaScript, geen TypeScript: dit script draait vóór en los van
// de applicatiebuild, en moet werken zonder ts-node, transpilatiestap of
// module-resolutie-afhankelijkheid (MCM2-CLAUDE.md §5, criterium 7).
//
// ── Waarom dotenv optioneel is ─────────────────────────────────────────────
//
// `dotenv` staat in devDependencies en zit dus NIET in het productie-image.
// Dat is juist: in een container komen variabelen uit de omgeving, niet uit een
// `.env`-bestand — dat bestand is er niet eens.
//
// Zonder deze try/catch faalt het script daar met MODULE_NOT_FOUND, en dat
// gebeurde bij de eerste uitrol naar acceptatie op 2026-08-10. Erger dan de
// fout zelf was wat eromheen zat: de uitrol meldde "UITGEROLD" en de rookproef
// werd groen, want een backend zonder tabellen antwoordt prima op /health en
// geeft netjes 401 op een beheerroute. Pas een telling in de database liet zien
// dat er nul tabellen stonden.
//
// Vandaar dat de uitrol nu terugleest uit de database in plaats van de
// exitcode te geloven — zie scripts/deploy.js, stap 4.
try {
  require('dotenv').config();
} catch {
  // Geen dotenv: dan draaien we in een container en staan de variabelen al in
  // de omgeving. Geen fout, en bewust geen melding — dit is het normale geval
  // bij een uitrol.
}

const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const { Pool } = require('pg');

const { meldDoelwit, eisOnbeschermdeDatabase } = require('./db-doelwit.js');

const url = process.env.MIGRATION_DATABASE_URL;

if (!url) {
  console.error(
    'MIGRATION_DATABASE_URL ontbreekt. Migraties draaien via de aparte clm_migrator-rol, niet via DATABASE_URL (de runtime-rol). Zie .env.example.',
  );
  process.exit(1);
}

// Vóór de verbinding, niet erna: zie Issue #86. Op 2026-08-06 draaide dit
// script tegen productie terwijl een wegwerpcontainer bedoeld was, en meldde
// alleen de rolnaam — die lokaal precies zo heet.
meldDoelwit(url, 'Migraties');

async function main() {
  // De rem staat binnen main() en niet erboven, want hij vraagt de database
  // zélf wat hij is (stap 5) en dat is een asynchrone leesquery. Vóór de
  // migratiepool, zodat er nog niets gebeurd is als hij weigert.
  if (!(await eisOnbeschermdeDatabase(url, { wat: 'Migraties' }))) {
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });

  try {
    // De rol staat al in de doelwitmelding hierboven; dit is de bevestiging
    // dat de database hem ook werkelijk zo ziet — een URL kan iets anders
    // beweren dan er na verbinden geldt.
    const { rows } = await pool.query(
      'SELECT current_user AS role, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    console.log(`Verbonden als rol '${rows[0]?.role}'.`);

    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    console.log('Migraties voltooid.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migratie mislukt:', err.message);
  process.exit(1);
});
