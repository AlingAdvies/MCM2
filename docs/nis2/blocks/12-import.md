# Blok 12 — Import vanuit bestaande ZCERT-excels

**Status:** concept — later in de bouwvolgorde (fase 6), nog niet in detail besproken

## Doel

Onboarding-versneller: tenants die al met de ZCERT-excel werken (gangbaar in de zorg) kunnen een ingevuld bestand importeren in plaats van opnieuw te beginnen.

## Herkomst

Direct afgeleid van het brondocument van dit project (`ZCERT_Leverancierbeoordeling.xlsx`).

## Scope

Parser voor het ZCERT-format als eerste ondersteunde bron. Mapping van excel-cellen naar de vaste v1-template (blok 4/5) — let op: blok 9 (configureerbaar normenkader) bestaat nog niet in v1, dus de mapping moet naar het hardgecodeerde template.

## Schermen (indicatief)

Upload → validatie → correctiestap vóór definitieve import.

## Afhankelijkheden

Blok 1, 2, 3, 4, 5 (importeert in al deze modellen tegelijk).

## Wettelijke referentie

Geen directe NIS2-verplichting; operationeel.

## Acceptatiecriteria

Nog niet uitgewerkt — volgt bij het functioneel ontwerp van fase 6.
