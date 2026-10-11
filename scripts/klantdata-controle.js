#!/usr/bin/env node
// Weigert klantdata in de repo.
//
// Aanleiding: op 2026-10-11 bleek docs/Transdev_Sample_Upload.csv — echte
// Transdev-leveranciers met 22 contact-e-mailadressen — sinds 28-08 in deze
// PUBLIEKE repo te staan. .gitignore weert zulke bestanden sinds PR #236, maar
// .gitignore is een vangnet dat met één `git add -f` of één vergeten regel
// open staat. Deze controle draait in CI en maakt zo'n PR rood.
//
// Klantbestanden horen in `OneDrive - Aling Advies\MCM2-klantdata\<tenant>\`,
// nooit in de projectmap. Zie CLAUDE.md, "Klantdata".
//
// ── Twee regels ──────────────────────────────────────────────────────────────
//
// 1. Geen data- of documentbestanden (csv, Excel, Word, pdf, zip, mail) in git,
//    behalve de verzonnen voorbeelddata in db/seeds/ en de expliciet genoemde
//    uitzonderingen hieronder.
// 2. In die toegestane databestanden alleen e-mailadressen op een fictief
//    domein (…voorbeeld.nl, example.*, .test). Een echt bedrijfsdomein met een
//    persoonsnaam ervoor is niet van echt te onderscheiden — en dus niet te
//    verdedigen als het ooit wél echt blijkt.
//
// Gebruik: npm run check:klantdata

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const VERBODEN_EXTENSIE = /\.(csv|xls|xlsx|xlsm|doc|docx|pdf|zip|msg|eml)$/i;

/** Voorbeelddata: mag, maar alleen met fictieve e-mailadressen (regel 2). */
const VOORBEELDMAP = 'db/seeds/';

/**
 * Bewuste uitzonderingen op regel 1, elk met reden. Een nieuwe uitzondering
 * is een besluit, geen gemak: liever het bestand als .md opslaan.
 */
const UITZONDERINGEN = new Map([
  [
    'docs/frontend-veld-cross-reference.csv',
    'koppeling van veldnamen tussen scherm, database en Coupa; geen klantgegevens',
  ],
]);

const EMAIL =
  /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;

function isFictiefDomein(domein) {
  const d = domein.toLowerCase();
  return (
    d === 'voorbeeld.nl' ||
    d.endsWith('.voorbeeld.nl') ||
    /(^|\.)example\.(com|org|net|nl)$/.test(d) ||
    /\.(test|example|invalid|localhost)$/.test(d)
  );
}

function getrackteBestanden() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

function controleer() {
  const fouten = [];

  for (const bestand of getrackteBestanden()) {
    const inVoorbeeldmap = bestand.startsWith(VOORBEELDMAP);
    const uitzondering = UITZONDERINGEN.has(bestand);

    if (VERBODEN_EXTENSIE.test(bestand) && !inVoorbeeldmap && !uitzondering) {
      fouten.push(
        `${bestand}\n    data- of documentbestand buiten ${VOORBEELDMAP}`,
      );
      continue;
    }

    if (!inVoorbeeldmap && !uitzondering) continue;
    // Een bestand dat lokaal verwijderd is maar nog gevolgd wordt, valt buiten
    // deze regel: wat niet bestaat kan geen adres bevatten.
    if (!fs.existsSync(bestand)) continue;

    const inhoud = fs.readFileSync(bestand, 'utf8');
    const echt = new Set();
    for (const treffer of inhoud.matchAll(EMAIL)) {
      if (!isFictiefDomein(treffer[1])) echt.add(treffer[0]);
    }
    if (echt.size > 0) {
      const voorbeeld = [...echt].slice(0, 3).join(', ');
      fouten.push(
        `${bestand}\n    ${echt.size} e-mailadres(sen) op een niet-fictief domein, o.a. ${voorbeeld}`,
      );
    }
  }

  return fouten;
}

const fouten = controleer();

if (fouten.length > 0) {
  console.error('KLANTDATA IN DE REPO — deze repo is publiek.\n');
  for (const fout of fouten) console.error(`  ${fout}`);
  console.error(
    '\n  Klantbestanden horen in OneDrive - Aling Advies\\MCM2-klantdata\\<tenant>\\.\n' +
      '  Voorbeelddata in db/seeds/ gebruikt alleen adressen op …voorbeeld.nl.\n' +
      '  Zie CLAUDE.md, "Klantdata".',
  );
  process.exit(1);
}

console.log('Geen klantdata in de repo gevonden.');
