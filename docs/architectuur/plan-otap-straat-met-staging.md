# Plan — een OTAP-straat met staging, van nul opnieuw doordacht

**Status:** in uitvoering — **stap 1, 2, 2b, 3, 4, 5 en 6 zijn gedaan**.
Volgende: stap 7 (`verify:omgevingen` bouwen)
**Datum:** 2026-08-10, bijgewerkt 2026-08-12
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
  → ✅ **Gedaan 12-08.** De *databasecontainer* is weg; de applicatie op 5021
  blijft draaien, maar nu tegen Supabase `clm-enterprise`. Zie §"Eén ding heet
  productie".
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

### 3.1 Voorwaarde: Issue #51 — ✅ GEDAAN op 2026-08-10

**Zonder dit werkte de rest niet.** `NEXT_PUBLIC_API_URL` werd tijdens de build
in de frontend gebakken. Eén image kon dus niet naar meerdere omgevingen — en
dat is precies wat de straat belooft.

**Uitgevoerd.** De browser praat alleen nog met de frontend zelf; alle aanroepen
gaan naar `/api/backend/...`, een server-side route die `API_BASE_URL` bij elke
aanroep uit de omgeving leest.

| Wat | Uitkomst |
|---|---|
| Acceptatiecriterium 1 — moet de browser cross-origin praten? | Nee. Alle 18 componenten die services aanroepen zijn `'use client'`; frontend en backend rollen samen uit |
| Acceptatiecriterium 2 — same-origin doorgeefluik | `src/app/api/backend/[...pad]/route.ts` |
| Acceptatiecriterium 3 — hetzelfde image, twee backends | Bewezen, zie hieronder |
| `profiles:` uit `docker-compose.omgeving.yml` | Weg |
| Browsertests | 55 geslaagd, 5 gevallen — dezelfde als de nulmeting, geen regressie |

**Het bewijs.** Image `sha256:8526dae2…` twee keer gestart, verschil alleen
`API_BASE_URL`, hetzelfde sessiecookie meegestuurd: container A gaf de
leverancierslijst uit de demo-database, container B een 401 uit een verse
database. Geen herbouw tussendoor.

**Tegenproef gedraaid**, want een geslaagde meting bewijst geen grens: met een
onbereikbaar `API_BASE_URL` geeft het doorgeefluik een 502 met een leesbare
melding. Geen stil terugvallen op voorbeelddata.

**Twee dingen die aandacht verdienen bij het vervolg:**

1. **De mock-schakelaar is omgekeerd.** Voorheen betekende een lege variabele
   mock data; nu moet mock expliciet aan met `NEXT_PUBLIC_MOCK_DATA`. Vergeten
   instellen gaf vroeger een scherm vol verzonnen data dat er echt uitzag, en
   geeft nu een zichtbare fout — de veilige kant van de twee.
2. **`API_BASE_URL` is géén browseradres.** Het wordt aangeroepen door de
   frontend-container, waarbinnen `localhost` de container zelf is. In compose
   is dat `http://api:5001`. Dat is het spiegelbeeld van `CORS_ORIGIN`, en die
   twee zijn makkelijk te verwarren.

**Wat dit níét oploste:** de frontend-image werd nergens gepubliceerd. Dat is
stap 2b geworden, hieronder.

### 3.1c De eerste echte uitrol met frontend — ✅ GEDAAN op 2026-08-10

De keten is één keer helemaal doorlopen naar acceptatie. Dat leverde meer op dan
een draaiende omgeving: **de eerste poging faalde**, en dat was de opbrengst.

**Vier dingen die alleen bij een echte uitrol boven komen:**

| Wat | Wat er misging | Wat eruit volgde |
|---|---|---|
| Het compose-bestand op de server | Stond nog met `profiles: ["frontend"]` erin. Zonder `--profile` slaat compose die dienst over: geen fout, geen container, alleen `kreeg 000` | `deploy.js` vergelijkt nu de sha256 vóór elke uitrol (PR #129) |
| Inloggen | `OIDC_*` ontbrak volledig — nooit onderdeel van de inrichting geweest. `/auth/login` gaf een kale 500 | Variabelen toegevoegd, redirect via de frontend (PR #130) |
| HTTPS | Entra weigert een `http`-redirect behalve op localhost | `tailscale serve` levert een geldig certificaat; `SESSIE_COOKIE_INSECURE` kon eruit |
| De rookproef | Een frontend met een verkeerd backend-adres gaf **200** op de startpagina | De nieuwe controle "frontend bereikt de backend" ving het met een 502 |

Die laatste is bewezen door hem te saboteren: een container met een onbereikbaar
`API_BASE_URL` serveert een pagina alsof er niets aan de hand is.

**Eindstand acceptatie:**

```
● frontend   sha-635ff21150bd
● api        sha-51319eaa4059
● db         17.6 (healthy)

https://saxombp.tail4b29b.ts.net   (tailnet only, geldig certificaat)
```

**Wat er nu in staat**, aangemaakt langs de bedoelde weg en teruggelezen uit de
database:

| | |
|---|---|
| Platformbeheerder | via `platform:inrichten`, met een echte Entra-login |
| Tenant `Platformbeheer` | `…f1a7` — de administratieve thuisbasis, geen klant |
| Tenant `AlingAdvies (acceptatie)` | via `POST /platform/tenants`, de échte route |
| Audit trail | `platformbeheerder_aangewezen`, `tenant_aangemaakt` |

Dat laatste is het punt: de vorige AlingAdvies-tenant op productie was er
buitenom in gezet, en daarom stond er niets over in `audit.audit_event`. Deze
keer wel.

**Drie bevindingen die daarbij boven kwamen**, alle drie vastgelegd als issue:

- **#131** — `mailVerstuurd: true` terwijl het logkanaal `[niet echt verstuurd]`
  meldt. Op acceptatie onschuldig; op productie denk je dan dat een klant is
  uitgenodigd.
- **#132** — de uitnodigingslink wees naar `localhost:5001`, een adres dat op
  die omgeving niet bestaat. Dezelfde soort omissie als de `OIDC_*`-variabelen.
- **#133** — Entra stuurt `"name": "unknown"` mee, en één persoon kan twee
  gebruikers worden. Geen blokkade voor de straat, wel voor de eerste klant.

**Wat dit bewijst en wat niet.** De keten werkt van commit tot ingelogd scherm.
Wat het níét bewijst: dat dit ook geldt voor een omgeving die je niet met de
hand hebt bijgesteld — drie van de vier fouten hierboven zijn opgelost met een
handmatige ingreep op de server, en pas daarna in code vastgelegd.

### 3.1b Frontend publiceren en meenemen in de uitrol — ✅ GEDAAN op 2026-08-10

Kwam boven bij stap 1 en blokkeerde stap 3: de CI van MCM2-frontend bouwde het
image en controleerde dat het start, maar duwde het niet naar GHCR.
`FRONTEND_IMAGE` verwees dus naar iets dat niet bestond.

**Uitgevoerd.** De frontend publiceert nu naar
`ghcr.io/alingadvies/mcm2-frontend/web`, met dezelfde tagstructuur en dezelfde
`workflow_dispatch`-terugval als de backend. `FRONTEND_MEE` staat op `true`.

**Het besluit dat hier viel: twee versies, samen vastgelegd.**

Backend en frontend zitten in aparte repositories, dus hun commit-SHA's zijn
nooit gelijk. `deploy.js` gebruikte één versietag voor beide — dat zou een
frontend-image zoeken met de SHA van de backend, en dat bestaat niet.

Afgewogen (besluit eigenaar 2026-08-10):

| Optie | Waarom niet |
|---|---|
| Frontend volgt `:latest` | Aan een draaiende omgeving is dan niet te zien welke schermcode erin zit, en terugdraaien werkt alleen voor de backend. In strijd met §6 |
| Frontend onder de backend-SHA publiceren | Kan niet — de frontend-CI kent de backend-commit niet |
| **Twee versies, apart meegegeven** | **Gekozen** |

```powershell
npm run deploy:productie -- --versie sha-abc123def456 --frontend-versie sha-987fed654321
```

**Eén afwijking van wat oorspronkelijk was voorgesteld, en het is een
verbetering.** Het idee was de combinatie weg te schrijven in een bestand op de
server. Dat is niet gebeurd: `deploy.js` leest de draaiende versies terug uit de
containers zelf. Een bestand kan afwijken van de werkelijkheid zodra iemand met
de hand ingrijpt, en wijst dan de verkeerde kant op precies wanneer je het nodig
hebt. Dat is regel 4 van het runbook — teruglezen, niet aannemen.

**Wat er verder bij kwam:**

- **Rollback zet beide onderdelen samen terug.** Alleen de backend terugdraaien
  laat een frontend achter die bij een andere versie hoort; die toestand is
  nergens beproefd.
- **De promotiecontrole vergelijkt beide.** Alleen de backend controleren zou
  een onbeproefde frontend stilzwijgend laten meepromoveren.
- **De rookproef toetst of de frontend de backend bereikt**, niet alleen of hij
  een pagina serveert. Dat is een aparte schakel met een misleidende faalvorm.
  Ook toegevoegd aan `deploy:status`.
- **Een CI-poort die Issue #51 bewaakt.** Herintroductie van
  `NEXT_PUBLIC_API_URL` is stil: het werkt lokaal en gaat pas mis bij de
  promotie. De poort toetst de bron én het gebouwde image — twee containers uit
  hetzelfde image met een verschillend adres moeten beide een 502 geven, en
  zonder adres een 500. Tegenproef gedraaid: de poort wordt aantoonbaar rood.

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

### 3.2 Staging aanmaken — ✅ GEDAAN op 2026-08-10

Uitgevoerd. Project `clm-staging3`, ref `ljdldwfylcbubzglxjoa`, KeesOrg,
regio eu-west-1.

| Stap | Uitkomst |
|---|---|
| Rollen via `db/roles/bootstrap-roles.sql` | 6 rollen; `clm_migrator` en `clm_api_runtime` inlogbaar, geen BYPASSRLS |
| 26 migraties met `migrate:deploy --extern` | Voltooid |
| Markeren als `wegwerp` | `clm.omgeving` = `wegwerp`, productie blijft `beschermd` |

**Verificatie, teruggelezen uit beide databases en naast elkaar gelegd:**

| | Productie | Staging |
|---|---|---|
| Postgres | 17.6 | 17.6 |
| Migraties | 26 | 26 |
| Tabellen | 23 | 23 |
| RLS in `clm` | 17/19 | 17/19 |
| FORCE RLS | 12 | 12 |

Geen tabel die alleen in de één voorkomt.

> **Val die twee uur kostte.** Een wachtwoord *resetten* bij Supabase komt niet
> altijd door bij de connection pooler: drie resets, drie keer
> `password authentication failed`, ook na een projectherstart. Productie bleef
> intussen gewoon bereikbaar via dezelfde pooler-host — dus het lag niet aan het
> netwerk. **Het wachtwoord bij het aanmaken van het project zelf instellen
> werkte meteen.** Houd het alfanumeriek: `@ : / ? # % &` breken de
> connectiestring.

> **Tweede bijna-ongeluk, en het bewijst §6.** `markeer-wegwerp.js` leest
> `MIGRATION_DATABASE_URL`, niet `DATABASE_URL`. Bij het meegeven van de
> verkeerde variabele pakte het script de waarde uit `.env` — **productie**.
> Met `--extern` erbij was productie als `wegwerp` gemarkeerd, en dan mogen de
> e2e-suites hem leegmaken. Wat het tegenhield: de rem die niet-lokale doelwitten
> weigert, én het feit dat de melding de **projectreferentie** toont. Zonder dat
> tweede was de fout onzichtbaar geweest.

### 3.3 De uitrol naar staging automatiseren — ✅ GEDAAN op 2026-08-11

Uitbreiding van `.github/workflows/ci.yml`. Wat er nu draait na elke merge op
`main`:

```
CI: lint, tests, build
  → image naar GHCR (SHA-tag, nooit `latest` — §6)
  → migraties tegen Supabase-staging
  → migratiestand TERUGGELEZEN en vergeleken met het journal
  ────────────────────────────────────────────────────────
  → npm run deploy:staging -- --versie sha-…     met de hand
```

**Het teruglezen is de kern, niet het migreren.** `scripts/migratiestand.js`
leest de stand uit de database — uitsluitend `SELECT` — en vergelijkt met
`drizzle/meta/_journal.json`, het bestand dat `migrate()` zelf leest. Wat daarin
staat is per definitie wat er na een geslaagde uitrol hoort te staan.

Een getal in de workflow zou verouderen bij de volgende migratie: dan faalt de
controle om de verkeerde reden, of blijft hij groen terwijl er iets ontbreekt.

**Beproefd, niet aangenomen:**

| Proef | Uitkomst |
|---|---|
| Tegen het echte stagingproject | `Migraties op deze database: 26 — Gelijk aan het journal (26)`, exitcode 0 |
| Database die 11 migraties achterliep | *"De database staat op 15, het journal telt 26 — er zijn migraties NIET toegepast"*, exitcode 1 |
| Onbereikbare database | exitcode 1 |

Die exitcodes zijn **zonder pipe** gemeten. Met `| tail` gaf de eerste meting 0 —
dezelfde valkuil als bij `migrate.js` op 10-08, waar een crash door de pipe als
succes werd gelezen.

**Twee bewuste afwijkingen**, beide toegelicht in de code:

- Geen `eisToestemmingBuitenLokaal` in het leesscript. Die rem beschermt tegen
  ongewild *schrijven*; aan een vlag wennen voor een leesquery is het echte
  risico dat het runbook beschrijft. Het doelwit wordt wél altijd gemeld.
- `--extern` staat expliciet bij de migratie-aanroep, niet als
  omgevingsvariabele. In de omgeving zetten maakt hem onzichtbaar voor elke
  volgende stap.

### 3.3b De applicatie tegen Supabase — ✅ GEDAAN, en dit was het punt

Er draait nu een applicatie op saxombp die praat met het Supabase-stagingproject.
**Voor het eerst gaat MCM2 over een connection pooler.** Dat is de hele reden dat
staging bij Supabase staat en niet in een container (§1).

Bewezen aan de Supabase-kant:

```
Actieve verbindingen op de Supabase-stagingdatabase:
  clm_api_runtime: 1     ← de applicatie op saxombp
  clm_migrator: 1        ← de leesquery van de meting
```

**Drie dingen moesten instelbaar worden**, en het derde was een verrassing:

1. `DATABASE_URL` stond vast in het compose-bestand, opgebouwd uit
   `DB_WACHTWOORD`. Nu een variabele.
2. De databaseservice staat achter het profiel `lokale-db`. Staging heeft er geen.
3. `depends_on: db` kon **niet** blijven staan. Compose weigert een heel
   compose-bestand zodra een service verwijst naar een dienst achter een inactief
   profiel: *"service api depends on undefined service db: invalid compose
   project"*. Niet alleen de api start dan niet — er start niets.

Dat derde punt is gemeten met een wegwerp-compose vóórdat het werd toegepast, en
de oplossing (`deploy/compose.lokale-db.yml` als overlay) op dezelfde manier.

**Regressietest:** acceptatie opnieuw uitgerold met het gewijzigde
compose-bestand — vier rookproeven groen. Dat was de risicovolle kant.

### 3.3c Waarom het starten van de applicatie handwerk blijft

De uitrol naar saxombp is bewust **niet** geautomatiseerd. Dat is geen
onvermogen maar een besluit (eigenaar, 2026-08-11), en de reden hoort hier
vastgelegd.

CI kan niet bij saxombp: de machine staat thuis achter een router, en buiten
Tailscale bestaat `saxombp.tail4b29b.ts.net` niet eens — een publieke DNS-server
geeft "non-existent domain".

De officiële Tailscale-action lost dat op, en werkte ook: de runner was
aantoonbaar in het netwerk zichtbaar. Maar de SSH-verbinding liep op een harde
regel van Tailscale:

> *"Devices with a tag-based identity can only SSH into other tagged devices;
> they cannot SSH into devices with a user-based identity."*

Een CI-runner krijgt onvermijdelijk een label; saxombp heeft er geen. Er bestáát
dus geen geldige regel die dit toestaat — drie pogingen
(`autogroup:self`, `autogroup:tagged`, een gebruiker als bestemming) waren alle
drie ongeldig, en de laatste werd door het invoerscherm zelf geweigerd.

De enige oplossing zou zijn saxombp óók te labelen. Dat *"removes the user
account"* en raakt daarmee de `tailscale serve`-opzet die het HTTPS-adres van
acceptatie draagt — de enige weg naar de inlog.

**Afgewogen en verworpen.** Het levert één ding op: dat één commando vanzelf
gaat. En juist dat commando verdwijnt bij een verhuizing naar AWS, waar je een
image duwt en de dienst het zelf ophaalt. Een stap die altijd faalt is bovendien
erger dan geen stap: dan wordt elke run rood en leer je rode runs negeren.

De samenvatting van elke CI-run drukt het vervolgcommando af met de juiste SHA
erin, zodat het niet samengesteld hoeft te worden.

### 3.4 De uitrol naar productie automatiseren — ✅ gedaan 2026-08-11

Dezelfde stappen, plus vier remmen:

| Rem | Waarom | Waar hij zit |
|---|---|---|
| **Handmatig akkoord** | GitHub Environments met required reviewer. Niets gaat naar productie zonder dat de eigenaar drukt. | Environment `productie`, teruggelezen: `required_reviewers` → `cmalinghotmail` |
| **Backup vooraf** | Verplicht, niet optioneel. Faalt de backup, dan gaat de uitrol niet door. | `productie-poort.js`, leest `docs/runbooks/backup-bewijs.json` |
| **Migratiestand teruglezen** | Vóór en ná. Wijkt het af van staging, dan stoppen. | `productie-poort.js` + `migratiestand.js --volgens-journal` |
| **Terugdraaien beproefd** | De vorige SHA moet met één commando terug te zetten zijn. | Heen en terug gedraaid op acceptatie, 11-08 |

**De workflow is `.github/workflows/productie.yml`, en hij staat bewust los van
`ci.yml`.** De stagingjob draait bij elke merge op main; voor productie mag dat
niet. Dan wacht er na elke merge een akkoordverzoek, en een akkoord dat je tien
keer per week wegklikt is geen rem meer maar een knop die in de weg zit.
Uitrollen naar productie begint daarom met iemand die dat besluit neemt:
`workflow_dispatch`, met een verplicht veld `reden`.

**De poort draait twee keer: vóór het akkoord en erna.** De eerste keer zodat er
niemand om aandacht wordt gevraagd voor een uitrol die toch geblokkeerd wordt.
De tweede omdat een akkoord een dag kan blijven wachten, en in die tijd kan er
een tweede merge zijn geweest of een backup verlopen.

#### Hoe de backuprem werkt zonder dat CI bij de backup kan

Dit was het lastigste stuk. De backup ligt op de laptop van de eigenaar; een
CI-runner kan daar nooit bij. De runner kan dus niet zelf vaststellen dat er een
bruikbare dump is.

Vandaar de omkering: **niet de runner gaat kijken, maar de backupcontrole laat
een spoor achter.** `backup-controle.js` — die tóch al dagelijks draait —
schrijft `docs/runbooks/backup-bewijs.json`, en dat bestand gaat mee in de
repository. De poort leest het.

Het bewijs komt uit de *controle* en niet uit `backup-dump.js`, en dat verschil
is de hele les van 2026-08-04: alle dumps waren toen keurig vers en misten al
maanden negen van de achttien tabellen. Een dump die bestaat is geen dump die
deugt. Het bestand zegt daarom niet "er is een backup" maar "de controle is
gedraaid en dit vond hij" — inclusief welke lagen er gedraaid hebben, want
zonder `--volledig` is de herstelbaarheid niet getoetst.

Er staat bewust géén pad, mapnaam of hostnaam in: het bestand wordt gecommit en
is dus zo openbaar als de repository, en `BACKUP_DIR` wijst naar een
OneDrive-map met de naam van de eigenaar erin.

#### Beproefd op zeven uitkomsten

Exitcodes zonder pipe gemeten — de fout van 2026-08-10 en 11-08.

| Situatie | Uitkomst |
|---|---|
| geen bewijsbestand | geblokkeerd, exitcode 1 |
| bewijs 50 uur oud | geblokkeerd, 1 |
| bewijs meldt problemen (`goed: false`) | geblokkeerd, 1 |
| alles gelijk | **DOOR**, 0 |
| staging loopt achter op de repository | geblokkeerd, 1 |
| productie loopt vóór op de repository | geblokkeerd, 1 |
| database onbereikbaar | geblokkeerd, 1 |

De vier migratiegevallen zijn gemeten met twee wegwerpcontainers (55480, 55481)
waarvan de migratietabel met de hand uit elkaar is getrokken.

#### Wat de poort níét doet

De applicatie starten. Dat blijft `npm run deploy:productie -- --versie …`, om
dezelfde Tailscale-reden als bij staging (§3.3c). De samenvatting van de
workflow draagt dat commando, en de weg terug.

#### Bijvangst: een rollbackcommando dat niet bestond

`deploy.js` verwees op twee plekken naar `npm run rollback:<omgeving>`. Dat
script staat niet in `package.json` en heeft er nooit in gestaan. Eén ervan was
een docstring — vervelend. De andere stond in de foutmelding die verschijnt
wanneer de containers niet starten, dus precies op het moment dat je hem nodig
hebt en een "Missing script"-melding het laatste is wat je kunt gebruiken.

Terugdraaien is in dit project geen apart script maar dezelfde uitrol met de
vorige tag. Die melding draagt nu die regel, samengesteld uit wat er draaide.

### 3.5 `.env` ontkoppelen van productie

**Dit is de grootste veiligheidswinst van het hele plan, en hij komt gratis mee.**

Nu wijzen `DATABASE_URL`, `MIGRATION_DATABASE_URL` en `BACKUP_DATABASE_URL` alle
drie naar Supabase-productie. Elk databasecommando op de laptop raakt de echte
database. Dat is de gemeenschappelijke oorzaak onder alle drie de incidenten uit
§0.

Zodra de uitrol via GitHub loopt, hoort de laptop dat adres niet meer te kennen.
`.env` gaat naar **staging** wijzen. De productiereferenties leven dan alleen nog
als GitHub secret.

### ✅ Uitgevoerd 2026-08-11

| Variabele | Wijst nu naar | Waarom |
|---|---|---|
| `DATABASE_URL` | **staging** | de oefendatabase is het nieuwe standaarddoelwit |
| `MIGRATION_DATABASE_URL` | **staging** | idem |
| `BACKUP_DATABASE_URL` | productie | **bewust** — een backup van de oefendatabase beschermt niets |
| `NOOD_PRODUCTIE_URL` | productie | nieuw; **geen enkel script leest deze naam** |

**Waarom de noodtoegang in `.env` staat en niet alleen bij GitHub.** De
bescherming zit niet in "onvindbaar" maar in "geen enkel script pakt het
automatisch op". `dotenv` laadt de variabele wel, maar niets vraagt ernaar — je
moet hem bewust doorgeven. Het verschil met een GitHub-secret is alleen hoe snel
je erbij kunt wanneer er iets stuk is, en dat is bij een noodherstel juist het
punt.

`scripts/with-migration-url.js` bleek hiervoor ongeschikt: dat kopieert
`MIGRATION_DATABASE_URL` naar `DATABASE_URL` en maakt het doelwit dus níét
expliciet — het tegenovergestelde van wat §3.5 vroeg.

### De rem moest mee, en dat was het echte werk

`eisToestemmingBuitenLokaal()` kende twee soorten: `localhost` en de rest. Dat
werkte zolang `.env` naar productie wees. Maar **staging staat óók bij Supabase**,
dus die rem zou bij élk stagingcommando afgaan. Dan typ je `--extern` erbij
omdat er anders niets werkt, na twee weken is het een gewoonte, en dan typ je
hem ook op de dag dat je per ongeluk naar productie wijst.

Een waarschuwing die altijd afgaat, is geen waarschuwing meer — dezelfde les als
bij de backupmelding die niemand las (2026-08-04).

`eisOnbeschermdeDatabase()` vraagt daarom de database zélf wat hij is
(`clm.omgeving`, migratie 0019). Die markering zit ín de database, niet in een
hostnaam of poortnummer dat ernaast staat en niet meer klopt zodra iets
verhuist.

**De naam is bewust veranderd.** De nieuwe functie is `async`, de oude
synchroon. Zouden ze hetzelfde heten, dan blijft `if (!eis…(url, …))` draaien —
met een Promise als uitkomst, en die is altijd waarheidsachtig. De rem zou dan
stilzwijgend nooit meer afgaan: een beveiliging die verdwijnt zonder één
foutmelding. Met een nieuwe naam faalt een vergeten aanroeper meteen.

**Twee dingen die het beproeven opleverde** — geen van beide was voorzien:

1. **Een verse container blokkeerde.** `clm.omgeving` ontstaat pas bij migratie
   0019, dus een lege database zou weigeren op precies het commando dat hem moet
   vullen. Opgelost met een uitzondering die alléén lokaal geldt: niet-lokaal
   zonder markering blijft geblokkeerd, want dat kan een kopie van productie zijn
   van vóór 0019.
2. **De doorloopstack op poort 55500 werd nergens gemarkeerd.** De migratie ging
   door (lokaal en leeg), maar `seed-vragenlijsten.js` weigerde een stap later —
   0019 had de database toen op `beschermd` gezet. `verify:volledig` markeert nu
   ook die stack.

### Beproefd

| Doelwit | Zonder vlag | Met `--extern` |
|---|---|---|
| staging (`wegwerp`) | gaat door | n.v.t. |
| verse lokale container (geen tabel) | gaat door | n.v.t. |
| lokaal, gemigreerd, nog `beschermd` | geblokkeerd | gaat door |
| **productie** (`beschermd`) | **geblokkeerd**, exitcode 1 | gaat door, met "LET OP" |

Exitcodes zonder pipe gemeten. `verify:volledig` groen tot en met de 66
browsertests — en voor het eerst zonder handmatig variabelen mee te geven, want
`.env` wijst nu vanzelf naar de goede plek.

---

## 4. Fase 2 — de infrastructuur precies goed inrichten

Pas als fase 1 werkt. Dit gaat over wat er per omgeving moet staan en hoe je
weet dat het klopt.

### 4.1 Wat er per omgeving hoort te zijn

*Bijgewerkt 2026-08-12 naar wat er werkelijk staat; teruggelezen, niet gepland.*

> **Deze tabel beschreef productie al als Supabase — en dat klopte niet.** Tot
> stap 6 draaide de applicatie daar tegen een lege lokale container. Het plan
> beschreef dus de bedoeling terwijl de werkelijkheid afweek, en niemand merkte
> het omdat er niets in stond. Sinds 12-08 kloppen ze weer op elkaar.

| | Acceptatie | Staging | Productie |
|---|---|---|---|
| Applicatie | saxombp `:5011` / `:3010` | saxombp `:5031` / `:3030` | saxombp `:5021` / `:3020` |
| Database | container 55460 | **Supabase `clm-staging3`** | **Supabase `clm-enterprise`** |
| Migraties door | `deploy:acceptatie` | **CI, automatisch** | **workflow, achter vier remmen** |
| `clm.omgeving` | `wegwerp` | `wegwerp` | `beschermd` |
| Rollen | migrator + runtime | migrator + runtime | migrator + runtime |
| RLS | actief | **actief — geverifieerd** | actief |
| Backups | nee | nee | dagelijks, met controle |
| e2e-suites | ja | nee | nooit |
| Data | wegwerp | leeg | echte data |
| Inloggen | ja, via HTTPS | nee — vraagt eigen redirect-URI | nee |

**Dat staging draait, is de applicatie op saxombp; de database staat bij
Supabase.** Die scheiding is opzet en het is de AWS-vorm: compute los van
database, elk apart te verhuizen.

> **RLS op staging is niet aangenomen maar gemeten.** Een poging om een tenant
> in te voegen als `clm_migrator` werd geweigerd met *"new row violates
> row-level security policy for table tenant"*. Dat is precies wat er hoort te
> gebeuren zonder tenantcontext.

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

### Eén ding heet "productie" — ✅ gedaan 2026-08-12

`mcm2-productie` op saxombp wordt opgeheven. Twee dingen die "productie" heten
is precies de verwarring die op 10-08 tot het verkeerde antwoord op de vraag
"wat zijn mijn rollen" leidde — en daarmee tot het dataverlies.

**Wat het bij nader inzien was.** Niet alleen een verwarrende naam: de twee
praatten langs elkaar heen. De workflow uit stap 4 migreerde naar Supabase
`clm-enterprise`, terwijl `npm run deploy:productie` een applicatie startte
tegen een lege container op saxombp. Wie het commando draaide dat de workflow
zélf afdrukt, kreeg een draaiende app op een database waarin niets stond — met
de volle overtuiging dat productie was uitgerold.

Dat maakte stap 6 dringender dan "opruimen": stap 4 was pas werkelijk af nadat
dit recht was gezet.

**Uitgevoerd in deze volgorde**, code vóór server zodat terugdraaien mogelijk
bleef:

1. `deploy.js` — `lokaleDatabase: false` en `migratiesOverslaan: true`, net als
   staging. De migratiestap meldt nu *"overgeslagen — teruglezen gebeurt in CI"*.
2. `deploy-inrichten.js` — `dbPoort: null`, waardoor `productie.env` een leeg
   `DATABASE_URL` krijgt dat met de hand ingevuld moet worden. Zelfde behandeling
   als staging: een connectiestring is een geheim en hoort niet uit een script.
3. `productie.env` op de server naar Supabase.
4. **Acceptatie eerst bijgewerkt** naar `sha-e8e462d6eec8`. Het script waarschuwde
   terecht dat de versie daar niet beproefd was — precies de rem die OTAP
   voorschrijft, en die is gerespecteerd in plaats van weggeklikt.
5. Productie uitgerold op diezelfde versie. Vier rookproeven groen, inclusief het
   doorgeefluik (401) — voor het eerst mét een frontend.
6. Container en volume verwijderd.

**Gemeten vóór het verwijderen:** 26 migraties, 0 tenants, 0 gebruikers,
0 leveranciers, 0 antwoorden, 0 actieve verbindingen. Leeg. Een backup is
daarom bewust overgeslagen (besluit eigenaar 12-08).

**Teruggelezen na afloop:** onder `mcm2-productie` draaien alleen nog `api` en
`frontend`; het volume `mcm2-productie_db-data` bestaat niet meer;
`deploy:status` geeft 200 / 200 / 401 op alle drie de omgevingen.

**Wat hiermee ook opgelost is:** staging en productie zien er nu identiek uit —
api plus frontend, database bij Supabase, migraties uit een workflow. Alleen
acceptatie houdt een eigen container, en dat is opzet: die mag stuk.

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
| 1 | ✅ **Issue #51 — frontend promoveerbaar** — gedaan 10-08 | Nee, ging sowieso door |
| 2 | ✅ **Staging aanmaken bij Supabase** — gedaan 10-08 | Beslist: optie A |
| 2b | ✅ **Frontend-image publiceren, frontend in de uitrol** — gedaan 10-08 | Beslist: twee versies, zie hieronder |
| 3 | ✅ **Uitrol naar staging automatiseren** — gedaan 11-08 | Beslist: applicatie start met de hand, zie §3.3c |
| 4 | ✅ **Uitrol naar productie automatiseren, met akkoordrem** — gedaan 11-08 | Beslist: backup blijft bij de eigenaar, CI controleert; applicatie start met de hand |
| 5 | ✅ **`.env` omleiden naar staging** — gedaan 11-08 | Beslist: rem kijkt naar `clm.omgeving`; noodtoegang als `NOOD_PRODUCTIE_URL` |
| 6 | ✅ **`mcm2-productie` op saxombp opheffen** — gedaan 12-08 | Akkoord gegeven; database was aantoonbaar leeg, backup bewust overgeslagen |
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
