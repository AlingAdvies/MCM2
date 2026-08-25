# Onafhankelijke productiebackup op saxombp — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** de productiedatabase wordt dagelijks, onafhankelijk van de ontwikkellaptop, gedumpt
op `saxombp` (via cron, rechtstreeks tegen Supabase) — met de bestaande Telegram-controle
uitgebreid zodat een storing op saxombp net zo zichtbaar wordt als een storing op de laptop.

**Architecture:** een nieuw bash-script (`scripts/saxombp-backup-productie.sh`) draait volledig
op saxombp zelf, in dezelfde vorm als het bestaande `scripts/backup-dump.js` (Docker
`postgres:17.6`-image, dezelfde schema's/vlaggen). `scripts/backup-controle.js` krijgt een
losse, gedempte controle (eigen sleutel `saxombp`) die via SSH (dezelfde vorm als
`verify-omgevingen.js`) de dumpmap op saxombp uitleest. Uitvoerende stappen op saxombp zelf
(map aanmaken, credential neerzetten, cron inrichten) gebeuren via de root-SSH-verbinding die
al werkt.

**Tech Stack:** Bash (op saxombp, Ubuntu 22.04), Docker, cron. Node.js (bestaande
backup-controle.js, ongewijzigd platform: Windows-laptop).

---

## Spec-referentie

Dit plan implementeert `docs/superpowers/specs/2026-08-25-saxombp-productiebackup-design.md`
§1 t/m §6, §8 en §9 volledig. §7 (uitfasering van de laptoptaak) is **bewust buiten scope** —
zie Task 6, die alleen de niet-geautomatiseerde eindstap documenteert, zonder de laptoptaak
zelf aan te raken.

---

## Voorafgaand aan Task 1 — wat al geverifieerd is

Tijdens het brainstormen is al bevestigd (niet opnieuw te doen, wel te weten):

- `ssh -o BatchMode=yes -o ConnectTimeout=15 root@saxombp "..."` werkt vandaag.
- Saxombp heeft Docker (`Docker version 29.1.3`), geen Node.js, wel uitgaand internet naar
  `supabase.com` (HTTP 200).
- Er staat nog geen crontab voor root op saxombp (`crontab -l` gaf "no crontab for root").
- Het productiewachtwoord staat in de lokale `.env` van de eigenaar onder
  `BACKUP_DATABASE_URL` (rol `postgres`, BYPASSRLS, tegen
  `aws-1-eu-west-1.pooler.supabase.com`, project `agojesdovwsupidwlevh`).

---

## Task 1: Het dump-script — `scripts/saxombp-backup-productie.sh`

**Files:**
- Create: `scripts/saxombp-backup-productie.sh`

Dit bestand wordt gecommit in de repo (net als `scripts/backup-taak.cmd`) en pas in Task 4
daadwerkelijk naar saxombp gekopieerd. Het bevat GEEN wachtwoord — het leest
`BACKUP_DATABASE_URL` uit een los `.env`-bestand dat pas in Task 4 op saxombp komt te staan.

- [ ] **Step 1: Schrijf het script**

```bash
#!/bin/bash
# =============================================================================
# Dagelijkse productiebackup, draait op saxombp zelf via cron — onafhankelijk
# van de ontwikkellaptop.
#
# Zie docs/superpowers/specs/2026-08-25-saxombp-productiebackup-design.md.
# Parallel aan scripts/backup-dump.js (Windows/Node-versie): zelfde
# pg_dump-vlaggen, zelfde Postgres-image, zelfde schema's, zodat de dump-
# inhoud op dezelfde manier gevalideerd kan worden door
# docs/runbooks/backup-verwachting.json.
#
# Vereist: BACKUP_DATABASE_URL in /opt/mcm2-backup/.env (rechten 600, alleen
# root leesbaar — zie Task 4). Dit script leest dat bestand, nooit
# environment-variabelen die breder zichtbaar zouden kunnen zijn (bv. via
# `ps` of een systemd-unit-omgeving).
#
# Cron-regel (zie Task 4):
#   0 6 * * * /opt/mcm2-backup/saxombp-backup-productie.sh >> /opt/mcm2-backup/backup.log 2>&1
# =============================================================================

set -euo pipefail

BACKUP_ROOT="/opt/mcm2-backup"
ENV_FILE="$BACKUP_ROOT/.env"
DUMP_DIR="$BACKUP_ROOT/dumps"
PG_IMAGE="postgres:17.6"
BEWAARDAGEN=14
MAX_LEEFTIJD_UREN=36

if [ ! -f "$ENV_FILE" ]; then
  echo "FOUT: $ENV_FILE bestaat niet. BACKUP_DATABASE_URL kan niet gelezen worden." >&2
  exit 1
fi

# Alleen deze ene sleutel lezen, niet het bestand 'sourcen' — zelfde
# voorzichtigheid als telegram.js (leesEnvSleutel): een script dat een heel
# .env inleest kan per ongeluk meer prijsgeven dan bedoeld, bijvoorbeeld in
# een set -x-trace of een foutmelding die de omgeving dumpt.
BACKUP_DATABASE_URL=$(grep -E '^BACKUP_DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d'=' -f2-)

if [ -z "$BACKUP_DATABASE_URL" ]; then
  echo "FOUT: BACKUP_DATABASE_URL staat niet in $ENV_FILE." >&2
  exit 1
fi

mkdir -p "$DUMP_DIR"

STEMPEL=$(date -u +"%Y-%m-%dT%H-%M-%S")
BESTANDSNAAM="mcm2-productie-${STEMPEL}.dump"
DOELPAD="$DUMP_DIR/$BESTANDSNAAM"

# ── Waarschuwen als de vorige dump te oud is ────────────────────────────────
# Zelfde signaal als backup-dump.js: dit is het enige teken dat de geplande
# taak heeft stilgelegen, vóórdat backup-controle.js (op de laptop) dat via
# SSH ook opmerkt.
LAATSTE=$(find "$DUMP_DIR" -name 'mcm2-productie-*.dump' -printf '%T@ %f\n' 2>/dev/null | sort -rn | head -1 || true)
if [ -n "$LAATSTE" ]; then
  LAATSTE_TIJD=$(echo "$LAATSTE" | cut -d' ' -f1 | cut -d'.' -f1)
  NU=$(date +%s)
  UREN_OUD=$(( (NU - LAATSTE_TIJD) / 3600 ))
  if [ "$UREN_OUD" -gt "$MAX_LEEFTIJD_UREN" ]; then
    echo "WAARSCHUWING: de vorige dump is meer dan $MAX_LEEFTIJD_UREN uur oud ($UREN_OUD uur)." >&2
  fi
fi

echo "Backup naar $DOELPAD"
START=$(date +%s)

# Zelfde vlaggen als backup-dump.js: --no-owner --no-privileges (de rollen
# uit productie bestaan niet overal waar teruggezet wordt), schema's
# clm/ref/audit (niet het hele cluster).
#
# BACKUP_DATABASE_URL wordt NIET met -e aan de container doorgegeven op een
# manier die in `docker inspect` of proceslijsten van andere gebruikers
# zichtbaar zou zijn buiten wat -e sowieso al doet — dit is dezelfde afweging
# als backup-dump.js al maakte, hier ongewijzigd overgenomen.
if ! docker run --rm \
    -v "$DUMP_DIR:/backup" \
    -e "PGURL=$BACKUP_DATABASE_URL" \
    "$PG_IMAGE" \
    sh -c "pg_dump \"\$PGURL\" --format=custom --no-owner --no-privileges --schema=clm --schema=ref --schema=audit --file=/backup/$BESTANDSNAAM"
then
  echo "Backup MISLUKT — pg_dump gaf een foutcode terug." >&2
  exit 1
fi

if [ ! -s "$DOELPAD" ]; then
  echo "Backup MISLUKT: het bestand is leeg. Dat wijst op een afgebroken dump." >&2
  rm -f "$DOELPAD"
  exit 1
fi

GROOTTE=$(stat -c%s "$DOELPAD")
DUUR=$(( $(date +%s) - START ))
echo "Geslaagd — $((GROOTTE / 1024)) kB in ${DUUR}s."

# ── Oude dumps opruimen ──────────────────────────────────────────────────────
VERWIJDERD=0
while IFS= read -r -d '' BESTAND; do
  rm -f "$BESTAND"
  VERWIJDERD=$((VERWIJDERD + 1))
done < <(find "$DUMP_DIR" -name 'mcm2-productie-*.dump' -mtime "+${BEWAARDAGEN}" -print0)

RESTEREND=$(find "$DUMP_DIR" -name 'mcm2-productie-*.dump' | wc -l)
echo "Bewaard: $RESTEREND dump(s), $VERWIJDERD ouder dan $BEWAARDAGEN dagen verwijderd."
```

- [ ] **Step 2: Maak het script uitvoerbaar in git**

```bash
chmod +x scripts/saxombp-backup-productie.sh
```

Verwacht resultaat: `git diff` toont een mode-wijziging (`old mode 100644` → `new mode
100755`) zodra je dit toevoegt aan de index — controleer met `git add -A -n
scripts/saxombp-backup-productie.sh` dat het bestand wordt opgepikt.

- [ ] **Step 3: Controleer de syntax lokaal (zonder uit te voeren)**

Dit script is bedoeld voor Linux (saxombp) en kan niet functioneel getest worden op de
Windows-ontwikkelmachine. Controleer wél de syntax met `bash -n`, dat werkt ook binnen Git
Bash op Windows:

```bash
bash -n scripts/saxombp-backup-productie.sh
```

Expected: geen output (geen syntaxfout). Een eventuele foutmelding noemt regel en probleem —
herstel die voordat je verder gaat.

- [ ] **Step 4: Commit**

```bash
git add scripts/saxombp-backup-productie.sh
git commit -m "feat(backup): dump-script voor saxombp (issue #58)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `backup-controle.js` uitbreiden met de saxombp-laag

**Files:**
- Modify: `scripts/backup-controle.js`

- [ ] **Step 1: Lees het volledige bestand eerst**

Dit bestand is al gelezen tijdens het schrijven van dit plan (zie de code hierboven onder
"Voorafgaand aan Task 1" voor context) — lees het opnieuw voordat je bewerkt, om de exacte
huidige structuur van `main()` te bevestigen: er kan tussen het schrijven van dit plan en de
uitvoering iets veranderd zijn.

- [ ] **Step 2: Voeg de SSH-constanten en de saxombp-controlefunctie toe**

Voeg toe, na de bestaande constanten (`PROJECT_DIR`, `PG_IMAGE`, `MAX_LEEFTIJD_UREN`,
`backupDir`, rond regel 46-56):

```javascript
const SAXOMBP = 'root@saxombp';
const SAXOMBP_DUMP_DIR = '/opt/mcm2-backup/dumps';

/**
 * Draait een commando op saxombp via SSH. Zelfde vorm als in
 * scripts/verify-omgevingen.js (opServer): BatchMode + ConnectTimeout, geen
 * interactieve prompt mogelijk.
 *
 * Dit is een DOOR EEN MENS GESTARTE controle (de eigenaar draait
 * `npm run backup:controle`, of de geplande laptoktaak doet dat namens
 * hem) — de periodieke Tailscale SSH-herauthenticatie is hier dus geen
 * showstopper zoals bij een onbewaakte cron-taak. Mocht de herauth ooit
 * opnieuw nodig zijn, faalt deze aanroep met een duidelijke fout in plaats
 * van stil te hangen, want BatchMode=yes weigert de interactieve vraag.
 */
function opSaxombp(commando) {
  const res = spawnSync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', SAXOMBP, commando],
    { encoding: 'utf8' },
  );
  return {
    ok: res.status === 0,
    uit: (res.stdout || '').trim(),
    fout: (res.stderr || res.error?.message || '').trim(),
  };
}

/**
 * Controleert de saxombp-productiebackup: bereikbaar? recente dump aanwezig?
 *
 * Twee soorten falen die uit elkaar gehouden moeten worden (spec §6): "saxombp
 * niet bereikbaar" (Tailscale uit, machine down, SSH-time-out) is een ander
 * signaal dan "geen dump gevonden" — hetzelfde onderscheid dat
 * backupcontrole.md al maakt voor "Docker draait niet" versus een echt
 * beschadigde dump. Een bericht dat de verkeerde oorzaak suggereert leert je
 * het te negeren.
 */
function controleerSaxombp() {
  const bereikbaar = opSaxombp('echo ok');
  if (!bereikbaar.ok) {
    return {
      bereikbaar: false,
      bericht:
        `saxombp is niet bereikbaar via SSH.\n${bereikbaar.fout || 'Geen verdere foutmelding.'}\n\n` +
        `Controleer of Tailscale actief is en of saxombp aanstaat.`,
    };
  }

  const lijst = opSaxombp(
    `ls -1 --time-style=+%s ${SAXOMBP_DUMP_DIR} 2>/dev/null | grep '^mcm2-productie-.*\\.dump$' || true`,
  );

  // `ls` zonder -t sorteert alfabetisch; de bestandsnamen bevatten een
  // ISO-achtige tijdstempel (mcm2-productie-YYYY-MM-DDTHH-MM-SS.dump), dus
  // alfabetisch is hier ook chronologisch. Geen aparte sortering nodig.
  const dumps = lijst.uit.split('\n').filter(Boolean);

  if (dumps.length === 0) {
    return {
      bereikbaar: true,
      goed: false,
      bericht: `Geen enkele productiedump gevonden op saxombp (${SAXOMBP_DUMP_DIR}).`,
    };
  }

  const nieuwste = dumps[dumps.length - 1];
  const mtijd = opSaxombp(
    `stat -c%Y ${SAXOMBP_DUMP_DIR}/${nieuwste} 2>/dev/null || true`,
  );
  const tijdSeconden = Number(mtijd.uit);

  if (!Number.isFinite(tijdSeconden) || tijdSeconden === 0) {
    return {
      bereikbaar: true,
      goed: false,
      bericht: `Kon de leeftijd van ${nieuwste} op saxombp niet bepalen.`,
    };
  }

  const urenOud = (Date.now() / 1000 - tijdSeconden) / 3600;
  if (urenOud > MAX_LEEFTIJD_UREN) {
    const leeftijd =
      urenOud >= 24 ? `${Math.floor(urenOud / 24)} dag(en)` : `${Math.floor(urenOud)} uur`;
    return {
      bereikbaar: true,
      goed: false,
      bericht: `De nieuwste productiedump op saxombp is ${leeftijd} oud (${nieuwste}).\nDe cron-taak op saxombp heeft kennelijk stilgelegen.`,
    };
  }

  const leeftijd =
    urenOud >= 1 ? `${Math.floor(urenOud)} uur` : `${Math.round(urenOud * 60)} minuten`;
  return { bereikbaar: true, goed: true, leeftijd, aantal: dumps.length };
}
```

- [ ] **Step 3: Roep `controleerSaxombp()` aan in `main()` en verwerk het resultaat**

Zoek in `main()` de plek direct na het blok dat Laag A (`controleerActualiteit`) afhandelt en
vóór het `dockerDraait()`-blok (rond regel 358-366 in de huidige versie). Voeg daar de
saxombp-controle tussen:

```javascript
  // ── Saxombp — onafhankelijke productiebackup ──────────────────────────────
  //
  // Los van de OneDrive-laag hierboven: dit is een TWEEDE, onafhankelijke
  // backup (spec 2026-08-25-saxombp-productiebackup-design.md). Eigen sleutel
  // ('saxombp'), zodat de demping los werkt van de OneDrive-problemen — een
  // storing op de laptop mag een storing op saxombp niet verbergen en
  // andersom.
  const saxombp = controleerSaxombp();
  if (!saxombp.bereikbaar) {
    problemen.push({ sleutel: 'saxombp', bericht: saxombp.bericht });
  } else if (!saxombp.goed) {
    problemen.push({ sleutel: 'saxombp', bericht: saxombp.bericht });
  } else {
    await telegram.meldHerstel('saxombp', 'de productiebackup op saxombp is weer actueel');
    regels.push(`saxombp: ${saxombp.leeftijd} oud, ${saxombp.aantal} dump(s) bewaard`);
  }
```

- [ ] **Step 4: Compileer/lint-check (Node heeft geen build-stap, maar syntax controleren)**

```bash
node -c scripts/backup-controle.js
```

Expected: geen output (geldige syntax).

- [ ] **Step 5: Test tegen de echte SSH-verbinding (zonder een cron-taak nodig te hebben)**

Op dit punt bestaat `/opt/mcm2-backup/dumps` op saxombp nog niet (dat komt in Task 4) — dus dit
is een test van het FALEN-pad, niet van het slagen-pad. Dat is prima: het bevestigt dat de
foutafhandeling werkt vóórdat er iets op saxombp staat.

```bash
node scripts/backup-controle.js
```

Expected: het script draait door (geen crash), en de console-uitvoer bevat een regel als
`PROBLEEM: Geen enkele productiedump gevonden op saxombp` — dat bewijst dat `controleerSaxombp()`
daadwerkelijk verbinding maakt en een zinnig antwoord teruggeeft, ook al bestaat de map nog
niet. Als de OneDrive-laag zelf ook problemen heeft (onafhankelijk van dit werk), staan die er
gewoon naast — dat is verwacht, niet iets om hier op te lossen.

Als je een `net::ERR` of SSH-timeout-achtige melding ziet in plaats van "Geen enkele
productiedump gevonden": controleer of Tailscale actief is
(`tailscale status` in een los terminalvenster) voordat je verder gaat.

- [ ] **Step 6: Commit**

```bash
git add scripts/backup-controle.js
git commit -m "feat(backup): saxombp-laag in de Telegram-backupcontrole (issue #58)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Documentatie — runbook en ADR-011 bijwerken

**Files:**
- Modify: `docs/runbooks/backupcontrole.md`
- Modify: `docs/adr/ADR-011-backup-en-hersteleisen.md`

- [ ] **Step 1: Voeg een nieuwe sectie toe aan `backupcontrole.md`**

Voeg toe, direct vóór de sectie `## Bekende beperking` aan het einde van het bestand:

```markdown
## De saxombp-laag (sinds 2026-08-25)

Naast de OneDrive-backup (hierboven) draait er een **volledig onafhankelijke** tweede
productiebackup, rechtstreeks op `saxombp` — geen laptop in de keten. Zie
`docs/superpowers/specs/2026-08-25-saxombp-productiebackup-design.md` voor het volledige
ontwerp.

**Wat er draait:**

| Waar | Wat | Wanneer |
|---|---|---|
| saxombp, cron | `/opt/mcm2-backup/saxombp-backup-productie.sh` | dagelijks 06:00 |
| Dump-locatie | `/opt/mcm2-backup/dumps/` op saxombp | 14 dagen bewaard |
| Controle | `scripts/backup-controle.js` (op de laptop, ongewijzigd tijdstip) | leest saxombp via SSH |

**Dit vervangt de laptop-productiebackup nog niet.** Zie "Wanneer de laptoptaak uit mag"
hieronder — dat is een bewust latere, handmatige stap, geen automatisme.

### Het samengevoegde Telegram-bericht

Sinds deze uitbreiding toont het dagelijkse Telegram-bericht de status van beide backups. Een
voorbeeld bij een geslaagde run:

```
✅ MCM2 backup — weekcheck 25-08, 07:30

Laatste dump: mcm2-2026-08-25_05-38-43.dump (3 uur oud)
Compleet: 27 tabellen
saxombp: 1 uur oud, 5 dump(s) bewaard
Bewaard: 12 dump(s)
```

Een probleem op saxombp meldt apart, met een eigen sleutel (`saxombp`) — dus onafhankelijk
gedempt van een eventueel probleem op de OneDrive-kant. Twee soorten saxombp-problemen worden
uit elkaar gehouden, net als bij de bestaande "Docker draait niet"-melding:

- **"saxombp is niet bereikbaar via SSH"** — Tailscale staat uit, saxombp staat uit, of het
  netwerk hapert. Zegt niets over de dump zelf.
- **"Geen enkele productiedump gevonden"** of **"de nieuwste dump is X oud"** — saxombp is wel
  bereikbaar, maar de cron-taak daar heeft kennelijk niet (recent) gedraaid.

### Wanneer de laptoptaak uit mag

**Niet automatisch, niet zomaar.** De bestaande Windows-taak `MCM2 databasebackup` blijft
draaien tot **beide** onderstaande punten aantoonbaar zijn:

1. Minimaal 7 opeenvolgende geslaagde saxombp-dumps (zichtbaar in het samengevoegde
   Telegram-bericht, of via `ssh root@saxombp "ls -la /opt/mcm2-backup/dumps/"`).
2. Minstens één geslaagde restore-test **vanaf een saxombp-dump** — dezelfde route als de
   bestaande restore-test in `docs/runbooks/supabase-verificatie-en-restoretest.md`, maar dan
   met een dumpbestand dat van saxombp is gehaald in plaats van uit OneDrive.

Zodra beide zijn aangetoond: zet de Windows-taak `MCM2 databasebackup` handmatig uit in
Taakplanner. Dat is een besluit en een handeling van de eigenaar — geen script in deze repo
doet dat automatisch.
```

- [ ] **Step 2: Voeg een aantekening toe aan ADR-011**

In `docs/adr/ADR-011-backup-en-hersteleisen.md`, zoek de sectie
`## Overwogen alternatief: database op eigen server (2026-07-28)` en de subsectie
`### Waarvoor hij wél wordt ingezet` daarbinnen (rond regel 142-153). Voeg direct na punt 2
van die lijst (na de zin die eindigt op "de dump er na afloop naartoe kopiëren.") een nieuwe
alinea toe:

```markdown

**Uitgevoerd op 2026-08-25** — niet als "laptop kopieert de dump naartoe" (dat obstakel bleek
Tailscale SSH's periodieke herauthenticatie, onhaalbaar voor een onbewaakte taak), maar als
"saxombp maakt de dump zelf, rechtstreeks bij Supabase, via een eigen cron-taak". Zie
`docs/superpowers/specs/2026-08-25-saxombp-productiebackup-design.md` voor het volledige
ontwerp en `docs/runbooks/backupcontrole.md` ("De saxombp-laag") voor de operationele kant.
```

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/backupcontrole.md docs/adr/ADR-011-backup-en-hersteleisen.md
git commit -m "docs(backup): runbook en ADR-011 bijgewerkt met de saxombp-laag (issue #58)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Inrichten op saxombp — de gevoelige stap

**Files:** geen (dit is uitvoerend werk op saxombp zelf via SSH, geen bestandswijziging in
deze repo)

**Dit is de gevoeligste taak van het plan: het productiewachtwoord komt hier voor het eerst
permanent op een derde machine te staan.** Elke stap hieronder is bewust klein en apart
verifieerbaar — geen stap gaat door voordat de vorige aantoonbaar goed is gegaan.

- [ ] **Step 1: Maak de map-structuur aan op saxombp**

```bash
ssh -o BatchMode=yes -o ConnectTimeout=15 root@saxombp "mkdir -p /opt/mcm2-backup/dumps && chmod 700 /opt/mcm2-backup"
```

Expected: geen output, exit code 0. Verifieer:

```bash
ssh -o BatchMode=yes root@saxombp "ls -la /opt/mcm2-backup/"
```

Expected: een map `dumps` met rechten `drwx------` (700), eigenaar `root`.

- [ ] **Step 2: Lees het productiewachtwoord uit de lokale `.env` (zonder het te loggen)**

Dit commando geeft de waarde NIET op het scherm — het leest hem in een shell-variabele die
alleen in dit terminalvenster bestaat, en gebruikt hem direct in de volgende stap. Voer dit
commando exact zo uit, verander er niets aan om "even te controleren wat erin staat" — dat
zou het wachtwoord alsnog op het scherm en mogelijk in de terminal-historie zetten.

```bash
cd "c:/DEV/Work/MCM2"
PRODUCTIE_URL=$(grep -E '^BACKUP_DATABASE_URL=' .env | head -1 | cut -d'=' -f2-)
```

Verifieer ALLEEN dat de variabele niet leeg is, zonder de inhoud te tonen:

```bash
[ -n "$PRODUCTIE_URL" ] && echo "Variabele gevuld (lengte: ${#PRODUCTIE_URL} tekens)" || echo "LEEG — stop hier"
```

Expected: `Variabele gevuld (lengte: ...)`. Bij `LEEG`: stop, en controleer handmatig of
`.env` de sleutel `BACKUP_DATABASE_URL` bevat vóórdat je verder gaat — niet verzinnen wat er
zou moeten staan.

- [ ] **Step 3: Zet het `.env`-bestand op saxombp, met de juiste rechten in dezelfde stap**

Dit commando stuurt de waarde via SSH-stdin naar een `cat`-aanroep op saxombp die het bestand
schrijft — de waarde komt zo nooit voor als los argument in een `ps`-lijst (op geen van beide
machines), en de bestandsrechten worden meteen na het schrijven gezet, in dezelfde SSH-sessie,
zodat er geen moment is waarop het bestand wereldleesbaar op schijf staat.

```bash
ssh -o BatchMode=yes -o ConnectTimeout=15 root@saxombp \
  "umask 077 && cat > /opt/mcm2-backup/.env && chmod 600 /opt/mcm2-backup/.env" \
  <<EOF
BACKUP_DATABASE_URL=$PRODUCTIE_URL
EOF
```

- [ ] **Step 4: Verifieer de bestandsrechten (niet de inhoud) vanaf hier**

```bash
ssh -o BatchMode=yes root@saxombp "stat -c '%a %U %G' /opt/mcm2-backup/.env"
```

Expected: `600 root root`. Is dit niet zo, herstel dan met
`ssh root@saxombp "chmod 600 /opt/mcm2-backup/.env"` en herhaal deze verificatie — ga niet
verder voordat dit klopt.

- [ ] **Step 5: Wis de lokale shell-variabele**

```bash
unset PRODUCTIE_URL
```

Dit is geen harde beveiligingsgrens (de waarde heeft even in het geheugen van deze
shell-sessie gestaan), maar het voorkomt dat de variabele per ongeluk in een later commando in
dezelfde sessie terechtkomt (bijvoorbeeld via een onbedachte `echo $PRODUCTIE_URL` verderop).

- [ ] **Step 6: Kopieer het dump-script naar saxombp**

```bash
scp -o BatchMode=yes scripts/saxombp-backup-productie.sh root@saxombp:/opt/mcm2-backup/saxombp-backup-productie.sh
ssh -o BatchMode=yes root@saxombp "chmod 700 /opt/mcm2-backup/saxombp-backup-productie.sh"
```

Verifieer:

```bash
ssh -o BatchMode=yes root@saxombp "stat -c '%a %U' /opt/mcm2-backup/saxombp-backup-productie.sh && head -5 /opt/mcm2-backup/saxombp-backup-productie.sh"
```

Expected: rechten `700 root`, en de eerste vijf regels tonen de shebang en het
commentaarblok — bevestigt dat het juiste bestand is overgekomen (geen afgebroken kopie).

- [ ] **Step 7: Draai een eerste, handmatige testrun**

```bash
ssh -o BatchMode=yes root@saxombp "/opt/mcm2-backup/saxombp-backup-productie.sh"
```

Expected output (grofweg, exacte grootte/duur variëren):

```
Backup naar /opt/mcm2-backup/dumps/mcm2-productie-2026-08-25T...-....dump
Geslaagd — NN kB in Ns.
Bewaard: 1 dump(s), 0 ouder dan 14 dagen verwijderd.
```

**Als dit een foutmelding geeft over "row-level security policy":** de rol in
`BACKUP_DATABASE_URL` heeft geen BYPASSRLS. Controleer dat de waarde uit stap 2 daadwerkelijk
de `postgres`-rol was (niet per ongeluk `clm_migrator` of een andere rol) — ga terug naar
Step 2 en verifieer de bron, verzin geen nieuwe rol.

**Als dit een Docker-gerelateerde fout geeft:** controleer of Docker draait op saxombp met
`ssh root@saxombp "docker info"` — dat werkte al tijdens het brainstormen van dit plan, dus
een fout hier wijst op iets dat sindsdien veranderd is, niet op een structureel probleem.

- [ ] **Step 8: Verifieer de dump-inhoud (niet alleen dat er een bestand staat)**

Vergelijkbaar met wat `backup-controle.js` doet, maar hier eenmalig handmatig:

```bash
ssh -o BatchMode=yes root@saxombp "docker run --rm -v /opt/mcm2-backup/dumps:/backup postgres:17.6 sh -c 'pg_restore --list /backup/\$(ls -t /opt/mcm2-backup/dumps | head -1)' | grep -c 'TABLE DATA'"
```

Expected: een getal rond de 27 (het aantal tabellen in de huidige `backup-verwachting.json` —
lees dat bestand na als je een actuele referentie wilt, verzin het getal niet). Een getal dat
duidelijk lager is (bijvoorbeeld onder de 20) wijst op een incomplete dump — stop en
onderzoek voordat je verder gaat naar Task 5.

- [ ] **Step 9: Richt de cron-taak in**

```bash
ssh -o BatchMode=yes root@saxombp "(crontab -l 2>/dev/null; echo '0 6 * * * /opt/mcm2-backup/saxombp-backup-productie.sh >> /opt/mcm2-backup/backup.log 2>&1') | crontab -"
```

Verifieer:

```bash
ssh -o BatchMode=yes root@saxombp "crontab -l"
```

Expected: exact één regel,
`0 6 * * * /opt/mcm2-backup/saxombp-backup-productie.sh >> /opt/mcm2-backup/backup.log 2>&1`.
Staat de regel er dubbel in (bijvoorbeeld door dit commando twee keer te draaien), verwijder
dan het duplicaat met `ssh root@saxombp "crontab -e"` (interactief, door de eigenaar — niet
door dit script op te lossen door te gokken welke regel weg moet).

---

## Task 5: Eindverificatie met `backup-controle.js` tegen de echte dump

**Files:** geen

- [ ] **Step 1: Draai de bestaande controle opnieuw, nu tegen een echte saxombp-dump**

```bash
cd "c:/DEV/Work/MCM2"
node scripts/backup-controle.js
```

Expected: geen `PROBLEEM`-regel meer voor `saxombp` in de console-uitvoer (in tegenstelling
tot Task 2, Step 5, waar de map nog niet bestond). In plaats daarvan een regel als
`saxombp: 0 uur oud, 1 dump(s) bewaard` in de `regels`-lijst.

- [ ] **Step 2: Verifieer het Telegram-bericht (optioneel, alleen als een bericht verwacht wordt)**

Een geslaagde run stuurt alleen een bericht als het wekelijkse levensteken aan de beurt is
(`telegram.levenstekenNodig(7)`), niet bij elke succesvolle run — dat is bestaand gedrag,
onveranderd door dit plan. Verwacht dus niet per se een Telegram-bericht bij deze stap; het
ontbreken ervan is geen fout. Was er al een `saxombp`-probleem gedempt van Task 2 Step 5, dan
verstuurt deze run wél een herstelbericht (`meldHerstel`) — dat is een goed teken, geen
onverwachte melding.

- [ ] **Step 3: Geen commit nodig (deze taak wijzigt geen bestanden in de repo)**

---

## Task 6: Push en samenvatting

**Files:** geen

Dit plan draait op branch `docs/saxombp-backup-design`. Na Task 1 t/m 3 (de enige taken die
bestanden in deze repo wijzigen) is de branch klaar om af te ronden volgens de gebruikelijke
`finishing-a-development-branch`-procedure — dat hoort niet in dit plan zelf, maar is de
logische vervolgstap na de laatste commit.

- [ ] **Step 1: Controleer dat alle codewijzigingen gecommit zijn**

```bash
git status --short
```

Expected: geen wijzigingen aan `scripts/saxombp-backup-productie.sh`,
`scripts/backup-controle.js`, `docs/runbooks/backupcontrole.md`, of
`docs/adr/ADR-011-backup-en-hersteleisen.md` — alleen eventuele, dit plan niet-rakende
bestanden die al vóór dit werk in de working tree stonden.

---

## Self-review — dekking tegen de spec

- §1 (alleen productie) → Task 1 (script noemt expliciet productie, geen acceptatie/staging-
  variant).
- §2 (SSH-herauth-obstakel vermeden door dump op saxombp zelf te draaien, niet via SSH te
  versturen) → Task 1 (script draait lokaal op saxombp, geen SSH nodig voor de dump zelf) en
  Task 2 (de SSH die wél gebruikt wordt, is voor de — door een mens gestarte — controle, niet
  voor de dump).
- §3 (architectuur: cron 06:00, dumps 14 dagen bewaard) → Task 1 (script), Task 4 Step 9
  (cron-regel).
- §4 (credential-opzet: los `.env`, rechten 600, alleen root) → Task 4, Steps 2-5, met expliciete
  verificatie van de bestandsrechten en zorgvuldige omgang met de waarde zelf.
- §5 (het script, parallel aan `backup-dump.js`) → Task 1.
- §6 (Telegram-uitbreiding, samengevoegd bericht, apart herkenbaar "niet bereikbaar" vs "geen
  dump") → Task 2.
- §7 (uitfasering laptoptaak) → **bewust niet geautomatiseerd**, wel gedocumenteerd als
  concreet criterium in Task 3, Step 1 ("Wanneer de laptoptaak uit mag"). Geen taak in dit
  plan raakt de Windows-taak `MCM2 databasebackup`.
- §8 (wat dit ontwerp niet doet — geen acceptatie/staging-backup, geen apart dump-account, geen
  deploy-pipeline naar saxombp, geen wijziging aan restore-testprocedure) → impliciet gedekt:
  geen enkele taak in dit plan doet een van deze dingen.
- §9 (relatie tot ADR-011) → Task 3, Step 2.

**Type-/naamconsistentie gecontroleerd:** `controleerSaxombp()` (Task 2) retourneert
`{ bereikbaar, goed, bericht, leeftijd, aantal }` — elk veld dat in Task 2 Step 3's
verwerkingscode wordt gebruikt (`saxombp.bereikbaar`, `saxombp.bericht`, `saxombp.goed`,
`saxombp.leeftijd`, `saxombp.aantal`) komt overeen met wat Step 2's functie daadwerkelijk
teruggeeft. De sleutel `'saxombp'` voor `problemen.push()` en `telegram.meldHerstel()` is
consistent binnen Task 2.

**Geen placeholder-scan-issues gevonden:** elke stap bevat volledige, uitvoerbare code of een
exact commando met verwacht resultaat. De enige plek waar een cijfer bewust niet hard is
vastgelegd (Task 4, Step 8: "een getal rond de 27") verwijst expliciet naar het actuele
`backup-verwachting.json` als bron van waarheid, in plaats van een verouderd getal te
bevriezen dat bij de volgende migratie alweer achterhaald zou zijn.
