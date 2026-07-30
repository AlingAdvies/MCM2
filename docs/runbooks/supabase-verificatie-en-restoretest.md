# Runbook — Supabase verifiëren: restore-test, tier/garanties, migratiestand

**Type:** C/D (verificatie en routineoperatie)
**Eigenaar:** Kees Maling (enige met Supabase-dashboardtoegang)
**Aangemaakt:** 2026-07-28
**Aanleiding:** ADR-002 laat drie van de vier controls open; Issue #19 (backup/restore nooit getest) en Issue #25 (Drizzle-migratiestand).
**Vereiste toegang:** Supabase-dashboard voor project `agojesdovwsupidwlevh` (`clm-enterprise`, eu-west-1)

---

## Waarom dit runbook bestaat

Alles wat op 2026-07-28 aan de databaselaag is bewezen (ADR-010), is bewezen op **lege wegwerpcontainers**.
Tegen de echte Supabase-database is nog geen enkele Drizzle-migratie gedraaid, en er is nog **nooit**
geverifieerd of een backup van deze database daadwerkelijk herstelbaar is.

Dat laatste is het zwaarste openstaande risico van het project: niet "we vermoeden dat het goed zit",
maar "het is nooit geprobeerd". Als deze database omvalt is onbekend of er iets terug te halen valt.

Voer de stappen in volgorde uit. Stap 1 en 2 zijn read-only. Stap 3 raakt de database en mag pas
ná een geslaagde stap 1.

---

## Vooraf vastgesteld (2026-07-28, read-only geverifieerd)

Deze feiten zijn al bevestigd via de databaseverbinding — niet opnieuw controleren:

| Gegeven | Waarde |
|---|---|
| Project-ref | `agojesdovwsupidwlevh` |
| Host | `aws-1-eu-west-1.pooler.supabase.com:5432` (Session Pooler) |
| PostgreSQL | **17.6** |
| Runtime-rol | `clm_api_runtime`, `rolbypassrls = false` ✅ |
| Tabellen | 5 in `clm`, 3 in `ref`, 1 in `audit` — **stand op 2026-07-28**; dit aantal groeit, de controle in stap 1c is er niet van afhankelijk |
| Prisma-historie | 3 migraties, alle drie afgerond |
| Drizzle-historie | `drizzle.__drizzle_migrations` **bestaat niet** |
| Schema t.o.v. Drizzle-baseline | **Volledig gelijk** — geen afwijking |

**Schema-afdrijving uitgesloten — met één uitzondering.** `node scripts/verify-schema.js` is op
2026-07-28 read-only tegen de echte database gedraaid: tabellen, RLS en policies komen volledig
overeen met de baseline. Dat was de grootste onzekerheid rond stap 3.

**Maar:** dezelfde dag bleek via de restore-test dat alle vijf UUID-primaire sleutels
`DEFAULT gen_random_uuid()` missen — een erfenis van Prisma, dat UUID's in de applicatielaag
genereerde. Zie **Issue #29**. De eerste versie van de controle keek niet naar kolomdefaults en gaf
daarom `GOEDGEKEURD` op een database waartegen de applicatie niet correct werkt; die controle is
inmiddels uitgebreid. Migratie `drizzle/0002_herstel_ontbrekende_defaults.sql` lost dit op, maar is
nog **niet** toegepast op `clm-enterprise` — dat wacht op deze backup-test.

**Al opgelost:** ADR-002 control 3 (runtime-rol zonder BYPASSRLS) is hiermee ook in de echte
omgeving bevestigd, niet alleen in CI.

**Versieverschil afgehandeld:** de CI draait op Postgres 18.2, Supabase op 17.6. De volledige
migratieketen en alle 11 isolatietests zijn op 2026-07-28 ook tegen een lokale 17.6-container
gedraaid en slagen. Het versieverschil vormt geen risico.

---

## Stap 1 — Backup/restore daadwerkelijk testen (Issue #19)

**Doel:** bewijzen dat een backup van `clm-enterprise` herstelbaar is naar een werkende database.
**Raakt de productiedatabase:** nee, alleen lezen/kopiëren.
**Verwachte duur:** 30–60 minuten, grotendeels wachten.

### 1a. Vaststellen wat er aan backups is

Ga naar het Supabase-dashboard → project `clm-enterprise` → **Database** → **Backups**.

Noteer letterlijk wat je ziet:

- Is er een lijst met dagelijkse backups? Hoeveel, en hoe ver terug?
- Staat er een **Point-in-Time Recovery (PITR)**-sectie? Zo ja: welk tijdvenster?
- Staat er ergens dat PITR een betaalde add-on is die niet actief is?

> **Bij afwijking:** als er géén backups zichtbaar zijn, stop hier en meld het. Dat is op zichzelf
> een bevinding die zwaarder weegt dan de rest van dit runbook.

### 1b. Restore uitvoeren naar een wegwerp-project

Herstel **niet** over `clm-enterprise` heen. Maak een nieuw, tijdelijk project:

1. Dashboard → **New project** → naam `clm-restoretest`, regio **eu-west-1** (zelfde als origineel),
   kies het goedkoopste plan dat een restore toestaat.
2. In `clm-enterprise` → Backups → kies de meest recente backup → **Restore** / **Download**.
   - Biedt Supabase "restore to new project" aan: kies `clm-restoretest`.
   - Kan dat niet: download de backup en herstel hem handmatig — zie stap 1b-alt hieronder.

> **Let op:** kies bij een restore-dialoog nooit `clm-enterprise` als doel. Dat overschrijft de
> werkende database. Lees het bevestigingsscherm hardop na voordat je klikt.

### 1b-alt. Handmatig dumpen en herstellen — beproefde commando's

Deze route is op 2026-07-28 volledig doorlopen tegen `clm-enterprise`; de commando's hieronder
werken. Ook bruikbaar als losse controle náást de dashboard-backup: hij bewijst dat er een
herstelpad bestaat dat niet van Supabase's eigen backupfunctie afhangt.

**Er staan geen PostgreSQL-tools op de ontwikkelmachine.** Dat hoeft ook niet — de
Docker-container `postgres:17.6` bevat `pg_dump` en `pg_restore` in exact dezelfde versie als
Supabase draait. Een oudere client tegen een nieuwere server geeft problemen, dus houd deze
versie gelijk aan wat `SHOW server_version` op het origineel teruggeeft.

#### Valkuil 1 — de connectiestring bevat een parameter die pg_dump niet kent

`DATABASE_URL` en `MIGRATION_DATABASE_URL` eindigen op `?schema=public`. Dat is een
Prisma-conventie; `pg_dump` weigert hem:

```
pg_dump: error: invalid URI query parameter: "schema"
```

Strip dat deel van de string voordat je hem gebruikt.

#### Valkuil 2 — Git Bash vertaalt paden naar Windows-vorm

Een pad als `/dump/bestand.dump` wordt binnen Git Bash omgezet naar
`C:/Program Files/Git/dump/bestand.dump`, waarna de container het niet vindt. Omzeil dit door het
commando binnen de container in een `sh -c '...'` te wikkelen — dan blijft het pad ongemoeid.

#### De dump maken (alleen lezen van productie)

```bash
# Connectiestring zonder ?schema=, in een variabele die niet in de shell-historie belandt
PGURL="postgresql://clm_migrator.<project-ref>:<wachtwoord>@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"

docker run --rm -v "/pad/naar/werkmap:/dump" -e PGURL="$PGURL" postgres:17.6 \
  sh -c 'pg_dump "$PGURL" --format=custom --no-owner --no-privileges \
         --schema=clm --schema=ref --schema=audit --file=/dump/clm-enterprise.dump'
```

Gebruik `clm_migrator`, niet de runtime-rol: die laatste ziet door RLS niet alle rijen.

#### Terugzetten in een verse container

```bash
docker run -d --name mcm2-restore -e POSTGRES_PASSWORD=postgres -p 55436:5432 \
  -v "/pad/naar/werkmap:/dump" postgres:17.6

# Rollen aanmaken — die zitten NIET in de dump (zie valkuil 3)
docker exec -i mcm2-restore psql -U postgres -v ON_ERROR_STOP=1 < db/roles/bootstrap-roles.sql
docker exec -i mcm2-restore psql -U postgres \
  -c "ALTER ROLE clm_api_runtime PASSWORD 'test'; ALTER ROLE clm_migrator PASSWORD 'test';"

docker exec mcm2-restore sh -c \
  'pg_restore --dbname="postgresql://clm_migrator:test@localhost:5432/postgres" \
              --no-owner --no-privileges /dump/clm-enterprise.dump'
```

#### Valkuil 3 — na een restore heeft de applicatie géén rechten

Dit is de belangrijkste. Een dump bevat geen rollen en (met `--no-privileges`) geen grants. Na de
restore heeft alleen `clm_migrator` toegang; `clm_api_runtime` — de rol waarmee de applicatie
draait — heeft niets. De app zou dus niet opstarten, terwijl de database er verder gaaf uitziet.

Herstel dat door de rechten-migratie opnieuw toe te passen:

```bash
docker exec -i mcm2-restore psql -U postgres -v ON_ERROR_STOP=1 < drizzle/0001_rolrechten.sql
```

> **Dit is geen theoretisch detail.** Zonder deze stap meldt de verificatie in 1c dat álle tabellen
> ontbreken — niet omdat ze weg zijn, maar omdat `information_schema.tables` alleen toont waarop je
> rechten hebt. Precies het soort verwarring dat je tijdens een incident niet wilt.

#### Valkuil 4 — de UUID-defaults ontbreken in de bestaande database

Een uit `clm-enterprise` herstelde database mist `DEFAULT gen_random_uuid()` op de vijf
UUID-primaire sleutels (Issue #29). Zolang die daar niet is hersteld, geldt dat ook voor elke
kopie. Toepassen:

```bash
docker exec -i mcm2-restore psql -U postgres -v ON_ERROR_STOP=1 \
  < drizzle/0002_herstel_ontbrekende_defaults.sql
```

Deze migratie is idempotent — hem tweemaal draaien of toepassen op een database die de defaults al
heeft, verandert niets.

#### Opruimen

```bash
docker rm -f mcm2-restore
rm /pad/naar/werkmap/clm-enterprise.dump
```

> **Verwijder de dump.** Het is een volledige kopie van de productiedatabase. Zodra er
> leveranciersdata in staat, is een rondslingerend dumpbestand een datalek-in-wording.

### 1c. Verifiëren dat de restore klopt

Neem de connectiestring van `clm-restoretest` en draai:

```bash
VERIFY_DATABASE_URL="postgresql://...connectiestring-van-clm-restoretest..." node scripts/verify-schema.js
```

Het script is read-only en leidt de verwachting af uit `src/db/schema.ts` — het bevat zelf geen lijst
van tabellen, dus het blijft kloppen naarmate de applicatie groeit. Het controleert:

- elke tabel uit het schema bestaat ook echt in de database;
- er staan geen tabellen in de database die níet in het schema zitten;
- RLS actief op elke tenantgebonden tabel (herkend aan de `tenant_id`-kolom);
- elke policy heeft zowel `USING` als `WITH CHECK`;
- **elke kolom met een default in het schema heeft die ook in de database** (toegevoegd na #29);
- de verbinding draait niet als een rol die RLS omzeilt.

**Geslaagd wanneer** het script afsluit met `GOEDGEKEURD`. Bij `AFGEKEURD` somt het per regel op wat
ontbreekt — dat is de bevinding, niet een reden om het nog eens te proberen.

**Niet** geslaagd bij "de database bestaat en ik kan inloggen" — dat zegt niets over de inhoud.

> **Wat dit script níet controleert: of de dáta is meegekomen.** Het bewijst dat de *structuur*
> klopt — tabellen, RLS, policies. Een correct herstelde maar lege database zou hier slagen.
>
> Dat is geen omissie maar een gevolg van RLS: de runtime-rol ziet zonder tenant-context nul rijen,
> dus tellen levert altijd `0` op. Controleer de datahoeveelheid daarom via het Supabase-dashboard
> (Database → Tables toont rijaantallen als beheerder) en vergelijk die met het origineel. Zolang de
> database in de pilotfase leeg is, is dit een formaliteit; zodra er leveranciersdata in staat, is
> het de belangrijkste controle van de hele test.

### 1c-bis. Bewijzen dat de herstelde database ook echt bruikbaar is

De structuurcontrole zegt dat de tabellen kloppen. Deze stap bewijst dat de applicatie er ook mee
kan werken — een schrijfactie die faalt op een ontbrekende default zou hierboven onopgemerkt blijven.

```bash
DATABASE_URL="postgresql://clm_api_runtime:test@localhost:55436/postgres" npm run test:e2e
```

**Geslaagd wanneer alle tests groen zijn.** Op 2026-07-28 faalden hier 6 van de 20 tegen een uit
productie herstelde database — precies de vijf UUID-sleutels uit #29. Ná toepassing van migratie
`0002` waren het er 20 van 20. Dat verschil is de reden dat deze stap bestaat.

### 1d. Meetwaarden noteren — niet overslaan

Vul de tabel onderaan dit runbook in. Dit is geen administratie om de administratie: een restore van
een lege database duurt seconden, een gevulde met certificaten kan uren duren. Zonder een reeks
metingen is die groei onzichtbaar tot het moment dat het een probleem is.

Noteer: datum, databaseomvang, hoe lang de restore duurde (van start tot geverifieerd), en de
uitkomst van `verify-schema.js`.

### 1e. Opruimen

Verwijder `clm-restoretest` zodra de verificatie klaar is. Een restore-project met echte data dat
blijft staan is een datalek-in-wording. Noteer de uitkomst in Issue #19 en sluit dat issue.

---

## Stap 2 — Tier en garanties vaststellen (ADR-002, control 2)

**Doel:** vastleggen wat Supabase contractueel biedt, zodat "we hebben backups" een onderbouwde
uitspraak wordt.
**Raakt de productiedatabase:** nee.
**Verwachte duur:** 15 minuten.

Ga naar **Settings** → **Billing** / **Subscription** en noteer:

| Vraag | Waar te vinden |
|---|---|
| Welk plan draait `clm-enterprise`? (Free / Pro / Team) | Settings → Billing |
| Wat is de backupfrequentie en -bewaartermijn? | Database → Backups |
| Is PITR actief, en zo ja welk venster? | Database → Backups |
| Wat is de uptime-SLA van dit plan? | Supabase-documentatie bij het plan |
| Wat is de support-responstijd? | Idem |
| Waar staat de data fysiek? (moet eu-west-1 zijn) | Settings → General |

> **Waarom dit ertoe doet:** op het Free-plan pauzeert Supabase projecten na inactiviteit en zijn
> backupgaranties beperkt. Voor een pilot met een echte klant (Transdev, deadline 1 september) is
> dat een reëel risico. Als hier "Free" uitkomt, is een upgrade waarschijnlijk nodig vóór de pilot —
> dat is een kostenbeslissing die bij jou ligt.

---

## Stap 3 — Drizzle-migratiestand initialiseren (Issue #25)

**Doel:** Drizzle laten weten dat migratie `0000` en `0001` al toegepast zijn, zonder de SQL
opnieuw uit te voeren.
**Raakt de productiedatabase:** **ja** — schrijft een nieuwe tabel.
**Voorwaarde:** stap 1 geslaagd. Zonder bewezen herstelpad hier niet aan beginnen.

### Waarom dit nodig is

De database bevat de drie Prisma-migraties (alle afgerond). Drizzle houdt zijn eigen boekhouding bij
in `drizzle.__drizzle_migrations` — die tabel bestaat daar niet. Een `npm run migrate:deploy` zou
daarom `0000_baseline_bestaand_schema.sql` willen uitvoeren op tabellen die al bestaan, en halverwege
afbreken op de eerste `CREATE TABLE`.

### Uitvoering

Dit is geen dashboardwerk. Vraag mij dit uit te voeren zodra stap 1 groen is; het vereist een
gecontroleerd script dat:

1. eerst read-only verifieert dat het Supabase-schema **daadwerkelijk** overeenkomt met de baseline
   (tabellen, kolommen, policies) — niet aannemen, controleren;
2. bij een afwijking stopt en rapporteert in plaats van door te gaan;
3. pas daarna `drizzle.__drizzle_migrations` aanmaakt met de twee migraties als toegepast gemarkeerd;
4. afsluit met een `migrate:deploy` die **geen** wijzigingen meer oplevert.

Punt 1 is de kern: als het Supabase-schema is afgedreven van wat de baseline beschrijft, is
markeren-als-toegepast een leugen die pas bij de volgende migratie ontploft.

`public._prisma_migrations` blijft voorlopig staan als vastlegging van wat er historisch is
toegepast. Niet verwijderen zonder apart besluit.

---

## Stap 4 — ADR-002 bijwerken

Na stap 1–3: werk `docs/adr/ADR-002-database-supabase-postgresql.md` bij met de werkelijke stand van
de vier controls, met per control een verwijzing naar het bewijs (testresultaat, screenshot,
issuenummer). Control 3 kan nu al als afgerond worden gemarkeerd.

Control 4 (NIS2/ISO27001-toetsing van Supabase's dataverwerkingsmodel) blijft daarna nog open — dat
is documentonderzoek, geen test, en valt buiten dit runbook.

---

## Meetregister — invullen bij elke restore-test

Elke rij is één uitgevoerde test. De reeks maakt groei zichtbaar: loopt de hersteltijd op terwijl de
eisen uit ADR-011 gelijk blijven, dan is dat een signaal vóórdat het een incident wordt.

| Datum | Omvang database | Duur restore (start → geverifieerd) | `verify-schema.js` | Binnen RTO uit ADR-011? | Uitgevoerd door |
|---|---|---|---|---|---|
| 2026-07-28 | 21,7 kB dump, 9 tabellen, geen klantdata | dump 5s + restore 1s + rechten <1s ≈ **10s** | GOEDGEKEURD (na herstel grants én defaults) | Ja, ruim — norm is 1 werkdag | Claude, via `pg_dump`/`pg_restore` in container |

**Toelichting bij de eerste meting.** Dit was een handmatige dump-restore, **niet** de
dashboard-backup van Supabase. Het bewijst dat er een werkend herstelpad bestaat en levert een
vertrekpunt voor de reeks, maar het beantwoordt nog niet de vraag uit Issue #19: is Supabase's eigen
backup herstelbaar? Daarvoor is stap 1a/1b nodig, met dashboardtoegang.

De 10 seconden zeggen bovendien weinig: de database was leeg op drie lookup-tabellen na. Verwacht
een heel andere orde van grootte zodra er 50 leveranciers, survey-antwoorden en certificaten in
staan. Dát is precies waarom deze tabel bestaat.

Twee bevindingen uit deze meting zijn als issue vastgelegd: de ontbrekende grants na een restore
(nu stap 1b-alt, valkuil 3) en de ontbrekende UUID-defaults (Issue #29, valkuil 4).

**Hertest-frequentie** hangt aan de projectfase, zie ADR-011:

- Ontwikkeling: bij elke wijziging in de databaselaag
- Transdev-pilot: elk kwartaal, plus na elke schemawijziging die tabellen toevoegt
- Productie: elk kwartaal, gedocumenteerd

## Hoe dit runbook meegroeit met de database

Dit runbook noemt bewust **geen** vast aantal tabellen meer. De controle in stap 1c leidt af wat er
hoort te bestaan uit `src/db/schema.ts` — de bron die per definitie actueel is, want daar worden
nieuwe tabellen aangemaakt.

`test/schema-conformiteit.e2e-spec.ts` draait ook als CI-poort en faalt bij:

- een tabel uit het schema die in de database ontbreekt;
- een tabel in de database die niet in het schema staat (buiten de migratieketen om aangemaakt);
- **een tenantgebonden tabel zonder RLS** — herkend aan de `tenant_id`-kolom;
- een policy zonder `USING` of zonder `WITH CHECK`.

Dat laatste is de belangrijkste: drizzle-kit genereert geen RLS (ADR-010), dus een nieuwe tabel met
`tenant_id` krijgt niet automatisch een policy. Zonder deze poort zou dat pas bij een datalek
opvallen. Beide faalscenario's zijn op 2026-07-28 daadwerkelijk uitgelokt om te bevestigen dat de
test ook rood wordt wanneer dat hoort.

## Stap 0 — Dagelijkse backup inrichten (VERPLICHT vóór de pilot)

**Waarom dit stap 0 is en niet stap 6:** de pilot draait op Supabase Free, dat géén enkele
providerbackup levert (Issue #30). Deze dump is daarmee niet "extra zekerheid" maar het **enige
vangnet**. Zonder dit is de pilot niet verdedigbaar tegenover een klant wiens leveranciers gegevens
hebben aangeleverd. Zie de risico-acceptatie in ADR-011.

Meegenomen voordeel: dagelijkse activiteit voorkomt dat Supabase het project pauzeert na ~7 dagen.

### 0a. Handmatig draaien

```bash
npm run backup:dump

# Of naar een specifieke map:
BACKUP_DIR="D:/mcm2-backups" npm run backup:dump
```

Het script gebruikt `pg_dump` uit de container `postgres:17.6` — dezelfde versie als Supabase — en
lost de vier valkuilen uit stap 1b-alt zelf op. Het bewaart 14 dagen aan dumps en ruimt oudere op.
Een lege dump wordt als mislukking behandeld en verwijderd, zodat een afgebroken poging nooit als
geslaagde backup blijft staan.

Op 2026-07-28 getest tegen `clm-enterprise`: 21,2 kB in 9,8s.

### 0b. Dagelijks inplannen

**INGERICHT OP 2026-07-30.** De taak `MCM2 databasebackup` draait dagelijks om 07:00 en schrijft
naar OneDrive. Onderstaande beschrijving is de werkende opzet, niet het advies dat er eerder stond —
dat advies werkte namelijk niet, zie de valkuilen hieronder.

De taak roept `scripts/backup-taak.cmd` aan. Dat tussenbestand is geen omweg maar de kern van de
oplossing: het logt start, einde en uitkomst, en geeft de echte exitcode door aan Taakplanner.

```powershell
$actie = New-ScheduledTaskAction -Execute "C:\DEV\Work\MCM2\scripts\backup-taak.cmd" -WorkingDirectory "C:\DEV\Work\MCM2"
$trigger = New-ScheduledTaskTrigger -Daily -At 07:00
$instellingen = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "MCM2 databasebackup" -Action $actie -Trigger $trigger -Settings $instellingen -Principal $principal -Description "Enige backup van clm-enterprise; Supabase Free levert er geen. Zie ADR-011."
```

`-StartWhenAvailable` haalt een gemiste run in wanneer de laptop om 07:00 uit stond.

#### Twee valkuilen die op 2026-07-30 daadwerkelijk toesloegen

**1. Taakplanner meldde "geslaagd" terwijl er niets gebeurde.** De eerste opzet riep het commando
rechtstreeks aan via `cmd.exe /c ...`. Resultaat: `LastTaskResult = 0`, geen dump, geen logregel.
Reden: `cmd.exe` geeft 0 terug zodra het zelf kon starten — of het commando erbinnen slaagde, telt
niet mee.

Dit is exact de faalvorm waar de waarschuwing hieronder voor bedoeld is, en hij is dus geen
theoretisch risico. Het tussenbestand lost het op door de exitcode expliciet door te geven
(`exit /b %UITKOMST%`) en altijd te loggen.

**2. Een `.cmd`-bestand in UTF-8 wordt onleesbaar voor `cmd.exe`.** Het tussenbestand is de eerste
keer als UTF-8 weggeschreven (de standaard van de meeste editors). `cmd.exe` leest dat verkeerd en
voert elke regel als los commando uit — een reeks meldingen als `'beschermd' is not recognized`.

`scripts/backup-taak.cmd` moet daarom **ASCII** blijven, zonder accenten of speciale tekens. Bij
bewerken:

```powershell
[System.IO.File]::WriteAllText($pad, $inhoud, [System.Text.Encoding]::ASCII)
```

#### Controleren of de taak echt draait

```powershell
# Wanneer draaide hij, en met welk resultaat?
Get-ScheduledTaskInfo -TaskName "MCM2 databasebackup" | Select-Object LastRunTime, LastTaskResult, NextRunTime

# Wat is er gebeurd? Elke run schrijft hier een start- en een uitkomstregel.
Get-Content "C:\Users\cmali\OneDrive - Aling Advies\MCM2-backups\backup-taak.log" -Tail 20
```

> Handmatig twee keer snel achter elkaar starten werkt niet: Windows slaat een herstart over van een
> taak die het als net-uitgevoerd beschouwt. Dat is geen fout — kijk in het log of er een nieuwe
> `start`-regel bij kwam.

> Controleer na een week of de taak daadwerkelijk draait — een geplande taak die stil faalt is
> erger dan geen taak, want je denkt beschermd te zijn.

### 0c. Bewaren op een tweede locatie

**Een dump op de ontwikkelmachine beschermt tegen "de database valt om", niet tegen "de laptop valt
om".** Zet `BACKUP_DIR` op een tweede locatie:

- de **eigen thuisserver** (`saxombp`, bereikbaar via Tailscale) — altijd aan, los van de
  werkmachine. Besluit 2026-07-28, zie ADR-011: die machine draagt de pilot niet, maar is hier wél
  het juiste gereedschap;
- of een gesynchroniseerde map (OneDrive), of een externe schijf.

Voor productie hoort dit naar objectopslag; voor de pilot volstaat een tweede fysieke locatie.

> Het script waarschuwt als de vorige dump meer dan 36 uur oud is. Dat is de enige signalering dat
> de geplande taak heeft stilgelegen — en zolang de pilot op Free draait, is die dump de enige
> backup. Negeer die waarschuwing niet.

### 0d. Herstelbaarheid aantonen — minstens één keer

Een backup die je nooit hebt teruggezet, is een aanname. Doorloop stap 1b-alt met een echte dump en
sluit af met stap 1c en 1c-bis.

Op 2026-07-28 uitgevoerd: dump → restore in een verse container → rechten → defaults → **20 van 20
e2e-tests groen**. Herhaal dit maandelijks tijdens actieve surveyrondes (ADR-011).

---

## Stap 5 — Een andere provider toetsen (optioneel, ~20 minuten)

**Aanleiding:** Supabase Free heeft géén backups en pauzeert projecten na ~7 dagen inactiviteit
(Issue #30). PITR kost daar **$100/maand bovenop Pro**. Andere aanbieders leveren PITR binnen het
plan — voor een fractie daarvan. Voordat je $1.500 per jaar vastlegt, is het de moeite waard te
meten of een overstap realistisch is.

**Waarom dit kán:** MCM2 gebruikt Supabase puur als gehoste PostgreSQL. Geen Supabase Auth, geen
Storage, geen Edge Functions, geen `supabase-js`. Schema, migraties, rollen en RLS zijn standaard
PostgreSQL. Dat is geen toeval maar het gevolg van ADR-008 en ADR-009.

### 5a. Gratis project aanmaken bij de kandidaat

Neem het gratis plan — voor deze toets is dat genoeg. Kies een **EU-regio** (bijv. `eu-central-1`,
Frankfurt) zodat de test representatief is voor waar de data uiteindelijk staat.

Noteer twee connectiestrings:

- één met **beheerrechten** (moet `CREATE ROLE` mogen — het script controleert dat);
- één voor de **runtime-rol** `clm_api_runtime`. Bestaat die nog niet, verzin dan een wachtwoord:
  het script maakt de rol aan en zet dat wachtwoord.

> Strip een eventuele `?schema=`-parameter uit beide strings. Dat is een Prisma-conventie die
> `pg_dump` en sommige drivers weigeren.

### 5b. De toets draaien

```bash
TARGET_MIGRATION_URL="postgresql://<beheerder>:<pw>@<host>/<db>?sslmode=require" \
TARGET_RUNTIME_URL="postgresql://clm_api_runtime:<verzonnen-pw>@<host>/<db>?sslmode=require" \
node scripts/provider-migratietest.js
```

Het script raakt Supabase niet. Het draait uitsluitend tegen de doelomgeving en doorloopt:

1. verbinding en serverversie (Supabase draait 17.6 — lager kan syntaxverschillen geven);
2. of de gebruiker rollen en schemas mag aanmaken;
3. of `gen_random_uuid()` beschikbaar is (nodig voor migratie 0002);
4. de rollenbootstrap uit `db/roles/bootstrap-roles.sql`;
5. de volledige migratieketen;
6. alle 20 e2e-tests: schema-conformiteit, RLS, tenant-isolatie, kolomdefaults.

### 5c. De uitkomst lezen

**`GESCHIKT`** — de provider draait MCM2 zonder aanpassing aan schema, migraties, rollen of RLS.
Een overstap is dan `pg_dump` → nieuw project → `pg_restore` → grants → connectiestring omzetten;
zie stap 1b-alt, die route is bewezen.

**`NIET ZONDER MEER GESCHIKT`** — elke bevinding is werk dat een overstap zou kosten. Weeg dat tegen
het kostenverschil. Twee dingen die het vaakst misgaan bij managed diensten:

- `CREATE ROLE` is voorbehouden aan de provider-beheerder. Dan werkt het vierrollenmodel uit ADR-008
  niet zonder aanpassing — een reëel bezwaar, want dat model draagt de tenant-isolatie.
- Connection pooling werkt anders. Meestal configuratiewerk, geen herbouw, maar wel uitzoeken.

### 5d. Testomgeving opruimen

Een testproject met een volledig schema en zes databaserollen laten staan is onnodige
aanvalsoppervlakte. Schema's droppen is niet genoeg — de rollen blijven bestaan en houden
verwijzingen vast.

De volgorde die werkt (op 2026-07-28 doorlopen tegen Neon):

```sql
DROP SCHEMA IF EXISTS clm CASCADE;
DROP SCHEMA IF EXISTS ref CASCADE;
DROP SCHEMA IF EXISTS audit CASCADE;
DROP SCHEMA IF EXISTS drizzle CASCADE;   -- migratieboekhouding van Drizzle

-- Rollen in deze volgorde: clm_migrator als laatste.
DROP ROLE IF EXISTS clm_api_runtime;
DROP ROLE IF EXISTS clm_admin;
DROP ROLE IF EXISTS clm_readonly;
DROP ROLE IF EXISTS clm_audit_reader;
DROP ROLE IF EXISTS clm_api;

-- clm_migrator weigert eerst: twee verwijzingen uit de bootstrap blijven hangen.
REVOKE clm_migrator FROM <provider-eigenaar>;   -- bij Neon: neondb_owner
REVOKE ALL ON SCHEMA public FROM clm_migrator;
DROP ROLE IF EXISTS clm_migrator;
```

> **Twee valkuilen.** `DROP ROLE clm_migrator` faalt met *"cannot be dropped because some objects
> depend on it"* zolang (a) de provider-eigenaar er lid van is en (b) de rol `CREATE` heeft op
> `public` — beide gezet door `bootstrap-roles.sql`. `DROP OWNED BY clm_migrator` is géén oplossing:
> een gewone projecteigenaar mag dat bij een managed provider niet uitvoeren
> (*"permission denied to drop objects"*). De twee `REVOKE`-regels hierboven wel.

Controleer daarna dat er niets rest:

```sql
SELECT rolname FROM pg_roles WHERE rolname LIKE 'clm_%';           -- moet leeg zijn
SELECT count(*) FROM information_schema.tables
 WHERE table_schema NOT IN ('pg_catalog','information_schema');    -- moet 0 zijn
```

**Roteer daarna het wachtwoord** van de testomgeving, of verwijder het project. Een connectiestring
die in een chat, terminalgeschiedenis of scriptaanroep heeft gestaan, moet je als gelekt beschouwen.

### 5e. Uitkomst vastleggen

Noteer het resultaat in Issue #30 en, bij een keuze, in ADR-011 en ADR-002. Een vergelijking die
alleen in een gesprek bestaat, is bij de volgende kostenafweging weer weg.

---

## Wat dit runbook niet beantwoordt

Of Supabase de **juiste keuze** blijft voor een platform met NIS2-ambities en betalende klanten.
Dat is een leveranciersafweging, geen test. De uitkomst van stap 1 en 2 is er wel directe input
voor: een tegenvallende backupgarantie of een ontoereikend tier weegt zwaar in die beslissing.
