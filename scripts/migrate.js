#!/usr/bin/env node
// Voert de Drizzle-migraties uit via de aparte migratierol clm_migrator,
// nooit via de runtime-rol (DATABASE_URL) en nooit via postgres. Zie ADR-009.
//
// Bewust plain JavaScript, geen TypeScript: dit script draait vóór en los van
// de applicatiebuild, en moet werken zonder ts-node, transpilatiestap of
// module-resolutie-afhankelijkheid (MCM2-CLAUDE.md §5, criterium 7).
require('dotenv').config();

const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const { Pool } = require('pg');

const url = process.env.MIGRATION_DATABASE_URL;

if (!url) {
  console.error(
    'MIGRATION_DATABASE_URL ontbreekt. Migraties draaien via de aparte clm_migrator-rol, niet via DATABASE_URL (de runtime-rol). Zie .env.example.',
  );
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString: url });

  try {
    const { rows } = await pool.query(
      'SELECT current_user AS role, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    console.log(`Migraties draaien als rol '${rows[0]?.role}'.`);

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
