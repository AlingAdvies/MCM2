# Blok 3 — Impact-/BIV-bepaling (stream A)

**Status:** concept — scope bevestigd, functioneel ontwerp nog uit te werken

## Doel

Business impact-analyse langs drie assen — Beschikbaarheid, Integriteit, Vertrouwelijkheid — die samen met blok 2 bepaalt hoe kritiek deze leverancier/dienst voor de eigen organisatie is. Kern van stream A.

## Scope

In scope voor de eerste bouwfase (fase 3).

## Herkomst

ZCERT-excel, tabblad "Impact bepaling". 8 vragen per as (B/I/V), antwoord laag/midden/hoog.

## Kernentiteiten

- Impactbeoordeling
- BIV-score (apart voor Beschikbaarheid, Integriteit, Vertrouwelijkheid)
- Niveau (laag/midden/hoog) per as

## Business rules

- Gemiddelde score per as bepaalt het niveau; drempelwaarden overnemen uit de ZCERT-brondata (laag &lt;1, midden &lt;3, hoog ≤4 — te herverifiëren bij uitwerking, en mogelijk later configureerbaar via blok 9).
- Proportionaliteit: dit blok is de basis voor een risicogebaseerde, evenredige aanpak (zie `../overview/legal-context.md`, art. 21 lid 1).

## Workflow / statussen

Ingevuld door proceseigenaar/security-officer, intern. Overweeg een goedkeuringsstap (vier-ogen) analoog aan de ZCERT-toelichting ("impactbeoordeling moet worden uitgevoerd én goedgekeurd").

## Schermen (indicatief)

Vragenformulier per as, met resultaatweergave (niveau-indicatie).

## Afhankelijkheden

Blok 2 (dienst moet geclassificeerd zijn). Voedt blok 7 (risicomatrix) rechtstreeks.

## Wettelijke referentie

Onderbouwt de risicogebaseerde/evenredige aanpak uit art. 21 lid 1, en levert de "belang"-as van de risicomatrix die art. 21 lid 2 sub d impliciet vereist (kwetsbaarheden per leverancier ín context beoordelen, niet generiek).

## Open vraag (nieuw, 24-08-2026, zie ADR 0003)

Het NIS2 Supply Chain-schema hanteert een rijkere impact-taxonomie: Te Beschermen Belangen (TBB), twaalf categorieën (financieel, juridisch, operationeel, veiligheid, reputatie, personeel, strategisch, klanten, innovatie, omgeving, leveranciers/partners, gegevensbescherming) — zie `../overview/nis2-supply-chain-scheme.md`. Nog niet besloten: vervangt TBB het BIV-model hier, vult het aan, of blijven ze naast elkaar bestaan? Dit raakt direct de scoringregels hierboven en moet beslist zijn vóór het functioneel ontwerp van dit blok wordt afgerond.

## Acceptatiecriteria (concept)

- [ ] Elk van de drie assen (B/I/V) heeft een eigen, zichtbare score en niveau.
- [ ] Resultaat is direct herleidbaar naar de 8 onderliggende antwoorden per as.
