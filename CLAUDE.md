# MCM2 — instap bij iedere sessie

> Dit bestand wordt door Claude Code **automatisch** geladen bij sessiestart.
> `MCM2-CLAUDE.md` niet — die naam staat niet in de conventie, ook al staat er
> bovenaan "lees dit bij iedere sessiestart". Vandaar dit bestand: het is de
> haak die de rest binnenhaalt.

---

## Lees deze drie, in deze volgorde, vóór je iets doet

| # | Bestand | Waarvoor |
|---|---|---|
| 1 | **`docs/runbooks/commandos-en-omgeving.md`** | Welk commando bestaat er echt, waar praat het naartoe, wat mag nooit |
| 2 | `MCM2-CLAUDE.md` | Rol, werkmodus, architectuurregels, §14 sessiestartprotocol |
| 3 | `docs/STATUS.md` | Waar het project nu staat |

**Nummer 1 gaat vóór de rest**, en dat is een correctie op §14 van
`MCM2-CLAUDE.md`. Reden: op 2026-08-07 werden in één sessie vier commando's
aangeroepen die niet bestaan (`npm run migrate`, `migrate:status`,
`verify:migratieketen`, `node scripts/db-doelwit.js`) en scheelde het weinig of
er was een migratie tegen de Supabase-productiedatabase gedraaid. Dat komt
doordat `.env` daarheen wijst. Architectuurregels lezen helpt niet als het
eerste commando al het verkeerde doelwit raakt.

---

## De vier dingen die het vaakst misgaan

Volledig uitgelegd in het runbook; hier alleen zodat je ze niet mist.

**1. `.env` wijst naar Supabase — de echte database.**
Elk databasecommando zonder overschreven variabele raakt productie. Zet een
wegwerpcontainer op (`-p 127.0.0.1:55440:5432`, niet `0.0.0.0`) en overschrijf
`MIGRATION_DATABASE_URL` / `DATABASE_URL` binnen het commando. Nooit `.env`
aanpassen.

**2. Verzin nooit een commando.**
Staat het niet in `package.json`, dan bestaat het niet:
```powershell
(Get-Content package.json | ConvertFrom-Json).scripts
```
`psql` en de Supabase CLI staan **niet** op deze machine. psql loopt via
`docker exec <container> psql …`.

**3. Een handgeschreven migratie moet in `drizzle/meta/_journal.json`.**
Anders slaat Drizzle hem over en meldt `migrate:deploy` alsnog "Migraties
voltooid". `db:generate` is onbruikbaar (Issue #96) — migraties gaan met de
hand, in de stijl van `drizzle/0015_survey_review.sql`.

**4. Vertrouw geen enkele geruststellende melding.**
Lees het resultaat terug uit de database. "Migraties voltooid" betekende op
2026-08-07 dat er niets was gebeurd, en in Issue #86 dat het op de verkeerde
database was gebeurd.

---

## Groen is alleen groen via verify

```powershell
npm run verify:volledig
```

Losse commando's bewijzen niets (§15a). Let op: `npm run lint` en
`npm run format` **wijzigen** bestanden; CI draait `lint:check` en
`format:check`.

---

## Bij conflicten

```text
Security en actuele blokkades
  -> docs/runbooks/commandos-en-omgeving.md   (wat technisch kan en mag)
    -> MCM2-CLAUDE.md                          (hoe we werken)
      -> actuele ADR's en docs/STATUS.md
        -> projectdocumentatie
          -> oude plannen, pilots en sessiehistorie
```

Zolang we in deze architectuur werken — NestJS, Drizzle met handgeschreven
migraties, Postgres met RLS, Supabase als productiedatabase — is het runbook
leidend van ontwerp tot en met uitrol.
