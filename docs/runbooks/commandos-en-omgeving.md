# Commando's en omgeving — wat draait waartegen

**Type:** R — referentie
**Eigenaar:** Kees Maling
**Laatste update:** 2026-08-07
**Aanleiding:** te vaak begonnen met een commando dat niet bestaat, of dat tegen
de verkeerde database zou hebben gedraaid.

**Geverifieerd op deze machine, 2026-08-07:** Docker 29.6.2, gh 2.89.0,
Node/npm-scripts uit `package.json`, `netstat`/`taskkill`/`findstr` in
`C:\Windows\system32`, image `postgres:17.6` lokaal aanwezig.

> **`psql` staat NIET op deze machine.** Er is geen PostgreSQL-client op de host
> geïnstalleerd. Elke `psql`-aanroep hieronder loopt daarom via
> `docker exec <container> psql …`. Een kaal `psql ...` faalt met
> "The term 'psql' is not recognized".
>
> **De Supabase CLI staat er ook niet.** Supabase wordt in dit project alleen
> benaderd via de connectiestrings in `.env` — er is geen `supabase`-commando.

---

## Waarvoor dit bestaat

Eén plek die zegt **welk commando er echt is**, **waar het naartoe praat**, en
**wat je vooraf moet controleren**. Alles hieronder is geverifieerd tegen
`package.json`, `scripts/` en `.github/workflows/ci.yml` op 2026-08-07.

Verzin nooit een commando. Staat het hier niet, dan bestaat het niet — kijk in
`package.json` voordat je iets typt.

---

## ⚠ Het belangrijkste: `.env` wijst naar Supabase

```
DATABASE_URL            → clm_api_runtime @ aws-1-eu-west-1.pooler.supabase.com
MIGRATION_DATABASE_URL  → clm_migrator    @ aws-1-eu-west-1.pooler.supabase.com
```

**Dat is de echte database.** Elk commando dat deze variabelen gebruikt en dat je
draait zónder ze te overschrijven, raakt Supabase.

Dit is precies waar **Issue #86** op misging: `npm run migrate:deploy` draaide
tegen productie terwijl een wegwerpcontainer de bedoeling was. Het script meldde
"Migraties draaien als rol 'clm_migrator'" en daarna "Migraties voltooid" —
beide waar, geen van beide verklapte het doelwit. Die rol heet lokaal precies zo.

**Vóór elk commando dat de database schrijft:** stel vast waar het naartoe gaat.
Sinds PR #93 noemen de schrijvende scripts hun doelwit zelf en weigeren ze
buiten lokaal zonder bevestiging. Vertrouw daarop, maar lees de melding.

---

## De commando's die er zijn

Volledige lijst uit `package.json`. Er is **geen** `npm run migrate`, **geen**
`migrate:status`, **geen** `verify:migratieketen`, en **geen** `db:studio`.

### Controleren (deze bewijzen iets)

| Commando | Wat het doet | Database nodig? |
|---|---|---|
| `npm run verify:volledig` | **Het bewijs.** Vijf stappen: code, unittests, e2e tegen een wegwerpdatabase, beide productie-images, browsertests, opruimen. | Zet er zelf een op (poort 55441) |
| `npm run verify` | Dezelfde poorten als CI, zonder de stack | Ja — `DATABASE_URL` |
| `npm run verify:snel` | Idem, e2e overgeslagen (zegt dat er ook bij) | Nee |
| `npm run verify:schema` | Schemaconformiteit: draait `test/schema-conformiteit.e2e-spec.ts` | Ja |

`verify.js` **weigert** te draaien als `DATABASE_URL` niet naar een lokale host
wijst. Die bescherming werkt; laat hem staan.

### Losse poorten (deze bewijzen niets op zichzelf)

```
npm run format:check     prettier --check
npm run lint:check       eslint --max-warnings=0
npm run typecheck        tsc --noEmit
npm test                 jest            (unittests, geen database)
npm run test:e2e         jest --config ./test/jest-e2e.json   (database nodig)
```

**Let op het verschil:** `npm run lint` en `npm run format` *wijzigen* bestanden;
CI draait `lint:check` en `format:check`. Gebruik nooit de schrijvende variant om
"groen" vast te stellen — dat ging op 2026-07-31 mis (MCM2-CLAUDE.md §15a).

### Database

| Commando | Waartegen | Let op |
|---|---|---|
| `npm run migrate:deploy` | `MIGRATION_DATABASE_URL` | **Zonder overschrijven: Supabase.** |
| `npm run seed:vragenlijsten -- <tenant-uuid>` | `DATABASE_URL` | Tenant moet bestaan |
| `npm run seed:demo` | `DATABASE_URL` | Doet de vragenlijsten zelf ook |
| `npm run db:check` | — | Drizzle-consistentie, raakt geen database |

**`npm run db:generate` is onbruikbaar** (Issue #96). De snapshots in
`drizzle/meta` lopen tot `0007` terwijl er 17 migraties zijn; het genereert een
migratie die `sessie`, `tenant_membership` en een `user`-kolom opnieuw wil
aanmaken. **Schrijf migraties met de hand**, in de stijl van
`drizzle/0015_survey_review.sql`.

### ⚠ Een handgeschreven migratie moet in `_journal.json`

Drizzle's `migrate()` leest **`drizzle/meta/_journal.json`**, niet de inhoud van
de map. Een `.sql`-bestand zonder journal-entry bestaat voor het script niet — en
`migrate:deploy` meldt dan gewoon **"Migraties voltooid"** zonder iets te doen.

Dat is dezelfde valkuil als Issue #86: een geruststellende melding over iets dat
niet gebeurd is. Overkwam ons op 2026-08-07 bij migratie 0017.

Voeg na het schrijven van `NNNN_naam.sql` een entry toe, met `idx` gelijk aan het
migratienummer:

```json
    {
      "idx": 17,
      "version": "7",
      "when": 1786435200000,
      "tag": "0017_goedkeuren",
      "breakpoints": true
    }
```

`tag` is de bestandsnaam **zonder** `.sql`. `when` is een epoch in milliseconden;
hoger dan de vorige entry.

**Controleer daarna in de database of het echt is gebeurd** — vertrouw de melding
niet:

```powershell
docker exec <container> psql -U postgres -d postgres -t -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = '<naam>';"
```

### Demo-omgeving (om zelf te kijken)

```
npm run demo             database + backend + frontend + sessie, ~1 minuut
npm run demo -- --vers   database eerst weggooien en opnieuw opbouwen
npm run demo:status      draait het, en sinds wanneer?
npm run demo:test        browsertests tegen de draaiende demo
npm run demo:af          backend en frontend stoppen, database laten staan
npm run demo:stop        ook de database weggooien
```

Container `mcm2demo` op poort **55450**, label `mcm2.rol=demo`. De data blijft
staan tussen sessies. Zie `docs/runbooks/zelf-testen.md` voor het hele verhaal.

### Overig

```
npm run backup:dump             draait dagelijks vanzelf om 07:00
npm run backup:controle         controle op de laatste dump
npm run mail:test               mailkanaal beproeven
```

---

## Lokaal draaien zonder .env aan te raken

**Dit is de manier.** Overschrijf de variabele binnen het commando; `.env` blijft
ongemoeid.

### Een verse wegwerpdatabase opzetten

```powershell
# De containernaam moet minstens twee tekens hebben — Docker 29 weigert één teken.
docker run -d --name mcm2test -e POSTGRES_PASSWORD=pw -p 55440:5432 postgres:17.6

# Wachten tot hij luistert; direct erna verbinden faalt met "the database system is starting up".
docker exec mcm2test pg_isready -U postgres

# LET OP: `< bestand.sql` werkt NIET in PowerShell. Gebruik een pipe.
Get-Content db\roles\bootstrap-roles.sql | docker exec -i mcm2test psql -U postgres -q

docker exec mcm2test psql -U postgres -d postgres -c "ALTER ROLE clm_migrator WITH PASSWORD 'pw'; ALTER ROLE clm_api_runtime WITH PASSWORD 'pw';"
```

In bash mag de redirect wél:
```bash
docker exec -i mcm2test psql -U postgres -q < db/roles/bootstrap-roles.sql
```

`-d postgres` is niet optioneel: psql neemt anders de rolnaam als databasenaam
en faalt met een melding die naar de verkeerde oorzaak wijst.

### Migraties erop draaien

PowerShell (deze machine):
```powershell
$env:MIGRATION_DATABASE_URL="postgresql://clm_migrator:pw@localhost:55440/postgres"
npm run migrate:deploy
Remove-Item Env:\MIGRATION_DATABASE_URL
```

Bash:
```bash
MIGRATION_DATABASE_URL="postgresql://clm_migrator:pw@localhost:55440/postgres" npm run migrate:deploy
```

**Controleer de melding die het script afdrukt.** Hij noemt het doelwit. Staat
daar `supabase.com`, dan is de variabele niet doorgekomen — stop.

### E2e-tests erop draaien

```powershell
$env:DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55440/postgres"
npx jest --config test/jest-e2e.json --forceExit
Remove-Item Env:\DATABASE_URL
```

`--forceExit` is nodig sinds de sessiesuite: die houdt een pg-verbinding open,
waardoor Jest anders blijft hangen zónder foutmelding.

### Opruimen

```powershell
docker rm -f mcm2test
```

---

## Poorten — wie claimt wat

| Poort | Wie | Wanneer |
|---|---|---|
| 55440 | handmatige wegwerpdatabase | als je hem zelf opzet (zie boven) |
| 55441 | `verify:volledig` | tijdens stap 1 |
| 55450 | `mcm2demo` | zolang de demo staat |
| 5001 | API in de doorloopstack | tijdens `verify:volledig` en `npm run demo` |
| 3000 | frontend | idem |

**`verify:volledig` faalt op een bezette 55441** met "geen testdatabase kunnen
starten" — een melding die naar de verkeerde oorzaak wijst. Draait daar nog iets
van een vorige sessie: `docker rm -f <naam>`.

**Het script sluit bewust niets zelf af.** Een dev-server op 3000 of 5001 kan van
een ander project zijn. Zoeken wat het is:

```powershell
netstat -ano | findstr ":5001 "
taskkill /PID <pid> /F
```

---

## Wat CI werkelijk draait

Drie jobs in `.github/workflows/ci.yml`:

| Job | Stappen |
|---|---|
| Format, lint en typecheck | `npm ci`, `format:check`, `lint:check`, `typecheck`, `npm test` |
| Docker productiebuild | `docker build -t mcm2-api:ci .`, daarna controleren dat het image het gecompileerde resultaat start |
| RLS tenant-isolatietest | `npm ci`, migraties op een verse Postgres, e2e-suite |

Sinds PR #92 is CI handmatig te starten:
```powershell
gh workflow run ci.yml --ref main
```

**Die trigger werkt alleen op branches die de commit van #92 al bevatten.**
GitHub leest de handmatige triggers uit de workflow op de branch zelf. Op een
oudere branch geeft dit een 422; `gh pr update-branch <nr>` haalt de trigger
binnen en start CI meteen opnieuw.

---

## Waar de sleutels staan

Alle variabelen staan in `.env` (niet in git) en zijn beschreven in
`.env.example` (wel in git, met `PROJECT_REF` en `PASSWORD` als plaatshouders).

| Variabele | Waarvoor |
|---|---|
| `DATABASE_URL` | runtime, rol `clm_api_runtime` |
| `MIGRATION_DATABASE_URL` | migraties, rol `clm_migrator` |
| `BACKUP_DATABASE_URL` | backups — aparte rol, want `FORCE RLS` breekt `pg_dump` als `clm_migrator` (#78) |
| `OIDC_*` | Entra-inlogflow |
| `RESEND_API_KEY`, `MAIL_AFZENDER_ADRES` | mailkanaal |
| `PORTAAL_BASIS_URL` | de basis van de tokenlinks in uitnodigingen |
| `TELEGRAM_*` | meldingen |
| `FEATURE_VENDORS_ENABLED` | feature flag |

**Nooit `.env` committen.** Nooit een sleutel in een commando dat in de
terminalhistorie of een CI-log belandt.

---

## Drie dingen die dit project anders doet dan je verwacht

1. **Migraties met de hand.** `db:generate` is kapot (Issue #96). Stijl:
   `drizzle/0015_survey_review.sql` — met een kop die uitlegt wáárom, niet
   alleen wat.

2. **Test-id's staan centraal** in `test/test-ids.ts`, met een bewakingstest
   erop. Verzin nooit een UUID in een testbestand. Hoogste vergeven staart per
   2026-08-07: `ef`.

3. **RLS eist een actor, niet alleen een tenant.** Databasetoegang loopt via
   `db.withTenant(tenantId, fn, 'medewerker')`. Op `survey_review` staat
   `clm.current_actor() = 'medewerker'` in zowel `USING` als `WITH CHECK` — een
   leverancier zit in dezelfde tenant als zijn beoordelaar en mag het oordeel
   niet zien.

---

## Bij twijfel

```powershell
# Welke commando's bestaan er echt?
(Get-Content package.json | ConvertFrom-Json).scripts.PSObject.Properties |
  ForEach-Object { "{0,-24} {1}" -f $_.Name, $_.Value }

# Waar wijzen mijn database-variabelen naartoe? (zonder wachtwoord)
Select-String -Path .env -Pattern '^(MIGRATION_)?DATABASE_URL' |
  ForEach-Object { ($_.Line -replace ':[^:@]+@',':***@') }

# Wat draait er nu in Docker?
docker ps --format "{{.Names}} {{.Ports}}"

# Bestaat een extern commando überhaupt op deze machine?
Get-Command psql, supabase, gh, docker -ErrorAction SilentlyContinue |
  Select-Object Name, Source
```

---

## Dit document actueel houden

Elk commando hierin is **uitgevoerd of opgezocht**, niet uit het hoofd
opgeschreven. Houd dat zo. Bij twijfel over een externe tool:

| Vraag | Hoe je het vaststelt |
|---|---|
| Bestaat het npm-script? | `(Get-Content package.json \| ConvertFrom-Json).scripts` |
| Bestaat de tool op deze machine? | `Get-Command <naam> -ErrorAction SilentlyContinue` |
| Bestaat de vlag? | `<tool> --help` en zoek de vlag op |
| Bestaat het script-argument? | `Select-String -Path scripts\<naam>.js -Pattern "'--<vlag>'"` |
| Deed de migratie wat er staat? | terugleze uit de database, niet de melding geloven |

Een commando dat plausibel klinkt maar niet bestaat, kost meer tijd dan het
opzoeken ervan. `npm run migrate`, `migrate:status`, `verify:migratieketen` en
`node scripts/db-doelwit.js` zijn alle vier zo ontstaan — geen ervan bestaat.
