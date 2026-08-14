#!/usr/bin/env node
'use strict';

/**
 * Legt de drie omgevingen naast elkaar en meldt waar ze uiteenlopen.
 *
 * Uitsluitend SELECT. Dit script schrijft nergens, ook niet de markering die
 * het leest — het stelt vast, het repareert niet.
 *
 * ── Waarom dit bestaat ───────────────────────────────────────────────────────
 *
 * Elk incident tot nu toe had dezelfde vorm: één omgeving week af van de
 * andere, niemand wist het, en het bleek pas toen er iets op stukliep.
 *
 *   2026-08-04  `clm-enterprise` liep achter; de dump miste 9 van de 18
 *               tabellen (#25). Maanden onopgemerkt, want elke dump was vers.
 *   2026-08-10  Een query zonder tenantcontext gaf nul rijen. Gelezen als "de
 *               database is leeg", waarna er data verdween die er wél was.
 *   2026-08-12  Productie draaide tegen een lege lokale container terwijl het
 *               plan Supabase beschreef. Niemand merkte het, want er stond
 *               niets in.
 *
 * Alle drie waren zichtbaar geweest door de omgevingen naast elkaar te leggen.
 * Dat is het enige dat dit script doet.
 *
 * ── Wat het vergelijkt (plan §4.3, en sinds 14-08 het pariteitscontract) ────
 *
 *   1. Migratiestand     niet vóór op de repository
 *   2. Tabellen          dezelfde verzameling in het clm-schema
 *   3. Tenantgrens       geen tenanttabel die clm_api_runtime kan lezen
 *                        zonder dat er RLS op staat
 *   4. Rollen            clm_api_runtime bestaat en heeft geen BYPASSRLS
 *   5. Markering         clm.omgeving zegt wat er verwacht wordt
 *   6. Draaiende code    /health meldt een digest, en de omgevingen die
 *                        hetzelfde zouden moeten zijn, draaien ook hetzelfde
 *                        image — pariteitscontract §2, indicatoren 1 en 2
 *
 * ── Waarom het geen verwachtingen uit een tabel in dit bestand haalt ────────
 *
 * Op één na. De verwachte migratiestand komt uit `drizzle/meta/_journal.json`,
 * en de tabellenlijst komt uit de omgevingen zelf — ze worden met elkáár
 * vergeleken, niet met een lijst die hier staat. Zo'n lijst loopt achter zodra
 * er een tabel bijkomt, en dan faalt de controle om de verkeerde reden of,
 * erger, blijft hij groen terwijl er iets ontbreekt. Dezelfde afweging als in
 * verify-schema.js.
 *
 * De uitzondering is `clm.omgeving`: dat productie `beschermd` hoort te zijn is
 * geen meting maar een besluit, en besluiten horen opgeschreven te staan.
 *
 * ── Gebruik ──────────────────────────────────────────────────────────────────
 *
 *   npm run verify:omgevingen
 *
 * Verwacht in de omgeving:
 *   STAGING_MIGRATION_DATABASE_URL     lezen — zelfde naam als productie-poort.js
 *   PRODUCTIE_MIGRATION_DATABASE_URL   lezen
 *
 * Acceptatie heeft géén URL en dat kan niet anders: die database is een
 * container op saxombp, gebonden aan 127.0.0.1:55460 en dus met opzet niet van
 * buiten bereikbaar. Hij wordt gelezen via `ssh root@saxombp docker exec`.
 * Gevolg: dit script werkt vanaf de machine van de eigenaar en niet vanuit CI.
 * Dat is een bewuste grens, geen omissie — zie de toelichting bij `leesViaSsh`.
 *
 * Vlaggen:
 *   --zonder-acceptatie   sla acceptatie over (bijv. zonder Tailscale)
 *
 * ── Beproefd op 2026-08-12 ───────────────────────────────────────────────────
 *
 * Groen tegen de drie echte omgevingen (alle drie 26 migraties, 19 tabellen,
 * 6 rollen). Daarna is elke controle apart rood gemaakt op een wegwerpcontainer
 * — een groene controle die nooit heeft gefaald, bewijst niets:
 *
 *   tabel gedropt (vendor_tag)          → tabellenverschil gemeld
 *   tabel zonder RLS teruggezet         → tenantgrens gemeld
 *   daarna rechten ingetrokken          → melding verdween, en dát is het punt:
 *                                         de controle onderscheidt "geen RLS"
 *                                         van "geen RLS én leesbaar"
 *   BYPASSRLS gezet                     → rolmelding
 *   27e migratierij toegevoegd          → "loopt VÓÓR op de repository"
 *   clm_api_runtime verwijderd          → onbereikbaar, met de reden erbij
 *   ssh geweigerd                       → acceptatie ONBEREIKBAAR, rest gaat door
 *
 * Exitcode gemeten zónder pipe: 1 bij afwijking, 0 bij gelijk. Met een pipe
 * meet je de exitcode van het laatste commando in de keten en lijkt alles goed.
 */

require('dotenv/config');

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { Client } = require('pg');

const SERVER = 'root@saxombp';
const ACCEPTATIE_CONTAINER = 'mcm2-acceptatie-db-1';

/**
 * De backend-poorten van elke omgeving op saxombp, gelijk aan `OMGEVINGEN` in
 * deploy.js en deploy-status.js. Alle drie omgevingen draaien hier — ook
 * staging en productie, die voor de databasevergelijking hierboven een eigen
 * Supabase-URL gebruiken. Voor de draaiende códe maakt dat niet uit: die
 * draait altijd op saxombp, ongeacht waar de data staat.
 */
const API_POORT = { acceptatie: 5011, staging: 5031, productie: 5021 };

/** Draait een commando op saxombp via SSH. Zelfde vorm als in deploy.js. */
function opServer(commando, { stil = false } = {}) {
  const res = spawnSync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', SERVER, commando],
    { encoding: 'utf8', stdio: stil ? 'pipe' : ['pipe', 'pipe', 'pipe'] },
  );

  return {
    ok: res.status === 0,
    uit: (res.stdout || '').trim(),
    fout: (res.stderr || '').trim(),
  };
}

const JOURNAL_PAD = path.join(
  __dirname,
  '..',
  'drizzle',
  'meta',
  '_journal.json',
);

/**
 * Wat elke omgeving over zichzelf hoort te zeggen in `clm.omgeving`.
 *
 * Dit is de enige verwachting die in dit bestand staat, en dat is bewust: het
 * is een besluit en geen meting. `beschermd` betekent dat de schrijvende
 * scripts weigeren zonder `--extern`; `wegwerp` betekent dat ze doorgaan.
 *
 * ── Acceptatie staat hier op `beschermd`, en dat wijkt af van het plan ─────
 *
 * §4.1 schrijft `wegwerp` voor. Bij de eerste run van deze controle
 * (2026-08-12) bleek acceptatie `beschermd` te zijn, met nog de standaardtekst
 * uit migratie 0019 — hij is dus nooit gemarkeerd.
 *
 * Nagegaan waaróm het plan `wegwerp` zei: omdat daar de e2e-suites zouden
 * draaien, en die weigeren tegen een beschermde database. Maar de e2e-suites
 * draaien niet tegen acceptatie; ze zetten hun eigen wegwerpcontainer op. De
 * reden voor `wegwerp` bestaat dus niet.
 *
 * Daarom is de verwachting bijgesteld in plaats van de database. Acceptatie
 * markeren als wegwerp zou een rem losdraaien op een database die op een
 * server staat, in ruil voor niets. De veilige stand is ook de juiste stand.
 *
 * Wie hier ooit toch `wegwerp` van wil maken: dat is een besluit, en het hoort
 * in het plan te staan vóórdat het hier staat.
 */
const VERWACHTE_MARKERING = {
  acceptatie: 'beschermd',
  staging: 'wegwerp',
  productie: 'beschermd',
};

/**
 * Draait de frontend mee op deze omgeving? Gelijk aan FRONTEND_MEE in
 * deploy.js en deploy-status.js — die vlag geldt voor alle drie tegelijk, dus
 * hier hetzelfde.
 */
const FRONTEND_VERWACHT = { acceptatie: true, staging: true, productie: true };

/**
 * De vijf vragen, als één query per omgeving.
 *
 * Bewust één ronde in plaats van vijf: staging en productie zitten achter een
 * pooler aan de andere kant van het land, en vijf keer heen en weer maakt het
 * verschil tussen een controle die je draait en een die je overslaat.
 *
 * `tenantgebonden` is dezelfde definitie als in otap-doorloop.js: een tabel in
 * het clm-schema met een `tenant_id`-kolom. Die afleiding staat er niet voor de
 * sier — een handmatige lijst zou de tabel missen die net is toegevoegd, en dat
 * is precies de tabel waar RLS het vaakst op vergeten wordt.
 *
 * ── Waarom `onbeschermd` niet simpelweg "geen RLS" is ──────────────────────
 *
 * De eerste versie van deze controle meldde `clm.sessie` op alle drie de
 * omgevingen. Dat was een vals alarm, en het is de moeite waard waarom.
 *
 * `clm.sessie` heeft bewust géén RLS (migratie 0010): een sessie moet
 * opgezocht worden vóórdat de tenantcontext bestaat — de tenant vólgt immers
 * uit de sessie — dus RLS zou daar altijd nul rijen geven. Die tabel is op een
 * andere manier dicht: de rechten van `clm_api_runtime` zijn ingetrokken en
 * alle toegang loopt via drie SECURITY DEFINER-functies. Gemeten:
 * `has_table_privilege` geeft false voor zowel SELECT als INSERT.
 *
 * De garantie die er werkelijk toe doet is dus niet "elke tenanttabel heeft
 * RLS" maar: **de applicatierol kan geen tenantgebonden tabel lezen zonder dat
 * er een tenantgrens op staat.** Daar zijn twee geldige manieren voor, en deze
 * query accepteert ze allebei.
 *
 * Was dit blijven staan als "geen RLS", dan had de controle drie keer per keer
 * een bekende, correcte situatie gemeld. Een waarschuwing die altijd afgaat, is
 * geen waarschuwing meer — dezelfde les als bij de backupmelding die niemand
 * las (2026-08-04) en bij de `--extern`-vlag in stap 5.
 *
 * ── Waarom `c.oid` en niet `'clm.' || quote_ident(...)` ────────────────────
 *
 * De tekstvariant van `has_table_privilege` faalde op acceptatie met:
 *
 *   ERROR: relation "clm.__drizzle_migrations" does not exist
 *
 * Een tabel die in dít deel van de query helemaal niet voorkomt. De tekstvorm
 * laat Postgres de naam laat oplossen, en de fout kwam terecht op een
 * verwijzing verderop in dezelfde `json_build_object`. Kost een half uur
 * zoeken, want de melding wijst de verkeerde kant op.
 *
 * De oid-vorm identificeert de tabel rechtstreeks en heeft dat probleem niet.
 * Meteen ook de reden dat dit blok `pg_class` gebruikt en niet `pg_tables`:
 * daar is de oid al bij de hand.
 */
const VRAGEN = `
  SELECT json_build_object(
    'migraties', (
      SELECT count(*)::int FROM drizzle.__drizzle_migrations
    ),
    'markering', (
      SELECT soort FROM clm.omgeving LIMIT 1
    ),
    'tabellen', (
      SELECT coalesce(json_agg(tablename ORDER BY tablename), '[]'::json)
        FROM pg_tables WHERE schemaname = 'clm'
    ),
    'onbeschermd', (
      SELECT coalesce(json_agg(c.relname ORDER BY c.relname), '[]'::json)
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'clm'
         AND c.relkind = 'r'
         AND NOT c.relrowsecurity
         AND EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = c.oid
                        AND a.attname = 'tenant_id'
                        AND a.attnum > 0
                        AND NOT a.attisdropped)
         AND has_table_privilege('clm_api_runtime', c.oid, 'SELECT')
    ),
    'runtimeBypassrls', (
      SELECT rolbypassrls FROM pg_roles WHERE rolname = 'clm_api_runtime'
    ),
    'rollen', (
      SELECT coalesce(json_agg(rolname ORDER BY rolname), '[]'::json)
        FROM pg_roles WHERE rolname LIKE 'clm\\_%'
    )
  ) AS uitkomst
`;

/**
 * Leest een omgeving over een gewone Postgres-verbinding.
 *
 * Een mislukking is hier geen uitzondering die het script afbreekt maar een
 * uitkomst met een `fout`-veld. Reden: valt staging weg, dan wil je nog steeds
 * weten wat acceptatie en productie doen. Een controle die bij het eerste
 * probleem stopt, vertelt je één ding terwijl je er drie kwam halen.
 */
async function leesViaPg(url) {
  const client = new Client({
    connectionString: url,
    // Supabase' pooler biedt een certificaat aan dat niet in de
    // standaardketen van Node zit. Zonder dit faalt élke controle tegen
    // staging en productie op een verbindingsfout. Zelfde afweging als in
    // db-doelwit.js.
    ssl: /supabase|amazonaws|neon/.test(url)
      ? { rejectUnauthorized: false }
      : undefined,
    connectionTimeoutMillis: 30_000,
  });

  try {
    await client.connect();
    const { rows } = await client.query(VRAGEN);
    return rows[0].uitkomst;
  } catch (fout) {
    return { fout: fout.message };
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Leest acceptatie via `ssh … docker exec psql`.
 *
 * ── Waarom deze omweg, en waarom hij zo hoort te blijven ───────────────────
 *
 * De acceptatiedatabase is gebonden aan `127.0.0.1:55460` op saxombp. Dat is
 * geen ongemak dat opgelost moet worden maar precies de bedoeling: een
 * databasepoort die op `0.0.0.0` staat, staat open voor het hele netwerk. Het
 * runbook schrijft die binding voor.
 *
 * De verleiding is om er een SSH-tunnel bij te bouwen zodat `pg` er ook bij
 * kan. Dat is meer bewegende delen — een poort die vrij moet zijn, een proces
 * dat opgeruimd moet worden, een tunnel die blijft hangen als het script
 * afbreekt — voor precies dezelfde uitkomst. `docker exec` heeft dat allemaal
 * niet.
 *
 * De prijs is dat dit script niet in CI kan draaien: een runner komt niet op
 * het tailnet (vastgesteld op 2026-08-09, drie pogingen). Voor de andere twee
 * omgevingen zou dat wel kunnen, maar een halve controle die groen meldt is
 * erger dan geen. Vandaar `--zonder-acceptatie`: expliciet, zichtbaar in de
 * uitvoer, en niet de standaard.
 */
function leesViaSsh() {
  // De query gaat over stdin, niet als argument. Dat is geen stijlkeuze: als
  // argument passeert hij twee shells (die van ssh en die van docker exec), en
  // elke laag haalt er een escape af. Vastgesteld op 2026-08-12 — `LIKE
  // 'clm\\_%'` kwam aan als `LIKE 'clm_%'`. Hier viel dat mee, maar een query
  // die onderweg stilzwijgend verandert is precies het soort meetfout waar dit
  // script tegen hoort te beschermen.
  //
  // `-f -` laat psql van stdin lezen; `-tA` houdt de uitvoer kaal.
  const res = spawnSync(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=15',
      SERVER,
      `docker exec -i ${ACCEPTATIE_CONTAINER} psql -U postgres -tA -f -`,
    ],
    { encoding: 'utf8', input: VRAGEN },
  );

  if (res.status !== 0) {
    const melding = (res.stderr || '').trim() || `ssh gaf ${res.status}`;

    return {
      fout: /tailnet policy|Permission denied|Connection closed/i.test(melding)
        ? `${melding}\n(Tailscale-sessie verlopen? Draai: tailscale status)`
        : melding,
    };
  }

  try {
    return JSON.parse((res.stdout || '').trim());
  } catch (fout) {
    return { fout: `onleesbaar antwoord van psql: ${fout.message}` };
  }
}

/**
 * Vraagt /health op via SSH + curl vanaf saxombp zelf, niet vanaf de laptop.
 *
 * ── Waarom niet gewoon fetch() naar het adres van de omgeving ───────────────
 *
 * Acceptatie is met opzet alleen op `127.0.0.1` op saxombp bereikbaar — zie de
 * toelichting bij `leesViaSsh`. Een rechtstreeks verzoek vanaf de laptop zou
 * voor acceptatie dus altijd falen, terwijl voor staging en productie precies
 * hetzelfde IP-adres wordt gebruikt (thuisrouter, gedeeld, niet vast — zie
 * CLAUDE.md §0b). Vanaf de server zelf werken alle drie op dezelfde manier,
 * en dat is ook de weg die deploy-status.js al gebruikt.
 *
 * Dit hoort dus bij dezelfde grens als leesViaSsh: dit deel van de controle
 * werkt alleen vanaf de machine van de eigenaar, niet vanuit CI.
 */
function leesHealth(omgevingNaam) {
  const poort = API_POORT[omgevingNaam];

  const res = opServer(
    `curl -s --max-time 8 http://localhost:${poort}/health || true`,
    { stil: true },
  );

  if (!res.ok || !res.uit) {
    return { fout: res.fout || 'geen antwoord van /health' };
  }

  try {
    return JSON.parse(res.uit);
  } catch (fout) {
    return { fout: `onleesbaar antwoord van /health: ${fout.message}` };
  }
}

/** Het aantal migraties dat de repository voorschrijft. */
function journalStand() {
  return JSON.parse(fs.readFileSync(JOURNAL_PAD, 'utf8')).entries.length;
}

function verschil(a, b) {
  return a.filter((x) => !b.includes(x));
}

async function main() {
  const zonderAcceptatie = process.argv.includes('--zonder-acceptatie');

  console.log('');
  console.log('De drie omgevingen naast elkaar');
  console.log('─'.repeat(70));

  const verwacht = journalStand();

  const stagingUrl = process.env.STAGING_MIGRATION_DATABASE_URL;
  const productieUrl = process.env.PRODUCTIE_MIGRATION_DATABASE_URL;

  const omgevingen = {};

  if (zonderAcceptatie) {
    console.log('\n  Acceptatie: OVERGESLAGEN (--zonder-acceptatie)');
  } else {
    omgevingen.acceptatie = leesViaSsh();
  }

  omgevingen.staging = stagingUrl
    ? await leesViaPg(stagingUrl)
    : { fout: 'STAGING_MIGRATION_DATABASE_URL ontbreekt' };

  omgevingen.productie = productieUrl
    ? await leesViaPg(productieUrl)
    : { fout: 'PRODUCTIE_MIGRATION_DATABASE_URL ontbreekt' };

  // Losse meting van de databasevergelijking hierboven: /health komt altijd
  // van saxombp zelf, ook voor staging en productie — die hebben wel een
  // eigen Supabase-database maar geen eigen server. Apart gehouden zodat een
  // falende health-meting de databasemeting van diezelfde omgeving niet
  // aanmerkt als ONBEREIKBAAR — het zijn twee onafhankelijke wegen naar twee
  // verschillende vragen.
  const codeOmgevingen = zonderAcceptatie
    ? { staging: leesHealth('staging'), productie: leesHealth('productie') }
    : {
        acceptatie: leesHealth('acceptatie'),
        staging: leesHealth('staging'),
        productie: leesHealth('productie'),
      };

  // ── Het overzicht ─────────────────────────────────────────────────────────
  //
  // Eerst tonen wat er gemeten is, dan pas oordelen. Wie het niet eens is met
  // de conclusie moet de meting kunnen zien zonder het script te lezen.
  const namen = Object.keys(omgevingen);
  const bevindingen = [];

  console.log('');
  console.log(`  Repository: ${verwacht} migraties in het journal`);
  console.log('');

  for (const naam of namen) {
    const o = omgevingen[naam];

    if (o.fout) {
      console.log(`  ${naam.padEnd(11)} ONBEREIKBAAR`);
      bevindingen.push(`${naam} is niet te lezen — ${o.fout}`);
      continue;
    }

    console.log(
      `  ${naam.padEnd(11)} ${String(o.migraties).padStart(2)} migraties  ` +
        `${String(o.tabellen.length).padStart(2)} tabellen  ` +
        `${String(o.rollen.length).padStart(2)} rollen  ` +
        `${o.markering ?? '(niet gemarkeerd)'}`,
    );

    // Losse regel, niet ingekort: een digest is lang (sha256:…) en het punt is
    // juist dat hij met het oog te vergelijken is tussen omgevingen.
    const c = codeOmgevingen[naam];
    if (c && !c.fout) {
      console.log(
        `  ${''.padEnd(11)} code: ${c.imageDigest ?? '(geen digest)'}` +
          (FRONTEND_VERWACHT[naam]
            ? `  frontend: ${c.frontendImageDigest ?? '(geen digest)'}`
            : ''),
      );
    }
  }

  const leesbaar = namen.filter((n) => !omgevingen[n].fout);

  // ── 1. Migratiestand ──────────────────────────────────────────────────────
  for (const naam of leesbaar) {
    const gevonden = omgevingen[naam].migraties;

    // Achterlopen is niet altijd fout — productie mag achterlopen vlak vóór een
    // uitrol. Vóórlopen is dat wél: dan draait daar iets dat niet uit deze code
    // komt. Zelfde onderscheid als in productie-poort.js, en met opzet niet
    // strenger: deze controle hoort niet af te gaan op een normale werkdag.
    if (gevonden > verwacht) {
      bevindingen.push(
        `${naam} staat op ${gevonden} migraties, de repository op ${verwacht}.\n` +
          'Die omgeving loopt VÓÓR op deze code — draait daar iets dat hier\n' +
          'niet in zit, of wijst dit naar de verkeerde database?',
      );
    } else if (gevonden < verwacht) {
      console.log(
        `\n  Let op: ${naam} loopt achter (${gevonden} van ${verwacht}).`,
      );
    }
  }

  // ── 2. Tabellen ───────────────────────────────────────────────────────────
  //
  // Onderling vergelijken, niet met een lijst hier. De omgevingen zijn elkaars
  // maatstaf: wijken ze af, dan is dát het signaal, ongeacht wie gelijk heeft.
  for (const naam of leesbaar) {
    for (const ander of leesbaar) {
      if (naam >= ander) continue;

      const mist = verschil(
        omgevingen[ander].tabellen,
        omgevingen[naam].tabellen,
      );
      const extra = verschil(
        omgevingen[naam].tabellen,
        omgevingen[ander].tabellen,
      );

      if (mist.length || extra.length) {
        bevindingen.push(
          `${naam} en ${ander} hebben niet dezelfde tabellen.\n` +
            (mist.length ? `  ${naam} mist: ${mist.join(', ')}\n` : '') +
            (extra.length ? `  alleen in ${naam}: ${extra.join(', ')}\n` : '') +
            'Dit is de vorm van #25: productie miste 9 van de 18 tabellen en\n' +
            'niemand wist het, omdat elke backup er vers uitzag.',
        );
      }
    }
  }

  // ── 3. Tenantgrens ────────────────────────────────────────────────────────
  for (const naam of leesbaar) {
    const zonder = omgevingen[naam].onbeschermd;

    if (zonder.length > 0) {
      bevindingen.push(
        `${naam}: ${zonder.length} tenantgebonden tabel(len) zonder tenantgrens —\n` +
          `  ${zonder.join(', ')}\n` +
          'Deze tabellen hebben een tenant_id, geen RLS, én clm_api_runtime mag\n' +
          'ze lezen. Daarmee kan elke tenant bij de rijen van elke andere.',
      );
    }
  }

  // ── 4. Rollen ─────────────────────────────────────────────────────────────
  for (const naam of leesbaar) {
    const o = omgevingen[naam];

    if (o.runtimeBypassrls === null) {
      bevindingen.push(
        `${naam}: de rol clm_api_runtime bestaat niet.\n` +
          'De applicatie hoort onder die rol te draaien (ADR-008).',
      );
    } else if (o.runtimeBypassrls === true) {
      bevindingen.push(
        `${naam}: clm_api_runtime heeft BYPASSRLS.\n` +
          'Dan staat RLS er wel, maar doet hij niets voor de applicatie — de\n' +
          'tenant-isolatie is daarmee waardeloos (ADR-008).',
      );
    }
  }

  // ── 5. Markering ──────────────────────────────────────────────────────────
  for (const naam of leesbaar) {
    const gevonden = omgevingen[naam].markering;
    const hoort = VERWACHTE_MARKERING[naam];

    if (gevonden !== hoort) {
      bevindingen.push(
        `${naam} is gemarkeerd als '${gevonden ?? '(niets)'}', verwacht '${hoort}'.\n` +
          (hoort === 'beschermd'
            ? 'Een omgeving met echte data die zich als wegwerp meldt, laat de\n' +
              'schrijvende scripts en de e2e-suites zonder waarschuwing door.'
            : 'Een wegwerpomgeving die zich als beschermd meldt, blokkeert de\n' +
              'e2e-suites en elk schrijvend script dat daar hoort te werken.'),
      );
    }
  }

  // ── 6. Draaiende code ────────────────────────────────────────────────────
  //
  // Dit meldt bewust NIET dat staging en productie hetzelfde image moeten
  // draaien — dat mogen ze best verschillen: staging beproeft de volgende
  // versie vóórdat productie hem krijgt (dat is de hele reden dat staging
  // bestaat). Wat hier wél gecontroleerd wordt: dat elke bereikbare omgeving
  // een digest kan tónen. Ontbreekt die, dan is de vraag "welke code draait
  // hier echt" onbeantwoordbaar — precies het gat uit pariteitscontract §2.
  //
  // De digests zelf staan in het overzicht hierboven zodra ze gemeten zijn
  // (zie het printblok verderop); wie ze wil vergelijken kan dat met het oog.
  const codeNamen = Object.keys(codeOmgevingen);

  for (const naam of codeNamen) {
    const c = codeOmgevingen[naam];

    if (c.fout) {
      bevindingen.push(
        `${naam}: /health is niet te lezen — ${c.fout}\n` +
          'Zonder dit endpoint is niet vast te stellen welke code hier draait.',
      );
      continue;
    }

    if (!c.imageDigest) {
      bevindingen.push(
        `${naam}: /health meldt geen imageDigest.\n` +
          'Ofwel deze omgeving draait een image van vóór deze meting (zie\n' +
          '  pariteitscontract), ofwel de uitrol heeft de digest niet kunnen\n' +
          '  vaststellen. npm run deploy:status laat zien wat er nu draait.',
      );
    }

    if (FRONTEND_VERWACHT[naam] && !c.frontendImageDigest) {
      bevindingen.push(
        `${naam}: /health meldt geen frontendImageDigest.\n` +
          '  Zelfde ontbrekende bewijs, maar dan voor de frontend.',
      );
    }
  }

  // ── Uitkomst ──────────────────────────────────────────────────────────────
  console.log('');

  if (bevindingen.length > 0) {
    console.error('─'.repeat(70));
    console.error('');
    console.error(`AFWIJKINGEN — ${bevindingen.length}:`);
    console.error('');

    for (const bevinding of bevindingen) {
      console.error(
        bevinding
          .split('\n')
          .map((r) => `  ${r}`)
          .join('\n'),
      );
      console.error('');
    }

    process.exit(1);
  }

  console.log('─'.repeat(70));
  console.log('');
  console.log('  GELIJK — de omgevingen komen op alle zes punten overeen.');
  console.log('');
}

main().catch((fout) => {
  console.error(`\nOnverwachte fout: ${fout.message}\n`);
  process.exit(1);
});
