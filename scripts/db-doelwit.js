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
 * Weigert door te gaan tegen een database die zichzelf `beschermd` noemt.
 *
 * ── Waarom dit `eisToestemmingBuitenLokaal` vervangt (stap 5, 2026-08-11) ───
 *
 * Die oude rem kende maar twee soorten: 'localhost' en 'de rest'. Dat werkte
 * zolang `.env` naar productie wees — alles buiten deze machine was dan per
 * definitie gevaarlijk.
 *
 * Sinds stap 5 wijst `.env` naar **staging**, en staging staat óók bij Supabase.
 * De oude rem zou dus bij élk stagingcommando afgaan. Dan typ je `--extern`
 * erbij omdat er anders niets werkt, na twee weken is het een gewoonte, en dan
 * typ je hem ook op de dag dat je per ongeluk naar productie wijst.
 *
 * **Een waarschuwing die altijd afgaat, is geen waarschuwing meer.** Dat is
 * dezelfde les als bij de backupmelding die niemand las (2026-08-04).
 *
 * Deze rem vraagt daarom aan de database zelf wat hij is. `clm.omgeving`
 * (migratie 0019) zegt `wegwerp` of `beschermd`, en die markering zit ín de
 * database — niet in een hostnaam, poortnummer of variabele die ernaast staat
 * en niet meer klopt zodra iets verhuist.
 *
 * Gevolg: de vlag gaat alleen nog af bij een beschermde database. Precies waar
 * hij voor bedoeld is, en dus houdt hij zijn betekenis.
 *
 * ── Waarom `beschermd` de standaard blijft ─────────────────────────────────
 *
 * Een database die zich niet meldt, of waarvan `clm.omgeving` niet te lezen is,
 * wordt behandeld als productie. Andersom zou juist de database die niemand
 * heeft ingericht — de nieuwe, de vergetene — vogelvrij zijn.
 *
 * ── De naam is bewust veranderd ────────────────────────────────────────────
 *
 * Deze functie is `async`, de oude was synchroon. Zou hij hetzelfde heten, dan
 * blijft `if (!eisToestemmingBuitenLokaal(url, …))` compileren én draaien — met
 * een Promise als uitkomst, en die is altijd waarheidsachtig. De rem zou dan
 * stilzwijgend nooit meer afgaan: een beveiliging die verdwijnt zonder één
 * foutmelding.
 *
 * Met een nieuwe naam faalt een vergeten aanroeper meteen en zichtbaar.
 *
 * @param {string} url
 * @param {{ wat: string, vlag?: string }} opties
 * @returns {Promise<boolean>} false wanneer het script moet stoppen.
 */
async function eisOnbeschermdeDatabase(url, { wat, vlag = '--extern' }) {
  const d = ontleed(url);

  if (!d.leesbaar) {
    console.error(
      `\n${wat} kan niet doorgaan: de database-URL is ${d.beschrijving}.\n` +
        'Controleer de betreffende variabele in .env.\n',
    );
    process.exitCode = 1;
    return false;
  }

  const { soort, reden } = await leesOmgevingssoort(url);

  if (soort === 'wegwerp') return true;

  // ── Een verse lokale database mag door ────────────────────────────────────
  //
  // `clm.omgeving` ontstaat pas bij migratie 0019. Een lege container die je
  // net hebt opgezet heeft die tabel dus nog niet, en zou zonder deze
  // uitzondering blokkeren op precies het commando dat hem moet vullen —
  // `migrate.js`. Dan geef je `--extern` mee bij elke nieuwe wegwerpcontainer,
  // en juist die gewoonte wil stap 5 voorkomen.
  //
  // Het geldt alleen op deze machine. Een NIET-lokale database zonder
  // markering blijft geblokkeerd: dat kan een kopie van productie zijn van
  // vóór 0019, en dan hoort de bescherming te zwijgen noch door te laten.
  //
  // Gevonden bij het beproeven op 2026-08-11: `verify:volledig` en CI zetten
  // allebei een verse container op, en die zouden hierop zijn vastgelopen.
  if (d.lokaal && soort === null) {
    console.log(
      `${d.beschrijving} is nog niet gemarkeerd (${reden}), maar staat lokaal. Doorgaan.\n`,
    );
    return true;
  }

  // De uitweg staat ná de controle, zodat er altijd in de uitvoer staat wát er
  // is overruled — ook als iemand de vlag gewoontegetrouw meegeeft.
  const toegestaan =
    process.argv.includes(vlag) || process.env.MCM2_EXTERNE_DB === 'ja';

  const status = soort ? `gemarkeerd als '${soort}'` : `niet leesbaar (${reden})`;

  if (toegestaan) {
    console.log(
      `LET OP: ${d.beschrijving} is ${status}, maar ${vlag} is meegegeven. Doorgaan.\n`,
    );
    return true;
  }

  console.error(
    `\n${wat} GESTOPT — deze database is beschermd.\n\n` +
      `  Doel:   ${d.beschrijving} (rol '${d.rol}')\n` +
      `  Status: ${status}\n\n` +
      'Sinds stap 5 wijst .env naar STAGING. Komt dit commando toch bij een\n' +
      'beschermde database uit, dan is er een variabele overschreven of staat\n' +
      'er een ander adres in .env dan je denkt.\n\n' +
      'Kijk waar het heen gaat — de regel hierboven noemt host en database.\n\n' +
      `Is het wél de bedoeling, geef dan ${vlag} mee:\n` +
      `  npm run <script> -- ${vlag}\n`,
  );
  process.exitCode = 1;
  return false;
}

/**
 * Leest `clm.omgeving`. Eén plek, zodat beide remmen hetzelfde vaststellen.
 */
async function leesOmgevingssoort(url) {
  // Bewust hier vereist: db-doelwit.js wordt ook geladen door scripts die geen
  // databaseverbinding maken.
  const { Client } = require('pg');
  const client = new Client({
    connectionString: url,
    // Supabase en RDS eisen TLS; de pooler biedt een certificaat aan dat niet
    // in de standaardketen van Node zit. Zonder dit faalt élke controle tegen
    // staging met een verbindingsfout, en dan lijkt de database beschermd
    // terwijl hij alleen onbereikbaar is.
    ssl: /supabase|amazonaws|neon/.test(url)
      ? { rejectUnauthorized: false }
      : undefined,
    connectionTimeoutMillis: 30_000,
  });

  try {
    await client.connect();
    const { rows } = await client.query(
      'SELECT soort FROM clm.omgeving LIMIT 1',
    );
    const soort = rows[0]?.soort ?? null;
    return { soort, reden: soort ? null : 'clm.omgeving is leeg' };
  } catch (err) {
    const melding = err.message ?? String(err);

    return {
      soort: null,
      reden: /relation .*omgeving.* does not exist/i.test(melding)
        ? 'clm.omgeving bestaat niet — migratie 0019 is niet toegepast'
        : `verbinden mislukte: ${melding}`,
    };
  } finally {
    await client.end().catch(() => {});
  }
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

  // Dezelfde leesfunctie als `eisOnbeschermdeDatabase`. Twee kopieën zouden
  // kunnen gaan afwijken in wat ze als "onleesbaar" behandelen, en dan
  // beschermen de twee remmen tegen verschillende dingen.
  const { soort, reden } = await leesOmgevingssoort(url);

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
  leesOmgevingssoort,
  // De rem sinds stap 5: vraagt de database wat hij is.
  eisOnbeschermdeDatabase,
  // De oude rem, op hostnaam. Blijft bestaan omdat hij synchroon is en dus
  // bruikbaar op een plek waar geen databaseverbinding gemaakt kan worden.
  // Gebruik hem niet voor nieuwe scripts: hij kan staging niet van productie
  // onderscheiden, want beide staan bij Supabase.
  eisToestemmingBuitenLokaal,
  eisWegwerpdatabase,
};
