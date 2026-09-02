# Evaluatie: MCM2 als twee producten (TD en AA)

## Eindoordeel

Het document is inhoudelijk sterk en pragmatisch. De hoofdkeuze — een gedeelde kern met twee afzonderlijke frontends en strak afgebakende productmodules — past goed bij twee divergerende roadmaps die nog substantiële technische fundamenten delen.

De analyse benoemt terecht dat dit geen gewone tenant-customization meer is, maar een ontwikkeling naar twee producten: een Transdev-specifiek product en een generiek, verkoopbaar AA-product. Dat onderscheid voorkomt de klassieke fout om productverschillen steeds verder weg te stoppen in tenantconfiguratie en feature flags.

## Sterke punten

- **Heldere probleemdefinitie.** Het document maakt terecht onderscheid tussen twee tenants en twee producten met divergerende roadmaps.
- **Geen premature fork.** Bij één technische onderhouder zou een fork vooral dubbel onderhoud, handmatig overzetten van bugfixes en geleidelijke technische divergentie veroorzaken.
- **Passende architectuurgrenzen.** Een gedeelde kern voor identiteit, tenantcontext, RLS en werkelijk gedeelde domeinfunctionaliteit; AA-functionaliteit als afgebakende modules; twee zelfstandige frontends.
- **Goed mail-principe.** Een gedeelde mail-capability met product-specifieke provider-implementaties voorkomt twee gekopieerde mailflows.
- **Realistische onderhouderanalyse.** Bij één maintainer is de kernuitdaging niet teamcoördinatie, maar de cognitieve last voor je toekomstige zelf. Strikte grenzen, documentatie en geautomatiseerde tests zijn daarvoor effectiever dan een kunstmatige repo-scheiding.

## Belangrijkste aanscherping

De combinatie van “één gedeelde backend-kern”, “TD deployt een subset” en “TD draait nooit een AA-only migratie” is alleen tegelijk goed uitvoerbaar wanneer TD en AA een gescheiden runtime- en waarschijnlijk database-topologie krijgen.

| Onderwerp | Gedeelde runtime/database | Gescheiden productdeployments |
|---|---|---|
| Backend | Eén draaiende API voor alle tenants | Zelfde code, apart uitgerold voor TD en AA |
| Database | Eén database met tenantisolatie | Eigen database of minimaal eigen database-omgeving per product |
| Modulemigraties | Worden technisch uitgevoerd, ook als een module voor TD niet actief is | Kunnen uitsluitend bij AA worden uitgevoerd |
| Risico | Grote blast radius en zwakkere productgrens | Meer deployment- en operationeel beheer |
| Passend bij het advies | Minder goed passend | Beter passend bij TD-subset en module-exclusiviteit |

### Advies

Maak dit expliciet als architectuurbesluit. Als Transdev werkelijk een afzonderlijk product wordt met een eigen lifecycle, branding, maildomein en mogelijk afwijkende klant- of beveiligingseisen, kies dan voor **één codebase, maar twee onafhankelijke deployments**.

De gedeelde kern is dan een gedeelde code- en testbasis, niet noodzakelijk één gedeelde productie-runtime. Dit maakt rollback, releaseplanning, incidentafhandeling en een eventuele latere ontvlechting veiliger.

## Feature flags

Het document gebruikt feature flags verstandig als productschakelaar, maar “route/tabel niet actief” verdient technische precisering. Een feature flag is primair een gedrags- en productentitlementmechanisme, geen harde beveiligings- of isolatiegrens.

Hanteer daarom drie afzonderlijke concepten:

- **Build/deployment-selectie:** welke modules fysiek zijn opgenomen en geactiveerd in TD respectievelijk AA.
- **Productentitlements:** welke modules een AA-tenant mag gebruiken, bijvoorbeeld freemium versus betaald.
- **Autorisatie:** welke gebruiker binnen een tenant bepaalde acties mag uitvoeren.

Zo voorkom je dat een flag per ongeluk als autorisatiecontrole wordt gebruikt. Route-autorisatie en database-RLS moeten onafhankelijk blijven van de zichtbaarheid in de interface, vooral bij NIS2-functionaliteit, leveranciersinformatie en vragenlijsten.

## Modulegrenzen

Een eigen schema, router-prefix en migraties zijn nuttig, maar vormen nog geen echte module als de kern alsnog direct tabellen of interne services van de module aanroept.

Leg per module minimaal vast:

- **Publieke interface:** API-routes, service-contracten en events die andere onderdelen mogen gebruiken.
- **Eigendom van data:** de module is exclusief eigenaar van haar tabellen; andere onderdelen lezen of muteren die data niet direct.
- **Afhankelijkheidsrichting:** modules mogen van core afhankelijk zijn; core hoort niet afhankelijk te worden van een optionele AA-module.
- **Lifecycle:** deployment waarin de module actief is, benodigde configuratie en veilige uitschakel- of migratiestrategie.
- **Acceptatietests:** zowel AA mét module als TD zónder module moeten deel zijn van CI.

Vertaal “module” in deze fase niet naar microservices. Voor één onderhouder is een goed gestructureerde modulaire monolith waarschijnlijk de beste balans tussen ontwikkelsnelheid, betrouwbaarheid en latere ontvlechtingsmogelijkheid.

## Mailontwerp

De `MailProvider`-gedachte is juist, maar houd de abstractie klein. Vermijd een generiek model dat alle toekomstige verschillen probeert te voorspellen; dat wordt snel ingewikkelder dan twee duidelijke adapters.

Een bruikbare scheiding is:

- **Kern:** verzendopdracht, ontvanger, berichttype, business-event, auditlog en retry-status.
- **Productadapter:** afzenderdomein, providerconfiguratie, templates, huisstijl, reply-to en eventuele compliance- of bewaartermijnen.
- **Productfrontend:** de gebruikersflow waarmee een medewerker de actie initieert.

Zo blijft de betrouwbaarheidslogica gedeeld, terwijl Transdev en AA zelfstandig hun uitstraling en verzendbeleid beheren.

## Nog vast te leggen besluiten

Hoewel IP, aandeelhouderschap en domeinkeuze terecht buiten de scope van het technische advies vallen, zijn de volgende operationele besluiten nodig voor uitvoerbaarheid:

1. **Deploymentgrens:** één of twee productieomgevingen, en één of twee databases?
2. **Releasebeleid:** kan AA vaker releasen dan TD, en hoe verloopt acceptatie bij TD?
3. **Versiebeheer:** hoe lang blijft een TD-deployment compatibel met wijzigingen aan de gedeelde kern?
4. **Observability:** aparte logs, foutmeldingen, audittrails, back-ups en dashboards per product/klantcontext.
5. **Herstelstrategie:** kan een TD-release zelfstandig worden teruggedraaid zonder AA te raken?
6. **Kosten- en beheergrens:** welke extra cloudcomponenten zijn acceptabel voor productisolatie?

## Aanbevolen vervolg

1. Leg de gewenste **runtime-topologie** vast; voorkeur: twee productdeployments vanuit één repository.
2. Definieer een `core`-contract: wat hoort er expliciet wel en niet thuis.
3. Bouw eerst de mail-capability als interface met twee adapters, omdat daar nu al concreet productverschil bestaat.
4. Breng NIS2, freemium en vragenlijsten onder in expliciete AA-modules, zonder directe afhankelijkheid vanuit core.
5. Richt CI in als matrix: TD-configuratie, AA-configuratie en minimaal één test op kerncompatibiliteit.
6. Voeg per module een korte ADR toe met doel, data-eigenaarschap, interfaces, configuratie en rollback-impact.

## Slot

De gekozen richting is goed onderbouwd en passend bij de situatie met één maintainer. Maak vooral de impliciete sprong van “gedeelde backend” naar “subset-deployment zonder AA-migraties” expliciet; daar wordt bepaald of de oplossing in de praktijk beheersbaar en veilig blijft.
