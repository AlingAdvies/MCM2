# Blok 0 — Platformfundament: tenants, gebruikers &amp; rollen

**Status:** concept — scope herzien 24-08-2026 (ADR 0005). Geen eigen bouwtaak meer; aansluiting op/uitbreiding van het bestaande mcm2-fundament.

## Belangrijke wijziging (ADR 0005, bevestigd)

Dit blok was eerst opgezet als een eigen, lichte tenant-/gebruikers-/rollenlaag, los van mcm2 (ADR 0001, vervallen). Dat is niet langer het uitgangspunt: de NIS2-tool draait op **hetzelfde platform** als mcm2 en gebruikt **hetzelfde** tenant-, gebruikers- en rollenmodel — geen eigen kopie, geen eigen RLS-implementatie ernaast. Dit blok is dus geen "van nul bouwen" meer, maar: (1) het bestaande mcm2-fundament doorlichten/verfijnen (stap 2a, zie `../roadmap.md`) en (2) waar nodig uitbreiden met wat de NIS2-tool specifiek nodig heeft (bv. een rol als "security-officer" naast de bestaande mcm2-rollen, als die er nog niet is).

## Doel

Eén gedeeld tenant-/gebruikers-/rollenfundament dat zowel mcm2 als de NIS2-tool draagt, met RLS-gebaseerde tenant-isolatie en dezelfde auth-aanpak als nu al in mcm2 gebruikt wordt.

## Scope

- **In scope (stap 2a):** het bestaande mcm2-tenant-/gebruikers-/rollenmodel in kaart brengen, en vaststellen wat ontbreekt voor de NIS2-tool (rollen, uitnodigingsflow voor een NIS2-only gebruiker, etc.).
- **Productwerk, niet architectuur (fase D):** hoe een nieuwe klant die alléén de NIS2-tool wil, zich kan aanmelden zonder de indruk te krijgen dat hij "mcm2 aanschaft" — dit is de proefperiode-verpakkingsvraag uit ADR 0005, geen apart datamodel.

## Herkomst

Niet uit de ZCERT-excel — bestaat al grotendeels in mcm2; dit blok documenteert de aansluiting, niet een nieuwbouw.

## Kernentiteiten (gedeeld met mcm2, niet opnieuw gedefinieerd)

- Tenant (organisatie)
- Gebruiker
- Rol (bestaande mcm2-rollen + eventueel aan te vullen met NIS2-specifieke rollen, bv. security-officer, proceseigenaar)
- Uitnodiging

## Business rules

- RLS: elke query/opslag/export blijft gescoped op tenant — ongewijzigd principe, nu toegepast op het gedeelde fundament in plaats van een eigen implementatie.
- Rollen bepalen wie stream A (intern) mag invullen/goedkeuren, en wie beoordelingen (stream B) mag uitzetten — dit zijn mogelijk nieuwe rollen/rechten bovenop het bestaande mcm2-rollenmodel, geen nieuw rollensysteem.

## Workflow / statussen

Geen aparte "NIS2-tenant-onboarding" meer. Onboarding verloopt via hetzelfde platform als mcm2; de open vraag is hoe dat voor een NIS2-only klant productmatig voelt (zie fase D, `../roadmap.md`).

## Afhankelijkheden

Fundament voor alle andere blokken — nu een afhankelijkheid op het bestaande/te verfijnen mcm2-fundament (stap 2a) in plaats van een eigen te bouwen laag.

## Wettelijke referentie

Geen directe NIS2-verplichting; ondersteunend aan alle blokken die art. 21 lid 2 sub d/e invullen.

## Open vraag

Moet "essentiële entiteit" / "belangrijke entiteit" (zie `../overview/legal-context.md`) een profielveld op de tenant worden, om later de verwachte diepte/rigueur te sturen (bv. bij blok 9)? En: bestaat dat veld al ergens in mcm2, of is dit nieuw?

## Acceptatiecriteria (concept — aan te vullen bij functioneel ontwerp)

- [ ] Een NIS2-gebruiker binnen een bestaande mcm2-tenant kan zonder nieuwe tenant/aparte inlog aan de slag.
- [ ] Data van tenant A is nooit zichtbaar of query-baar voor tenant B (geverifieerd met RLS-tests op het gedeelde fundament).
- [ ] Rollen bepalen zichtbaar verschillende rechten in de UI (bv. proceseigenaar kan stream A goedkeuren, gewone gebruiker niet).
- [ ] (Nog te ontwerpen, fase D) Een organisatie die nog geen mcm2-klant is, kan zich toch herkenbaar aanmelden "voor de NIS2-tool".
