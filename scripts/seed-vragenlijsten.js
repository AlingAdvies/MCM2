#!/usr/bin/env node
// Leest de vragenlijsten uit db/seeds/ in voor één tenant.
//
// Gebruikt bewust hetzelfde importpad als de applicatie (§2d): de validatie,
// de category_key-koppeling en de UUID-generatie komen alle drie uit
// src/survey/vragenlijst-schema.ts. Een eigen INSERT-script hier zou een tweede
// waarheid opleveren die stilzwijgend uit de pas loopt met het echte pad — en
// dat is precies waarom stap 3 vóór stap 4 kwam in de bouwvolgorde.
//
// Plain JavaScript en geen TypeScript, net als scripts/migrate.js: dit draait
// los van de applicatiebuild. De validatie wordt daarom uit de gecompileerde
// dist/ geladen, of — wanneer die er niet is — via ts-node.
//
// Gebruik:
//   node scripts/seed-vragenlijsten.js <tenant-uuid> [bestand.json ...]
//
// Zonder bestandsargumenten worden alle .json-bestanden uit db/seeds/ ingelezen.
require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');

const { sql } = require('drizzle-orm');
const { drizzle } = require('drizzle-orm/node-postgres');
const { Pool } = require('pg');

const { meldDoelwit, eisToestemmingBuitenLokaal } = require('./db-doelwit.js');

const SEEDMAP = path.join(__dirname, '..', 'db', 'seeds');

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Laadt de validatie uit de applicatiecode.
 *
 * Eerst uit dist/ (aanwezig na `npm run build`, en in het productie-image de
 * enige vorm die bestaat), anders via ts-node vanuit src/. Wat we níét doen is
 * de regels hier overtypen: dan zou een strengere controle in de applicatie
 * stilzwijgend niet gelden voor de seed.
 */
function laadValidatie() {
  const uitDist = path.join(
    __dirname,
    '..',
    'dist',
    'survey',
    'vragenlijst-schema.js',
  );

  if (fs.existsSync(uitDist)) {
    return require(uitDist);
  }

  require('ts-node/register');
  return require(
    path.join(__dirname, '..', 'src', 'survey', 'vragenlijst-schema.ts'),
  );
}

function bestandenUitArgumenten(argumenten) {
  // Vlaggen zijn geen bestandsnamen. Zonder deze regel wordt `--extern` gelezen
  // als `db/seeds/--extern`, en dan laadt dit script nul vragenlijsten met de
  // melding dat het bestand niet bestaat — terwijl de aanroeper alleen
  // toestemming voor een niet-lokaal doelwit gaf.
  //
  // Nodig sinds seed-demo-tenant.js zijn doelwitvlaggen doorgeeft (2026-08-09).
  const bestanden = argumenten.filter((naam) => !naam.startsWith('--'));

  if (bestanden.length > 0) {
    return bestanden.map((naam) =>
      path.isAbsolute(naam) ? naam : path.join(SEEDMAP, naam),
    );
  }

  if (!fs.existsSync(SEEDMAP)) {
    return [];
  }

  return fs
    .readdirSync(SEEDMAP)
    .filter((naam) => naam.endsWith('.json'))
    .sort()
    .map((naam) => path.join(SEEDMAP, naam));
}

/**
 * Schrijft één vragenlijst weg binnen de tenantcontext.
 *
 * De tenant komt uit het argument, nooit uit het bestand — dezelfde regel als
 * in de applicatie (Issue #7). valideerVragenlijst() weigert een bestand dat er
 * zelf een meebrengt.
 */
async function importeer(db, tenantId, document) {
  return db.transaction(async (tx) => {
    // Exact dezelfde sleutel als setTenantContext() in src/db/schema.ts:
    // de policies lezen clm.current_tenant_id(), die op 'app.current_tenant_id'
    // staat. Een afwijkende naam levert geen foutmelding op maar een lege
    // context — en dan weigert RLS elke INSERT.
    await tx.execute(
      sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
    );

    const bestaand = await tx.execute(
      sql`SELECT template_id FROM clm.survey_template
           WHERE name = ${document.name} AND version = ${document.version}`,
    );

    // Idempotent: het script moet twee keer te draaien zijn zonder fout. Een
    // seed die de tweede keer omvalt, blokkeert precies het opnieuw opzetten
    // van een omgeving waar hij voor bedoeld is.
    if (bestaand.rows.length > 0) {
      return { overgeslagen: true, templateId: bestaand.rows[0].template_id };
    }

    const template = await tx.execute(
      sql`INSERT INTO clm.survey_template (tenant_id, name, version)
          VALUES (${tenantId}, ${document.name}, ${document.version})
          RETURNING template_id`,
    );

    const templateId = template.rows[0].template_id;
    const categorieIds = new Map();

    for (const categorie of document.categories ?? []) {
      const rij = await tx.execute(
        sql`INSERT INTO clm.survey_category
                (tenant_id, template_id, position, name, min_answers)
            VALUES (${tenantId}, ${templateId}, ${categorie.position},
                    ${categorie.name}, ${categorie.min_answers ?? 0})
            RETURNING category_id`,
      );
      categorieIds.set(categorie.key, rij.rows[0].category_id);
    }

    for (const vraag of document.questions) {
      const sleutel = vraag.category_key;
      const categorieId =
        sleutel === undefined || sleutel === null || sleutel === ''
          ? null
          : categorieIds.get(sleutel);

      await tx.execute(
        sql`INSERT INTO clm.survey_question
                (tenant_id, template_id, category_id, position, question_key,
                 title, body, answer_type, config, is_required,
                 allows_upload, max_files)
            VALUES (${tenantId}, ${templateId}, ${categorieId ?? null},
                    ${vraag.position}, ${vraag.question_key}, ${vraag.title},
                    ${vraag.body}, ${vraag.answer_type},
                    ${JSON.stringify(vraag.config ?? {})}::jsonb,
                    ${vraag.is_required ?? true},
                    ${vraag.allows_upload ?? false}, ${vraag.max_files ?? 0})`,
      );
    }

    return {
      overgeslagen: false,
      templateId,
      categorieen: categorieIds.size,
      vragen: document.questions.length,
    };
  });
}

async function main() {
  const [tenantId, ...rest] = process.argv.slice(2);

  if (!tenantId || !UUID_REGEX.test(tenantId)) {
    console.error(
      'Gebruik: node scripts/seed-vragenlijsten.js <tenant-uuid> [bestand.json ...]',
    );
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error(
      'DATABASE_URL ontbreekt. De seed draait via de runtime-rol clm_api_runtime, net als de applicatie.',
    );
    process.exit(1);
  }

  // Vóór de eerste schrijfactie: deze seed schrijft vragenlijsten weg en kan
  // dus productiedata raken (Issue #86).
  meldDoelwit(url, 'Seed vragenlijsten');

  if (!eisToestemmingBuitenLokaal(url, { wat: 'Seed vragenlijsten' })) {
    process.exit(1);
  }

  const bestanden = bestandenUitArgumenten(rest);

  if (bestanden.length === 0) {
    console.error(`Geen seedbestanden gevonden in ${SEEDMAP}.`);
    process.exit(1);
  }

  const { valideerVragenlijst, VragenlijstOngeldigError } = laadValidatie();
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  try {
    const { rows } = await pool.query(
      'SELECT current_user AS rol, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );

    // Dezelfde startcontrole als DatabaseService: met BYPASSRLS is RLS geen
    // effectieve tenantgrens, en dan zegt een geslaagde seed niets.
    if (rows[0]?.rolbypassrls) {
      console.error(
        `De rol '${rows[0].rol}' heeft BYPASSRLS. Gebruik clm_api_runtime. Zie ADR-008.`,
      );
      process.exit(1);
    }

    console.log(`Seeden als rol '${rows[0]?.rol}' voor tenant ${tenantId}.`);

    for (const bestand of bestanden) {
      const naam = path.basename(bestand);
      let document;

      try {
        document = valideerVragenlijst(
          JSON.parse(fs.readFileSync(bestand, 'utf8')),
        );
      } catch (fout) {
        if (fout instanceof VragenlijstOngeldigError) {
          console.error(`\n${naam} — afgekeurd:`);
          for (const bezwaar of fout.bezwaren) {
            console.error(`  ${bezwaar.pad}: ${bezwaar.melding}`);
          }
          process.exitCode = 1;
          continue;
        }
        throw fout;
      }

      const uitkomst = await importeer(db, tenantId, document);

      if (uitkomst.overgeslagen) {
        console.log(
          `  ${naam}: bestaat al (${document.name} v${document.version}), overgeslagen.`,
        );
      } else {
        console.log(
          `  ${naam}: ${uitkomst.vragen} vragen, ${uitkomst.categorieen} categorieën → ${uitkomst.templateId}`,
        );
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((fout) => {
  console.error('Seeden mislukt:', fout.message);
  process.exit(1);
});
