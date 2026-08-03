# Implementatieplan — beheerkant, demo-tenant en robuuste OTAP

**Datum:** 2026-07-30
**Status:** goedgekeurd door de eigenaar; **fase 1 in uitvoering, driekwart af**
**Aanleiding:** drie samenhangende doelen van de eigenaar (zie §1)
**Raakt:** Issue #7 (spoor 1), #12, #16, #18, #23, #57, #58

---

## Voortgang (bijgewerkt 2026-07-30, einde tweede sessie)

Branch `feat/identiteit-en-membership`, vijf commits, nog niet gepusht.

| Fase | Onderdeel | Stand |
|---|---|---|
| **1** | Migratie 0009 — `external_subject`, `tenant_membership`, `gebruiker_bij_subject()` | ✅ |
| **1** | `src/auth/` — OIDC-config, code inwisselen, ID-tokenverificatie | ✅ |
| **1** | Migratie 0010 — `clm.sessie` + drie `SECURITY DEFINER`-functies | ✅ |
| **1** | `TenantContextGuard` | ✅ |
| **1** | Auth-routes `/auth/login`, `/auth/callback`, `/auth/logout` | ✅ |
| **1** | `X-Tenant-Id` verwijderen | ✅ bleek niets te verwijderen — zie hieronder |
| **2** | Vendorroutes en schermen | ✅ gemerged 2026-07-31 (MCM2#67, frontend#2) |
| **2b** | Sidebar, schermindeling en zoeken | ✅ 2026-08-03 — het deel van fase 2 dat was blijven liggen |
| **2c** | Vendordetail, wijzigen, contactpersonen | ✅ 2026-08-03 — inclusief rolcontrole; sluit §6 van het rechten-ontwerp |
| **3** | Demo-tenant seed | ✅ 2026-08-03 — `npm run seed:demo`, 8 e2e-tests, tegenproef vond een echt gat |
| 4 | OTAP-doorloop uitgebreid | niet gestart |

**Fase 1 is af (2026-07-31).** De keten `cookie → hash → clm.sessie_oplossen() → tenantId → withTenant()` staat en is bewezen. 205 e2e-tests in 15 suites, 158 unittests, productie-image gecontroleerd.

**`X-Tenant-Id` verwijderen bleek niets te verwijderen.** De header bestaat nergens in `src/` of `test/` — hij ging mee met de weggegooide branch `feat/fase0-skeleton-vendors`. Wat er nog van over is, staat uitsluitend in documentatie en gearchiveerde plannen. De stap is daarmee van vorm veranderd: van iets weghalen naar **bewijzen dat er geen tweede pad naar een tenantcontext bestaat**. Nagelopen: elke `withTenant()`-aanroep krijgt zijn tenantId van `SurveyTokenGuard` (spoor 2), van `TenantContextGuard` (spoor 1), of van het seed-script waar een beheerder de tenant zelf op de opdrachtregel meegeeft. Geen enkele HTTP-route accepteert een tenant uit de invoer.

**De tegenproef vond een echt gat** — het soort dat groene tests verbergt. Met een terugval op de `X-Tenant-Id`-header ingebouwd bleven alle 18 guard-tests groen: de test die een meegestuurde tenant hoorde te negeren stuurde namelijk een *geldig* cookie mee, dus de terugval kwam nooit aan de beurt. Een verzoek met alleen een header en geen cookie zou er zo doorheen zijn gekomen. Drie tests toegevoegd voor precies die gevallen; daarna faalde de sabotage wel. Dit is de vierde keer in dit project dat een tegenproef iets vond dat de tests misten.

**Twee besluiten die tijdens fase 1 zijn genomen en het plan aanvullen:**

- **Eén actief membership per gebruiker** (partiële unieke index). Multi-tenant toegang is alleen voor platformbeheer, en dat vraagt een eigen auditbaar mechanisme — uitgezocht werk, **Issue #57**. Weghalen is later één `DROP INDEX`.
- **Sessies in de database met een glijdend venster van 8 uur**; uitloggen verwijdert de rij. Dit stond in §4 als openstaand ontwerppunt en is nu beslist en gebouwd.

**Buiten het plan om afgerond:** de dagelijkse backup is ingericht en werkend bewezen (#30 grotendeels weg, restrisico in **#58**). Dat stond in §7 als "raakt dit plan maar lost het niet op".

### Twee dingen die bij elke fase meegaan

Uitdrukkelijke wens van de eigenaar op 2026-07-30: dit plan in volgorde afwerken, en deze twee punten niet laten wegzakken.

1. **`npm audit --omit=dev` moet 0 blijven.** Stand op 2026-07-30: `npm audit` meldt 29 kwetsbaarheden, `npm audit --omit=dev` meldt er **0** — alles zit in bouw- en testgereedschap, niets in het productie-image. Dat is de reden dat het geen blocker is (**Issue #59**). Controleer het bij elke fase; wordt het meer dan nul, dan raakt het wél het uitgerolde artefact en verandert de prioriteit.

   Niet oplossen met `npm audit fix --force`: dat zet eslint jaren terug en breekt de lint-configuratie. Hoort bij een major-onderhoudsronde, samen met Dependabot (#22).

2. **Elke fase eindigt met een werkende, geverifieerde stand** — niet met "bijna af". Dat betekent: format, lint, typecheck, unittests, e2e-tests en de Docker-build groen, plus een tegenproef op wat er aan beveiliging is toegevoegd. Groene tests zonder tegenproef bewijzen niets; dat is deze sessie drie keer gebleken.

---

## 1. Wat de eigenaar wil bereiken

Letterlijk gevraagd, in deze volgorde:

1. Een frontend die eruitziet als MVM_V2, degelijk en robuust verbonden met MCM2.
   Inloggen als tenant, en als die tenant vendors aanmaken met contactpersonen en
   e-mailadressen — zodat surveys verstuurd kunnen worden.
2. In diezelfde bijna-productieomgeving een volledig werkende **demo-tenant** die met
   mock data te vullen is.
3. Aantoonbaar zien dat de **OTAP-straat robuust werkt**.

## 2. Besluiten die dit plan sturen

Genomen op 2026-07-30, na afweging:

| Besluit | Keuze | Reden |
|---|---|---|
| Loginmechanisme | **Meteen Entra External ID**, geen tijdelijke tussenlaag | Een tijdelijke sessielogin bouw je twee keer en levert een tweede autorisatiepad op dat later opgeruimd moet worden. De PoC is al geslaagd; het resterende werk is backend-werk, geen onderzoek. |
| Demo-tenant | **Seed-script, gebouwd ná de guard** | Het script is omgevingsonafhankelijk (alleen `DATABASE_URL`) en draait later ongewijzigd tegen acceptatie. Maar het moet gebruikers met een Entra-identiteit kunnen vullen — dus pas schrijven als het membership-model vaststaat, anders vult het de verkeerde kolommen. |
| Uiterlijk | **Layout en navigatie overnemen, niet de compliance-panelen** | MVM_V2's vendordetailscherm heeft panelen (`SecurityReviewPanel`, `VendorDocumentRequirementsPanel`, `InteractionPanel`, contracten, certificeringen) waarvoor MCM2 geen datamodel heeft. Getrouw overnemen zou de UI het datamodel laten bepalen — de omgekeerde volgorde van §8. |
| OTAP | **Eerst lokaal robuust, dan AWS** | Conform STATUS.md. Issue #12 (AWS-acceptatie) blijft open maar is geen voorwaarde voor de eerste drie doelen. |

## 3. Wat er al ligt — en waarom dit kleiner is dan het klinkt

Geverifieerd tegen de draaiende OTAP-database op 2026-07-30, niet uit gespreksgeheugen:

- **`clm.vendor`** bestaat en is rijk: `name`, `kvk_number`, `vestigingsnummer`,
  `statutory_name`, `trade_names`, `legal_form`, `sbi_code`, `category_code`,
  `business_criticality_code`, `compliance_status_code`, `annual_spend_eur`,
  `risk_score`, `owner_user_id`, `last_review_date`, `next_review_date`, soft delete.
- **`clm.vendor_contact`** bestaat al, mét `email`, `phone`, `job_title`, `is_primary`
  en RLS. **Contactpersonen vragen dus geen nieuwe migratie.**
- **`clm.user`** bestaat, met RLS en een FK vanuit `vendor.owner_user_id`.
- **`DatabaseService.withTenant()`** heeft al exact de juiste vorm: het neemt een
  `tenantId`, zet die met `SET LOCAL` als eerste statement in één transactie, en
  weigert een niet-UUID. De docstring zegt zelfs al dat de tenantId uit geverifieerde
  identiteit hoort te komen.
- **CSV-parser** (`src/vendor/`) valideert al leveranciersimport, 58 unittests groen.
  Schrijft bewust nog niets weg.

**Wat dat betekent:** de guard hoeft de databaselaag niet te herbouwen. Hij hoeft
alleen te *bepalen* welke `tenantId` in `withTenant()` gaat, op een geverifieerde
manier. De schrijfroutes voor vendors zijn daarna gewone CRUD binnen een bestaand,
RLS-beschermd model.

**Wat ontbreekt:** `clm.user` heeft geen koppeling naar een externe identiteit
(geen `external_subject`/`oid`), en er is geen membership-tabel. Zonder dat kan de
guard niet bewijzen dat een ingelogde persoon bij een tenant hoort. Dat is de enige
echte modeluitbreiding in dit plan.

## 4. Bouwvolgorde

Vier fasen. Elke fase eindigt met iets dat aantoonbaar werkt en een controlemoment.

---

### Fase 1 — Geverifieerde identiteit en membership (Issue #7, spoor 1)

Dit is de flessenhals. Alles daarna hangt hieraan.

#### 1a. Migratie: identiteit en membership

Nieuwe migratie `0009_identiteit_en_membership.sql`:

- `clm.user` krijgt `external_subject text` — de stabiele identifier uit het
  ID-token (`oid`, niet `email`: een e-mailadres verandert, `oid` niet).
  Nullable, want bestaande rijen en seed-gebruikers hebben er geen.
- `UNIQUE (external_subject)` waar niet-null — één Entra-identiteit is één gebruiker.
- Nieuwe tabel `clm.tenant_membership`: `user_id`, `tenant_id`, `role`, `created_at`,
  soft delete. Primaire sleutel op `(user_id, tenant_id)`.
  RLS met `USING` én `WITH CHECK`, conform §7.
- Rol als `text` met CHECK op een kleine set (`admin`, `reviewer`) — geen aparte
  rollentabel voor twee waarden.

**Waarom een aparte membershiptabel en niet `user.tenant_id`?** `clm.user` heeft al
een `tenant_id`, maar dat maakt een gebruiker permanent van één tenant. §6 staat een
tenant-switch expliciet toe wanneer de gebruiker aantoonbaar lid is van beide. Zonder
membershiptabel is die switch niet te bouwen zonder de gebruiker te dupliceren.

Tenant-isolatietest verplicht (§7.4): een membership van tenant A mag niet leesbaar
of schrijfbaar zijn in de context van tenant B.

#### 1b. Authorization code inwisselen en token verifiëren

Nieuwe module `src/auth/`:

- **Config-gedreven**, conform de PoC-bevindingen stap 3: issuer-URL, JWKS-endpoint,
  client-ID en secret als environment-variabelen. Een latere verhuizing naar een
  Bizaline-tenant blijft dan een configuratiewijziging.
- `POST` naar het `/token`-endpoint van `mcm2ciam` met code + PKCE-verifier.
- ID-token verifiëren tegen de **JWKS** van de issuer: handtekening, `iss`, `aud`,
  `exp`, `nbf`. Niet zelf JWT-logica schrijven — een bestaande, gepinde bibliotheek
  (`jose`), conform §11.
- Claims uitlezen: `oid`, `email`, `tid`.

**Uitdrukkelijk niet:** het ID-token doorgeven aan de frontend als bearer token dat
bij elke call meegaat. De sessie loopt via een **httpOnly, secure, SameSite cookie**
die naar een server-side sessie verwijst. Een token in JavaScript-bereik is een
XSS-doelwit.

#### 1c. De guard

`TenantContextGuard`:

1. Leest de sessie uit de cookie.
2. Zoekt de `clm.user` op via `external_subject`.
3. Controleert membership voor de gevraagde tenant.
4. Zet de tenantId in de request-context; `withTenant()` gebruikt uitsluitend díé waarde.

**De `X-Tenant-Id`-route gaat eruit** zodra de guard staat. Zolang beide bestaan is
er een tweede pad naar tenantcontext, en dan is P0 niet dicht.

Er is geen productiedata die hierop leunt: de enige plek waar de header nu gebruikt
wordt, is testopzet.

#### 1d. Tests

- Membership-isolatie (cross-tenant read én write), verplicht per §7.4.
- Guard weigert: geen sessie, onbekende `external_subject`, geldige gebruiker zonder
  membership voor de gevraagde tenant, verlopen token.
- **Tegenproef**, conform de werkwijze in dit project: membershipcontrole tijdelijk
  uitschakelen en vaststellen dat precies de bedoelde tests omvallen. Groene tests
  zonder tegenproef bewijzen niets.

**Klaar wanneer:** je kunt inloggen via Entra, de backend leidt je tenant af uit het
geverifieerde ID-token, en een gebruiker zonder membership komt er niet in.

---

### Fase 2 — Vendorbeheer: schrijfroutes en schermen

#### 2a. Backend

`src/vendor/` uitbreiden met:

- `GET /vendors` — lijst, tenant uit de guard.
- `GET /vendors/:id` — detail inclusief contactpersonen.
- `POST /vendors` — aanmaken.
- `PATCH /vendors/:id` — wijzigen.
- `POST /vendors/:id/contacts`, `PATCH`/`DELETE` op contacten.
- **CSV-import activeren:** de bestaande parser krijgt eindelijk zijn schrijfpad.
  De geweigerde-e-mailregel uit ontwerp §2c hoort hier (onbekende vendor → weigeren
  en terugmelden, niet automatisch aanmaken).

Alles via `withTenant()`. Auditregels voor aanmaken/wijzigen/verwijderen, conform §7.7
(append-only voor de runtime-rol).

**Soft delete, geen harde delete.** `deleted_at` bestaat al op beide tabellen.

#### 2b. Frontend

In `MCM2-frontend`, naast het bestaande portaal:

- **Layout van MVM_V2 overnemen**: sidebar, kleuren, typografie, schermindeling.
  Kopiëren met bronvermelding, niet koppelen (ADR-012) — zoals de design tokens al
  gedaan zijn.
- Vendorlijst met zoeken en filteren.
- Vendordetail: stamgegevens + contactpersonen.
- Formulieren voor aanmaken/wijzigen van vendor en contactpersoon.

**Bewust niet overgenomen:** de compliance-panelen van MVM_V2. Zie §2.

**De bestaande CI-poorten blijven gelden:** geen leveranciersspecifieke imports, en
nooit een tenant in een URL. Die tweede poort is precies wat MVM_V2's `?tenant=demo`
zou tegenhouden.

**Klaar wanneer:** je logt in als tenant, maakt een vendor aan met contactpersoon en
e-mailadres, en ziet die terug in de lijst — in de browser, tegen de echte backend.

#### Fase 2b — wat er van 2b was blijven liggen (uitgevoerd 2026-08-03)

Fase 2 is op 2026-07-31 afgevinkt terwijl de frontend-helft maar deels gedaan was.
Van "sidebar, kleuren, typografie, schermindeling" hierboven waren alleen de
kleuren en typografie overgenomen; de sidebar en de schermindeling niet. Dat viel
op toen de eigenaar vroeg waarom het er anders uitzag dan MVM_V2.

**Gebouwd:**

- `Sidebar.tsx` en `AppLayout.tsx`, overgenomen uit MVM_V2 met bronvermelding.
- Zoeken op de leverancierslijst (naam, KvK, plaats; losse woorden).
- `GET /auth/sessie` in de backend — de frontend wist niet wie er was ingelogd.

**Drie dingen bewust anders dan MVM_V2:**

- **Alleen menu-items die werken.** MVM_V2 toont er zes; hiervan bestaat alleen
  Leveranciers. Een menu-item naar een lege pagina belooft iets dat er niet is.
- **Geen gebruikersschakelaar.** MVM_V2 heeft er een voor demo's op mock data;
  hier zou dat een tweede pad naar identiteit zijn naast het sessiecookie —
  precies wat Issue #7 uitsluit.
- **Geen verborgen knoppen bij open routes.** `POST /vendors` staat open voor elke
  geldige sessie, dus ook voor een `reviewer`. De knop verbergen zou de indruk
  wekken dat er een rechtenmodel is. Zie het rechten-ontwerp §6.

**De tegenproef vond opnieuw een echt gat.** Met een `tenantId` toegevoegd aan het
antwoord van `/auth/sessie` bleven **alle acht browsertests groen**: de sidebar
toont dat veld niet, dus het kwam nooit in beeld terwijl het wél over de lijn
ging. Een lek test je bij de bron, niet bij de plek waar je hoopt dat het niet
opduikt — vandaar `test/sessie-route.e2e-spec.ts`, die het antwoord zelf
controleert. Met de sabotage erin vallen daar twee tests om.

**Bijvangst: een onregelmatig falende doorloop opgelost.** `verify:volledig` faalde
wisselend op `psql: connection to server on socket … failed`. Oorzaak: het
postgres-image start tijdens de eerste initialisatie een *tijdelijke* server die
alleen op de Unix-socket luistert; `pg_isready` meldt die als gereed, waarna het
image herstart. Een `psql` die daartussen valt, faalt met een melding die naar de
verkeerde oorzaak wijst. De wachtlus eist nu twee opeenvolgende geslaagde
queries. Daarna vijf runs achter elkaar groen.

**Feature flags zijn níét gebouwd.** De eigenaar wees erop dat die twee lagen
kennen — betaalde features per tenant, én verschillen per gebruiker binnen een
tenant. Dat is uitgewerkt in
`docs/superpowers/specs/2026-08-03-feature-flags-en-rechten.md`, met drie manieren
om laag 1 vast te leggen en een advies. Besluit ligt bij de eigenaar; 2b bouwt
alleen `magZien()`, de plek waar beide lagen straks samenkomen.

#### Fase 2c — detail, wijzigen en contactpersonen (uitgevoerd 2026-08-03)

Het laatste deel van fase 2. Een leverancier is nu te openen op
`/beheer/leveranciers/[id]`, te wijzigen en te verwijderen, en zijn
contactpersonen zijn te beheren.

**Nieuw in de backend:** `GET /vendors/:id`, `PATCH /vendors/:id`,
`DELETE /vendors/:id`, plus `POST`, `PATCH` en `DELETE` op
`/vendors/:id/contacts`. Allemaal soft delete — een leverancier kan in een
surveyronde voorkomen, en die respons is bewijsmateriaal.

**`RolGuard` sluit een openstaand punt.** Tot vandaag stond `POST /vendors` open
voor elke geldige sessie: `reviewer` was een label in de sidebar zonder
betekenis. Nu geeft elke schrijfroute 403 voor een reviewer, en lezen mag hij
wel. Daarmee is §6 van het rechten-ontwerp dicht — de tussenvorm die dat
document als gevaarlijkst benoemde (knop verborgen, route open) is nooit
gebouwd.

**Wat bewust níét wijzigbaar is:** risicoscore, jaarbedrag en reviewdatums. Die
horen uit een beoordeling of een inkoopsysteem te komen; een handmatig
ingevulde risicoscore botst met een berekende zodra die er is. Besluit van de
eigenaar.

**Twee tegenproeven, beide raak:**

- Rolcontrole uitgeschakeld → de vijf reviewer-tests vielen om, zoals bedoeld.
- De `vendor_id`-controle uit de contactquery → precies één test viel om.
  Zonder die controle was een contactpersoon van leverancier A te wijzigen via
  het adres van leverancier B, binnen dezelfde tenant.

**Een onregelmatig falende test opgespoord en opgelost.** `demo-seed.e2e-spec.ts`
(fase 3) faalde wisselend op de tokenhash-test: die las de tokens uit de
uitvoer van het seed-script, en dat script drukt de links alleen af wanneer het
de ronde daadwerkelijk aanmaakt. Had een andere suite de tenant al gevuld, dan
vond de test nul links en viel om op iets dat niets met hashing te maken had.
De tokens worden nu berekend zoals het script ze berekent. Daarna drie keer
vanaf een lege database groen.

**Twee dingen die het bouwen opleverde en aandacht verdienen:**

- **`consulting` en `consultancy` staan allebei in `ref.vendor_category`** — twee
  codes voor hetzelfde begrip. `consultancy` komt uit de baseline, `consulting`
  uit migratie 0012 van vanochtend. De frontend toont alleen `consulting`;
  bestaande rijen met `consultancy` blijven werken en tonen hun eigen waarde.
  Opruimen is een migratie die bestaande data raakt en apart afgestemd moet
  worden.
- **De startpagina gebruikte een `<a>` naar een interne route.** Die lintfout
  sluimerde en werd pas zichtbaar toen de detailroute erbij kwam: ESLint
  herkent `/beheer/leveranciers` nu als bekende pagina. Opgelost met `<Link>`.

---

### Fase 3 — Demo-tenant met mock data

`scripts/seed-demo-tenant.js`, in de vorm van de bestaande seedscripts
(idempotent, `DATABASE_URL`-gedreven, plain JavaScript).

Vult:

- Eén demo-tenant.
- Gebruikers mét `external_subject` en membership — anders kun je er niet in inloggen
  en kijk je naar onbereikbare data. **Dit is de reden dat deze fase ná fase 1 komt.**
- Leveranciers en contactpersonen, afgeleid uit `vendors.mock.ts` van MVM_V2 en het
  bestaande `db/seeds/voorbeeld-leveranciers-coupa.csv`.
- Beide vragenlijsten (hergebruikt: `seed-vragenlijsten.js`).
- Een actieve surveyronde met een paar responses in verschillende stadia — open,
  concept, ingediend — zodat de statusweergave iets te tonen heeft.

**Herhaalbaar en weggooibaar.** Twee keer draaien geeft hetzelfde resultaat.

**Let op:** dit script is *geen* testfixture. `otap-doorloop.js` houdt zijn eigen
opzet; twee scripts die dezelfde rijen claimen gaan elkaar in de weg zitten.

**Klaar wanneer:** één commando vult een demo-tenant, je logt erin en ziet gevulde
schermen.

#### Uitgevoerd op 2026-08-03

`npm run seed:demo` vult de tenant `dededede-…-0001` in één commando: 3 gebruikers
met membership, 21 leveranciers met contactpersoon en tags, beide vragenlijsten en
één actieve ronde met drie responses. `--verwijder` haalt alles weer weg.

**De bron is MVM_V2** (`src/data/vendors.mock.ts`), zoals dit plan voorschreef —
maar éénmalig geëxtraheerd naar `db/seeds/demo/leveranciers.json` in plaats van
geïmporteerd. Een `import` uit `../../MVM_V2` werkt niet in een container of op een
andere machine, en dat is precies waar dit script moet draaien.

**`mvm-api-pilot/Database/import-mock-data.ts` is bekeken en niet hergebruikt.**
Dat script zet RLS uit (`session_replication_role = 'replica'`), draait als
superuser, heeft productiereferenties hardgecodeerd en schrijft naar tabellen die
MCM2 niet heeft (`contract`, `document`, `certification`, `task`, `issue`). Alleen
de databron eruit is bruikbaar. Zie ook de opmerking bij Issue #1 hieronder.

**Migratie 0012 was nodig.** De mock-data gebruikt negen code-waarden die de
`ref`-tabellen niet kenden — zeven categorieën, plus `critical` en `at_risk`.
Besluit van de eigenaar: toevoegen, niet vervlakken naar `other`/`high`. Anders
heet de helft van de demo "Overig" en is dezelfde migratie later alsnog nodig,
dan met gevulde rijen.

**Drie dingen die het datamodel afdwong** en waar het script zich naar voegt in
plaats van omheen:

- **"Concept" is geen status.** `survey_response.status` kent alleen `pending`,
  `submitted` en `revoked`. Een concept is een `pending` response mét antwoorden.
- **Antwoorden kunnen alleen op een `pending` response.** De policy op
  `survey_answer` heeft dat in zijn `WITH CHECK`. Het ingediende stadium wordt dus
  eerst ingevuld en daarna ingediend — dezelfde volgorde als een echte invuller.
- **De tenantrij wordt aangemaakt bínnen de tenantcontext.** Buiten de context
  weigert RLS de INSERT.

**De tegenproef vond een echt gat** — de vijfde keer in dit project. Met de
tokenhash vervangen door een hex-codering van het ruwe token bleven alle acht
tests groen, terwijl de waarde omkeerbaar was: wie de databasedump heeft, kan dan
elke openstaande survey openen. De test controleerde de vórm van de hash, niet dat
het de hash ís. Nu herberekent hij de verwachte SHA-256 uit het bekende token; met
de sabotage erin valt precies die ene test om.

**Een tweede fout kwam pas bij het openen van een link aan het licht:** de eerste
demo-tokens waren 38 en 39 tekens, terwijl `heeftGeldigeVorm()` er exact 43 eist.
Het seeden slaagde, de database accepteerde de hash — maar elke demo-link werd
door de guard geweigerd vóórdat de database geraadpleegd werd. Het script berekent
de lengte nu zelf en faalt hard bij een afwijking.

**Gemeten tegen de draaiende API**, niet alleen in tests:

```
open       /survey/respond/questions?t=…  200  (9 vragen)
concept    /survey/respond/questions?t=…  200
ingediend  /survey/respond/questions?t=…  410  "al ingediend op 3 augustus 2026"
```

Plus: 21 leveranciers zichtbaar in demo-context, **0** vanuit een andere tenant,
**0** zonder tenantcontext, en nul tenant- of response-ID's in de respons.

**Wat er níét is:** inloggen als demo-gebruiker. Hun `external_subject` begint met
`demo:` en is geen echte Entra-`oid`, dus de guard laat ze niet door. Dat is
bewust — een verzonnen UUID zou niet te onderscheiden zijn van een echte
identiteit en zou kunnen botsen op de unieke index. De schermen zijn te bekijken
via de tokenlinks; inloggen vraagt om het koppelen van een echte `oid`.

---

### Fase 4 — OTAP-straat robuust

`scripts/otap-doorloop.js` uitbreiden van de huidige 21 controles met:

- Login-keten: authorization code → token → sessie → guard laat door.
- Guard weigert een gebruiker zonder membership.
- Vendor aanmaken via de API, terugvinden in de lijst, cross-tenant onzichtbaar.
- Contactpersoon toevoegen.
- Demo-seed draaien en verifiëren dat het resultaat klopt.
- De frontend praat écht met de backend (bestaande controle, uitbreiden naar de
  nieuwe schermen).

Plus twee dingen die de straat pas robuust maken:

- **Idempotentie bewijzen**: twee keer achter elkaar draaien zonder `down -v`, beide
  keren groen. Dat is eerder misgegaan (bevinding 2 van 2026-07-29).
- **Vanaf niets**: `down -v` gevolgd door een volledige doorloop.

**Klaar wanneer:** één commando bewijst de hele keten, twee keer achter elkaar, en
ook vanaf een lege database.

Issue #18 blijft daarna open — die vraagt A en P, en die omgevingen bestaan nog niet
(#12). Dat is bewust: dit plan maakt O en T robuust.

---

## 5. Wat dit plan expliciet niet doet

- **Geen AWS-acceptatieomgeving** (#12). Losse beslissing, kost geld, niet nodig voor
  deze drie doelen.
- **Geen e-mailverzending** (#13). "Surveys kunnen versturen" betekent hier: de
  gegevens staan klaar en de ronde is te starten. Het daadwerkelijk versturen wacht
  op de SMTP-details van Transdev (OV-9, nog open) — dat is een klantafhankelijkheid,
  geen bouwkeuze.
- **Geen compliance-panelen** uit MVM_V2. Zie §2.
- **Geen aanpassingen aan de tokenlaag** voor leveranciers. Die is af, gemerged en
  bewezen; dit plan raakt hem niet.

## 6. Risico's en aandachtspunten

| Risico | Impact | Beheersing |
|---|---|---|
| Entra-flow blijkt weerbarstiger dan de PoC suggereert | Fase 1 loopt uit | De PoC is end-to-end geslaagd tot een geldige code; het resterende werk is server-side en goed gedocumenteerd. Bij de eerste blokkade: eerst Microsoft Learn lezen, niet gokken (§6 van MCM2-CLAUDE.md, en de les uit de PoC zelf). |
| Client secret van `mcm2ciam-federation-trust` | Secret in configuratie | Nooit in git, nooit in logs. Via environment-variabele, `.env` blijft ge-ignored. Rotatie mogelijk zonder codewijziging. |
| Sessiecookies over http bij lokaal draaien | `secure`-cookie werkt niet op http | Cookie-instellingen omgevingsafhankelijk maken; `secure` verplicht buiten ontwikkeling. Expliciet gemarkeerd, conform §6 over tijdelijke lokale ontwikkelcontext. |
| Demo-tenant en OTAP-doorloop botsen | Onbetrouwbare tests | Gescheiden tenants en gescheiden UUID-reeksen. |
| Scope groeit tijdens fase 2 (MVM_V2 heeft veel schermen) | Fase 2 loopt uit | De grens staat in §5. Een paneel toevoegen vraagt een datamodel-onderbouwing, geen UI-argument. |
| `deleted_at` en RLS | Migratie 0004 haalde `deleted_at` bewust uit de RLS-policies | Filtering op soft delete hoort in de query, niet in de policy. Bij het bouwen van de vendorroutes expliciet meenemen. |

## 7. Openstaande punten die dit plan raakt maar niet oplost

- **#30 (geen backups)** blijft de zwaarste blokkade voor alles wat de
  productiedatabase raakt. Dit plan bouwt tegen wegwerpcontainers en raakt
  `clm-enterprise` niet — maar #30 blijft openstaan en vraagt uitvoering door de
  eigenaar (dagelijkse dump inplannen, `BACKUP_DIR` naar een tweede locatie).
- **#46** heeft een harde datum: pilot rond 1 september, en geüploade certificaten
  staan op een containerschijf die bij de eerstvolgende image-vervanging leeg is.
  Staat los van dit plan, maar loopt op een klok.
- **#16** (export- en reminderacties krijgen expliciet `tenantId` mee) wordt door de
  guard makkelijker op te lossen, maar valt buiten deze scope.
- **#23** (MVM_V2-inconsistenties) wordt hier deels omzeild door bewust niet getrouw
  te kopiëren.

## 8. Volgorde in één oogopslag

```
Fase 1  identiteit + membership + guard      → inloggen werkt, P0 dicht
Fase 2  vendorroutes + schermen              → vendor aanmaken in de browser
Fase 3  demo-tenant seed                     → gevulde schermen
Fase 4  OTAP-doorloop uitgebreid             → de keten bewezen, twee keer
```

Elke fase krijgt een eigen feature branch, conform het branch-ritueel. Na elke fase:
STATUS.md bijwerken (§13b) en een controlemoment met de eigenaar.
