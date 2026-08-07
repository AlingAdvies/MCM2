# Zelf testen in de demo-omgeving

**Type:** D — routineoperatie
**Eigenaar:** Kees Maling
**Laatste update:** 2026-08-07
**Vereiste toegang:** Docker Desktop draaiend, deze repository, `MCM2-frontend` als buurmap

---

## Waarvoor dit bedoeld is

Zelf klikken door wat er opgeleverd is, op een echte frontend tegen een echte
backend tegen een gevulde database. Niet op mock data, en niet op productie.

Dit is **geen** vervanging van `npm run verify:volledig`. Dat commando is het
bewijs; dit is de plek om te kijken.

---

## Het korte verhaal

```
npm run demo
```

Dat is alles. Het script zet database, backend en frontend neer, maakt een
sessie, controleert of de keten sluit, en geeft een link die je in de browser
opent. Klaar in ongeveer een minuut.

Afsluiten:

```
npm run demo:af
```

---

## Wat het script per stap doet

| Stap | Wat er gebeurt | Waarom |
|---|---|---|
| 1 | Poorten 5001 en 3000 vrijmaken | Een eerdere demo-stack wordt opgeruimd; iets anders wordt met rust gelaten |
| 2 | Demo-database (`npm run demo:start`) | Container `mcm2demo` op poort 55450, data blijft staan |
| 3 | Backend bouwen en starten | Op 5001, met de vier variabelen die met de hand steeds misgingen |
| 4 | Frontend starten | Op 3000, met `NEXT_PUBLIC_API_URL` gezet |
| 5 | Sessie maken en de keten controleren | Haalt zelf de vragenlijsten op en toont wat het terugkreeg |

Stap 5 is het verschil met alles wat hiervoor bestond. Zonder die stap eindigt
een script met "klaar" terwijl de browser een leeg scherm toont.

---

## De vier fouten die dit voorkomt

Op 4 augustus 2026 ging het handmatig opstarten drie keer achter elkaar mis, en
elke keer op een andere manier. Alle vier de oorzaken zien er in het scherm
ongeveer hetzelfde uit:

| Wat ontbrak | Wat je zag | Wat het werkelijk was |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Voorbeeldgegevens | De frontend praatte met niemand |
| Backend niet gestart | "Kon niet worden opgehaald" | Er was geen backend |
| `CORS_ORIGIN` | "Kon niet worden opgehaald" | De browser gooide het antwoord weg |
| `SESSIE_COOKIE_INSECURE` | Lege lijst na inloggen | De backend zocht `__Host-mcm2_sessie`, dat over http niet bestaat |

Het script zet ze alle vier goed én controleert ze. Die controle stuurt bewust
een `Origin`-header mee: zonder die header geeft de backend ook bij een
verkeerde `CORS_ORIGIN` netjes 200 terug, en dan zou de controle de derde fout
missen. Gemeten, niet aangenomen.

---

## Zien waar je bent

Zolang je in een niet-productieomgeving zit staat er een oranje balk bovenin met
de naam van de tenant:

> ⚠ Demo (voorbeelddata) — dit is geen klantomgeving. De gegevens hieronder zijn
> verzonnen.

Die balk komt uit de **tenantnaam in de sessie**, niet uit een
omgevingsvariabele. Dat is met opzet: een variabele kan per ongeluk meegaan naar
productie of juist ontbreken in de demo, en dan waarschuwt hij op het verkeerde
moment.

Herkende namen staan in `MCM2-frontend/src/shared/components/layout/OmgevingBanner.tsx`:
`Demo (voorbeelddata)`, `Doorloop` en `Echte-login-test` — alle drie afkomstig
uit een seed-script.

De sidebar toont daarnaast **LIVE** of **MOCK DATA**. Dat gaat over iets anders:
of er een backend is. In zowel demo als productie staat daar LIVE.

---

## Wat er in de demo zit

```
21 leveranciers    uit MVM_V2, eenmalig geëxtraheerd
 3 gebruikers      1 admin (Sophie van der Berg), de rest reviewer
 2 vragenlijsten   transdev-annual-vendor-it-risk (8 vragen + 1 instructie)
                   transdev-leveranciersbeoordeling (29 vragen, interne UC2)
 2 rondes          één lopende, één met een gepasseerde sluitdatum
 6 responses       samen élke status uit het overzicht
```

De tweede vragenlijst is de interne beoordelingslijst die nog niet gebouwd is.
Hij staat in de demo omdat `seed-demo-tenant.js` alles uit `db/seeds/` inleest;
`verify:volledig` seedt bewust alleen de eerste.

### De zes responses, en waarom het er zes zijn

| Leverancier | Status op `/beheer/status` |
|---|---|
| Alstom | Nog niet terug |
| Siemens | Nog niet terug |
| Thales | **Te laat** — plus één notitie |
| Capgemini | Wacht op beoordeling |
| Strukton | Beoordeeld — twee tegenstrijdige oordelen, twee notities |
| Microsoft | Goedgekeurd |

Bijgewerkt op 2026-08-07. Daarvóór waren het er drie, en dan toonde het
statusoverzicht maar twee van de vijf statussen: de rest was visueel nooit
beoordeeld.

Twee dingen die daarbij bewust zo zijn:

- **De tweede ronde heeft een sluitdatum in het verleden.** "Te laat" is
  `closes_at < now()` bij een actieve ronde, en één ronde kan niet tegelijk
  open en verlopen zijn.
- **De uitnodigingen liggen 5 tot 40 dagen terug.** Stonden ze allemaal op
  vandaag, dan zegt de kolom "Uitgestuurd" niets — het verschil tussen
  gisteren en zes weken geleden is juist wat een lege "terug ontvangen"
  betekenis geeft.

---

## Andere commando's

```
npm run demo -- --vers   database eerst weggooien en opnieuw opbouwen
npm run demo:status      draait het, en sinds wanneer?
npm run demo:test        de browsertests tegen de draaiende demo
npm run demo:af          backend en frontend stoppen, database laten staan
npm run demo:stop        ook de database weggooien
```

### Deze data in een echte omgeving zetten

De seed draait ongewijzigd tegen een andere database — de enige invoer is
`DATABASE_URL`. Eén ding moet dan anders:

```
DATABASE_URL=... node scripts/seed-demo-tenant.js --echte-tokens
```

Zonder die vlag krijgen de zes responses vaste tokens die **in de broncode
staan**. Op een wegwerpdatabase is dat prima — de link moet ná het seeden nog
bruikbaar zijn om een scherm te tonen. In een echte omgeving betekent het dat
iedereen die het script leest die surveys kan openen; ook al wijzen ze naar
verzonnen data, dat is een verschil met een klant dat er niet hoort te zijn.

Met `--echte-tokens` worden ze gegenereerd zoals bij een echte uitnodiging en
**één keer afgedrukt**. Daarna bestaan ze alleen nog als hash: er is geen route
die een token opnieuw kan tonen. Bewaar wat je nodig hebt.

> **Inloggen vraagt nog een handeling.** De demo-gebruikers krijgen een
> herkenbaar nep-identiteitskenmerk (`demo:…`), juist om te voorkomen dat een
> verzonnen account botst met een echte Entra-identiteit — `external_subject`
> is uniek. Om zelf in te loggen moet een echte `oid` aan één van die
> gebruikers gekoppeld worden; zie `docs/STATUS.md`, "Demo-tenant".

`demo:test` draait dezelfde Playwright-suites als de doorloop, maar tegen
`next dev` en tegen de gevulde demo-database. Nuttig wanneer je iets met de hand
hebt zien misgaan en wilt weten of een test het ook ziet. Een groene uitkomst
zegt minder dan een groene `verify:volledig` — die draait tegen de
productie-images.

### De tests ruimen op wat ze aanmaken

Elke browsertest maakt zijn eigen leverancier aan. In `verify:volledig` valt dat
niet op — die gooit zijn database na afloop weg. Tegen de demo-database ligt dat
anders, want die blijft bestaan.

Op 4 augustus 2026 bleek wat dat kost: na één testronde stonden er naast de 21
demo-leveranciers 20 stuks "Detailtest 178584… B.V.". De lijst was daarmee
onbruikbaar om iets aan te laten zien.

De suites hebben nu een `afterEach` (detailscherm) en `afterAll`
(leveranciersbeheer) die hun eigen leveranciers weer weghalen, rechtstreeks via
de API. Gemeten over twee opeenvolgende rondes: 21 vóór, 32 tests groen, 21 erna.

Het opruimen zit in de test en niet in een schoonmaakscript achteraf. Een script
zou op naam moeten raden wat afval is, en dan is één demo-leverancier die
toevallig zo heet genoeg om echte data te verliezen. De test weet zelf precies
wat hij heeft aangemaakt.

---

## Bij afwijking

### "Er draait al iets op onze poorten"

Het script ruimt zijn eigen vorige stack op, maar laat vreemde processen met
rust — dat kan een dev-server van een ander project zijn. Zoeken wat het is:

```
netstat -ano | findstr ":5001 "
taskkill /PID <pid> /F
```

### "De stack antwoordt niet"

De logs staan in `.demo/`:

```
.demo/backend.log
.demo/frontend.log
```

### "De sessie werkt niet" in de browser

Sessies zijn 8 uur geldig, en een herstart van de stack maakt de oude ongeldig.
Draai `npm run demo` opnieuw voor een verse link.

### "Geen admin gevonden in de demo-tenant"

De database is leeg of half gevuld. `npm run demo -- --vers` bouwt hem opnieuw
op. Let op: een gekoppeld Entra-account moet dan opnieuw gekoppeld worden.

---

## Wat dit bewust niet doet

**De demo-database weggooien.** Nooit zonder `--vers`. Op 3 augustus 2026 is de
demo-data twee keer verdwenen door een opruimactie over alle containers, en
daarmee ook de koppeling met een echt Entra-account. Vandaar het label
`mcm2.rol=demo` op de container.

**Vreemde processen doodschieten.** Zie hierboven.

**Een tweede inlogpad maken.** De demo-sessie komt uit
`clm.sessie_aanmaken()` — dezelfde databasefunctie als de echte inlogflow,
inclusief membershipcontrole. Alleen het verkrijgen ervan is overgeslagen, niet
de sessie zelf. Wie de échte Entra-flow wil doorlopen koppelt een echte `oid`;
zie `docs/STATUS.md`, "Demo-tenant".

De aanmeldpagina (`/demo-aanmelden`) werkt in productie niet: over https heet
het cookie `__Host-mcm2_sessie`, en dat voorvoegsel mag een pagina niet zetten.
