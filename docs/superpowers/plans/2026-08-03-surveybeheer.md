# Implementatieplan — surveybeheer voor de tenant

**Datum:** 2026-08-03 (bijgewerkt 2026-08-06 met de voortgang)
**Status:** GOEDGEKEURD — in uitvoering
**Aanleiding:** de beheerkant kan leveranciers beheren maar geen enkele vragenlijst uitzetten
**Raakt:** ontwerp `2026-07-28-vragenlijst-ontwerp.md` §7 (stap 10 van de bouwvolgorde), Issue #13, #15, #16

## Voortgang

| Fase | Backend | Frontend | PR's |
|---|---|---|---|
| **A** — vragenlijsten en rondes bekijken | ✅ gemerged | ✅ gemerged | #79, frontend #5 |
| **B** — ronde starten en uitnodigen | ✅ gemerged | ✅ gemerged | #81, frontend #6 |
| **C1** — antwoorden lezen | ✅ gebouwd, **PR open** | ❌ nog niet | #94 |
| **C2** — beoordelen (migratie 0015) | ✅ gebouwd, **PR open** | ❌ nog niet | #95 |
| **C3** — beoordelaar koppelen (migratie 0016) | ✅ gebouwd, **PR open** | ❌ nog niet | #97 |
| **D** — uitnodigingen mailen | ✅ gemerged | n.v.t. | #87, #88, #89 |

**Fase D is vóór C gebouwd**, op verzoek van de eigenaar (2026-08-06): eerst een leverancier
echt kunnen uitnodigen, dan de antwoorden kunnen lezen. Er gaat sindsdien aantoonbaar mail uit
via Resend.

**Fase C is in drie PR's geknipt** (besluit eigenaar 2026-08-06): lezen → beoordelen →
koppelen. Elke stap is los te beoordelen en los terug te draaien; C1 heeft geen migratie nodig
en dicht op zichzelf al het grootste gat.

**Wat er nog niet is: alle schermen van fase C.** Zie §Fase C, "Frontend".

> **Let op bij het lezen naast het ontwerp van 28 juli:** §1b daarvan wijst "request
> revisions" af. Dit plan gaat daar niet tegenin — het legt een oordeel vast zonder de
> respons te heropenen. Zie §2a.

---

## 0. Waar dit over gaat, in één alinea

MCM2 kan een leverancier een vragenlijst laten invullen — dat werkt end-to-end en is
bewezen. Wat er niet is: een manier voor de tenant om die vragenlijst **uit te zetten**.
Er is geen scherm om een vragenlijst te bekijken, geen manier om een ronde te starten,
geen manier om deelnemers toe te voegen, en geen scherm dat de antwoorden toont. De
demo-tenant lijkt gevuld, maar dat komt doordat een seed-script rechtstreeks in de
database schrijft.

Concreet: **`genereerToken()` wordt in geen enkele productieroute aangeroepen.** Alleen
`seed-demo-tenant.js` en `otap-doorloop.js` maken responses aan. Er bestaat dus geen weg
waarlangs een echte uitnodiging tot stand komt.

---

## 1. Wat er al ligt — dit is kleiner dan het lijkt

Geverifieerd op 2026-08-03 tegen de code, niet uit gespreksgeheugen.

| Onderdeel | Stand |
|---|---|
| Datamodel (`survey_template`, `_category`, `_question`, `_run`, `_response`, `_answer`, `_attachment`) | ✅ compleet, met RLS, CHECK-constraints, bevriezingstrigger |
| `VragenlijstImportService` — JSON-schema importeren, valideren | ✅ |
| `VragenlijstLeesService` — vragen ophalen per response | ✅ |
| `AntwoordIndienService` + validatie | ✅ |
| `BijlageService` + inhoudscontrole | ✅ |
| `SurveyAuditService` | ✅ |
| `SurveyTokenGuard`, `genereerToken()`, `hashToken()` | ✅ maar `genereerToken()` heeft **geen aanroeper** |
| Lifecycle-kolommen (`status`, `is_test`, `survey_kind`) | ✅ in de database, **nergens gebruikt** |
| **Beheerroutes** | ❌ geen enkele |
| **Beheerschermen** | ❌ geen enkele |
| **Beoordeling van een ingediende respons** | ❌ bestaat nergens — geen tabel, geen route, geen scherm |

De onderlaag is dus af. Wat ontbreekt is de bovenkant: routes, schermen, en de ene
functie die een token uitgeeft.

**Het ontwerp uit juli beschrijft dit al** (§7 "Beheerderskant", §2b lifecycle, §2c
deelnemers). Het stond destijds als "nog niet te bouwen — wacht op de Entra-guard". Die
guard is er sinds 2026-07-31, en sinds vandaag is er ook een `RolGuard`. **Dit plan voert
stap 10 van die bouwvolgorde uit; het bedenkt geen nieuw ontwerp.**

---

## 2. Wat een tenantbeheerder moet kunnen

In de volgorde waarin hij het doet:

1. **Zien welke vragenlijsten er zijn** en wat erin staat.
2. **Een ronde starten** op een vragenlijst — echt of als test.
3. **Deelnemers toevoegen** en daarmee tokenlinks laten uitgeven.
4. **Volgen wie heeft ingevuld** en wie niet.
5. **De antwoorden lezen.**
6. **De ingevulde vragenlijst beoordelen** — Goed, Nadere vragen of Niet goed.

Punt 3 is het hart: daar wordt `genereerToken()` eindelijk aangeroepen, en daar komt de
regel uit §2c ("onbekend e-mailadres → weigeren en terugmelden") tot leven.

Punt 6 is op 2026-08-03 toegevoegd op verzoek van de eigenaar. Zonder die stap is het
lezen van antwoorden een leesoefening zonder uitkomst: er staat nergens vast wát de tenant
ervan vond. Zie §2a — het is bewust iets anders dan UC2.

**Wat er níét bij hoort in deze ronde:** vragenlijsten samenstellen in een scherm.
Importeren via JSON werkt al, en een vraageditor is een eigen project — acht
antwoordtypen met elk hun eigen `config`. Dat is een bewuste knip; zie §6.

---

## 2a. Beoordelen is niet UC2 — het onderscheid, en waarom het uitmaakt

Besluit eigenaar 2026-08-03: **UC1 wordt gebouwd, UC2 niet.** Maar een Transdev-collega
moet de ingevulde vragenlijst wél kunnen beoordelen. Dat lijkt op UC2 en is het niet.

| | UC2 (uitgesteld) | Beoordeling (wél bouwen) |
|---|---|---|
| Wat vult de collega in | een eigen vragenlijst met eigen vragen | één oordeel plus toelichting |
| Waar landt het | `survey_response` met `vendor_id` leeg | eigen tabel `survey_review` |
| Waarover gaat het | de leverancier in het algemeen | déze ingediende respons |
| Bestaat los van UC1 | ja | nee — zonder ingediende respons is er niets te beoordelen |

Het verschil dat de bouw bepaalt: UC2 is een **tweede vragenlijst**, beoordelen is een
**oordeel over een bestaande respons**. UC2 vraagt een tweede schermflow, deelnemersbeheer
voor collega's en een scoreberekening. Beoordelen vraagt één knop op een scherm dat in fase
C toch al gebouwd wordt.

**Dat maakt beoordelen een stuk kleiner dan UC2, terwijl het de werkstroom oplevert die de
eigenaar beschrijft.** UC2 blijft in het datamodel staan en kan later alsnog — er wordt
hier niets gebouwd dat dat in de weg zit.

### Drie oordelen, en wat "nadere vragen" wel en niet doet

De oordelen zijn `goed`, `nadere_vragen` en `niet_goed`.

`nadere_vragen` **stuurt de vragenlijst niet terug naar de leverancier** (besluit eigenaar
2026-08-03). Het oordeel en de toelichting worden vastgelegd, de respons blijft dicht, en
de beheerder neemt zelf contact op. Het scherm laat zien welke leveranciers openstaan.

Dat is een bewuste keuze en geen tekortkoming. Terugsturen zou raken aan vier plekken die
nu bewezen en groen zijn: de bevriezingstrigger (migratie 0005), de `SurveyTokenGuard`, de
verlooplogica van het token, en de audittrail. Het ontwerp legt bovendien vast (§1b, besluit
2026-07-29) dat de tokenlaag bewust eenrichtingsverkeer is: één atomair
`UPDATE … WHERE status = 'pending'`, daarna een 410.

Er is ook een inhoudelijke vraag die eerst beantwoord moet worden en die dit plan níét kan
beantwoorden: **mag een leverancier bij heropenen zijn oude antwoorden overschrijven, of
komt de aanvulling ernaast te staan?** Bij overschrijven is het originele antwoord weg — en
dat is precies wat je in een compliance-dossier wilt kunnen terughalen. Die vraag is beter
te beantwoorden ná een maand echte beoordelingen dan nu op een aanname.

**Wat dit besluit openhoudt:** de waarde `nadere_vragen` staat straks in de data. Terugsturen
toevoegen is later een statusovergang erbij plus een besluit over historie — geen verbouwing
van wat hier gebouwd wordt.

### Elk oordeel blijft bewaard

Besluit eigenaar 2026-08-03: **oordelen worden nooit overschreven.** Elk oordeel is een
eigen regel met datum en beoordelaar; het scherm toont ze nieuwste bovenaan.

Reden: een leverancier die vorig jaar `nadere_vragen` kreeg en dit jaar `goed`, is een
ander verhaal dan een leverancier die altijd goed was. Dat verloop is de kern van wat een
compliance-instrument moet opleveren, en met overschrijven is het onherstelbaar weg.

Praktisch betekent dit dat "het huidige oordeel" een afgeleide is (de nieuwste regel), geen
kolom. Dat scheelt later een migratie: een tweede beoordelaar of een vierpuntsschaal past er
zonder schemawijziging in.

### De toelichting is intern — en dat is de eerste tabel waar "zelfde tenant" niet volstaat

Besluit eigenaar 2026-08-03: **een leverancier komt nooit bij een beoordeling.** Niet het
oordeel, niet de toelichting, ook niet indirect. Als er iets is, neemt Transdev zelf contact
op. Blijkt er een aanvulling nodig, dan volgt een volledige tweede ronde — nieuw token,
nieuwe respons, bestaande mechaniek.

De beoordelaar kan daardoor noteren wat hij denkt zonder het te formuleren alsof de
leverancier meeleest. En de regel is in één zin uit te spreken, wat hem toetsbaar maakt en
over een jaar nog steeds naleefbaar.

**Maar dit vereenvoudigt de beveiliging niet — het verplaatst haar.** Dat is de reden dat
deze paragraaf zo uitvoerig is.

De leverancier staat niet buiten het systeem: hij is de enige die de vragenlijst invult, en
hij heeft een geldig token voor precies de respons waar het oordeel aan hangt. Op
2026-08-03 nagelopen in de code:

- `DatabaseService.withTenant()` is de enige plek waar tenantcontext gezet wordt, en zet
  precies één variabele: `app.current_tenant_id`.
- Zowel `vragenlijst-lezen.service.ts` (leverancier, tokenpad) als `vendor.service.ts`
  (medewerker, sessiepad) roepen dezelfde functie met dezelfde parameter aan.
- Elke bestaande policy luidt `USING (tenant_id = clm.current_tenant_id())`.

**De database kan dus op dit moment geen onderscheid maken tussen jou en de leverancier.**
Met de standaardpolicy is `survey_review` binnen de tenant leesbaar, punt. Dat de
leverancier er niet bij kan, komt uitsluitend doordat er geen route bestaat die het
teruggeeft — bescherming door afwezigheid, die standhoudt tot iemand een route bouwt die
"de respons met alles eromheen" ophaalt.

Dat is exact het faalpatroon van tegenproef 6 (MCM2-CLAUDE.md §15b): `tenantId` lekte via
`/auth/sessie` terwijl acht browsertests groen bleven, omdat geen scherm dat veld toonde.
**De afwezigheid van een lek is niet de aanwezigheid van een grens.**

Overal elders in MCM2 geldt "zelfde tenant = mag het zien". `survey_review` is de eerste
tabel waar dat níét waar is. Zo'n uitzondering hoort vastgelegd op de plek die niet
overgeslagen kan worden — de database — en niet in de gewoonte om de juiste route te
bouwen.

### Hoe de sterke variant werkt

Besluit eigenaar 2026-08-03: **sterk**, niet de goedkopere variant met alleen een tegenproef.

Er komt een tweede sessievariabele naast `app.current_tenant_id`:

```
app.current_actor  = 'medewerker' | 'leverancier'
```

- `withTenant()` krijgt die soort als verplicht argument. Verplicht en niet optioneel met
  een standaardwaarde: een nieuwe aanroeper die het vergeet moet een compilatiefout krijgen,
  niet stilzwijgend de ruimste variant.
- `clm.current_actor()` leest hem, met dezelfde vorm als `current_tenant_id()`.
- De policy op `survey_review` eist beide:
  ```sql
  USING (tenant_id = clm.current_tenant_id() AND clm.current_actor() = 'medewerker')
  ```
- De tokenpaden (`vragenlijst-lezen`, `antwoord-indienen`, `bijlage`) geven
  `'leverancier'` door; de sessiepaden `'medewerker'`.

Gevolg: een toekomstige route die `survey_review` aan de leverancierskant meegeeft, krijgt
**nul rijen** — geen foutmelding, geen lek, gewoon niets. De grens ligt onder de
applicatielaag en overleeft dus de programmeur die hem niet kent.

**Wat dit kost:** één migratie, een wijziging in `withTenant()` en in ongeveer tien
aanroepers, plus een tegenproef. Ruwweg een halve dag.

**Wat het oplevert buiten dit plan:** zodra `app.current_actor` bestaat, is elke volgende
"dit mag de leverancier niet zien" één policyregel in plaats van een ontwerpdiscussie.
Interne notities bij een leverancier, een risicoscore, een auditlogregel — dat komt er.

**Wat het níét is:** dit vervangt de guards niet. Een leverancier hoort al bij de route te
stranden. Dit is de tweede grendel voor het geval de eerste ooit ontbreekt — dezelfde
gedachte als de `WITH CHECK`-clausules die schrijven op een ingediende respons
tegenhouden terwijl de applicatie dat óók al doet (migratie 0005, §3).

---

## 3. Vier fases

Elke fase eindigt met iets dat aantoonbaar werkt, `verify:volledig` groen en een
tegenproef op wat er aan beveiliging is toegevoegd (MCM2-CLAUDE.md §15, §15b).

### Fase A — Vragenlijsten en rondes bekijken

**Backend**

```
GET /admin/survey/templates            lijst met naam, versie, aantal vragen, aantal rondes
GET /admin/survey/templates/:id        detail: categorieën en vragen, incl. config per type
GET /admin/survey/runs                 rondes met status, deadline, voortgang
GET /admin/survey/runs/:id             één ronde met haar responses
```

Alles achter `TenantContextGuard`. **Lezen mag ook een reviewer** — die moet resultaten
kunnen inzien, dat is precies zijn rol.

**Frontend**

Sidebar krijgt het menu-item **Vragenlijsten**. Twee schermen: een overzicht van
vragenlijsten met hun rondes, en een detailscherm dat de vragen toont zoals de
leverancier ze ziet.

**Klaar wanneer:** je logt in, klikt op Vragenlijsten, en ziet de twee Transdev-lijsten
met hun 9 en 29 vragen — uit de database, niet uit mock data.

---

### Fase B — Een ronde starten en deelnemers uitnodigen

De kern van dit plan.

**Backend**

```
POST  /admin/survey/runs                 nieuwe ronde (draft), UC1 of UC2
PATCH /admin/survey/runs/:id/status      draft → active → finished → archived
POST  /admin/survey/runs/:id/participants  deelnemers toevoegen; geeft tokens terug
```

`@VereistRol('admin')` op alle drie: een reviewer mag lezen, niet uitzetten.

**Hier wordt `genereerToken()` voor het eerst in productiecode aangeroepen.** Dat is de
gevoeligste stap van dit plan, want het raakt de tokenlaag die al groen en bewezen is.

**Drie regels die het ontwerp al vastlegt en die hier gebouwd worden:**

- **Een onbekend e-mailadres wordt geweigerd en teruggemeld** (§2c, besluit opdrachtgever
  2026-07-29). Niet automatisch een vendor aanmaken: dat levert binnen een jaar dubbele
  records op, en het vendorbestand is de lijst waar de rapportage op leunt.
- **Het ruwe token bestaat één keer** — in het antwoord op deze route. Daarna alleen de
  hash. Dat betekent dat de beheerder de links op dát moment moet kunnen kopiëren of
  versturen; er is geen "toon nogmaals".
- **Een gestarte ronde bevriest de vragenlijst** (trigger in migratie 0005, bestaat al).
  Het scherm moet dat uitleggen vóór de beheerder op "starten" drukt, niet erna met een
  foutmelding.

**Alleen UC1 in deze ronde** (besluit eigenaar 2026-08-03). De route accepteert
`survey_kind` en het datamodel kent UC2, maar er komt één scherm: een lijst leveranciers
die elk over zichzelf invullen. UC2 vraagt een tweede schermflow met een andere
deelnemerskeuze (één leverancier, daarna de collega's die hem beoordelen), en dat verschil
achter een keuzerondje verbergen levert een scherm op dat beide dingen half doet.

De behoefte die achter UC2 leek te zitten — een Transdev-collega die iets vindt van een
leverancier — wordt in dit plan door het beoordelingsscherm ingevuld. Zie §2a.

**Klaar wanneer:** je start een ronde, voegt drie leveranciers toe, en krijgt drie
werkende tokenlinks die je in een incognitovenster kunt openen.

---

### Fase C — Voortgang, antwoorden lezen en beoordelen

**Twee migraties, bewust gescheiden**

*Migratie 1 — `app.current_actor`.* Raakt geen enkele bestaande policy en verandert geen
gedrag: hij voegt de variabele, de functie `clm.current_actor()` en de doorgifte in
`withTenant()` toe. Apart houden omdat hij ~tien aanroepers raakt en dus overal doorwerkt;
als er iets omvalt, wil je weten dat het hierdóór komt en niet door de nieuwe tabel.

Deze migratie is **eerst groen met alle bestaande tests** voordat de tabel erbij komt. Zie
de volgorde in §6.

*Migratie 2 — `survey_review`.* Kolommen: `review_id`, `tenant_id`, `response_id`,
`verdict`, `toelichting`, `reviewer_user_id`, `created_at`, `deleted_at`.

- `CHECK (verdict IN ('goed', 'nadere_vragen', 'niet_goed'))` — dezelfde vorm als de
  bestaande statuscontroles, zodat een typefout in code een databasefout wordt en niet een
  rij met onzin.
- **Geen** unieke sleutel op `response_id`: meerdere oordelen zijn het punt (§2a).
- `FORCE ROW LEVEL SECURITY` conform migratie 0011, met `USING` én `WITH CHECK`, en in
  beide de actor-eis erbij:
  ```sql
  USING      (tenant_id = clm.current_tenant_id() AND clm.current_actor() = 'medewerker')
  WITH CHECK (tenant_id = clm.current_tenant_id() AND clm.current_actor() = 'medewerker')
  ```
  De eis staat ook in `WITH CHECK`: zonder dat zou een leverancierspad wel kunnen
  schrijven wat het niet kan lezen — een lek dat pas opvalt als de rij er al staat.
- Beoordelen mag alleen op een ingediende respons. Dat is een controle in de service, niet
  in een constraint: de foutmelding moet uitleggen waaróm het niet kan.

*Migratie 3 — `template_reviewer`.* Toegevoegd op 2026-08-06 na de domeincontext van de
eigenaar; onderbouwing in **ADR-013**.

```
clm.template_reviewer
  ├── tenant_id      (RLS, zoals alles)
  ├── template_id    welke vragenlijst
  ├── user_id        wie hem beoordeelt
  └── created_at / created_by
```

- **De beoordelaar hangt aan de vragenlijst, niet aan de vendor of de ronde.** Beoordelen is
  vakinhoud, geen eigenaarschap: de CISO kan IT-compliance beoordelen voor élke vendor, de
  contractmanager van vendor X voor géén enkele.
- **Geen unieke sleutel op `template_id`** — meerdere beoordelaars zijn toegestaan. Bij
  Transdev is het er waarschijnlijk één, maar die gaat met vakantie.
- Zelfde RLS-behandeling als hierboven, inclusief de actor-eis in `USING` én `WITH CHECK`.
- **De koppeling is een hulpmiddel, geen guard.** Elke reviewer mag elke inzending
  beoordelen; de koppeling bepaalt wat je in je werkvoorraad ziet. Zie ADR-013 besluit 3 —
  een harde grens zou het proces stilleggen zodra de gekoppelde beoordelaar afwezig is, en
  de fallback is de contractmanager die dat intern regelt.

*Wat hier géén migratie voor nodig is:* de contractmanager. `clm.vendor.owner_user_id`
bestaat al sinds migratie 0000 en staat in `src/db/schema.ts`, maar wordt nergens gebruikt.
Fase C neemt hem in gebruik (ADR-013 besluit 1).

**Backend**

```
GET  /admin/survey/runs/:id/responses      status per deelnemer, wie wel/niet ingediend
GET  /admin/survey/responses/:id/answers   de antwoorden van één respons, incl. bijlagen
GET  /admin/survey/responses/:id/reviews   alle oordelen, nieuwste eerst
POST /admin/survey/responses/:id/reviews   nieuw oordeel vastleggen
```

Daarbij komt sinds ADR-013 dat de leesroutes **meeleveren van wie iets is** — de beheerder
van de vendor en of de ingelogde gebruiker aan de vragenlijst gekoppeld is. Zonder die
velden moet het scherm een tweede uitvraag doen om te kunnen sorteren, en dan kan die
tussentijds iets anders zien.

**Alle vier mogen door een reviewer** (besluit eigenaar 2026-08-03). Beoordelen ís de rol
van een reviewer; hem dat ontzeggen maakt de rol betekenisloos en maakt de admin een
flessenhals. Een reviewer mag nog steeds géén rondes starten, geen deelnemers toevoegen en
geen leveranciers wijzigen — die houden `@VereistRol('admin')`.

Dat dit verantwoord is, hangt aan één ding uit §2a: **elk oordeel is met naam en datum
vastgelegd en wordt nooit overschreven.** Een reviewer kan dus niets stilletjes veranderen —
hij kan alleen iets toevoegen dat zichtbaar van hem is. Zonder die historie zou ik hier
admin adviseren.

**Frontend**

Een voortgangsscherm per ronde (ingediend / open / verlopen), een leesscherm per respons,
en onder de antwoorden het beoordeelblok: drie knoppen plus een toelichtingsveld, met
daaronder de eerdere oordelen op datum.

**Twee werkvoorraden, geen twee filters op dezelfde lijst** (ADR-013). "Wat wacht er op
mij" betekent voor de twee rollen iets wezenlijk anders:

| Rol | Wat hij ziet |
|---|---|
| Contractmanager (`vendor.owner_user_id`) | rondes op vendors die ik beheer: wie moet nog invullen, wie is te laat, welke uitnodiging kwam niet aan |
| Beoordelaar (`template_reviewer`) | ingediende antwoorden op vragenlijsten waaraan ik gekoppeld ben, over alle vendors heen |

De CISO wil niet zien wie er nog moet invullen — daar gaat hij niet over. De
contractmanager wil niet de beoordeelstapel van de hele organisatie. Eén lijst met een
filter erop bedient allebei half.

Met een schakelaar **"van mij" / "hele organisatie"**: ADR-013 besluit 3 zegt dat de rest
zichtbaar moet blijven, want de koppeling is een hulpmiddel en geen grens.

Twee dingen in dat scherm die geen detail zijn:

- **Het huidige oordeel staat bij de leverancier in de voortgangslijst**, niet alleen op het
  detailscherm. Anders moet je zeventien schermen openen om te zien wie er nog openstaat —
  en dan wordt de lijst niet gebruikt.
- **`nadere_vragen` leest als een openstaande actie, niet als een eindoordeel.** Het scherm
  moet duidelijk maken dat de leverancier hier niets van merkt en dat de beheerder zelf
  contact opneemt (§2a). Een knop die suggereert dat er iets verstuurd wordt terwijl dat
  niet gebeurt, is erger dan geen knop.

**Twee dingen die hier scherp moeten:**

- **Verlopen is `closes_at < now()` bij status `active`** (§2b). Let op de asymmetrie die
  het ontwerp benoemt: de guard hanteert de striktste van `expires_at` (per token) en
  `closes_at` (per ronde). Een deadline verlengen op de ronde verlengt de tokens níét —
  dat moet zichtbaar zijn in het scherm, anders verlengt iemand de deadline en werkt de
  helft van de links alsnog niet.
- **De interne score (UC2) is niet zichtbaar voor de leverancier** — dat volgt al uit de
  architectuur, maar testpunt 39 uit het ontwerp bewaakt het. Dat testpunt hoort hier
  gebouwd te worden, want dit is de eerste plek waar iemand een route zou kunnen bouwen
  die op `subject_vendor_id` filtert in plaats van op `response_id`.

**Twee tegenproeven die bij ADR-013 horen** en die als paar gelezen moeten worden:

- **Een reviewer die niet aan de vragenlijst gekoppeld is, kan wél beoordelen.** Slaagt dit
  niet, dan is er per ongeluk een harde grens gebouwd en ligt het proces stil zodra de
  gekoppelde beoordelaar ziek is.
- **Diezelfde reviewer ziet die inzending níét in zijn eigen werkvoorraad.** De keerzijde:
  zonder deze tweede test kan de koppeling decoratie zijn zonder dat iets dat merkt.

**Klaar wanneer:** je ziet per ronde wie heeft ingevuld, kunt een ingediende respons lezen
inclusief de geüploade certificaten, en kunt hem beoordelen met Goed, Nadere vragen of Niet
goed — waarna dat oordeel in de voortgangslijst staat en een tweede oordeel het eerste niet
wist. En: een contractmanager ziet zijn eigen rondes, een beoordelaar zijn eigen stapel,
allebei met de mogelijkheid de rest van de organisatie erbij te halen.

---

### Fase D — Uitnodigingen versturen

**Dit is de fase met een externe afhankelijkheid en hoort daarom apart.**

Issue #13 (SMTP via Transdev) en OV-9 uit de klantvragen staan allebei nog open: de
SMTP-gegevens van `contractmanagement@transdev.nl` zijn er niet.

**Maar dat blokkeert minder dan gedacht.** Op 2026-08-03 nagekeken in
`C:\dev\Work\jouwcontractmanager`, op aanwijzing van de eigenaar: daar draait een werkende
uitnodigingsmail met portallink, en die is bruikbaar als voorbeeld.

**Wat daar te halen valt:**

| | Waar | Bruikbaar? |
|---|---|---|
| Resend als verzenddienst | `package.json`, `.env.local.example` | ✅ live, testflow bevestigd |
| Mailsjabloon met portalknop | `src/app/api/uitvragen/[id]/beoordelen/route.ts` r. 113–129 | ✅ als voorbeeld |
| Afzenderlabel "«klant» via «product»" | idem, r. 107 | ✅ precies wat Transdev nodig heeft |
| Testadressen via de plus-truc | `docs/OPSTARTEN.md` §5 | ✅ zie hieronder |
| Mailfout logt maar breekt niet | idem, r. 131 | ✅ juiste keuze, overnemen |

**Testen zonder echte leveranciers:** `cmaling+transdev1@gmail.com` is voor Resend een
apart adres, maar alles komt in dezelfde inbox aan. Daarmee is een hele ronde met vijf
"leveranciers" te doorlopen zonder één externe partij te mailen — en zonder een testmodus
in de code die in productie per ongeluk aan kan staan. Dat is de reden dat dit beter is dan
een `MAIL_UITGESCHAKELD`-vlag.

**Wat dit betekent voor de planning:** fase D kan gebouwd én getest worden met een eigen
Resend-account op een eigen domein. De SMTP-gegevens van Transdev zijn dan nog steeds nodig
— maar alleen om het afzenderadres te wisselen, niet om te kunnen bouwen. OV-9 is daarmee
een uitrolvraag geworden in plaats van een bouwblokkade.

**Twee dingen die níét zomaar overgenomen worden:**

- **De afwijzingsmail met terugstuurlink.** Dezelfde route stuurt bij afwijzen een nieuw
  token en een "vul opnieuw in"-link. Dat is precies het heropenen dat hier bewust niet
  gebouwd wordt (§2a) — én daar worden de oude antwoorden bij verwijderd (`delete()` op
  `uitvraag_antwoord`, r. 92–95). Voor MCM2 is dat onacceptabel: een compliance-dossier
  waarin het oorspronkelijke antwoord weg is, bewijst niets meer. Zie §5.
- **De mail wordt daar vanuit de webapplicatie verstuurd.** In MCM2 hoort dat in de backend,
  achter dezelfde guard als de rest — de frontend heeft geen tenantcontext.

---

## 4. Wat dit plan expliciet niet doet

- **Geen vraageditor.** Vragenlijsten samenstellen in een scherm is een eigen project:
  acht antwoordtypen met elk hun eigen `config`, plus de bevriezingsregel en versionering.
  Importeren via JSON werkt al (§2d) en dekt de behoefte tot de eerste tenant zijn eigen
  lijst wil opstellen.
- **Geen UC2.** De interne vragenlijst waarbij een collega een eigen set vragen over een
  leverancier beantwoordt, blijft in het datamodel staan maar wordt niet gebouwd (besluit
  eigenaar 2026-08-03). Wat wél gebouwd wordt is beoordelen van een ingediende UC1-respons;
  het verschil staat in §2a.
- **Geen terugsturen naar de leverancier.** `nadere_vragen` markeert, heropent niet (§2a).
  Blijkt een aanvulling nodig, dan volgt een volledige tweede ronde met een nieuw token —
  bestaande mechaniek, en het levert een dossier op van ronde 1 náást ronde 2 in plaats van
  een overschreven antwoord.
- **Geen enkele leveranciersinzage in beoordelingen.** Niet het oordeel, niet de
  toelichting, niet indirect. Dit is met een policy afgedwongen en niet met de afwezigheid
  van een route (§2a).
- **Geen rapportage of scores.** Categoriescores met `min_answers` staan in het datamodel
  maar zijn een presentatielaag die pas betekenis krijgt zodra er echte antwoorden zijn.
- **Geen herinneringen.** Issue #16 raakt dit (export- en reminder-acties met expliciete
  tenantId) maar hangt aan fase D.
- **Geen export.** OV-4 (exportformaat) is nog open bij de klant.
- **Geen contractlaag.** In het domein hangt een complianceverplichting aan het contract,
  niet aan de vendor (domeincontext eigenaar 2026-08-06). Voor de pilot verandert dat
  niets: alle Transdev-vendors hebben dezelfde verplichting en er is één vragenlijst, dus
  een contractlaag zou vandaag voor iedereen hetzelfde antwoord geven. Wat er verschuift
  zodra contracten er wél zijn, staat in ADR-013 besluit 4 — zodat dit een bewuste
  beperking blijft en geen vergeten laag.

---

## 5. Risico's en aandachtspunten

**Fase B raakt bestaande, groene code.** De tokenlaag is bewezen en heeft eigen tests. Een
route die tokens uitgeeft is nieuw gedrag op een oud fundament — daar hoort een tegenproef
op de tokenuitgifte bij (bijvoorbeeld: het ruwe token per ongeluk opslaan, of een token
uitgeven voor een andere tenant).

**De statuscontrole in de guard bestaat al** (migratie 0006, "ronde-status in guard"),
maar er is nog nooit een ronde van status veranderd via een route. Fase B is de eerste
keer dat die overgang in productiecode gebeurt.

**Twee tenants in elke test.** Elke nieuwe route is een nieuwe kans om de tenantgrens te
missen. Dat is bij 2c twee keer aangetoond met een tegenproef; dezelfde discipline geldt
hier.

**Het naburige project laat zien wat er misgaat bij heropenen.** In jouwcontractmanager
(`src/app/api/uitvragen/[id]/beoordelen/route.ts`) verwijdert de afwijsactie álle antwoorden
van de leverancier en geeft een nieuw token uit. Voor dat product is dat verdedigbaar: het
gaat om één certificaat aanleveren, en een half ingevuld formulier heeft daar geen
bewijswaarde.

Voor MCM2 zou dezelfde keuze het instrument ondermijnen. Wat een leverancier oorspronkelijk
verklaarde, ís hier het bewijsmateriaal — dat is de reden dat migratie 0005 een
bevriezingstrigger heeft en dat `survey_answer` na indienen alleen nog leesbaar is.

Dit is geen kritiek op dat project maar een concreet voorbeeld van waarom "nadere vragen"
hier een tweede ronde wordt en geen heropening (§2a): bij een tweede ronde staat ronde 1
compleet naast ronde 2, en is achteraf vast te stellen wat er veranderd is en wanneer.

**De beoordeling is een nieuw soort gevoelige data.** Tot nu toe was de vraag steeds "mag
tenant A bij tenant B?". Bij `survey_review` komt er een tweede grens bij: **mag de
leverancier bij het oordeel over zichzelf?** Dat is een ander soort lek — de leverancier
hééft een geldig token voor die respons, dus een route die op `response_id` filtert zonder
naar de sessie te kijken, geeft hem netjes antwoord.

De tegenproef die daarbij hoort — en die geschreven moet worden vóórdat de route bestaat:
**voeg `survey_review` toe aan wat `VragenlijstLeesService` teruggeeft** (het leveranciers-
pad) en controleer dat een test faalt. Faalt er niets, dan test niemand de grens zelf maar
alleen de plek waar hij toevallig niet zichtbaar is.

Met de sterke variant (§2a) is dat een échte tegenproef en geen formaliteit: het leespad
draait onder `app.current_actor = 'leverancier'`, dus de policy geeft nul rijen terug. De
test hoort dan te falen op "het oordeel ontbreekt" — precies het bewijs dat de grens in de
database ligt en niet in de gewoonte om de juiste route te schrijven.

Dat is exact de les uit §15b van MCM2-CLAUDE.md, tegenproef 6: `tenantId` werd toegevoegd
aan `/auth/sessie` en alle acht browsertests bleven groen, omdat de sidebar dat veld niet
toont. **Test een lek bij de bron, niet waar je hoopt dat het niet opduikt.**

**Tweede tegenproef, op de actor zelf.** De eerste bewijst dat de policy werkt zolang de
actor klopt. Deze bewijst dat de actor niet stilletjes verkeerd kan staan: **zet in één
tokenpad `'medewerker'` in plaats van `'leverancier'`** en controleer dat een test faalt.
Zonder deze tweede proef is de hele constructie afhankelijk van tien aanroepers die het
goed doen, zonder dat iets dat bewaakt.

---

## 6. Voorstel voor de volgorde

Fase A → B → C, dan **fase 4 van het vorige plan** (OTAP-doorloop uitbreiden met álles wat
er dan staat), dan fase D zodra de SMTP-gegevens er zijn.

**Eén uitzondering op die volgorde: `app.current_actor` mag vooruit.** Die migratie (§ fase
C, migratie 1) hangt nergens van af — hij voegt alleen een variabele toe en verandert geen
gedrag. Hem los draaien vóór fase A heeft twee voordelen: hij raakt ~tien aanroepers, en dat
wil je uitzoeken tegen een codebase die verder stilstaat. En zodra hij er is, kan elke route
die in A en B gebouwd wordt meteen de juiste actor meegeven — in plaats van dat ze in fase C
alsnog langsgelopen moeten worden.

Dat is een halve dag die zichzelf terugbetaalt zodra fase B begint.

Reden om de OTAP-doorloop ná C te doen en niet ertussen: die test wat er ís. Elke fase die
erna komt moet er alsnog in — één keer uitbreiden aan het eind is minder werk dan drie keer
tussendoor. Voorwaarde is wel dat elke fase blijft eindigen met `verify:volledig` groen
plus een tegenproef, anders wordt fase 4 een opruimactie in plaats van een uitbreiding.

---

## 7. Vragen voor de eigenaar

**Alles beantwoord op 2026-08-03. Er blokkeert niets meer.**

| Vraag | Antwoord | Waar het landt |
|---|---|---|
| UC2 in deze ronde of later? | later — alleen UC1 | fase B, §2a |
| Stuurt "nadere vragen" de lijst terug? | nee, markeren en zelf contact opnemen | §2a |
| Wordt een oordeel overschreven? | nee, elk oordeel blijft bewaard | §2a |
| Ziet de leverancier het oordeel? | nee, en dat wordt met een policy afgedwongen | §2a |
| Moet Transdev zelf vragen kunnen opstellen? | nee, JSON-import volstaat voorlopig | §4 |
| Mag een reviewer beoordelen? | ja, lezen én beoordelen | fase C |
| Hoe komen de tokenlinks bij de leverancier? | kopieerbaar in het scherm; e-mail volgt in fase D | fase B, fase D |
