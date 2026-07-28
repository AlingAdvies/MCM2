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

**Schema-afdrijving uitgesloten.** `node scripts/verify-schema.js` is op 2026-07-28 read-only tegen
de echte database gedraaid en keurde alles goed: negen tabellen, RLS actief op alle zes
tenantgebonden tabellen, zes policies met zowel `USING` als `WITH CHECK`, en `clm.current_tenant_id()`
werkend. Dat was de grootste onzekerheid rond stap 3 — het schema is níet afgedreven van de baseline.

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
   - Kan dat niet: download de backup en herstel hem handmatig met `pg_restore` naar het nieuwe project.
     Vraag om hulp bij dit commando — dat hoort niet uit het hoofd te gebeuren.

> **Let op:** kies bij een restore-dialoog nooit `clm-enterprise` als doel. Dat overschrijft de
> werkende database. Lees het bevestigingsscherm hardop na voordat je klikt.

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
| _(nog niet uitgevoerd)_ | | | | | |

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

## Wat dit runbook niet beantwoordt

Of Supabase de **juiste keuze** blijft voor een platform met NIS2-ambities en betalende klanten.
Dat is een leveranciersafweging, geen test. De uitkomst van stap 1 en 2 is er wel directe input
voor: een tegenvallende backupgarantie of een ontoereikend tier weegt zwaar in die beslissing.
