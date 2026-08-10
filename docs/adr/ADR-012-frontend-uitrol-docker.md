# ADR-012 — Frontend: Docker als enige uitrolweg, AWS als beoogde doelplek

**Datum:** 2026-07-29
**Status:** besloten, nog niet uitgevoerd
**Raakt:** Issue #12 (acceptatieomgeving), Issue #18 (OTAP-doorloop), Issue #20 (Dockerfile hardenen)
**Bouwt voort op:** ADR-001 (TypeScript als enige taal), ADR-008/009 (draagbaarheid als bewezen principe)

---

## Context

MCM2 heeft tot 2026-07-29 **geen frontend**. De backend is een NestJS-applicatie met twee
survey-routes; er is geen scherm, geen framework-keuze en geen uitrolbesluit. ADR-001 noemt Next.js
terloops als context ("sluit aan bij de frontend (Next.js/MVM_V2)"), maar dat is geen besluit.

De aanleiding voor deze ADR is een vraag van de eigenaar: **wanneer zien we de verbinding met de
frontend, want dat geeft veel beter zicht op de juistheid van het backend-ontwerp.** Die vraag is
terecht — een datamodel beoordeel je op papier als abstractie, aan een scherm zie je meteen of het
klopt. Diezelfde sessie leverde daar al bewijs voor: de vergelijking met MVM_V2 legde drie gaten in
het vragenlijst-ontwerp bloot die in het document zelf niet zichtbaar waren.

### Wat er al ligt

**MVM_V2** (`C:\dev\Work\MVM_V2`) is een Next.js 15 / React 19-applicatie met werkende
surveyschermen op mock data, die de klant heeft gezien. Relevant hier:

- `src/shared/design-tokens.ts` — 57 regels, expliciet "ENIGE bron van waarheid voor kleuren en
  typografie"
- `src/app/portal/survey/[token]/` — een leverancierportaal op token, precies MCM2's route
- Een mock/live-schakelaar op de branch `feat/transdev-backend-koppeling`: staat
  `NEXT_PUBLIC_API_URL` gezet, dan haalt de service echte data op; zo niet, dan mock data

MVM_V2 heeft géén `vercel.json`, `netlify.toml` of Dockerfile — daar is dus ook nog geen
uitrolbesluit genomen. De CI daar is één job (lint + build).

**MCM2** heeft een multi-stage Dockerfile met een `development`-stage voor hot reload en een
`runtime`-stage die het gecompileerde resultaat draait, plus een CI-job die het image bouwt **én
start**. Die job bestaat omdat de oorspronkelijke Dockerfile de applicatie niet eens bouwde
(`npm install` + `start:dev`) en dat pas aan het licht kwam toen er een poort op kwam.

---

## Besluit

De frontend wordt een **Next.js-applicatie in een eigen repository**, uitgerold als
**containerimage — de enige uitrolweg**, zowel lokaal als in productie.

Tot de golive draait die container **lokaal via `docker compose`**, naast de bestaande
backend-stack. Kosten: nul.

Bij golive is **AWS de beoogde doelplek**, met **App Runner** als voorkeursdienst. Dat is een
richting, geen definitief besluit — zie "Beoogde doelplek".

---

## Onderbouwing

Het doorslaggevende criterium is door de eigenaar expliciet gesteld: **robuust en eenvoudig
deployen.** Dat is een operationeel criterium, geen gemakscriterium — het gaat om één manier van
uitrollen die begrepen wordt en overal hetzelfde werkt, niet om de snelste weg naar een deelbare
link.

| Wat het oplevert | Waarom dat hier telt |
|---|---|
| Eén patroon in plaats van twee | De backend zit al in Docker, met dezelfde CI-poort. Eén manier van uitrollen, terugdraaien en logs lezen. |
| Nul kosten tot golive | Lokaal draaien kost niets. Tweede randvoorwaarde van de eigenaar. |
| Geen externe partij in de keten | Bij een NIS2-instrument is "wie kan mijn dienst platleggen" een gerechtvaardigde vraag. |
| Eén omgeving om aan te tonen | Voor NIS2/ISO27001 aanzienlijk eenvoudiger dan de helft bij een externe partij. |
| Consistent met ADR-008/009 | Geen leveranciersspecifieke diensten. Dat principe maakte de overstap naar Neon gratis. |
| Elke dag bewezen | De CI-poort "bouwt én start" vanaf dag één, niet pas bij de eerste uitrol. |

Dat laatste punt is zwaarder dan het lijkt. De backend-Dockerfile was aanvankelijk fout en werd
betrapt door de CI-poort. Diezelfde poort direct voor de frontend inbouwen voorkomt dat een tweede
keer — en het is goedkoop, want het patroon ligt er al.

---

## Wat dit kost

Deze afwegingen horen hier vastgelegd, want over drie maanden zijn het terechte vragen.

**Iets laten zien aan de klant wordt een handeling.** Bij een gehoste optie zoals Vercel krijgt elke
pull request automatisch een eigen webadres — de acceptatiestap uit OTAP, gratis. Met Docker en
lokaal draaien is dat: zelf starten en het scherm delen, of tijdelijk iets online zetten.

Dat is een reële beperking en raakt precies de vraag die deze ADR aanleiding gaf. Het blijft
mogelijk om schermen te beoordelen, maar op de eigen machine in plaats van via een link.

**De acceptatieomgeving (Issue #12) kan niet worden overgeslagen.** Met een gehoste optie had de
frontend de acceptatiestap eerder kunnen waarmaken dan de backend. Nu delen ze dezelfde
afhankelijkheid.

**Next.js in een container vraagt eenmalig aandacht:** `output: 'standalone'` in `next.config.ts`,
en de ingebouwde afbeeldingsoptimalisatie werkt niet vanzelf zoals bij een gehost platform. Voor
MCM2 is dat waarschijnlijk klein — een logo, mogelijk een certificaat-preview — maar het is het
enige punt waar het uiterlijk kan afwijken als het over het hoofd gezien wordt.

**Wat níét verschilt:** de HTML, CSS en JavaScript zijn identiek. Een gehost platform voert onder
water hetzelfde `next build` uit. Er bestaat geen platformspecifieke versie van Next.js.

---

## Beoogde doelplek: AWS

De eigenaar geeft aan dat golive **met grote waarschijnlijkheid op AWS** gebeurt. Dat is hier
vastgelegd als richting, niet als besluit — het definitieve besluit hoeft pas te vallen wanneer de
pilot daadwerkelijk live gaat.

| Dienst | Wat het is | Beheerlast | Oordeel |
|---|---|---|---|
| **App Runner** | Neemt een image, levert een draaiende dienst met HTTPS | vrijwel geen | **voorkeur** |
| ECS/Fargate | Containers met volledige controle | netwerk, load balancer, taakdefinities | te veel voor deze schaal |
| EC2 | Zelf beheerde server | updates, patches, certificaten | het meeste werk |
| Amplify | Gehost platform van AWS | weinig | **afgeraden** — niet containergebaseerd, levert alsnog twee uitrolwegen op |

App Runner regelt HTTPS, schaling en herstarten zelf. Dat is de AWS-dienst die het dichtst bij het
gemak van een gehost platform komt zonder een tweede uitrolweg te introduceren.

> **Kosten, niet op de bron geverifieerd:** App Runner heeft geen gratis laag. Indicatie voor een
> kleine, continu draaiende dienst: **$25–40 per maand**. Dit cijfer is niet bij AWS geverifieerd en
> moet gecontroleerd worden vóór de golive-beslissing. Het is een kost bij golive, niet nu.

---

## De draagbaarheidsregel

**Geen aannames over waar de container draait.** Alle configuratie via omgevingsvariabelen, geen
AWS-specifieke code, geen platformspecifieke functies — ook niet van de eigen omgeving.

Dit is dezelfde regel die de database-overstap goedkoop maakte. MCM2 bleek zonder één regel
codewijziging op Neon te draaien, en dat was geen toeval maar een gevolg van ADR-008/009: geen
Supabase Auth, Storage, Edge Functions of `supabase-js`.

Concreet voor de frontend:

| Regel | Waarom |
|---|---|
| ~~API-adres uit `NEXT_PUBLIC_API_URL`~~ → `API_BASE_URL`, zie de aanvulling onderaan | Zelfde patroon als MVM_V2's mock/live-schakelaar |
| Geen platformspecifieke build-functies | Anders is verhuizen later duur |
| Geen aanname over het domein | Het adres verschilt per omgeving |
| Bestandsopslag via de backend, nooit rechtstreeks | De backend bewaakt de tokencontrole (vragenlijst-ontwerp §6) |

Daarmee is App Runner straks een keuze en geen huwelijk: blijkt een MSP of Azure beter, dan verhuist
hetzelfde image.

---

## De mock/live-schakelaar

Het patroon uit MVM_V2 wordt **overgenomen, niet overgeërfd**: het is een idee van enkele regels,
geen bestand om te kopiëren. Er wordt niet gewacht op het mergen van
`feat/transdev-backend-koppeling` in MVM_V2 — dat is een aangelegenheid van dat project.

```
NEXT_PUBLIC_API_URL leeg    → schermen draaien op mock data, geen backend nodig
NEXT_PUBLIC_API_URL gezet   → dezelfde schermen op de echte MCM2-API
```

Dit levert precies wat de aanleiding van deze ADR vroeg: schermen zijn te beoordelen vóórdat de
backend af is, en services gaan één voor één over zodra het endpoint bestaat. Geen big bang.

### Eén ding gaat er expliciet uit

De MVM_V2-code stuurt de tenant mee in het webadres:

```typescript
const res = await fetch(`${API_URL}/api/v2/contracts?tenant=demo`)
```

**Dat mag in MCM2 niet.** Het is exact het patroon dat MCM2-CLAUDE.md §6 verbiedt en de kern van
Issue #7 — het is de reden dat de branch `feat/fase0-skeleton-vendors` is weggegooid zonder te
mergen. In MVM_V2 is het verdedigbaar (demo-code tegen de C#-pilot), maar bij overname komt het
patroon mee als niemand oplet.

In MCM2 komt de tenant uit het token (leverancierskant) of uit het geverifieerde ID-token
(beheerderskant, spoor 1). **De API accepteert geen `tenant`-parameter.**

---

## Huisstijl: kopiëren, niet koppelen

`design-tokens.ts` wordt **gekopieerd** naar de MCM2-frontend, met een verwijzing naar de bron in
het bestand. Wijzigt MVM_V2 de huisstijl, dan is dat één bestand bijwerken — een handeling van
minuten, hooguit enkele keren per jaar.

**Een gedeeld npm-pakket is overwogen en afgewezen.** Technisch netter, maar het betekent een derde
repository, een publicatiestap en versiebeheer voor twee producten die door één persoon onderhouden
worden. De overhead is groter dan het probleem.

De regel uit MVM_V2 wordt meegenomen: **nooit kleuren hardcoderen in componenten.** Dan blijft een
huisstijlwijziging altijd één bestand.

---

## Gevolgen

### Nieuwe structuur

| Onderdeel | Waar |
|---|---|
| Frontend | eigen repository (`MCM2-frontend` of vergelijkbaar) |
| Uitrolartefact | containerimage, gebouwd uit een Dockerfile in die repo |
| Lokaal draaien | `docker compose up`, frontend toegevoegd aan de bestaande stack |
| CI-poort | image bouwen **én starten**, gemodelleerd naar de `docker-build`-job van de backend |

**Eigen repository, geen map in MCM2.** Frontend en backend hebben verschillende releasecycli: een
tekstwijziging in een scherm moet niet wachten op een databasemigratie, en een frontendwijziging
hoort niet de RLS-isolatietests te draaien.

### OTAP

Het bestaande document `docs/otap-en-security-voor-eigenaar.md` beschrijft OTAP backend-only en is
op onderdelen verouderd (het noemt Prisma en twee CI-controles; er zijn er nu drie). Het moet
bijgewerkt worden met de frontend erin.

| Fase | Backend | Frontend |
|---|---|---|
| Ontwikkel | branch, lokaal | branch, `docker compose up` op mock data |
| Test | CI: 3 jobs | CI: typecheck, build, image start |
| Acceptatie | Issue #12 | Issue #12 — **gedeelde afhankelijkheid** |
| Productie | AWS (beoogd) | AWS App Runner (beoogd) |

### Issues die geraakt worden

- **#12** (acceptatieomgeving) — wordt zwaarder: nu twee containers in plaats van één.
- **#18** (OTAP-doorloop) — de doorloop moet frontend én backend omvatten.
- **#20** (Dockerfile hardenen) — de openstaande eis "base-image op exacte patchversie pinnen" geldt
  vanaf het begin ook voor de frontend-Dockerfile.

---

## Overwogen alternatieven

**Vercel.** Gemaakt door de makers van Next.js, gratis voor deze fase, en het geeft automatisch een
preview-URL per pull request — precies de acceptatiestap die nu handwerk wordt. **Afgewezen op het
criterium "robuust en eenvoudig deployen":** het introduceert een tweede uitrolweg naast de
containeraanpak van de backend, en die zou bij de overstap naar AWS weer afgeleerd moeten worden.
Daarnaast is het een Amerikaanse partij in de keten, wat bij een NIS2-instrument uitleg vraagt.

**Vercel nu, Docker later.** Overwogen als tussenvorm, met de Dockerfile vanaf dag één in CI zodat
beide wegen bewezen blijven. **Afgewezen:** twee uitrolwegen onderhouden is per definitie niet
eenvoudig — twee plekken waar het misgaat, twee verhalen bij een incident.

**Azure Static Web Apps / Container Apps.** Serieuze kandidaat, want identity ligt al bij Microsoft
(ADR-006). **Afgewezen omdat die koppeling hier niet bestaat:** de frontend praat niet met Entra,
dat doet de backend. En golive gaat naar verwachting naar AWS.

**Een map in de MCM2-repo.** Eén repository, één pull request voor front- en backend samen.
**Afgewezen:** verschillende releasecycli, en elke frontendwijziging zou de volledige backend-CI
draaien.

**Gedeeld npm-pakket voor de huisstijl.** Zie hierboven — overhead groter dan het probleem.

---

## Reviewmoment

Herzien wanneer:

- **de pilot live gaat** — dan valt het definitieve besluit over de AWS-dienst, met geverifieerde
  kosten in plaats van de indicatie hierboven;
- **een klant EU-hosting of eigen infrastructuur eist** — dan is de draagbaarheidsregel de reden
  dat dit een verhuizing is en geen verbouwing;
- **er een tweede ontwikkelaar bijkomt** — dan verandert de afweging tussen beheerlast en gemak,
  en wordt een preview-omgeving per pull request waardevoller;
- **het handmatig tonen van schermen aan de klant in de praktijk knelt** — dat is de bekende prijs
  van dit besluit en het is legitiem om hem opnieuw te wegen.

---

## Aanvulling 2026-08-10 — het API-adres wordt runtime gelezen (Issue #51)

Het besluit hierboven blijft staan; één regel eruit is achterhaald door de
uitvoering ervan.

**Wat er niet klopte.** De draagbaarheidsregel eist "alle configuratie via
omgevingsvariabelen". `NEXT_PUBLIC_API_URL` leek daaraan te voldoen, maar
Next.js bakt zulke variabelen tijdens de **build** in de bundel. Het adres was
dus geen configuratie maar een eigenschap van het image — precies wat deze ADR
wilde vermijden, in de ene regel die de uitzondering vormde.

Het gevolg raakte de kern van de OTAP-belofte: één image kon niet van acceptatie
naar productie promoveren, want het wist al met welke backend het praatte. Twee
images bouwen lost dat niet op maar breekt het uitgangspunt — dan is wat je test
niet wat je uitrolt.

**Wat er nu staat.** De browser praat alleen nog met de frontend zelf. Alle
aanroepen gaan naar `/api/backend/...`, een server-side route die `API_BASE_URL`
bij elke aanroep uit de omgeving leest en het verzoek doorgeeft.

| | Voor | Na |
|---|---|---|
| Variabele | `NEXT_PUBLIC_API_URL` | `API_BASE_URL` |
| Gelezen | bij het bouwen | bij het starten |
| Promoveerbaar | nee | ja |
| `CORS_ORIGIN` nodig | ja | nee — zelfde herkomst |

**Afgewogen en verworpen:** een publiek `/config`-endpoint dat de browser bij het
laden bevraagt. Dat was de eerste gedachte in Issue #51; de externe review van
2026-07-29 wees hem af wegens een extra netwerklaag, een endpoint dat vertelt
waar de backend leeft, en een venster waarin de eerste aanroep nog niet weet
waarheen.

**De mock/live-schakelaar is losgekoppeld, niet verplaatst.**
`NEXT_PUBLIC_MOCK_DATA` blijft een build-variabele. Mock data is een
ontwikkelstand en geen omgeving: test, acceptatie, staging en productie draaien
allemaal op de echte backend, en een mock-image wordt nooit gepromoveerd. De
schakelaar zit bovendien in achttien schermbestanden, en als hij breekt tonen
schermen stilletjes verzonnen data terwijl je denkt naar echte klantgegevens te
kijken — de gevaarlijkste faalvorm die deze applicatie heeft.

**Let op de omkering.** Voorheen betekende een lege variabele mock data, doordat
één variabele twee dingen deed. Nu moet mock expliciet aan. Vergeten instellen
gaf vroeger een scherm vol verzonnen data dat er echt uitzag; het geeft nu een
zichtbare fout.

**Bewezen, niet aangenomen.** Hetzelfde image (`sha256:8526dae2…`) draaide in
twee containers die alleen in `API_BASE_URL` verschilden, met hetzelfde
sessiecookie: de een gaf de leverancierslijst uit de demo-database, de ander een
401 uit een verse database. Dat is acceptatiecriterium 3 van Issue #51.

Daarmee is de draagbaarheidsregel voor het eerst volledig waar: er is geen enkele
instelling meer die bij het bouwen vastligt en per omgeving zou moeten
verschillen. Dat is wat App Runner, ECS en Kubernetes nodig hebben.
