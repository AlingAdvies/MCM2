# Telegram-melding bij geaccepteerde tenant-uitnodiging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een nieuw, los script dat elk uur (via Windows Taakplanner) controleert of er nieuwe actieve leden zijn bijgekomen bij de tenant "Transdev Nederland" op productie, en daarvan een Telegram-bericht stuurt.

**Architecture:** `scripts/uitnodiging-controle.js` leest read-only uit productie (`PRODUCTIE_RUNTIME_URL`, rol `clm_api_runtime`), vergelijkt de huidige lijst actieve `user_id`'s van de tenant met een lokaal bewaarde lijst uit de vorige run, en stuurt via het bestaande `scripts/telegram.js` één bericht per nieuw actief lid. De vergelijkingslogica staat in een apart, puur functioneel bestand zodat hij zonder database getest kan worden.

**Tech Stack:** Node.js (CommonJS, zelfde stijl als de overige `scripts/*.js`), `pg` voor de databaseverbinding, het bestaande `scripts/telegram.js` en `scripts/db-doelwit.js`.

---

## File Structure

- **Create:** `scripts/uitnodiging-nieuwe-leden.js` — pure functie: gegeven de vorige en de huidige lijst `user_id`'s, bepaal welke nieuw zijn. Geen database, geen Telegram, geen I/O.
- **Create:** `scripts/uitnodiging-nieuwe-leden.spec.js` — Jest-test voor die pure functie (dit bestand leent zich, anders dan de overige `scripts/*.js`, voor een Jest-test omdat het geen database/netwerk aanraakt).
- **Create:** `scripts/uitnodiging-controle.js` — het orkestrerende script: leest `.env`, verbindt met productie, haalt de tenant en de actieve leden op, roept de pure functie aan, verstuurt Telegram-berichten, leest/schrijft de statusfile.
- **Modify:** `package.json` — nieuw script `"uitnodiging:controle": "node scripts/uitnodiging-controle.js"`.
- **Modify:** `docs/runbooks/README.md` — nieuwe rij in de tabel "Routineoperaties" (Type D, wekelijks/uurlijks terugkerend).
- **Create:** `docs/runbooks/uitnodigingscontrole.md` — kort runbook (Type D) met de Taakplanner-instellingen, zodat de eigenaar de taak zelf kan inrichten en dit terugvindt bij een volgende sessie.

---

### Task 1: Pure vergelijkingsfunctie

**Files:**
- Create: `scripts/uitnodiging-nieuwe-leden.js`
- Test: `scripts/uitnodiging-nieuwe-leden.spec.js`

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/uitnodiging-nieuwe-leden.spec.js
const { bepaalNieuweLeden } = require('./uitnodiging-nieuwe-leden');

describe('bepaalNieuweLeden', () => {
  it('herkent een lid dat er bij de vorige run nog niet bij stond', () => {
    const vorige = new Set(['a']);
    const huidige = [
      { userId: 'a', naam: 'Bestaand', email: 'a@x.nl', rol: 'lezer' },
      { userId: 'b', naam: 'Nieuw', email: 'b@x.nl', rol: 'beheerder' },
    ];

    const resultaat = bepaalNieuweLeden(vorige, huidige);

    expect(resultaat).toEqual([
      { userId: 'b', naam: 'Nieuw', email: 'b@x.nl', rol: 'beheerder' },
    ]);
  });

  it('geeft een lege lijst als er niets nieuw is', () => {
    const vorige = new Set(['a', 'b']);
    const huidige = [
      { userId: 'a', naam: 'A', email: 'a@x.nl', rol: 'lezer' },
      { userId: 'b', naam: 'B', email: 'b@x.nl', rol: 'lezer' },
    ];

    expect(bepaalNieuweLeden(vorige, huidige)).toEqual([]);
  });

  it('behandelt een lege vorige lijst als eerste run: alles is "nieuw"', () => {
    const vorige = new Set();
    const huidige = [
      { userId: 'a', naam: 'A', email: 'a@x.nl', rol: 'lezer' },
    ];

    // Bewuste keuze (spec: "Kapotte/onleesbare lokale statusfile wordt
    // behandeld als lege lijst"): een lege vorige-lijst levert altijd alle
    // huidige leden op als "nieuw". De aanroeper (Task 3) onderdrukt
    // berichten bij een allereerste run apart, niet deze functie.
    expect(bepaalNieuweLeden(vorige, huidige)).toEqual([
      { userId: 'a', naam: 'A', email: 'a@x.nl', rol: 'lezer' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest scripts/uitnodiging-nieuwe-leden.spec.js`
Expected: FAIL — `Cannot find module './uitnodiging-nieuwe-leden'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// scripts/uitnodiging-nieuwe-leden.js
// Pure functie, los van database en Telegram — zodat de kernlogica
// (wat is "nieuw"?) zonder netwerk of state getest kan worden.
//
// @param {Set<string>} vorigeUserIds - user_id's die de vorige run al zag.
// @param {{userId: string, naam: string, email: string, rol: string}[]} huidigeLeden
// @returns {{userId: string, naam: string, email: string, rol: string}[]}
function bepaalNieuweLeden(vorigeUserIds, huidigeLeden) {
  return huidigeLeden.filter((lid) => !vorigeUserIds.has(lid.userId));
}

module.exports = { bepaalNieuweLeden };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest scripts/uitnodiging-nieuwe-leden.spec.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/uitnodiging-nieuwe-leden.js scripts/uitnodiging-nieuwe-leden.spec.js
git commit -m "feat(uitnodigingscontrole): pure vergelijkingsfunctie voor nieuwe actieve leden

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Statusfile lezen/schrijven

**Files:**
- Create: `scripts/uitnodiging-status.js`
- Test: `scripts/uitnodiging-status.spec.js`

Deze module isoleert de bestandslogica (lezen/schrijven van de lokale
"welke user_id's kende ik al"-lijst) zodat Task 3 alleen hoeft te
orkestreren, en zodat "kapotte statusfile → lege lijst" apart getest kan
worden zonder een echte homedir aan te raken.

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/uitnodiging-status.spec.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { leesGezienIds, schrijfGezienIds } = require('./uitnodiging-status');

describe('uitnodiging-status', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uitnodiging-status-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('geeft een lege Set als het bestand nog niet bestaat (eerste run)', () => {
    const pad = path.join(tmpDir, 'gezien.json');
    expect(leesGezienIds(pad)).toEqual(new Set());
  });

  it('geeft een lege Set als het bestand kapotte JSON bevat', () => {
    const pad = path.join(tmpDir, 'gezien.json');
    fs.writeFileSync(pad, '{ dit is geen json');
    expect(leesGezienIds(pad)).toEqual(new Set());
  });

  it('rondtrip: schrijven en teruglezen levert dezelfde ids op', () => {
    const pad = path.join(tmpDir, 'gezien.json');
    schrijfGezienIds(pad, new Set(['a', 'b', 'c']));
    expect(leesGezienIds(pad)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('maakt de bovenliggende map aan als die nog niet bestaat', () => {
    const pad = path.join(tmpDir, 'nog-niet-bestaand', 'gezien.json');
    schrijfGezienIds(pad, new Set(['x']));
    expect(leesGezienIds(pad)).toEqual(new Set(['x']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest scripts/uitnodiging-status.spec.js`
Expected: FAIL — `Cannot find module './uitnodiging-status'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// scripts/uitnodiging-status.js
// Bewaart welke user_id's het script al eerder als "actief" zag, in een
// klein JSON-bestand op de laptop. Geen inhaalslag, geen historie — alleen
// de laatst geziene stand (spec: "mag missen").
const fs = require('fs');
const path = require('path');

/**
 * @param {string} pad
 * @returns {Set<string>} lege Set als het bestand ontbreekt of kapot is —
 *   dat is bewust geen fout: een kapotte/ontbrekende statusfile betekent
 *   hooguit dat de eerstvolgende run alle huidige leden als "nieuw" ziet.
 */
function leesGezienIds(pad) {
  try {
    const ruw = fs.readFileSync(pad, 'utf8');
    const lijst = JSON.parse(ruw);
    if (!Array.isArray(lijst)) return new Set();
    return new Set(lijst);
  } catch {
    return new Set();
  }
}

/**
 * @param {string} pad
 * @param {Set<string>} ids
 */
function schrijfGezienIds(pad, ids) {
  fs.mkdirSync(path.dirname(pad), { recursive: true });
  fs.writeFileSync(pad, JSON.stringify([...ids], null, 2));
}

module.exports = { leesGezienIds, schrijfGezienIds };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest scripts/uitnodiging-status.spec.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/uitnodiging-status.js scripts/uitnodiging-status.spec.js
git commit -m "feat(uitnodigingscontrole): lokale statusfile voor eerder geziene leden

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Het orkestrerende script

**Files:**
- Create: `scripts/uitnodiging-controle.js`
- Modify: `package.json`

Dit script raakt een echte (productie-)database aan en is daarom niet met
Jest getest — zelfde conventie als `scripts/backup-controle.js` en de
overige orkestrerende scripts in deze map. De correctheid ervan leunt op de
al-geteste modules uit Task 1 en 2, plus een handmatige proef (Task 4).

- [ ] **Step 1: Schrijf het script**

```javascript
#!/usr/bin/env node
// Meldt via Telegram wanneer een uitgenodigd lid van Transdev Nederland voor
// het eerst inlogt (en daarmee 'actief' wordt op beheer/leden).
//
// ── Waarom dit bestaat ──────────────────────────────────────────────────────
//
// Op beheer/leden is per lid te zien of een uitnodiging nog openstaat of is
// geaccepteerd, maar er is geen melding op het moment zelf — de eigenaar
// moest daarvoor zelf het scherm openen.
//
// ── Waarom dit los draait van de backend ────────────────────────────────────
//
// De acceptatie zelf gebeurt in een SECURITY DEFINER-databasefunctie
// (sessie_aanmaken()), niet in makkelijk uit te breiden applicatiecode. Een
// melding vanuit de server zou een nieuw Telegram-secret op zowel saxombp als
// AWS vragen. Dit script hergebruikt in plaats daarvan het bestaande
// laptop+Telegram-patroon van backup-controle.js: minder ingrijpend, en
// realtime is voor dit doel niet nodig (besluit eigenaar, 2026-09-02).
//
// ── Scope: alleen Transdev Nederland, alleen productie ──────────────────────
//
// Zie docs/superpowers/specs/2026-09-02-telegram-uitnodigingscontrole-design.md
//
// ── Gebruik ─────────────────────────────────────────────────────────────────
//
//   node scripts/uitnodiging-controle.js
//
// Geen productie-schrijfrem (--extern) nodig: dit script leest alleen (SELECT),
// tegen een bewust gekozen, altijd-productie doelwit. meldDoelwit() blijft wel
// verplicht, zodat de uitvoer altijd toont welke database geraakt is.

require('dotenv').config();

const os = require('os');
const path = require('path');
const { Client } = require('pg');

const { meldDoelwit } = require('./db-doelwit');
const { Telegram } = require('./telegram');
const { bepaalNieuweLeden } = require('./uitnodiging-nieuwe-leden');
const { leesGezienIds, schrijfGezienIds } = require('./uitnodiging-status');

const PROJECT_DIR = path.resolve(__dirname, '..');
const TENANT_NAAM = 'Transdev Nederland';
const STATUS_PAD = path.join(
  os.homedir(),
  '.mcm2-uitnodigingscontrole',
  'gezien.json',
);

const ROL_LABEL = {
  admin: 'beheerder',
  lezer: 'lezer',
};

async function haalActieveLeden(client, tenantNaam) {
  const tenantRij = await client.query(
    'SELECT tenant_id FROM clm.tenant WHERE name = $1',
    [tenantNaam],
  );

  if (tenantRij.rows.length === 0) {
    throw new Error(`Tenant '${tenantNaam}' niet gevonden.`);
  }

  const tenantId = tenantRij.rows[0].tenant_id;

  // Zelfde statuslogica als TenantLedenService.lijst()
  // (src/tenant/tenant-leden.service.ts): uitnodiging_hash IS NULL
  // betekent geaccepteerd/actief.
  const { rows } = await client.query(
    `SELECT u.user_id, u.full_name, u.email, m.role
       FROM clm.tenant_membership m
       JOIN clm."user" u ON u.user_id = m.user_id
      WHERE m.tenant_id = $1
        AND m.deleted_at IS NULL
        AND m.role <> 'support'
        AND u.uitnodiging_hash IS NULL`,
    [tenantId],
  );

  return rows.map((r) => ({
    userId: r.user_id,
    naam: r.full_name,
    email: r.email,
    rol: r.role,
  }));
}

function berichtVoor(lid) {
  const rolLabel = ROL_LABEL[lid.rol] ?? lid.rol;
  return (
    `✅ Nieuw lid actief bij ${TENANT_NAAM}\n` +
    `${lid.naam} (${lid.email}) — rol: ${rolLabel}`
  );
}

async function main() {
  const url = process.env.PRODUCTIE_RUNTIME_URL;

  if (!url) {
    console.error(
      'PRODUCTIE_RUNTIME_URL ontbreekt in .env. Dit script leest altijd ' +
        'productie — zonder dat adres kan het niets controleren.',
    );
    process.exitCode = 1;
    return;
  }

  meldDoelwit(url, 'Uitnodigingscontrole');

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30_000,
  });

  let leden;
  try {
    await client.connect();
    leden = await haalActieveLeden(client, TENANT_NAAM);
  } catch (err) {
    // Bewust geen Telegram-bericht bij een verbindingsfout (spec: geen ruis
    // bij een offline laptop of een gepauzeerde Supabase-database — dat
    // risico wordt al elders bewaakt).
    console.error(`Uitnodigingscontrole mislukt: ${err.message}`);
    process.exitCode = 1;
    return;
  } finally {
    await client.end().catch(() => {});
  }

  const vorige = leesGezienIds(STATUS_PAD);
  const nieuw = bepaalNieuweLeden(vorige, leden);

  const isEersteRun = vorige.size === 0;
  const telegram = new Telegram({
    projectDir: PROJECT_DIR,
    statusDir: path.dirname(STATUS_PAD),
  });

  if (isEersteRun) {
    // Bij de allereerste run staan alle huidige leden per definitie "nieuw"
    // in bepaalNieuweLeden() — zonder deze uitzondering zou de eerste keer
    // draaien een stortvloed aan berichten opleveren voor leden die al lang
    // actief waren.
    console.log(
      `Eerste run: ${leden.length} lid(leden) vastgelegd, geen Telegram-bericht.`,
    );
  } else {
    for (const lid of nieuw) {
      // eslint-disable-next-line no-await-in-loop -- berichten moeten in
      // volgorde en na elkaar verstuurd worden, niet gelijktijdig.
      await telegram.verstuur(berichtVoor(lid));
      console.log(`Gemeld: ${lid.naam} (${lid.email})`);
    }
    if (nieuw.length === 0) {
      console.log('Geen nieuwe actieve leden sinds de vorige controle.');
    }
  }

  schrijfGezienIds(
    STATUS_PAD,
    new Set(leden.map((l) => l.userId)),
  );
}

main().catch((err) => {
  console.error('Uitnodigingscontrole mislukt:', err.message);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Voeg het npm-script toe**

Open `package.json`, zoek de bestaande regel:

```json
    "backup:controle:test": "node scripts/backup-controle.js --test",
```

Voeg er direct na toe:

```json
    "uitnodiging:controle": "node scripts/uitnodiging-controle.js",
```

- [ ] **Step 3: Controleer dat het script zonder crash draait tegen een lege/ontbrekende configuratie**

Run: `node scripts/uitnodiging-controle.js`

Expected (met een geldige `PRODUCTIE_RUNTIME_URL` in `.env`, wat al het
geval is): het script verbindt, meldt het doelwit
(`Uitnodigingscontrole: aws-1-eu-west-1.pooler.supabase.com:5432/postgres
als rol 'clm_api_runtime' [NIET-LOKAAL]`), en meldt vervolgens ofwel
"Eerste run: N lid(leden) vastgelegd" (de allereerste keer) of "Geen nieuwe
actieve leden sinds de vorige controle." (bij een tweede achtereenvolgende
run zonder tussentijdse wijziging). Geen crash, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/uitnodiging-controle.js package.json
git commit -m "feat(uitnodigingscontrole): orkestrerend script, meldt nieuwe actieve leden via Telegram

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Handmatige proef tegen productie

Dit is geen geautomatiseerde stap — de spec vraagt expliciet om een
handmatige proef vóórdat de geplande taak wordt ingesteld (spec §Testen).
Voer dit uit als losse actie, niet als onderdeel van een testbestand.

- [ ] **Step 1: Draai het script een eerste keer om de nulstand vast te leggen**

Run: `npm run uitnodiging:controle`
Expected: "Eerste run: N lid(leden) vastgelegd, geen Telegram-bericht."
(N = huidig aantal actieve leden bij Transdev Nederland op productie).

- [ ] **Step 2: Nodig een tijdelijk testadres uit bij Transdev Nederland op productie**

Dit gebeurt via het bestaande scherm `beheer/leden` op productie
(`clm.alingadvies.nl`, ingelogd als beheerder van Transdev Nederland) — niet
via een los script. Gebruik een adres dat de eigenaar zelf kan accepteren
(bijv. een alias van `cmaling@hotmail.com` of een tweede eigen mailbox).

- [ ] **Step 3: Accepteer de uitnodiging (klik de link, log in)**

- [ ] **Step 4: Draai het script opnieuw**

Run: `npm run uitnodiging:controle`
Expected: precies één regel "Gemeld: <naam> (<email>)", en een Telegram-
bericht met tekst in de vorm:

```
✅ Nieuw lid actief bij Transdev Nederland
<naam> (<email>) — rol: <rol>
```

- [ ] **Step 5: Draai het script een derde keer zonder tussentijdse wijziging**

Run: `npm run uitnodiging:controle`
Expected: "Geen nieuwe actieve leden sinds de vorige controle." — geen
tweede Telegram-bericht voor hetzelfde lid.

- [ ] **Step 6: Ruim het testlid weer op**

Trek de uitnodiging/het lidmaatschap in via `beheer/leden` (bestaande
"intrekken"-actie), zodat er geen testaccount blijft hangen op de echte
Transdev-tenant.

---

### Task 5: Runbook en documentatie-index

**Files:**
- Create: `docs/runbooks/uitnodigingscontrole.md`
- Modify: `docs/runbooks/README.md`

- [ ] **Step 1: Schrijf het runbook**

```markdown
# Runbook — Telegram-melding bij nieuwe actieve leden (Transdev Nederland)

**Type:** D — routineoperatie
**Eigenaar:** de eigenaar (Chris)
**Laatste update:** 2026-09-02
**Vereiste toegang:** deze PC, de bestaande Telegram-bot (zie
`backupcontrole.md`), `.env` met `PRODUCTIE_RUNTIME_URL`

## Waarvoor

Meldt via Telegram zodra een uitgenodigd lid van de tenant "Transdev
Nederland" op productie voor het eerst inlogt (en daarmee `actief` wordt op
`beheer/leden`). Zie
`docs/superpowers/specs/2026-09-02-telegram-uitnodigingscontrole-design.md`
voor het ontwerp en de afweging tegen een realtime serveroplossing.

**Alleen Transdev Nederland, alleen productie.** Andere tenants en andere
omgevingen worden bewust niet gemeld.

## Taakplanner instellen (eenmalig)

1. Open Taakplanner → **Taak maken** (niet "Eenvoudige taak").
2. **Algemeen:** naam `MCM2 tenant-uitnodigingscontrole`. "Uitvoeren of de
   gebruiker nu is aangemeld of niet" — zelfde keuze als de bestaande
   backup-taken.
3. **Triggers:** nieuw → Elke dag herhalen, Herhaal taak elke: **1 uur**,
   gedurende: **onbeperkt**.
4. **Acties:** nieuw → Programma: `node`, Argumenten:
   `scripts/uitnodiging-controle.js`, Starten in:
   `C:\DEV\Work\MCM2` (of het actuele pad van deze repository).
5. **Voorwaarden:** "Alleen starten indien op netvoeding" uitzetten (laptop
   draait ook op batterij), zelfde als de backup-taken.

## Wat je ziet

- Een Telegram-bericht per nieuw actief lid:
  `✅ Nieuw lid actief bij Transdev Nederland` gevolgd door naam, e-mail en
  rol.
- **Geen bericht** bij: de allereerste keer draaien (nulstand), een
  onbereikbare database (bijv. laptop offline, of Supabase gepauzeerd), of
  wanneer er simpelweg niemand nieuw is.

## Bij afwijking

| Situatie | Betekenis | Actie |
|---|---|---|
| Geen berichten al een tijd, maar je verwachtte er wel een | De taak draait niet, of de database is onbereikbaar | Vraag Claude: "draai de uitnodigingscontrole handmatig en laat de uitvoer zien" |
| `Tenant 'Transdev Nederland' niet gevonden` | De tenant is hernoemd of bestaat niet meer op productie | Vraag Claude de tenantnaam in het script bij te werken |
| Telegram-bericht blijft uit ondanks een geslaagde run | Telegram-configuratie ontbreekt of is verlopen | Zie `backupcontrole.md` §Telegram-regels — zelfde bot, zelfde configuratie |

## Lokale status

Het script onthoudt welke leden het al zag in
`%USERPROFILE%\.mcm2-uitnodigingscontrole\gezien.json`. Dat bestand
verwijderen forceert een nieuwe "eerste run" (nulstand, geen berichten) bij
de eerstvolgende keer draaien.
```

- [ ] **Step 2: Voeg de rij toe aan de runbook-index**

Open `docs/runbooks/README.md`, zoek de tabel onder "Routineoperaties —
dingen die terugkeren", en voeg een rij toe direct na de bestaande
`zelf-testen.md`-rij:

```markdown
| [uitnodigingscontrole.md](uitnodigingscontrole.md) | Telegram-melding bij een nieuw actief lid van Transdev Nederland op productie | elk uur, automatisch |
```

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/uitnodigingscontrole.md docs/runbooks/README.md
git commit -m "docs(uitnodigingscontrole): runbook en index-vermelding

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Alleen Transdev Nederland, alleen productie → Task 3 (`TENANT_NAAM`
  constante, `PRODUCTIE_RUNTIME_URL`).
- Elk uur via Taakplanner → Task 5 (runbook-instructies).
- Mag missen, geen ruis bij offline laptop → Task 3 Step 1 (geen
  Telegram-bericht bij verbindingsfout).
- Geen inhaalslag → Task 2 (statusfile bewaart alleen de laatste stand, geen
  historie).
- Bericht met naam, e-mail, tenant, rol → Task 3 (`berichtVoor()`).
- Tenant via naam, niet hardcoded UUID → Task 3
  (`haalActieveLeden(client, tenantNaam)`).
- `meldDoelwit()` verplicht, geen `eisOnbeschermdeDatabase()` → Task 3 Step 1.
- npm-script conform "verzin nooit een commando" → Task 3 Step 2.
- Handmatige proef vóór de geplande taak → Task 4.

Geen ontbrekend onderdeel van de spec gevonden.

**Placeholder scan:** geen TBD/TODO, alle codeblokken zijn compleet en
uitvoerbaar.

**Type consistency:** `bepaalNieuweLeden(vorigeUserIds, huidigeLeden)` in
Task 1 en het gebruik ervan in Task 3 (`bepaalNieuweLeden(vorige, leden)`)
komen overeen in signatuur en veldnamen (`userId`, `naam`, `email`, `rol`).
`leesGezienIds`/`schrijfGezienIds` in Task 2 en het gebruik in Task 3 komen
overeen.
