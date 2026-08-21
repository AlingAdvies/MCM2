#!/usr/bin/env node
'use strict';

/**
 * Genereert `docs/STATUSBORD.md`: een compact overzicht van de openstaande
 * GitHub issues, gegroepeerd per thema en per prioriteit.
 *
 * ── Waarom dit bestaat ───────────────────────────────────────────────────────
 *
 * `docs/STATUS.md` is een chronologisch sessiejournaal (2600+ regels) — goed
 * om te lezen wat er gebeurd is, niet om in tien seconden te zien wat er nu
 * openstaat. GitHub Issues heeft de details (acceptatiecriteria, discussie),
 * maar geen compact totaalbeeld. Dit script overbrugt dat: het genereert een
 * kort document, geen nieuwe bron van waarheid. De issues zelf blijven
 * leidend — dit bestand is een afgeleide weergave.
 *
 * ── Waarom volledig herschrijven, niet aanvullen ────────────────────────────
 *
 * Een script dat een bestaand bestand probeert bij te werken, kan uit de pas
 * gaan lopen met de werkelijke issue-stand (een gesloten issue die niet
 * verwijderd wordt, een handmatige aanpassing die overschreven wordt zonder
 * dat iemand het merkt). Een schone regeneratie bij elke run voorkomt beide:
 * het bestand is altijd exact wat de huidige issue-stand zegt, nooit meer en
 * nooit minder.
 *
 * ── Thema's ──────────────────────────────────────────────────────────────────
 *
 * Elk issue hoort een `thema:*`-label te hebben. Zonder zo'n label zou dit
 * script moeten raden op basis van de titel, en dat is broos — een titel kan
 * over meerdere thema's tegelijk gaan. Issues zonder thema-label komen in een
 * aparte "niet ingedeeld"-groep, zichtbaar in plaats van stilzwijgend
 * genegeerd of verkeerd geraden.
 *
 * ── Gebruik ──────────────────────────────────────────────────────────────────
 *
 *   npm run statusbord              # herschrijft docs/STATUSBORD.md
 *
 * Vereist de GitHub CLI (`gh`), ingelogd met leestoegang tot deze repository.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO = 'AlingAdvies/MCM2';
const UITVOERPAD = path.join(__dirname, '..', 'docs', 'STATUSBORD.md');

// Vaste volgorde en labels — bepaalt zowel de sortering in het document als
// welke labels als "thema" herkend worden. Een nieuw thema-label op GitHub
// verschijnt pas hier als het aan deze lijst wordt toegevoegd; dat is bewust
// een handmatige stap, geen automatische ontdekking, zodat de volgorde in het
// document een keuze blijft en niet de willekeurige volgorde van labels.
const THEMAS = [
  { label: 'thema:product-kern', titel: 'Product — vragenlijst, leveranciers, contracten, meldingen' },
  { label: 'thema:beheermenu', titel: 'Beheermenu' },
  { label: 'thema:aws-productie', titel: 'AWS / productie-infrastructuur' },
  { label: 'thema:backup-en-herstel', titel: 'Backup en herstel' },
  { label: 'thema:otap-en-ci', titel: 'OTAP en CI/CD' },
  { label: 'thema:vragenlijst-en-tokens', titel: 'Toegangsmechanisme (tokens, guards)' },
  { label: 'thema:database-en-rls', titel: 'Database, migraties, RLS' },
  { label: 'thema:overig', titel: 'Overig' },
];

const PRIORITEIT_VOLGORDE = [
  'priority:p0',
  'priority:before-pilot',
  'priority:before-production',
  'priority:later',
];

const PRIORITEIT_LABEL = {
  'priority:p0': 'P0 — voor elke volgende regel productiecode',
  'priority:before-pilot': 'Vóór de pilot',
  'priority:before-production': 'Vóór bredere productie',
  'priority:later': 'Later — bewust uitgesteld',
  geen: 'Geen prioriteitslabel',
};

function haalOpenIssuesOp() {
  const uitvoer = execFileSync(
    'gh',
    [
      'issue',
      'list',
      '--repo',
      REPO,
      '--state',
      'open',
      '--limit',
      '200',
      '--json',
      'number,title,labels,url',
    ],
    { encoding: 'utf8' },
  );

  return JSON.parse(uitvoer).map((issue) => ({
    nummer: issue.number,
    titel: issue.title,
    url: issue.url,
    labels: issue.labels.map((l) => l.name),
  }));
}

function prioriteitVan(issue) {
  return PRIORITEIT_VOLGORDE.find((p) => issue.labels.includes(p)) ?? 'geen';
}

function themaVan(issue) {
  return THEMAS.find((t) => issue.labels.includes(t.label)) ?? null;
}

function groepeer(issues) {
  const perThema = new Map(THEMAS.map((t) => [t.label, []]));
  const nietIngedeeld = [];

  for (const issue of issues) {
    const thema = themaVan(issue);
    if (thema) {
      perThema.get(thema.label).push(issue);
    } else {
      nietIngedeeld.push(issue);
    }
  }

  return { perThema, nietIngedeeld };
}

function renderIssueRegel(issue) {
  const prioriteit = prioriteitVan(issue);
  const badge = prioriteit === 'geen' ? '' : ` \`${prioriteit.replace('priority:', '')}\``;
  return `- [#${issue.nummer}](${issue.url})${badge} — ${issue.titel}`;
}

function renderThema(titel, issues) {
  if (issues.length === 0) return '';

  // Binnen een thema: P0 eerst, dan before-pilot, dan before-production, dan
  // later, dan issues zonder prioriteitslabel — dezelfde volgorde als de
  // labels zelf uitdrukken.
  const gesorteerd = [...issues].sort((a, b) => {
    const ia = PRIORITEIT_VOLGORDE.indexOf(prioriteitVan(a));
    const ib = PRIORITEIT_VOLGORDE.indexOf(prioriteitVan(b));
    const posA = ia === -1 ? PRIORITEIT_VOLGORDE.length : ia;
    const posB = ib === -1 ? PRIORITEIT_VOLGORDE.length : ib;
    return posA - posB || a.nummer - b.nummer;
  });

  return [
    `### ${titel} (${issues.length})`,
    '',
    ...gesorteerd.map(renderIssueRegel),
    '',
  ].join('\n');
}

function renderPrioriteitOverzicht(issues) {
  const regels = ['## Op prioriteit, over alle thema\'s heen', ''];

  for (const prioriteit of PRIORITEIT_VOLGORDE) {
    const inDezePrioriteit = issues.filter((i) => prioriteitVan(i) === prioriteit);
    regels.push(`**${PRIORITEIT_LABEL[prioriteit]}** — ${inDezePrioriteit.length} open`);
  }

  return regels.join('\n');
}

function main() {
  let issues;

  try {
    issues = haalOpenIssuesOp();
  } catch (fout) {
    console.error(
      `\nKon de issue-lijst niet ophalen: ${fout.message}\n` +
        'Is de GitHub CLI (`gh`) geïnstalleerd en ingelogd?\n',
    );
    process.exit(1);
  }

  const { perThema, nietIngedeeld } = groepeer(issues);
  const nu = new Date().toISOString().slice(0, 16).replace('T', ' ');

  const secties = THEMAS.map((thema) =>
    renderThema(thema.titel, perThema.get(thema.label)),
  ).filter(Boolean);

  const inhoud = [
    '# Statusbord — compact overzicht van openstaande issues',
    '',
    '**Automatisch gegenereerd. Niet handmatig bewerken** — wijzigingen gaan',
    'verloren bij de volgende run. Pas in plaats daarvan het issue of het label',
    'aan op GitHub, en draai `npm run statusbord` opnieuw (of wacht op de',
    'geplande workflow).',
    '',
    `**Gegenereerd:** ${nu} UTC · **Bron:** \`gh issue list --repo ${REPO}\``,
    '',
    'Dit is geen vervanging van de issues zelf (details, acceptatiecriteria,',
    'discussie staan daar) en geen vervanging van `docs/STATUS.md` (het',
    'chronologische sessiejournaal). Dit is het compacte tussenniveau: in één',
    'oogopslag zien wat er per thema openstaat, gesorteerd op prioriteit.',
    '',
    '---',
    '',
    renderPrioriteitOverzicht(issues),
    '',
    '---',
    '',
    '## Per thema',
    '',
    ...secties,
  ];

  if (nietIngedeeld.length > 0) {
    inhoud.push(
      `### ⚠ Niet ingedeeld (${nietIngedeeld.length})`,
      '',
      'Deze issues missen een `thema:*`-label. Voeg er een toe op GitHub, of',
      'maak een nieuw thema aan in `scripts/statusbord.js` als geen van de',
      'bestaande thema\'s past.',
      '',
      ...nietIngedeeld.map(renderIssueRegel),
      '',
    );
  }

  inhoud.push(
    '---',
    '',
    `**Totaal open:** ${issues.length}`,
    '',
  );

  fs.writeFileSync(UITVOERPAD, inhoud.join('\n'));

  console.log(`Statusbord geschreven: ${issues.length} open issues, ${nietIngedeeld.length} niet ingedeeld.`);

  if (nietIngedeeld.length > 0) {
    console.log('Niet ingedeeld: ' + nietIngedeeld.map((i) => `#${i.nummer}`).join(', '));
  }
}

main();
