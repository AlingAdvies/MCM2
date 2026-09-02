#!/usr/bin/env node
// Meldt via Telegram wanneer een uitgenodigd lid van Transdev Nederland voor
// het eerst inlogt (en daarmee 'actief' wordt op beheer/leden).
//
// ── Waarom dit bestaat ──────────────────────────────────────────────────────
//
// Op beheer/leden is per lid te zien of een uitnodiging nog openstaat of is
// geaccepteerd, maar er is geen melding op het moment zelf — de eigenaar
// moest daarvoor zelf het scherm openen.
//
// ── Waarom dit los draait van de backend ────────────────────────────────────
//
// De acceptatie zelf gebeurt in een SECURITY DEFINER-databasefunctie
// (sessie_aanmaken()), niet in makkelijk uit te breiden applicatiecode. Een
// melding vanuit de server zou een nieuw Telegram-secret op zowel saxombp als
// AWS vragen. Dit script hergebruikt in plaats daarvan het bestaande
// laptop+Telegram-patroon van backup-controle.js: minder ingrijpend, en
// realtime is voor dit doel niet nodig (besluit eigenaar, 2026-09-02).
//
// ── Scope: alleen Transdev Nederland, alleen productie ──────────────────────
//
// Zie docs/superpowers/specs/2026-09-02-telegram-uitnodigingscontrole-design.md
//
// ── Gebruik ─────────────────────────────────────────────────────────────────
//
//   node scripts/uitnodiging-controle.js
//
// Geen productie-schrijfrem (--extern) nodig: dit script leest alleen (SELECT),
// tegen een bewust gekozen, altijd-productie doelwit. meldDoelwit() blijft wel
// verplicht, zodat de uitvoer altijd toont welke database geraakt is.

require('dotenv').config();

const os = require('os');
const path = require('path');
const { Client } = require('pg');

const { meldDoelwit } = require('./db-doelwit');
const { Telegram } = require('./telegram');
const { bepaalNieuweLeden } = require('./uitnodiging-nieuwe-leden');
const { leesGezienIds, schrijfGezienIds } = require('./uitnodiging-status');

const PROJECT_DIR = path.resolve(__dirname, '..');

// Vaste UUID in plaats van een naam-lookup: clm.tenant heeft FORCE ROW LEVEL
// SECURITY (migratie 0011) en clm_api_runtime heeft géén BYPASSRLS
// (ADR-008) — een SELECT op clm.tenant zonder al bekende tenantcontext geeft
// dus altijd nul rijen, ongeacht wat er echt in de tabel staat (zie
// mcm2-nul-rijen-is-geen-bevinding). Opgezocht via clm.tenant_register
// (ADR-017, leesbaar zonder tenantcontext) op 2026-09-02, rol clm_migrator.
const TENANT_NAAM = 'Transdev Nederland';
const TENANT_ID = '4afcb659-63a8-4b16-8a0c-76d2a2d8676e';
const STATUS_PAD = path.join(
  os.homedir(),
  '.mcm2-uitnodigingscontrole',
  'gezien.json',
);

const ROL_LABEL = {
  admin: 'beheerder',
  lezer: 'lezer',
};

async function haalActieveLeden(client, tenantId) {
  // Vereist vóór elke query op een tabel met tenant_isolation-policy: zonder
  // dit ziet clm_api_runtime niets, RLS-conform "nul rijen" — niet "de tabel
  // is leeg" (zie mcm2-nul-rijen-is-geen-bevinding). Derde argument `true`:
  // geldt alleen binnen deze transactie, zelfde patroon als
  // scripts/seed-vragenlijsten.js.
  await client.query('BEGIN');
  await client.query(
    "SELECT set_config('app.current_tenant_id', $1, true)",
    [tenantId],
  );

  // Zelfde statuslogica als TenantLedenService.lijst()
  // (src/tenant/tenant-leden.service.ts): uitnodiging_hash IS NULL
  // betekent geaccepteerd/actief.
  const { rows } = await client.query(
    `SELECT u.user_id, u.full_name, u.email, m.role
       FROM clm.tenant_membership m
       JOIN clm."user" u ON u.user_id = m.user_id
      WHERE m.tenant_id = $1
        AND m.deleted_at IS NULL
        AND m.role <> 'support'
        AND u.uitnodiging_hash IS NULL`,
    [tenantId],
  );
  await client.query('COMMIT');

  return rows.map((r) => ({
    userId: r.user_id,
    naam: r.full_name,
    email: r.email,
    rol: r.role,
  }));
}

function berichtVoor(lid) {
  const rolLabel = ROL_LABEL[lid.rol] ?? lid.rol;
  return (
    `✅ Nieuw lid actief bij ${TENANT_NAAM}\n` +
    `${lid.naam} (${lid.email}) — rol: ${rolLabel}`
  );
}

async function main() {
  const url = process.env.PRODUCTIE_RUNTIME_URL;

  if (!url) {
    console.error(
      'PRODUCTIE_RUNTIME_URL ontbreekt in .env. Dit script leest altijd ' +
        'productie — zonder dat adres kan het niets controleren.',
    );
    process.exitCode = 1;
    return;
  }

  meldDoelwit(url, 'Uitnodigingscontrole');

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30_000,
  });

  let leden;
  try {
    await client.connect();
    leden = await haalActieveLeden(client, TENANT_ID);
  } catch (err) {
    // Bewust geen Telegram-bericht bij een verbindingsfout (spec: geen ruis
    // bij een offline laptop of een gepauzeerde Supabase-database — dat
    // risico wordt al elders bewaakt).
    console.error(`Uitnodigingscontrole mislukt: ${err.message}`);
    process.exitCode = 1;
    return;
  } finally {
    await client.end().catch(() => {});
  }

  const vorige = leesGezienIds(STATUS_PAD);
  const nieuw = bepaalNieuweLeden(vorige, leden);

  const isEersteRun = vorige.size === 0;
  const telegram = new Telegram({
    projectDir: PROJECT_DIR,
    statusDir: path.dirname(STATUS_PAD),
  });

  if (isEersteRun) {
    // Bij de allereerste run staan alle huidige leden per definitie "nieuw"
    // in bepaalNieuweLeden() — zonder deze uitzondering zou de eerste keer
    // draaien een stortvloed aan berichten opleveren voor leden die al lang
    // actief waren.
    console.log(
      `Eerste run: ${leden.length} lid(leden) vastgelegd, geen Telegram-bericht.`,
    );
  } else {
    for (const lid of nieuw) {
      // eslint-disable-next-line no-await-in-loop -- berichten moeten in
      // volgorde en na elkaar verstuurd worden, niet gelijktijdig.
      await telegram.verstuur(berichtVoor(lid));
      console.log(`Gemeld: ${lid.naam} (${lid.email})`);
    }
    if (nieuw.length === 0) {
      console.log('Geen nieuwe actieve leden sinds de vorige controle.');
    }
  }

  schrijfGezienIds(
    STATUS_PAD,
    new Set(leden.map((l) => l.userId)),
  );
}

main().catch((err) => {
  console.error('Uitnodigingscontrole mislukt:', err.message);
  process.exitCode = 1;
});
