# Terminologie

**Status:** bijgewerkt 24-08-2026 na ADR 0003 — categorie-taxonomie vastgesteld. Code-taalconventie nog te beslissen.

Gebruik deze termen consequent in UI-teksten en documentatie. De gebruiker is geen specialist — sluit aan bij de termen die in een echte NIS2 Supply Chain-audit gebruikt worden, verzin geen eigen vocabulaire (zie ADR 0003).

## Domeintermen

| Term | Betekenis | Gebruik in |
|---|---|---|
| Tenant / organisatie | De klant van de tool — de partij die haar leveranciers beoordeelt | Blok 0 |
| Leverancier | De partij die wordt beoordeeld; geen platformgebruiker, respondent op een uitgestuurde vragenlijst | Blok 1, 4, 5 |
| Dienst / product | Wat de leverancier levert aan de tenant; onderwerp van classificatie en beoordeling | Blok 1, 2 |
| Stream A | Interne beoordeling: classificatie + BIV-impactbepaling, door de tenant zelf | Blok 2, 3 |
| Stream B | Extern self-assessment door de leverancier, via tijdgebonden link; versturen/opvolgen via mcm2 | Blok 4, 5, 8 |
| BIV | Beschikbaarheid, Integriteit, Vertrouwelijkheid — de drie assen van de impactbepaling | Blok 3 |
| Comply-or-explain | Bij "nee" op een vraag is een toelichting verplicht | Blok 4, 5 |
| Vraagcode | Stabiele code per vraag — moet stabiel blijven over versies van het normenkader | Blok 4, 5, 9 |
| Normenkader | De configureerbare set categorieën/vragen/weging die een beoordeling structureert | Blok 9 (niet in v1) |
| Toeleveringsketen-beveiliging | Officiële term uit NIS2 art. 21 lid 2 sub d — primaire framing van het product | Overal |
| Zorgplicht | Wettelijke duty of care — vereist "passende en evenredige maatregelen" | Compliance-boodschap |
| Essentiële / belangrijke entiteit | NIS2-classificatie van de tenant zelf, o.b.v. omvang/kritikaliteit | Blok 0 (mogelijk profielveld) |
| Proefperiode | 30 dagen, volledige functiediepte, beperkt aantal leveranciers | Blok 0, business-model.md (intern document, buiten de publieke repo: OneDrive\MCM2-klantdata\_platform\nis2\) |

## Categorie-taxonomie zelfassessment (ISO 27002:2022) — leidend sinds ADR 0003

Gebruik deze zes categorieën in blok 4/5, **niet** de oude ENISA-12-groepering (Beleid/Personeel/Operations/Netwerk/Backup/Leveranciersmanagement/Privacy/Informatie delen/Controle):

1. Organisatorische maatregelen
2. Mensgerichte maatregelen
3. Fysieke maatregelen
4. Technologische maatregelen
5. OT-maatregelen (vanaf SC20-niveau)
6. IT-maatregelen (vanaf SC20-niveau)

## NIS2 Supply Chain-termen (zie `nis2-supply-chain-scheme.md`)

| Term | Betekenis |
|---|---|
| SC10 · BASIC | Lichtste certificeringsniveau, 17 criteria, beperkte ketenimpact |
| SC20 · SUBSTANTIAL | Middenniveau, 29–35 criteria, IT/OT/IoT met netwerktoegang |
| SC30 · HIGH | Zwaarste niveau, 55 criteria, kritieke leveranciers/MSP's |
| TBB (Te Beschermen Belangen) | Twaalf-categorieën impact-taxonomie, mogelijke aanvulling op BIV (nog niet besloten, zie blok 3) |
| Stichting Kwaliteitsinnovatie | Governance-/auditpartij achter het NIS2 Supply Chain-keurmerk |

## Positioneringstaal

"De tool waarmee het gedaan wordt" — de tool is de uitvoerings-/voorbereidingsmotor voor NIS2 Supply Chain-certificering, niet een concurrerend keurmerk. Gebruik deze framing in productcommunicatie (zie ADR 0003).

## Vermijd

- "Zorginstelling", "zorgaanbieder", "patiëntenzorg" — herkomsttermen uit de ZCERT-excel, vervangen door "organisatie", "primaire bedrijfsprocessen".
- "CISO/FGO" als vaste rolnaam — gebruik generieke contactrollen ("security contact", "privacy contact").
- De oude ENISA-12-categorienamen in nieuwe UI/documenten — gebruik de ISO 27002-taxonomie hierboven.

## Open vraag: codetaal

Nog te beslissen: worden entiteiten/velden in code Engels genoemd (Supplier, Assessment, RiskLevel) met Nederlandse UI-labels, of Nederlands doorgevoerd tot in de code? Leg de keuze hier vast zodra gemaakt.
