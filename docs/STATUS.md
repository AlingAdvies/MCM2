# MCM2 — actuele status

## Laatst bijgewerkt

**2026-08-12.** **Stappen 3, 4, 5, 6 en 7 van het OTAP-plan zijn af**, plus de
issues #131, #132 en #133. De keten loopt nu van een merge tot aan productie,
met vier remmen ervoor — de laptop wijst niet meer standaard naar de
klantendatabase, en **nog maar één ding heet "productie"**.

### Stap 7: de omgevingen zijn naast elkaar te leggen

`npm run verify:omgevingen` leest acceptatie, staging en productie en meldt
waar ze uiteenlopen: migratiestand, tabellen, tenantgrens, rollen en de
markering in `clm.omgeving`. Vandaag staan alle drie op 26 migraties, 19
tabellen en 6 rollen.

Dit is de controle die op 04-08 gemeld zou hebben dat productie 9 van de 18
tabellen miste. Elk van de vijf controles is apart rood gemaakt op een
wegwerpcontainer voordat hij groen werd verklaard.

Twee dingen kwamen bij de eerste run boven water, en die staan in §4.3 van het
plan: de RLS-controle moest anders geformuleerd (`clm.sessie` heeft bewust geen
RLS en is op een andere manier dicht), en acceptatie blijkt `beschermd` in
plaats van het `wegwerp` dat §4.1 voorschreef — daar is het plan aangepast, niet
de database.

**Let op:** deze controle draait niet in CI en moet dus gedraaid wórden. De
acceptatiedatabase is alleen via saxombp bereikbaar.

### Stap 6: de dubbele betekenis van "productie" is weg

Er waren er twee. De workflow migreerde naar Supabase `clm-enterprise` — de
echte klantgegevens — terwijl `npm run deploy:productie` een applicatie startte
tegen een **lege Postgres-container** op saxombp. Wie het commando draaide dat
de workflow zelf afdrukt, kreeg een draaiende app op een database waarin niets
stond, met de volle overtuiging dat productie was uitgerold.

Dat is precies de verwarring die op 2026-08-10 tot het verkeerde antwoord op
"wat zijn mijn rollen" leidde, en daarmee tot het dataverlies.

**Wat er is gebeurd**, in deze volgorde:

1. `deploy.js` en `deploy-inrichten.js`: productie heeft geen lokale database
   meer (`lokaleDatabase: false`, `dbPoort: null`) — net als staging
2. `productie.env` op de server wijst naar Supabase
3. acceptatie bijgewerkt naar `sha-e8e462d6eec8`, zodat de OTAP-volgorde klopte
4. productie uitgerold op diezelfde versie — vier rookproeven groen
5. de container en zijn volume verwijderd

**Vóór het verwijderen gemeten:** 26 migraties, 0 tenants, 0 gebruikers,
0 leveranciers, 0 antwoorden, 0 actieve verbindingen. Er is niets verloren
gegaan. Een backup is daarom bewust overgeslagen (besluit eigenaar).

> **Begin je hier na een `/clear`?** Lees dan eerst
> [`runbooks/devops-handleiding.md`](runbooks/devops-handleiding.md) als je wilt
> weten wat de eigenaar doet, en
> [`runbooks/commandos-en-omgeving.md`](runbooks/commandos-en-omgeving.md) als je
> zelf een commando gaat draaien. **Let op: `.env` wijst sinds vandaag naar
> staging, niet meer naar productie.**

```
merge op main
  → CI: lint, tests, build
  → image naar GHCR (SHA-tag)
  → migraties naar Supabase-staging
  → migratiestand teruggelezen, vergeleken met het journal   ← automatisch
  ──────────────────────────────────────────────────────────
  → npm run deploy:staging -- --versie sha-…                 ← één commando

Actions → "Uitrol naar productie" (handmatig, met reden)
  → poort: backup vers? staging op stand? productie niet vóór?
  → JOUW AKKOORD                                             ← de run staat stil
  → poort opnieuw (er kan tijd overheen zijn gegaan)
  → migraties naar Supabase-productie
  → teruggelezen + rechtencontrole                           ← automatisch
  ──────────────────────────────────────────────────────────
  → npm run deploy:productie -- --versie sha-…               ← één commando
```

**De vier remmen** — drie in `productie-poort.js`, één op GitHub:

| Rem | Houdt tegen |
|---|---|
| Backup vooraf | geen bewijs, ouder dan 36 uur, of de controle meldde problemen |
| Staging beproefd | staging staat niet op de stand van de repository |
| Productie niet vóór | productie telt méér migraties dan het journal |
| Handmatig akkoord | Environment `productie`, required reviewer |

Beproefd op zeven uitkomsten, exitcodes zonder pipe gemeten. Terugdraaien is
heen-en-terug gedraaid op acceptatie.

**De backuprem was het lastigste stuk**, want CI kan nooit bij de backup op de
laptop. Opgelost door de omkering: `backup-controle.js` schrijft een bewijs in
de repository, en de poort leest dat. Bewust uit de *controle* en niet uit
`backup-dump.js` — op 2026-08-04 waren alle dumps vers en misten er negen van de
achttien tabellen.

Vandaag gemerged: **#135** (uitnodigingslink wees naar `localhost`), **#136**
(migraties naar staging), **#137** (applicatie tegen Supabase), **#139/#140**
(time-outs, en de Tailscale-stappen er weer uit), **#141** (documentatie na stap
3), **#142** (issues #131 en #133), **#143** (stap 4), **#144** (stap 5 en de
DevOps-handleiding).

**De productieworkflow is één keer echt gedraaid** — 11-08, met akkoord van de
eigenaar. De poort meldde `DOOR`, productie stond al op 26 migraties, en het
teruglezen bevestigde dat. Bewijs dat de weg werkt, zonder dat er iets op het
spel stond.

### Stap 5 is ook af: de laptop wijst niet meer naar productie

**Dit is de grootste veiligheidswinst van het hele plan.** Tot vanmiddag wezen
`DATABASE_URL` en `MIGRATION_DATABASE_URL` naar de echte klantendatabase. Elk
databasecommando raakte die — niet omdat iemand dat koos, maar omdat het de
standaard was. Dat is de gemeenschappelijke oorzaak onder 04-08, 07-08 en 10-08.

| Variabele | Wijst nu naar |
|---|---|
| `DATABASE_URL` | **staging** |
| `MIGRATION_DATABASE_URL` | **staging** |
| `BACKUP_DATABASE_URL` | productie — bewust, een backup van de oefendatabase beschermt niets |
| `NOOD_PRODUCTIE_URL` | productie — **geen enkel script leest deze naam** |

**De rem moest mee, en dat was het echte werk.** Hij kende `localhost` en "de
rest". Maar staging staat óók bij Supabase, dus hij zou bij élk stagingcommando
afgaan — en dan went `--extern`. Een waarschuwing die altijd afgaat is geen
waarschuwing meer.

De rem vraagt nu de database zélf wat hij is (`clm.omgeving`, migratie 0019):
`wegwerp` mag door, `beschermd` eist de vlag. Beproefd op vier doelwitten,
exitcodes zonder pipe gemeten.

Twee dingen kwamen alleen boven door het te draaien: een verse container
blokkeerde op het commando dat hem moet vullen, en de doorloopstack op poort
55500 werd nergens gemarkeerd. Beide opgelost.

**Van de negen stappen zijn 1, 2, 2b, 3, 4 en 5 af.** Volgende is stap 6:
`mcm2-productie` op saxombp opheffen, zodat er nog maar één ding "productie"
heet. Dat is de eerste onomkeerbare stap van het plan.

Nieuw: **[`docs/runbooks/devops-handleiding.md`](runbooks/devops-handleiding.md)**
— uitrollen, terugdraaien, status opvragen en wat er misgaat, geschreven vanuit
de handeling in plaats van vanuit de techniek.

### Waarom het starten van de applicatie handwerk blijft

Bewust, niet uit onvermogen. CI kan niet bij saxombp — de machine staat thuis
achter een router, en buiten Tailscale bestaat het adres niet eens. De officiële
Tailscale-action loste dat op en de runner kwám in het netwerk, maar de
SSH-verbinding liep op een harde regel:

> *"Devices with a tag-based identity can only SSH into other tagged devices."*

Een CI-runner krijgt onvermijdelijk een label, saxombp heeft er geen. De enige
oplossing zou zijn saxombp óók te labelen, en dat verwijdert de gebruiker als
eigenaar — met gevolgen voor de HTTPS-opzet die de inlog draagt.

Afgewogen en verworpen (eigenaar, 11-08): het levert één ding op, en juist dat
verdwijnt bij een verhuizing naar AWS. Details in §3.3c van het plan.

<details>
<summary><strong>Wat er op 2026-08-10 gebeurde</strong> — de dag ervoor</summary>

De dag begon met een leeggemaakte productiedatabase en eindigde met een
**volledig werkende acceptatieomgeving waar je met je Microsoft-account op
inlogt** — frontend, backend en database, uitgerold vanaf een image dat door de
kwaliteitspoorten kwam.

| | Wat |
|---|---|
| frontend #12, backend #127 | **Issue #51** — het backend-adres wordt bij het starten gelezen, niet ingebakken. Eén image, elke omgeving |
| frontend #13, backend #128 | Frontend-image naar GHCR, en de frontend draait mee in de uitrol |
| backend #129 | `deploy.js` stopt als het compose-bestand op de server afwijkt |
| backend #130 | Inloggen werkt op een uitgerolde omgeving |

Plus, niet in een PR maar op de server: **HTTPS op acceptatie** via
`tailscale serve`, waardoor de cookie-verzwakking eruit kon.

De opbrengst zat niet in de PR's maar in wat de eerste echte uitrol blootlegde.
Die faalde, en drie van de vier oorzaken waren stille fouten die geen enkele
test ving. Zie "Wat de uitrol leerde" hieronder.

</details>

---

## ⚠️ EERST LEZEN: wat er op 10-08 is misgegaan

**De productiedatabase is leeggemaakt op basis van een meetfout.**

Wat er gebeurde: een query op `clm.tenant` zonder tenantcontext gaf nul rijen.
Dat werd gelezen als "de database is kapot", terwijl RLS gewoon zijn werk deed —
de tenant AlingAdvies bestond gewoon, hij was alleen niet zichtbaar zonder de
juiste context. Op die verkeerde meting is een diagnose gebouwd, en op die
diagnose is toestemming gevraagd om op te ruimen.

**Weg:** tenant AlingAdvies (`c9f2a68a…`), 21 leveranciers, 2 vragenlijsten,
7 responses, 34 antwoorden, 4 oordelen, 3 notities, 5 gebruikers, 1 bijlage.
Een gedeeltelijke backup staat in de scratchpad (alleen gebruikers, memberships
en sessies — niet de leveranciers en antwoorden).

**Wat dit betekent, en waarom het het plan draagt:** de fout was menselijk, maar
de *gevolgen* waren onmiddellijk omdat er niets tussen zat. Geen goedkeuring,
geen afgedwongen backup, geen omgeving waar het eerst had moeten gebeuren.
Zolang de enige weg naar productie een mens met een laptop is, is elke verkeerde
inschatting direct dataverlies.

Twee lessen die in de code horen:

1. **In een database met RLS betekent nul rijen niet dat er niets staat.** Het
   betekent dat je niets mag zien. Zet altijd `app.current_tenant_id` voordat je
   een conclusie trekt over vulling.
2. **Toon het doelwit, niet alleen de handeling.** Later die avond gaf ik
   `DATABASE_URL` mee aan `markeer-wegwerp.js`, dat `MIGRATION_DATABASE_URL`
   leest — het pakte productie uit `.env`. De rem hield het tegen, en de
   projectreferentie in de melding maakte zichtbaar wat er werkelijk gebeurde.

---

## 🔵 MORGEN BEGINNEN

**Lees eerst:** [`docs/architectuur/plan-otap-straat-met-staging.md`](architectuur/plan-otap-straat-met-staging.md).
Van de negen stappen zijn **1, 2, 2b en 3 gedaan**. Volgende is **stap 4**: de
uitrol naar productie, met vier remmen erin.

| Rem | Waarom |
|---|---|
| Handmatig akkoord | Niets naar productie zonder dat de eigenaar drukt |
| Backup vooraf | Verplicht. Faalt de backup, dan gaat de uitrol niet door |
| Migratiestand vergelijken met staging | Wijkt het af, dan stoppen |
| Terugdraaien beproefd | Op deze weg, niet alleen op saxombp |

De derde is nu goedkoop geworden: `scripts/migratiestand.js` bestaat en is
beproefd op alle drie de uitkomsten.

**Let op bij stap 4.** Productie draait nu nog op `latest` zonder frontend en
zonder `OIDC_*` — inloggen kan daar niet. Het compose-bestand raakt beide
omgevingen, dus een uitrol daarheen is een aparte, bewuste handeling.

### Waar je meteen naar kunt kijken

```
https://saxombp.tail4b29b.ts.net
```

Acceptatie draait, met een geldig certificaat, alleen binnen Tailscale. Inloggen
met je Microsoft-account werkt — kies de knop van je eigen organisatie, niet het
wachtwoordveld (anders `AADSTS50056`).

Er staan twee tenants in: `Platformbeheer` (`…f1a7`, de administratieve
thuisbasis) en `AlingAdvies (acceptatie)`, aangemaakt via de échte route
`POST /platform/tenants` — met een spoor in `audit.audit_event`. Dat is precies
wat bij de vorige AlingAdvies-tenant op productie ontbrak.

### Twee dingen die nog aandacht vroegen — beide opgelost op 11-08

~~**#131**~~ — `mailVerstuurd: true` terwijl het logkanaal `[niet echt
verstuurd]` meldde. De oorzaak zat op de grens: `LogMailKanaal` gaf een
resultaat terug dat er precies zo uitzag als dat van een echte verzending, dus
kon geen enkele aanroeper het verschil zien. `VerzendResultaat` heeft nu een
verplicht veld `echtVerstuurd`; een implementatie die het vergeet, compileert
niet. Beide routes — tenantaanmaak én leveranciersuitnodigingen — lezen dat veld
in plaats van "er ging niets mis".

Bijvangst tijdens het bouwen: mijn eerste versie leidde "geen mailkanaal" af uit
*nul echte verzendingen*. Dat is óók waar als de provider álles weigert, en dan
wijst de melding naar de verkeerde oorzaak — dezelfde soort misleiding als de
fout die hij moest repareren. De toets is nu *geslaagd maar niet echt
verstuurd*, met een test die dat onderscheid vastlegt.

~~**#133**~~ — de naam `unknown` uit Entra, en één persoon met twee
gebruikersrijen.

De naam kwam er doorheen omdat de claimlezer alleen *lege* waarden weerde en
`"unknown"` niet leeg is. Er is nu een korte lijst plaatsvervangers
(`unknown`, `n/a`, `null`, `-`, …), hoofdletterongevoelig, met een tegenproef
die bewijst dat een echte naam als `Robert Unknown` ongemoeid blijft. De
terugval is het e-mailadres — dat zegt wie iemand is, waar
"Platformbeheerder" alleen zegt wat hij doet.

De dubbele rij is **gemeten** op een wegwerpdatabase, niet beredeneerd:
`clm.koppel_eerste_login()` geeft **0 rijen** terug wanneer de oid al bestaat,
en beide rijen blijven staan met de uitnodiging op `open`. Er ontstaat dus geen
tweede gebruiker en er wordt niets samengevoegd — de uitnodiging doet
stilzwijgend niets. Die weigering is terecht (koppelen zou accountovername
zijn); wat ontbrak was zichtbaarheid. `SessieService` waarschuwt nu in beide
gevallen: bij een mislukte koppeling én wanneer iemand die al binnen is een
uitnodiging aanbiedt.

**Samenvoegen doen we bewust niet automatisch.** Dat raakt beoordelingen,
notities en de audit trail, en hoort een beheerhandeling te zijn — geen
bijverschijnsel van een klik op een link.

~~**#132**~~ — de uitnodigingslink wees naar `localhost:5001` — **opgelost op
11-08** (PR #135). De link wordt nu gebouwd op `UITNODIGING_BASIS_URL` en wijst
naar de frontend, want sinds Issue #51 loopt de inlog via het doorgeefluik. Een
link naar de backend-poort zou het pogingcookie op de verkeerde herkomst zetten.

`PORTAAL_BASIS_URL` ontbrak net zo goed en is meegenomen; die was nooit
opgevallen omdat er nog geen leverancier is uitgenodigd.

### De omgevingen op saxombp

Teruggelezen op 2026-08-11, eind van de dag:

| | Backend | Frontend | Database | Antwoordt |
|---|---|---|---|---|
| acceptatie | `sha-e8e462d6eec8` | `sha-635ff21150bd` | container 55460 | ✅ 200 / 200 / 401 |
| **staging** | `sha-ffd27dc9472f` | `sha-635ff21150bd` | **Supabase `clm-staging3`** | ✅ 200 / 200 / 401 |
| **productie** | `sha-e8e462d6eec8` | `sha-635ff21150bd` | **Supabase `clm-enterprise`** | ✅ 200 / 200 / 401 |

**Staging én productie hebben geen `db`-container meer** — beide praten met
Supabase. Alleen acceptatie heeft er nog een, en dat is opzet: die mag stuk.

Productie draait sinds stap 6 (11-08) voor het eerst **op dezelfde versie als
acceptatie**, mét een frontend. Inloggen kan daar nog steeds niet — geen
`OIDC_*`, geen HTTPS — maar dat is nu het enige verschil.

> **`deploy:status` toonde staging eerst niet** (PR #145). Het commando liet
> alleen acceptatie en productie zien terwijl `mcm2-staging-api-1` gewoon
> draaide: een controlecommando met een blinde vlek stelt gerust over iets dat
> het niet gemeten heeft — dezelfde klasse als #131. Gevonden door `docker ps`
> te vergelijken met wat het script afdrukte.

### Wat er gisteravond is neergezet: staging

| | Productie | Staging |
|---|---|---|
| Project | `clm-enterprise` | `clm-staging3` |
| Ref | `agojesdovwsupidwlevh` | `ljdldwfylcbubzglxjoa` |
| Postgres | 17.6 | 17.6 |
| Regio | eu-west-1 | eu-west-1 |
| Migraties | 26 | 26 |
| Tabellen | 23 | 23 |
| RLS in `clm` | 17/19 | 17/19 |
| FORCE RLS | 12 | 12 |
| `clm.omgeving` | `beschermd` | `wegwerp` |

Alles teruggelezen uit beide databases en naast elkaar gelegd — niet aangenomen
uit een melding die "voltooid" zei.

**Rollen aangemaakt** via `db/roles/bootstrap-roles.sql`: zes stuks, `clm_migrator`
en `clm_api_runtime` inlogbaar, geen enkele met BYPASSRLS.

**Verbindingsgegevens** staan in de scratchpad van de sessie van 10-08:
`staging.txt` (postgres), `staging-migrator.txt`, `staging-runtime.txt`. Die
verdwijnen bij het opruimen van de sessie — ze horen als GitHub secret te
worden vastgelegd zodra de straat gebouwd wordt. **Is dat nog niet gebeurd en
zijn ze weg, dan is een wachtwoordreset nodig** (zie waarschuwing hieronder).

> **Val bij Supabase, kost twee uur op 10-08:** een wachtwoord *resetten* komt
> niet altijd door bij de connection pooler — drie resets, drie keer
> "password authentication failed", ook na een projectherstart. Het wachtwoord
> **bij het aanmaken van het project zelf instellen** werkte meteen. Loop je hier
> weer tegenaan: nieuw project, wachtwoord zelf intypen, niet genereren.
> Alfanumeriek houden, want `@ : / ? # % &` breken de connectiestring.

### Dan: de frontend promoveerbaar maken (Issue #51)

Dit is de enige plek waar de keten van vandaag nog niet dekt.

`NEXT_PUBLIC_API_URL` wordt in de frontend tijdens de **build** in de bundel
gebakken (`Dockerfile` regel 28–29). Eén image weet daardoor al met welke backend
het praat, en dan is promoveren van acceptatie naar productie onmogelijk: het
image dat je op acceptatie beproeft zou op productie de verkeerde backend
aanroepen.

Twee images bouwen — één per omgeving — lost dat niet op maar breekt juist het
uitgangspunt: dan is wat je test niet wat je uitrolt.

**De oplossing:** de frontend leest de API-URL bij het starten in plaats van bij
het bouwen. Server-side meegeven bij het renderen, geen losse `/config`-fetch —
anders is er een venster waarin de eerste aanroep nog niet weet waarheen.

**Waarom dit meer is dan een uitrolprobleem.** Elke cloudleverancier configureert
containers met omgevingsvariabelen. Zolang de URL ingebakken zit, kun je die knop
niet gebruiken — bij AWS App Runner net zo min als bij Azure of Kubernetes. Dit
is dus geen tussenstap naar de cloud, het is de eis zelf.

**Risico's** (besproken 2026-08-10): het raakt `client.ts`, de laag waar élk
scherm doorheen praat. Twee dingen vangen dat af — de 55 browsertests draaien
tegen de echte backend en worden massaal rood bij een breuk, en elke test
controleert al expliciet dat `mock-melding` afwezig is. Die tweede is de
belangrijkste: als de mock-schakelaar sneuvelt, draaien schermen stil op
voorbeelddata terwijl je denkt dat ze live zijn.

Werkwijze: eerst de basislijn meten (welke tests falen nu al — dat zijn er vijf),
dan bouwen, dan opnieuw meten. Het verschil is de regressie.

Daarna kan `FRONTEND_MEE` in `scripts/deploy.js` op `true` en de regel
`profiles:` uit `deploy/docker-compose.omgeving.yml`. Verder verandert er niets.

---

## Wat er op 2026-08-11 is gebouwd

### Stap 3 — migraties automatisch naar staging (#136)

`scripts/migratiestand.js` leest de stand terug uit de database en vergelijkt
met `drizzle/meta/_journal.json`. Beproefd op alle drie de uitkomsten, met
**exitcodes zonder pipe gemeten**:

| Toestand | Antwoord |
|---|---|
| gelijk | `Gelijk aan het journal (26)` — exitcode 0 |
| 11 achter | *"De database staat op 15, het journal telt 26"* — exitcode 1 |
| onbereikbaar | exitcode 1 |

Met `| tail` gaf de eerste meting exitcode 0 — dezelfde valkuil als bij
`migrate.js` op 10-08.

### Stap 3b — de applicatie tegen Supabase (#137)

Voor het eerst praat MCM2 over een **connection pooler**. Bewezen aan de
Supabase-kant: `clm_api_runtime: 1` actieve verbinding, terwijl de applicatie op
saxombp draaide.

Drie dingen moesten instelbaar worden, en het derde was een verrassing: Compose
weigert een **héél** compose-bestand zodra een service `depends_on` een dienst
achter een inactief profiel — *"invalid compose project"*, en dan start er
niets. Gemeten met een wegwerp-compose vóór toepassing, net als de oplossing
(`compose.lokale-db.yml` als overlay).

Regressietest: acceptatie opnieuw uitgerold met het gewijzigde compose-bestand,
vier rookproeven groen.

### #132 — de uitnodigingslink (#135)

De link werd gebouwd op `API_BASIS_URL`, een variabele die in geen enkel
voorbeeldbestand stond en dus nooit gezet werd. Elke uitgerolde omgeving gaf een
link naar `localhost:5001`.

Hij wijst nu naar de frontend, want sinds Issue #51 loopt de inlog via het
doorgeefluik. **De aanname eerst gemeten** voordat ik bouwde: een uitnodiging via
`/api/backend/auth/login` geeft 302 naar Microsoft en zet het token in het
pogingcookie — 44 tekens langer dan zonder token.

> Die meting ging bijna fout. Mijn eerste poging gebruikte een token van 12
> tekens en gaf geen verschil, waaruit ik bijna concludeerde dat het token niet
> meereist. `heeftGeldigeVorm()` eist er 43, dus het werd terecht genegeerd.

### Wat er níét gebouwd is, en waarom

De uitrol naar saxombp automatiseren (#138, teruggedraaid in #140). Zie
"Waarom het starten van de applicatie handwerk blijft" bovenaan.

---

## ⚡ Wat de eerste echte uitrol leerde

De keten is 's nachts één keer helemaal doorlopen naar acceptatie. **De eerste
poging faalde**, en dat was de opbrengst — vier bevindingen die geen enkele test
ving.

| Wat je zag | Wat het was | Wat eruit volgde |
|---|---|---|
| Rookproef: `kreeg 000` | Het compose-bestand op de server stond nog met `profiles: ["frontend"]`. Compose slaat die dienst dan over: geen fout, geen container, niets | `deploy.js` vergelijkt de sha256 vóór elke uitrol (#129) |
| `{"statusCode":500}` bij Inloggen | `OIDC_*` ontbrak volledig — inloggen is nooit onderdeel van de inrichting geweest. De backend zei precies wat er miste, maar in het serverlog | Variabelen toegevoegd, callback via de frontend (#130) |
| Entra weigerde het adres | Microsoft accepteert geen `http`-redirect behalve op localhost | `tailscale serve` levert een geldig certificaat; `SESSIE_COOKIE_INSECURE` kon eruit |
| Frontend serveert netjes een pagina | …terwijl `API_BASE_URL` naar niets wees. De oude rookproef had dit **groen** gemeld | Nieuwe controle "frontend bereikt de backend" — bewezen door hem te saboteren: **200** op de startpagina, **502** op het doorgeefluik |

**De rode draad, en die is bekend:** drie van de vier zagen eruit als succes.
Dat is §15b, tegenproef 6 — dezelfde klasse als de vier fouten van overdag en
als Issue #86.

**Wat nieuw is aan deze vier:** ze zitten niet in de code maar in de *afstand
tussen de code en de omgeving waarin hij terechtkomt*. De testaanpak toetst code
tegen een database; niets toetste wat er op de server stond. Twee van de vier
zijn nu een poort; de derde staat als #131 open.

**En één les over de callback die bijna verkeerd ging.** De backend zet bij
`/auth/login` een pogingcookie en leest dat bij `/auth/callback` terug. Lopen die
over verschillende herkomsten — de een via poort 3010, de ander via 5011 — dan
stuurt de browser het cookie niet mee en mislukt élke login op een ontbrekende
state. Sinds #51 klikt de gebruiker op de frontend, dus moet de callback daar
terugkomen. Dat is niet af te leiden uit het verzoek: de backend gebruikt
`OIDC_REDIRECT_URI` letterlijk.

---

## Wat er op 2026-08-10 is gebouwd

### De OTAP-keten (PR #120 t/m #123)

```
merge naar main → CI (3 poorten) → image naar GHCR
                                    :sha-<commit>  onveranderlijk
                                    :latest
  → npm run deploy:acceptatie   ophalen, migreren, starten, rookproef
  → npm run deploy:productie    HETZELFDE image, vraagt bevestiging
```

| Omgeving | Waar | Backend | Database |
|---|---|---|---|
| Acceptatie | `saxombp` | `:5011` | 55460 (127.0.0.1) |
| Productie | `saxombp` | `:5021` | 55470 (127.0.0.1) |

> **Achterhaald sinds stap 6 (2026-08-11):** de databasecontainer op 55470 is
> opgeheven. Productie praat nu met Supabase `clm-enterprise`, net als staging
> met `clm-staging3`. Zie de omgevingstabel bovenaan dit document.

Bereikbaar via Tailscale, niet vanaf internet. Docker is op die server
geïnstalleerd; de Saxo-app op 8080/8081 is aantoonbaar ongemoeid gebleven —
zelfde PID's voor en na.

**Wat is beproefd, niet aangenomen:**

- uitrol naar acceptatie: 26 migraties, teruggelezen uit `drizzle.__drizzle_migrations`
- promotie naar productie met hetzelfde image
- rollback naar `sha-25ffdf847ce0` en weer terug, beide keren groen
- datascheiding: tenant aangemaakt op acceptatie → productie zag `(leeg)`

> **"Productie" betekent nu twee dingen, en dat verschil is wezenlijk.**
> `saxombp:5021` is een **procesbewijs** zonder klantdata. De échte
> productiedatabase is Supabase, met de tenant AlingAdvies erin; daar draait geen
> uitgerolde applicatie tegen. Een cloudomgeving die beide samenbrengt is nodig
> vóór de pilot (Issue #12).
>
> Wat dit **niet** bewijst: beschikbaarheid. Eén machine, thuisinternet, geen
> reservestroom.

### Onderhoud (PR #119)

`docs/runbooks/README.md` als index, `onderhoudskalender.md` met alle
terugkerende taken, en `npm run verify:onderhoud` als stap 1 van
`verify:volledig`. Die poort is bewezen rood én groen: drie tegenproeven gedraaid.

§5 van de kalender is de eerlijkste sectie — zeven ontbrekende onderdelen, vier
met urgentie hoog.

### Frontend (frontend PR #11)

Startscherm op `/beheer` met vier tegels die de **hele organisatie** tellen, plus
urgentiesortering in het statusoverzicht. Aanleiding: op 09-08 stonden er twee
uitvragen bij Siemens terwijl het statusoverzicht niets meldde — dat scherm staat
standaard op "van mij".

Bewust **niet** overgenomen uit MVM_V2: de KPI's "compliance %" en "gemiddelde
risicoscore". Die staan daar op handmatig ingetypte getallen in `vendors.mock.ts`.

### Documentatie (PR #124)

Vier documenten bijgewerkt die tot twee weken achterliepen. `otap-en-security-
voor-eigenaar.md` stond nog op *"Acceptatie en Productie bestaan nog niet"*.

---

## ⚠ Vier fouten van 2026-08-10, en wat eruit volgde

Alle vier gevonden door terug te lezen in plaats van een melding te geloven.

| Wat er leek te gebeuren | Wat er werkelijk was | Wat eruit volgde |
|---|---|---|
| Backupcontrole: "Compleet: 18 tabellen" | `backup-verwachting.json` liep **twaalf migraties** achter; vijf tabellen ontbraken | `verify:onderhoud` als stap 1 |
| Uitrol: "UITGEROLD", rookproef groen | De database was **leeg** | uitrol leest `__drizzle_migrations` terug |
| `migrate.js`: exitcode 0 | Het script crashte op `MODULE_NOT_FOUND`; de pipe naar `tail` slaagde | exitcode is geen bewijs |
| `pg_isready`: "klaar" | Een verse Postgres start intern twee keer; hij zei ja in het venster ertussen | twee opeenvolgende **queries** |

**Drie van de vier zijn varianten van hetzelfde**: elk zag eruit als succes. Dat
is §15b, tegenproef 6 — de afwezigheid van een fout is niet de aanwezigheid van
een grens.

---

## ⚠ De repository is een uur kwijt geweest

Bij het verwijderen van een GHCR-pakket is `AlingAdvies/MCM2` zelf verwijderd —
de knop *"Delete this repository"* staat in dezelfde Danger Zone als *"Delete this
package"*, op een pagina waar je makkelijk terechtkomt vanaf de pakketpagina.

**Hersteld via** `https://github.com/organizations/AlingAdvies/settings/deleted_repositories`,
met alles erin: branches, issues, 124 PR's. GitHub bewaart 90 dagen.

Twee dingen om te onthouden:

1. **De herstelpagina toont niets in het eerste uur.** "No recoverable
   repositories" betekende daar: nog niet verwerkt, niet: weg.
2. **Er staat nu een geverifieerde git-bundel in OneDrive**
   (`mcm2-git-noodkopie-20260810-1423.bundle`, *"records a complete history"*).
   Die blijft staan.

Na het herstel stond de repository op **public** in plaats van private, en pikte
GitHub de push-triggers niet meer op — vandaar dat de publiceer-job nu ook
handmatig te starten is (PR #122).

---

## Openstaand, in volgorde van urgentie

| # | Wat | Waarom nu |
|---|---|---|
| — | ~~**Geen geautomatiseerde uitrol naar productie**~~ | ✅ **Gedaan 11-08** (stap 4). Migraties gaan achter vier remmen langs; de applicatie starten blijft één commando. De remmen zijn op zeven uitkomsten beproefd |
| — | ~~**`.env` wijst nog naar productie**~~ | ✅ **Gedaan 11-08** (stap 5). Wijst nu naar staging; de rem kijkt naar `clm.omgeving` in plaats van naar de hostnaam |
| — | ~~**Twee dingen heten "productie"**~~ | ✅ **Gedaan 12-08** (stap 6). De lege databasecontainer op saxombp is opgeheven; productie praat nu met Supabase. Gemeten vóór het verwijderen: 0 tenants, 0 gebruikers, 0 antwoorden |
| — | ~~**`deploy:status` toont staging niet**~~ | ✅ **Gedaan 11-08** (PR #145). Toont nu drie omgevingen; beproefd op saxombp, alle rookproeven groen |
| ~~#51~~ | ~~Frontend promoveerbaar maken~~ | ✅ **Gedaan 10-08.** Bewezen: hetzelfde image tegen twee backends, verschillende antwoorden, geen herbouw |
| ~~#132~~ | ~~Uitnodigingslink wijst naar `localhost`~~ | ✅ **Gedaan 11-08** (PR #135). Twee tests, tegenproef gedraaid |
| ~~#131~~ | ~~`mailVerstuurd: true` terwijl er niets verstuurd is~~ | ✅ **Gedaan 11-08.** `echtVerstuurd` op de mailgrens; verplicht veld, dus niet te vergeten |
| ~~#133~~ | ~~Naam `unknown` uit Entra; dubbele gebruiker mogelijk~~ | ✅ **Gedaan 11-08.** Plaatsvervangers gefilterd; dubbele rij gemeten — geen tweede gebruiker, wél een stille uitnodiging, nu zichtbaar |
| **#46** | Uploads op een containerschijf: weg bij image-vervanging | **Harde datum**: pilot ~1 september. Dit zijn compliance-bewijsstukken |
| — | Geen bewaking die waarschuwt als een omgeving omvalt | Je zou het merken doordat iemand belt |
| — | Geen incidentplan | NIS2 kent een meldplicht binnen 24 uur; die klok loopt of je een plan hebt of niet |
| — | Geen sleutelrotatie | Het GHCR-token op saxombp **verloopt rond 08-11-2026**; dan stopt elke uitrol |
| **#58** | Backup hangt aan deze laptop | Er leeft een echte tenant |
| **#12** | Echte cloudomgeving | Nodig vóór de pilot |

De drie regels zonder nummer staan in `docs/runbooks/onderhoudskalender.md` §5.
Die lijst hoort korter te worden; groeit hij, dan loopt het onderhoud achter op
wat er gebouwd wordt.

---

## Vijf falende browsertests (bestaand, niet nieuw)

In `instellingen` (3), `uitnodigen` (1) en `vragenlijsten` (1). Gemeten op schone
`main` vóór het startschermwerk — ze faalden daar ook.

Drie ervan gaan over het antwoordadres dat op 09-08 is gemerged: het veld staat
op `disabled` terwijl de ingelogde gebruiker admin is. Verdient aparte aandacht.
---

## De PR-stapel van 06-08 is weg (afgehandeld 2026-08-07)

Alle vijf zijn gemerged, elk met een groene CI-run — de Actions-storing was voorbij.

| PR | Wat | Migratie |
|---|---|---|
| #92 | `workflow_dispatch` + bijgewerkte documenten | — |
| #93 | Issue #86 — scripts noemen hun doelwit | — |
| #94 | Fase C1 — antwoorden lezen | — |
| **#99** | Fase C2 — beoordelen | 0015 |
| #97 | Fase C3 — beoordelaar koppelen | 0016 |

> **Waarom C2 nummer #99 heeft en niet #95.** #95 was gericht op de branch van #94. Bij het
> mergen van #94 werd die branch verwijderd, en GitHub sluit een PR automatisch als zijn
> basisbranch verdwijnt. Heropenen kan dan niet meer, en de basis van een gesloten PR is niet
> te wijzigen — dus is de inhoud onder een nieuw nummer opnieuw ingediend. Er is niets
> gemerged geweest en niets kwijtgeraakt; dezelfde commit `9f691eb` zit in #99.
>
> **De les voor een volgende keten:** richt de bovenliggende PR op `main` vóórdat je de
> onderliggende mergt, niet erna. Bij #97 is dat wel zo gedaan en die bleef gewoon open.

---

**De frontend van fase C.** Twee van de drie schermen uit het plan (§Fase C, "Frontend")
staan er; beide zitten in **MCM2-frontend PR #8**.

1. ~~**Voortgang per ronde**~~ → **statusoverzicht per vendor** (`/beheer/status`).
   De vijf statussen uit `docs/superpowers/plans/2026-08-07-statuswaarheid-per-vendor.md`,
   een samenvatting bovenaan, en de tijdlijn *uitgestuurd → terug ontvangen → sluit op*.
   Met de schakelaar "van mij" / "hele organisatie", standaard de eigen stapel.
2. **De inzending zelf** (`/beheer/status/[responseId]`). **Opent op de afwijkingen**, niet
   op alle antwoorden — acht keer "Bevestigd" lezen is verspilde aandacht (besluit eigenaar
   2026-08-07). De bevestigde vragen zitten achter een schakelaar. Notities staan boven de
   eerdere oordelen: ze gaan meestal over de afwijking. Goedkeuren staat apart van de drie
   oordelen.
3. **Werkvoorraad van de beoordelaar** — **ontbreekt nog.** De contractmanagerkant zit in
   het statusoverzicht; `GET /admin/survey/mijn-beoordelingen` bestaat maar heeft geen eigen
   scherm. Dat is een aparte lijst en geen filter (ADR-013).

**Wat een "afwijking" is, is geen nieuwe definitie.** De database eist al een toelichting van
minstens tien tekens bij alles behalve `confirmed`
(`survey_answer_comment_required_check`, migratie 0005). Die regel bestond; hij was alleen
nergens zichtbaar. Een onbeantwoorde verplichte vraag telt óók mee.

Twee dingen die daarbij geen detail waren, en die nu gebouwd zijn:
- ✅ **Het huidige oordeel staat in de lijst**, met "(van 2)" wanneer er meer oordelen zijn —
  anders verdwijnt een meningsverschil uit beeld.
- ✅ **`nadere_vragen` leest als een openstaande actie.** Onder de knoppen staat expliciet dat
  de leverancier hier niets van merkt en dat u zelf contact opneemt.

---

## Functionele wensen (stand 2026-08-07, nog geldig)

> Deze lijst komt uit de sessie van 7 augustus en gaat over **functionaliteit**,
> niet over de infrastructuur van 10 augustus. Punt 1 en 2 staan nog open; punt 1
> is deels ingehaald doordat er sinds 09-08 een echte tenant in productie leeft.

**Voor de eigenaar, in volgorde van wat het meest oplevert:**

1. **De DEMO-tenant in productie.** Voorstel van de eigenaar (2026-08-07): een tenant náást
   de echte klanten, waar hij zelf admin is, om ná uitrol te toetsen. Dat maakt de lokale
   demo als tussencategorie overbodig — en die tussencategorie is waar het vandaag misging.
   De seed kan het al (`--echte-tokens`), maar **inloggen vraagt een echte Entra-koppeling**,
   en dat pad is nog niet volledig doorlopen. Waarschijnlijk het meeste werk van wat er ligt.
2. **Werkvoorraad van de beoordelaar** — het derde scherm.
3. **Hulp bij het juiste mailadres.** De backend kiest al bewust een contactpersoon *met*
   adres (`ronde-beheer.service.ts`), maar je merkt pas bij het verzenden dat er niemand te
   mailen is. Dat hoort in het uitnodigingsscherm zichtbaar te zijn vóór je op verzenden
   drukt. Restrisico blijft een adres dat is ingevuld maar verkeerd → bounce-webhook.
4. **Heads-up bij tijdsoverschrijding.** Het zichtbare deel is er ("Te laat" in het
   overzicht); een seintje sturen hangt aan e-mail (fase D) en Issue #16.

Ook nog open: het **vragenlijst-overzichtscherm** ("levert nu nauwelijks zinvolle informatie",
eigenaar 2026-08-06).

---

### Wat er op 2026-08-06 bijkwam

**Het mailkanaal** (#87, #88). Eén platformverstuurder via Resend op `send.myvendormanager.nl`,
geen eigen SMTP per tenant. De klant is herkenbaar aan de afzendernaam ("Transdev via MCM2"),
het adres blijft van het platform — zo hoeft er geen SPF-record van de klant te zijn voordat er
mail uit kan. Zonder sleutel valt alles terug op een logkanaal; half ingesteld faalt bewust hard
bij opstarten.

**Uitnodigingen worden echt verstuurd** (#89). Mislukt één adres, dan gaan de overige door en
rapporteert de response per deelnemer. Serieel, niet parallel — voorspelbaar onder de dagcap van
100 mails. Aantoonbaar: een echte mail kwam aan, een ongeldig adres werd geweigerd.

**Een contactpersoon is te bewerken** (frontend). Voorheen alleen weggooien en opnieuw invoeren.

**ADR-013 — het rolmodel** (#90). Beheerder aan de vendor, beoordelaar aan de vragenlijst. De
koppeling is **een hulpmiddel, geen autorisatiegrens**.

**De exit-route** (#91). `docs/architectuur/exit-route-hosting.md`, een levend document. Valkey
eruit — er bleek geen enkele regel code mee te praten.

**Fase C, backend compleet** (gemerged op 07-08):

| PR | Wat | Migratie |
|---|---|---|
| #94 | `GET /admin/survey/responses/:id/answers` | geen |
| #99 (was #95) | `clm.survey_review` + twee routes | 0015 |
| #97 | `clm.template_reviewer` + vier routes | 0016 |

Drie dingen daaruit die het onthouden waard zijn:

- **C1 joint vanaf de vraag, niet vanaf het antwoord.** Een half ingevulde respons moet de
  openstaande vragen tónen; joinen vanaf `survey_answer` laat ze verdwijnen en doet een halve
  respons compleet lijken.
- **`survey_review` is de eerste tabel waar de tenantgrens niet volstaat.** Een leverancier zit
  in dezelfde tenant als de medewerker die hem beoordeelt, maar mag het oordeel nooit lezen.
  Eerste policy die `clm.current_actor()` gebruikt — de functie stond sinds 0013 ongebruikt.
- **`BeoordelingService` kent `template_reviewer` niet** (nul verwijzingen, geverifieerd). Dat is
  ADR-013 besluit 3: de koppeling bepaalt wat je ziet, niet wat je mag. Wie hier later iets
  bouwt dat op de koppeling wéigert, gaat daartegen in.

### Wat er onderweg boven kwam (2026-08-06)

| Bevinding | Waar |
|---|---|
| **Een tegenproef die niets bewees.** Een heredoc at de backslashes op; sabotage nooit toegepast, 22 tests groen tegen ónveranderde code. Sabotage gaat nu via een bestand en faalt hard als het patroon ontbreekt | werkwijze |
| `migrate:deploy` gedraaid met alleen `DATABASE_URL` gezet; het script leest `MIGRATION_DATABASE_URL` en die wees naar **productie**. Meldde "Migraties voltooid" tegen de verkeerde database. Geen schade (no-op) → **Issue #86**, opgelost in #93 | `scripts/` |
| **`db:generate` is onbruikbaar** — snapshots lopen tot 0007 terwijl er 19 migraties zijn. Het genereerde een migratie die `sessie`, `tenant_membership` en een `user`-kolom opnieuw wilde aanmaken → **Issue #96** | `drizzle/meta/` |
| De bewakingstest op test-id's kijkt alleen naar UUID's tussen **enkele** aanhalingstekens; dezelfde waarde binnen een template-string glipt erdoor. Nog geen issue | `test/test-ids.spec.ts` |
| Verouderde context uit een automatisch geladen skill stelde dat Bizaline naar Azure migreert; als feit overgenomen in een architectuurdocument. Bron opgespoord, vier bestanden geactualiseerd met een gedateerd "Stand per"-kopje | buiten dit project |
| Een geldig gevormd maar niet-bestaand mailadres levert "Geslaagd" op. Geen fout, wel het bewijs dat de bounce-webhook nodig is | mailkanaal |

### Wat er op 2026-08-07 boven kwam

| Bevinding | Waar |
|---|---|
| **De e2e-suites wisten de demo-database leeg.** Geen enkele bescherming sloeg aan: de hostcontrole kent `localhost` als veilig, en de tests hadden hem sowieso niet. Opgelost met migratie 0019 (`clm.omgeving`) | `test/`, `scripts/` |
| **Een handgeschreven migratie wordt stil overgeslagen** als hij niet in `drizzle/meta/_journal.json` staat — `migrate:deploy` meldt dan gewoon "Migraties voltooid". Gevonden doordat het plan voorschreef de constraint terug te lezen uit de database | `drizzle/` |
| **Twee suites deelden dezelfde `token_hash`.** `survey_response_token_hash_key` is uniek over álle tenants heen, dus de tenantscheiding hielp niet. Los draaide elke suite groen; alleen in de volledige run viel er willekeurig een om. Bewakingstest toegevoegd | `test/test-ids.spec.ts` |
| Twee tests in `demo-seed` startten een script zonder timeout en vielen terug op Jests 5s. Bij de reparatie van 2026-08-04 waren juist deze twee overgeslagen | `test/demo-seed.e2e-spec.ts` |
| De opruimstap van `seed:demo --verwijder` kende `survey_review` en `response_note` niet, en zette geen actor `medewerker` — waardoor de policy elke rij weigerde en de fout naar een foreign key wees | `scripts/` |

<details>
<summary>Vorige stand (2026-08-04, avond)</summary>

**Fase A én B van het surveybeheerplan zijn af en gemerged.** De tenant kan een leverancier
aanvinken, een ronde starten en werkende uitnodigingslinks krijgen — de eerste productiecode die
`genereerToken()` aanroept. Vier PR's gemerged: #79, #80, #81, #82 plus frontend #5 en #6.
`verify:volledig` groen: 316 backend, 39 browser.

### Wat er toen bijkwam

**Het mailkanaal** (#87, #88). Eén platformverstuurder via Resend, geen eigen SMTP per tenant — de klant is herkenbaar aan de afzendernaam ("Transdev via MCM2"), het adres blijft van het platform. Zo hoeft er geen SPF-record van de klant te zijn voordat er mail uit kan. `MailKanaal` is een abstracte klasse met één methode; zonder sleutel valt hij terug op een logkanaal, wat de veilige toestand is voor CI en de demo. Half ingestelde configuratie faalt bewust hard bij opstarten: stil terugvallen zou betekenen dat je denkt dat er mail uitgaat terwijl er niets gebeurt.

**Uitnodigingen worden echt verstuurd** (#89). De kern van het ontwerp: mislukt één adres, dan gaan de overige gewoon door en rapporteert de response per deelnemer. Serieel, niet parallel — voorspelbaar onder de dagcap van 100 mails. Verzending gebeurt ná de transactie. Aantoonbaar: een echte mail kwam aan op een externe inbox, en een ongeldig adres werd geweigerd met de juiste foutcode.

**Een contactpersoon is te bewerken** (frontend). Voorheen kon je alleen weggooien en opnieuw invoeren.

**ADR-013 — het rolmodel** (#90). Vier besluiten: de beheerder hangt aan de leverancier (`vendor.owner_user_id`, bestond al ongebruikt), de beoordelaar aan de vragenlijst (nieuw: `template_reviewer`). De koppeling is **een hulpmiddel, geen autorisatiegrens** — de terugval is altijd de contractmanager, die intern buiten de app kan regelen dat de beoordeling door een bevoegd persoon gebeurt. Nog geen contractlaag.

**De exit-route** (#91). `docs/architectuur/exit-route-hosting.md` — bewust geen besluitdocument maar een levend document: per onderdeel wat er draait, hoe vast het zit en wat het alternatief zou zijn. AWS is de waarschijnlijke richting, maar staat niet vast.

**Valkey eruit** (#91). Er bleek geen enkele regel code mee te praten: geen `bullmq`, geen `ioredis`, geen dependency. Container en `REDIS_URL` verwijderd. ADR-004 blijft staan met een noot — komt er een queue, dan is het Valkey; alleen de aanname dát er snel een queue zou zijn klopte niet.

### Wat er onderweg boven kwam

| Bevinding | Waar |
|---|---|
| **Een tegenproef die niets bewees.** Een heredoc at de backslashes op, waardoor de sabotage nooit werd toegepast — 22 tests groen tegen ónveranderde code, bijna gelezen als geslaagd bewijs. Sabotage gaat nu via een bestand en faalt hard als het patroon niet gevonden wordt | werkwijze |
| Een sabotage die de build brak gaf "0 total" — bijna gelezen als "geen falende tests" | werkwijze |
| Een dagcap-test slaagde om de verkeerde reden: met het hele `error`-veld genegeerd viel hij door naar de "geen id"-controle en gooide alsnog | `resend-mail-kanaal.spec.ts` |
| `migrate:deploy` gedraaid met alleen `DATABASE_URL` gezet; het script leest `MIGRATION_DATABASE_URL` en die wees naar **productie**. Meldde "Migraties voltooid" tegen de verkeerde database. Geen schade (no-op), wel Issue #86 | `scripts/` |
| Een geldig gevormd maar niet-bestaand adres levert "Geslaagd" op. Geen fout, wel het bewijs dat de bounce-webhook nodig is | mailkanaal |
| Verouderde context uit een automatisch geladen skill stelde dat Bizaline naar Azure migreert. Dat is als feit overgenomen in een architectuurdocument. Bron opgespoord en de vier bestanden geactualiseerd; ze dragen nu een gedateerd "Stand per"-kopje | buiten dit project |

<details>
<summary>Vorige stand (2026-08-04, avond)</summary>

**Fase A én B van het surveybeheerplan zijn af en gemerged.** De tenant kan een leverancier aanvinken, een ronde starten en werkende uitnodigingslinks krijgen — de eerste productiecode die `genereerToken()` aanroept. Daarnaast: `npm run demo` zet de hele stack in één commando neer, en de browsertests ruimen op wat ze aanmaken. Vier PR's gemerged: #79, #80, #81, #82 plus frontend #5 en #6. `verify:volledig` groen: 316 backend, 39 browser.

**Fase A — vragenlijsten bekijken** (#79, frontend #5). Vier leesroutes onder `/admin/survey`, plus de schermen. Bewust alleen lezen.

**Fase B — uitnodigen** (#81, frontend #6). Drie schrijfroutes met `@VereistRol('admin')`; een reviewer mag lezen maar geen tokens uitgeven. De ronde begint in `draft` omdat actief zetten de vragenlijst onomkeerbaar bevriest. Alles in één transactie: faalt er één invoeging, dan rollen ook de al gegenereerde tokens terug.

**`npm run demo`** — database, backend, frontend, sessie en een zelfcontrole in één commando. Aanleiding: het handmatig opstarten ging drie keer mis, en alle vier de oorzaken (ontbrekende `NEXT_PUBLIC_API_URL`, geen backend, `CORS_ORIGIN`, `SESSIE_COOKIE_INSECURE`) zien er in het scherm hetzelfde uit. Runbook: `docs/runbooks/zelf-testen.md`.

**Een oranje balk** bovenin zolang je niet in een klantomgeving zit, met de tenantnaam erin. Leest uit de sessie en niet uit een omgevingsvariabele — die kan per ongeluk meegaan naar productie of ontbreken in de demo.

| Bevinding | Waar |
|---|---|
| De zelfcontrole met `curl` was blind voor CORS-fouten — zonder `Origin`-header geeft de backend ook bij een verkeerde `CORS_ORIGIN` een 200 | `scripts/demo-stack.js` |
| `verify:volledig` ruimde zijn stack niet op na een rode run: `process.exit(1)` slaat `finally` over | `scripts/verify-volledig.js` |
| De browsertests lieten hun leveranciers staan — 20 stuks testafval naast 21 demo-leveranciers | `e2e/vendor-detail.spec.ts` |
| Een verborgen afhankelijkheid tussen suites: `navigatie-en-zoeken` leunde op wat een andere suite achterliet | idem |
| Twee tests gebruikten `count()` op een ladende pagina; één werd daardoor groen zonder iets te bekijken | `e2e/vragenlijsten.spec.ts` |
| Zoektests leunden op kolomposities; met de selectiekolom erbij keek er één naar het KvK-nummer i.p.v. de plaats | `e2e/navigatie-en-zoeken.spec.ts` |

**Nieuwe werkwijzeregel (§15c in `MCM2-CLAUDE.md`, PR #82).** Namen en paden opzoeken, niet reconstrueren. Aanleiding: zes van de negen correctierondes deze sessie waren vermijdbaar, en alle zes stonden in code die al gelezen was. Wat dat kost is niet de tijd maar het onderscheid tussen een rode test die iets betekent en een rode test die slordigheid is.

</details>

<details>
<summary>Vorige stand (2026-08-04, middag)</summary>

**De productiedatabase is bijgewerkt van 9 naar 18 tabellen.** `clm-enterprise` stond sinds 27 juli stil op de Prisma-historie; de migraties 0003 t/m 0014 waren er nooit op toegepast. Daardoor miste de dagelijkse backup álle vragenlijsten, antwoorden, geüploade certificaten en het complete rechtenmodel — gevonden bij een routinecontrole diezelfde ochtend, toen bleek dat alle dumps exact 21.683 bytes waren. Migratiestand geïnitialiseerd (#25), UUID-defaults en tenant-indexen rechtgezet (#29), backup weer compleet en herstelbaar bewezen. Beide issues gesloten.

</details>

<details>
<summary>Vorige stand (2026-08-04, ochtend)</summary>

**De backup bleek de helft van de database te missen.** Bij een routinecontrole gemeten: de dagelijkse dump bevat 9 van de 18 tabellen. Ontbrekend zijn álle vragenlijsten, antwoorden, geüploade certificaten, `tenant_membership` en `sessie`. Dat was er altijd al zo geweest; alle dumps waren exact 21.683 bytes en niemand had daar betekenis aan gehecht. Oorzaak is Issue #25: `clm-enterprise` heeft de migraties vanaf 0003 nooit gekregen.

</details>

<details>
<summary>Vorige stand (2026-08-03, avond)</summary>

**`app.current_actor` toegevoegd en gemerged**, PR #73: de database kan sinds migratie 0013 onderscheid maken tussen een medewerker en een leverancier. Dat kon hij niet — `withTenant()` zette alleen de tenant, en beide paden riepen hem identiek aan. Nodig voor de beoordelingstabel uit het surveybeheerplan, waar "zelfde tenant = mag het zien" voor het eerst níét opgaat. 269 e2e-tests en 25 browsertests groen, CI groen op `main`, geen open branches. Drie tegenproeven gedaan; de derde bleef groen en leverde een nieuwe les op — zie hieronder.

</details>

<details>
<summary>Vorige stand (2026-08-03, middag)</summary>

**fase 2b, 2c en 3 zijn af**: demo-tenant met één commando, de sidebar en schermindeling van MVM_V2, zoeken, en een detailscherm waarop een leverancier te wijzigen is. Een `reviewer` mag nu aantoonbaar lezen maar niet schrijven. 264 e2e-tests en 25 browsertests groen. Twee dingen die aandacht vragen staan onder "Actieve blokkades": de dagelijkse backup heeft drie dagen stilgelegen, en er staat een productiewachtwoord in de git-historie van `mvm-api-pilot`.

</details>

<details>
<summary>Vorige stand (2026-07-31, avond)</summary>

**fase 1 én 2 zijn af, en inloggen via Entra werkt aantoonbaar**. Er is een zichtbaar beheerscherm op `/beheer/leveranciers`, één commando dat de hele keten doortest, en de laatste onbewezen aanname — welke claims Entra levert — is gemeten. Alles gemerged, CI groen op `main` in beide repositories.

</details>

Alles hieronder is geverifieerd, niet uit gespreksgeheugen.

**Plan voor de komende fases:** `docs/superpowers/plans/2026-08-03-surveybeheer.md` — vier fases naar een tenant die zelf een vragenlijst kan uitzetten: rondes bekijken (A), een ronde starten en deelnemers uitnodigen (B), voortgang volgen, antwoorden lezen en beoordelen (C), en uitnodigingen mailen (D). Alle openstaande vragen daarin zijn op 2026-08-03 beantwoord.

Dat plan begint met een bevinding die het waard is om te onthouden: **`genereerToken()` heeft geen enkele productieaanroeper.** Alleen `seed-demo-tenant.js` en `otap-doorloop.js` maken responses aan. Er bestaat dus nog geen weg waarlangs een echte uitnodiging tot stand komt — de beheerkant kan leveranciers beheren, maar geen vragenlijst uitzetten.

<details>
<summary>Vorig plan (2026-07-30, alle vier de fases af)</summary>

`docs/superpowers/plans/2026-07-30-beheerkant-en-demo-tenant.md` — een frontend die eruitziet als MVM_V2, inloggen als tenant, vendors met contactpersonen aanmaken, een demo-tenant met mock data, en een robuuste OTAP-doorloop.

</details>

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

   Wie wil begrijpen **waarom** de tenantgrens is zoals hij is, en hoe elke laag ervan bewezen wordt: `docs/architectuur-en-verificatie.md`. Dat document beschrijft de architectuur, het principe achter de testopzet (elke beveiligingstest krijgt een tegenproef) en — het belangrijkste hoofdstuk — wat er nog **niet** bewezen is. Het veroudert zodra de code verandert, dus werk het bij wanneer je de tenantgrens of de testopzet raakt.

   Verder, sinds 2026-08-10:
   - `docs/runbooks/README.md` — de index van alle runbooks
   - `docs/runbooks/onderhoudskalender.md` — wat er terugkeert en wanneer, plus §5: wat nog **niet** beschreven is
   - `docs/runbooks/uitrol-acceptatie-en-productie.md` — uitrollen, promoveren, terugdraaien

   `npm run verify:onderhoud` bewaakt dat die documenten niet verouderen; hij draait als stap 1 van `verify:volledig`.
3. Verifieer git-status zelf (`git status`, `git branch -a`) tegen wat hieronder staat — vertrouw niet blind op deze snapshot. **Doe dat in beide repositories.**
4. Check de open GitHub Issues (`gh issue list --repo AlingAdvies/MCM2 --state open`) voor de actuele backlog — dit document verwijst naar issue-nummers, maar de Issues zelf zijn de bron van waarheid over wat daadwerkelijk nog open staat.
5. **Werk verder volgens het plan** — sinds 2026-08-03 is dat
   `docs/superpowers/plans/2026-08-03-surveybeheer.md`. Niet volgens losse ingevingen.
   Uitdrukkelijke wens van de eigenaar: **de fases in volgorde afwerken.**

   > **Stand 2026-08-10:** fase A, B en C zijn gebouwd en gemerged. Er zijn geen
   > open PR's. Het surveybeheerplan is daarmee grotendeels afgewerkt; wat er nu
   > ligt is infrastructuur (Issue #51, #46, #12) en frontend-ontwerp.
   > **Begin bij het blauwe blok bovenaan dit document**, niet bij punt 6 hieronder —
   > dat beschrijft de situatie van vóór fase A.

   Twee dingen die daarbij horen en makkelijk wegzakken:
   - **Issue #59 — `npm audit` meldt 29 kwetsbaarheden.** Niet vergeten, maar ook niet nu oplossen: `npm audit --omit=dev` geeft **0**, dus er zit niets van in het productie-image. De voorgestelde automatische fix zet eslint jaren terug en breekt de lint-configuratie. Hoort bij de eerste major-onderhoudsronde op devDependencies, samen met Dependabot (#22). **Controleer wel bij elke sessie dat `npm audit --omit=dev` nul blijft** — wordt dat meer dan nul, dan is het geen onderhoudspunt meer maar een blocker.
   - **Issue #58 — de backup hangt af van deze laptop.** Draait dagelijks, maar niet als de machine uitstaat. Vóór de pilotstart (rond 1 september) naar iets onafhankelijks.

6. **Historisch — de situatie van 2026-08-03.** Dit punt beschrijft waaróm het surveybeheerplan
   er kwam. Voor de actuele vervolgstap: zie het rode blok bovenaan.

   Fase 1 en 2 zijn op 2026-07-31 afgerond, fase 2b, 2c en 3 op 2026-08-03.

   **Advies over de volgorde (2026-08-03):** eerst functionaliteit, dan fase 4. De doorloop test wat er ís; elke functie die er daarna bij komt, moet er alsnog in. Fase 4 later doen betekent niet dat het werk verdwijnt — het voorkomt dat het twee keer gebeurt. Voorwaarde is wel dat elke fase blijft eindigen met `verify:volledig` groen plus een tegenproef (§15, §15b), anders wordt fase 4 een opruimactie in plaats van een uitbreiding.

   **Het grootste gat is surveybeheer.** `survey/respond` is de leverancierskant — invullen via een token. Er is géén enkele beheerroute: geen vragenlijsten bekijken, geen ronde starten, geen resultaten inzien. De database kan het allemaal al (`survey_template`, `survey_run`, `survey_response`), en de demo-seed vult het. Dat verdient een eigen plan vóór er code komt.

   **Wat er nu werkt en zichtbaar is:**

   ```
   /beheer/leveranciers        sidebar + lijst met zoeken + aanmaakformulier
   /beheer/leveranciers/[id]   detail: stamgegevens wijzigen, contactpersonen beheren
   npm run seed:demo           demo-tenant: 21 leveranciers, 3 gebruikers, 3 responses
   npm run verify:volledig     code → 161 unit → 269 e2e → stack → 25 browsertests
   ```

   **Inloggen via Entra werkt aantoonbaar.** Eén echte login doorlopen: code inwisselen, token verifiëren met de échte applicatiecode, gebruiker en membership, sessie via `clm.sessie_aanmaken()`, en met dat cookie `/vendors` → 200. Zonder cookie → 401.

   **De claims zijn gemeten**, niet langer aangenomen: `oid` is 36 tekens (UUID), `sub` 43 en dus géén UUID. Dat lengteverschil bevestigt de keuze voor `oid` — op `sub` koppelen had betekend dat dezelfde persoon in een tweede app-registratie een ander account kreeg.

   **Twee dingen om te onthouden bij lokaal werken:**
   - `SESSIE_COOKIE_INSECURE=true` moet in `.env` staan, anders weigert de browser het `__Host-`-cookie over http en lukt inloggen niet. In productie hoort die regel er níét te staan.
   - De `oid` in `clm.user.external_subject` hoort bij **mcm2ciam**, niet bij AlingAdvies. Verhuist de CIAM-tenant ooit, dan is dat een **datamigratie** — zie `docs/architectuur-en-verificatie.md` §11.

### Twee scripts in `scripts/` die hun werk gedaan hebben

`claims-meten.js` en `echte-login.js` zijn op 2026-07-31 gebouwd om één vraag te beantwoorden: **welke claims levert Entra werkelijk, en sluit de keten van login tot beheerroute?** Die vraag is beantwoord (§11 van het architectuurdocument), dus ze zijn nu niet meer nodig.

**Bewust laten staan, niet verwijderd.** Ze worden weer bruikbaar zodra de identity-configuratie verandert:

| Wanneer | Welk script |
|---|---|
| Verhuizing naar een Bizaline-tenant (ADR-006) | allebei — de `oid`'s veranderen dan |
| Een tweede app-registratie erbij | `claims-meten.js` |
| "Inloggen doet het niet meer" | `echte-login.js` — die noemt per stap waar het strandt |

Geen van beide schrijft iets weg of drukt een `oid` af; de waarden gaan rechtstreeks van het token naar de database. Zie de kop van elk bestand voor de werkwijze en de valkuilen (oude browsertabs, de cookienaam).

Blijken ze over een half jaar nog steeds ongebruikt, dan kunnen ze weg — de kennis staat in `src/auth/README.md`, niet in de scripts.

   **Issue #30 is niet langer de zwaarste blokkade** — de dagelijkse backup draait sinds 2026-07-30 naar OneDrive. Wat rest is het restrisico in #58 (hangt af van de laptop). De drie issues die op backups wachtten (#19, #25, #29) raken de productiedatabase en kunnen nu heroverwogen worden; er wordt intussen tegen wegwerpcontainers gebouwd.

   **#46 heeft een harde datum.** De pilot start rond 1 september en geüploade certificaten staan op een containerschijf die bij de eerstvolgende image-vervanging leeg is.

### Snel weer op gang komen

> **Welk commando bestaat er, en waar praat het naartoe?**
> `docs/runbooks/commandos-en-omgeving.md` — de volledige lijst, geverifieerd,
> met de waarschuwing dat `.env` naar Supabase wijst. Lees dat eerst wanneer je
> iets wilt draaien dat de database raakt.

**De hele keten in één commando** (aanbevolen — sinds 2026-07-31):

```bash
npm run verify:volledig
```

Vijf stappen: code, 161 unittests, 269 e2e tegen een wegwerpdatabase, beide
productie-images bouwen, 25 browsertests, en altijd opruimen. Stopt bij de
eerste rode stap en noemt welke CI-job dat is.

**Sinds 2026-08-03 controleert hij eerst of poort 5001 en 3000 vrij zijn.** Draait
daar een dev-server, dan stopt hij binnen ~2,5 seconde met een melding die zegt
welke poort bezet is en hoe je het proces vindt. Daarvóór strandde de doorloop
pas ná stap 1 — minuten aan tests voor niets, met een Docker-melding die niet zei
wélk proces in de weg zat.

Dat was ook een correctheidsprobleem: `wachtOpStack()` pollt op die twee poorten,
dus een draaiende dev-server antwoordde met 200 en het script dacht dat de stack
gezond was — waarna de browsertest tegen die dev-server draaide in plaats van
tegen de productie-images. Vandaar hard falen en niet alleen waarschuwen. Het
script sluit bewust niets zelf af.

**Let op bij handmatig een testcontainer draaien:** `verify:volledig` claimt poort
**55441**. Draait daar nog iets van een vorige sessie, dan faalt stap 1 met
"geen testdatabase kunnen starten" — een melding die naar de verkeerde oorzaak
wijst. Opruimen met `docker rm -f <naam>`.

Alleen de code-poorten, zonder stack: `npm run verify` (vraagt `DATABASE_URL`)
of `npm run verify:snel` (slaat de e2e-laag over en zegt dat er ook bij).

**Nooit meer losse commando's gebruiken om "groen" vast te stellen** — zie
MCM2-CLAUDE.md §15a. `npm run lint` en `npm run format` doen iets ánders dan wat
CI draait, en dat is op 2026-07-31 een keer misgegaan.

<details>
<summary>Handmatig een wegwerpdatabase opzetten (zelden nodig)</summary>

```bash
# Let op: de containernaam moet minstens twee tekens hebben. Docker 29 weigert
# een naam van één teken ("Invalid container name"); oudere versies deden dat niet.
docker run -d --name mcm2test -e POSTGRES_PASSWORD=pw -p 55440:5432 postgres:17.6
docker exec -i mcm2test psql -U postgres -q < db/roles/bootstrap-roles.sql
docker exec mcm2test psql -U postgres -d postgres -c "ALTER ROLE clm_migrator WITH PASSWORD 'pw'; ALTER ROLE clm_api_runtime WITH PASSWORD 'pw';"
MIGRATION_DATABASE_URL="postgresql://clm_migrator:pw@localhost:55440/postgres" npm run migrate:deploy
DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55440/postgres" \
  npx jest --config test/jest-e2e.json --forceExit    # 269 tests, 20 suites
# --forceExit is nodig sinds de sessiesuite: die houdt een pg-verbinding open
# waardoor Jest anders blijft hangen zonder foutmelding.
# `-d postgres` is niet optioneel: psql neemt anders de rolnaam als
# databasenaam en faalt met een melding die naar de verkeerde oorzaak wijst.
```

</details>

# Unittests — geen database nodig
npx jest                                  # 105 (58 vendor + 46 auth + 1 bestaande)

# Backup handmatig draaien (draait dagelijks vanzelf om 07:00 naar OneDrive)
npm run backup:dump
# Heeft de geplande taak gedraaid?
#   Get-ScheduledTaskInfo -TaskName "MCM2 databasebackup"
#   Get-Content "$env:USERPROFILE\OneDrive - Aling Advies\MCM2-backups\backup-taak.log" -Tail 20

# De twee vragenlijsten inlezen (tenant moet bestaan)
DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55440/postgres" \
  npm run seed:vragenlijsten -- <tenant-uuid>

# De demo-tenant vullen (doet de vragenlijsten zelf ook)
DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55440/postgres" \
  npm run seed:demo
#   → drukt drie tokenlinks af: open, concept, ingediend
#   weghalen: node scripts/seed-demo-tenant.js --verwijder

# Frontend: het portaal bekijken zonder backend
cd ../MCM2-frontend && npm run dev
# → http://localhost:3000/portal/survey/demo-geldig
#   andere demo-tokens: demo-nietopen, demo-verlopen, demo-ingediend

# De volledige keten (beide productie-images): docs/runbooks/otap-doorloop.md
# Daarna de browsertest, met een VERSE tokenlink (indienen is eenmalig):
cd ../MCM2-frontend && SURVEY_TOKEN=<verse-link> npm run e2e
```

## De database kent nu het verschil tussen medewerker en leverancier (2026-08-03, migratie 0013)

**Wat er ontbrak.** `DatabaseService.withTenant()` zette precies één sessievariabele: `app.current_tenant_id`. Het leverancierspad (tokenlookup) en het medewerkerspad (sessiecookie) riepen die functie identiek aan, met dezelfde tenantId. Elke policy luidt `USING (tenant_id = clm.current_tenant_id())`.

Gemeten op 2026-08-03: **de database kon geen onderscheid maken tussen een medewerker en een leverancier van dezelfde tenant.** Voor elke bestaande tabel is dat juist — een leverancier hoort zijn eigen respons te kunnen lezen. Het wordt pas een probleem bij de beoordelingstabel uit `docs/superpowers/plans/2026-08-03-surveybeheer.md`: daar mag de leverancier het oordeel over zichzelf níét zien, ook al staat het in zijn tenant.

Zonder deze migratie zou die bescherming volledig bestaan uit de afwezigheid van een route die het oordeel teruggeeft — hetzelfde faalpatroon als tegenproef 6.

**Wat er nu staat.** `app.current_actor` met waarden `medewerker`, `leverancier` en `onbekend`, gelezen via `clm.current_actor()`. Niet gezet betekent `onbekend`, en dat is de striktste stand: een vergeten actor faalt dicht, niet open.

De migratie **verandert bewust geen gedrag** — geen enkele bestaande policy leunt erop. De eerste die dat doet is migratie 0014 (`survey_review`).

**Waarom de parameter optioneel is en toch verplicht.** In de signatuur optioneel, omdat verplicht maken ~70 testregels zou raken die niets met dit onderwerp te maken hebben — ruis in precies de tests die de tenantgrens bewijzen. In de praktijk verplicht, omdat weglaten `onbekend` oplevert en een nieuwe test de leverancierspaden bewaakt.

### Drie tegenproeven, en de derde leverde een nieuwe les

| Sabotage | Uitkomst |
|---|---|
| `withTenant()` zet de actor altijd op `medewerker` | 2 tests vielen om, zoals bedoeld |
| standaard omgedraaid naar `medewerker` i.p.v. `onbekend` | 3 tests vielen om, zoals bedoeld |
| `vragenlijst-lezen.service.ts` kondigt zich aan als `medewerker` | **alle 268 tests bleven groen** |

Die derde is het ernstigste wat er met dit mechanisme mis kan gaan: een leverancier die zich als medewerker voordoet, krijgt straks toegang tot beoordelingen over zichzelf. Niets merkte het.

**Terecht en tegelijk onacceptabel.** Terecht, want er was nog geen policy die de actor gebruikt — er viel niets te meten. Onacceptabel, want daarmee is de doorgifte tot migratie 0014 volledig onbewaakt, en dat is precies het venster waarin iemand een nieuwe survey-route bouwt en de actor van het verkeerde voorbeeld overneemt.

Opgelost met een test die de broncode zelf leest (`actor-context.e2e-spec.ts`, laatste test) — lelijker dan een gedragstest, maar het verschil tussen een bewaakte afspraak en een goed voornemen. Dezelfde afweging als `test-ids.spec.ts`. Na toevoeging faalt de sabotage wél.

De les staat in MCM2-CLAUDE.md §15b: **bouw je een grens in twee stappen, dan hoort er in stap één een test die de afspraak zelf bewaakt.**

### Bijvangst: een test met een te krappe tijdslimiet

`demo-seed.e2e-spec.ts` viel reproduceerbaar om op een timeout van 5 s. Niet door deze wijziging — het seed-script gebruikt zijn eigen `set_config` en raakt `withTenant()` niet. De test start dat script twee keer als apart Node-proces (~1,6 s per keer, gemeten), wat binnen 5 s alleen past als de machine niets anders doet. In de volledige suite doet hij dat wel.

De foutmelding wees naar hashing terwijl er niets mis was met hashing — dezelfde verwarrende faalvorm als de botsende test-id's van 2026-07-31. Twee tests hebben nu een limiet van 20 s met de reden erbij.

## Beheerkant — detail, wijzigen en rolcontrole (2026-08-03, fase 2c)

Een leverancier is te openen op `/beheer/leveranciers/[id]`, te wijzigen en te verwijderen; contactpersonen zijn toe te voegen, primair te maken en te verwijderen.

**Nieuw in de backend:** `GET`, `PATCH` en `DELETE` op `/vendors/:id`, plus `POST`, `PATCH` en `DELETE` op `/vendors/:id/contacts`. Alles soft delete — een leverancier kan in een surveyronde voorkomen, en die respons is bewijsmateriaal.

**`RolGuard` sluit §6 van het rechten-ontwerp.** Tot vandaag stond `POST /vendors` open voor elke geldige sessie: `reviewer` was een label in de sidebar zonder betekenis. Nu geeft elke schrijfroute 403 voor een reviewer, lezen mag wel. Gemeten:

```
reviewer  GET lijst 200 · GET detail 200
          POST 403 · PATCH 403 · DELETE 403 · contacten 403
```

**Bewust níét wijzigbaar:** risicoscore, jaarbedrag en reviewdatums. Die horen uit een beoordeling of een inkoopsysteem te komen; een handmatig ingevulde risicoscore botst met een berekende zodra die er is.

**Twee tegenproeven, beide raak:** rolcontrole uitgeschakeld → vijf reviewer-tests vielen om; de `vendor_id`-controle uit de contactquery → precies één test viel om. Zonder die controle was een contactpersoon van leverancier A te wijzigen via het adres van leverancier B, binnen dezelfde tenant.

**Een onregelmatig falende test opgelost.** `demo-seed.e2e-spec.ts` faalde wisselend: de tokenhash-test las de tokens uit de uitvoer van het seed-script, maar dat script drukt de links alleen af wanneer het de ronde daadwerkelijk aanmaakt. Had een andere suite de tenant al gevuld, dan vond de test nul links en viel om op iets dat niets met hashing te maken had. De tokens worden nu berekend zoals het script ze berekent; daarna drie keer vanaf een lege database groen.

### Twee punten die aandacht verdienen

- **`consulting` én `consultancy` staan allebei in `ref.vendor_category`** — twee codes voor hetzelfde begrip. `consultancy` komt uit de baseline, `consulting` uit migratie 0012 van vanochtend. De frontend toont alleen `consulting`; bestaande rijen met `consultancy` blijven werken en tonen hun eigen waarde (`keuzesMetHuidige()`). Opruimen is een migratie die bestaande data raakt en apart afgestemd moet worden.
- **`POST /vendors` was open voor reviewers en dat is nu dicht** — maar dat betekent ook dat een reviewer sinds vandaag geen leveranciers meer kan aanmaken. Als dat in de praktijk wél de bedoeling is, is dat één regel: de `@VereistRol('admin')` van die route halen.

## Beheerkant — sidebar, schermindeling en zoeken (2026-08-03, fase 2b)

De beheerkant lijkt nu op MVM_V2: navigatiekolom links, titelbalk boven, de huisstijlkleuren. Aanleiding was de vraag van de eigenaar waarom het er zo anders uitzag — en het antwoord was dat fase 2 als "af" was afgevinkt terwijl alleen de kleuren waren overgenomen, niet de layout. Het plan vroeg letterlijk om "sidebar, kleuren, typografie, schermindeling".

**Nieuw in de backend: `GET /auth/sessie`.** De frontend wist niet wie er was ingelogd — het sessiecookie is `httpOnly` en dus onleesbaar voor JavaScript. Deze route geeft naam, tenantnaam en rol; **geen tenantId, userId of sessieId**, want wat er niet in staat kan ook niet in een URL belanden (§6).

**Nieuw in de frontend:** `Sidebar.tsx`, `AppLayout.tsx` (beide uit MVM_V2, met bronvermelding), zoeken op naam/KvK/plaats, en `magZien()` — de ene plek die bepaalt of iemand een menu-item ziet.

**Drie dingen bewust anders dan MVM_V2:**

- **Alleen menu-items die werken.** MVM_V2 heeft er zes; hier bestaat alleen Leveranciers.
- **Geen gebruikersschakelaar.** Die zou een tweede pad naar identiteit zijn naast het sessiecookie.
- **Geen verborgen knoppen bij open routes.** `POST /vendors` staat open voor elke geldige sessie, ook voor een `reviewer`. De knop verbergen zou de indruk wekken dat er een rechtenmodel is dat er niet is.

**De tegenproef vond een echt gat, de zesde keer in dit project.** Met een `tenantId` toegevoegd aan `/auth/sessie` bleven **alle acht browsertests groen** — de sidebar toont dat veld niet, dus het kwam nooit in beeld terwijl het wél over de lijn ging. Een lek hoort bij de bron getest te worden; `test/sessie-route.e2e-spec.ts` controleert nu het antwoord zelf, en daar vallen met de sabotage twee tests om.

**Feature flags: ontworpen, niet gebouwd.** De eigenaar wees op twee lagen — betaalde features per tenant én verschillen per gebruiker binnen een tenant. Uitgewerkt in `docs/superpowers/specs/2026-08-03-feature-flags-en-rechten.md`, inclusief drie manieren om laag 1 vast te leggen en een advies. **Besluit ligt bij de eigenaar.** Vier openstaande vragen staan in §7 van dat document; geen daarvan blokkeert fase 4.

### Onregelmatig falende doorloop opgelost

`verify:volledig` faalde wisselend op `psql: connection to server on socket … failed: No such file or directory` — een melding die naar de verkeerde oorzaak wijst, want de container was gezond.

Oorzaak: het `postgres`-image start tijdens de **eerste initialisatie** een tijdelijke server die alleen op de Unix-socket luistert. `pg_isready` meldt die als "accepting connections", waarna het image hem stopt en de echte server start. Een `psql` die precies daartussen valt, faalt.

De wachtlus eist nu **twee opeenvolgende geslaagde queries** in plaats van één `pg_isready`. Daarna vijf runs achter elkaar groen.

## Demo-tenant — één commando, geen klantdata (2026-08-03, fase 3)

**De hele omgeving in één commando** (aanbevolen — container, migraties en data):

```bash
npm run demo:start              # opzetten, of met rust laten als hij draait
npm run demo:status             # draait hij, wat zit erin, is er een account gekoppeld?
npm run demo:stop               # opruimen
npm run demo:start -- --opnieuw # weggooien en vanaf niets opbouwen
```

`demo:start` is idempotent en kent drie situaties: draaiend (blijft staan, data intact), gestopt (start op mét data — het scenario "Docker Desktop herstart"), afwezig (bouwt op). De container heet `mcm2demo`, draait op poort **55450** en heeft het label `mcm2.rol=demo`.

**Dat label is er met reden.** Op 2026-08-03 is de demo-database twee keer weggegooid door een opruimactie over álle containers, en daarmee ook de koppeling van een echt Entra-account aan een demo-gebruiker. Een opruimactie kan hem nu overslaan:

```bash
docker rm -f $(docker ps -aq --filter "label!=mcm2.rol=demo")
```

De teststraat raakte hem overigens nooit: `verify` weigert te draaien tegen iets anders dan een lokale wegwerpdatabase, en `verify:volledig` maakt zijn eigen container op poort 55441. Vier poorten, vier doelen: 55440 handmatige `verify`, 55441 `verify:volledig`, 55450 demo, 55500 OTAP-doorloop.

**Alleen de data, tegen een bestaande database:**

```bash
DATABASE_URL=… npm run seed:demo              # vullen (idempotent)
DATABASE_URL=… node scripts/seed-demo-tenant.js --verwijder   # weghalen
```

Vult tenant `dededede-0000-4000-8000-000000000001` met 3 gebruikers (met membership), 21 leveranciers met contactpersoon en tags, beide vragenlijsten en één actieve ronde met drie responses: open, concept en ingediend.

**De data komt uit MVM_V2** (`src/data/vendors.mock.ts`), éénmalig geëxtraheerd naar `db/seeds/demo/leveranciers.json`. Bewust geëxtraheerd en niet geïmporteerd: een `import` uit `../../MVM_V2` werkt niet in een container of op een andere machine, en dat is juist waar dit script moet draaien.

**Migratie 0012 hoort hierbij.** De mock-data gebruikt negen `ref`-codes die MCM2 niet kende (zeven categorieën, plus `critical` en `at_risk`). Besluit van de eigenaar: toevoegen in plaats van vervlakken naar `other`/`high`.

**Twee dingen om te weten bij gebruik:**

- **Inloggen als demo-gebruiker kan niet.** Hun `external_subject` begint met `demo:` en is geen echte Entra-`oid`. Dat is bewust: een verzonnen UUID zou niet te onderscheiden zijn van een echte identiteit en kan botsen op de unieke index. De schermen bekijk je via de tokenlinks die het script afdrukt.
- **De demo-tokens staan leesbaar in het script.** Dat mag daar en nergens anders: ze geven alleen toegang tot verzonnen data in deze ene tenant. De opslag blijft een SHA-256-hash — het pad is identiek aan dat van een echte uitnodiging, alleen de invoer is bekend.

**Bewezen, niet aangenomen** (8 e2e-tests in `test/demo-seed.e2e-spec.ts`): idempotent, drie werkelijk verschillende stadia, tokens in de vorm die de guard accepteert, en cross-tenant onzichtbaar. Gemeten tegen de draaiende API gaven de drie links respectievelijk 200, 200 en 410 ("al ingediend op 3 augustus 2026").

**De tegenproef vond een echt gat** — de vijfde keer in dit project. Met de tokenhash vervangen door een hex-codering van het ruwe token bleven alle acht tests groen, terwijl de waarde omkeerbaar was: een databasedump zou dan elke openstaande survey openen. De test keek naar de vórm van de hash, niet of het de hash ís. Nu herberekent hij de verwachte SHA-256 uit het bekende token.

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

## Frontend — leverancierportaal werkt end-to-end (2026-07-30)

**`https://github.com/AlingAdvies/MCM2-frontend`** (privé, onder AlingAdvies). CI groen op beide jobs.

**Het portaal is afrondbaar.** Sinds PR #1 (2026-07-30) kan een leverancier de Transdev-vragenlijst van tokenlink tot bevestiging doorlopen: vragen lezen, bevestigen, certificaat uploaden, indienen. Daarna is de link op. Gemeten in de browser tegen de productie-images:

```
/questions 200  →  /attachment 201  →  /respond 200  →  tweede poging 410
```

Twee bugs uit de OTAP-doorloop van 2026-07-29 zijn daarmee weg:

- **#42** — het portaal toonde "Bestandsupload volgt in een volgende versie" terwijl de backend het wél kon. Bevestigen op de ISO-vraag gaf een 422 die als "Er ging iets mis bij het versturen" verscheen: een doodlopende weg. Nu een uploadveld begrensd op `maxFiles`, en een 422 wordt **per vraag** getoond in plaats van als paginabrede blokkade — een 422 is herstelbaar, dus die hoort niet naar het geblokkeerde scherm te leiden.
- **#43** — het leesblok kreeg drie keuzerondjes. Nu een apart `Leesblok`-component, en de nummering slaat leesblokken over zodat "vraag 8" klopt met wat de teller zegt.

**Eerste browsertest** (`e2e/portaal-uc1.spec.ts`, Playwright): de volledige UC1-flow tegen de OTAP-stack, geen mock. **Draait niet in CI** — hij vraagt een verse tokenlink per run, want indienen is eenmalig. Zonder `SURVEY_TOKEN` slaat hij zichzelf over in plaats van te falen. Zie #47 en #53.

Tegenproef gedaan: met de `instruction`-tak eruit vielen drie controles om, met het uploadveld verborgen twee plus een omvallende `setInputFiles`.

**Twee bekende gaten, bewust niet gedicht:**

- **Gemengde taal.** De vragen zijn Engels (uit het Transdev-bronbestand), de meldingen van het portaal Nederlands. Dat is een besluit voor de eigenaar, geen bug.
- **Een geüploade bijlage is niet te verwijderen.** De backend heeft geen `DELETE` op `/survey/respond/attachment`. Er staat een vinkje, geen kruisje — een knop die niets kan aanroepen is erger dan geen knop. Verwijderen mogelijk maken is backend-werk en een nieuw issue.

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

- **OPGELOST 2026-08-07, ochtend — het CI-gat is gedicht.** GitHub Actions stond weer op
  `operational`, waarna de vijf wachtende PR's stuk voor stuk met een groene run zijn gemerged.
  De Docker-productiebuild en de RLS tenant-isolatietest hebben `main` daarmee weer gezien,
  inclusief de twee migraties 0015 en 0016.

  **Het onderscheid dat anders verloren gaat:** de rode run op `main` na PR #90 had drie
  `cancelled` jobs zonder één falende stap. Er was niets uitgevoerd, dus niets gezakt. Een
  `failure` noemt de stap die zakte; een `cancelled` betekent dat de klus is afgebroken vóór er
  iets gebeurde. `main` was niet stuk.

  **Eén ding om te onthouden voor een volgende storing.** `workflow_dispatch` uit PR #92 werkt
  pas op branches die die commit al bevatten — GitHub leest de handmatige triggers uit de
  workflow op de branch zelf. Bij de oudere PR's leverde handmatig starten daarom een 422 op;
  de branch bijwerken vanaf `main` haalde de trigger binnen en startte CI meteen opnieuw.

- **OPGELOST 2026-08-04, middag — de backup mist negen van de achttien tabellen.** De migratiestand is geïnitialiseerd en de keten 0002 t/m 0014 toegepast: 9 tabellen werden er 18, schema-conformiteit GOEDGEKEURD (17/17), backupcontrole 0 problemen, dump van 21,2 kB naar 77,7 kB. Issues #25 en #29 gesloten. Procedure in `docs/runbooks/baseline-migratiestand.md`.

  **Twee dingen die daarbij bleken.** `clm_migrator` had geen `CREATE`-recht op de database, terwijl `db/roles/bootstrap-roles.sql` regel 67–68 dat al voorschrijft — nooit op Supabase toegepast, dezelfde onafgemaakte overstap als #25 zelf. En direct ná de migraties was de backup stuk: migratie 0011 zet `FORCE ROW LEVEL SECURITY`, waardoor `pg_dump` als `clm_migrator` faalt. Dat is #78, opgelost met een aparte `BACKUP_DATABASE_URL`; het onderliggende besluit staat nog open.

  <details>
  <summary>De oorspronkelijke bevinding</summary>

  **NIEUW 2026-08-04 — de backup mist negen van de achttien tabellen.** Gemeten tegen `mcm2-2026-08-04_05-38-43.dump` met `pg_restore --list`: aanwezig zijn alleen de negen tabellen uit migratie 0000. **Ontbrekend:** `survey_template`, `survey_run`, `survey_response`, `survey_answer`, `survey_attachment`, `survey_category`, `survey_question`, `tenant_membership` en `sessie`.

  Dat is álle vragenlijsten, álle antwoorden, álle geüploade certificaten en het complete rechtenmodel. De dumps van 30 juli, 31 juli en 4 augustus bevatten alle drie exact dezelfde negen tabellen en zijn alle drie exact 21.683 bytes. **Dit is niet nieuw ontstaan — het is er altijd zo geweest**; de identieke bestandsgrootte was het zichtbare symptoom.

  **Oorzaak: Issue #25.** Niet de schemaselectie (`--schema=clm --schema=ref --schema=audit` is correct), maar de migratiestand: `clm-enterprise` heeft de migraties vanaf 0003 nooit gekregen. De dump is een correcte kopie van een database die achterloopt.

  **Gevolg voor de hersteltest van 30 juli** ("dump → restore → 20 van 20 e2e-tests groen"): die draaide tegen negen tabellen en bewees het herstelpád, niet de compleetheid. Faalpatroon §15b — de afwezigheid van een fout is niet de aanwezigheid van een grens.

  </details>

- **ACTIEF (Issue #78) — `FORCE ROW LEVEL SECURITY` blokkeert `pg_dump` voor `clm_migrator`.** Vanochtend nog theoretisch, 's middags acuut: zodra migratie 0011 op productie stond, faalde de dagelijkse backup met `ERROR: query would be affected by row-level security policy for table "audit_event"`. `FORCE` geldt ook voor de tabeleigenaar — dat is de bedoeling ervan, maar `pg_dump` leest zonder tenantcontext.

  **Tijdelijk opgelost** met een eigen `BACKUP_DATABASE_URL` die naar de Supabase-`postgres`-rol wijst (de enige met `BYPASSRLS`). Bewust een aparte variabele: de keuze voor een ruimere rol hoort zichtbaar te zijn in `.env`, niet verstopt in een script.

  **Het besluit staat nog open** (#78): een aparte dumprol, de dump via de eigenaarsrol met een gerichte uitzondering, of dit vastleggen als geaccepteerd restrisico in ADR-011. Nu is het feitelijk het laatste, maar zonder dat het ergens als besluit staat.

  **Twee dingen die dit verscherpt.** De backup hangt nu aan het wachtwoord van de `postgres`-rol — hetzelfde dat in de git-historie van `mvm-api-pilot` staat (#1). Roteren zonder `.env` bij te werken legt de backup stil. En: een halve dump ziet er normaal uit. `backup-dump.js` beschouwt alleen 0 bytes als mislukt; de gefaalde dumps waren 78 kB en dus op het oog prima. De backupcontrole ving dit wél, want die telt tabellen in plaats van bytes — de eerste keer dat hij een echt probleem aantoonde dat anders onopgemerkt was gebleven.

- **2026-08-03/04 — de dagelijkse backup heeft vier dagen stilgelegen** (niet drie, zoals hier eerder stond). Op 1, 2 en 3 augustus faalde de geplande taak, telkens omdat **Docker Desktop niet draaide** om 07:00. De handmatige inhaalpoging van 3 augustus **mislukte eveneens** (`MISLUKT, code 1` in het log). De feitelijke reeks in OneDrive is 31 juli → 4 augustus.

  Dit is Issue #58, maar met een andere oorzaak dan daar beschreven. Het issue gaat uit van "de laptop staat uit"; hier stónd de laptop aan en was Docker nog niet opgestart. Het script waarschuwde keurig in het log — **maar niemand leest dat log.** Vier dagen geen backup zonder dat iemand het merkte.

  **Opgelost op 2026-08-04**, branch `feat/backupcontrole-en-signalering`: een controle die dagelijks draait, vergelijkt met een handgeschreven verwachtingslijst, en via Telegram meldt. Zie hieronder.

- **NIEUW 2026-08-03 — een productiewachtwoord staat in de git-historie van `mvm-api-pilot`.** Gevonden bij het bekijken van `Database/import-mock-data.ts` voor de demo-data: host, gebruiker en wachtwoord van `clm-enterprise` staan daar hardgecodeerd (regels 21-28), en het bestand staat in git. Dat is dezelfde database als waar MCM2 op draait.

  Raakt **Issue #1** (wachtwoordrotatie `postgres`-beheerrol), maar is dringender dan dat issue suggereert: dit is geen hygiënepunt meer maar een gelekt geheim. Rotatie alleen is niet genoeg — het wachtwoord blijft in de historie staan, dus het moet ook daar weg of de rol moet vervangen worden. **Niet aangeraakt in deze sessie**: het is een andere repository en een besluit van de eigenaar.

- **P0 — databaserol/RLS-bereikbaarheid, opgelost op 2026-07-27:** de runtime database-connectie gebruikte de Supabase-rol `postgres` (`rolbypassrls: true`). Nieuwe login-rol `clm_api_runtime` aangemaakt (`LOGIN`, erft van `clm_api`, `rolbypassrls: false`), `DATABASE_URL` in `.env` bijgewerkt. Tussentijdse extra bevinding: geen van de vier `clm_*`-rollen had ooit `USAGE`-rechten op de schemas `clm`/`ref`/`audit` — hersteld via migratie `20260727053702_grant_schema_and_table_privileges`. Zie ADR-008.
- **P0 — migration-rol en geautomatiseerde RLS-test, opgelost op 2026-07-27:** aparte login-rol `clm_migrator` toegevoegd (los van zowel `postgres` als `clm_api_runtime`), rollen-bootstrap vastgelegd in `prisma/roles/bootstrap-roles.sql` (niet in de Prisma-migratiehistorie, want rollen zijn cluster-breed). De handmatige, ad-hoc RLS-verificatie is vervangen door een geautomatiseerde test (`test/tenant-rls-isolation.e2e-spec.ts`), die nu ook in CI draait tegen een ephemere, wegwerpbare Postgres-container (`.github/workflows/ci.yml`, job `rls-isolation`) — bewust niet tegen de echte Supabase-database, om geen productiegeheim als GitHub Secret te hoeven gebruiken. Zie ADR-009 voor de volledige achtergrond, inclusief waarom dit geen Prisma-probleem was (de rolrechten-kwesties tijdens het bouwen hiervan waren PostgreSQL/Supabase-specifiek, los van de ORM-keuze).
- **P0 — opgelost op 2026-07-31 (Issue #7):** tenantcontext kwam blind uit client-input (`X-Tenant-Id`-header of query-parameter), zonder koppeling aan geverifieerde identiteit. **Beide sporen zijn nu dicht.**

  Issue #7 vraagt om **twee gescheiden mechanismen**:
  - **Interne beheerder (spoor 1)** — **gebouwd en bewezen op 2026-07-31.** Besluit: Microsoft Entra External ID als CIAM-laag (ADR-006, herzien op 2026-07-27; AWS Cognito losgelaten vóór er resources waren aangemaakt, dus geen opruimwerk). De federatie-PoC is geslaagd: tenant `mcm2ciam.onmicrosoft.com`, federatie met `alingadvies.nl`, end-to-end doorlopen tot een geldige authorization code. Volledige configuratie: `docs/architecture-review/2026-07-27/01-entra-external-id-poc-bevindingen.md`. De keten `cookie → hash → clm.sessie_oplossen() → tenantId → withTenant()` staat; zie het blok "Beheerkant fase 1" hieronder. **Wat níét bewezen is: de tokenverificatie is nooit tegen de echte Entra-tenant gedraaid.**
  - **Externe leverancier (spoor 2)** — tokengebaseerde, accountloze survey-linktoegang. **Gebouwd op 2026-07-28, CI groen, gemerged op 2026-07-29 (PR #32).** Zie het blok "Aantoonbaar werkend" hieronder voor wat precies bewezen is.

  Het tijdelijke AWS-account `727732213368` is niet langer nodig voor identity.
- **Issue #30 — de provider levert geen backups.** *(Was tot 2026-07-30 de zwaarste blokkade; sindsdien is er een eigen dump. Op 2026-08-04 bleek die dump onvolledig — zie de bevinding bovenaan dit blok.)* Op 2026-07-28 in het dashboard vastgesteld: `clm-enterprise` draait op het **Supabase Free Plan**, dat letterlijk meldt *"Free Plan does not include project backups"*. Niet "beperkte backups" — **geen**. Free-projecten worden bovendien na circa **7 dagen inactiviteit gepauzeerd**, met verwijdering na langere inactiviteit; voor een surveylink die 30 dagen geldig moet zijn is dat op zichzelf al onwerkbaar.

  **Stand 2026-08-04:** er is een eigen dagelijkse dump naar OneDrive én een controle die dagelijks vaststelt of hij actueel en compleet is (`npm run backup:controle`). Wat er níét is: een complete dump, zolang **Issue #25** open staat. De negen tabellen die ontbreken zijn juist de tabellen met het bewijsmateriaal.

  **Blokkeerde #19, #25 en #29** — die wijzigen alle drie de productiedatabase. Sinds er een dump ís, kunnen die heroverwogen worden; #25 is nu juist de eerstvolgende stap, omdat de backup zonder die migraties incompleet blijft.

  **Kostenafweging, met cijfers uit het dashboard:** Supabase Pro (~$25/mnd) geeft dagelijkse backups — te grof voor de pilotnorm van 1 uur uit ADR-011. Point-in-Time Recovery is daar een add-on van **$100/mnd bovenop Pro**. Op 2026-07-28 is gemeten dat **Neon** hetzelfde biedt voor ~$10–20/mnd (7-daags PITR-venster binnen het plan). Zie het volgende punt.

  **BESLUIT EIGENAAR 2026-07-28: de pilot draait op Supabase Free**, met bewust geaccepteerde risico's. Vastgelegd in ADR-011, sectie "Risico-acceptatie Free Plan", inclusief de voorwaarden waaronder dit verdedigbaar is en wanneer het besluit opnieuw op tafel moet. De pilotnorm is daarmee feitelijk **24 uur dataverlies mits de dagelijkse dump draait — en oneindig zonder**.

  **Mitigatie is gebouwd, niet alleen beschreven:** `npm run backup:dump` (`scripts/backup-dump.js`) draait `pg_dump` via de container `postgres:17.6`, bewaart 14 dagen, ruimt ouder op, behandelt een lege dump als mislukking, en **waarschuwt als de vorige dump ouder is dan 36 uur** — de enige signalering dat de geplande taak heeft stilgelegen. Getest tegen `clm-enterprise` (21,2 kB in 9,8s) én aantoonbaar herstelbaar: dump → restore → rechten → defaults → **20 van 20 e2e-tests groen**. Inplannen via Taakplanner: runbook stap 0.

  **INGERICHT OP 2026-07-30 — beide openstaande punten gedaan.** De Windows-taak `MCM2 databasebackup` draait dagelijks om 07:00 en schrijft naar OneDrive (`C:\Users\cmali\OneDrive - Aling Advies\MCM2-backups`), dus de dump staat niet alleen op de laptop. Aantoonbaar via Taakplanner gedraaid, met dump én `GESLAAGD`-regel in het log als bewijs (21,2 kB in 4,8s).

  Daarmee gaat #30 van **nul backups** naar **meestal dagelijks**, tegen nul kosten. De keuze voor een betaalde oplossing (Supabase Pro of Neon) blijft open en is niet langer dringend.

  **Twee valkuilen sloegen daadwerkelijk toe** en staan in het runbook, want ze kosten anders opnieuw een half uur: (1) de directe aanroep via `cmd.exe /c` meldde `LastTaskResult = 0` terwijl er geen dump kwam — `cmd.exe` geeft 0 zodra het zélf kon starten. Precies de faalvorm waar het runbook voor waarschuwt. Opgelost met `scripts/backup-taak.cmd`, dat de echte exitcode doorgeeft en altijd logt. (2) Datzelfde `.cmd`-bestand in UTF-8 is onleesbaar voor `cmd.exe`; het moet ASCII blijven.

  **Bewust geaccepteerde beperking (Issue #58):** de taak draait alleen als de laptop aanstaat. `-StartWhenAvailable` haalt een gemiste run in, maar bij langere afwezigheid valt er een gat — en Supabase pauzeert Free-projecten na circa 7 dagen. Dat geeft géén foutmeldingen; het script waarschuwt in het log zodra de vorige dump ouder is dan 36 uur. Vóór de pilotstart (rond 1 september) hoort dit naar de thuisserver, GitHub Actions of Supabase Pro.
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

- **Omgevingsdrift wordt gemeten (2026-08-04, `verify:volledig` stap 5).** De doorloop toetst read-only of de omgevingen uit `.env` het schema hebben dat de code verwacht. Bewust **niet rood**: een omgeving die achterloopt is een bevinding, geen bewijs dat de code stuk is — en het commando draait ook op machines zonder productietoegang.

  **Waarom dit er is.** Alle 269 e2e-tests draaien tegen een verse wegwerpdatabase die vanaf niets met de migraties is opgebouwd. Dat is de juiste keuze, maar het bewijst dat de migraties correct *zijn*, niet dat ze ergens zijn *toegepast*. Precies dat gat liet `clm-enterprise` vijf dagen op negen tabellen staan. Zie MCM2-CLAUDE.md §15b, vierde les.

  **Tegenproef geslaagd:** een container met de oude 9-tabellendump wordt aantoonbaar als afwijkend gemeld (`DRIFT_TOETS_LOKAAL=1` heft het localhost-filter op).

  **En de stap legde meteen een fout in zichzelf bloot.** Bij de eerste volledige doorloop meldde hij "niet ingesteld — overgeslagen" terwijl `.env` wel een `DATABASE_URL` heeft: `verify-volledig.js` laadt bewust geen `dotenv`. Een controle die stil overslaat wekt de indruk dat er iets gemeten is — hij zou in die vorm nooit drift hebben gevonden. Opgelost met `processEnv: {}`, geverifieerd dat er niets doorlekt naar stap 1.

  **Volledige doorloop daarna groen**, inclusief 25 browsertests tegen de stack ná de migraties van vanmiddag.

- **De backupcontrole (2026-08-04, branch `feat/backupcontrole-en-signalering`).** Drie lagen: is er een dump jonger dan 36 uur (A), zit alles erin wat erin hoort (B), komt het er na een echte restore ook weer uit (C). Draait als aparte taak, los van de backup zelf — als de backup helemaal niet draait, waarschuwt die ook niet.

  **Getest tegen de werkelijke situatie, niet tegen een fixture:**
  - Laag B vindt exact de negen ontbrekende tabellen in de productiedump.
  - Laag C bevestigt dat onafhankelijk via een echte `pg_restore`: 9 van 18 teruggezet.
  - Groene pad geverifieerd tegen een complete dump van de demo-database (89 kB tegenover 21 kB): 18/18 compleet én herstelbaar.
  - Demping getest: tweede run binnen 48 uur stuurt niets. Escalatie na 48 uur geeft één laatste bericht. Herstelbericht ruimt het statusbestand op.
  - "Onbekende tabel"-melding getest door een tabel uit de verwachtingslijst te halen.

  **De verwachtingslijst is handgeschreven** (`docs/runbooks/backup-verwachting.json`) en wordt bewust níét uit de migraties afgeleid. Zou hij dat wel zijn, dan verifieert de controle zichzelf: bij een achterlopende migratiestand verwacht hij precies de verkeerde dingen en meldt hij niets. Dat is exact hoe de fout van 4 augustus onzichtbaar bleef.

  **Ingericht en werkend op 2026-08-04.** Beide taken staan in Taakplanner en zijn aantoonbaar *via Taakplanner* gedraaid — niet alleen handmatig:

  | Taak | Trigger | Bewijs |
  |---|---|---|
  | `MCM2 backupcontrole` | dagelijks 07:30 | log 11:15:43, "PROBLEEM GEMELD, code 1" |
  | `MCM2 backupcontrole volledig` | maandag 07:45 | log 11:16:17, restore uitgevoerd, 9 van 18 |

  Het testbericht is in Telegram aangekomen (bevestigd door de eigenaar). De credentials komen uit `~/saxo/.env` op `192.168.3.200` — bestaande Saxo-bot, geen aparte MCM2-bot, want dit gaat uiteindelijk naar Slack.

  **Let op bij het controleren:** `LastTaskResult = 0` bewijst niets — dat betekent alleen dat `cmd.exe` kon starten. Het log is het bewijs. Dat is dezelfde valkuil die op 2026-07-30 bij de backuptaak toesloeg.

- **De actor-grens (2026-08-03, migratie 0013, PR #73).** De database kan onderscheid maken tussen een medewerker en een leverancier van dezelfde tenant. `withTenant()` zet naast de tenant nu ook `app.current_actor`, gelezen via `clm.current_actor()`; niet gezet betekent `onbekend`, de striktste stand.

  **269 e2e-tests groen in 20 suites** plus **161 unittests**, tegen een database die vanaf niets is opgebouwd met migraties 0000 t/m 0013. Vier leverancierspaden geven `leverancier` door, twaalf medewerkerspaden `medewerker` — geverifieerd na afloop, niet aangenomen.

  **Eerlijk over wat níét bewezen is:** er is nog geen policy die de actor gebruikt. Deze migratie verandert bewust geen gedrag; wat hier bewezen is, is uitsluitend dat de waarde correct in de database aankomt en per transactie geïsoleerd blijft. De eerste policy die erop leunt is migratie 0014 (`survey_review`), en die bestaat nog niet.

  Dat is precies waarom de derde tegenproef groen bleef — zie de sectie hieronder over migratie 0013.

- **Beheerkant fase 1 — de tenantgrens is dicht (2026-07-31, branch `feat/identiteit-en-membership`).** De laag die ontbrak is er:

  ```
  cookie  →  hash  →  clm.sessie_oplossen()  →  tenantId  →  withTenant()
  ```

  **205 e2e-tests groen in 15 suites** (was 184) plus **158 unittests** (was 105), tegen een database die vanaf niets is opgebouwd met migraties 0000 t/m 0010. Format, lint (0 errors) en typecheck schoon. `npm audit --omit=dev` blijft **0** — `cookie-parser` voegde niets toe.

  Nieuw in `src/auth/`: `TenantContextGuard` (401 bij geen, onbekende of verlopen sessie), `SessieService` (de enige route naar `clm.sessie`), `inlogpoging.ts` (PKCE S256 plus state tegen CSRF), en de drie routes `/auth/login`, `/auth/callback`, `/auth/logout`.

  **Drie keuzes die uitleg verdienen:**
  - **De OIDC-configuratie wordt lui gelezen, niet in de constructor.** In de constructor zou een ontbrekende variabele de héle applicatie onstartbaar maken — ook de e2e-suite en de leverancierskant, die geen identity nodig hebben. De harde fout blijft: `/auth/login` geeft 500 met alle zes ontbrekende variabelen bij naam.
  - **Het cookie is `httpOnly` en standaard `Secure` met `__Host-`-prefix.** Alleen een expliciete opt-out (exact `'true'`) zet Secure uit voor lokaal http; de naam valt dan mee terug, want de browser weigert `__Host-` zonder Secure.
  - **`sameSite` is `'lax'`, niet `'strict'`.** Bij `'strict'` stuurt de browser het cookie niet mee na de terugkeer van de provider, en is de gebruiker na een geslaagde login alsnog uitgelogd.

  **`X-Tenant-Id` verwijderen bleek niets te verwijderen.** De header bestaat nergens in `src/` of `test/` — hij ging mee met de weggegooide branch `feat/fase0-skeleton-vendors`. De stap veranderde daarmee van vorm: van iets weghalen naar **bewijzen dat er geen tweede pad is**. Elke `withTenant()`-aanroep krijgt zijn tenantId van `SurveyTokenGuard`, van `TenantContextGuard`, of van het seed-script waar een beheerder de tenant zelf meegeeft.

  **De tegenproef vond een echt gat.** Met een terugval op de `X-Tenant-Id`-header ingebouwd bleven alle 18 guard-tests groen: de test die een meegestuurde tenant hoorde te negeren stuurde namelijk een *geldig* cookie mee, dus de terugval kwam nooit aan de beurt. Een verzoek met alléén een header zou er zo doorheen zijn gekomen. Drie tests toegevoegd; daarna faalde de sabotage wel. Een tweede sabotage (verloopcontrole eruit) liet negen tests omvallen, waaronder `permission denied` op een directe `SELECT` — dat herbewijst dat de deur naar `clm.sessie` dicht zit.

  **Geverifieerd in het productie-image, niet alleen in de build:** modules laden op Node v24.18.1 (inclusief de `jose`-keten), `/health` 200, `/auth/logout` 302, `/auth/login` 500 met de verwachte configuratiemelding.

  **Eerlijk over wat níét bewezen is:** er is nog geen beheerroute die de guard gebruikt — die komen in fase 2. En de tokenverificatie is nooit tegen de echte Entra-tenant gedraaid; de claims blijven een verwachting.

  **Bevinding die tijd kostte:** Jest draait suites parallel, en de UUID-reeksen `c1`/`c2` en `d1`/`d2`/`d3` waren al in gebruik. Twee suites ruimden elkaars tenant op, met een foutmelding over een foreign key op `vendor` — ver van de oorzaak. Staat in de test.

- **Identiteit, membership en sessies (2026-07-30, branch `feat/identiteit-en-membership`, migraties 0009 en 0010).** **184 e2e-tests groen in 14 suites** plus **105 unittests** — geverifieerd tegen een verse Postgres 17.6 met de volledige keten 0000 t/m 0010, en daarna nog een keer volledig vanaf niets.

  **Drie besluiten van de eigenaar op 2026-07-30**, alle drie in de database vastgelegd:
  - **Eén actief membership per gebruiker**, afgedwongen met een partiële unieke index. Alleen platformbeheer heeft meerdere tenants nodig, en dat is een ánder soort toegang: support bij een klant hoort auditbaar te zijn, niet ononderscheidbaar van een medewerker van die klant. Welk patroon daarvoor juist is (impersonation, break-glass, aparte identiteitslaag) is uitgezocht werk — **Issue #57**. Weghalen is later één `DROP INDEX`.
  - **Sessies in de database, niet in het geheugen.** Geheugen betekent iedereen uitgelogd bij elke herstart — ook bij een gewone deploy — en het breekt zodra er een tweede container draait, wat de beoogde uitrolvorm is (ADR-012).
  - **Glijdend venster van 8 uur; uitloggen verwijdert de rij.** Wie wat deed staat al in de audit trail; inlogpatronen bewaren is een persoonsgegeven met een bewaartermijn die niemand gaat bewaken.

  **`clm.sessie` is de enige tenantgebonden tabel zónder RLS**, en dat is een bewuste uitzondering op §7.4 — geen vergissing. De sessie wordt opgezocht vóórdat de tenantcontext bestaat, want de tenant vólgt eruit; een policy op `current_tenant_id()` zou structureel nul rijen geven en elke login onmogelijk maken. Zelfde kip-ei-probleem als bij `gebruiker_bij_subject()`.

  De bescherming is daarom niet zwakker maar anders: **`REVOKE ALL` op de tabel**, alle toegang via drie `SECURITY DEFINER`-functies. De uitzondering staat expliciet in `src/db/schema-inventory.ts` (`RLS_UITZONDERINGEN`) met motivatie, en **drie tests bewaken hem**: de lijst mag niet groeien, elke uitzondering moet volledig afgesloten zijn voor de runtime-rol, en een directe `SELECT`/`INSERT` moet "permission denied" geven. Tegenproef gedaan: met rechten toegekend aan `clm_api` vielen exact die twee deur-tests om.

  **Vier bevindingen die het bouwen blootlegde, geen ervan beredeneerd:**

  1. **`CHECK (verloopt_op > aangemaakt_op)` was te streng.** Leek redelijk, maar blokkeerde het *intrekken* van een lopende sessie — precies wat je wilt kunnen bij een gestolen laptop. Verwijderd; het scenario dat hij moest afvangen wordt afgevangen in `sessie_aanmaken()`.
  2. **De conformiteitstest had een gat.** Die las uit `information_schema`, dat alleen toont waar de huidige rol rechten op heeft. `clm.sessie` viel daardoor stilzwijgend buiten de controle — precies het soort gat waar Issue #29 door kon ontstaan. Overgezet naar `pg_tables`/`pg_attribute`; die test dekt nu méér dan voorheen.
  3. **De RLS-tegenproef gaf eerst een misleidend resultaat.** Met `WITH CHECK` uit de policy bleven alle tests groen: PostgreSQL valt dan terug op `USING` om schrijfacties te toetsen. Pas met `USING (true)` plus strenge `WITH CHECK` viel de juiste verdeling op — vier leestests op `USING`, de schrijftest op `WITH CHECK`. Vastgelegd in de test.
  4. **`jose` 6 is ESM-only en dit project compileert naar CommonJS** — dezelfde combinatie waarop Prisma 7 hier stukliep (§5). Opgelost met `transformIgnorePatterns` voor Jest: standaard configuratie, geen experimentele Node-vlaggen. **En geverifieerd waar het telt:** in het productie-image zelf laadt en werkt `jose` (Node v24.18.0 — `require()` van ESM kan sinds Node 22). Een geslaagde `nest build` bewijst dat niet. **Let op bij een Node-downgrade:** zakt de base-image naar Node 20, dan breekt het inloggen in productie terwijl build en tests groen blijven. Staat in `src/auth/README.md`.

  **Eerlijk over wat níét bewezen is:** de tokenverificatie is nooit tegen de echte Entra-tenant gedraaid. De claims uit de PoC-bevindingen (`email`, `sub`, `oid`, `tid`) zijn nog steeds een **verwachting, geen meting**. De code koppelt op `oid` — stabiel per tenant, anders dan `sub` (per applicatie verschillend) en `email` (verandert). Dat is de juiste keuze volgens de Microsoft-documentatie, maar bevestig het bij de eerste echte login.

- **CSV-parser voor leveranciersimport (2026-07-30, PR #55).** `src/vendor/` — leest een bestand, meldt per rij wat er mis is, **schrijft niets weg**. Dat laatste is bewust: wegschrijven vraagt een geverifieerde tenantcontext (#7), en zonder die context weet een schrijfroute niet namens wie hij schrijft.

  Onderscheid **blokkerend** (naam ontbreekt, dubbel in bestand) versus **waarschuwing** (KvK niet 8 cijfers, e-mail zonder apenstaartje, impactwaarde onbekend, bedrag geen getal). Dat is de kern: een fout KvK-nummer is achteraf te corrigeren, een ontbrekende naam niet. Regelnummers verwijzen naar wat de gebruiker in Excel ziet, en een dubbelmelding zegt wáár het duplicaat staat.

  Tegen `db/seeds/voorbeeld-leveranciers-coupa.csv`: 28 rijen, 26 importeerbaar, 2 geblokkeerd, 3 met waarschuwing, en één gemelde onbekende kolom.

  **58 unittests — de eerste echte unittestlaag in dit project** (gevraagd in #54). `npx jest` rapporteert 59: die ene extra is de bestaande `app.controller.spec.ts`. Tegenproef: ontsnapping van aanhalingstekens eruit → 2 rood; dubbelsleutel van KvK-eerst naar alleen-naam → 1 rood.

  **Eigen CSV-lezer, niet die van MVM_V2.** Die wisselt `inQuotes` bij élk aanhalingsteken en kapt `Jansen "De Bouwer" B.V.` af. Deze leest ontsnapte aanhalingstekens, regeleinden binnen een veld, CRLF/LF door elkaar, en raadt het scheidingsteken — alle vier Transdev-specificatiebestanden in MVM_V2 gebruiken puntkomma's, want zo schrijft Nederlandse Excel.

  **Let op — het voorbeeldbestand is zelf samengesteld.** Er staat geen echte Coupa-export in MVM_V2; het bestand is afgeleid uit `vendors.mock.ts`. De kolomkoppen zijn dus een **aanname** over wat Transdev levert. Aanpassen is één tabel wijzigen (`KOLOM_ALIASSEN`), niet de code eromheen.

- **UC1 volledig afrondbaar in de browser (2026-07-30, MCM2-frontend PR #1).** Zie het frontend-blok hierboven: `/questions` 200 → `/attachment` 201 → `/respond` 200 → tweede poging 410, gemeten tegen de productie-images. Issue #42 en #43 gesloten.

- **OTAP-doorloop t/m indienen en upload (2026-07-29, tweede doorloop).** Uitgebreid van 8 naar **21 controles** in negen stappen; `scripts/otap-doorloop.js` dekt nu ook de vragenlijst, de validatie, de bestandsupload en het indienen. **Vier keer gedraaid, vier keer geslaagd** — waarvan één keer volledig vanaf niets na `down -v`.

  **De volledige keten is in de browser bewezen:** het portaal toont de echte negen Transdev-vragen uit de database met de MVM_V2-huisstijl, en vanuit diezelfde pagina levert upload → 201 en indienen → 200. De 404 die de vorige doorloop signaleerde is weg.

  **Drie bevindingen die geen enkele test zag:**

  1. **Élke upload faalde in het productie-image** — `EACCES: permission denied, mkdir '/app/var'`. Het image draait als non-root, maar `/app` is eigendom van root. De e2e-tests misten dit omdat die met `UPLOAD_DIR` naar een tijdelijke map draaien. Gerepareerd in de `Dockerfile`: map aanmaken en overdragen vóór `USER node`, `UPLOAD_DIR` expliciet in het image, plus een `VOLUME`-declaratie als waarschuwing bij uitrol.
  2. **Het opruimblok van het doorloopscript was niet meer idempotent** zodra er echt ingediend werd — `ON DELETE RESTRICT` blokkeerde het verwijderen van een respons met antwoorden. Dat de constraint in de weg zat, is het bewijs dat hij werkt.
  3. **De seed vraagt een bestaande tenant** op een verse database. Toegevoegd als stap 3b in het runbook.

  **Twee frontend-bevindingen, vastgelegd als Issue #42 en #43 — beide gesloten op 2026-07-30** (MCM2-frontend PR #1): het portaal kon geen bestanden uploaden (waardoor een leverancier UC1 niet via de browser kon afronden — de backend kon het wél), en het rendeerde het `instruction`-leesblok als een vraag met keuzerondjes. Beide met de browser vastgesteld, niet beredeneerd. **Dat geen van beide door een test gevonden is, was de aanleiding voor #47** — de eerste browsertest.

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

  *Deze notitie beschrijft de stand op 2026-07-29, toen het portaal nog op mock data draaide.* De mock/live-schakelaar bestaat nog steeds en is nuttig om schermen zonder backend te beoordelen — maar sinds 2026-07-30 werkt het portaal ook volledig tegen de echte backend. Zie het frontend-blok bovenaan.

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

**Bijgewerkt 2026-07-30: het vendorspoor is nu wél gestart, contracten nog niet.** De eigenaar heeft leveranciersbeheer als volgend spoor gekozen (aanmaken en importeren). Dat verandert het besluit hierboven niet — contracten blijven een eigen bouwspoor met eigen intake — maar het maakt één vondst uit die inventarisatie belangrijk:

**De tabellen bestonden al.** `clm.vendor` (25 kolommen, met RLS), `clm.vendor_contact`, `clm.vendor_tag` en drie `ref.*`-tabellen stonden er al, overgenomen uit `mvm-api-pilot/Database/migrations/004_clm_vendor.sql`. Wat ontbrak was niet het datamodel maar de laag erboven: geen `src/vendor/`-module, geen routes, geen scherm. Tot 2026-07-30 schreven alleen testscripts er rechtstreeks via SQL in.

**Twee dingen die de C#-pilot wél heeft en MCM2 niet:** `vendor_address` (adressen genormaliseerd in een eigen tabel) en `parent_vendor_id` (holdingstructuur). Geen van beide is nu nodig; wel goed om te weten dat de bron ze heeft.

## Externe architectuurreview — ontvangen 2026-07-29, omgezet in negen issues

Op verzoek van de eigenaar is de volledige architectuur, OTAP-straat en teststrategie ter review aangeboden aan een tweede AI-model. Beide documenten staan in `docs/architecture-review/`:

| Document | Wat |
|---|---|
| `2026-07-29/00-review-aanvraag-architectuur-otap-tests.md` | de aanvraag, 1027 regels, zelfstandig leesbaar, met negen vragen die elk om een beslissing vragen |
| `External-2026-07-29-mcm2-architectuurreview-otap-tests.pplx.md` | het antwoord |

Alle negen vragen zijn beantwoord, met het gevraagde sjabloon per bevinding: ernst, onderbouwing, aanbeveling, kosten van niets doen, en **zekerheid** (zeker/waarschijnlijk/vermoeden). Dat laatste veld bleek het nuttigst — het is eerlijk gebruikt, niet alles staat op "zeker".

**Omgezet in negen issues (#46 t/m #54).** Drie als pilotblokkade:

| # | Wat |
|---|---|
| **#46** | duurzame objectopslag voor uploads + dump buiten de brondraaimachine — **harde datum: pilot rond 1 september** |
| **#47** | Playwright-browsertest van de volledige UC1-flow — gedeeltelijk af, zie frontend-blok |
| **#48** | pilot-runbook en alerting: wie kijkt wanneer naar welk signaal |

Vijf voor productie (#49 quotarij voor `max_files`, #50 vergrendeling bewijzen, #51 frontend-image promoveerbaar, #52 virusscan-restrisico vastleggen, #53 OTAP-doorloop automatiseren) en één later (#54 unittestlaag — daarvan is de eerste laag geleverd in PR #55).

### Waar de review mij corrigeerde, en gelijk had

- **Waarneembaarheid was te licht ingeschat.** Ik had geen logging/monitoring als "kleiner punt" weggezet; de review tilt het naar blokkerend. Het argument snijdt hout: een stille storing blijft dagenlang onopgemerkt bij een link met 30 dagen geldigheid.
- **Mijn eigen vraagstelling over `NEXT_PUBLIC_API_URL` was fout.** Ik zette twee opties tegenover elkaar; de review draagt een derde, betere aan (server-side runtime-config of same-origin proxy) zonder extra publiek endpoint. Zie #51.
- **Virusscanning stond te hoog in mijn lijst.** Ik noemde zelf drie compenserende controles en concludeerde toch "het is niet nul", zonder te vragen of nul nodig is vóór een pilot met bekende leveranciers. Zie #52.
- **Het CREATE ROLE-risico overschatte ik.** Op Amazon RDS heeft `rds_superuser` gewoon `CREATEROLE`. Het risico is reëel bij bepaalde serverless Postgres-aanbieders, niet bij de RDS-route die ik zelf als doel noem.
- **De concurrency-aanpak bij `max_files` was te zwak.** Een kale trigger met `COUNT(*)` lost de race niet op — twee uploads passeren allebei vóór elkaars commit. Zie #49 voor twee uitgewerkte routes; de quotarij met atomaire `UPDATE ... WHERE used_files < max_files RETURNING` is de betere.

### Eén reviewbevinding is nagerekend en vervallen

Vraag 5 beval een e2e-test aan voor de UC2-tokenlookup over HTTP, met als onderbouwing dat die dekking ontbrak. **Die aanname is onjuist**: `test/vragenlijst-ophalen.e2e-spec.ts` regel 437 en 465 doen dit al, beide via `request(server)` door de guard heen. De eerste is de regressietest voor de 0008-bug, de tweede sluit af dat "join op `subject_vendor_id`" niet stilzwijgend "controleer niets meer" gaat betekenen.

De reviewer kon dit niet zien: de testbestanden zaten niet in Bijlage A, alleen een tabel met testtellingen. Dit stond op zekerheid **waarschijnlijk**, en het is het enige van de negen antwoorden dat op een aanname over niet-meegeleverd materiaal rustte — en het enige dat bij narekenen sneuvelt. Vastgelegd in #24.

Wat er van vraag 5 wél overblijft staat als later-item in #24: een expliciete `respondent_type`-kolom zodra een derde use case ontstaat waarin deelnemer en onderwerp niet meer via `vendor_id IS NULL` te onderscheiden zijn.

## Lessen uit deze sessies die tijd besparen

Praktische valkuilen die daadwerkelijk zijn tegengekomen, niet bedacht. Ze staan hier omdat ze anders opnieuw ontdekt worden.

**Een regel die met geen enkele test rood te krijgen is, hoort weg — niet een derde test.** In `csv-lezer.ts` stond een losse BOM-verwijdering. Die bleek overbodig: `.trim()` op de koppen haalt U+FEFF in JavaScript óók weg. Er zijn twee tests geschreven om het mechanisme aan te tonen; beide bleven groen met de regel eruit. Toen is de regel verwijderd in plaats van een derde poging te doen. **Een regel die niets doet is erger dan geen regel**, want de volgende lezer denkt dat het probleem daar wordt afgehandeld. Kostte drie omwegen; het alternatief was code committen met een bewering die niet aantoonbaar was.

**Een test die het juiste antwoord geeft, kan nog steeds het verkeerde meten.** Twee keer op één dag tegengekomen. In de browsercontrole zocht een assertie de naam van de vragenlijst in de koptekst in plaats van de titel van het leesblok — die faalde terwijl de code goed was. En `getByText(/al ingediend/i)` matchte twee elementen, want die tekst staat ook in de melding van de backend eronder. Beide keren was de fix in de test, niet in de code. Bij een falende assertie: kijk eerst wát er gemeten wordt.

**`drizzle-kit` genereert migraties die op een gevulde database falen.** Bij `subject_vendor_id` produceerde het `ADD COLUMN ... NOT NULL`, wat alleen op een lege tabel slaagt. Elke nieuwe verplichte kolom vraagt handmatig de drie-stappenvorm: kolom toevoegen → backfillen → `SET NOT NULL`. Controleer dit bij **elke** gegenereerde migratie.

**PostgreSQL weigert `CREATE OR REPLACE FUNCTION` als de `RETURNS TABLE` wijzigt.** Dan is `DROP` + `CREATE` nodig — en **na een `DROP` zijn de rechten weg**, want die hangen aan het functie-object en niet aan de naam. Zonder een herhaalde `GRANT` werkt er niets meer. Zie migratie 0006.

**Groene tests bewijzen niets tot je ze hebt zien falen.** Bij stap 2 zijn de zes nieuwe tests gecontroleerd door de controle tijdelijk te verwijderen: vijf vielen om, één niet. De eerste poging daartoe mislukte bovendien stil (een regex die niet matchte), waardoor de "proef" niets toetste. Doe die tegenproef expliciet.

**`NEXT_PUBLIC_*` wordt tijdens de build ingebakken, niet bij het starten gelezen.** Een frontend-image dat de echte backend moet gebruiken heeft die waarde nodig als **build-argument**. Zet je hem als `environment`, dan draait de app stilzwijgend op mock data terwijl je denkt dat hij live is. De OTAP-doorloop controleert hierop.

**De tenantcontext heet `app.current_tenant_id`, niet `app.tenant_id`.** Het seed-script gebruikte de verkeerde naam. Dat geeft **geen foutmelding** — `set_config` accepteert elke sleutel — maar een lege context, waarna RLS elke INSERT weigert met "new row violates row-level security policy". Gebruik altijd `setTenantContext()` uit `src/db/schema.ts` als bron; scripts die hun eigen `set_config` schrijven, moeten die naam letterlijk overnemen.

**Drizzle verpakt databasefouten: een triggermelding staat in `cause`, niet in `message`.** Een test die met `rejects.toThrow(/bevroren/)` op `message` matcht, wordt daardoor óók groen bij een tikfout in de SQL — dan test hij niets. Lees `(fout as Error & { cause?: Error }).cause?.message`.

**Testsuites die dezelfde tenant-id gebruiken botsen bij de tweede run.** Templates zijn uniek op `(tenant_id, name, version)` en de lokale testdatabase blijft staan. **Sinds 2026-07-31 deelt `test/test-ids.ts` de id's uit, per suite een eigen blok, en bewaakt `test/test-ids.spec.ts` dat er geen dubbelen ontstaan** — inclusief een controle dat geen suite een id hardcodeert langs het register heen. Een nieuwe suite voegt daar een blok toe en gebruikt `TEST_IDS['naam']`; zelf een UUID kiezen faalt de unittest. Geef testtemplates daarnaast een unieke versie in plaats van een vast nummer.

**Docker 29 weigert een containernaam van één teken.** Het oude `--name t` uit dit document faalde met "Invalid container name"; de opstartcommando's hierboven zijn gecorrigeerd naar `mcm2test`.

**Een tegenproef kan zélf onvoldoende zijn — controleer of de testopzet het lek kán zien.** Bij stap 5 is het lek uit ontwerp §1c daadwerkelijk ingebouwd (filteren op `subject_vendor_id` in plaats van `response_id`) en **bleef alles groen**. Oorzaak: elke leverancier in de test had een eigen vendor, dus de verkeerde filter selecteerde toevallig dezelfde rij. Pas met **twee responses over dezelfde leverancier** — het echte UC1/UC2-scenario — viel testpunt 39 om. Een tegenproef die niet faalt betekent dus niet automatisch dat de code goed is; het kan ook zijn dat de opzet het probleem niet kan aantonen.

**Een race is niet uit te lokken met twee gewone requests of twee service-aanroepen.** Bij stap 8 zijn drie testopzetten geprobeerd om te bewijzen dat een `FOR UPDATE` nodig was: supertest via `Promise.all`, de service rechtstreeks, en een handmatig vastgehouden transactie. **Alle drie bleven groen mét de vergrendeling verwijderd.** Twee transacties via dezelfde pg-`Pool` komen achter elkaar aan de beurt zodra de eerste zijn connectie teruggeeft. Wie een vergrendeling echt wil toetsen heeft twee losse verbindingen én een wachtpunt binnen de transactie nodig — en dat kost een haak in productiecode. De les: **stel de claim bij naar wat de test aantoont**, in plaats van de test te laten suggereren dat een mechanisme bewezen is.

**Drizzle geeft een JS-array door als `record`, niet als `text[]`.** Een `INSERT` in een array-kolom faalt met "column X is of type text[] but expression is of type record". Werkende vorm: `ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(waarden)}::jsonb))`. Zelf een array-literal opbouwen kan ook, maar vraagt quoting van komma's, aanhalingstekens en accolades die in de waarden kunnen voorkomen — precies waar een injectiefout in sluipt.

**Een nullable kolom maken raakt méér dan de tabel.** Migratie 0005 maakte `survey_response.vendor_id` nullable voor UC2, maar `resolve_survey_token()` joinde daar nog op — waardoor elke interne beoordeling 410 gaf. Bij het versoepelen van een kolom hoort een zoektocht naar elke plek die hem gebruikt: functies, views, policies. `grep -rn "vendor_id" drizzle/` had dit gevonden.

**Bouw je een grens in twee stappen, dan is stap één onbewaakt tot stap twee er is.** Migratie 0013 voegt `app.current_actor` toe zonder één policy die hem gebruikt — bewust, zodat hij apart groen kan zijn. Gevolg: het leverancierspad zich laten voordoen als medewerker liet **alle 268 tests groen**. Terecht, want er viel niets te meten. En tegelijk het gevaarlijkste moment: precies het venster waarin iemand een nieuwe route bouwt en de actor van het verkeerde voorbeeld overneemt. **Hoort in stap één een test die de afspraak zélf bewaakt** — desnoods door de broncode te lezen, zoals `actor-context.e2e-spec.ts` en `test-ids.spec.ts` doen. Wachten tot stap twee betekent dat de fout er ondertussen in kan sluipen.

**Een lang script hoort zijn goedkoopste controle als eerste te doen.** `verify:volledig` strandde twee keer op een bezette poort 5001/3000 — beide keren pas ná stap 1, die minuten duurt inclusief een wegwerpdatabase en 269 tests. De controle die het had voorkomen kost 2,5 seconde. Bijkomend: die poorten werden ook gebruikt om te bepalen óf de stack gezond was, dus een draaiende dev-server maakte de doorloop niet alleen traag maar ook onbetrouwbaar. **Vraag bij elke voorwaarde: wat kost het om dit vooraf te controleren, en wat kost het als het pas halverwege blijkt?**

**Een test die een extern proces start, past zelden binnen de standaard 5 seconden.** `demo-seed.e2e-spec` viel reproduceerbaar om op een timeout omdat hij het seed-script twee keer als apart Node-proces draait (~1,6 s per keer, gemeten). Binnen de volledige suite — twintig suites parallel — was dat structureel te krap. De foutmelding wees naar hashing terwijl er niets mis was met hashing, dezelfde verwarrende faalvorm als de botsende test-id's. **Meet wat de test doet en geef hem een limiet die daarbij past, met de reden erbij.**

## Niet als bewezen beschouwen

- RLS-tenant-isolatie was tot 2026-07-27 niet bewezen zolang de runtime-role nog `BYPASSRLS` had — een eerdere "RLS werkt"-verificatie in deze projectgeschiedenis was vals-positief (lege tabel, geen bewijs van daadwerkelijke blokkade). **Nu aantoonbaar bewezen én geautomatiseerd** (zie hierboven en ADR-009) — niet langer een handmatige, ad-hoc verificatie.
- Elke aanname uit `docs/context/PROJECT-HISTORY-2026-07-24.md` die alleen op historische sessienotities berust: **historisch gemeld; opnieuw verifiëren bij de volgende technische fase.** Dit geldt met name voor:
  - de exacte Prisma-7-generatorinstellingen (voorwaardelijk aan een ORM-keuze die nog niet definitief is);
  - of het `mvm-api-pilot`-wachtwoordlek inmiddels is opgelost (nooit definitief bevestigd);
  - de exacte Supabase-tier/backup-garanties (nooit expliciet geverifieerd, zie ADR-002).

## Huidige branch en Git-status

**Stand op 2026-08-04, ochtend** (geverifieerd met `git status` en `git branch -a`):

| Repo | Branch | Werkboom | Gepusht |
|---|---|---|---|
| MCM2 | `main` | schoon, op `c87c7a6` | ja |
| MCM2 | `docs/beheermenu-tenantinstellingen` | 1 commit vóór `main` | **nee** |

**Eén openstaande branch:**

- **`docs/beheermenu-tenantinstellingen`** (`de00294`) — ontwerp voor het beheermenu (gebruikers en rechten, SMTP per tenant, uitnodigingen versturen). Alleen documentatie, backlog: #75, #76, #77. Nog niet gepusht.

**Gemerged op 2026-08-04**, alle drie daarna lokaal én op GitHub verwijderd:

- `docs/actorgrens-en-testaantallen` → `c088bf9`
- `feat/backupcontrole-en-signalering` → `34c807a`
- `feat/baseline-convergentie` → `415e069` (migratie 0014, runbook, backupfix #78)
- `chore/omgevingsdrift-in-verify` → `c87c7a6` (stap 5 in `verify:volledig`)

**Gemerged op 2026-08-04, beide daarna lokaal én op GitHub verwijderd:**

- `docs/actorgrens-en-testaantallen` → merge-commit `c088bf9`
- `feat/backupcontrole-en-signalering` → merge-commit `34c807a`, vier commits (controle, STATUS-correcties, Slack-besluit, inrichtingsbewijs)

<details>
<summary>Vorige stand (2026-07-30, einde tweede sessie)</summary>

| Repo | Branch | Werkboom | Openstaande PR's |
|---|---|---|---|
| MCM2 | `feat/identiteit-en-membership` | schoon, 3 commits vóór `main` | geen — nog niet gepusht |
| MCM2-frontend | `main` | schoon | geen |

</details>

**Openstaande branch `feat/identiteit-en-membership`** (fase 1 van het plan, zie hieronder). Vijf commits, alle geverifieerd, **nog niet gepusht** en nog niet gemerged:

- `62f39f8` — migratie 0009: `external_subject`, `tenant_membership`, `gebruiker_bij_subject()`
- `14c4aad` — `src/auth`: OIDC-config, code inwisselen, ID-tokenverificatie (46 unittests)
- `0fc37af` — dagelijkse backup ingericht en werkend bewezen
- `4ba7af3` — tussentijdse statusbijwerking
- `f0125f3` — migratie 0010: server-side sessies met drie SECURITY DEFINER-functies

**Bijgewerkt 2026-07-31 — de branch is nu wél af en gepusht.** Commit `0c4d9f7` voegt de `TenantContextGuard`, de sessielaag en de drie auth-routes toe. Daarmee vervalt de reden om te parkeren: er ligt geen halve identiteitslaag meer, en er is geen tweede pad naar tenantcontext. **Nog niet gemerged naar `main`** — dat is een bewuste keuze van de eigenaar, geen vergeten stap.

**Gemerged op 2026-07-30:**

| PR | Repo | Wat |
|---|---|---|
| **#55** | MCM2 | CSV-parser en validatie voor leveranciersimport (`2d9a4ad`) |
| **#1** | MCM2-frontend | Bestandsupload en leesblok — UC1 afrondbaar in de browser (`3a8a571`) |

**Gemerged op 2026-07-29:** #37, #38, #39, #40, #41 (stap 8), #42/#43 als issues, #44, #45 (reviewaanvraag). Alle met CI groen op alle jobs.

**Eén onopgeruimd punt uit een eerdere sessie:** `git branch -a` toonde na de merge van MCM2-frontend#1 nog een remote branch die GitHub al had verwijderd. Dat was een verouderde lokale cache; `git fetch --prune` loste het op. Meldenswaardig omdat het er even uitzag als een mislukte opruiming.

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

**Stand 2026-08-04.** Twee dingen, in deze volgorde:

1. ~~**De backupcontrole inrichten**~~ — **gedaan op 2026-08-04.** Credentials, beide taken, testbericht aangekomen, beide taken via Taakplanner gedraaid.

2. ~~**Issue #25 — de migratiestand van `clm-enterprise` bijwerken**~~ — **gedaan op 2026-08-04.** 9 tabellen werden er 18, #25 en #29 gesloten.

**Nu: fase C uit `docs/superpowers/plans/2026-08-03-surveybeheer.md`** — voortgang volgen, antwoorden lezen en beoordelen. Fase A en B zijn op 2026-08-04 afgerond en gemerged.

**Drie restpunten**, geen van drieën blokkerend:
- **#78** — het besluit over welke rol de backup maakt. Nu feitelijk de `postgres`-rol met `BYPASSRLS`, zonder dat dat ergens als besluit staat.
- **#19** — de hersteltest moet over. Die van 30 juli draaide tegen negen tabellen en bewees dus het herstelpad, niet de compleetheid. De backupcontrole doet dit inmiddels wekelijks, wat het issue grotendeels afdekt.
- **#83** — gearchiveerde testrondes stapelen op in de demo-database. De e2e-suite archiveert ze (verwijderen kan niet en hoort ook niet te kunnen), maar ze blijven in de lijst staan. Logisch moment om aan te pakken is fase C, want dan wordt het rondeoverzicht toch herzien.

<details>
<summary>Vorige eerstvolgende stap (2026-07-31, inmiddels uitgevoerd)</summary>

**De leverancierskant is klaar en in de browser bewezen.** UC1 is van tokenlink tot bevestiging afrondbaar (zie het frontend-blok hierboven). Daarmee is er voor het eerst iets demonstreerbaars voor de klant.

**Het nieuwe spoor sinds 2026-07-30: leveranciersbeheer.** De opdrachtgever wil leveranciers kunnen aanmaken en importeren. Startpunt is Excel/CSV, daarna handinvoer; PC-only; het gaat mee in de pilot.

**Issue #7 spoor 1 is op 2026-07-31 afgerond.** Dat was de flessenhals: de leverancierskant had een eigen, complete beveiliging (het token *is* de sleutel, de tenant komt uit de tokenlookup), de beheerkant had dat niet. Nu wel — en de aanname dat de backend de tenant uit een ongeverifieerde header afleidde bleek bij het bouwen achterhaald: die header bestond al niet meer in de code.

**De eerstvolgende stap is fase 2 van het plan: vendorroutes en schermen.** Eerste regel daarvan: `@UseGuards(TenantContextGuard)` op elke beheercontroller. De guard is gebouwd en bewezen, maar hangt nog nergens op.

**Stand van spoor 1**, op branch `feat/identiteit-en-membership`:

- ✅ **Datamodel** (migratie 0009) — `clm.user.external_subject`, `clm.tenant_membership` met RLS, en `clm.gebruiker_bij_subject()`. Die laatste lost een kip-ei-probleem op dat pas bij het bouwen zichtbaar werd: de guard moet de tenant vaststellen vóórdat er tenantcontext is, maar `clm.user` staat onder RLS en levert zonder die context nul rijen. De enige alternatieven waren een `BYPASSRLS`-rol (verboden, §6) of de client laten zeggen welke tenant hij wil — precies de header die eruit moet. Opgelost met `SECURITY DEFINER`, zelfde patroon als `resolve_survey_token()` uit 0003.
- ✅ **OIDC-laag** (`src/auth/`) — configuratie, authorization code inwisselen, ID-token verifiëren tegen JWKS. 46 unittests tegen een lokaal gegenereerd sleutelpaar: strenger dan tegen de echte tenant, want een verlopen token of een handtekening van een vreemde sleutel geeft Entra nooit af.
- ✅ **Sessies** (migratie 0010) — `clm.sessie` plus `sessie_aanmaken()`, `sessie_oplossen()` en `sessie_beeindigen()`. Zie het eigen blok hieronder; die tabel is de enige zonder RLS en dat verdient uitleg.
- ✅ **De guard zelf** (2026-07-31) — `TenantContextGuard`: sessiecookie lezen → `sessie_oplossen()` → tenantId op de request. 401 bij geen, onbekende of verlopen sessie. Bewust géén rolcontrole: wie je bent en wat je mag zijn twee vragen.
- ✅ **Auth-routes** (2026-07-31) — `/auth/login`, `/auth/callback`, `/auth/logout`, met PKCE (S256) en een state-parameter tegen CSRF op de inlogflow. `cookie-parser` toegevoegd als directe dependency (1.4.7, exact gepind).
- ✅ **`X-Tenant-Id` verwijderen** — **bleek niets te verwijderen.** De header stond nergens in `src/` of `test/`; hij ging mee met de weggegooide branch `feat/fase0-skeleton-vendors`. In plaats daarvan bewezen dat er geen tweede pad naar tenantcontext bestaat, met drie tests die dat bewaken. Zie het blok "Beheerkant fase 1" hierboven.

**De claims zijn nog steeds niet gemeten.** De PoC-bevindingen noemen `email`, `sub`, `oid` en `tid` als verwáchting. De code koppelt bewust op `oid` (stabiel per tenant) en niet op `sub` (in Entra per applicatie verschillend) of `email` (verandert). Dat is de juiste keuze op basis van Microsoft-documentatie, maar **bevestig het bij de eerste echte login**.

**Wat de eigenaar nog moet aanleveren:** de OIDC-waarden in `.env` (zie `.env.example`, sectie Identity) — issuer, endpoints, client-ID en het client secret van de backend-app-registratie. **Zonder die waarden werkt alles behalve inloggen**: `/auth/login` geeft dan een 500 die precies opsomt welke variabelen ontbreken. Dat is een bewuste wijziging van 2026-07-31 — eerder zou de hele backend niet starten, en dat blokkeerde de e2e-suite en de leverancierskant, die geen identity nodig hebben.

</details>

### De vier stappen van het vendorspoor, in deze volgorde

1. ~~**CSV-parser en validatie**~~ — **afgerond 2026-07-30** (PR #55). Leest een bestand, meldt per rij wat er mis is, schrijft niets weg. Raakt de tenantgrens niet en kon daarom vóór de guard.
2. ~~**Entra-guard (#7 spoor 1)**~~ — **afgerond 2026-07-31** (commit `0c4d9f7`). Identiteit, sessies, guard en auth-routes staan; de tenantgrens is dicht. Nog niet gemeten: welke claims Entra werkelijk levert.
3. **CATS-rollen** — zie het blok hieronder. Let op: migratie 0009 voert `tenant_membership.role` in met twee waarden (`admin`, `reviewer`) als CHECK-constraint. Dat is bewust minimaal en staat **los** van het CATS-model; wordt CATS ingevoerd, dan is dat een eigen migratie die deze constraint vervangt.
4. **Wegschrijven** — de tweede helft van de import, plus formulier en lijst.

**Goed nieuws voor stap 4:** het datamodel ligt er al. `clm.vendor` is rijk gevuld (KvK, vestigingsnummer, SBI, criticality, spend, review-datums, soft delete) en **`clm.vendor_contact` bestaat al** met `email`, `phone`, `job_title` en `is_primary`. Contactpersonen met e-mailadressen vragen dus geen nieuwe migratie — alleen schrijfroutes en schermen.

### CATS-rollen — bron gevonden, nog niet gebouwd

Op 2026-07-30 vastgesteld door de eigenaar: gebruikers krijgen **verschillende rollen**; of autorisatie later ook op individu gaat, is een besluit voor later.

De bron is `MVM_V2/src/tenant/transdev/config/job-titles.ts`, afkomstig uit `CATS rollen.csv` (Bizaline/MyVendormanager). **Ongewijzigd actueel volgens de eigenaar.** Het bevat twee lagen, en dat onderscheid is de vondst:

| Laag | Wat | Aantal |
|---|---|---|
| **CATS-rol** | bepaalt de rechten — platform | 5: `vraageigenaar`, `realisatie_verificatie_manager`, `inkoper`, `contractmanager`, `contractbeheerder` |
| **Functietitel** | wat op het visitekaartje staat — tenantconfiguratie | 8 voor Transdev, elk gekoppeld aan één CATS-rol |

**Niet de vier rollen uit `MVM_V2/src/core/auth/permissions.ts` overnemen** (`admin`/`manager`/`compliance_officer`/`viewer`). Dat zijn generieke applicatierollen; CATS is Transdev's eigen vakinhoudelijke model. In MVM_V2 staan ze náást elkaar en doet `canDo()` niets met CATS — daar is het gedocumenteerd maar niet aangesloten.

**Twee ontwerpeisen die daaruit volgen:**

- **Rol als eigen rij, niet als kolom op `clm.user`.** Zodra "autorisatie op individu" aan de orde komt, is er een plek nodig om bereik op te hangen. Een `clm.user_role`-rij geeft die; een `role`-kolom niet. Kost nu vrijwel niets en voorkomt een migratie op gevulde pilotdata.
- **Rechten in code, niet in de database.** Rechten wijzigen hoort een codewijziging met een PR te zijn, geen `UPDATE`-statement.

**`contractScope` (DOP/AOC) is een autorisatiegrens, geen label.** DOP = operationele prestatie-artikelen, AOC = prijs, boete, tekortkoming. MVM_V2's backlog B-025 is er expliciet over: *"Contract coordinator (DOP only) krijgt NOOIT toegang tot het volledige PDF-contract"*, met PDF alleen voor DOP+AOC/AOC-rollen en AOC-KPI's alleen voor AOC-geautoriseerden.

Nu is er niets om dat op toe te passen — geen contracttabel, geen KPI's, geen PDF's, en bij leveranciers speelt het niet. **Kolom vastleggen, niet gebruiken**, zoals met `contract_id` op `survey_run` is gedaan. Wél als grens documenteren, anders leest een volgende ontwikkelaar het als een filtertje.

**Eén aanname om te verifiëren:** B-025 stelt dat Transdev de scheiding DOP/AOC *zelf nog niet formeel kent* en dat die met AI uit contract-PDF's gehaald zou worden. Dat is een aanname over hun werkwijze uit maart 2026.

### Daarna, in de vragenlijst-tool

Stap 7 (concept opslaan) is de volgende inhoudelijke uitbreiding; stap 10 (beheerroutes) wacht op spoor 1.

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
- **Architectuurreviews:**
  - `docs/architecture-review/2026-07-24/` — de oorspronkelijke review (00, 02-05, 07-09; 06 is verplaatst naar `docs/archive/`)
  - `docs/architecture-review/2026-07-27/01-entra-external-id-poc-bevindingen.md` — **de Entra-PoC. Lees dit vóór het bouwen van de guard**; de drie concrete vervolgstappen staan onderaan.
  - `docs/architecture-review/2026-07-29/00-review-aanvraag-architectuur-otap-tests.md` — de reviewaanvraag (1027 regels, zelfstandig leesbaar)
  - `docs/architecture-review/External-2026-07-29-mcm2-architectuurreview-otap-tests.pplx.md` — het externe antwoord. Omgezet in #46 t/m #54; zie het reviewblok hierboven.
- **Herbruikbaar uit MVM_V2** (`C:\dev\Work\MVM_V2`), geverifieerd op 2026-07-30:
  - `src/tenant/transdev/config/job-titles.ts` — **de CATS-rollen en acht Transdev-functietitels.** Bron: `CATS rollen.csv`, ongewijzigd actueel volgens de eigenaar.
  - `src/tenant/transdev/config/coupa-field-mapping.ts` — de kolomaliassen; de basis van `KOLOM_ALIASSEN` in de parser. **De CSV-lezer daarin is níét overgenomen** (kapt ontsnapte aanhalingstekens af).
  - `src/app/vendors/` — lijst (316 regels), aanmaakformulier (272) en detailpagina (397). Vorm bruikbaar; `vendorService.ts` schrijft in localStorage en een in-memory array — dat is demo-code, geen persistentie.
  - `BACKLOG.md` B-025 — de DOP/AOC-autorisatiegrens.
  - `src/core/auth/permissions.ts` — **niet overnemen** als rollenmodel, zie het CATS-blok hierboven.
- **Uit `mvm-api-pilot`:** `Database/migrations/004_clm_vendor.sql` is de bron van MCM2's vendorschema (dat werk is al binnengehaald). `Controllers/V2/VendorsController.cs` is bruikbaar als contract-referentie voor verplichte velden en defaults — **maar niet voor de tenantafleiding**, die komt daar uit `?tenant=demo`. `Database/migrations/009_staging.sql` bevat een staging-importmodel dat nooit in C# is geïmplementeerd; het idee (rijen eerst in staging met `pending/validated/imported/rejected`, ruwe rij als jsonb) is wel bruikbaar voor stap 4 van het vendorspoor.
- Actieve ADR's: `docs/adr/`, inclusief ADR-012 (frontend-uitrol: Docker als enige weg, AWS App Runner beoogd, Vercel afgewezen), ADR-006 (CIAM-laag: Microsoft Entra External ID — herzien op 2026-07-27, AWS Cognito verworpen; bestand heette eerder `ADR-006-cognito-als-federatielaag.md`), ADR-007 (CI-platform: GitHub Actions; eerste CI-scope: format/lint/typecheck, test/build bewust uitgesteld tot na de ORM-spike), ADR-008 (P0-databaserolherstel: clm_api_runtime, ontbrekende schema-grants, tijdelijke clm_admin=clm_api-gelijkstelling), ADR-009 (migration-rol clm_migrator, rollenbootstrap, geautomatiseerde RLS-test in CI via ephemere testdatabase) ADR-010 (databaselaag Drizzle, Prisma verwijderd; inclusief de toetsing van de zeven §5-criteria) en ADR-011 (backup- en hersteleisen per fase: hoeveel dataverlies en hersteltijd acceptabel zijn tijdens ontwikkeling, pilot en productie). ADR-002 is op 2026-07-28 bijgewerkt met de werkelijke stand van de vier openstaande controls.
- Runbooks: `docs/runbooks/` — bevat sinds 2026-07-28 `supabase-verificatie-en-restoretest.md`: vijf stappen (backupinventarisatie, restore-test, tier/garanties, Drizzle-migratiestand, provider-toets), met beproefde `pg_dump`/`pg_restore`-commando's, zes gedocumenteerde valkuilen en een meetregister voor hersteltijden.
- Historisch projectcontextdocument: `docs/context/PROJECT-HISTORY-2026-07-24.md`
- Volledig gearchiveerd, vervangen instructiebestand: `docs/archive/MCM2-CLAUDE-2026-07-24-pre-restructure.md`
