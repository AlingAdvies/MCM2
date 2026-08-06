# Runbook — migratiestand initialiseren op een bestaande database

**Type:** A — eenmalige databasehandeling met rollback
**Eigenaar:** de eigenaar (Chris)
**Laatste update:** 2026-08-04
**Vereiste toegang:** `MIGRATION_DATABASE_URL` in `.env`, Docker Desktop, Telegram voor de meldingen
**Duur:** ongeveer 10 minuten, waarvan 1 minuut daadwerkelijk schrijven

> **Lost op:** Issue #25 (migratiestand initialiseren) en Issue #29 (ontbrekende UUID-defaults).
> **Vereist:** migratie `0014_baseline_convergentie.sql` moet in de repository staan.
> **Onderbouwing:** de meting van 2026-08-04, zie `scripts/baseline-vergelijken.js`.

---

## Waarom dit runbook bestaat

Bij de overstap van Prisma naar Drizzle (ADR-010) is de bestaande Supabase-database bewust
niet aangeraakt: de migratieketen is getest op verse, lege containers. Verstandig — maar de
tweede helft van die overstap is nooit afgemaakt.

Het gevolg, gemeten op 2026-08-04:

- `clm-enterprise` staat stil op de Prisma-historie van **27 juli** en heeft **9 tabellen**;
  het project is inmiddels bij migratie 0014 en heeft er **18**.
- De ontbrekende negen zijn álle vragenlijsten, antwoorden, geüploade certificaten,
  `tenant_membership` en `sessie` — precies het bewijsmateriaal waar het product om draait.
- Daardoor is ook **de dagelijkse backup incompleet**: die dumpt netjes wat er staat, en dat
  is de helft.

Drizzle kent de Prisma-historie niet. Een `migrate:deploy` begint daarom bij 0000, op tabellen
die al bestaan. **Aangetoond op een replica: dat faalt meteen op `CREATE SCHEMA "audit"`** —
niet netjes overgeslagen, maar afgebroken.

De oplossing heet *baselinen*: Drizzle's boekhouding aanleggen met 0000 en 0001 als "reeds
toegepast", zodat hij vanaf 0002 verder werkt.

---

## Dit is doorgemeten, niet beredeneerd

Op 2026-08-04 is de volledige procedure uitgevoerd op een replica: de echte productiedump in
een wegwerpcontainer, met dezelfde rollen en hetzelfde eigendom als Supabase.

| Stap | Uitkomst op de replica |
|---|---|
| `migrate:deploy` zonder baselinen | faalt op `CREATE SCHEMA "audit"` |
| Baselinen + `migrate:deploy` | 9 tabellen → 18, 15 migraties vastgelegd |
| Schema-conformiteit daarna | 17 van 17 tests groen |
| Baselinen een tweede keer | geweigerd met duidelijke melding |

**Twee dingen die daarbij bleken** en die de reden zijn dat er een script voor is in plaats van
twee `INSERT`-statements:

1. **De boekhoudtabel moet eigendom zijn van `clm_migrator`.** Maak je hem aan als `postgres`,
   dan faalt de eerstvolgende migratie op `permission denied for schema clm` — een foutmelding
   die naar de verkeerde plek wijst.
2. **De hash moet exact overeenkomen** met het migratiebestand. Eén teken verschil en Drizzle
   beschouwt 0000 als niet-toegepast en probeert hem alsnog.

---

## Uitgevoerd op 2026-08-04 — twee dingen die het runbook nog niet wist

De procedure is op 2026-08-04 tegen `clm-enterprise` uitgevoerd. Uitkomst: 9 tabellen werden
er 18, schema-conformiteit 17 van 17, backupcontrole groen op alle drie de lagen.

Twee dingen liepen anders dan hier beschreven. Beide staan hieronder als stap 0 en stap 7,
zodat een volgende omgeving er niet opnieuw op stuit.

**1. `clm_migrator` had geen `CREATE`-recht op de database.** Stap 4 brak af op
`permission denied for database postgres`. De transactie draaide terug; er was niets gewijzigd.

`db/roles/bootstrap-roles.sql` regel 67–68 schrijft die grants al voor — ze waren alleen nooit
op Supabase toegepast. Dezelfde onafgemaakte overstap als Issue #25 zelf. Zie **stap 0**.

**2. Na de migraties was de backup stuk.** Migratie 0011 zet `FORCE ROW LEVEL SECURITY`, en
dat geldt ook voor de tabeleigenaar. `pg_dump` als `clm_migrator` faalt sindsdien op
`query would be affected by row-level security policy for table "audit_event"`.

Dat is Issue #78, die vanochtend nog een open vraag was en door deze migratie acuut werd. Zie
**stap 7**.

---

## Stap 0 — Rechten van de migratierol controleren

**Waarom:** zonder `CREATE` op de database kan `clm_migrator` het schema `drizzle` niet
aanmaken, en breekt stap 4 af.

**Actie:**

```powershell
node -e "require('dotenv').config();const{Client}=require('pg');const c=new Client({connectionString:process.env.MIGRATION_DATABASE_URL});c.connect().then(()=>c.query(\"SELECT has_database_privilege(current_user,'postgres','CREATE') AS mag_create\")).then(r=>{console.log(r.rows[0]);return c.end()})"
```

**Verwacht:** `{ mag_create: true }`

**Bij `false`:** zet de grants die `db/roles/bootstrap-roles.sql` al voorschrijft. Dit vraagt
een rol met meer rechten — bij Supabase is dat `postgres`:

```sql
GRANT CREATE ON DATABASE postgres TO clm_migrator;
GRANT CREATE ON SCHEMA public TO clm_migrator;
```

Dit is geen uitbreiding van wat het project toestaat; het brengt de database in lijn met wat
er al gedocumenteerd staat. `CREATE ON DATABASE` betekent "mag schema's aanmaken", niet "mag
alles".

---

## Vooraf — controleer dit eerst

```powershell
# 1. Sta je op de juiste branch en is de werkboom schoon?
git status

# 2. Staat migratie 0014 er?
Get-ChildItem drizzle\0014_baseline_convergentie.sql

# 3. Draait Docker?
docker ps
```

**Waarschuwing:** dit runbook wijzigt de **productiedatabase**. Doe het niet tussendoor, niet
aan het eind van de dag, en niet terwijl iemand anders met de applicatie werkt.

---

## Stap 1 — Verse backup maken

**Waarom:** dit is het vangnet voor alle volgende stappen. De dump van vanochtend is niet
genoeg; er kan sindsdien iets gewijzigd zijn.

**Actie:**

```powershell
npm run backup:dump
```

**Verwacht resultaat:** `Geslaagd — 21.2 kB in Xs.` en een nieuw bestand in de backupmap.

**Bij afwijking:** stop. Zonder verse backup gaat de rest niet door. Draait Docker Desktop?

**Noteer de bestandsnaam** — die heb je nodig bij een rollback.

---

## Stap 2 — Meten of het schema overeenkomt met de baseline

**Waarom:** baselinen zegt tegen Drizzle "0000 en 0001 zijn al gedaan". Klopt dat niet, dan
denkt hij voortaan dat de database in een toestand is waarin hij niet verkeert, en bouwt elke
volgende migratie voort op een verkeerde aanname.

**Actie** (read-only, schrijft niets):

```powershell
node scripts/baseline-vergelijken.js
```

**Verwacht resultaat op 2026-08-04** — drie soorten verschillen:

| Verschil | Ernst |
|---|---|
| `DEFAULT now()` vs `CURRENT_TIMESTAMP` (11 kolommen) | cosmetisch — synoniemen in PostgreSQL |
| Constraint-namen + `ON UPDATE CASCADE` (8 stuks) | cosmetisch — Prisma's naamgeving |
| **4 ontbrekende tenant-indexen** | **echt** — wordt opgelost door 0014 |
| **11 kolommen met een andere default** | waarvan **5 echt**: de UUID-primary-keys uit Issue #29 |

De vijf die er werkelijk toe doen zijn de primary keys van `audit_event`, `tenant`, `user`,
`vendor` en `vendor_contact`. De overige zes regels in die groep zijn de
`now()`/`CURRENT_TIMESTAMP`-synoniemen. `clm.vendor_tag` staat er niet bij: die heeft een
samengestelde primary key `(vendor_id, tag)` en dus geen UUID-kolom.

**Bij afwijking:** zie je andere verschillen dan deze vier groepen — een ontbrekende tabel, een
andere kolomsoort, een ontbrekende policy — **stop dan**. Dat is een structureel verschil dat
eerst beoordeeld moet worden. Baselinen zou het verbergen in plaats van oplossen.

---

## Stap 3 — Boekhouding initialiseren (proefdraai)

**Actie:**

```powershell
node scripts/baseline-initialiseren.js
```

Zonder `--uitvoeren` is dit een **proef**: het toont wat het zou doen en schrijft niets.

**Verwacht resultaat:**

```
Doeldatabase : postgresql://clm_migrator...:***@aws-1-eu-west-1.pooler.supabase.com:5432/postgres
Rol          : clm_migrator
Modus        : PROEF — er wordt niets geschreven

Gevonden: 9 tabellen in clm, ref en audit.

Wordt vastgelegd als "reeds toegepast":
  0000_baseline_bestaand_schema
    hash 8e1832b4dc0c0558277316d73c010d96e2e137f926831f4106c08fd5329f675f
  0001_rolrechten
    hash 91c741f178bbd51c1f7337daa8a3a4324fa38f5c6af9e4ea4f30b42936426961

PROEF — er is niets geschreven.
```

**Controleer twee dingen:**

- **Rol is `clm_migrator`** — niet `postgres`. Staat er iets anders, dan wijst
  `MIGRATION_DATABASE_URL` naar de verkeerde rol en klopt het eigendom straks niet.
- **Doeldatabase is de juiste** — lees de hostnaam echt.

**Bij afwijking:**
- *"AFGEBROKEN — er staan al N migratie(s) vastgelegd"* → deze database is al gebaselined. Sla
  stap 4 over en ga door naar stap 5.
- *"AFGEBROKEN — er staat geen enkele tabel"* → verkeerde database. Op een lege database draai
  je gewoon `npm run migrate:deploy` (met `-- --extern` als die database niet op deze machine
  staat).

---

## Stap 4 — Boekhouding initialiseren (uitvoeren)

**Dit is de eerste stap die schrijft.** Uitsluitend in het schema `drizzle`; geen enkele
bestaande tabel, rij of policy wordt aangeraakt. Alles in één transactie: of het komt er
helemaal in, of niets.

**Actie:**

```powershell
node scripts/baseline-initialiseren.js --uitvoeren
```

**Verwacht resultaat:**

```
GEDAAN — 2 migratie(s) vastgelegd, eigendom bij 'clm_migrator'.

Volgende stap: npm run migrate:deploy
```

**Bij afwijking:** de transactie is teruggedraaid; er staat niets half. Lees de foutmelding en
los die op voordat je opnieuw draait.

---

## Stap 5 — De migraties uitvoeren

**Wat er gebeurt:** Drizzle slaat 0000 en 0001 over en voert 0002 tot en met 0014 uit. Dat
zijn de survey-tabellen, het rechtenmodel, sessies, RLS-verscherpingen, de actor-grens en de
convergentie uit 0014.

**Actie:**

```powershell
npm run migrate:deploy -- --extern
```

> **Waarom hier `--extern` staat.** Sinds Issue #86 weigert `migrate:deploy` te draaien tegen
> een database die niet op deze machine staat, tenzij je dat expliciet meegeeft. Deze runbook
> richt zich op een replica of op productie — dus niet-lokaal, dus de vlag is nodig.
>
> Dat is precies de bedoeling: op 2026-08-06 draaide dit commando per ongeluk tegen productie
> omdat `.env` daarheen wees, en het meldde gewoon "Migraties voltooid". De vlag maakt van die
> vergissing een bewuste handeling.
>
> Draai je tegen een lokale wegwerpcontainer, laat de vlag dan weg.

**Verwacht resultaat:**

```
Migraties: <host>:5432/postgres als rol 'clm_migrator' [NIET-LOKAAL]
Doelwit is niet-lokaal, maar --extern is meegegeven. Doorgaan.

Verbonden als rol 'clm_migrator'.
Migraties voltooid.
```

**Lees de eerste regel voordat je verdergaat.** Daar staat tegen welke database je werkelijk
draait. Staat daar een andere host dan je bedoelde, breek dan af — er is op dat moment nog
niets gewijzigd.

Dit duurt op de replica enkele seconden.

**Bij afwijking:** noteer bij welke migratie het misging (staat in de foutmelding) en ga naar
de rollback onderaan. Migraties draaien per stuk in een transactie, dus de gefaalde migratie
zelf is teruggedraaid — maar de eerdere zijn toegepast.

---

## Stap 6 — Verifiëren

Drie controles, in oplopende zwaarte.

**6a — Tellen:**

```powershell
node -e "require('dotenv').config();const{Pool}=require('pg');const p=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});p.query(\"SELECT count(*) AS tabellen FROM information_schema.tables WHERE table_schema IN ('clm','ref','audit') AND table_type='BASE TABLE'\").then(r=>{console.log(r.rows[0]);return p.end()})"
```

**Verwacht:** `{ tabellen: '18' }`

**6b — Schema-conformiteit:**

```powershell
npm run verify:schema
```

**Verwacht:** `GOEDGEKEURD — schema, RLS en policies komen overeen met src/db/schema.ts.`
(17 van 17 tests.)

> Let op: dit script leest `VERIFY_DATABASE_URL`, en anders `DATABASE_URL` — dus de
> **runtime**-rol, niet `MIGRATION_DATABASE_URL`. Dat is bewust: het controleert wat de
> applicatie ziet, inclusief RLS. Wil je een andere database toetsen, zet dan
> `VERIFY_DATABASE_URL` ervoor.

**6c — De backupcontrole, het eigenlijke bewijs:**

```powershell
npm run backup:dump
npm run backup:controle
```

**Verwacht:** geen probleemmelding meer, en in Telegram:
`✅ Hersteld na ...: de dump is weer compleet`

Dat laatste is de bevestiging dat het echte probleem is opgelost: er bestaat nu een herstelbare
kopie van vragenlijsten, antwoorden en certificaten.

**Let op de dumpgrootte.** Die was 21,2 kB met negen tabellen. Na deze operatie hoort hij
groter te zijn — op 2026-08-04 werd dat 77,7 kB. Blijft hij exact 21.683 bytes, dan is er iets
niet goed gegaan.

**Faalt de dump op "row-level security policy"?** Dan is stap 7 nog niet gedaan.

---

## Stap 7 — De backup laten draaien als een rol met BYPASSRLS

**Waarom:** migratie 0011 zet `FORCE ROW LEVEL SECURITY` op alle tabellen. Dat geldt ook voor
de tabeleigenaar — dat is precies wat `FORCE` betekent, en het is de juiste stand voor de
runtime. Maar `pg_dump` leest alle rijen zonder tenantcontext en krijgt er dan nul, of een
harde fout:

```
pg_dump: error: query would be affected by row-level security policy for table "audit_event"
```

**Op een database die deze migratie nog niet had, valt dit niet op.** Zodra 0011 erop staat,
is de backup stuk — en dat merk je pas bij de eerstvolgende dump.

**Let op:** het script beschouwt alleen een dump van 0 bytes als mislukt. Een dump die
halverwege afbreekt levert een bestand op dat er normaal uitziet. Op 2026-08-04 waren dat twee
bestanden van 78 kB die niet compleet waren; die zijn handmatig verwijderd. De backupcontrole
(`npm run backup:controle`) vangt dit wel — dat is precies waarvoor die bestaat.

**Actie:** zet `BACKUP_DATABASE_URL` in `.env`, wijzend naar een rol met `BYPASSRLS`. Bij
Supabase is dat de `postgres`-rol:

```
BACKUP_DATABASE_URL=postgresql://postgres.<project>:<wachtwoord>@<host>:5432/postgres
```

`backup-dump.js` gebruikt die als hij bestaat, en valt anders terug op
`MIGRATION_DATABASE_URL` — wat blijft werken op omgevingen zonder `FORCE RLS` (verse
containers, CI).

**Verificatie:**

```powershell
npm run backup:dump
npm run backup:controle --volledig
```

**Verwacht:** een dump van ongeveer 78 kB en `0 probleem(en)` met 18 tabellen compleet én
herstelbaar.

**Openstaand besluit:** dat de backup een `BYPASSRLS`-rol gebruikt terwijl de applicatie dat
juist nooit mag (ADR-008), is een spanningsveld dat een expliciete keuze verdient — een aparte
dumprol, of dit vastleggen als geaccepteerd restrisico. Dat is **Issue #78**.

---

## Rollback

**Wanneer:** stap 5 faalt halverwege, of stap 6 laat iets onverwachts zien.

**Wat er teruggezet moet worden:** de hele database. Een halve migratieketen terugdraaien door
losse `DROP`-statements is foutgevoelig; terugzetten van de dump is één handeling met een
bekende uitkomst.

```powershell
# 1. Dumpbestand uit stap 1 (pas de naam aan)
$dump = "$env:USERPROFILE\OneDrive - Aling Advies\MCM2-backups\mcm2-JJJJ-MM-DD_UU-MM-SS.dump"

# 2. Terugzetten. --clean verwijdert eerst wat er staat.
docker run --rm -v "$([System.IO.Path]::GetDirectoryName($dump)):/backup" postgres:17.6 `
  sh -c "pg_restore --clean --if-exists --no-owner --no-privileges -d '<MIGRATION_DATABASE_URL>' /backup/$([System.IO.Path]::GetFileName($dump))"

# 3. Drizzle-boekhouding weghalen, anders denkt hij dat 0002+ al gedaan zijn
#    terwijl de tabellen weer weg zijn.
node -e "require('dotenv').config();const{Client}=require('pg');const c=new Client({connectionString:process.env.MIGRATION_DATABASE_URL});c.connect().then(()=>c.query('DROP SCHEMA IF EXISTS drizzle CASCADE')).then(()=>{console.log('boekhouding verwijderd');return c.end()})"
```

**Punt 3 is essentieel.** Vergeet je dat, dan staat de database terug op negen tabellen terwijl
Drizzle denkt dat alles t/m 0014 is toegepast. Een volgende `migrate:deploy` doet dan niets en
je hebt een stille inconsistentie — precies de faalvorm die dit hele runbook wil voorkomen.

**Verifieer na de rollback:** `node scripts/baseline-vergelijken.js` moet weer dezelfde vier
groepen verschillen tonen als in stap 2.

---

## Na afloop

1. **Issue #29 sluiten** — de UUID-defaults zijn opgelost. Acceptatiecriterium: de e2e-tests
   die faalden tegen een uit productie herstelde database zijn groen.
2. **Issue #25 sluiten** — met vermelding dat `migrate:deploy` nu geen wijzigingen meer
   oplevert en een volgende migratie normaal toepasbaar is.
3. **Issue #19 opnieuw oppakken** — de hersteltest van 30 juli draaide tegen negen tabellen en
   bewees dus het herstelpád, niet de compleetheid. Die moet over.
4. **`public._prisma_migrations` laten staan.** Dat is de enige vastlegging van wat Prisma in
   Supabase heeft toegepast. Pas weghalen als er een tijd zonder verrassingen overheen is.
5. **STATUS.md bijwerken** conform §13b.

---

## Voor een volgende omgeving

Deze procedure geldt onveranderd voor de acceptatieomgeving (#12) en voor een eventuele
verhuizing naar een managed service — het is dezelfde handeling met een andere
`MIGRATION_DATABASE_URL`.

Eén verschil: een **verse** database hoeft niet gebaselined te worden. Daar draai je gewoon
`npm run migrate:deploy` en loopt de hele keten vanaf 0000. Baselinen is uitsluitend voor een
database die het baseline-schema al heeft maar Drizzle's boekhouding mist.
