# Exit-route: MCM2 verhuizen naar een andere hostingomgeving

**Type:** levend document — geen besluit
**Eigenaar:** de eigenaar (Chris)
**Laatste update:** 2026-08-06
**Status:** AWS is de waarschijnlijke bestemming, maar staat niet vast (ADR-012)

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

Wat wél echt werk is: **de bestandsopslag**. Certificaten staan op de containerschijf. Dat is
tegelijk het grootste openstaande risico van vandaag (Issue #46) en het enige onderdeel dat
bij een verhuizing herbouwd moet worden.

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

| Component | AWS-tegenhanger | Azure-tegenhanger | Hoe vast |
|---|---|---|---|
| Backend-container | App Runner (ADR-012 voorkeur), ECS Fargate | Container Apps | **Los** — image draait overal |
| Frontend-container | idem | idem | **Los** |
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

## 8. Wat de richting zou kunnen veranderen

Vier dingen die dit document doen herzien:

**De Bizaline-context wijst de andere kant op.** De legacy-stack migreert juist *ván* AWS
*náár* Azure. Gaat MCM2 naar AWS, dan draaien er twee clouds naast elkaar. Dat is te
verdedigen — MCM2 is een apart product — maar het is een bewuste afwijking en geen
vanzelfsprekendheid.

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
