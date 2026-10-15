# Blok 10 — Rapportage &amp; audit trail (NIS2-aantoonplicht)

**Status:** concept — scope bevestigd (nu vroeg in de bouwvolgorde, zie ADR 0002), functioneel ontwerp nog uit te werken

## Doel

NIS2 vereist dat een organisatie kán aantonen dat de leveranciersketen zorgvuldig wordt beheerd (art. 21 lid 2 sub d, gecombineerd met de zorgplicht uit lid 1). Historie, wijzigingen en beslissingen vastleggen als auditspoor, exporteerbaar voor een toezichthouder — dit is het exportmoment dat centraal staat in het verdienmodel (zie `business-model.md` (intern document, buiten de publieke repo: OneDrive\MCM2-klantdata\_platform\nis2\)).

## Herkomst

Niet expliciet in de ZCERT-excel (die toont alleen een momentopname) — nieuw, noodzakelijk zodra er meerdere leveranciers, tenants en beoordelingsrondes zijn.

## Kernentiteiten

- Auditlog (wie deed wat, wanneer)
- Beoordelingshistorie (versies van een beoordeling over tijd)
- Beslissingsvastlegging (wie heeft een beoordeling vastgesteld/goedgekeurd)

## Business rules

- Onveranderlijkheid: een vastgestelde beoordeling (blok 3/4/5) is niet meer te wijzigen zonder een nieuwe versie/ronde te starten — de historie blijft staan.
- Elke wijziging is toe te schrijven aan een gebruiker en tijdstip.

## Schermen (indicatief)

Compliance-rapport per tenant/leverancier, exporteerbaar (PDF of vergelijkbaar) — dit is het "meeneembare bewijsstuk" richting toezichthouder of accountant.

## Afhankelijkheden

Blok 3, 4, 5 (wat wordt vastgelegd), blok 6 (bewijsstukken worden meegenomen in het rapport), blok 7 (scores/risicomatrix in het rapport).

## Wettelijke referentie

Direct: art. 21 lid 2 sub d/e als de aangetoonde grondslag. Vermeld dit expliciet in het gegenereerde rapport (zie `../overview/legal-context.md`, terminologie-aanbevelingen).

## Acceptatiecriteria (concept)

- [ ] Een export bevat: leveranciersgegevens, classificatie/BIV-uitkomst, self-assessment-scores, gekoppelde bewijsstukken, en wie/wanneer heeft vastgesteld.
- [ ] Een eerder vastgestelde beoordeling kan niet stilzwijgend wijzigen — elke wijziging resulteert in een nieuwe, traceerbare versie.
