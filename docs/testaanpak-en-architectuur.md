# Zo testen we MCM2 — principes, gereedschap en architectuur

**Datum:** 2026-08-10
**Doel van dit document:** de testaanpak van MCM2 volledig beschrijven, in
samenhang met de architectuur — productiedatabase, backup, backend en frontend.

> **Voor wie hier een infographic van maakt:** §11 bevat een compacte
> datastructuur met alle cijfers, lagen en relaties. De rest van het document is
> de onderbouwing. Voorgestelde visuele opbouw staat in §12.

**Verhouding tot de runbooks.** Dit document beschrijft *waarom* er zo getest
wordt. Het *hoe* staat in `docs/runbooks/`, en dat blijft daar leidend:

| Runbook | Waarvoor |
|---|---|
| `README.md` | de index — welke runbooks er zijn |
| `commandos-en-omgeving.md` | welk commando bestaat, waar praat het naartoe, wat mag nooit |
| `zelf-testen.md` | de demo-omgeving gebruiken |
| `otap-doorloop.md` | de volledige doorloop naar productie-images |
| `uitrol-acceptatie-en-productie.md` | een image promoveren naar acceptatie en productie, en terugdraaien |
| `onderhoudskalender.md` | wat er terugkeert en wanneer |
| `backupcontrole.md` | de dagelijkse dump nalopen |
| `supabase-verificatie-en-restoretest.md` | herstel beproeven |

Bij twijfel over een commando of doelwit: het runbook wint van dit document.

---

## 1. Het uitgangspunt

Dit project heeft één ontwerpprioriteit die boven de andere staat:

> **Security en betrouwbare tenant-isolatie.**
> Daarna: onderhoudbaarheid, functionele aansluiting, reproduceerbare uitrol,
> en pas dan performance.

De testaanpak is daar de directe afgeleide van. Niet "werkt de functie" is de
kernvraag, maar **"kan tenant A ooit iets van tenant B zien"** — en die vraag
laat zich niet met een unittest beantwoorden.

Daaruit volgen vijf principes.

---

## 2. De vijf principes

### P1 — Groen is alleen groen via één commando

`npm run verify:volledig`. Losse commando's bewijzen niets.

**Waarom deze regel bestaat:** op 2026-07-31 was CI rood terwijl lokaal alles
groen leek — er was een stap overgeslagen die niemand miste. Een reeks losse
groene commando's voelt als bewijs en is het niet.

### P2 — Een groene test zonder tegenproef bewijst niets

Bij elke bescherming hoort een test die hem probeert te omzeilen.

**Voorbeeld dat dit rechtvaardigt:** de demo-seed had acht groene tests. Bij de
tegenproef bleek dat de tokenhash vervangen kon worden door een omkeerbare
hex-codering — alle acht bleven groen. De test keek naar de *vorm* van de hash,
niet of het de hash ís. Een databasedump zou daarmee elke openstaande survey
hebben geopend.

### P3 — Lees het resultaat terug uit de database

"Migraties voltooid" is geen bewijs.

**Twee keer misgegaan:** één keer betekende die melding dat er niets was
gebeurd (de migratie stond niet in het journal), één keer dat het op de
verkeerde database was gebeurd.

### P4 — Meet, reconstrueer niet

Namen opzoeken vóór je ze typt. Bestaand gereedschap zoeken vóór je het
naschrijft.

**Op één dag drie keer fout gegaan:** een tabel heette `tenant_membership` en
niet `membership`; er bestond al een `bootstrap-roles.sql`; en een tabeltelling
gaf "tien migraties achter" waar het er vijf waren.

### P5 — Elk recht en elke aanname is expliciet en getest

Niets mag afhangen van een omgevingsinstelling die toevallig ergens greep.

**De aanleiding:** `ALTER DEFAULT PRIVILEGES` gaf lokaal rechten die op
productie ontbraken — en omgekeerd gaf het lokaal méér rechten dan productie
had. Tests draaiden daardoor ruimer dan de werkelijkheid.

---

## 3. De vier testlagen

```
┌─ Laag 4 ── BROWSERTEST ────────────────────────────────────────┐
│  Playwright tegen de productie-images                          │
│  8 specs · bewijst: het scherm roept de juiste route aan       │
├─ Laag 3 ── E2E / INTEGRATIE ───────────────────────────────────┤
│  Jest + echte PostgreSQL 17 in Docker                          │
│  30 suites · 421 tests · bewijst: RLS, guards, tenantgrens     │
├─ Laag 2 ── UNITTESTS ──────────────────────────────────────────┤
│  Jest, geen database                                           │
│  14 bestanden · bewijst: losse logica, tokenvorm, validatie    │
├─ Laag 1 ── STATISCH ───────────────────────────────────────────┤
│  prettier · eslint · tsc --noEmit                              │
│  bewijst: opmaak, stijl, types                                 │
└────────────────────────────────────────────────────────────────┘
```

**Het zwaartepunt ligt bewust op laag 3.** In een systeem waar de tenantgrens in
de *database* zit (row-level security), bewijst een unittest met een mock niets
over de eigenschap die ertoe doet. Vandaar 421 e2e-tests tegen een echte
PostgreSQL, en 14 unittestbestanden.

---

## 4. De architectuur waartegen getest wordt

```
        ┌──────────────────┐         ┌──────────────────┐
        │   FRONTEND       │         │   Entra External │
        │   Next.js 15     │◄───────►│   ID  (OIDC)     │
        │   eigen repo     │  login  │   federatie+MFA  │
        └────────┬─────────┘         └──────────────────┘
                 │ HTTP + sessiecookie
                 ▼
        ┌──────────────────┐
        │   BACKEND        │   NestJS / TypeScript / Node 22
        │   7 controllers  │   guards: TenantContext → Rol → PlatformAdmin
        └────────┬─────────┘
                 │ rol: clm_api_runtime  (géén BYPASSRLS)
                 ▼
        ┌───────────────────────────────────────────────┐
        │   POSTGRESQL 17                               │
        │   ┌─────────────────────────────────────────┐ │
        │   │  ROW-LEVEL SECURITY = de tenantgrens    │ │
        │   │  SET LOCAL app.current_tenant_id        │ │
        │   └─────────────────────────────────────────┘ │
        │   clm 19 · ref 3 · audit 1  = 23 tabellen     │
        │   5 SECURITY DEFINER-functies                 │
        └───────────────────────────────────────────────┘
```

**Twee toegangssporen, allebei getest:**

| | Spoor 1 — interne beheerder | Spoor 2 — externe leverancier |
|---|---|---|
| Identiteit | Entra External ID | **geen account** |
| Toegang | sessiecookie na login | tijdgebonden token in een link |
| Tenant uit | `tenant_membership` | het token zelf |

---

## 5. De zes omgevingen

Dit is de kern van de aanpak: **elke omgeving heeft een eigen rol, en de
database zegt zélf welke.**

| Omgeving | Poort | Markering | Wie gebruikt hem | Mag weg? |
|---|---|---|---|---|
| **Wegwerp** | 55440 e.v. | `wegwerp` | e2e-tests | ja, altijd |
| **Demo (lokaal)** | 55450 | `beschermd` | feature review, demo's geven | nee |
| **CI** | in de runner | `wegwerp` | GitHub Actions | ja, per run |
| **Acceptatie** *(saxombp)* | 55460 | `beschermd` | uitrol beproeven vóór productie | nee |
| **Productie-simulatie** *(saxombp)* | 55470 | `beschermd` | het promotieproces bewijzen | nee |
| **Productie** | Supabase | `beschermd` | de echte applicatie | **nooit** |

> **Twee dingen heten hier "productie", en dat verschil is wezenlijk.**
>
> `saxombp:5021` is een **procesbewijs**: het toont aan dat hetzelfde image dat
> op acceptatie stond ook op een andere machine draait, dat migraties meelopen,
> en dat terugdraaien werkt. Het bevat geen klantdata.
>
> Supabase is de **échte** productiedatabase, met de tenant AlingAdvies erin.
> Daar draait geen uitgerolde applicatie tegen — die wordt lokaal benaderd.
>
> Een echte cloudomgeving die beide samenbrengt is nodig vóór de pilot
> (Issue #12). Zie `docs/runbooks/uitrol-acceptatie-en-productie.md`.

### Hoe de bescherming werkt

Sinds migratie 0019 staat in elke database een tabel `clm.omgeving` met één rij:
`wegwerp` of `beschermd`. **Standaard is alles `beschermd`.** Een wegwerpdatabase
moet zich expliciet aanmelden:

```
node scripts/markeer-wegwerp.js "waarvoor"
```

De e2e-suites weigeren te draaien tegen alles wat niet `wegwerp` is — voor
**beide** databaseverbindingen (`DATABASE_URL` én `MIGRATION_DATABASE_URL`).

**Waarom dit bestaat:** op 2026-08-07 wisten de e2e-tests de demo-database.
`DATABASE_URL` wees naar poort 55450 in plaats van 55440. De demo-tenant
verdween, 400 testleveranciers bleven achter, en er sloeg niets aan — de enige
bescherming die er was kende één criterium: is de host lokaal? Binnen
`localhost` was de demo niet van een wegwerpcontainer te onderscheiden.

**Waarom beide verbindingen:** op 2026-08-08 praatte een e2e-suite via
`MIGRATION_DATABASE_URL` tegen productie. Die variabele staat in `.env` en wijst
naar Supabase; wordt hij niet meegegeven, dan vult dotenv hem aan. De eerste
query faalde toevallig — anders had die test rijen in productie aangemaakt.

---

## 6. Het gereedschap

### Verificatie

| Commando | Wat het doet | Duur |
|---|---|---|
| `npm run verify:volledig` | **de norm** — zes stappen, code tot browser | ~3 min |
| `npm run verify` | code, unittests, e2e | ~1 min |
| `npm run verify:snel` | zonder e2e | ~30 s |
| `npm run verify:schema` | schema, RLS en policies vs. de code | ~20 s |

### De zeven stappen van `verify:volledig`

```
1  Onderhoud van de documentatie      runbooks geïndexeerd, niet verouderd
2  Code, unittests en backend-e2e     format → lint → typecheck → unit → e2e
3  Stack bouwen en starten            beide PRODUCTIE-images via docker compose
4  Migraties, tenant en sessie        een échte sessie klaarzetten
5  Browsertest                        Playwright tegen de draaiende stack
6  Draaien de echte omgevingen mee?   read-only controle op productie
7  Opruimen                           altijd, ook na een fout
```

**Stap 1 staat vooraan omdat hij een seconde kost en geen database nodig heeft.**
Zelfde gedachte als de poortcontrole: de goedkoopste controle eerst, zodat je
niet vier minuten aan Docker besteedt voordat je hoort dat er iets veroudert.

Hij vangt vier dingen: een runbook dat niet in de index staat, een ontbrekende
kop, een document dat langer dan zes maanden stilstaat, en — de belangrijkste —
een `backup-verwachting.json` die achterloopt op de migratiestand. Die laatste
kwam er na 2026-08-10, toen die lijst twaalf migraties achterliep en de
dagelijkse backupcontrole daardoor "compleet: 18 tabellen" meldde over een dump
die er 23 hoorde te hebben.

**Stap 3 draait tegen productie-images, niet tegen een ontwikkelserver.** Dat
verschil is de reden dat deze doorloop bestaat: een `next dev`-server had een
EACCES-uploadfout in het productie-image nooit gevonden.

**Stap 6 is read-only** en meldt wanneer productie achterloopt op het schema —
zonder de doorloop rood te maken. De keten kloppen en een omgeving die
achterloopt zijn twee verschillende dingen.

### Specifiek gereedschap

| Bestand | Rol |
|---|---|
| `test/jest-e2e.guard.ts` | **de poort** — weigert niet-wegwerpdatabases, beide verbindingen |
| `test/opruimen.ts` | één gedeelde opruimhelper, alle tabellen in FK-volgorde |
| `test/test-ids.ts` | UUID-register per suite — voorkomt botsingen |
| `src/db/schema-inventory.ts` | leidt uit het Drizzle-schema af wat er hoort te bestaan |
| `src/db/rechten-contract.ts` | legt vast wat de applicatierol mág |
| `scripts/db-doelwit.js` | hostcontrole + `--extern`-bevestiging voor scripts |
| `scripts/markeer-wegwerp.js` | de enige manier om een database als wegwerp te markeren |

### Poorten — wie claimt wat

| Poort | Wie | Wanneer |
|---|---|---|
| 55440 | handmatige wegwerpdatabase | als je hem zelf opzet |
| 55441 | `verify:volledig` | tijdens stap 1 |
| 55450 | `mcm2demo` | zolang de demo staat |
| 5001 | API in de doorloopstack | `verify:volledig` en `npm run demo` |
| 3000 | frontend | idem |

`verify:volledig` faalt op een bezette 55441 met "geen testdatabase kunnen
starten" — een melding die naar de verkeerde oorzaak wijst. Het script sluit
bewust niets zelf af: een server op 3000 of 5001 kan van een ander project zijn.

### De valkuil van gedeelde suites

Alle e2e-suites delen één database. Een suite die los groen draait kan de
volledige run alsnog rood maken, en welke suite dan omvalt hangt af van de
volgorde — de vervelendste faalvorm die er is, want hij ziet eruit als toeval.

**Vier unieke sleutels hebben géén `tenant_id` erin.** Je eigen tenant beschermt
je dus niet:

| Sleutel | Op | Oplossing |
|---|---|---|
| `survey_response_token_hash_key` | `survey_response.token_hash` | eigen herhaald teken per suite |
| `tenant_name_key` | `tenant.name` | suitenaam in de tenantnaam |
| `user_external_subject_key` | `user.external_subject` | suiteprefix **plus** `Date.now()` |
| `survey_attachment_storage_key_key` | `survey_attachment.storage_key` | eigen prefix per suite |

Daarom bestaat `test-ids.ts` als centraal register, met een bewakingstest die
een botsing vangt en beide suites bij naam noemt. Die kost een seconde en heeft
geen database nodig — draai hem vóór een volledige run.

**De aanleiding:** op 2026-07-31 viel de suite onregelmatig om — één run 21
falende tests, dan drie runs groen, dan weer 20. De foutmeldingen wezen naar
`duplicate key` en een foreign key: allebei gevolgen, geen oorzaken. Drie suites
deelden dezelfde UUID's.

### Twee registers, één principe

```
   schema-inventory.ts          rechten-contract.ts
   ────────────────────         ───────────────────
   Wat hoort te BESTAAN?        Wat is TOEGESTAAN?
   afgeleid uit de code         een expliciet besluit
   tabellen, kolommen, RLS      GRANT, search_path, EXECUTE
                    │                    │
                    └────────┬───────────┘
                             ▼
              een test leest de database terug
              en vergelijkt met het register
```

Een nieuwe tabel of functie zonder regel in het register maakt de test rood.
Dat dwingt een besluit af op het moment dat het object ontstaat — niet bij de
eerste route die erover struikelt.

---

## 7. Wat de e2e-tests werkelijk bewijzen

Niet "de functie werkt", maar dat de beschermingen niet te omzeilen zijn. De
grootste suites, naar aantal tests:

| Suite | Wat het bewaakt |
|---|---|
| `bijlage-upload` (18) | inhoud bepaalt het bestandstype, niet de naam |
| `schema-conformiteit` (17) | policies, FORCE RLS, tabeleigenaarschap, `search_path` |
| `vragenlijst-seed` (15) | inlezen van de vragenlijst |
| `sessie` (14) | aanmaken, verlopen, intrekken; de tabel is afgesloten |
| `membership-isolatie` (13) | lidmaatschap bepaalt de tenant, niet de invoer |
| `rechten-contract` (8) | tabelrechten, `search_path`, `EXECUTE` |
| `tenant-rls-isolation` (5) | lezen én schrijven over de tenantgrens heen |
| `actor-context` (5) | **de actorgrens: medewerker, leverancier, onbekend** |

### Drie tegenproeven die er echt toe doen

1. **Een tenant uit de invoer wordt genegeerd.** Drie tests sturen een tenant
   mee via een header, een query-parameter, en een ongeldig cookie náást een
   header. Alle drie horen 401 te geven. Geschreven ná een tegenproef waarin de
   guard wél op de header terugviel.
2. **De sessietabel is dicht.** Een directe `SELECT` en `INSERT` als
   applicatierol geven beide "permission denied".
3. **De applicatie kan de audit trail niet wijzigen.** Append-only, afgedwongen
   in de rechten en getest.

---

## 8. Data en herstel

```
  PRODUCTIE (Supabase Free)          geen providerbackup — Issue #30
        │
        │  npm run backup:dump   ─── dagelijks 07:00, automatisch
        ▼
  LOKALE DUMP  ──►  OneDrive        het enige vangnet (ADR-011)
        │
        │  npm run backup:controle
        ▼
  CONTROLE op de laatste dump       meldt stilstand
```

**De backup is niet "extra zekerheid" maar het enige vangnet.** Supabase Free
levert geen providerbackups. De dagelijkse dump houdt bovendien het project
actief, wat pauzeren na ~7 dagen inactiviteit voorkomt.

**Waarom dit bij de testaanpak hoort:** stap 5 van `verify:volledig` meldt
wanneer productie achterloopt op het schema — en dus ook dat de backup mist wat
er niet in staat. Een backup van een verouderd schema herstelt een verouderde
werkelijkheid.

---

## 9. CI: wat er bij elke push draait

| Job | Wat | Wanneer |
|---|---|---|
| **Format, lint en typecheck** | prettier `--check`, eslint `--max-warnings=0`, `tsc --noEmit`, unittests | elke PR en push |
| **Docker productiebuild** | image bouwt, start, draait als non-root, serveert een pagina | elke PR en push |
| **RLS tenant-isolatietest** | de tenantgrens tegen een echte PostgreSQL | elke PR en push |
| **Image publiceren naar GHCR** | het uitrolbare artefact, met een onveranderlijke `sha-`tag | **alleen op main** |

CI draait `lint:check` en `format:check` — de **controlerende** varianten.
`npm run lint` en `npm run format` wijzigen bestanden en horen daarom niet in CI.

**De publiceer-job hangt aan alle drie de andere.** Faalt er één, dan komt er
geen image, en dan kan er niets uitgerold worden. Dat is de koppeling tussen
"getest" en "uitrolbaar": ze zijn niet los verkrijgbaar.

**Twee tags per image**, en dat onderscheid doet ertoe:

| Tag | Waarvoor |
|---|---|
| `:sha-<commit>` | onveranderlijk — hier draait een rollback naar terug |
| `:latest` | wat de uitrol standaard ophaalt |

Zonder de eerste is terugdraaien niet uitvoerbaar: `:latest` van gisteren
bestaat morgen niet meer.

**Publiceren kan ook handmatig afgedwongen worden** (`gh workflow run ci.yml
--ref main`). Dat is geen luxe: op 2026-08-10 pikte GitHub na een storing de
push-triggers niet meer op, en zonder die uitweg was er geen enkele manier om
een image te publiceren terwijl alle poorten groen waren.

---

## 10. De incidenten die deze aanpak vormden

Elke regel hierboven is er omdat er iets misging. Dat is geen zwakte van het
document maar de reden dat het te vertrouwen is.

| Datum | Wat er gebeurde | Wat eruit volgde |
|---|---|---|
| 2026-07-31 | CI rood, lokaal groen — een stap overgeslagen | P1: één commando |
| 2026-07-31 | Drie suites deelden UUID's; onregelmatig falen | `test-ids.ts` |
| 2026-08-06 | `migrate:deploy` draaide tegen productie (Issue #86) | doelwitmelding vóór verbinden |
| 2026-08-07 | E2e-tests wisten de demo-database | migratie 0019: `clm.omgeving` |
| 2026-08-07 | "Migraties voltooid" terwijl er niets gebeurde | P3: teruglezen |
| 2026-08-08 | Suite praatte via de migratie-URL tegen productie | poort over **beide** verbindingen |
| 2026-08-08 | Rechten lokaal ruimer dan productie | `rechten-contract.ts` |
| 2026-08-10 | Backupcontrole meldde "compleet: 18 tabellen" — de verwachtingslijst liep twaalf migraties achter | `verify:onderhoud` als stap 1 |
| 2026-08-10 | Uitrol meldde "UITGEROLD" over een **lege** database; de rookproef werd groen | uitrol leest `__drizzle_migrations` terug |
| 2026-08-10 | `migrate.js` crashte op een ontbrekende module, maar de pipe naar `tail` gaf exitcode 0 | exitcode is geen bewijs |
| 2026-08-10 | `pg_isready` meldde "klaar" tijdens de interne herstart van een verse Postgres | twee opeenvolgende **queries**, geen socketcontrole |
| 2026-08-10 | Frontend met een verkeerd backend-adres gaf **200** op de startpagina | rookproef vraagt óók een beheerroute op via de frontend-poort |
| 2026-08-10 | `deploy.js` draaide op een compose-bestand dat op de server anders was dan in de repo | sha256-vergelijking als eerste stap van de uitrol |
| 2026-08-10 | `mailVerstuurd: true` terwijl het logkanaal `[niet echt verstuurd]` meldde | nog open — **Issue #131** |
| 2026-08-11 | Een migratiescript dat faalt gaf **exitcode 0** door de pipe naar `tail` | exitcodes zonder pipe meten; `scripts/migratiestand.js` faalt aantoonbaar |
| 2026-08-11 | Compose weigert een héél bestand bij `depends_on` naar een inactief profiel — niet alleen die dienst | overlay `compose.lokale-db.yml`; gemeten met een wegwerp-compose vóór toepassing |

**De regels van 10 augustus zijn varianten van P3**, en dat is geen toeval. Elk
ervan zag eruit als succes: een groene controle, een geslaagde uitrol, een
exitcode 0, een pagina die netjes antwoordt. Wat ze gemeen hebben is dat de
melding klopte over iets anders dan waar hij over leek te gaan.

**De laatste drie kwamen alleen boven doordat de keten één keer echt gedraaid
is.** Geen enkele test ving ze: de eerste omdat een startpagina serveren iets
anders is dan de backend bereiken, de tweede omdat de afstand tussen repository
en server nergens gemeten werd, de derde omdat het antwoord van de route nooit
naast het log is gelegd.

Dat is een grens van deze testaanpak die het benoemen waard is: **alles hierboven
toetst code tegen een database. Niets toetst de omgeving waarin die code
terechtkomt.** De eerste twee zijn inmiddels een poort geworden; de derde staat
nog open.

De vierde is een variant van P2: `pg_isready` gaf een antwoord dat waar was op
het moment van vragen, en onwaar een seconde later. Een controle die maar één
keer kijkt, meet een momentopname en geen toestand.

### Teruglezen als testvorm — nieuw sinds 2026-08-11

De poorten hierboven draaien vóór een uitrol. Sinds stap 3 van het OTAP-plan is
er een controle die erná draait, in de pipeline, waar niemand meekijkt:
`scripts/migratiestand.js`.

Hij leest de migratiestand uit de database — uitsluitend `SELECT` — en
vergelijkt met `drizzle/meta/_journal.json`. Dat is bewust **niet** een getal in
de workflow: zo'n getal veroudert bij de volgende migratie, en dan faalt de
controle om de verkeerde reden of blijft hij groen terwijl er iets ontbreekt.
Het journal is het bestand dat `migrate()` zelf leest, dus wat daarin staat is
per definitie wat er hoort te staan.

**Waarom dit een testvorm is en geen logregel.** De drie eerdere gevallen —
2026-08-07 ("Migraties voltooid" over niets), Issue #86 (de verkeerde database),
2026-08-10 (exitcode 0 na een crash) — hadden allemaal een geruststellende
melding. Geen ervan had een meting die daarnaast lag.

**Beproefd op alle drie de uitkomsten**, met exitcodes zonder pipe gemeten:

| Toestand | Antwoord |
|---|---|
| gelijk aan het journal | `Gelijk aan het journal (26)` — exitcode 0 |
| 11 migraties achter | *"De database staat op 15, het journal telt 26"* — exitcode 1 |
| onbereikbaar | exitcode 1 met de verbindingsfout |

Die tweede is gemaakt door een database op te bouwen met een tijdelijk ingekort
journal — de aanpak uit `docs/runbooks/commandos-en-omgeving.md`, met de `trap`
die het journal altijd terugzet.

**De grens die dit níét dekt:** het toetst dat migraties gelánd zijn, niet dat ze
het júíste doen. Een migratie die een verkeerde kolom toevoegt telt gewoon mee.
Daarvoor is `verify:schema` er, en die draait niet tegen staging.

---

## 11. Datastructuur voor de infographic

```yaml
titel: "Zo testen we MCM2"
ondertitel: "Security-first testaanpak voor een multi-tenant SaaS-platform"

kernboodschap: >
  De tenantgrens zit in de database, niet in de code.
  Daarom testen we tegen een echte database, en bewijst
  elke bescherming zichzelf met een tegenproef.

kerncijfers:
  - waarde: "421"
    label: "e2e-tests"
  - waarde: "30"
    label: "testsuites"
  - waarde: "8"
    label: "browsertests"
  - waarde: "1"
    label: "commando voor 'groen'"
  - waarde: "6"
    label: "stappen van code tot browser"

testlagen:                      # piramide, breedste onderaan
  - laag: 4
    naam: "Browsertest"
    gereedschap: "Playwright tegen productie-images"
    omvang: "8 specs"
    bewijst: "het scherm roept de juiste route aan"
  - laag: 3
    naam: "E2E / integratie"
    gereedschap: "Jest + echte PostgreSQL 17"
    omvang: "30 suites, 421 tests"
    bewijst: "RLS, guards, tenantgrens"
    accent: true                # zwaartepunt
  - laag: 2
    naam: "Unittests"
    gereedschap: "Jest, geen database"
    omvang: "14 bestanden"
    bewijst: "losse logica"
  - laag: 1
    naam: "Statisch"
    gereedschap: "prettier, eslint, tsc"
    bewijst: "opmaak, stijl, types"

principes:
  - code: "P1"
    naam: "Eén commando"
    kort: "verify:volledig of niets"
  - code: "P2"
    naam: "Tegenproef verplicht"
    kort: "groen zonder tegenproef bewijst niets"
  - code: "P3"
    naam: "Teruglezen"
    kort: "een melding is geen bewijs"
  - code: "P4"
    naam: "Meten, niet reconstrueren"
    kort: "opzoeken vóór je typt"
  - code: "P5"
    naam: "Expliciet en getest"
    kort: "geen impliciete aannames"

architectuur:
  lagen:
    - naam: "Frontend"
      tech: "Next.js 15, eigen repo"
    - naam: "Identity"
      tech: "Entra External ID, OIDC + MFA"
    - naam: "Backend"
      tech: "NestJS, Node 22 — 7 controllers"
      detail: "3 guards: TenantContext → Rol → PlatformAdmin"
    - naam: "Database"
      tech: "PostgreSQL 17 (Supabase)"
      detail: "RLS = de tenantgrens · 23 tabellen · 5 definer-functies"
      accent: true
  verbinding_backend_db: "rol clm_api_runtime, géén BYPASSRLS"

omgevingen:                     # vier kolommen, kleur op 'markering'
  - naam: "Wegwerp"
    poort: "55440+"
    markering: "wegwerp"
    kleur: "groen"
    mag_weg: true
    gebruik: "e2e-tests"
  - naam: "Demo lokaal"
    poort: "55450"
    markering: "beschermd"
    kleur: "oranje"
    mag_weg: false
    gebruik: "feature review, demo's"
  - naam: "CI"
    poort: "in de runner"
    markering: "wegwerp"
    kleur: "groen"
    mag_weg: true
    gebruik: "GitHub Actions"
  - naam: "Productie"
    poort: "Supabase"
    markering: "beschermd"
    kleur: "rood"
    mag_weg: false
    gebruik: "de echte applicatie"

de_poort:                       # centraal visueel element
  naam: "De wegwerppoort"
  regel: "elke database is 'beschermd' tot hij zich als wegwerp meldt"
  bewaakt:
    - "DATABASE_URL"
    - "MIGRATION_DATABASE_URL"
  gevolg: "e2e-tests kunnen productie en demo per constructie niet raken"

twee_registers:
  - naam: "schema-inventory.ts"
    vraag: "Wat hoort te bestaan?"
    bron: "afgeleid uit de code"
  - naam: "rechten-contract.ts"
    vraag: "Wat is toegestaan?"
    bron: "een expliciet besluit"
  samen: "een test leest de database terug en vergelijkt"

gedeelde_database:              # waarom suites elkaar kunnen slopen
  probleem: "alle e2e-suites delen één database"
  kern: "vier unieke sleutels hebben géén tenant_id — je eigen tenant beschermt je niet"
  sleutels:
    - "survey_response.token_hash"
    - "tenant.name"
    - "user.external_subject"
    - "survey_attachment.storage_key"
  oplossing: "test-ids.ts — centraal register met bewakingstest"

poorten:                        # eventueel als klein schema
  - poort: 55440
    wie: "handmatige wegwerpdatabase"
  - poort: 55441
    wie: "verify:volledig"
  - poort: 55450
    wie: "demo (beschermd)"
  - poort: 5001
    wie: "API"
  - poort: 3000
    wie: "frontend"

backup:
  bron: "Supabase Free — geen providerbackup"
  stroom: ["productie", "dagelijkse dump 07:00", "OneDrive", "controle"]
  status: "het enige vangnet"

tijdlijn_incidenten:            # elk incident → een maatregel
  - datum: "2026-07-31"
    incident: "CI rood, lokaal groen"
    maatregel: "één commando"
  - datum: "2026-08-06"
    incident: "migratie tegen productie"
    maatregel: "doelwit melden vóór verbinden"
  - datum: "2026-08-07"
    incident: "tests wisten de demo-database"
    maatregel: "clm.omgeving: wegwerp of beschermd"
  - datum: "2026-08-08"
    incident: "suite praatte tegen productie"
    maatregel: "poort over beide verbindingen"
  - datum: "2026-08-08"
    incident: "rechten lokaal ruimer dan productie"
    maatregel: "rechtencontract met terugleestest"
```

---

## 12. Aanwijzingen voor de infographic

**Voorgestelde opbouw, van boven naar beneden:**

1. **Kop** — titel, ondertitel, de vijf kerncijfers als tegels
2. **De kernboodschap** in één kader: *de tenantgrens zit in de database*
3. **De testpiramide** (§11 `testlagen`) — laag 3 visueel het zwaarst, want
   daar ligt het zwaartepunt. Dat is het tegenovergestelde van de klassieke
   piramide, en dat is opzet.
4. **De architectuurkolom** ernaast, met de pijl backend → database gelabeld
   *"géén BYPASSRLS"*
5. **De vier omgevingen** als kaarten, kleur op markering (groen = wegwerp,
   oranje = demo, rood = productie)
6. **De poort** als centraal element tussen de tests en de omgevingen — een
   slot met twee sleutelgaten (`DATABASE_URL` en `MIGRATION_DATABASE_URL`)
7. **De twee registers** als tweeluik dat samenkomt in één test
8. **De backupstroom** als horizontale pijlketen
9. **De tijdlijn** onderaan: incident → maatregel, als bewijs dat de aanpak
   uit ervaring komt en niet uit een boek

**Toon:** feitelijk en rustig. Dit is een compliance-product; de infographic
mag technisch zijn.

**Wat je vooral moet overbrengen:** dat elke regel uit een incident komt. De
tijdlijn is daarom geen bijzaak maar de onderbouwing van het geheel.

**Wat je niet moet doen:** de klassieke testpiramide tekenen met unittests als
brede basis. Hier is dat feitelijk onjuist — het zwaartepunt ligt op laag 3, en
dat is een bewuste keuze die volgt uit waar de tenantgrens zit.
