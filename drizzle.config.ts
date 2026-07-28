import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Migraties draaien via clm_migrator, nooit via de runtime-rol en nooit via
// postgres. Zie ADR-009 en scripts/with-migration-url.js.
const url = process.env.MIGRATION_DATABASE_URL;

if (!url) {
  throw new Error(
    'MIGRATION_DATABASE_URL ontbreekt. Migraties draaien via de aparte clm_migrator-rol, niet via DATABASE_URL (de runtime-rol). Zie .env.example.',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
  schemaFilter: ['clm', 'ref', 'audit'],
  verbose: true,
  strict: true,
});
