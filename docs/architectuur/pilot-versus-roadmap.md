# Pilot versus roadmap

> Vastgelegd 2026-08-23, naar aanleiding van een vraag van de eigenaar bij
> het lezen van `docs/architectuur/gap-analyse-mvm2-v2.md`: hoe verhoudt
> die roadmap zich tot een korte-termijn pilot van de vragenlijst-flow op
> een aantal Transdev-leveranciers?

## Waarom dit een apart document is, geen sectie in de roadmap

De gap-analyse toetst op één vraag: **is dit uiteindelijk de juiste
richting voor het product?** De pilot toetst op een andere vraag:
**overleeft dit het eerste echte contact met een paar Transdev-mensen en
hun leveranciers, zonder gênant te zijn of vast te lopen?**

Die twee toetsen geven regelmatig een tegenovergesteld antwoord op
dezelfde vraag "moet dit nu gebouwd worden?":

- **Contract 360** (roadmap-prioriteit 2, zie de gap-analyse) is voor de
  pilot niet nodig — de pilot draait om de vragenlijst-flow naar de
  leverancier, niet om hoe rijk een contractscherm is voor de interne
  beheerder.
- Omgekeerd staat er in eerdere, allang gesloten issues (#8 token-
  mechanisme, #9 certificaat-upload, #43 portal-rendering-bug) precies het
  soort werk dat wél "voor de pilot" was en niets met de MVM_V2-gap-
  analyse te maken heeft.

Dit patroon bestond al vóór deze sessie: het label `priority:before-pilot`
("Aantoonbaar nodig voor de Transdev-survey-slice") staat al op issue #58
(back-up onafhankelijk van de ontwikkellaptop). Dit document maakt dat
onderscheid alleen expliciet en herhaalbaar, in plaats van het aan
losse labels over te laten.

## De pilot: wat er op het spel staat

Dit is de **eerste keer dat de app door anderen gezien wordt**: een paar
Transdev-medewerkers (intern, als beheerder/beoordelaar) en de
leveranciers die de vragenlijst ontvangen (extern, geen account, via
token). Twee verschillende doelgroepen, twee verschillende soorten risico:

- **Transdev-medewerkers** zien het beheerscherm. Een ruwe rand hier is
  vervelend maar herstelbaar — het zijn mensen die weten dat het een
  vroege versie is.
- **Leveranciers** zien alleen het vragenlijst-portaal via een tokenlink.
  Zij weten niet dat het een pilot is. Een fout hier (een link die niet
  werkt, een formulier dat data verliest, een afzender die onbetrouwbaar
  oogt) is geen bug-report — het is een eerste indruk van Transdev als
  opdrachtgever, niet alleen van de tool.

Dat asymmetrische risico bepaalt de prioriteit: **de leveranciers-kant
van de flow (het portaal, het token, het formulier, de afzender) weegt
zwaarder dan de interne beheerkant**, ook al is de interne kant waar de
meeste roadmap-aandacht naartoe gaat.

## Wat de pilot nodig heeft — een voorlopige lijst

Dit is geen uitputtende lijst maar een eerste aanzet, bedoeld om samen
met de eigenaar aan te vullen in een apart issue (zie onderaan). Puur wat
al zichtbaar is vanuit bestaande, deels al open issues:

| Onderwerp | Status | Issue |
|---|---|---|
| Backup onafhankelijk van de ontwikkellaptop | Open, al pilot-gelabeld | #58 |
| Vragenlijst toont geen contact-/afzenderinfo voor de leverancier | Open | #153 |
| Uitnodigingen versturen — handpicked en in bulk | Open | #77 |
| E-mailinstellingen (SMTP) per tenant | Open | #76 |
| Backup/restore-test daadwerkelijk uitgevoerd | Open | #19 |
| Logging/monitoring-basislaag vóór de pilot | Open | #17 |
| Resterende open Transdev-klantvragen (OV-4, OV-6 t/m OV-9) | Open | #15 |

Wat nog **niet** als issue bestaat en wel relevant lijkt voor de pilot,
puur op basis van "wat ziet een leverancier voor het eerst":
- Foutafhandeling in het portaal: wat ziet een leverancier als een token
  verlopen is, een upload mislukt, of het formulier al is ingediend?
  (Vergelijkbaar met de al gesloten #42/#43, maar dan als bewuste
  eindtoets in plaats van losse bugfixes.)
- Of de afzender/het e-mailadres van de uitnodiging er voor een externe
  ontvanger professioneel en herkenbaar uitziet (raakt #153 en #76).

## Hoe dit issue-technisch te structureren

**Voorstel:** één nieuw issue, `priority:before-pilot`-gelabeld, met deze
lijst als startpunt — geen losse issues per punt totdat de scope met de
eigenaar is vastgesteld. De bestaande #58/#153/#77/#76/#19/#17/#15 blijven
zelfstandige issues (ze bestonden al), maar krijgen (voor zover nog niet
gebeurd) het `priority:before-pilot`-label zodat ze in GitHub's filter samen
opduiken als "wat moet er vóór de pilot staan", los van de roadmap-issues
uit de gap-analyse.

**Wat dit niet is:** dit document beslist niet welke van bovenstaande
punten daadwerkelijk vóór de pilot moeten — dat is aan de eigenaar. Het
legt vast waarom de twee lijsten (roadmap, pilot) een aparte toets
verdienen, en geeft een startpunt zodat de eigenaar niet bij nul begint.
