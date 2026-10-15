# ADR 0001 — Zelfstandige applicatie, geen module in mcm2

**Status:** VERVALLEN — vervangen door `0005-nis2-as-module-on-mcm2.md` (24-08-2026). Bewaard voor de geschiedenis; niet meer van toepassing. De NIS2-tool wordt alsnog een module op hetzelfde platform als mcm2, met gedeeld tenant-/leveranciers-/contactpersoon-/rollenmodel.

**Oorspronkelijke status:** bevestigd — 24-08-2026

## Context

Kees heeft mcm2, een contractmanagementtool met leveranciers/contracten, RLS-gebaseerde tenant-isolatie, sterke authenticatie, en een bestaande jaarlijkse 8-vragen leveranciers-survey (pilotklant Transdev). De vraag was of de NIS2-tool een module binnen mcm2 wordt, of een los product.

## Beslissing

De NIS2-tool wordt een zelfstandige, lichte applicatie. Platformpatronen (RLS, auth, AWS/CI-CD) worden hergebruikt naar het patroon van mcm2; domeindata (leveranciers, beoordelingen) krijgt een eigen model, niet gedeeld met mcm2's contracttabellen. Een optionele integratie (leveranciers importeren, risiconiveau terugschrijven) ontsluit de koppeling met mcm2 voor bestaande klanten, zonder dat die koppeling een vereiste is.

## Reden

Een laagdrempelige, zelfstandige kennismaking (proefperiode, zie ADR 0002) vereist dat een organisatie zonder mcm2 zelf kan starten. Een harde afhankelijkheid van mcm2's contractmodel zou dat blokkeren en de doelgroep onnodig beperken. Het beveiligingsfundament van mcm2 (RLS, auth) is wel waardevol om te hergebruiken — dat opnieuw bouwen zou risico's introduceren zonder voordeel.

## Consequenties

- Blok 1 (leveranciersregister) wordt gebouwd, niet hergebruikt van mcm2 — met een optionele sync-laag later.
- Blok 0 (platformfundament) volgt hetzelfde patroon als mcm2, maar is een eigen implementatie/instantie.
- De mcm2-koppeling is een apart, later te bouwen onderdeel (fase 6), geen randvoorwaarde voor v1.

## Zie ook

`../overview/architecture.md`
