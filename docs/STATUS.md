# MCM2 — actuele status

## Laatst bijgewerkt
2026-07-29 (PR #32 gemerged, Issue #31 gesloten; vragenlijst-scope vastgesteld op niveau B — alles hieronder is geverifieerd, niet uit gespreksgeheugen)

## Voor een nieuwe sessie: lees dit eerst

1. Lees `MCM2-CLAUDE.md` volledig (sessiestartprotocol, §14).
2. Lees dit document (`docs/STATUS.md`) volledig — het is de enige actuele waarheid over fase en blockers.
3. Verifieer git-status zelf (`git status`, `git branch -a`) tegen wat hieronder staat — vertrouw niet blind op deze snapshot.
4. Check de open GitHub Issues (`gh issue list --repo AlingAdvies/MCM2 --state open`) voor de actuele backlog — dit document verwijst naar issue-nummers, maar de Issues zelf zijn de bron van waarheid over wat daadwerkelijk nog open staat.
5. **Eerste concrete vervolgstap: het bouwen van de vragenlijst-tool kan beginnen.** Het ontwerp is op 2026-07-29 bouwbaar geworden (niveau B vastgesteld); de bouwvolgorde staat in §10 van het ontwerp. Issue #30 (geen backups) blijft de zwaarste openstaande blokkade voor alles wat de productiedatabase raakt (#19, #25, #29), maar vraagt nu alleen nog uitvoering door de eigenaar, geen besluit — en de vragenlijst-tool loopt daar niet op vast, want die bouwt tegen wegwerpcontainers.

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

**Nog open in het ontwerp (voorstellen, niet bevestigd, geen van alle blokkerend):** dat een gestarte ronde de vragenlijst bevriest (§2), dat een toelichting ook verplicht is bij "I do not confirm" (§3), en wat er gebeurt bij een geïmporteerd e-mailadres zonder bekende vendor (§2c — advies: weigeren, niet automatisch aanmaken).

**Drie dingen raken bestaande, groene code** en verdienen aandacht bij het bouwen: `survey_run` krijgt drie kolommen (`status`, `is_test`, `survey_kind`), `survey_response` krijgt er drie (`subject_vendor_id`, `respondent_user_id`, `respondent_label`) waarbij `vendor_id` **nullable** wordt, en de bestaande guard moet de ronde-status meewegen naast `closes_at`/`revoked_at`. Die nullable-wijziging is een versoepeling op een tabel die vanochtend gemerged is — de UC1-garantie wordt overgenomen door een partiële unieke index plus twee CHECK-constraints, en testpunten 41 t/m 43 horen te bewijzen dat er niets weglekt.

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

## Niet als bewezen beschouwen

- RLS-tenant-isolatie was tot 2026-07-27 niet bewezen zolang de runtime-role nog `BYPASSRLS` had — een eerdere "RLS werkt"-verificatie in deze projectgeschiedenis was vals-positief (lege tabel, geen bewijs van daadwerkelijke blokkade). **Nu aantoonbaar bewezen én geautomatiseerd** (zie hierboven en ADR-009) — niet langer een handmatige, ad-hoc verificatie.
- Elke aanname uit `docs/context/PROJECT-HISTORY-2026-07-24.md` die alleen op historische sessienotities berust: **historisch gemeld; opnieuw verifiëren bij de volgende technische fase.** Dit geldt met name voor:
  - de exacte Prisma-7-generatorinstellingen (voorwaardelijk aan een ORM-keuze die nog niet definitief is);
  - of het `mvm-api-pilot`-wachtwoordlek inmiddels is opgelost (nooit definitief bevestigd);
  - de exacte Supabase-tier/backup-garanties (nooit expliciet geverifieerd, zie ADR-002).

## Huidige branch en Git-status

- **`feat/issue-7-leveranciertoken` is op 2026-07-29 via PR #32 gemerged naar `main`** (merge-commit `7f0cc01`) en daarna lokaal én op GitHub verwijderd. CI groen op alle drie de jobs vóór de merge, opnieuw geverifieerd met `gh pr checks 32` op de laatste commit. Vijf commits: de tokenlaag, de HTTP-routes met logmaskering en auditregels, de fix op `maskeerDiep`, plus twee documentatiecommits. **Issue #31 is bij die merge gesloten** — migratie `0004` loste hem op. Let op: die migratie is bewezen in CI, **niet toegepast op `clm-enterprise`** — net als #29 en #25 wacht dat op #30.
- **Actieve branch: `feat/issue-9-vragenlijst-ontwerp`** — bevat uitsluitend documentatie: het bijgewerkte vragenlijst-ontwerp (niveau B) en deze statusbijwerking. Geen code.
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

De databaselaag is omgezet (ADR-010), spoor 2 van Issue #7 zit in `main`, en het vragenlijst-ontwerp is bouwbaar.

**De eerstvolgende inhoudelijke stap is het bouwen van de vragenlijst-tool** (ontwerp §10). Dat is nu de kortste weg naar een werkende pilot: de toegangslaag eronder staat en is bewezen, en het bouwen ervan raakt de productiedatabase niet — de hele e2e-keten draait tegen wegwerpcontainers, dus #30 blokkeert dit spoor niet.

Eerste twee stappen uit die volgorde, omdat ze bestaande groene code raken en dus de meeste aandacht vragen:
1. Migratie met `survey_question`, `survey_answer`, `survey_attachment`, plus `status` en `is_test` op `survey_run` — inclusief RLS, policies, CHECK-constraints en de samengestelde foreign key. Handwerk: drizzle-kit genereert hiervan niets.
2. De bestaande guard uitbreiden met de ronde-statuscontrole.

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
- Actieve ADR's: `docs/adr/`, inclusief ADR-006 (CIAM-laag: Microsoft Entra External ID — herzien op 2026-07-27, AWS Cognito verworpen; bestand heette eerder `ADR-006-cognito-als-federatielaag.md`), ADR-007 (CI-platform: GitHub Actions; eerste CI-scope: format/lint/typecheck, test/build bewust uitgesteld tot na de ORM-spike), ADR-008 (P0-databaserolherstel: clm_api_runtime, ontbrekende schema-grants, tijdelijke clm_admin=clm_api-gelijkstelling), ADR-009 (migration-rol clm_migrator, rollenbootstrap, geautomatiseerde RLS-test in CI via ephemere testdatabase) ADR-010 (databaselaag Drizzle, Prisma verwijderd; inclusief de toetsing van de zeven §5-criteria) en ADR-011 (backup- en hersteleisen per fase: hoeveel dataverlies en hersteltijd acceptabel zijn tijdens ontwikkeling, pilot en productie). ADR-002 is op 2026-07-28 bijgewerkt met de werkelijke stand van de vier openstaande controls.
- Runbooks: `docs/runbooks/` — bevat sinds 2026-07-28 `supabase-verificatie-en-restoretest.md`: vijf stappen (backupinventarisatie, restore-test, tier/garanties, Drizzle-migratiestand, provider-toets), met beproefde `pg_dump`/`pg_restore`-commando's, zes gedocumenteerde valkuilen en een meetregister voor hersteltijden.
- Historisch projectcontextdocument: `docs/context/PROJECT-HISTORY-2026-07-24.md`
- Volledig gearchiveerd, vervangen instructiebestand: `docs/archive/MCM2-CLAUDE-2026-07-24-pre-restructure.md`
