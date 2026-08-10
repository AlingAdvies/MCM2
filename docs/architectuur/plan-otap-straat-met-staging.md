# Plan — een OTAP-straat met staging, van nul opnieuw doordacht

**Status:** voorstel, nog niet uitgevoerd
**Datum:** 2026-08-10
**Eigenaar:** Kees Aling
**Aanleiding:** de straat die op 09/10-08 op saxombp gebouwd is, loopt niet uit
op de database die er werkelijk toe doet. Dit plan trekt hem door tot het einde,
in de volgorde die de eigenaar heeft vastgesteld: **eerst de weg, dan de
inrichting, dan pas de vulling.**

---

## 0. Waarom dit plan bestaat

Op 10-08 is er in deze sessie een fout gemaakt die de aanleiding voor dit plan
scherpstelt. Een query op `clm.tenant` zonder tenantcontext gaf nul rijen. Dat
werd gelezen als "de database is kapot", terwijl RLS gewoon zijn werk deed. Op
die verkeerde meting is een diagnose gebouwd, en op die diagnose is toestemming
gevraagd om productiedata te verwijderen. De tenant AlingAdvies met 21
leveranciers, 7 responses en 34 antwoorden is daarmee weg.

Dat is geen reden voor een strenger protocol op het lezen van databases. Het is
een reden voor iets anders: **zolang de enige weg naar productie een mens met
een laptop is, is elke verkeerde inschatting van die mens direct
productiedataverlies.** Een straat die uitkomt op productie is geen luxe. Het is
de maatregel die precies dit onmogelijk maakt.

De drie eerdere incidenten wijzen dezelfde kant op:

| Datum | Wat er gebeurde | Wat ontbrak |
|---|---|---|
| 2026-08-04 | `clm-enterprise` liep achter, dump miste 9 van 18 tabellen (#25) | Bewijs dat productie op de verwachte stand stond |
| 2026-08-07 | Vier verzonnen commando's; bijna een migratie op productie | Een weg die het juiste commando afdwingt |
| 2026-08-10 | Werkende tenant verwijderd op basis van een meetfout | Een weg die handmatig ingrijpen overbodig maakt |

---

## 1. De keuze die alles bepaalt

**Waar draait staging?**

De eigenaar heeft vastgesteld dat er met staging gewerkt wordt, zoals dat bij
professionele SaaS hoort. Blijft de vraag waar die staging staat. Twee opties,
en ze sluiten elkaar uit.

### Optie A — staging bij Supabase (aanbevolen)

Een tweede Supabase-project, in dezelfde organisatie KeesOrg.

**Waarom dit wint:** een generale repetitie op ander toneel bewijst weinig.
Productie draait Postgres bij AWS in Ierland, achter een connection pooler.
Staging op saxombp draait Postgres in een container op een Ubuntu-machine thuis.
Dat is niet hetzelfde systeem. De pooler is precies zo'n plek waar het anders
gaat — verbindingen die anders worden vastgehouden, andere timeouts, ander
gedrag bij migraties die een tabel vergrendelen.

Staging bij Supabase betekent: dezelfde Postgres-versie, dezelfde pooler,
dezelfde netwerkweg, dezelfde manier van verbinden. Wat daar werkt, werkt in
productie.

**Wat het kost:** niets. Het gratis plan geeft twee actieve projecten.
`clm-enterprise` is er één; er zijn er vier gepauzeerd, en gepauzeerde projecten
tellen niet mee. Er is dus ruimte.

**De valkuil, en die is echt:** een gratis project pauzeert na 7 dagen zonder
databaseactiviteit. Staging is bij uitstek de omgeving die je niet elke week
raakt. Dan faalt een uitrol op een moment dat je denkt dat er iets stuk is,
terwijl er alleen iets sliep. Dit wordt afgevangen in §4.

### Optie B — staging op saxombp

Hergebruik van wat er al staat: `mcm2-productie` op poort 5021 wordt omgedoopt
tot staging.

**Waarom dit verliest:** het bewijst het verkeerde. Zie hierboven.

**Wanneer het toch wint:** als de eigenaar geen tweede Supabase-project wil, om
welke reden dan ook. Dan is staging op saxombp beter dan geen staging. Maar dan
moet in de documentatie staan wat het níét bewijst, anders geeft het
schijnzekerheid — en dat is gevaarlijker dan geen repetitie.

### Wat saxombp dan nog doet

Bij optie A verandert de rol van saxombp, maar hij verdwijnt niet:

- **Acceptatie (5011) blijft.** Dit is waar een nieuwe versie het eerst draait,
  tegen een wegwerpdatabase, met de e2e-suites erop. Snel, gratis, en het mag
  stuk.
- **Productie (5021) wordt opgeheven.** Die simuleerde iets dat straks echt
  bestaat. Twee dingen die "productie" heten is precies de verwarring die op
  10-08 tot dataverlies leidde.
- **De machine blijft de plek** waar gereedschap wordt uitgeprobeerd zonder
  risico. Dat is echte waarde.

De machine heeft ruimte: 7,5 GB geheugen waarvan 6,5 GB vrij, 87 GB schijf vrij,
2 cores, Ubuntu 22.04.5. De vier huidige containers gebruiken samen minder dan
1 GB.

---

## 2. Hoe de straat eruit komt te zien

```
  ┌─────────────┐
  │   GitHub    │  push naar main
  └──────┬──────┘
         │  CI: lint, unit, e2e tegen wegwerpdatabase, build
         ↓
  ┌─────────────┐
  │    GHCR     │  één image, getagd met de commit-SHA
  └──────┬──────┘
         │
         ↓  automatisch
  ┌─────────────────────────────────┐
  │  ACCEPTATIE  — saxombp:5011     │  wegwerpdatabase in container
  │  e2e-suites draaien hier        │  mag stuk, wordt weggegooid
  └──────┬──────────────────────────┘
         │
         ↓  automatisch, dezelfde SHA
  ┌─────────────────────────────────┐
  │  STAGING  — Supabase project 2  │  zelfde platform als productie
  │  gevuld met testdata            │  migraties worden hier eerst gedraaid
  └──────┬──────────────────────────┘
         │
         ↓  ALLEEN NA AKKOORD VAN DE EIGENAAR
  ┌─────────────────────────────────┐
  │  PRODUCTIE — clm-enterprise     │  echte data
  │  backup vooraf, verificatie na  │
  └─────────────────────────────────┘
```

**De kern:** één image, vier keer gedraaid, drie keer bewezen voordat het
productie raakt. Er wordt nergens opnieuw gebouwd. Wat op staging is
goedgekeurd, is bit voor bit wat naar productie gaat.

**De rem:** de laatste pijl is de enige die niet automatisch is. Een uitrol naar
productie wacht op een expliciet akkoord. Dat is geen gebrek aan vertrouwen in
de automatisering — het is de plek waar een mens hoort te kijken, en de enige
plek.

---

## 3. Fase 1 — de straat werkend krijgen

Dit is de fase die af moet zijn voordat er ook maar één rij data wordt ingevoerd.

### 3.1 Voorwaarde: Issue #51

**Zonder dit werkt de rest niet.** `NEXT_PUBLIC_API_URL` wordt nu tijdens de
build in de frontend gebakken. Eén image kan dus niet naar meerdere omgevingen —
en dat is precies wat de straat belooft.

Uit onderzoek op 10-08 (acceptatiecriterium 1 van #51):

- De browser praat nu rechtstreeks cross-origin met de backend, via
  `credentials: 'include'` in `src/core/api/client.ts`.
- Dat dwingt `CORS_ORIGIN` af op de backend — met `origin: *` plus credentials
  weigert elke browser.
- Er is **geen eis** dat dit cross-origin blijft: geen mobiele app, geen externe
  consument, frontend en backend rollen samen uit.

**Oplossing:** de Next.js-server wordt een same-origin proxy naar de backend. De
browser praat alleen met de frontend; de frontend weet waar de backend staat en
leest dat bij het starten uit een omgevingsvariabele.

**Wat dat extra oplevert** (staat niet in #51, maar is het sterkste argument):
frontend en backend worden dezelfde herkomst. `CORS_ORIGIN` kan dan wég. Dat is
één instelling minder die per omgeving goed moet staan — en `deploy-inrichten.js`
waarschuwt er nu al voor dat een fout hierin "elk beheerscherm een 401 geeft".
Die hele klasse fouten verdwijnt.

**Wat aandacht vraagt:**

| Onderdeel | Waarom het aandacht vraagt |
|---|---|
| `verstuurBestand` (multipart) | De proxy moet de stream doorgeven zonder te bufferen |
| `Sidebar.tsx` `/auth/login` en `/auth/logout` | Browsernavigaties, geen fetches — moeten óók door de proxy, anders komt het cookie op de verkeerde herkomst |
| `gebruiktMockData` | Hangt aan een lege `NEXT_PUBLIC_API_URL`; die schakelaar moet blijven werken, alle browsertests leunen erop |
| 5 al falende browsertests | In `instellingen` (3), `uitnodigen` (1), `vragenlijsten` (1). Eerst vastleggen als nulmeting, anders is niet te zien wat nieuw stuk is |

**Bewijs dat het af is:** hetzelfde image, zonder herbouw, draait tegen twee
verschillende backends. Dat is acceptatiecriterium 3 van #51 en het is de enige
maatstaf die telt.

### 3.2 Staging aanmaken

1. Nieuw Supabase-project in KeesOrg, regio **eu-west-1** — dezelfde als
   productie. Naam: `clm-staging`.
2. Rollen aanmaken via `db/roles/bootstrap-roles.sql`. Deze staan bewust niet in
   de migratieketen (ADR-009), dus ze moeten apart.
3. Alle 26 migraties draaien met `migrate:deploy`.
4. **Markeren als wat het is.** `clm.omgeving` staat standaard op `beschermd`.
   Staging bevat geen echte gegevens, dus `wegwerp` is de eerlijke markering —
   en die maakt seeden en e2e-tests er mogelijk.

**Verificatie, terug te lezen uit de database:** 26 migraties, hetzelfde aantal
tabellen als productie, RLS actief op dezelfde tabellen. Niet "het commando zei
dat het goed ging".

### 3.3 De uitrol naar staging automatiseren

Uitbreiding van `.github/workflows/ci.yml`: na een geslaagde acceptatie-uitrol
gaat dezelfde SHA naar staging.

Stappen, met de rem er al in:

1. Image ophalen uit GHCR op SHA-tag (nooit `latest` — zie §6)
2. Migraties draaien tegen staging
3. **Teruglezen** hoeveel migraties er nu staan. Nul of onveranderd = stoppen.
4. Applicatie starten
5. Rookproef: `/health` én een route die de database raakt

Stap 5 is een les van 09-08: een backend zonder tabellen antwoordt vrolijk 200
op `/health` en 401 op beheerroutes. De rookproef moet iets vragen dat alleen
kan slagen als de database gevuld is.

### 3.4 De uitrol naar productie automatiseren

Dezelfde stappen, plus vier remmen:

| Rem | Waarom |
|---|---|
| **Handmatig akkoord** | GitHub Environments met required reviewer. Niets gaat naar productie zonder dat de eigenaar drukt. |
| **Backup vooraf** | Verplicht, niet optioneel. Faalt de backup, dan gaat de uitrol niet door. |
| **Migratiestand teruglezen** | Vóór en ná. Wijkt het af van staging, dan stoppen. |
| **Terugdraaien beproefd** | De vorige SHA moet met één commando terug te zetten zijn. Dit is op 10-08 bewezen op saxombp; het moet opnieuw bewezen op deze weg. |

### 3.5 `.env` ontkoppelen van productie

**Dit is de grootste veiligheidswinst van het hele plan, en hij komt gratis mee.**

Nu wijzen `DATABASE_URL`, `MIGRATION_DATABASE_URL` en `BACKUP_DATABASE_URL` alle
drie naar Supabase-productie. Elk databasecommando op de laptop raakt de echte
database. Dat is de gemeenschappelijke oorzaak onder alle drie de incidenten uit
§0.

Zodra de uitrol via GitHub loopt, hoort de laptop dat adres niet meer te kennen.
`.env` gaat naar **staging** wijzen. De productiereferenties leven dan alleen nog
als GitHub secret.

**Wat er dan nog handmatig moet kunnen** — en dus een andere weg krijgt:

- Een noodherstel wanneer de straat zelf stuk is
- Een leesquery om iets te onderzoeken

Beide via `scripts/with-migration-url.js`, dat het doelwit expliciet maakt in
plaats van het uit `.env` te halen. Het commando moet zeggen wat het raakt.

---

## 4. Fase 2 — de infrastructuur precies goed inrichten

Pas als fase 1 werkt. Dit gaat over wat er per omgeving moet staan en hoe je
weet dat het klopt.

### 4.1 Wat er per omgeving hoort te zijn

| | Acceptatie | Staging | Productie |
|---|---|---|---|
| Waar | saxombp:5011 | Supabase `clm-staging` | Supabase `clm-enterprise` |
| Database | container, wegwerp | Supabase eu-west-1 | Supabase eu-west-1 |
| `clm.omgeving` | `wegwerp` | `wegwerp` | `beschermd` |
| Rollen | migrator + runtime | migrator + runtime | migrator + runtime |
| RLS | actief | actief | actief |
| Backups | nee | nee | dagelijks, met controle |
| e2e-suites | ja | nee | nooit |
| Data | wegwerp | testdata | echte data |
| Wie mag erbij | CI | CI | CI + eigenaar na akkoord |

### 4.2 Het pauzeerprobleem oplossen

Staging pauzeert na 7 dagen stilte. Aanpak:

- Een dagelijkse `SELECT 1` tegen staging, vanuit de Windows-taakplanner die al
  draait voor de backups.
- De uitrol naar staging controleert eerst of het project wakker is, en geeft
  een begrijpelijke melding als het pauzeert — niet een cryptische
  verbindingsfout.

Verdwijnt dit probleem bij een overstap naar Pro ($25/maand voor de organisatie
plus $10 voor het tweede project), dan kan de wakkerhouder weg. Tot die tijd is
hij nodig.

### 4.3 Een controle die de omgevingen vergelijkt

Nieuw: `npm run verify:omgevingen`. Leest van alle drie de omgevingen en
vergelijkt:

- Migratiestand — moeten gelijk zijn, of staging vooruit op productie
- Tabellen — zelfde verzameling
- RLS — actief op dezelfde tabellen
- Rollen — `clm_api_runtime` zonder BYPASSRLS
- Markering in `clm.omgeving`

Dit is de controle die op 04-08 had gemeld dat productie 9 tabellen miste, en
die vandaag had gemeld dat de tenant er wél was. **Alles teruglezen uit de
database, nooit uit een melding.**

### 4.4 Wat er nog helemaal niet is

Eerlijk benoemen wat dit plan niet oplost:

| Gat | Waarom het telt |
|---|---|
| **Geen bewaking** | Valt productie om, dan merkt niemand het. Geen alarm, geen dashboard. |
| **Geen incidentplan** | Er is geen procedure voor "productie is stuk". ISO27001-verplichting. |
| **Geen sleutelrotatie** | Het GHCR-token op saxombp verloopt rond **8 november 2026**. Dan stopt elke uitrol. |
| **Issue #46 — uploads** | Bestanden staan op een containerschijf en verdwijnen bij herstart. Deadline ~1 september. |

Deze horen in fase 3 of later, maar ze horen genoemd te zijn.

---

## 5. Fase 3 — pas dan: vulling en verbindingen

Expliciet als laatste, op verzoek van de eigenaar.

### 5.1 Productie opnieuw opbouwen

De database is op 10-08 leeggemaakt. Wat terug moet:

1. Tenant AlingAdvies **via de platformroute** — dan komt het in de audit trail
   terecht. De vorige tenant was er buitenom in gezet, en daarom stond er niets
   over in `audit.audit_event`.
2. `kees@alingadvies.nl` als admin én platformbeheerder.
3. Antwoordadres instellen (was `cmaling+transdev@gmail.com`).
4. Demo-leveranciers via `npm run seed:demo`, als de eigenaar die wil.

**Pas nadat de straat werkt.** Dan gebeurt dit langs de goede weg, met een spoor,
en is het herhaalbaar.

### 5.2 Testdata voor staging

Staging heeft data nodig, anders bewijst een migratie er niets. Een lege
database zegt alleen dat de software start.

Regel: **geen echte klantgegevens op staging.** Nu geen probleem — er zijn geen
betalende klanten — maar het moet vastliggen voordat die er zijn. De seed levert
verzonnen namen; die blijven verzonnen.

### 5.3 De frontend-backendverbinding

Volgt uit §3.1: same-origin proxy, `API_BASE_URL` bij het starten gelezen,
`CORS_ORIGIN` weg. Op dat moment is dit al gebouwd; hier wordt het alleen
vastgelegd als eindtoestand.

---

## 6. Wat dit plan bewust anders doet

### `latest` verdwijnt

Op saxombp draaien de containers nu op `ghcr.io/alingadvies/mcm2/api:latest`.
Aan de status is dus niet te zien welke code draait. Vanaf nu: **alleen
SHA-tags in acceptatie, staging en productie.** `latest` blijft bestaan voor
handmatig gebruik, maar de straat raakt hem niet aan.

### Eén ding heet "productie"

`mcm2-productie` op saxombp wordt opgeheven. Twee dingen die "productie" heten
is precies de verwarring die op 10-08 tot het verkeerde antwoord op de vraag
"wat zijn mijn rollen" leidde — en daarmee tot het dataverlies.

### Teruglezen is verplicht, melden is niet genoeg

Elke stap die iets wijzigt, leest terug wat er nu staat. Dit is regel 4 van
`docs/runbooks/commandos-en-omgeving.md` en het is drie keer bewezen nodig:
op 04-08 (dump miste tabellen), op 07-08 ("migraties voltooid" terwijl er niets
gebeurde) en op 10-08 (uitrol meldde succes over een lege database).

---

## 7. Draagbaarheid naar AWS

De eis was: relatief eenvoudig te migreren naar een professionele cloud. Wat dit
plan oplevert, vertaalt zich zo:

| Nu | Bij AWS | Wat er verandert |
|---|---|---|
| Containers via docker compose | ECS of App Runner | Een taakdefinitie in plaats van een compose-bestand |
| GHCR | ECR | Eén registeradres |
| Supabase Postgres | RDS Postgres | Eén connectiestring |
| Instellingen via omgevingsvariabelen | Idem | Niets |
| GitHub Actions | Idem, of CodePipeline | Niets, als je GitHub houdt |

**Wat er niet in zit, en dat is het punt:** geen enkele functie die alleen bij
één leverancier bestaat. Dat is vastgelegd in ADR-012 en het is de reden dat de
overstap van de database naar Neon destijds gratis was.

De uitzondering was de frontend. Issue #51 heft die op, en dat is precies waarom
het als eerste staat.

---

## 8. Volgorde en beslismomenten

| Stap | Wat | Beslissing nodig? |
|---|---|---|
| 1 | Issue #51 — frontend promoveerbaar | Nee, gaat sowieso door |
| 2 | Staging aanmaken bij Supabase | **Ja — §1, optie A of B** |
| 3 | Uitrol naar staging automatiseren | Nee |
| 4 | Uitrol naar productie automatiseren, met akkoordrem | Nee |
| 5 | `.env` omleiden naar staging | Nee, maar wel melden wanneer |
| 6 | `mcm2-productie` op saxombp opheffen | **Ja — onomkeerbaar** |
| 7 | `verify:omgevingen` bouwen | Nee |
| 8 | Productie opnieuw vullen | Nee |
| 9 | Testdata op staging | Nee |

**Ruwe inschatting:** stap 1 een halve dag; stappen 2–5 samen twee dagen;
stappen 6–9 een halve dag. Niet in één sessie, en niet in één dag.

---

## 9. Wat er misgaat als we dit niet doen

- Elke uitrol naar productie blijft een mens met een laptop. De incidenten van
  04-08, 07-08 en 10-08 herhalen zich, want er is niets veranderd aan de
  oorzaak.
- De straat op saxombp blijft bewijzen dat containers werken, maar niet dat
  *jouw* uitrol werkt.
- Zodra er een betalende klant is, wordt dataverlies zoals dat van 10-08
  onherstelbaar in plaats van vervelend.
- De overstap naar AWS wordt duurder, want de frontend heeft dan een eigen
  buildpijplijn per omgeving — en dat is permanent in plaats van eenmalig.
