# MCM2 — actuele status

## Laatst bijgewerkt
2026-07-29, tweede sessie (vragenlijst-tool t/m **stap 8**: import/export, beide seeds, vragen ophalen, indienlogica én bestandsupload; `contract_id` op `survey_run`; **guardbug gevonden waardoor UC2 in het geheel niet werkte**; 155 e2e-tests groen; **OTAP-doorloop uitgebreid naar 21 controles en geslaagd** — alles hieronder is geverifieerd, niet uit gespreksgeheugen)

## Het project bestaat uit twee repositories

Sinds 2026-07-29. Wie alleen deze repo kent, mist de helft:

| Repo | Pad | Inhoud |
|---|---|---|
| **MCM2** | `C:\dev\Work\MCM2` | NestJS-backend, database, migraties, ontwerpen, ADR's |
| **MCM2-frontend** | `C:\dev\Work\MCM2-frontend` | Next.js-frontend, leverancierportaal |

Eigen CI en eigen releasecyclus per repo — bewust, zodat een tekstwijziging in een scherm niet wacht op een databasemigratie (ADR-012). De OTAP-stack verwacht ze als zustermappen.

## Voor een nieuwe sessie: lees dit eerst

1. Lees `MCM2-CLAUDE.md` volledig (sessiestartprotocol, §14).
2. Lees dit document (`docs/STATUS.md`) volledig — het is de enige actuele waarheid over fase en blockers.
3. Verifieer git-status zelf (`git status`, `git branch -a`) tegen wat hieronder staat — vertrouw niet blind op deze snapshot. **Doe dat in beide repositories.**
4. Check de open GitHub Issues (`gh issue list --repo AlingAdvies/MCM2 --state open`) voor de actuele backlog — dit document verwijst naar issue-nummers, maar de Issues zelf zijn de bron van waarheid over wat daadwerkelijk nog open staat.
5. **Eerste concrete vervolgstap: stap 5 uit de bouwvolgorde** (`GET /survey/respond/questions`, ontwerp §10). Stap 1 t/m 4 zijn af: migratie, guard met ronde-status, import/export en beide seeds. Issue #30 (geen backups) blijft de zwaarste openstaande blokkade voor alles wat de productiedatabase raakt (#19, #25, #29), maar vraagt nu alleen nog uitvoering door de eigenaar, geen besluit — en de vragenlijst-tool loopt daar niet op vast, want die bouwt tegen wegwerpcontainers.

### Snel weer op gang komen

```bash
# Backend: tests tegen een wegwerpcontainer
# Let op: de containernaam moet minstens twee tekens hebben. Docker 29 weigert
# een naam van één teken ("Invalid container name"); oudere versies deden dat niet.
docker run -d --name mcm2test -e POSTGRES_PASSWORD=pw -p 55440:5432 postgres:17.6
docker exec -i mcm2test psql -U postgres -q < db/roles/bootstrap-roles.sql
docker exec mcm2test psql -U postgres -c "ALTER ROLE clm_migrator WITH PASSWORD 'pw'; ALTER ROLE clm_api_runtime WITH PASSWORD 'pw';"
MIGRATION_DATABASE_URL="postgresql://clm_migrator:pw@localhost:55440/postgres" npm run migrate:deploy
DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55440/postgres" npm run test:e2e   # 155 tests

# De twee vragenlijsten inlezen (tenant moet bestaan)
DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55440/postgres" \
  npm run seed:vragenlijsten -- <tenant-uuid>

# Frontend: het portaal bekijken zonder backend
cd ../MCM2-frontend && npm run dev
# → http://localhost:3000/portal/survey/demo-geldig
#   andere demo-tokens: demo-nietopen, demo-verlopen, demo-ingediend

# De volledige keten (beide productie-images): docs/runbooks/otap-doorloop.md
```

## Vragenlijst-tool — scope vastgesteld op 2026-07-29, ontwerp is bouwbaar

Op 2026-07-28 is de scope **gecorrigeerd door de opdrachtgever**: wat er gebouwd moet worden is **een tool waarmee een tenant zélf vragen opstelt**. De acht Transdev-vragen (`Transdev Annual Vendor IT Risk SurveyV1_0.md`) zijn de **eerste vulling en de PoC-casus** — niet de scope.

Op 2026-07-29 is het openstaande niveau-besluit genomen: **niveau B**. Aanleiding was `VendorComply Help en Manual.md` (in OneDrive, `Bizaline/Producten/VendorComply/`) — de handleiding van een bestaand, werkend product. Dat leverde geen wensenlijst maar keuzes die de praktijk al hebben overleefd. Het eerdere advies (niveau A) rustte op het argument dat er nog geen tweede vraagvorm was om tegen te ontwerpen; dat verviel zodra er acht bewezen vraagtypen op tafel lagen.

**Wat niveau B betekent:** de tenant kiest per vraag een antwoordtype uit acht — `instruction` (leesblok), `confirmation`, `open_text`, `yes_no`, `single_choice`, `multi_choice`, `rating`, `number`, `file_upload`.

**Scopegrens van de MVP, verduidelijkt op 2026-07-29: twee use cases, niets daarbuiten.**

| | Use case | Wie vult in | Over welke leverancier |
|---|---|---|---|
| **UC1** | Vendor compliance (bv. IT) | de leverancier zelf | zichzelf |
| **UC2** | Interne beoordeling | een Transdev-collega | dezelfde leverancier |

"Leverancier" en "dienstverlener" zijn hetzelfde: dezelfde partij, dezelfde `clm.vendor`-rij, alleen bekeken vanuit een andere kant. Bij UC1 is de leverancier de **deelnemer**, bij UC2 het **onderwerp** — hij vult daar niets in, er wordt over hem ingevuld. Omdat `subject_vendor_id` bij beide gevuld is, staan de zelfverklaring en de praktijkscore over dezelfde partij automatisch naast elkaar.

UC2 ontbrak volledig in het ontwerp en raakte het datamodel, niet alleen de tekst: `survey_response.vendor_id` was `NOT NULL` met een foreign key naar `vendor`, en de invuller is bij UC2 een collega, geen leverancier. Drie besluiten van de eigenaar bepalen hoe UC2 werkt:

- **Toegang ook via token-link** — daarmee blijft de toegangslaag ongewijzigd en wacht de MVP niet op de Entra-guard.
- **Meerdere collega's mogen dezelfde leverancier beoordelen** — `UNIQUE (run_id, vendor_id)` wordt partieel, zodat UC1's garantie "één leverancier, één respons" wél overeind blijft.
- **De interne score is niet zichtbaar voor de leverancier.** Dat volgt al uit de architectuur: een leverancier heeft geen toegang tot de Transdev-tenant, alleen één token voor één respons. Vastgelegd als testpunt 39, omdat het de garantie is die sneuvelt zodra iemand een route bouwt die op `subject_vendor_id` filtert in plaats van op `response_id`.

**Overgenomen uit VendorComply:** de acht vraagtypen, de lifecycle Draft → Active → Finished/Archived, Test Mode vóór publicatie, drie manieren om deelnemers toe te voegen, deadline met overdue-markering, en import/export als JSON-schema.

**Bewust uitgesteld:** logic jumps (voorwaardelijke logica — dat is niveau C), AI-beoordeling via Gemini, EFQM KPI-sync, Marketing Mode (publieke anonieme surveys) en radar/spider charts.

**Bewust níét gebouwd — en dit is de belangrijkste:** auto-save en "request revisions". Beide zouden vragen dat indienen terugdraaibaar wordt, en dat is precies de garantie die de zojuist gemergde tokenlaag levert. **De tokenlaag blijft daarmee ongewijzigd.** Expliciet concept opslaan blijft wél bestaan — dat is nodig omdat acht vragen met verplichte toelichtingen niet in één keer ingevuld worden en het token gehasht is, dus niet opnieuw te versturen.

Volledig ontwerp: `docs/superpowers/specs/2026-07-28-vragenlijst-ontwerp.md` — status **BOUWBAAR**, bouwvolgorde in §10.

**MVM_V2 is functioneel leidend voor de vragenlijst** (besluit 2026-07-29). Dat betekent: MVM_V2 bepaalt wát de gebruiker ziet en kan — schermen, vraagtypen, categorieën, naamgeving, workflow. MCM2 bepaalt hóé het onder water werkt — tokens, RLS, constraints, audit. Op dat tweede punt is MVM_V2 juist achterlopend: daar staan tokens onversleuteld in een `Map` in het geheugen, terwijl MCM2 ze SHA-256-hasht.

Uit de vergelijking (ontwerp §1a-bis) kwam dat beide modellen onafhankelijk grotendeels overeenkomen. Drie besluiten:

- **Categorieën gaan erin** — MVM_V2's interne beoordeling heeft er vijf met 29 vragen (Duidelijkheid, Behoefte, Kwaliteit, Kosten, Besturing). Nieuwe tabel `survey_category`; `category_id` op `survey_question` is **nullable**, want UC1 heeft geen categorieën. Inclusief `min_answers`: onder die drempel is de categoriescore `null` in plaats van een gemiddelde over te weinig punten.
- **`frameworkRef` niet** — koppelt een vraag aan een normartikel en loopt vooruit op meerdere compliance-frameworks. Nu bouwen we NIS2. De tool is al framework-agnostisch; een tweede framework is straks een tweede import.
- **`date` als negende vraagtype niet** — geen van beide use cases gebruikt het.

**De drie laatste openstaande ontwerpvoorstellen zijn op 2026-07-29 bevestigd door de eigenaar,** alle drie conform advies:

- **Een gestarte ronde bevriest de vragenlijst** (§2). Wijzigen mag altijd maar raakt alleen nieuwe rondes; een vragenlijst met een niet-`draft` ronde is uitsluitend te kopiëren naar een nieuwe versie. Zonder die regel krijg je antwoorden op vragen die inmiddels anders luiden. Al gebouwd als trigger in migratie 0005.
- **Een toelichting is óók verplicht bij "I do not confirm"** (§3). De regel luidt daarmee: *alles behalve een bevestiging vereist uitleg*, minimaal 10 tekens. Al gebouwd als CHECK-constraint in migratie 0005.
- **Een geïmporteerd e-mailadres zonder bekende vendor wordt geweigerd en teruggemeld** (§2c), met een expliciete "aanmaken"-stap. Automatisch aanmaken zou binnen een jaar dubbele records opleveren. **Nog niet gebouwd** — landt bij stap 10 (deelnemersbeheer).

Daarmee zijn alle blokkerende ontwerpvragen beantwoord. Wat nog openstaat in §11 raakt geen enkele bouwstap: of UC1 en UC2 dezelfde templates delen, hoe meerdere interne scores samengevat worden, en of een toelichting buiten `confirmation` überhaupt moet kunnen.

**Drie dingen raken bestaande, groene code** en verdienen aandacht bij het bouwen: `survey_run` krijgt drie kolommen (`status`, `is_test`, `survey_kind`), `survey_response` krijgt er drie (`subject_vendor_id`, `respondent_user_id`, `respondent_label`) waarbij `vendor_id` **nullable** wordt, en de bestaande guard moet de ronde-status meewegen naast `closes_at`/`revoked_at`. Die nullable-wijziging is een versoepeling op een tabel die vanochtend gemerged is — de UC1-garantie wordt overgenomen door een partiële unieke index plus twee CHECK-constraints, en testpunten 41 t/m 43 horen te bewijzen dat er niets weglekt.

## Frontend — repository aangemaakt op 2026-07-29 (ADR-012), nog geen schermen

**`https://github.com/AlingAdvies/MCM2-frontend`** (privé, onder AlingAdvies). Fundament staat, CI groen op beide jobs. **Nog geen schermen** — het leverancierportaal is de volgende stap.

Wat er staat: Next.js 15 + Tailwind 3 (**bewust dezelfde majors als MVM_V2**, niet de nieuwste — Next 16/Tailwind 4 zouden het overnemen van MVM_V2-componenten juist duurder maken), versies exact gepind conform MCM2-CLAUDE.md §11, TypeScript meteen op `strict` (in de backend is dat nog Issue #3; achteraf strict maken kost meer).

De **design tokens** zijn gekopieerd met bronvermelding; Tailwind leest zijn thema eruit, zodat `bg-brand-primary` en `tokens.brandPrimary` niet uit elkaar kunnen lopen. De **mock/live-schakelaar** werkt: zonder `NEXT_PUBLIC_API_URL` draait alles op mock data, en de startpagina toont welke bron actief is.

**Twee CI-poorten dwingen af wat anders alleen op papier staat:** geen leveranciersspecifieke imports (de draagbaarheidsregel), en nooit een tenant in een URL. Beide zijn geverifieerd door een overtreding uit te lokken — waarbij bleek dat de tweede poort afging op een codevoorbeeld in het commentaar van `client.ts` zelf. Dat voorbeeld is herschreven naar een beschrijving.

**Geverifieerd:** image bouwt, container serveert HTTP 200, draait als non-root. De Docker-poort controleert niet alleen dát het image start maar dat het een pagina *serveert* — een Next.js-server met een kapotte build start namelijk wel en geeft een 500.

**Let op bij het uitrollen:** `NEXT_PUBLIC_*`-variabelen worden **tijdens de build** in de bundel gebakken, niet bij het starten gelezen. Een image dat de echte backend moet gebruiken heeft die waarde nodig als build-argument. Dat is een eigenschap van Next.js, geen keuze.

### Het uitrolbesluit zelf

**Besluit: Next.js in een eigen repository, uitgerold als containerimage — de enige uitrolweg.** Tot de golive draait dat lokaal via `docker compose` naast de bestaande backend-stack. **Kosten: nul.** Bij golive is AWS de beoogde doelplek, met **App Runner** als voorkeursdienst (indicatie $25–40/mnd, *niet op de bron geverifieerd*).

Doorslaggevend criterium van de eigenaar: **robuust en eenvoudig deployen** — één manier van uitrollen die overal hetzelfde werkt, niet de snelste weg naar een deelbare link.

**Vercel is overwogen en afgewezen.** Het geeft gratis een preview-URL per PR (de acceptatiestap uit OTAP), maar introduceert een tweede uitrolweg naast de containeraanpak van de backend — die zou bij de overstap naar AWS weer afgeleerd moeten worden.

**Wat dit kost, expliciet:** iets laten zien aan de klant wordt een handeling in plaats van een link. Dat raakt precies de vraag die tot deze ADR leidde (schermen zien om het backend-ontwerp te toetsen). Het blijft mogelijk, maar lokaal.

**MVM_V2 levert drie dingen** (`C:\dev\Work\MVM_V2`, Next.js 15 / React 19):
- `src/shared/design-tokens.ts` — de huisstijl die de klant kent. **Kopiëren, niet koppelen**: een gedeeld npm-pakket is afgewezen als overhead voor twee producten met één onderhouder.
- `src/app/portal/survey/[token]/` — een leverancierportaal op token; precies MCM2's route.
- De **mock/live-schakelaar**: staat `NEXT_PUBLIC_API_URL` leeg, dan mock data; gezet, dan de echte API. Daarmee zijn schermen te beoordelen vóórdat de backend af is.

**Eén ding gaat er expliciet uit bij overname:** MVM_V2 stuurt de tenant mee in het webadres (`?tenant=demo`). Dat is exact het patroon dat MCM2-CLAUDE.md §6 verbiedt en waarom `feat/fase0-skeleton-vendors` is weggegooid. In MCM2 komt de tenant uit het token; **de API accepteert geen `tenant`-parameter.**

Raakt **#12** (acceptatieomgeving — wordt zwaarder: twee containers), **#18** (OTAP-doorloop moet front- én backend omvatten) en **#20** (base-image pinnen geldt ook voor de frontend).

## Doel
Transdev Vendor IT Compliance Survey als eerste verticale MVP-slice.

## Actieve blokkades

- **P0 — databaserol/RLS-bereikbaarheid, opgelost op 2026-07-27:** de runtime database-connectie gebruikte de Supabase-rol `postgres` (`rolbypassrls: true`). Nieuwe login-rol `clm_api_runtime` aangemaakt (`LOGIN`, erft van `clm_api`, `rolbypassrls: false`), `DATABASE_URL` in `.env` bijgewerkt. Tussentijdse extra bevinding: geen van de vier `clm_*`-rollen had ooit `USAGE`-rechten op de schemas `clm`/`ref`/`audit` — hersteld via migratie `20260727053702_grant_schema_and_table_privileges`. Zie ADR-008.
- **P0 — migration-rol en geautomatiseerde RLS-test, opgelost op 2026-07-27:** aparte login-rol `clm_migrator` toegevoegd (los van zowel `postgres` als `clm_api_runtime`), rollen-bootstrap vastgelegd in `prisma/roles/bootstrap-roles.sql` (niet in de Prisma-migratiehistorie, want rollen zijn cluster-breed). De handmatige, ad-hoc RLS-verificatie is vervangen door een geautomatiseerde test (`test/tenant-rls-isolation.e2e-spec.ts`), die nu ook in CI draait tegen een ephemere, wegwerpbare Postgres-container (`.github/workflows/ci.yml`, job `rls-isolation`) — bewust niet tegen de echte Supabase-database, om geen productiegeheim als GitHub Secret te hoeven gebruiken. Zie ADR-009 voor de volledige achtergrond, inclusief waarom dit geen Prisma-probleem was (de rolrechten-kwesties tijdens het bouwen hiervan waren PostgreSQL/Supabase-specifiek, los van de ORM-keuze).
- **P0 — deels opgelost (Issue #7):** tenantcontext kwam blind uit client-input (`X-Tenant-Id`-header of query-parameter), zonder koppeling aan geverifieerde identiteit.

  Issue #7 vraagt om **twee gescheiden mechanismen**, met verschillende voortgang:
  - **Interne beheerder (spoor 1)** — identity-infrastructuur staat en werkt. Besluit: Microsoft Entra External ID als CIAM-laag (ADR-006, herzien op 2026-07-27; AWS Cognito losgelaten vóór er resources waren aangemaakt, dus geen opruimwerk). De federatie-PoC is geslaagd: tenant `mcm2ciam.onmicrosoft.com`, federatie met `alingadvies.nl`, end-to-end doorlopen tot een geldige authorization code (`?code=...`, geen error). Volledige configuratie — tenant-ID's, client-ID's, endpoints — plus een gedocumenteerde tijdelijke blokkade die zonder configuratiewijziging verdween: `docs/architecture-review/2026-07-27/01-entra-external-id-poc-bevindingen.md`. **Nog te bouwen:** authorization code server-to-server inwisselen, claims inspecteren, NestJS-guard die de tenantcontext uit het geverifieerde ID-token afleidt. **Niet gestart.**
  - **Externe leverancier (spoor 2)** — tokengebaseerde, accountloze survey-linktoegang. **Gebouwd op 2026-07-28, CI groen, gemerged op 2026-07-29 (PR #32).** Zie het blok "Aantoonbaar werkend" hieronder voor wat precies bewezen is.

  Het tijdelijke AWS-account `727732213368` is niet langer nodig voor identity.
- **ZWAARSTE BLOKKADE (Issue #30): er zijn géén backups van de productiedatabase.** Op 2026-07-28 in het dashboard vastgesteld: `clm-enterprise` draait op het **Supabase Free Plan**, dat letterlijk meldt *"Free Plan does not include project backups"*. Niet "beperkte backups" — **geen**. Bij verlies van het project is alles weg. Free-projecten worden bovendien na circa **7 dagen inactiviteit gepauzeerd**, met verwijdering na langere inactiviteit; voor een surveylink die 30 dagen geldig moet zijn is dat op zichzelf al onwerkbaar.

  **Blokkeert #19, #25 en #29** — die wijzigen alle drie de productiedatabase, en dat zonder enig vangnet doen is onverantwoord.

  **Kostenafweging, met cijfers uit het dashboard:** Supabase Pro (~$25/mnd) geeft dagelijkse backups — te grof voor de pilotnorm van 1 uur uit ADR-011. Point-in-Time Recovery is daar een add-on van **$100/mnd bovenop Pro**. Op 2026-07-28 is gemeten dat **Neon** hetzelfde biedt voor ~$10–20/mnd (7-daags PITR-venster binnen het plan). Zie het volgende punt.

  **BESLUIT EIGENAAR 2026-07-28: de pilot draait op Supabase Free**, met bewust geaccepteerde risico's. Vastgelegd in ADR-011, sectie "Risico-acceptatie Free Plan", inclusief de voorwaarden waaronder dit verdedigbaar is en wanneer het besluit opnieuw op tafel moet. De pilotnorm is daarmee feitelijk **24 uur dataverlies mits de dagelijkse dump draait — en oneindig zonder**.

  **Mitigatie is gebouwd, niet alleen beschreven:** `npm run backup:dump` (`scripts/backup-dump.js`) draait `pg_dump` via de container `postgres:17.6`, bewaart 14 dagen, ruimt ouder op, behandelt een lege dump als mislukking, en **waarschuwt als de vorige dump ouder is dan 36 uur** — de enige signalering dat de geplande taak heeft stilgelegen. Getest tegen `clm-enterprise` (21,2 kB in 9,8s) én aantoonbaar herstelbaar: dump → restore → rechten → defaults → **20 van 20 e2e-tests groen**. Inplannen via Taakplanner: runbook stap 0.

  **Nog te doen door de eigenaar:** de dagelijkse taak daadwerkelijk inplannen, en `BACKUP_DIR` naar een tweede locatie zetten (de eigen thuisserver, OneDrive of een externe schijf). Zonder dat tweede punt beschermt de dump tegen "de database valt om", niet tegen "de laptop valt om".
- **Providerkeuze open, maar niet blokkerend (Issue #30):** op 2026-07-28 is met `scripts/provider-migratietest.js` gemeten dat MCM2 **zonder enige codewijziging** op Neon draait (`eu-central-1`, PostgreSQL 17.10): alle zes rollen uit ADR-008 aangemaakt, `CREATE ROLE` toegestaan, migraties 0000–0002 toegepast, RLS en policies compleet, **20 van 20 e2e-tests groen**. Dat MCM2 draagbaar is, is geen toeval maar een gevolg van ADR-008/009: geen Supabase Auth, Storage, Edge Functions of `supabase-js` — uitsluitend standaard PostgreSQL. De testomgeving is daarna opgeruimd (geen tabellen, geen rollen). **Prijzen zijn niet op de bron geverifieerd** en Neon is overgenomen door Databricks; controleer dat vóór een besluit.
- **Issue #19 (restore-test): kan pas ná #30.** Er valt niets te herstellen zolang er geen backup bestaat. Op 2026-07-28 verhoogd naar `priority:before-pilot`. Wél al bewezen: een handmatige dump-restore van `clm-enterprise` naar een verse container werkt end-to-end (dump 5s, restore 1s, verificatie GOEDGEKEURD). Dat bewijst een herstelpad, niet dat Supabase' eigen backup herstelbaar is — die vraag staat nog open.
- **P0 (Issue #25): Drizzle-migratiestand op de bestaande Supabase-database.** `drizzle.__drizzle_migrations` bestaat daar niet; een `migrate:deploy` zou de baseline opnieuw willen toepassen op bestaande tabellen. **Grootste onzekerheid hierbij is op 2026-07-28 weggenomen:** het schema in Supabase komt volledig overeen met de Drizzle-baseline (read-only geverifieerd, zie hieronder), dus er is geen schema-afdrijving. Uitvoeren pas ná een geslaagde restore-test (#19) — zonder bewezen herstelpad niet aan de productiedatabase komen. Zie ADR-010 en het runbook, stap 3.
- **P0 (Issue #29): de productiedatabase mist `DEFAULT gen_random_uuid()` op alle vijf UUID-primaire sleutels.** Ontdekt tijdens de restore-test van 2026-07-28. Oorzaak is de overstap, niet Drizzle: Prisma genereerde UUID's in de applicatielaag (`@default(uuid())` is een Prisma-level default, geen SQL-clausule), Drizzle verwacht dat de database het doet. Gevolg: elke `INSERT` zonder expliciete UUID faalt daar op een NOT NULL-constraint — 6 van de 20 e2e-tests falen tegen een uit productie herstelde database. **Migratie `drizzle/0002_herstel_ontbrekende_defaults.sql` lost dit op** en is bewezen tegen een exacte productiekopie (van 6 falend naar 20/20 groen), idempotent. **Nog niet toegepast op `clm-enterprise` zelf** — wacht op #30.
- **P0 — twee overige open issues, niet aangeraakt door het bovenstaande:**
  - **#1** — wachtwoordrotatie van de `postgres`-beheerrol.
  - **#3** — `tsconfig.json` naar strict-mode, module-systeem-inconsistentie oplossen.
  - ~~**#2** — `pg` en `@types/pg` als directe dependency~~ — **afgerond 2026-07-28**, bijvangst van de Drizzle-omzetting.
- ~~**P1:** ORM-keuze Prisma 6 versus Drizzle~~ — **besloten en uitgevoerd op 2026-07-28: Drizzle** (ADR-010, commit `e9df0dc`). De vergelijkende spike uit Issue #5 is niet uitgevoerd; in plaats daarvan zijn de zeven criteria uit MCM2-CLAUDE.md §5 getoetst op de daadwerkelijke omzetting. Prisma is volledig verwijderd. Bevinding die de omvang bepaalde: geen enkele regel applicatiecode gebruikte Prisma, dus het oorspronkelijke Prisma 7-conflict was op dat moment niet reproduceerbaar — er was geen code die het kon uitlokken.
- CI dekt nu format/lint/typecheck, unit tests, een Docker-productiebuild die de image ook daadwerkelijk start, én beide tenant-isolatietests (zie hieronder). De eerdere beperking "geen `docker build` in CI, uitgesteld tot na de ORM-spike" (ADR-007) is daarmee vervallen.
- Geen branch-protection op `main`: technisch geblokkeerd, niet vergeten. GitHub Branch Protection op een privérepository vereist een betaald plan (Pro/Team) voor de organisatie `AlingAdvies`; dat is nu niet actief (bevestigd via de GitHub API op 2026-07-27: `403 Upgrade to GitHub Pro or make this repository public`). Tot een upgrade is geregeld, is "nooit rechtstreeks op main werken" (MCM2-CLAUDE.md §10) uitsluitend een werkregel, geen technische afdwinging — een falende CI-check of een directe push naar `main` wordt nu niet door GitHub tegengehouden.
- **Transdev-klantvragen: drie van de vijf beantwoord op 2026-07-28** met de aanlevering van `Transdev Annual Vendor IT Risk SurveyV1_0.md` plus mondelinge aanvullingen.
  - ~~OV-6 (toelichting verplicht?)~~ — **beantwoord, deels.** Verplicht bij "Not applicable" en bij de vierde optie op een uploadvraag ("I cannot upload our Certificate or SoA because…"). Of het óók verplicht is bij "I do not confirm" is **niet bevestigd**; het ontwerp neemt aan van wel en markeert dat als aanname.
  - ~~OV-7 (upload-validatie-eisen)~~ — **beantwoord, behalve de scanvereiste.** Maximaal 2 bestanden, PDF of PNG, elk maximaal 5 MB (zo gelezen: per bestand, niet totaal). **Over een virusscan is niets gezegd** — het ontwerp bouwt er geen en benoemt dat als expliciet risico.
  - ~~OV-8 (welke vraag welk vraagtype)~~ — **achterhaald door de scopewijziging.** Alle acht vragen hebben hetzelfde antwoordtype; de vraag welk type waar hoort, wordt straks door de tenant zelf beantwoord in de tool.
  - **OV-4 (exportformaat)** — nog open.
  - **OV-9 (SMTP-details voor `contractmanagement@transdev.nl`)** — nog open, was al "volgt". Blokkeert het daadwerkelijk versturen van uitnodigingen.

  Ook nieuw vastgelegd: de vragenlijst is **alleen Engels**. Geen vertaallaag.

## Aantoonbaar werkend

- **OTAP-doorloop t/m indienen en upload (2026-07-29, tweede doorloop).** Uitgebreid van 8 naar **21 controles** in negen stappen; `scripts/otap-doorloop.js` dekt nu ook de vragenlijst, de validatie, de bestandsupload en het indienen. **Vier keer gedraaid, vier keer geslaagd** — waarvan één keer volledig vanaf niets na `down -v`.

  **De volledige keten is in de browser bewezen:** het portaal toont de echte negen Transdev-vragen uit de database met de MVM_V2-huisstijl, en vanuit diezelfde pagina levert upload → 201 en indienen → 200. De 404 die de vorige doorloop signaleerde is weg.

  **Drie bevindingen die geen enkele test zag:**

  1. **Élke upload faalde in het productie-image** — `EACCES: permission denied, mkdir '/app/var'`. Het image draait als non-root, maar `/app` is eigendom van root. De e2e-tests misten dit omdat die met `UPLOAD_DIR` naar een tijdelijke map draaien. Gerepareerd in de `Dockerfile`: map aanmaken en overdragen vóór `USER node`, `UPLOAD_DIR` expliciet in het image, plus een `VOLUME`-declaratie als waarschuwing bij uitrol.
  2. **Het opruimblok van het doorloopscript was niet meer idempotent** zodra er echt ingediend werd — `ON DELETE RESTRICT` blokkeerde het verwijderen van een respons met antwoorden. Dat de constraint in de weg zat, is het bewijs dat hij werkt.
  3. **De seed vraagt een bestaande tenant** op een verse database. Toegevoegd als stap 3b in het runbook.

  **Twee frontend-bevindingen, vastgelegd als Issue #42 en #43:** het portaal kan nog geen bestanden uploaden (waardoor een leverancier UC1 niet via de browser kan afronden — de backend kan het wél), en het rendert het `instruction`-leesblok als een vraag met keuzerondjes. Beide met de browser vastgesteld, niet beredeneerd.

- **Bestandsupload met inhoudscontrole (2026-07-29, stap 8, Issue #9).** `src/survey/bestand-validatie.ts`, `bestand-opslag.service.ts` en `bijlage.service.ts`, plus `POST /survey/respond/attachment`. **155 van 155 e2e-tests groen** in twaalf suites.

  Hiermee is de leverancierskant compleet: de validatie uit stap 6 eist een bestand bij `confirmed` op een uploadvraag, en de acht Transdev-vragen hebben er één. Zonder deze route was q1 niet bevestigend te beantwoorden.

  **De inhoud telt, niet de naam.** Extensie en de meegestuurde `Content-Type` komen allebei van de client; de server stelt het type vast uit de eerste bytes (`%PDF-`, de acht PNG-bytes) en slaat díé waarde op. Een `.pdf` met PNG-inhoud wordt geweigerd in plaats van stilzwijgend als PNG opgeslagen — anders verbergt het systeem dat de leverancier iets anders aanleverde dan hij dacht (testpunt 20).

  **De groottegrens ligt in de ontvangstlaag**, niet erna (testpunt 21). `storage_key` is servergegenereerd en bevat geen enkel teken uit de invoer, dus `../../etc/passwd.pdf` kan geen pad worden (testpunt 22).

  **Eerst naar schijf, dan de databaserij.** Andersom zou een rij zonder bestand kunnen bestaan — een dode verwijzing die pas bij downloaden opvalt. De faalvorm is nu een bestand zonder rij, en dat wordt opgeruimd in een `finally`.

  **Eerlijk over wat níét bewezen is:** de `FOR UPDATE`-vergrendeling zou twee gelijktijdige uploads serialiseren. Met die vergrendeling verwijderd bleven **alle tests groen** — gemeten, niet aangenomen. Twee transacties via dezelfde pg-`Pool` komen in de praktijk achter elkaar aan de beurt, dus de race was niet uit te lokken zonder een wachtpunt in productiecode te bouwen. `FOR UPDATE` blijft staan als bescherming voor het geval de transacties wél overlappen; de tests claimen nu alleen wat ze aantonen (het maximum houdt stand), en het commentaar zegt dat expliciet.

  **`multer` is directe dependency geworden** (exact gepind, 2.2.0). Zat er al transitief via `@nestjs/platform-express`; zelfde patroon als `pg` bij Issue #2.

  **Raakt Issue #30:** de database gaat mee in `npm run backup:dump`, bestanden op schijf niet. De certificaten zijn daarmee het enige onderdeel zonder backup — en juist het onderdeel met bewijsmateriaal.

- **Validatie- en indienlogica (2026-07-29, stap 6).** `src/survey/antwoord-validatie.ts` (de regelset, zonder database en zonder NestJS) plus `src/survey/antwoord-indienen.service.ts` (valideren, schrijven, afsluiten, auditeren — alles in één transactie). **137 van 137 e2e-tests groen** in elf suites.

  `POST /survey/respond` accepteerde een lege body en zette alleen de status; nu komen de antwoorden mee en wordt de volledige regelset uit ontwerp §5 toegepast. Drie uitkomsten: **200** ingediend, **422** met per vraag de reden, **410** bij een tweede poging.

  **De volgorde is de garantie:** eerst álles valideren, dan pas `submitted`. Faalt de validatie, dan is er niets weggeschreven en blijft de link bruikbaar (testpunt 25). Dat is essentieel — het token is gehasht en niet opnieuw te versturen, dus een half verbruikte link zou onherstelbaar zijn.

  **De drie regels die een CHECK niet kan afdwingen zitten hier**, precies zoals §3a voorspelde: geldige optiecode, rating binnen bereik, `multi_choice`-aantallen. Een CHECK kan de vraagrij niet raadplegen.

  **Tegenproef:** met drie regels uitgeschakeld (optiecode, rating-bereik, toelichtingsplicht) vielen 6 van de 25 tests om — precies de testpunten die ze bewaken.

  **Bug die het draaien blootlegde:** Drizzle geeft een JS-array door als `record` waar Postgres `text[]` verwacht. Opgelost met `ARRAY(SELECT jsonb_array_elements_text(…))`; een array-literal opbouwen zou quoting vereisen van komma's en aanhalingstekens die in een optiecode kunnen voorkomen.

  **Aangepast:** `survey-routes.e2e-spec.ts` gebruikte een template zónder vragen en kreeg daarvoor één minimale vraag. Een lege vragenlijst hoort niets af te sluiten — dat is bewust gedrag, geen bijvangst. De teardown daar moest mee: alle survey-tabellen hebben `ON DELETE RESTRICT`.

- **`GET /survey/respond/questions` (2026-07-29, stap 5).** `src/survey/vragenlijst-lezen.service.ts` plus de route op de bestaande `SurveyResponseController`, dus automatisch achter dezelfde guard. **112 van 112 e2e-tests groen** in tien suites, tegen een verse Postgres 17.6 met de volledige keten 0000 t/m 0008.

  De vorm sluit aan op het model dat het portaal al gebruikt (`MCM2-frontend/src/core/models/survey.ts`): categorieën en losse vragen gescheiden. De `config`-jsonb wordt in de **backend** naar camelCase vertaald — een frontend die dat zelf doet gaat afwijken zodra er een veld bijkomt. Alleen bekende sleutels gaan mee: `config` is een vrij veld dat de database niet bewaakt, en alles doorgeven zou betekenen dat wat daar ooit in belandt automatisch bij de leverancier terechtkomt.

  **Deze route legde een bug bloot waardoor UC2 in het geheel niet werkte** — zie het blok hieronder.

- **Guardbug: elke interne beoordeling gaf 410 (2026-07-29, migratie 0008).** `resolve_survey_token()` bepaalde `vendor_active` via een join op `survey_response.vendor_id`. Bij UC2 is die kolom bewust `NULL` — de invuller is een Transdev-collega, geen leverancier — waardoor de join niets opleverde, `vendor_active` op `false` kwam en de guard **élke** interne beoordeling afwees met "vendor-inactief".

  **Aangetoond tegen de database, niet beredeneerd:** alle drie de UC2-responses in de testset gaven `vendor_active = false`.

  Migratie 0006 is geschreven vóórdat UC2 bestond; 0005 maakte `vendor_id` nullable zonder deze functie mee te nemen. **Geen enkele test merkte het,** omdat geen enkele test een UC2-link over HTTP ophaalde — stap 5 is de eerste die dat doet.

  De fix joint op `subject_vendor_id`, die bij beide use cases gevuld en `NOT NULL` is. Voor UC1 verandert er niets, en dat is geen aanname: een CHECK uit 0005 dwingt daar `vendor_id = subject_vendor_id` af. Twee tests leggen beide kanten vast — een UC2-link wérkt, en hij werkt niet meer zodra de beoordeelde leverancier zacht verwijderd is.

  **`CREATE OR REPLACE` mocht hier wél**, anders dan bij 0006: de `RETURNS TABLE` blijft ongewijzigd, dus de rechten blijven staan.

- **Import/export van vragenlijsten en beide seeds (2026-07-29, stap 3 en 4).** `src/survey/vragenlijst-schema.ts` (vorm en validatie, zonder database), `src/survey/vragenlijst-import.service.ts` (importeer/exporteer via `withTenant`), `scripts/seed-vragenlijsten.js` en twee seedbestanden in `db/seeds/`. **89 van 89 e2e-tests groen**, in negen suites.

  **De harde regel is getest, niet alleen geschreven:** `tenant_id` komt uit de sessiecontext en nooit uit het bestand (Issue #7, testpunt 31). Een bestand dat er zelf een meebrengt wordt expliciet geweigerd in plaats van stil genegeerd. Hetzelfde geldt voor UUID's — die worden bij import nieuw gegenereerd, en de vraag→categorie-koppeling loopt via `category_key` (testpunt 48). Export bevat geen enkele UUID en geen `tenant_id`, waardoor klonen en een nieuwe versie afsplitsen dezelfde operatie zijn als exporteren-en-importeren.

  **Tegenproef gedaan, twee keer.** Met de `tenant_id`-controle uitgeschakeld viel precies testpunt 31 om. Op de seed-suite: met een verplicht gemaakt leesblok en een upload op de verkeerde vraag vielen 6 van de 15 tests om. Zonder die proef bewijzen groene tests niets.

  **Herhaalbaar:** drie opeenvolgende runs tegen dezelfde, niet-leeggemaakte database, alle drie 89/89. Het seed-script is idempotent — een tweede run slaat bestaande templates over.

  **Wat er in de database komt:** UC1 negen vragen (acht `confirmation` + één `instruction`), geen categorieën, alleen vraag 1 met upload (max 2 bestanden). UC2 29 vragen (28 `rating` op schaal 1–5 + één `open_text`) over zes categorieën met `min_answers = 3`.

  **Correctie op het ontwerp:** §2 spreekt van vijf categorieën met 29 vragen. De bron in MVM_V2 (`src/data/internal-survey-data.ts`) heeft er **zes met 28** — "Risico's" ontbreekt in het ontwerpdocument. De seed volgt de bron, want dat is wat de klant gezien heeft; een test legt het verschil vast zodat het niet stilzwijgend terugdraait.

- **OTAP-doorloop voor de volledige keten (2026-07-29, PR #34, Issue #18).** `docker-compose.otap.yml` + `scripts/otap-doorloop.js` + runbook `docs/runbooks/otap-doorloop.md`. **Beide onderdelen draaien als productie-image**, niet in ontwikkelmodus — dat onderscheid is het punt: `docker-compose.yml` draait de backend met hot reload en bewijst daarmee niets over het artefact dat uitgerold wordt.

  Acht controles: rollen en het ontbreken van BYPASSRLS, de volledige migratieketen met RLS op elke tenantgebonden tabel en beide clausules op elke policy, het draaien van beide images, het guard-gedrag bij onbekend/geldig/draft-token, en of de frontend écht met de backend praat in plaats van stil op mock data. **Vier keer gedraaid, vier keer geslaagd** — de laatste keer tegen `main` ná de merge.

  **Twee gaten blootgelegd die in geen enkele test zichtbaar waren.** (1) Het portaal lekte een routepad: `Cannot GET /survey/respond/questions`, omdat de frontend elke 404-melding van de backend vertrouwde — dat klopt voor de guard, niet voor een 404 van het framework zelf. (2) Het doorloopscript was zelf niet idempotent en gaf bij een tweede run een misleidende fout. Beide gerepareerd.

  **Dekt O en T, niet A en P.** Acceptatie en productie bestaan als omgeving nog niet (#12). Issue #18 blijft daarom open; de doorloop dáár moet nog gebeuren.

- **Leverancierportaal in de browser (2026-07-29, `MCM2-frontend`).** De acht Transdev-vragen renderen met de MVM_V2-huisstijl. Geverifieerd door het scherm daadwerkelijk te doorlopen: de toelichtingsplicht schakelt om zodra een niet-bevestiging gekozen wordt, indienen met ontbrekende antwoorden wordt geweigerd en markeert elke onvolledige vraag, en een toelichting van `"   -   "` valt af op de ondergrens van tien tekens. De vierde antwoordoptie verschijnt alleen bij de uploadvraag; de draft-toestand toont een oranje klok in plaats van een rode fout.

  Draait op mock data. Tegen de live backend toont het portaal de vragenlijst nog niet — `/survey/respond/questions` is stap 5 uit de bouwvolgorde en bestaat nog niet.

- **Vragenlijst-datamodel niveau B (2026-07-29, PR #33, migratie `0005_vragenlijst_niveau_b.sql`).** Vier nieuwe tabellen (`survey_category`, `survey_question`, `survey_answer`, `survey_attachment`) plus `survey_kind`/`status`/`is_test` op `survey_run` en drie respondentkolommen op `survey_response`. 459 regels, waarvan ongeveer een derde gegenereerd — de rest handwerk, precies zoals ADR-010 voorspelt.

  **Geverifieerd tegen een verse Postgres 17.6-container, niet beredeneerd.** Volledige keten 0000 t/m 0006 via `clm_migrator`. Daarna is elke garantie uitgelokt; alle acht werden geweigerd door de database: categorie van een andere template, verplicht leesblok, afwijkend `answer_type`, rating in het tekstveld, toelichting van drie spaties, dezelfde leverancier twee keer in een UC1-ronde, wijzigen van een bevroren template, bestand boven 5 MB. De tegenproef slaagt wél: **twee collega's die dezelfde leverancier beoordelen in een UC2-ronde**, wat bewijst dat de partiële unieke index UC1 beschermt zonder UC2 te blokkeren.

  **Twee dingen die drizzle-kit niet kon en die handmatig zijn opgelost:**
  - Het gegenereerde `ADD COLUMN subject_vendor_id uuid NOT NULL` slaagt alleen op een lege tabel en **zou op `clm-enterprise` falen**. Vervangen door kolom toevoegen → backfillen vanuit `vendor_id` → dan pas `NOT NULL`.
  - De rolverdeling per use case kon niet als CHECK: `survey_kind` staat op `survey_run` en een CHECK mag geen subquery bevatten. Opgelost met een trigger in plaats van `survey_kind` te dupliceren — dupliceren zou een derde plek opleveren waar de waarde kan afwijken.

  Alle zeven survey-tabellen hebben RLS met zowel `USING` als `WITH CHECK`.

- **De guard weegt de lifecycle van de ronde mee (2026-07-29, migratie `0006_ronde_status_in_guard.sql`).** Vóór deze stap was een ronde in `draft` — aangemaakt maar niet opengesteld — via een token gewoon bereikbaar; `revoked_at` en `closes_at` zeggen niets over een ronde die nog niet begonnen is. `draft` krijgt een eigen melding ("nog niet opengesteld"), want dat is voor een leverancier iets anders dan "gesloten".

  De controle staat **ook in het `UPDATE`-statement van `dienIn()`**, niet alleen in de guard: die beschermt het HTTP-pad, de voorwaarde beschermt de methode zelf.

  **Bevinding om te onthouden:** PostgreSQL weigert een `CREATE OR REPLACE` die de `RETURNS TABLE` wijzigt — geverifieerd, niet aangenomen. Daarom `DROP` + `CREATE`. Gevolg: **na een `DROP` zijn de rechten weg**, want die hangen aan het functie-object en niet aan de naam. Zonder de herhaalde `GRANT` zou geen enkele leverancierslink meer werken.

  **De testwaarde is geverifieerd door de controle tijdelijk te verwijderen:** vijf van de zes nieuwe tests vielen om. Zonder die proef bewijzen groene tests niets — de eerste poging mislukte overigens stil (een regex die niet matchte), waardoor de "proef" niets toetste.

  53 van 53 e2e-tests groen.

- **Leverancierstoegang via token, spoor 2 van Issue #7 (2026-07-28, PR #32, commit `b29e2ad`).** CI groen op alle drie de jobs, geverifieerd met `gh pr checks 32`. 46 tests groen. Wat er staat:
  - `clm.resolve_survey_token()` — `SECURITY DEFINER` met `SET search_path = clm, pg_temp`. De enige route naar een responserij zonder tenantcontext, met een minimale returnwaarde (geen namen, geen e-mailadressen, geen antwoorden). Lost de kip-en-ei op: de tenant is niet bekend vóór de lookup.
  - **De tenantcontext komt uitsluitend uit die lookup**, nooit uit een header, query-parameter of body. Er bestáát geen veld waarin een leverancier een andere tenant kan benoemen. Dit is precies het patroon dat de verwijderde branch `feat/fase0-skeleton-vendors` fout deed.
  - Token: 32 bytes uit `crypto.randomBytes`, base64url, 43 tekens. Opgeslagen als SHA-256; het ruwe token staat nergens in de database. **Gevolg: een verloren link is niet herstelbaar, alleen opnieuw te genereren.**
  - Guard met onderscheid dat bewust asymmetrisch is: 404 voor onbekend én ingetrokken (ononderscheidbaar), 410 voor verlopen, al ingediend, gesloten ronde en inactieve vendor.
  - Éénmaligheid via één atomair `UPDATE … WHERE status = 'pending'`, niet via lezen-dan-schrijven. Een dubbelklik kan geen twee indieningen opleveren.
  - Auditregel binnen dezelfde transactie als de indiening. Rolt de indiening terug, dan verdwijnt de auditregel mee.
  - `MaskerendeLogger` maskeert tokens in logregels vóór het wegschrijven. Dat het ruwe token in een log even gevoelig is als een wachtwoord in platte tekst, is de reden dat dit er is.
  - Migratie `0004_rls_zonder_deleted_at_filter.sql` loste Issue #31 op: `deleted_at IS NULL` in de `USING`-clausule maakte soft delete onmogelijk — het vullen van `deleted_at` duwde de rij uit de policy, waarna de UPDATE geweigerd werd. Journey A werkte daardoor niet.

  **Bevinding die genoemd moet worden:** de logmaskering had zelf een fout die pas door de Docker-productiebuild in CI aan het licht kwam. `maskeerDiep` liep over `Object.entries()`; bij een `Error` is die lijst leeg omdat `message` en `stack` niet-opsombaar zijn. Elke foutmelding werd daardoor `{}` — bij een incident zou je in de logs niets zien. Gerepareerd in `b29e2ad` met een regressietest die beide kanten toetst: leesbaarheid én maskering. Dit is precies waarvoor de CI-poort "image moet ook daadwerkelijk starten" is toegevoegd.
- **Handmatig herstelpad bewezen (2026-07-28).** `pg_dump` van `clm-enterprise` → `pg_restore` in een verse Postgres 17.6-container → grants → verificatie GOEDGEKEURD. Duur: dump 5s, restore 1s. De Postgres-clienttools staan niet op de ontwikkelmachine maar zitten in de container `postgres:17.6`, exact de versie die Supabase draait. Vier valkuilen gedocumenteerd in het runbook (stap 1b-alt): de `?schema=`-parameter die `pg_dump` weigert, padvertaling in Git Bash, ontbrekende grants na een restore, en de UUID-defaults uit #29.
- **MCM2 draait aantoonbaar op een andere provider (2026-07-28).** Gemeten met `scripts/provider-migratietest.js` tegen Neon (`eu-central-1`, PostgreSQL 17.10): 20 van 20 e2e-tests groen zonder één regel codewijziging. Zie het blokkadeblok hierboven.
- **Schemacontrole die meegroeit met de applicatie (2026-07-28).** `src/db/schema-inventory.ts` leidt de verwachting af uit `src/db/schema.ts` via Drizzle's `getTableConfig` — geen hardgecodeerde lijst die veroudert bij de eerste nieuwe tabel. `test/schema-conformiteit.e2e-spec.ts` draait als CI-poort en faalt bij een ontbrekende tabel, een tabel buiten het schema, **een tenantgebonden tabel zonder RLS**, een policy zonder `USING`/`WITH CHECK`, en een ontbrekende kolomdefault. Alle faalscenario's zijn daadwerkelijk uitgelokt om te bevestigen dat de test ook rood wordt wanneer dat hoort. Noodzakelijk omdat `drizzle-kit generate` afwijkingen buiten de migratieketen **niet** detecteert: het vergelijkt met zijn eigen momentopnames in `drizzle/meta/`, niet met de database (geverifieerd).
- **De echte Supabase-database is read-only geverifieerd (2026-07-28).** Niet aangenomen — gemeten met `scripts/verify-schema.js` tegen `clm-enterprise` zelf: negen tabellen aanwezig, RLS actief op alle zes tenantgebonden tabellen, zes policies met zowel `USING` als `WITH CHECK`, `clm.current_tenant_id()` werkend. Uitkomst GOEDGEKEURD, geen afwijking t.o.v. de Drizzle-baseline. Tevens bevestigd: de runtime-rol daar is `clm_api_runtime` met `rolbypassrls = false` — daarmee is ADR-002's control 3 ook in de echte omgeving aangetoond, niet alleen in CI.
- **Postgres-versieverschil afgehandeld (2026-07-28).** Supabase draait **17.6**, CI draait 18.2. De volledige migratieketen én alle 11 isolatietests zijn daarom ook tegen een lokale 17.6-container gedraaid: alles groen. Het versieverschil vormt geen risico.
- **Drizzle als databaselaag (2026-07-28, ADR-010, commit `e9df0dc`).** Geverifieerd tegen twee verse Postgres 18.2-containers, niet beredeneerd: migraties draaien op een lege database via `clm_migrator`; de bestaande RLS-isolatietest slaagt **ongewijzigd** (5 tests); een nieuwe test via de Drizzle-querylaag zelf slaagt (6 tests, `test/drizzle-tenant-context.e2e-spec.ts`); de productie-image bouwt, start, verbindt als `clm_api_runtime` en `/health` antwoordt `HTTP 200`; opstarten met een `BYPASSRLS`-rol wordt geweigerd met een expliciete foutmelding; grants correct toegepast (`clm_api` heeft geen DELETE op audit). Prisma is volledig verwijderd — pakketten, schema, migratiehistorie, gegenereerde client en configuratie.
- **Docker-productiebuild (2026-07-28).** De Dockerfile bouwde de app voorheen niet (`npm install` + `start:dev`); nu multi-stage met `npm ci`, non-root gebruiker en `node dist/main`. Dit was criterium 1 uit §5 en voorheen voor géén enkele ORM toetsbaar. Lost Issue #20 gedeeltelijk op; de base-image is nog niet op een exacte patchversie gepind.
- NestJS-skeleton en health-check-endpoint: gebouwd, getest, gecommit.
- Docker Compose-stack (mcm2-api + minio + valkey): opgezet, health-check via Docker geverifieerd.
- Eerste Prisma-schema (Tenant, User, Vendor-cluster, AuditEvent + ref-lookups) en migratie: uitgevoerd tegen de Supabase `clm-enterprise`-database, inclusief RLS-policies (`USING`+`WITH CHECK`) en seed-data.
- WSL2 en Docker Desktop: werkend op de ontwikkelmachine.
- Vier database-rollen (`clm_api`, `clm_admin`, `clm_readonly`, `clm_audit_reader`) bestaan in de database met `rolbypassrls=false`, hebben `USAGE`+tabelrechten op `clm`/`ref`/`audit`, en `clm_api` heeft een inlogbare runtime-rol (`clm_api_runtime`) die de app daadwerkelijk gebruikt. Zie ADR-008.
- Aparte migration-rol `clm_migrator` (LOGIN, geen `BYPASSRLS`), bootstrap vastgelegd in `prisma/roles/bootstrap-roles.sql`. Migraties (`npm run migrate:deploy`/`migrate:status`) lopen voortaan via `clm_migrator`, nooit meer via `postgres`. Volledige keten (bootstrap → migraties → RLS-test) end-to-end geverifieerd op een verse, lokale Postgres 18.2-container. Zie ADR-009.
- Geautomatiseerde cross-tenant RLS-isolatietest (`test/tenant-rls-isolation.e2e-spec.ts`): geen `BYPASSRLS`, geen rijen zonder tenant-context, correcte read/write-isolatie tussen twee tenants, en een cross-tenant write wordt geweigerd door de `WITH CHECK`-policy. Draait lokaal (`npm run test:e2e`) én automatisch in CI tegen een ephemere testdatabase. Zie ADR-009.
- CI-workflow `.github/workflows/ci.yml` (GitHub Actions), twee jobs: `quality` (format-check, lint-check, typecheck) en `rls-isolation` (bootstrap + migraties via `clm_migrator` + RLS-test via `clm_api_runtime` tegen een ephemere Postgres-servicecontainer). Beide jobs groen bevestigd in GitHub Actions zelf (run `30242917733`, 2026-07-27). Zie ADR-007 en ADR-009.
- Repository staat op GitHub: `https://github.com/AlingAdvies/MCM2` (privé), remote `origin`, aangemaakt en voor het eerst gepusht op 2026-07-27. Hiervoor bestond alleen een lokale repository zonder remote.
- **Issue #4 (EntraID-haalbaarheidscheck) afgerond op 2026-07-27:** `kees@alingadvies.nl` heeft Global Administrator in de Entra ID-tenant `alingadvies.nl`, ruim voldoende voor app-registraties; geen Azure-subscription gekoppeld maar dat blokkeert Entra-app-registraties niet. Rechtencheck is tegen `alingadvies.nl` gedaan, niet tegen een Transdev-tenant (geen toegang tot Transdev's Entra-omgeving) — `alingadvies.nl` dient als voorbeeld-/testtenant. De destijds gekozen uitvoeringsvorm (Cognito) is nadien herzien, zie hieronder.
- **ADR-006 herzien op 2026-07-27 (Cognito → Entra External ID):** vóór er een Cognito User Pool werd aangemaakt bleek de tweede cloudlaag (los AWS-account, cross-cloud federatie) onnodige complexiteit t.o.v. Microsoft Entra External ID, dat dezelfde multi-IdP-flexibiliteit biedt binnen het Microsoft-ecosysteem — geen los AWS-account, gratis tot 50.000 MAU. Reden om niet simpelweg "kaal" Entra ID te gebruiken (zoals een ouder platformdocument uit 2026-03-30 voorstelde): MCM2's multi-tenant-toekomst qua identity-providers is onzeker (niet aantoonbaar Microsoft-only), dus een CIAM-laag blijft gewenst. Zie `docs/adr/ADR-006-ciam-laag-entra-external-id.md` (bestandsnaam gewijzigd op 2026-07-27; heette eerder `ADR-006-cognito-als-federatielaag.md`).

## Contractmanagement als basis — openstaande vraag, bewust geparkeerd

Op 2026-07-29 stelde de eigenaar vast dat de survey **onderdeel is van een contractmanagement-app**: de vragenlijst hoort gekoppeld te zijn aan de leveranciersgegevens, aan **de contracten waarop de survey betrekking heeft**, en aan de contactpersoon met diens e-mailadres.

**Wat er feitelijk staat** (geverifieerd in `src/db/schema.ts`, niet aangenomen):

| Bestaat al | Ontbreekt volledig |
|---|---|
| `vendor` — KvK, vestigingsnummer, statutaire naam, handelsnamen, rechtsvorm, SBI, categorie, business-criticality, compliance-status, spend, risicoscore, eigenaar, reviewdatums | **`contract` — er is géén tabel** |
| `vendor_contact` — naam, **e-mail**, telefoon, functie, rol, `is_primary` | `contract_document`, en elke koppeling survey ↔ contract |

**Besluit: eerst de survey afmaken, dan contracten.** Drie redenen. (1) De survey heeft geen contract nodig om te werken — nergens in de acht Transdev-vragen, het datamodel of de validatie komt een contract voor; wat hij nodig heeft (vendor + contactpersoon met e-mail) staat er al. (2) De survey is bijna af en contracten beginnen bij nul: MVM_V2's `Contract` heeft 24 velden inclusief CATS CM v4-levenscyclus, managementregime en raam-/deelovereenkomst — dat is een eigen bouwspoor met eigen intake. (3) Een afgeronde survey is demonstreerbaar aan de klant, een half contractmodel niet.

**Wat dit kost, expliciet:** een survey die niet weet op welk contract hij slaat is functioneel incompleet — "hoe scoort deze leverancier" zonder "op welke overeenkomst" is een half oordeel. Dat gat blijft bestaan tot het contractspoor er is. Het is wél een *toevoeging* later (`contract_id` op `survey_run`, plus een FK), geen herbouw.

**Besluit eigenaar 2026-07-29: `survey_run` krijgt nu een `contract_id`** — migratie 0007, nullable en bewust nog zonder foreign key, want `clm.contract` bestaat niet. Als lege kolom hoefde de ALTER niets te backfillen; straks bevat de tabel gevulde rondes en maakt de bevriezingstrigger uit 0005 wijzigen rond lopende rondes bewust lastig. Nullable blijft het ook na invoering van de contracttabel: een leverancier kan beoordeeld worden vóór er een overeenkomst is.

Drie tests in `test/schema-conformiteit.e2e-spec.ts` bewaken de kolom. De middelste is zo geschreven dat hij automatisch omslaat: zolang `clm.contract` niet bestaat eist hij géén foreign key, zodra die tabel er wél is eist hij er één. **Dat is de plek die eraan herinnert wanneer de FK gelegd moet worden.**

**Aandachtspunt voor het contractspoor:** zodra `clm.contract` bestaat, moet die tabel een eigen RLS-policy krijgen vóórdat de foreign key gelegd wordt. Een verwijzing naar een tabel zonder RLS is een lek.

## Lessen uit deze sessies die tijd besparen

Praktische valkuilen die daadwerkelijk zijn tegengekomen, niet bedacht. Ze staan hier omdat ze anders opnieuw ontdekt worden.

**`drizzle-kit` genereert migraties die op een gevulde database falen.** Bij `subject_vendor_id` produceerde het `ADD COLUMN ... NOT NULL`, wat alleen op een lege tabel slaagt. Elke nieuwe verplichte kolom vraagt handmatig de drie-stappenvorm: kolom toevoegen → backfillen → `SET NOT NULL`. Controleer dit bij **elke** gegenereerde migratie.

**PostgreSQL weigert `CREATE OR REPLACE FUNCTION` als de `RETURNS TABLE` wijzigt.** Dan is `DROP` + `CREATE` nodig — en **na een `DROP` zijn de rechten weg**, want die hangen aan het functie-object en niet aan de naam. Zonder een herhaalde `GRANT` werkt er niets meer. Zie migratie 0006.

**Groene tests bewijzen niets tot je ze hebt zien falen.** Bij stap 2 zijn de zes nieuwe tests gecontroleerd door de controle tijdelijk te verwijderen: vijf vielen om, één niet. De eerste poging daartoe mislukte bovendien stil (een regex die niet matchte), waardoor de "proef" niets toetste. Doe die tegenproef expliciet.

**`NEXT_PUBLIC_*` wordt tijdens de build ingebakken, niet bij het starten gelezen.** Een frontend-image dat de echte backend moet gebruiken heeft die waarde nodig als **build-argument**. Zet je hem als `environment`, dan draait de app stilzwijgend op mock data terwijl je denkt dat hij live is. De OTAP-doorloop controleert hierop.

**De tenantcontext heet `app.current_tenant_id`, niet `app.tenant_id`.** Het seed-script gebruikte de verkeerde naam. Dat geeft **geen foutmelding** — `set_config` accepteert elke sleutel — maar een lege context, waarna RLS elke INSERT weigert met "new row violates row-level security policy". Gebruik altijd `setTenantContext()` uit `src/db/schema.ts` als bron; scripts die hun eigen `set_config` schrijven, moeten die naam letterlijk overnemen.

**Drizzle verpakt databasefouten: een triggermelding staat in `cause`, niet in `message`.** Een test die met `rejects.toThrow(/bevroren/)` op `message` matcht, wordt daardoor óók groen bij een tikfout in de SQL — dan test hij niets. Lees `(fout as Error & { cause?: Error }).cause?.message`.

**Testsuites die dezelfde tenant-id gebruiken botsen bij de tweede run.** Templates zijn uniek op `(tenant_id, name, version)` en de lokale testdatabase blijft staan. In gebruik: `…e1` (survey-routes), `…f1`/`…f2` (token-isolatie), `…d1`/`…d2`/`…d3` (vragenlijst). Kies een eigen paar, en geef testtemplates een unieke versie in plaats van een vast nummer.

**Docker 29 weigert een containernaam van één teken.** Het oude `--name t` uit dit document faalde met "Invalid container name"; de opstartcommando's hierboven zijn gecorrigeerd naar `mcm2test`.

**Een tegenproef kan zélf onvoldoende zijn — controleer of de testopzet het lek kán zien.** Bij stap 5 is het lek uit ontwerp §1c daadwerkelijk ingebouwd (filteren op `subject_vendor_id` in plaats van `response_id`) en **bleef alles groen**. Oorzaak: elke leverancier in de test had een eigen vendor, dus de verkeerde filter selecteerde toevallig dezelfde rij. Pas met **twee responses over dezelfde leverancier** — het echte UC1/UC2-scenario — viel testpunt 39 om. Een tegenproef die niet faalt betekent dus niet automatisch dat de code goed is; het kan ook zijn dat de opzet het probleem niet kan aantonen.

**Een race is niet uit te lokken met twee gewone requests of twee service-aanroepen.** Bij stap 8 zijn drie testopzetten geprobeerd om te bewijzen dat een `FOR UPDATE` nodig was: supertest via `Promise.all`, de service rechtstreeks, en een handmatig vastgehouden transactie. **Alle drie bleven groen mét de vergrendeling verwijderd.** Twee transacties via dezelfde pg-`Pool` komen achter elkaar aan de beurt zodra de eerste zijn connectie teruggeeft. Wie een vergrendeling echt wil toetsen heeft twee losse verbindingen én een wachtpunt binnen de transactie nodig — en dat kost een haak in productiecode. De les: **stel de claim bij naar wat de test aantoont**, in plaats van de test te laten suggereren dat een mechanisme bewezen is.

**Drizzle geeft een JS-array door als `record`, niet als `text[]`.** Een `INSERT` in een array-kolom faalt met "column X is of type text[] but expression is of type record". Werkende vorm: `ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(waarden)}::jsonb))`. Zelf een array-literal opbouwen kan ook, maar vraagt quoting van komma's, aanhalingstekens en accolades die in de waarden kunnen voorkomen — precies waar een injectiefout in sluipt.

**Een nullable kolom maken raakt méér dan de tabel.** Migratie 0005 maakte `survey_response.vendor_id` nullable voor UC2, maar `resolve_survey_token()` joinde daar nog op — waardoor elke interne beoordeling 410 gaf. Bij het versoepelen van een kolom hoort een zoektocht naar elke plek die hem gebruikt: functies, views, policies. `grep -rn "vendor_id" drizzle/` had dit gevonden.

## Niet als bewezen beschouwen

- RLS-tenant-isolatie was tot 2026-07-27 niet bewezen zolang de runtime-role nog `BYPASSRLS` had — een eerdere "RLS werkt"-verificatie in deze projectgeschiedenis was vals-positief (lege tabel, geen bewijs van daadwerkelijke blokkade). **Nu aantoonbaar bewezen én geautomatiseerd** (zie hierboven en ADR-009) — niet langer een handmatige, ad-hoc verificatie.
- Elke aanname uit `docs/context/PROJECT-HISTORY-2026-07-24.md` die alleen op historische sessienotities berust: **historisch gemeld; opnieuw verifiëren bij de volgende technische fase.** Dit geldt met name voor:
  - de exacte Prisma-7-generatorinstellingen (voorwaardelijk aan een ORM-keuze die nog niet definitief is);
  - of het `mvm-api-pilot`-wachtwoordlek inmiddels is opgelost (nooit definitief bevestigd);
  - de exacte Supabase-tier/backup-garanties (nooit expliciet geverifieerd, zie ADR-002).

## Huidige branch en Git-status

**Stand op 2026-07-29, tweede sessie:**

| Repo | Branch | Werkboom | Openstaande PR's |
|---|---|---|---|
| MCM2 | **`chore/otap-doorloop-stap8`** | schoon | nog niet gepusht |
| MCM2-frontend | `main` | schoon | geen |

**Drie PR'''s gemerged naar `main`:** #37 (stap 3 en 4, `ef62cd6`), #38 (migratie 0007 plus de drie bevestigde ontwerpbesluiten, `4b09026`) en #39 (stap 5 plus de UC2-guardfix, `52f41b0`). Alle drie met CI groen op alle drie de jobs, alle branches lokaal én op GitHub verwijderd. Na elke merge opnieuw geverifieerd tégen `main` zelf.

**Vijf PR's gemerged naar `main`:** #37, #38, #39, #40 en #41 (stap 8, `7c0be9b`). Alle vijf met CI groen op alle drie de jobs, alle branches lokaal én op GitHub verwijderd.

**`chore/otap-doorloop-stap8` staat open:** de uitgebreide doorloop, de Dockerfile-fix voor de uploadmap en deze statusbijwerking. Nog niet gepusht. Lokale poorten wél gedraaid: format, lint, typecheck, 155/155 e2e tegen een verse Postgres 17.6 (twee keer), en de Docker-productiebuild die start, de uploadroute mapt en `/health` met 200 beantwoordt.

- **`docs/sessiestand-otap` is op 2026-07-29 via PR #35 gemerged naar `main`** (merge-commit `cbe6c48`) en daarna lokaal én op GitHub verwijderd. Eén commit: uitsluitend deze statusbijwerking.
- **`feat/issue-7-leveranciertoken` is op 2026-07-29 via PR #32 gemerged naar `main`** (merge-commit `7f0cc01`) en daarna lokaal én op GitHub verwijderd. CI groen op alle drie de jobs vóór de merge, opnieuw geverifieerd met `gh pr checks 32` op de laatste commit. Vijf commits: de tokenlaag, de HTTP-routes met logmaskering en auditregels, de fix op `maskeerDiep`, plus twee documentatiecommits. **Issue #31 is bij die merge gesloten** — migratie `0004` loste hem op. Let op: die migratie is bewezen in CI, **niet toegepast op `clm-enterprise`** — net als #29 en #25 wacht dat op #30.
- **`feat/issue-9-vragenlijst-ontwerp` is op 2026-07-29 via PR #33 gemerged naar `main`** en daarna lokaal én op GitHub verwijderd. Negen commits: het vragenlijst-ontwerp (niveau B, twee use cases, categorieën), ADR-012, de migratie 0005, de guard-uitbreiding 0006 en deze statusbijwerking. CI groen op alle drie de jobs vóór de merge.
- **`chore/otap-doorloop` is op 2026-07-29 via PR #34 gemerged naar `main`** (merge-commit `8467ef8`) en daarna lokaal én op GitHub verwijderd. Eén commit: de OTAP-stack, het verificatiescript en het runbook. Geen applicatiecode.
- **Tweede repository sinds 2026-07-29: `AlingAdvies/MCM2-frontend`** (privé). Eigen CI, eigen releasecyclus — bewust geen map in deze repo, zodat een tekstwijziging in een scherm niet wacht op een databasemigratie. Zie ADR-012. Staat op `main` met twee commits (portaal + de 404-fix uit de OTAP-doorloop), CI groen op beide jobs.
- `chore/supabase-verificatie` is op 2026-07-28 via PR #28 gemerged naar `main` en daarna lokaal én op GitHub verwijderd. Zes commits: Supabase read-only verificatie, schemacontrole die uit het schema meegroeit, ADR-011 (backupeisen per fase), de #29-fix, en het runbook met beproefde commando's en opruimprocedure. CI groen op alle drie de jobs vóór de merge.
- `feat/issue-5-drizzle-omzetting` is op 2026-07-28 via PR #26 gemerged naar `main` (merge-commit `f0806f8`) en daarna lokaal én op GitHub verwijderd. Bevatte de volledige Drizzle-omzetting; CI groen op alle drie de jobs vóór de merge.
- `docs/issue-7-leveranciertoken-ontwerp` is op 2026-07-28 via PR #27 gemerged naar `main` (merge-commit `c8f896a`) en daarna lokaal én op GitHub verwijderd. Bevatte uitsluitend het ontwerpdocument voor het leverancierstokenspoor.
- `chore/issue-4-entraid-haalbaarheid` is op 2026-07-27 gemerged naar `main` (vier documentatiecommits: Issue #4-afronding, ADR-006-herziening naar Entra External ID, PoC-bevindingendocument en de bijwerking daarvan naar "geslaagd") en daarna lokaal én op GitHub verwijderd. Daarna is direct op `main` nog een documentatie-consistentieronde gedaan (ADR-006 hernoemd, feitelijke fout over de gebruikte app-registratie gecorrigeerd, Issue #7-status samengevoegd tot één blok), gevolgd door het toevoegen van het sessieafsluitprotocol (MCM2-CLAUDE.md §14b) en de backlog-synchronisatie die daaruit voortkwam.
- `chore/restructure-project-context` is inmiddels in `main` opgegaan (laatste commit op die lijn: `beb3e66`, "docs(fase0): archiveer opdrachtinstructie en eerdere techstack-evaluatie") en bestaat niet meer als losse branch.
- `feat/fase0-skeleton-vendors` is op 2026-07-28 **verwijderd na expliciete goedkeuring van de eigenaar**, zonder te mergen. Laatste commit: `4581edd580ec4d37695065d130f4bdfb5d806c8a` ("wip(fase0): Taak 6 tussenstand — PrismaService, TenantMiddleware, with-tenant", 2026-07-24, 9 bestanden).

  **Deze branch is nooit naar GitHub gepusht.** De commit bestond uitsluitend lokaal en is met het verwijderen van de branch onbereikbaar geworden; hij is via `git reflog`/`git fsck` nog een beperkte periode terug te halen op de machine waar hij stond, maar is **geen duurzaam archief**. Wie de inhoud definitief nodig heeft, moet die opnieuw opbouwen.

  Reden om niet te mergen: `TenantMiddleware` leidde de tenant blind af uit een ongeverifieerde `X-Tenant-Id`-header of een `?tenant=`-query-param — exact het patroon dat MCM2-CLAUDE.md §6 verbiedt en dat de kern is van Issue #7. Daarnaast gebruikte `withTenant()` `$executeRawUnsafe` met stringinterpolatie van `tenantId` in plaats van een geparametriseerde aanpak.

  Reden om te verwijderen: het bruikbare deel (het transactiepatroon) is op 2026-07-28 opnieuw gebouwd in `src/db/database.service.ts` en staat op `main` — met tenantcontext via `set_config()` met een echte queryparameter, een startcontrole die een `BYPASSRLS`-rol weigert, en zes tests. Er viel niets meer over te nemen; wat er nog in zat, is juist het afgekeurde patroon.

## Eerstvolgende goedgekeurde stap

De databaselaag is omgezet (ADR-010), spoor 2 van Issue #7 zit in `main`, en de vragenlijst-tool staat t/m stap 4: het datamodel, de guard, import/export en beide gevulde vragenlijsten.

**De backendkant van de leveranciersflow is compleet en in de keten bewezen.** De OTAP-doorloop van 2026-07-29 toont dat vragen ophalen, valideren, uploaden en indienen end-to-end werken vanuit de browser.

**De eerstvolgende stap zit in de frontend, niet in de backend: Issue #42.** Het portaal kan nog geen bestanden uploaden, waardoor een leverancier de Transdev-vragenlijst niet via de browser kan afronden — bevestigen op de ISO-vraag levert een 422 op die als "Er ging iets mis" wordt getoond. Dat is nu de enige blokkade voor een werkende demonstratie aan de klant. Issue #43 (het leesblok met keuzerondjes) is cosmetisch maar verwarrend.

Daarna is stap 7 (concept opslaan) de volgende inhoudelijke uitbreiding, en stap 10 (beheerroutes) wacht op spoor 1.

**Daarnaast, en dat kost geen code:** het portaal tegen de echte backend zetten via een OTAP-doorloop. De vragen staan in de database en de route bestaat, dus dit is de eerste keer dat de klant de echte vragenlijst in de browser kan zien in plaats van mock data.

~~1. Migratie met de vier nieuwe tabellen en de kolommen op `survey_run`/`survey_response`~~ — **afgerond 2026-07-29** (migratie 0005).
~~2. De bestaande guard uitbreiden met de ronde-statuscontrole~~ — **afgerond 2026-07-29** (migratie 0006).
~~3. Import/export van het JSON-schema~~ — **afgerond 2026-07-29**, zie "Aantoonbaar werkend".
~~4. Seed: beide vragenlijsten via het importpad~~ — **afgerond 2026-07-29**, idem.

~~5. `GET /survey/respond/questions`~~ — **afgerond 2026-07-29**, zie "Aantoonbaar werkend". Legde en passant de UC2-guardbug bloot.

~~6. Validatie- en indienlogica~~ — **afgerond 2026-07-29**, zie "Aantoonbaar werkend".
~~8. Bestandsupload met inhoudscontrole~~ — **afgerond 2026-07-29**, idem.

**Nu aan de beurt:**
7. `PUT /survey/respond/answers` — concept opslaan, expliciet (geen auto-save). Bruikbaar bij acht vragen met verplichte toelichtingen, maar blokkeert niets.
9. De resterende testpunten uit ontwerp §8.
10. Beheerroutes — wacht op spoor 1 (Entra-guard).

**De 404 die de OTAP-doorloop signaleerde is weg:** `/survey/respond/questions` bestaat en levert de vragenlijst uit de database. **Nog niet in de browser bekeken** — het portaal draait nog op mock data tot iemand het met `NEXT_PUBLIC_API_URL` tegen de backend zet. Dat is de eerstvolgende zichtbare stap en kost geen code, alleen een OTAP-doorloop.

**Stap 8 (bestandsupload) is de laatste die nog echt iets toevoegt aan de leverancierskant.** Zonder die stap kan een uploadvraag niet bevestigend beantwoord worden: de validatie eist een bestand bij `confirmed` op een uploadvraag. De acht Transdev-vragen hebben er één (q1), dus dit blokkeert een volledige UC1-indiening met bewijsstuk. `cannot_upload` met toelichting werkt wél al.

Daarna, in volgorde van afhankelijkheid:

1. ~~**Issue #30 — beslissing over het databaseplan**~~ — **besloten 2026-07-28: Supabase Free voor de pilot**, met expliciete risico-acceptatie in ADR-011 en een gebouwde, geteste dagelijkse dump als enige vangnet. Overwogen en afgewezen als pilotdatabase: de eigen MacBook-thuisserver (thuisinternet is geen SLA, en Tailscale maakt hem niet bereikbaar voor een leverancier) — die wordt wél ingezet als ontwikkeldatabase en backupbestemming. **Resterende actie voor de eigenaar:** de dagelijkse taak inplannen en `BACKUP_DIR` naar een tweede locatie zetten. Zie runbook stap 0.
2. **Issue #19** — restore-test van de dashboard-backup. Kan pas ná #30: zonder plan zijn er geen backups om te herstellen. Runbook stap 1, vereist dashboardtoegang.
3. **Issue #29** — de vijf ontbrekende UUID-defaults toepassen op de productiedatabase. Migratie ligt klaar en is bewezen tegen een productiekopie; wacht op een vangnet uit #30/#19.
4. **Issue #25** — Drizzle-migratiestand initialiseren op de bestaande Supabase-database. Idem: raakt productie, wacht op #30/#19. Schema-afdrijving is al uitgesloten.
5. **Issue #7** — spoor 2 (leverancierstoken) is **gebouwd, groen en gemerged** (PR #32). Spoor 1 (Entra-guard) vraagt nog om het inwisselen van de authorization code en het bouwen van de JWKS-guard; **niet gestart**. Spoor 1 blokkeert de leverancierskant niet, maar wél de beheer-UI van de vragenlijst-tool (ontwerp §10, stap 10). Beide sporen kunnen zonder de productiedatabase — de e2e-keten draait tegen wegwerpcontainers.
5b. **Vragenlijst-tool** — ontwerp is **bouwbaar** (niveau B, vastgesteld 2026-07-29). Bouwvolgorde in het ontwerp, §10. Dit is wat de leverancierskant van een werkende toegangslaag naar een werkende pilot brengt, en het is nu het actieve spoor.
5c. **Issue #9 (certificaat-upload)** — meegenomen in datzelfde ontwerp, §4/§6. Twee punten die daaruit voortkomen en nog geen issue hebben: **een virusscan** (OV-7 onbeantwoord, ontwerp bouwt er geen) en **backup van geüploade bestanden** (die vallen buiten `npm run backup:dump` en zijn daarmee het enige onderdeel zonder vangnet — raakt #30).
6. **Issue #1** — wachtwoordrotatie van de `postgres`-beheerrol (P0, niet aangeraakt door de databaserol-fix van 2026-07-27).
7. **Issue #3** — `tsconfig.json` naar strict-mode, module-systeem-inconsistentie oplossen (P0, klein). De eerdere kanttekening hierbij ("kan typefouten blootleggen die per ORM verschillen") is vervallen nu de databaselaag vastligt.
8. ~~**Issue #2** — `pg` en `@types/pg` als directe dependency~~ — **afgerond 2026-07-28**, bijvangst van ADR-010.
9. ~~**Issue #4** — EntraID-federatie haalbaarheidscheck~~ — **afgerond 2026-07-27**, zie hierboven en ADR-006.
10. ~~**Issue #5** — ORM-spike Prisma 6 vs. Drizzle~~ — **besloten 2026-07-28: Drizzle** (ADR-010). De spike zelf is niet uitgevoerd; de zeven criteria zijn op de daadwerkelijke omzetting getoetst. Issue #6 (definitieve ORM-implementatie) is hiermee inhoudelijk afgehandeld.
11. **Issue #15** — nog twee resterende Transdev-klantvragen: OV-4 (exportformaat) en OV-9 (SMTP-details). OV-6, OV-7 en OV-8 zijn op 2026-07-28 afgehandeld, zie het blok hierboven. OV-9 blokkeert het daadwerkelijk versturen van uitnodigingen.
12. **Nog aan te maken issues** (voortgekomen uit deze sessie, bestonden op 2026-07-28 nog niet in GitHub):
    - Virusscan op geüploade bestanden — OV-7 liet dit onbeantwoord; het ontwerp bouwt er geen en benoemt het haakpunt (tussen ontvangen en opslaan).
    - Backup van geüploade bestanden — vallen buiten `npm run backup:dump`; hoort in de dagelijkse taak uit #30.
    - Twee eisen aan de beheerderskant uit het tokenontwerp §5a: waarschuwen bij het zacht verwijderen van een vendor met openstaande responses, en een aparte "vervallen"-status in het statusoverzicht. Zonder die twee lost de guard het stille falen op voor de leverancier, maar blijft de beheerder wachten op een antwoord dat nooit komt.

Volledige backlog (alle 24 items, incl. Before production en Later): `gh issue list --repo AlingAdvies/MCM2` of `https://github.com/AlingAdvies/MCM2/issues`.

## Belangrijke verwijzingen

- **Backlog/roadmap: GitHub Issues** (`https://github.com/AlingAdvies/MCM2/issues`), gelabeld met type (`bug`/`enhancement`/`chore`) en prioriteit (`priority:p0`/`priority:before-pilot`/`priority:before-production`/`priority:later`). Vervangt de losse Markdown-roadmap sinds 2026-07-27 (zie `docs/archive/06-prioritized-roadmap-2026-07-24-pre-issues.md` voor de migratieverantwoording en issue-nummer-mapping).
- **Ontwerpen (`docs/superpowers/specs/`):**
  - `2026-07-28-leveranciertoken-ontwerp.md` — toegangslaag voor leveranciers. **Uitgevoerd**, zie PR #32. Blijft de referentie voor waarom de guard doet wat hij doet.
  - `2026-07-28-vragenlijst-ontwerp.md` — vragenlijst-tool, antwoorden en certificaat-upload. **Status: bouwbaar** (niveau B, vastgesteld 2026-07-29). §0 legt de twee scopewijzigingen uit; §10 bevat de bouwvolgorde.
- **Externe referentie:** `VendorComply Help en Manual.md` (OneDrive, `Bizaline/Producten/VendorComply/`) — handleiding van een bestaand, werkend product. Bron van de acht vraagtypen en de lifecycle. **Referentie, geen compatibiliteitseis:** geen gedeelde database, geen migratiepad. Wat is overgenomen en wat niet, staat in het ontwerp §1a.
- **Klantaanlevering:** `Transdev Annual Vendor IT Risk SurveyV1_0.md` (repo-root) — de acht vragen die de eerste vulling van de tool vormen.
- Architectuurreview: `docs/architecture-review/2026-07-24/` (00, 02-05, 07-09 — 06 is verplaatst naar `docs/archive/`, zie hierboven)
- Actieve ADR's: `docs/adr/`, inclusief ADR-012 (frontend-uitrol: Docker als enige weg, AWS App Runner beoogd, Vercel afgewezen), ADR-006 (CIAM-laag: Microsoft Entra External ID — herzien op 2026-07-27, AWS Cognito verworpen; bestand heette eerder `ADR-006-cognito-als-federatielaag.md`), ADR-007 (CI-platform: GitHub Actions; eerste CI-scope: format/lint/typecheck, test/build bewust uitgesteld tot na de ORM-spike), ADR-008 (P0-databaserolherstel: clm_api_runtime, ontbrekende schema-grants, tijdelijke clm_admin=clm_api-gelijkstelling), ADR-009 (migration-rol clm_migrator, rollenbootstrap, geautomatiseerde RLS-test in CI via ephemere testdatabase) ADR-010 (databaselaag Drizzle, Prisma verwijderd; inclusief de toetsing van de zeven §5-criteria) en ADR-011 (backup- en hersteleisen per fase: hoeveel dataverlies en hersteltijd acceptabel zijn tijdens ontwikkeling, pilot en productie). ADR-002 is op 2026-07-28 bijgewerkt met de werkelijke stand van de vier openstaande controls.
- Runbooks: `docs/runbooks/` — bevat sinds 2026-07-28 `supabase-verificatie-en-restoretest.md`: vijf stappen (backupinventarisatie, restore-test, tier/garanties, Drizzle-migratiestand, provider-toets), met beproefde `pg_dump`/`pg_restore`-commando's, zes gedocumenteerde valkuilen en een meetregister voor hersteltijden.
- Historisch projectcontextdocument: `docs/context/PROJECT-HISTORY-2026-07-24.md`
- Volledig gearchiveerd, vervangen instructiebestand: `docs/archive/MCM2-CLAUDE-2026-07-24-pre-restructure.md`
