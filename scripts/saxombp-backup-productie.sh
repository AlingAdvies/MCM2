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
  rm -f "$DOELPAD" 2>/dev/null || true
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
