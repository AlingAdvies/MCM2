#!/usr/bin/env node
// Maakt een backup van de MCM2-database naar een lokale dump.
//
// Waarom dit bestaat: de pilot draait op Supabase Free, dat géén enkele
// providerbackup levert (Issue #30). Deze dump is daarmee niet "extra
// zekerheid" maar het enige vangnet — zie de risico-acceptatie in ADR-011.
//
// Draait het dagelijks, dan houdt het bovendien het project actief, wat het
// pauzeren na ~7 dagen inactiviteit voorkomt.
//
// Gebruik:
//   npm run backup:dump
//   BACKUP_DIR="D:/mcm2-backups" npm run backup:dump
//
// Vereist Docker (voor pg_dump in de juiste versie) en MIGRATION_DATABASE_URL.
require('dotenv').config();

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Gelijk aan de Supabase-serverversie. Een oudere client tegen een nieuwere
// server weigert te dumpen; houd dit gelijk aan `SHOW server_version`.
const PG_IMAGE = 'postgres:17.6';

// Hoeveel dagen aan dumps bewaard blijven. Ruimer dan de RPO van 24 uur uit
// ADR-011, zodat een probleem dat pas na een paar dagen opvalt nog herstelbaar
// is vanaf vóór dat probleem.
const BEWAARDAGEN = Number(process.env.BACKUP_RETENTION_DAYS || 14);

// ── Welke rol de dump maakt, en waarom dat een eigen variabele is ───────────
//
// Sinds migratie 0011 staat FORCE ROW LEVEL SECURITY op alle tabellen. Dat
// geldt ook voor de tabeleigenaar — dat is precies wat FORCE betekent, en het
// is de juiste stand voor de runtime.
//
// Gevolg: pg_dump leest alle rijen zonder tenantcontext en krijgt er nul, of
// een harde fout. Op 2026-08-04 gemeten, direct nadat 0011 op productie
// terechtkwam:
//
//   pg_dump: error: query would be affected by row-level security policy
//            for table "audit_event"
//
// clm_migrator kan de database dus NIET dumpen. Alleen een rol met BYPASSRLS
// kan dat, en dat is bij Supabase de postgres-rol.
//
// Dat is ongemakkelijk: ADR-008 en DatabaseService.onModuleInit() zijn er
// juist streng over dat de applicatie nooit een BYPASSRLS-rol gebruikt. Voor
// een backup is het onvermijdelijk — een dump die de helft van de rijen mist
// is geen backup.
//
// Daarom een EIGEN variabele in plaats van stilletjes MIGRATION_DATABASE_URL
// hergebruiken: de keuze voor een ruimere rol hoort zichtbaar te zijn in .env,
// niet verstopt in een script. Zie Issue #78 voor het openstaande besluit over
// een aparte dumprol.
//
// Valt BACKUP_DATABASE_URL weg, dan wordt MIGRATION_DATABASE_URL geprobeerd —
// dat werkt op omgevingen zonder FORCE RLS (verse containers, CI).
const url = process.env.BACKUP_DATABASE_URL || process.env.MIGRATION_DATABASE_URL;

if (!url) {
  console.error(
    'BACKUP_DATABASE_URL en MIGRATION_DATABASE_URL ontbreken beide.\n' +
      'De dump vraagt een rol die alle rijen ziet. Sinds FORCE ROW LEVEL SECURITY\n' +
      '(migratie 0011) is dat een rol met BYPASSRLS — zie .env.example en Issue #78.',
  );
  process.exit(1);
}

// De ?schema=-parameter is een Prisma-conventie; pg_dump weigert die met
// "invalid URI query parameter". Zie runbook stap 1b-alt.
const dumpUrl = url.replace(/[?&]schema=[^&]*/g, '');

const backupDir = path.resolve(
  process.env.BACKUP_DIR || path.join(process.cwd(), 'backups'),
);

fs.mkdirSync(backupDir, { recursive: true });

const stempel = new Date()
  .toISOString()
  .replace(/[:.]/g, '-')
  .replace('T', '_')
  .slice(0, 19);
const bestandsnaam = `mcm2-${stempel}.dump`;

// Waarschuw als de vorige dump te oud is: dat betekent dat de geplande taak
// heeft stilgelegen. Een backup-taak die stil faalt is gevaarlijker dan geen
// taak, want dan denk je beschermd te zijn (ADR-011, openstaand punt).
const bestaande = fs
  .readdirSync(backupDir)
  .filter((b) => /^mcm2-.*\.dump$/.test(b))
  .map((b) => ({ b, t: fs.statSync(path.join(backupDir, b)).mtimeMs }))
  .sort((x, y) => y.t - x.t);

if (bestaande.length > 0) {
  const urenGeleden = (Date.now() - bestaande[0].t) / 3_600_000;
  if (urenGeleden > 36) {
    console.warn(
      `\nWAARSCHUWING: de vorige dump is ${Math.floor(urenGeleden / 24)} dag(en) oud (${bestaande[0].b}).\n` +
        `De geplande taak heeft kennelijk stilgelegen. Controleer of hij nog draait —\n` +
        `zolang de pilot op Supabase Free loopt, is deze dump de enige backup.\n`,
    );
  }
}

console.log(`Backup naar ${path.join(backupDir, bestandsnaam)}`);

const start = Date.now();

// Het pad binnen de container niet als los argument doorgeven: Git Bash
// vertaalt /dump/... naar een Windows-pad. sh -c houdt het ongemoeid.
const resultaat = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '-v',
    `${backupDir}:/backup`,
    '-e',
    `PGURL=${dumpUrl}`,
    PG_IMAGE,
    'sh',
    '-c',
    `pg_dump "$PGURL" --format=custom --no-owner --no-privileges ` +
      `--schema=clm --schema=ref --schema=audit --file=/backup/${bestandsnaam}`,
  ],
  { encoding: 'utf8' },
);

if (resultaat.status !== 0) {
  console.error('\nBackup MISLUKT.');
  console.error((resultaat.stderr || resultaat.error?.message || '').trim());
  console.error(
    '\nControleer of Docker draait en of BACKUP_DATABASE_URL klopt.' +
      '\nMeldt de fout iets over "row-level security policy", dan draait de dump' +
      '\nals een rol zonder BYPASSRLS — zie de toelichting bovenaan dit bestand.',
  );
  process.exit(1);
}

const doelpad = path.join(backupDir, bestandsnaam);
const grootte = fs.statSync(doelpad).size;
const duur = ((Date.now() - start) / 1000).toFixed(1);

if (grootte === 0) {
  console.error(
    `\nBackup MISLUKT: het bestand is leeg. Dat wijst op een afgebroken dump — niet als geslaagd beschouwen.`,
  );
  fs.unlinkSync(doelpad);
  process.exit(1);
}

console.log(`Geslaagd — ${(grootte / 1024).toFixed(1)} kB in ${duur}s.`);

// ── Oude dumps opruimen ───────────────────────────────────────────────────
const grens = Date.now() - BEWAARDAGEN * 24 * 60 * 60 * 1000;
let verwijderd = 0;

for (const bestand of fs.readdirSync(backupDir)) {
  if (!/^mcm2-.*\.dump$/.test(bestand)) continue;
  const volledig = path.join(backupDir, bestand);
  if (fs.statSync(volledig).mtimeMs < grens) {
    fs.unlinkSync(volledig);
    verwijderd++;
  }
}

const resterend = fs
  .readdirSync(backupDir)
  .filter((b) => /^mcm2-.*\.dump$/.test(b)).length;

console.log(
  `Bewaard: ${resterend} dump(s)${verwijderd ? `, ${verwijderd} ouder dan ${BEWAARDAGEN} dagen verwijderd` : ''}.`,
);

// Deze regel klopte tot 2026-07-30, toen BACKUP_DIR nog de projectmap was.
// Sindsdien schrijft backup-taak.cmd naar OneDrive en synct de dump weg. De
// oude tekst bleef staan en zette daarmee op het verkeerde been — vandaar
// dat hij nu de werkelijke bestemming benoemt.
if (backupDir.includes('OneDrive')) {
  console.log(
    `
Deze dump staat in OneDrive en synchroniseert dus weg van deze machine.
Wat hij NIET bewijst: dat de inhoud compleet is. Dat controleert
\`npm run backup:controle\` — zie docs/runbooks/backupcontrole.md.`,
  );
} else {
  console.log(
    `
LET OP: deze dump staat op dezelfde machine als waar hij gemaakt is.
Dat beschermt tegen "de database valt om", niet tegen "de laptop valt om".
Zorg voor een tweede locatie — zie ADR-011, risico-acceptatie Free Plan.`,
  );
}
