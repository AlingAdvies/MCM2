Je bent een ervaren enterprise solution architect, productmanager voor B2B-SaaS en domain-driven-design-specialist.

## Context

Ik ontwikkel MCM2: een multitenant SaaS-platform voor multi-contractmanagement en vendormanagement. De technische basis bestaat uit:

- Frontend: Next.js / React / TypeScript
- Backend: NestJS / TypeScript
- Database: PostgreSQL via Supabase
- Doel: beheersbaar, modulair, veilig en geschikt voor professionele organisaties
- Relevante generieke platformfuncties: organisaties, gebruikers, rollen, documentbeheer, workflows, taken, reminders, dashboards, rapportages, audittrail, notificaties en mogelijk SSO.

Transdev wil MCM2 mogelijk uitbreiden met een oplossing voor concessiemanagement in het openbaar vervoer.

## Businessvraag

Transdev heeft langlopende concessieovereenkomsten met provincies en gemeenten als opdrachtgevers. Per concessie gelden contractuele verplichtingen, vaak afkomstig uit een Programma van Eisen (PvE), aanbestedingsdocumenten, inschrijving, gunningsbesluiten, contractbijlagen en later gemaakte afspraken.

Transdev zoekt één toegankelijke en betrouwbare bron van waarheid voor concessies, met onder andere:

1. Vastleggen van concessies, opdrachtgevers, contractdocumenten, looptijden, opties, mijlpalen en verantwoordelijke personen.
2. Structuur aanbrengen in verplichtingen uit het PvE en andere contractbronnen.
3. Inzicht in de status van invulling/naleving van elke toegezegde verplichting.
4. Vastleggen, goedkeuren, plannen en opvolgen van tussentijds gemaakte afspraken met opdrachtgevers.
5. Bewijsvoering en documentatie koppelen aan verplichtingen, afspraken, mijlpalen en rapportages.
6. Heldere managementrapportage voor de directie van Transdev.
7. Snelle, gecontroleerde informatieverstrekking en rapportage aan provincies en gemeenten.
8. Een eenduidige audittrail: wie heeft wat wanneer vastgelegd, gewijzigd, beoordeeld of goedgekeurd?
9. Waar mogelijk hergebruik van de bestaande contractmanagement- en vendormanagementfunctionaliteit van MCM2.

## Opdracht

Analyseer de implicaties van het combineren van:
A. een generieke multi-contractmanagement / vendormanagement-oplossing (MCM2);
B. een Transdev-specifieke concessiemanagementoplossing.

Werk dit uit als een praktisch solution-designdocument in Markdown, gericht op besluitvorming én mogelijke implementatie.

## Belangrijke ontwerpprincipes

Hanteer deze uitgangspunten:

- Ontwerp concessiemanagement als een afzonderlijke bounded context / productmodule, niet als een verzameling losse extra velden op het standaardcontract.
- Maximaliseer hergebruik van een gedeelde platformkern, zonder dat concessiespecifieke logica het generieke MCM2-product vervuilt.
- Maak onderscheid tussen configureerbare klantvariatie en echte Transdev-specifieke maatwerkfunctionaliteit.
- Ondersteun meerdere concessies, meerdere opdrachtgevers en meerdere interne bedrijfsonderdelen.
- Houd rekening met lange contractduren, contractwijzigingen, tussentijdse afspraken, versies en historisch bewijs.
- Maak een expliciet onderscheid tussen:
  - formele contractuele verplichtingen;
  - interne acties en beheersmaatregelen;
  - afspraken met opdrachtgevers;
  - bewijsstukken;
  - beoordelingen / accordering;
  - formele rapportages.
- Denk aan rolgebaseerde toegang, gegevensscheiding, auditability, documentversies, vertrouwelijke informatie en externe toegang voor opdrachtgevers.
- Adviseer een pragmatische MVP die snel waarde levert, maar ontwerp geen technische schuld die latere uitbreiding onmogelijk maakt.
- Vermijd microservices tenzij daar een duidelijke operationele of schaalbaarheidsreden voor is. Start vanuit een modulaire monolith in NestJS, met duidelijke modulegrenzen en API-contracten.
- Neem mee dat de bestaande MCM2-oplossing ook vendormanagement en leveranciersrisico/compliance kan bevatten. Beschrijf waar dit functioneel aansluit op concessies, bijvoorbeeld wanneer leveranciers of onderaannemers bijdragen aan concessieverplichtingen.

## Lever exact deze onderdelen op

### 1. Executive assessment
Geef in maximaal 10 bullets antwoord op:
- Waarom deze combinatie commercieel en functioneel aantrekkelijk kan zijn.
- Welke drie grootste productrisico’s ontstaan.
- Welke drie ontwerpkeuzes essentieel zijn om MCM2 generiek en verkoopbaar te houden.

### 2. Domeinmodel en bounded contexts
Beschrijf de voorgestelde bounded contexts, inclusief:
- Shared Platform Core
- Contract Lifecycle Management
- Vendor Management / Vendor Risk
- Concession Management
- Reporting & External Information Provisioning
- Identity, Access & Audit

Geef per bounded context:
- Verantwoordelijkheid
- Belangrijkste entiteiten
- Eigenaar van de data
- Belangrijkste events of interfaces
- Wat gedeeld mag worden
- Wat strikt concessiespecifiek moet blijven

Gebruik hiervoor een overzichtelijke Markdown-tabel.

### 3. Functioneel doelmodel concessiemanagement
Werk het functionele model uit voor minimaal de volgende entiteiten:

- Concession
- Contract Party / Contracting Authority
- Concession Agreement
- Source Document
- Requirement / Obligation
- Obligation Version
- Compliance Assessment
- Action / Measure
- Milestone
- Commitment
- Agreement with Client
- Change / Variation
- Evidence Item
- Finding / Exception
- Risk
- Report
- Approval
- Stakeholder
- Supplier / Subcontractor (koppeling met vendormanagement)

Geef per entiteit:
- Doel
- Belangrijkste attributen
- Relaties met andere entiteiten
- Lifecycle/statussen
- Audit- en versiebehoefte

### 4. Verplichtingenregister
Ontwerp een verplichtingenregister voor PvE- en concessieverplichtingen.

Beschrijf minimaal:
- Herkomst en bronverwijzing: document, versie, pagina/paragraaf en eventueel letterlijk fragment.
- Categorisatie, bijvoorbeeld exploitatie, personeel, materieel, duurzaamheid, KPI, veiligheid, toegankelijkheid, reizigersinformatie, financiën en rapportage.
- Type verplichting: eenmalig, periodiek, continu, mijlpaalgebonden, gebeurtenisgestuurd.
- Prioriteit en materialiteit.
- Contractuele eigenaar en uitvoeringsverantwoordelijke.
- Frequentie, deadline, herinneringen en escalaties.
- Statusmodel, bijvoorbeeld: concept, geïnterpreteerd, gepland, in uitvoering, bewijs aangeleverd, ter beoordeling, compliant, deels compliant, non-compliant, niet van toepassing, verlopen.
- Koppeling met acties, risico’s, leveranciers, bewijsstukken en rapportages.
- Formele beoordeling/goedkeuring, inclusief bewijs dat een beoordeling is uitgevoerd.

Beschrijf ook hoe AI eventueel kan helpen bij het extraheren van verplichtingen uit PvE-documenten, maar benadruk dat menselijke validatie altijd nodig is voordat een verplichting formeel wordt.

### 5. Afspraken met opdrachtgevers
Ontwerp een proces voor tussentijdse afspraken met provincies en gemeenten.

Maak duidelijk onderscheid tussen:
- Informele notitie of overlegpunt
- Actiepunt
- Conceptafspraak
- Door beide partijen bevestigde afspraak
- Formele contractwijziging / addendum

Werk een statusflow uit vanaf registratie tot afsluiting, inclusief:
- initiatiefnemer;
- betrokken interne en externe partijen;
- relatie met concessie en contractclausules;
- acties, deadlines en eigenaren;
- benodigde bewijsstukken zoals e-mails, vergaderverslagen en ondertekende documenten;
- interne review;
- eventuele bevestiging door opdrachtgever;
- impact op verplichtingen, risico’s, planning en rapportages;
- onveranderbare audittrail.

### 6. Samenhang met MCM2
Maak een tabel met drie kolommen:
1. Hergebruiken uit de MCM2-kern;
2. Uitbreiden / generiek maken;
3. Nieuw en alleen concessiespecifiek.

Neem minimaal mee:
- Contractmetadata en contractrepository
- Organisaties, contactpersonen en rollen
- Taken, workflow, deadlines en reminders
- Documenten, versies en bewijsstukken
- Dashboarding en rapportages
- Risico-, issue- en actiebeheer
- Goedkeuringen en audittrail
- Leveranciers en onderaannemers
- Koppeling leveranciersprestatie aan concessieverplichtingen
- Extern opdrachtgeverportaal
- PvE-verplichtingenregister
- Afsprakenregister
- Concessiespecifieke KPI’s en rapportageformats

### 7. Architectuurvoorstel
Adviseer een architectuur voor de bestaande Next.js + NestJS + PostgreSQL/Supabase-stack.

Werk uit:
- Module-indeling in frontend en backend.
- Aanbevolen NestJS-modules.
- Kern-API’s of API-resourcegroepen.
- Database-schema op hoofdlijnen met tabellen/aggregates en belangrijkste relaties.
- Strategie voor multi-tenancy en row-level security.
- Autorisatiemodel met rollen, bijvoorbeeld:
  - Platform administrator
  - Transdev group administrator
  - Concession manager
  - Obligation owner
  - Contributor
  - Reviewer / approver
  - Director / management viewer
  - External client user
  - Auditor
- Documentopslag, immutable bewijsvoering, versiebeheer en retentie.
- Auditlogging: welke gebeurtenissen moeten minimaal worden vastgelegd?
- Notificaties, escalaties en periodieke controles.
- Opties voor integratie met Microsoft 365 / SharePoint / Teams / Entra ID, zonder die integraties als harde MVP-voorwaarde te maken.
- Externe rapportage en gecontroleerde informatieverstrekking aan opdrachtgevers.

Voeg een Mermaid componentdiagram toe dat de modulegrenzen en belangrijkste gegevensstromen zichtbaar maakt.

### 8. Rapportages
Ontwerp drie rapportageniveaus:

1. Directierapportage Transdev:
   - totaaloverzicht per concessie;
   - status kritische verplichtingen;
   - non-compliance en openstaande risico’s;
   - aankomende deadlines;
   - trends;
   - uitzonderingen die managementbesluitvorming vragen.

2. Concessie-/operationeel management:
   - verplichtingen per eigenaar;
   - deadlines en achterstanden;
   - bewijsstatus;
   - openstaande acties;
   - afspraken met opdrachtgevers;
   - issues, risico’s en escalaties.

3. Opdrachtgeversrapportage:
   - alleen relevante, gevalideerde informatie;
   - overeengekomen format en periode;
   - rapportagestatus;
   - exporteerbaar naar PDF en Excel;
   - versie, goedkeuring en verzendregistratie.

Maak expliciet hoe voorkomen wordt dat interne concepten, risicoanalyses of niet-gevalideerde informatie per ongeluk zichtbaar worden voor opdrachtgevers.

### 9. Oplossingsvarianten
Werk minimaal drie oplossingsrichtingen uit:

- Variant A: Concessiemodule binnen één gedeeld MCM2-product.
- Variant B: Gedeelde platformkern met een aparte Transdev Concession Management-app/frontend.
- Variant C: Een eigen Transdev-specifieke oplossing, met slechts beperkte koppeling aan MCM2.

Vergelijk de varianten op:
- time-to-value;
- beheerbaarheid voor een klein ontwikkelteam;
- producthergebruik;
- risico op productvervuiling;
- flexibiliteit voor Transdev;
- uitbreidbaarheid;
- commerciële verkoopbaarheid buiten Transdev;
- implementatierisico;
- aanbevolen situatie waarin de variant passend is.

Geef daarna een expliciete aanbeveling met argumentatie.

### 10. MVP en roadmap
Definieer:

- MVP (0-4 maanden): minimale set om één of twee concessies betrouwbaar te beheren.
- Fase 2: schaalbaarheid, uitgebreidere workflows, opdrachtgeverportaal en geavanceerde rapportage.
- Fase 3: AI-ondersteunde documentextractie, integraties, benchmarking en geavanceerde analytics.

Geef voor iedere fase:
- Scope
- Gebruikerswaarde
- Belangrijkste datamigratie
- Belangrijkste technische keuzes
- Acceptatiecriteria
- Belangrijkste risico’s

### 11. Backlog
Maak een prioritaire backlog met:
- Epic
- User story
- Gebruikersrol
- Prioriteit: Must / Should / Could
- Acceptatiecriteria
- Afhankelijkheden
- Indicatie: S, M, L of XL

Neem minimaal 25 concrete user stories op.

### 12. Beslisdocument
Sluit af met:
- Een korte aanbevolen productpositionering voor Transdev.
- Een korte aanbevolen productpositionering voor de bredere markt.
- Vijf Architecture Decision Records (ADR’s), elk met context, besluit, consequenties en alternatieven.
- Een lijst met maximaal 15 gerichte vragen die eerst met Transdev moeten worden gevalideerd voordat ontwikkeling start.

## Kwaliteitseisen voor jouw antwoord

- Schrijf in helder zakelijk Nederlands.
- Wees concreet en voorkom algemene SaaS-clichés.
- Maak aannames expliciet.
- Benoem expliciet waar concessiemanagement wezenlijk afwijkt van normaal contractmanagement.
- Geef waar nuttig voorbeelden van statuswaarden, schermen, dashboards, rollen en workflows.
- Adviseer geen enterprise-overengineering.
- Lever de uitwerking als één goed gestructureerd Markdown-document en een leesbare html