# Exit-route: MCM2 verhuizen naar een andere hostingomgeving

**Type:** levend document — geen besluit
**Eigenaar:** de eigenaar (Chris)
**Laatste update:** 2026-08-10 — GHCR als imageregister erbij, en "het image draait overal"
is voor de backend van bewering naar meting gegaan (§3).
**Status:** AWS is de waarschijnlijke bestemming, maar staat niet vast (ADR-012). Bizaline
draait al op AWS; Azure alleen bij zwaarwegende redenen (eigenaar, 2026-08-06).

> **Waarvoor dit document bestaat.** Niet om te kiezen. Wel om op elk moment te kunnen
> beantwoorden: *hoe vast zitten we nu, wat zou een verhuizing kosten, en welke keuze van
> vandaag maakt dat morgen duurder?*
>
> Het hoort bijgewerkt te worden **wanneer er een externe afhankelijkheid bij komt of
> verdwijnt** — niet op een vaste datum. Een nieuwe dienst in `.env.example` zonder regel in
> dit document is een gemiste afhankelijkheid.

---

## 0. De korte versie

MCM2 zit vandaag **losser dan het lijkt**. Drie dingen dragen dat:

1. **Supabase is alleen een Postgres-connectiestring.** Geen SDK, geen Supabase-specifieke
   code in de applicatie. Verhuizen naar RDS, Azure Database of een VPS is een URL wisselen
   plus een datamigratie.
2. **ADR-012 verbiedt platformspecifieke code** — ook die van de eigen omgeving. De backend
   en frontend draaien als gewone containers.
3. **Het mailkanaal zit achter één interface** (`MailKanaal`, ontwerp §5). Een andere
   provider is één nieuwe klasse.

Sinds 2026-08-10 is punt 2 **gemeten in plaats van beweerd**: het backend-image dat CI bouwt
draait ongewijzigd op een andere machine (`saxombp`), met migraties, rookproef en
terugdraaien. Wat per omgeving verschilt staat in drie regels van een `.env`-bestand.

Wat wél echt werk is:

- **De bestandsopslag.** Certificaten staan op de containerschijf. Dat is tegelijk het
  grootste openstaande risico van vandaag (Issue #46) en het enige onderdeel dat bij een
  verhuizing herbouwd moet worden.
- **De frontend.** Die is minder los dan hierboven gesuggereerd: de API-URL wordt tijdens de
  build ingebakken, dus één image kan niet naar twee omgevingen (Issue #51). Geen lock-in bij
  een leverancier, wel een blokkade voor elke cloud die je met omgevingsvariabelen instelt —
  en dat doen ze allemaal.

**Ruwe inschatting van een volledige verhuizing, in de huidige omvang:** dagen, geen weken —
mits de bestandsopslag vóór die tijd al naar objectopslag is verhuisd. Zo niet, dan komt dat
werk er bovenop en op het verkeerde moment.

---

## 1. Wat er vandaag draait

| Component | Nu | Vastgelegd in |
|---|---|---|
| Backend | NestJS in Docker | ADR-001 |
| Frontend | Next.js in Docker, aparte repo | ADR-012 |
| Database | PostgreSQL bij Supabase (**13 MB** op 2026-08-06) | ADR-002 |
| Identity | Microsoft Entra External ID, tenant `alingadvies.nl` | ADR-006 |
| Mail | Resend, domein `send.myvendormanager.nl` | mailkanaal-ontwerp |
| Bestanden | **containerschijf** `./var/uploads` (3,5 MB) | — |
| CI | GitHub Actions | ADR-007 |
| **Imageregister** | GitHub Container Registry (GHCR) | sinds 2026-08-10 |
| **Acceptatie + productie-simulatie** | Docker op `saxombp` (thuisserver, Tailscale) | uitrol-runbook |
| Meldingen | Telegram (backupcontrole) | backupcontrole-runbook |
| Backup | `pg_dump` naar OneDrive vanaf de ontwikkellaptop | ADR-011, Issue #58 |

---

## 2. Wat er níét hoeft te verhuizen

Deze paragraaf is de helft van de winst, en hij staat bewust vóór het migratieplan.

### Valkey — bestaat op papier, doet niets

`docker-compose.yml` start een `valkey/valkey:8.1-alpine`-container en `.env.example` kent
`REDIS_URL`. Maar er is **geen enkele dependency** (`bullmq`, `ioredis`) en **geen enkele
regel code** die ermee praat.

ADR-004 koos Valkey als queue-technologie voor BullMQ. Dat besluit ging over *welke* queue,
niet over *of* die er moest komen. De achtergrondtaken waarvoor hij bedoeld was —
bulkmail, herinneringen, verlopen rondes markeren, exports — zijn nog niet gebouwd.

**Besluit eigenaar 2026-08-06: eruit halen tot het nodig is.** ADR-004 blijft geldig als
"besluit genomen, nog niet toegepast"; komt er een queue, dan is het Valkey.

Wat dat scheelt: geen ElastiCache-cluster (of Azure Cache) inrichten, geen container per
omgeving, en geen variabele die een afhankelijkheid suggereert die er niet is.

> **Openstaand:** de container en `REDIS_URL` zijn op het moment van schrijven nog niet
> verwijderd. Dat is een losse opruimactie.

### Supabase — alleen een connectiestring

Doorzocht op 2026-08-06: geen `@supabase/*` in `package.json`, geen import in `src/`. De
enige treffer is een commentaarregel in `bestand-opslag.service.ts` die Supabase Storage als
*mogelijke* toekomst noemt — en die is niet gebruikt.

Wat er wél Supabase-specifiek is, zit **buiten de applicatie**: de rollenbootstrap
(`db/roles/bootstrap-roles.sql`) en de aanname dat `clm_migrator` `CREATE` heeft op de
database. Dat is bij elke Postgres opnieuw in te richten en staat al in een runbook.

### De databaselaag

Drizzle (ADR-010) spreekt gewoon Postgres. RLS, `FORCE ROW LEVEL SECURITY` en de
`app.current_tenant_id`/`app.current_actor`-constructie zijn standaard PostgreSQL — geen
Supabase-uitbreidingen. Ze werken op RDS, Aurora, Azure Database en een zelfgehoste
Postgres 17.

---

## 3. Per component: hoe vast zit het?

De kolom die ertoe doet is de laatste. "Los" betekent: configuratie wisselen. "Vast" betekent:
code of data verplaatsen.

De Azure-kolom staat er **niet omdat Azure waarschijnlijk is** — dat is het sinds 2026-08-06
minder dan eerder gedacht (§8). Hij staat er als toetssteen: een component met een makkelijke
tegenhanger in twee clouds is aantoonbaar niet vastgeklonken. Blijkt een rij moeilijk te
vullen, dan is dát de plek waar de lock-in zit.

| Component | AWS-tegenhanger | Azure-tegenhanger | Hoe vast |
|---|---|---|---|
| Backend-container | App Runner (ADR-012 voorkeur), ECS Fargate | Container Apps | **Los — en sinds 2026-08-10 gemeten**, zie hieronder |
| Frontend-container | idem | idem | **Minder los dan gedacht** — Issue #51, zie hieronder |
| Imageregister | ECR | Azure Container Registry | **Los** — `docker push` naar een ander adres; de uitrol leest de registernaam uit een `.env` op de server |
| Database | RDS PostgreSQL, Aurora | Azure Database for PostgreSQL | **Los** — dump + restore |
| **Bestanden** | **S3** | **Blob Storage** | **VAST — zie §4** |
| Identity | blijft Entra (of Cognito) | blijft Entra | **Los** — OIDC-standaard, ADR-006 |
| Mail | SES | geen eigen dienst; derde partij | **Los** — één klasse achter `MailKanaal` |
| CI | blijft GitHub Actions | idem | **Los** |
| Meldingen | SNS | Azure Monitor | **Los** — `verstuur()` in `telegram.js` |
| Backup | RDS-snapshots | Azure-backup | **Los** — vervangt `backup-dump.js` |

**Identity verhuist waarschijnlijk helemaal niet.** ADR-006 koos bewust generieke `OIDC_*`-
variabelen in plaats van `ENTRA_*`. Entra draait bij Microsoft; welke cloud de applicatie
host, raakt dat niet.

### "Los" was een bewering. Sinds 2026-08-10 is het voor de backend een meting.

Tot die datum stond hier *"image draait overal"* zonder dat het ooit ergens anders had
gedraaid dan op de ontwikkelmachine. Dat is nu beproefd: het image dat CI bouwt en publiceert
naar GHCR draait op `saxombp` — een andere machine, ander besturingssysteem, andere
netwerkomgeving — zonder enige aanpassing aan het image.

Wat daarbij gemeten is: migraties draaien mee bij de uitrol, acceptatie en productie hebben
gescheiden data, en terugdraaien naar een oudere versie werkt.

**Wat dit betekent voor een verhuizing.** De uitrol kent precies drie dingen die per omgeving
verschillen, en alle drie staan in een `.env`-bestand op de doelmachine:

| Wat | Waar het staat |
|---|---|
| Welk register | `GHCR_API=` — wordt `…dkr.ecr.eu-west-1.amazonaws.com/…` bij AWS |
| Welk databasewachtwoord | `DB_WACHTWOORD=` |
| Welke poorten en URL | `API_POORT=`, `FRONTEND_URL=` |

De rest van de keten — bouwen, publiceren, migreren, rookproef, terugdraaien — is
leverancieronafhankelijk. Dat was de opzet en dat is nu aantoonbaar.

### De frontend was minder los dan deze tabel suggereerde — opgelost 2026-08-10

`NEXT_PUBLIC_API_URL` werd tijdens de **build** in de bundel gebakken. Eén frontend-image
wist daardoor al met welke backend het praatte.

Dat was geen lock-in bij een leverancier, maar wél een blokkade voor het uitgangspunt dat
hetzelfde artefact van acceptatie naar productie promoveert — en dus voor elke cloud die je
met omgevingsvariabelen configureert, wat ze allemaal doen.

**Issue #51 is opgelost.** De frontend leest het backend-adres nu bij het **starten**, uit
`API_BASE_URL`; de browser praat via een server-side doorgeefluik op de frontend zelf.
Bewezen met hetzelfde image in twee containers die alleen in die variabele verschilden: de
een gaf de leverancierslijst uit de demo-database, de ander een 401 uit een verse database.

Daarmee is er geen enkele instelling meer die bij het bouwen vastligt en per omgeving zou
moeten verschillen — precies wat App Runner, ECS en Kubernetes verwachten.

**Wat er nog wél in de weg staat**, en dat is iets anders: de frontend-image wordt nergens
gepubliceerd. De CI bouwt hem en controleert dat hij start, maar duwt hem niet naar GHCR.
Zolang dat zo is draait de frontend niet mee in de uitrolketen — geen ontwerpprobleem meer,
maar een ontbrekende publicatiestap.

### Wat deze tabel níét meet: beschikbaarheid

De kolom "hoe vast" gaat over verhuizen. Dat is niet hetzelfde als: wat gebeurt er als deze
leverancier het even niet doet?

Op 2026-08-06 lag GitHub Actions een middag plat (officiële status `major_outage`, incident
gestart 15:22 UTC). CI staat hierboven als **Los** — en dat klopt: de workflow is één
YAML-bestand en draait op een andere aanbieder net zo goed. Maar tijdens die storing was er
geen enkele manier om te bewijzen dat `main` gezond was. Twee merges gingen erdoorheen zonder
dat de Docker-productiebuild of de RLS-isolatietest ze zag.

**Makkelijk te vervangen is niet hetzelfde als beschikbaar.** Voor elke rij hierboven geldt
die tweede vraag apart, en dit document beantwoordt hem niet. Wat het wél oplevert: waar een
storing alleen het *aantonen* raakt (CI, meldingen) is de schade uitgesteld werk. Waar hij de
*applicatie* raakt (database, identity, bestanden) staat de dienst stil. Dat onderscheid is
belangrijker dan de verhuisbaarheid, en er is nog geen document dat het bijhoudt.

---

## 4. De enige echte blokkade: bestandsopslag

Geüploade certificaten staan op `./var/uploads` in de container. De `VOLUME`-regel in de
`Dockerfile` is een map ín de container, geen persistente opslag.

Dat is **nu al** het probleem dat Issue #46 beschrijft ("blokkerend-voor-pilot") en dat
`bestand-opslag.service.ts` zelf benoemt:

> *"De database gaat mee in `npm run backup:dump`; bestanden op schijf niet. Zonder aanvulling
> zijn de certificaten het enige onderdeel zonder backup, en juist het onderdeel dat
> bewijsmateriaal bevat."*

**Waarom dit hier staat:** het is niet alleen een migratieprobleem. Het is een probleem van
vandaag dat bij een verhuizing zichtbaar wordt. Los je het vóór de verhuizing op, dan is de
verhuizing zelf triviaal — de bestanden staan dan al in objectopslag en die verhuist met een
kopieeropdracht.

**Wat het ontwerp goed doet:** `storage_key` is bewust een relatief pad en geen URL. De
service zegt: *"alleen deze service wordt dan vervangen"*. Dat klopt — het is één klasse met
drie methoden (`bewaar`, `lees`, `verwijder`).

**Advies: los dit los van de verhuisvraag op.** Het staat op de pilot-lijst; de verhuizing
profiteert er gratis van.

---

## 5. Het mailkanaal: Resend of iets anders

Sinds 2026-08-06 draait Resend op `send.myvendormanager.nl`, achter de `MailKanaal`-interface.
Vervangen is één nieuwe klasse — dat is precies waarvoor die knip er is.

**Maar de code is niet het werk.** Bij een provider-wissel verhuist ook:

- **DNS** — nieuwe SPF, DKIM, en verificatie van het domein
- **Reputatie** — een nieuw verzenddomein of een nieuwe provider begint zonder geschiedenis
- **De ontvangstkant** — Resend levert ondertekende webhooks voor bounces; SES doet dat via
  SNS (en meestal SQS erachter). Dat is niet zwaarder, maar het is wél andere plumbing dan
  wat het ontwerp §4 nu beschrijft.

**Wat je bij SES aan gemak inlevert** (geverifieerd 2026-08-06, oriënterend):

| | Resend | SES |
|---|---|---|
| Bounce-webhooks | ondertekend, out of the box | via SNS + meestal SQS |
| Domeinverificatie | records aanleveren, klaar | vergelijkbaar, meer stappen |
| Sandbox | n.v.t. | ja — productietoegang aanvragen, orde van dagen |
| Prijs | gratis tot 3.000/maand, 100/dag | ~$0,10 per 1.000 mails |
| Reputatiebeheer | grotendeels geregeld | meer zelf doen |

**Waar de kostenvergelijking op kantelt:** de daglimiet van 100 op het gratis Resend-plan is
voor een bulkronde van 500 uitnodigingen een echte beperking (mailkanaal-ontwerp §3b). Dat is
eerder een reden om naar Resend Pro te gaan dan naar SES — tenzij de rest al op AWS staat, en
dan is SES de logische bijvangst.

Dat laatste is sinds 2026-08-06 waarschijnlijker geworden (§8), maar het maakt de afweging
niet vanzelf. Resend draait, is bewezen, en de webhook-constructie uit het mailkanaal-ontwerp
§4 is erop gebouwd. Overstappen kost DNS-werk, reputatieopbouw en het herschrijven van de
ontvangstkant naar SNS — voor een besparing die bij dit volume in centen loopt. **De reden om
naar SES te gaan zou beheereenvoud zijn (één leverancier, één factuur), niet de prijs.**

> **Niet nu beslissen.** Deze paragraaf bestaat om de afweging vast te leggen, niet om hem te
> maken. Herzien wanneer de bulkfeature gebouwd wordt of het volume boven 3.000/maand komt.

---

## 6. Volgorde, als het zover is

Niet als planning bedoeld, wel als volgorde. Elke stap is los terug te draaien.

1. **Bestandsopslag naar objectopslag** (Issue #46) — het enige echte bouwwerk. Doe dit
   sowieso, ongeacht de verhuizing.
2. **Een lege doelomgeving inrichten** — netwerk, database, containerregistry. Nog niets
   verplaatsen.
3. **Rollenbootstrap en migraties** tegen de nieuwe database. Dit is beproefd: het gebeurt bij
   elke CI-run tegen een wegwerpdatabase.
4. **Images naar het registry**, containers draaien, health checks groen.
5. **DNS en identity** — redirect-URI's in Entra bijwerken, `PORTAAL_BASIS_URL` wisselen.
6. **Data overzetten** — `pg_dump`/`pg_restore`, plus de objecten uit stap 1. Bij 13 MB is dat
   minuten.
7. **Mail** — pas hierna, en pas als er een reden is om van Resend af te stappen.
8. **Backup en meldingen** — provider-snapshots in plaats van `backup-dump.js`; dat lost
   Issue #58 (backup hangt aan de ontwikkellaptop) meteen op.

**Wat níét in deze lijst staat:** applicatiecode aanpassen. Als dat er wél in blijkt te horen,
is er onderweg iets platformspecifieks ingeslopen en is dat het echte signaal.

---

## 7. Kosten — ordegrootte, niet geverifieerd

> **Waarschuwing.** De cijfers hieronder zijn oriënterend, deels afgeleid uit secundaire
> bronnen en niet bij de leverancier bevestigd. Ze zijn bruikbaar om te zien of iets tientjes
> of honderden euro's kost — niet om een begroting op te bouwen. ADR-012 hanteert dezelfde
> voorzichtigheid voor App Runner.

Uitgangspunt: twee kleine, continu draaiende containers, database onder 1 GB, enkele GB's aan
bestanden, minder dan 3.000 mails per maand.

| Post | Indicatie per maand |
|---|---|
| App Runner, 2 diensten op de kleinste maat | $10–50, afhankelijk van de maat |
| RDS PostgreSQL, kleinste instantie | $12–20 |
| S3, enkele GB's | onder $5 |
| SES, <10.000 mails | onder $1 |

**Wat dit vooral zegt:** de hostingkosten zijn in deze omvang geen argument in de keuze. Wat
wél weegt is beheerlast, en dat is een vraag waar dit document geen antwoord op geeft.

---

## 8. Wat de richting bepaalt

Eén ding dat de richting **bevestigt**, en drie die hem alsnog kunnen omgooien.

### Wat hem bevestigt

**De Azure-beweging is geen gegeven meer.** Bizaline draait op AWS, en dat blijkt de meest
praktische oplossing. Er was eerder een richting naar Azure — die staat nog in oudere
Bizaline-documentatie — maar de eigenaar twijfelt daar inmiddels aan (2026-08-06). **Azure
is nog aan de orde als er zwaarwegende redenen voor zijn, niet als vanzelfsprekende
bestemming.**

Dat maakt AWS voor MCM2 sterker dan ADR-012 destijds kon vastleggen: niet alleen de
waarschijnlijke keuze, maar ook de keuze die aansluit bij waar de rest al draait — dezelfde
account­structuur, dezelfde IAM-praktijk, dezelfde facturatie.

**Waarom dit document AWS tóch niet vastlegt.** Het is nog steeds geen besluit, en de
Azure-kolom in §3 blijft staan. Niet omdat Azure waarschijnlijk is, maar omdat de kolom laat
zien *hoe los* elke component zit. Een component met een makkelijke tegenhanger in beide
clouds is aantoonbaar niet vastgeklonken — en dat is wat dit document moet bewaken. Verdwijnt
de kolom, dan verdwijnt ook het zicht op waar de lock-in werkelijk zit.

### Wat hem alsnog kan omgooien

**Een MSP.** Als er beheer wordt uitbesteed, kiest die partij mogelijk de omgeving. Dan is dit
document input voor het gesprek in plaats van een plan.

**De klant.** Transdev of een volgende klant kan eisen stellen aan dataresidentie of aan de
leverancier. Dat overrulet elke technische voorkeur.

**Een tweede tenant.** Alles hierboven gaat uit van één omgeving. Bij meerdere klanten met
eigen eisen wordt de vraag anders — en dan is de exit-route belangrijker dan de bestemming.

---

## 9. Bijhouden

Dit document veroudert stil. Twee momenten waarop het bijgewerkt hoort te worden:

- **Een externe afhankelijkheid komt erbij of verdwijnt.** Nieuwe regel in `.env.example`
  zonder regel hier = gemiste afhankelijkheid. Dat is de belangrijkste.
- **Een ADR raakt de hosting.** Dan hoort de tabel in §3 mee te bewegen.

**Wat het niet is:** een planning. Er staat geen datum in en er hoort er geen in te komen
zolang de bestemming niet vaststaat.

---

## Verwijzingen

- ADR-012 — frontend-uitrol: Docker als enige weg, AWS App Runner beoogd
- ADR-011 — backup- en hersteleisen per fase
- ADR-006 — CIAM-laag: Entra External ID, generieke OIDC-variabelen
- ADR-004 — Valkey in plaats van Redis (besluit staat, nog niet toegepast)
- ADR-002 — Supabase als database, met openstaande controls
- Issue #46 — objectopslag voor uploads
- Issue #58 — backup hangt aan de ontwikkellaptop
- Issue #21 — AWS-beveiligingsdiensten, afhankelijk van een volledige migratie
- `docs/superpowers/specs/2026-08-06-mailkanaal.md` — de `MailKanaal`-knip
