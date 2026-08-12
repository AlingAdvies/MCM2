# DevOps-handleiding — wat jij doet

**Type:** D — routineoperaties
**Eigenaar:** de eigenaar (Chris)
**Laatste update:** 2026-08-12
**Vereiste toegang:** GitHub (AlingAdvies/MCM2), Supabase, Telegram op je telefoon

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
run staat stil tot jij drukt.

**Wat jij doet:**

1. Open de link in de e-mail (of ga naar de repo → tabblad **Actions**)
2. Bovenaan staat een gele balk → klik **Review deployments**
3. Vink **productie** aan
4. Klik **Approve and deploy**

**Waar je op let vóór je drukt:** in de logs van de stap ervóór staat een blok
dat eindigt met `DOOR — de drie automatische remmen geven groen licht`. Staat
daar `GEBLOKKEERD`, dan is de knop er niet eens — dan hoef je niets te doen.

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

### Naar productie — daar komt jouw akkoord bij

🤖 **Vraag Claude:** *"ik wil versie X naar productie"*

Wat er dan gebeurt, in volgorde:

| | Wie | Wat |
|---|---|---|
| 1 | 🤖 CLAUDE | controleert of de backup vers genoeg is, en commit het bewijs |
| 2 | 🤖 CLAUDE | start de workflow op GitHub |
| 3 | ⚙️ VANZELF | de poort draait: backup, staging, productiestand |
| 4 | 🧑 **JIJ** | **akkoord geven** — zie moment 2 hierboven |
| 5 | ⚙️ VANZELF | de poort draait nog eens, dan de migraties |
| 6 | 🤖 CLAUDE | start de applicatie met het commando uit de samenvatting |

**Stap 4 is het enige moment waarop het op jou wacht.** Alles daarvoor en
daarna loopt door.

### Wat je nooit hoeft te onthouden

De versienummers. Die staan altijd in de samenvatting van de vorige stap, en
Claude leest ze daar op. Vraag ernaar in plaats van ze over te typen — ze zijn
twaalf tekens lang en één cijfer verkeerd betekent "image niet gevonden".

---

## 3. "Er is iets stuk, ik wil terug"

🤖 **Vraag Claude:** *"draai de laatste uitrol terug"*

Claude weet welke versie er daarvóór draaide — dat staat in de logs van de
vorige uitrol — en zet die terug.

🧑 **Wat jij moet weten:** terugdraaien zet de **applicatie** terug, niet de
**database**. Zijn er bij die uitrol kolommen verwijderd, dan is terugzetten van
de backup de weg. Claude zegt het als dat aan de orde is; je hoeft het niet zelf
te beoordelen.

**Hoe snel:** een rollback duurt ongeveer een minuut. Hij is op 11 augustus
beproefd op acceptatie, heen en terug.

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
| elke week | staging wakker houden | 🤖 vraag Claude: *"houd staging wakker"* |
| elke maand | herstelproef met echte controle | 🤖 vraag Claude erom |
| elke maand, en na elke uitrol naar productie | de omgevingen naast elkaar leggen | 🤖 vraag Claude: *"lopen de omgevingen gelijk?"* |
| elk kwartaal | terugdraaien beproeven | 🤖 vraag Claude erom |

> **Waarom staging wakker houden?** Een gratis Supabase-project pauzeert na
> zeven dagen zonder activiteit. Gebeurt dat, dan faalt de eerstvolgende uitrol
> met een verbindingsfout die naar de verkeerde oorzaak wijst.

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

> **Over die Tailscale-link.** De toegang tot saxombp verloopt periodiek; dat is
> een beveiliging van Tailscale zelf, geen storing. Claude kan hem niet voor je
> aanklikken — het is juist de bedoeling dat een mens dat doet. Zolang je niet
> bevestigt, blijft elke poging om bij de server te komen wachten.
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

### Er zijn vier omgevingen

| | Waarvoor | Wie komt eraan |
|---|---|---|
| **lokaal** | ontwikkelen | Claude, op je laptop |
| **acceptatie** | uitproberen, zelf inloggen | jij, via `saxombp:3010` |
| **staging** | repetitie vóór productie | niemand — dit is een generale |
| **productie** | echte klanten | de klant |

> **Tot 12 augustus heetten er twee dingen "productie".** De echte database bij
> Supabase, én een lege database op saxombp waar de applicatie tegenaan praatte.
> Dat is opgeheven: er is er nu één. Als je ergens nog leest over "de
> productiecontainer op poort 55470" — die bestaat niet meer.

**Waarom staging bestaat:** productie draait bij Amazon in Ierland, achter een
verbindingslaag die zich anders gedraagt dan een database op je eigen machine.
Staging draait op precies diezelfde opzet. Een migratie die dáár slaagt, slaagt
in productie — dat is het hele punt.

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
