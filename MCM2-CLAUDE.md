# MCM2 — NestJS Backend (AWS-gericht)
## Claude Code projectcontext — lees dit altijd volledig bij het starten van een sessie

> Git-ritueel en algemene principes staan in `C:\Users\cmali\.claude\CLAUDE.md` (globaal).
> MVM platform-context staat in `C:\dev\CLAUDE.md` (workspace).
> Dit bestand bevat alleen MCM2-specifieke aanvullingen.

---

## Wat is dit project?

MCM2 is de nieuwe backend van het MVM_V2-platform — een NestJS/TypeScript API die de C#-pilot (`mvm-api-pilot`) vervangt en vanaf de eerste regel code zo gebouwd wordt dat migreren naar AWS (ECS Fargate) een configuratiewijziging is, geen herbouw. Achtergrond en volledige afwegingen: `MVM_V2/docs/architectuur-hosting-onderhoud-sessie-2026-07-23.md` en `MVM_V2/docs/platform-architectuur-aws.md`.

**Verhouding tot de andere twee mappen — nooit uit het oog verliezen:**

| Map | Rol tijdens de bouw van MCM2 |
|---|---|
| `MVM_V2` (Next.js) | Blijft ongewijzigd. Praat via `NEXT_PUBLIC_API_URL` met mock-data of `mvm-api-pilot`; wordt herwezen naar MCM2 zodra een endpoint daar werkt. Geen frontendcode aanpassen vanuit dit project. |
| `mvm-api-pilot` (C#) | Dient als **specificatie**, niet als bron om over te nemen. Eerst opzoeken hoe de C#-versie een endpoint oplost, dan in NestJS navertalen — niet opnieuw ontwerpen. |
| `MCM2` (dit project) | De daadwerkelijke bouwplaats. |

Database: dezelfde Supabase `clm-enterprise` (Session Pooler, eu-west-1) als `mvm-api-pilot` gebruikt — schema, RLS en audit-trail blijven ongewijzigd. Zie `MVM_V2/docs/database-schema-kwaliteitsborging.md` voor de regels die hieronder in de sectie "Database-regels" zijn overgenomen.

---

## Architectuur — beknopt schema

### Lokaal (nu — geen AWS-account nodig)

```
Developer machine
  └── docker-compose up
        ├── mcm2-api        NestJS, hot-reload, poort 5001
        ├── minio            S3-nabootsing (documentopslag)
        └── redis             BullMQ-wachtrij (e-mail)
              │
              └──▶ Supabase PostgreSQL — clm-enterprise (Session Pooler)
                     (zelfde database als mvm-api-pilot, ongewijzigd schema)

MVM_V2 (Next.js, aparte map, ongewijzigd)
  └── NEXT_PUBLIC_API_URL=http://localhost:5001 → wijst naar mcm2-api
```

Alle instellingen (databaseverbinding, sleutels) komen uit omgevingsvariabelen (`.env`, nooit gecommit) — dezelfde namen/structuur als de AWS Secrets Manager-variabelen die er later voor in de plaats komen. Documentopslag wordt vanaf dag 1 tegen de S3-API gecodeerd, lokaal getest tegen MinIO — omzetten naar echte S3 is dan een configuratiewijziging, geen nieuwe code.

### AWS-doelarchitectuur (Fase 5, later)

```
Route 53 → Application Load Balancer → ECS Fargate (Docker)
                                          ├── mcm2-api service
                                          └── frontend service (Vercel of Fargate — nog open)
                                                ├── ElastiCache (Redis)
                                                ├── Amazon S3 (documenten)
                                                ├── AWS Secrets Manager
                                                ├── AWS Cognito (SSO-federatielaag — zie hieronder)
                                                └── Supabase PostgreSQL (ongewijzigd)
```

Volledige AWS-detaillering: `MVM_V2/docs/platform-architectuur-aws.md`. Dit project bouwt er *naartoe*, niet *tegenaan* — geen AWS-specifieke code vóór Fase 5, wel AWS-vormige gewoontes (Docker, env-vars, S3-API) vanaf Fase 0.

---

## Authenticatie — AWS Cognito vóór Entra ID (besluit 2026-07-24)

**Regel voor Claude Code: authenticatie (Fase 2) bouwen tegen AWS Cognito, nooit rechtstreeks tegen Microsoft's MSAL/Entra ID-library.**

- Cognito fungeert als federatielaag: Microsoft-tenants loggen nog gewoon in via Entra ID (SAML/OIDC), Cognito routeert dat verzoek en geeft daarna zelf het JWT uit. Dit vervangt Entra ID niet — het maakt Entra ID "één geconfigureerde koppeling" in plaats van hardgecodeerd de enige, zodat een tweede IdP later een configuratie-actie is, geen herbouw.
- Configureer de user pool in de **Plus-tier** (compromised credential detection, risk-based adaptive authentication, exporteerbare activiteits-/dreigingslogs) — dit is de NIS2-onderbouwing en sluit rechtstreeks aan op `audit.access_log` en CloudWatch.
- Kosten blijven laag: federatie via SAML/OIDC kost 50 gratis/maand + $0,015/gebruiker daarna, op elke tier gelijk — bij de verwachte schaal (~2.000 actieve gebruikers) ongeveer $30/maand.
- Reden om dit nu al zo te bouwen, niet later: zelfde "goedkoopste moment"-logica als de backend-stackkeuze — rechtstreeks tegen Entra ID bouwen en er later een broker voor zetten is een herbouw; vanaf Fase 2 al via Cognito bouwen niet.
- Volledige onderbouwing: `MVM_V2/docs/architectuur-hosting-onderhoud-sessie-2026-07-23.md`, sectie 10.

---

## Aanvullende AWS-beveiligingsdiensten — groep 1 (besluit 2026-07-24)

**Regel voor Claude Code: deze zes diensten horen standaard bij de AWS-doelarchitectuur van MCM2, niet als losse "nice to have" maar als vaste basislaag — inbouwen vanaf Fase 0/1, niet uitstellen tot vlak vóór Fase 5.**

| Dienst | Waarvoor | Richtprijs/maand |
|---|---|---|
| AWS WAF | Vóór de ALB — verwacht basisniveau bij (semi)publieke inkoop/pentest | $15 – $45 |
| Amazon GuardDuty | Geautomatiseerde dreigingsdetectie | $10 – $60 |
| AWS KMS (customer-managed keys) | Maakt encryptie-at-rest aantoonbaar (lost de in `database-schema-kwaliteitsborging.md` gevonden onbewezen PII-encryptieclaim op) | $4 – $10 |
| AWS CloudTrail | Audit-trail van het AWS-account zelf, los van `audit.audit_event` | $5 – $20 |
| Amazon SNS | CloudWatch-alarmen → e-mail/Slack | $0 – $3 |
| Malware-scan op uploads (ClamAV, kleine Fargate-taak) | Vult de bestaande "quarantainezone"-regel (zie Guardrails) daadwerkelijk in — nu nog puur procedureel | $5 – $20 |

Later, pas bij een concrete trigger (niet nu al bouwen): CloudFront (alleen bij S3-hosted frontend), AWS Config/Security Hub (bij klant-audits op de infrastructuur), Amazon Macie (PII-scanning, begrenzen i.v.m. kosten bij volledige scans), EventBridge/Step Functions (orkestratie, kan later Redis/BullMQ aanvullen). Volledige pricing-onderbouwing: `MVM_V2/docs/architectuur-hosting-onderhoud-sessie-2026-07-23.md`, sectie 11 + Bijlage H.

---

## Ontwikkel- en onderhoudsproces — OTAP, altijd volledig doorlopen

Elke wijziging — bugfix, feature, dependency-update — doorloopt **alle vier** de stappen, in deze volgorde, nooit een stap overslaan:

| OTAP-stap | In dit project | Wat hier moet gebeuren |
|---|---|---|
| **O — Ontwikkel** | Lokale machine, `docker-compose up` | Code op een feature-branch (`feat/[onderwerp]`), nooit rechtstreeks op `main`. Lokaal draaien en handmatig verifiëren vóór een commit. |
| **T — Test** | GitHub Actions, bij elke push/PR | Automatisch: linten, typechecken, unit- en integratietests, migraties tegen een verse database uitvoeren (zie Database-regels), Docker-image bouwen. Faalt één stap, dan is de PR niet mergebaar. |
| **A — Acceptatie** | Staging-deploy + preview-URL | Automatische deploy naar staging na een groene Test-stap. Bij klantspecifieke wijzigingen: preview-URL delen, expliciet akkoord vragen vóór merge. Bij interne wijzigingen: zelf de staging-omgeving als laatste check doorlopen. |
| **P — Productie** | Handmatige promotie | Nooit automatisch. Een bewuste actie na Acceptatie, met feature flags standaard **uit** voor nieuwe/klantspecifieke functionaliteit — zichtbaarheid per tenant is een losse, snelle actie ná de deploy, geen nieuwe release. |

**Regel voor Claude Code: nooit voorstellen om een stap over te slaan** — ook niet bij een "kleine" wijziging, ook niet onder tijdsdruk. Een migratie die niet eerst door de Test-stap (schone-database-check) is gegaan, wordt niet naar Acceptatie of Productie voorgesteld.

---

## Benodigde tooling

| Categorie | Tool | Waarvoor |
|---|---|---|
| Runtime | Node.js LTS, NestJS CLI | De backend zelf |
| Containers | Docker + Docker Compose | Lokaal draaien op een manier die AWS-vormig is (zie Architectuur) |
| Lokale S3-nabootsing | MinIO | Documentupload/-download testen zonder AWS-account |
| Lokale queue | Redis (via Docker) | BullMQ e-mailwachtrij testen |
| Database-CLI | Supabase CLI | Migraties beheren, lokale types genereren |
| Versiebeheer | Git + GitHub | Broncode, PR's, Actions |
| CI/CD | GitHub Actions | Bouwen, testen, migratie-check, Docker-image, deploy naar staging |
| Codekwaliteit | ESLint + Prettier | Consistente stijl, geen stijldiscussies in reviews |
| Testen | Jest of Vitest | Unit-, integratie- en tenant-isolatietests |
| Backlog | Linear | Bugs, features, `schema-debt`-issues (zie Database-regels) |
| Later, vanaf Fase 5 | AWS CLI, AWS CDK, Amazon ECR | Daadwerkelijke AWS-deploy — niet eerder nodig |

---

## Database-regels — verplicht, afgeleid van `database-schema-kwaliteitsborging.md`

Deze regels bestaan omdat vergelijkbare afwijkingen al eerder zijn gevonden in `mvm-api-pilot`. Claude Code handhaaft ze zonder uitzondering:

1. **Nooit schema wijzigen buiten een migratiebestand.** Geen directe wijzigingen via de Supabase-dashboard vanuit deze workflow.
2. **Elke migratie moet foutloos draaien tegen een lege database** — dit is een verplichte CI-stap (zie OTAP-stap Test), niet optioneel.
3. **Elke nieuwe `clm.*`-tabel krijgt**: de Hay CDM-standaardkolommen, RLS ingeschakeld, én een policy met zowel `USING` als `WITH CHECK` — nooit alleen `USING`.
4. **Elke nieuwe tabel met `tenant_id` krijgt een tenant-isolatietest** (twee testtenants, lezen én schrijven cross-tenant geblokkeerd) vóórdat de migratie als voltooid geldt.
5. **Geen "FK later toevoegen"-commentaar.** Dependency-volgorde aanpassen, of een Linear-issue met label `schema-debt` aanmaken en het issuenummer in de migratie zetten.
6. **Compliance-comments** (PII, encryptie e.d.) alleen toevoegen mét verwijzing naar de implementatie of naar een Linear-issue — nooit als kale belofte.

---

## Guardrails — checklist vóór elke wijziging als "klaar" geldt

```
[ ] Feature-branch gebruikt, niet rechtstreeks op main gewerkt
[ ] Lokaal getest via docker-compose (niet los van Docker gedraaid)
[ ] Migratie (indien van toepassing) getest tegen een lege database
[ ] Nieuwe clm.*-tabel voldoet aan Database-regel 3 en 4
[ ] Geen secrets/sleutels hardcoded — alles via omgevingsvariabelen
[ ] Feature flag toegevoegd en standaard uit bij nieuwe/klantspecifieke functionaliteit
[ ] Alle vier OTAP-stappen doorlopen vóór productie-promotie wordt voorgesteld
[ ] Endpoint-vorm gecontroleerd tegen mvm-api-pilot als referentie (indien van toepassing)
```

---

## Sessiestatus — waar we gebleven zijn (laatst bijgewerkt 2026-07-24)

**Fase:** 0 (alles moet nog worden opgezet — geen code geschreven, alleen ontwerp + plan).

**Wat er al staat:**
- Git-repository geïnitialiseerd. Branch `main` bevat alleen `MCM2-CLAUDE.md` + de design-spec.
- Feature-branch `feat/fase0-skeleton-vendors` aangemaakt, bevat tot nu toe alleen het implementatieplan (nog geen code).
- Design-spec: `docs/superpowers/specs/2026-07-24-fase0-skeleton-vendors-design.md` — architectuur voor NestJS-skeleton, tenant-resolutie/RLS, eerste schone Prisma-migratie, Vendors-endpoints. Goedgekeurd.
- Implementatieplan: `docs/superpowers/plans/2026-07-24-fase0-skeleton-vendors.md` — 16 bite-sized taken (TDD, elke stap met volledige code), van NestJS-init tot handmatige MVM_V2-koppeling. Nog **niet uitgevoerd**.

**Belangrijke besluiten die in deze sessie zijn genomen (staan verwerkt in de spec):**
- Database wordt **niet** hergebouwd door de oude 16 migraties van `mvm-api-pilot` te kopiëren — volledig schone herbouw binnen hetzelfde Supabase-project (`clm-enterprise`), met de oude migraties als spec, niet als bron. Zie `MVM_V2/docs/database-schema-kwaliteitsborging.md` sectie 5 voor de volledige entiteiteninventaris (Fase 0 doet alleen tenant/user/vendor-cluster/audit_event; de rest komt endpoint-voor-endpoint mee).
- Database-toegang: **Prisma ORM** gekozen (niet Supabase JS client, niet Kysely) — expliciet omdat de opdrachtgever geen IT-professional is en fool-proof/onderhoudbaar zwaarder weegt dan minimale abstractie.
- Eerste endpoint: **Vendors, volledige CRUD** (niet alleen GET) — 1-op-1 vorm van `mvm-api-pilot/Controllers/V2/VendorsController.cs`.
- Tenant-resolutie: header → query → fallback "demo", 1-op-1 overgenomen uit de C#-pilot.
- Feature flag: wél toegepast vanaf deze allereerste implementatie (`FEATURE_VENDORS_ENABLED`, standaard uit) — bewuste keuze, afwijkend van het eerste voorstel (overslaan) na expliciete vraag aan de gebruiker.
- `NESTJS_MIGRATION_PLAN.md` (in `mvm-api-pilot`, gedateerd 2026-05-28) noemt nog "Azure Container Apps" — is achterhaald, dit project volgt AWS ECS Fargate + Cognito (besluit 2026-07-24, zie boven in dit bestand). Niet als bron gebruiken voor hosting-beslissingen, wel voor de endpoint-volgorde (vendor → contract → task → issue → cert → interaction).

**Bekend, niet-blokkerend aandachtspunt (ander project):** in `mvm-api-pilot/appsettings.Development.json` staat een Supabase-wachtwoord in leesbare tekst, waarschijnlijk al gecommit in git. Bewust geparkeerd tot na MCM2 Fase 0 — nog oppakken (roteren + uit git-historie verwijderen).

**Eerstvolgende stap:** implementatieplan uitvoeren. Bij sessiestart is nog niet gekozen tussen subagent-driven uitvoering of inline uitvoering (zie `docs/superpowers/plans/2026-07-24-fase0-skeleton-vendors.md`, sectie "Execution Handoff") — dat is de eerste vraag om te beantwoorden voordat het bouwen start.

---

## Sessiestatus — vervolg (bijgewerkt 2026-07-24, sessie 2)

**Uitvoeringswijze besloten:** inline uitvoeren in dit gesprek (niet subagents) — reden: gebruiker is eerder door tokenbudget heen gevlogen bij subagent-gebruik; bij dit plan (16 lineair op elkaar voortbouwende taken in één samenhangend NestJS-project) is inline zowel goedkoper als praktischer. Subagents lonen vooral bij onafhankelijke, parallelliseerbare taken — niet van toepassing hier.

**Blocker gevonden bij start van Taak 1:** Docker is niet geïnstalleerd op deze machine (`docker --version` faalt zowel in Git Bash als PowerShell). Dit blokkeert Taak 3 (Docker Compose), Taak 13/14 (e2e-tests tegen lokale database) en Taak 16 (volledige stackverificatie) — niet Taak 1, 2, 4–12 (skeleton, Prisma-schema, unit-tests met mocks kunnen zonder Docker).

**Gebruiker koos:** eerst Docker Desktop installeren (niet "doorwerken zonder Docker"), om het plan strikt in volgorde te kunnen uitvoeren. Dit vereist WSL2-installatie + herstart van de computer — actie op de gebruikers eigen machine, buiten bereik van Claude Code.

**Nog niet gestart:** geen enkele taak uit het implementatieplan is uitgevoerd. Er staat nog geen NestJS-code, geen `package.json`, geen Prisma-schema — de branch bevat alleen documentatie (spec + plan + dit statusbestand).

**Eerstvolgende stap ná herstart:** controleren of Docker werkt (`docker --version` en `docker ps`), en zo ja: starten met Taak 1 (feature-branch bestaat al — `git checkout -b` in Taak 1 Step 1 overslaan/aanpassen omdat `feat/fase0-skeleton-vendors` al bestaat — NestJS-scaffold is de eerste echte actie).

---

## Sessiestatus — vervolg (bijgewerkt 2026-07-24, sessie 3: WSL2-installatietraject)

Onderweg naar Docker Desktop bleek WSL2 zelf nog niet werkend op deze machine. Traject om dat op te lossen, voor het geval een volgende sessie hier weer instapt:

1. `wsl --install` gaf "term not recognized" — bleek te komen doordat de gebruikte PowerShell-vensters niet echt verhoogd (Administrator) waren, ondanks "als administrator uitvoeren".
2. Na een écht verhoogd venster (bevestigd met `IsInRole(Administrator)` = True nodig — controleer dit eerst bij twijfel) gaf `wsl.exe --version` alsnog: "Het Windows-subsysteem voor Linux is niet geïnstalleerd."
3. Root cause gevonden via `dism.exe /online /get-featureinfo /featurename:Microsoft-Windows-Subsystem-Linux`: **State: Disabled**. (`VirtualMachinePlatform` stond wél al op Enabled.)
4. Opgelost met: `dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart` — liep door naar 100%, succesvol.
5. **Computer moet herstart worden** om de feature-wijziging actief te maken. Dit is de stap waar de gebruiker nu voor staat.

**Eerstvolgende stap ná déze herstart:** in een Administrator PowerShell `wsl --install` draaien (zou nu wel moeten werken nu de feature aan staat) — dit installeert de Linux-kernel + Ubuntu, mogelijk gevolgd door nóg een herstart. Pas daarna Docker Desktop installeren/opstarten, dan pas terug naar het Fase 0-implementatieplan (zie sessiestatus hierboven, sessie 2).

---

## Sessiestatus — vervolg (bijgewerkt 2026-07-24, sessie 4: WSL/Docker werkend, DB-connectiestring + secrets-beheer)

**WSL2 en Docker Desktop werken nu.** Geverifieerd: `wsl --version` geeft versie 2.7.10 + kernel actief; `docker info` geeft server-versie 29.6.2 en `docker ps` reageert. Geen Docker-account/login nodig voor lokaal gebruik. Alle blockers voor Taak 1 zijn opgelost.

**Database-connectiestring uitgezocht:** `mvm-api-pilot` gebruikt twee gescheiden Supabase-projecten via twee EF Core DbContexts (`Program.cs`):
- `DefaultConnection` (project `adcmcslyimttpskyzpwy`) → `AppDbContext`, oude losstaande pilot-database, alleen simpele `public.vendors`-tabel. **Niet gebruiken voor MCM2.**
- `ClmConnection` (project `agojesdovwsupidwlevh`) → `ClmDbContext`, dit ís de `clm-enterprise`-database met het volledige Hay CDM-schema (`clm.vendor`, `clm.tenant`, `audit.audit_event`, etc.). **Dit is de juiste voor MCM2's `DATABASE_URL`.**

Bevestigd via `Data/ClmDbContext.cs` doc-comment ("EF Core DbContext for the clm-enterprise Supabase project") en `.ToTable(..., "clm")`-mappings.

**Bekend lek (nog niet opgelost, staat los van MCM2):** `mvm-api-pilot/appsettings.Development.json` bevat het wachtwoord voor beide connecties in leesbare tekst. Bestand zit **niet** in `git ls-files` (dus niet gecommit in de huidige HEAD) — maar mogelijk wel in eerdere commits; nog te verifiëren. Bestand staat nog niet in `mvm-api-pilot/.gitignore`. Blijft een aparte, niet-blokkerende to-do (roteren + `.gitignore` + geschiedenis opschonen) — niet iets voor de MCM2-branch om op te lossen.

**Besluit over secrets-beheer (gebruiker gevraagd, 2026-07-24):** voor Fase 0 blijft een lokale `.env` (niet gecommit, al in `.gitignore`) de werkwijze — geen overkill voor een éénpersoons lokale devomgeving. Gebruiker wil wél **rekening houden met een toekomstige inrichting van Doppler of 1Password-CLI** zodra er met meerdere mensen gewerkt wordt of secrets centraal beheerd moeten worden. Concreet betekent dit voor nu:
- Alle secrets consequent via omgevingsvariabelen laten lopen (staat al in Guardrails-checklist) — dat is exact de vorm die Doppler/1Password-CLI later gewoon injecteren in plaats van een `.env`-bestand te lezen, dus geen aparte voorbereiding nodig, wel de discipline volhouden.
- Geen namen/structuur bedenken die specifiek zijn voor één secrets-tool — bij een latere overstap verandert alleen **hoe** de env-vars gevuld worden (`doppler run -- npm run start:dev` of `op run -- npm run start:dev` in plaats van `.env` lezen), niet de variabele-namen zelf.
- Los vervolgpunt (niet blokkerend voor Fase 0): het `appsettings.Development.json`-lek in `mvm-api-pilot` is een goede eerste concrete case om Doppler/1Password-CLI ooit op te introduceren — maar dat is een aparte sessie/beslissing, geen onderdeel van dit MCM2-implementatieplan.

**DATABASE_URL voor `.env` (Prisma-vorm, gebruiker vult zelf het wachtwoord in):**
```
DATABASE_URL="postgresql://postgres.agojesdovwsupidwlevh:<WACHTWOORD>@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?schema=public"
```
Wachtwoord staat in `mvm-api-pilot/appsettings.Development.json` bij `ClmConnection` — gebruiker vult dit zelf in, niet door Claude Code opnieuw laten tonen/kopiëren in toekomstige sessies tenzij nodig.

**Eerstvolgende stap:** Taak 1 van het implementatieplan starten (NestJS scaffolden) — feature-branch bestaat al, dus Taak 1 Step 1 (`git checkout -b`) overslaan.

---

## Sessiestart protocol

Begin elke nieuwe sessie met:

1. Dit bestand volledig lezen, inclusief de sectie "Sessiestatus" hierboven.
2. Als er een openstaande sessiestatus is: eerst die afronden vragen ("we waren bezig met X, wil je daarmee doorgaan?") vóór iets nieuws wordt gestart.
3. Vragen: "Welke endpoint of welk onderdeel bouwen we vandaag?" — bij twijfel eerst de C#-pilot als specificatie opzoeken.
4. Bevestigen: welke OTAP-stap is dit — nieuwe code (Ontwikkel), of een wijziging die al bij Test/Acceptatie staat?
5. Controleren of de Database-regels van toepassing zijn (raakt de wijziging het schema?).
6. Pas beginnen met bouwen als dit protocol doorlopen is.

---

*Dit bestand is opgesteld op 2026-07-24, gebaseerd op de architectuur-, hosting- en onderhoudssessie vastgelegd in `MVM_V2/docs/architectuur-hosting-onderhoud-sessie-2026-07-23.md` en `MVM_V2/docs/database-schema-kwaliteitsborging.md`. Bijwerken zodra nieuwe beslissingen worden genomen — dit bestand is voor MCM2 wat `CLAUDE.md` voor `MVM_V2` en `mvm-api-pilot` is.*
