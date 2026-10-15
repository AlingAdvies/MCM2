# Blok 5 — Zelfassessment product-/dienstbeveiliging (stream B)

**Status:** concept — scope bevestigd, herzien 24-08-2026 op basis van ADR 0003. Functioneel ontwerp nog uit te werken.

## Doel

Zelfde mechaniek als blok 4, gericht op het product/de dienst zelf. Dekt art. 21 lid 2 **sub e** (beveiliging bij verwerving, ontwikkeling en onderhoud van systemen).

## Belangrijke wijziging (ADR 0003)

Net als blok 4 wordt dit blok herbouwd op het NIS2 Supply Chain-schema. Waar blok 4 vooral de Organisatorisch/Mensgericht/Fysiek/Technologisch-categorieën dekt, ligt bij blok 5 het zwaartepunt op de **OT-maatregelen** en **IT-maatregelen** (vanaf SC20-niveau): broncodebeheer, veilige softwareontwikkeling, testen, deployment, operationele technologie. Zie `../overview/nis2-supply-chain-scheme.md`.

Criteria/vraagteksten mogen direct worden overgenomen uit de SC10/20/30-normdocumenten (geen IP-restrictie, ADR 0003).

## Scope

Volledige diepte, ook tijdens de proefperiode (ADR 0002). In scope voor fase 3.

## Herkomst

Oorspronkelijk ZCERT-excel, tabblad "Beoordeling Deel B" — nu vervangen door NIS2 Supply Chain-criteria (technologisch/OT/IT-deel).

## Kernentiteiten

Zelfde model als blok 4 (Vragenlijst-template, Categorie, Vraag, Antwoord), andere template-inhoud (Technologisch, OT, IT).

## Business rules

Identieke scoring-engine als blok 4 (comply-or-explain, categorie-scoring) — herbruikbare component.

## Workflow / statussen

Zelfde mechanisme als blok 4 (via mcm2, zie blok 8/ADR 0004), per dienst i.p.v. per leverancier in algemene zin.

## Schermen (indicatief)

Zelfde patroon als blok 4.

## Afhankelijkheden

Blok 1, blok 8, blok 6. Voedt blok 7.

## Wettelijke referentie

NIS2 art. 21 lid 2 sub e.

## Latere uitbreiding

Herbeoordeling koppelen aan certificaatvervaldatum (bv. ISO 27001) — hoort bij blok 8/11, niet bij de eerste bouwfase.

## Acceptatiecriteria (concept)

- [ ] Zelfde criteria als blok 4, toegepast op de Technologisch/OT/IT-template.
- [ ] Categorienamen/vraagteksten komen overeen met de gepubliceerde SC-norm.

## Open actie

Volledige SC10/20-normdocumenten ophalen voor de exacte verdeling van criteria tussen blok 4 en blok 5.
