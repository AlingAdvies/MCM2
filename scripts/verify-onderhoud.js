#!/usr/bin/env node
'use strict';

/**
 * Controleert dat het onderhoudsproces zelf niet veroudert.
 *
 * ── Waarom dit bestaat ───────────────────────────────────────────────────────
 *
 * Op 2026-08-10 stond `docs/runbooks/backup-verwachting.json` op migratiestand
 * 0013 terwijl productie op 0025 draaide. Vijf tabellen — survey_review,
 * template_reviewer, response_note, omgeving, platform_admin — ontbraken in de
 * lijst. De dagelijkse backupcontrole meldde daardoor "Compleet: 18 tabellen"
 * en dat was waar tegen de lijst, en onwaar over de database.
 *
 * Dat is precies de faalvorm die de controle zelf hoort uit te bannen: een
 * geruststellende melding over een bewering die niemand meer nakeek. De spec
 * van de backupcontrole voorzag hem ook — "de verwachtingslijst veroudert" staat
 * er als geaccepteerd risico, gemitigeerd door een melding die pas afgaat als de
 * tabel al in de dump zit. Dat is te laat: tussen de migratie en de eerste dump
 * op de nieuwe stand zit een gat waarin de controle groen meldt over een
 * incomplete backup.
 *
 * Dit script sluit dat gat aan de andere kant: het faalt zodra de migratie
 * geschreven is, niet pas zodra de dump erop volgt.
 *
 * ── Waarom een poort en geen melding ─────────────────────────────────────────
 *
 * Overwogen: een maandelijks Telegram-bericht via scripts/telegram.js. Bewust
 * niet gedaan. Dat kanaal werkt omdat het zelden iets zegt; een tweede stroom
 * berichten over documentatie-onderhoud is precies de ruis waardoor je de
 * backupmelding leert negeren. Zie docs/runbooks/onderhoudskalender.md §4.
 *
 * Gebruik:
 *   npm run verify:onderhoud
 *
 * Draait mee in `npm run verify:volledig` (stap 0) en raakt geen database.
 */

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_DIR = path.resolve(__dirname, '..');
const RUNBOOK_DIR = path.join(PROJECT_DIR, 'docs', 'runbooks');
const INDEX = path.join(RUNBOOK_DIR, 'README.md');
const KALENDER = path.join(RUNBOOK_DIR, 'onderhoudskalender.md');
const VERWACHTING = path.join(RUNBOOK_DIR, 'backup-verwachting.json');
const DRIZZLE_DIR = path.join(PROJECT_DIR, 'drizzle');

// Een runbook dat klopt hoeft niet bijgewerkt te worden. Deze drempels vangen
// verval, niet stabiliteit — te streng en ze worden weggeklikt met een
// datumwijziging zonder inhoud, en dan is de poort erger dan niets.
const MAX_LEEFTIJD_RUNBOOK_MAANDEN = 6;
const MAX_LEEFTIJD_KALENDER_MAANDEN = 3;

// README.md is de index zelf; backup-verwachting.json is data, geen runbook.
const GEEN_RUNBOOK = new Set(['README.md']);

const bevindingen = [];

function meld(wat, waarom) {
  bevindingen.push({ wat, waarom });
}

/** Alle .md-bestanden in docs/runbooks, behalve de index zelf. */
function runbooks() {
  return fs
    .readdirSync(RUNBOOK_DIR)
    .filter((naam) => naam.endsWith('.md') && !GEEN_RUNBOOK.has(naam))
    .sort();
}

function leesKop(bestand) {
  const inhoud = fs.readFileSync(path.join(RUNBOOK_DIR, bestand), 'utf8');
  // Alleen de eerste 40 regels: de kop staat bovenaan, en verderop in het
  // document kan "**Eigenaar:**" in een voorbeeld of tabel voorkomen.
  const kop = inhoud.split(/\r?\n/).slice(0, 40).join('\n');

  const veld = (naam) => {
    const match = kop.match(new RegExp(`^\\*\\*${naam}:\\*\\*\\s*(.+)$`, 'm'));
    return match ? match[1].trim() : null;
  };

  return {
    type: veld('Type'),
    eigenaar: veld('Eigenaar'),
    bijgewerkt: veld('Laatste update'),
  };
}

/** Haalt de eerste ISO-datum uit een "Laatste update"-regel. */
function datumUit(tekst) {
  const match = (tekst || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const datum = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return Number.isNaN(datum.getTime()) ? null : datum;
}

function maandenGeleden(datum) {
  return (Date.now() - datum.getTime()) / (30.44 * 86_400_000);
}

// ── Controle 1 — staat elk runbook in de index, en andersom ─────────────────
//
// Een runbook dat niet in de index staat, vindt niemand. Dat was tot 2026-08-10
// de feitelijke situatie: zeven runbooks, geen index, en alleen CLAUDE.md wees
// naar één ervan.
function controleerIndex() {
  if (!fs.existsSync(INDEX)) {
    meld('docs/runbooks/README.md ontbreekt', 'Zonder index vindt niemand de runbooks.');
    return;
  }

  const index = fs.readFileSync(INDEX, 'utf8');

  for (const bestand of runbooks()) {
    if (!index.includes(`(${bestand})`)) {
      meld(
        `${bestand} staat niet in docs/runbooks/README.md`,
        'Voeg een regel toe in de index. Keert het runbook terug, zet het dan ook in de onderhoudskalender.',
      );
    }
  }

  // Andersom: een link naar een runbook dat niet meer bestaat.
  for (const match of index.matchAll(/\(([\w.-]+\.(?:md|json))\)/g)) {
    const doel = match[1];
    if (doel === 'README.md') continue;
    if (!fs.existsSync(path.join(RUNBOOK_DIR, doel))) {
      meld(
        `docs/runbooks/README.md verwijst naar ${doel}, dat niet bestaat`,
        'Verwijder de regel of herstel het bestand.',
      );
    }
  }
}

// ── Controle 2 — heeft elk runbook een bruikbare kop ────────────────────────
//
// Zonder eigenaar weet niemand wie het bijhoudt; zonder datum weet niemand of
// het nog klopt.
function controleerKoppen() {
  for (const bestand of runbooks()) {
    const kop = leesKop(bestand);
    const ontbreekt = [];

    if (!kop.type) ontbreekt.push('Type');
    if (!kop.eigenaar) ontbreekt.push('Eigenaar');
    if (!kop.bijgewerkt) ontbreekt.push('Laatste update');

    if (ontbreekt.length > 0) {
      meld(
        `${bestand} mist in de kop: ${ontbreekt.join(', ')}`,
        'Neem de kop over van een bestaand runbook — zie docs/runbooks/README.md, "Een nieuw runbook schrijven".',
      );
    }
  }
}

// ── Controle 3 — is een runbook verouderd ───────────────────────────────────
function controleerLeeftijd() {
  for (const bestand of runbooks()) {
    const kop = leesKop(bestand);
    if (!kop.bijgewerkt) continue; // al gemeld in controle 2

    const datum = datumUit(kop.bijgewerkt);

    if (!datum) {
      meld(
        `${bestand} heeft geen leesbare datum in "Laatste update": ${kop.bijgewerkt}`,
        'Schrijf de datum als JJJJ-MM-DD.',
      );
      continue;
    }

    const grens =
      bestand === 'onderhoudskalender.md'
        ? MAX_LEEFTIJD_KALENDER_MAANDEN
        : MAX_LEEFTIJD_RUNBOOK_MAANDEN;
    const maanden = maandenGeleden(datum);

    if (maanden > grens) {
      meld(
        `${bestand} is ${Math.floor(maanden)} maanden niet bijgewerkt (grens: ${grens})`,
        'Loop het door: klopt het nog? Werk de inhoud bij en dan pas de datum — een datumwijziging zonder inhoud maakt deze controle waardeloos.',
      );
    }
  }
}

// ── Controle 4 — loopt de backup-verwachtingslijst achter ───────────────────
//
// Dit is de belangrijkste controle van dit script, en de aanleiding ervoor.
// Zie de kop van dit bestand.
function controleerVerwachtingslijst() {
  if (!fs.existsSync(VERWACHTING)) {
    meld(
      'docs/runbooks/backup-verwachting.json ontbreekt',
      'Zonder die lijst kan de backupcontrole niet vaststellen of een dump compleet is.',
    );
    return;
  }

  let verwachting;
  try {
    verwachting = JSON.parse(fs.readFileSync(VERWACHTING, 'utf8'));
  } catch (err) {
    meld(`backup-verwachting.json is geen geldige JSON: ${err.message}`, 'Herstel het bestand.');
    return;
  }

  const migraties = fs
    .readdirSync(DRIZZLE_DIR)
    .filter((naam) => /^\d{4}_.*\.sql$/.test(naam))
    .sort();

  if (migraties.length === 0) {
    meld('Geen migraties gevonden in drizzle/', 'Klopt het pad nog?');
    return;
  }

  const hoogste = migraties[migraties.length - 1].replace(/\.sql$/, '');
  const genoteerd = verwachting.migratiestand || '(niet ingevuld)';

  if (genoteerd !== hoogste) {
    meld(
      `backup-verwachting.json staat op migratiestand '${genoteerd}', hoogste migratie is '${hoogste}'`,
      'Controleer of de nieuwe migraties tabellen toevoegen of hernoemen. Werk zo nodig "tabellen" bij, en daarna "migratiestand" en "bijgewerkt".\n' +
        '     Waarom dit blokkeert: staat een tabel niet in de lijst, dan meldt de dagelijkse controle "compleet" over een dump die hem mist.',
    );
  }

  // De lijst hoort gesorteerd en zonder dubbelen te zijn: dat maakt een diff
  // leesbaar en voorkomt dat een tabel er twee keer in sluipt bij handmatig
  // bijwerken.
  const tabellen = verwachting.tabellen || [];
  const gesorteerd = [...tabellen].sort();

  if (JSON.stringify(tabellen) !== JSON.stringify(gesorteerd)) {
    meld(
      'De tabellenlijst in backup-verwachting.json staat niet alfabetisch',
      'Sorteer hem — dat houdt een diff leesbaar bij het bijwerken.',
    );
  }

  const dubbel = tabellen.filter((naam, i) => tabellen.indexOf(naam) !== i);
  if (dubbel.length > 0) {
    meld(
      `backup-verwachting.json bevat dubbele tabellen: ${[...new Set(dubbel)].join(', ')}`,
      'Verwijder de dubbelen.',
    );
  }
}

// ── Controle 5 — bestaat de kalender, en noemt hij de geplande taken ────────
function controleerKalender() {
  if (!fs.existsSync(KALENDER)) {
    meld(
      'docs/runbooks/onderhoudskalender.md ontbreekt',
      'Dat is het document dat alle terugkerende taken bij elkaar houdt.',
    );
    return;
  }

  const kalender = fs.readFileSync(KALENDER, 'utf8');

  // De drie geplande taken staan in Windows Taakplanner. Verdwijnt er een uit
  // de kalender, dan is het overzicht niet meer compleet — en dan is er geen
  // enkele plek meer waar staat dat ze bestaan.
  for (const taak of [
    'MCM2 databasebackup',
    'MCM2 backupcontrole',
    'MCM2 backupcontrole volledig',
  ]) {
    if (!kalender.includes(taak)) {
      meld(
        `De onderhoudskalender noemt de geplande taak '${taak}' niet`,
        'Voeg hem toe aan §1, of verwijder de taak uit Taakplanner als hij niet meer hoort te draaien.',
      );
    }
  }
}

function main() {
  console.log('');
  console.log('Onderhoudscontrole — houdt het onderhoudsproces zelf actueel');
  console.log('(docs/runbooks/onderhoudskalender.md §4)');
  console.log('');

  controleerIndex();
  controleerKoppen();
  controleerLeeftijd();
  controleerVerwachtingslijst();
  controleerKalender();

  if (bevindingen.length === 0) {
    const aantal = runbooks().length;
    console.log(`GROEN — ${aantal} runbooks, alle geïndexeerd, geen verouderd.`);
    console.log('');
    console.log('Let op: dit bewijst dat de documenten kloppen, niet dat de');
    console.log('taken erin zijn uitgevoerd. Zie §6 van de kalender.');
    console.log('');
    return;
  }

  console.error(`ROOD — ${bevindingen.length} bevinding(en):`);
  console.error('');

  for (const [i, bevinding] of bevindingen.entries()) {
    console.error(`  ${i + 1}. ${bevinding.wat}`);
    console.error(`     → ${bevinding.waarom}`);
    console.error('');
  }

  process.exitCode = 1;
}

main();
