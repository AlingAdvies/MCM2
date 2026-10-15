# ADR 0005 — NIS2-tool wordt een module op mcm2, geen zelfstandige app

**Status:** bevestigd — 24-08-2026. **Vervangt ADR 0001 en ADR 0004** (beide blijven bewaard voor de geschiedenis, maar gelden niet meer).

## Context

Twee eerdere besluiten gingen ervan uit dat de NIS2-tool een zelfstandige applicatie zou zijn: eigen datamodel (ADR 0001), en later een eigen orchestratie-/notificatiemotor die het ontwerp van mcm2 hergebruikt maar los draait (ADR 0004). Bij nader inzien bleek dat onwerkbaar duur: Kees verwacht dat de kerntabellen in hoge mate overeenkomen (leveranciers-stamdata, contracten-stamdata, contactpersonen, wie beheert de leverancier, wie is tenant admin), en een losse orchestratie-/notificatiemotor zou alsnog een tweede systeem zijn dat naast dat van mcm2 onderhouden moet worden — met reëel risico dat de twee uit elkaar gaan lopen.

## Beslissing

De NIS2-tool wordt gebouwd als **module op hetzelfde platform als mcm2** — geen aparte app met een eigen kopie van tenant-, leveranciers-, contactpersoon-, rollen- of orchestratiedata. Eén gedeeld fundament, twee gezichten (mcm2 voor contractmanagement, NIS2-tool voor leveranciersbeoordeling/toeleveringsketen-beveiliging).

## Wat dit vervangt

- **ADR 0001** ("zelfstandige, lichte applicatie, geen gedeelde domeindata") — vervallen. Domeindata wordt juist wél gedeeld.
- **ADR 0004** ("eigen orchestratiemotor met maximaal hergebruik van mcm2's ontwerp") — vervallen. Er komt geen tweede motor; de bestaande/uit te breiden mcm2-orchestratie en -notificatie wordt het gedeelde mechanisme.

## Wat overeind blijft

- **ADR 0002** (proeftijd i.p.v. freemium-gating) blijft inhoudelijk staan — volledige functiediepte tijdens een proefperiode, begrensd op leveranciersaantal. Wat verandert: dit is niet langer "vanzelf" doordat de app zelfstandig is, maar wordt nu een **bewuste verpakkings-/onboardingvraag**: hoe zorgen we dat iemand die zich aanmeldt voor "de NIS2-tool" een samenhangende, herkenbare ervaring krijgt, zonder de indruk te wekken dat hij mcm2 aanschaft? Dit is productwerk (aparte aanmeldflow, eigen merkbeleving bovenop het gedeelde fundament), geen architectuurbeslissing meer. Nog te ontwerpen.
- **ADR 0003** (aansluiting NIS2 Supply Chain-schema, ISO 27002-taxonomie, SC10/20/30) — ongewijzigd van toepassing.

## Consequenties voor de blokken

- **Blok 0 (platformfundament)** en **blok 1 (leveranciersregister)**: worden niet als eigen datamodel gebouwd, maar als aansluiting op/uitbreiding van mcm2's bestaande tenant-/leveranciers-/contactpersoon-/rollenmodel.
- **Blok 8 (workflow)** en **blok 11 (notificaties)**: gebruiken het gedeelde orchestratie-/notificatiemechanisme rechtstreeks — geen aparte motor, geen servicegrens tussen "twee apps" nodig, want er is er maar één.
- Overige blokken (2–7, 9, 10, 12) grotendeels ongewijzigd in opzet, wel in scope: ze bouwen op het gedeelde fundament in plaats van op een eigen kopie.

## Bouwvolgorde (samengevat — volledige toelichting in `../roadmap.md`)

1. Nu direct: een super eenvoudige survey voor Transdev uitvoeren via het bestaande mcm2-mechanisme (Kees als platformbeheerder, tenant admin én gebruiker) — én expliciet de frictie vastleggen die daarbij optreedt (stamdata, contactpersoon, respons-zicht) als input voor stap 2/3.
2. Verfijning van mcm2, gesplitst:
   - **2a — gedeeld fundament (blokkerend voor de NIS2-tool):** tenant-/leveranciers-/contactpersoon-/rollenmodel, en de orchestratie/notificatie als eigen, herbruikbare interne dienst (bestaat nog niet).
   - **2b — overige mcm2-gap-analyse (niet blokkerend):** contractspecifieke functies en frontend-verbeteringen los van leveranciersbeoordeling; mag parallel of na stap 3 lopen.
3. De NIS2-tool bouwen als module op het (via 2a) ververste fundament.

## Reden

Voorkomt duplicatie en het uit-elkaar-lopen van twee implementaties van in essentie dezelfde orchestratie-/notificatielogica en dezelfde stamdata. Kost nu meer coördinatie met de bestaande mcm2-codebase, maar dat weegt niet op tegen twee systemen die na verloop van tijd moeten worden samengevoegd.

## Nog open

- Hoe de proefperiode/onboarding-belofte (ADR 0002) er productmatig uitziet bovenop één gedeeld platform — nog te ontwerpen, geen blokkade voor de bouwvolgorde hierboven.
- De exacte afbakening tussen 2a en 2b (wat hoort precies bij "gedeeld fundament") — te verfijnen zodra de mcm2-gap-analyse zelf start.

## Zie ook

`0001-standalone-app-vs-mcm2-module.md` (vervallen), `0004-orchestration-notifications-from-mcm2.md` (vervallen), `0002-proeftijd-vs-freemium.md`, `0003-align-with-nis2-supply-chain-scheme.md`, `../roadmap.md`, `../overview/architecture.md`
