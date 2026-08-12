# AWS-kostenraming — complete briefing

**Opdracht:** raam de maandelijkse en jaarlijkse **out-of-pocket kosten aan AWS**
voor het hosten van het MCM2-platform in de hieronder beschreven use case.

**Buiten scope:** migratiekosten, ontwikkeluren, leerkosten, licenties van
derden. Uitsluitend de AWS-factuur.

| | |
|---|---|
| **Regio** | `eu-west-1` (Ierland) |
| **Datum** | 2026-08-12 |
| **Huidige situatie** | Nog geen AWS-account; applicatie draait op eigen hardware |
| **Gevraagd** | Drie scenario's, per AWS-dienst uitgesplitst, jaar 1 en jaar 2 apart |

> ✅ = gemeten aan de draaiende applicatie
> 📐 = afgeleid uit de use case
> ⚠️ = aanname die de rammer moet vastleggen

---

## 1. De use case

Multi-tenant SaaS voor **Contract & Vendor Lifecycle Management**. Corporate
klanten sturen jaarlijks een compliance-vragenlijst uit naar hun leveranciers;
die vullen die in en uploaden bewijsdocumenten (certificaten, verklaringen).

### Volume waarop geraamd moet worden

| Grootheid | Aantal | Toelichting |
|---|---|---|
| **Tenants (corporate klanten)** | **7** | Elk volledig van elkaar gescheiden |
| **Actieve gebruikers per tenant** | **~5** | Interne medewerkers, loggen in |
| **Totaal interne gebruikers** | **35** 📐 | 7 × 5 |
| **Vendors per tenant** | **~100** | Krijgen een survey, uploaden documenten |
| **Totaal vendors** | **700** 📐 | 7 × 100 |
| **Surveyrondes** | **1× per jaar per tenant** ⚠️ | Zie §6, aanname 1 |

### Wat vendors doen — en niet doen

**Vendors loggen NIET in.** Ze krijgen een e-mail met een unieke link
(tokengebaseerd), vullen daarmee de vragenlijst in en uploaden bestanden. Dat is
relevant voor twee redenen:

- Geen identity-kosten voor 700 vendors — alleen de 35 interne gebruikers
- Wél publiek verkeer: 700 externe bezoekers per ronde die documenten uploaden

### Belastingpatroon — dit is géén constante belasting

**Kritiek voor de raming.** Het gebruik is sterk gepiekt:

- Een surveyronde wordt in één keer uitgestuurd naar ~100 vendors
- Die reageren verspreid over enkele weken, met een piek vlak vóór de deadline
- Daarbuiten is het rustig: ~5 interne gebruikers per tenant

**Implicatie:** een raming op basis van constante piekbelasting overschat fors.
Vraag om een raming die uitgaat van een lage basislast met periodieke pieken,
en geef aan of automatisch schalen daarin is meegenomen.

---

## 2. De applicatie — gemeten cijfers

Twee containers plus een database. **Zeer licht** — reken niet met
standaardgroottes.

| Post | Gemeten ✅ |
|---|---|
| Geheugen `api` (Node.js/NestJS) | **41 MB** |
| Geheugen `frontend` (Next.js) | **48 MB** |
| Samen | **~90 MB** |
| CPU-belasting | **load 0,06** op 2 cores |
| Image `api` | **316 MB** per versie |
| Image `frontend` | **342 MB** per versie |
| Database nu | **14 MB** (1 tenant, leeg) |
| PostgreSQL-versie | **17.6** |
| Max. uploadgrootte | **5 MB** per bestand (afgedwongen in code) |

**Extensies in gebruik** ✅ — te toetsen bij RDS:
`pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `plpgsql`.

---

## 3. Documentopslag — harde eis

> **Uploads moeten permanent bewaard blijven en opvraagbaar zijn.**

Dit is compliance-bewijsmateriaal: een vendor toont aan ISO27001-gecertificeerd
te zijn, en dat bewijs moet later terug te vinden zijn. Er is dus **geen
vervaldatum** en geen automatische opruiming.

### Volumeberekening 📐

```
Per ronde per tenant : 100 vendors × 5 MB      =   500 MB
Alle 7 tenants       : 7 × 500 MB              = 3,5 GB per ronde
Per jaar (1 ronde)   :                           3,5 GB
```

**Cumulatief, want er wordt niets verwijderd:**

| Na | Opslag |
|---|---|
| Jaar 1 | ~3,5 GB |
| Jaar 3 | ~10,5 GB |
| Jaar 5 | ~17,5 GB |
| Jaar 10 | ~35 GB |

> ⚠️ **Dit is de bovengrens.** 5 MB is het *maximum* per bestand; in de praktijk
> zijn certificaten vaak 100–500 KB. Vraag de rammer een bandbreedte:
> **0,5 MB gemiddeld (~350 MB/jaar) tot 5 MB maximum (~3,5 GB/jaar).**

### Wat te ramen

- **S3 Standard** voor de eerste periode
- **Levenscyclus naar goedkopere opslagklassen** — documenten worden zelden
  opgevraagd na het eerste jaar. Vraag om een variant mét en zonder
  automatische overgang naar infrequent access / archief.
- **PUT-verzoeken**: ~700 per ronde (plus herzendingen)
- **GET-verzoeken**: laag — alleen bij beoordeling en incidenteel opvragen
- **Versioning en replicatie**: ⚠️ ja/nee, zie §6

> **Let op de archiefkeuze:** goedkope archiefklassen hebben ophaalkosten en
> wachttijd. Bij "opvraagbaar" als eis is dat een afweging, geen automatisme.

---

## 4. Database

De database bevat tenants, vendors, vragenlijsten, antwoorden en een
**append-only audit trail**. Ook die groeit en wordt niet opgeschoond.

### Volumeschatting 📐

| Bron | Per jaar |
|---|---|
| 700 vendors + contactpersonen | klein |
| 700 responses × ~10 antwoorden | ~7.000 rijen |
| Audit trail (append-only) | grootste groeier |

**Realistisch:** enkele honderden MB na meerdere jaren. **De minimumopslag van
RDS (20 GB) is jarenlang ruim voldoende** — de opslagkosten worden bepaald door
het minimum, niet door het gebruik.

### Twee scenario's, allebei ramen

| | Te ramen |
|---|---|
| **A — blijft bij Supabase** | € 0 op de AWS-factuur (kosten apart bij Supabase) |
| **B — naar Amazon RDS** | `db.t4g.small` of `db.t4g.medium`, 20 GB gp3, backup-retentie, **Multi-AZ apart specificeren** |

Bij 7 corporate klanten met echte data is Multi-AZ een serieuze overweging.
Het verdubbelt de databasekosten — laat het als aparte regel zien.

---

## 5. Te ramen AWS-diensten

### 5.1 Compute

Drie omgevingen (zie §7). Per omgeving twee containers.

| Vorm | Te ramen |
|---|---|
| **ECS Fargate** (aanbevolen) | 2 taken × 0,5 vCPU / 1 GB + ALB + NAT Gateway |
| **App Runner** | 2 diensten, automatisch schalend |
| **EC2** | instantie + EBS |

> **Grootste valkuil:** **ALB en NAT Gateway** kosten een vast bedrag per maand,
> ongeacht gebruik. Bij een applicatie van 90 MB zijn die samen vaak duurder dan
> alle compute. **Specificeer ze apart**, en geef aan of de drie omgevingen ze
> kunnen delen.

Reken op 0,5 vCPU / 1 GB per container in productie (ruim boven de gemeten
90 MB, om piekbelasting bij een surveyronde op te vangen).

### 5.2 Uitgaand dataverkeer ⚠️

**De grootste onbekende.** Componenten:

- 700 vendors die het portaal openen en documenten uploaden (inkomend: gratis)
- Interne gebruikers die documenten downloaden bij beoordeling (uitgaand)
- Normale webapplicatie-belasting voor 35 gebruikers

📐 Ruwe indicatie: **10–100 GB per maand**, met pieken tijdens surveyrondes.
Laat de rammer werken met bandbreedtes, niet met één getal.

### 5.3 Overige diensten

| Dienst | Te ramen |
|---|---|
| **S3** | Zie §3 — cumulatief, geen retentiegrens |
| **RDS** | Zie §4 — alleen bij scenario B |
| **ECR** | ~660 MB per versie × bewaarde versies. Blijft het bij GitHub: € 0 |
| **ACM** (TLS) | Gratis bij ALB/CloudFront |
| **Route 53** | Hosted zone + queries, als DNS verhuist |
| **Secrets Manager** | ~10 secrets × 3 omgevingen |
| **CloudWatch Logs** | Per GB + retentie ⚠️ |
| **EventBridge Scheduler** | 1 dagelijkse taak (notificaties) |
| **SQS** | Mailwachtrij — piek van 100 berichten per ronde |
| **SES** | ⚠️ Alleen als mail van Resend naar AWS gaat: ~700 berichten per ronde plus herinneringen |
| **AWS Backup** | Bij RDS en S3 |
| **CloudFront** | ⚠️ Optioneel — kan uitgaand verkeer goedkoper maken |
| **WAF** | ⚠️ Optioneel — het portaal is publiek toegankelijk |

---

## 6. Aannames die de rammer moet vastleggen

| # | Aanname | Uitgangspunt |
|---|---|---|
| 1 | **Rondes per jaar** | 1 per tenant. Meer rondes schalen S3 en SES lineair |
| 2 | **Gemiddelde bestandsgrootte** | Raam 0,5 MB én 5 MB (bovengrens) |
| 3 | **Bewaartermijn documenten** | **Onbeperkt** — nergens een retentiebeleid vastgelegd |
| 4 | **Archiefklassen** | Mag S3 automatisch naar goedkopere opslag? |
| 5 | **Multi-AZ / redundantie** | Bij 7 corporate klanten waarschijnlijk ja |
| 6 | **Uitgaand verkeer** | 10 / 50 / 100 GB per maand als bandbreedte |
| 7 | **Database bij RDS of Supabase** | Zie §4 |
| 8 | **Mail via Resend of SES** | Nu Resend (extern) |
| 9 | **Images bij ECR of GitHub** | Nu GitHub (gratis) |
| 10 | **Logretentie** | 30 / 90 / 365 dagen |
| 11 | **Niet-productie 24/7 of kantooruren** | Uitzetten scheelt tot ~70% op die omgevingen |
| 12 | **Groeipad** | Raam ook 15 en 25 tenants, om de schaalbaarheid te zien |

---

## 7. Omgevingen — drie, alle bij AWS

De opdrachtgever wil een **robuuste, hassle-free geautomatiseerde OTAP-straat**.
Dat vraagt dat acceptatie en staging dezelfde vorm hebben als productie;
anders bewijst een geslaagde test daar niets over productie.

| Omgeving | Omvang | Draaitijd | Data |
|---|---|---|---|
| **Acceptatie** | Klein, mag stuk | Kantooruren ⚠️ | Wegwerp |
| **Staging** | Gelijk aan productie | Kantooruren ⚠️ | Testdata |
| **Productie** | Volledig, redundant | 24/7 | Echte klantdata |

Vraag expliciet: **kunnen de drie omgevingen netwerkonderdelen delen** (ALB, NAT
Gateway) of heeft elke omgeving een eigen set nodig? Dat verschil is bij deze
applicatiegrootte groter dan alle compute samen.

---

## 8. Niet op de AWS-factuur

Voorkom dubbeltelling:

| Dienst | Waarvoor |
|---|---|
| **Microsoft Entra External ID** | Inloggen. **Alleen de 35 interne gebruikers** — de 700 vendors loggen niet in |
| **Resend** | E-mail, tenzij naar SES |
| **GitHub Actions / GHCR** | Bouwstraat en images |
| **Supabase** | Database, tenzij naar RDS |

---

## 9. Gevraagde uitvoer

### Drie scenario's

| | Omvang |
|---|---|
| **Minimaal** | Alleen productie bij AWS, database blijft Supabase, images bij GitHub, geen Multi-AZ |
| **Realistisch** | Drie omgevingen, RDS zonder Multi-AZ, S3 met levenscyclus, logging, secrets |
| **Volledig** | Drie omgevingen, RDS Multi-AZ, ECR, CloudFront, WAF, volledige backup en logging |

### Per scenario apart specificeren

- Compute (per omgeving)
- **ALB** (apart)
- **NAT Gateway** (apart)
- Uitgaand dataverkeer
- Database (incl. Multi-AZ als aparte regel)
- S3 (opslag + verzoeken, cumulatief over 5 jaar)
- ECR
- Overig (logging, secrets, DNS, scheduler, wachtrij, SES)

### Aanvullend gevraagd

1. **Jaar 1 en jaar 2 apart** — de vrije laag voor nieuwe accounts vervalt na
   jaar 1. Een raming die alleen jaar 1 toont, is misleidend.
2. **Vijfjarenbeeld voor S3** — de opslag groeit cumulatief (§3).
3. **Kosten per tenant** — bij 7 tenants is dat een bruikbaar kental voor de
   prijsstelling naar klanten.
4. **Groeiscenario** — wat verandert er bij 15 en 25 tenants? Welke post loopt
   het eerst tegen een grens aan?

---

## Bijlage — kopieerbare invoer

```
REGIO: eu-west-1 (Ierland)

USE CASE
  tenants           : 7
  interne gebruikers: 35 (5 per tenant) — loggen in
  vendors           : 700 (100 per tenant) — loggen NIET in, tokenlink
  surveyrondes      : 1 per tenant per jaar
  belasting         : lage basislast + piek per ronde

COMPUTE (per omgeving, 3 omgevingen)
  api      : 0,5 vCPU / 1 GB    (gemeten in rust: 41 MB)
  frontend : 0,5 vCPU / 1 GB    (gemeten in rust: 48 MB)
  productie: 730 uur/maand; acceptatie+staging: kantooruren

DATABASE (bij RDS)
  engine    : PostgreSQL 17.6
  klasse    : db.t4g.small of db.t4g.medium
  opslag    : 20 GB gp3 (minimum; groei enkele honderden MB/jaar)
  Multi-AZ  : apart specificeren

S3 — CUMULATIEF, GEEN RETENTIEGRENS
  per ronde : 3,5 GB  (700 vendors × 5 MB)
  na 5 jaar : ~17,5 GB bovengrens / ~1,75 GB bij 0,5 MB gemiddeld
  PUT       : ~700 per ronde
  GET       : laag

ECR
  ~660 MB per versie × aantal bewaarde versies

VERKEER
  uitgaand  : raam 10 / 50 / 100 GB per maand

MAIL (alleen bij SES)
  ~700 berichten per ronde + herinneringen
```
