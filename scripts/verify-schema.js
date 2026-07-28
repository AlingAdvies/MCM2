#!/usr/bin/env node
// Verifieert dat een database het verwachte MCM2-schema bevat: tabellen, RLS,
// policies en de tenantcontext-functie. Read-only — schrijft niets.
//
// Gebruik:
//   node scripts/verify-schema.js                  (gebruikt DATABASE_URL)
//   VERIFY_DATABASE_URL="postgresql://..." node scripts/verify-schema.js
//
// Bedoeld voor stap 1c van docs/runbooks/supabase-verificatie-en-restoretest.md:
// bewijzen dat een herstelde backup daadwerkelijk het volledige schema bevat,
// niet alleen "de database bestaat en ik kan inloggen".
require('dotenv').config();

const { Client } = require('pg');

const VERWACHTE_TABELLEN = {
  clm: ['tenant', 'user', 'vendor', 'vendor_contact', 'vendor_tag'],
  ref: ['vendor_category', 'business_criticality', 'compliance_status'],
  audit: ['audit_event'],
};

// De zes tenantgebonden tabellen; ref is bewust tenant-agnostisch zonder RLS.
const VERWACHTE_RLS = [
  'clm.tenant',
  'clm.user',
  'clm.vendor',
  'clm.vendor_contact',
  'clm.vendor_tag',
  'audit.audit_event',
];

const url = process.env.VERIFY_DATABASE_URL || process.env.DATABASE_URL;

if (!url) {
  console.error(
    'Geen connectiestring. Zet VERIFY_DATABASE_URL (voor een herstelde database) of DATABASE_URL.',
  );
  process.exit(1);
}

const bevindingen = [];
const meld = (ok, tekst) => {
  console.log(`${ok ? '  OK  ' : ' FOUT '} ${tekst}`);
  if (!ok) bevindingen.push(tekst);
};

async function main() {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 20000 });
  await client.connect();

  try {
    const { rows: versie } = await client.query('SHOW server_version');
    const { rows: rol } = await client.query(
      'SELECT current_user AS rol, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    console.log(`\nPostgreSQL ${versie[0].server_version}, verbonden als '${rol[0].rol}'.\n`);

    console.log('Tabellen:');
    const { rows: tabellen } = await client.query(
      `SELECT table_schema, table_name FROM information_schema.tables
        WHERE table_schema IN ('clm','ref','audit')`,
    );
    const aanwezig = new Set(tabellen.map((t) => `${t.table_schema}.${t.table_name}`));

    for (const [schema, namen] of Object.entries(VERWACHTE_TABELLEN)) {
      for (const naam of namen) {
        meld(aanwezig.has(`${schema}.${naam}`), `${schema}.${naam}`);
      }
    }

    console.log('\nRow Level Security:');
    const { rows: rls } = await client.query(
      `SELECT schemaname||'.'||tablename AS tabel, rowsecurity
         FROM pg_tables WHERE schemaname IN ('clm','audit')`,
    );
    const rlsAan = new Set(rls.filter((r) => r.rowsecurity).map((r) => r.tabel));

    for (const tabel of VERWACHTE_RLS) {
      meld(rlsAan.has(tabel), `RLS actief op ${tabel}`);
    }

    console.log('\nPolicies (elk met USING en WITH CHECK):');
    const { rows: policies } = await client.query(
      `SELECT schemaname||'.'||tablename AS tabel, policyname, qual, with_check
         FROM pg_policies WHERE schemaname IN ('clm','audit')`,
    );

    for (const tabel of VERWACHTE_RLS) {
      const p = policies.find((x) => x.tabel === tabel);
      if (!p) {
        meld(false, `policy op ${tabel} ontbreekt`);
      } else {
        meld(
          Boolean(p.qual) && Boolean(p.with_check),
          `${p.policyname} op ${tabel}${p.with_check ? '' : ' — WITH CHECK ONTBREEKT'}`,
        );
      }
    }

    console.log('\nTenantcontext:');
    try {
      await client.query(
        "SELECT set_config('app.current_tenant_id', '00000000-0000-0000-0000-0000000000aa', false)",
      );
      const { rows } = await client.query('SELECT clm.current_tenant_id() AS id');
      meld(
        rows[0].id === '00000000-0000-0000-0000-0000000000aa',
        'clm.current_tenant_id() leest de sessievariabele correct',
      );
    } catch (err) {
      meld(false, `clm.current_tenant_id() faalt: ${err.message}`);
    }

    console.log('\nRijaantallen (ter vergelijking met het origineel):');
    for (const [schema, namen] of Object.entries(VERWACHTE_TABELLEN)) {
      for (const naam of namen) {
        if (!aanwezig.has(`${schema}.${naam}`)) continue;
        try {
          const { rows } = await client.query(
            `SELECT count(*)::int AS n FROM "${schema}"."${naam}"`,
          );
          // Tenantgebonden tabellen tonen 0 zonder tenant-context: dat is RLS
          // die werkt, geen lege tabel. Alleen ref is direct leesbaar.
          console.log(`       ${schema}.${naam}: ${rows[0].n}`);
        } catch (err) {
          console.log(`       ${schema}.${naam}: niet leesbaar (${err.message})`);
        }
      }
    }
  } finally {
    await client.end();
  }

  console.log('');
  if (bevindingen.length > 0) {
    console.error(`AFGEKEURD — ${bevindingen.length} bevinding(en):`);
    bevindingen.forEach((b) => console.error(`  - ${b}`));
    process.exit(1);
  }
  console.log('GOEDGEKEURD — schema, RLS, policies en tenantcontext compleet.');
}

main().catch((err) => {
  console.error('Verificatie mislukt:', err.message);
  process.exit(1);
});
