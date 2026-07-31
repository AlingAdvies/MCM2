# MCM2 — de tenantgrens, en hoe elke laag ervan bewezen wordt

**Opgesteld:** 2026-07-31
**Bedoeld voor:** de eigenaar en een externe reviewer
**Leesbare webversie:** https://claude.ai/code/artifact/31d7819a-a7d9-4079-b224-c51d08497450

Dit document beschrijft de architectuur van MCM2 vanuit één vraag: kan een verzoek
ooit bij gegevens van een andere klant komen? Daarna staat per laag welke test dat
uitsluit — en welke garanties nog **niet** bewezen zijn.

Alle aantallen zijn gemeten tegen een database die vanaf niets is opgebouwd, niet
overgenomen uit eerdere verslagen.

| | |
|---|---|
| E2e-tests | 205 in 15 suites |
| Unittests | 161 in 8 suites |
| Migraties | 0000 t/m 0010 |

> **Onderhoud.** Dit document veroudert zodra de code verandert. Bij een wijziging
> aan de tenantgrens, de testopzet of de verificatiepoort hoort een wijziging hier.
> De aantallen zijn te herleiden met `npm run verify`.

---

## 1. Wat dit systeem moet garanderen

MCM2 bewaart compliancegegevens van meerdere klanten in **één database**. Transdev en
een volgende klant delen dezelfde tabellen. Dat is een bewuste keuze — aparte databases
per klant zijn duurder om te onderhouden en lopen bij elke migratie uit de pas — maar
het verplaatst de vraag naar één punt:

> **De garantie waar alles op rust.** Een verzoek krijgt uitsluitend gegevens te zien
> van de klant waartoe de indiener aantoonbaar behoort. Niet omdat de code dat netjes
> doet, maar omdat de database weigert iets anders terug te geven.

Het verschil tussen die twee is de kern van het ontwerp. Een controle in de
applicatiecode werkt zolang niemand een route vergeet. Een controle in de database
werkt óók wanneer iemand een route vergeet. Dat laatste is de enige vorm die op termijn
houdbaar is, en het bepaalt hoe de rest van dit document is opgebouwd.

### Twee soorten gebruikers, twee toegangswegen

| Spoor | Wie | Hoe hij binnenkomt | Waar de klant uit volgt |
|---|---|---|---|
| **1** | Interne beheerder van de klant | Inloggen via Microsoft Entra | Zijn lidmaatschap in de database |
| **2** | Externe leverancier | Een linkje in een e-mail, geen account | De opzoeking van dat token |

In beide gevallen geldt dezelfde regel: **de klant komt nooit uit iets dat de bezoeker
zelf meestuurt.** Geen kopregel, geen queryparameter, geen keuzelijst. De bezoeker bezit
één sleutel; wat die sleutel opent, bepaalt de database.

---

## 2. De keten, in vijf stappen

Zo ziet een verzoek van een ingelogde beheerder eruit, van browser tot gegevens. Elke
pijl is een plek waar het mis kan gaan, en dus een plek die getest wordt.

```
browser        cookie              een betekenisloze sleutel van 43 tekens
                  │                (httpOnly — JavaScript kan er niet bij)
                  ▼
server         SHA-256             de sleutel wordt een afdruk
                  │
                  ▼
database       sessie_oplossen()   afdruk opzoeken, verlopen sessies weigeren
                  │
                  ▼
server         tenantId            komt terug uit de database, niet uit het verzoek
                  │
                  ▼
database       withTenant()        zet de klantcontext, daarna filtert Postgres zelf
```

De vierde stap is waar de garantie zit. De tenantId die in `withTenant()` gaat, is
diezelfde stap ervoor uit de database gekomen. Er bestaat geen veld in het verzoek
waarin een bezoeker een andere klant zou kunnen noemen — niet omdat dat veld genegeerd
wordt, maar omdat het **nergens gelezen wordt**.

**Nagelopen op 2026-07-31.** Elke aanroep van `withTenant()` in de codebase krijgt zijn
tenantId van `TenantContextGuard` (spoor 1), van `SurveyTokenGuard` (spoor 2), of van
het seed-script waar een beheerder de tenant zelf op de opdrachtregel meegeeft. Er is
geen vierde bron.

### De laatste verdedigingslinie: Row Level Security

Stel dat alles hierboven faalt en er staat een verkeerde tenantId in de context. Dan nog
gebeurt er niets, want de filtering zit niet in de code maar in Postgres zelf. Elke tabel
met klantgegevens heeft een policy: een regel die de database dwingt alleen rijen van de
ingestelde klant te tonen.

Dat werkt alleen wanneer de databaserol die regel niet mag negeren. Vandaar dat de
applicatie draait als een rol **zonder** `BYPASSRLS` — en dat de applicatie weigert op te
starten als dat recht er wél blijkt te zijn (`DatabaseService.onModuleInit`).

---

## 3. Twee uitzonderingen, en waarom ze moeten

Op één tabel na heeft elke tabel met klantgegevens RLS. Die uitzondering is geen
vergissing maar een noodzaak, en het loont om te begrijpen waarom — het is precies het
soort keuze dat een reviewer hoort te toetsen.

**Het kip-ei-probleem.** Een RLS-policy filtert op "de klant die nu ingesteld staat".
Maar bij het opzoeken van een sessie *is er nog geen klant ingesteld* — de klant volgt
juist uit die sessie. Een policy zou daar dus altijd nul rijen opleveren en elke
inlogpoging onmogelijk maken. Hetzelfde geldt voor het opzoeken van een
leverancierstoken.

De oplossing is niet "dan maar zonder bescherming", maar een andere vorm ervan.
`clm.sessie` is voor de runtime-rol **volledig afgesloten** (`REVOKE ALL`) — geen lezen,
geen schrijven. Alle toegang loopt via drie `SECURITY DEFINER`-functies die met verhoogde
rechten draaien en nooit meer teruggeven dan strikt nodig.

De uitzondering staat expliciet in `src/db/schema-inventory.ts` (`RLS_UITZONDERINGEN`),
en drie tests bewaken hem:

1. de lijst met uitzonderingen mag niet groeien;
2. elke uitzondering moet volledig afgesloten zijn voor de runtime-rol;
3. een rechtstreekse `SELECT`/`INSERT` moet stuklopen op "permission denied".

---

## 4. Het principe achter de testopzet

Dit is de kern van het document, en de reden dat de testaantallen pas daarna komen. Een
test die groen is, bewijst niets zolang niemand heeft vastgesteld dat hij ook rood *kan*
worden.

> **Regel: elke beveiligingstest krijgt een tegenproef.** Bouw de fout die de test hoort
> te vangen bewust in. Zie de test omvallen. Draai terug. Pas dan telt groen als bewijs.
> Zonder die stap weet je alleen dat de test draait, niet dat hij iets bewaakt.

Dat is geen theorie. In dit project heeft de tegenproef **vier keer** een gat gevonden dat
de groene tests niet lieten zien.

### De guardtest die 18 keer groen was en toch een gat liet

De sessieguard had een test die moest bewijzen dat een meegestuurde tenant in de kopregel
genegeerd wordt. Als tegenproef is een terugval ingebouwd: "geen sessie? neem dan de
kopregel maar" — precies het lek dat afgeschaft moest worden.

**Alle 18 tests bleven groen.** De reden: die ene test stuurde een geldig cookie mee, dus
de terugval kwam nooit aan de beurt. Een verzoek met alléén een kopregel en geen cookie
zou er gewoon doorheen zijn gekomen.

Drie tests toegevoegd voor precies die gevallen — alleen een kopregel, alleen een
queryparameter, en een ongeldig cookie náást een kopregel. Daarna faalde de sabotage wel.
Zonder tegenproef was dit gat pas in productie zichtbaar geworden.

### Een tegenproef die zélf ongeldig bleek

Bij het bouwen van de verificatiepoort was de eerste sabotage een geëxporteerde functie
met een `any`-parameter. De poort bleef groen — terecht, want een functie die niemand
aanroept levert die waarschuwing niet op.

Dat is het vermelden waard omdat het laat zien dat een tegenproef zélf ook fout kan zijn.
Pas met een constructie waar de regel wél op afgaat, werd de poort rood. **Een mislukte
tegenproef is geen bewijs dat de code goed is.**

### Waar de tests hun verwachting vandaan halen

Een tweede principe, minder zichtbaar maar even belangrijk: een test die zijn verwachting
uit een handmatig bijgehouden lijst haalt, veroudert stilletjes. De conformiteitstest
leest daarom de verwachting **uit `src/db/schema.ts` zelf**. Een nieuwe tabel met
`tenant_id` die geen policy krijgt, valt daardoor automatisch op — er hoeft niemand aan te
denken.

Dat is niet vanzelf goed gegaan. De eerste versie las uit `information_schema`, dat alleen
toont waar de huidige rol rechten op heeft. Juist de afgesloten sessietabel viel daardoor
buiten de controle — precies het gat waar de test voor bedoeld was. Overgezet naar
`pg_tables`/`pg_attribute`.

---

## 5. Wat er getest wordt, en waar

De tests zitten in twee lagen met een duidelijke taakverdeling. Unittests toetsen regels
die zonder database te controleren zijn; e2e-tests toetsen alles waar de database de
garantie draagt — en dat is bij een tenantgrens vrijwel alles.

### Unittests — 161, geen database nodig

| Onderwerp | Wat het bewijst | Tests |
|---|---|---:|
| Leveranciersimport (CSV) | Blokkerende fouten versus waarschuwingen; aanhalingstekens, regeleinden, scheidingstekens | 58 |
| ID-tokenverificatie | Verlopen token, verkeerde `aud`, vreemde handtekening, `alg:none` | 46 |
| Sessietoken en cookie | Vorm, hashing, en dat het cookie standaard `Secure` staat | 30 |
| Inlogpoging (PKCE, state) | Bescherming tegen onderschepping en tegen vervalste terugkeer | 23 |
| Testregister | Dat geen twee suites dezelfde UUID's claimen | 3 |
| Bestaand | `app.controller.spec.ts` | 1 |

**Waarom de tokentests tegen een eigen sleutelpaar draaien.** Niet tegen de echte
Entra-tenant, en dat is *strenger* in plaats van losser. Een echte provider geeft nooit een
verlopen token af, of een token met een vervalste handtekening — en juist dat zijn de
aanvallen. Met een lokaal gegenereerd sleutelpaar zijn die wél te maken.

### E2e-tests — 205, tegen een wegwerpdatabase

| Suite | Bewaakt | Tests |
|---|---|---:|
| `antwoord-indienen` | Valideren vóór wegschrijven; tweede poging afgewezen (410) | 25 |
| `survey-token-isolatie` | Een token geeft toegang tot precies één respons | 21 |
| `vragenlijst-import` | Import blijft binnen één tenant | 21 |
| `tenant-context-guard` | **De sessieguard: geen tenantcontext zonder sessie** | 21 |
| `vragenlijst-ophalen` | Alleen eigen vragenlijsten zichtbaar | 20 |
| `bijlage-upload` | Inhoud bepaalt het bestandstype, niet de naam | 18 |
| `vragenlijst-seed` | Inlezen van de acht Transdev-vragen | 15 |
| `sessie` | Aanmaken, verlopen, intrekken; de tabel is afgesloten | 14 |
| `membership-isolatie` | Lidmaatschap bepaalt de tenant, niet de invoer | 13 |
| `schema-conformiteit` | Elke tenanttabel heeft een policy — uit het schema afgeleid | 12 |
| `survey-routes` | De volledige UC1-flow over HTTP | 12 |
| `drizzle-tenant-context` | Isolatie ook via de querylaag, niet alleen ruwe SQL | 6 |
| `tenant-rls-isolation` | Lezen én schrijven over de tenantgrens heen | 5 |
| `app`, `health` | De applicatie start en antwoordt | 2 |

Vier van deze suites bestaan uitsluitend om de tenantgrens te toetsen, en ze doen dat
langs verschillende wegen: ruwe SQL, de Drizzle-querylaag, het tokenpad en het sessiepad.
Dat is bewust — **een garantie die maar op één manier getest is, is getest voor één manier
van gebruiken.**

---

## 6. De verificatiepoort

Tests hebben pas waarde als iedereen ze op dezelfde manier draait. Dat ging op 2026-07-31
mis: CI faalde terwijl lokaal alles groen leek. Geen typefout, maar een naamsverwarring —
er bestaan commando's die op elkaar lijken en verschillende dingen doen.

| Wat je intuïtief draait | Wat CI draait | Verschil |
|---|---|---|
| `npm run lint` | `lint:check` | `--fix` en waarschuwingen toegestaan versus `--max-warnings=0` |
| `npm run format` | `format:check` | Schrijft weg in plaats van te controleren |
| `npm test` | plus de e2e-laag | Unittests raken de tenantgrens niet |

Eén commando lost dat op. `npm run verify` (`scripts/verify.js`) draait dezelfde vijf
stappen in dezelfde volgorde als de workflow, stopt bij de eerste rode stap, en noemt
daarbij de bijbehorende CI-job. Vastgelegd als harde regel in **MCM2-CLAUDE.md §15a**.

> **De veiligheidsklep.** De poort **weigert te draaien** wanneer `DATABASE_URL` niet naar
> een lokale wegwerpdatabase wijst. De e2e-tests maken tenants aan en verwijderen rijen;
> tegen `clm-enterprise` gedraaid is dat onherstelbaar — en die verbinding staat in
> `.env`. Dit is de laatste plek waar die vergissing te vangen is.

De poort meldt ook eerlijk wat hij *niet* gecontroleerd heeft. De `--snel`-variant zei
aanvankelijk "GROEN — alle poorten die CI ook draait" terwijl de e2e-laag was
overgeslagen. Dat is dezelfde valse zekerheid in het gereedschap dat die zekerheid moest
borgen, en het is gecorrigeerd.

---

## 7. Twee gebreken in de testopzet zelf

Bij het opstellen van dit document bleek de e2e-suite **onregelmatig te falen**: één run
21 fouten, dan drie runs groen, dan weer 20. Dat is de vervelendste faalvorm die er is —
hij ondermijnt het vertrouwen in álle tests, ook de tests die wél iets bewijzen. "Even
opnieuw draaien" wordt een gewoonte, en daarmee is elke echte regressie onzichtbaar.

Twee onafhankelijke oorzaken, beide verholpen (PR #63).

### Oorzaak 1 — de verbindingslimiet van de database

Jest draait suites parallel (hier tot elf), elke suite start een eigen Nest-applicatie, en
elke applicatie opende tot tien verbindingen — de standaard van node-postgres. Dat past
niet binnen `max_connections=100`.

**Bewezen, niet vermoed:** met de limiet tijdelijk op 30 faalde de suite reproduceerbaar
met 13 fouten. Met de pool begrensd op vier bleef diezelfde krappe opstelling volledig
groen. Instelbaar via `DATABASE_POOL_MAX` — voor productie is tien eerder te krap dan te
ruim.

### Oorzaak 2 — testsuites die elkaars gegevens opruimden

Elke suite maakt eigen tenants aan met vaste UUID's, en ruimt ze achteraf op. Drie suites
bleken dezelfde UUID's te gebruiken:

```
...e1         membership-isolatie  én  survey-routes
...f1, ...f2  membership-isolatie  én  survey-token-isolatie
```

Draaien ze tegelijk, dan verwijdert de een de tenant van de ander terwijl die er nog mee
bezig is. De foutmeldingen wezen naar `duplicate key on tenant_pkey` en naar een foreign
key op `vendor`: **allebei gevolgen, geen oorzaken**. Dat is waarom dit zo lang onzichtbaar
bleef.

Opgelost met `test/test-ids.ts`: één register dat de reeksen uitdeelt, met per suite een
eigen blok. Plus drie bewakingstests, waarvan de strengste de e2e-bestanden inleest en elk
UUID afwijst dat niet uit het register komt.

Die bewakingstest is het punt. De guard-suite had dit probleem eerder "opgelost" met
alleen een commentaarregel die voor botsingen waarschuwde — **een afspraak die niemand
controleert, is geen afspraak.**

Resultaat: **vijf keer achter elkaar 205 groen**, waar eerder ongeveer één op de vier runs
faalde.

---

## 8. Wat níét bewezen is

Dit hoofdstuk hoort in elk reviewdocument, en het is het eerste dat een reviewer zou
moeten lezen. Alles hierboven is gemeten; alles hieronder is dat niet.

| Onderwerp | Stand | Wat dat betekent |
|---|---|---|
| Claims uit Microsoft Entra | **Aanname** | Alle tests draaien tegen een lokaal sleutelpaar. Welke claims de echte tenant levert (`oid`, `tid`, `email`), is nooit gemeten. Te bevestigen bij de eerste echte login. |
| De sessieguard in gebruik | **Niet aangesloten** | Gebouwd en bewezen, maar er is nog geen beheerroute die hem gebruikt. `@UseGuards(TenantContextGuard)` is de eerste stap van fase 2. |
| Gelijktijdige uploads | **Onbewezen** | De `FOR UPDATE`-vergrendeling is er, maar met die vergrendeling verwijderd bleven alle tests groen. De race was niet uit te lokken zonder kunstgrepen in productiecode. |
| Gezondheid van een uitgerolde omgeving | **Bestaat niet** | De e2e-tests beantwoorden dit nooit — ze zijn destructief van aard. Er is een aparte, alleen-lezende rookproef nodig: **Issue #61**. |
| Virusscan op bijlagen | **Niet gebouwd** | De klant heeft er niets over gezegd (OV-7); het ontwerp benoemt dit expliciet als openstaand risico. |
| Branch protection op `main` | **Technisch geblokkeerd** | Vereist een betaald GitHub-plan. Tot dan is "nooit rechtstreeks op main werken" een werkafspraak, geen afdwinging. |

> **Over de dekking van `verify`.** De poort dekt de Docker-productiebuild *niet* — die
> draait alleen in CI (job `docker-build`). Een geslaagde `nest build` bewijst bovendien
> niet dat het artefact werkt: dat is in dit project al een keer misgegaan met een module
> die wel compileerde maar niet laadde (zie `src/auth/README.md`). Bij wijzigingen aan de
> `Dockerfile` of aan runtime-dependencies hoort een echte `docker build`.

---

## 9. Wat een reviewer zou moeten toetsen

Vijf vragen waarvan het antwoord het meest zegt over de houdbaarheid van dit ontwerp:

1. **Is de uitzondering op RLS verdedigbaar?** Eén tabel heeft geen policy, met een
   kip-ei-argument. Klopt dat argument, en is de gekozen vervanging — `REVOKE ALL` plus
   `SECURITY DEFINER`-functies — sterk genoeg?

2. **Is "geen tweede weg naar de tenantcontext" aantoonbaar, of aangenomen?** Dit is
   nagelopen en met drie tests vastgelegd. Een reviewer zou dat zelf moeten narekenen,
   want het is de garantie die alles draagt.

3. **Bewaakt elke beveiligingstest werkelijk iets?** De tegenproef vond vier keer een gat.
   Is die gewoonte ook toegepast op de oudere tests, of alleen op de recente?

4. **Is vier verbindingen per instantie juist voor productie?** Gekozen om de testsuite te
   stabiliseren, en instelbaar gemaakt. Onder echte belasting is dat niet gemeten.

5. **Wat gebeurt er bij de tweede klant?** Alles hierboven is gebouwd voor meerdere
   klanten, maar er draait er nu één. De eerste echte tweede klant is de werkelijke test
   van dit ontwerp.

---

## Bronnen

- `docs/STATUS.md` — de actuele stand, fases en blockers
- `MCM2-CLAUDE.md` §6 (tenantcontext), §7.4 (RLS), §15a (verificatiepoort)
- ADR-006 (CIAM-laag) t/m ADR-012 (frontend-uitrol)
- `src/auth/README.md` — de identiteitslaag, en waarom `jose` bijzondere aandacht vraagt
- Migraties `drizzle/0009_identiteit_en_membership.sql` en `drizzle/0010_sessie.sql`
