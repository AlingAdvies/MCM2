# Referentie: NIS2 Supply Chain-certificeringsschema

**Status:** vastgelegd 24-08-2026, na onderzoek van https://nis2supplychain.eu/. Dit is het schema waar de tool zich actief op afstemt (zie ADR 0003) — niet zomaar een inspiratiebron.

## Wat het is

NIS2 Supply Chain (ook "NIS2-QM", Quality Mark) is een bestaand, breed gedragen mkb-keurmerk voor leveranciers van NIS2-plichtige organisaties. Governance/steekproefaudits door Stichting Kwaliteitsinnovatie, een netwerk van 80+ gecertificeerde auditpartners, en een 5-stappen certificeringsproces: pre-registratie → auditvoorbereiding (self-assessment) → verplicht pre-audit-webinar → onafhankelijke audit → certificaat.

Het schema claimt bereik: ~400.000 Europese bedrijven direct NIS2-plichtig, ~1,8 miljoen bedrijven indirect geraakt als leverancier.

## Positionering van de tool t.o.v. dit schema

**Wij zijn niet het keurmerk. Wij zijn de tool waarmee het gedaan wordt.** Het schema zelf benoemt "auditvoorbereiding" als aparte stap en verwijst naar een platform voor zelfstandige voorbereiding — dat is het gat. De echte pijn is niet de norm kennen, maar een survey daadwerkelijk laten landen bij de juiste persoon, opvolgen tot er antwoord komt, en dat overzichtelijk krijgen voor iemand voor wie dit geen vakgebied is (zie ADR 0003).

## De drie niveaus

| | SC10 · BASIC | SC20 · SUBSTANTIAL | SC30 · HIGH |
|---|---|---|---|
| Doelgroep | mkb met beperkte ketenimpact (productie, handel, diensten) | IT/OT/IoT-leveranciers met toegang tot klantnetwerken/gevoelige data | grote leveranciers, softwareleveranciers, MSP's, kritieke systemen |
| Aantal criteria | 17 | 29–35 (bronnen wisselen licht) | 55 |
| Categorieën | Organisatorisch, Mensgericht, Fysiek, Technologisch | + OT-maatregelen, IT-maatregelen | zelfde 6, OT/IT flink uitgebreid |

Kerngedachte, letterlijk van de site: "geen maximale beveiliging voor iedereen, maar passende en proportionele cybersecurity per risico in de supply chain." Het niveau wordt bepaald door de impact van het product/de dienst van de leverancier op de klant.

## Categorie-taxonomie (ISO 27002:2022) — leidend voor blok 4/5

In plaats van ZCERT's eigen ENISA-12-groepering (Beleid, Personeel, Operations, Netwerk, Backup, Leveranciersmanagement, Privacy, Informatie delen, Controle) gebruikt dit schema de ISO 27002:2022-indeling:

1. **Organisatorische maatregelen** — beleid, verantwoordelijkheden, assetbeheer, toegangsrechten, continuïteit, toeleveringsketen-beveiliging (1.26)
2. **Mensgerichte maatregelen** — bewustzijn/training, thuiswerken, incidentmelding, achtergrondcontroles
3. **Fysieke maatregelen** — toegangsbeveiliging, vergrendeling, apparatuurbeheer
4. **Technologische maatregelen** — authenticatie/MFA, malwarepreventie, back-up, patchbeheer, versleuteling, logging
5. **OT-maatregelen** (vanaf SC20) — operationele technologie, geen equivalent in ISO 27001
6. **IT-maatregelen** (vanaf SC20) — broncodebeheer, veilige softwareontwikkeling, testen, deployment

**Besluit (zie ADR 0003):** blok 4 en 5 worden op deze taxonomie herbouwd, niet op ENISA-12-groepering — omdat de eindgebruiker geen specialist is en dus dezelfde termen moet zien als in de daadwerkelijke audit waar de tool hem op voorbereidt.

## Te Beschermen Belangen (TBB) — mogelijke aanvulling op blok 3

Aparte, rijkere impact-taxonomie dan het BIV-model uit blok 3: twaalf categorieën — financieel, juridisch, operationeel, veiligheid, reputatie, personeel, strategisch, klanten, innovatie, omgeving, leveranciers/partners, gegevensbescherming — per sector uitgewerkt, gebruikt om te bepalen wat er voor een organisatie op het spel staat.

**Nog niet besloten:** of TBB het BIV-model in blok 3 vervangt, aanvult, of ernaast blijft bestaan als optionele verdieping. Zie open vraag in `../blocks/03-impact-biv.md`.

## Inhoudelijk hergebruik

Kees heeft expliciet aangegeven dat de criteria/normdocumenten van dit schema zonder IP-restrictie mogen worden overgenomen (uitspraak 24-08-2026, vastgelegd in ADR 0003 — dit is geen door mij geverifieerde juridische inschatting, maar een expliciete beslissing van de opdrachtgever).

## Documenten (bron)

- [SC10 BASIC — korte norm (PDF)](https://nis2supplychain.eu/wp-content/uploads/2025/12/Kort-NIS2-SC-10-BASIC-15122025.pdf) — 17 criteria: Organisatorisch (1.2, 1.3, 1.6.1, 1.6.2, 1.8, 1.14, 1.23, 1.26), Mensgericht (2.2, 2.6, 2.7), Fysiek (3.9), Technologisch (4.1, 4.4, 4.5, 4.7, 4.10)
- [SC20 SUBSTANTIAL — korte norm (PDF)](https://nis2supplychain.eu/wp-content/uploads/2025/12/Kort-NIS2-SC-20-SUBSTANTIAL-15122025-1.pdf) — 35 gemapte criteria over 6 categorieën
- [SC30 HIGH — korte norm (PDF)](https://nis2supplychain.eu/wp-content/uploads/2025/12/Kort-NIS2-SC-30-HIGH-15122025-1.pdf) — 55 criteria, gemapt op ISO 27001, OT-criteria zonder ISO-equivalent
- [Vergelijkingsdocument SC10/SC20/SC30 (PDF)](https://nis2supplychain.eu/wp-content/uploads/2026/02/NIS2-Supply-Chain-Certificering.pdf)
- [Te Beschermen Belangen — sectoren (PDF)](https://nis2supplychain.eu/wp-content/uploads/2025/06/Beschermen-van-je-belangrijkste-belangen-Sectoren.pdf)
- [NIS2 SC Compliance en certificeringsschema v3.2 (PDF)](https://nis2supplychain.eu/wp-content/uploads/2026/01/NIS2-Quality-Mark-Compliance-and-Certificeringsschema-v3.2-1-1-2026.pdf) — nog niet inhoudelijk doorgenomen, aanbevolen voor vervolgonderzoek
- [FAQ](https://nis2supplychain.eu/faq/), [Voor bedrijven](https://nis2supplychain.eu/voor-bedrijven/), [Documenten](https://nis2supplychain.eu/documenten/)

## Nog te onderzoeken

- Wie precies Stichting Kwaliteitsinnovatie is, hoe jong/gevestigd het initiatief is, en of toenadering (partnerschap/erkenning) zinvol is — apart, zakelijk vervolgtraject, geen blokkade voor de bouw.
- Volledige (niet-verkorte) versies van de SC10/20/30-normdocumenten, voor als blok 4/5 in detail wordt gebouwd.
- Het volledige compliance- en certificeringsschema-document (v3.2) voor de exacte auditprocedure.
