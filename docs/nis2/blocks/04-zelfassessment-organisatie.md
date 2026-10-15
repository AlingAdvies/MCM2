# Blok 4 — Zelfassessment leverancier: organisatieniveau (stream B)

**Status:** concept — scope bevestigd, herzien 24-08-2026 op basis van ADR 0003 (aansluiting NIS2 Supply Chain). Functioneel ontwerp nog uit te werken.

## Doel

De leverancier beantwoordt vragen over de eigen beveiliging. Dekt art. 21 lid 2 **sub d** (toeleveringsketen-beveiliging) — zie `../overview/legal-context.md`.

## Belangrijke wijziging (ADR 0003)

Dit blok is **niet langer gestructureerd op ZCERT's ENISA-12-groepering**. In plaats daarvan wordt de inhoud herbouwd op basis van het NIS2 Supply Chain-schema (zie `../overview/nis2-supply-chain-scheme.md`):

- **Categorie-taxonomie:** ISO 27002:2022 — Organisatorisch, Mensgericht, Fysiek, Technologisch (+ OT/IT bij hogere niveaus, zie blok 5 voor de productgerichte IT/OT-criteria).
- **Niveaus:** SC10 · BASIC (17 criteria totaal over beide blokken), SC20 · SUBSTANTIAL (29–35), SC30 · HIGH (55) — proportioneel aan het risiconiveau uit stream A (blok 3). De exacte verdeling van criteria tussen blok 4 (organisatieniveau) en blok 5 (productniveau) per SC-tier moet nog worden uitgezocht in de volledige normdocumenten (zie open actie in `nis2-supply-chain-scheme.md`).
- **Inhoud:** criteria/vraagteksten mogen direct worden overgenomen uit de SC10/20/30-normdocumenten — geen IP-restrictie (expliciete uitspraak Kees, zie ADR 0003).
- **Waarom:** de eindgebruiker is geen specialist; dezelfde termen gebruiken als in de daadwerkelijke audit voorkomt verwarring en maakt een ingevulde beoordeling bij ons direct herkenbaar als voorbereiding op een echte SC-certificering.

**Let op:** in v1 nog altijd één vast niveau/template (zie blok 9 — configureerbaarheid/tiering volgt later), maar de categorienamen en waar mogelijk de vraaginhoud sluiten al aan bij SC10 als startpunt.

## Scope

Volledige diepte beschikbaar, ook tijdens de proefperiode (ADR 0002). In scope voor fase 3.

## Herkomst

Oorspronkelijk ZCERT-excel, tabblad "Beoordeling Deel A" — nu vervangen door NIS2 Supply Chain SC10-criteria (organisatorisch/mensgericht/fysiek/technologisch-deel).

## Kernentiteiten

- Vragenlijst-template (in v1 vast — inhoud SC10-niveau)
- Categorie (Organisatorisch, Mensgericht, Fysiek, Technologisch)
- Vraag (met stabiele vraagcode — overweeg de SC-nummering, bv. "1.2", "2.6", over te nemen voor herkenbaarheid)
- Antwoord (ja/nee, toelichting, n.v.t.-vlag)

## Business rules

- Scoring per categorie (comply-or-explain-mechaniek uit de ZCERT-brondata blijft functioneel bruikbaar, ook met nieuwe inhoud).
- Comply-or-explain: bij "nee" is een toelichting verplicht.
- N.v.t.-vlag sluit een vraag uit van de score.

## Workflow / statussen

Beoordeling wordt aangemaakt en uitgezet naar de leverancier via het mcm2-orchestratiemechanisme (zie blok 8, ADR 0004) — geen leveranciersaccount, tussentijds opslaan mogelijk.

## Schermen (indicatief)

- Externe invulweergave voor de leverancier (per categorie, met voortgang)
- Interne reviewweergave voor de organisatie

## Afhankelijkheden

Blok 1 (leverancier moet bestaan), blok 8 (uitzetmechanisme, via mcm2), blok 6 (bewijsstukken bij een antwoord). Voedt blok 7.

## Wettelijke referentie

NIS2 art. 21 lid 2 sub d + lid 3.

## Herbruikbare component

Scoring-engine (comply-or-explain, categorie-scoring) is functioneel identiek aan blok 5 — bouw als gedeelde service.

## Acceptatiecriteria (concept)

- [ ] Leverancier kan de vragenlijst in meerdere sessies invullen zonder account (token-based, met tussentijds opslaan).
- [ ] Een "nee"-antwoord zonder toelichting kan niet worden opgeslagen als definitief ingediend.
- [ ] Categorienamen en (waar mogelijk) vraagteksten komen overeen met de gepubliceerde SC10-norm — geen zelfbedachte alternatieve bewoording.
- [ ] Score per categorie is direct herleidbaar naar de onderliggende antwoorden.

## Open actie

Volledige (niet-verkorte) SC10-normdocument ophalen en de exacte vraagteksten/criteria per categorie overnemen voordat dit blok in detail wordt gebouwd.
