# Onderhoudskalender — wat er terugkeert, en wanneer

**Type:** D — routineoperaties
**Eigenaar:** de eigenaar (Chris)
**Laatste update:** 2026-08-10
**Vereiste toegang:** deze PC, Docker Desktop, Telegram, GitHub
**Raakt:** ADR-011 (backup- en hersteleisen), Issue #19, #48, #58

> **Dit is het overzicht, niet de uitvoering.** Elke regel verwijst naar het
> runbook dat de handeling beschrijft. Staat een taak hier zonder runbook, dan is
> dat een bewust gemarkeerd gat — zie §5.

---

## Waarom dit bestaat

De terugkerende taken van dit project stonden tot 2026-08-10 verspreid over zeven
documenten: het ritme van de backup in het ene runbook, de restore-hertest in
ADR-011, de dependency-afspraken in een externe architectuurreview van 24 juli.
Nergens stond ze bij elkaar, en op twee punten spraken ze elkaar tegen.

Dat is dezelfde faalvorm die dit project al twee keer heeft geraakt. In de spec
van de backupcontrole staat hij als volgt: *een waarschuwing die je moet gaan
halen, is geen waarschuwing.* Het runbook van de OTAP-doorloop noemt de variant
die hier speelt: *niet dat de doorloop vergeten wordt, maar dat hij inconsistent
wordt uitgevoerd — een werkafspraak zonder afdwinging vervalt geleidelijk onder
deadlinedruk.*

Daarom staat naast dit document een controle die faalt als het veroudert:
`npm run verify:onderhoud`, onderdeel van `npm run verify:volledig`. Zie §4.

---

## 1. Wat automatisch draait

Deze drie taken staan in Windows Taakplanner en vragen geen handeling — behalve
dat je de meldingen leest.

| Wanneer | Taak | Wat het doet | Runbook |
|---|---|---|---|
| Dagelijks 07:00 | `MCM2 databasebackup` | `pg_dump` van productie naar OneDrive, 14 dagen retentie | [backupcontrole.md](backupcontrole.md) |
| Dagelijks 07:30 | `MCM2 backupcontrole` | Laag A (is er een dump?) en B (zit alles erin?) | [backupcontrole.md](backupcontrole.md) |
| Maandag 07:45 | `MCM2 backupcontrole volledig` | Idem, plus laag C: echte restore in een wegwerpcontainer | [backupcontrole.md](backupcontrole.md) |

Nagaan of ze nog bestaan en wanneer ze laatst draaiden:

```powershell
Get-ScheduledTask | Where-Object TaskName -like "*MCM2*" |
  ForEach-Object { $i = Get-ScheduledTaskInfo -TaskName $_.TaskName
    "{0,-30} {1,-8} laatst: {2}  code: {3}" -f $_.TaskName, $_.State, $i.LastRunTime, $i.LastTaskResult }
```

> **`LastTaskResult = 0` bewijst niets over de inhoud.** Het zegt dat `cmd.exe`
> kon starten. Lees het log: `backup-controle.log` en `backup-taak.log` in de
> backupmap. Dat onderscheid is op 2026-07-30 daadwerkelijk misgegaan.

**Docker Desktop start niet mee met Windows.** Dat is de waarschijnlijkste
storing van allemaal: elke herstart zonder handmatige start levert een dag zonder
backup op. Zowel de dump als laag B en C hebben de container nodig.

Een gemiste dag inhalen, ná het starten van Docker:

```powershell
& "C:\DEV\Work\MCM2\scripts\backup-taak.cmd"   # niet: npm run backup:dump
npm run backup:controle
```

> **Gebruik het `.cmd`, niet het npm-script.** `BACKUP_DIR` staat alleen in
> `backup-taak.cmd`. Los gedraaid schrijft `npm run backup:dump` naar `backups/`
> in de projectmap: de dump slaagt, maar de controle ziet hem niet, de retentie
> raakt hem niet en hij synchroniseert nergens heen. Zie
> [backupcontrole.md](backupcontrole.md), "Als Docker niet draait".

---

## 2. Wat je zelf moet doen

| Ritme | Taak | Waarom dit ritme | Runbook |
|---|---|---|---|
| **Wekelijks** | Levensteken opgemerkt? | Blijft het uit, dan is de melder zelf stuk — of de machine staat uit. Dit is de enige afdekking van Issue #58. | [backupcontrole.md](backupcontrole.md) |
| **Maandelijks** | Restore-hertest met verificatie van de inhoud | ADR-011 fase 2. Zie §3 voor waarom maandelijks en niet per kwartaal. | [supabase-verificatie-en-restoretest.md](supabase-verificatie-en-restoretest.md) |
| **Maandelijks** | `npm audit` nalopen; beoordeelde uitzonderingen op vervaldatum controleren | Nieuwe high/critical kwetsbaarheden buiten de geaccepteerde lijst | — (§5) |
| **Maandelijks** | Deze kalender nalopen: klopt hij nog met wat er werkelijk draait? | Een kalender die veroudert is erger dan geen kalender | dit document |
| **Per kwartaal** | ADR's op geldigheid nalopen, met name ADR-011 en ADR-002 | Fase-overgangen veranderen de norm, niet het document | — (§5) |
| **Bij elke release naar productie** | OTAP-doorloop draaien | Bewijst dat het uitrolbare artefact werkt, niet alleen de code | [otap-doorloop.md](otap-doorloop.md) |
| **Bij elke release naar productie** | Uitrollen via acceptatie, nooit rechtstreeks | Een versie die niet op acceptatie stond, is niet beproefd | [uitrol-acceptatie-en-productie.md](uitrol-acceptatie-en-productie.md) |
| **Per kwartaal** | Rollback beproeven op acceptatie | Terugdraaien is het onderdeel dat in de praktijk het vaakst nooit getest is — en dat je nodig hebt op het slechtste moment | [uitrol-acceptatie-en-productie.md](uitrol-acceptatie-en-productie.md) |
| **Wekelijks** | Staging wakker houden: één query tegen `clm-staging3` | Een gratis Supabase-project pauzeert na 7 dagen zonder databaseactiviteit. Pauzeert staging, dan faalt de eerstvolgende uitrol met een verbindingsfout die naar de verkeerde oorzaak wijst. | — (§5) |
| **Bij elke migratie** | Eerst op staging draaien, dan pas op productie | Staging draait dezelfde Postgres-versie, regio en pooler als productie. Een migratie die daar slaagt, slaagt in productie — dat is de hele reden dat staging niet op saxombp staat. | — (§5) |

### Gebeurtenisgebonden — geen ritme, maar een trigger

| Trigger | Taak | Waarom het niet mag wachten |
|---|---|---|
| **Migratie die een tabel toevoegt of hernoemt** | [backup-verwachting.json](backup-verwachting.json) bijwerken, inclusief `bijgewerkt` en `migratiestand` | Vergeet je dit, dan meldt de controle "compleet" over een lijst die de nieuwe tabellen niet kent. Op 2026-08-10 stond de lijst twaalf migraties achter en misten er vijf tabellen. |
| **Nieuw runbook geschreven** | Regel toevoegen in [README.md](README.md) | Een runbook dat niet in de index staat, vindt niemand |
| **Nieuwe terugkerende taak afgesproken** | Regel toevoegen in dit document | Anders staat hij over een maand weer in één losse spec |
| **Major dependency-update** (NestJS, Drizzle, TypeScript) | Korte impact-analyse vóór merge, nooit blind updaten | De Prisma 7-episode in dit project is het directe bewijs |
| **Fase-overgang** (eerste betalende klant, tweede tenant) | ADR-011 opnieuw beoordelen | Free-plan is dan niet langer verdedigbaar — het besluit noemt dit zelf als reviewmoment |

---

## 3. Twee conflicten, beslecht op 2026-08-10

**Restore-hertest: maandelijks, niet per kwartaal.**
ADR-011 fase 2 zegt "maandelijks tijdens actieve surveyrondes"; de externe
architectuurreview van 2026-07-24 zegt "per kwartaal". ADR-011 wint: dat is een
vastgesteld besluit, de review is een niet-vastgesteld voorstel van buiten het
project. Besluit eigenaar 2026-08-10: **maandelijks**, ook buiten een lopende
surveyronde. Reden om niet te differentiëren: een ritme met een uitzondering
erin is een ritme dat je moet onthouden, en dat is precies wat hier misging.

**De onderhoudskalender in de architectuurreview is opgevolgd.**
[05-otap-and-maintenance-model.md](../architecture-review/2026-07-24/05-otap-and-maintenance-model.md)
bevat een "Maandelijkse onderhoudskalender (voorstel)" met een backup-paragraaf
die feitelijk onjuist is geworden — er staat dat Supabase managed backups biedt,
en drie dagen later bleek in ADR-011 dat het Free-plan er géén levert. Dat
document blijft staan als historische review, met een verwijzing bovenaan naar
dit document.

---

## 4. Hoe dit document actueel blijft

Niet door een afspraak, maar door een poort die faalt.

```powershell
npm run verify:onderhoud
```

Draait mee in `npm run verify:volledig`. Hij controleert vier dingen:

| Controle | Faalt wanneer |
|---|---|
| **Index compleet** | Er staat een runbook in `docs/runbooks/` dat niet in [README.md](README.md) genoemd wordt, of andersom |
| **Koppen aanwezig** | Een runbook mist `Type`, `Eigenaar` of `Laatste update` |
| **Niet verouderd** | Een runbook is langer dan zes maanden niet bijgewerkt, of deze kalender langer dan drie maanden |
| **Verwachtingslijst bij** | `backup-verwachting.json` noemt een lagere migratiestand dan de hoogste migratie in `drizzle/` |

De vierde is de belangrijkste: die vangt precies de fout die op 2026-08-10 werd
aangetroffen, en hij vangt hem op het moment dat de migratie geschreven wordt in
plaats van maanden later.

**Waarom een poort en geen Telegram-melding.** Overwogen en bewust niet gedaan.
Er is al een meldingskanaal, en dat werkt omdat het zelden iets zegt. Een derde
stroom berichten over documentatie-onderhoud is precies de ruis waardoor je de
backupmelding leert negeren. Een CI-poort dwingt het af zonder iets te sturen.

**Waarom zes maanden en niet strenger.** Een runbook dat klopt hoeft niet
bijgewerkt te worden. De drempel moet verval vangen, niet stabiliteit
bestraffen — anders wordt hij weggeklikt met een datumwijziging zonder inhoud,
en dan is de poort erger dan niets.

---

## 5. Wat nog niet beschreven is

Bewust genoteerd in plaats van stilzwijgend overgeslagen. Elk van deze punten is
een terugkerende taak zonder runbook; de kalender noemt ze, maar er is nog geen
document dat vertelt hóe.

| Ontbreekt | Waarom het een gat is | Urgentie |
|---|---|---|
| **Sleutel- en wachtwoordrotatie** | `.env` bevat het Supabase-productiewachtwoord, `RESEND_API_KEY`, `TELEGRAM_BOT_TOKEN` en de OIDC-secrets. Sinds 2026-08-10 komen daar de GitHub-secrets bij: `STAGING_MIGRATION_DATABASE_URL` en `STAGING_DATABASE_URL`. Eén sleutel heeft een **harde einddatum**: `/opt/mcm2/.ghcr-token` op saxombp verloopt rond **2026-11-08**, en dan stopt elke uitrol. Er is geen rotatieritme, geen vervaldatum-bewaking en geen procedure. | **Hoog** — er leeft een echte tenant, en er is een sleutel met een einddatum |
| **Storing buiten backup** | *Deels ingevuld op 2026-08-10:* rollback na een mislukte release staat in [uitrol-acceptatie-en-productie.md](uitrol-acceptatie-en-productie.md), en de uitrol draait zelf terug als de rookproef faalt. Wat ontbreekt: wat te doen als een omgeving spontaan omvalt — detectie, eerste respons, escalatie. | **Hoog** vanaf de pilotstart |
| **Bewaking van de omgevingen** | Er is geen enkel signaal wanneer acceptatie of productie omvalt. De rookproef kijkt één keer, bij de uitrol. Voor de backup bestaat zo'n signaal wél (Telegram, met wekelijks levensteken); voor de draaiende omgevingen niet. Je zou het merken doordat iemand belt. | **Hoog** vanaf de pilotstart |
| **Afwezigheid en vakantie** | Alles hangt aan één persoon en één machine. Staat de laptop uit, dan draait geen dump, geen controle en geen melding. Er is geen tweede lezer en geen overdracht. | **Hoog** — dit is Issue #58 plus Issue #48 |
| **Dependabot** | `.github/dependabot.yml` bestaat niet. Het updatebeleid in de architectuurreview (patch automatisch, minor met review, major nooit blind) is nooit ingericht. De maandelijkse `npm audit` in §2 is de handmatige vervanging. | Middel |
| **Logrotatie** | `backup-controle.log` en `backup-taak.log` groeien onbegrensd. Klein probleem, maar het staat nergens. | Laag |
| **Certificaat- en domeinvervaldata** | Het verzenddomein van het mailkanaal en straks de productie-URL hebben vervaldata die niemand bewaakt. | Middel vanaf de pilotstart |
| **Uploadopslag** | Certificaten staan op een containerschijf; bij image-vervanging zijn ze weg (Issue #46). Backup daarvan valt buiten ADR-011. | **Hoog** — harde datum, pilot start ~1 september |
| **Uitrol naar staging en productie** | Staging bestaat sinds 2026-08-10, maar er loopt nog geen geautomatiseerde weg heen. Migraties gaan met de hand vanaf de laptop, met `.env` wijzend naar productie. Dat is de gemeenschappelijke oorzaak onder de incidenten van 04-08, 07-08 en 10-08. *Acceptatie is sinds 10-08 wél volledig uitgerold, frontend en al — maar met de hand gestart.* Plan: [plan-otap-straat-met-staging.md](../architectuur/plan-otap-straat-met-staging.md) | **Hoog** — elke handmatige uitrol is een kans op dataverlies |
| **Staging wakker houden** | De wekelijkse taak staat in §2, maar er is nog geen geplande taak die hem uitvoert. Nu dus handwerk, en handwerk dat je vergeet. | Middel — pas pijnlijk bij de eerste uitrol na een stille week |
| **Het TLS-certificaat van acceptatie** | Sinds 2026-08-10 draait acceptatie op `https://saxombp.tail4b29b.ts.net` via `tailscale serve`. Tailscale vernieuwt dat certificaat zelf, dus dit is géén taak — maar het staat hier omdat het een afhankelijkheid is die niemand in de gaten heeft. Valt Tailscale weg of verandert het beleid, dan werkt inloggen niet meer: Entra weigert een `http`-redirect. | Laag, maar het hoort geweten te zijn |
| **`OIDC_*` per omgeving** | Toegevoegd op 10-08 na een storing (PR #130). `deploy-inrichten.js` zet ze nu leeg neer met een toelichting; het client-secret invullen is handwerk. Productie heeft ze nog niet, dus daar kan niemand inloggen. Bij een sleutelrotatie moet dit op élke omgeving apart bijgewerkt worden — zie de eerste regel van deze tabel. | Middel |

**Deze lijst hoort korter te worden.** Groeit hij in plaats daarvan, dan is dat
het signaal dat het onderhoud achterloopt op wat er gebouwd wordt.

---

## 6. Wat deze kalender niet oplost

Het grootste risico van dit document is hetzelfde als dat van de backupcontrole,
en het staat in die spec zo opgeschreven: *dat de aanwezigheid van een controle
het gevoel geeft dat het geregeld is.*

Deze kalender bewijst dat de taken benoemd zijn en dat de documenten niet
verouderd zijn. Hij bewijst niet dat de taken daadwerkelijk uitgevoerd zijn — op
de drie geplande taken na, en die bewijzen alleen dat ze gestart zijn. §5 is
daarom geen bijlage maar het eerlijkste deel van dit document.
