#!/usr/bin/env node
// Zaait de standaardset vendor-categorieën voor bestaande tenants, na
// migratie 0034 (#186). Bewust GEEN onderdeel van de migratieketen — zie de
// toelichting in drizzle/0034_coupa_schema_uitbreiding.sql: een migratie
// hoort niet af te hangen van hoeveel tenants of vendors er al bestaan, dus
// die migratie zaait geen data en maakt bestaande vendor.category_code-
// verwijzingen leeg. Dit script is de losse, herhaalbare reparatiestap
// erna, één keer per omgeving handmatig te draaien.
//
// Gebruik:
//   DATABASE_URL=... node scripts/seed-vendor-categorieen.js
//   DATABASE_URL=... node scripts/seed-vendor-categorieen.js --extern
//
// Zonder --extern weigert het script op een beschermde, niet-lokale
// database — zelfde rem als migrate.js. Idempotent: een tenant die al
// categorieën heeft (via het scherm zelf, of een eerdere run van dit
// script) wordt overgeslagen, niet overschreven.
//
// Dit script vult ALLEEN de standaardset aan bij tenants die nog geen
// enkele categorie hebben. Het herstelt NIET automatisch welke vendor
// welke categorie had vóór migratie 0034 — die informatie is bij die
// migratie bewust weggegooid (zie de toelichting daar). Een tenant-admin
// die de oude indeling terug wil, kent zijn eigen leveranciers en kan de
// categorie per vendor opnieuw instellen via het scherm; dit script maakt
// dat mogelijk door de dropdown te vullen, het raadt niet per vendor.
require('dotenv').config();

const { sql } = require('drizzle-orm');
const { drizzle } = require('drizzle-orm/node-postgres');
const { Pool } = require('pg');

const { meldDoelwit, eisOnbeschermdeDatabase } = require('./db-doelwit.js');

const STANDAARD_CATEGORIEEN = [
  { code: 'it_services', label: 'IT-diensten' },
  { code: 'consultancy', label: 'Consultancy' },
  { code: 'maintenance', label: 'Onderhoud' },
  { code: 'consulting', label: 'Advies' },
  { code: 'energy', label: 'Energie' },
  { code: 'facilities', label: 'Facilitair' },
  { code: 'insurance', label: 'Verzekeringen' },
  { code: 'security', label: 'Beveiliging' },
  { code: 'telecom', label: 'Telecom' },
  { code: 'other', label: 'Overig' },
];

async function main() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error('DATABASE_URL ontbreekt.');
    process.exitCode = 1;
    return;
  }

  meldDoelwit(url, 'Vendor-categorieën zaaien');

  if (
    !(await eisOnbeschermdeDatabase(url, { wat: 'Vendor-categorieën zaaien' }))
  ) {
    return;
  }

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  try {
    // clm.tenant staat achter RLS (tenant_isolation-policy) — zonder
    // tenantcontext levert een SELECT daar altijd nul rijen op, en
    // clm_api_runtime heeft geen BYPASSRLS (ADR-008). clm.tenant_register
    // is de RLS-vrije "telefoonlijst" die precies hiervoor bestaat (zie
    // PlatformService, ADR-017): naam en register_id (= het tenant-id,
    // via trigger gelijkgehouden aan clm.tenant — zie migratie 0026),
    // niets tenant-gevoelig.
    const tenants = await db.execute(
      sql`SELECT register_id AS tenant_id, name FROM clm.tenant_register`,
    );

    let geseed = 0;
    let overgeslagen = 0;

    for (const tenant of tenants.rows) {
      // ref.vendor_category heeft wél RLS: elke query hierop moet binnen
      // de tenantcontext van déze tenant lopen, anders levert zowel de
      // SELECT als de INSERT niets op (RLS filtert stil, geen fout — geen
      // foutmelding om op te merken dat er iets mis was).
      //
      // set_config(..., true) is transactie-lokaal, niet sessie-breed —
      // zelfde reden als DatabaseService.withTenant() (src/db/schema.ts,
      // setTenantContext): met een Pool is niet gegarandeerd dat
      // opeenvolgende .execute()-aanroepen dezelfde onderliggende
      // connectie gebruiken, dus een sessie-brede set_config (`false`) zou
      // op een andere aanroep een andere, onbedoelde tenantcontext kunnen
      // laten staan. Eén transactie per tenant maakt dat onmogelijk.
      const resultaat = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('app.current_tenant_id', ${tenant.tenant_id}, true)`,
        );

        const bestaand = await tx.execute(
          sql`SELECT count(*)::int AS aantal FROM ref.vendor_category WHERE tenant_id = ${tenant.tenant_id}`,
        );

        if (bestaand.rows[0].aantal > 0) {
          return 'overgeslagen';
        }

        const rijen = STANDAARD_CATEGORIEEN.map(
          (c) => sql`(${tenant.tenant_id}, ${c.code}, ${c.label})`,
        );

        await tx.execute(
          sql`INSERT INTO ref.vendor_category (tenant_id, code, label) VALUES ${sql.join(rijen, sql`, `)}`,
        );

        return 'geseed';
      });

      if (resultaat === 'overgeslagen') {
        console.log(`  ${tenant.name}: heeft al categorieën, overgeslagen.`);
        overgeslagen += 1;
      } else {
        console.log(
          `  ${tenant.name}: ${STANDAARD_CATEGORIEEN.length} categorieën gezaaid.`,
        );
        geseed += 1;
      }
    }

    console.log(
      `\nKlaar: ${geseed} tenant(s) geseed, ${overgeslagen} overgeslagen.`,
    );

    if (geseed > 0) {
      console.log(
        '\nLET OP: vendors op de geseede tenant(s) tonen nu "geen categorie" ' +
          '(migratie 0034 maakte category_code leeg). Een tenant-admin kent ' +
          'zijn eigen leveranciers en kan de categorie per vendor opnieuw ' +
          'instellen via /beheer/leveranciers.',
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Zaaien mislukt:', err.message);
  process.exitCode = 1;
});
