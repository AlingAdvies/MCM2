# Blok 11 — Notificaties &amp; taken

**Status:** concept — scope herzien 24-08-2026 (ADR 0005). Geen eigen bouwtaak/motor meer; gebruikt het gedeelde mcm2-notificatiemechanisme rechtstreeks.

## Doel

Herinneringen voor openstaande vragenlijsten, verlopende certificaten en naderende herbeoordelingstermijnen.

## Belangrijke wijziging (ADR 0005, bevestigd — vervangt de ADR 0004-aanpak)

Zoals blok 8: geen eigen motor met "hergebruikt ontwerp" (ADR 0004, vervallen), maar direct gebruik van het gedeelde mcm2-notificatiemechanisme. Dit blok breidt dat mechanisme uit met NIS2-specifieke triggers, in plaats van een parallel notificatiesysteem te bouwen.

## Scope

Samen met blok 8 onderdeel van stap 2a/stap 3 (zie `../roadmap.md`) voor het basismechanisme (herinnering bij uitblijvend antwoord); NIS2-specifieke uitbreidingen (certificaatvervaldatum-herinneringen e.d.) volgen in fase B/C van de blokfasering.

## Kernentiteiten

Taak, Notificatieregel, Kanaal (e-mail/in-app) — bestaande concepten in het gedeelde mechanisme; dit blok voegt NIS2-specifieke regels toe, geen nieuw systeem.

## Triggers

- Statuswijziging in blok 8 (bv. beoordeling blijft lang "uitgezet")
- Vervaldatum bewijsstuk (blok 6)

## Afhankelijkheden

Blok 8. Direct afhankelijk van (niet: geïnspireerd door) het gedeelde mcm2-notificatiemechanisme.

## Wettelijke referentie

Geen directe NIS2-verplichting; operationeel comfort dat de herbeoordelingscyclus ondersteunt.

## Acceptatiecriteria (concept)

- [ ] Een organisatiegebruiker krijgt automatisch een signaal als een uitgezette beoordeling na een instelbare termijn nog geen antwoord heeft.
- [ ] NIS2-specifieke triggers (bewijsstuk-vervaldatum, herbeoordelingstermijn) lopen via hetzelfde notificatiekanaal als de bestaande mcm2-notificaties, niet via een los systeem.
