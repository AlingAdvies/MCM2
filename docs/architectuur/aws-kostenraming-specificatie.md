# AWS-kostenraming — specificatie voor een externe rammer

**Doel:** uitsluitend de **out-of-pocket kosten aan AWS** ramen.
**Buiten scope:** migratiekosten, ontwikkeluren, leerkosten, licenties van
derden (Entra, Resend). Dit document gaat alleen over de AWS-factuur.

**Regio:** `eu-west-1` (Ierland) — de databases staan daar al.
**Datum meting:** 2026-08-12.
**Status:** er is nog geen AWS-account.

> ✅ = gemeten op de bestaande productieomgeving.
> ⚠️ = onbekend, moet de rammer als aanname invullen.

---

## 1. Wat er gehost moet worden

Eén applicatie, bestaande uit twee containers, plus een database.
Multi-tenant SaaS. Nu: **1 tenant, 1 gebruiker.**

| Onderdeel | Type | Wat het is |
|---|---|---|
| `api` | container, Node.js/NestJS | REST-backend |
| `frontend` | container, Next.js | Webinterface |
| database | PostgreSQL 17.6 ✅ | Nu bij Supabase |

---

## 2. Gemeten verbruik — de invoer voor de raming

Dit is een **zeer kleine** applicatie. Reken niet met standaardgroottes.

| Post | Gemeten ✅ | Toelichting |
|---|---|---|
| Geheugen `api` | **41 MB** | In rust, productie |
| Geheugen `frontend` | **48 MB** | In rust, productie |
| **Samen** | **~90 MB** | 0,5 GB per container is ruim |
| CPU-belasting | **load 0,06** | Op 2 cores uit 2009 — vrijwel niets |
| Image `api` | **316 MB** | Per versie |
| Image `frontend` | **342 MB** | Per versie |
| Databasegrootte | **14 MB** | Productie, gevuld met 26 migraties |
| PostgreSQL-versie | **17.6** | Bij een RDS-raming aanhouden |
| Max. bestandsupload | **5 MB** | Per bestand, afgedwongen in de code |

---

## 3. Te ramen posten

### 3.1 Compute — de hoofdpost

Kies één vorm; de raming verschilt sterk.

| Vorm | Wat te ramen |
|---|---|
| **App Runner** | 2 diensten × 0,25 vCPU / 0,5 GB, 730 uur/maand |
| **ECS Fargate** | 2 taken × 0,25 vCPU / 0,5 GB + **ALB** + **NAT Gateway** |
| **EC2** | 1 × `t4g.small` of kleiner + EBS-volume |

> ⚠️ **Grootste valkuil bij Fargate:** de **Application Load Balancer** en de
> **NAT Gateway** kosten een vast bedrag per maand, ongeacht gebruik. Bij een
> applicatie van 90 MB zijn die samen vaak duurder dan alle compute. **Vraag de
> rammer die twee posten apart te specificeren.**

### 3.2 Database

Twee scenario's, allebei ramen:

| Scenario | Te ramen |
|---|---|
| **A — blijft bij Supabase** | € 0 op de AWS-factuur |
| **B — naar RDS PostgreSQL** | `db.t4g.micro` of `db.t4g.small`, 20 GB gp3 (minimum), Multi-AZ ja/nee, backup-retentie |

Gebruikt maar 14 MB, dus de opslag is het minimum van 20 GB. **Multi-AZ
verdubbelt de databasekosten** — apart specificeren.

**Extensies in gebruik** ✅ (voor de toets of RDS ze ondersteunt):
`pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `plpgsql`.
`supabase_vault` is Supabase-eigen en vervalt bij RDS.

### 3.3 Objectopslag (S3) — uploads

Nu staan bestanden op een containerschijf; bij AWS horen ze op S3.

Te ramen: opslag + PUT/GET-verzoeken + uitgaand verkeer.

⚠️ **Volume onbekend.** Rekenmodel voor de rammer:

```
5 MB × aantal leveranciers × rondes per jaar
```

Referentie: de vorige tenant had **21 leveranciers**, 1 ronde per jaar.
Dat is ~105 MB per jaar per tenant. Verwaarloosbaar, maar de
verzoekkosten en retentie horen erbij.

### 3.4 Uitgaand dataverkeer

⚠️ **De grootste onbekende, en bij AWS een reële post.**

Niet betrouwbaar te schatten zonder meting. Laat de rammer werken met
bandbreedtes (bijv. 10 / 50 / 200 GB per maand) in plaats van één getal.

### 3.5 Container registry (ECR)

Alleen als de images van GitHub (GHCR) naar AWS gaan.

- ~660 MB per versie (api + frontend) ✅
- ⚠️ Aantal bewaarde versies × retentiebeleid bepaalt de opslag
- Blijft het bij GHCR: **€ 0 op de AWS-factuur**

### 3.6 Overige AWS-posten

| Post | Te ramen |
|---|---|
| **ACM** (TLS-certificaat) | **Gratis** bij gebruik met ALB/CloudFront |
| **Route 53** | Alleen als DNS van mijndomein.nl verhuist: hosted zone + queries |
| **Secrets Manager** | ~10 secrets per omgeving (of Parameter Store, goedkoper) |
| **CloudWatch Logs** | Per GB opgenomen + retentie — **retentie kort zetten** |
| **EventBridge Scheduler** | 1 dagelijkse taak (zie §4) |
| **SQS** | Wachtrij voor mail (zie §4) |
| **AWS Backup** | Alleen bij RDS |

---

## 4. Nieuwe functionaliteit die AWS-posten toevoegt

Twee dingen die **nog niet bestaan** maar wel op de AWS-factuur komen. Alleen
de infrastructuurkosten hier — het bouwwerk is buiten scope.

### Notificaties (per tenant)

Herinneringen als een leverancier te laat is of een beoordeling blijft liggen.

| AWS-post | Omvang |
|---|---|
| **EventBridge Scheduler** | 1 taak per dag |
| **SQS** | Wachtrij, laag volume |

Verwaarloosbaar bij dit volume, maar het hoort in de opsomming.

### Agendakoppeling (toekomstig)

Meetings plannen met vendors en collega's, via Microsoft Graph (Outlook).

**Geen AWS-post.** Het verkeer gaat naar Microsoft, niet naar AWS-infrastructuur.

---

## 5. Diensten die NIET op de AWS-factuur komen

Belangrijk om dubbeltelling te voorkomen:

| Dienst | Waarvoor | Kosten |
|---|---|---|
| **Microsoft Entra External ID** | Inloggen interne gebruikers | Apart bij Microsoft. **Leveranciers loggen niet in** — die krijgen een tokenlink — dus alleen interne gebruikers tellen |
| **Resend** | E-mail versturen | Apart. Kan naar **Amazon SES**: dan wél een AWS-post, te ramen op aantal berichten per maand ⚠️ |
| **GitHub Actions / GHCR** | Bouwstraat en images | Apart bij GitHub |
| **Supabase** | Database, tenzij naar RDS | Apart |

---

## 6. Aannames die de rammer moet vastleggen

Zonder deze wordt het één getal zonder betekenis.

| # | Aanname | Nu bekend |
|---|---|---|
| 1 | **Aantal omgevingen bij AWS** | Nu 3 (acceptatie/staging/productie). Overweeg alleen productie |
| 2 | **Database bij RDS of bij Supabase** | Zie §3.2 |
| 3 | **24/7 of alleen kantoortijden** | Niet-productie uitzetten scheelt tot ~70% |
| 4 | **Multi-AZ / redundantie** | Nu: geen. Verdubbelt compute én database |
| 5 | **Uitgaand verkeer** ⚠️ | Onbekend — laat bandbreedtes ramen |
| 6 | **Aantal tenants / gebruikers** | Nu 1 tenant, 1 gebruiker. Pilot: +1 klant |
| 7 | **Logretentie** | Bepaalt CloudWatch-kosten |
| 8 | **Images bij ECR of GHCR** | Zie §3.5 |
| 9 | **Mail via Resend of SES** | Zie §5 |

---

## 7. Gevraagde uitvoer

**Drie scenario's**, elk met de posten uit §3 apart gespecificeerd:

| Scenario | Omvang |
|---|---|
| **Minimaal** | Alleen productie bij AWS, database blijft Supabase, images bij GHCR, geen redundantie |
| **Realistisch** | Productie + staging, S3 voor uploads, logging, secrets, geen Multi-AZ |
| **Volledig** | Drie omgevingen, RDS Multi-AZ, ECR, volledige logging en backup |

**Specificeer apart, niet als één totaal:**

- Compute
- Loadbalancer
- **NAT Gateway** (indien van toepassing)
- Uitgaand dataverkeer
- Database
- Opslag (S3 + ECR)
- Overig (logging, secrets, DNS, scheduler, wachtrij)

**Voor jaar 1 en jaar 2 apart** — AWS geeft nieuwe accounts een vrije laag die
in jaar 2 vervalt. Een raming die alleen jaar 1 toont, is misleidend.

---

## Bijlage — kopieerbare invoer voor de AWS Pricing Calculator

```
Regio: eu-west-1 (Ierland)

COMPUTE (per omgeving)
  api      : 0,25 vCPU / 0,5 GB   (gemeten: 41 MB)
  frontend : 0,25 vCPU / 0,5 GB   (gemeten: 48 MB)
  draaitijd: 730 uur/maand

DATABASE (alleen bij RDS)
  engine   : PostgreSQL 17.6
  klasse   : db.t4g.micro of db.t4g.small
  opslag   : 20 GB gp3 (minimum; werkelijk gebruik 14 MB)
  Multi-AZ : apart ramen

OPSLAG
  ECR      : ~660 MB per versie × aantal bewaarde versies
  S3       : ~105 MB/jaar per tenant (5 MB × 21 leveranciers)

VERKEER
  uitgaand : ONBEKEND — raam 10 / 50 / 200 GB per maand
```
