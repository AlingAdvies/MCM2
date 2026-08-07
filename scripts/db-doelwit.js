// Benoemt waar een script naartoe praat, vóórdat het iets doet.
//
// Aanleiding (Issue #86): `npm run migrate:deploy` draaide tegen Supabase
// productie terwijl de bedoeling een wegwerpcontainer was. Het script meldde
// "Migraties draaien als rol 'clm_migrator'" en daarna "Migraties voltooid" —
// beide waar, en geen van beide verklapte dat het de verkeerde database was.
// Die rol heet lokaal precies zo.
//
// Drie dingen kwamen samen: dotenv vult stilzwijgend aan wat je op de
// commandoregel niet noemt, het script noemde de rol maar niet het doelwit, en
// DATABASE_URL en MIGRATION_DATABASE_URL lijken genoeg op elkaar om "ik heb de
// database omgezet" een halve waarheid te maken.
//
// Dit bestand lost het eerste en tweede op. Het derde blijft: dotenv-gedrag
// veranderen zou zijn eigen verrassingen opleveren (Issue #86, voorstel 3).
//
// ── Uitgebreid op 2026-08-07: de hostcontrole was niet genoeg ────────────────
//
// De lokaal/niet-lokaal-toets hierboven vangt Supabase af, maar binnen
// 'localhost' onderscheidde hij niets. Daardoor wisten de e2e-suites de
// demo-database (poort 55450) leeg terwijl een wegwerpcontainer (55440) bedoeld
// was: allebei localhost, allebei goedgekeurd.
//
// `eisWegwerpdatabase()` hieronder leest daarom `clm.omgeving` (migratie 0019).
// Die markering zit ín de database en niet in een poortnummer, containerlabel
// of omgevingsvariabele — die zitten ernáást en kloppen niet meer zodra iets
// verhuist.

// Hosts die als "op deze machine" gelden. Alles daarbuiten is een echte
// database die iemand anders ook gebruikt, ook als het geen productie is.
const LOKALE_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  'host.docker.internal',
]);

/**
 * Ontleedt een Postgres-URL tot iets dat veilig te tonen is.
 *
 * Geeft nooit het wachtwoord terug — ook niet in `beschrijving`. Een script dat
 * zijn doelwit afdrukt komt in CI-logs, in terminalhistorie en in
 * schermafdrukken terecht (MCM2-CLAUDE.md §6).
 *
 * Een onleesbare URL is geen reden om te stoppen: dan is `leesbaar` false en
 * blijft het aan de aanroeper om te beslissen. De URL zelf komt daarbij niet in
 * de melding, want juist een kapotte URL bevat vaak een wachtwoord dat een
 * teken mist.
 */
function ontleed(url) {
  if (!url) {
    return { leesbaar: false, lokaal: false, beschrijving: '(geen URL gezet)' };
  }

  let ontleed;
  try {
    ontleed = new URL(url);
  } catch {
    return {
      leesbaar: false,
      lokaal: false,
      beschrijving: '(onleesbare URL)',
    };
  }

  const host = ontleed.hostname;
  const poort = ontleed.port || '5432';
  // pathname is '/postgres' → de naam zonder schuine streep.
  const database = ontleed.pathname.replace(/^\//, '') || '(geen naam)';
  const rol = ontleed.username || '(geen rol)';

  return {
    leesbaar: true,
    host,
    poort,
    database,
    rol,
    lokaal: LOKALE_HOSTS.has(host),
    beschrijving: `${host}:${poort}/${database}`,
  };
}

/**
 * Drukt af waar dit script naartoe praat.
 *
 * Bewust vóór de eerste schrijfactie aan te roepen en niet erna: een melding
 * achteraf vertelt je welke database je zojuist hebt gewijzigd, en dat is te
 * laat om er nog iets aan te doen.
 */
function meldDoelwit(url, wat) {
  const d = ontleed(url);
  const plek = d.lokaal ? 'lokaal' : 'NIET-LOKAAL';
  console.log(`${wat}: ${d.beschrijving} als rol '${d.rol}' [${plek}]`);
  return d;
}

/**
 * Weigert door te gaan tegen een niet-lokaal doelwit zonder expliciete
 * toestemming.
 *
 * Bewust een vlag en geen interactieve vraag. Een vraag werkt niet in CI, niet
 * in `verify:volledig` en niet in een geplande taak — daar hangt hij, of erger:
 * hij leest een lege stdin als "ja". Een vlag is zichtbaar in de
 * terminalhistorie en in de pipeline, en dat is precies de bedoeling: je moet
 * later kunnen terugzien dat iemand dit bewust deed.
 *
 * CI blijft hierdoor groen zonder aanpassing: die draait tegen localhost.
 * Geverifieerd voor alle geautomatiseerde aanroepers (demo-omgeving.js,
 * verify-volledig.js, provider-migratietest.js) — die zetten hun eigen
 * MIGRATION_DATABASE_URL naar localhost.
 */
function eisToestemmingBuitenLokaal(url, { wat, vlag = '--extern' }) {
  const d = ontleed(url);

  if (!d.leesbaar) {
    console.error(
      `\n${wat} kan niet doorgaan: de database-URL is ${d.beschrijving}.\n` +
        'Controleer de betreffende variabele in .env.\n',
    );
    process.exitCode = 1;
    return false;
  }

  if (d.lokaal) return true;

  const toegestaan =
    process.argv.includes(vlag) || process.env.MCM2_EXTERNE_DB === 'ja';

  if (toegestaan) {
    console.log(
      `Doelwit is niet-lokaal, maar ${vlag} is meegegeven. Doorgaan.\n`,
    );
    return true;
  }

  console.error(
    `\n${wat} GESTOPT — het doelwit is niet lokaal.\n\n` +
      `  Doel: ${d.beschrijving} (rol '${d.rol}')\n\n` +
      'Dit kan de productiedatabase zijn. Was dat niet de bedoeling, dan staat\n' +
      'de verkeerde waarde in .env: dotenv vult aan wat je op de commandoregel\n' +
      'niet noemt.\n\n' +
      `Is het wél de bedoeling, geef dan ${vlag} mee:\n` +
      `  npm run <script> -- ${vlag}\n`,
  );
  process.exitCode = 1;
  return false;
}

/**
 * Weigert door te gaan tegen een database die niet als wegwerp is gemarkeerd.
 *
 * Voor scripts die gegevens verwijderen of overschrijven. Niet voor scripts die
 * alleen toevoegen — daar is de hostcontrole hierboven genoeg, en zou deze eis
 * betekenen dat je productie niet meer kunt seeden.
 *
 * ── Waarom dit náást eisToestemmingBuitenLokaal staat ───────────────────────
 *
 * Die kijkt naar de hostnaam en kent 'localhost' als veilig. Deze kijkt naar wat
 * de database over zichzelf zegt. De demo-database is lokaal én beschermd:
 * alleen de tweede controle houdt hem tegen.
 *
 * ── Waarom een ontbrekende tabel ook faalt ──────────────────────────────────
 *
 * Een database zonder `clm.omgeving` heeft migratie 0019 niet gehad. Dat kan
 * een oude wegwerpcontainer zijn, maar net zo goed een kopie van productie van
 * vóór die migratie. Doorgaan zou betekenen dat de bescherming zwijgt op
 * precies het moment dat je hem nodig hebt.
 *
 * @param {string} url
 * @param {{ wat: string, vlag?: string }} opties
 * @returns {Promise<boolean>} false wanneer het script moet stoppen.
 */
async function eisWegwerpdatabase(url, { wat, vlag = '--ook-beschermd' }) {
  const d = ontleed(url);

  // Bewust hier vereist en niet bovenaan het bestand: db-doelwit.js wordt ook
  // geladen door scripts die geen databaseverbinding maken, en die hoeven pg
  // niet te laden.
  const { Client } = require('pg');
  const client = new Client({ connectionString: url });

  let soort = null;
  let reden = null;

  try {
    await client.connect();
    const { rows } = await client.query('SELECT soort FROM clm.omgeving LIMIT 1');
    soort = rows[0]?.soort ?? null;
    if (!soort) reden = 'clm.omgeving is leeg';
  } catch (err) {
    const melding = err.message ?? String(err);

    reden = /relation .*omgeving.* does not exist/i.test(melding)
      ? 'clm.omgeving bestaat niet — migratie 0019 is niet toegepast'
      : `verbinden mislukte: ${melding}`;
  } finally {
    await client.end().catch(() => {});
  }

  if (soort === 'wegwerp') return true;

  // De uitweg staat ná de controle, niet ervoor: zo staat er altijd in de
  // uitvoer wát er is overruled, ook als iemand de vlag gewoontegetrouw
  // meegeeft.
  const toegestaan =
    process.argv.includes(vlag) || process.env.MCM2_OOK_BESCHERMD === 'ja';

  const status = soort ? `gemarkeerd als '${soort}'` : reden;

  if (toegestaan) {
    console.log(
      `LET OP: doelwit is ${status}, maar ${vlag} is meegegeven. Doorgaan.\n`,
    );
    return true;
  }

  console.error(
    `\n${wat} GESTOPT — dit is geen wegwerpdatabase.\n\n` +
      `  Doel:   ${d.beschrijving}\n` +
      `  Status: ${status}\n\n` +
      'Dit script verwijdert of overschrijft gegevens. Op een database die niet\n' +
      'als wegwerp is gemarkeerd, is dat gegevensverlies.\n\n' +
      'Op 2026-08-07 gebeurde dat met de demo-database: de demo-tenant verdween\n' +
      'en er bleven 400 testleveranciers achter.\n\n' +
      'Is dit wél een wegwerpdatabase:\n' +
      '  node scripts/markeer-wegwerp.js "waarvoor"\n\n' +
      `Alleen als je zeker weet wat je doet: ${vlag}\n`,
  );
  process.exitCode = 1;
  return false;
}

module.exports = {
  ontleed,
  meldDoelwit,
  eisToestemmingBuitenLokaal,
  eisWegwerpdatabase,
};
