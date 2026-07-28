#!/usr/bin/env node
// Verifieert dat een database overeenkomt met het Drizzle-schema: tabellen,
// RLS, policies en tenantcontext. Read-only — schrijft niets.
//
// Gebruik (bijv. voor een herstelde backup):
//   VERIFY_DATABASE_URL="postgresql://..." node scripts/verify-schema.js
//
// Zonder VERIFY_DATABASE_URL wordt DATABASE_URL gebruikt.
//
// Bedoeld voor stap 1c van docs/runbooks/supabase-verificatie-en-restoretest.md.
//
// Dit script bevat bewust geen eigen lijst van verwachte tabellen: het draait
// test/schema-conformiteit.e2e-spec.ts, die de verwachting rechtstreeks uit
// src/db/schema.ts afleidt. Eén bron van waarheid, die vanzelf meegroeit
// wanneer er tabellen bijkomen — een tweede lijst hier zou binnen één sprint
// achterlopen.
require('dotenv').config();

const { spawnSync } = require('child_process');

const url = process.env.VERIFY_DATABASE_URL || process.env.DATABASE_URL;

if (!url) {
  console.error(
    'Geen connectiestring. Zet VERIFY_DATABASE_URL (voor een herstelde database) of DATABASE_URL.',
  );
  process.exit(1);
}

// Toon waar we naartoe verbinden, zonder het wachtwoord te lekken.
const beschrijving = url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');
console.log(`\nVerificatie tegen: ${beschrijving}\n`);

const resultaat = spawnSync(
  'npx',
  [
    'jest',
    '--config',
    './test/jest-e2e.json',
    'test/schema-conformiteit.e2e-spec.ts',
  ],
  {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: url },
  },
);

if (resultaat.status === 0) {
  console.log(
    '\nGOEDGEKEURD — schema, RLS en policies komen overeen met src/db/schema.ts.',
  );
  process.exit(0);
}

console.error(
  '\nAFGEKEURD — zie de faalregels hierboven. Elke regel noemt de tabel waar het misgaat.',
);
process.exit(resultaat.status ?? 1);
