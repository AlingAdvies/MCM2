#!/usr/bin/env node
// Initialiseert Drizzle's migratieboekhouding op een bestaande database, zodat
// migratie 0000 en 0001 als "reeds toegepast" gelden zonder dat hun SQL wordt
// uitgevoerd. Dat heet baselinen.
//
// ── Waarom dit nodig is ─────────────────────────────────────────────────────
//
// Issue #25. Bij de overstap van Prisma naar Drizzle (ADR-010) is de bestaande
// Supabase-database bewust niet aangeraakt: de keten is getest op verse, lege
// containers. Drizzle houdt zijn eigen boekhouding bij en kent de Prisma-
// historie niet, dus een `migrate:deploy` begint bij 0000 — op tabellen die er
// al staan.
//
// Aangetoond op 2026-08-04 tegen een replica van de productiedump: zonder
// baselining faalt de keten meteen op `CREATE SCHEMA "audit"`. Niet netjes
// overgeslagen, maar afgebroken — met een database in een halve toestand.
//
// ── Waarom een script en niet twee INSERT-statements ────────────────────────
//
// Twee dingen gaan bij de handmatige variant mis, en beide zijn op 2026-08-04
// daadwerkelijk gebeurd:
//
//   1. De boekhoudtabel moet eigendom zijn van de migratierol. Maak je hem aan
//      als `postgres`, dan faalt de eerstvolgende migratie op "permission
//      denied for schema clm" — een foutmelding die naar de verkeerde plek
//      wijst en je een half uur kost.
//   2. De hash moet exact overeenkomen met het migratiebestand. Eén spatie
//      verschil en Drizzle beschouwt 0000 als niet-toegepast en probeert hem
//      alsnog.
//
// Dit script berekent de hashes uit de bestanden zelf en zet het eigendom
// goed. Wat overblijft is een besluit, geen typewerk.
//
// ── Veiligheid ──────────────────────────────────────────────────────────────
//
// Draait standaard als PROEF: het toont wat het zou doen en schrijft niets.
// Pas met --uitvoeren wordt er daadwerkelijk geschreven, en dan uitsluitend in
// het schema `drizzle` — nooit in clm, ref of audit. Er wordt geen enkele
// bestaande tabel, rij of policy aangeraakt.
//
// Weigert te draaien als er al migraties zijn vastgelegd: dan is de database
// al gebaselined en zou een tweede run dubbele regels opleveren.
//
// ── Gebruik ─────────────────────────────────────────────────────────────────
//
//   node scripts/baseline-initialiseren.js              proefdraai
//   node scripts/baseline-initialiseren.js --uitvoeren  daadwerkelijk
//
// Leest MIGRATION_DATABASE_URL uit .env. Zie docs/runbooks/baseline-migratiestand.md

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Welke migraties als "reeds toegepast" gelden. Uitsluitend deze twee: zij
// beschrijven het schema zoals Prisma het achterliet. Alles daarna (0002 en
// verder) moet Drizzle wél gewoon uitvoeren.
const BASELINE = ['0000_baseline_bestaand_schema', '0001_rolrechten'];

const uitvoeren = process.argv.includes('--uitvoeren');
const url = process.env.MIGRATION_DATABASE_URL;

if (!url) {
  console.error(
    'MIGRATION_DATABASE_URL ontbreekt. Baselinen gebeurt via clm_migrator, niet via de runtime-rol.',
  );
  process.exit(1);
}

function hashVan(tag) {
  const bestand = path.join(__dirname, '..', 'drizzle', `${tag}.sql`);
  const inhoud = fs.readFileSync(bestand, 'utf8');
  return crypto.createHash('sha256').update(inhoud).digest('hex');
}

function tijdstipVan(tag) {
  const journaal = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'drizzle', 'meta', '_journal.json'), 'utf8'),
  );
  const regel = journaal.entries.find((e) => e.tag === tag);
  if (!regel) throw new Error(`${tag} staat niet in drizzle/meta/_journal.json`);
  return regel.when;
}

async function main() {
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const { rows: wie } = await client.query('SELECT current_user AS rol');
    const veilig = url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');

    console.log(`\nDoeldatabase : ${veilig}`);
    console.log(`Rol          : ${wie[0].rol}`);
    console.log(`Modus        : ${uitvoeren ? 'UITVOEREN — er wordt geschreven' : 'PROEF — er wordt niets geschreven'}\n`);

    // ── Controle 1: is er al gebaselined? ───────────────────────────────────
    const { rows: bestaat } = await client.query(
      "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS aanwezig",
    );

    if (bestaat[0].aanwezig) {
      const { rows: aantal } = await client.query(
        'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
      );
      if (aantal[0].n > 0) {
        console.error(
          `AFGEBROKEN — er staan al ${aantal[0].n} migratie(s) vastgelegd.\n` +
            'Deze database is al gebaselined. Een tweede run zou dubbele regels\n' +
            'opleveren en Drizzle in de war brengen.\n',
        );
        return 1;
      }
      console.log('De boekhoudtabel bestaat al maar is leeg — dat komt van een');
      console.log('afgebroken migratiepoging. Wordt hergebruikt.\n');
    }

    // ── Controle 2: staan de tabellen er werkelijk? ─────────────────────────
    //
    // Baselinen op een lege database zou betekenen dat Drizzle 0000 overslaat
    // terwijl er niets staat — dan mist de hele basis en falen alle volgende
    // migraties op ontbrekende tabellen.
    const { rows: tabellen } = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema IN ('clm','ref','audit') AND table_type = 'BASE TABLE'`,
    );

    if (tabellen[0].n === 0) {
      console.error(
        'AFGEBROKEN — er staat geen enkele tabel in clm, ref of audit.\n' +
          'Baselinen hoort alleen op een database die het baseline-schema al hééft.\n' +
          'Op een lege database draai je gewoon `npm run migrate:deploy`.\n',
      );
      return 1;
    }

    console.log(`Gevonden: ${tabellen[0].n} tabellen in clm, ref en audit.`);
    console.log('(Of die ook overeenkomen met de baseline, meet baseline-vergelijken.js.)\n');

    // ── Wat er gezet gaat worden ────────────────────────────────────────────
    const regels = BASELINE.map((tag) => ({
      tag,
      hash: hashVan(tag),
      when: tijdstipVan(tag),
    }));

    console.log('Wordt vastgelegd als "reeds toegepast":');
    for (const r of regels) {
      console.log(`  ${r.tag}`);
      console.log(`    hash ${r.hash}`);
    }
    console.log('');

    if (!uitvoeren) {
      console.log('PROEF — er is niets geschreven.');
      console.log('Draai opnieuw met --uitvoeren om dit daadwerkelijk vast te leggen.\n');
      return 0;
    }

    // ── Uitvoeren ───────────────────────────────────────────────────────────
    //
    // In één transactie: of alles komt erin, of niets. Een halve boekhouding
    // is erger dan geen boekhouding.
    await client.query('BEGIN');

    await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )`);

    // Het eigendom goedzetten. Dit is de stap die bij handmatig baselinen
    // wordt vergeten en die de eerstvolgende migratie laat falen op
    // "permission denied" — een foutmelding die naar de verkeerde plek wijst.
    const rol = wie[0].rol;
    await client.query(`ALTER SCHEMA drizzle OWNER TO ${client.escapeIdentifier(rol)}`);
    await client.query(
      `ALTER TABLE drizzle.__drizzle_migrations OWNER TO ${client.escapeIdentifier(rol)}`,
    );
    await client.query(
      `ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNER TO ${client.escapeIdentifier(rol)}`,
    );

    for (const r of regels) {
      await client.query(
        'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
        [r.hash, r.when],
      );
    }

    await client.query('COMMIT');

    const { rows: na } = await client.query(
      'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
    );

    console.log(`GEDAAN — ${na[0].n} migratie(s) vastgelegd, eigendom bij '${rol}'.`);
    console.log('\nVolgende stap: npm run migrate:deploy\n');
    return 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\nBaselinen mislukt: ${err.message}\n`);
    process.exit(2);
  });
