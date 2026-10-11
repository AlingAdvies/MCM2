# MCM2 — technisch overzicht

**Stand:** 30-08-2026
**Repository:** `AlingAdvies/MCM2` (backend) + `MCM2-frontend` (eigen repo)
**Doel:** de OTAP-keten aantoonbaar maken op één echte tenant (AlingAdvies)

> Dit document vat samen wat het systeem is, hoe het in elkaar zit, hoe het
> getest wordt en hoe een wijziging van laptop naar productie reist. Voor de
> achtergrond en het waarom van elke keuze: zie de ADR's in `docs/adr/` en
> `docs/ARCHITECTUUR.md` — dit document vervangt die niet.

---

## Inhoud

1. [Stack](#stack)
2. [Architectuur](#architectuur)
3. [Testmethodiek](#testmethodiek)
4. [OTAP-straat](#otap-straat)

---

## Stack

### Backend

Eén NestJS-service die alle domeinlogica en de database-toegang draagt. Geen
losse microservices — bewust, gezien de schaal van dit project.

| Onderdeel | Keuze | Versie |
|---|---|---|
| Taal | TypeScript | 5.7 |
| Framework | NestJS | 11.0 |
| Database-toegang | Drizzle ORM — *alleen* als migratie-uitvoerder en typegenerator; queries in de applicatie zijn handgeschreven SQL via `sql`-tagged templates | drizzle-orm 0.45 |
| Databasedriver | pg (node-postgres) | 8.22 |
| Tokens/sessies | jose (JWT-verificatie OIDC) | 6.2 |
| Mail | Resend | — |
| Runtime | Node.js | zie `.nvmrc` (ADR-005) |

Waarom Drizzle wél voor migraties maar niet voor querybouw: de generator
(`drizzle-kit generate`) is sinds Issue #96 onbruikbaar op dit schema —
migraties worden met de hand geschreven in de stijl van
`drizzle/0015_survey_review.sql` en toegevoegd aan
`drizzle/meta/_journal.json`. De *uitvoerder*
(`drizzle-orm/node-postgres/migrator`) blijft wel actief: `scripts/migrate.js`
gebruikt hem om die handgeschreven bestanden op de database te zetten. Zie
ADR-010.

**Portabiliteit.** MCM2 is Postgres-portable (bewezen op Neon zonder
codewijziging), niet motor-portable: Row-Level Security, check-constraints en
`SECURITY DEFINER`-functies zijn PostgreSQL-specifiek en zouden bij een andere
databasemotor herbouwd moeten worden. Dat is een bewuste afweging — RLS is
precies het mechanisme dat de tenant-isolatie afdwingt.

### Frontend

Eigen repository (`MCM2-frontend`), los van de backend gebouwd en uitgerold —
elk met een eigen container-image.

| Onderdeel | Keuze | Versie |
|---|---|---|
| Framework | Next.js | 15.5 |
| UI-bibliotheek | React | 19.2 |
| Styling | Tailwind CSS | 3.4 |
| Iconen | lucide-react | — |
| E2e-browsertests | Playwright | 1.62 |

Startscherm is `/beheer` (sinds 29-08); `/` redirect ernaartoe. Deze wijziging
raakte drie losse plekken die elk apart "gezond" op `/` controleerden — CI,
`verify-volledig.js`, en de AWS-loadbalancer-targetgroup — en moest dus op
drie plekken tegelijk aangepast worden.

### Database

PostgreSQL 17, ingedeeld in drie schema's met een duidelijke scheiding van
verantwoordelijkheid:

| Schema | Rol |
|---|---|
| `clm` | Het domein: tenants, gebruikers, contracten, leveranciers, vragenlijsten, sessies. Multi-tenant met RLS. |
| `ref` | Referentiedata: codelijsten, categorieën — gedeeld over tenants heen, niet tenant-gebonden. |
| `audit` | Append-only auditspoor. Schrijvende rollen krijgen alleen `SELECT, INSERT` — nooit `UPDATE`/`DELETE`. |

Hosting: **Supabase** (Postgres-as-a-service), beide omgevingen op het gratis
plan (bewuste risicoacceptatie, ADR-011) — geen providerbackup, pauzeert na
circa 7 dagen stilte. Gemitigeerd door een eigen dagelijkse `pg_dump`, zie
[Backup & herstel](#backup--herstel).

### Identiteit & overige diensten

| Dienst | Rol |
|---|---|
| Microsoft Entra External ID | Login (OIDC/PKCE), CIAM-domein `mcm2ciam.ciamlogin.com` — provider-agnostisch opgezet (ADR-016), dus vervangbaar |
| GitHub Actions | CI/CD-uitvoerder, plus OIDC-koppeling naar AWS (geen langlevende sleutel) |
| GHCR | Container-registry voor backend- en frontend-images |
| AWS ECS (Express Mode) | Productie-hosting, twee services (`mcm2-api`, `web-23bd`) |
| Resend | Transactionele mail (uitnodigingen, vragenlijstlinks) |
| Windows Taakplanner | Dagelijkse backup + controle, draait op de laptop van de eigenaar — niet in CI |

---

## Architectuur

Vastgelegd in `docs/ARCHITECTUUR.md`: vier platformgaranties dekken de
grenzen waar een fout het duurst is. Elke garantie wijst naar de code die
haar afdwingt en de tests die haar bewijzen.

### 1. Tenantcontext & database-toegang

De actieve tenant komt uitsluitend uit een server-side sessielookup — nooit
uit een header, query-parameter of body-veld die de browser zelf kan sturen.
Zonder expliciete tenantcontext levert elke query nul rijen op, nooit "per
ongeluk alles".

### 2. Sessie & authenticatie

Login via OIDC/PKCE. Na verificatie krijgt de browser een betekenisloos
sessietoken in een `httpOnly`-cookie; alleen de SHA-256-hash staat in de
database. Sessie verloopt na 8 uur inactiviteit.

### 3. Databaserollen & RLS

De applicatie draait altijd als een rol zonder `BYPASSRLS` en zonder
eigenaarschap. Row-Level Security geldt met `FORCE` ook voor de
tabeleigenaar, op elke tenanttabel op een kort, bewust gedocumenteerd lijstje
uitzonderingen na.

### 4. Deployment & backup/herstel

Elke uitrol naar productie doorloopt vier remmen: handmatig akkoord, actueel
backupbewijs, vastgestelde migratiestand, aantoonbaar terugdraaibaar.

> Wijzig je code die een van deze vier raakt, dan hoort `docs/ARCHITECTUUR.md`
> in dezelfde wijziging bijgewerkt te worden — een garantie die er staat maar
> niet meer klopt is gevaarlijker dan geen document.

### Tenant-isolatie & RLS

Elke tenant (klant) deelt dezelfde database en dezelfde tabellen — de
scheiding zit in de rijen, niet in aparte databases.

```
Cookie (sessietoken, httpOnly)
  → Guard (TenantContextGuard lost tenant op)
    → Transactie (SET LOCAL app.current_tenant_id)
      → RLS-policy (database filtert zelf de rijen)
```

De applicatiecode kan deze grens niet per ongeluk omzeilen: elke domeinquery
loopt via `db.withTenant()`, de enige plek die een transactie opent. Geen
andere plek in de code opent zelf een databaseclient.

### Sessie & login

De sessietabel zelf (`clm.sessie`) is volledig afgesloten voor de
applicatie-rol — toegang loopt uitsluitend via drie smalle databasefuncties
die net genoeg mogen om een kip-ei-probleem op te lossen: een sessie
opzoeken kán pas nadat je weet wie je bent, maar wie je bent moet uit de
sessie komen.

| Functie | Wanneer |
|---|---|
| `sessie_aanmaken` | bij een geslaagde login |
| `sessie_oplossen` | bij elk verzoek — de heetste route in het systeem |
| `sessie_beeindigen` | bij uitloggen |

### Databaserollen

| Rol | Gebruikt voor | Rechten |
|---|---|---|
| `clm_api_runtime` | de draaiende applicatie | nooit `BYPASSRLS`, geen schema-eigenaarschap |
| `clm_migrator` | uitsluitend migraties | eigenaar van de schema's |
| `clm_readonly` / `clm_audit_reader` | rapportage, inspectie | alleen-lezen |

Tien `SECURITY DEFINER`-functies vormen de enige uitzonderingen op RLS —
allemaal met een vastgezette `search_path` en expliciete `GRANT EXECUTE`. Ze
staan getabelleerd in `docs/ARCHITECTUUR.md` en worden ieder kwartaal
geaudit.

---

## Testmethodiek

### Testlagen

Vier lagen, van snel-en-geïsoleerd naar traag-en-realistisch.

| Laag | Wat | Database? |
|---|---|---|
| Unit | `npm test` (Jest) | nee |
| E2e (backend) | `npm run test:e2e` — 44 suites tegen een echte Postgres | ja, wegwerpcontainer |
| Browsertest | Playwright tegen de volledig gebouwde stack (frontend + backend + database) | ja |
| Schema-conformiteit | `test/schema-conformiteit.e2e-spec.ts` | ja |

De schema-conformiteitstest vergelijkt `src/db/schema.ts` kolom-voor-kolom
met de echte database, en controleert RLS/FORCE/`SECURITY DEFINER` op elke
tabel.

**Waarom 44 e2e-suites op één database.** Alle suites delen dezelfde
wegwerpdatabase binnen één testrun. Vier unieke sleutels (token-hash,
tenantnaam, external_subject, storage_key) hebben bewust géén `tenant_id`
erin — een suite kan dus de hele run laten struikelen als hij een sleutel
hergebruikt. Een bewakingstest (`test/test-ids.spec.ts`) vangt dit vóór de
volledige run start.

### De verify-keten

`npm run verify:volledig` is het enige commando dat "groen" mag betekenen —
losse deelcommando's bewijzen op zichzelf niets.

```
1. Onderhoud (format · lint · typecheck)
  → 2. Unittests
    → 3. E2e (eigen wegwerpdatabase)
      → 4. Docker-build (productie-images)
        → 5. Browsertest (volledige stack)
          → 6. Schema-check (tegen echte omgevingen, alleen-lezen)
            → 7. Opruimen
```

Zet zelf een wegwerpdatabase op poort 55441 op, migreert, seedt, bouwt de
containers, draait de browsertests, en breekt alles weer af. Duurt enkele
minuten; loopt daarom altijd als achtergrondtaak.

### Wegwerp versus beschermd

Elke database draagt sinds migratie 0019 een markering in `clm.omgeving` die
zegt wat er wel en niet mee mag gebeuren.

| Markering | Betekenis | E2e-tests |
|---|---|---|
| **beschermd** | met rust laten — productie, demo, of die van een collega. Standaard, ook voor een database die zichzelf nog niet gemarkeerd heeft. | weigeren te draaien |
| **wegwerp** | een container die je zelf opzet en weer weggooit | mogen draaien |

Aanleiding was een incident (07-08) waarbij de e2e-suites tegen de
demo-database draaiden in plaats van tegen een wegwerpcontainer: de
demo-tenant verdween. `npm run test:db` zet een correct gemarkeerde
wegwerpdatabase in één stap op — rollen, migraties, markering.

---

## OTAP-straat

### De vier omgevingen

| Omgeving | Waar | Database | Markering |
|---|---|---|---|
| Ontwikkeling | eigen laptop, wegwerpcontainer | Postgres in Docker | wegwerp |
| Acceptatie | container op `saxombp` | eigen Postgres-container | beschermd |
| Staging | AWS-achtige omgeving, laatst geverifieerd | Supabase `clm-staging3` | wegwerp |
| Productie | AWS ECS Express Mode, `clm.alingadvies.nl` | Supabase `clm-enterprise` | beschermd |

**Eén echte tenant op productie: AlingAdvies zelf** — gevuld met mock-data
die behandeld wordt als klantdata (backup, RLS, geen e2e-suites eroverheen).
Die tenant dient tegelijk als demo, test én bewijs dat de keten werkt.

### CI/CD-pijplijn

**Bij elke push / pull request (`ci.yml`)**
- Format · lint · typecheck
- Docker-productiebuild
- RLS tenant-isolatietest (e2e op verse Postgres)

**Na een merge naar `main`**
- Images publiceren naar GHCR (backend + frontend, getagd met de korte commit-SHA)
- Migraties automatisch naar staging

**Naar productie (`productie-aws.yml`) — handmatig gestart**
Volledig geautomatiseerde uitrol zodra iemand akkoord geeft: migraties op
productie, dan de backend-container, dan de frontend-container. Zie de vier
remmen hieronder.

### De vier remmen naar productie

1. **Handmatig akkoord** — GitHub Environment `productie` met een verplichte
   reviewer. De uitrol pauzeert tot iemand op GitHub akkoord geeft.
2. **Backup vooraf** — `scripts/productie-poort.js` weigert bij een
   ontbrekend bewijs, een bewijs ouder dan 36 uur, of een bewijs dat zelf een
   probleem meldde.
3. **Migratiestand** — vastgelegd vóór de uitrol, na afloop teruggelezen uit
   de database en vergeleken — nooit alleen de meldtekst geloofd.
4. **Terugdraaien** — de vorige image-tags staan al klaar vóór de uitrol
   begint. Rollback is dezelfde workflow met de oude tag. Een verwijderende
   migratie is met alleen een rollback niet te herstellen — dan is een
   backuprestore nodig.

### Backup & herstel

Drie lagen, draaiend op de laptop van de eigenaar via Windows Taakplanner —
niet in CI, want CI kan niet bij die laptop.

| Laag | Wat | Wanneer |
|---|---|---|
| A — Vers | dump jonger dan 36 uur | dagelijks 07:00 |
| B — Compleet | volledigheid tegen de verwachte tabellenlijst | dagelijks 09:00 |
| C — Werkt echt | restore in een wegwerpcontainer | wekelijks, maandag 07:45 |

**Norm huidige fase:** RPO 24 uur, RTO 4 uur, restore maandelijks hertest
(ADR-011). Bij betalende klanten wordt dit RPO 15 min / RTO 2 uur, met
kwartaalrestores naar een ander project/regio.

Laag B liep tot 30-08 met een marge van 30 minuten na laag A, wat bij een
"inhaal"-start van de Taakplanner (na een periode dat de laptop uit stond)
tot een race-condition leidde — de controle las een dump die nog werd
weggeschreven. De marge is verruimd naar 2 uur.

---

*Bronnen: `docs/ARCHITECTUUR.md`, `docs/runbooks/commandos-en-omgeving.md`,
`package.json` (backend + frontend), `.github/workflows/`, ADR-001 t/m
ADR-017. Bij twijfel over een detail: die bronnen zijn leidend boven dit
overzicht.*
