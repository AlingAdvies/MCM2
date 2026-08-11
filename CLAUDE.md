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

Alle runbooks staan geïndexeerd in **`docs/runbooks/README.md`**; wat er
terugkeert en wanneer, staat in **`docs/runbooks/onderhoudskalender.md`**.

**Nummer 1 gaat vóór de rest**, en dat is een correctie op §14 van
`MCM2-CLAUDE.md`. Reden: op 2026-08-07 werden in één sessie vier commando's
aangeroepen die niet bestaan (`npm run migrate`, `migrate:status`,
`verify:migratieketen`, `node scripts/db-doelwit.js`) en scheelde het weinig of
er was een migratie tegen de Supabase-productiedatabase gedraaid — `.env` wees
daarheen. Architectuurregels lezen helpt niet als het eerste commando al het
verkeerde doelwit raakt.

> Sinds stap 5 (2026-08-11) wijst `.env` naar **staging**, en de rem leest
> `clm.omgeving` in plaats van de hostnaam. Dat verkleint dit risico maar heft
> het niet op: het verzinnen van commando's is er niet mee opgelost.

**`docs/runbooks/devops-handleiding.md` is niet voor jou maar voor de
eigenaar.** Hij typt zelf geen commando's; hij vraagt ze in de chat. Die
handleiding beschrijft wát hij doet — akkoord geven op GitHub, reageren op een
Telegram-melding, Docker starten. Verwijs ernaar als hij vraagt hoe iets werkt,
en houd hem bij wanneer een handeling van hem verandert.

---

## De vier dingen die het vaakst misgaan

Volledig uitgelegd in het runbook; hier alleen zodat je ze niet mist.

**1. `.env` wijst naar STAGING — sinds stap 5 (2026-08-11).**
Een databasecommando zonder eigen adres komt op de oefendatabase uit, niet meer
op productie. Voor e2e-werk zet je nog steeds een eigen wegwerpcontainer op
(`-p 127.0.0.1:55440:5432`, niet `0.0.0.0`) en overschrijf je
`MIGRATION_DATABASE_URL` / `DATABASE_URL` binnen het commando.

Productie leeft nog als `NOOD_PRODUCTIE_URL` in `.env` — **geen enkel script
leest die naam**. Erbij komen kost twee bewuste stappen: het adres meegeven én
`--extern`, want productie is `beschermd`.

**1b. Elke database is `beschermd` tot hij zich als wegwerp meldt.**
Sinds migratie 0019 staat dat in `clm.omgeving`. De e2e-suites weigeren tegen
alles wat niet `wegwerp` is, en sinds stap 5 geldt dat ook voor de schrijvende
scripts: `eisOnbeschermdeDatabase()` leest die markering in plaats van de
hostnaam. Na het opzetten van je eigen container:
`node scripts/markeer-wegwerp.js "waarvoor"`.

**Markeer nooit de demo (poort 55450) of een Supabase-productiedatabase.**
Aanleiding: op 2026-08-07 wisten de e2e-tests de demo-database leeg omdat
`DATABASE_URL` naar 55450 wees.

> Eén uitzondering, bewust: een **lokale** database zonder `clm.omgeving` mag
> door. Die tabel ontstaat pas bij migratie 0019, dus een verse container zou
> anders blokkeren op precies het commando dat hem moet vullen. Niet-lokaal
> zonder markering blijft geblokkeerd.

**2. Verzin nooit een commando — en ook geen kolomnaam of route.**
Staat het niet in `package.json`, dan bestaat het niet:
```powershell
(Get-Content package.json | ConvertFrom-Json).scripts
```
`psql` en de Supabase CLI staan **niet** op deze machine. psql loopt via
`docker exec <container> psql …`.

Dat geldt net zo hard voor namen die plausibel klinken. Op 2026-08-10 kostte
`is_active` (bestaat niet, het is `deleted_at`), `occurred_at` (het is
`created_at`) en `/survey/respond/status` (de route is `/survey/respond?t=`)
elk een mislukte query. Opzoeken kost één commando:
```sql
SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
  FROM information_schema.columns WHERE table_schema='clm' AND table_name='<tabel>';
```

**3. Een handgeschreven migratie moet in `drizzle/meta/_journal.json`.**
Anders slaat Drizzle hem over en meldt `migrate:deploy` alsnog "Migraties
voltooid". `db:generate` is onbruikbaar (Issue #96) — migraties gaan met de
hand, in de stijl van `drizzle/0015_survey_review.sql`.

**4. Vertrouw geen enkele geruststellende melding.**
Lees het resultaat terug uit de database. "Migraties voltooid" betekende op
2026-08-07 dat er niets was gebeurd, en in Issue #86 dat het op de verkeerde
database was gebeurd. Op 2026-08-10 meldde een route `mailVerstuurd: true`
terwijl het log in dezelfde seconde `[niet echt verstuurd]` zei (Issue #131).

**4b. De server draait niet vanzelf op wat er in de repo staat.**
`deploy.js` gebruikt `/opt/mcm2/docker-compose.omgeving.yml` maar brengt dat
bestand niet mee; `deploy-inrichten.js` weigert op een server waar al iets
draait. Op 2026-08-10 stond daar nog een versie met `profiles: ["frontend"]`
erin, en compose sloeg die dienst stilzwijgend over: geen fout, geen container.
Sindsdien vergelijkt `deploy.js` de sha256 als eerste stap — maar de les is
breder dan dat ene bestand. **Werk je aan de uitrol, kijk dan wat er op de
server staat en neem niet aan dat het de repo volgt.**

**5. Schrijf je een e2e-suite? Lees dan eerst §"Een nieuwe e2e-suite schrijven".**
Alle suites delen één database. Vier unieke sleutels hebben géén `tenant_id`
erin — je eigen tenant beschermt je dus niet. Een suite die los groen draait
kan de volledige run alsnog rood maken, en welke suite dan omvalt hangt af van
de volgorde. Draai altijd `npx jest test-ids` én de volledige e2e-run.

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
