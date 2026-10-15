# Architectuur &amp; schaal

**Status:** bevestigd 24-08-2026, herzien 24-08-2026 (ADR 0005 — module op mcm2). Deze versie vervangt het eerdere "zelfstandige app"-model.

## Kernbeslissing

De NIS2-tool wordt een **module op hetzelfde platform als mcm2** — geen aparte applicatie met een eigen kopie van tenant-, leveranciers-, contactpersoon-, rollen- of orchestratiedata. Eén gedeeld fundament, twee gezichten: mcm2 voor contractmanagement, de NIS2-tool voor leveranciersbeoordeling/toeleveringsketen-beveiliging.

Dit is een koerswijziging t.o.v. de eerste opzet (ADR 0001: zelfstandige app) en de daaropvolgende tussenstap (ADR 0004: eigen orchestratiemotor met hergebruik van mcm2's ontwerp). Beide zijn vervangen door **ADR 0005**. Zie die ADR voor de volledige besluitvormingsgeschiedenis.

## Waarom deze omslag

Kees verwacht dat de kerntabellen in hoge mate overeenkomen: leveranciers-stamdata, contracten-stamdata, contactpersonen, wie beheert de leverancier, wie is tenant admin. Een losse implementatie voor de NIS2-tool — zelfs met hergebruik van mcm2's ontwerp als voorbeeld — zou alsnog een tweede systeem zijn dat apart onderhouden moet worden, met reëel risico dat het uit elkaar gaat lopen. Eén gedeeld fundament voorkomt dat.

## Wat gedeeld is

| Aspect | Status |
|---|---|
| Auth-aanpak, RLS-patroon, AWS/CI-CD | Gedeeld — hetzelfde platform |
| Tenant-/gebruikers-/rollenmodel | Gedeeld |
| Leveranciers- en contactpersoongegevens | Gedeeld — geen aparte kopie voor de NIS2-tool |
| Orchestratie/opvolging + notificaties (versturen, status, herinneren) | Gedeeld mechanisme — wordt uitgebreid (niet dubbel gebouwd), zie `nis2-supply-chain-scheme.md` en blok 8/11 |
| Leveranciersbeoordelingen (classificatie, BIV, self-assessment, scores) | **NIS2-specifiek** — dit is de eigenlijke, nieuwe data die de module toevoegt |

## Twee-stromenmodel (blijft staan)

- **Stream A — intern.** Dienstclassificatie + BIV-impactbepaling: hoe kritiek is deze leverancier/dienst voor de eigen organisatie. Ingevuld door de organisatie zelf. (Blok 2, 3)
- **Stream B — extern.** Zelfassessment door de leverancier: organisatieniveau en productbeveiliging, nu ingericht op de ISO 27002-taxonomie/SC10-SC30 (zie ADR 0003). Uitgezet en opgevolgd via het gedeelde mcm2-mechanisme. (Blok 4, 5)

## Persona

De primaire gebruiker aan organisatiezijde is geen specialist — vaak iemand voor wie leveranciersbeoordeling een taak erbij is. Terminologie sluit aan bij wat de gebruiker in een echte audit tegenkomt (zie ADR 0003), geen extra jargon.

## Wat nog open staat (productwerk, geen architectuur meer)

De proefperiode-belofte (ADR 0002: volledige functiediepte, 30 dagen, beperkt aantal leveranciers, zelfstandig te proberen) blijft overeind, maar is nu een **verpakkings-/onboardingvraag**: hoe zorgt een aparte aanmeldflow/merkbeleving voor de NIS2-tool ervoor dat een nieuwe klant een samenhangende ervaring krijgt, zonder de indruk dat hij "mcm2 aanschaft"? Nog te ontwerpen — zie ADR 0005.

## Bouwvolgorde

Zie `../roadmap.md` voor de directe uitvoeringsvolgorde (Transdev-survey nu → gedeeld fundament verfijnen → NIS2-module bouwen).

## Zie ook

- `business-model.md` (intern document, buiten de publieke repo: OneDrive\MCM2-klantdata\_platform\nis2\) — proefperiode, nu als verpakkingsvraag
- `legal-context.md` — art. 21 lid 2 sub d/e
- `nis2-supply-chain-scheme.md` — schema waar de tool zich op afstemt
- `../decisions/0005-nis2-as-module-on-mcm2.md` — huidige architectuur, met volledige besluitgeschiedenis
