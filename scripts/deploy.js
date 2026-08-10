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
 *   npm run deploy:acceptatie              laatste main-image
 *   npm run deploy:acceptatie -- sha-abc123def456
 *   npm run deploy:productie               vraagt bevestiging
 *   npm run deploy:productie -- --versie sha-abc123def456
 *   npm run deploy:status                  wat draait waar
 *   npm run rollback:acceptatie            vorige versie terug
 *
 * Zie docs/runbooks/uitrol-acceptatie-en-productie.md.
 */

const { spawnSync } = require('node:child_process');
const readline = require('node:readline');

const SERVER = 'root@saxombp';
const SERVER_MAP = '/opt/mcm2';

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

/** Wat er op dit moment draait, of null wanneer er niets draait. */
function huidigeVersie(omgeving) {
  const res = opServer(
    `docker inspect --format '{{.Config.Image}}' ${omgeving.project}-api-1 2>/dev/null || true`,
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
    {
      wat: 'frontend serveert een pagina',
      commando: `curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:${omgeving.frontendPoort}/`,
      verwacht: (uit) => uit === '200',
    },
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
function start(omgeving, versie) {
  const zet = [
    `cd ${SERVER_MAP}`,
    `export API_IMAGE=$(grep '^GHCR_API=' ${omgeving.naam}.env | cut -d= -f2):${versie}`,
    `export FRONTEND_IMAGE=$(grep '^GHCR_FRONTEND=' ${omgeving.naam}.env | cut -d= -f2):${versie}`,
    `docker compose --env-file ${omgeving.naam}.env -p ${omgeving.project} -f docker-compose.omgeving.yml up -d`,
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

  console.log('');
  console.log(`Uitrol naar ${kleur.geel(omgeving.naam.toUpperCase())}`);
  console.log(kleur.grijs(`  server:  ${SERVER}`));
  console.log(kleur.grijs(`  versie:  ${versie}`));
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
  console.log(
    `     ${kleur.groen('OK')}   ${vorige ? `nu actief: ${vorige}` : 'er draait nog niets'}`,
  );

  // ── 2. Bevestiging bij productie ────────────────────────────────────────
  if (omgeving.bevestiging) {
    console.log('');
    console.log('2/6  Bevestiging');

    // Een uitrol naar productie die niet eerst op acceptatie stond, is precies
    // de stap die OTAP overslaat. Melden, niet blokkeren: soms is er een
    // gegronde reden, maar hij moet zichtbaar zijn.
    const opAcceptatie = huidigeVersie(OMGEVINGEN.acceptatie);

    if (opAcceptatie !== versie) {
      console.log('');
      console.log(
        kleur.geel(
          `     LET OP: op acceptatie draait ${opAcceptatie || '(niets)'}, niet ${versie}.`,
        ),
      );
      console.log(
        kleur.geel(
          '     Deze versie is daar dus niet beproefd. Dat is de stap die OTAP juist voorschrijft.',
        ),
      );
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
      `docker pull $(grep '^GHCR_FRONTEND=' ${omgeving.naam}.env | cut -d= -f2):${versie}`,
    ].join(' && '),
    { stil: true },
  );

  if (!ophalen.ok) {
    stop(
      `Kon image '${versie}' niet ophalen.`,
      `${ophalen.fout}\n\nBestaat die tag? Kijk op:\n  https://github.com/AlingAdvies/MCM2/pkgs/container/mcm2%2Fapi\n\nEr is niets gewijzigd — de draaiende omgeving is niet aangeraakt.`,
    );
  }

  console.log(`     ${kleur.groen('OK')}   beide images opgehaald`);

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
      `docker compose --env-file ${omgeving.naam}.env -p ${omgeving.project} -f docker-compose.omgeving.yml up -d db`,
      `sleep 3`,
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

  console.log(`     ${kleur.groen('OK')}   ${migreren.uit.split('\n').pop()}`);

  // ── 5. Containers vervangen ─────────────────────────────────────────────
  console.log('');
  console.log('5/6  Containers vervangen');

  const gestart = start(omgeving, versie);

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
      console.log(`Terugdraaien naar ${vorige}…`);
      const terug = start(omgeving, vorige);

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
    kleur.groen(`UITGEROLD — ${omgeving.naam} draait op ${versie}.`),
  );
  console.log('');
  console.log(`  frontend:  http://saxombp:${omgeving.frontendPoort}`);
  console.log(`  backend:   http://saxombp:${omgeving.apiPoort}/health`);

  if (vorige && vorige !== versie) {
    console.log('');
    console.log(kleur.grijs(`  vorige versie was ${vorige}`));
    console.log(
      kleur.grijs(
        `  terugdraaien:  npm run deploy:${omgeving.naam} -- --versie ${vorige}`,
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
