# Reviewaanvraag — architectuur, OTAP-straat en teststrategie

**Datum:** 2026-07-29
**Aangevraagd door:** projecteigenaar
**Bedoeld voor:** een onafhankelijk beoordelaar (AI-model of architect) die MCM2 niet kent
**Opgesteld door:** Claude Opus 5, op basis van de code zoals die op `main` staat — niet uit gespreksgeheugen

---

## 0. Wat ik van je vraag

Dit document beschrijft de architectuur van MCM2, de OTAP-straat en de teststrategie, plus een
eerlijke lijst van wat ik zelf zwak vind. Ik zoek een **tweede mening**, geen bevestiging.

**De vier vragen waar het om draait:**

1. **Portabiliteit.** Wat hier gebouwd wordt moet eenvoudig maar robuust te verplaatsen zijn naar
   AWS (of een andere provider). Is dat aannemelijk gemaakt, of zit er ergens een afhankelijkheid
   die dat straks duur maakt? Zie §7 — dit is de belangrijkste vraag.
2. **Zijn de garanties echt garanties?** Er wordt veel in de database afgedwongen (RLS,
   CHECK-constraints, triggers). Klopt die verdeling, of zitten er dingen in de servicelaag die
   erin horen — of andersom?
3. **Is de teststrategie evenredig?** 155 e2e-tests op de backend, **nul** op de frontend. Zie §6.
4. **Wat mis ik?** Vooral op het snijvlak van beveiliging en operatie.

**Wat ik níét vraag:** een oordeel over de functionele scope. Die ligt vast in een apart
ontwerpdocument en is met de opdrachtgever doorgenomen.

**Waar je op mag afgaan:** alle cijfers en bestandsnamen in dit document zijn geverifieerd tegen de
code op het moment van schrijven. Waar iets *niet* geverifieerd is, staat dat er expliciet bij.

---

## 1. Wat MCM2 is

Een **contractmanagement-applicatie** voor Transdev, waarvan nu één verticale slice gebouwd is: een
**vragenlijst-tool** waarmee een klant (tenant) zelf vragenlijsten opstelt en uitzet bij zijn
leveranciers.

Twee gebruikssituaties, en die grens is hard:

| | Wie vult in | Over wie | Toegang |
|---|---|---|---|
| **UC1** Vendor compliance | de leverancier zelf | zichzelf | tokenlink, geen account |
| **UC2** Interne beoordeling | een Transdev-collega | een leverancier | tokenlink, geen account |

De eerste vulling is een jaarlijkse IT-compliancevragenlijst van acht vragen, waarvan er één een
ISO 27001-certificaat als bijlage vraagt.

**Belangrijk voor de beoordeling:** de leverancier heeft géén account en géén sessie. Zijn enige
sleutel is een token in een URL. Dat bepaalt vrijwel de hele beveiligingsarchitectuur.

### Wat er nog níét is

- **Geen beheerkant.** De tenant kan nog geen vragenlijsten opstellen via een scherm; dat wacht op
  de interne-identiteitslaag (Entra External ID). Vragenlijsten komen nu via een JSON-import binnen.
- **Geen contracttabel.** De applicatie heet contractmanagement, maar `clm.contract` bestaat niet.
  Er is wel een `contract_id`-kolom op de surveyronde gezet (nullable, zonder foreign key) zodat de
  koppeling later geen migratie op gevulde data kost.
- **Geen e-mailverzending.** Uitnodigingen versturen kan nog niet (wacht op SMTP-gegevens).

---

## 2. Architectuur in één overzicht

```
Browser (leverancier, geen login)
   │  https, token in query-parameter ?t=<43 tekens base64url>
   ▼
MCM2-frontend  ── Next.js 15, React 19, Tailwind 3
   │            eigen repository, eigen CI, eigen productie-image
   │  fetch, NEXT_PUBLIC_API_URL wordt tijdens de BUILD ingebakken
   ▼
MCM2 (backend) ── NestJS 11 op Node 24, TypeScript
   │            SurveyTokenGuard op controllerniveau
   ▼
PostgreSQL 17  ── Row Level Security als tenantgrens
                  runtime-rol clm_api_runtime, GEEN BYPASSRLS
```

**Twee repositories, bewust gescheiden** (ADR-012): een tekstwijziging in een scherm hoeft niet te
wachten op een databasemigratie. De prijs is dat een keten-doorloop beide repositories nodig heeft.

### De kernregel van het hele ontwerp

> **De tenantcontext komt uitsluitend uit een databaselookup op de gehashte token. Nooit uit een
> header, query-parameter of body.**

Er bestáát geen veld waarin een client een tenant kan benoemen. Dit is de reden dat een eerdere
implementatie (die de tenant uit een `X-Tenant-Id`-header las) is weggegooid in plaats van
gerepareerd.

Concreet: `clm.resolve_survey_token(hash)` is een `SECURITY DEFINER`-functie — de enige route naar
een responserij zónder tenantcontext. Dat lost een kip-en-ei op: de tenant is niet bekend vóór de
lookup. De functie geeft uitsluitend geldigheidsvelden terug: geen namen, geen e-mailadressen, geen
antwoorden.

### Waar welke garantie wordt afgedwongen

Dit is de verdeling waar ik je oordeel over wil.

| Garantie | Afgedwongen in |
|---|---|
| Tenant-isolatie | **Database** — RLS met `USING` én `WITH CHECK` op elke tenantgebonden tabel |
| Schrijven na indienen onmogelijk | **Database** — `WITH CHECK`-policy op `survey_answer`/`survey_attachment` |
| Toelichtingsplicht bij een niet-bevestiging | **Database** — CHECK-constraint |
| Antwoordwaarde in de juiste kolom per type | **Database** — CHECK-constraint |
| Antwoordtype gelijk aan dat van de vraag | **Database** — samengestelde foreign key |
| Vraag hoort bij de juiste vragenlijst | **Database** — samengestelde foreign key |
| Een lopende ronde bevriest de vragenlijst | **Database** — trigger |
| Eén respons per leverancier per ronde (UC1) | **Database** — partiële unieke index |
| Bestandsgrootte en -type | **Database** — CHECK; én servercontrole op magic bytes |
| Gekozen optie bestaat in `config.options[]` | **Servicelaag** — een CHECK kan de vraagrij niet lezen |
| Rating binnen `min…max` | **Servicelaag** — idem |
| `multi_choice`-aantallen | **Servicelaag** — idem |
| Aantal bestanden per vraag | **Servicelaag** — een CHECK kan niet over rijen tellen |
| Inhoud van de `config`-JSONB | **Servicelaag** — Postgres bewaakt JSONB-inhoud niet |

**De onderste vijf zijn de zwakke plek.** Ze leunen op applicatiecode, terwijl de rest van het
systeem juist op databasegaranties gebouwd is. Een trigger zou ze kunnen afdwingen. Ik heb dat niet
gedaan omdat het werk pas loont als blijkt dat de servicelaag hier faalt — **is dat de juiste
afweging?**

---

## 3. Datamodel, kort

Drie schema's: `clm` (domein), `ref` (opzoeklijsten), `audit` (append-only gebeurtenissen).

De survey-cluster, zeven tabellen:

```
survey_template ──< survey_category ──┐
      │                               │  samengestelde FK: een vraag kan geen
      └──────────< survey_question ───┘  categorie van een ándere template aanwijzen
                        │
survey_run ──< survey_response ──< survey_answer
                    │                    (FK op question_id + answer_type)
                    └──────────────< survey_attachment
```

**Twee kolommen op `survey_response` die de use cases scheiden:**

- `vendor_id` — de leverancier als **deelnemer**. Leeg bij UC2, want daar vult een collega in.
- `subject_vendor_id` — de leverancier als **onderwerp**. Bij beide gevuld.

Daardoor staan de zelfverklaring (UC1) en de praktijkscore (UC2) over dezelfde partij automatisch
naast elkaar. De uniciteitsregel is partieel (`WHERE vendor_id IS NOT NULL`) zodat UC1's garantie
"één leverancier, één respons" overeind blijft terwijl meerdere collega's dezelfde leverancier
mogen beoordelen.

**Vraag aan de reviewer:** is dit een heldere modellering, of is het een verkapte
polymorfe-relatie-constructie die op termijn pijn doet?

### Waarom aparte antwoordkolommen en geen JSONB

`survey_answer` heeft `answer_code`, `answer_codes[]`, `answer_text` en `answer_number` — vier
kolommen waarvan er per rij één gevuld is. Reden: een rating in een `NUMERIC` is te sorteren, te
middelen en te aggregeren; dezelfde waarde in JSONB is dat niet, en één niet-numerieke waarde laat
een hele rapportagequery klappen. Bij een instrument waarvan de uitkomst jaar op jaar vergeleken
wordt, is dat het verschil tussen bruikbare en onbruikbare data.

De prijs: vier grotendeels lege kolommen, en een vormconstraint van ~35 regels SQL die per type
afdwingt welke kolom gevuld mag zijn.

---

## 4. De toegangslaag

Het token: 32 bytes uit `crypto.randomBytes`, base64url, 43 tekens. **Opgeslagen als SHA-256; het
ruwe token staat nergens in de database.** Gevolg dat expliciet geaccepteerd is: een verloren link
is niet herstelbaar, alleen opnieuw te genereren.

Geen bcrypt/argon2 — de invoer is 256 bits entropie, dus een traag algoritme voegt niets toe en kost
bij elke request tijd.

**De guard maakt een bewust asymmetrisch onderscheid:**

| Situatie | Status |
|---|---|
| Onbekend token | 404 |
| Ingetrokken token | 404 — *ononderscheidbaar van onbekend, ook dezelfde melding* |
| Verlopen | 410 |
| Al ingediend | 410 |
| Ronde nog niet opengesteld (`draft`) | 410, met eigen melding |
| Ronde gesloten/gearchiveerd | 410 |
| Leverancier zacht verwijderd | 410 |

De redenering: onbekend en ingetrokken mogen niet te onderscheiden zijn, anders wordt de foutmelding
zelf informatie. Verlopen en al-ingediend krijgen wél een eigen melding, want de leverancier ontving
de link zelf en heeft er belang bij te begrijpen waarom hij niet meer werkt.

**Éénmaligheid** via één atomair `UPDATE … WHERE status = 'pending'`, niet via lezen-dan-schrijven.
Een dubbelklik kan geen twee indieningen opleveren.

**Logmaskering:** een `MaskerendeLogger` vervangt tokens in logregels vóór het wegschrijven. Een ruw
token in een logbestand is even gevoelig als een wachtwoord in platte tekst.

---

## 5. De OTAP-straat

### Wat er is

| Omgeving | Status |
|---|---|
| **O**ntwikkel | `docker-compose.yml` — backend met hot reload, plus minio en valkey |
| **T**est | `docker-compose.otap.yml` — **beide onderdelen als productie-image** |
| **A**cceptatie | **bestaat niet** (open issue) |
| **P**roductie | **bestaat niet** |

Het onderscheid tussen O en T is het punt: de ontwikkelstack draait de backend in ontwikkelmodus en
bewijst daarmee niets over het artefact dat uitgerold wordt. De OTAP-stack draait beide onderdelen
als productie-image.

### De doorloop

`scripts/otap-doorloop.js` — **21 controles in negen stappen**, handmatig te draaien:

| # | Wat |
|---|---|
| 1 | Zes `clm_*`-rollen aanwezig, runtime-rol zonder BYPASSRLS |
| 2 | Migratieketen volledig, RLS op elke tenantgebonden tabel, elke policy met `USING` én `WITH CHECK` |
| 3 | Backend-image draait, `/health` → 200 |
| 4–6 | Onbekend token → 404; geldig token → 200 zonder tenant-ID in de respons; draft-ronde → 410 |
| 7 | Vragenlijst komt uit de database: negen vragen, leesblok als `instruction`, uploadvraag met max 2 |
| 8 | Bevestigen zonder certificaat → 422; nep-PDF geweigerd op de bytes; upload → 201; indienen → 200; tweede poging → 410; alles vastgelegd inclusief auditregel |
| 9 | Frontend-image draait, serveert het portaal, praat met de echte backend (niet met mock data) |

**Wat de doorloop heeft opgeleverd — dit is het argument dat hij nut heeft.** Vijf bevindingen die
geen enkele unit- of e2e-test zag:

1. **Élke upload faalde in het productie-image**: `EACCES: permission denied, mkdir '/app/var'`. Het
   image draait als non-root, maar `/app` is eigendom van root. De e2e-tests misten dit omdat die
   naar een tijdelijke map schrijven.
2. Een routepad lekte naar de leverancier (`Cannot GET /survey/respond/questions`) omdat de frontend
   élke 404 van de backend vertrouwde — wat klopt voor de guard, maar niet voor een 404 van het
   framework zelf.
3. Het doorloopscript was zelf niet idempotent (twee keer, om twee verschillende redenen).
4. De seed vereist een bestaande tenantrij op een verse database.
5. Het portaal kan nog geen bestanden uploaden, waardoor een leverancier de vragenlijst niet via de
   browser kan afronden.

**Vraag aan de reviewer:** de doorloop is handmatig. Automatiseren vraagt beide repositories in één
workflow. Is "handmatig maar bewezen" hier verdedigbaar, of is dit precies het soort ding dat na
drie maanden niemand meer draait?

### Deploystrategie

**Eén uitrolweg: containerimages** (ADR-012). Vercel is overwogen en afgewezen — het geeft gratis
preview-URL's per PR, maar introduceert een tweede uitrolweg naast de containeraanpak van de
backend, die bij de overstap naar AWS weer afgeleerd zou moeten worden.

De prijs die daarvoor betaald wordt, expliciet: iets laten zien aan de klant is een handeling in
plaats van een link.

Beoogde doelplek bij golive: AWS App Runner (indicatie $25–40/mnd, **niet op de bron geverifieerd**).

---

## 6. Teststrategie

### Backend: 155 e2e-tests in twaalf suites

| Suite | Tests | Waarvoor |
|---|---|---|
| `antwoord-indienen` | 25 | De validatieregels bij indienen |
| `survey-token-isolatie` | 21 | Tokenlevenscyclus, éénmaligheid, cross-tenant |
| `vragenlijst-import` | 21 | Import/export, tenant nooit uit het bestand |
| `vragenlijst-ophalen` | 20 | De vragenlijstroute, UC1/UC2-scheiding |
| `bijlage-upload` | 18 | Magic bytes, grootte, padveiligheid, maximum |
| `survey-routes` | 12 | De HTTP-laag van buitenaf |
| `vragenlijst-seed` | 11 | De seedbestanden zelf als productinhoud |
| `schema-conformiteit` | 10 | Schema versus database, RLS-dekking |
| `drizzle-tenant-context` | 6 | De querylaag binnen tenantcontext |
| `tenant-rls-isolation` | 5 | RLS via ruwe queries |
| `app` + `health` | 2 | Rooktest |

*(De tabel telt `it()`-blokken: 151. Jest rapporteert er 155, omdat een paar
`it.each`-blokken meerdere tests genereren.)*

**Eén unittest** (`app.controller.spec.ts`). Vrijwel alles is e2e tegen een echte Postgres in een
wegwerpcontainer. Dat is een bewuste keuze: de garanties die ertoe doen zitten in de database, en
een mock bewijst daar niets over. **Is die verhouding verdedigbaar, of mis ik de snelheid en
precisie van een unittestlaag?**

### Twee gewoonten die ik belangrijk vind

**1. Tegenproef bij elke garantie.** Een test is pas iets waard als hij aantoonbaar rood wordt. Bij
elke stap is de betreffende controle tijdelijk verwijderd om te zien of de tests dat merken.

Dat leverde een leerzame mislukking op: bij de `FOR UPDATE`-vergrendeling op de uploadtelling bleven
**alle tests groen** met de vergrendeling verwijderd. Drie testopzetten geprobeerd; alle drie
waardeloos als tegenproef, omdat twee transacties via dezelfde connectiepool achter elkaar aan de
beurt komen. **Conclusie: de claim bijgesteld in plaats van de test te laten suggereren dat het
mechanisme bewezen is.** De vergrendeling staat er nog, maar het commentaar zegt expliciet dat hij
ongetoetst is. Zie §8.

**2. Idempotentie.** Elke suite moet twee keer achter elkaar tegen dezelfde database kunnen draaien.
Dat heeft meerdere echte fouten gevonden.

### Frontend: **geen enkele test**

Dit is de scherpste asymmetrie in het project. `MCM2-frontend` heeft geen testframework — geen Jest,
geen Vitest, geen Playwright. De CI draait er alleen format, lint, typecheck en een Docker-build die
controleert dat het image een pagina *serveert*.

De twee openstaande frontendbugs (uploadveld ontbreekt, leesblok krijgt keuzerondjes) zijn dan ook
**niet door een test gevonden maar door de browser open te doen**.

**Vraag aan de reviewer:** waar zou je hier beginnen — componenttests, of één end-to-end
browsertest die de hele flow doorloopt?

### CI

**Backend, drie parallelle jobs**, alle drie verplicht:

1. Format, lint, typecheck, unittests
2. Docker-productiebuild die het image ook daadwerkelijk **start** — deze poort ving een fout die
   geen test zag (een logmaskeringsbug die alleen in de gecompileerde vorm optrad)
3. Rollen bootstrappen → migraties via de migratierol → schema-conformiteit → de volledige e2e-suite
   tegen een ephemere Postgres

**Frontend, twee jobs:** kwaliteit (zonder tests) en een Docker-build die controleert dat het image
een pagina serveert.

**Geen branch protection op `main`.** Niet vergeten maar technisch geblokkeerd: GitHub vereist een
betaald plan voor een privérepository. Tot dat geregeld is, is "nooit rechtstreeks op main" een
werkafspraak zonder afdwinging.

---

## 7. Portabiliteit — de belangrijkste vraag

**Eis van de opdrachtgever:** wat nu gebouwd wordt moet **eenvoudig maar robuust** te verplaatsen
zijn naar bijvoorbeeld AWS.

### Wat er is gedaan om dat mogelijk te maken

| Keuze | Gevolg voor portabiliteit |
|---|---|
| Uitsluitend **standaard PostgreSQL** | Geen Supabase Auth, Storage, Edge Functions of `supabase-js`. De database is een gewone Postgres. |
| **Eén uitrolweg: containerimages** | Geen platformspecifieke buildstap. Hetzelfde image draait lokaal, in de OTAP-stack en straks op AWS. |
| Configuratie via **omgevingsvariabelen** | `DATABASE_URL`, `PORT`, `UPLOAD_DIR`. Geen ingebakken hosts. |
| **`storage_key` als relatief pad** | Verhuizen naar S3 raakt alleen `BestandOpslagService`, geen schemawijziging. |
| Migraties als **platte SQL-bestanden** | Geen ORM-specifiek migratieformaat dat elders niet draait. |

### Wat dat aantoonbaar heeft opgeleverd

MCM2 is **zonder één regel codewijziging** op Neon gedraaid (een andere Postgres-provider): alle zes
rollen aangemaakt, migraties toegepast, RLS en policies compleet, e2e-suite groen. Dat is gemeten,
niet beredeneerd.

### Waar ik twijfel — en waar ik je oordeel wil

1. **Bestanden op schijf.** De uploadmap is een pad in de container. Zonder volume zijn de
   certificaten weg zodra het image vervangen wordt. Er is een `VOLUME`-declaratie als waarschuwing,
   maar die lost het op een platform zonder persistente opslag niet op — en App Runner is precies
   zo'n platform, *voor zover ik weet; dit is **niet** op de bron geverifieerd en het is een van de
   punten waarop ik je wil laten meekijken.* De verhuizing naar S3 is voorzien maar niet gebouwd.
   **Is dit een acceptabele fase-1-keuze, of is het een fout die nu goedkoop en straks duur is?**

2. **`SECURITY DEFINER`-functie en rollenmodel.** De hele tenant-isolatie hangt aan zes
   PostgreSQL-rollen en een `SECURITY DEFINER`-functie. Dat is draagbaar tussen Postgres-providers,
   maar niet naar een managed dienst die geen `CREATE ROLE` toestaat. **Hoe reëel is dat risico?**

3. **De database is de applicatielaag.** Veel logica zit in constraints, policies en triggers. Dat
   maakt de garanties sterk, maar bindt het systeem aan PostgreSQL. Een overstap naar een andere
   database is geen optie meer — alleen naar een andere Postgres. **Is dat een aanvaardbare
   vergrendeling, of te ver doorgeschoten?**

4. **`NEXT_PUBLIC_API_URL` wordt tijdens de build ingebakken.** Eén image kan dus niet van
   acceptatie naar productie gepromoveerd worden zonder opnieuw te bouwen — wat botst met het
   principe "promoveer exact dezelfde image". Dit is een eigenschap van Next.js, geen keuze, maar
   het raakt de OTAP-straat direct. **Wat is hier de nette oplossing: runtime-configuratie via een
   endpoint, of per omgeving bouwen en accepteren dat het artefact verschilt?**

---

## 8. Wat ik zelf zwak vind

Op volgorde van hoe erg ik het vind.

### 8.1 Er zijn geen backups van de productiedatabase

De pilotdatabase draait op een gratis plan dat letterlijk meldt *"does not include project
backups"*. Niet beperkte backups — **geen**. Projecten worden na ~7 dagen inactiviteit gepauzeerd,
terwijl een surveylink 30 dagen geldig moet zijn.

Er is een gebouwde en geteste dagelijkse dump als vangnet, maar **die staat nog niet ingepland**, en
de bestemming is dezelfde machine. Dat beschermt tegen "de database valt om", niet tegen "de laptop
valt om".

De opdrachtgever heeft dit risico expliciet geaccepteerd voor de pilot. **Ik vind het nog steeds de
zwaarste openstaande blokkade.**

### 8.2 Geüploade bestanden vallen buiten élke backup

De database gaat mee in de dump; bestanden op schijf niet. De certificaten zijn daarmee het enige
onderdeel zonder vangnet — **en juist het onderdeel dat bewijsmateriaal bevat.**

### 8.3 Geen virusscan op uploads

Een leverancier kan een besmet bestand uploaden en het wordt bewaard. Wat het risico verkleint: het
bestand wordt nooit uitgevoerd, de opslagnaam is servergegenereerd, en er is geen route die het
inline serveert. Maar het is niet nul. De klantvraag hierover is nooit beantwoord.

### 8.4 Een ongetoetste concurrency-claim

De `FOR UPDATE`-vergrendeling op de uploadtelling zou twee gelijktijdige uploads serialiseren. **Dat
is niet bewezen** — met de vergrendeling verwijderd bleven alle tests groen. Ik heb de claim
bijgesteld in plaats van hem te laten staan, maar er zit nu een mechanisme in de code waarvan ik
niet kan aantonen dat het werkt. **Hoe zou jij dit toetsen?**

### 8.5 Vijf validatieregels leunen op applicatiecode

Zie de tabel in §2. Een bug in de servicelaag kan hier een ongeldig antwoord doorlaten dat de
database wél zou hebben geweigerd als er een trigger stond.

### 8.6 Frontend zonder tests

Zie §6. Twee bugs gevonden door de browser open te doen, niet door een test.

### 8.7 Kleinere punten

- **`tsconfig.json` is niet volledig strict** (`strictBindCallApply: false`). Open issue.
- **Geen branch protection**, technisch geblokkeerd door het GitHub-plan.
- **Geen logging/monitoring-laag.** Bij een incident in de pilot is er niets om in te kijken behalve
  containerlogs.
- **De audit-tabel is nog niet volledig append-only afgedwongen** voor de runtime-rol. Open issue.
- **De OTAP-doorloop draait handmatig.**
- **Het onderscheid ontwikkel- versus productiestack** betekent dat er twee compose-bestanden zijn
  die uit elkaar kunnen lopen.

---

## 9. Waar ik juist vertrouwen in heb

Voor de balans — en omdat een reviewer moet weten wat volgens mij niet aangeraakt hoeft te worden.

- **Tenant-isolatie is aantoonbaar, niet beweerd.** Getest via ruwe queries, via de ORM-laag, en via
  het tokenpad. Een eerdere "RLS werkt"-verificatie in dit project was vals-positief (lege tabel);
  dat is de reden dat er nu een geautomatiseerde test staat die ook rood wordt.
- **De schemaconformiteitstest groeit mee met de applicatie.** De verwachting wordt afgeleid uit de
  schemadefinitie, niet uit een lijst die veroudert bij de eerste nieuwe tabel. Hij faalt bij een
  tenantgebonden tabel zonder RLS.
- **Migraties draaien via een aparte rol** die de applicatie niet heeft, en de applicatie weigert te
  starten met een rol die RLS omzeilt.
- **De CI-poort "image moet ook starten"** heeft een echte bug gevangen.
- **Elke ontwerpkeuze staat vastgelegd** in twaalf ADR's en een statusdocument dat als enige
  waarheid geldt.

---

## 10. Concrete vragen

1. **§7** — Is de portabiliteitsclaim geloofwaardig? Met name: bestanden op schijf, het rollenmodel,
   en `NEXT_PUBLIC_API_URL` dat per omgeving een eigen image afdwingt.
2. **§2** — Klopt de verdeling database versus servicelaag? Horen de vijf servicelaag-regels in een
   trigger?
3. **§6** — Is 155 e2e-tests met één unittest een verdedigbare verhouding? En waar begin je met de
   frontend?
4. **§3** — Is `vendor_id` naast `subject_vendor_id` een heldere modellering of een valkuil?
5. **§5** — Is een handmatige doorloop verdedigbaar, of moet die eerst geautomatiseerd worden?
6. **§8.4** — Hoe toets je een vergrendeling waarvan de race niet uit te lokken is zonder een haak
   in productiecode?
7. **Wat mis ik**, vooral op het snijvlak van beveiliging en operatie?

> **Bijlage A bevat de kernfragmenten letterlijk uit de code** — de RLS-policy, de tenantfunctie, de
> `SECURITY DEFINER`-lookup, de guard, de CHECK-constraints, de trigger, de bestandscontrole, de
> OTAP-stack en een voorbeeldtest. Beoordeel op wat daar staat, niet op mijn samenvatting erboven.

---

## Bijlage A — de kernfragmenten

Letterlijk uit de code gekopieerd, zodat je kunt oordelen op wat er staat in plaats van op mijn
samenvatting. Commentaar is ingekort waar het alleen achtergrond gaf.

### A1. De tenantgrens: sessievariabele + RLS

De hele isolatie hangt aan één functie en het feit dat de runtime-rol geen `BYPASSRLS` heeft.

```sql
-- drizzle/0000_baseline_bestaand_schema.sql
CREATE OR REPLACE FUNCTION clm.current_tenant_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID
$$;
```

Elke tenantgebonden tabel heeft een policy met **zowel `USING` als `WITH CHECK`**. Zonder
`WITH CHECK` kan een rij met een vreemde `tenant_id` weggeschreven worden die daarna onzichtbaar is
— een lek dat pas bij een audit opvalt.

Het voorbeeld hieronder doet meer: het dwingt óók af dat er alleen geschreven mag worden zolang de
respons openstaat. Dat is de databasekant van de éénmaligheid; een bug in de applicatie kan die niet
omzeilen.

```sql
-- drizzle/0005_vragenlijst_niveau_b.sql
CREATE POLICY survey_answer_isolation ON clm.survey_answer
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (
        tenant_id = clm.current_tenant_id()
        AND EXISTS (
            SELECT 1
              FROM clm.survey_response r
             WHERE r.response_id = survey_answer.response_id
               AND r.tenant_id   = clm.current_tenant_id()
               AND r.status      = 'pending'
        )
    );
```

Let op de asymmetrie: **lezen mag altijd binnen de eigen tenant** — een ingediende respons moet
leesbaar blijven, anders is het bewijsmateriaal onbereikbaar. Schrijven mag alleen bij `pending`.

### A2. De enige plek waar een verbinding wordt geopend

Domeincode opent nooit zelf een client. Alles loopt via `withTenant()`, dat de tenantcontext als
eerste statement in de transactie zet — op dezelfde connectie, want een sessievariabele geldt per
connectie.

```ts
// src/db/database.service.ts
async withTenant<T>(
  tenantId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  if (!UUID_REGEX.test(tenantId)) {
    throw new Error(`Ongeldige tenant-id: '${tenantId}'`);
  }

  return this.db.transaction(async (tx) => {
    await tx.execute(setTenantContext(tenantId));
    return fn(tx);
  });
}
```

Waarbij `setTenantContext` een geparametriseerde `set_config` is — geen stringinterpolatie:

```ts
// src/db/schema.ts
export const setTenantContext = (tenantId: string) =>
  sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
```

Buiten deze methode is er geen tenantcontext, dus levert elke tenantgebonden query nul rijen op.

**Startcontrole:** de applicatie weigert te starten als de databaserol `BYPASSRLS` heeft. Zonder die
controle zou RLS betekenisloos zijn als isolatiegrens terwijl alles er goed uitziet.

### A3. De tokenlookup — `SECURITY DEFINER`

Dit is de kip-en-ei: de tenant is niet bekend vóór de lookup, dus deze ene functie moet buiten RLS
om kunnen kijken. Ze geeft **uitsluitend geldigheidsvelden** terug — geen namen, e-mailadressen of
antwoorden.

```sql
-- drizzle/0008_guard_kent_uc2.sql
CREATE OR REPLACE FUNCTION clm.resolve_survey_token(p_token_hash TEXT)
RETURNS TABLE (
    response_id   UUID,
    tenant_id     UUID,
    status        TEXT,
    expires_at    TIMESTAMPTZ,
    submitted_at  TIMESTAMPTZ,
    vendor_active BOOLEAN,
    run_closed    BOOLEAN,
    run_status    TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
    SELECT r.response_id,
           r.tenant_id,
           r.status,
           r.expires_at,
           r.submitted_at,
           -- subject_vendor_id, niet vendor_id: de leverancier waar de survey
           -- OVER gaat, niet degene die invult.
           (v.vendor_id IS NOT NULL AND v.deleted_at IS NULL) AS vendor_active,
           (run.revoked_at IS NOT NULL
            OR (run.closes_at IS NOT NULL AND run.closes_at < now())) AS run_closed,
           run.status AS run_status
      FROM clm.survey_response r
      LEFT JOIN clm.vendor     v   ON v.vendor_id = r.subject_vendor_id
      LEFT JOIN clm.survey_run run ON run.run_id  = r.run_id
     WHERE r.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION clm.resolve_survey_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clm.resolve_survey_token(TEXT) TO clm_api, clm_admin;
```

> Die `LEFT JOIN` op `subject_vendor_id` was tot 2026-07-29 een join op `vendor_id`. Bij UC2 is die
> kolom leeg, dus `vendor_active` werd `false` en **élke interne beoordeling kreeg 410**. Gevonden
> door de OTAP-doorloop, niet door een test — geen enkele test haalde een UC2-link over HTTP op.

### A4. De guard: waar de tenantcontext vandaan komt

De guard staat op **controllerniveau**, dus elke route die erbij komt is automatisch beschermd. Een
nieuwe route vergeten te beveiligen is geen mogelijkheid.

```ts
// src/survey/survey-token.guard.ts
async canActivate(context: ExecutionContext): Promise<boolean> {
  const request = context.switchToHttp().getRequest<RequestMetToken>();

  const uitkomst = await this.tokens.controleer(request.query?.t);

  if (!uitkomst.geldig) {
    // 404 voor onbekend/ingetrokken: geen informatie prijsgeven.
    // 410 Gone voor de rest: de link heeft bestaan en is nu definitief weg.
    if (uitkomst.reden === 'onbekend' || uitkomst.reden === 'ingetrokken') {
      throw new NotFoundException(melding(uitkomst.reden));
    }
    throw new GoneException(melding(uitkomst.reden, uitkomst.datum));
  }

  request.surveyToken = {
    responseId: uitkomst.responseId,
    tenantId: uitkomst.tenantId,
    expiresAt: uitkomst.expiresAt,
  };
  // …
}
```

**Het punt: `tenantId` komt uit `uitkomst`, dus uit de databaselookup.** Er is geen pad waarlangs een
client hem kan beïnvloeden.

### A5. De vormconstraint — één waardekolom per antwoordtype

Ingekort tot vier van de acht takken; de rest volgt hetzelfde patroon. Zonder dit kan een bug een
rating als tekst wegschrijven of een keuzecode in `answer_number` proppen — en dat merk je pas
maanden later bij de eerste rapportage, wanneer niemand meer weet wat er bedoeld was.

```sql
-- drizzle/0005_vragenlijst_niveau_b.sql
ALTER TABLE clm.survey_answer
    ADD CONSTRAINT survey_answer_shape_check
    CHECK (
        CASE answer_type
            WHEN 'confirmation' THEN
                answer_code IN ('confirmed', 'not_confirmed',
                                'not_applicable', 'cannot_upload')
                AND answer_codes IS NULL
                AND answer_text IS NULL AND answer_number IS NULL
            WHEN 'multi_choice' THEN
                answer_codes IS NOT NULL
                AND array_length(answer_codes, 1) >= 1
                AND answer_code IS NULL AND answer_text IS NULL
                AND answer_number IS NULL
            WHEN 'rating' THEN
                answer_number IS NOT NULL
                AND answer_number = trunc(answer_number)
                AND answer_code IS NULL AND answer_codes IS NULL
                AND answer_text IS NULL
            -- … open_text, yes_no, single_choice, number, file_upload
            ELSE false
        END
    );
```

De toelichtingsplicht is een aparte constraint — één regel die de kern van het compliance-instrument
afdwingt:

```sql
ALTER TABLE clm.survey_answer
    ADD CONSTRAINT survey_answer_comment_required_check
    CHECK (
        answer_type <> 'confirmation'
        OR answer_code = 'confirmed'
        OR length(btrim(coalesce(comment, ''))) >= 10
    );
```

De `coalesce` is niet cosmetisch: zonder die functie zou `length(btrim(NULL))` zelf `NULL` opleveren,
en een CHECK die `NULL` teruggeeft **slaagt** in PostgreSQL. Een ontbrekende toelichting zou er dan
gewoon doorheen komen.

*Alles behalve een bevestiging vereist uitleg van minstens tien tekens.* De ondergrens houdt "n/a" en
"-" tegen: die maken het veld formeel gevuld en inhoudelijk leeg, en zijn daarmee erger dan een leeg
veld — in een overzicht zien ze eruit als een antwoord.

### A6. De partiële unieke index — hoe UC1 en UC2 naast elkaar bestaan

```sql
CREATE UNIQUE INDEX survey_response_run_vendor_key
    ON clm.survey_response (run_id, vendor_id)
 WHERE vendor_id IS NOT NULL;
```

Bij UC1 is `vendor_id` gevuld en geldt "één leverancier, één respons". Bij UC2 is hij leeg, dus
mogen meerdere collega's dezelfde leverancier beoordelen. Een niet-partiële index zou bij het
toelaten van UC2 óók de UC1-garantie hebben verzwakt.

### A7. De bevriezingstrigger

De regel die bepaalt of antwoorden achteraf nog interpreteerbaar zijn: zodra er aan een vragenlijst
een ronde hangt die niet meer in `draft` staat, is die vragenlijst bevroren.

```sql
CREATE OR REPLACE FUNCTION clm.assert_template_niet_bevroren()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER
SET search_path = clm, pg_temp
AS $fn$
DECLARE
    doel_template UUID;
BEGIN
    doel_template := COALESCE(NEW.template_id, OLD.template_id);

    IF EXISTS (
        SELECT 1 FROM clm.survey_run r
         WHERE r.template_id = doel_template AND r.status <> 'draft'
    ) THEN
        RAISE EXCEPTION
            'Vragenlijst % is bevroren: er loopt of liep een ronde. '
            'Kopieer naar een nieuwe versie.', doel_template
            USING ERRCODE = 'raise_exception';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$fn$;

CREATE TRIGGER survey_question_bevriezing
    BEFORE INSERT OR UPDATE OR DELETE ON clm.survey_question
    FOR EACH ROW EXECUTE FUNCTION clm.assert_template_niet_bevroren();
```

Afgedwongen met een trigger en niet met een `if` in de servicelaag: anders is de garantie zo sterk
als de code die hem toevallig niet omzeilt, en hier hangt bewijskracht aan.

### A8. Bestandscontrole op de inhoud

Extensie en de meegestuurde `Content-Type` komen allebei van de client. Wat de server uit de eerste
bytes vaststelt is het enige dat telt — en dát is wat er opgeslagen wordt.

```ts
// src/survey/bestand-validatie.ts
const HANDTEKENINGEN = [
  { contentType: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },      // %PDF-
  { contentType: 'image/png',
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
] as const;

export function valideerBestand(inhoud: Buffer, beweerdType?: string): BestandUitkomst {
  if (inhoud.length === 0)                     return { geldig: false, reden: 'leeg' };
  if (inhoud.length > MAX_BESTANDSGROOTTE)     return { geldig: false, reden: 'te-groot' };

  const vastgesteld = bepaalContentType(inhoud);
  if (vastgesteld === null)                    return { geldig: false, reden: 'onbekend-type' };

  // Alleen om een mismatch te MELDEN — de opgeslagen waarde komt uit de bytes.
  if (beweerdType !== undefined && beweerdType !== vastgesteld) {
    return { geldig: false, reden: 'type-komt-niet-overeen' };
  }

  return {
    geldig: true,
    contentType: vastgesteld,
    sha256: createHash('sha256').update(inhoud).digest('hex'),
  };
}
```

De opslagsleutel bevat **geen enkel teken uit de invoer** — `../../etc/passwd.pdf` kan dus geen pad
worden:

```ts
export function maakOpslagsleutel(tenantId: string, responseId: string): string {
  return `${tenantId}/${responseId}/${randomUUID()}`;
}
```

De groottegrens ligt in de ontvangstlaag, niet erna — anders is een upload van 500 MB een
geheugenprobleem in plaats van een validatieregel:

```ts
// src/survey/survey-response.controller.ts
@UseInterceptors(
  FileInterceptor('file', {
    limits: { fileSize: MAX_BESTANDSGROOTTE, files: 1 },
  }),
)
```

### A9. De OTAP-stack

```yaml
# docker-compose.otap.yml (ingekort)
services:
  db:
    image: postgres:17.6
    ports: ["55500:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]

  api:
    build:
      context: .
      # Geen target: de laatste stage is de productie-image. Bewust niet de
      # development-stage — die bewijst niets over wat er uitgerold wordt.
    environment:
      DATABASE_URL: postgresql://clm_api_runtime:otap_pw@db:5432/postgres
      PORT: "5001"

  frontend:
    build:
      context: ../MCM2-frontend
      args:
        # NEXT_PUBLIC_* wordt tijdens de BUILD ingebakken, niet bij het starten
        # gelezen. Daarom een build-arg en geen environment-regel; dat laatste
        # zou stilzwijgend niets doen en de frontend op mock data laten draaien
        # terwijl je denkt dat hij live is.
        NEXT_PUBLIC_API_URL: http://localhost:5001
```

Die laatste opmerking is precies het portabiliteitsprobleem uit §7, punt 4: **één image kan niet van
acceptatie naar productie gepromoveerd worden zonder opnieuw te bouwen.**

En de Dockerfile-regels die de OTAP-doorloop afdwong:

```dockerfile
# Moet vóór `USER node` én van die gebruiker zijn: /app is eigendom van root,
# dus een non-root proces kan er geen submap in maken. Zonder deze regels faalt
# élke upload met "EACCES: permission denied, mkdir '/app/var'".
RUN mkdir -p /app/var/uploads && chown -R node:node /app/var
ENV UPLOAD_DIR=/app/var/uploads

# LET OP BIJ UITROL: dit is een map ín de container. Zonder volume zijn de
# certificaten weg zodra het image vervangen wordt.
VOLUME ["/app/var/uploads"]

USER node
```

### A10. Een test die de garantie toetst, niet de eigen code

Illustratief voor de gewoonte uit §6: de belangrijke garanties worden getoetst met **directe SQL die
de servicelaag overslaat**. Anders test je je eigen validatiecode en niet de garantie.

```ts
// test/antwoord-indienen.e2e-spec.ts
it('blokkeert schrijven na indienen op de RLS-policy zelf (testpunt 23)', async () => {
  const { token, responseId } = await maakRonde([{ key: 'q1', type: 'yes_no' }]);
  await dienIn(token, [{ questionKey: 'q1', answerCode: 'yes' }]).expect(200);

  const questionId = await db.withTenant(TENANT, async (tx) => {
    const r = await tx.execute<{ question_id: string }>(
      sql`SELECT a.question_id FROM clm.survey_answer a
           WHERE a.response_id = ${responseId}`,
    );
    return r.rows[0].question_id;
  });

  // De respons staat nu op 'submitted'. Deze INSERT hoort te falen op de
  // WITH CHECK-policy uit A1 — niet op applicatiecode.
  const geweigerd = await db
    .withTenant(TENANT, async (tx) => {
      await tx.execute(
        sql`INSERT INTO clm.survey_answer
                (tenant_id, response_id, question_id, answer_type, answer_code)
            VALUES (${TENANT}, ${responseId}, ${questionId}, 'yes_no', 'no')`,
      );
      return null;
    })
    .catch((fout: Error) => fout);

  expect(geweigerd).toBeInstanceOf(Error);
  // Drizzle verpakt de databasefout: de echte melding staat in `cause`. Een
  // test die alleen op `message` matcht wordt óók groen bij een tikfout in de
  // SQL — en test dan niets.
  const oorzaak = (geweigerd as Error & { cause?: Error }).cause;
  expect(oorzaak?.message).toMatch(/row-level security/i);
});
```

---

## Bijlage B — waar je kunt kijken

| Onderwerp | Bestand |
|---|---|
| Actuele stand, blockers, bewezen zaken | `docs/STATUS.md` |
| Besluiten met onderbouwing | `docs/adr/` (twaalf ADR's) |
| Ontwerp van de vragenlijst-tool | `docs/superpowers/specs/2026-07-28-vragenlijst-ontwerp.md` |
| Ontwerp van de toegangslaag | `docs/superpowers/specs/2026-07-28-leveranciertoken-ontwerp.md` |
| OTAP-runbook incl. bevindingen | `docs/runbooks/otap-doorloop.md` |
| Datamodel | `src/db/schema.ts`, `drizzle/0000`–`0008` |
| Toegangslaag | `src/survey/survey-token*.ts`, `drizzle/0003`, `0006`, `0008` |
| Validatieregels | `src/survey/antwoord-validatie.ts` |
| Bestandscontrole | `src/survey/bestand-validatie.ts` |
| CI | `.github/workflows/ci.yml` in beide repositories |
