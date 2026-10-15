# Wettelijk kader: Cyberbeveiligingswet / NIS2

**Status:** onderzocht en vastgelegd 24-08-2026. Zie bronnen onderaan.

## Actuele status

De Cyberbeveiligingswet (Nederlandse implementatie van NIS2) is op **15 augustus 2026** in werking getreden. Ca. 8.000 organisaties in 18 sectoren vallen eronder. Toezicht: het NCSC en sectorale toezichthouders.

## Kernvondst: directe grondslag voor de blok 4/5-splitsing

Artikel 21 lid 2 NIS2 kent tien verplichte risicobeheersmaatregelen. Relevant:

- **Sub d — "toeleveringsketen-beveiliging"** (supply chain security): de relatie met en vetting van directe leveranciers/dienstverleners. → **Blok 4** (zelfassessment organisatieniveau, ENISA-12).
- **Sub e — "beveiliging bij verwerving, ontwikkeling en onderhoud van systemen"**: hoe het product/de dienst zelf technisch is gebouwd en onderhouden. → **Blok 5** (product-/dienstbeveiliging).

Dit is geen toeval maar een directe wettelijke onderbouwing om deel A en deel B als aparte blokken te behouden.

**Overige acht maatregelen uit art. 21 lid 2** (voor context — de tool richt zich primair op sub d/e, niet op volledige NIS2-brede compliance):
beleid voor risicoanalyse en informatiebeveiliging; incidentafhandeling; bedrijfscontinuïteit en crisismanagement; effectiviteit van het cyberrisicobeheer; basis-cyberhygiëne en training; cryptografie en versleuteling; personeelsbeveiliging/toegang/assetbeheer; multifactorauthenticatie en beveiligde communicatie.

## Artikel 21 lid 3 — uitwerking van sub d

Bij het beoordelen van leveranciers moet rekening gehouden worden met:

1. Kwetsbaarheden specifiek per directe leverancier (niet generiek toepassen).
2. De algehele kwaliteit van producten en cyberbeveiligingspraktijken van leveranciers, inclusief secure-development-procedures.
3. Uitkomsten van gecoördineerde Europese ketenrisicobeoordelingen (art. 22 lid 1) voor kritieke technologieën — macro-niveau (vergelijkbaar met het 5G-traject), geen bouwtaak voor de tool. Mogelijk later als achtergrondreferentie in blok 9.

## Proportionaliteit is wettelijk verankerd

Art. 21 lid 1: organisaties moeten "passende en evenredige maatregelen" nemen, rekening houdend met risicoblootstelling, omvang en implementatiekosten. Dit is de wettelijke (niet alleen productmatige) onderbouwing om de zwaarte van het self-assessment te koppelen aan het risiconiveau uit stream A — relevant zodra blok 9 wordt opgepakt.

## Meldtermijnen (relevant voor blok 5, vragen over incidentmelding door de leverancier)

| Fase | Termijn |
|---|---|
| Vroegtijdige waarschuwing | 24 uur |
| Melding / eerste beoordeling | 72 uur |
| Eindverslag | 1 maand na melding (bij langlopende incidenten: voortgangsrapport na 1 maand, eindverslag 1 maand na afsluiting) |

Gebruik deze termijnen als referentie in blok 5 in plaats van eigen termijnen te verzinnen.

## Essentiële vs. belangrijke entiteiten

| | Essentieel | Belangrijk |
|---|---|---|
| Omvang (indicatief) | >250 fte of >€50 mln omzet + >€43 mln balanstotaal, in kritieke sectoren | >50 fte of >€10 mln omzet |
| Toezicht | Proactief (inspecties op eigen initiatief) | Reactief (naar aanleiding van incidenten/signalen) |

Het verschil zit in omvang/kritikaliteit, **niet** in sector. Potentieel bruikbaar als tenant-profielveld (blok 0) om verwachte diepte/rigueur te sturen — zie open vraag in `../blocks/00-platform.md`.

## Nuance: is de zorgsector strenger dan andere sectoren?

Niet volgens de wet zelf — die schrijft geen sector-specifieke zwaarte voor. ENISA-12 (basis van blok 4) is een breed erkende, **sectorneutrale** kern die de EU zelf aanbeveelt, geen zorg-specifieke verzwaring. Er bestaat wél een aparte, zwaardere ENISA-uitvoeringsverordening (13 technische maatregelen) specifiek voor een smalle groep entiteitstypen (cloudproviders, datacenters, DNS, managed service providers) — dit is entiteitstype-gebonden, niet sector-gebonden. Voor de brede doelgroep buiten die smalle groep is de ENISA-12-aanpak een solide, verdedigbare basis.

## Terminologie-aanbevelingen (zie ook `glossary.md`)

- Gebruik **"toeleveringsketen-beveiliging"** / **"ketenbeveiliging"** als primaire framing, niet alleen het generieke "leveranciersbeoordeling" — dit is de officiële term uit art. 21 lid 2 sub d.
- Verwijs in het compliance-/auditrapport expliciet naar **"artikel 21 lid 2 sub d"** (en waar relevant sub e) als de wettelijke grondslag die wordt aangetoond.
- Gebruik **"passende en evenredige maatregelen"** en **"zorgplicht"** in de compliance-boodschap — dit is taal die de doelgroep al kent uit de wet.

## Belangrijke kanttekening

De wettekst zelf is principe-gebaseerd, geen kant-en-klare vragenlijst-methodiek. Er staat nergens letterlijk "8 vragen per BIV-as" of "ENISA-12" voorgeschreven. De ZCERT/ENISA-12-aanpak is een gangbare, verdedigbare invulling van het wettelijke principe — niet een letterlijk wettelijk voorschrift. Communiceer dit ook zo naar gebruikers (geen overclaiming van "wettelijk verplicht exact zo").

## Bronnen (geraadpleegd 24-08-2026)

- Rijksoverheid.nl — Cyberbeveiligingswet en Wet weerbaarheid kritieke entiteiten vanaf 15 augustus 2026 van kracht: https://www.rijksoverheid.nl/actueel/nieuws/2026/07/07/cyberbeveiligingswet-en-wet-weerbaarheid-kritieke-entiteiten-vanaf-15-augustus-2026-van-kracht
- NCSC — Cyberbeveiligingswet (NIS2): https://www.ncsc.nl/cyberbeveiligingswet-nis2
- NCSC — Meldplicht: https://www.ncsc.nl/cyberbeveiligingswet-nis2/meldplicht
- NIS 2 Directive, Article 21: https://www.nis-2-directive.com/NIS_2_Directive_Article_21.html
- NIS2 Supply Chain Security: Article 21(2)(d) Explained — NIS2Dir.eu: https://nis2dir.eu/en/articles/nis2-supply-chain-security
- Wat is supply chain security binnen de NIS2-richtlijn? — IT Aanspreekpunt: https://itaanspreekpunt.nl/blog/wat-is-supply-chain-security-binnen-de-nis2-richtlijn/
- NIS2 artikel 21: wat de tien maatregelen concreet betekenen — Absolute Security: https://absolutesecurity.nl/nl/inzichten/nis2-artikel-21-concreet
- Wat is het verschil tussen essentiële en belangrijke entiteiten onder NIS2? — TCA: https://tca.nl/kennisbank/wat-is-het-verschil-tussen-essentiele-en-belangrijke-entiteiten-onder-nis2/
- Vragen en antwoorden over NIS2 — Z-CERT: https://z-cert.nl/vragen-en-antwoorden-over-de-richtlijn-netwerk-en-informatiebeveiliging-nis2
- ENISA publishes technical guidance to strengthen NIS2 cybersecurity risk management — Industrial Cyber: https://industrialcyber.co/threats-attacks/enisa-publishes-technical-guidance-to-strengthen-nis2-cybersecurity-risk-management/
