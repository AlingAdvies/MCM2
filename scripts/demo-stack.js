#!/usr/bin/env node
'use strict';

/**
 * De hele demo-omgeving in één commando: database, backend, frontend, sessie.
 *
 * ── Waarom dit bestaat ───────────────────────────────────────────────────────
 *
 * `demo:start` zet de database neer. Backend en frontend startte je daarna zelf,
 * met de hand, met vier omgevingsvariabelen die alle vier goed moesten staan.
 * Op 2026-08-04 ging dat drie keer achter elkaar mis, en telkens op een andere
 * manier:
 *
 *   1. NEXT_PUBLIC_API_URL ontbrak     → het scherm toonde mock data
 *   2. de backend draaide niet         → "kon niet worden opgehaald"
 *   3. CORS_ORIGIN ontbrak             → de browser liet het cookie thuis
 *   4. SESSIE_COOKIE_INSECURE ontbrak  → 401, want de backend zocht een
 *                                        `__Host-`cookie dat over http niet
 *                                        bestaat
 *
 * Geen van die vier meldt zichzelf als de eigenlijke oorzaak. Fout 1 en 2 zien
 * er in het scherm identiek uit, en fout 4 geeft een 401 die niet verklapt dat
 * het om de naam van het cookie gaat.
 *
 * Dit script zet ze alle vier goed en controleert daarna of het écht werkt.
 *
 * ── Wat het niet doet ────────────────────────────────────────────────────────
 *
 * De demo-database wordt nooit weggegooid zonder `--vers`. Dat is de les van
 * 2026-08-03, toen een opruimactie de demo-data twee keer meenam inclusief de
 * koppeling met een echt Entra-account.
 *
 * En het schiet geen processen dood die het niet zelf gestart heeft. Zie
 * controleerPoorten().
 *
 * Gebruik:
 *   npm run demo                       opzetten (data blijft staan)
 *   npm run demo -- --vers             database eerst weggooien en opnieuw opbouwen
 *   npm run demo -- --branch <naam>    eerst deze branch uitchecken in MCM2-frontend
 *   npm run demo:af                    backend en frontend stoppen, database laten staan
 *   npm run demo:status                draait het, en wat zit erin?
 */

const { spawn, spawnSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEMO_TENANT_ID = 'dededede-0000-4000-8000-000000000001';
const DEMO_CONTAINER = 'mcm2demo';
const DB_POORT = 55450;
const API_POORT = 5001;
const WEB_POORT = 3000;

const FRONTEND = path.join(__dirname, '..', '..', 'MCM2-frontend');

/**
 * Waar de achtergrondprocessen hun sporen achterlaten.
 *
 * Bewust in het project en niet in de systeem-tempmap: wie een probleem heeft,
 * moet het logbestand kunnen vinden zonder te weten waar Windows zijn tempmap
 * neerzet. Staat in .gitignore.
 */
const WERKMAP = path.join(__dirname, '..', '.demo');
const LOG_API = path.join(WERKMAP, 'backend.log');
const LOG_WEB = path.join(WERKMAP, 'frontend.log');
const STAAT = path.join(WERKMAP, 'staat.json');

const RUNTIME_URL = `postgresql://clm_api_runtime:pw@localhost:${DB_POORT}/postgres`;
const isWindows = process.platform === 'win32';

function draai(commando, argumenten, opties = {}) {
  const resultaat = spawnSync(commando, argumenten, {
    encoding: 'utf8',
    shell: isWindows,
    stdio: opties.toon ? 'inherit' : 'pipe',
    cwd: opties.cwd,
    env: { ...process.env, ...(opties.env ?? {}) },
  });

  return {
    ok: resultaat.status === 0,
    uitvoer: (resultaat.stdout ?? '') + (resultaat.stderr ?? ''),
  };
}

function psql(sql, rol = 'clm_migrator') {
  return draai('docker', [
    'exec',
    DEMO_CONTAINER,
    'psql',
    '-U',
    rol,
    '-d',
    'postgres',
    '-tAc',
    `"${sql.replace(/"/g, '\\"')}"`,
  ]);
}

/** Het laatste niet-lege regeltje van psql-uitvoer; SET geeft zelf ook een regel. */
function laatsteRegel(uitvoer) {
  const regels = uitvoer
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean);
  return regels[regels.length - 1] ?? '';
}

function pauze(seconden) {
  draai(
    isWindows ? 'timeout' : 'sleep',
    isWindows ? ['/t', String(seconden), '/nobreak'] : [String(seconden)],
  );
}

function httpCode(url, maxSeconden = 2) {
  const { uitvoer } = draai('curl', [
    '-s',
    '-o',
    isWindows ? 'NUL' : '/dev/null',
    '-w',
    '%{http_code}',
    '--max-time',
    String(maxSeconden),
    url,
  ]);

  return uitvoer.trim();
}

// ── Poorten ─────────────────────────────────────────────────────────────────

/**
 * Wie houdt poort 5001 en 3000 bezet, en mogen we die afsluiten?
 *
 * ── Waarom niet blind afsluiten ──────────────────────────────────────────────
 *
 * Poort 3000 is niet van ons alleen. In deze werkomgeving draaien meerdere
 * projecten door elkaar (C:\dev\CLAUDE.md noemt mvm-website op 3003 en
 * jouwcontractmanager op 3005, maar 3000 is de standaard van elk Next.js-
 * project dat als eerste start). Een `taskkill` op alles wat daar luistert
 * gooit mogelijk andermans werk weg — een dev-server met een openstaande
 * debugsessie, of een demo die op dat moment aan een klant getoond wordt.
 *
 * ── Waarom wél afsluiten wat van ons is ──────────────────────────────────────
 *
 * `verify:volledig` weigert simpelweg te starten bij een bezette poort, en dat
 * is daar de juiste keuze: dat is een testrun die iets moet bewijzen, en een
 * vreemde server op de poort maakt de uitkomst waardeloos.
 *
 * Hier is de afweging anders. Dit script wordt gedraaid door iemand die wil
 * klikken, niet iemand die een bewijs wil. "Poort bezet, zoek zelf uit welke
 * PID het is" is precies de wrijving waar dit script voor bestaat. Dus: een
 * eerdere demo-stack van onszelf ruimen we op, al het andere weigeren we.
 *
 * Het onderscheid maken we via het staatbestand, niet via de poort. Wat wij
 * gestart hebben, hebben we opgeschreven.
 */
function eigenProcessen() {
  if (!fs.existsSync(STAAT)) {
    return [];
  }

  try {
    const staat = JSON.parse(fs.readFileSync(STAAT, 'utf8'));
    return Array.isArray(staat.pids) ? staat.pids : [];
  } catch {
    // Een onleesbaar staatbestand is geen reden om te stoppen; het betekent
    // alleen dat we niets weten van een vorige run.
    return [];
  }
}

function stopProces(pid) {
  if (isWindows) {
    // /T ook de kindprocessen: `npm run dev` start node als kind, en het
    // afsluiten van alleen de npm-wrapper laat de server op de poort staan.
    draai('taskkill', ['/PID', String(pid), '/T', '/F']);
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Al weg. Prima.
    }
  }
}

/**
 * Wie luistert er op deze poort?
 *
 * ── Waarom dit nodig is náást het staatbestand ───────────────────────────────
 *
 * Het staatbestand houdt bij wat wij gestart hebben, maar dat zijn de PID's van
 * de commando's — `npm` en `node dist/main`. Op Windows start `npm run dev` een
 * eigen kleinkind dat de poort werkelijk bindt, en `taskkill /T` bereikt dat
 * niet altijd: als de tussenliggende schil al weg is, is de kleinkindrelatie
 * verbroken en blijft de server draaien.
 *
 * Gemeten op 2026-08-04: na een mislukte run stond de stack "afgesloten
 * (2 processen)" en antwoordden beide poorten daarna nog met HTTP 200.
 *
 * Vandaar dat het opruimen op de poort werkt en niet alleen op de PID: de vraag
 * is niet "welk proces hebben wij gestart" maar "wat houdt deze poort nog vast".
 */
function luisteraarsOpPoort(poort) {
  if (isWindows) {
    const { uitvoer } = draai('netstat', ['-ano', '-p', 'TCP']);

    const pids = new Set();

    for (const regel of uitvoer.split('\n')) {
      // Alleen LISTENING: een ESTABLISHED-regel op dezelfde poort is een
      // openstaande verbinding van een cliënt, niet de server zelf.
      if (!regel.includes('LISTENING')) {
        continue;
      }

      const velden = regel.trim().split(/\s+/);
      const adres = velden[1] ?? '';
      const pid = Number(velden[velden.length - 1]);

      if (adres.endsWith(`:${poort}`) && Number.isInteger(pid) && pid > 0) {
        pids.add(pid);
      }
    }

    return [...pids];
  }

  const { uitvoer } = draai('lsof', ['-ti', `tcp:${poort}`, '-sTCP:LISTEN']);

  return uitvoer
    .split('\n')
    .map((r) => Number(r.trim()))
    .filter((p) => Number.isInteger(p) && p > 0);
}

function stopEigenProcessen() {
  const pids = new Set(eigenProcessen());

  // Ook wat er nog op ónze poorten luistert, maar alleen als het staatbestand
  // zegt dat wij hier een stack hadden draaien. Zonder dat bestand blijven we
  // van de poorten af — dan is het andermans server.
  if (pids.size > 0) {
    for (const poort of [API_POORT, WEB_POORT]) {
      for (const pid of luisteraarsOpPoort(poort)) {
        pids.add(pid);
      }
    }
  }

  for (const pid of pids) {
    stopProces(pid);
  }

  if (fs.existsSync(STAAT)) {
    fs.unlinkSync(STAAT);
  }

  return pids.size;
}

/**
 * Controleert of onze twee poorten vrij zijn, na eerst onze eigen oude
 * processen te hebben opgeruimd.
 */
function controleerPoorten() {
  const opgeruimd = stopEigenProcessen();

  if (opgeruimd > 0) {
    console.log(`  Vorige demo-stack afgesloten (${opgeruimd} proces(sen)).`);
    // Windows geeft de poort niet meteen vrij na taskkill.
    pauze(2);
  }

  const bezet = [];

  for (const { poort, wat } of [
    { poort: API_POORT, wat: 'de backend' },
    { poort: WEB_POORT, wat: 'de frontend' },
  ]) {
    const code = httpCode(`http://localhost:${poort}/`);

    // Elk antwoord betekent dat er iets luistert — ook een 404 of 500.
    if (code && code !== '000') {
      bezet.push({ poort, wat, code });
    }
  }

  return bezet;
}

// ── Database ────────────────────────────────────────────────────────────────

function databaseKlaarzetten(vers) {
  const argumenten = ['run', 'demo:start'];

  if (vers) {
    argumenten.push('--', '--opnieuw');
  }

  const uitkomst = draai('npm', argumenten, { toon: true });

  if (!uitkomst.ok) {
    return { ok: false, reden: 'demo:start is mislukt — zie hierboven.' };
  }

  return { ok: true };
}

const MIGRATION_URL = `postgresql://clm_migrator:pw@localhost:${DB_POORT}/postgres`;

/**
 * Vergelijkt de migratiestand van de demo-database met het journal, en
 * werkt bij als er verschil is.
 *
 * ── Waarom dit hier zit ──────────────────────────────────────────────────
 *
 * Gemeten op 2026-08-21: de demo-database liep 7 migraties achter (20 van
 * 27) zonder dat er enig signaal was. Dat gaf een 500-fout op een query
 * naar een tabel die nog niet bestond — een fout die op het eerste gezicht
 * leek op "sessie verlopen", maar in werkelijkheid een stille
 * infrastructuur-achterstand was. `verify:omgevingen` bewaakt dit al voor
 * acceptatie/staging/productie; de demo-database had die bewaking niet.
 *
 * ── Waarom "voltooid" niet genoeg is ─────────────────────────────────────
 *
 * migrate.js meldt "Migraties voltooid" ook wanneer er niets te doen was.
 * Na een daadwerkelijke migratie wordt daarom opnieuw gemeten — dezelfde
 * discipline als scripts/deploy.js, en de kernregel van dit project.
 */
function migratieBijwerken() {
  const eerste = draai('node', ['scripts/migratiestand.js', '--volgens-journal'], {
    env: { MIGRATION_DATABASE_URL: MIGRATION_URL },
  });

  if (eerste.ok) {
    return { ok: true, bijgewerkt: false };
  }

  console.log('  Demo-database loopt achter op de migraties — bijwerken…');

  const migratie = draai('node', ['scripts/migrate.js', '--extern'], {
    env: { MIGRATION_DATABASE_URL: MIGRATION_URL },
  });

  if (!migratie.ok) {
    return {
      ok: false,
      reden:
        `de migratie op de demo-database is mislukt:\n` +
        `${migratie.uitvoer.trim().split('\n').slice(-15).join('\n')}`,
    };
  }

  const tweede = draai('node', ['scripts/migratiestand.js', '--volgens-journal'], {
    env: { MIGRATION_DATABASE_URL: MIGRATION_URL },
  });

  if (!tweede.ok) {
    return {
      ok: false,
      reden:
        `de migratie meldde succes, maar de stand klopt na afloop nog steeds niet:\n` +
        `${tweede.uitvoer.trim().split('\n').slice(-10).join('\n')}`,
    };
  }

  return { ok: true, bijgewerkt: true };
}

// ── Backend en frontend ─────────────────────────────────────────────────────

/**
 * Start een proces op de achtergrond en houdt de PID vast.
 *
 * `detached` op Windows is bewust false: met true krijgt het proces een eigen
 * procesgroep die `taskkill /T` niet meer als kind herkent, en dan blijft de
 * server na `demo:af` op de poort staan.
 */
function startAchtergrond(commando, argumenten, logbestand, opties = {}) {
  const log = fs.openSync(logbestand, 'w');

  const kind = spawn(commando, argumenten, {
    shell: isWindows,
    cwd: opties.cwd,
    env: { ...process.env, ...(opties.env ?? {}) },
    stdio: ['ignore', log, log],
    detached: false,
    windowsHide: true,
  });

  kind.unref();

  return kind.pid;
}

function backendStarten() {
  console.log('  Bouwen…');

  const gebouwd = draai('npm', ['run', 'build']);

  if (!gebouwd.ok) {
    return {
      ok: false,
      reden: `de backend kon niet gebouwd worden:\n${gebouwd.uitvoer.trim().split('\n').slice(-15).join('\n')}`,
    };
  }

  // De vier variabelen die met de hand steeds misgingen — zie de kop van dit
  // bestand. Expliciet meegeven en niet uit .env laten komen: .env wijst naar
  // productie, en dat is precies waar deze demo níét heen mag.
  const pid = startAchtergrond('node', ['dist/main'], LOG_API, {
    env: {
      DATABASE_URL: RUNTIME_URL,
      CORS_ORIGIN: `http://localhost:${WEB_POORT}`,
      // Over http bestaat het `__Host-`voorvoegsel niet. Zonder deze schakelaar
      // zoekt de backend een cookie dat de browser nooit zal sturen, en het
      // gevolg is een 401 die zwijgt over de oorzaak.
      SESSIE_COOKIE_INSECURE: 'true',
      PORT: String(API_POORT),
    },
  });

  return { ok: true, pid };
}

function frontendStarten() {
  const pid = startAchtergrond('npm', ['run', 'dev'], LOG_WEB, {
    cwd: FRONTEND,
    env: {
      // Sinds Issue #51 leest de frontend dit bij het starten, niet bij het
      // bouwen. Hier is `localhost` wél goed: de demo draait niet in Docker,
      // dus de frontend en de backend delen de machine. In
      // docker-compose.otap.yml staat om die reden de servicenaam.
      API_BASE_URL: `http://localhost:${API_POORT}`,
      PORT: String(WEB_POORT),
    },
  });

  return { ok: true, pid };
}

/**
 * Checkt een specifieke branch uit in de MCM2-frontend-map, als die is
 * opgegeven.
 *
 * ── Waarom dit bestaat ───────────────────────────────────────────────────
 *
 * Vóór deze functie startte de frontend altijd vanuit wat er toevallig in
 * MCM2-frontend stond uitgecheckt — een impliciete aanname die op
 * 2026-08-21 tot een onopgemerkte branch-mismatch leidde tussen de
 * backend- en frontend-repo. Deze functie maakt de keuze expliciet in
 * plaats van impliciet.
 *
 * Zonder --branch verandert er niets: de functie doet dan niets en geeft
 * ok:true terug, precies het gedrag van vóór deze wijziging.
 */
function frontendBranchWisselen(branch) {
  if (!branch) {
    return { ok: true };
  }

  const checkout = draai('git', ['-C', FRONTEND, 'checkout', branch]);

  if (!checkout.ok) {
    return {
      ok: false,
      reden:
        `kon niet naar branch '${branch}' wisselen in MCM2-frontend:\n` +
        `${checkout.uitvoer.trim()}\n\n` +
        `Bestaat de branch? Staan er ongecommitte wijzigingen in de weg?\n` +
        `Controleer met: git -C "${FRONTEND}" status`,
    };
  }

  return { ok: true };
}

/**
 * Leest de actieve branch en laatste commit van een repository.
 *
 * ── Waarom dit altijd draait, niet alleen met --branch ────────────────────
 *
 * Het probleem van 2026-08-21 was niet "er is geen manier om een branch te
 * kiezen" maar "er is geen manier om te zíen wat er draait" — die twee zijn
 * verschillend. Zonder --branch blijft de keuze impliciet, maar de
 * zichtbaarheid hoeft dat niet te zijn.
 */
function huidigeBranchInfo(pad) {
  const branch = draai('git', ['-C', pad, 'branch', '--show-current']);
  const commit = draai('git', ['-C', pad, 'log', '-1', '--format=%h %s']);

  if (!branch.ok || !commit.ok) {
    return { ok: false };
  }

  return {
    ok: true,
    branch: branch.uitvoer.trim() || '(detached HEAD)',
    commit: commit.uitvoer.trim(),
  };
}

/**
 * Wacht tot beide echt antwoorden.
 *
 * Op een HTTP-antwoord pollen en niet op "het proces draait": een Next.js-
 * server met een kapotte build start wél en geeft een 500. Datzelfde
 * onderscheid staat in verify-volledig.js, om dezelfde reden.
 */
function wachtOpStack(maxSeconden = 120) {
  const einde = Date.now() + maxSeconden * 1000;
  let laatste = '';

  while (Date.now() < einde) {
    const api = httpCode(`http://localhost:${API_POORT}/health`);
    const web = httpCode(`http://localhost:${WEB_POORT}/`);

    if (api === '200' && web === '200') {
      return { ok: true };
    }

    laatste = `backend=${api || 'geen antwoord'} frontend=${web || 'geen antwoord'}`;
    pauze(2);
  }

  return { ok: false, reden: laatste };
}

// ── Sessie ──────────────────────────────────────────────────────────────────

/**
 * Maakt een sessie voor de admin van de demo-tenant.
 *
 * ── Waarom dit mag, en waarom het geen tweede inlogpad is ────────────────────
 *
 * Issue #7 sluit uit dat er een tweede weg naar identiteit ontstaat naast het
 * sessiecookie. Dit script maakt géén tweede weg: het roept
 * `clm.sessie_aanmaken()` aan — dezelfde databasefunctie die de echte
 * inlogflow gebruikt, inclusief de membershipcontrole. Wat de browser krijgt
 * is precies wat een geslaagde Entra-login zou opleveren.
 *
 * Alleen het verkríjgen ervan is overgeslagen, niet de sessie zelf. Dat is
 * dezelfde afweging als in verify-volledig.js (maakSessie), en de reden dat het
 * hier kan is dat het uitsluitend de demo-tenant met verzonnen data betreft.
 *
 * Wie de échte inlogflow wil doorlopen, koppelt een echte Entra-oid — zie
 * docs/STATUS.md, "Demo-tenant".
 */
function sessieMaken() {
  const subject = gekozenDemoGebruiker();

  if (!subject.ok) {
    return subject;
  }

  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token, 'utf8').digest('hex');

  const sessie = psql(
    `SELECT tenant_id FROM clm.sessie_aanmaken('${hash}', '${subject.subject}', '8 hours'::interval)`,
  );

  if (!sessie.ok || !sessie.uitvoer.includes(DEMO_TENANT_ID)) {
    return {
      ok: false,
      reden:
        `sessie_aanmaken() gaf geen sessie terug voor '${subject.subject}'.\n` +
        `  ${sessie.uitvoer.trim()}`,
    };
  }

  return { ok: true, token, naam: subject.naam };
}

/**
 * Zoekt de admin van de demo-tenant op.
 *
 * Op rol zoeken en niet op een vast UUID: seed-demo-tenant.js maakt de
 * gebruikers met gegenereerde id's, en de eerste uit de lijst krijgt `admin`.
 * Een hardgecodeerd id hier zou stilzwijgend breken zodra die volgorde
 * verandert.
 */
function gekozenDemoGebruiker() {
  const uitkomst = psql(
    `SET app.current_tenant_id = '${DEMO_TENANT_ID}'; ` +
      `SELECT u.external_subject || '|' || u.full_name ` +
      `FROM clm."user" u ` +
      `JOIN clm.tenant_membership m ON m.user_id = u.user_id ` +
      `WHERE m.role = 'admin' ORDER BY u.full_name LIMIT 1`,
  );

  const regel = laatsteRegel(uitkomst.uitvoer);

  if (!uitkomst.ok || !regel.includes('|')) {
    return {
      ok: false,
      reden:
        'Geen admin gevonden in de demo-tenant. Is de database gevuld?\n' +
        '  Probeer: npm run demo -- --vers',
    };
  }

  const [subject, naam] = regel.split('|');

  return { ok: true, subject, naam };
}

// ── Zelfcontrole ────────────────────────────────────────────────────────────

/**
 * Haalt de vragenlijsten op zoals de browser dat doet, met het echte cookie.
 *
 * ── Waarom dit erin zit ──────────────────────────────────────────────────────
 *
 * Zonder deze stap eindigt het script met "klaar" terwijl elk van de vier
 * bekende fouten nog aanwezig kan zijn. Precies dat gebeurde op 2026-08-04: de
 * stack leek te draaien, en pas in de browser bleek dat het scherm mock data
 * toonde.
 *
 * Een geslaagde aanroep met een echt sessiecookie bewijst de hele keten:
 * cookie → guard → RLS → database → antwoord. Blijft die uit, dan stopt dit
 * script met de reden in plaats van de gebruiker naar een kapot scherm te
 * sturen.
 */
function controleerKeten(token) {
  // ── Waarom de Origin-header hier staat ────────────────────────────────────
  //
  // Zonder deze header bewijst deze controle drie van de vier fouten, maar niet
  // de CORS-fout — en dat is juist de fout die het lastigst te herkennen is.
  //
  // Gemeten op 2026-08-04: een verzoek zonder `Origin` gaf 200, en een verzoek
  // mét een verkeerde `Origin` óók 200. curl trekt zich niets aan van CORS; de
  // browser wel. Het script zou dus "klaar" melden terwijl elk beheerscherm in
  // de browser leeg blijft.
  //
  // Met de header erbij antwoordt de backend met
  // `Access-Control-Allow-Origin`, en dat is precies wat de browser nodig heeft
  // om het antwoord door te laten. Ontbreekt die kop, dan is CORS_ORIGIN
  // verkeerd gezet en stopt dit script — zie hieronder.
  const argumenten = [
    '-s',
    '-i',
    '--max-time',
    '10',
    '-H',
    `"Origin: http://localhost:${WEB_POORT}"`,
    '-H',
    `"Cookie: mcm2_sessie=${token}"`,
    `http://localhost:${API_POORT}/admin/survey/templates`,
  ];

  const antwoordMetKoppen = draai('curl', argumenten);

  if (!/access-control-allow-origin/i.test(antwoordMetKoppen.uitvoer)) {
    return {
      ok: false,
      reden:
        'de backend stuurt geen Access-Control-Allow-Origin terug.\n' +
        `  De browser zal het antwoord dan weggooien en elk beheerscherm\n` +
        `  blijft leeg. Controleer CORS_ORIGIN in de backend.`,
    };
  }

  const { uitvoer, ok } = draai('curl', [
    '-s',
    '--max-time',
    '10',
    '-H',
    `"Cookie: mcm2_sessie=${token}"`,
    `http://localhost:${API_POORT}/admin/survey/templates`,
  ]);

  if (!ok) {
    return { ok: false, reden: 'de backend gaf geen antwoord.' };
  }

  let antwoord;

  try {
    antwoord = JSON.parse(uitvoer);
  } catch {
    return {
      ok: false,
      reden: `onverwacht antwoord van de backend: ${uitvoer.trim().slice(0, 200)}`,
    };
  }

  const lijsten = antwoord.vragenlijsten;

  if (!Array.isArray(lijsten)) {
    return {
      ok: false,
      reden:
        `de backend antwoordde, maar niet met vragenlijsten: ` +
        `${JSON.stringify(antwoord).slice(0, 200)}`,
    };
  }

  // ── Het doorgeefluik (Issue #51) ──────────────────────────────────────────
  //
  // Alles hierboven praat rechtstreeks met de backend. Sinds #51 doet de
  // browser dat niet meer: die gaat via de frontend, die het adres van de
  // backend bij het starten leest. Dat is een aparte schakel die apart stuk
  // kan, en de faalvorm is de bekende — het scherm toont "kon niet worden
  // opgehaald", precies zoals bij een backend die niet draait.
  //
  // Dezelfde aanroep als hierboven, maar via poort 3000.
  const viaFrontend = draai('curl', [
    '-s',
    '--max-time',
    '15',
    '-H',
    `"Cookie: mcm2_sessie=${token}"`,
    `http://localhost:${WEB_POORT}/api/backend/admin/survey/templates`,
  ]);

  let viaProxy;

  try {
    viaProxy = JSON.parse(viaFrontend.uitvoer);
  } catch {
    return {
      ok: false,
      reden:
        'het doorgeefluik naar de backend werkt niet.\n' +
        `  De frontend gaf: ${viaFrontend.uitvoer.trim().slice(0, 200)}\n` +
        `  Controleer API_BASE_URL en ${LOG_WEB}`,
    };
  }

  if (!Array.isArray(viaProxy.vragenlijsten)) {
    return {
      ok: false,
      reden:
        'het doorgeefluik antwoordde, maar niet met vragenlijsten: ' +
        `${JSON.stringify(viaProxy).slice(0, 200)}`,
    };
  }

  return { ok: true, lijsten };
}

// ── Opdrachten ──────────────────────────────────────────────────────────────

function start(vers, frontendBranch) {
  fs.mkdirSync(WERKMAP, { recursive: true });

  console.log('\n1/5  Poorten vrijmaken');

  const bezet = controleerPoorten();

  if (bezet.length > 0) {
    console.error('\nGestopt: er draait al iets op onze poorten.\n');

    for (const { poort, wat, code } of bezet) {
      console.error(`  poort ${poort} (${wat}) — antwoordt met HTTP ${code}`);
    }

    console.error(
      '\nDat is niet door dit script gestart, dus het laat het met rust —\n' +
        'het kan een dev-server of demo van een ander project zijn.\n',
    );
    console.error(
      isWindows
        ? `Zoeken wat het is:\n  netstat -ano | findstr ":${bezet[0].poort} "\n  taskkill /PID <pid> /F`
        : `Zoeken wat het is:\n  lsof -i :${bezet[0].poort}\n  kill <pid>`,
    );

    return false;
  }

  console.log('  Poorten 5001 en 3000 zijn vrij.');

  console.log('\n2/5  Demo-database');

  const db = databaseKlaarzetten(vers);

  if (!db.ok) {
    console.error(`\nGestopt: ${db.reden}`);
    return false;
  }

  const migratie = migratieBijwerken();

  if (!migratie.ok) {
    console.error(`\nGestopt: ${migratie.reden}`);
    return false;
  }

  if (migratie.bijgewerkt) {
    console.log('  Migraties bijgewerkt en geverifieerd.');
  }

  console.log('\n3/5  Backend starten');

  const backend = backendStarten();

  if (!backend.ok) {
    console.error(`\nGestopt: ${backend.reden}`);
    return false;
  }

  console.log('\n4/5  Frontend starten');

  const branchWissel = frontendBranchWisselen(frontendBranch);

  if (!branchWissel.ok) {
    console.error(`\nGestopt: ${branchWissel.reden}`);
    return false;
  }

  const frontend = frontendStarten();

  // Meteen opschrijven, vóór het wachten. Breekt de gebruiker hier af met
  // Ctrl+C, dan weet `demo:af` alsnog wat er opgeruimd moet worden.
  fs.writeFileSync(
    STAAT,
    JSON.stringify(
      {
        gestart: new Date().toISOString(),
        pids: [backend.pid, frontend.pid].filter(Boolean),
      },
      null,
      2,
    ),
  );

  const gereed = wachtOpStack();

  if (!gereed.ok) {
    console.error(`\nGestopt: de stack antwoordt niet (${gereed.reden}).`);
    console.error(`\n  backend:   ${LOG_API}`);
    console.error(`  frontend:  ${LOG_WEB}`);
    console.error('\nAfsluiten: npm run demo:af');
    return false;
  }

  console.log('  Beide antwoorden.');

  console.log('\n5/5  Sessie en zelfcontrole');

  const sessie = sessieMaken();

  if (!sessie.ok) {
    console.error(`\nGestopt: ${sessie.reden}`);
    return false;
  }

  const keten = controleerKeten(sessie.token);

  if (!keten.ok) {
    console.error(`\nGestopt: de keten sluit niet — ${keten.reden}`);
    console.error(`\n  backend: ${LOG_API}`);
    return false;
  }

  // Het token hoort hier, en dat is een bewuste afwijking van de regel dat
  // ruwe tokens nergens worden bewaard.
  //
  // Twee redenen. Het geeft uitsluitend toegang tot de demo-tenant met
  // verzonnen data, op een backend die alleen op localhost luistert. En zonder
  // deze regel kun je de browsertests niet tegen de draaiende demo draaien —
  // die verwachten BEHEER_COOKIE, en dan moet je het token opnieuw met de hand
  // uit de terminaluitvoer vissen.
  //
  // De werkmap .demo/ staat in .gitignore, dus het komt niet in de repository.
  fs.writeFileSync(
    STAAT,
    JSON.stringify(
      {
        gestart: new Date().toISOString(),
        pids: [backend.pid, frontend.pid].filter(Boolean),
        gebruiker: sessie.naam,
        cookie: `mcm2_sessie=${sessie.token}`,
      },
      null,
      2,
    ),
  );

  console.log(`  Ingelogd als ${sessie.naam} (admin).`);
  console.log(`  De backend gaf ${keten.lijsten.length} vragenlijst(en) terug:`);

  for (const lijst of keten.lijsten) {
    console.log(
      `    ${lijst.name} v${lijst.version} — ${lijst.aantalVragen} vragen, ${lijst.aantalRondes} ronde(s)`,
    );
  }

  const backendInfo = huidigeBranchInfo(path.join(__dirname, '..'));
  const frontendInfo = huidigeBranchInfo(FRONTEND);

  console.log('');
  if (backendInfo.ok) {
    console.log(`  Backend:  ${backendInfo.branch} @ ${backendInfo.commit}`);

    if (backendInfo.branch !== 'main') {
      console.log(
        '    Let op: backend staat niet op main — dit is geen standaard-previewcombinatie.',
      );
    }
  }
  if (frontendInfo.ok) {
    console.log(`  Frontend: ${frontendInfo.branch} @ ${frontendInfo.commit}`);
  }

  const link = `http://localhost:${WEB_POORT}/demo-aanmelden#${sessie.token}`;

  console.log('');
  console.log('─'.repeat(70));
  console.log('');
  console.log('  De demo draait. Open deze link om in te loggen:');
  console.log('');
  console.log(`    ${link}`);
  console.log('');
  console.log('  De sessie is 8 uur geldig. Bovenin het scherm staat een');
  console.log('  oranje balk zolang je in de demo zit.');
  console.log('');
  console.log('  Afsluiten:  npm run demo:af');
  console.log('  Kijken:     npm run demo:status');
  console.log('');
  console.log('─'.repeat(70));

  return true;
}

function af() {
  const aantal = stopEigenProcessen();

  if (aantal === 0) {
    console.log('Er stond geen demo-stack aan (volgens .demo/staat.json).');
  } else {
    console.log(`Backend en frontend afgesloten (${aantal} proces(sen)).`);
  }

  console.log(
    `\nDe demo-database blijft staan met zijn data.\n` +
      `  weggooien: npm run demo:stop`,
  );

  return true;
}

/**
 * Draait de browsertests tegen de drááiende demo-stack.
 *
 * ── Waarom dit naast `verify:volledig` bestaat ───────────────────────────────
 *
 * `verify:volledig` bouwt zijn eigen stack op de productie-images, draait de
 * tests en breekt alles weer af. Dat is het bewijs, en dat blijft het bewijs.
 *
 * Dit is iets anders: dezelfde tests tegen de omgeving die op dit moment voor
 * je neus staat. Nuttig wanneer je iets met de hand hebt zien misgaan en wilt
 * weten of een test het ook ziet — het verschil tussen "het werkt bij mij" en
 * "er staat een test op".
 *
 * Het is uitdrukkelijk géén vervanging: deze tests draaien tegen `next dev`,
 * niet tegen het productie-image, en de demo-database is gevulder dan een verse
 * container. Een groene uitkomst hier zegt minder dan een groene doorloop.
 */
function test() {
  if (!fs.existsSync(STAAT)) {
    console.error('Er draait geen demo-stack. Start hem met: npm run demo');
    return false;
  }

  const staat = JSON.parse(fs.readFileSync(STAAT, 'utf8'));

  if (!staat.cookie) {
    console.error(
      'Geen sessie in .demo/staat.json. Start opnieuw met: npm run demo',
    );
    return false;
  }

  console.log('Browsertests tegen de draaiende demo…\n');

  const uitkomst = draai('npm', ['run', 'e2e'], {
    toon: true,
    cwd: FRONTEND,
    env: {
      BEHEER_COOKIE: staat.cookie,
      PORTAL_URL: `http://localhost:${WEB_POORT}`,
    },
  });

  if (!uitkomst.ok) {
    console.error(
      '\nEen of meer tests zijn gevallen. Let op: dit draait tegen next dev\n' +
        'en tegen de gevulde demo-database — `npm run verify:volledig` is het\n' +
        'echte bewijs.',
    );
    return false;
  }

  return true;
}

function status() {
  const draaitDb =
    laatsteRegel(draai('docker', [
      'ps',
      '--filter',
      `name=^${DEMO_CONTAINER}$`,
      '--format',
      '{{.Names}}',
    ]).uitvoer) === DEMO_CONTAINER;

  const api = httpCode(`http://localhost:${API_POORT}/health`);
  const web = httpCode(`http://localhost:${WEB_POORT}/`);

  console.log('');
  console.log(`  database   ${draaitDb ? 'draait' : 'staat uit'} (poort ${DB_POORT})`);
  console.log(
    `  backend    ${api === '200' ? 'draait' : `geen antwoord (${api || 'stil'})`} (poort ${API_POORT})`,
  );
  console.log(
    `  frontend   ${web === '200' ? 'draait' : `geen antwoord (${web || 'stil'})`} (poort ${WEB_POORT})`,
  );

  if (fs.existsSync(STAAT)) {
    try {
      const staat = JSON.parse(fs.readFileSync(STAAT, 'utf8'));
      console.log(
        `\n  gestart om ${new Date(staat.gestart).toLocaleString('nl-NL')}` +
          (staat.gebruiker ? ` als ${staat.gebruiker}` : ''),
      );
    } catch {
      // Onleesbaar staatbestand: niet de moeite waard om over te melden.
    }
  }

  if (api !== '200' || web !== '200') {
    console.log('');
    console.log('  Logs:');
    console.log(`    ${LOG_API}`);
    console.log(`    ${LOG_WEB}`);
    console.log('');
    console.log('  Opnieuw opzetten: npm run demo');
  }

  console.log('');

  return true;
}

function main() {
  const argumenten = process.argv.slice(2);

  // De waarde van --branch staat als los argument ná de vlag, en is dus
  // zelf geen `--`-argument. Zonder deze uitsluiting zou `opdracht.find()`
  // hieronder een branchnaam als 'feat/154-iets' kunnen aanzien voor de
  // opdracht (af/status/test/start), simpelweg omdat hij niet met `--`
  // begint.
  //
  // `branchIndex` is -1 wanneer --branch ontbreekt, en dan mag
  // `branchIndex + 1` (dus 0) niet als "uit te sluiten index" gelden — dat
  // zou anders per ongeluk het eerste échte argument overslaan, wat
  // precies de opdracht zelf is (bijv. 'af'). Vandaar de expliciete
  // branchIndex !== -1-voorwaarde in de uitsluiting hieronder.
  const branchIndex = argumenten.indexOf('--branch');
  const frontendBranch =
    branchIndex !== -1 ? argumenten[branchIndex + 1] : undefined;

  const opdracht =
    argumenten.find(
      (a, i) => !a.startsWith('--') && !(branchIndex !== -1 && i === branchIndex + 1),
    ) ?? 'start';

  const uitkomst =
    opdracht === 'af'
      ? af()
      : opdracht === 'status'
        ? status()
        : opdracht === 'test'
          ? test()
          : start(argumenten.includes('--vers'), frontendBranch);

  process.exit(uitkomst ? 0 : 1);
}

main();
