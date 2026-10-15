# ADR 0003 — Actieve aansluiting bij het NIS2 Supply Chain-certificeringsschema

**Status:** bevestigd — 24-08-2026

## Context

Onderzoek naar https://nis2supplychain.eu/ (zie `../overview/nis2-supply-chain-scheme.md`) bracht een bestaand, breed gedragen mkb-certificeringsschema aan het licht (SC10/SC20/SC30, ISO 27002-taxonomie, TBB-impactmodel), inclusief een eigen auditpartnernetwerk en governance (Stichting Kwaliteitsinnovatie). Eerste reactie was dit als mogelijke concurrent te behandelen; bij nader inzien is het complementair: het schema zelf beschrijft "auditvoorbereiding" als aparte stap zonder een goede tool daarvoor te bieden.

## Beslissing

De tool positioneert zich expliciet als **de uitvoerings-/voorbereidingstool voor dit schema** — "de tool waarmee het gedaan wordt" — niet als concurrerend keurmerk. Concreet:

1. Blok 4 (zelfassessment organisatieniveau) en blok 5 (productbeveiliging) worden herstructureerd op de **ISO 27002:2022-taxonomie** (Organisatorisch, Mensgericht, Fysiek, Technologisch, + OT/IT bij hogere niveaus) in plaats van ZCERT's ENISA-12-groepering.
2. Blok 9 (normenkader, uitgesteld tot na v1) wordt concreet ingevuld met de **SC10/SC20/SC30-tiering** in plaats van een abstract, zelf te ontwerpen niveaustelsel.
3. **Inhoudelijk hergebruik van de criteria/normdocumenten is toegestaan zonder IP-restrictie** — expliciete uitspraak van Kees, 24-08-2026. Dit is een beslissing van de opdrachtgever, geen door mij geverifieerde juridische inschatting.
4. Te Beschermen Belangen (TBB) als mogelijke aanvulling op het BIV-model in blok 3 — **nog niet besloten**, zie open vraag in `../blocks/03-impact-biv.md`.

## Reden

De eindgebruiker is expliciet **geen specialist** (zie ook ADR 0004 / persona-aantekening). Een eigen terminologie hanteren die afwijkt van de daadwerkelijke certificeringseisen waar de organisatie ooit tegenaan loopt, veroorzaakt verwarring op precies het moment dat duidelijkheid het meest telt. Aansluiten bij een reeds breed gedragen, herkenbare standaard is ook een sterkere marktpositie dan een eigen normenkader introduceren.

## Consequenties

- Blok 4/5-documenten worden herzien (categorieën, mogelijk directe overname van SC10/20/30-criteria als inhoud).
- Blok 9 krijgt een concreet ontwerp (SC-tiers) in plaats van "later te bedenken".
- Een zakelijk vervolgtraject (toenadering tot Stichting Kwaliteitsinnovatie, mogelijke erkenning/partnerschap) is de moeite van het onderzoeken waard, maar staat los van en blokkeert niet de bouw.

## Zie ook

`../overview/nis2-supply-chain-scheme.md`, `../blocks/04-zelfassessment-organisatie.md`, `../blocks/05-zelfassessment-product.md`, `../blocks/09-normenkader.md`
