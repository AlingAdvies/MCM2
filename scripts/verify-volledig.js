#!/usr/bin/env node
'use strict';

/**
 * De volledige doorloop: van code tot browser (`npm run verify:volledig`).
 *
 * ── Waarom dit bestaat ───────────────────────────────────────────────────────
 *
 * `npm run verify` bewijst dat de code klopt en dat de backend doet wat hij
 * belooft. Wat het níét bewijst is of de keten áls geheel werkt — of het
 * scherm de juiste route aanroept, of het sessiecookie meekomt, of een
 * aangemaakte leverancier daadwerkelijk terugkomt uit de database.
 *
 * Dat gat is niet theoretisch. Issue #42 en #43 waren allebei fouten die 155
 * backend-tests niet zagen en één blik in de browser wél: een ontbrekend
 * uploadveld en een leesblok met keuzerondjes.
 *
 * Dit script sluit dat gat. Eén commando, van opmaakcontrole tot een browser
 * die een leverancier aanmaakt en hem terugziet.
 *
 * ── Wat het doet ─────────────────────────────────────────────────────────────
 *
 *   1. npm run verify        code, unittests, e2e tegen een wegwerpdatabase
 *   2. stack bouwen          beide productie-images via docker compose
 *   3. migraties + sessie    tenant, gebruiker en een échte sessie
 *   4. browsertest           Playwright tegen de draaiende stack
 *   5. opruimen              altijd, ook na een fout
 *
 * Stap 4 draait tegen de PRODUCTIE-images, niet tegen `next dev`. Dat verschil
 * is de hele reden dat de OTAP-doorloop bestaat: een ontwikkelserver had de
 * EACCES-uploadfout in het productie-image nooit gevonden.
 */

const { spawnSync } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');

const COMPOSE = ['compose', '-f', 'docker-compose.otap.yml'];

/** Vaste id's voor de doorloop. Buiten de reeksen uit test/test-ids.ts. */
const TENANT_ID = '00000000-0000-0000-0000-0000000000d0';
const USER_ID = '00000000-0000-0000-0000-0000000000d1';
const SUBJECT = 'oid-verify-volledig';

const isWindows = process.platform === 'win32';

function draai(commando, argumenten, opties = {}) {
  // Een bestand als stdin doorgeven: psql leest het schema dan van de
  // standaardinvoer, precies zoals het runbook `< bestand.sql` gebruikt.
  const invoer = opties.invoerBestand
    ? readFileSync(opties.invoerBestand, 'utf8')
    : undefined;

  const resultaat = spawnSync(commando, argumenten, {
    stdio: opties.stil || invoer ? 'pipe' : 'inherit',
    shell: isWindows,
    encoding: 'utf8',
    env: { ...process.env, ...(opties.env ?? {}) },
    cwd: opties.cwd,
    input: invoer,
  });

  return {
    ok: resultaat.status === 0,
    uitvoer: (resultaat.stdout ?? '') + (resultaat.stderr ?? ''),
  };
}

/** Draait psql in de databasecontainer. */
function psql(sql, rol = 'postgres') {
  return draai(
    'docker',
    [
      ...COMPOSE,
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      rol,
      // De database expliciet: psql neemt anders de rolnaam als databasenaam
      // en faalt met `database "clm_migrator" does not exist` — een melding
      // die naar de verkeerde oorzaak wijst.
      '-d',
      'postgres',
      '-tAc',
      `"${sql}"`,
    ],
    { stil: true },
  );
}

function kop(nummer, totaal, tekst) {
  console.log(`\n${nummer}/${totaal}  ${tekst}`);
}

function opruimen() {
  console.log('\nOpruimen…');
  draai('docker', [...COMPOSE, 'down', '-v'], { stil: true });
}

/**
 * Wacht tot de stack antwoordt.
 *
 * Bewust pollen op een echte HTTP-reactie en niet op "de container draait":
 * een Next.js-server met een kapotte build start wél en geeft een 500. Dat
 * onderscheid is in dit project al eens misgegaan.
 */
function wachtOpStack(maxSeconden = 120) {
  const einde = Date.now() + maxSeconden * 1000;
  let laatsteFout = '';

  while (Date.now() < einde) {
    const api = draai(
      'curl',
      ['-s', '-o', isWindows ? 'NUL' : '/dev/null', '-w', '%{http_code}', 'http://localhost:5001/health'],
      { stil: true },
    );
    const web = draai(
      'curl',
      ['-s', '-o', isWindows ? 'NUL' : '/dev/null', '-w', '%{http_code}', 'http://localhost:3000/'],
      { stil: true },
    );

    const apiCode = api.uitvoer.trim();
    const webCode = web.uitvoer.trim();

    if (apiCode === '200' && webCode === '200') {
      return { ok: true };
    }

    laatsteFout = `api=${apiCode || 'geen antwoord'} frontend=${webCode || 'geen antwoord'}`;
    draai(isWindows ? 'timeout' : 'sleep', isWindows ? ['/t', '2', '/nobreak'] : ['2'], {
      stil: true,
    });
  }

  return { ok: false, reden: laatsteFout };
}

/**
 * De poorten die de doorloopstack nodig heeft, met wie ze normaal bezet houdt.
 *
 * Zie controleerPoortenVrij() hieronder voor waarom dit vooraf gebeurt.
 */
const STACK_POORTEN = [
  { poort: 5001, wat: 'de API', gebruikelijk: 'npm run start:prod of npm run start:dev' },
  { poort: 3000, wat: 'de frontend', gebruikelijk: 'npm run dev in MCM2-frontend' },
];

/**
 * Weigert te starten zolang 5001 of 3000 bezet is.
 *
 * ── Waarom dit vóór stap 1 staat en niet bij stap 2 ──────────────────────────
 *
 * Aanleiding: op 2026-08-03 liep deze doorloop twee keer achter elkaar vast op
 * een bezette poort. Beide keren pas ná stap 1 — die duurt enkele minuten,
 * inclusief het opzetten en weer afbreken van een wegwerpdatabase en 269
 * e2e-tests. De foutmelding kwam van Docker en luidde "ports are not
 * available", zonder te zeggen wélk proces de poort vasthield.
 *
 * De poorten waren bezet door een handmatig gestarte backend en frontend uit
 * een eerdere sessie — de normaalste zaak van de wereld tijdens ontwikkelen.
 *
 * Vooraf controleren kost een fractie van een seconde en bespaart die hele
 * ronde. Dat is de hele reden dat dit hier staat.
 *
 * ── Waarom weigeren en niet zelf afsluiten ───────────────────────────────────
 *
 * Een proces doodschieten dat iemand bewust heeft gestart, is een
 * onomkeerbare actie op andermans werk: een dev-server met ongesaveerde staat,
 * een debugsessie, een demo die live staat. Het script meldt wat er in de weg
 * staat en laat de keuze aan de gebruiker.
 *
 * ── Waarom dit óók een correctheidsprobleem is ───────────────────────────────
 *
 * wachtOpStack() pollt op http://localhost:5001/health en :3000. Draait daar al
 * iets, dan antwoordt dát met 200 en concludeert het script dat de stack
 * gezond is — terwijl de browsertest vervolgens tegen een dev-server draait in
 * plaats van tegen de productie-images die deze stap juist moet bewijzen.
 *
 * Vandaar dat het bezet zijn van een poort hier hard faalt en niet alleen een
 * waarschuwing geeft: een groene doorloop die het verkeerde getest heeft, is
 * erger dan een rode.
 */
function controleerPoortenVrij() {
  const bezet = [];

  for (const { poort, wat, gebruikelijk } of STACK_POORTEN) {
    // Bewust curl en geen netstat: netstat verschilt per platform en vraagt op
    // Windows om parsing van een tabel. Een HTTP-antwoord bewijst bovendien
    // méér — een luisterende poort zonder antwoord blokkeert Docker niet.
    const antwoord = draai(
      'curl',
      [
        '-s',
        '-o',
        isWindows ? 'NUL' : '/dev/null',
        '-w',
        '%{http_code}',
        '--max-time',
        '2',
        `http://localhost:${poort}/`,
      ],
      { stil: true },
    );

    const code = antwoord.uitvoer.trim();

    // Elk HTTP-antwoord betekent dat er iets luistert. Ook een 404 of 500:
    // Docker kan de poort dan evengoed niet binden.
    if (code && code !== '000') {
      bezet.push({ poort, wat, gebruikelijk, code });
    }
  }

  return bezet;
}

/** Containernaam voor de wegwerpdatabase van stap 1. */
const TESTDB = 'mcm2-verify-volledig-db';
const TESTDB_POORT = 55441;

/**
 * Start een wegwerpdatabase voor stap 1.
 *
 * Los van de doorloopstack (die draait op 55500) en los van de container die
 * iemand handmatig voor `npm run verify` gebruikt (55440). Drie poorten, drie
 * doelen — dat voorkomt dat deze doorloop andermans database leegruimt.
 */
function startTestDatabase() {
  draai('docker', ['rm', '-f', TESTDB], { stil: true });

  const gestart = draai(
    'docker',
    [
      'run',
      '-d',
      '--name',
      TESTDB,
      '-e',
      'POSTGRES_PASSWORD=pw',
      '-p',
      `${TESTDB_POORT}:5432`,
      'postgres:17.6',
    ],
    { stil: true },
  );

  if (!gestart.ok) {
    return { ok: false, reden: gestart.uitvoer.trim() };
  }

  // Wachten tot Postgres verbindingen accepteert.
  //
  // `pg_isready` alleen is niet genoeg, en dat leverde een onregelmatig
  // falende doorloop op (2026-08-03): het officiële postgres-image start
  // tijdens de eerste initialisatie een *tijdelijke* server die alleen op de
  // Unix-socket luistert. pg_isready meldt die als "accepting connections",
  // waarna het image de server stopt en opnieuw start voor de echte. Een psql
  // die precies daartussen valt, faalt met:
  //
  //   connection to server on socket "/var/run/postgresql/.s.PGSQL.5432"
  //   failed: No such file or directory
  //
  // Een melding die naar de verkeerde oorzaak wijst — hij suggereert dat er
  // geen server draait, terwijl de container gezond is.
  //
  // Daarom een echte query als bewijs van gereedheid, en pas doorgaan als die
  // twee keer achter elkaar slaagt: één keer kan nog de tijdelijke server zijn.
  let opeenvolgendGoed = 0;

  for (let poging = 0; poging < 60; poging += 1) {
    const gereed = draai(
      'docker',
      ['exec', TESTDB, 'psql', '-U', 'postgres', '-tAc', '"SELECT 1"'],
      { stil: true },
    );

    opeenvolgendGoed = gereed.ok ? opeenvolgendGoed + 1 : 0;

    if (opeenvolgendGoed >= 2) {
      const rollen = draai(
        'docker',
        ['exec', '-i', TESTDB, 'psql', '-U', 'postgres', '-q'],
        { stil: true, invoerBestand: 'db/roles/bootstrap-roles.sql' },
      );

      if (!rollen.ok) {
        return { ok: false, reden: rollen.uitvoer.trim() };
      }

      draai(
        'docker',
        [
          'exec',
          TESTDB,
          'psql',
          '-U',
          'postgres',
          '-q',
          '-c',
          '"ALTER ROLE clm_migrator WITH PASSWORD \'pw\'; ALTER ROLE clm_api_runtime WITH PASSWORD \'pw\';"',
        ],
        { stil: true },
      );

      const migraties = draai('npm', ['run', 'migrate:deploy'], {
        stil: true,
        env: {
          MIGRATION_DATABASE_URL: `postgresql://clm_migrator:pw@localhost:${TESTDB_POORT}/postgres`,
        },
      });

      if (!migraties.ok) {
        return { ok: false, reden: migraties.uitvoer.trim() };
      }

      return {
        ok: true,
        url: `postgresql://clm_api_runtime:pw@localhost:${TESTDB_POORT}/postgres`,
      };
    }

    draai(isWindows ? 'timeout' : 'sleep', isWindows ? ['/t', '1', '/nobreak'] : ['1'], {
      stil: true,
    });
  }

  return {
    ok: false,
    reden: `Postgres in ${TESTDB} accepteerde binnen 60 seconden geen twee opeenvolgende queries. Bekijk 'docker logs ${TESTDB}'.`,
  };
}

function stopTestDatabase() {
  draai('docker', ['rm', '-f', TESTDB], { stil: true });
}

/**
 * Bouwt de database vanaf niets op: rollen, wachtwoorden, migraties.
 *
 * Dit hoort bij de doorloop en is geen voorbereiding: het bewijst dat een lege
 * database via de migratieketen tot een werkend schema komt (runbook stap 3).
 *
 * De API is al gestart vóórdat de rollen bestonden en kan daardoor niet
 * verbinden. Herstarten is verplicht — zonder die stap wacht `wachtOpStack()`
 * tevergeefs op een backend die nooit gezond wordt. Dat kostte bij de eerste
 * doorloop tijd, en staat daarom in het runbook.
 */
function bouwDatabaseOp() {
  const rollen = draai(
    'docker',
    [
      ...COMPOSE,
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'postgres',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      '-',
    ],
    { stil: true, invoerBestand: 'db/roles/bootstrap-roles.sql' },
  );

  if (!rollen.ok) {
    return { ok: false, reden: `bootstrap-roles.sql: ${rollen.uitvoer.trim()}` };
  }

  const wachtwoorden = psql(
    "ALTER ROLE clm_migrator WITH PASSWORD 'otap_pw'; ALTER ROLE clm_api_runtime WITH PASSWORD 'otap_pw';",
  );

  if (!wachtwoorden.ok) {
    return { ok: false, reden: wachtwoorden.uitvoer.trim() };
  }

  const migraties = draai('npm', ['run', 'migrate:deploy'], {
    stil: true,
    env: {
      MIGRATION_DATABASE_URL:
        'postgresql://clm_migrator:otap_pw@localhost:55500/postgres',
    },
  });

  if (!migraties.ok) {
    return { ok: false, reden: migraties.uitvoer.trim() };
  }

  console.log('  Migraties toegepast op een lege database.');

  // Zie de uitleg hierboven: zonder deze herstart blijft de API onbereikbaar.
  draai('docker', [...COMPOSE, 'restart', 'api'], { stil: true });

  return { ok: true };
}

/**
 * Zet een tenant, gebruiker en membership klaar, en maakt een échte sessie.
 *
 * Geen nagebootst cookie: `clm.sessie_aanmaken()` doet het werk, inclusief de
 * membershipcontrole. Wat de browsertest daarna gebruikt is dus precies wat
 * een geslaagde inlog zou opleveren — alleen het verkrijgen ervan is
 * overgeslagen, niet de sessie zelf.
 */
function maakSessie() {
  const opzet = [
    `INSERT INTO clm.tenant (tenant_id, name) VALUES ('${TENANT_ID}', 'Doorloop') ON CONFLICT DO NOTHING;`,
    `INSERT INTO clm.\\"user\\" (user_id, tenant_id, full_name, external_subject) VALUES ('${USER_ID}', '${TENANT_ID}', 'Doorloop Beheerder', '${SUBJECT}') ON CONFLICT DO NOTHING;`,
    `INSERT INTO clm.tenant_membership (user_id, tenant_id, role) VALUES ('${USER_ID}', '${TENANT_ID}', 'admin') ON CONFLICT DO NOTHING;`,
  ];

  for (const sql of opzet) {
    // Als eigenaar, want deze tabellen staan onder RLS en er is nog geen
    // tenantcontext. Dit is opzetwerk, geen applicatiecode.
    const uitkomst = psql(
      `SET app.current_tenant_id = '${TENANT_ID}'; ${sql}`,
      'clm_migrator',
    );

    if (!uitkomst.ok) {
      return { ok: false, reden: uitkomst.uitvoer.trim() };
    }
  }

  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token, 'utf8').digest('hex');

  const sessie = psql(
    `SELECT tenant_id FROM clm.sessie_aanmaken('${hash}', '${SUBJECT}', '8 hours'::interval);`,
    'clm_migrator',
  );

  if (!sessie.ok || !sessie.uitvoer.includes(TENANT_ID)) {
    return {
      ok: false,
      reden: `sessie_aanmaken() gaf geen sessie terug: ${sessie.uitvoer.trim()}`,
    };
  }

  // Zelfde naam als cookieInstellingen() kiest wanneer SESSIE_COOKIE_INSECURE
  // aanstaat — en dat staat het in docker-compose.otap.yml, want deze doorloop
  // draait over http.
  return { ok: true, cookie: `mcm2_sessie=${token}` };
}

/**
 * Controleert of de ECHTE omgevingen het schema hebben dat deze code verwacht.
 *
 * ── Waarom deze stap er is ──────────────────────────────────────────────────
 *
 * Alle andere stappen draaien tegen een wegwerpdatabase die vanaf niets met de
 * migraties is opgebouwd. Dat is de juiste keuze — een testrun hoort geen
 * productiedata aan te raken — maar het heeft een blinde vlek:
 *
 *   ze bewijzen dat de migraties correct ZIJN, niet dat ze ergens zijn
 *   TOEGEPAST.
 *
 * Op 2026-08-04 bleek wat dat kost. `clm-enterprise` stond sinds 27 juli stil
 * op de Prisma-historie en had 9 van de 18 tabellen — geen vragenlijsten, geen
 * antwoorden, geen certificaten, geen rechtenmodel. Vijf dagen lang bleven
 * 269 e2e-tests groen, want die draaiden allemaal tegen een verse container.
 *
 * De bevinding kwam pas boven bij een routinecontrole van de backup, en toen
 * bleek ook dat de dagelijkse dump al die tijd de helft van de database miste.
 *
 * ── Read-only, en dat is essentieel ─────────────────────────────────────────
 *
 * Deze stap draait `verify-schema.js`, dat uitsluitend leest. Er wordt niets
 * gemigreerd, niets gerepareerd en niets aangemaakt. Een doorloop die stilletjes
 * de productiedatabase wijzigt is erger dan de drift die hij zou vinden.
 *
 * ── Waarom hij niet ROOD geeft ──────────────────────────────────────────────
 *
 * Een omgeving die achterloopt is een bevinding, geen bewijs dat de code stuk
 * is. `verify:volledig` toetst de keten van code tot browser; die conclusie
 * verandert niet doordat een externe database achterloopt.
 *
 * Bovendien draait dit commando ook op machines zonder toegang tot productie.
 * Dan is er niets te meten, en dat mag geen rode doorloop opleveren.
 *
 * Wat het wél doet is het zichtbaar maken op het moment dat je toch al kijkt.
 * Dat is precies wat er vijf dagen ontbrak.
 */
function controleerOmgevingsdrift() {
  // .env hier inlezen en niet bovenaan het script.
  //
  // Dit is de enige stap die de échte omgeving nodig heeft; alle andere bouwen
  // bewust hun eigen wegwerpwereld op. Zou dotenv bovenaan staan, dan zou een
  // DATABASE_URL uit .env kunnen doorlekken naar stap 1 — en dan draaien de
  // e2e-tests tegen productie in plaats van tegen de testcontainer. Precies wat
  // dit script overal vermijdt door DATABASE_URL expliciet mee te geven.
  //
  // Gemeten op 2026-08-04: zonder deze regel meldde de stap "niet ingesteld"
  // en sloeg hij stil over. Een controle die stil overslaat is erger dan geen
  // controle, want hij wekt de indruk dat er iets gemeten is (§15b).
  const dotenv = require('dotenv');
  const { parsed } = dotenv.config({ processEnv: {} });

  const omgevingen = [
    { naam: 'productie (DATABASE_URL)', url: parsed?.DATABASE_URL },
  ];

  const bevindingen = [];
  let gemeten = 0;

  for (const { naam, url } of omgevingen) {
    if (!url) {
      console.log(`  ${naam}: niet ingesteld — overgeslagen`);
      continue;
    }

    // Nooit tegen een lokale wegwerpdatabase: die is deze doorloop zelf al
    // aan het testen, en dat zou een vals gevoel van dekking geven.
    //
    // DRIFT_TOETS_LOKAAL=1 heft dit op. Dat is er uitsluitend om déze controle
    // zelf te kunnen bewijzen: zonder die uitweg is niet aantoonbaar dat hij
    // een achterlopende database ook wérkelijk vindt, en dan is het een
    // controle die je moet geloven in plaats van kunnen toetsen. Precies het
    // patroon dat op 2026-08-04 vijf dagen lang een halve backup verborg.
    if (/localhost|127\.0\.0\.1/.test(url) && !process.env.DRIFT_TOETS_LOKAAL) {
      console.log(`  ${naam}: wijst naar localhost — overgeslagen`);
      continue;
    }

    gemeten++;

    const resultaat = draai('node', ['scripts/verify-schema.js'], {
      stil: true,
      env: { VERIFY_DATABASE_URL: url },
    });

    if (resultaat.ok) {
      console.log(`  ${naam}: schema komt overeen met de code`);
    } else {
      console.log(`  ${naam}: WIJKT AF van het schema in deze code`);
      bevindingen.push({ naam, uitvoer: resultaat.uitvoer });
    }
  }

  if (gemeten === 0) {
    console.log('');
    console.log('  Geen externe omgeving gemeten. Op een machine zonder');
    console.log('  productietoegang (CI, een verse kloon) is dat normaal.');
    console.log('');
    console.log('  Verwacht je hier wél een meting, controleer dan of .env een');
    console.log('  DATABASE_URL bevat die niet naar localhost wijst.');
  }

  return bevindingen;
}

function main() {
  const stappen = 6;
  let gestart = false;

  // Vóór alles: stap 1 duurt minuten, en die zijn weggegooid als stap 2 op een
  // bezette poort strandt. Zie controleerPoortenVrij().
  const bezet = controleerPoortenVrij();

  if (bezet.length > 0) {
    console.error('\nROOD: de doorloop kan niet starten — poorten zijn bezet.\n');

    for (const { poort, wat, gebruikelijk, code } of bezet) {
      console.error(
        `  poort ${poort} (${wat}) — er antwoordt al iets (HTTP ${code})`,
      );
      console.error(`     meestal: ${gebruikelijk}`);
    }

    console.error(
      '\nDeze doorloop start de volledige stack op dezelfde poorten. Sluit af wat\n' +
        'daar draait en probeer opnieuw. Zoeken welk proces het is:\n',
    );
    console.error(
      isWindows
        ? `  netstat -ano | findstr ":${bezet[0].poort} "     (laatste kolom is de PID)\n` +
            '  taskkill /PID <pid> /F'
        : `  lsof -i :${bezet[0].poort}\n  kill <pid>`,
    );
    console.error(
      '\nBewust niet automatisch afgesloten: dat is meestal een dev-server die\n' +
        'iemand zelf heeft gestart.',
    );
    process.exit(1);
  }

  try {
    kop(1, stappen, 'Code, unittests en backend-e2e (npm run verify)');

    // DATABASE_URL expliciet meegeven, anders slaat verify de e2e-stap over en
    // meldt hij "GROEN, met overgeslagen stappen" — misleidend in een
    // commando dat volledigheid belooft. De doorloopstack draait op 55500, dus
    // dit is een aparte wegwerpdatabase die er niet mee botst.
    const testDb = startTestDatabase();

    if (!testDb.ok) {
      console.error(`\nROOD: geen testdatabase kunnen starten.\n${testDb.reden}`);
      process.exit(1);
    }

    const verify = draai('npm', ['run', 'verify'], {
      env: { DATABASE_URL: testDb.url },
    });

    stopTestDatabase();

    if (!verify.ok) {
      console.error('\nROOD op stap 1. De rest is niet gedraaid.');
      process.exit(1);
    }

    kop(2, stappen, 'Stack bouwen en starten (productie-images)');

    if (!draai('docker', [...COMPOSE, 'up', '--build', '-d']).ok) {
      console.error('\nROOD: de stack kon niet gestart worden.');
      process.exit(1);
    }

    gestart = true;

    kop(3, stappen, 'Migraties, tenant en sessie klaarzetten');

    const opgebouwd = bouwDatabaseOp();

    if (!opgebouwd.ok) {
      console.error(`\nROOD: de database opbouwen mislukte.\n${opgebouwd.reden}`);
      process.exit(1);
    }

    const gereed = wachtOpStack();

    if (!gereed.ok) {
      console.error(`\nROOD: de stack antwoordt niet (${gereed.reden}).`);
      console.error('Logs: docker compose -f docker-compose.otap.yml logs');
      process.exit(1);
    }

    const sessie = maakSessie();

    if (!sessie.ok) {
      console.error(`\nROOD: geen sessie kunnen maken.\n${sessie.reden}`);
      process.exit(1);
    }

    console.log('  Sessie aangemaakt via clm.sessie_aanmaken().');

    kop(4, stappen, 'Browsertest tegen de draaiende stack');

    const browser = draai('npm', ['run', 'e2e'], {
      env: {
        BEHEER_COOKIE: sessie.cookie,
        PORTAL_URL: 'http://localhost:3000',
      },
      cwd: '../MCM2-frontend',
    });

    if (!browser.ok) {
      console.error('\nROOD op de browsertest.');
      console.error(
        'Playwright bewaart een trace bij een mislukte test:\n' +
          '  cd ../MCM2-frontend && npx playwright show-trace test-results/**/trace.zip',
      );
      process.exit(1);
    }

    kop(5, stappen, 'Draaien de echte omgevingen op dit schema? (read-only)');

    const drift = controleerOmgevingsdrift();

    kop(6, stappen, 'Opruimen');
    console.log('');
    console.log('GROEN — de hele keten, van code tot browser.');
    console.log('');
    console.log('Wat hiermee bewezen is:');
    console.log('  formulier → API → sessiecookie → guard → RLS → database → lijst');
    console.log('');

    if (drift.length > 0) {
      console.log('LET OP — een of meer echte omgevingen lopen achter:');
      console.log('');

      for (const { naam, uitvoer } of drift) {
        console.log(`  ${naam}`);
        for (const regel of uitvoer.trim().split('\n').slice(-6)) {
          console.log(`    ${regel}`);
        }
        console.log('');
      }

      console.log('  Dit maakt de doorloop niet rood: de keten kloppen én een');
      console.log('  omgeving die achterloopt zijn twee verschillende dingen.');
      console.log('  Maar het betekent wel dat wat hierboven bewezen is, daar');
      console.log('  niet draait — en dat de backup van die omgeving mist wat');
      console.log('  er niet in staat.');
      console.log('');
      console.log('  Migraties toepassen: docs/runbooks/baseline-migratiestand.md');
      console.log('');
    }
  } finally {
    // Ook bij een afgebroken run: een achtergebleven container blokkeert de
    // volgende doorloop op een poort die al bezet is.
    stopTestDatabase();

    if (gestart) {
      opruimen();
    }
  }
}

main();
