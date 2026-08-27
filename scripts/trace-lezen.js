#!/usr/bin/env node
// Leest een Playwright trace.zip uit en toont per netwerkverzoek methode, URL,
// statuscode, request-cookies en response-body.
//
// Aanleiding: op 2026-08-27 (platformbeheer-uitbreiding) werd een falende
// Playwright-test vier keer los onderzocht door trace.zip met de hand uit te
// pakken en met python3-eenregelaars door de JSON-lines te zoeken. Dat vond
// zowel een PATCH/PUT-methode-mismatch als een 401 na een sessiewissel — allebei
// onzichtbaar in de test-assertie zelf, want die zegt alleen *dat* het faalde.
// Dit script maakt van dat handwerk één commando.
//
// ── Waarom uitpakken via PowerShell en niet via een zip-library ─────────────
//
// Er staat geen zip-library in dit project (Playwright zelf zit in de
// zusterrepo MCM2-frontend, niet hier). In plaats van een nieuwe dependency
// toe te voegen voor iets dat maar af en toe nodig is, gebruikt dit script het
// systeemeigen `Expand-Archive` (Windows) of `unzip` (overige) om het
// trace-bestand naar een tijdelijke map uit te pakken, en leest daarna zelf
// alleen `0-trace.network` — de enige bestanden die dit script nodig heeft.
//
// Gebruik:
//   node scripts/trace-lezen.js <pad-naar-trace.zip>
//   node scripts/trace-lezen.js <pad-naar-trace.zip> --url platform

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const argv = process.argv.slice(2);
const tracePad = argv[0];
const urlFilterIdx = argv.indexOf('--url');
const urlFilter = urlFilterIdx !== -1 ? argv[urlFilterIdx + 1] : null;

if (!tracePad || !fs.existsSync(tracePad)) {
  console.error('Gebruik: node scripts/trace-lezen.js <pad-naar-trace.zip> [--url <deel-van-url>]');
  process.exit(1);
}

const werkmap = fs.mkdtempSync(path.join(os.tmpdir(), 'mcm2-trace-'));

try {
  if (process.platform === 'win32') {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${tracePad}' -DestinationPath '${werkmap}' -Force`,
    ]);
  } else {
    execFileSync('unzip', ['-q', tracePad, '-d', werkmap]);
  }
} catch (fout) {
  console.error('Uitpakken mislukt:', fout.message);
  process.exit(1);
}

const netwerkBestand = fs
  .readdirSync(werkmap)
  .find((naam) => naam.endsWith('.network'));

if (!netwerkBestand) {
  console.error(
    `Geen *.network-bestand gevonden in het uitgepakte trace-archief (${werkmap}). ` +
      'Is dit een Playwright trace.zip?',
  );
  process.exit(1);
}

const regels = fs
  .readFileSync(path.join(werkmap, netwerkBestand), 'utf8')
  .split('\n')
  .filter(Boolean);

let aantalGetoond = 0;

for (const regel of regels) {
  let event;
  try {
    event = JSON.parse(regel);
  } catch {
    continue;
  }

  if (event.type !== 'resource-snapshot') continue;

  const request = event.snapshot?.request;
  const response = event.snapshot?.response;
  if (!request) continue;

  const url = request.url ?? '';
  if (urlFilter && !url.includes(urlFilter)) continue;

  const methode = request.method ?? '?';
  const status = response?.status ?? '(geen response)';
  const cookies =
    (request.headers ?? []).find((h) => h.name.toLowerCase() === 'cookie')
      ?.value ?? '(geen cookie-header)';

  console.log('─'.repeat(70));
  console.log(`${methode} ${url}`);
  console.log(`  status:  ${status}`);
  console.log(`  cookies: ${cookies}`);

  const body = response?.content?.text;
  if (body) {
    const kort = body.length > 2000 ? body.slice(0, 2000) + ' …(afgekapt)' : body;
    console.log(`  body:    ${kort}`);
  }

  aantalGetoond += 1;
}

if (aantalGetoond === 0) {
  console.log(
    urlFilter
      ? `Geen verzoeken gevonden die '${urlFilter}' in de URL bevatten.`
      : 'Geen netwerkverzoeken gevonden in deze trace.',
  );
}

fs.rmSync(werkmap, { recursive: true, force: true });
