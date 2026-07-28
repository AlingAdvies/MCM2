#!/usr/bin/env node
// Toetst of MCM2 op een andere PostgreSQL-provider draait dan Supabase.
//
// Achtergrond: Supabase Free biedt geen backups en pauzeert projecten na ~7
// dagen inactiviteit (Issue #30). PITR kost daar $100/maand bovenop Pro. Andere
// providers bieden PITR in het plan. Dit script meet hoe reëel een overstap is —
// in plaats van dat te beredeneren.
//
// Gebruik:
//   TARGET_MIGRATION_URL="postgresql://...eigenaar..." \
//   TARGET_RUNTIME_URL="postgresql://...runtime..." \
//   node scripts/provider-migratietest.js
//
// Read-only voor de bronomgeving: dit script raakt Supabase niet. Het draait
// uitsluitend tegen de doelomgeving.
require('dotenv').config();

const { spawnSync } = require('child_process');
const { Client } = require('pg');

const migrationUrl = process.env.TARGET_MIGRATION_URL;
const runtimeUrl = process.env.TARGET_RUNTIME_URL || migrationUrl;

if (!migrationUrl) {
  console.error(`
TARGET_MIGRATION_URL ontbreekt.

Gebruik de connectiestring van de DOELprovider, niet die van Supabase.
Strip een eventuele ?schema=-parameter: pg_dump en sommige drivers weigeren die.

  TARGET_MIGRATION_URL="postgresql://user:pw@host/db?sslmode=require" \\
  node scripts/provider-migratietest.js
`);
  process.exit(1);
}

const bevindingen = [];
const stappen = [];

const meld = (ok, tekst, detail) => {
  console.log(`${ok ? '  OK  ' : ' FOUT '} ${tekst}${detail ? ` — ${detail}` : ''}`);
  if (!ok) bevindingen.push(`${tekst}${detail ? `: ${detail}` : ''}`);
  stappen.push({ ok, tekst, detail });
};

const maskeer = (url) => url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');

async function query(url, sql, params) {
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 30000,
  });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

async function main() {
  console.log(`\nMigratietest naar: ${maskeer(migrationUrl)}\n`);

  // ── 1. Verbinding en versie ─────────────────────────────────────────────
  let versie = '?';
  try {
    const r = await query(migrationUrl, 'SHOW server_version');
    versie = r.rows[0].server_version;
    meld(true, 'Verbinding werkt', `PostgreSQL ${versie}`);
  } catch (err) {
    meld(false, 'Verbinding werkt', err.message);
    return rapporteer();
  }

  // Supabase draait 17.6. Een lagere major kan syntaxverschillen opleveren.
  const major = parseInt(versie, 10);
  meld(
    major >= 17,
    'Versie is 17 of hoger (Supabase draait 17.6)',
    `gevonden: ${versie}`,
  );

  // ── 2. Rolrechten ───────────────────────────────────────────────────────
  // De rollenbootstrap maakt clm_migrator, clm_api_runtime en drie andere
  // rollen aan. Providers verschillen sterk in wat een gewone gebruiker mag:
  // CREATE ROLE is bij sommige managed diensten voorbehouden aan de beheerder.
  try {
    const r = await query(
      migrationUrl,
      'SELECT current_user AS rol, rolcreaterole, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    const rol = r.rows[0];
    console.log(
      `\nVerbonden als '${rol.rol}' — CREATE ROLE: ${rol.rolcreaterole}, superuser: ${rol.rolsuper}, BYPASSRLS: ${rol.rolbypassrls}\n`,
    );
    meld(
      rol.rolcreaterole === true,
      'Mag rollen aanmaken (nodig voor bootstrap-roles.sql)',
      rol.rolcreaterole ? undefined : 'CREATE ROLE ontbreekt',
    );
  } catch (err) {
    meld(false, 'Rolrechten opvragen', err.message);
  }

  // ── 3. Schemarechten ────────────────────────────────────────────────────
  try {
    await query(migrationUrl, 'CREATE SCHEMA IF NOT EXISTS mcm2_migratietest');
    await query(migrationUrl, 'DROP SCHEMA mcm2_migratietest');
    meld(true, 'Mag schemas aanmaken en verwijderen');
  } catch (err) {
    meld(false, 'Mag schemas aanmaken', err.message);
  }

  // ── 4. gen_random_uuid() ────────────────────────────────────────────────
  // Sinds PostgreSQL 13 ingebouwd, maar sommige providers beperken pgcrypto.
  // Zonder deze functie faalt migratie 0002 (Issue #29).
  try {
    const r = await query(migrationUrl, 'SELECT gen_random_uuid() AS id');
    meld(
      typeof r.rows[0].id === 'string' && r.rows[0].id.length === 36,
      'gen_random_uuid() beschikbaar (nodig voor migratie 0002)',
    );
  } catch (err) {
    meld(false, 'gen_random_uuid() beschikbaar', err.message);
  }

  // ── 5. Rollen bootstrappen ──────────────────────────────────────────────
  console.log('\nRollen bootstrappen...');
  const bootstrap = spawnSync(
    'node',
    [
      '-e',
      `
      const { Client } = require('pg');
      const fs = require('fs');
      (async () => {
        const c = new Client({ connectionString: process.env.U });
        await c.connect();
        try { await c.query(fs.readFileSync('db/roles/bootstrap-roles.sql','utf8')); }
        finally { await c.end(); }
      })().catch(e => { console.error(e.message); process.exit(1); });
      `,
    ],
    { env: { ...process.env, U: migrationUrl }, encoding: 'utf8' },
  );
  meld(
    bootstrap.status === 0,
    'Rollenbootstrap uitgevoerd',
    bootstrap.status === 0 ? undefined : (bootstrap.stderr || '').trim().split('\n')[0],
  );

  // De bootstrap maakt de rollen aan zonder wachtwoord. Zonder wachtwoord kan
  // er niet mee ingelogd worden, dus TARGET_RUNTIME_URL zou falen. Zet er een
  // als de aanroeper dat nog niet deed.
  if (bootstrap.status === 0 && runtimeUrl !== migrationUrl) {
    const wachtwoord = new URL(runtimeUrl).password;
    if (wachtwoord) {
      try {
        // ALTER ROLE accepteert geen queryparameters, en een DO-blok evenmin.
        // Daarom in twee stappen: eerst het statement veilig laten opbouwen
        // door PostgreSQL zelf (format met %I/%L escapet identifier en literal),
        // dan uitvoeren. Zo staat er nergens geïnterpoleerde invoer in SQL.
        const rolnaam = new URL(runtimeUrl).username.split('.')[0];
        const { rows } = await query(
          migrationUrl,
          'SELECT format($1, $2::text, $3::text) AS stmt',
          ['ALTER ROLE %I PASSWORD %L', rolnaam, wachtwoord],
        );
        await query(migrationUrl, rows[0].stmt);
        meld(true, `Wachtwoord gezet op rol '${rolnaam}'`);
      } catch (err) {
        meld(false, 'Wachtwoord zetten op de runtime-rol', err.message);
      }
    }
  }

  // ── 6. Migraties ────────────────────────────────────────────────────────
  console.log('\nMigraties toepassen...');
  const migratie = spawnSync('node', ['scripts/migrate.js'], {
    env: { ...process.env, MIGRATION_DATABASE_URL: migrationUrl },
    encoding: 'utf8',
  });
  console.log((migratie.stdout || '').trim());
  meld(
    migratie.status === 0,
    'Volledige migratieketen toegepast',
    migratie.status === 0 ? undefined : (migratie.stderr || '').trim().split('\n')[0],
  );

  if (migratie.status !== 0) return rapporteer();

  // ── 7. Conformiteit en tenant-isolatie ──────────────────────────────────
  console.log('\nTests draaien tegen de doelomgeving...\n');
  const tests = spawnSync(
    'npx',
    ['jest', '--config', './test/jest-e2e.json'],
    {
      env: { ...process.env, DATABASE_URL: runtimeUrl },
      stdio: 'inherit',
      shell: true,
    },
  );
  meld(
    tests.status === 0,
    'Alle e2e-tests groen (schema, RLS, tenant-isolatie, defaults)',
  );

  rapporteer();
}

function rapporteer() {
  console.log('\n' + '─'.repeat(70));
  if (bevindingen.length === 0) {
    console.log(
      'GESCHIKT — deze provider draait MCM2 zonder aanpassingen aan schema,\nmigraties, rollen of RLS.',
    );
    process.exit(0);
  }
  console.error(`NIET ZONDER MEER GESCHIKT — ${bevindingen.length} bevinding(en):`);
  bevindingen.forEach((b) => console.error(`  - ${b}`));
  console.error(
    '\nElke bevinding is werk dat een overstap zou kosten. Weeg dat tegen\nhet kostenverschil; zie ADR-011 en Issue #30.',
  );
  process.exit(1);
}

main().catch((err) => {
  console.error('\nMigratietest afgebroken:', err.message);
  process.exit(1);
});
