# DevOps-handleiding — wat jij doet

**Type:** D — routineoperaties
**Eigenaar:** de eigenaar (Chris)
**Laatste update:** 2026-08-27
**Vereiste toegang:** GitHub (AlingAdvies/MCM2), AWS-console (account
AlingAdvies, 727732213368), Telegram op je telefoon

> **Sinds 2026-08-19 draait productie op AWS (ECS Express Mode), niet meer
> op `saxombp`.** Acceptatie en staging blijven ongewijzigd op `saxombp`.
> Deze handleiding is bijgewerkt naar de nieuwe situatie — waar iets over
> `saxombp` gaat, staat dat er nu expliciet bij.

---

## Hoe dit werkt

Je typt zelf geen commando's. **Je vraagt ze aan Claude in de chat**, en die voert
ze uit. Wat jij doet is: opdracht geven, knoppen indrukken die alleen jij mag
indrukken, en reageren op meldingen.

Deze handleiding is daarom geordend naar **jouw handelingen**. Elk hoofdstuk
begint met wat er van jou wordt verwacht. De uitleg erachter is achtergrond —
sla die gerust over.

| Symbool | Betekent |
|---|---|
| 🧑 **JIJ** | jouw vingers, jouw beslissing |
| 🤖 **CLAUDE** | vraag je in de chat |
| ⚙️ **VANZELF** | gebeurt zonder dat iemand iets doet |

**De enige dingen die Claude niet voor je kan doen:**

1. Een akkoord geven op GitHub voor een uitrol naar productie
2. Iets aanklikken in de Supabase-console
3. Docker Desktop starten op je laptop
4. Beslissen dát er iets naar productie gaat

Al het andere — testen, branches, commits, uitrollen, terugdraaien, status
opvragen — vraag je aan Claude.

---

## 1. De drie momenten waarop jij iets MOET doen

Dit is het belangrijkste hoofdstuk. De rest is naslag.

### Moment 1 — Telegram meldt een probleem met de backup

**Je krijgt een bericht op je telefoon.** Zes soorten, en ze vragen niet
allemaal hetzelfde:

| Bericht begint met | Wat het betekent | Wat jij doet |
|---|---|---|
| *"Docker draait niet…"* | Docker Desktop staat uit. De backup van vanochtend is waarschijnlijk óók mislukt | **Start Docker Desktop.** Vraag daarna aan Claude: *"haal de gemiste backup in"* |
| *"De nieuwste dump is … oud"* | De geplande taak heeft stilgelegen | Zelfde als hierboven: Docker starten, Claude vragen in te halen |
| *"De inhoudsopgave … is niet leesbaar"* | De dump is beschadigd | Vraag Claude: *"de backup is beschadigd, zoek uit wat er mis is"* |
| *"… mist tabellen"* | De dump is incompleet — **dit is ernstig** | Vraag Claude er meteen naar. Dit is precies wat op 4 augustus misging |
| *"de verwachtingslijst is verouderd"* | Er is een tabel bijgekomen die de controle nog niet kent | Vraag Claude: *"werk de backup-verwachtingslijst bij"* |
| *"herstelproef mislukt"* | De dump is er wel, maar er komt niets uit | Vraag Claude er meteen naar |

> **Krijg je een week lang niets?** Dat is óók een signaal. Er hoort elke week
> een levensteken te komen (een bericht met ✅). Blijft dat uit, dan is de
> melder zelf stuk, of staat je laptop uit. Vraag Claude om het te controleren.

### Moment 2 — GitHub vraagt je akkoord voor productie

**Je krijgt een e-mail van GitHub** met "Deployment review requested", en de
run staat stil tot jij drukt. Dit gebeurt zowel bij een uitrol naar
AWS-productie (workflow `productie-aws.yml`) als, voor acceptatie/staging op
`saxombp`, bij de oudere workflow `productie.yml`.

**Wat jij doet:**

1. Open de link in de e-mail (of ga naar de repo → tabblad **Actions**)
2. Bovenaan staat een gele balk → klik **Review deployments**
3. Vink **productie** aan
4. Klik **Approve and deploy**

**Waar je op let vóór je drukt:** in de logs van de stap ervóór staat een blok
dat eindigt met `DOOR — de drie automatische remmen geven groen licht`. Staat
daar `GEBLOKKEERD`, dan is de knop er niet eens — dan hoef je niets te doen.

**Voor AWS-productie duurt het na jouw akkoord langer dan je gewend bent van
vroeger** — reken op zo'n 35-40 minuten voordat de run helemaal groen is. Dat
komt doordat de workflow nu ook echt de nieuwe versie naar AWS uitrolt en
wacht tot die daar aantoonbaar gezond draait, in plaats van te stoppen na de
migraties. Je hoeft niet te wachten of iets te doen — de run loopt vanzelf
door.

### Moment 3 — Je wilt zelf iets uitgerold hebben

Dat begint altijd bij jou, want niemand anders beslist dat. Zie hoofdstuk 2.

---

## 2. "Ik wil dat een wijziging live gaat"

### Naar acceptatie of staging — dat is één opdracht

🤖 **Vraag Claude:** *"rol dit uit naar staging"*

Claude doet dan alles: testen draaien, een branch maken, een pull request
openen, wachten tot de controles groen zijn, mergen, en de applicatie starten.

🧑 **Jouw enige moment:** Claude vraagt je of de pull request gemerged mag
worden. Dat is een vraag in de chat, geen knop op GitHub.

> **Sinds 2026-08-27: "zet deze versie in productie" impliceert deze stap.**
> Op 26-08 ging dit een keer mis: de productie-uitrol werd gestart zonder dat
> staging eerst met dezelfde code was bijgewerkt en bewezen. Zichtbaar gevolg:
> de eigenaar zag in productie een oud scherm, terwijl de onderliggende
> oorzaak (een mislukte GHCR-publicatie door opmaakfouten in de frontend) op
> staging al zichtbaar had kunnen zijn vóórdat productie geraakt werd. Vanaf nu
> geldt: **wanneer de eigenaar zegt "in productie krijgen" of vergelijkbaar,
> doorloopt Claude eerst deze stap (staging bijwerken en de rookproef
> bekijken) — zonder daar apart naar te hoeven vragen — en gaat pas daarna
> naar de productie-stap hieronder.** Vraagt de eigenaar met zoveel woorden om
> alléén staging, dan stopt het daar, zoals dit hoofdstuk al beschreef.

### Naar productie (AWS) — daar komt jouw akkoord bij

🤖 **Vraag Claude:** *"ik wil versie X naar productie"*

Wat er dan gebeurt, in volgorde:

| | Wie | Wat |
|---|---|---|
| 0 | 🤖 CLAUDE | rolt eerst uit naar staging (zie hierboven) en bevestigt dat de rookproef daar slaagt |
| 1 | 🤖 CLAUDE | controleert of de backup vers genoeg is, en commit het bewijs |
| 2 | 🤖 CLAUDE | start de workflow `productie-aws.yml` op GitHub |
| 3 | ⚙️ VANZELF | de poort draait: backup- en migratiestand worden gecontroleerd (géén staging-uitrol — zie stap 0) |
| 4 | 🧑 **JIJ** | **akkoord geven** — zie moment 2 hierboven |
| 5 | ⚙️ VANZELF | de poort draait nog eens, dan de migraties |
| 6 | ⚙️ VANZELF | AWS rolt de nieuwe versie uit — eerst de API, dan de website — en wacht tot beide aantoonbaar gezond zijn |

**Stap 4 is het enige moment waarop het op jou wacht.** Alles daarvoor en
daarna loopt vanzelf door, inclusief het daadwerkelijk starten van de nieuwe
versie — dat hoef je (anders dan vroeger bij `saxombp`) niet meer apart aan
Claude te vragen.

### Naar acceptatie/staging (saxombp) — het starten blijft handwerk

Voor acceptatie en staging draait de applicatie nog op `saxombp`, niet op
AWS. Daar geldt onveranderd: na het mergen start de container niet vanzelf.

🤖 **Vraag Claude:** *"start [acceptatie/staging] op met versie X"* — dat is
het commando uit de samenvatting van de vorige stap.

### Wat je nooit hoeft te onthouden

De versienummers. Die staan altijd in de samenvatting van de vorige stap, en
Claude leest ze daar op. Vraag ernaar in plaats van ze over te typen — ze zijn
twaalf tekens lang en één cijfer verkeerd betekent "image niet gevonden".

---

## 3. "Er is iets stuk, ik wil terug"

🤖 **Vraag Claude:** *"draai de laatste uitrol terug"*

Claude weet welke versie er daarvóór draaide — dat staat in de samenvatting
van de vorige uitrol — en zet die terug.

**Voor AWS-productie is een rollback gewoon dezelfde workflow opnieuw**, met
de vorige versienummers ingevuld. Er is geen apart terugdraai-commando. Dat
betekent ook: **jouw akkoord (moment 2) is bij een rollback opnieuw nodig** —
bewust, want een rollback is ook een uitrol en verdient dezelfde rem.

🧑 **Wat jij moet weten:** terugdraaien zet de **applicatie** terug, niet de
**database**. Zijn er bij die uitrol kolommen verwijderd, dan is terugzetten van
de backup de weg. Claude zegt het als dat aan de orde is; je hoeft het niet zelf
te beoordelen.

**Hoe snel:** op `saxombp` (acceptatie/staging) duurt een rollback ongeveer een
minuut. Op AWS-productie duurt het net zo lang als een gewone uitrol
(35-40 minuten), omdat het dezelfde volledige workflow is.

---

## 4. "Ik wil weten hoe het ervoor staat"

🤖 **Vraag Claude één van deze dingen:**

| Je vraag | Wat je terugkrijgt |
|---|---|
| *"wat draait er waar?"* | per omgeving de versie, én of de applicatie antwoordt |
| *"is de backup in orde?"* | wanneer de laatste was, en of alles erin zit |
| *"kan er naar productie?"* | of de vier remmen groen staan |
| *"lopen de omgevingen gelijk?"* | acceptatie, staging en productie naast elkaar — en waar ze afwijken |
| *"waar staan we?"* | de stand van het project, uit `docs/STATUS.md` |

Er is niets dat je zelf moet opzoeken. Als Claude iets niet weet, gaat hij het
meten in plaats van het te gokken.

---

## 5. Wat er vanzelf gebeurt — en waar jij op let

### Elke dag

| Tijd | ⚙️ Wat er draait | 🧑 Jouw rol |
|---|---|---|
| 07:00 | backup van de productiedatabase | niets |
| 07:30 | controle: is de dump er, en zit alles erin? | **het Telegram-bericht lezen** |
| maandag 07:45 | zware controle: dump echt terugzetten in een testdatabase | idem |

### Bij elke wijziging die gemerged wordt

| ⚙️ Wat er draait | 🧑 Jouw rol |
|---|---|
| tests, opmaakcontrole, productiebuild | niets |
| image publiceren naar het register | niets |
| migraties naar staging + teruglezen | niets |

**De enige storing die je zelf moet oplossen: Docker Desktop staat uit.** Dan
falen alle drie de dagelijkse taken. Je merkt het aan het Telegram-bericht.

### Wat jij periodiek doet

| Wanneer | Wat | Hoe |
|---|---|---|
| elke week | kijken of het levensteken kwam | je telefoon |
| elke week | staging én productie wakker houden | 🤖 vraag Claude: *"houd staging en productie wakker"* |
| elke maand | herstelproef met echte controle | 🤖 vraag Claude erom |
| elke maand, en na elke uitrol naar productie | de omgevingen naast elkaar leggen | 🤖 vraag Claude: *"lopen de omgevingen gelijk?"* |
| elk kwartaal | terugdraaien beproeven | 🤖 vraag Claude erom |

> **Waarom wakker houden?** Beide Supabase-projecten (staging én productie)
> draaien op het gratis plan en pauzeren na zeven dagen zonder activiteit.
> Gebeurt dat, dan faalt de eerstvolgende uitrol — of erger, dan pauzeert de
> database waar klanten/demo tegenaan praten — met een verbindingsfout die
> naar de verkeerde oorzaak wijst. Voor productie is dit risico groter dan
> vroeger: die wordt nu ook voor demo gebruikt (zie `CLAUDE.md` §0).

> **Waarom de omgevingen naast elkaar leggen?** De drie omgevingen horen
> dezelfde vorm te hebben: dezelfde tabellen, dezelfde beveiliging, dezelfde
> stand. Loopt er één uit de pas, dan merk je dat normaal gesproken pas als er
> iets stukgaat — en dan op het slechtst denkbare moment.
>
> Op 4 augustus miste de productiedatabase negen van de achttien tabellen. Dat
> stond er maanden, en niemand wist het, omdat elke backup er vers uitzag. Deze
> controle zou dat op dag één gemeld hebben.
>
> **Let op:** hiervoor moet Tailscale aanstaan, want één van de drie databases
> staat achter de server thuis. Claude zegt het als hij er niet bij kan.

---

## 6. Beslissingen die alleen jij kunt nemen

Claude vraagt het je; dit is waar het over gaat.

| Vraag | Waarom jij |
|---|---|
| "Mag deze pull request gemerged worden?" | het is jouw product |
| "Zal ik dit naar productie brengen?" | er staan klantgegevens op het spel |
| "Deze branch is klaar — mergen of parkeren?" | een geparkeerde branch is prima, een vergeten branch niet |
| "Dit is onomkeerbaar. Doorgaan?" | verwijderen, force-pushen, een database leegmaken |
| "Ik zie een probleem dat je niet vroeg. Oppakken?" | jij bepaalt de volgorde |

**Bij twijfel: vraag om de gevolgen.** *"Wat gebeurt er als dit fout gaat?"* is
altijd een goede vraag, en het antwoord hoort concreet te zijn.

---

## 7. Als er iets misgaat

Je hoeft geen foutmeldingen te ontleden. **Kopieer wat je ziet en plak het in de
chat.** Dat is sneller en betrouwbaarder dan zelf zoeken.

Drie dingen die je wel zelf moet doen:

| Situatie | 🧑 Wat jij doet |
|---|---|
| Telegram meldt dat Docker uit staat | Docker Desktop starten, daarna Claude vragen de backup in te halen |
| Er komt al een week geen enkel bericht | Claude vragen te controleren of de melder nog werkt |
| Claude meldt *"Tailscale SSH requires an additional check"* met een login-link | **Open die link en bevestig.** Eén klik |

> **Over die Tailscale-link.** Dit speelt alleen bij **acceptatie en staging**
> (die draaien nog op `saxombp`) — nooit bij productie, want die staat op AWS
> en is via de gewone AWS-console/API bereikbaar. De toegang tot saxombp
> verloopt periodiek; dat is een beveiliging van Tailscale zelf, geen storing.
> Claude kan hem niet voor je aanklikken — het is juist de bedoeling dat een
> mens dat doet. Zolang je niet bevestigt, blijft elke poging om bij de server
> te komen wachten.
>
> Waargenomen op 2026-08-11: `npm run deploy:status` hing zonder foutmelding,
> en de reden bleek pas zichtbaar bij een handmatige SSH-poging.

**Wat je nooit hoeft te doen:** een commando verzinnen, een versienummer
overtypen, of zelf bedenken welke database ergens bij hoort. Vraag het.

---

## 8. Wat er nooit mag gebeuren

Dit staat hier niet omdat jij het zou doen, maar zodat je het herkent als Claude
het voorstelt — dan is er iets mis.

| Nooit | Waarom |
|---|---|
| Het bestand `.env` in GitHub | daar staan alle wachtwoorden in |
| Rechtstreeks werken op `main` | elke wijziging hoort via een pull request |
| Controles overslaan bij een commit | dan werken de beveiligingen niet die je beschermen |
| Force-pushen naar `main` | onherstelbaar, voor iedereen |
| De demo-database wissen | poort 55450. Dat gebeurde op 7 augustus |
| Een uitrol zonder verse backup | daar zit sinds 11 augustus een rem op |

---

## 9. Achtergrond — alleen als je wilt weten waarom

### Er zijn vier omgevingen, en ze draaien niet allemaal op dezelfde plek

| | Waarvoor | Draait op | Wie komt eraan |
|---|---|---|---|
| **lokaal** | ontwikkelen | jouw laptop | Claude, op je laptop |
| **acceptatie** | uitproberen, zelf inloggen | `saxombp` (thuisserver) | jij, via `saxombp:3010` |
| **staging** | repetitie vóór productie | `saxombp` (thuisserver) | niemand — dit is een generale |
| **productie** | echte klanten + demo | **AWS** (ECS Express Mode, Ierland), `clm.alingadvies.nl` | de klant, en jij voor demo |

> **Sinds 19 augustus draait productie niet meer op `saxombp`.** De
> applicatie (`mcm2-api` + `mcm2-frontend`) draait sinds die dag op Amazon
> Web Services. De productiedatabase zelf stond al bij Supabase en is niet
> verhuisd — alleen de server die ertegenaan praat, is nu bij Amazon in
> plaats van bij jou thuis. Acceptatie en staging zijn ongewijzigd op
> `saxombp` blijven staan.
>
> **Tot 12 augustus heetten er twee dingen "productie".** De echte database bij
> Supabase, én een lege database op saxombp waar de applicatie tegenaan praatte.
> Dat is opgeheven: er is er nu één. Als je ergens nog leest over "de
> productiecontainer op poort 55470" — die bestaat niet meer.

**Waarom staging bestaat:** productie draait bij Amazon in Ierland, achter een
verbindingslaag die zich anders gedraagt dan een database op je eigen machine.
Staging draait op `saxombp` op een vergelijkbare opzet — geen exacte kopie meer
van de omgeving, maar wel van de database en de migraties. Een migratie die
op staging slaagt, slaagt op productie — dat blijft het hele punt.

### Waarom er remmen op productie zitten

Drie keer ging er iets mis doordat een commando op de verkeerde database
uitkwam: op 4, 7 en 10 augustus. De oorzaak was steeds hetzelfde — de laptop
wees standaard naar de echte klantendatabase.

Sinds 11 augustus wijst hij naar staging. En vóór een uitrol naar productie
staan vier remmen:

1. is er een verse, gecontroleerde backup?
2. is deze versie op staging beproefd?
3. loopt productie niet vóór op wat we uitrollen?
4. **heb jij akkoord gegeven?**

De eerste drie kan een computer vaststellen. De vierde bewust niet.

### Waarom "het is gelukt" niet genoeg is

Dit project heeft drie keer een geruststellende melding gehad over iets dat niet
gebeurd was. *"Migraties voltooid"* terwijl er niets gebeurde. *"Backup
compleet"* terwijl de helft ontbrak. *"Mail verstuurd"* terwijl er geen mail was.

Daarom leest alles wat nu draait het resultaat terug uit de database in plaats
van de melding te geloven. Merk je dat Claude iets meldt zonder het te hebben
gecontroleerd, dan mag je daarnaar vragen.

---

## 10. Waar de rest staat

Deze handleiding gaat over wat jij doet. De techniek erachter staat elders:

| Zoek je | Kijk in |
|---|---|
| welke commando's er bestaan en wat ze raken | [`commandos-en-omgeving.md`](commandos-en-omgeving.md) |
| de uitrolprocedure in detail | [`uitrol-acceptatie-en-productie.md`](uitrol-acceptatie-en-productie.md) |
| hoe de backups werken | [`backupcontrole.md`](backupcontrole.md) |
| wat er wanneer terugkeert | [`onderhoudskalender.md`](onderhoudskalender.md) |
| waar het project staat | [`../STATUS.md`](../STATUS.md) |
| waarom de straat zo is opgezet | [`../architectuur/plan-otap-straat-met-staging.md`](../architectuur/plan-otap-straat-met-staging.md) |

**Alle runbooks:** [`README.md`](README.md)
