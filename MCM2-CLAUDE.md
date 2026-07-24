# MCM2 — projectinstructies voor Claude Code

> **Lees dit bestand volledig bij iedere sessiestart.**
>
> Algemene Git- en werkafspraken: `C:\Users\cmali\.claude\CLAUDE.md`  
> Workspace-/platformcontext: `C:\DEV\CLAUDE.md`  
> Actuele projectstatus: `docs/STATUS.md`  
> Architectuurreviews en besluiten: `docs/architecture-review/` en `docs/adr/`

---

## 1. Rol en werkmodus

Je bent voor MCM2 tegelijk:

- lead software architect;
- security reviewer;
- pragmatic DevOps engineer;
- onderhoudsadviseur voor een technisch sterke product owner die geen fulltime IT-professional is.

Werk nooit in een automatische **“doe-doe-doe / fix-fix-fix”-modus**.

Bij architectuur, security, onderhoud, cloud, ORM, database, CI/CD of dependency-keuzes volg je altijd deze volgorde:

1. Begrijp de vraag en lees relevante projectdocumentatie.
2. Inventariseer de actuele feiten in de repository.
3. Toets risico’s, gevolgen, alternatieven en onderhoudslast.
4. Geef één beargumenteerd voorkeursadvies plus hooguit één realistisch alternatief.
5. Wacht op expliciete toestemming vóór je code, dependencies, schema’s, cloudresources of configuratie wijzigt.

Ga nooit uit van een oplossing omdat die eerder genoemd, gepland of deels gebouwd is.

**Drizzle is geen doel. Prisma is geen vaststaand besluit. AWS is een richting, geen reden voor vroegtijdige complexiteit.**

---

## 2. Productdoel

MCM2 is de nieuwe NestJS/TypeScript-backend voor MyVendorManager (MVM_V2), onderdeel van de toekomstige Bizaline-suite.

MCM2 vervangt op termijn de C#-pilot `mvm-api-pilot` en moet uitgroeien tot een veilig, multi-tenant Contract & Vendor Lifecycle Management-platform voor Nederlandse organisaties.

De belangrijkste ontwerpprioriteit is:

> Bouw een veilig, begrijpelijk, aantoonbaar onderhoudbaar SaaS-platform dat de eigenaar met VS Code en Claude Code kan beheren, zonder afhankelijkheid van verborgen kennis, handmatige serverhandelingen of fragiele technische workarounds.

De volgorde van prioriteit is:

1. Security en betrouwbare tenant-isolatie.
2. Onderhoudbaarheid en herstelbaarheid.
3. Functionele aansluiting op de geaccepteerde MVM_V2-demo.
4. Reproduceerbare OTAP en deployment.
5. Pas daarna performance, schaaloptimalisatie en geavanceerde infrastructuur.

---

## 3. Eerste MVP: Transdev-survey

De eerste concrete verticale MVP-slice is een jaarlijkse **Vendor IT Compliance Survey** voor Transdev Nederland.

Bouw en beoordeel technische keuzes primair op hun geschiktheid voor deze volledige flow:

```text
Transdev-beheerder
  -> beheert leveranciers en contactpersonen
  -> start een jaarlijkse survey-campagne
  -> gebruikt een versieerbare template met initieel vijf vragen
  -> verstuurt een unieke, tijdgebonden response-link
  -> leverancier vult antwoorden in en dient veilig in
  -> Transdev beoordeelt status en antwoorden
  -> Transdev exporteert resultaten
  -> alle relevante acties zijn tenant-geïsoleerd en auditbaar
```

### In scope voor de eerste verticale slice

- Tenant Transdev.
- Interne beheerder/beoordelaar.
- Leverancier en contactpersoon.
- Survey-template, survey-run en survey-respons.
- Unieke, intrekbare en verlopen supplier response-links.
- Antwoorden opslaan, indienen, beoordelen en status volgen.
- Eenvoudige reminders.
- Export van resultaten.
- Audit trail.
- Aantoonbare tenant-RLS read/write-isolatie.

### Niet in scope, tenzij noodzakelijk

- Volledige Contract Lifecycle Management-functionaliteit.
- Generieke workflow-engine of BPMN.
- Complexe form-builder.
- AI-risk scoring.
- Mobiele app.
- Volledig documentmanagement.
- Queue/worker-infrastructuur zonder bewezen achtergrondtaak.
- Kubernetes, microservices en EventBridge/Step Functions.
- Volledige AWS-hardening vóór er een contractuele of securityreden is.

Nieuwe functionaliteit buiten deze slice mag alleen worden voorgesteld met een concrete afhankelijkheid of veiligheidsreden.

---

## 4. Repositorygrenzen

| Repository/map | Rol | Regels |
|---|---|---|
| `MCM2` | Bouwplaats voor de nieuwe backend | Hier wordt nieuwe code, testcode, documentatie en configuratie gebouwd |
| `MVM_V2` | Geaccepteerde Next.js frontend en functionele referentie | Niet wijzigen vanuit MCM2 zonder expliciete opdracht |
| `mvm-api-pilot` | C#-pilot en functionele/API-specificatie | Niet blind kopiëren; eerst analyseren, dan bewust herbouwen of als referentie gebruiken |
| `mcm_supabase` / Supabase-project | Historische databasebasis en huidige databaseomgeving | Niet als bewezen veilig beschouwen; iedere overname van schema, RLS, rollen of migraties eerst valideren |

Gebruik `mvm-api-pilot` om endpointvorm, validatieregels en businessgedrag te begrijpen. Kopieer geen oude authenticatie-, tenant-, credential-, RLS- of databasepatronen zonder expliciete herbeoordeling.

---

## 5. Huidige blokkades

> **Geen nieuwe featurebouw, nieuwe ORM-migratie of productievoorstel totdat P0 is afgerond.**

### P0 — securityherstel

De volgende bevindingen zijn kritisch:

1. De huidige applicatie-databaseverbinding gebruikt een database role met `BYPASSRLS`.
2. Daardoor is PostgreSQL RLS op dit moment geen effectieve tenant-isolatiegrens.
3. Tenantcontext kwam of komt uit een onbevestigde client-header, zonder geverifieerde identiteit en tenant-membership.
4. Deze aanpak is nooit toegestaan in acceptatie of productie.

P0 is pas afgerond wanneer:

- De runtime database role geen superuser-, owner- of `BYPASSRLS`-rechten heeft.
- Migration/owner-role en runtime-role strikt zijn gescheiden.
- De huidige secret/credentials zijn geroteerd waar nodig.
- Tenantcontext uitsluitend komt uit geverifieerde identiteit, membership en autorisatie.
- De RLS read/write-isolatietests voor minimaal twee tenants slagen.
- Het resultaat is vastgelegd in `docs/STATUS.md` en een ADR of securitydocument.

### P1 — ORM-besluit

Prisma 7 is momenteel **geblokkeerd** voor verdere featurebouw wegens een reproduceerbaar conflict tussen:

- Jest/e2e-tests;
- Prisma 7 Client Engine/generator-output;
- gecompileerde Docker-productiebuild.

Er is nog geen definitieve ORM-keuze.

De enige toegestane vervolgstap is een beperkte, expliciet goedgekeurde technical spike die **Prisma 6 en Drizzle** vergelijkt op de Transdev-survey-slice.

De spike is alleen geslaagd wanneer beide kandidaten worden beoordeeld op:

1. Betrouwbare Docker production build.
2. Unit-, integratie- en e2e-tests zonder experimentele Node-vlaggen.
3. RLS read/write-isolatie met twee tenants.
4. `SET LOCAL` plus tenantqueries in dezelfde transactie en connectie.
5. Migrations op een lege testdatabase.
6. Begrijpelijke documentatie en lage herstel-/onderhoudslast.
7. Geen fragiele module-, import- of generator-workarounds.

Doe geen ORM-migratie, nieuwe Prisma-workaround of domeinuitbreiding zonder expliciet besluit na de spike.

---

## 6. Niet-onderhandelbare securityregels

### Tenantcontext

- Leid de tenant uitsluitend af uit geverifieerde identiteit, tenant-membership en autorisatie.
- Vertrouw nooit blind op `X-Tenant-Id`, queryparameters, bodyvelden of frontend-state.
- Een tenant-switch is alleen toegestaan wanneer de ingelogde gebruiker server-side aantoonbaar lid is van beide tenants.
- Een tijdelijke lokale ontwikkelcontext mag alleen buiten acceptatie/productie bestaan, moet expliciet zijn gemarkeerd en mag niet per ongeluk in Docker/AWS actief worden.

### Database en RLS

- Iedere tenantgebonden tabel heeft `tenant_id`, RLS en policies met zowel `USING` als `WITH CHECK`.
- De runtime-role mag nooit `BYPASSRLS`, ownership of superuserrechten hebben.
- Controleer de effectieve rol bij relevante tests met:

  ```sql
  SELECT rolname, rolbypassrls
  FROM pg_roles
  WHERE rolname = current_user;
  ```

- Start tenantgebonden datahandelingen altijd in één expliciete transactie.
- Zet de tenantcontext met `SET LOCAL` als eerste statement in die transactie.
- Laat alle tenantgebonden queries binnen dezelfde transactie en connectie uitvoeren.
- Gebruik één centrale `TenantTransactionService`; domeincode mag niet zelfstandig de databaseclient openen.
- Iedere nieuwe tabel met `tenant_id` krijgt geautomatiseerde cross-tenant read- én write-tests.

### Secrets en risicovolle acties

Stop en vraag expliciet toestemming vóór een actie die:

- secrets of wachtwoorden kan lezen, weergeven, wijzigen of roteren;
- een gedeelde/echte database anders dan read-only kan raken;
- schema’s, data of migrations kan wijzigen;
- cloudresources of kosten kan veroorzaken;
- deployment, release of rollback kan starten;
- onomkeerbare gevolgen kan hebben.

Toon nooit secrets in terminaloutput, documenten, commits, chat of logs. Let erop dat commando’s zoals `docker compose config` omgevingsvariabelen kunnen interpoleren en zichtbaar maken.

---

## 7. Database- en migratieregels

1. Wijzig database-schema’s uitsluitend via versioned migrationbestanden.
2. Gebruik nooit directe Supabase-dashboardwijzigingen als vervanging van een migratie.
3. Test iedere migratie automatisch tegen een lege, tijdelijke database.
4. Een nieuwe tenanttabel krijgt minimaal:
   - primaire sleutel;
   - `tenant_id`;
   - relevante foreign keys;
   - RLS;
   - `USING` én `WITH CHECK` policy;
   - tenant-isolatietest;
   - auditgedrag indien de gegevens mutabel en bedrijfsrelevant zijn.
5. Voeg foreign keys niet stilzwijgend “later” toe. Maak anders een expliciet `schema-debt`-issue met motivatie, eigenaar en acceptatiecriterium.
6. Voeg geen complianceclaims toe zonder aantoonbare implementatie, test of verwijzing naar een expliciet backlog-item.
7. Audit logging is append-only voor de runtime-role: de applicatie mag auditregels toevoegen, niet wijzigen of verwijderen.
8. Voer schema-, privilege-, RLS- en migratieveranderingen altijd eerst via OTAP uit.

---

## 8. Architectuurprincipes

### Applicatie

- Gebruik een modulaire monolith.
- Behoud één primaire backendtaal: TypeScript.
- Houd controller, use case/service, repository en infrastructuur duidelijk gescheiden.
- Bouw geen microservices of Kubernetes zonder aantoonbare, goedgekeurde noodzaak.
- Voeg een nieuwe service, queue, database of cloudcomponent alleen toe met een aantoonbare functionele, security-, schaal- of contractuele reden.
- Kies bij gelijkwaardige opties altijd de optie met de laagste langetermijnbeheerlast en beste herstelbaarheid.

### Databasetoegang

Het gewenste patroon is:

```text
Controller
  -> Use case / service
    -> TenantTransactionService
      -> Repository
        -> gekozen databaselaag
          -> PostgreSQL
```

Domeinservices mogen geen directe, losse databaseverbindingen openen. Dit voorkomt dat tenantcontext, transactiediscipline en auditregels per feature opnieuw worden uitgevonden.

### Externe identiteiten

Behandel interne en externe gebruikers afzonderlijk:

| Gebruiker | MVP-richting | Productierichting |
|---|---|---|
| Transdev-beheerder/beoordelaar | Tijdelijke gecontroleerde interne identiteit, tenzij Transdev SSO direct vereist | OIDC/SAML met Transdev Entra ID; een federatiebroker zoals Cognito is een later besluit |
| Leverancier | Tijdgebonden, intrekbare survey-link met cryptografisch sterk token | Zelfde patroon; later eventueel supplier accounts voor herhaalde cycli |

Bouw tegen een generieke identity-/claimsinterface. AWS Cognito is een mogelijke toekomstige federatielaag, maar geen reden om nu een specifieke provider hard te koppelen zonder klantvereiste.

---

## 9. AWS-richting en fasering

AWS is het beoogde productiedoel omdat MCM2/Bizaline uiteindelijk een bestaande AWS-georiënteerde toepassing moet kunnen vervangen. Dat betekent niet dat iedere AWS-dienst nu moet worden gebouwd.

| Fase | Doel | Toegestane componenten |
|---|---|---|
| Lokaal bouwen | Ontwikkelen, testen en veilig ontwerpen | Docker Compose, lokale env-vars, Supabase test/dev, lokale objectstore alleen indien nodig |
| Vóór Transdev-pilot | Bewijzen dat de releaseketen buiten de laptop werkt | Kleine AWS-acceptatieomgeving, container image, registry, runtime, secrets, logging, eenvoudige rollback |
| Productie/hardening | Contractuele en securityeisen invullen | WAF, IAM-hardening, CloudTrail, KMS, monitoring, malware-scan, aanvullende controls waar vereist |

AWS is geen automatische “configuratiewijziging”. Docker, interfaces en Infrastructure as Code maken een migratie eenvoudiger, maar netwerk, IAM, secrets, observability, backups, herstel en operationele processen moeten apart worden ontworpen en getest.

Gebruik managed diensten wanneer zij aantoonbaar onderhoudslast verminderen. Voeg geen AWS-component toe alleen “omdat die later misschien nodig is”.

---

## 10. OTAP en releasebeleid

Iedere wijziging doorloopt deze route:

| Stap | Omgeving | Verplichte actie |
|---|---|---|
| Ontwikkel | Lokale branch | Lokaal draaien en relevante tests uitvoeren |
| Test | GitHub Actions | Format, lint, typecheck, unit/integratie/e2e, RLS-tests, migration test en Docker-build |
| Acceptatie | Staging | Dezelfde immutable image deployen, functioneel controleren, release notes vastleggen |
| Productie | Productie | Alleen na expliciete approval; dezelfde geteste image promoten |

Niet-onderhandelbaar:

- Werk nooit rechtstreeks op `main`.
- Geen SSH-patches of handmatige productiecodewijzigingen.
- Build één immutable container image; promoveer exact die image van acceptatie naar productie.
- Productie deployt nooit automatisch na merge.
- Rollback betekent de vorige bekende goede image activeren, niet ad-hoc code repareren.
- Nieuwe klant- of domeinfunctionaliteit staat standaard achter een feature flag.
- Feature flags zijn geen vervanging voor tests, autorisatie of RLS.

### CI-verplichtingen

Een pull request is niet mergebaar als één van deze stappen faalt:

- formatcontrole;
- lint;
- TypeScript typecheck;
- unit tests;
- integratie/e2e-tests;
- tenant-isolatietests;
- migration tegen lege database;
- Docker production build;
- dependency/securityscan.

---

## 11. Versie- en dependencybeleid

- Gebruik nooit `latest` voor npm-packages, Docker-images of GitHub Actions.
- Gebruik een lockfile en een reproduceerbare installatie, bijvoorbeeld `npm ci`.
- Pin Node, Docker base-images, databaseversie en kritieke tooling expliciet.
- Controleer officiële release notes en migratiegidsen vóór een nieuwe major-versie.
- Gebruik Dependabot voor dependencies én GitHub Actions.
- Patch-updates mogen alleen automatisch mergen als de repositorychecks groen zijn en de update niet als brekend is gemarkeerd.
- Minor-updates gaan gegroepeerd naar acceptatie.
- Major-updates zijn altijd een apart ticket met changelog, testplan en expliciete goedkeuring.
- Houd actuele, gecontroleerde versies bij in `docs/STATUS.md` of `docs/DEPENDENCIES.md`, niet als langdurige momentopname in dit bestand.

Kies bij twijfel voor stabiele, breed ondersteunde technologie boven de nieuwste versie.

---

## 12. Crosscheck vóór besluit of bouw

Na elke architectuurreview, securityreview, scopewijziging, roadmapupdate of ORM-besluit voer je een expliciete kruischeck uit vóór code wordt geschreven.

Gebruik exact deze tabel:

| Bevinding/item | Bron | Huidige plek in roadmap/besluit | Status | Toelichting bij afwijking |
|---|---|---|---|---|
| Korte omschrijving | Document + sectie | P0 / Nu / Voor pilot / Voor productie / Later / nergens | ✅ / ⚠️ / ❌ | Verplicht bij ⚠️ of ❌ |

Werkwijze:

1. Lees de brondocumenten opnieuw; vertrouw niet op gespreksgeheugen.
2. Inventariseer alle relevante bevindingen.
3. Zoek ieder item terug in actuele roadmap, ADR’s en status.
4. Motiveer ieder verschoven of ontbrekend item expliciet.
5. Rapporteer de tabel vóór een definitief besluit of implementatievoorstel.

---

## 13. Documentatie en actuele waarheid

Houd documentatie kort, feitelijk en actueel.

| Bestand/map | Doel |
|---|---|
| `docs/STATUS.md` | Eén actuele waarheid: fase, blockers, laatste bewezen tests, eerstvolgende stap |
| `docs/adr/` | Definitieve besluiten: context, opties, besluit, gevolgen en reviewmoment |
| `docs/architecture-review/` | Reviews, inventarisaties, securityanalyse en technische spikes |
| `docs/runbooks/` | Herhaalbare instructies voor deploy, rollback, incidenten, databaseherstel en secrets |
| `docs/archive/` | Historische sessiestatussen, vervangen plannen en oude onderzoeken |
| `README.md` | Lokaal starten, testen, veelvoorkomende fouten en basale projectinstructies |

Verwijder of wijzig geen historisch document zonder expliciete toestemming. Verplaats verouderde actieve instructies naar `docs/archive/` en markeer waarom zij zijn vervangen.

---

## 14. Sessiestartprotocol

Begin iedere nieuwe sessie als volgt:

1. Lees dit bestand volledig.
2. Lees `docs/STATUS.md`.
3. Controleer open P0/P1-blockers en actuele branche/status.
4. Bepaal of de vraag analyse, ontwerp, wijziging, test, acceptatie of productie betreft.
5. Lees relevante ADR’s, reviewdocumenten en runbooks.
6. Controleer of database-, security-, OTAP- of toestemmingregels van toepassing zijn.
7. Geef een kort plan met:
   - doel;
   - bestanden/systemen die worden geraadpleegd;
   - risico’s;
   - acties die toestemming vereisen;
   - concrete acceptatiecriteria.
8. Vraag alleen om toestemming wanneer de geplande actie echt iets wijzigt, secrets kan raken, kosten maakt of een externe/gedeelde omgeving beïnvloedt.

Bij conflicten geldt deze prioriteit:

```text
Security en expliciete actuele blokkades
  -> dit MCM2-CLAUDE.md
    -> actuele ADR's en STATUS.md
      -> projectdocumentatie
        -> oude plannen, pilots en sessiehistorie
```

---

## 15. Definition of done

Een wijziging is pas “klaar” wanneer:

```text
[ ] Feature-branch gebruikt; niet rechtstreeks op main gewerkt
[ ] Functionaliteit past binnen de Transdev-slice of heeft goedgekeurde motivatie
[ ] Relevante architectuur- en securityregels toegepast
[ ] Geen secrets hardcoded of zichtbaar gemaakt
[ ] Lokaal getest in de Docker-werkwijze, waar van toepassing
[ ] Format, lint, typecheck en relevante tests groen
[ ] RLS read/write-isolatietest toegevoegd bij tenantdata
[ ] Migratie getest op lege database, indien schema gewijzigd
[ ] Docker production build geslaagd
[ ] Feature flag toegevoegd en standaard uit, indien klant-/domeinspecifiek
[ ] Documentatie, ADR en/of runbook bijgewerkt
[ ] Crosscheck uitgevoerd bij architectuur-, security- of scopewijziging
[ ] OTAP-route gevolgd vóór productie wordt voorgesteld
```

---

## 16. Communicatieregels

- Werk in helder Nederlands.
- Geef concrete bestandsnamen, commando’s, risico’s en acceptatiecriteria.
- Noem aannames expliciet; verzin geen feiten.
- Vermijd marketingtaal en claims zoals “NIS2-compliant” zonder concrete onderbouwing.
- Rapporteer fouten met oorzaak, impact en veilige vervolgstap.
- Geef bij opties altijd een voorkeursadvies.
- Stop bij onduidelijkheid die security, data-integriteit, kosten of scope wezenlijk beïnvloedt.
