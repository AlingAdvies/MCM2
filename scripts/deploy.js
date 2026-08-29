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
 *
 * Terugdraaien is géén apart script. Het is dezelfde uitrol met de vorige tag:
 *
 *   npm run deploy:acceptatie -- --versie sha-<vorige>
 *
 * Hier stond `npm run rollback:acceptatie`, en dat bestaat niet — niet in
 * package.json en nergens anders. Het slotbericht van elke uitrol drukt de
 * juiste regel af, met beide versies erin.
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
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
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
    // Een Postgres-container op deze machine. Mag stuk, wordt weggegooid.
    lokaleDatabase: true,
  },
  staging: {
    naam: 'staging',
    project: 'mcm2-staging',
    apiPoort: 5031,
    frontendPoort: 3030,
    bevestiging: false,
    // GEEN lokale database: staging praat met het Supabase-project
    // `clm-staging3`. Dat is de hele reden dat staging bestaat — productie
    // draait Postgres bij AWS in Ierland achter een connection pooler, en een
    // repetitie in een container bewijst het verkeerde (§1 van het plan).
    //
    // De migraties gaan hier niet vanaf deze machine maar vanuit CI; zie de
    // job `staging` in .github/workflows/ci.yml. Deze uitrol start alleen de
    // applicatie.
    lokaleDatabase: false,
    migratiesOverslaan: true,
  },
  productie: {
    naam: 'productie',
    project: 'mcm2-productie',
    apiPoort: 5021,
    frontendPoort: 3020,
    // Productie krijgt nooit een stille uitrol. Ook niet als het "maar een
    // kleine wijziging" is — juist dan.
    bevestiging: true,
    // ── Sinds stap 6 (2026-08-11): GEEN lokale database meer ────────────────
    //
    // Hier stond `lokaleDatabase: true`, en dat betekende dat dit commando een
    // eigen Postgres-container startte op saxombp. Ondertussen migreerde de
    // productieworkflow naar Supabase `clm-enterprise`, waar de echte
    // klantgegevens staan.
    //
    // Twee dingen heetten dus "productie", en ze praatten langs elkaar heen:
    // de migraties gingen naar Supabase, de applicatie startte tegen een
    // container waarin niets stond. Wie het commando draaide dat de workflow
    // zelf afdrukt, kreeg een draaiende app op een lege database — met de
    // volle overtuiging dat productie was uitgerold.
    //
    // Dat is precies de verwarring die op 2026-08-10 tot het verkeerde antwoord
    // op "wat zijn mijn rollen" leidde, en daarmee tot het dataverlies.
    //
    // Gemeten vóór het opheffen: 26 migraties, 0 tenants, 0 gebruikers,
    // 0 leveranciers. De container was leeg; er is niets verloren gegaan.
    lokaleDatabase: false,
    // Net als staging: de migraties draaien vanuit de workflow
    // (.github/workflows/productie.yml), niet vanaf deze machine. Deze uitrol
    // start alleen de applicatie.
    migratiesOverslaan: true,
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
            // Getest wordt /beheer, niet /: sinds 2026-08-29 stuurt / bewust
            // door (307) naar /beheer, het scherm waarmee de app opent.
            wat: 'frontend serveert een pagina',
            commando: `curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:${omgeving.frontendPoort}/beheer`,
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

/**
 * Vraagt de echte image-digests op, ná het pullen.
 *
 * ── Waarom dit een aparte stap is en geen build-arg ─────────────────────────
 *
 * De tag (`sha-abc123…`) zegt welke code we BEDÓÉLDEN te draaien. De digest
 * is de inhoudsvingerafdruk van het image zelf — pariteitscontract §2,
 * indicatoren 1 en 2, en het grootste gat dat het contract benoemt. Die
 * bestaat pas nadat het image ergens vandaan gehaald is, dus hij kan niet in
 * de Dockerfile gebakken worden (zie BUILD_COMMIT daar, wat wél kan).
 *
 * `docker inspect` op de server, ná de pull van hierboven en vóór het starten
 * — zo meet dit script exact het image dat zo meteen ook echt gaat draaien,
 * in plaats van iets af te leiden uit de tag.
 *
 * Een mislukte meting stopt de uitrol niet: de digest is bewijsmateriaal voor
 * verify-omgevingen.js, geen voorwaarde om te mogen draaien. Ontbreekt hij,
 * dan meldt /health `null` en verify dat als afwijking — precies zoals een
 * ontbrekende markering dat nu ook doet.
 */
function digestsOpvragen(omgeving, versie, frontendVersie) {
  const apiRes = opServer(
    [
      `cd ${SERVER_MAP}`,
      `image=$(grep '^GHCR_API=' ${omgeving.naam}.env | cut -d= -f2):${versie}`,
      `docker inspect --format '{{index .RepoDigests 0}}' "$image" 2>/dev/null || true`,
    ].join(' && '),
    { stil: true },
  );

  const resultaat = { api: apiRes.uit.trim() || null, frontend: null };

  if (FRONTEND_MEE) {
    const frontendRes = opServer(
      [
        `cd ${SERVER_MAP}`,
        `image=$(grep '^GHCR_FRONTEND=' ${omgeving.naam}.env | cut -d= -f2):${frontendVersie}`,
        `docker inspect --format '{{index .RepoDigests 0}}' "$image" 2>/dev/null || true`,
      ].join(' && '),
      { stil: true },
    );

    resultaat.frontend = frontendRes.uit.trim() || null;
  }

  return resultaat;
}

/** Start een omgeving met een bepaalde versie. */
function start(omgeving, versie, frontendVersie, digests = {}) {
  // Draait de frontend niet mee, dan wordt die dienst geschaald naar nul in
  // plaats van uit het compose-bestand geweerd. `profiles:` is daar weg sinds
  // de frontend promoveerbaar is (Issue #51); wat nu nog ontbreekt is dat het
  // image gepubliceerd wordt, en dat is een tijdelijke toestand.
  const schaal = FRONTEND_MEE ? '' : '--scale frontend=0 ';

  // Omgevingen met een eigen databasecontainer krijgen het profiel én de
  // overlay die de afhankelijkheid legt. Zonder de overlay start de api
  // voordat Postgres klaar is; zonder het profiel bestaat de container niet.
  //
  // Staging krijgt geen van beide: die praat met Supabase. Zie
  // deploy/compose.lokale-db.yml voor waarom dat twee losse dingen zijn.
  const db = omgeving.lokaleDatabase
    ? '--profile lokale-db -f docker-compose.omgeving.yml -f compose.lokale-db.yml'
    : '-f docker-compose.omgeving.yml';

  // Wat de omgeving straks over zichzelf meldt via /health (zie
  // health.controller.ts). Leeg wanneer de meting niets opleverde — een lege
  // omgevingsvariabele geeft in de container `process.env.IMAGE_DIGEST ===
  // ''`, en dat vangt het endpoint met `|| null` af net als een ontbrekende.
  const zet = [
    `cd ${SERVER_MAP}`,
    `export API_IMAGE=$(grep '^GHCR_API=' ${omgeving.naam}.env | cut -d= -f2):${versie}`,
    // Ook zetten wanneer de frontend niet meedraait: docker compose
    // waarschuwt anders over een lege variabele, en zo'n waarschuwing in de
    // uitvoer van een uitrol leidt af van meldingen die er wél toe doen.
    `export FRONTEND_IMAGE=$(grep '^GHCR_FRONTEND=' ${omgeving.naam}.env | cut -d= -f2):${frontendVersie}`,
    `export IMAGE_DIGEST='${digests.api || ''}'`,
    `export FRONTEND_IMAGE_DIGEST='${digests.frontend || ''}'`,
    `export OMGEVING='${omgeving.naam}'`,
    `docker compose --env-file ${omgeving.naam}.env -p ${omgeving.project} ${db} up -d ${schaal}`.trim(),
  ].join(' && ');

  return opServer(zet);
}

/**
 * Draait de server op hetzelfde compose-bestand als de repository?
 *
 * ── Waarom dit bestaat ──────────────────────────────────────────────────────
 *
 * Dit script gebruikt `/opt/mcm2/docker-compose.omgeving.yml` op de server,
 * maar brengt dat bestand niet mee — het komt daar via `deploy:inrichten`, dat
 * alleen op een lege server draait. Wijzig je het bestand in de repository, dan
 * draait de uitrol stilzwijgend door op de oude versie.
 *
 * Dat is geen theoretisch risico. Op 2026-08-10 stond op saxombp nog een versie
 * met `profiles: ["frontend"]` erin, terwijl die regel in de repository al weg
 * was. Gevolg: de frontend-container werd niet aangemaakt — geen fout, geen
 * container, alleen een rookproef die faalde met "kreeg 000". Zoeken naar de
 * oorzaak kostte meer tijd dan de uitrol zelf.
 *
 * Vergelijken gebeurt op de inhoud en niet op de wijzigingsdatum: een bestand
 * dat toevallig even oud is, kan nog steeds anders zijn.
 *
 * ── Waarom dit stopt en niet zelf kopieert ──────────────────────────────────
 *
 * Het bestand overschrijven raakt beide omgevingen tegelijk — ook productie,
 * die op dat moment kan draaien. Dat hoort een bewuste handeling te zijn, niet
 * een bijwerking van een uitrol naar acceptatie.
 */
function controleerComposeBestand() {
  const lokaalPad = path.join(
    __dirname,
    '..',
    'deploy',
    'docker-compose.omgeving.yml',
  );

  const lokaal = createHash('sha256')
    .update(fs.readFileSync(lokaalPad))
    .digest('hex');

  const opDeServer = opServer(
    `sha256sum ${SERVER_MAP}/docker-compose.omgeving.yml 2>/dev/null | cut -d' ' -f1 || true`,
    { stil: true },
  );

  const server = opDeServer.uit.trim();

  if (!server) {
    stop(
      `${SERVER_MAP}/docker-compose.omgeving.yml ontbreekt op de server.`,
      'Richt de server eerst in:\n  npm run deploy:inrichten',
    );
  }

  if (server !== lokaal) {
    stop(
      'Het compose-bestand op de server wijkt af van dat in de repository.',
      `  server:      ${server.slice(0, 16)}…\n` +
        `  repository:  ${lokaal.slice(0, 16)}…\n\n` +
        'De uitrol zou draaien op een andere opzet dan je hier voor je hebt.\n' +
        'Precies dat gebeurde op 2026-08-10: de frontend stond op de server nog\n' +
        'achter een profiel en werd stilzwijgend overgeslagen.\n\n' +
        'Verschil bekijken:\n' +
        `  ssh ${SERVER} "cat ${SERVER_MAP}/docker-compose.omgeving.yml" | diff - deploy/docker-compose.omgeving.yml\n\n` +
        'Bijwerken (raakt BEIDE omgevingen, dus kijk eerst naar het verschil):\n' +
        `  ssh ${SERVER} "cp ${SERVER_MAP}/docker-compose.omgeving.yml ${SERVER_MAP}/docker-compose.omgeving.yml.bak"\n` +
        `  ssh ${SERVER} "cat > ${SERVER_MAP}/docker-compose.omgeving.yml" < deploy/docker-compose.omgeving.yml\n\n` +
        'Er is niets gewijzigd — de draaiende omgeving is niet aangeraakt.',
    );
  }

  console.log(`     ${kleur.groen('OK')}   compose-bestand gelijk aan de repository`);
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

  controleerComposeBestand();

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

  const digests = digestsOpvragen(omgeving, versie, frontendVersie);

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
  console.log(
    omgeving.migratiesOverslaan
      ? '4/6  Migraties — overgeslagen'
      : '4/6  Migraties op de database van deze omgeving',
  );

  // Staging én productie migreren niet vanaf deze machine. Dat gebeurt in een
  // workflow, tegen Supabase, met het teruglezen erin:
  //
  //   staging    → job `staging` in .github/workflows/ci.yml
  //   productie  → .github/workflows/productie.yml, achter vier remmen
  //
  // Ze hier nóg een keer draaien zou betekenen dat een laptop schrijft naar een
  // database die de pipeline beheert. Dat is precies de gewoonte die dit plan
  // probeert af te leren: `.env` op een laptop wijzend naar iets echts.
  const migreren = omgeving.migratiesOverslaan
    ? { ok: true, uit: '', fout: '' }
    : opServer(
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
  const migratiestand = omgeving.migratiesOverslaan
    ? { uit: '' }
    : opServer(
        `docker exec ${omgeving.project}-db-1 psql -U postgres -tAc ` +
          `"SELECT count(*) FROM drizzle.__drizzle_migrations" 2>/dev/null || echo 0`,
        { stil: true },
      );

  const aantalMigraties = Number(migratiestand.uit.trim()) || 0;

  // Teruglezen is de kern van deze stap, dus overslaan vraagt een reden. Die
  // is er: staging heeft geen containerdatabase om in te kijken, en de
  // CI-job die daar migreert leest de stand zelf terug — met
  // `scripts/migratiestand.js --volgens-journal`, dat vergelijkt met het
  // journal in plaats van met een getal dat veroudert.
  //
  // Wat hier dus NIET gebeurt: aannemen dat het goed is. Het bewijs staat
  // ergens anders, en deze melding zegt waar.
  if (omgeving.migratiesOverslaan) {
    console.log(
      `     ${kleur.grijs('teruglezen gebeurt in CI, tegen Supabase')}`,
    );
  } else if (aantalMigraties === 0) {
    stop(
      'De migraties meldden succes, maar de database is leeg.',
      `In drizzle.__drizzle_migrations staan ${aantalMigraties} migraties.\n\n` +
        `Uitvoer van het migratiescript:\n${migreren.uit}\n\n` +
        'De nieuwe code is NIET gestart.',
    );
  }

  if (!omgeving.migratiesOverslaan) {
    console.log(
      `     ${kleur.groen('OK')}   ${aantalMigraties} migraties op de database (teruggelezen, niet aangenomen)`,
    );
  }

  // ── 5. Containers vervangen ─────────────────────────────────────────────
  console.log('');
  console.log('5/6  Containers vervangen');

  const gestart = start(omgeving, versie, frontendVersie, digests);

  if (!gestart.ok) {
    // Hier stond `npm run rollback:<omgeving>` — een script dat niet bestaat.
    // Dat is niet zomaar een verkeerde verwijzing: deze regel verschijnt op het
    // moment dat de uitrol al mislukt is, en dan is een commando dat "Missing
    // script" antwoordt het laatste wat je kunt gebruiken.
    //
    // Terugdraaien is in dit project geen apart script maar dezelfde uitrol met
    // de vorige tag. Die staat hier expliciet in, samengesteld uit wat er
    // draaide — net als in het slotbericht van een geslaagde uitrol.
    //
    // Gevonden op 2026-08-11, bij het bouwen van stap 4.
    stop(
      'De containers konden niet gestart worden.',
      `${gestart.fout}\n\nTerugdraaien:\n  ` +
        (vorige
          ? `npm run deploy:${omgeving.naam} -- --versie ${vorige}` +
            (FRONTEND_MEE && vorigeFrontend
              ? ` --frontend-versie ${vorigeFrontend}`
              : '')
          : 'er draaide hier nog niets — er is geen vorige versie om naar terug te vallen.'),
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
      // De vorige images staan al lokaal op de server — geen nieuwe pull
      // nodig — maar hun digest is nog niet gemeten in déze uitrol. Opnieuw
      // opvragen in plaats van hergebruiken van `digests`, want die hoort bij
      // de mislukte versie.
      const vorigeDigests = digestsOpvragen(
        omgeving,
        vorige,
        vorigeFrontend || 'latest',
      );
      const terug = start(omgeving, vorige, vorigeFrontend || 'latest', vorigeDigests);

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
