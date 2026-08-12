# Commando's en omgeving — wat draait waartegen

**Type:** R — referentie
**Eigenaar:** Kees Maling
**Laatste update:** 2026-08-10
**Vereiste toegang:** deze PC, Docker Desktop
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

## Twee soorten database, en de database zegt zelf welke

Sinds migratie 0019 draagt elke database een markering in `clm.omgeving`:

| Soort | Wat het betekent |
|---|---|
| `beschermd` | Met rust laten. Productie, de demo, of die van een collega. **Dit is de standaard.** |
| `wegwerp` | Mag leeggegooid worden. Een container die je zelf opzet en weer weggooit. |

**De e2e-suites weigeren te draaien tegen een beschermde database.** Ze maken
tenants aan en voeren `DELETE` uit; dat is op alles behalve wegwerp
gegevensverlies.

**Waarom `beschermd` de standaard is:** een database die vergeet zich te
benoemen wordt behandeld als productie. Andersom zou precies de database die
niemand heeft ingericht — de nieuwe, de vergetene — vogelvrij zijn.

**Aanleiding.** Op 2026-08-07 draaiden de e2e-suites tegen de demo-database
(poort 55450 in plaats van 55440). De demo-tenant verdween, 400
testleveranciers bleven achter. Er sloeg niets aan: de bestaande bescherming
kijkt alleen of de host lokaal is, en binnen `localhost` was de demo niet te
onderscheiden van een wegwerpcontainer.

Het besluit erachter — inclusief de afgevallen alternatieven en wat dit níét
oplost — staat in **ADR-014**.

Een eigen wegwerpdatabase markeren, ná het draaien van de migraties:
```powershell
$env:MIGRATION_DATABASE_URL="postgresql://clm_migrator:pw@localhost:55440/postgres"
node scripts/markeer-wegwerp.js "korte omschrijving"
```

Markeren gaat via `clm_migrator`, niet via de runtime-rol: een database omkatten
hoort een beheerhandeling te zijn, geen iets wat de applicatie kan.

`verify:volledig` en CI markeren hun eigen container automatisch — daar hoef je
niets voor te doen.

### Waar de controle overal geldt

*Bijgewerkt bij stap 5 (2026-08-11): de schrijvende scripts kijken niet meer naar
de hostnaam maar naar `clm.omgeving`.*

| Wat | Controle | Zonder vlag op productie |
|---|---|---|
| e2e-suites (alle 34) | markering | weigeren te starten |
| `seed:demo -- --verwijder` | markering, twee keer | weigert |
| `migrate:deploy` | markering | **weigert** — was: mocht |
| `seed:vragenlijsten`, `seed:demo` | markering | **weigert** — was: mocht |
| `platform:inrichten` | markering | **weigert** — was: mocht |
| `markeer-wegwerp` | hostnaam | weigert |
| `migratiestand`, `productie:poort` | geen — lezen alleen | gaan door |

**Wat er veranderde:** vóór stap 5 mocht *toevoegen* op een beschermde database
zonder vlag, en werd alleen *verwijderen* tegengehouden. Dat onderscheid is
vervallen: nu `.env` naar staging wijst, is een commando dat toch bij productie
uitkomt vrijwel altijd een vergissing — en dan hoort het te stoppen, ook als het
"maar" toevoegt.

Is het géén vergissing, dan is `--extern` genoeg. Dat is één woord extra op een
handeling die je zelden doet, en het staat in je terminalhistorie.

**`markeer-wegwerp` houdt de hostcontrole**, en dat is geen omissie: dat script
draait per definitie tegen een database die nog `beschermd` is — dat is wat het
omzet. Met de nieuwe rem zou het altijd blokkeren.

**Lezen blijft vrij.** `migratiestand.js` en `productie-poort.js` doen
uitsluitend `SELECT count(*)`. Een leesquery tegen productie is precies wat je
zonder drempel wilt kunnen doen; een vlag die je daarvoor moet meegeven, went.

`otap-doorloop.js` en `provider-migratietest.js` verwijderen ook, maar hebben de
controle niet nodig: de eerste praat naar een vast adres binnen zijn eigen
container, de tweede werkt in een eigen wegwerpschema dat hij zelf aanmaakt en
weggooit.

---

## `.env` wijst naar STAGING — sinds stap 5 (2026-08-11)

```
DATABASE_URL            → clm_api_runtime @ clm-staging3   (oefendatabase)
MIGRATION_DATABASE_URL  → clm_migrator    @ clm-staging3   (oefendatabase)
BACKUP_DATABASE_URL     → postgres        @ clm-enterprise (PRODUCTIE — bewust)
NOOD_PRODUCTIE_URL      → clm_migrator    @ clm-enterprise (leest geen enkel script)
```

**Een commando zonder eigen adres komt nu op staging uit.** Daar kan niets kapot.

### Wat hier vóór 11 augustus stond, en waarom het weg moest

Deze paragraaf begon met *"⚠ Het belangrijkste: `.env` wijst naar Supabase"* —
naar **productie**. Elk databasecommando raakte de echte klantgegevens, niet
omdat iemand dat koos maar omdat het de standaard was. Dat is de
gemeenschappelijke oorzaak onder alle drie de incidenten:

- **2026-08-04** — productie liep achter, de dump miste 9 van 18 tabellen (#25)
- **2026-08-06** — `migrate:deploy` draaide tegen productie (Issue #86). Het
  script meldde "Migraties draaien als rol 'clm_migrator'" en daarna "Migraties
  voltooid" — beide waar, geen van beide verklapte het doelwit. Die rol heet
  lokaal precies zo.
- **2026-08-07** — vier verzonnen commando's; bijna een migratie op productie

Nu de uitrol via GitHub loopt (stappen 3 en 4), hoeft deze machine het
productieadres niet meer standaard te kennen.

### Hoe je tóch bij productie komt

Twee keer bewust kiezen:

```powershell
# 1. het adres meegeven — uit NOOD_PRODUCTIE_URL in .env
$p = (Get-Content .env | Select-String '^NOOD_PRODUCTIE_URL=').Line -replace '^NOOD_PRODUCTIE_URL=',''
$env:MIGRATION_DATABASE_URL = $p.Trim('"')

# 2. én de vlag, want productie is 'beschermd'
node scripts/migrate.js --extern
```

`NOOD_PRODUCTIE_URL` wordt door **geen enkel script** gelezen. Dat is de hele
bescherming: `dotenv` laadt hem wel, maar niets vraagt ernaar.

> Sluit je terminal daarna, of maak de variabele leeg. Hij blijft anders gelden
> voor élk volgend commando in dezelfde sessie.

### De rem: de database zegt zelf wat hij is

Vóór stap 5 keek de rem naar de **hostnaam**: localhost mocht, de rest niet. Dat
werkte zolang `.env` naar productie wees, maar staging staat óók bij Supabase —
die rem zou dus bij élk stagingcommando afgaan. Dan typ je `--extern` erbij
omdat er anders niets werkt, en na twee weken is het een gewoonte.

**Een waarschuwing die altijd afgaat, is geen waarschuwing meer.**

Daarom vraagt de rem nu aan de database zelf wat hij is (`clm.omgeving`,
migratie 0019):

| Database | Markering | Zonder vlag |
|---|---|---|
| staging | `wegwerp` | gaat door |
| jouw wegwerpcontainers | `wegwerp` | gaat door |
| verse container, nog niet gemigreerd | *(geen tabel)* | gaat door — **alleen lokaal** |
| **productie** | **`beschermd`** | **geblokkeerd** |
| demo (poort 55450) | `beschermd` | geblokkeerd |

Die derde regel is er omdat `clm.omgeving` pas bij migratie 0019 ontstaat: een
lege container zou anders blokkeren op precies het commando dat hem moet vullen.
Niet-lokaal en zonder markering blijft geblokkeerd — dat kan een kopie van
productie zijn van vóór 0019.

**Vóór elk commando dat de database schrijft:** lees de doelwitregel. De
schrijvende scripts noemen hem zelf, vóór ze iets doen.

---

## De commando's die er zijn

Volledige lijst uit `package.json`. Er is **geen** `npm run migrate`, **geen**
`migrate:status`, **geen** `verify:migratieketen`, en **geen** `db:studio`.

### Controleren (deze bewijzen iets)

| Commando | Wat het doet | Database nodig? |
|---|---|---|
| `npm run verify:volledig` | **Het bewijs.** Zeven stappen: onderhoud, code, unittests, e2e tegen een wegwerpdatabase, beide productie-images, browsertests, opruimen. | Zet er zelf een op (poort 55441) |
| `npm run verify` | Dezelfde poorten als CI, zonder de stack | Ja — `DATABASE_URL` |
| `npm run verify:snel` | Idem, e2e overgeslagen (zegt dat er ook bij) | Nee |
| `npm run verify:schema` | Schemaconformiteit: draait `test/schema-conformiteit.e2e-spec.ts` | Ja |
| `npm run verify:onderhoud` | Runbooks geïndexeerd en niet verouderd; `backup-verwachting.json` bij de migratiestand | Nee |
| `npm run productie:poort` | De drie automatische remmen vóór een uitrol naar productie: is de backup vers en goed, staat staging op de stand van de repository, loopt productie niet vóór | Leest staging én productie |
| `npm run verify:omgevingen` | Legt de **drie** omgevingen naast elkaar: migratiestand, tabellen, tenantgrens, rollen, markering in `clm.omgeving` | Leest alle drie |

`verify:omgevingen` **schrijft nergens** — uitsluitend SELECT. Hij repareert dus
ook niets: hij stelt vast.

Dit is de controle die op 04-08 gemeld zou hebben dat productie 9 van de 18
tabellen miste. Draai hem maandelijks en na elke uitrol naar productie.

Twee dingen om te weten:

- **Hij draait niet in CI en dat blijft zo.** De acceptatiedatabase luistert
  alleen op `127.0.0.1:55460` op saxombp — zoals het hoort — en wordt gelezen
  via `ssh … docker exec`. Een CI-runner komt niet op het tailnet. **Tailscale
  moet dus aan staan.** Is dat niet zo, gebruik dan
  `npm run verify:omgevingen -- --zonder-acceptatie`; de andere twee worden dan
  gewoon vergeleken.
- **Acceptatie hoort `beschermd` te zijn, niet `wegwerp`.** Dat wijkt af van wat
  §4.1 van het OTAP-plan lang beweerde. De e2e-suites draaien niet tegen
  acceptatie maar tegen hun eigen wegwerpcontainer, dus er is geen reden om daar
  een rem los te draaien. Markeer acceptatie niet.

`productie:poort` **schrijft nergens** — uitsluitend `SELECT count(*)`. Hij
draait ook vanzelf in de workflow *Uitrol naar productie*, twee keer: vóór het
akkoord en erna. Los draaien is handig om te kijken of alles klaarstaat.

Verwacht `STAGING_MIGRATION_DATABASE_URL` en `PRODUCTIE_MIGRATION_DATABASE_URL`.
Ontbreken die, dan blokkeert hij — hij gaat niet stilletjes terugvallen op
`.env`, want dan zou hij productie met zichzelf vergelijken.

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
| `npm run platform:inrichten` | `MIGRATION_DATABASE_URL` | Vraagt één echte Entra-login. Zie hieronder |
| `npm run db:check` | — | Drizzle-consistentie, raakt geen database |

### De eerste platformbeheerder aanwijzen

`clm.platform_admin` verwijst naar een gebruiker met een `external_subject` —
de `oid` uit Entra. Die kan niemand verzinnen: hij ontstaat pas bij een echte
login. Maar inloggen vraagt een membership, en tenants aanmaken vraagt
platformbeheer. Zonder hulp komt die cirkel niet rond.

```powershell
npm run build                        # het script verifieert met dist/
npm run platform:inrichten           # lokaal
npm run platform:inrichten -- --extern   # tegen productie
```

Het script drukt een inloglink af, wacht, en schrijft de `oid` rechtstreeks
naar de database. **De `oid` wordt nergens afgedrukt of gelogd** — dat is een
persoonsgegeven; je ziet óf het werkte, niet wie je bent.

Twee dingen die het bewust **niet** doet:

- **Geen klant-tenant aanmaken.** Dat kan de applicatie zelf sinds
  `POST /platform/tenants`, en dat is juist de route die beproefd moet worden.
  Een script dat het eromheen doet, maakt die test zinloos.
- **Niet via `DATABASE_URL`.** `clm_api_runtime` mag `clm.platform_admin`
  alleen lezen (migratie 0020, met een expliciete `REVOKE` omdat
  `ALTER DEFAULT PRIVILEGES` uit 0001 anders schrijfrechten geeft).

> **Federatief account?** Gebruik op het inlogscherm de knop van je eigen
> organisatie, niet het wachtwoordveld. `kees@alingadvies.nl` heeft in
> `mcm2ciam` geen eigen wachtwoord; het invulveld geeft dan `AADSTS50056`
> (*password does not exist in the directory*), wat eruitziet als een
> onbekend account maar dat niet is.

**`npm run db:generate` is onbruikbaar** (Issue #96). De snapshots in
`drizzle/meta` lopen tot `0007` terwijl er 17 migraties zijn; het genereert een
migratie die `sessie`, `tenant_membership` en een `user`-kolom opnieuw wil
aanmaken. **Schrijf migraties met de hand**, in de stijl van
`drizzle/0015_survey_review.sql`.

### ⚠ Vaststellen welke migraties er op een database staan

Er is **geen commando** dat dit vertelt. Verzin er ook geen — lees het uit de
database. Maar niet zomaar: de voor de hand liggende wegen geven allebei een
verkeerd antwoord.

**`drizzle.__drizzle_migrations` is de waarheid, maar `clm_api_runtime` mag er
niet bij.** Een query via `DATABASE_URL` geeft `permission denied for schema
drizzle`. Dat is opzet (ADR-009). Lees de tabel via `MIGRATION_DATABASE_URL`
(`clm_migrator`) als je hem nodig hebt.

**Tel nooit tabellen om de stand af te leiden.** Op 2026-08-08 leverde dat twee
foute conclusies op in één sessie: "productie loopt tien migraties achter" (het
waren er vijf) en "`tenant_membership` ontbreekt" (hij stond er al sinds 0009).
Oorzaak: een tabeltelling ziet niet wat migraties werkelijk doen. `0017` voegt
geen tabel toe maar verruimt een **check-constraint**, en `0012` raakt alleen
`ref.code`.

**En `information_schema.tables` liegt afhankelijk van je rol.** Die view toont
alleen tabellen waarop de bevragende rol rechten heeft. Via `DATABASE_URL`
(`clm_api_runtime`) ontbreken daardoor onder meer `clm.sessie` en
`clm.tenant_membership` — ze bestaan wel, je mag ze alleen niet zien. Dat gaf
op 2026-08-08 een telling van 12 waar het er 14 waren, en dat verschil was de
helft van de foute conclusie hierboven.

Gebruik `pg_tables` of `to_regclass`; die kennen die beperking niet:

```sql
SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'clm' ORDER BY 2;
```

Toets in plaats daarvan per migratie één kenmerk dat *alleen* ná die migratie
bestaat — en zoek de naam op in het `.sql`-bestand, reconstrueer hem niet:

```sql
SELECT
  to_regclass('clm.tenant_membership') IS NOT NULL AS m_0009,
  to_regclass('clm.survey_review')     IS NOT NULL AS m_0015,
  to_regclass('clm.response_note')     IS NOT NULL AS m_0018,
  to_regclass('clm.omgeving')          IS NOT NULL AS m_0019;
```

Voor een migratie die geen tabel maakt, toets het echte gevolg:

```sql
-- 0017 verruimt de constraint naar vier oordelen
SELECT pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conname = 'survey_review_verdict_check';
```

**Een eigen leesscript hoort in de projectmap**, niet in een tijdelijke map:
`dotenv` en `pg` staan in `node_modules` hier. Geef het een `tmp-`voorvoegsel,
laat het **uitsluitend `SELECT`** doen, en verwijder het direct na gebruik
(`git status` moet daarna schoon zijn).

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

> **Bind op localhost, niet op alle interfaces.** `-p 55440:5432` luistert op
> `0.0.0.0` — dan is de testdatabase bereikbaar vanaf het hele netwerk, met een
> wachtwoord van twee letters. Op een kantoor- of hotelnetwerk is dat een open
> database. Schrijf `-p 127.0.0.1:55440:5432`; alles hieronder werkt onveranderd,
> want migraties en tests verbinden via `localhost`.
>
> Controleren waar hij luistert: `docker port <container>`. Staat er `0.0.0.0`,
> dan is de binding te ruim.

```powershell
# De containernaam moet minstens twee tekens hebben — Docker 29 weigert één teken.
# 127.0.0.1 ervoor: anders luistert de database op alle netwerkinterfaces.
docker run -d --name mcm2test -e POSTGRES_PASSWORD=pw -p 127.0.0.1:55440:5432 postgres:17.6

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
Remove-Item Env:\MIGRATION_DATABASE_URL     # niet overslaan, zie hieronder
```

Bash — veiliger, want de variabele geldt alleen voor dít commando:
```bash
MIGRATION_DATABASE_URL="postgresql://clm_migrator:pw@localhost:55440/postgres" npm run migrate:deploy
```

> **`Remove-Item` is geen opruimnetheid maar een veiligheidsmaatregel.**
> In PowerShell blijft `$env:X` staan voor de hele sessie. Vergeet je hem, dan
> draait een uur later een backup-, seed- of migratiescript stilzwijgend tegen
> `localhost:55440` in plaats van tegen de database die je dan bedoelt — of
> andersom, als je de variabele naar productie hebt gezet.
>
> Dit is dezelfde klasse fout als Issue #86, alleen met de omgekeerde richting.
> Wil je dat risico helemaal niet: gebruik de bash-vorm.

**Controleer de melding die het script afdrukt.** Hij noemt het doelwit. Staat
daar `supabase.com`, dan is de variabele niet doorgekomen — stop.

### Markeren als wegwerp (verplicht vóór de e2e-tests)

```powershell
node scripts/markeer-wegwerp.js "wegwerp voor <waar je aan werkt>"
```

Zonder deze stap weigeren de e2e-suites te draaien: elke database komt uit
migratie 0019 als `beschermd`. Dat is opzet — zie de sectie bovenaan.

De melding die je krijgt als je het vergeet noemt het doelwit, de status en dit
commando, dus je kunt hem niet mislezen.

> **Markeer nooit de demo-database (55450) of iets op Supabase als wegwerp.**
> Het script weigert een niet-lokale host zonder `--extern`, maar tegen de demo
> op localhost is er geen technische rem — alleen deze regel.

Zie je twijfel over wat er nu gezet staat:
```powershell
Get-ChildItem Env: | Where-Object Name -match 'DATABASE_URL' |
  ForEach-Object { "{0} = {1}" -f $_.Name, ($_.Value -replace ':[^:@]+@',':***@') }
```

### E2e-tests erop draaien

```powershell
$env:DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55440/postgres"
npx jest --config test/jest-e2e.json --forceExit
Remove-Item Env:\DATABASE_URL
```

`--forceExit` is nodig sinds de sessiesuite: die houdt een pg-verbinding open,
waardoor Jest anders blijft hangen zónder foutmelding.

### Een inhaalslag toetsen vóór hij een echte database raakt

Migraties draaien lokaal altijd **vanaf nul**. Een database die al op stand N
staat is een ander pad, en dat pad is nooit gedraaid tot je het draait. Toets
het eerst op een wegwerpcontainer.

Twee dingen die het resultaat waardeloos maken als je ze overslaat:

- **Gebruik dezelfde PostgreSQL-major als het doelwit.** Supabase draait 17.
  Een test op `postgres:16` bewijst niets over syntax die per major verschilt.
  Nagaan: `SHOW server_version` op beide.
- **Boots de startstand na**, niet een lege database. Kort
  `drizzle/meta/_journal.json` tijdelijk in tot de stand van het doelwit, draai
  `migrate:deploy`, zet het journal terug, en draai dan pas de rest.

```bash
WEG="postgresql://clm_migrator:pw@127.0.0.1:55440/postgres"
cp drizzle/meta/_journal.json /tmp/_journal.backup.json
trap 'cp /tmp/_journal.backup.json drizzle/meta/_journal.json' EXIT   # ALTIJD terugzetten

# 1. startstand nabootsen (hier: t/m 0014)
node -e "const fs=require('fs'),p='drizzle/meta/_journal.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.entries=j.entries.filter(e=>e.idx<=14);
  fs.writeFileSync(p,JSON.stringify(j,null,2));"
MIGRATION_DATABASE_URL="$WEG" node scripts/migrate.js

# 2. journal terug, dan de inhaalslag zelf
cp /tmp/_journal.backup.json drizzle/meta/_journal.json
MIGRATION_DATABASE_URL="$WEG" node scripts/migrate.js
```

> **De `trap` is niet optioneel.** Blijft het journal ingekort achter, dan
> "bestaan" de laatste migraties niet meer voor Drizzle en meldt een volgende
> `migrate:deploy` doodleuk "Migraties voltooid" zonder iets te doen. Controleer
> na afloop met `git status` dat het journal ongewijzigd is.

Toets daarna in de database of elke migratie werkelijk landde — zie
"Vaststellen welke migraties er op een database staan" hierboven. "Migraties
voltooid" is geen bewijs.

### Opruimen

```powershell
docker rm -f mcm2test
```

**Ruim de container op als je klaar bent.** Een blijvende testdatabase met
wachtwoord `pw` is precies het soort ding dat maanden vergeten blijft draaien.
`docker ps` laat zien wat er nog staat.

---

## Wat dit runbook bewust NIET verzwakt

Nagelopen op 2026-08-07. Deze werkwijze mag geen enkele bestaande bescherming
omzeilen, en doet dat ook niet:

| Bescherming | Blijft gelden? |
|---|---|
| `migrate:deploy` weigert buiten lokaal zonder `--extern` of `MCM2_EXTERNE_DB=ja` | **Ja** — de wegwerpdatabase is lokaal, dus de bescherming hoeft nooit uitgezet |
| `verify.js` weigert een niet-lokale `DATABASE_URL` | **Ja** — onaangeroerd |
| Rolscheiding `clm_migrator` (DDL) / `clm_api_runtime` (runtime) / aparte backuprol | **Ja** — de opzet reproduceert alle drie via `bootstrap-roles.sql` |
| Geen `BYPASSRLS`, geen superuser op de app-rollen | **Ja** — geverifieerd op de wegwerpdatabase: beide `f` |
| `FORCE ROW LEVEL SECURITY` (migratie 0011) | **Ja** — komt mee via de migratieketen |
| `.env` buiten git | **Ja** — staat in `.gitignore`, niet getrackt |

**Drie dingen die nooit in dit runbook mogen sluipen:**

1. **Geen `--extern` of `MCM2_EXTERNE_DB=ja` als standaardstap.** Die vlag hoort
   een bewuste, zichtbare uitzondering te zijn — hij staat in de
   terminalhistorie zodat later terug te zien is dat iemand het deed. Zet hem
   nooit in een `.env`, script of alias.
2. **Nooit een echte connectiestring in een commandovoorbeeld.** Voorbeelden
   gebruiken `clm_migrator:pw@localhost`. Een commando met een echt wachtwoord
   belandt in terminalhistorie, CI-logs en schermafdrukken.
3. **Nooit `pw` buiten een wegwerpcontainer.** Het is een wegwerpwachtwoord voor
   een database die je binnen een uur weggooit — geen patroon om elders te
   hergebruiken.

**Eén ding dat wél zwakker is dan productie, en dat mag:** de wegwerpdatabase
heeft een triviaal wachtwoord en geen TLS. Dat is verdedigbaar omdat hij op
`127.0.0.1` luistert, geen echte gegevens bevat en binnen een sessie verdwijnt.
Zodra een van die drie niet meer klopt, is het geen wegwerpdatabase meer.

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

## Een nieuwe e2e-suite schrijven

Alle e2e-suites delen één database. Een suite die los groen draait kan de
volledige run alsnog rood maken — en welke suite dan omvalt, hangt af van de
volgorde. Dat is de vervelendste faalvorm in dit project: hij ziet eruit als
toeval en is het niet.

### Vier waarden moeten uniek zijn over ALLE suites heen

Deze unieke sleutels hebben **geen `tenant_id` erin**. Je eigen tenant beschermt
je dus niet:

| Sleutel | Op | Hoe je het oplost |
|---|---|---|
| `survey_response_token_hash_key` | `survey_response.token_hash` | Eigen herhaald teken per suite |
| `tenant_name_key` | `tenant.name` | Suitenaam in de tenantnaam |
| `user_external_subject_key` | `user.external_subject` | Suiteprefix **plus** `Date.now()` |
| `survey_attachment_storage_key_key` | `survey_attachment.storage_key` | Eigen prefix per suite |
| `sessie_token_hash_key` | `sessie.token_hash` | Komt uit `SessieService`, dus vanzelf uniek |

**De beproefde vormen**, zoals de bestaande suites het doen:

```ts
// token_hash — 64 hex-tekens (CHECK uit migratie 0003).
// Het herhaalde teken is je claim; kies er een die nog vrij is.
const HASH_INGEDIEND = `${'6'.repeat(48)}60ed6e0e60ed6e0e`;

// external_subject — prefix én tijdstempel. Dubbel beveiligd, want twee
// suites met dezelfde prefix zouden nog steeds botsen.
const SUBJECT_ADMIN = `oid-gk-a-${Date.now()}`;

// tenantnaam — noem de suite erin.
'Tenant A (goedkeuren)'
```

Welke tekens al vergeven zijn:
```powershell
Select-String -Path test\*.e2e-spec.ts -Pattern "repeat\(48\)"
```

**Er staat een bewakingstest op** (`test/test-ids.spec.ts`): die vangt een
botsende `token_hash` en noemt beide suites bij naam. Draai hem vóór je een
volledige e2e-run start — hij kost een seconde en heeft geen database nodig:

```powershell
npx jest test-ids
```

### Test-id's: kijk naar BEIDE uitdeelvormen

`test/test-ids.ts` deelt UUID's op twee manieren uit: letterlijk, én via de
`id()`-helper bovenaan. Zoek je alleen op de letterlijke vorm, dan lijken
staarten vrij die het niet zijn.

```powershell
# Beide vormen, samengevoegd. Schrijf de UUID voluit — met koppeltekens.
# Een verkort patroon als '0{20}([0-9a-f]{2})' vindt NUL treffers en ziet er
# toch uit alsof het werkt; het geeft dan een lijst vrije staarten die allemaal
# bezet zijn.
$viaId = Select-String -Path test\test-ids.ts -Pattern "id\('([0-9a-f]{2})'\)" -AllMatches |
  ForEach-Object { $_.Matches } | ForEach-Object { $_.Groups[1].Value }
$letterlijk = Select-String -Path test\test-ids.ts -Pattern "'00000000-0000-0000-0000-0000000000([0-9a-f]{2})'" -AllMatches |
  ForEach-Object { $_.Matches } | ForEach-Object { $_.Groups[1].Value }
$vergeven = ($viaId + $letterlijk) | Sort-Object -Unique
"$($vergeven.Count) vergeven"

# Wat is er vrij in een bereik?
0x92..0xa4 | ForEach-Object { $h='{0:x2}' -f $_; if ($vergeven -notcontains $h) { $h } }
```

**Controleer de uitkomst op plausibiliteit.** Krijg je opeens veel minder
vergeven staarten dan de vorige keer, dan matcht je patroon niet — niet dat er
ruimte is vrijgekomen.

Verzin nooit een UUID in een testbestand: er staat een bewakingstest op die elke
letterlijke test-UUID in het register wil zien.

### Geef elke test die een script start een timeout mee

Jest hanteert standaard **5 seconden**. Een test die `draaiSeed()` of een ander
Node-proces start haalt dat alleen op een verder onbelaste machine. In de
volledige run valt hij dan om — niet omdat er iets stuk is, maar omdat het even
duurde.

```ts
it('vult een lege database…', async () => {
  draaiSeed();
  // …
}, 20_000);
```

Dit is twee keer misgegaan: op 2026-08-04 en, in de tests die toen waren
overgeslagen, opnieuw op 2026-08-07.

### Voordat je een suite als klaar beschouwt

```powershell
# 1. Bewakingstests (snel, geen database)
npx jest test-ids

# 2. Je eigen suite
$env:DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55440/postgres"
npx jest --config test/jest-e2e.json <naam> --forceExit

# 3. ALLE suites samen — dit is de stap die botsingen vindt
npx jest --config test/jest-e2e.json --forceExit
```

Krijg je bij stap 2 of 3 **"E2E GESTOPT — deze database is geen
wegwerpdatabase"**, dan wijst `DATABASE_URL` naar iets dat met rust gelaten
moet worden. Kijk naar het doelwit in die melding vóór je iets anders doet:
staat daar poort 55450, dan is dat de demo, en dan moet je `DATABASE_URL`
corrigeren — niet de demo markeren.

**Stap 3 is niet optioneel.** Stap 2 groen zegt niets over botsingen; dat is
precies wat het op 2026-08-07 twee runs lang verborg.

Zakt er iets, zoek dan eerst naar de databasefout in plaats van naar de
falende assertie:
```powershell
npx jest --config test/jest-e2e.json --forceExit 2>&1 |
  Select-String -Pattern "duplicate key|violates|deadlock|Exceeded timeout"
```
`duplicate key` betekent een botsing tussen suites, `Exceeded timeout` een
ontbrekende timeout. Beide staan hierboven.

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
opzoeken ervan. `npm run migrate`, `migrate:status` en `verify:migratieketen`
zijn alle drie zo ontstaan — geen ervan bestaat.

`node scripts/db-doelwit.js` hoort in datzelfde rijtje maar ligt subtieler: het
bestánd bestaat wél. Het is een gedeelde module die andere scripts aanroepen om
hun doelwit te benoemen, en zelfstandig aanroepen doet niets zichtbaars. Een
bestaand bestand is dus geen bewijs dat er een commando is — kijk in
`package.json`.
