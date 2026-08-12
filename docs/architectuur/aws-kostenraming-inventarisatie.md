# AWS-kostenraming — wat je nodig hebt om te ramen

**Type:** inventarisatie ter voorbereiding op een cost estimate
**Eigenaar:** Kees Aling
**Laatste update:** 2026-08-12
**Status:** er is **geen AWS-account**; dit is een raming vooraf, geen migratieplan

> Alle getallen met ✅ zijn **gemeten** op 2026-08-12, niet geschat. Getallen met
> ⚠️ zijn aannames die je moet toetsen voordat je erop begroot.

---

## 1. Wat er verhuist — en wat niet

Dit is de kern van de raming, en het scheelt veel geld: **het grootste deel
staat al buiten saxombp.**

| Onderdeel | Waar het nu draait | Verhuist mee? | Kostengevolg |
|---|---|---|---|
| Databases (staging, productie) | **Supabase**, AWS eu-west-1 | Alleen als je wilt | Blijft gelijk, of RDS erbij |
| Bouwstraat (CI/CD) | GitHub Actions | Nee | € 0 extra |
| Images | GitHub Container Registry | Optioneel naar ECR | € 0 of paar € |
| Identiteit / inloggen | Microsoft Entra External ID | Nee | € 0 extra |
| **Applicaties (api + frontend)** | **saxombp** | **Ja — dit is de verhuizing** | Hoofdpost |
| Acceptatiedatabase | container op saxombp | Ja, of blijft lokaal | Klein |
| Backups | geplande taak op de laptop → OneDrive | Te heroverwegen | Klein |

**Alleen de rekenlaag verhuist echt.** Dat is de belangrijkste boodschap voor
je raming: je begroot geen volledige migratie maar het draaien van twee
containers.

---

## 2. Gemeten cijfers — de invoer voor je raming

### Wat de applicatie werkelijk verbruikt

| Meting | Waarde | Waarom het telt |
|---|---|---|
| Geheugen api ✅ | **41 MB** | Bepaalt de instantiegrootte |
| Geheugen frontend ✅ | **48 MB** | Idem |
| Image api ✅ | **316 MB** | Opslag + transfer bij elke uitrol |
| Belasting saxombp ✅ | **load 0,06** | De machine verveelt zich |
| Productiedatabase ✅ | **14 MB** | RDS-opslag, mocht je migreren |
| Maximale uploadgrootte ✅ | **5 MB per bestand** | S3-volume (zie Issue #46) |

**De conclusie die hieruit volgt:** dit is een zeer kleine applicatie. Samen
gebruiken beide containers **~90 MB geheugen**. Elke instantie met 512 MB is
ruim voldoende; begroot niet op "standaard 2 GB" want dat is een factor 20
overschat.

### Wat je nog moet meten voordat je begroot

| Onbekend | Waarom het de kosten bepaalt | Hoe je het krijgt |
|---|---|---|
| Aantal gebruikers ⚠️ | Bepaalt verkeer en instantiegrootte | Nu: 1 tenant (AlingAdvies) + pilot Transdev |
| Aantal leveranciers per ronde ⚠️ | Piekbelasting bij het versturen | Vorige tenant had er 21 |
| Uitgaand dataverkeer ⚠️ | **De verborgen post bij AWS** | Meet een maand op saxombp |
| Uploadvolume per jaar ⚠️ | S3-opslag | 5 MB × aantal leveranciers × rondes |
| Gewenste beschikbaarheid ⚠️ | Bepaalt of je dubbel uitvoert | Zie §5 |

---

## 2b. Drie diensten die NIET bij AWS zitten

Belangrijk voor de raming: deze drie kosten geld, maar staan **niet** in de
AWS-calculator. Vergeet ze niet in je totaalplaatje.

| Dienst | Wat het doet | Verhuist naar AWS? |
|---|---|---|
| **Microsoft Entra External ID** | Inloggen van interne gebruikers | **Nee** — blijft bij Microsoft |
| **Resend** | Uitnodigings- en notificatiemail versturen | **Nee** — of eventueel naar SES |
| **Supabase** | De databases (staan al in AWS eu-west-1) | Alleen als je dat wilt |

**Entra** kost per maandelijks actieve gebruiker, met een gratis marge. Blijft
klein: leveranciers die een vragenlijst invullen **loggen niet in** — die
krijgen een link met een token. Alleen interne gebruikers tellen mee. Bij een
verhuizing verandert er één ding: het terugkeeradres na inloggen. Eén regel in
de Entra-portal. ADR-016 legt vast dat de identiteitsleverancier inwisselbaar
moet zijn.

**Resend** is het huidige mailkanaal (`src/mail/resend-mail-kanaal.ts`), achter
één interface `MailKanaal` met twee implementaties. Overstappen naar Amazon SES
kan, maar is bij dit volume **niet aan te raden**: SES vraagt een
sandbox-ontheffing en domeinverificatie, en het prijsverschil is bij een
handvol leveranciers per ronde verwaarloosbaar. Houd Resend.

> **Wat geen AWS-post is maar wel werk:** e-mail *bezorgen* is niet het
> probleem, e-mail *aankomen* wel. SPF, DKIM, bounces, reputatie. Dat speelt
> bij elke leverancier.

---

## 2c. Notificaties — een nieuwe eis, en de grootste post

*Toegevoegd 2026-08-12 op aangeven van de eigenaar. Staat nog niet in het
OTAP-plan of in een issue.*

**Wat het moet doen:** gebruikers binnen een tenant waarschuwen over dingen die
blijven liggen. Bijvoorbeeld *"Siemens is al 3 weken te laat met antwoorden"*
of *"de beoordeling van deze survey staat al 12 dagen open"*.

### De harde eis: per tenant, en nooit bij een andere tenant

Dat is geen wens maar een beveiligingseis, en hij bepaalt de architectuur.

**Waarom notificaties daarom BINNEN de app horen.** Tenant-isolatie wordt hier
afgedwongen door de database (RLS), niet door code die je kunt vergeten. De
applicatierol heeft bewust géén `BYPASSRLS` (ADR-008, aantoonbaar geverifieerd).
Zou je het bepalen én bewaren van notificaties uitbesteden aan een externe
dienst, dan ligt de scheiding tussen tenants **buiten je database** — bij een
leverancier, afgedwongen door hún code. Dan is de grendel weg die er juist is
omdat je niet wilt vertrouwen op "de code doet het goed".

Bovendien is de *inhoud* klantgegeven: "Siemens is 3 weken te laat" verklapt wie
de leveranciers van een tenant zijn en hoe ze presteren. Dat naar een derde
sturen is een verwerkersovereenkomst en ISO27001-materiaal.

### De scheiding die wél werkt

| Deel | Waar | Waarom |
|---|---|---|
| **Bepalen** wat er speelt | **In de app** | Vraagt tenantcontext en kennis van het model |
| **Bewaren** van de notificatie | **In de app**, tabel met `tenant_id` + RLS | Zelfde grendel als leveranciers en antwoorden |
| **Tonen** in het scherm | In de app | Komt uit de eigen database |
| **Bezorgen** per e-mail | **Buiten** (Resend) | Krijgt alleen een adres en een tekst — weet niet wat een tenant is |

Zo blijft de tenantgrens waar hij hoort, terwijl het generieke verzendwerk
uitbesteed blijft.

### De data is er al ✅

Gemeten 2026-08-12 — beide voorbeelden zijn uit te rekenen met bestaande velden:

- *"te laat met antwoorden"* → `clm.survey_response.expires_at` versus
  `submitted_at` (leeg = niet ingestuurd)
- *"beoordeling staat open"* → `submitted_at` gevuld, maar geen rij in
  `clm.survey_review`

> **Nagekeken:** ADR-008 noemt een oud `notification`-schema uit de Prisma-tijd.
> Dat bestaat **niet meer** — gemeten, 0 tabellen, het schema is weg. Er ligt
> dus geen bruikbaar ontwerp; dit begint schoon.

### Wat het betekent voor de raming

| Soort kosten | Omvang |
|---|---|
| **AWS** | Klein: iets dat dagelijks afgaat om te kijken wie te laat is. Paar euro per maand. |
| **Externe dienst** | Geen extra — Resend heb je al. Een notificatiedienst valt af voor het bepalen. |
| **Ontwikkelwerk** | **De grootste post.** Tabel + RLS-policies, de regels wanneer iets "te laat" is, een scherm, en voorkeuren per gebruiker. |

**Dit hoort in je raming als bouwwerk, niet als hostingpost.**

### Wat dit blootlegt aan bestaand gebrek

De app verstuurt mail nu **tijdens** het verzoek: je klikt op "verstuur
uitnodigingen" en wacht tot alles weg is. Bij 21 leveranciers gaat dat; bij 200
loopt het vast en weet niemand wat er wel en niet verstuurd is. Notificaties
vragen bovendien iets dat afgaat **als er niemand op een knop drukt** — en dat
bestaat vandaag niet.

Er komt dus waarschijnlijk een wachtrij bij. Bij dit volume goedkoop, maar het
staat nu nergens in het plan.

---

## 3. De drie AWS-vormen — kies er één om te ramen

Ramen kan pas als je weet wélke vorm. Dit zijn de drie realistische, van
goedkoop naar robuust.

### Vorm A — App Runner (eenvoudigst)

Je geeft AWS een container-image; zij draaien het, schalen het en regelen het
TLS-certificaat.

- **Voor:** geen netwerk of servers inrichten. Het certificaat waar we op
  vastliepen is hier een invulveld.
- **Tegen:** minder controle, schaalt niet naar nul (je betaalt door)
- **Ramen op:** 2 diensten (api + frontend) × geheugen/CPU-uren

### Vorm B — ECS Fargate (het middenpad)

Containers zonder servers te beheren, maar met een eigen netwerk en
loadbalancer.

- **Voor:** de gangbare vorm voor dit soort applicaties; goed te automatiseren
- **Tegen:** een loadbalancer kost een vast bedrag per maand, ongeacht gebruik.
  **Dat is bij lage volumes vaak de grootste post.**
- **Ramen op:** taken × geheugen/CPU + loadbalancer + NAT Gateway

> ⚠️ **Let op de NAT Gateway.** Die staat in bijna elke standaardopzet en kost
> tientallen euro's per maand plus verkeer, ook als er niets gebeurt. Voor een
> kleine applicatie is dit vaak duurder dan alle compute samen. Vraag hier
> expliciet naar in je raming.

### Vorm C — EC2 (het dichtst bij nu)

Eén virtuele machine, Docker erop, precies zoals saxombp nu.

- **Voor:** goedkoopst, en de overstap is het kleinst — het draait al zo
- **Tegen:** je beheert zelf updates, certificaten en herstel. Dat is
  handwerk, en het doel is juist automatisering.
- **Ramen op:** 1 kleine instantie + opslag + IP

---

## 4. Postenlijst voor de raming

Neem deze lijst mee naar de calculator. **Per omgeving** die je bij AWS wilt
draaien — nu zijn dat er drie (acceptatie, staging, productie), en dat mag je
terugbrengen.

| # | Post | Nodig? | Opmerking |
|---|---|---|---|
| 1 | Compute (App Runner / Fargate / EC2) | **Ja** | ~90 MB geheugen totaal gemeten |
| 2 | Loadbalancer | Bij vorm B | Vast bedrag per maand |
| 3 | **NAT Gateway** | Bij vorm B | ⚠️ Vaak de grootste verrassing |
| 4 | Uitgaand dataverkeer | **Ja** | ⚠️ Moeilijk te ramen zonder meting |
| 5 | S3 voor uploads | **Ja** | Lost Issue #46 op — zie §6 |
| 6 | Database (RDS) | Alleen bij verhuizen van Supabase | 14 MB nu |
| 7 | Certificaat (ACM) | Ja | **Gratis** bij AWS |
| 8 | DNS (Route 53) | Optioneel | Kan ook bij mijndomein blijven |
| 9 | Secrets Manager | Ja | Voor wachtwoorden en sleutels |
| 10 | Logging (CloudWatch) | Ja | Betaal per GB — zet retentie kort |
| 11 | Backup | Ja | Nu op een laptop; hoort naar AWS |
| 12 | Container registry (ECR) | Optioneel | GHCR werkt ook |

### Wat je nu al gratis krijgt en straks betaalt

Let op deze omslag in je raming:

- Supabase gratis → RDS kost geld (of je blijft bij Supabase)
- GHCR gratis → ECR kost per GB (of je blijft bij GHCR)
- Backup op OneDrive → S3 + retentie
- Tailscale gratis → loadbalancer of publiek adres

---

## 5. Vragen die de raming bepalen

Zonder antwoord hierop wordt een raming een slag in de lucht.

**1. Hoeveel omgevingen bij AWS?**
Drie (zoals nu) is drie keer de kosten. Overweeg: productie bij AWS,
acceptatie blijft op saxombp. Dat halveert de raming en past bij het doel —
saxombp is dan de oefenplek.

**2. Blijft de database bij Supabase?**
Die staat al bij AWS in Ierland en werkt. Meeverhuizen naar RDS kost geld en
werk; het levert alleen iets op als je alles bij één leverancier wilt.

**3. Moet het buiten kantoortijd blijven draaien?**
Een demo-omgeving die 's nachts uit staat, kost tot 70% minder. Dat is een
reële optie voor acceptatie en staging.

**4. Wat is de gewenste beschikbaarheid?**
Nu: één machine, geen reserve. Vraag je bij AWS om dubbele uitvoering, dan
verdubbelt de compute. **Voor een pilot met één klant is dat vaak niet nodig
— maar het is een bewuste keuze, geen detail.**

**5. Hoeveel dataverkeer?**
De onbekende post. Meet het een maand op saxombp voordat je begroot.

---

## 6. Wat er eerst moet gebeuren — ongeacht de kosten

Drie dingen die de migratie blokkeren of vereenvoudigen.

### Issue #46 — uploads (deadline ~1 september)

Bestanden staan nu op de schijf van een container en verdwijnen bij elke nieuwe
versie. **Dit is het enige stuk state dat aan saxombp vastzit** — zolang dat zo
is, is de rekenlaag niet zomaar te verplaatsen.

Bij AWS hoort dit op S3. Het is dus geen losse bugfix maar **de laatste schakel
in het AWS-verhaal**, en het heeft een harde datum.

### Een eigen adres

`clm.alingadvies.nl` is aangemaakt maar wijst nu naar een privé-adres. Bij AWS
wordt dit eenvoudig: het certificaat is een invulveld in plaats van een dag
werk met vernieuwing elke 90 dagen. Dit is een reden om niet eerst op saxombp
te investeren.

### Secrets

Wachtwoorden en sleutels staan nu in `.env`-bestanden op de server. Bij AWS
horen die in Secrets Manager. Kleine post, maar hij hoort in de raming.

---

## 7. Wat een raming NIET moet vergeten

| Post | Waarom hij vergeten wordt |
|---|---|
| **Inrichtingskosten** | Eenmalig werk: netwerk, IAM, pipelines omzetten. Geen AWS-factuur, wel kosten. |
| **Leerkosten** | Er is geen AWS-kennis in huis; de mensen die die hadden zijn vertrokken. |
| **Dubbel draaien** | Tijdens de overgang draaien saxombp én AWS. Reken op een maand overlap. |
| **Bewaking** | Bestaat nu niet. Bij een klantomgeving hoort het erbij. |
| **Vrije laag eerste jaar** | AWS geeft nieuwe accounts korting. **Reken daar niet op voor jaar 2.** |

---

## 8. Aanbeveling voor de raming zelf

Maak **drie scenario's** in plaats van één bedrag:

| Scenario | Wat erin zit | Waarvoor |
|---|---|---|
| **Minimaal** | Alleen productie bij AWS, database blijft Supabase, acceptatie op saxombp | Ondergrens |
| **Realistisch** | Productie + staging bij AWS, S3 voor uploads, bewaking | De vermoedelijke werkelijkheid |
| **Volledig** | Drie omgevingen, RDS, dubbele uitvoering, volledige bewaking | Bovengrens bij groei |

Het verschil tussen minimaal en volledig is bij dit soort applicaties makkelijk
een factor vijf. Eén bedrag noemen suggereert een zekerheid die er niet is.

### Scheid hostingkosten van bouwkosten

De grootste post in dit hele verhaal is **geen AWS-factuur**. Zet ze apart,
anders verdwijnt het echte werk achter een klein maandbedrag:

| | Wat erin zit |
|---|---|
| **Terugkerend (AWS + diensten)** | Compute, verkeer, opslag, S3, plus Entra en Resend |
| **Eenmalig (bouwen)** | Notificaties (§2c), Issue #46 uploads naar S3, inrichting, pipelines omzetten |
| **Eenmalig (leren)** | Er is geen AWS-kennis in huis |

Bij een applicatie van deze omvang — 90 MB geheugen, 14 MB database — is de
hosting bijna altijd de kleinste van de drie.

---

## Bijlage — wat je in de calculator invult

Voor **AWS Pricing Calculator**, regio **eu-west-1 (Ierland)** — dezelfde regio
waar je databases al staan:

```
Compute per omgeving:
  api        : 0,25 vCPU / 512 MB   (gemeten: 41 MB)
  frontend   : 0,25 vCPU / 512 MB   (gemeten: 48 MB)
  draaitijd  : 730 uur/maand (of minder bij nachtelijk uitzetten)

Opslag:
  images     : ~320 MB per versie
  uploads    : 5 MB × leveranciers × rondes per jaar
  database   : 20 GB minimum bij RDS (nu 14 MB in gebruik)

Verkeer:
  uitgaand   : ⚠️ ONBEKEND — meet dit eerst
```

**Waarschuwing bij het invullen:** de calculator kiest standaard ruime
instanties en zet een NAT Gateway in de opzet. Controleer beide — daar zit bij
kleine applicaties het grootste verschil tussen een reële en een opgeblazen
raming.
