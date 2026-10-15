# Blok 7 — Scoring, risico &amp; dashboards

**Status:** concept — scope bevestigd, functioneel ontwerp nog uit te werken

## Doel

De plek waar stream A (belang, blok 2/3) en stream B (volwassenheid, blok 4/5) samenkomen in een risicomatrix. Dit is het "aha"-moment van het product.

## Herkomst

ZCERT-excel, tabblad "Uitkomst": vier grafieken — belang/risico-matrix, BIV-betrouwbaarheidsniveau, cybervolwassenheidsradar (deel A), productbeveiligingsradar (deel B).

## Kernentiteiten

Scoresnapshot per beoordeling (vastgelegd resultaat op het moment van vaststellen, niet alleen live herberekend — belangrijk voor blok 10/audit trail).

## Business rules

Rekenmodel overnemen uit de ZCERT-brondata (gewogen sommen/gemiddelden per categorie) als herbruikbare scoring-service, gedeeld met blok 2/3/4/5.

## Schermen (indicatief)

- Risicomatrix per leverancier/dienst
- Eenvoudig overzicht (eerste bouwfase)
- Later: tenant-brede portfolio-dashboard (aggregatie over alle leveranciers), PDF-export voor auditors (fase 5)

## Afhankelijkheden

Blok 2, 3, 4, 5 (voedende data). Blok 10 (audit trail/export bouwt hierop voort).

## Wettelijke referentie

Levert het aantoonbare overzicht dat een organisatie nodig heeft om te laten zien dat de toeleveringsketen risicogebaseerd wordt beheerd (art. 21 lid 2 sub d, in combinatie met de zorgplicht uit lid 1).

## Acceptatiecriteria (concept)

- [ ] Risicomatrix combineert altijd een blok 3-score (belang) met een blok 4/5-score (volwassenheid) — nooit los gepresenteerd als het "risico".
- [ ] Een score is een vastgelegd snapshot bij vaststelling, niet alleen een live-berekening die met terugwerkende kracht kan veranderen.
