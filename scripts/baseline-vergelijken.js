#!/usr/bin/env node
// Vergelijkt het schema van een bestaande database met wat migratie 0000 en
// 0001 zouden opleveren. READ-ONLY voor de doeldatabase: dit script schrijft
// daar niets, maakt niets aan en wijzigt niets.
//
// ── Waarom dit bestaat ──────────────────────────────────────────────────────
//
// Issue #25: de Supabase-database `clm-enterprise` staat sinds 27 juli stil op
// de Prisma-migratiehistorie. Drizzle kent die historie niet en zou bij een
// `migrate:deploy` de baseline opnieuw willen uitvoeren op tabellen die al
// bestaan — dat faalt halverwege.
//
// De oplossing is baselining: Drizzle's boekhouding aanleggen met 0000 en 0001
// als "reeds toegepast". Maar dat mag alleen als het bestaande schema ook
// werkelijk overeenkomt met die twee migraties. Het acceptatiecriterium van
// #25 is daar expliciet over: "geverifieerd dat het bestaande schema in
// Supabase daadwerkelijk overeenkomt met de baseline — niet aangenomen."
//
// Zet je vinkjes voor migraties waarvan de inhoud er niet precies zo staat,
// dan denkt Drizzle voortaan dat de database in een toestand is waarin hij
// niet verkeert. Elke volgende migratie bouwt dan voort op een aanname die
// niet klopt, en dat merk je pas als er iets omvalt.
//
// ── Hoe het meet ────────────────────────────────────────────────────────────
//
// Niet door de SQL te lezen en te interpreteren — dat is precies het soort
// redenering dat fout gaat. In plaats daarvan:
//
//   1. Een verse, lege wegwerpcontainer starten.
//   2. Daarop UITSLUITEND 0000 en 0001 draaien.
//   3. Beide databases structureel uitlezen (kolommen, constraints, indexen,
//      RLS, policies, functies) en vergelijken.
//
// De container is de referentie: die is per definitie precies wat 0000 en 0001
// opleveren. Wat daarvan afwijkt in Supabase, is een echt verschil.
//
// ── Gebruik ─────────────────────────────────────────────────────────────────
//
//   node scripts/baseline-vergelijken.js
//
// Leest MIGRATION_DATABASE_URL uit .env als doeldatabase. Vereist Docker.

require('dotenv').config();

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const PG_IMAGE = 'postgres:17.6';
const CONTAINER = `mcm2-baseline-referentie-${Date.now()}`;
const POORT = 55987;

const SCHEMAS = ['clm', 'ref', 'audit'];
const MIGRATIES = [
  '0000_baseline_bestaand_schema.sql',
  '0001_rolrechten.sql',
];

const doelUrl = process.env.MIGRATION_DATABASE_URL;

if (!doelUrl) {
  console.error(
    'MIGRATION_DATABASE_URL ontbreekt. Dit script leest de doeldatabase read-only uit.',
  );
  process.exit(1);
}

// ── Structuurvragen ─────────────────────────────────────────────────────────
//
// Elke query levert een gesorteerde, tekstuele weergave van één aspect van het
// schema. Sorteren is essentieel: PostgreSQL geeft geen gegarandeerde volgorde
// terug, en een verschil in volgorde is geen verschil in schema.

const VRAGEN = {
  tabellen: `
    SELECT table_schema || '.' || table_name AS regel
    FROM information_schema.tables
    WHERE table_schema = ANY($1) AND table_type = 'BASE TABLE'
    ORDER BY 1`,

  kolommen: `
    SELECT table_schema || '.' || table_name || '.' || column_name
           || ' :: ' || data_type
           || COALESCE(' (' || character_maximum_length || ')', '')
           || COALESCE(' num(' || numeric_precision || ',' || numeric_scale || ')', '')
           || CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END
           || COALESCE(' DEFAULT ' || column_default, '') AS regel
    FROM information_schema.columns
    WHERE table_schema = ANY($1)
    ORDER BY 1`,

  constraints: `
    SELECT n.nspname || '.' || t.relname || ' :: ' || c.conname
           || ' :: ' || pg_get_constraintdef(c.oid) AS regel
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = ANY($1)
    ORDER BY 1`,

  indexen: `
    SELECT schemaname || '.' || tablename || ' :: ' || indexname
           || ' :: ' || indexdef AS regel
    FROM pg_indexes
    WHERE schemaname = ANY($1)
    ORDER BY 1`,

  rls: `
    SELECT n.nspname || '.' || c.relname
           || ' :: rls=' || c.relrowsecurity
           || ' force=' || c.relforcerowsecurity AS regel
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY($1) AND c.relkind = 'r'
    ORDER BY 1`,

  policies: `
    SELECT schemaname || '.' || tablename || ' :: ' || policyname
           || ' :: ' || cmd
           || ' :: USING ' || COALESCE(qual, '-')
           || ' :: CHECK ' || COALESCE(with_check, '-') AS regel
    FROM pg_policies
    WHERE schemaname = ANY($1)
    ORDER BY 1`,

  functies: `
    SELECT n.nspname || '.' || p.proname
           || ' :: ' || pg_get_function_result(p.oid)
           || ' :: ' || CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'INVOKER' END AS regel
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = ANY($1)
    ORDER BY 1`,

  triggers: `
    SELECT n.nspname || '.' || c.relname || ' :: ' || t.tgname AS regel
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY($1) AND NOT t.tgisinternal
    ORDER BY 1`,
};

async function leesStructuur(client, label) {
  const uitkomst = {};
  for (const [naam, sql] of Object.entries(VRAGEN)) {
    const { rows } = await client.query(sql, [SCHEMAS]);
    uitkomst[naam] = rows.map((r) => r.regel);
  }
  const totaal = Object.values(uitkomst).reduce((n, v) => n + v.length, 0);
  console.log(`  ${label}: ${totaal} structuurregels gelezen`);
  return uitkomst;
}

function docker(args, opties = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', ...opties });
}

async function bouwReferentie() {
  console.log(`\nReferentiecontainer starten (${PG_IMAGE})...`);

  const start = docker([
    'run', '--rm', '-d',
    '--name', CONTAINER,
    '-e', 'POSTGRES_PASSWORD=referentie',
    '-p', `${POORT}:5432`,
    PG_IMAGE,
  ]);

  if (start.status !== 0) {
    throw new Error(`Container starten mislukt: ${(start.stderr || '').trim()}`);
  }

  // Wachten tot Postgres verbindingen aanneemt.
  let gereed = false;
  for (let poging = 0; poging < 40; poging++) {
    if (docker(['exec', CONTAINER, 'pg_isready', '-U', 'postgres']).status === 0) {
      gereed = true;
      break;
    }
    docker(['exec', CONTAINER, 'sleep', '1']);
  }
  if (!gereed) throw new Error('Referentiecontainer werd niet gereed.');

  // De rollen uit 0001 bestaan niet in een verse container. Aanmaken conform
  // db/roles/bootstrap-roles.sql, anders faalt de GRANT-migratie.
  const rollen = fs.readFileSync(
    path.join(__dirname, '..', 'db', 'roles', 'bootstrap-roles.sql'),
    'utf8',
  );
  const rollenResultaat = docker(
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: rollen },
  );
  if (rollenResultaat.status !== 0) {
    throw new Error(`Rollen aanmaken mislukt: ${(rollenResultaat.stderr || '').trim().slice(0, 400)}`);
  }

  // Uitsluitend 0000 en 0001 — niet de rest. Dat is het hele punt: de
  // container moet de toestand hebben die de baseline oplevert, niet meer.
  for (const bestand of MIGRATIES) {
    const sql = fs
      .readFileSync(path.join(__dirname, '..', 'drizzle', bestand), 'utf8')
      .split('--> statement-breakpoint')
      .join(';\n');

    const res = docker(
      ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
      { input: sql },
    );

    if (res.status !== 0) {
      throw new Error(
        `Migratie ${bestand} faalde op de referentiecontainer:\n${(res.stderr || '').trim().slice(0, 600)}`,
      );
    }
    console.log(`  ${bestand} toegepast`);
  }
}

function vergelijk(referentie, doel) {
  const bevindingen = [];

  for (const aspect of Object.keys(VRAGEN)) {
    const verwacht = new Set(referentie[aspect]);
    const gevonden = new Set(doel[aspect]);

    const ontbreekt = [...verwacht].filter((r) => !gevonden.has(r));
    const extra = [...gevonden].filter((r) => !verwacht.has(r));

    if (ontbreekt.length || extra.length) {
      bevindingen.push({ aspect, ontbreekt, extra });
    }
  }

  return bevindingen;
}

async function main() {
  const referentieClient = new Client({
    connectionString: `postgresql://postgres:referentie@localhost:${POORT}/postgres`,
  });
  const doelClient = new Client({ connectionString: doelUrl });

  try {
    await bouwReferentie();

    console.log('\nStructuren uitlezen...');
    await referentieClient.connect();
    const referentie = await leesStructuur(referentieClient, 'referentie (0000+0001)');

    await doelClient.connect();
    const doel = await leesStructuur(doelClient, 'doeldatabase (read-only)');

    const bevindingen = vergelijk(referentie, doel);

    console.log('\n' + '='.repeat(70));

    if (bevindingen.length === 0) {
      console.log('GELIJK — de doeldatabase komt exact overeen met 0000 + 0001.');
      console.log('Baselining is verantwoord: Drizzle mag beide als toegepast krijgen.');
      console.log('='.repeat(70) + '\n');
      return 0;
    }

    console.log(`VERSCHILLEN GEVONDEN in ${bevindingen.length} aspect(en).\n`);

    for (const b of bevindingen) {
      console.log(`── ${b.aspect.toUpperCase()} ${'─'.repeat(60 - b.aspect.length)}`);

      if (b.ontbreekt.length) {
        console.log(`\n  ONTBREEKT in de doeldatabase (${b.ontbreekt.length}):`);
        b.ontbreekt.forEach((r) => console.log(`    - ${r}`));
      }
      if (b.extra.length) {
        console.log(`\n  EXTRA in de doeldatabase (${b.extra.length}):`);
        b.extra.forEach((r) => console.log(`    + ${r}`));
      }
      console.log('');
    }

    console.log('='.repeat(70));
    console.log('Beoordeel elk verschil vóór je baselinet. Zie Issue #25.');
    console.log('='.repeat(70) + '\n');
    return 1;
  } finally {
    await referentieClient.end().catch(() => {});
    await doelClient.end().catch(() => {});
    docker(['rm', '-f', CONTAINER]);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\nVergelijking mislukt: ${err.message}`);
    docker(['rm', '-f', CONTAINER]);
    process.exit(2);
  });
