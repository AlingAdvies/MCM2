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

module.exports = { ontleed, meldDoelwit, eisToestemmingBuitenLokaal };
