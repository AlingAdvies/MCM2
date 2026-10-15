# ADR 0004 — Orchestratie, opvolging en notificaties: eigen, zelfstandige motor met maximaal hergebruik van mcm2

**Status:** VERVALLEN — vervangen door `0005-nis2-as-module-on-mcm2.md` (24-08-2026). Bewaard voor de geschiedenis; niet meer van toepassing. Er komt geen tweede, eigen motor — de NIS2-tool gebruikt het gedeelde mcm2-orchestratie-/notificatiemechanisme rechtstreeks, als onderdeel van hetzelfde platform.

**Oorspronkelijke status:** bevestigd — 24-08-2026

## Context

Kees: "orchestratie en opvolging is onderdeel van mcm2. notificatie ook." De vervolgvraag was of dit betekent dat de NIS2-tool op de dráaiende mcm2-applicatie leunt (runtime-afhankelijkheid), of dat het bewezen mcm2-mechanisme als voorbeeld/bouwstof dient voor een eigen, losse implementatie. Dit raakte direct ADR 0001 (zelfstandige app) en ADR 0002 (proefperiode zonder mcm2 te hoeven kennen).

## Beslissing

**Zelfstandige, eigen motor — met maximaal hergebruik van wat er al is.** De NIS2-tool bouwt haar eigen verstuur-/opvolg-/notificatiemechanisme (blok 8, blok 11), maar niet vanaf nul: het ontwerp, de logica en waar mogelijk de code van het bewezen mcm2-mechanisme (versturen, token-links, statusbewaking, herinneringen) wordt overgenomen/geport als startpunt. Er is geen runtime-aanroep naar een levende mcm2-instantie — een klant van de NIS2-tool heeft nooit een mcm2-account nodig, ook niet onzichtbaar op de achtergrond.

## Reden

Dit behoudt de kern van ADR 0001/0002 (zelfstandig, los verkoopbaar product, proefperiode zonder mcm2) terwijl het de bouwtijd flink verkort: waarom een verstuur-/trackingmechanisme helemaal opnieuw bedenken als er al een werkende, geteste versie bestaat? "Hergebruik" betekent hier dus **overnemen van het ontwerp/de code als eigen kopie**, niet **een blijvende technische afhankelijkheid** van de mcm2-applicatie.

## Consequenties

- Blok 8 en blok 11 zijn weer bouwtaken (niet alleen integratietaken), maar met een concrete referentie-implementatie om vanuit te werken — dat scheelt ontwerptijd en risico t.o.v. blanco beginnen.
- Geen enkele klant van de NIS2-tool — proef of betaald, met of zonder mcm2 — is ooit afhankelijk van of zichtbaar gekoppeld aan een mcm2-instantie voor het versturen/opvolgen van beoordelingen.
- Een latere, aparte, optionele integratie (leveranciers importeren vanuit mcm2, risiconiveau terugschrijven — zie `../overview/architecture.md`) blijft ongewijzigd een eigen, later te bouwen koppeling, los van dit besluit.
- Bij het bouwen van blok 8/11: vraag Kees om toegang tot (of een beschrijving van) het bestaande mcm2-mechanisme, zodat het ontwerp daadwerkelijk hergebruikt kan worden in plaats van blind opnieuw uitgevonden.

## Zie ook

`../blocks/08-workflow.md`, `../blocks/11-notificaties.md`, `0001-standalone-app-vs-mcm2-module.md`, `0002-proeftijd-vs-freemium.md`
