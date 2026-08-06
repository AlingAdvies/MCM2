#!/usr/bin/env node
// Controleert of de backup werkt, compleet is en herstelbaar — en meldt via Telegram.
//
// ── Waarom dit bestaat ──────────────────────────────────────────────────────
//
// Op 2026-08-04 bleken twee dingen tegelijk mis:
//
// 1. De dagelijkse dump miste NEGEN van de achttien tabellen — alle vragenlijsten,
//    alle antwoorden, alle geuploade certificaten, en het complete rechtenmodel.
//    Dat was er altijd al zo geweest; alle dumps waren exact 21.683 bytes.
// 2. De taak had vier dagen stilgelegen. Het script waarschuwde keurig in het
//    log — maar niemand las dat log.
//
// Een waarschuwing die je moet gaan halen, is geen waarschuwing. En een backup
// waarvan niemand controleert WAT erin zit, is een bestand, geen vangnet.
//
// ── Drie lagen ──────────────────────────────────────────────────────────────
//
//   A. Draait hij?      is er een dump van vandaag?     (vervalt bij managed service)
//   B. Is hij compleet? zit alles erin wat erin hoort?  (BLIJFT — dit is de kern)
//   C. Is hij herstelbaar?  komt het er ook weer uit?   (blijft, wekelijks)
//
// Laag B is de enige die geen enkele managed service voor je doet. Neon of
// Supabase Pro garanderen dat er een backup IS — niet dat erin staat wat jij
// denkt. Daarom ligt daar het gewicht.
//
// ── Gebruik ─────────────────────────────────────────────────────────────────
//
//   node scripts/backup-controle.js            lagen A en B (dagelijks)
//   node scripts/backup-controle.js --volledig lagen A, B en C (wekelijks)
//   node scripts/backup-controle.js --test     test alleen de Telegram-verbinding
//
// Draait bewust LOS van backup-dump.js: als de backup helemaal niet draait,
// moet de melding juist nog werken. Zelfde gedachte als de serverbewaking in
// de Saxo-app.
//
// Zie docs/superpowers/specs/2026-08-04-backupcontrole-en-signalering.md

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { Telegram } = require('./telegram');

const PROJECT_DIR = path.resolve(__dirname, '..');
const PG_IMAGE = 'postgres:17.6';

// Gelijk aan de drempel in backup-dump.js: laat een overgeslagen dag toe zonder
// vals alarm, slaat aan bij twee.
const MAX_LEEFTIJD_UREN = 36;

const backupDir = path.resolve(
  process.env.BACKUP_DIR ||
    path.join(os.homedir(), 'OneDrive - Aling Advies', 'MCM2-backups'),
);

const statusDir = path.join(os.homedir(), '.mcm2-backupcontrole');
const verwachtingPad = path.join(PROJECT_DIR, 'docs', 'runbooks', 'backup-verwachting.json');

const telegram = new Telegram({ projectDir: PROJECT_DIR, statusDir });

// ── De portabiliteitsgrens ──────────────────────────────────────────────────
//
// Dit is de ENIGE functie die verandert bij de overstap naar een managed service.
// Nu: het nieuwste bestand in een map. Straks: een API-aanroep bij de provider,
// of een restore naar een tijdelijke database.
//
// Alles daarna — de verwachtingslijst, de vergelijking, de demping, het bericht
// — blijft ongewijzigd. Dat is de hele abstractie; verder geen lagen.
function haalNieuwsteBackup() {
  if (!fs.existsSync(backupDir)) {
    return { fout: `De backupmap bestaat niet: ${backupDir}` };
  }

  const dumps = fs
    .readdirSync(backupDir)
    .filter((b) => /^mcm2-.*\.dump$/.test(b))
    .map((b) => {
      const volledig = path.join(backupDir, b);
      const stat = fs.statSync(volledig);
      return { naam: b, pad: volledig, tijd: stat.mtimeMs, grootte: stat.size };
    })
    .sort((x, y) => y.tijd - x.tijd);

  if (dumps.length === 0) {
    return { fout: `Geen enkele dump gevonden in ${backupDir}` };
  }

  return { dump: dumps[0], aantal: dumps.length };
}

// ── Draait Docker? ──────────────────────────────────────────────────────────
//
// Laag B en C hebben allebei een container nodig. Staat Docker uit, dan falen
// ze — maar met een melding die iets heel anders suggereert dan er aan de hand
// is. Op 2026-08-06 gebeurde dat: "De inhoudsopgave is niet leesbaar. Dat wijst
// op een beschadigde of afgebroken dump." De dump was volstrekt in orde; alleen
// Docker Desktop stond uit.
//
// Dat is de gevaarlijkste soort melding. Hij liegt niet over dát er iets mis is,
// maar wel over wát — en een bericht dat je twee keer voor niets laat schrikken,
// leer je negeren. Dan is de melding net zo stil als het logbestand.
//
// Dit is bovendien de waarschijnlijkste storing van allemaal: Docker Desktop
// start niet mee met Windows, dus elke herstart zonder handmatige start levert
// een dag zonder backup op. Precies daarom verdient hij een eigen, eerlijke
// melding in plaats van een afgeleide.
function dockerDraait() {
  const res = spawnSync('docker', ['info'], { encoding: 'utf8' });
  return res.status === 0;
}

/** Draait een commando in de postgres-container tegen de backupmap. */
function inContainer(commando) {
  return spawnSync(
    'docker',
    ['run', '--rm', '-v', `${backupDir}:/backup`, PG_IMAGE, 'sh', '-c', commando],
    { encoding: 'utf8' },
  );
}

// ── Laag A — draait hij? ────────────────────────────────────────────────────
function controleerActualiteit(dump) {
  const urenOud = (Date.now() - dump.tijd) / 3_600_000;
  const leeftijd =
    urenOud >= 24 ? `${Math.floor(urenOud / 24)} dag(en)` : `${Math.floor(urenOud)} uur`;

  if (urenOud > MAX_LEEFTIJD_UREN) {
    return {
      goed: false,
      bericht: `De nieuwste dump is ${leeftijd} oud (${dump.naam}).\nDe geplande taak heeft kennelijk stilgelegen.`,
    };
  }
  return { goed: true, leeftijd };
}

// ── Laag B — is hij compleet? (de kern) ─────────────────────────────────────
function controleerCompleetheid(dump) {
  const verwachting = JSON.parse(fs.readFileSync(verwachtingPad, 'utf8'));
  const verwacht = new Set(verwachting.tabellen);

  const res = inContainer(`pg_restore --list /backup/${dump.naam}`);
  if (res.status !== 0) {
    return {
      goed: false,
      bericht: `De inhoudsopgave van ${dump.naam} is niet leesbaar.\nDat wijst op een beschadigde of afgebroken dump.\n\n${(res.stderr || '').trim().slice(0, 300)}`,
    };
  }

  // Regels zien eruit als: "3915; 0 42064 TABLE DATA clm tenant clm_migrator"
  const gevonden = new Set();
  for (const regel of res.stdout.split(/\r?\n/)) {
    const match = regel.match(/TABLE DATA\s+(\S+)\s+(\S+)/);
    if (match) gevonden.add(`${match[1]}.${match[2]}`);
  }

  const ontbrekend = [...verwacht].filter((t) => !gevonden.has(t)).sort();
  const onbekend = [...gevonden].filter((t) => !verwacht.has(t)).sort();

  if (ontbrekend.length > 0) {
    return {
      goed: false,
      bericht:
        `De dump mist ${ontbrekend.length} van de ${verwacht.size} tabellen:\n` +
        ontbrekend.map((t) => `  • ${t}`).join('\n') +
        `\n\nDump: ${dump.naam} (${(dump.grootte / 1024).toFixed(1)} kB)` +
        `\nControleer de migratiestand van de database — zie Issue #25.`,
      aantalGevonden: gevonden.size,
    };
  }

  if (onbekend.length > 0) {
    return {
      goed: true,
      waarschuwing:
        `De dump bevat ${onbekend.length} tabel(len) die niet in de verwachtingslijst staan:\n` +
        onbekend.map((t) => `  • ${t}`).join('\n') +
        `\n\nWerk docs/runbooks/backup-verwachting.json bij.`,
      aantalGevonden: gevonden.size,
    };
  }

  return { goed: true, aantalGevonden: gevonden.size };
}

// ── Laag C — is hij herstelbaar? ────────────────────────────────────────────
//
// pg_restore --list leest alleen de inhoudsopgave. Een dump kan een correcte
// inhoudsopgave hebben en toch afgebroken zijn. Alleen een echte restore
// bewijst dat er iets uitkomt.
//
// Bewust NIET de e2e-suite: traag, en juist het onderdeel dat bij de managed
// service verdwijnt. Vaststellen dat de tabellen er staan is genoeg.
function controleerHerstelbaarheid(dump) {
  const naam = `mcm2-hersteltest-${Date.now()}`;

  const start = spawnSync(
    'docker',
    ['run', '--rm', '-d', '--name', naam, '-e', 'POSTGRES_PASSWORD=hersteltest', PG_IMAGE],
    { encoding: 'utf8' },
  );

  if (start.status !== 0) {
    return {
      goed: false,
      bericht: `Kon geen testcontainer starten voor de herstelproef.\n${(start.stderr || '').trim().slice(0, 200)}`,
    };
  }

  try {
    // Wachten tot Postgres klaar is om verbindingen aan te nemen.
    let gereed = false;
    for (let poging = 0; poging < 30; poging++) {
      const check = spawnSync('docker', ['exec', naam, 'pg_isready', '-U', 'postgres'], {
        encoding: 'utf8',
      });
      if (check.status === 0) {
        gereed = true;
        break;
      }
      spawnSync('docker', ['exec', naam, 'sleep', '1'], { encoding: 'utf8' });
    }

    if (!gereed) {
      return { goed: false, bericht: 'De testcontainer werd niet op tijd gereed.' };
    }

    spawnSync('docker', ['cp', dump.pad, `${naam}:/tmp/herstel.dump`], { encoding: 'utf8' });

    // --no-owner: de rollen uit productie bestaan niet in de wegwerpcontainer.
    // Foutmeldingen daarover zijn ruis, geen herstelprobleem.
    const restore = spawnSync(
      'docker',
      [
        'exec',
        naam,
        'sh',
        '-c',
        'pg_restore --no-owner --no-privileges -U postgres -d postgres /tmp/herstel.dump 2>&1 | tail -5',
      ],
      { encoding: 'utf8' },
    );

    const telling = spawnSync(
      'docker',
      [
        'exec',
        naam,
        'psql',
        '-U',
        'postgres',
        '-tAc',
        "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('clm','ref','audit')",
      ],
      { encoding: 'utf8' },
    );

    const aantal = Number((telling.stdout || '0').trim());
    const verwachting = JSON.parse(fs.readFileSync(verwachtingPad, 'utf8'));

    if (aantal < verwachting.tabellen.length) {
      return {
        goed: false,
        bericht:
          `Na herstel staan er ${aantal} tabellen in de database, verwacht ${verwachting.tabellen.length}.\n` +
          `De dump is dus niet volledig herstelbaar.\n\n${(restore.stdout || '').trim().slice(0, 300)}`,
      };
    }

    return { goed: true, aantal };
  } finally {
    spawnSync('docker', ['rm', '-f', naam], { encoding: 'utf8' });
  }
}

// ── Hoofdprogramma ──────────────────────────────────────────────────────────
async function main() {
  const modus = process.argv[2] || '';

  if (modus === '--test') {
    const gelukt = await telegram.verstuur(
      `🔔 Testbericht van de MCM2-backupcontrole op ${os.hostname()}.\nAls je dit leest, werkt de melding.`,
    );
    if (!gelukt && telegram.geconfigureerd) {
      console.error('MISLUKT — zie de foutmelding hierboven.');
      process.exit(1);
    }
    if (!telegram.geconfigureerd) {
      console.error(
        '\nTELEGRAM_BOT_TOKEN en/of TELEGRAM_CHAT_ID ontbreken in .env.\nZonder die twee is er geen melding — zie het runbook.',
      );
      process.exit(1);
    }
    console.log('OK — testbericht verstuurd.');
    return;
  }

  const problemen = [];
  const regels = [];

  // Laag A
  const { dump, fout, aantal } = haalNieuwsteBackup();

  if (fout) {
    await telegram.meldProbleem('geen_backup', `MCM2 backup\n\n${fout}`);
    console.error(fout);
    process.exit(1);
  }

  const actualiteit = controleerActualiteit(dump);
  if (!actualiteit.goed) {
    problemen.push({ sleutel: 'verouderd', bericht: actualiteit.bericht });
  } else {
    await telegram.meldHerstel('verouderd', 'de backup is weer actueel');
    regels.push(`Laatste dump: ${dump.naam} (${actualiteit.leeftijd} oud)`);
  }

  // Draait Docker? Zonder container geen laag B en geen laag C. Dan is één
  // eerlijke melding beter dan twee afgeleide die de verkeerde kant op wijzen.
  //
  // Bewust GEEN herstelmelding voor de andere sleutels hier: we weten niets
  // over de compleetheid, en "hersteld" beweren op grond van onwetendheid is
  // erger dan zwijgen. Die statussen blijven staan tot een run die het
  // werkelijk kon vaststellen.
  if (!dockerDraait()) {
    problemen.push({
      sleutel: 'docker_uit',
      bericht:
        'Docker draait niet, dus de inhoud van de backup is niet gecontroleerd.\n' +
        'Over de dump zelf is hiermee niets gezegd — niet goed en niet fout.\n\n' +
        'Start Docker Desktop en draai daarna:\n' +
        '  npm run backup:controle\n\n' +
        'Let op: de backup van vanochtend is dan waarschijnlijk ook mislukt,\n' +
        'want die heeft dezelfde container nodig.',
    });
  } else {
    await telegram.meldHerstel('docker_uit', 'Docker draait weer');

    // Laag B — de kern
    const compleetheid = controleerCompleetheid(dump);
    if (!compleetheid.goed) {
      problemen.push({ sleutel: 'incompleet', bericht: compleetheid.bericht });
    } else {
      await telegram.meldHerstel('incompleet', 'de dump is weer compleet');
      regels.push(`Compleet: ${compleetheid.aantalGevonden} tabellen`);
      if (compleetheid.waarschuwing) {
        problemen.push({ sleutel: 'lijst_verouderd', bericht: compleetheid.waarschuwing });
      } else {
        await telegram.meldHerstel('lijst_verouderd', 'de verwachtingslijst is weer bij');
      }
    }

    // Laag C — alleen bij --volledig
    if (modus === '--volledig') {
      const herstel = controleerHerstelbaarheid(dump);
      if (!herstel.goed) {
        problemen.push({ sleutel: 'onherstelbaar', bericht: herstel.bericht });
      } else {
        await telegram.meldHerstel('onherstelbaar', 'de dump is weer herstelbaar');
        regels.push(`Herstelproef: ${herstel.aantal} tabellen teruggezet`);
      }
    }
  }

  // Melden
  const stempel = new Date().toLocaleString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  for (const probleem of problemen) {
    await telegram.meldProbleem(probleem.sleutel, `MCM2 backup — ${stempel}\n\n${probleem.bericht}`);
  }

  // Levensteken: zonder dit is stilte dubbelzinnig — je weet niet of alles goed
  // gaat of dat de melder zelf stuk is.
  if (problemen.length === 0 && telegram.levenstekenNodig(7)) {
    await telegram.verstuur(
      `✅ MCM2 backup — weekcheck ${stempel}\n\n${regels.join('\n')}\nBewaard: ${aantal} dump(s)`,
    );
  }

  // Console-uitvoer voor handmatig gebruik en het taaklog.
  console.log(`${new Date().toISOString()} — ${problemen.length} probleem(en)`);
  for (const regel of regels) console.log(`  ${regel}`);
  for (const probleem of problemen) console.log(`  PROBLEEM: ${probleem.bericht.split('\n')[0]}`);

  process.exit(problemen.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`Onverwachte fout in de backupcontrole: ${err.message}`);
  process.exit(1);
});
