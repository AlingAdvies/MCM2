# Runbook — OTAP-doorloop voor frontend en backend

**Type:** D (routineoperatie)
**Eigenaar:** projecteigenaar
**Laatste update:** 2026-07-29
**Vereiste toegang:** Docker Desktop, beide repositories lokaal
**Raakt:** Issue #18 (volledige OTAP-doorloop minimaal één keer bewezen)

---

## Waarom dit bestaat

Issue #18 vraagt om één bewezen doorloop van de volledige keten. Het risico dat
daarachter zit: onbekende gaten die pas tijdens een echte crisis opvallen.

Deze doorloop dekt **Ontwikkel → Test** volledig en bewijst dat het uitrolbare
artefact werkt. Wat het níét dekt: Acceptatie en Productie — die omgevingen
bestaan nog niet (Issue #12).

**Het onderscheid dat dit waardevol maakt:** `docker-compose.yml` draait de
backend in ontwikkelmodus met hot reload. Deze doorloop draait **beide
onderdelen als productie-image**, precies het artefact dat straks naar AWS gaat
(ADR-012). Dat is het verschil tussen "het werkt op mijn machine" en "wat we
uitrollen werkt".

---

## Voorwaarden

- Docker Desktop draait
- `MCM2-frontend` staat als zustermap naast `MCM2`
- Poorten 3000, 5001 en 55500 zijn vrij

> **Poort 3000 is de gebruikelijke struikelblok.** Een `npm run dev` die nog
> draait houdt hem bezet en de stack weigert te starten met "ports are not
> available". Sluit die eerst af.

---

## Stap 1 — Images bouwen

```bash
docker compose -f docker-compose.otap.yml build
```

**Verwacht resultaat:** `Image mcm2-api Built` en `Image mcm2-frontend Built`.

**Bij afwijking:** een build die faalt is zelf de bevinding. Beide Dockerfiles
worden ook in CI gebouwd, dus een lokale fout wijst meestal op een verschil in
de werkkopie.

---

## Stap 2 — Stack starten

```bash
docker compose -f docker-compose.otap.yml up -d
```

**Verwacht resultaat:** drie containers gestart, `db` als eerste en gezond.

---

## Stap 3 — Database vanaf niets opbouwen

Dit hoort bij de doorloop: het bewijst dat een lege database via de
migratieketen tot een werkend schema komt.

```bash
docker compose -f docker-compose.otap.yml exec -T db \
  psql -U postgres -q -v ON_ERROR_STOP=1 < db/roles/bootstrap-roles.sql

docker compose -f docker-compose.otap.yml exec -T db psql -U postgres -q -c \
  "ALTER ROLE clm_migrator WITH PASSWORD 'otap_pw'; \
   ALTER ROLE clm_api_runtime WITH PASSWORD 'otap_pw';"

MIGRATION_DATABASE_URL="postgresql://clm_migrator:otap_pw@localhost:55500/postgres" \
  npm run migrate:deploy
```

**Verwacht resultaat:** `Migraties voltooid.`

**Let op:** de API is gestart vóórdat de rollen bestonden en kan daardoor niet
verbinden. Herstart hem:

```bash
docker compose -f docker-compose.otap.yml restart api
```

---

## Stap 4 — De doorloop draaien

```bash
node scripts/otap-doorloop.js
```

**Verwacht resultaat:** `OTAP-doorloop GESLAAGD — de volledige keten werkt.`

Acht stappen, elk met eigen controles:

| # | Wat |
|---|---|
| 1 | Database bereikbaar, zes `clm_*`-rollen, `clm_api_runtime` zonder BYPASSRLS |
| 2 | Migratieketen volledig, RLS op elke tenantgebonden tabel, elke policy met `USING` én `WITH CHECK` |
| 3 | Backend-image draait, `/health` antwoordt 200 |
| 4 | Onbekend token → 404 |
| 5 | Geldig token → 200, en de respons lekt geen tenant-ID |
| 6 | Draft-ronde → 410, met een melding die "nog niet open" onderscheidt van "gesloten" |
| 7 | Frontend-image draait en serveert het portaal |
| 8 | Frontend praat met de echte backend, niet met mock data |

Het script is idempotent: het ruimt zijn eigen testdata op vóór elke run.

---

## Stap 5 — Opruimen

```bash
docker compose -f docker-compose.otap.yml down -v
```

`-v` gooit ook het databasevolume weg. Dat is de bedoeling: de volgende
doorloop hoort weer vanaf niets te beginnen, anders bewijst stap 3 niets.

---

## Wat de eerste doorloop opleverde (2026-07-29)

Twee echte bevindingen, wat het nut van deze doorloop meteen aantoont:

**1. Een routepad lekte naar de leverancier.** Het portaal toonde letterlijk
`Cannot GET /survey/respond/questions` omdat die route nog niet gebouwd is. De
frontend vertrouwde elke 404-melding van de backend, wat klopt voor de guard
maar niet voor een 404 van het framework zelf. Gerepareerd: een framework-404
wordt nu herkend en vervangen door dezelfde melding als bij een onbekend token.

**2. Het doorloopscript was zelf niet idempotent.** `ON CONFLICT DO NOTHING`
sloeg bij een tweede run de insert over, waardoor de rij van de vórige run met
een oude tokenhash bleef staan en de doorloop faalde met een misleidende
"geldig token gaf 404". Gerepareerd door de testdata eerst te verwijderen.

Beide zijn precies het soort gat dat Issue #18 bedoelt: geen van beide was
zichtbaar in unit- of e2e-tests.

---

## Bekende beperkingen

- **Acceptatie en Productie ontbreken** — die omgevingen bestaan nog niet
  (Issue #12). Deze doorloop dekt O en T.
- **`/survey/respond/questions` bestaat nog niet**, dus het portaal kan de
  vragenlijst nog niet echt tonen tegen de live backend. Dat is stap 5 uit de
  bouwvolgorde; de mockmodus toont het scherm wél volledig.
- **De doorloop draait handmatig.** Automatiseren in CI vraagt beide
  repositories in één workflow; nu de moeite niet waard.
