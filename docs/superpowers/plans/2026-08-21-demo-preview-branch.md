# Betrouwbare frontend-preview vóór mergen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `scripts/demo-stack.js` uitbreiden zodat (1) een specifieke
frontend-branch expliciet gekozen kan worden in plaats van impliciet
"wat er toevallig staat uitgecheckt", (2) altijd zichtbaar is welke
branch/commit er in beide repo's daadwerkelijk draait, en (3) de
demo-database nooit stilzwijgend kan achterlopen op de repo-migraties.

**Architecture:** Drie gerichte uitbreidingen van het bestaande script, geen
nieuw bestand, geen nieuwe omgeving. Hergebruikt `scripts/migratiestand.js`
en `scripts/migrate.js` (al bestaand, al beproefd) voor de migratiecontrole,
en `git`-aanroepen via de bestaande `draai()`-helper voor de branch-keuze en
-weergave.

**Tech Stack:** Node.js (plain JavaScript, geen TypeScript — zie de
bestaande motivatie bovenaan `scripts/migrate.js`), `git`, de bestaande
`spawnSync`-wrapper `draai()` in `demo-stack.js`.

---

## Achtergrond die de engineer nodig heeft

- Spec: `docs/superpowers/specs/2026-08-21-demo-preview-branch-design.md`
  (issue [#165](https://github.com/AlingAdvies/MCM2/issues/165)).
- `scripts/demo-stack.js` is het bestaande opstartscript (`npm run demo`).
  Kernstructuur: `start(vers)` roept in volgorde
  `controleerPoorten()` → `databaseKlaarzetten(vers)` → `backendStarten()` →
  `frontendStarten()` → `wachtOpStack()` → `sessieMaken()` →
  `controleerKeten(token)` aan, met bij elke stap een foutpad dat stopt met
  een duidelijke reden (zie `demo-stack.js:625-770`).
- `FRONTEND` is een module-constante:
  `path.join(__dirname, '..', '..', 'MCM2-frontend')` (`demo-stack.js:54`).
- `frontendStarten()` (`demo-stack.js:367-381`) start `npm run dev` met
  `cwd: FRONTEND` — er wordt nergens gecontroleerd of gewisseld van branch.
- `draai(commando, argumenten, opties)` (`demo-stack.js:71-84`) is de
  bestaande `spawnSync`-wrapper: geeft `{ ok, uitvoer }` terug, ondersteunt
  `cwd` en `env` in `opties`.
- `scripts/migratiestand.js` leest `MIGRATION_DATABASE_URL` en ondersteunt
  `--volgens-journal`: vergelijkt de daadwerkelijke migratiestand met
  `drizzle/meta/_journal.json`, exitcode 1 bij afwijking, exitcode 0 bij
  gelijkheid (zie `scripts/migratiestand.js:133-162`).
- `scripts/migrate.js` leest `MIGRATION_DATABASE_URL`, weigert een
  beschermde database tenzij `--extern` is meegegeven (leest
  `process.argv` van het eigen proces — dus dit werkt correct wanneer
  `demo-stack.js` het als los kindproces aanroept met `--extern` als eigen
  argument, niet als iets dat via de omgeving van de ouder doorgegeven moet
  worden).
- De demo-database luistert op poort 55450, rol `clm_migrator`, wachtwoord
  `pw` (vast wegwerp-wachtwoord voor lokale containers in dit project) —
  bevestigd vandaag: `MIGRATION_DATABASE_URL="postgresql://clm_migrator:pw@localhost:55450/postgres"`.
- Bestaande foutmeldingsstijl: Nederlandse tekst, concreet over wát er niet
  werkt en wat de volgende stap is (zie elke `return { ok: false, reden: ... }`
  in het bestand).

---

## Scope check

Eén samenhangende uitbreiding van één bestand
(`scripts/demo-stack.js`). Geen decompositie in aparte plannen nodig — de
drie onderdelen (branch-parameter, branch-weergave, migratiecontrole) delen
dezelfde plek in de opstartvolgorde en horen bij elkaar.

---

## File Structure

- **Modify:** `scripts/demo-stack.js` — vier nieuwe functies
  (`frontendBranchWisselen`, `huidigeBranchInfo`, `migratieBijwerken`) plus
  aanpassingen in `start()` om ze op de juiste plek aan te roepen, en in de
  afsluitende samenvatting om de branch-info te tonen.
- **Test:** geen geautomatiseerde test toegevoegd — dit is een lokaal
  ontwikkelhulpmiddel zonder CI-aanroep, net als de rest van
  `demo-stack.js`. Verificatie gebeurt door het script daadwerkelijk te
  draaien (zie Task 4).

---

### Task 1: Migratiecontrole/auto-fix van de demo-database

**Files:**
- Modify: `scripts/demo-stack.js`

- [ ] **Step 1: Lees de bestaande `databaseKlaarzetten`-functie**

```bash
cd C:/DEV/Work/MCM2
sed -n '293,310p' scripts/demo-stack.js
```

Bevestig dat de functie er nog exact zo uitziet als hieronder aangenomen —
regelnummers kunnen zijn opgeschoven als er tussentijds iets anders
gewijzigd is:

```javascript
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
```

- [ ] **Step 2: Voeg de migratiecontrole toe, na deze functie**

Voeg direct na `databaseKlaarzetten` een nieuwe functie toe:

```javascript
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
```

- [ ] **Step 3: Roep de nieuwe functie aan in `start()`, ná de database, vóór de backend**

Zoek in `start()` het blok:

```javascript
  console.log('\n2/5  Demo-database');

  const db = databaseKlaarzetten(vers);

  if (!db.ok) {
    console.error(`\nGestopt: ${db.reden}`);
    return false;
  }

  console.log('\n3/5  Backend starten');
```

Vervang door (voegt de migratiecontrole toe tussen database en backend):

```javascript
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
```

**Let op — de stapnummering ("1/5" t/m "5/5") blijft ongewijzigd.** De
migratiecontrole krijgt bewust geen eigen genummerde stap: hij hoort
inhoudelijk bij "de database klaarzetten", en een zesde nummer zou de
bestaande, vertrouwde volgorde in de terminal-output verstoren zonder dat
er een nieuwe fase is — het is een verificatie binnen een bestaande fase.

- [ ] **Step 4: Commit**

```bash
cd C:/DEV/Work/MCM2
git add scripts/demo-stack.js
git commit -m "feat(demo-stack): migratiecontrole/auto-fix bij het opstarten

Voorkomt dat de demo-database stilzwijgend achterloopt op de
repo-migraties (gemeten 21-08: 7 migraties achter, gaf een misleidende
500-fout). Hergebruikt migratiestand.js en migrate.js, geen nieuwe
vergelijkingslogica."
```

---

### Task 2: Expliciete frontend-branch-parameter

**Files:**
- Modify: `scripts/demo-stack.js`

- [ ] **Step 1: Voeg de branch-wissel-functie toe**

Voeg toe, na `frontendStarten()` (rond regel 381 in het origineel):

```javascript
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
```

- [ ] **Step 2: Roep de functie aan in `start()`, vóór het starten van de frontend**

Zoek:

```javascript
  console.log('\n4/5  Frontend starten');

  const frontend = frontendStarten();
```

Vervang door:

```javascript
  console.log('\n4/5  Frontend starten');

  const branchWissel = frontendBranchWisselen(frontendBranch);

  if (!branchWissel.ok) {
    console.error(`\nGestopt: ${branchWissel.reden}`);
    return false;
  }

  const frontend = frontendStarten();
```

- [ ] **Step 3: Geef `frontendBranch` door aan `start()`**

Zoek de functiehandtekening van `start`:

```javascript
function start(vers) {
```

Vervang door:

```javascript
function start(vers, frontendBranch) {
```

- [ ] **Step 4: Lees de nieuwe vlag uit `main()`**

Zoek in `main()`:

```javascript
  const uitkomst =
    opdracht === 'af'
      ? af()
      : opdracht === 'status'
        ? status()
        : opdracht === 'test'
          ? test()
          : start(argumenten.includes('--vers'));
```

Vervang door:

```javascript
  const branchIndex = argumenten.indexOf('--branch');
  const frontendBranch =
    branchIndex !== -1 ? argumenten[branchIndex + 1] : undefined;

  const uitkomst =
    opdracht === 'af'
      ? af()
      : opdracht === 'status'
        ? status()
        : opdracht === 'test'
          ? test()
          : start(argumenten.includes('--vers'), frontendBranch);
```

- [ ] **Step 5: Werk de gebruiksaanwijzing bovenaan het bestand bij**

Zoek het commentaarblok met "Gebruik:" (rond regel 36-41 in het origineel):

```javascript
 * Gebruik:
 *   npm run demo            opzetten (data blijft staan)
 *   npm run demo -- --vers  database eerst weggooien en opnieuw opbouwen
 *   npm run demo:af         backend en frontend stoppen, database laten staan
 *   npm run demo:status     draait het, en wat zit erin?
 */
```

Vervang door:

```javascript
 * Gebruik:
 *   npm run demo                       opzetten (data blijft staan)
 *   npm run demo -- --vers             database eerst weggooien en opnieuw opbouwen
 *   npm run demo -- --branch <naam>    eerst deze branch uitchecken in MCM2-frontend
 *   npm run demo:af                    backend en frontend stoppen, database laten staan
 *   npm run demo:status                draait het, en wat zit erin?
 */
```

- [ ] **Step 6: Draai een snelle syntaxcontrole**

```bash
cd C:/DEV/Work/MCM2
node --check scripts/demo-stack.js
```

Expected: geen output (een syntaxfout zou een `SyntaxError` met bestand en
regelnummer tonen).

- [ ] **Step 7: Commit**

```bash
cd C:/DEV/Work/MCM2
git add scripts/demo-stack.js
git commit -m "feat(demo-stack): expliciete frontend-branch-parameter (--branch)

Voorkomt de onopgemerkte branch-mismatch van 2026-08-21: de frontend
startte altijd vanuit wat er toevallig in MCM2-frontend stond
uitgecheckt. Zonder --branch verandert er niets aan het bestaande
gedrag."
```

---

### Task 3: Altijd tonen welke branch/commit er draait

**Files:**
- Modify: `scripts/demo-stack.js`

- [ ] **Step 1: Voeg een functie toe die branch + commit + boodschap ophaalt**

Voeg toe, na `frontendBranchWisselen` (Task 2):

```javascript
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
```

- [ ] **Step 2: Toon de branch-info in de afsluitende samenvatting**

Zoek in `start()` het blok waar de vragenlijsten worden opgesomd:

```javascript
  console.log(`  Ingelogd als ${sessie.naam} (admin).`);
  console.log(`  De backend gaf ${keten.lijsten.length} vragenlijst(en) terug:`);

  for (const lijst of keten.lijsten) {
    console.log(
      `    ${lijst.name} v${lijst.version} — ${lijst.aantalVragen} vragen, ${lijst.aantalRondes} ronde(s)`,
    );
  }
```

Voeg direct erna toe:

```javascript

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
```

- [ ] **Step 3: Draai een snelle syntaxcontrole**

```bash
cd C:/DEV/Work/MCM2
node --check scripts/demo-stack.js
```

Expected: geen output.

- [ ] **Step 4: Commit**

```bash
cd C:/DEV/Work/MCM2
git add scripts/demo-stack.js
git commit -m "feat(demo-stack): toon altijd welke branch/commit er draait

Onafhankelijk van --branch. Lost de zichtbaarheidshelft op van de
branch-mismatch van 2026-08-21: een mens kan nu zonder zelf git te
raadplegen zien wat de demo-stack precies toont."
```

---

### Task 4: Verificatie — daadwerkelijk draaien, met en zonder --branch

**Files:** geen nieuwe — dit is de afsluitende controle.

- [ ] **Step 1: Zorg dat er geen demo-stack draait**

```bash
cd C:/DEV/Work/MCM2
npm run demo:status
```

Draait er nog iets (van een vorige sessie), stop het eerst:

```bash
npm run demo:af
```

- [ ] **Step 2: Start zonder --branch, controleer het bestaande gedrag blijft werken**

```bash
cd C:/DEV/Work/MCM2
npm run demo
```

Expected: de bestaande 5 stappen doorlopen zoals voorheen, plus:
- een regel die meldt of de migraties bijgewerkt zijn (of niets, als de
  demo-database al up-to-date was)
- twee nieuwe regels onderaan de samenvatting: `Backend: ...` en
  `Frontend: ...`, met de daadwerkelijke branch/commit van dit moment

- [ ] **Step 3: Stop, en start opnieuw met --branch naar een niet-main-branch**

Kies een bestaande branch in `MCM2-frontend` om mee te testen (bijvoorbeeld
een oude, al gemergede branch is ongeschikt — gebruik een branch die nog
bestaat). Als er op dit moment geen losse frontend-branch bestaat, maak er
eerst een aan om te verifiëren:

```bash
cd C:/DEV/Work/MCM2
npm run demo:af

cd C:/DEV/Work/MCM2-frontend
git checkout -b tijdelijke-testbranch-voor-verificatie
git checkout main

cd C:/DEV/Work/MCM2
npm run demo -- --branch tijdelijke-testbranch-voor-verificatie
```

Expected: de frontend-map wisselt daadwerkelijk naar
`tijdelijke-testbranch-voor-verificatie` (te bevestigen met
`git -C C:/DEV/Work/MCM2-frontend branch --show-current` in een aparte
terminal, of aan de `Frontend: ...`-regel in de samenvatting), en de demo
start normaal door.

- [ ] **Step 4: Test de foutmelding bij een niet-bestaande branch**

```bash
cd C:/DEV/Work/MCM2
npm run demo:af
npm run demo -- --branch deze-branch-bestaat-niet
```

Expected: het script stopt bij stap "4/5 Frontend starten" met een
duidelijke foutmelding die de branchnaam noemt, in plaats van door te gaan
of een onduidelijke git-foutmelding door te geven.

- [ ] **Step 5: Ruim de testbranch op**

```bash
cd C:/DEV/Work/MCM2-frontend
git branch -d tijdelijke-testbranch-voor-verificatie
```

- [ ] **Step 6: Stop de demo-stack**

```bash
cd C:/DEV/Work/MCM2
npm run demo:af
```

---

### Task 5: Branch, push, PR

**Files:** geen nieuwe.

- [ ] **Step 1: Push de branch**

```bash
cd C:/DEV/Work/MCM2
git push -u origin <branchnaam>
```

(De branchnaam volgt uit hoe deze taken zijn uitgevoerd — als alle
voorgaande commits al op een feature branch staan, is dit een gewone push;
zo niet, maak eerst een branch vanaf de huidige stand aan met
`git checkout -b feat/165-demo-preview-branch`.)

- [ ] **Step 2: Maak de PR aan**

```bash
cd C:/DEV/Work/MCM2
gh pr create --repo AlingAdvies/MCM2 \
  --base main --head <branchnaam> \
  --title "feat(demo-stack): expliciete branch-keuze en migratiecontrole" \
  --body "Implementeert MCM2#165 volgens docs/superpowers/specs/2026-08-21-demo-preview-branch-design.md.

## Wat er verandert
- npm run demo -- --branch <naam>: expliciete frontend-branch-keuze i.p.v. impliciet wat toevallig uitgecheckt staat
- Altijd tonen welke branch/commit er in beide repo's draait, ook zonder --branch
- Migratiecontrole/auto-fix van de demo-database bij het opstarten (hergebruikt migratiestand.js en migrate.js)

## Verificatie
- Gedraaid zonder --branch: bestaand gedrag intact, nieuwe branch-info zichtbaar in de samenvatting
- Gedraaid met --branch naar een bestaande branch: frontend wisselt daadwerkelijk
- Gedraaid met --branch naar een niet-bestaande branch: duidelijke foutmelding, geen doorstart

Fixes AlingAdvies/MCM2#165

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-review — uitgevoerd bij het schrijven van dit plan

**Spec coverage:**
- Expliciete branch-parameter (`--branch`) → Task 2. ✅
- Backend wisselt nooit automatisch mee → Task 2 raakt alleen
  `frontendBranchWisselen`, geen equivalent voor de backend. ✅
- Altijd tonen welke branch/commit draait, ook zonder `--branch` → Task 3,
  onafhankelijk van de `--branch`-vlag aangeroepen. ✅
- Waarschuwing als backend niet op `main` staat → Task 3, Step 2
  (`if (backendInfo.branch !== 'main')`). ✅
- Migratiecontrole/auto-fix, met verificatie ná de migratie (niet de
  melding vertrouwen) → Task 1, Step 2 (`eerste` → conditioneel migreren →
  `tweede` als herbevestiging). ✅
- Geen wijziging aan `.github/workflows/*`, geen wijziging aan het
  OTAP-ketenschema → bevestigd: geen enkele taak raakt bestanden buiten
  `scripts/demo-stack.js`. ✅
- Geen wijziging aan het `#`-linkmechanisme → bevestigd: geen taak raakt
  `sessieMaken()` of de link-opbouw onderaan `start()`. ✅

**Placeholder scan:** geen "TBD"/"implementeer later"/"voeg validatie toe"
zonder concrete invulling aangetroffen bij herlezen.

**Type consistency:** `migratieBijwerken()` geeft altijd `{ ok, reden? }`
of `{ ok, bijgewerkt }` terug — consistent met het bestaande
resultaatpatroon van elke andere functie in dit bestand
(`{ ok: boolean, reden?: string }`). `frontendBranchWisselen()` en
`huidigeBranchInfo()` volgen hetzelfde patroon. Geen naamsafwijking tussen
waar een functie gedefinieerd wordt en waar hij aangeroepen wordt
(gecontroleerd: `migratieBijwerken`, `frontendBranchWisselen`,
`huidigeBranchInfo` — elke aanroep in Task 1–3 gebruikt exact de naam uit
de bijbehorende definitiestap).
