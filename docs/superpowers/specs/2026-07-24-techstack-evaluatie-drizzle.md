# MCM2 — Techstack ter evaluatie

**Datum:** 2026-07-24
**Status:** ter beoordeling door een derde partij, vóór verdere implementatie
**Aanleiding:** tijdens de bouw van Fase 0 bleek de oorspronkelijk geplande ORM (Prisma, versie 7) een structureel, nog onopgelost architectuurconflict te hebben tussen testomgeving (Jest) en gecompileerde productie-build (Docker). Dit document legt de use case, de voorgestelde architectuur en de volledige techstack vast, inclusief de motivatie voor de ORM-wissel naar Drizzle.

---

## 1. Use case

MCM2 is de nieuwe backend van het MVM_V2-platform: een Contract & Vendor Lifecycle Management (CLM/VLM)-systeem voor Nederlandse MKB-organisaties. Het systeem beheert leveranciers (vendors), contracten, taken, issues, certificeringen en compliance-documentatie, met een audit-trail voor elke wijziging.

Kernkenmerken die de architectuur bepalen:

- **Multi-tenant SaaS**: één database, meerdere klanten (tenants), strikte data-isolatie tussen tenants verplicht.
- **Compliance-gedreven**: de eindklanten van MVM_V2 gebruiken het platform mede om aan NIS2/ISO27001-verplichtingen te voldoen — dat stelt eisen aan auditlogging, toegangscontrole en aantoonbare data-encryptie.
- **Niet-technische opdrachtgever**: het project wordt aangestuurd door iemand zonder IT-achtergrond. Onderhoudbaarheid en "fool-proof"-code wegen zwaarder dan maximale performance of minimale abstractie.
- **Vervangt een bestaande C#/.NET-pilot** (`mvm-api-pilot`) die als functionele specificatie dient (endpoint-vorm, business-logica), niet als technische bron.
- **Bouwt vanaf dag 1 AWS-vormig**, zonder al AWS te gebruiken: Docker Compose lokaal met services die 1-op-1 corresponderen met hun toekomstige AWS-tegenhanger (MinIO → S3, Redis/Valkey → ElastiCache), zodat de uiteindelijke migratie naar AWS ECS Fargate (gepland als Fase 5, van in totaal 5 fases) een configuratiewijziging is, geen herbouw.

---

## 2. Architectuur — huidig (Fase 0, lokaal, geen AWS-account nodig)

```
Developer machine
  └── docker-compose up
        ├── mcm2-api        NestJS, hot-reload, poort 5001
        ├── minio            S3-nabootsing (documentopslag)
        └── valkey            BullMQ-wachtrij (e-mail), Redis-protocolcompatibel
              │
              └──▶ Supabase PostgreSQL — project "clm-enterprise" (Session Pooler, eu-west-1)
                     Multi-schema: clm (kerndata), ref (lookup-tabellen), audit (audit-trail)

MVM_V2 (Next.js, apart project, ongewijzigd)
  └── NEXT_PUBLIC_API_URL=http://localhost:5001 → wijst naar mcm2-api
```

**AWS-doelarchitectuur (Fase 5, later, nog niet gebouwd):**

```
Route 53 → Application Load Balancer → ECS Fargate (Docker)
                                          ├── mcm2-api service
                                          └── frontend service (Vercel of Fargate)
                                                ├── ElastiCache (Redis/Valkey)
                                                ├── Amazon S3 (documenten)
                                                ├── AWS Secrets Manager
                                                ├── AWS Cognito (SSO-federatielaag richting Entra ID)
                                                └── Supabase PostgreSQL (ongewijzigd)
```

Aanvullende beveiligingslaag gepland vanaf Fase 0/1 (niet uitgesteld tot vlak vóór Fase 5): AWS WAF, GuardDuty, KMS (customer-managed keys), CloudTrail, SNS-alarmering, malware-scan op uploads.

---

## 3. Tenant-isolatie en Row-Level Security (kernmechanisme)

Elke tabel met `tenant_id` wordt beschermd door PostgreSQL Row-Level Security (RLS), niet alleen door applicatielogica:

1. Een `TenantMiddleware` in NestJS bepaalt per request de actieve tenant (via header, query-param, of een fallback-tenant voor lokale ontwikkeling).
2. Elke databasetransactie voert eerst `SET LOCAL app.current_tenant_id = '<uuid>'` uit, binnen dezelfde Postgres-connectie/transactie als de daaropvolgende queries.
3. RLS-policies op elke tenant-gebonden tabel vergelijken `tenant_id` met deze sessievariabele, met zowel een `USING`- als een `WITH CHECK`-clausule (voorkomt zowel lekken bij lezen als bij schrijven — een inconsistentie die in de C#-pilot wél voorkwam en hier bewust rechtgezet is).
4. Elke wijziging (create/update/delete) schrijft een regel naar een append-only `audit.audit_event`-tabel, eveneens tenant-gescopet via RLS.

Dit patroon is **onafhankelijk van de gekozen ORM** — het is een databaseniveau-garantie. De ORM moet wel toestaan dat de `SET LOCAL`-instructie en de queries in exact dezelfde transactie/connectie lopen; dat is de belangrijkste technische eis aan de databaselaag.

---

## 4. Techstack

| Laag | Keuze | Versie (2026-07-24) | Toelichting |
|---|---|---|---|
| **Runtime** | Node.js | 24 (Active LTS) | Consistent tussen dev-machine en Docker-image (`node:24-alpine`) |
| **Framework** | NestJS | 11.x | TypeScript-backend-framework, modulaire architectuur, dependency injection |
| **Taal** | TypeScript | 5.7.x | Strict mode |
| **Database** | PostgreSQL via Supabase | Postgres 17.6 (bevestigd via `SHOW server_version` op het productie-Supabase-project) | Managed Postgres, EU-regio (eu-west-1, Ierland), Session Pooler voor connectiebeheer |
| **ORM / databaselaag** | **Drizzle ORM** (voorgesteld, zie sectie 5) | Apache-2.0, v1.x (stable sinds 2025) | Vervangt het oorspronkelijk geplande Prisma 7 |
| **Validatie** | class-validator + class-transformer | 0.15.x / 0.5.x | Request-DTO-validatie in NestJS-controllers |
| **Object storage (lokaal)** | MinIO | latest (Docker) | S3-compatibele API, 1-op-1 vervangbaar door Amazon S3 in Fase 5 |
| **Queue** | Valkey (niet Redis) | 8.1-alpine (Docker) | Redis-protocolcompatibele, vrij-licentie fork (Linux Foundation, BSD-3) — Redis Ltd. zelf is sinds versie 7.4 niet meer vrij gelicentieerd (RSALv2/SSPL) |
| **Containers** | Docker + Docker Compose | — | Lokaal draaien op een AWS-vormige manier |
| **Testen** | Jest | 30.x | Unit- en e2e-tests, inclusief verplichte tenant-isolatietests (twee testtenants, cross-tenant lezen/schrijven moet geblokkeerd zijn) |
| **CI/CD** | GitHub Actions | `actions/checkout@v5`, `actions/setup-node@v5` | Lint, typecheck, test, migratie-tegen-lege-database, Docker-build |
| **Codekwaliteit** | ESLint + Prettier | eslint 9.x (flat config) | |
| **Auth (Fase 2, nog niet gebouwd)** | AWS Cognito als federatielaag vóór Entra ID | Plus-tier | Cognito routeert Microsoft-tenant-login (SAML/OIDC) door en geeft zelf het JWT uit — vervangt Entra ID niet, maakt het een configureerbare koppeling i.p.v. hardcoded enige IdP |
| **Backlog** | Linear | — | Bugs, features, expliciet gelabelde `schema-debt`-issues |

---

## 5. Waarom Drizzle in plaats van Prisma — de kern van deze evaluatie

### Wat er misging met Prisma 7

Prisma introduceerde in major-versie 7 een fundamentele architectuurwijziging: de oude Rust-binary "query engine" is vervangen door een WASM-gecompileerde "Client Engine", die **verplicht** is zodra je een driver-adapter gebruikt (nodig voor het `SET LOCAL`-in-transactie-patroon hierboven). Tijdens implementatie liepen we na elkaar tegen deze problemen aan, elk door de vorige "fix" veroorzaakt:

1. Connection-URL-configuratie verplaatst van `schema.prisma` naar een apart `prisma.config.ts`-bestand.
2. De gegenereerde client gebruikt standaard `import.meta.url` (ES-module-only syntax) — dit breekt Jest (dat CommonJS gebruikt). Fix: generator-instelling `moduleFormat = "cjs"`.
3. Die fix alleen gaf een nieuwe fout (`Cannot find module './internal/class.js'`) omdat de gegenereerde client `.js`-imports gebruikt die niet oplossen naar de onderliggende `.ts`-bronbestanden onder Jest. Fix: generator-instelling `importFileExtension = "ts"`.
4. **Die fix loste Jest op, maar brak vervolgens de gecompileerde Docker-productiebuild** — `node dist/main.js` verwacht `.js`-bestanden in de gecompileerde map, maar vindt alleen `.ts`-imports die daar niet bestaan. Er is geen instelling die zowel Jest als de gecompileerde build tevreden houdt: het is één instelling voor alle output-consumers tegelijk.
5. Los daarvan faalde een e2e-test die een echte databaseverbinding opzet met: de WASM-gebaseerde query-compiler laadt zichzelf via een dynamische `import()`, wat Jest's CommonJS-testomgeving niet ondersteunt zonder experimentele Node-vlaggen.

**Dit bleek geen incidentele configuratiefout maar een bevestigd, structureel, nog open probleem**: meerdere GitHub-issues op de officiële Prisma-repository (o.a. #28627, #28784) beschrijven exact dezelfde tegenstelling tussen Jest-compatibiliteit en gecompileerde NestJS/Docker-builds, zonder dat de Prisma-maintainers een oplossing hebben aangedragen op het moment van schrijven. Community-gebruikers rapporteren zelf geen andere uitweg te hebben gevonden dan terug te gaan naar Prisma 6.

### Overwogen alternatieven

| Optie | Beoordeling |
|---|---|
| **Prisma 6** (downgrade) | Vermijdt het probleem (oudere, bewezen binary-engine), maar is een bewust aflopende major-versie — koopt tijd, lost het onderliggende vraagstuk niet structureel op. |
| **Kysely** | Nog minder kans op dit soort tooling-conflicten (pure SQL-query-builder, geen enkele codegenerator), maar vereist volledig handgeschreven migraties en heeft een bekende beperking bij meerdere Postgres-schema's (één globale migratie-trackingtabel voor alle schemas, niet per schema) — minder passend bij de multi-schema-opzet (`clm`/`ref`/`audit`). |
| **Kaal `pg` (node-postgres) + repository-pattern, zonder ORM/query-builder** | Verworpen: verschuift alle typeveiligheid en RLS-transactiediscipline naar handmatige consistentie, zonder vangrails. Past niet bij de expliciete eis dat onderhoudbaarheid voor een niet-technische opdrachtgever zwaarder weegt dan minimale abstractie. |
| **Drizzle ORM** | Voorgesteld, zie hieronder. |

### Waarom Drizzle

- **Geen native binary, geen WASM-laag**: Drizzle is een pure TypeScript-library die dun bovenop `pg` (node-postgres) zit. Er is geen aparte "engine" die kan conflicteren tussen testomgeving en gecompileerde build — precies de klasse problemen die Prisma 7 introduceerde, bestaat hier structureel niet.
- **Multi-schema als eersteklas ondersteund**: expliciete `pgSchema()`-declaraties per Postgres-schema (`clm`, `ref`, `audit`), inclusief cross-schema foreign keys.
- **RLS/`SET LOCAL`-patroon is hoofdpad, geen workaround**: het vereiste patroon (`SET LOCAL app.current_tenant_id` + queries in dezelfde transactie) is een gedocumenteerd, veelgebruikt Drizzle-patroon voor exact deze multi-tenant-RLS-aanpak (o.a. in Supabase- en Neon-integratievoorbeelden), niet iets dat tegen de architectuur van de library in moet worden gebouwd.
- **Nu stabiel**: Drizzle bereikte v1.0 in 2025, na ruim een jaar productiegebruik voorafgaand aan die stabiele release.
- **Leesbaar voor een niet-technisch team**: het schema wordt gedeclareerd als platte, leesbare TypeScript-objecten; migraties worden gegenereerd (via `drizzle-kit`) uit dat schema, net als bij Prisma — dit blijft dus een begrijpelijk "schema-as-code"-werkproces, alleen zonder de nu problematische generator-architectuur.
- **Gratis en zonder cloud-afhankelijkheid**: Apache-2.0-licentie, geen kosten, geen enkele eigen hosted dienst waar databaseverkeer doorheen zou lopen (in tegenstelling tot bijvoorbeeld Prisma Accelerate). Alle data blijft rechtstreeks tussen de applicatiecode en de zelf beheerde Supabase-database in eu-west-1 — geen extra dataresidency-vraagstuk.
- **Kanttekening**: het optionele GUI-tool "Drizzle Studio" laadt zijn interface vanaf een door Drizzle gehost domein (de databaseverbinding zelf blijft lokaal) — relevant alleen bij gebruik van dat losse ontwikkeltool, niet voor de productiecode of -data.

### Consequentie voor reeds geschreven code

De Fase 0-implementatie was tot dit punt gevorderd: NestJS-skeleton, health-check endpoint, Docker Compose (api + minio + valkey), en een Prisma-schema met eerste migratie (4 kernmodellen: tenant, user, vendor-cluster, audit-event) — dat laatste is al tegen de Supabase-database uitgevoerd en geverifieerd (RLS-policies werken, seed-data staat). Bij een keuze voor Drizzle wordt dit schema **opnieuw opgezet in Drizzle-syntax** (functioneel identiek, geen extra databasewijziging nodig — het gaat om het opnieuw schrijven van de ORM-laag, niet om een nieuwe databasestructuur), en wordt de `PrismaService`/adapter-aanpak vervangen door een vergelijkbare `TenantTransactionService` die hetzelfde `SET LOCAL`-patroon met Drizzle implementeert.

---

*Dit document is opgesteld ter voorbereiding van een externe technische beoordeling, vóór verdere implementatie van Fase 0. Het legt de huidige stand, de architectuurkeuzes en de motivatie voor de ORM-wissel vast — het is geen bindend besluit totdat intern akkoord is gegeven op basis van deze en eventuele externe feedback.*
