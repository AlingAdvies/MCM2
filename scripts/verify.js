#!/usr/bin/env node
'use strict';

/**
 * Bootst de CI-poort lokaal na (`npm run verify`).
 *
 * ── Waarom dit bestaat ───────────────────────────────────────────────────────
 *
 * Op 2026-07-31 faalde CI op de lintstap terwijl lokaal alles groen leek. De
 * oorzaak was geen typefout maar een naamsverwarring: `npm run lint` fixt en
 * staat waarschuwingen toe, `npm run lint:check` faalt op elke waarschuwing.
 * CI draait de tweede. Er waren 16 waarschuwingen, allemaal blokkerend.
 *
 * Datzelfde valstrikje bestaat bij `format` versus `format:check`, en bij
 * `test` (alleen unittests) versus de e2e-suite die CI apart draait. Wie moet
 * onthouden welke variant CI gebruikt, gaat dat een keer mis hebben.
 *
 * Dit script haalt die kennis uit iemands hoofd en zet hem in code. Eén
 * commando, één antwoord op "is dit groen", en dat antwoord komt overeen met
 * dat van CI.
 *
 * ── De bron van waarheid blijft .github/workflows/ci.yml ─────────────────────
 *
 * Dit script is een kopie van die stappen, geen afleiding ervan. Verandert de
 * workflow, dan verandert dit script mee — de lijst STAPPEN hieronder verwijst
 * per stap naar de job waar hij vandaan komt, zodat die vergelijking te maken
 * is zonder beide bestanden uit het hoofd te kennen.
 */

const { spawnSync } = require('node:child_process');

/**
 * De stappen, in de volgorde waarin CI ze draait.
 *
 * `ci` benoemt de job en stap in .github/workflows/ci.yml. Bij een wijziging
 * daar hoort een wijziging hier; die verwijzing maakt dat controleerbaar.
 */
const STAPPEN = [
  {
    naam: 'format',
    omschrijving: 'Opmaak controleren',
    ci: 'quality → Format controleren',
    commando: ['npm', 'run', 'format:check'],
  },
  {
    naam: 'lint',
    omschrijving: 'Lint (waarschuwingen tellen als fout)',
    ci: 'quality → Lint',
    commando: ['npm', 'run', 'lint:check'],
  },
  {
    naam: 'typecheck',
    omschrijving: 'Typecontrole',
    ci: 'quality → Typecheck',
    commando: ['npm', 'run', 'typecheck'],
  },
  {
    naam: 'unit',
    omschrijving: 'Unittests',
    ci: 'quality → Unit tests',
    commando: ['npm', 'test'],
  },
  {
    naam: 'e2e',
    omschrijving: 'E2e-tests (vraagt een wegwerpdatabase)',
    ci: 'rls-isolation → Tenant- en token-isolatietests',
    commando: ['npx', 'jest', '--config', './test/jest-e2e.json', '--forceExit'],
    vraagtDatabase: true,
  },
];

/** Hosts die als wegwerpomgeving gelden. */
const LOKALE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

/**
 * Controleert dat DATABASE_URL naar een wegwerpdatabase wijst.
 *
 * Dit is geen formaliteit. De e2e-suite maakt tenants aan, verwijdert rijen en
 * trekt sessies in. Tegen `clm-enterprise` gedraaid is dat onherstelbaar — en
 * de productie-URL staat in `.env`, dus één verkeerd gekopieerde regel is
 * genoeg. Dit is de laatste plek waar die vergissing nog te vangen is.
 *
 * @returns {{ok: true} | {ok: false, reden: string}}
 */
function controleerDatabaseUrl(waarde) {
  let url;

  try {
    url = new URL(waarde);
  } catch {
    return { ok: false, reden: 'DATABASE_URL is geen geldige URL.' };
  }

  if (!LOKALE_HOSTS.has(url.hostname)) {
    return {
      ok: false,
      reden:
        `DATABASE_URL wijst naar '${url.hostname}'.\n\n` +
        '  De e2e-tests maken tenants aan en verwijderen rijen. Ze horen\n' +
        '  uitsluitend tegen een wegwerpcontainer te draaien, nooit tegen een\n' +
        '  database met echte gegevens.\n\n' +
        '  Een verse testdatabase opzetten: zie docs/STATUS.md, "Snel weer op\n' +
        '  gang komen".',
    };
  }

  return { ok: true };
}

function draai(commando) {
  const [uitvoerbaar, ...argumenten] = commando;

  const resultaat = spawnSync(uitvoerbaar, argumenten, {
    stdio: 'inherit',
    // Op Windows zijn npm en npx .cmd-bestanden; zonder shell vindt spawnSync
    // ze niet. Zelfde reden als in scripts/backup-dump.js.
    shell: process.platform === 'win32',
  });

  return resultaat.status === 0;
}

function main() {
  const alleenSnel = process.argv.includes('--snel');
  const stappen = alleenSnel
    ? STAPPEN.filter((stap) => !stap.vraagtDatabase)
    : STAPPEN;

  console.log('');
  console.log('Verificatie — dezelfde poorten als CI (.github/workflows/ci.yml)');
  if (alleenSnel) {
    console.log('Modus: --snel, de e2e-stap wordt overgeslagen.');
  }
  console.log('');

  // --snel telt als overslaan, niet als een kleinere volledige controle. Zonder
  // deze regel meldde het script "GROEN — alle poorten die CI ook draait"
  // terwijl de e2e-stap bewust was overgeslagen: precies de valse zekerheid
  // die dit script hoort uit te bannen.
  const overgeslagen = alleenSnel
    ? STAPPEN.filter((stap) => stap.vraagtDatabase).map((s) => s.omschrijving)
    : [];
  let nummer = 0;

  for (const stap of stappen) {
    nummer += 1;
    const kop = `${nummer}/${stappen.length}  ${stap.omschrijving}`;

    if (stap.vraagtDatabase) {
      const url = process.env.DATABASE_URL;

      if (!url) {
        // Overslaan en dat luid melden, niet falen. Zelfde patroon als de
        // browsertest in de frontend (#47): een stap die zijn omgeving niet
        // heeft, hoort niet te doen alsof hij iets bewezen heeft.
        console.log(`${kop}\n  OVERGESLAGEN — DATABASE_URL ontbreekt.\n`);
        overgeslagen.push(stap.omschrijving);
        continue;
      }

      const oordeel = controleerDatabaseUrl(url);

      if (!oordeel.ok) {
        console.error(`${kop}\n`);
        console.error(`  GESTOPT: ${oordeel.reden}\n`);
        process.exit(1);
      }
    }

    console.log(kop);

    if (!draai(stap.commando)) {
      console.error('');
      console.error(`ROOD op: ${stap.omschrijving}`);
      console.error(`CI draait deze stap als: ${stap.ci}`);
      console.error('');
      // Stoppen bij de eerste rode stap: de volgende stappen zeggen niets
      // zolang deze faalt, en een lange lijst uitvoer verbergt de oorzaak.
      process.exit(1);
    }

    console.log('');
  }

  if (overgeslagen.length > 0) {
    console.log('GROEN, met overgeslagen stappen:');
    for (const naam of overgeslagen) {
      console.log(`  - ${naam}`);
    }
    console.log('');
    console.log('Dit is dus GEEN volledige CI-gelijkwaardige controle.');
    console.log('Zet DATABASE_URL naar een wegwerpcontainer voor de rest.');
    // Bewust exitcode 0: overslaan is geen fout. De melding hierboven is het
    // signaal, niet de exitcode — anders wordt `--snel` onbruikbaar.
  } else {
    console.log('GROEN — alle poorten die CI ook draait.');
    console.log('');
    console.log('Let op: dit dekt niet de Docker-productiebuild.');
    console.log('Die draait alleen in CI (job: docker-build).');
  }

  console.log('');
}

main();
