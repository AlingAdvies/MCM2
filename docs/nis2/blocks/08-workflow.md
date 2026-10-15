# Blok 8 — Workflow &amp; samenwerking

**Status:** concept — scope herzien 24-08-2026 (ADR 0005). Geen eigen bouwtaak/motor meer; gebruikt het gedeelde mcm2-orchestratiemechanisme rechtstreeks.

## Doel

Het mechanisme om een beoordeling (stream B) uit te zetten naar een leverancier, op te volgen, en te herbeoordelen.

## Belangrijke wijziging (ADR 0005, bevestigd — vervangt de ADR 0004-aanpak)

Eerder (ADR 0004, vervallen) was het plan: een eigen, zelfstandige motor bouwen, met het ontwerp van mcm2's bestaande mechanisme als voorbeeld/startpunt — maar wel een eigen implementatie, zonder runtime-afhankelijkheid. Dat is nu achterhaald: er is nog maar **één** platform. De NIS2-tool gebruikt het bestaande (en via stap 2a te verfijnen) mcm2-orchestratie-/uitzetmechanisme **rechtstreeks** — geen aparte motor, geen servicegrens, geen "wel of geen mcm2-account"-vraag, want het is hetzelfde systeem.

Dit blok is dus geen bouwtaak voor een nieuw mechanisme meer, maar: (1) vaststellen wat het bestaande mcm2-uitzetmechanisme (versturen, token-links, statusbewaking, herinneringen — nu bekend van de jaarlijkse 8-vragen-survey én de Transdev-proef uit stap 1) al kan, en (2) het uitbreiden zodat het ook NIS2-beoordelingen (stream B, blok 4/5) kan uitzetten en opvolgen, niet alleen de bestaande contractsurvey.

## Scope

- **In scope (stap 2a, blokkerend voor de NIS2-module):** het bestaande mcm2-uitzetmechanisme tot een generieke, herbruikbare interne dienst maken die zowel de bestaande contractsurvey als NIS2-beoordelingen kan uitzetten.
- **In scope (stap 3):** de NIS2-beoordeling (stream B) daadwerkelijk aansluiten op die dienst.

## Kernentiteiten

Beoordelingsinstantie (koppelt leverancier + dienst + normenkader-template + status), Toegangslink/token — dit zijn zeer waarschijnlijk al bestaande concepten in mcm2's surveymechanisme; dit blok breidt uit, definieert niet opnieuw.

## Statussen

Minimaal: concept → uitgezet → ingevuld. Uitgebreider (in review → vastgesteld → verlopen, automatische heropening) voor zover het bestaande mcm2-mechanisme dit al biedt — anders toe te voegen tijdens stap 2a, ten behoeve van beide toepassingen (contractsurvey én NIS2-beoordeling).

## Business rules

- Alleen stream B gebruikt dit uitzetmechanisme; stream A (blok 2/3) is een intern formulier.
- Token/toegang blijft gescoped tot precies één beoordelingsinstantie.

## Afhankelijkheden

Blok 0 (gedeeld tenant-/rollenfundament), blok 4/5 (wat wordt uitgezet). Direct afhankelijk van (niet: geïnspireerd door) het gedeelde mcm2-orchestratiemechanisme — zie stap 2a in `../roadmap.md`.

## Wettelijke referentie

Ondersteunend proces; geen directe NIS2-verplichting op zichzelf.

## Openstaande vraag

Moet stream A altijd afgerond zijn vóórdat stream B naar de leverancier kan worden uitgezet, of mogen ze parallel lopen?

## Acceptatiecriteria (concept)

- [ ] Een beoordeling kan worden aangemaakt en uitgezet via het gedeelde mechanisme, en de leverancier kan via de link invullen zonder account.
- [ ] Status van een beoordeling is voor de organisatiegebruiker altijd zichtbaar.
- [ ] Het gedeelde uitzetmechanisme kan zowel de bestaande contractsurvey als een NIS2-beoordeling versturen, zonder dubbele code-paden.
- [ ] De frictiepunten die in stap 1 (Transdev-survey) zijn gelogd, zijn zichtbaar meegenomen in het functioneel ontwerp van dit blok.
