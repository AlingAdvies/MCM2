# Blok 2 — Intake &amp; dienstclassificatie (stream A)

**Status:** concept — scope bevestigd, functioneel ontwerp nog uit te werken

## Doel

Beschrijving van het in te kopen product/dienst: gebruiksdoel, wie het gebruikt, wat de dienst met gegevens doet, welk type en volume gegevens, waar verwerkt, en de afhankelijkheid van de organisatie. Interne vragenlijst — stream A, geen externe (leverancier-)toegang nodig.

## Scope

In scope voor de eerste bouwfase (fase 3).

## Herkomst

ZCERT-excel, tabblad "Algemeen — intake", deel 2 (door de organisatie zelf ingevuld).

## Kernentiteiten

- Dienstprofiel (gebruiksdoel: primair/ondersteunend proces; wie gebruikt; wat doet de dienst met gegevens)
- Verwerkingslocatie (eigen locatie / eigen + leverancier / leverancier / onderaannemer van leverancier)
- Gegevenstype (financieel, persoonsgegevens, inloggegevens, gezondheidsgegevens, gepseudonimiseerd, anders)

## Business rules

Gewogen scoring per subvraag (overgenomen uit de ZCERT-brondata: gebruik, gegevenstype, volume, locatie, afhankelijkheid tellen elk mee met een eigen gewicht) — te herbouwen als herbruikbare rule-set, gedeeld met blok 3/4/5 (zie "Scoring-engine" als dwarsverband in de blokkenkaart-artifact).

## Workflow / statussen

Door de organisatie zelf ingevuld, vóór blok 3 (impactbepaling). Zie open vraag in `../roadmap.md` over volgorde t.o.v. stream B.

## Schermen (indicatief)

Gestructureerd formulier per dienst (geen vrije excel-cellen).

## Afhankelijkheden

Blok 1 (dienst moet bestaan). Voedt blok 3 en blok 7.

## Wettelijke referentie

Onderdeel van de risicoanalyse die aan art. 21 lid 2 sub d voorafgaat (bepalen hoe kritiek een leverancier/dienst is, voordat de leverancier zelf beoordeeld wordt).

## Acceptatiecriteria (concept)

- [ ] Scoring per subvraag is traceerbaar naar een individueel antwoord (niet alleen een eindscore).
- [ ] Formulier is per dienst herhaalbaar (één leverancier, meerdere diensten, elk met eigen classificatie).
