#!/usr/bin/env node
require('dotenv').config();

if (!process.env.MIGRATION_DATABASE_URL) {
  console.error(
    'MIGRATION_DATABASE_URL ontbreekt. Migraties draaien via de aparte clm_migrator-rol, niet via DATABASE_URL (de runtime-rol). Zie .env.example.',
  );
  process.exit(1);
}

const { spawnSync } = require('child_process');
const [command, ...args] = process.argv.slice(2);

const result = spawnSync(command, args, {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DATABASE_URL: process.env.MIGRATION_DATABASE_URL },
});

process.exit(result.status ?? 1);
