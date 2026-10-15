# NIS2-tool (werktitel)

Module voor leveranciersbeoordeling/toeleveringsketen-beveiliging onder NIS2/de Cyberbeveiligingswet, gebouwd **op hetzelfde platform als mcm2** (Kees' bestaande contractmanagementtool, pilotklant Transdev) — niet als aparte app (zie ADR 0005, 24-08-2026). Gebaseerd op de ZCERT-vragenlijst "Leverancierbeoordeling" (zorgsector) qua proces, inhoudelijk herbouwd op het NIS2 Supply Chain-certificeringsschema (ADR 0003). Tenant-, leveranciers-, contactpersoon-, rollen- en orchestratie/notificatiedata zijn **gedeeld** met mcm2 — geen eigen kopie. Alleen de leveranciersbeoordelingen zelf (classificatie, BIV, self-assessment, scores) zijn NIS2-specifiek.

Dit bestand is het oriëntatiepunt. Lees de gelinkte documenten in `/docs` voordat je aan een blok begint — begin niet te bouwen op basis van aannames die hier niet staan.

## Snelle oriëntatie

- **Architectuur:** [`docs/overview/architecture.md`](docs/overview/architecture.md) — module op hetzelfde platform als mcm2, gedeeld tenant-/leveranciers-/rollen-/orchestratiemodel (ADR 0005).
- **Verdienmodel:** `business-model.md` (intern document, buiten de publieke repo: OneDrive\MCM2-klantdata\_platform\nis2\) — proeftijd van 30 dagen met volledige functiediepte, begrensd door aantal leveranciers (geen permanente freemium-gating).
- **Wettelijk kader:** [`docs/overview/legal-context.md`](docs/overview/legal-context.md) — Cyberbeveiligingswet/NIS2, art. 21 lid 2, mapping naar de functieblokken.
- **NIS2 Supply Chain-schema:** [`docs/overview/nis2-supply-chain-scheme.md`](docs/overview/nis2-supply-chain-scheme.md) — het bestaande, breed gedragen mkb-certificeringsschema (SC10/20/30) waar de tool zich actief op afstemt. De tool is de uitvoerings-/voorbereidingsmotor daarvoor, geen concurrerend keurmerk.
- **Marktsignalen (input, geen besluit):** `marktsignalen-ncsc-2026-10.md` (intern document, buiten de publieke repo: OneDrive\MCM2-klantdata\_platform\nis2\) — wat NCSC-mail laat zien over vragen uit de markt, met feature-hypothesen en marketingthema's (14-10-2026).
- **Gebruikersontwerp (voorstel):** [`docs/overview/gebruikersontwerp-nis2.md`](docs/overview/gebruikersontwerp-nis2.md) — actoren, kernreizen, schermen, inlog en rechten.
- **Concepttemplate SC10:** `sc10-basic-concept-v0.json` (buiten de repo, zie [`templates/README.md`](templates/README.md)) — 17 maatregelen in eigen woorden, geldig tegen het mcm2-importschema; niet voor productie vóór afstemming over auteursrecht (ADR 0006).
- **Terminologie:** [`docs/overview/glossary.md`](docs/overview/glossary.md) — vaste NL/EN-namen, gebruik deze consequent in code, UI en documentatie. Categorieën in blok 4/5 volgen de ISO 27002-taxonomie, niet ENISA-12.
- **Fasering:** [`docs/roadmap.md`](docs/roadmap.md).
- **Besluiten:** [`docs/decisions/`](docs/decisions/) — ADR's; wijzig een bestaand besluit niet stilzwijgend, voeg een nieuwe ADR toe als iets herzien wordt.
- **Functieblokken:** [`docs/blocks/`](docs/blocks/) — één bestand per blok (00–12), elk met doel, scope, entiteiten, business rules, workflow, afhankelijkheden en wettelijke referentie.

## Status van dit document

Dit scaffold is opgezet op basis van fase 1 (analyse + architectuurrichting + wettelijk kader + aansluiting NIS2 Supply Chain-schema). De meeste blok-documenten staan op **concept**: scope en kernbeslissingen liggen vast, het volledige functioneel ontwerp (schermen, use cases, acceptatiecriteria) moet nog per blok worden uitgewerkt voordat er gebouwd wordt. Blok 9 is expliciet **buiten scope voor v1/de proefperiode**.

**Architectuur (ADR 0005, bevestigd — vervangt eerdere ADR 0001/0004):** de NIS2-tool is een module op hetzelfde platform als mcm2. Blok 0/1/8/11 zijn geen zelfstandige bouwtaken meer, maar aansluiting op/uitbreiding van het gedeelde tenant-/leveranciers-/contactpersoon-/rollen-/orchestratiemodel. Zie `docs/roadmap.md` voor de directe uitvoeringsvolgorde (Transdev-survey nu → gedeeld fundament verfijnen (stap 2a) → NIS2-module bouwen (stap 3)).

## Werkwijze voor een nieuwe sessie

1. Lees dit bestand en het relevante blok-document in `docs/blocks/` volledig voordat je code schrijft.
2. Ga niet uit van context uit een eerder gesprek — alles wat relevant is, staat in `/docs`. Ontbreekt iets, vraag het na of leg een aanname expliciet vast in het blok-document.
3. Wijk je af van een vastgelegd besluit (`docs/decisions/`) of scope-afspraak, leg dat dan vast als nieuwe ADR of expliciete aantekening — overschrijf niet stilzwijgend.
4. Werk de status-regel bovenaan een blok-document bij zodra de status wijzigt (concept → functioneel ontwerp klaar → in bouw → klaar).

## Tech-stack

Nog te bevestigen. Uitgangspunt: zoveel mogelijk aansluiten bij mcm2's bestaande AWS/DevOps-omgeving (zelfde taal/framework, zelfde IaC-patronen, zelfde auth-/RLS-aanpak) — zie `docs/overview/architecture.md`. Vul dit blok aan zodra de concrete keuzes zijn gemaakt.
