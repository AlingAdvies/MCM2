# De volledige stack: OTAP en DevOps in samenhang

**Type:** beschrijvend overzicht — geen plan, geen besluit
**Eigenaar:** de eigenaar (Chris)
**Laatste update:** 2026-08-21
**Vervangt als naslag:** de oudere plandocumenten in deze map beschrijven hoe we
hier gekomen zijn (`plan-otap-straat-met-staging.md`, `pariteitscontract.md`)
en blijven staan als historie. Dit document beschrijft de **huidige stand**.

> **Onderhoud.** Dit document veroudert zodra een omgeving verhuist, een
> workflow verandert, of er een nieuwe externe dienst bijkomt. Werk het bij op
> hetzelfde moment als de wijziging, niet achteraf — dat is precies waar de
> vorige documenten in deze map aan zijn onderdoor gegaan.

---

## 1. Wat er staat, in één oogopslag

MCM2 is één applicatie (een NestJS-backend + een Next.js-frontend) die in vier
vormen bestaat, elk met een eigen doel:

| Omgeving | Doel | Draait op | Database |
|---|---|---|---|
| **Lokaal** | Ontwikkelen | Ontwikkelaars-laptop | Eigen wegwerpcontainer |
| **Acceptatie** | Uitproberen, zelf inloggen, e2e-tests | `saxombp` (thuisserver) | Eigen wegwerpcontainer op `saxombp` |
| **Staging** | Repetitie vóór productie | `saxombp` (thuisserver) | Supabase, project `clm-staging3` |
| **Productie** | Echte klant + demo/bewijs | **AWS** (ECS Express Mode, Ierland) | Supabase, project `clm-enterprise` |

Vier omgevingen, twee hostinglocaties, drie databaseplekken. Dat is geen
toevalligheid maar het resultaat van een reeks bewuste keuzes — §2 legt uit
waarom elke omgeving daar staat waar hij staat, en §3–§5 hoe ze met elkaar
verbonden zijn.

---

## 2. De vier omgevingen, en waarom ze niet allemaal hetzelfde zijn

### Lokaal — waar gebouwd wordt

Een ontwikkelaar draait de applicatie op een eigen machine, tegen een eigen,
wegwerpbare Postgres-container. Niets hiervan is gedeeld of blijvend. Migraties
worden hier eerst beproefd voordat ze ergens anders komen.

### Acceptatie — waar het eerst echt draait

Op `saxombp` draait de applicatie tegen een eigen databasecontainer (poort
`55460`), niet tegen Supabase. Dit is de omgeving waar de automatische
e2e-testsuites tegenaan lopen, en waar de eigenaar zelf kan inloggen om iets
uit te proberen. **Mag stuk** — de database is wegwerp in de zin dat hij
opnieuw opgebouwd kan worden, al is hij in de praktijk gemarkeerd als
`beschermd` (zie §4) omdat de e2e-suites hun eigen, losse containers gebruiken
en niet tegen acceptatie zelf draaien.

### Staging — de generale repetitie die het juiste bewijst

Staging draait, net als acceptatie, op `saxombp` — maar de database staat bij
**Supabase** (`clm-staging3`), niet in een lokale container. Dat is een
bewuste, afzonderlijke keuze (vastgelegd 2026-08-10): een repetitie tegen een
lokale Postgres-container bewijst niets over hoe migraties zich gedragen tegen
de Supabase-connectionpooler, en die pooler is precies de laag waar productie
zich anders gedraagt dan een simpele lokale database. Wat op staging slaagt,
slaagt ook tegen dezelfde pooler-laag in productie.

Staging heeft geen eigen hostnaam-conflict met productie meer — dat probleem
bestond toen productie nog op `saxombp` draaide onder hetzelfde adres met een
sub-pad. Sinds productie naar AWS is verhuisd (zie hieronder), is dat conflict
opgelost: staging blijft op `saxombp`, productie niet.

### Productie — sinds 19-08 op AWS, niet meer op saxombp

Dit is de belangrijkste wijziging sinds de oorspronkelijke OTAP-plannen
geschreven zijn. Productie draaide tot **19 augustus 2026** ook op `saxombp`,
als derde applicatie-instantie op dezelfde machine. Sindsdien draait productie
op **AWS ECS Express Mode** (regio `eu-west-1`, Ierland), bereikbaar via
`https://clm.alingadvies.nl`.

**Wat er niet mee verhuisde: de database.** Productie praatte al vóór de
AWS-migratie met Supabase (`clm-enterprise`) — dat was al zo sinds
2026-08-12. De AWS-migratie verplaatste alleen de **compute**-laag (de
container die de applicatiecode draait), niet de data. Dat is precies de
scheiding die vanaf het begin bedoeld was: compute los van database, elk apart
te verhuizen (zie §7 van `plan-otap-straat-met-staging.md`).

**Waarom productie als enige naar AWS ging, en acceptatie/staging niet.**
Bewust besluit van de eigenaar (19-08): acceptatie is een wegwerp-oefenomgeving
en hoort daar niet te staan; staging beproeft primair de
database-verbindingslaag (Supabase-pooler), niet de hostingbeschikbaarheid, en
een verhuizing zou de kosten verdubbelen zonder aantoonbare meerwaarde. Alleen
productie hoeft de eindsituatie (AWS) echt te repliceren — dat is namelijk
letterlijk het doel van dit hele traject (zie `CLAUDE.md` §0).

---

## 3. De keten van commit tot productie

```
  ┌─────────────┐
  │   GitHub    │  push naar main (of PR die naar main mergt)
  └──────┬──────┘
         │  CI (ci.yml): format, lint, typecheck, unittests,
         │  Docker-productiebuild, RLS-tenant-isolatietest (e2e)
         ↓
  ┌─────────────┐
  │    GHCR     │  image gepubliceerd, getagd met de korte commit-SHA
  └──────┬──────┘  (én :latest, dat de straat zelf nooit gebruikt)
         │
         ↓  automatisch, in dezelfde CI-run
  ┌─────────────────────────────────────┐
  │  STAGING — migraties automatisch     │  Supabase clm-staging3
  │  applicatie starten: met de hand     │  saxombp, poort 3030/5031
  └──────┬────────────────────────────────┘
         │
         ↓  ALLEEN op expliciete aanvraag, ALLEEN na akkoord
  ┌─────────────────────────────────────┐
  │  PRODUCTIE — AWS ECS Express Mode    │  Supabase clm-enterprise
  │  vier remmen, dan volledig automatisch│  clm.alingadvies.nl
  └───────────────────────────────────────┘
```

**Acceptatie staat bewust buiten deze keten getekend** — hij ontvangt geen
doorstroom vanuit CI. Acceptatie is waar de e2e-testsuites hun eigen,
zelfopgebouwde wegwerpdatabase gebruiken (niet de acceptatiedatabase op
`saxombp` zelf), en waar de eigenaar los kan bijwerken wanneer hij wil.

**De kern van de keten:** één image, gepubliceerd na CI, twee keer gedraaid —
eerst op staging, dan (na akkoord) op productie. Er wordt nergens opnieuw
gebouwd tussen staging en productie. Wat op staging is goedgekeurd, is bit
voor bit wat naar productie gaat.

### Wat automatisch gaat, en wat met de hand

| Stap | Staging | Productie (AWS) |
|---|---|---|
| Build, test, image publiceren | Automatisch (CI) | Automatisch (CI) |
| Migraties draaien + teruglezen | Automatisch (CI) | Automatisch, na akkoord |
| Applicatie/container vervangen | **Met de hand** | **Automatisch**, na akkoord |
| Wie beslist dat het gebeurt | Iedere merge op `main` | Expliciete aanvraag van de eigenaar |

Dit verschil — staging start de container met de hand, productie volledig
automatisch — is geen inconsistentie maar een technische beperking die alleen
voor `saxombp` geldt: een GitHub Actions-runner kan er via Tailscale niet
automatisch bij komen om een `docker compose`-commando te draaien (een harde
regel van Tailscale zelf, geen instelling die verkeerd staat — zie
`commandos-en-omgeving.md` en `.github/workflows/ci.yml`). AWS heeft die
beperking niet: ECS heeft een gewone AWS-API die een workflow met de juiste
IAM-rol probleemloos mag aanroepen. Dat is precies waarom productie op AWS
verder geautomatiseerd is dan staging op `saxombp` — niet omdat productie
minder belangrijk zou zijn, maar omdat de infrastructuur het toelaat.

---

## 4. De databaselaag: drie plekken, één discipline

Elke database draagt een markering (`clm.omgeving`, sinds migratie 0019):
`beschermd` (met rust laten) of `wegwerp` (mag leeggemaakt worden). Dat is de
mechaniek die voorkomt dat een testscript per ongeluk productie- of
demogegevens wist.

| Database | Waar | Markering |
|---|---|---|
| Lokale wegwerpcontainers | Ontwikkelaars-laptop | `wegwerp` |
| Acceptatie | Container op `saxombp`, `127.0.0.1:55460` | `beschermd` |
| Staging | Supabase `clm-staging3`, eu-west-1 | `wegwerp` |
| Productie | Supabase `clm-enterprise`, eu-west-1 | `beschermd` |
| Demo | Container op `saxombp`, poort 55450 | `beschermd` |

**`.env` op de ontwikkelaars-laptop wijst sinds 2026-08-11 naar staging**, niet
naar productie. Dat is een bewuste veiligheidsmaatregel na drie incidenten
(04-08, 07-08, 10-08) waarbij een commando zonder expliciet doelwit op de
echte klantendatabase uitkwam. Productie is nog bereikbaar als
`NOOD_PRODUCTIE_URL`, maar geen enkel script leest die naam automatisch — er
zijn twee bewuste stappen nodig (het adres meegeven én `--extern`) om er
werkelijk bij te komen.

**Beide Supabase-projecten (staging én productie) draaien op het gratis
plan** en pauzeren na 7 dagen zonder databaseactiviteit. Dat risico is voor
productie groter dan voor staging, omdat productie sinds de AWS-migratie ook
voor demo gebruikt wordt (zie `CLAUDE.md` §0) — een gepauzeerd project geeft
een verwarrende verbindingsfout op precies het moment dat er iemand naar
gekeken wordt.

---

## 5. De vier remmen vóór productie

Een uitrol naar productie (AWS) gaat nooit ongecontroleerd. Vier
onafhankelijke controles, elk met een eigen reden van bestaan:

| # | Rem | Wat hij controleert | Waar hij zit |
|---|---|---|---|
| 1 | **Verse backup** | Is er een recent, gecontroleerd bewijs dat de laatste backup goed was — niet alleen dat hij bestaat | `scripts/productie-poort.js`, leest `docs/runbooks/backup-bewijs.json` |
| 2 | **Staging beproefd** | Loopt staging niet vóór op wat er uitgerold wordt | Idem, vergelijkt migratiestand |
| 3 | **Productie niet vooruit** | Loopt productie niet al vóór op de repository | Idem |
| 4 | **Handmatig akkoord** | Een mens beslist bewust dat dit nu naar productie gaat | GitHub Environment `productie`, verplichte reviewer |

De poort (remmen 1–3) draait **twee keer**: eenmaal vóór het akkoord wordt
gevraagd (zodat niemand lastiggevallen wordt met een aanvraag die toch
geblokkeerd zou worden), en nogmaals ná het akkoord (omdat een akkoord een dag
kan blijven liggen, en in die tijd kan er een nieuwe merge zijn geweest of een
backup verlopen zijn).

### Hoe de backuprem werkt zonder dat een GitHub-runner bij de backup kan

De backup zelf draait op de laptop van de eigenaar (drie geplande Windows-taken,
zie §6). Een GitHub Actions-runner kan daar nooit bij. In plaats daarvan schrijft
de dagelijkse backupcontrole een bewijsbestand
(`docs/runbooks/backup-bewijs.json`) dat gecommit wordt naar de repository — de
poort leest dát, niet de backup zelf. Het bestand zegt niet "er is een backup"
maar "de controle is gedraaid en dit vond hij", inclusief welke controlelagen
gedraaid hebben.

### Wat er gebeurt na het akkoord (specifiek voor AWS)

```
akkoord gegeven
  → de poort draait nog één keer
  → migraties tegen productie (Supabase clm-enterprise)
  → migratiestand teruggelezen en vergeleken met het journal
  → AWS-credentials via OIDC (kortlevend token, geen langlevende sleutel)
  → nieuwe image-tag in de ECS-taakdefinitie van mcm2-api
  → mcm2-api uitgerold, wacht op aantoonbare gezondheid
  → nieuwe image-tag in de ECS-taakdefinitie van mcm2-frontend
  → mcm2-frontend uitgerold, wacht op aantoonbare gezondheid
  → runtime-rol getoetst: kan de applicatie echt bij zijn eigen data?
```

Dit hele blok — inclusief het daadwerkelijk vervangen van de draaiende
container — gebeurt **volledig automatisch**, in de workflow
`productie-aws.yml`. Dat is het belangrijkste verschil met de oudere
`productie.yml` (voor `saxombp`), waar dit laatste stuk met de hand moest
gebeuren. Reken op zo'n 35–40 minuten van akkoord tot een volledig groene run.

**Terugdraaien is dezelfde workflow, niet een apart script.** Bij een
mislukte of ongewenste uitrol wordt dezelfde workflow opnieuw gestart met de
vorige image-tags (die in de samenvatting van elke run staan). Dat betekent
ook dat een rollback opnieuw door het akkoordmoment gaat — bewust, want een
rollback is ook een uitrol.

---

## 6. De omliggende diensten, en hoe ze samenhangen

De applicatie zelf is niet de hele stack. Vijf externe diensten maken de keten
compleet, en ze grijpen op specifieke plekken in elkaar:

| Dienst | Rol | Raakt welke schakel |
|---|---|---|
| **GitHub** (`AlingAdvies/MCM2`, publiek) | Broncode, CI/CD, het akkoordmoment | Elke stap in §3 |
| **GHCR** (GitHub Container Registry) | Bewaart de gepubliceerde images | Tussen CI en elke uitrol; token verloopt ~8 nov 2026 |
| **Supabase** (twee projecten) | De database voor staging én productie | §4 |
| **Microsoft Entra External ID** | Login (CIAM), één app-registratie met per omgeving een eigen redirect-adres | Elke omgeving die inloggen aanbiedt |
| **AWS** (account "AlingAdvies", IAM Identity Provider + rol) | Compute voor productie, authenticatie via OIDC | Alleen productie |
| **Telegram** | Meldingen over de dagelijkse backupcontrole | Backuprem (§5) |
| **OneDrive** (`BACKUP_DIR`) | Opslag van de databasedumps | Backuprem (§5) |

**De authenticatieketen naar AWS verdient een eigen regel, want hij is
bewust anders dan de rest.** GitHub Actions wisselt per run een kortlevend
token uit met AWS, via een IAM Identity Provider
(`token.actions.githubusercontent.com`) en een rol
(`GitHubActions-MCM2-ECS-Deploy`) waarvan de trust policy beperkt is tot deze
repository, op `main`. Er staat **geen langlevende AWS-sleutel** in GitHub
Secrets — dat pad heeft dus, in tegenstelling tot bijna alles hierboven, geen
sleutelrotatieprobleem.

**De frontend praat nooit rechtstreeks met een los API-domein.** Een eerdere
poging om een apart sub-domein (`api.clm.alingadvies.nl`) voor de backend te
gebruiken bleek onnodig en is teruggedraaid: de frontend heeft al een
ingebouwd server-side doorgeefluik (`/api/backend/*`, ADR-012/Issue #51) dat
alle verzoeken — inclusief de OAuth-callback en cookies — naar `mcm2-api`
doorstuurt. De browser praat dus altijd alleen met `clm.alingadvies.nl`. Dat
is dezelfde constructie die het mogelijk maakt dat **één image** ongewijzigd
tegen elke omgeving kan draaien: welke backend erachter zit, wordt pas bij het
starten van de container bepaald (`API_BASE_URL`), nooit tijdens het bouwen.

---

## 7. Bewaking, backup en wat daar nog aan ontbreekt

### Backup — draait op de laptop van de eigenaar, niet in de cloud

Drie geplande Windows-taken: `MCM2 databasebackup`, `MCM2 backupcontrole`,
`MCM2 backupcontrole volledig`. Dumps gaan naar OneDrive, meldingen via
Telegram. **Gevolg: staat die laptop uit, dan draait er geen backup**, en dat
is precies waarom de backuprem (§5) niet zelf een backup maakt maar een
bewijsbestand leest dat de laptop zelf heeft geschreven — CI kan er niet bij.

### Doorlopende bewaking van een draaiende omgeving

Voor acceptatie en staging (beide op `saxombp`) bestaat er geen enkel signaal
wanneer ze omvallen — dat zou je merken doordat iemand het meldt.

Voor productie op AWS is er sinds de migratie een basaal, generiek vangnet:
ECS Express Mode herstart een taak automatisch als de `/health`-check faalt,
en de deploy-workflow wacht op aantoonbare gezondheid vóór hij zichzelf als
geslaagd meldt. Dat is **geen bewaking van een reeds langer draaiende
omgeving** — het vangt alleen een falende container tijdens of vlak na een
deploy, niet een applicatie die uren later stilletjes fout gaat zonder te
crashen. Er is nog geen alarmering (Telegram-achtig) voor productie, zoals die
voor de backup wél bestaat. CloudWatch-logretentie en een AWS Budget-alert
staan nog open.

### Sleutel- en wachtwoordrotatie — bestaat nergens

Geen ritme, geen vervaldatum, geen procedure voor: het Supabase-productie- en
stagingwachtwoord, de Resend-sleutel, het Telegram-token, de OIDC-secrets, het
GHCR-token op `saxombp` (verloopt ~8 november 2026), de AWS Secrets
Manager-secrets voor productie (`mcm2/productie/*`), en het GHCR-token dat ECS
gebruikt om images te pullen. De GitHub→AWS-authenticatie zelf is hiervan
uitgezonderd (zie §6) — dat is het enige stuk van de keten dat structureel
geen langlevend geheim nodig heeft.

---

## 8. Draagbaarheid: wat dit project nog steeds niet vastklikt aan één leverancier

Het uitgangspunt van dit hele traject was: bouw niets dat op de eindsituatie
(AWS) niet zou bestaan. Een samenvatting van wat dat betekent, nu productie
er daadwerkelijk staat:

| Onderdeel | Nu | Zou ook kunnen | Wat er zou veranderen |
|---|---|---|---|
| Compute (productie) | AWS ECS Express Mode | Elke andere containerdienst | Een taakdefinitie in plaats van een compose-bestand |
| Container-registry | GHCR | ECR of elk ander registry | Eén registeradres |
| Database | Supabase Postgres | RDS Postgres, elke managed Postgres | Eén connectiestring |
| Instellingen | Omgevingsvariabelen + secrets | Idem, overal | Niets |
| CI/CD | GitHub Actions | Elke andere CI-dienst met OIDC-support | De workflow-syntax, niet de architectuur |
| Identity | Microsoft Entra External ID | Elke OIDC-provider | Redirect-URI's en claims-mapping |

De belangrijkste asymmetrie die er wél was — de frontend die tijdens het
bouwen een vast API-adres inbakte, waardoor één image niet naar meerdere
omgevingen kon — is opgeheven (Issue #51, zie §6). Dat was de enige plek in de
stack die een architecturale beperking was, geen leveranciersbeperking, en het
is precies waarom die stap als eerste in het OTAP-plan werd aangepakt.

**Wat nog wél AWS-specifiek is, en bewust:** de OIDC-vertrouwensrelatie tussen
GitHub Actions en de IAM-rol (§6), en de ECS-taakdefinities zelf. Een
overstap naar een andere cloud zou die twee stukken opnieuw vragen — de rest
van de keten (image, database, secrets, CI-stappen) verhuist ongewijzigd mee.

---

## Bronnen

- `CLAUDE.md` §0, §0b — het doel van dit traject en de actuele middeleninventaris
- `docs/STATUS.md` — de actuele stand, sessie voor sessie
- `docs/runbooks/devops-handleiding.md` — wat de eigenaar zelf doet, bijgewerkt 2026-08-21
- `docs/runbooks/commandos-en-omgeving.md` — welk commando echt bestaat en waar het naartoe praat
- `docs/architectuur/plan-otap-straat-met-staging.md` — hoe de OTAP-straat tot stand kwam (10–14 augustus, saxombp-tijdperk)
- `docs/architectuur/pariteitscontract.md` — de norm voor "gelijke omgevingen"
- `.github/workflows/ci.yml`, `.github/workflows/productie.yml`, `.github/workflows/productie-aws.yml`
- Projectgeheugen `mcm2-besluit-18-08-naar-aws` — de volledige toedracht van de AWS-migratie, inclusief elke tegengekomen fout
