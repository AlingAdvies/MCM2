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

const SAXOMBP = 'root@saxombp';
const SAXOMBP_DUMP_DIR = '/opt/mcm2-backup/dumps';

/**
 * Draait een commando op saxombp via SSH. Zelfde vorm als in
 * scripts/verify-omgevingen.js (opServer): BatchMode + ConnectTimeout, geen
 * interactieve prompt mogelijk.
 *
 * Dit is een DOOR EEN MENS GESTARTE controle (de eigenaar draait
 * `npm run backup:controle`, of de geplande laptoktaak doet dat namens
 * hem) — de periodieke Tailscale SSH-herauthenticatie is hier dus geen
 * showstopper zoals bij een onbewaakte cron-taak. Mocht de herauth ooit
 * opnieuw nodig zijn, faalt deze aanroep met een duidelijke fout in plaats
 * van stil te hangen, want BatchMode=yes weigert de interactieve vraag.
 */
function opSaxombp(commando) {
  const res = spawnSync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', SAXOMBP, commando],
    { encoding: 'utf8' },
  );
  return {
    ok: res.status === 0,
    uit: (res.stdout || '').trim(),
    fout: (res.stderr || res.error?.message || '').trim(),
  };
}

/**
 * Controleert de saxombp-productiebackup: bereikbaar? recente dump aanwezig?
 *
 * Twee soorten falen die uit elkaar gehouden moeten worden (spec §6): "saxombp
 * niet bereikbaar" (Tailscale uit, machine down, SSH-time-out) is een ander
 * signaal dan "geen dump gevonden" — hetzelfde onderscheid dat
 * backupcontrole.md al maakt voor "Docker draait niet" versus een echt
 * beschadigde dump. Een bericht dat de verkeerde oorzaak suggereert leert je
 * het te negeren.
 */
function controleerSaxombp() {
  const bereikbaar = opSaxombp('echo ok');
  if (!bereikbaar.ok) {
    return {
      bereikbaar: false,
      bericht:
        `saxombp is niet bereikbaar via SSH.\n${bereikbaar.fout || 'Geen verdere foutmelding.'}\n\n` +
        `Controleer of Tailscale actief is en of saxombp aanstaat.`,
    };
  }

  // Geen `|| true`: dat verstopt een echte fout (bv. permission-denied op de
  // dumpmap) achter dezelfde lege uitvoer als "geen dumps aanwezig", en meldt
  // dan het verkeerde probleem ("cron heeft niet gedraaid" i.p.v. "de map is
  // niet leesbaar"). Een niet-nul exitcode wordt hieronder apart afgehandeld.
  const lijst = opSaxombp(`ls -1 --time-style=+%s ${SAXOMBP_DUMP_DIR}`);

  if (!lijst.ok) {
    return {
      bereikbaar: true,
      goed: false,
      bericht: `Kon de dumpmap niet lezen op saxombp (${SAXOMBP_DUMP_DIR}).\n${lijst.fout || 'Geen verdere foutmelding.'}`,
    };
  }

  // `ls` zonder -t sorteert alfabetisch; de bestandsnamen bevatten een
  // ISO-achtige tijdstempel (mcm2-productie-YYYY-MM-DDTHH-MM-SS.dump), dus
  // alfabetisch is hier ook chronologisch. Geen aparte sortering nodig.
  //
  // Strikte whitelist i.p.v. een losse grep: exact het formaat dat
  // saxombp-backup-productie.sh produceert. Een naam die hier niet aan
  // voldoet komt NOOIT in een SSH-commando-string terecht — dat voorkomt
  // shell-injectie via een geprepareerde bestandsnaam (bv.
  // "mcm2-productie-...$(commando).dump") volledig, in plaats van hem
  // "veilig te maken" met escaping.
  const DUMPNAAM_PATROON = /^mcm2-productie-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.dump$/;

  const regels = lijst.uit.split('\n').filter(Boolean);
  const dumps = regels.filter((r) => DUMPNAAM_PATROON.test(r));
  const onverwacht = regels.filter((r) => !DUMPNAAM_PATROON.test(r));

  if (onverwacht.length > 0) {
    return {
      bereikbaar: true,
      goed: false,
      bericht:
        `Onverwachte bestandsnaam gevonden op saxombp (${SAXOMBP_DUMP_DIR}):\n` +
        onverwacht.map((r) => `  • ${r}`).join('\n') +
        `\n\nDit wordt niet verwerkt — controleer handmatig wat daar staat.`,
    };
  }

  if (dumps.length === 0) {
    return {
      bereikbaar: true,
      goed: false,
      bericht: `Geen enkele productiedump gevonden op saxombp (${SAXOMBP_DUMP_DIR}).`,
    };
  }

  const nieuwste = dumps[dumps.length - 1];
  const mtijd = opSaxombp(`stat -c%Y ${SAXOMBP_DUMP_DIR}/${nieuwste} 2>/dev/null || true`);
  const tijdSeconden = Number(mtijd.uit);

  if (!Number.isFinite(tijdSeconden) || tijdSeconden === 0) {
    return {
      bereikbaar: true,
      goed: false,
      bericht: `Kon de leeftijd van ${nieuwste} op saxombp niet bepalen.`,
    };
  }

  const urenOud = (Date.now() / 1000 - tijdSeconden) / 3600;
  if (urenOud > MAX_LEEFTIJD_UREN) {
    const leeftijd =
      urenOud >= 24 ? `${Math.floor(urenOud / 24)} dag(en)` : `${Math.floor(urenOud)} uur`;
    return {
      bereikbaar: true,
      goed: false,
      bericht: `De nieuwste productiedump op saxombp is ${leeftijd} oud (${nieuwste}).\nDe cron-taak op saxombp heeft kennelijk stilgelegen.`,
    };
  }

  const leeftijd =
    urenOud >= 1 ? `${Math.floor(urenOud)} uur` : `${Math.round(urenOud * 60)} minuten`;
  return { bereikbaar: true, goed: true, leeftijd, aantal: dumps.length };
}

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

// ── Het bewijsbestand ───────────────────────────────────────────────────────
//
// Waar het staat: `docs/runbooks/backup-bewijs.json`, náást de
// verwachtingslijst waar het bij hoort. In de repository, want de lezer is een
// CI-runner die alleen de repository heeft.
//
// ── Wat er NIET in staat, en waarom dat telt ────────────────────────────────
//
// Geen pad, geen mapnaam, geen hostnaam. Het bestand wordt gecommit en is dus
// zo openbaar als de repository. `backupDir` wijst naar een OneDrive-map met de
// naam van de eigenaar erin; die hoort daar niet in te belanden.
//
// De bestandsnaam van de dump is wél veilig: `mcm2-<tijdstempel>.dump` bevat
// niets persoonlijks, en zonder die naam is niet na te gaan wélke dump het
// akkoord droeg.
const bewijsPad = path.join(PROJECT_DIR, 'docs', 'runbooks', 'backup-bewijs.json');

function schrijfBewijs({ dump, problemen, regels, modus }) {
  const bewijs = {
    // Wanneer de controle draaide — niet wanneer de dump gemaakt is. Dat
    // onderscheid is precies waar het op 2026-08-04 misging: de dumps waren
    // dagelijks vers en al maanden incompleet.
    gecontroleerdOp: new Date().toISOString(),
    dumpGemaaktOp: new Date(dump.tijd).toISOString(),
    dumpNaam: dump.naam,
    dumpBytes: dump.grootte,
    // Welke lagen er gedraaid hebben. Zonder `--volledig` is de
    // herstelbaarheid niet getoetst, en dat mag het bewijs niet verzwijgen.
    lagen: modus === '--volledig' ? ['A', 'B', 'C'] : ['A', 'B'],
    goed: problemen.length === 0,
    problemen: problemen.map((p) => p.sleutel),
    bevindingen: regels,
  };

  try {
    fs.writeFileSync(bewijsPad, JSON.stringify(bewijs, null, 2) + '\n', 'utf8');
  } catch (err) {
    // Niet fataal: de backupcontrole zelf is belangrijker dan zijn bewijs.
    // Wél zichtbaar, want zonder dit bestand blokkeert de productie-uitrol en
    // is de oorzaak anders niet te vinden.
    console.error(`Bewijsbestand niet geschreven: ${err.message}`);
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
      process.exitCode = 1;
      return;
    }
    if (!telegram.geconfigureerd) {
      console.error(
        '\nTELEGRAM_BOT_TOKEN en/of TELEGRAM_CHAT_ID ontbreken in .env.\nZonder die twee is er geen melding — zie het runbook.',
      );
      process.exitCode = 1;
      return;
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
    process.exitCode = 1;
    return;
  }

  const actualiteit = controleerActualiteit(dump);
  if (!actualiteit.goed) {
    problemen.push({ sleutel: 'verouderd', bericht: actualiteit.bericht });
  } else {
    await telegram.meldHerstel('verouderd', 'de backup is weer actueel');
    regels.push(`Laatste dump: ${dump.naam} (${actualiteit.leeftijd} oud)`);
  }

  // ── Saxombp — onafhankelijke productiebackup ──────────────────────────────
  //
  // Los van de OneDrive-laag hierboven: dit is een TWEEDE, onafhankelijke
  // backup (spec 2026-08-25-saxombp-productiebackup-design.md). Eigen sleutel
  // ('saxombp'), zodat de demping los werkt van de OneDrive-problemen — een
  // storing op de laptop mag een storing op saxombp niet verbergen en
  // andersom.
  const saxombp = controleerSaxombp();
  if (!saxombp.bereikbaar) {
    problemen.push({ sleutel: 'saxombp', bericht: saxombp.bericht });
  } else if (!saxombp.goed) {
    problemen.push({ sleutel: 'saxombp', bericht: saxombp.bericht });
  } else {
    await telegram.meldHerstel('saxombp', 'de productiebackup op saxombp is weer actueel');
    regels.push(`saxombp: ${saxombp.leeftijd} oud, ${saxombp.aantal} dump(s) bewaard`);
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

  // ── Het bewijsbestand voor de productie-uitrol ────────────────────────────
  //
  // Stap 4 van het OTAP-plan eist een backup vóór elke uitrol naar productie,
  // en die eis moet AFDWINGBAAR zijn — niet een zin in een runbook.
  //
  // Het probleem: de backup ligt hier, op deze laptop, en de uitrol wordt
  // gestart door een CI-runner die daar nooit bij kan. De runner kan dus niet
  // zelf vaststellen of er een bruikbare dump is.
  //
  // Vandaar deze omkering. Niet de runner gaat kijken; de controle die hier
  // tóch al draait laat een spoor achter in de repository, en de runner leest
  // dat. `productie-poort.js` weigert de uitrol als het te oud is.
  //
  // ── Waarom het uit DEZE controle komt en niet uit backup-dump.js ──────────
  //
  // Een dump die bestaat is geen dump die deugt. Op 2026-08-04 waren alle
  // dumps precies 21.683 bytes en misten er negen van de achttien tabellen —
  // `backup-dump.js` meldde al die tijd succes. Laag B hierboven is de enige
  // die dát vaststelt, dus het bewijs hoort daarachter te zitten.
  //
  // Het bestand zegt daarom niet "er is een backup" maar "de controle is
  // gedraaid en dit vond hij". Staat er een probleem in, dan weigert de poort.
  schrijfBewijs({ dump, problemen, regels, modus });

  // Console-uitvoer voor handmatig gebruik en het taaklog.
  console.log(`${new Date().toISOString()} — ${problemen.length} probleem(en)`);
  for (const regel of regels) console.log(`  ${regel}`);
  for (const probleem of problemen) console.log(`  PROBLEEM: ${probleem.bericht.split('\n')[0]}`);

  // Bewust process.exitCode en niet process.exit().
  //
  // process.exit() kapt af terwijl libuv de HTTPS-verbinding naar Telegram nog
  // aan het opruimen is. Op Windows crasht Node daar sinds v24 op:
  //
  //   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c
  //
  // Dat gebeurde op 2026-08-06 en gaf exitcode -1073740791 in plaats van 1.
  // De berichten wáren al verstuurd, dus er ging niets verloren — maar het log
  // eindigde met een crash, en een controle die zelf crasht is er precies één
  // die je niet vertrouwt op het moment dat het ertoe doet.
  //
  // Met exitCode rondt Node de verbinding netjes af en eindigt daarna vanzelf.
  // Gemeten: binnen 0,6 seconde, want fetch houdt geen sockets open.
  process.exitCode = problemen.length > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(`Onverwachte fout in de backupcontrole: ${err.message}`);
  process.exitCode = 1;
});
