# Blok 9 — Normenkader-configuratie

**Status:** BUITEN SCOPE voor v1 — bewuste, expliciete uitstel-beslissing (los van het proeftijd-besluit, ADR 0002). Inhoudelijk concreter gemaakt op 24-08-2026 door ADR 0003.

## Doel (voor later)

Vragenlijst-templates (categorieën, vragen, weging, bewijsplicht) als data in plaats van vaste structuur. **Sinds ADR 0003 is dit niet langer abstract:** de niveaus worden de bestaande **SC10 · BASIC / SC20 · SUBSTANTIAL / SC30 · HIGH**-tiering van het NIS2 Supply Chain-schema (zie `../overview/nis2-supply-chain-scheme.md`), met de bijbehorende criteria-aantallen (17/29–35/55) en ISO 27002-categorieën. Geen eigen niveaustelsel te ontwerpen — overnemen.

## Waarom nu niet bouwen

Configureerbaarheid is precies het soort diepte die een laagdrempelige eerste versie zwaar zou maken. Eén vast, generiek NIS2/ENISA-basisformulier volstaat om de kernwaarde te bewijzen (zie `business-model.md` (intern document, buiten de publieke repo: OneDrive\MCM2-klantdata\_platform\nis2\) en `../roadmap.md`, fase 5).

**Let op:** dit is een aparte beslissing van het proeftijd-vs-freemium-besluit (ADR 0002) — blok 9 blijft uitgesteld ongeacht proefstatus, in tegenstelling tot blok 4/5/6/10 die nu wél volledig in de proef zitten.

## Wanneer wel bouwen

Fase 5, ná de aantoonlaag (blok 6/8/10). Bouw blok 4/5 in de tussentijd wel zo dat de vraagcodes stabiel blijven — dat voorkomt een pijnlijke migratie zodra blok 9 er komt (zie dwarsverband "vraagcode-stabiliteit" in de artifact/blokkenkaart).

## Kernentiteiten (voor later, niet nu bouwen)

Normenkader, Template, Categorie, Vraagdefinitie, Weging.

## Wettelijke referentie

Art. 21 lid 3 (kwetsbaarheden en kwaliteit per leverancier beoordelen) en art. 21 lid 1 (proportionaliteit) onderbouwen waarom risicogebaseerde, instelbare zwaarte uiteindelijk waardevol is — maar is geen wettelijke eis om dit al in v1 te bouwen.

## Koppeling met stream A (blok 3)

De uiteindelijke bedoeling: het risiconiveau uit blok 3 (BIV-impactbepaling, mogelijk aangevuld met TBB — zie open vraag in `03-impact-biv.md`) bepaalt welk SC-niveau (10/20/30) aan de leverancier wordt voorgelegd in blok 4/5. Dit is exact het proportionaliteitsprincipe uit art. 21 lid 1, nu met een kant-en-klaar, extern herkenbaar tiermodel in plaats van een zelf te verzinnen indeling.

## Actie voor nu

Bij het bouwen van blok 4/5: hardcode één vast template, maar behandel vraagcodes en categorie-structuur als een stabiel contract, alsof er al een simpel versienummer op het normenkader zit.
