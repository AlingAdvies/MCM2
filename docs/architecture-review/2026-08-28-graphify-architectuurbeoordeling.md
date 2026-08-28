# Architectuurbeoordeling — conclusie

## Oordeel

De applicatie laat een opvallend volwassen basis zien voor een security- en compliancegevoelige multi-tenant SaaS. De kracht zit niet uitsluitend in de gekozen technologie, maar vooral in de aantoonbare samenhang tussen architectuurkeuzes, database-migraties, geautomatiseerde tests, operationele scripts, runbooks en beheerbewijzen.

De graph toont een duidelijke beveiligingsketen rond tenant-isolatie, server-side sessies, OIDC/Entra-identiteit, rolgebaseerde autorisatie en PostgreSQL Row-Level Security (RLS). Belangrijk is dat tenantcontext niet vanuit browser-URL’s of client-invoer wordt vertrouwd, maar via de geverifieerde sessie en databasecontext wordt afgeleid.

## Sterktes

- **Defence in depth voor multi-tenancy:** RLS, `FORCE ROW LEVEL SECURITY`, database-rollen, GRANT-contracten, guards in de applicatielaag en e2e-isolatietests vormen samen meerdere onafhankelijke beschermingslagen.
- **Aantoonbare security:** Er zijn niet alleen ontwerpprincipes, maar ook tegenproeven, schema-conformiteitstests en tenant-isolatietests.
- **Professionele besluitvorming:** ADR’s verbinden technische keuzes — zoals Drizzle, database-rollen, identity en platformbeheer — met de rationale achter die keuzes.
- **Operationele volwassenheid:** Deployment, database-doelwitbescherming, backupcontrole, onderhoudskalender en herstelbaarheid zijn zichtbaar onderdeel van de oplossing.
- **Traceerbare featureontwikkeling:** Functionele features, zoals contractmanagement, vendorbeheer, vragenlijsten en platformbeheer, zijn gekoppeld aan ontwerpdocumenten, migraties, backend, frontend en tests.

## Voornaamste risico

De uitdaging is niet een gebrek aan architectuur, maar het beheersen van de ontstane complexiteit.

De graph omvat een groot en groeiend ecosysteem van code, migraties, tests, scripts, ADR’s, plannen en runbooks. Hierdoor ontstaan drie aandachtspunten:

1. **Kritieke knooppunten:** `DatabaseService`, sessiecontext en de scriptslaag hebben veel afhankelijkheden. Wijzigingen hierin kunnen brede gevolgen hebben en verdienen daarom een expliciet contract, beperkte verantwoordelijkheden en verplichte review.
2. **Historische versus actuele documentatie:** Besluiten en plannen uit eerdere fases blijven waardevol als historie, maar kunnen verwarrend zijn wanneer ze nog naast de actuele AWS-, OTAP- of identity-architectuur staan.
3. **Privileged databasecode:** `SECURITY DEFINER`-functies zijn een verdedigbare oplossing voor RLS-gerelateerde bootstrap- en lookupvraagstukken, maar vormen wel een verhoogd risico en moeten structureel handmatig worden beoordeeld.

## Volgende groeistap

De volgende fase is: **architectuur niet alleen bouwen en bewijzen, maar ook expliciet beheren als productonderdeel.**

Dat betekent:

- Eén kort, actueel en normatief document maken dat de werkelijke productiearchitectuur beschrijft.
- Historische plannen en vervangen besluiten archiveren of duidelijk labelen als niet-normatief.
- De belangrijkste platformgrenzen formaliseren: tenantcontext/database, sessie/authenticatie, database-rollen en RLS, deployment en backup/herstel.
- Alle `SECURITY DEFINER`-functies periodiek auditen op minimaal privilege, vaste `search_path`, GRANTs, invoervalidatie en misbruikscenario’s.
- Graphify periodiek gebruiken als architectuurcontrole, met aandacht voor groeiende god nodes, nieuwe onduidelijke relaties, documentatieconflicten en ongewenste afhankelijkheden.

## Samenvattend

De oplossing beweegt duidelijk richting een professioneel beheerde SaaS: niet omdat alle onderdelen al eenvoudig zijn, maar omdat kritieke risico’s zichtbaar worden gemaakt, technisch worden begrensd en met bewijs worden afgedekt.

De belangrijkste investering vanaf hier is het voorkomen dat de opgebouwde kennis versnipperd raakt. Houd de actuele architectuur compact, normatief en toetsbaar; behandel de kernketens als formele platformcontracts; en gebruik de graph als terugkerend instrument om complexiteit vroeg te signaleren.