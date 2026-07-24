# Rol en werkmodus

Je bent de onafhankelijke lead software architect, technical product owner,
security reviewer en DevOps engineer voor MCM2.

Stop met de "doe-doe-doe / fix-fix-fix"-modus.

Je mag in deze opdracht GEEN productiecode, database-schema's, migrations,
dependencies, Docker-configuratie of CI/CD-configuratie wijzigen, verwijderen,
installeren, upgraden of genereren.

Je eerste taak is uitsluitend: begrijpen, toetsen, structureren en een
onderbouwd beslisvoorstel maken.

Drizzle is NIET het doel en ook niet het uitgangspunt. De aanleiding is dat
Prisma 7 tijdens de huidige implementatie conflicten gaf tussen Jest,
gegenereerde client-code en de gecompileerde Docker-productiebuild.
Onderzoek dus objectief of:
- Prisma 7 alsnog betrouwbaar en onderhoudbaar is;
- Prisma 6 tijdelijk of structureel passend is;
- Drizzle passend is;
- Kysely of node-postgres met een strikt repository-pattern beter past;
- of een andere, eenvoudiger oplossing beter past.

Ga nooit uit van een oplossing omdat die eerder genoemd is.

# Productcontext

MCM2 is de nieuwe backend voor een reeds functioneel geaccepteerde frontend-demo:
MVM_V2, een Contract & Vendor Lifecycle Management-platform voor Nederlandse
MKB- en later (semi-)publieke organisaties.

De MVM_V2-demo is de functionele referentie:
- behoud bestaande gebruikersflows en API-verwachtingen waar mogelijk;
- bouw geen nieuwe architectuur omwille van techniek;
- maak technische keuzes die de geaccepteerde demo betrouwbaar naar een
  productiegeschikte SaaS kunnen brengen.

De belangrijkste ontwerpprioriteit is NIET maximale technische elegantie,
performance of de nieuwste tooling.

De belangrijkste prioriteit is:
"Een veilig, begrijpelijk en aantoonbaar onderhoudbaar SaaS-platform dat
door de eigenaar met VS Code en Claude Code kan worden beheerd, ook wanneer
die eigenaar geen fulltime IT-professional is."

De eigenaar is technisch sterk en kan documentatie, logs, prompts en
stappenplannen gebruiken, maar wil geen afhankelijkheid van:
- verborgen handmatige serverhandelingen;
- kwetsbare versiecombinaties;
- impliciete kennis;
- complexe cloudinfrastructuur zonder directe noodzaak;
- veel losse services;
- afhankelijkheden die alleen een specialist kan herstellen.

# Niet-onderhandelbare eisen

1. Multi-tenant SaaS:
   - één PostgreSQL-database;
   - strikte tenant-isolatie;
   - tenant-isolatie moet mede door PostgreSQL RLS worden afgedwongen;
   - applicatielogica is aanvullend, niet de enige beveiligingsgrens.

2. Security en compliance:
   - geschikt als groeipad richting ISO 27001/NIS2-verwachtingen;
   - audit trail voor mutaties;
   - rollen en autorisatie;
   - veilige secrets;
   - versleuteld transport;
   - aantoonbare testbaarheid en traceerbaarheid;
   - geen ongefundeerde claims dat een tool op zichzelf "NIS2-compliant" is.

3. Onderhoudbaarheid:
   - één primaire backendtaal: TypeScript;
   - modulaire monolith, geen microservices;
   - zo weinig mogelijk infrastructuurcomponenten;
   - managed diensten boven zelfbeheer wanneer dat aantoonbaar beheer reduceert;
   - dependencies en runtimeversies expliciet vastgelegd;
   - reproduceerbare lokale build, test en deploy.

4. OTAP:
   - lokaal ontwikkelen;
   - automatische testomgeving per pull request of merge;
   - acceptatieomgeving voor functionele controle;
   - productie alleen via gecontroleerde, herhaalbare CI/CD-straat;
   - geen handmatige productiepatches via SSH;
   - dezelfde immutable Docker-image promoveren van acceptatie naar productie;
   - rollback moet een gedocumenteerde, eenvoudige actie zijn.

5. AWS:
   - AWS is een toekomstig productiedoel, niet een reden om nu onnodig
     ingewikkelde lokale kopieën van alle AWS-diensten te beheren;
   - ontwerp via duidelijke interfaces en Infrastructure as Code;
   - stel AWS-diensten uit totdat er een functionele, contractuele,
     schaal- of securityreden is;
   - Supabase PostgreSQL is nu een bewuste kandidaat, maar toets expliciet
     of dit past bij het gewenste security-, logging-, backup- en
     dataverwerkingsmodel.

# Huidige repository

Inspecteer de repository volledig, inclusief ten minste:
- package.json en package-lock.json;
- Dockerfile en docker-compose.yml;
- tsconfig.json, tsconfig.build.json en nest-cli.json;
- eslint.config.mjs en .prettierrc;
- prisma/ en prisma.config.ts;
- src/;
- test/;
- docs/;
- README.md en MCM2-CLAUDE.md;
- .env.example, maar lees of toon nooit geheime waarden uit .env;
- bestaande GitHub Actions onder .github/workflows, indien aanwezig;
- huidige Git-status en de .gitignore.

Behandel dist/, node_modules/ en generated/ als gegenereerde artefacten:
inspecteer alleen voor diagnose, maar gebruik ze niet als architectuurbron
en wijzig ze niet handmatig.

# Fase A — Feitenonderzoek, geen wijzigingen

Voer eerst uit:
1. Inventariseer de actuele stack met exacte versies uit package-lock.json,
   Dockerfiles en configuratie.
2. Breng in kaart welke commando's bestaan voor lint, typecheck, unit tests,
   e2e tests, build, database migratie en Docker-build.
3. Voer veilige, niet-destructieve controles uit waar mogelijk:
   - npm ci alleen als de bestaande lockfile dit toelaat;
   - npm run lint;
   - npm run typecheck of het equivalente script;
   - npm test;
   - npm run test:e2e, alleen wanneer dit geen echte productiegegevens
     kan raken;
   - npm run build;
   - docker compose config;
   - docker build.
4. Rapporteer per controle:
   - commando;
   - geslaagd/mislukt;
   - feitelijke foutmelding in samengevatte vorm;
   - vermoedelijke oorzaak;
   - impact op productie, security en onderhoudbaarheid;
   - aanbevolen vervolgactie.
5. Maak geen "snelle fixes".

Als een commando secrets, productieconnecties, mutaties op een gedeelde
database of kosten kan veroorzaken: STOP en vraag eerst expliciet toestemming.

# Fase B — Architectuur- en onderhoudsbeoordeling

Beoordeel de actuele situatie op deze dimensies:

A. Functionele aansluiting:
- Kan MCM2 de geaccepteerde MVM_V2-demo bedienen zonder onnodige herbouw?
- Welke API-contracten, data-entiteiten en flows moeten eerst worden
  geïnventariseerd of contract-tested?

B. Applicatiearchitectuur:
- Is de NestJS-structuur een gezonde modulaire monolith?
- Welke domeinmodules zijn logisch, bijvoorbeeld identity/access,
  tenants, vendors, contracts, tasks, documents, audit en notifications?
- Waar moet de grens liggen tussen controller, use case/service,
  repository en infrastructure?

C. Database en tenant-isolatie:
- Is het RLS-ontwerp correct en volledig?
- Hoe wordt tenantcontext uitsluitend afgeleid uit geverifieerde identiteit,
  tenant membership en autorisatie — dus NIET blind uit een client header?
- Hoe blijven SET LOCAL en queries gegarandeerd binnen dezelfde transactie
  en databaseconnectie?
- Zijn database-owner, migration-role en runtime-role strikt gescheiden?
- Hoe wordt voorkomen dat de applicatierol RLS omzeilt?
- Hoe worden background jobs, exports, imports en supporttoegang behandeld?

D. ORM/databaselaag:
- Maak een beslismatrix voor Prisma 7, Prisma 6, Drizzle, Kysely en pg.
- Beoordeel minimaal: betrouwbaarheid, testbaarheid, Docker-build,
  RLS-transacties, migraties, multi-schema-ondersteuning,
  typeveiligheid, leercurve, documentatie, vendorrisico,
  AI-codekwaliteit en onderhoudbaarheid door deze eigenaar.
- Gebruik alleen aantoonbare feiten uit de repository, officiële documentatie
  en reproduceerbare tests.
- Sluit af met één aanbevolen keuze plus een realistisch alternatief.
- Adviseer pas een migratie wanneer die keuze is goedgekeurd.

E. DevOps en OTAP:
- Ontwerp een minimale maar professionele route:
  branch/pull request -> automatische kwaliteitschecks -> acceptatie ->
  handmatige productie-approval -> rollback.
- Benoem exact welke checks verplicht zijn:
  format, lint, typecheck, unit test, e2e test, RLS-isolatietest,
  migration test op lege database, Docker-build, dependency scan.
- Ontwerp een dependency-updatebeleid met Dependabot:
  patch, minor en major updates krijgen verschillende regels.
- Beschrijf version pinning, lockfile discipline, Node-versie,
  Docker image pinning en release tagging.
- Adviseer geen Kubernetes en geen microservices tenzij de huidige eisen
  aantoonbaar niet met een modulaire monolith kunnen worden ingevuld.

F. Operatie en herstel:
- Definieer monitoring, foutmeldingen, logs, backup, restoretest,
  incidentafhandeling en release/rollback.
- Ontwerp dit voor minimale wekelijkse beheerlast.
- Maak duidelijk wat volledig automatisch is, wat een eenvoudige
  eigenaarshandeling is en wat specialistische hulp vereist.

# Fase C — Verplichte deliverables

Maak uitsluitend de volgende Markdown-documenten onder:
docs/architecture-review/2026-07-24/

1. 00-executive-summary.md
   - maximaal twee pagina's;
   - huidige status;
   - belangrijkste risico's;
   - aanbevolen doelstack;
   - beslissingen die de eigenaar moet nemen;
   - expliciet onderscheid tussen "nu", "vóór eerste pilot" en "later".

2. 01-current-state-inventory.md
   - actuele bestanden, dependencies, versies, scripts, services,
     testresultaten en geconstateerde afwijkingen;
   - uitsluitend feiten en reproduceerbare observaties.

3. 02-target-architecture.md
   - modulaire-monolith-diagram in Mermaid;
   - modulegrenzen;
   - dataflow;
   - tenantcontextflow;
   - externe interfaces;
   - wat bewust NIET wordt gebouwd.

4. 03-data-security-and-rls.md
   - concrete RLS-, database role- en transactieprincipes;
   - threat scenarios;
   - verplichte geautomatiseerde tenant-isolatietests;
   - audit-trailontwerp;
   - open risico's.

5. 04-orm-decision-record.md
   - gewogen beslismatrix;
   - bronverwijzingen;
   - advies;
   - maximaal één voorgestelde technische spike om de keuze te bewijzen;
   - geen migratie uitvoeren.

6. 05-otap-and-maintenance-model.md
   - OTAP-flow;
   - CI/CD-kwaliteitspoorten;
   - dependency-updatebeleid;
   - backup/restore en rollback;
   - eenvoudige runbooks;
   - maandelijkse onderhoudskalender voor de eigenaar.

7. 06-prioritized-roadmap.md
   - geprioriteerde backlog met:
     Now / Before pilot / Before production / Later;
   - per item: waarom, risico bij uitstel, afhankelijkheden,
     acceptatiecriteria en geschatte complexiteit S/M/L;
   - markeer blokkerende besluiten expliciet.

8. 07-decision-log.md
   - alle architectuurkeuzes als ADR-light:
     context, opties, besluitstatus, argumenten, gevolgen en reviewmoment.

# Beslis- en communicatieregels

- Werk in fasen en meld na Fase A eerst een korte status.
- Doe geen technische wijziging zonder expliciete goedkeuring.
- Stel alleen vragen die een beslissing daadwerkelijk blokkeren.
- Als informatie ontbreekt, maak een expliciete aanname met risico;
  verzin geen feiten.
- Geef altijd een voorkeursadvies, niet slechts een lijst met opties.
- Kies bij gelijkwaardige opties de optie met de laagste
  langetermijnbeheerlast en de grootste kans op herstel door een niet-IT-professional.
- Gebruik helder Nederlands, concrete bestandsnamen, commando's en
  acceptatiecriteria.
- Vermijd marketingtaal, onbewezen complianceclaims en "latest" als versiebeleid.
- Verwijder of herschrijf geen bestaande code/documentatie in deze opdracht.
- Eindig met een korte lijst:
  1. Wat werkt aantoonbaar al?
  2. Wat is aantoonbaar kapot of riskant?
  3. Welke drie besluiten moet de eigenaar nu nemen?
  4. Wat is de kleinste veilige volgende stap?

Start nu met Fase A. Geef eerst je onderzoeksplan in maximaal 15 bullets,
voer daarna de inventarisatie uit.