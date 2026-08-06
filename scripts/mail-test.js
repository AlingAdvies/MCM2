#!/usr/bin/env node
// Verstuurt één echte testmail via het mailkanaal.
//
// ── Waarom dit script bestaat ───────────────────────────────────────────────
//
// De unit-tests bootsen de Resend-SDK na. Ze bewijzen dat onze vertaling van
// "wat Resend teruggeeft" naar "wat de aanroeper moet weten" klopt — maar niet
// dat er werkelijk een mail aankomt. Daarvoor is een geverifieerd domein en een
// echte verzending nodig.
//
// Dat is tegenproef 1 uit het mailkanaal-ontwerp §7, en het is dezelfde
// gedachte als `npm run backup:controle:test`: de melding zelf een keer
// aantoonbaar laten werken, vóór het moment waarop je hem nodig hebt.
//
// ── Gebruik ─────────────────────────────────────────────────────────────────
//
//   node scripts/mail-test.js <ontvanger>
//
// Zonder RESEND_API_KEY in .env verstuurt dit niets en zegt het dat ook —
// zelfde no-op-gedrag als scripts/telegram.js.
//
// Zie docs/superpowers/specs/2026-08-06-mailkanaal.md
require('dotenv').config();

const ontvanger = process.argv[2];

if (!ontvanger) {
  console.error('Gebruik: node scripts/mail-test.js <ontvanger@example.com>');
  process.exit(1);
}

// De TypeScript-bron via de build. Dit script draait bewust tegen dezelfde code
// die de applicatie gebruikt: een eigen Resend-aanroep hier zou iets anders
// testen dan wat er in productie gebeurt.
const { leesMailConfig } = require('../dist/mail/mail.config');
const { ResendMailKanaal } = require('../dist/mail/resend-mail-kanaal');
const { LogMailKanaal } = require('../dist/mail/log-mail-kanaal');

async function main() {
  const config = leesMailConfig();

  const kanaal = config ? new ResendMailKanaal(config) : new LogMailKanaal();

  if (!config) {
    console.log('Geen RESEND_API_KEY — er wordt niets verstuurd (logkanaal).\n');
  } else {
    console.log(`Verstuurt via Resend vanaf ${config.afzenderAdres}.\n`);
  }

  const stempel = new Date().toLocaleString('nl-NL');

  const resultaat = await kanaal.verstuur({
    aan: ontvanger,
    afzenderNaam: 'Demo-organisatie via MCM2',
    antwoordAan: 'contractmanagement@demo.nl',
    onderwerp: `MCM2 testbericht — ${stempel}`,
    tekst:
      `Dit is een testbericht van het MCM2-mailkanaal.\n\n` +
      `Als je dit leest, werkt de keten: verstuurd via Resend, ` +
      `afgeleverd op ${ontvanger}.\n\n` +
      `Controleer in dit bericht:\n` +
      `  - de afzender toont "Demo-organisatie via MCM2"\n` +
      `  - beantwoorden gaat naar contractmanagement@demo.nl\n` +
      `  - het bericht staat niet in de spammap\n\n` +
      `Verstuurd op ${stempel}.\n`,
  });

  console.log(`Geslaagd — bericht-id ${resultaat.providerId}`);
  console.log(`\nControleer de inbox van ${ontvanger}.`);
  console.log('Niets aangekomen? Kijk in Resend onder Emails wat de status is.');
}

main().catch((err) => {
  console.error(`\nMISLUKT: ${err.message}`);
  if (err.tijdelijk === false) {
    console.error('Dit is een blijvende fout — opnieuw proberen helpt niet.');
  }
  process.exitCode = 1;
});
