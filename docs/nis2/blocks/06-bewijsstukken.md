# Blok 6 — Bewijsstukkenbeheer (evidence)

**Status:** concept — scope bevestigd (nu vroeg in de bouwvolgorde, zie ADR 0002), functioneel ontwerp nog uit te werken

## Doel

Bijlagen bij een antwoord (blok 4/5), gekoppeld aan de vraagcode, met versiebeheer. Dit is een van de kernonderdelen die het verschil met een eigen excel voelbaar maakt (zie `business-model.md` (intern document, buiten de publieke repo: OneDrive\MCM2-klantdata\_platform\nis2\)) — hoort dus bij fase 4, vroeg in de bouwvolgorde, niet als afterthought.

## Herkomst

ZCERT-excel, tabblad "Bijlagen" (instructies + ruimte per vraagcode).

## Kernentiteiten

- Bewijsstuk
- Versie
- Koppeling aan vraag/antwoord (via vraagcode)

## Business rules

- Verplicht/optioneel per vraag (instelbaar per vraagdefinitie).
- Bewaartermijn.
- Toegestane bestandstypen.

## Schermen (indicatief)

Upload inline bij de betreffende vraag (blok 4/5-scherm), reviewer-weergave voor de organisatie.

## Opslag

Object storage (AWS S3-achtig patroon, zie `../overview/architecture.md`), encryptie, toegangsbeleid gescoped op tenant.

## Afhankelijkheden

Blok 4, 5 (waar bewijs aan gekoppeld wordt), blok 10 (audit trail verwijst naar bewijsstukken).

## Wettelijke referentie

Ondersteunt de aantoonplicht van art. 21 lid 2 sub d/e — bewijs is wat het verschil maakt tussen "beweren" en "aantonen".

## Acceptatiecriteria (concept)

- [ ] Een bewijsstuk is altijd traceerbaar naar de specifieke vraag/antwoord waar het bij hoort.
- [ ] Een nieuwe versie van een bewijsstuk overschrijft de oude niet, maar wordt toegevoegd (versiehistorie).
