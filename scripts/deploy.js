#!/usr/bin/env node
'use strict';

/**
 * Rolt een image uit naar acceptatie of productie op saxombp.
 *
 * ── Wat dit script wél en niet doet ─────────────────────────────────────────
 *
 * Het BOUWT NIETS. Het haalt een image op dat CI al gebouwd en getest heeft en
 * start dat op de doelomgeving. Zou de server zelf bouwen, dan is het per
 * definitie een ánder artefact dan wat door de kwaliteitspoorten kwam — andere
 * basis-laag, andere npm-resolutie, andere buildtijd. Dan bewijst een groene
 * acceptatie niets over productie, en dat is precies wat OTAP moet voorkomen.
 *
 * ── De volgorde is het ontwerp ──────────────────────────────────────────────
 *
 *   1. vaststellen WELK image (expliciet, of de laatste van main)
 *   2. bij productie: bevestiging vragen
 *   3. image ophalen op de server            ← faalt hier niets stuk
 *   4. huidige versie onthouden               ← nodig voor rollback
 *   5. migraties draaien                      ← vóór de nieuwe code start
 *   6. containers vervangen
 *   7. rookproef                              ← bewijst dat het draait
 *   8. bij een falende rookproef: terugdraaien
 *
 * Stap 5 vóór stap 6 is niet willekeurig. Migraties in dit project zijn
 * voorwaarts compatibel (geen destructieve wijzigingen zonder schema-debt
 * issue, MCM2-CLAUDE.md), dus de oude code overleeft een nieuw schema. Andersom
 * geldt niet: nieuwe code op een oud schema breekt meteen.
 *
 * ── Waarom de rookproef er is ───────────────────────────────────────────────
 *
 * "docker compose up" slaagt zodra de container gestart is, niet zodra de app
 * werkt. Dat is dezelfde faalvorm als de backuptaak die "geslaagd" meldde
 * omdat cmd.exe kon starten. Zonder rookproef meldt dit script een uitrol die
 * niet gelukt is.
 *
 * ── Gebruik ─────────────────────────────────────────────────────────────────
 *
 *   npm run deploy:acceptatie              laatste main-images
 *   npm run deploy:acceptatie -- sha-abc123def456
 *   npm run deploy:productie               vraagt bevestiging
 *   npm run deploy:productie -- --versie sha-abc123def456
 *   npm run deploy:status                  wat draait waar
 *   npm run rollback:acceptatie            vorige versie terug
 *
 * Backend en frontend zijn aparte repositories met eigen SHA's. De frontend
 * krijgt een eigen vlag; laat je hem weg, dan wordt dat `:latest`:
 *
 *   npm run deploy:productie -- --versie sha-abc123def456 \
 *                               --frontend-versie sha-987fed654321
 *
 * Het slotbericht van een geslaagde uitrol drukt de terugdraairegel af met
 * beide versies erin, zodat je die niet zelf hoeft samen te stellen.
 *
 * Zie docs/runbooks/uitrol-acceptatie-en-productie.md.
 */

const { spawnSync } = require('node:child_process');
const readline = require('node:readline');

const SERVER = 'root@saxombp';
const SERVER_MAP = '/opt/mcm2';

/**
 * Draait de frontend mee?
 *
 * Ja, sinds 2026-08-10. Twee blokkades zijn achtereenvolgens weggenomen:
 *
 *   1. Issue #51 — het backend-adres werd bij de build ingebakken, waardoor
 *      één image al wist met welke backend het praatte. Dat adres komt nu uit
 *      `API_BASE_URL`, gelezen bij het starten.
 *   2. Het frontend-image werd nergens gepubliceerd. De CI van MCM2-frontend
 *      duwt hem nu naar `ghcr.io/alingadvies/mcm2-frontend/web`, met dezelfde
 *      tagstructuur als de backend.
 *
 * ── Twee versies, en waarom dat geen omissie is ─────────────────────────────
 *
 * Backend en frontend zitten in aparte repositories, dus hun commit-SHA's zijn
 * nooit gelijk. Deze uitrol vraagt ze allebei:
 *
 *   npm run deploy:acceptatie -- --versie sha-abc123def456 \
 *                                --frontend-versie sha-987fed654321
 *
 * Zonder argument valt elk terug op `:latest`. Wat er drááit wordt altijd
 * teruggelezen uit de containers zelf — niet uit een bestand dat een vorige
 * uitrol heeft weggeschreven, want zo'n bestand kan afwijken van de
 * werkelijkheid zodra iemand met de hand ingrijpt.
 *
 * Bij een rollback gaan beide onderdelen samen terug naar de combinatie die er
 * stond. Alleen de backend terugdraaien laat een frontend achter die bij een
 * andere versie hoort, en die toestand is nergens beproefd.
 */
const FRONTEND_MEE = true;

/**
 * De omgevingen. Poorten liggen ver uit elkaar zodat een typefout in een
 * poortnummer niet per ongeluk de andere omgeving raakt.
 */
const OMGEVINGEN = {
  acceptatie: {
    naam: 'acceptatie',
    project: 'mcm2-acceptatie',
    apiPoort: 5011,
    frontendPoort: 3010,
    bevestiging: false,
  },
  productie: {
    naam: 'productie',
    project: 'mcm2-productie',
    apiPoort: 5021,
    frontendPoort: 3020,
    // Productie krijgt nooit een stille uitrol. Ook niet als het "maar een
    // kleine wijziging" is — juist dan.
    bevestiging: true,
  },
};

const kleur = {
  rood: (t) => `\x1b[31m${t}\x1b[0m`,
  groen: (t) => `\x1b[32m${t}\x1b[0m`,
  geel: (t) => `\x1b[33m${t}\x1b[0m`,
  grijs: (t) => `\x1b[90m${t}\x1b[0m`,
};

/** Draait een commando op de server via SSH. */
function opServer(commando, { stil = false } = {}) {
  const resultaat = spawnSync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', SERVER, commando],
    { encoding: 'utf8', stdio: stil ? 'pipe' : ['pipe', 'pipe', 'pipe'] },
  );

  return {
    ok: resultaat.status === 0,
    uit: (resultaat.stdout || '').trim(),
    fout: (resultaat.stderr || '').trim(),
  };
}

function stop(bericht, hint) {
  console.error('');
  console.error(kleur.rood(`GESTOPT: ${bericht}`));
  if (hint) {
    console.error('');
    console.error(hint);
  }
  console.error('');
  process.exit(1);
}

async function vraagBevestiging(vraag) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const antwoord = await new Promise((klaar) => rl.question(vraag, klaar));
  rl.close();

  return antwoord.trim().toLowerCase();
}

/**
 * Stelt vast welk image uitgerold wordt.
 *
 * Zonder argument: `:latest`, wat CI op main heeft gepubliceerd. Met een
 * expliciete tag: precies die — dat is ook de weg terug bij een rollback.
 */
function bepaalVersie(argumenten) {
  const index = argumenten.indexOf('--versie');
  if (index !== -1 && argumenten[index + 1]) return argumenten[index + 1];

  const los = argumenten.find(
    (a) => !a.startsWith('--') && /^(sha-[0-9a-f]{12}|latest)$/.test(a),
  );

  return los || 'latest';
}

/**
 * Stelt vast welk frontend-image uitgerold wordt.
 *
 * ── Waarom dit een aparte versie is ─────────────────────────────────────────
 *
 * Backend en frontend zitten in twee repositories, dus hun commit-SHA's zijn
 * nooit gelijk. Eén versietag voor beide zou een frontend-image zoeken met de
 * SHA van de backend, en dat bestaat niet — de uitrol zou stranden op een
 * `docker pull` met een melding die naar de verkeerde oorzaak wijst.
 *
 * De alternatieven zijn afgewogen (besluit eigenaar 2026-08-10): de frontend
 * `:latest` laten volgen is eenvoudiger, maar dan is aan een draaiende omgeving
 * niet te zien welke schermcode erin zit en werkt terugdraaien alleen voor de
 * backend. Dat gaat in tegen §6 van het OTAP-plan.
 *
 * Zonder argument valt dit terug op `:latest`, net als de backend.
 */
function bepaalFrontendVersie(argumenten) {
  const index = argumenten.indexOf('--frontend-versie');
  if (index !== -1 && argumenten[index + 1]) return argumenten[index + 1];

  return 'latest';
}

/**
 * Wat er op dit moment draait, of null wanneer er niets draait.
 *
 * Teruggelezen uit de draaiende container en niet uit een bestand dat de vorige
 * uitrol heeft weggeschreven. Dat is bewust: zo'n bestand kan afwijken van de
 * werkelijkheid zodra iemand met de hand ingrijpt, en dan wijst het de
 * verkeerde kant op precies wanneer je het nodig hebt (runbook, regel 4).
 *
 * `dienst` is 'api' of 'frontend'. Draait de frontend niet mee, dan geeft
 * `docker inspect` niets terug en is het antwoord null — dat is geen fout maar
 * de juiste beschrijving van de toestand.
 */
function huidigeVersie(omgeving, dienst = 'api') {
  const res = opServer(
    `docker inspect --format '{{.Config.Image}}' ${omgeving.project}-${dienst}-1 2>/dev/null || true`,
    { stil: true },
  );

  const image = res.uit.trim();
  if (!image) return null;

  const tag = image.split(':').pop();
  return tag || null;
}

/**
 * De rookproef: draait het écht?
 *
 * Drie controles, oplopend in wat ze bewijzen. Een container die start bewijst
 * niets; pas een antwoord uit de database bewijst de keten.
 */
function rookproef(omgeving) {
  const controles = [
    {
      wat: 'backend antwoordt op /health',
      commando: `curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:${omgeving.apiPoort}/health`,
      verwacht: (uit) => uit === '200',
    },
    ...(FRONTEND_MEE
      ? [
          {
            wat: 'frontend serveert een pagina',
            commando: `curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:${omgeving.frontendPoort}/`,
            verwacht: (uit) => uit === '200',
          },
          {
            // Een pagina serveren bewijst niet dat de frontend de backend
            // bereikt: sinds Issue #51 loopt dat via een doorgeefluik dat
            // `API_BASE_URL` bij het starten leest, en dat is een aparte
            // schakel die apart stuk kan. Staat die variabele verkeerd, dan
            // draait de frontend vrolijk door en geeft elk beheerscherm "kon
            // niet worden opgehaald" — precies zoals bij een backend die niet
            // draait.
            //
            // Dezelfde aanroep als de controle hierboven, maar via poort 3000.
            // Zonder sessie hoort dat 401 te geven; een 502 betekent dat het
            // doorgeefluik de backend niet vindt, een 500 dat de variabele
            // helemaal niet gezet is.
            wat: 'frontend bereikt de backend (401 via het doorgeefluik)',
            commando: `curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:${omgeving.frontendPoort}/api/backend/admin/survey/templates`,
            verwacht: (uit) => uit === '401',
          },
        ]
      : []),
    {
      // Zonder sessie hoort dit 401 te geven, niet 500. Dat bewijst dat de
      // guard draait én dat de app de database kon bereiken om dat vast te
      // stellen — een backend zonder database geeft hier een 500.
      wat: 'beheerroute weigert zonder sessie (401, geen 500)',
      commando: `curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:${omgeving.apiPoort}/admin/survey/templates`,
      verwacht: (uit) => uit === '401',
    },
  ];

  const mislukt = [];

  for (const controle of controles) {
    const res = opServer(controle.commando, { stil: true });
    const geslaagd = res.ok && controle.verwacht(res.uit);

    console.log(
      geslaagd
        ? `     ${kleur.groen('OK')}   ${controle.wat}`
        : `     ${kleur.rood('FOUT')} ${controle.wat} — kreeg '${res.uit || 'geen antwoord'}'`,
    );

    if (!geslaagd) mislukt.push(controle.wat);
  }

  return mislukt;
}

/** Start een omgeving met een bepaalde versie. */
function start(omgeving, versie, frontendVersie) {
  // Draait de frontend niet mee, dan wordt die dienst geschaald naar nul in
  // plaats van uit het compose-bestand geweerd. `profiles:` is daar weg sinds
  // de frontend promoveerbaar is (Issue #51); wat nu nog ontbreekt is dat het
  // image gepubliceerd wordt, en dat is een tijdelijke toestand.
  const schaal = FRONTEND_MEE ? '' : '--scale frontend=0 ';

  const zet = [
    `cd ${SERVER_MAP}`,
    `export API_IMAGE=$(grep '^GHCR_API=' ${omgeving.naam}.env | cut -d= -f2):${versie}`,
    // Ook zetten wanneer de frontend niet meedraait: docker compose
    // waarschuwt anders over een lege variabele, en zo'n waarschuwing in de
    // uitvoer van een uitrol leidt af van meldingen die er wél toe doen.
    `export FRONTEND_IMAGE=$(grep '^GHCR_FRONTEND=' ${omgeving.naam}.env | cut -d= -f2):${frontendVersie}`,
    `docker compose --env-file ${omgeving.naam}.env -p ${omgeving.project} -f docker-compose.omgeving.yml up -d ${schaal}`.trim(),
  ].join(' && ');

  return opServer(zet);
}

async function main() {
  const doelNaam = process.argv[2];
  const omgeving = OMGEVINGEN[doelNaam];

  if (!omgeving) {
    stop(
      `Onbekende omgeving '${doelNaam || '(geen)'}'.`,
      'Gebruik: node scripts/deploy.js acceptatie|productie [--versie sha-…]',
    );
  }

  const argumenten = process.argv.slice(3);
  const versie = bepaalVersie(argumenten);
  const frontendVersie = bepaalFrontendVersie(argumenten);

  console.log('');
  console.log(`Uitrol naar ${kleur.geel(omgeving.naam.toUpperCase())}`);
  console.log(kleur.grijs(`  server:  ${SERVER}`));
  console.log(kleur.grijs(`  backend:  ${versie}`));
  console.log(
    kleur.grijs(
      `  frontend: ${FRONTEND_MEE ? frontendVersie : '(rolt nog niet mee)'}`,
    ),
  );
  console.log(
    kleur.grijs(
      `  poorten: api ${omgeving.apiPoort}, frontend ${omgeving.frontendPoort}`,
    ),
  );
  console.log('');

  // ── 1. Is de server bereikbaar? ─────────────────────────────────────────
  console.log('1/6  Server bereikbaar en ingericht?');

  const bereik = opServer(
    `test -f ${SERVER_MAP}/${omgeving.naam}.env && echo ja`,
    { stil: true },
  );

  if (!bereik.ok || bereik.uit !== 'ja') {
    stop(
      `${SERVER} is niet bereikbaar, of ${SERVER_MAP}/${omgeving.naam}.env ontbreekt.`,
      'Richt de server eerst in:\n  npm run deploy:inrichten\n\nZie docs/runbooks/uitrol-acceptatie-en-productie.md.',
    );
  }

  const vorige = huidigeVersie(omgeving);
  // Ook de frontend vastleggen, en wel hier — vóór er iets vervangen wordt.
  // Bij een falende rookproef moeten beide onderdelen samen terug; alleen de
  // backend terugdraaien laat een frontend achter die bij een andere versie
  // hoort, en dat is een toestand die nergens beproefd is.
  const vorigeFrontend = huidigeVersie(omgeving, 'frontend');

  console.log(
    `     ${kleur.groen('OK')}   ${vorige ? `nu actief: backend ${vorige}` : 'er draait nog niets'}` +
      (vorige && FRONTEND_MEE
        ? `, frontend ${vorigeFrontend || '(geen)'}`
        : ''),
  );

  // ── 2. Bevestiging bij productie ────────────────────────────────────────
  if (omgeving.bevestiging) {
    console.log('');
    console.log('2/6  Bevestiging');

    // Een uitrol naar productie die niet eerst op acceptatie stond, is precies
    // de stap die OTAP overslaat. Melden, niet blokkeren: soms is er een
    // gegronde reden, maar hij moet zichtbaar zijn.
    //
    // Beide onderdelen worden vergeleken. Alleen de backend controleren zou
    // betekenen dat een onbeproefde frontend stilzwijgend meepromoveert — en
    // juist omdat de versies uit twee repositories komen, is dat makkelijk om
    // over het hoofd te zien.
    const opAcceptatie = huidigeVersie(OMGEVINGEN.acceptatie);

    if (opAcceptatie !== versie) {
      console.log('');
      console.log(
        kleur.geel(
          `     LET OP: op acceptatie draait als backend ${opAcceptatie || '(niets)'}, niet ${versie}.`,
        ),
      );
      console.log(
        kleur.geel(
          '     Deze versie is daar dus niet beproefd. Dat is de stap die OTAP juist voorschrijft.',
        ),
      );
    }

    if (FRONTEND_MEE) {
      const feOpAcceptatie = huidigeVersie(OMGEVINGEN.acceptatie, 'frontend');

      if (feOpAcceptatie !== frontendVersie) {
        console.log('');
        console.log(
          kleur.geel(
            `     LET OP: op acceptatie draait als frontend ${feOpAcceptatie || '(niets)'}, niet ${frontendVersie}.`,
          ),
        );
        console.log(
          kleur.geel(
            '     Het is de combinatie die beproefd wordt, niet elk onderdeel apart.',
          ),
        );
      }
    }

    console.log('');
    const antwoord = await vraagBevestiging(
      `     Uitrollen naar PRODUCTIE (${versie})? Typ 'ja' om door te gaan: `,
    );

    if (antwoord !== 'ja') {
      console.log('');
      console.log('Afgebroken. Er is niets gewijzigd.');
      console.log('');
      return;
    }
  } else {
    console.log('');
    console.log('2/6  Bevestiging — niet nodig voor acceptatie');
  }

  // ── 3. Image ophalen ────────────────────────────────────────────────────
  //
  // Eerst ophalen, dan pas iets vervangen. Een tikfout in de versie faalt zo
  // vóórdat de draaiende omgeving is aangeraakt.
  console.log('');
  console.log('3/6  Image ophalen op de server');

  const ophalen = opServer(
    [
      `cd ${SERVER_MAP}`,
      `docker pull $(grep '^GHCR_API=' ${omgeving.naam}.env | cut -d= -f2):${versie}`,
      ...(FRONTEND_MEE
        ? [
            `docker pull $(grep '^GHCR_FRONTEND=' ${omgeving.naam}.env | cut -d= -f2):${frontendVersie}`,
          ]
        : []),
    ].join(' && '),
    { stil: true },
  );

  if (!ophalen.ok) {
    // Twee images, twee registers, twee mogelijke tikfouten. De melding noemt
    // ze allebei: uit de foutuitvoer alleen is niet af te leiden welk van de
    // twee niet bestond, en zoeken in het verkeerde register kost tijd.
    stop(
      FRONTEND_MEE
        ? `Kon image '${versie}' (backend) of '${frontendVersie}' (frontend) niet ophalen.`
        : `Kon image '${versie}' niet ophalen.`,
      `${ophalen.fout}\n\nBestaan die tags? Kijk op:\n` +
        `  https://github.com/AlingAdvies/MCM2/pkgs/container/mcm2%2Fapi\n` +
        (FRONTEND_MEE
          ? `  https://github.com/AlingAdvies/MCM2-frontend/pkgs/container/mcm2-frontend%2Fweb\n`
          : '') +
        `\nLet op: backend en frontend zijn aparte repositories, dus hun SHA's\n` +
        `verschillen. De frontendversie geef je mee met --frontend-versie.\n\n` +
        `Er is niets gewijzigd — de draaiende omgeving is niet aangeraakt.`,
    );
  }

  console.log(
    `     ${kleur.groen('OK')}   ${FRONTEND_MEE ? 'beide images' : 'backend-image'} opgehaald`,
  );

  // ── 4. Migraties ────────────────────────────────────────────────────────
  //
  // Vóór de nieuwe code start. Migraties zijn voorwaarts compatibel, dus de
  // oude code overleeft een nieuw schema; andersom niet.
  //
  // ── Waarom hier MCM2_EXTERNE_DB=ja staat ────────────────────────────────
  //
  // `migrate.js` weigert een niet-lokaal doelwit zonder expliciete
  // toestemming (db-doelwit.js). Binnen het compose-netwerk heet de database
  // `db`, en dat is voor die controle niet-lokaal — terecht, want hij kan het
  // verschil met een echte externe host niet zien.
  //
  // Dat de vlag hier staat is dus geen omzeiling maar de bedoelde uitweg: hij
  // staat zichtbaar in dit script, in het logboek van de uitrol, en hij geldt
  // alleen voor déze aanroep. Wat hij NIET doet is de bescherming in `.env`
  // verzwakken — daar verandert niets aan, en een handmatige
  // `npm run migrate:deploy` op je laptop weigert nog steeds gewoon.
  console.log('');
  console.log('4/6  Migraties op de database van deze omgeving');

  const migreren = opServer(
    [
      `cd ${SERVER_MAP}`,
      // API_IMAGE en FRONTEND_IMAGE moeten gezet zijn, óók nu we alleen `db`
      // starten: compose valideert het hele bestand en weigert met "service
      // 'api' has neither an image nor a build context specified" zodra één
      // dienst een lege image-variabele heeft. Gemeten op 2026-08-10, bij de
      // eerste uitrol.
      `export API_IMAGE=$(grep '^GHCR_API=' ${omgeving.naam}.env | cut -d= -f2):${versie}`,
      `export FRONTEND_IMAGE=$(grep '^GHCR_FRONTEND=' ${omgeving.naam}.env | cut -d= -f2):${versie}`,
      `docker compose --env-file ${omgeving.naam}.env -p ${omgeving.project} -f docker-compose.omgeving.yml up -d db`,
      // Wachten tot de database ECHT klaar is, niet tot hij dat één keer zegt.
      //
      // Een verse Postgres-container start intern twee keer: eerst voor de
      // initialisatie (initdb, het aanmaken van de database), dan opnieuw voor
      // gebruik. In dat venster antwoordt `pg_isready` bevestigend terwijl de
      // server een seconde later "the database system is shutting down" geeft.
      // Precies dat gebeurde bij de eerste uitrol naar productie op 2026-08-10;
      // op acceptatie niet, want daar bestond de database al.
      //
      // Twee opeenvolgende geslaagde QUERIES in plaats van één `pg_isready`.
      // Een query bewijst meer dan een socketcontrole, en twee achter elkaar
      // vallen niet samen met een herstart ertussen. Zelfde patroon als de
      // wachtlus in demo-omgeving.js.
      `gereed=0; for i in $(seq 1 90); do ` +
        `if docker exec ${omgeving.project}-db-1 psql -U postgres -tAc 'SELECT 1' >/dev/null 2>&1; then ` +
        `gereed=$((gereed+1)); [ $gereed -ge 2 ] && break; ` +
        `else gereed=0; fi; sleep 1; done; ` +
        `[ $gereed -ge 2 ] || { echo "De database werd niet gereed binnen 90 seconden."; exit 1; }`,
      // De rollen komen NIET uit de migratieketen maar uit
      // db/roles/bootstrap-roles.sql (ADR-009). Zonder deze stap bestaat
      // `clm_migrator` niet en faalt de migratie op een authenticatiefout —
      // een melding die naar de verkeerde oorzaak wijst.
      //
      // Het script is idempotent (IF NOT EXISTS per rol), dus het mag bij elke
      // uitrol opnieuw draaien. Daarna krijgen de twee inlogbare rollen het
      // wachtwoord van deze omgeving; dat staat alleen in het .env-bestand op
      // de server.
      `docker exec -i ${omgeving.project}-db-1 psql -U postgres -q -v ON_ERROR_STOP=1 < rollen.sql`,
      `docker exec ${omgeving.project}-db-1 psql -U postgres -q -c ` +
        `"ALTER ROLE clm_migrator LOGIN PASSWORD '$(grep '^DB_WACHTWOORD=' ${omgeving.naam}.env | cut -d= -f2)'; ` +
        `ALTER ROLE clm_api_runtime PASSWORD '$(grep '^DB_WACHTWOORD=' ${omgeving.naam}.env | cut -d= -f2)';"`,
      `docker run --rm --network ${omgeving.project}_default ` +
        `-e MIGRATION_DATABASE_URL="postgresql://clm_migrator:$(grep '^DB_WACHTWOORD=' ${omgeving.naam}.env | cut -d= -f2)@db:5432/postgres" ` +
        `-e MCM2_EXTERNE_DB=ja ` +
        `$(grep '^GHCR_API=' ${omgeving.naam}.env | cut -d= -f2):${versie} node scripts/migrate.js 2>&1 | tail -20`,
    ].join(' && '),
    { stil: true },
  );

  if (!migreren.ok) {
    stop(
      'De migraties zijn niet gelukt.',
      `${migreren.uit}\n${migreren.fout}\n\nDe nieuwe code is NIET gestart. De omgeving draait nog op ${vorige || '(niets)'}.`,
    );
  }

  // ── De melding niet geloven, de database lezen ──────────────────────────
  //
  // Op 2026-08-10 gaf `migrate.js` exitcode 0 terwijl het script al op regel 8
  // was gecrasht met MODULE_NOT_FOUND — de fout ging via een pipe naar `tail`,
  // en die slaagde. De uitrol meldde "UITGEROLD" over een lege database, en de
  // rookproef werd gewoon groen: een backend zonder tabellen antwoordt prima op
  // /health en geeft netjes 401 op een beheerroute.
  //
  // Dat is dezelfde faalvorm als Issue #86 en migratie 0017: een geruststellende
  // melding over iets dat niet gebeurd is. De enige remedie is teruglezen.
  const migratiestand = opServer(
    `docker exec ${omgeving.project}-db-1 psql -U postgres -tAc ` +
      `"SELECT count(*) FROM drizzle.__drizzle_migrations" 2>/dev/null || echo 0`,
    { stil: true },
  );

  const aantalMigraties = Number(migratiestand.uit.trim()) || 0;

  if (aantalMigraties === 0) {
    stop(
      'De migraties meldden succes, maar de database is leeg.',
      `In drizzle.__drizzle_migrations staan ${aantalMigraties} migraties.\n\n` +
        `Uitvoer van het migratiescript:\n${migreren.uit}\n\n` +
        'De nieuwe code is NIET gestart.',
    );
  }

  console.log(
    `     ${kleur.groen('OK')}   ${aantalMigraties} migraties op de database (teruggelezen, niet aangenomen)`,
  );

  // ── 5. Containers vervangen ─────────────────────────────────────────────
  console.log('');
  console.log('5/6  Containers vervangen');

  const gestart = start(omgeving, versie, frontendVersie);

  if (!gestart.ok) {
    stop(
      'De containers konden niet gestart worden.',
      `${gestart.fout}\n\nTerugdraaien:\n  npm run rollback:${omgeving.naam}`,
    );
  }

  console.log(`     ${kleur.groen('OK')}   gestart`);

  // ── 6. Rookproef ────────────────────────────────────────────────────────
  console.log('');
  console.log('6/6  Rookproef');

  // Even wachten: de containers zijn gestart, de app heeft nog een moment
  // nodig om te luisteren. Zonder deze pauze faalt de eerste controle op
  // iets dat een seconde later wel werkt.
  opServer('sleep 6', { stil: true });

  const mislukt = rookproef(omgeving);

  if (mislukt.length > 0) {
    console.log('');
    console.log(kleur.rood(`De rookproef faalde op ${mislukt.length} punt(en).`));

    if (vorige && vorige !== versie) {
      // Beide onderdelen samen terug naar de combinatie die er stond. Draait de
      // frontend niet mee, dan is `vorigeFrontend` null en valt hij terug op
      // `latest` — dat is dan een lege variabele die niets start.
      console.log(
        `Terugdraaien naar ${vorige}` +
          (FRONTEND_MEE ? ` met frontend ${vorigeFrontend || 'latest'}` : '') +
          '…',
      );
      const terug = start(omgeving, vorige, vorigeFrontend || 'latest');

      if (terug.ok) {
        opServer('sleep 6', { stil: true });
        const naTerug = rookproef(omgeving);

        console.log('');
        if (naTerug.length === 0) {
          console.log(
            kleur.geel(`TERUGGEDRAAID naar ${vorige}. De omgeving werkt weer.`),
          );
        } else {
          console.log(
            kleur.rood(
              `TERUGGEDRAAID naar ${vorige}, maar ook die versie komt niet door de rookproef.\n` +
                'Kijk zelf op de server: npm run deploy:status',
            ),
          );
        }
      } else {
        console.log(kleur.rood('Terugdraaien is óók mislukt. Kijk op de server.'));
      }
    } else {
      console.log(
        kleur.geel(
          'Geen vorige versie om naar terug te vallen — de nieuwe blijft staan, maar werkt niet.',
        ),
      );
    }

    console.log('');
    process.exit(1);
  }

  // ── Klaar ───────────────────────────────────────────────────────────────
  console.log('');
  console.log(
    kleur.groen(
      `UITGEROLD — ${omgeving.naam} draait op ${versie}` +
        (FRONTEND_MEE ? ` met frontend ${frontendVersie}` : '') +
        '.',
    ),
  );
  console.log('');
  console.log(`  backend:   http://saxombp:${omgeving.apiPoort}/health`);

  if (FRONTEND_MEE) {
    console.log(`  frontend:  http://saxombp:${omgeving.frontendPoort}`);
  } else {
    console.log(
      kleur.grijs(
        `  frontend:  draait niet mee — image wordt nog niet gepubliceerd`,
      ),
    );
  }

  if (vorige && vorige !== versie) {
    console.log('');
    console.log(
      kleur.grijs(
        `  vorige versie was ${vorige}` +
          (FRONTEND_MEE
            ? ` met frontend ${vorigeFrontend || '(geen)'}`
            : ''),
      ),
    );
    // De hele combinatie in één regel, zodat terugdraaien geen puzzel is: met
    // twee repositories is de frontendversie precies het stuk dat je vergeet.
    console.log(
      kleur.grijs(
        `  terugdraaien:  npm run deploy:${omgeving.naam} -- --versie ${vorige}` +
          (FRONTEND_MEE && vorigeFrontend
            ? ` --frontend-versie ${vorigeFrontend}`
            : ''),
      ),
    );
  }

  console.log('');
}

main().catch((err) => {
  console.error('');
  console.error(kleur.rood(`Onverwachte fout: ${err.message}`));
  console.error('');
  process.exit(1);
});
