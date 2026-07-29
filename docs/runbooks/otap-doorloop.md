# Runbook — OTAP-doorloop voor frontend en backend

**Type:** D (routineoperatie)
**Eigenaar:** projecteigenaar
**Laatste update:** 2026-07-29 (tweede doorloop: uitgebreid t/m indienen en upload)
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

## Stap 3b — Tenant en vragenlijsten inladen

Zonder deze stap staat er geen vragenlijst en faalt stap 7 van de doorloop.

**De tenant moet er vóór de seed zijn.** `seed-vragenlijsten.js` schrijft binnen
een tenantcontext; zonder bestaande tenantrij weigert de foreign key. Dat is bij
de doorloop van 2026-07-29 tegengekomen op een verse database.

```bash
docker compose -f docker-compose.otap.yml exec -T db psql -U postgres -q -c \
  "INSERT INTO clm.tenant (tenant_id, name)
   VALUES ('11111111-1111-1111-1111-111111111111','OTAP')
   ON CONFLICT DO NOTHING;"

DATABASE_URL="postgresql://clm_api_runtime:otap_pw@localhost:55500/postgres" \
  node scripts/seed-vragenlijsten.js 11111111-1111-1111-1111-111111111111
```

**Verwacht resultaat:** negen vragen voor `transdev-annual-vendor-it-risk`, en
29 vragen met zes categorieën voor `transdev-leveranciersbeoordeling`.

---

## Stap 4 — De doorloop draaien

```bash
node scripts/otap-doorloop.js
```

**Verwacht resultaat:** `OTAP-doorloop GESLAAGD — de volledige keten werkt.`

Negen stappen, 21 controles:

| # | Wat |
|---|---|
| 1 | Database bereikbaar, zes `clm_*`-rollen, `clm_api_runtime` zonder BYPASSRLS |
| 2 | Migratieketen volledig, RLS op elke tenantgebonden tabel, elke policy met `USING` én `WITH CHECK` |
| 3 | Backend-image draait, `/health` antwoordt 200 |
| 4 | Onbekend token → 404 |
| 5 | Geldig token → 200, en de respons lekt geen tenant-ID |
| 6 | Draft-ronde → 410, met een melding die "nog niet open" onderscheidt van "gesloten" |
| 7 | De vragenlijst komt uit de database: negen vragen, leesblok als `instruction`, uploadvraag met max 2 |
| 8 | Bevestigen zonder certificaat → 422; nep-PDF geweigerd op de bytes; upload → 201; indienen → 200; tweede poging → 410; alles vastgelegd inclusief auditregel |
| 9 | Frontend-image draait, serveert het portaal en praat met de echte backend |

Het script is idempotent: het ruimt zijn eigen testdata op vóór elke run —
antwoorden en bijlagen eerst, want alle survey-tabellen hebben
`ON DELETE RESTRICT`.

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

## Wat de tweede doorloop opleverde (2026-07-29, na bouwvolgorde stap 5–8)

De doorloop is uitgebreid van 8 naar 21 controles, zodat hij ook de vragenlijst,
de validatie, de upload en het indienen dekt. Dat leverde **drie bevindingen** op
die geen enkele unit- of e2e-test zag.

**1. Élke upload faalde in het productie-image.** `EACCES: permission denied,
mkdir '/app/var'`. Het image draait als non-root (`USER node`), maar `/app` is
eigendom van root, dus het proces kon er geen uploadmap in aanmaken. De e2e-tests
misten dit omdat die met `UPLOAD_DIR` naar een tijdelijke map draaien —
**precies het soort verschil tussen "werkt op mijn machine" en "het artefact
werkt" waar deze doorloop voor bestaat.**

Gerepareerd in de `Dockerfile`: de map wordt vóór `USER node` aangemaakt en
overgedragen, met `UPLOAD_DIR` expliciet in het image en een `VOLUME`-declaratie.
Dat laatste is een waarschuwing bij uitrol: zonder volume zijn de certificaten
weg zodra het image vervangen wordt.

**2. Het opruimblok van het script was niet meer idempotent.** Zodra de doorloop
ook echt ging indienen, viel de tweede run om op
`survey_answer_response_id_..._fk`. Alle survey-tabellen hebben
`ON DELETE RESTRICT` omdat een ingediende response bewijsmateriaal is; antwoorden
en bijlagen moeten dus vóór de response weg. **Dat de constraint hier in de weg
zat, is het bewijs dat hij werkt.**

**3. De seed vraagt een bestaande tenant.** Op een verse database faalt
`seed-vragenlijsten.js` op de foreign key naar `clm.tenant`. Opgelost door stap
3b aan dit runbook toe te voegen.

### Twee frontend-bevindingen — nog niet gerepareerd

Deze zitten in `MCM2-frontend` en zijn met de browser vastgesteld, niet
beredeneerd:

- **Het portaal kan nog niet uploaden.** Het toont letterlijk "Bestandsupload
  volgt in een volgende versie", terwijl de backend het sinds stap 8 wél kan.
  Gevolg: bevestigen op de ISO-vraag levert een 422 `file_required` op, die het
  portaal toont als "Er ging iets mis bij het versturen". **Een leverancier kan
  de vragenlijst daardoor nog niet via de browser afronden.**
- **Het leesblok krijgt keuzerondjes.** De backend levert het correct als
  `answerType: 'instruction'` en de voortgangsteller telt het terecht niet mee
  ("0 van 8" bij negen vragen), maar het renderen behandelt het als een gewone
  `confirmation`-vraag.

De backend-kant van de keten is wél volledig bewezen: vragen ophalen, valideren,
uploaden en indienen werken end-to-end vanuit de browser (gemeten via
`fetch` op de portaalpagina).

---

## Bekende beperkingen

- **Acceptatie en Productie ontbreken** — die omgevingen bestaan nog niet
  (Issue #12). Deze doorloop dekt O en T.
- **De frontend kan de keten nog niet volledig afronden** — zie de twee
  frontend-bevindingen hierboven.
- **De doorloop draait handmatig.** Automatiseren in CI vraagt beide
  repositories in één workflow; nu de moeite niet waard.
