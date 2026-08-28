# MCM2 — instap bij iedere sessie

> Dit bestand wordt door Claude Code **automatisch** geladen bij sessiestart.
> `MCM2-CLAUDE.md` niet — die naam staat niet in de conventie, ook al staat er
> bovenaan "lees dit bij iedere sessiestart". Vandaar dit bestand: het is de
> haak die de rest binnenhaalt.

---

# 0. HET DOEL — lees dit vóór al het andere

*Vastgelegd 2026-08-12, samen met de eigenaar. Dit staat bovenaan omdat het op
die dag drie keer misging: er werd gebouwd zonder eerst vast te stellen wat het
doel was en wat er al stond. De eigenaar moest steeds bijsturen.*

**Wat we aan het bouwen zijn:**

> Een omgeving die de **eindsituatie zo goed mogelijk repliceert**, om daarop
> vast te stellen dat de **geautomatiseerde OTAP en DevOps werkt**.

Dat is het eigenlijke product van dit werk. De features zijn het middel, niet
het doel.

**Vijf punten, letterlijk zoals afgesproken:**

1. Een omgeving die de eindsituatie (AWS) zo goed mogelijk repliceert.
2. Daarop aantonen dat de geautomatiseerde OTAP en DevOps werkt.
3. **Eén echte tenant: AlingAdvies — dat is de eigenaar zelf.** Gevuld met
   **mock data die behandeld wordt als klantdata**: backup, RLS, `beschermd`,
   geen e2e-suites erop.
4. Die tenant dient tegelijk voor **demo**, **test** én **bewijs** dat de
   keten werkt.
5. Alles wat gebouwd wordt moet **eenvoudig naar AWS te migreren** zijn.

**Wat dit betekent voor een voorstel:** bouw je iets dat op AWS niet zou
bestaan (een sub-pad in plaats van een eigen hostnaam, een omgevingsspecifiek
image), dan beproef je een constructie die straks weg is. Dat is dezelfde fout
die het plan over staging benoemt: *"een generale repetitie op ander toneel
bewijst weinig."*

**Waar het werkelijk om gaat is het gedrag, niet de techniek.** Dat de eigenaar
een wijziging kan doen en die met vertrouwen tot in productie ziet lopen, met
remmen die afgaan als er iets niet klopt, en dat hij kan terugvallen als het
misgaat. Dat is wat een klant straks verwacht, en dat is wat nu op de eigen
tenant beproefd wordt. Volgorde die daaruit volgt: **eerst de keten aantoonbaar
rond mét data erin, daarna pas de kosmetiek.**

**Twee besluiten van de eigenaar (12-08), zodat ze niet opnieuw gesteld worden:**

| Vraag | Besluit |
|---|---|
| Moet het starten van de applicatie ook automatisch? | **Nee — handmatig starten is OK.** Het besluit uit §3.3c van het OTAP-plan blijft staan. |
| Moet productie inlog krijgen, tegen §4.1 in? | **Ja.** Zonder inloggen valt niet vast te stellen dát de keten werkt, en demo is een expliciet doel. §4.1 is op dit punt achterhaald. |
| Moet het sub-pad `/productie` opgelost worden? | **Ja.** Een eigen hostnaam per omgeving is de AWS-vorm. |

De tenant komt via de **platformroute**, niet rechtstreeks in de database — het
auditspoor ís de opbrengst (§5.1 van het plan blijft dus staan).

---

# 0b. DE MIDDELEN — wat er werkelijk is

*Gemeten op 2026-08-12, niet aangenomen. Klopt iets niet meer? Meet opnieuw en
werk dit bij — een verouderde inventaris is erger dan geen.*

## AWS: er is GEEN account

**AWS is een richting, geen middel.** De kans is groot dat we er komen, maar we
**staan er nog niet**. Stel nooit iets voor dat een AWS-account veronderstelt
zonder dat expliciet te benoemen.

## Rekenlaag — één machine

**`saxombp`** — een MacBook Pro uit 2009 (`MacBookPro5,5`) met Ubuntu 22.04.5.

| | |
|---|---|
| Processor | Intel Core2 Duo P7550, 2 cores |
| Geheugen | 7,5 GB (6,3 GB vrij) |
| Schijf | 106 GB (87 GB vrij) |
| Belasting | load 0,06 — de machine verveelt zich |
| Bereikbaar | **alleen via Tailscale** (`100.99.51.53`), tailnet only |

Zes MCM2-containers (~300 MB samen) plus de acceptatiedatabase. Daarnaast
draait er **alleen de Saxo-app** (poort 8080/8081) — niets anders.

Publiek IP `80.114.79.142` is de thuisrouter, gedeeld met de laptop en
vermoedelijk niet vast. **Capaciteit is het probleem niet; het feit dat het
één machine is wel** — geen tweede, geen redundantie.

## Databases — bij Supabase

| Omgeving | Waar | Markering |
|---|---|---|
| acceptatie | container op saxombp, `127.0.0.1:55460` | `beschermd` |
| staging | Supabase `ljdldwfy…`, eu-west-1 | `wegwerp` |
| productie | Supabase `agojesdo…`, eu-west-1 | `beschermd` |

Beide Supabase-projecten draaien op het **gratis plan** en **pauzeren na 7
dagen stilte**. Dat is een reëel risico zodra productie voor demo gebruikt
wordt.

## Bouwstraat en identiteit — in de cloud

- **GitHub** `AlingAdvies/MCM2` — **publiek**, hoofdbranch `main`
- Workflows `ci.yml` en `productie.yml`; Environment `productie` met een
  verplichte akkoordgever
- **GHCR** voor images (token verloopt rond **8 november 2026**)
- **Microsoft Entra External ID** — CIAM-domein `mcm2ciam.ciamlogin.com`, één
  app-registratie. Elke omgeving vraagt een eigen redirect-adres.

## Backup en bewaking — op de laptop van de eigenaar

Drie geplande taken op de Windows-laptop: `MCM2 databasebackup`,
`MCM2 backupcontrole`, `MCM2 backupcontrole volledig`. Dumps gaan naar
**OneDrive** (`BACKUP_DIR`). Meldingen via **Telegram**.

**Gevolg:** staat die laptop uit, dan draait er geen backup. CI kan er niet bij
— zie [[mcm2-backupbewijs-omkering]] en het runbook.

## Wat er NIET is

Geen AWS-account. Geen tweede server. Geen bewaking of alarmering. Geen
incidentplan. Geen sleutelrotatie. Geen eigen hostnaam per omgeving — en dat
laatste is precies wat de proefopstelling nog niet AWS-vormig maakt.

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

**Gebruik `npm run test:db -- "waarvoor"` om die container helemaal op te
zetten — niet met de hand.** (2026-08-25) Container, rollen (`clm_migrator`/
`clm_api_runtime`, wachtwoorden inclusief), migraties én de
wegwerp-markering in één stap, precies zoals CI het doet. Draait
`DATABASE_URL` per ongeluk op de `postgres`-superuser (die heeft BYPASSRLS,
verboden door ADR-008) of moet je bij elke nieuwe container opnieuw
wachtwoorden raden — dat kostte op 2026-08-25 een hele testronde aan
omwegen, terwijl de code zelf goed was. Het script drukt aan het eind de
exacte `MIGRATION_DATABASE_URL`/`DATABASE_URL`-regels af om te exporteren.
`npm run test:db -- "waarvoor" --hergebruik` op een bestaande container
(idempotent); `npm run test:db -- --afbreken` om op te ruimen.

**1b. Elke database is `beschermd` tot hij zich als wegwerp meldt.**
Sinds migratie 0019 staat dat in `clm.omgeving`. De e2e-suites weigeren tegen
alles wat niet `wegwerp` is, en sinds stap 5 geldt dat ook voor de schrijvende
scripts: `eisOnbeschermdeDatabase()` leest die markering in plaats van de
hostnaam. `npm run test:db` doet dit al automatisch; los, op een al bestaande
container: `node scripts/markeer-wegwerp.js "waarvoor"`.

**Markeer nooit de demo (poort 55450) of een Supabase-productiedatabase.**
Aanleiding: op 2026-08-07 wisten de e2e-tests de demo-database leeg omdat
`DATABASE_URL` naar 55450 wees.

> Eén uitzondering, bewust: een **lokale** database zonder `clm.omgeving` mag
> door. Die tabel ontstaat pas bij migratie 0019, dus een verse container zou
> anders blokkeren op precies het commando dat hem moet vullen. Niet-lokaal
> zonder markering blijft geblokkeerd.

**2. Verzin nooit een commando — en ook geen kolomnaam, route of constraint-naam.**
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

**Constraint-, index- en sequence-namen zijn hetzelfde risico, en zijn op
2026-08-28 ook daadwerkelijk misgegaan.** Migratie 0034 droppte een foreign
key met een aangenomen, door Drizzle gegenereerde naam
(`vendor_category_code_vendor_category_code_fk`). Die naam klopte op de
lokale wegwerpdatabase, maar productie had dezelfde constraint onder een
andere naam (`vendor_category_code_fkey` — ontstaan buiten de
migratieketen om). `DROP CONSTRAINT IF EXISTS <geraden-naam>` faalt in dat
geval niet — hij mist gewoon stilzwijgend, en de migratie loopt vast op een
latere stap die wél op het bestaan van die constraint rekent. Dit kostte
drie mislukte pogingen op productie voordat het werd herkend. **Zoek een
constraint-naam daarom altijd op aan de hand van wat hij doet, niet aan de
hand van een aangenomen naam:**
```sql
SELECT con.conname
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE con.contype = 'f' AND nsp.nspname = '<schema>' AND rel.relname = '<tabel>';
```
Test dit **niet alleen tegen een lege wegwerpdatabase** — die kent de naam
sowieso niet, want er is niets om te vinden, dus de opzoekquery levert daar
altijd "niet gevonden" en de `IF EXISTS`-tak slaagt schijnbaar probleemloos.
Een `DROP`/`ALTER` op een bestaande, al gevulde constraint moet vóór
uitrol ook gecontroleerd zijn tegen een omgeving die de constraint al heeft
(staging, of een handmatig opgebouwde replica van productie's structuur).

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

**6. Verzin ook geen diagnosemethode — dezelfde regel als bij commando's.**
Loopt iets vast (een falende test, een onverwacht resultaat), check dan eerst
`docs/runbooks/commandos-en-omgeving.md` §"Bij een falende test of onverwacht
resultaat" op een al-beproefde aanpak — een lijst bekende architectuurvallen
(FORCE RLS + SECURITY DEFINER, `clm."user"` aan één tenant gebonden, PATCH/PUT-
mismatches) en `node scripts/trace-lezen.js` voor Playwright-traces. Pas als
daar niets bij past, een nieuwe aanpak proberen — en die er dan bij zetten.
Aanleiding: op 2026-08-27 werd dezelfde trace-analyse vier keer met de hand
opnieuw uitgevonden in plaats van als vast stappenplan hergebruikt.

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
