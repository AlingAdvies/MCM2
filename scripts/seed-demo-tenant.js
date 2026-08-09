#!/usr/bin/env node
// Vult één demo-tenant met samenhangende voorbeelddata: gebruikers met
// membership, leveranciers met contactpersonen, beide vragenlijsten en een
// lopende ronde met responses in drie stadia.
//
// Bedoeld om schermen te kunnen tonen en doorlopen zonder klantdata. Draait
// ongewijzigd tegen een lokale wegwerpdatabase én tegen acceptatie: de enige
// invoer is DATABASE_URL.
//
// Gebruik:
//   DATABASE_URL=... node scripts/seed-demo-tenant.js
//   DATABASE_URL=... node scripts/seed-demo-tenant.js --verwijder
//   DATABASE_URL=... node scripts/seed-demo-tenant.js --echte-tokens
//
// `--echte-tokens` genereert willekeurige tokens in plaats van de vaste uit
// dit bestand, en drukt ze één keer af. Bedoeld voor een echte omgeving: daar
// hoort een demo-tenant niet te verschillen van een klant. Zie ECHTE_TOKENS.
//
// ── Drie dingen die dit script bewust NIET doet ──────────────────────────────
//
// 1. RLS uitzetten. Het draait als clm_api_runtime, dezelfde rol als de
//    applicatie, en weigert te starten bij BYPASSRLS — net als
//    seed-vragenlijsten.js en DatabaseService. Een seed die de tenantgrens
//    omzeilt bewijst niet dat de data via de normale weg bereikbaar is, en dat
//    is juist wat een demo moet laten zien.
//
// 2. De tenant van otap-doorloop.js aanraken. Die claimt
//    11111111-1111-1111-1111-111111111111 en ruimt hem zelf op. Twee scripts
//    die dezelfde rijen claimen gaan elkaar in de weg zitten; dit is
//    uitdrukkelijk geen testfixture (plan §4, fase 3).
//
// 3. Echte Entra-identiteiten verzinnen. Zie DEMO_SUBJECT_PREFIX hieronder.
require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { sql } = require('drizzle-orm');
const { drizzle } = require('drizzle-orm/node-postgres');
const { Pool } = require('pg');

const {
  meldDoelwit,
  eisToestemmingBuitenLokaal,
  eisWegwerpdatabase,
} = require('./db-doelwit.js');

// Vast UUID, zodat het script idempotent is en `--verwijder` precies weet wat
// het weghaalt. Bewust niet 1111.../2222..., die zijn in gebruik bij
// otap-doorloop.js en de e2e-suites.
const STANDAARD_TENANT_ID = 'dededede-0000-4000-8000-000000000001';
const STANDAARD_TENANT_NAAM = 'Demo (voorbeelddata)';

/**
 * Naar welke tenant deze seed schrijft.
 *
 * ── Waarom dit instelbaar is ────────────────────────────────────────────────
 *
 * Tot 2026-08-09 stond hier alleen het vaste UUID hierboven, en dat is voor de
 * demo-database precies goed: één herkenbare tenant die het script zelf
 * aanmaakt en zelf opruimt.
 *
 * Maar de eigenaar wilde dezelfde voorbeelddata in een bestáánde tenant
 * (AlingAdvies, aangemaakt via de platformroute), om die als demo-omgeving te
 * gebruiken. Zonder deze vlag zou het script daar een tweede tenant naast
 * zetten in plaats van de bestaande te vullen.
 *
 * ── Wat de vlag NIET doet ───────────────────────────────────────────────────
 *
 * Een tenant aanmaken die niet bestaat. Bij `--tenant` moet de tenant er al
 * zijn: die hoort via de platformroute te ontstaan, met een uitnodiging voor
 * zijn beheerder. Een seed die stilzwijgend tenants aanmaakt in een echte
 * omgeving is precies het soort script dat je niet wilt hebben.
 */
function leesDoelTenant(argv) {
  const index = argv.indexOf('--tenant');

  if (index === -1) {
    return { id: STANDAARD_TENANT_ID, eigen: true };
  }

  const waarde = argv[index + 1];

  if (!waarde || waarde.startsWith('--')) {
    console.error('\n--tenant verwacht een tenant-UUID erachter.\n');
    process.exit(1);
  }

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      waarde,
    )
  ) {
    console.error(`\n'${waarde}' is geen geldig UUID.\n`);
    process.exit(1);
  }

  return { id: waarde.toLowerCase(), eigen: false };
}

const DOEL = leesDoelTenant(process.argv);
const DEMO_TENANT_ID = DOEL.id;
const DEMO_TENANT_NAAM = STANDAARD_TENANT_NAAM;

// Herkenbaar niet-echt. Een verzonnen UUID hier zou niet te onderscheiden zijn
// van een echte Entra-oid: dan kan niemand later nog zien welke gebruikers
// nep zijn, en een demo-account zou stilzwijgend kunnen botsen met een echte
// identiteit (external_subject is UNIQUE). Met dit voorvoegsel is één blik op
// de kolom genoeg. Inloggen met deze gebruikers kan dus niet — daarvoor moet
// een echte oid gekoppeld worden; zie de slotmelding van dit script.
const DEMO_SUBJECT_PREFIX = 'demo:';

const SEEDMAP = path.join(__dirname, '..', 'db', 'seeds');

// Bewust in een submap. seed-vragenlijsten.js leest zonder argumenten álle
// .json uit db/seeds/ en keurt af wat geen vragenlijst is; dit bestand stond
// daar aanvankelijk naast en werd meteen als ongeldige vragenlijst gemeld.
// Niet-recursief lezen maakt de submap voldoende scheiding.
const LEVERANCIERSBESTAND = path.join(SEEDMAP, 'demo', 'leveranciers.json');

/**
 * Vaste, niet-geheime tokens voor de demo-responses.
 *
 * Anders dan bij een echte uitnodiging: die krijgt een token uit
 * randomBytes(32) dat éénmalig getoond wordt en daarna alleen als hash
 * bestaat. Hier moet de link ná het seeden nog bruikbaar zijn om een scherm te
 * kunnen tonen, dus het ruwe token staat in dit bestand.
 *
 * Dat mag hier en nergens anders, om twee redenen: deze tokens geven
 * uitsluitend toegang tot verzonnen data in de demo-tenant, en het script
 * weigert te draaien tegen een tenant met een andere naam dan de demo-tenant.
 * De opslag blijft ongewijzigd een SHA-256-hash — het pad is exact dat van een
 * echte uitnodiging, alleen de invoer is bekend.
 */
/**
 * Exact 43 tekens uit [A-Za-z0-9_-] — de vorm die heeftGeldigeVorm() in
 * src/survey/survey-token.ts eist. Die controle draait vóór de database
 * geraadpleegd wordt, dus een token van een andere lengte wordt geweigerd
 * zonder dat de hash er ooit aan te pas komt.
 *
 * Hier berekend in plaats van uitgeschreven: bij handmatig tellen zaten de
 * eerste versies er 4 tot 5 tekens naast en werkten de demo-links niet, terwijl
 * het seeden zelf gewoon slaagde — de fout kwam pas bij het openen van de link
 * aan het licht.
 */
const TOKEN_LENGTE = 43;

function demoToken(naam) {
  const token = `demo-${naam}`.padEnd(TOKEN_LENGTE, 'x');

  if (token.length !== TOKEN_LENGTE || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error(
      `Demo-token '${naam}' levert een ongeldige vorm op: ${token.length} tekens.`,
    );
  }

  return token;
}

/**
 * Een echt, willekeurig token — dezelfde weg als een echte uitnodiging.
 *
 * `randomBytes` is de veilige generator van Node, gelijk aan genereerToken()
 * in src/survey/survey-token.ts. base64url omdat het token in een URL komt.
 */
function echtToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Met `--echte-tokens` krijgt elke respons een willekeurig token in plaats van
 * de vaste demo-waarde.
 *
 * ── Waarom die keuze bestaat ────────────────────────────────────────────────
 *
 * De vaste tokens hieronder staan in de broncode, zodat een demo-link ná het
 * seeden nog te gebruiken is om een scherm te tonen. Op een wegwerpdatabase is
 * dat prima: ze geven toegang tot verzonnen data die binnen een uur weg is.
 *
 * In een echte omgeving ligt dat anders. Ook al wijzen ze naar nepdata, iedereen
 * die het script leest kan die surveys openen — en dan is er een verschil met
 * een echte klant dat er niet hoort te zijn.
 *
 * Met deze vlag is dat verschil weg: de tokens worden gegenereerd zoals bij een
 * echte uitnodiging, en het script drukt ze één keer af. Daarna bestaan ze
 * alleen nog als hash, precies zoals het ontwerp voorschrijft.
 */
const ECHTE_TOKENS = process.argv.includes('--echte-tokens');

const DEMO_TOKENS = ECHTE_TOKENS
  ? {
      open: echtToken(),
      concept: echtToken(),
      ingediend: echtToken(),
      telaat: echtToken(),
      beoordeeld: echtToken(),
      goedgekeurd: echtToken(),
    }
  : {
      open: demoToken('open'),
      concept: demoToken('concept'),
      ingediend: demoToken('ingediend'),
      // De laatste drie vullen het statusoverzicht (plan 2026-08-07). Zonder
      // deze toonde het scherm alleen 'nog niet terug' en 'wacht op
      // beoordeling' — de helft van de statussen was visueel nooit beoordeeld.
      telaat: demoToken('telaat'),
      beoordeeld: demoToken('beoordeeld'),
      goedgekeurd: demoToken('goedgekeurd'),
    };

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Geeft een array door als één parameter, niet als losse waarden.
 *
 * Drizzle's sql-template spreidt een JS-array uit tot `($1, $2)` — een tupel,
 * geen Postgres-array. Op een text[]-kolom (vendor.trade_names) levert dat een
 * typefout op. sql.param() houdt de array bij elkaar, en de pg-driver zet hem
 * om naar het array-formaat dat Postgres verwacht.
 */
/**
 * De verbinding voor `--verwijder`: dezelfde database, maar als migratierol.
 *
 * Waarom niet gewoon MIGRATION_DATABASE_URL lezen: die staat in `.env` en wijst
 * naar productie. Wordt hij niet expliciet meegegeven, dan vult dotenv hem aan
 * — en dan wist dit script in de verkeerde database. Dat patroon kostte op
 * 2026-08-08 bijna een ongeluk in een e2e-suite.
 *
 * Vandaar: alleen gebruiken als hij op dezelfde database uitkomt als de
 * opgegeven URL. Anders de rol vervangen en verder alles laten staan.
 */
function opruimUrl(runtimeUrl) {
  const doel = new URL(runtimeUrl);
  const expliciet = process.env.MIGRATION_DATABASE_URL;

  if (expliciet) {
    const gegeven = new URL(expliciet);

    if (gegeven.host === doel.host && gegeven.pathname === doel.pathname) {
      return expliciet;
    }
  }

  doel.username = 'clm_migrator';
  return doel.toString();
}

function arrayOfNull(waarde) {
  return Array.isArray(waarde) && waarde.length > 0
    ? sql.param(waarde)
    : sql.param(null);
}

/** Zelfde berekening als survey-token.ts: 30 dagen (OV-2). */
function vervalOverDagen(dagen) {
  return new Date(Date.now() + dagen * 24 * 60 * 60 * 1000);
}

async function metTenantContext(tx, callback) {
  // Zelfde sleutel als setTenantContext() in src/db/schema.ts. Een afwijkende
  // naam geeft geen foutmelding maar een lege context, en dan weigert RLS
  // elke INSERT.
  await tx.execute(
    sql`SELECT set_config('app.current_tenant_id', ${DEMO_TENANT_ID}, true)`,
  );
  return callback();
}

// ── Stappen ─────────────────────────────────────────────────────────────────

/**
 * Maakt de tenantrij aan bínnen de context van de tenant zelf.
 *
 * Dat lijkt een kip-ei-probleem maar is het niet: de policy op clm.tenant eist
 * `tenant_id = clm.current_tenant_id()`, en die context zetten we zelf op het
 * UUID dat we gaan invoegen. Buiten de context invoegen faalt op
 * "new row violates row-level security policy" — RLS doet daar precies zijn
 * werk. Dezelfde weg als de e2e-suites (test/antwoord-indienen.e2e-spec.ts).
 */
async function tenantAanmaken(db) {
  return db.transaction(async (tx) =>
    metTenantContext(tx, async () => {
      const bestaand = await tx.execute(
        sql`SELECT name FROM clm.tenant WHERE tenant_id = ${DEMO_TENANT_ID}`,
      );

      if (bestaand.rows.length > 0) {
        return { nieuw: false, naam: bestaand.rows[0].name };
      }

      // Met --tenant hoort de tenant al te bestaan: die ontstaat via de
      // platformroute, met een uitnodiging voor zijn beheerder. Hem hier
      // alsnog aanmaken zou een tenant opleveren zonder beheerder en zonder
      // spoor in de audit trail — en bij een typefout in het UUID zou dat
      // stilzwijgend gebeuren.
      if (!DOEL.eigen) {
        throw new Error(
          `Tenant ${DEMO_TENANT_ID} bestaat niet.\n\n` +
            'Met --tenant vult dit script een bestáánde tenant. Controleer het\n' +
            'UUID, of maak de tenant eerst aan via POST /platform/tenants.',
        );
      }

      await tx.execute(
        sql`INSERT INTO clm.tenant (tenant_id, name)
            VALUES (${DEMO_TENANT_ID}, ${DEMO_TENANT_NAAM})`,
      );

      return { nieuw: true, naam: DEMO_TENANT_NAAM };
    }),
  );
}

async function gebruikersAanmaken(db, owners) {
  const perSleutel = new Map();

  await db.transaction(async (tx) =>
    metTenantContext(tx, async () => {
      for (const [index, owner] of owners.entries()) {
        const subject = `${DEMO_SUBJECT_PREFIX}${owner.key}`;
        const email = `${owner.full_name
          .toLowerCase()
          .replace(/[^a-z ]/g, '')
          .replace(/ /g, '.')}@demo.voorbeeld`;

        const bestaand = await tx.execute(
          sql`SELECT user_id FROM clm.user
               WHERE tenant_id = ${DEMO_TENANT_ID}
                 AND external_subject = ${subject}`,
        );

        let userId;

        if (bestaand.rows.length > 0) {
          userId = bestaand.rows[0].user_id;
        } else {
          const rij = await tx.execute(
            sql`INSERT INTO clm.user
                    (tenant_id, full_name, email, external_subject)
                VALUES (${DEMO_TENANT_ID}, ${owner.full_name}, ${email},
                        ${subject})
                RETURNING user_id`,
          );
          userId = rij.rows[0].user_id;
        }

        // De eerste gebruiker beheert, de rest beoordeelt. Twee rollen in de
        // demo, zodat het verschil tussen admin en reviewer zichtbaar is.
        const rol = index === 0 ? 'admin' : 'reviewer';

        await tx.execute(
          sql`INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
              VALUES (${userId}, ${DEMO_TENANT_ID}, ${rol})
              ON CONFLICT (user_id, tenant_id) DO NOTHING`,
        );

        perSleutel.set(owner.key, userId);
      }
    }),
  );

  return perSleutel;
}

async function leveranciersAanmaken(db, vendors, gebruikers) {
  const perMockId = new Map();
  let nieuw = 0;

  await db.transaction(async (tx) =>
    metTenantContext(tx, async () => {
      for (const v of vendors) {
        // kvk_number is uniek per tenant en gevuld voor elke demo-leverancier;
        // dat maakt het de natuurlijke sleutel om op te herkennen.
        const bestaand = await tx.execute(
          sql`SELECT vendor_id FROM clm.vendor
               WHERE tenant_id = ${DEMO_TENANT_ID}
                 AND kvk_number = ${v.kvk_number}`,
        );

        if (bestaand.rows.length > 0) {
          perMockId.set(v.mock_id, bestaand.rows[0].vendor_id);
          continue;
        }

        const rij = await tx.execute(
          sql`INSERT INTO clm.vendor
                  (tenant_id, name, kvk_number, vestigingsnummer,
                   statutory_name, trade_names, legal_form, incorporation_date,
                   sbi_code, sbi_description, category_code,
                   business_criticality_code, compliance_status_code,
                   country, city, website, annual_spend_eur, risk_score,
                   owner_user_id, last_review_date, next_review_date)
              VALUES (${DEMO_TENANT_ID}, ${v.name}, ${v.kvk_number},
                      ${v.vestigingsnummer}, ${v.statutory_name},
                      ${arrayOfNull(v.trade_names)}, ${v.legal_form},
                      ${v.incorporation_date}, ${v.sbi_code},
                      ${v.sbi_description}, ${v.category_code},
                      ${v.business_criticality_code},
                      ${v.compliance_status_code}, ${v.country}, ${v.city},
                      ${v.website}, ${v.annual_spend_eur}, ${v.risk_score},
                      ${gebruikers.get(v.owner_key) ?? null},
                      ${v.last_review_date}, ${v.next_review_date})
              RETURNING vendor_id`,
        );

        const vendorId = rij.rows[0].vendor_id;
        perMockId.set(v.mock_id, vendorId);
        nieuw += 1;

        if (v.contact) {
          await tx.execute(
            sql`INSERT INTO clm.vendor_contact
                    (vendor_id, tenant_id, full_name, email, phone, job_title,
                     is_primary)
                VALUES (${vendorId}, ${DEMO_TENANT_ID}, ${v.contact.full_name},
                        ${v.contact.email}, ${v.contact.phone},
                        ${v.contact.job_title}, true)`,
          );
        }

        for (const tag of v.tags ?? []) {
          await tx.execute(
            sql`INSERT INTO clm.vendor_tag (vendor_id, tenant_id, tag)
                VALUES (${vendorId}, ${DEMO_TENANT_ID}, ${tag})
                ON CONFLICT DO NOTHING`,
          );
        }
      }
    }),
  );

  return { perMockId, nieuw, totaal: vendors.length };
}

/**
 * Laadt de vragenlijsten in via het bestaande seed-script.
 *
 * Aanroepen in plaats van overschrijven: seed-vragenlijsten.js gebruikt de
 * validatie uit src/survey/vragenlijst-schema.ts — hetzelfde pad als de
 * applicatie. De vragen hier zelf invoegen zou een tweede waarheid opleveren
 * die stilzwijgend uit de pas loopt zodra die validatie strenger wordt.
 *
 * Het is zelf idempotent (bestaat de naam+versie al, dan slaat het over), dus
 * onvoorwaardelijk aanroepen is veilig.
 */
function vragenlijstenLaden() {
  const { execFileSync } = require('node:child_process');

  // De doelwitvlaggen doorgeven aan het subproces.
  //
  // `seed-vragenlijsten.js` heeft zijn eigen `eisToestemmingBuitenLokaal()` en
  // kijkt daarvoor naar zijn éígen argv — niet naar die van de aanroeper.
  // Zonder deze regel stopt het bij een niet-lokaal doelwit terwijl het
  // hoofdscript al toestemming heeft gekregen, en dan staan de leveranciers er
  // wél en de vragenlijsten niet.
  //
  // Vastgesteld op 2026-08-09 bij het vullen van een tenant op productie: de
  // seed strandde halverwege. Geen schade — beide scripts zijn idempotent —
  // maar een halve seed is een verwarrende toestand, en de melding wees naar
  // het subscript in plaats van naar de ontbrekende doorgifte.
  const doorgeven = ['--extern', '--ook-beschermd'].filter((vlag) =>
    process.argv.includes(vlag),
  );

  execFileSync(
    process.execPath,
    [
      path.join(__dirname, 'seed-vragenlijsten.js'),
      DEMO_TENANT_ID,
      ...doorgeven,
    ],
    { stdio: 'inherit' },
  );
}

/**
 * Twee rondes op de Transdev-vragenlijst, met zes responses die samen élke
 * status in het overzicht laten zien.
 *
 * ── Twee soorten status, en dat onderscheid is het ontwerp ──────────────────
 *
 * `survey_response.status` is de INVULstatus: 'pending' | 'submitted' |
 * 'revoked' (migratie 0003). Een "concept" is daarin een pending response met
 * enkele antwoorden — geen aparte waarde.
 *
 * Wat het scherm toont is iets anders: de berekende status uit
 * src/survey/respons-status.ts, die daarnaast kijkt naar de sluitdatum en het
 * laatste oordeel. Die twee lopen bewust niet gelijk.
 *
 * ── Waarom een tweede, verlopen ronde ───────────────────────────────────────
 *
 * 'te laat' is `closes_at < now()` bij een actieve ronde. Eén ronde kan niet
 * tegelijk open en verlopen zijn, dus krijgt dat stadium een eigen ronde met
 * een sluitdatum vijf dagen terug.
 *
 * ── Waarom oordelen in de seed ──────────────────────────────────────────────
 *
 * Zonder oordelen toonde het statusoverzicht alleen 'nog niet terug' en 'wacht
 * op beoordeling': de helft van de statussen was visueel nooit beoordeeld.
 * Eén response krijgt twee tegenstrijdige oordelen, zodat zichtbaar is dat het
 * laatste telt én dat er meer zijn.
 */
async function rondeAanmaken(db, vendors) {
  return db.transaction(async (tx) =>
    metTenantContext(tx, async () => {
      const template = await tx.execute(
        sql`SELECT template_id FROM clm.survey_template
             WHERE tenant_id = ${DEMO_TENANT_ID}
             ORDER BY name, version
             LIMIT 1`,
      );

      if (template.rows.length === 0) {
        return { overgeslagen: 'geen vragenlijst' };
      }

      const templateId = template.rows[0].template_id;

      const bestaandeRonde = await tx.execute(
        sql`SELECT run_id FROM clm.survey_run
             WHERE tenant_id = ${DEMO_TENANT_ID}
               AND template_id = ${templateId}
             LIMIT 1`,
      );

      if (bestaandeRonde.rows.length > 0) {
        return { overgeslagen: 'ronde bestaat al' };
      }

      const ronde = await tx.execute(
        sql`INSERT INTO clm.survey_run
                (tenant_id, template_id, survey_kind, status, closes_at)
            VALUES (${DEMO_TENANT_ID}, ${templateId}, 'vendor_compliance',
                    'active', ${vervalOverDagen(30).toISOString()})
            RETURNING run_id`,
      );

      const runId = ronde.rows[0].run_id;

      // Een tweede ronde die al gesloten is, voor de status 'te laat'.
      // Dezelfde ronde kan niet tegelijk open en verlopen zijn, en de
      // statusberekening kijkt naar closes_at bij een 'active' ronde
      // (src/survey/respons-status.ts).
      const verlopen = await tx.execute(
        sql`INSERT INTO clm.survey_run
                (tenant_id, template_id, survey_kind, status, closes_at)
            VALUES (${DEMO_TENANT_ID}, ${templateId}, 'vendor_compliance',
                    'active', now() - interval '10 days')
            RETURNING run_id`,
      );

      const verlopenRunId = verlopen.rows[0].run_id;

      // Wie de oordelen op zijn naam krijgt. De eerste gebruiker is admin, de
      // rest reviewer; een oordeel van een reviewer laat zien dat die rol dat
      // mag zonder admin te zijn (plan §2a).
      const beoordelaars = await tx.execute(
        sql`SELECT u.user_id
              FROM clm."user" u
              JOIN clm.tenant_membership m ON m.user_id = u.user_id
             WHERE u.tenant_id = ${DEMO_TENANT_ID}
               AND m.role = 'reviewer'
             ORDER BY u.full_name
             LIMIT 1`,
      );

      const beoordelaarId = beoordelaars.rows[0]?.user_id ?? null;

      const vragen = await tx.execute(
        sql`SELECT question_id, answer_type, position, config
             FROM clm.survey_question
             WHERE tenant_id = ${DEMO_TENANT_ID}
               AND template_id = ${templateId}
             ORDER BY position`,
      );

      // Zes responses: drie invulstadia plus drie beoordeelstadia.
      //
      // De eerste drie waren er al en volgen het datamodel: status is
      // 'pending' | 'submitted' | 'revoked' (migratie 0003). Een "concept" is
      // daarin een pending response met enkele antwoorden — geen aparte status.
      //
      // De laatste drie bestaan voor het statusoverzicht (plan 2026-08-07).
      // `oordelen` bepaalt wat er ná het indienen wordt vastgelegd; de
      // berekende status volgt daaruit vanzelf, want die kijkt naar het
      // laatste oordeel (src/survey/respons-status.ts).
      // `dagenGeleden` zet de uitnodiging terug in de tijd.
      //
      // Zonder dat staan alle uitnodigingen op vandaag, en dan zegt de kolom
      // "Uitgestuurd" niets: het verschil tussen gisteren verstuurd en zes
      // weken geleden verstuurd is juist wat een lege "terug ontvangen"
      // betekenis geeft. Bij de verlopen ronde was het zelfs tegenstrijdig —
      // uitgestuurd ná de sluitdatum.
      const stadia = [
        {
          sleutel: 'open',
          mockId: vendors[0],
          status: 'pending',
          antwoorden: 0,
          oordelen: [],
          dagenGeleden: 5,
        },
        {
          sleutel: 'concept',
          mockId: vendors[1],
          status: 'pending',
          antwoorden: 3,
          oordelen: [],
          dagenGeleden: 12,
        },
        {
          sleutel: 'ingediend',
          mockId: vendors[2],
          status: 'submitted',
          antwoorden: vragen.rows.length,
          oordelen: [],
          dagenGeleden: 9,
          ingediendDagenGeleden: 2,
          // Eén afwijking, zodat het beoordeelscherm iets te tonen heeft: dat
          // toont standaard alléén wat afwijkt. Alles bevestigd betekent daar
          // een leeg scherm.
          afwijkingen: {
            2: {
              code: 'cannot_upload',
              toelichting:
                'Certificaat verloopt volgende maand; hercertificering loopt. Nieuw certificaat volgt in september.',
            },
          },
        },
        {
          // Status 'te laat': niet ingediend, en de ronde is gesloten. Krijgt
          // hieronder een eigen ronde met een sluitdatum in het verleden —
          // dezelfde ronde kan niet tegelijk open en verlopen zijn.
          sleutel: 'telaat',
          mockId: vendors[3],
          status: 'pending',
          antwoorden: 1,
          oordelen: [],
          verlopenRonde: true,
          // Ruim vóór de sluitdatum van die ronde (5 dagen terug), anders zou
          // de uitnodiging ná het sluiten zijn uitgegaan.
          dagenGeleden: 40,
          notities: [
            'Twee keer gebeld, contactpersoon met vakantie. Collega zou het oppakken.',
          ],
        },
        {
          // Twee oordelen die elkaar tegenspreken. Het laatste telt voor de
          // status, maar het scherm toont "(van 2)" — anders verdwijnt een
          // meningsverschil uit beeld (besluit eigenaar, V3).
          sleutel: 'beoordeeld',
          mockId: vendors[4],
          status: 'submitted',
          antwoorden: vragen.rows.length,
          oordelen: [
            { verdict: 'goed', toelichting: 'Ziet er compleet uit.' },
            {
              verdict: 'nadere_vragen',
              toelichting: 'Toch een vraag over het onderaannemersbeleid.',
            },
          ],
          dagenGeleden: 21,
          ingediendDagenGeleden: 14,
          notities: [
            'Mail gestuurd met de vraag over onderaannemers. Nog geen antwoord.',
            'Gesproken op de kwartaalmeeting; sturen deze week aanvulling.',
          ],
          // Twee afwijkingen: dit is het geval waar de notities en het
          // meningsverschil over gaan.
          afwijkingen: {
            5: {
              code: 'not_confirmed',
              toelichting:
                'In maart is er een phishingincident geweest. Gemeld op dag 4 in plaats van binnen 48 uur; procedure is inmiddels aangepast.',
            },
            9: {
              code: 'not_confirmed',
              toelichting:
                'Eén onderaannemer voldoet nog niet aan alle eisen; contract wordt dit kwartaal herzien.',
            },
          },
        },
        {
          sleutel: 'goedgekeurd',
          mockId: vendors[5],
          status: 'submitted',
          antwoorden: vragen.rows.length,
          oordelen: [
            { verdict: 'goed', toelichting: 'Alles aangeleverd.' },
            { verdict: 'goedgekeurd', toelichting: '' },
          ],
          dagenGeleden: 28,
          ingediendDagenGeleden: 20,
        },
      ];

      for (const stadium of stadia) {
        // Altijd als 'pending' aanmaken, ook het ingediende stadium.
        //
        // De policy op survey_answer staat schrijven alleen toe zolang de
        // response 'pending' is (WITH CHECK op r.status). Een response die
        // meteen 'submitted' is, kan daarna geen antwoorden meer krijgen — de
        // database weigert dat, en terecht: indienen is eenmalig en
        // onomkeerbaar. Dus dezelfde volgorde als een echte invuller:
        // invullen, dan indienen. Het indienen gebeurt hieronder.
        const respons = await tx.execute(
          sql`INSERT INTO clm.survey_response
                  (tenant_id, run_id, vendor_id, subject_vendor_id, token_hash,
                   status, expires_at)
              VALUES (${DEMO_TENANT_ID},
                      ${stadium.verlopenRonde ? verlopenRunId : runId},
                      ${stadium.mockId},
                      ${stadium.mockId},
                      ${hashToken(DEMO_TOKENS[stadium.sleutel])},
                      'pending',
                      ${vervalOverDagen(30).toISOString()})
              RETURNING response_id`,
        );

        // created_at is de uitnodigingsdatum in het statusoverzicht. De kolom
        // heeft DEFAULT now(), dus terugzetten gebeurt hier in plaats van in
        // de INSERT — dat houdt de INSERT gelijk aan wat de applicatie doet.
        if (stadium.dagenGeleden) {
          await tx.execute(
            sql`UPDATE clm.survey_response
                   SET created_at = now() - (${stadium.dagenGeleden} * interval '1 day')
                 WHERE response_id = ${respons.rows[0].response_id}`,
          );
        }

        const responseId = respons.rows[0].response_id;

        for (const vraag of vragen.rows.slice(0, stadium.antwoorden)) {
          // Leesblokken hebben geen antwoord: answer_type 'instruction' is
          // uitleg, geen vraag. Een antwoordrij erop zou de vormconstraint
          // op survey_answer schenden.
          if (vraag.answer_type === 'instruction') {
            continue;
          }

          // Afwijkingen zijn per positie opgegeven; `position` telt vanaf 1 en
          // is wat de leverancier als vraagnummer ziet.
          const afwijking = stadium.afwijkingen?.[vraag.position];

          const antwoord = antwoordVoor(
            vraag.answer_type,
            vraag.config,
            afwijking?.code,
          );

          // Geen plausibel antwoord te maken (keuzevraag zonder opties in de
          // config): overslaan in plaats van iets verzinnen dat de
          // vormconstraint haalt maar nergens op slaat.
          if (antwoord === null) {
            continue;
          }

          // Alles behalve een bevestiging vereist uitleg van minimaal 10
          // tekens (ontwerp §3, afgedwongen door
          // survey_answer_comment_required_check). Bij 'confirmed' mag het
          // leeg blijven, en dat houden we ook zo — anders toont de demo een
          // toelichting waar een echte invuller er geen hoeft te geven.
          const toelichting = afwijking
            ? // Bij een afwijking is de toelichting het antwoord op "waarom",
              // en dus het enige wat de beoordelaar echt leest. Een generieke
              // zin zou het scherm vullen zonder iets te zeggen.
              afwijking.toelichting
            : vraag.answer_type === 'confirmation' &&
                antwoord.code === 'confirmed'
              ? null
              : 'Voorbeeldantwoord uit de demo-seed.';

          try {
            await tx.execute(
              sql`INSERT INTO clm.survey_answer
                      (tenant_id, response_id, question_id, answer_type,
                       answer_code, answer_codes, answer_text, answer_number,
                       comment)
                  VALUES (${DEMO_TENANT_ID}, ${responseId},
                          ${vraag.question_id}, ${vraag.answer_type},
                          ${antwoord.code ?? null},
                          ${arrayOfNull(antwoord.codes)},
                          ${antwoord.text ?? null},
                          ${antwoord.number ?? null},
                          ${toelichting})
                  ON CONFLICT DO NOTHING`,
            );
          } catch (fout) {
            const oorzaak = fout.cause ?? fout;
            throw new Error(
              `antwoord op vraag ${vraag.position} (${vraag.answer_type}): ` +
                `${oorzaak.message}` +
                (oorzaak.constraint ? ` [${oorzaak.constraint}]` : ''),
            );
          }
        }

        // Pas nu indienen, met de antwoorden erin. Dezelfde vololgorde als
        // antwoord-indienen.service.ts: status en submitted_at gaan samen,
        // afgedwongen door survey_response_submitted_consistent_check.
        if (stadium.status === 'submitted') {
          await tx.execute(
            sql`UPDATE clm.survey_response
                   SET status = 'submitted',
                       submitted_at = now() -
                         (${stadium.ingediendDagenGeleden ?? 0} * interval '1 day')
                 WHERE response_id = ${responseId}
                   AND tenant_id = ${DEMO_TENANT_ID}`,
          );
        }

        // Oordelen ná het indienen, in volgorde: het láátste bepaalt de
        // status. Elk oordeel krijgt een created_at die een uur later ligt dan
        // het vorige, want binnen één transactie geeft now() steeds hetzelfde
        // tijdstip — en dan is "het laatste oordeel" niet te bepalen.
        // De policy op survey_review eist naast de tenant ook actor
        // 'medewerker' (migratie 0015): een leverancier zit in dezelfde tenant
        // als zijn beoordelaar en mag het oordeel niet zien. metTenantContext
        // zet alleen de tenant, dus zonder deze regel weigert RLS elke INSERT
        // — met een foutmelding die de constraint niet noemt.
        const teOordelen = beoordelaarId ? (stadium.oordelen ?? []) : [];
        const teNoteren = beoordelaarId ? (stadium.notities ?? []) : [];

        if (teOordelen.length > 0 || teNoteren.length > 0) {
          await tx.execute(
            sql`SELECT set_config('app.current_actor', 'medewerker', true)`,
          );
        }

        // Notities van collega's onderling (migratie 0018). Ze raken de status
        // niet — het scherm toont alleen dát ze er zijn. Zonder deze regels
        // bleef dat deel van het overzicht visueel ongetest.
        let notitieDagen = stadium.dagenGeleden ?? 0;
        for (const tekst of teNoteren) {
          notitieDagen = Math.max(0, notitieDagen - 3);
          await tx.execute(
            sql`INSERT INTO clm.response_note
                    (tenant_id, response_id, tekst, author_user_id, created_at)
                VALUES (${DEMO_TENANT_ID}, ${responseId}, ${tekst},
                        ${beoordelaarId},
                        now() - (${notitieDagen} * interval '1 day'))`,
          );
        }

        // Ná het indienen, elk oordeel een dag later dan het vorige. Binnen één
        // transactie geeft now() steeds hetzelfde tijdstip, en dan is "het
        // laatste oordeel" niet te bepalen — juist dat bepaalt de status.
        let oordeelDagen = stadium.ingediendDagenGeleden ?? 0;
        for (const oordeel of teOordelen) {
          oordeelDagen = Math.max(0, oordeelDagen - 1);
          await tx.execute(
            sql`INSERT INTO clm.survey_review
                    (tenant_id, response_id, verdict, toelichting,
                     reviewer_user_id, created_at)
                VALUES (${DEMO_TENANT_ID}, ${responseId}, ${oordeel.verdict},
                        ${oordeel.toelichting}, ${beoordelaarId},
                        now() - (${oordeelDagen} * interval '1 day'))`,
          );
        }
      }

      return { runId, responses: stadia.length, vragen: vragen.rows.length };
    }),
  );
}

/**
 * Een plausibel antwoord per vraagtype.
 *
 * Elk type vult precies één kolom; survey_answer_shape_check (migratie 0005)
 * dwingt dat af en weigert elke andere combinatie. Daarom niet één generieke
 * answer_code voor alles, maar per type de kolom die het model verwacht.
 *
 * `config` bevat bij single_choice en multi_choice de toegestane opties. Die
 * moeten we lezen in plaats van verzinnen: een verzonnen code komt door de
 * vormconstraint (die alleen NOT NULL eist) maar levert een demo op met
 * antwoorden die in geen enkele keuzelijst voorkomen.
 */
/**
 * @param afwijkendeCode Alternatief voor 'confirmed' bij een bevestigingsvraag.
 *   Bedoeld om een inzending mét afwijking te kunnen tonen: het beoordeelscherm
 *   laat standaard alléén de afwijkingen zien, en zonder deze mogelijkheid was
 *   dat scherm altijd leeg.
 */
function antwoordVoor(type, config, afwijkendeCode) {
  const opties = (config?.options ?? config?.choices ?? [])
    .map((optie) => (typeof optie === 'string' ? optie : optie?.code))
    .filter(Boolean);

  switch (type) {
    case 'confirmation':
      return { code: afwijkendeCode ?? 'confirmed' };
    case 'yes_no':
      return { code: 'yes' };
    case 'single_choice':
      return opties.length > 0 ? { code: opties[0] } : null;
    case 'multi_choice':
      return opties.length > 0 ? { codes: [opties[0]] } : null;
    case 'open_text':
      return { text: 'Voorbeeldantwoord uit de demo-seed.' };
    case 'rating':
      return { number: 4 };
    case 'number':
      return { number: 1 };
    case 'file_upload':
      // Geldig zonder bijlage: de vormconstraint eist juist dat alle
      // waardekolommen leeg zijn. Het bestand zelf hangt aan
      // survey_attachment, en die vult de demo niet — er is geen echt bestand.
      return {};
    default:
      return null;
  }
}

async function verwijderen(db) {
  // Volgorde volgt de foreign keys: antwoorden en bijlagen vóór responses,
  // responses vóór rondes, rondes vóór templates.
  //
  // Oordelen en notities staan bovenaan om dezelfde reden. Beide verwijzen met
  // ON DELETE restrict naar survey_response — bewust, want een oordeel is
  // bewijsmateriaal en mag niet stilzwijgend meeverdwijnen. Vergeet je ze hier,
  // dan strandt het opruimen op een foreign key. Gebeurde op 2026-08-07 bij het
  // toevoegen van notities aan de seed.
  const stappen = [
    sql`DELETE FROM clm.response_note WHERE tenant_id = ${DEMO_TENANT_ID}`,
    sql`DELETE FROM clm.survey_review WHERE tenant_id = ${DEMO_TENANT_ID}`,
    sql`DELETE FROM clm.survey_answer WHERE tenant_id = ${DEMO_TENANT_ID}`,
    sql`DELETE FROM clm.survey_attachment WHERE tenant_id = ${DEMO_TENANT_ID}`,
    sql`DELETE FROM clm.survey_response WHERE tenant_id = ${DEMO_TENANT_ID}`,
    sql`DELETE FROM clm.survey_run WHERE tenant_id = ${DEMO_TENANT_ID}`,
    sql`DELETE FROM clm.survey_question WHERE tenant_id = ${DEMO_TENANT_ID}`,
    sql`DELETE FROM clm.survey_category WHERE tenant_id = ${DEMO_TENANT_ID}`,
    sql`DELETE FROM clm.survey_template WHERE tenant_id = ${DEMO_TENANT_ID}`,
    sql`DELETE FROM clm.vendor_tag WHERE tenant_id = ${DEMO_TENANT_ID}`,
    sql`DELETE FROM clm.vendor_contact WHERE tenant_id = ${DEMO_TENANT_ID}`,
    sql`DELETE FROM clm.vendor WHERE tenant_id = ${DEMO_TENANT_ID}`,
    // Alleen de demo-gebruikers, herkenbaar aan hun voorvoegsel.
    //
    // Tot 2026-08-09 stond hier `WHERE tenant_id = …` zonder meer, en dat kon
    // ook: in een tenant die dit script zelf aanmaakt zijn álle gebruikers van
    // dit script. Met --tenant is dat niet langer waar — daar staat de echte
    // beheerder tussen, en die mag een opruimactie nooit raken.
    sql`DELETE FROM clm.tenant_membership
         WHERE tenant_id = ${DEMO_TENANT_ID}
           AND user_id IN (SELECT user_id FROM clm.user
                            WHERE tenant_id = ${DEMO_TENANT_ID}
                              AND external_subject LIKE ${`${DEMO_SUBJECT_PREFIX}%`})`,
    sql`DELETE FROM clm.user
         WHERE tenant_id = ${DEMO_TENANT_ID}
           AND external_subject LIKE ${`${DEMO_SUBJECT_PREFIX}%`}`,
  ];

  await db.transaction(async (tx) =>
    metTenantContext(tx, async () => {
      // survey_review en response_note eisen naast de tenant ook actor
      // 'medewerker' (migraties 0015 en 0018): een leverancier zit in dezelfde
      // tenant als zijn beoordelaar en mag niet meelezen. Zonder deze regel
      // weigert de policy élke rij — ook bij het opruimen, en dan strandt de
      // DELETE op survey_response met een foreign-keyfout die naar de
      // verkeerde oorzaak wijst.
      await tx.execute(
        sql`SELECT set_config('app.current_actor', 'medewerker', true)`,
      );

      for (const stap of stappen) {
        await tx.execute(stap);
      }

      // De tenantrij als laatste, binnen dezelfde context — zie
      // tenantAanmaken() voor waarom dat binnen de context moet.
      //
      // Maar alléén wanneer dit script de tenant zelf heeft aangemaakt. Met
      // --tenant is hij van iemand anders: daar haalt opruimen de voorbeelddata
      // weg en blijft de omgeving met zijn beheerder staan.
      if (DOEL.eigen) {
        await tx.execute(
          sql`DELETE FROM clm.tenant WHERE tenant_id = ${DEMO_TENANT_ID}`,
        );
      }
    }),
  );
}

async function tellen(db) {
  return db.transaction(async (tx) =>
    metTenantContext(tx, async () => {
      const { rows } = await tx.execute(
        sql`SELECT
              (SELECT count(*) FROM clm.user) AS gebruikers,
              (SELECT count(*) FROM clm.tenant_membership) AS memberships,
              (SELECT count(*) FROM clm.vendor) AS leveranciers,
              (SELECT count(*) FROM clm.vendor_contact) AS contactpersonen,
              (SELECT count(*) FROM clm.survey_template) AS vragenlijsten,
              (SELECT count(*) FROM clm.survey_run) AS rondes,
              (SELECT count(*) FROM clm.survey_response) AS responses,
              (SELECT count(*) FROM clm.survey_answer) AS antwoorden`,
      );
      return rows[0];
    }),
  );
}

// ── Hoofdprogramma ──────────────────────────────────────────────────────────

async function main() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error(
      'DATABASE_URL ontbreekt. De seed draait via de runtime-rol clm_api_runtime, net als de applicatie.',
    );
    process.exit(1);
  }

  if (!fs.existsSync(LEVERANCIERSBESTAND)) {
    console.error(`Ontbreekt: ${LEVERANCIERSBESTAND}`);
    process.exit(1);
  }

  // Vóór de eerste schrijfactie. Dit script schrijft niet alleen, het kan met
  // --verwijder ook opruimen — op de verkeerde database is dat onherstelbaar
  // zonder backup (Issue #86).
  meldDoelwit(url, 'Seed demo-tenant');

  if (!eisToestemmingBuitenLokaal(url, { wat: 'Seed demo-tenant' })) {
    process.exit(1);
  }

  const moetVerwijderen = process.argv.includes('--verwijder');

  // Alleen bij --verwijder de wegwerpeis, en dat onderscheid is opzet.
  //
  // Seeden voegt toe: dat mag op een beschermde database, en moet ook — anders
  // is een demo-tenant in productie niet in te richten. Verwijderen is
  // onherstelbaar, en de hostcontrole hierboven kent 'localhost' als veilig
  // terwijl juist de demo-database daar draait (2026-08-07).
  if (
    moetVerwijderen &&
    !(await eisWegwerpdatabase(url, { wat: 'Opruimen demo-tenant' }))
  ) {
    process.exit(1);
  }

  // ── Opruimen gaat via de migratierol, seeden via de runtime-rol ────────────
  //
  // Sinds migratie 0022 heeft de applicatierol geen DELETE op clm.survey_review
  // en clm.response_note: een oordeel of notitie wordt zacht verwijderd. Dat is
  // de stand op productie, en dit script hoort die te delen.
  //
  // Opruimen is daarmee geen applicatiehandeling meer maar een beheerhandeling.
  // Dat is geen omweg om de beperking heen — de applicatie kán het niet, en dat
  // is het punt. De wegwerpeis hierboven staat er nog steeds vóór.
  //
  // Seeden blijft bewust op de runtime-rol: dat moet werken met exact de rechten
  // die de applicatie heeft, anders bewijst een geslaagde seed niets over of de
  // data langs de normale weg bereikbaar is.
  const verbinding = moetVerwijderen ? opruimUrl(url) : url;

  const pool = new Pool({ connectionString: verbinding });
  const db = drizzle(pool);

  try {
    const { rows } = await pool.query(
      'SELECT current_user AS rol, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );

    // Dezelfde startcontrole als DatabaseService en seed-vragenlijsten.js: met
    // BYPASSRLS is RLS geen effectieve tenantgrens, en dan zegt een geslaagde
    // seed niets over of de data via de normale weg bereikbaar is.
    if (rows[0]?.rolbypassrls) {
      console.error(
        `De rol '${rows[0].rol}' heeft BYPASSRLS. Gebruik clm_api_runtime. Zie ADR-008.`,
      );
      process.exit(1);
    }

    if (moetVerwijderen) {
      await verwijderen(db);
      console.log(
        DOEL.eigen
          ? `Demo-tenant ${DEMO_TENANT_ID} verwijderd.`
          : `Voorbeelddata uit tenant ${DEMO_TENANT_ID} verwijderd.\n` +
              'De tenant zelf en zijn eigen gebruikers zijn ongemoeid gebleven.',
      );
      return;
    }

    console.log(`Seeden als rol '${rows[0]?.rol}'.\n`);

    const tenant = await tenantAanmaken(db);
    console.log(
      `Tenant: ${tenant.naam} (${DEMO_TENANT_ID})` +
        (tenant.nieuw ? '' : ' — bestond al'),
    );

    const bron = JSON.parse(fs.readFileSync(LEVERANCIERSBESTAND, 'utf8'));

    const gebruikers = await gebruikersAanmaken(db, bron.owners);
    console.log(`Gebruikers: ${gebruikers.size} met membership`);

    const leveranciers = await leveranciersAanmaken(
      db,
      bron.vendors,
      gebruikers,
    );
    console.log(
      `Leveranciers: ${leveranciers.totaal} (${leveranciers.nieuw} nieuw)`,
    );

    console.log('\nVragenlijsten:');
    vragenlijstenLaden();
    console.log('');

    const vendorIds = [...leveranciers.perMockId.values()];
    const ronde = await rondeAanmaken(db, vendorIds);

    if (ronde.overgeslagen) {
      console.log(`Ronde: overgeslagen (${ronde.overgeslagen})`);
    } else {
      console.log(
        `Ronde: actief, ${ronde.responses} responses over ${ronde.vragen} vragen`,
      );
    }

    console.log('\nStand:');
    console.table(await tellen(db));

    if (!ronde.overgeslagen) {
      if (ECHTE_TOKENS) {
        // Deze uitvoer is eenmalig: de database bewaart alleen een hash, en er
        // is geen route die een token opnieuw kan tonen. Wie hem nu niet
        // bewaart, kan die survey nooit meer openen — dat is het ontwerp, geen
        // omissie.
        console.log(
          '\nUitnodigingslinks — DEZE UITVOER IS EENMALIG.\n' +
            'De database bewaart alleen een hash. Bewaar wat je nodig hebt;\n' +
            'daarna is er geen enkele manier om deze links terug te halen.',
        );
      } else {
        console.log(
          '\nDemo-links (alleen deze tenant, alleen verzonnen data):',
        );
      }

      for (const [stadium, token] of Object.entries(DEMO_TOKENS)) {
        console.log(`  ${stadium.padEnd(12)} /portal/survey/${token}`);
      }

      if (!ECHTE_TOKENS) {
        console.log(
          '\nDeze tokens staan in de broncode. Voor een echte omgeving:\n' +
            '  node scripts/seed-demo-tenant.js --echte-tokens',
        );
      }
    }

    console.log(
      '\nInloggen met deze gebruikers kan niet: hun external_subject begint met',
      `'${DEMO_SUBJECT_PREFIX}' en is geen echte Entra-oid. Koppel een echte oid`,
      '\nom in te loggen — zie docs/STATUS.md.',
    );
    console.log(`Opruimen: node scripts/seed-demo-tenant.js --verwijder`);
  } finally {
    await pool.end();
  }
}

main().catch((fout) => {
  console.error('Seeden mislukt:', fout.message);

  // Drizzle vat een databasefout samen tot de query; de oorzaak staat in de
  // onderliggende driver-fout. Zonder deze regels kost elke constraint-fout
  // een aparte reproductie om te zien wélke constraint het was.
  const oorzaak = fout.cause ?? fout;
  if (oorzaak?.constraint || oorzaak?.detail) {
    console.error(
      `  constraint: ${oorzaak.constraint ?? '(onbekend)'}\n  detail: ${oorzaak.detail ?? oorzaak.message}`,
    );
  }

  process.exit(1);
});
