# Ontwerp — vragenlijst-tool, antwoorden en certificaat-upload

**Datum:** 2026-07-28
**Status:** ⚠️ **ONVOLLEDIG — herschreven na koerswijziging, wacht op één antwoord.** Niet bouwen.
**Issues:** #9 (certificaat-upload, AC13), en het inhoudelijke deel van #7 dat OV-6/OV-8 blokkeerde
**Bron:** `Transdev Annual Vendor IT Risk SurveyV1_0.md` (aangeleverd 2026-07-28)
**Bouwt voort op:** `2026-07-28-leveranciertoken-ontwerp.md` (toegang), dat hier als gegeven geldt

---

## 0. Lees dit eerst — de scope is op 2026-07-28 gecorrigeerd

De eerste versie van dit document ging ervan uit dat de acht Transdev-vragen **de** vragenlijst
waren, en legde ze daarom vast in code met een uitgebreide onderbouwing waarom een beheerscherm
onwenselijk zou zijn.

**Dat was een verkeerde lezing van de opdracht.** De opdrachtgever heeft het rechtgezet:

> "wat er gebouwd moet worden is een tool waarmee vragen kunnen worden opgesteld door de tenant.
> de eerste poc van deze vraagopstel tool zijn deze 8 vragen met dit type antwoorden."

Het te bouwen product is dus een **vragenlijst-tool**. De acht Transdev-vragen zijn de eerste
vulling en de PoC-casus — niet de scope. De vragen horen daarmee in de **database**, met beheer
eromheen, niet in de codebase.

Alles hieronder is op die correctie herschreven. Wat uit de eerste versie ongewijzigd overeind
blijft: de antwoordopslag (§4), de toelichtingsregels (§3), de bestandsvalidatie (§6) en de
RLS-garanties. Alleen de herkomst van de vragen verschuift.

**Dit ontwerp is nog niet af.** Eén vraag aan de opdrachtgever staat open en bepaalt de omvang —
zie §1. Zonder dat antwoord is §2 (het schema voor de vragen) niet definitief in te vullen.

---

## 1. OPENSTAAND — hoeveel vrijheid krijgt de tenant?

Dit is de vraag die de omvang bepaalt en die vóór het bouwen beantwoord moet zijn.

| | Niveau | Wat de tenant kan | Dekt de 8 vragen? |
|---|---|---|---|
| **A** | Vaste vraagvorm, vrije tekst | Vraagteksten schrijven, volgorde bepalen, per vraag aangeven of er een upload bij hoort. Antwoordtype is altijd het bevestigingstype uit §3. | ja, volledig |
| **B** | Meerdere antwoordtypen | Als A, plus per vraag kiezen: bevestiging, meerkeuze, vrije tekst, ja/nee, datum. | ja, ruim |
| **C** | Volledige formulierbouwer | Als B, plus voorwaardelijke logica ("als vraag 3 = nee, toon 3a"), secties, herhaalbare blokken. | ja, zeer ruim |

**Advies: A voor de PoC, met een datamodel dat B mogelijk maakt zonder verbouwing.**

Onderbouwing: alle acht vragen hebben exact hetzelfde antwoordtype. Er is nog geen tweede vraagvorm
om tegen te ontwerpen. Een abstractie bouwen voor variatie die je nog niet gezien hebt, levert
doorgaans de verkeerde abstractie op — die kost later meer dan hij nu bespaart.

Het datamodel in §2 is bewust zo gekozen dat B erbij past: `answer_type` staat al als kolom in
`survey_question`, met voorlopig één toegestane waarde. Uitbreiden naar B is dan een nieuwe waarde
plus de bijbehorende validatie, geen migratie van bestaande gegevens.

C is een apart product en zou ik niet in dit spoor halen.

---

## 2. De vragen in de database

### `clm.survey_question`

De template bestaat al (`clm.survey_template`, met `name` en `version`); die krijgt nu vragen.

```
question_id     UUID PK
tenant_id       UUID NOT NULL              → RLS-kolom
template_id     UUID NOT NULL              → clm.survey_template, ON DELETE RESTRICT
position        INTEGER NOT NULL           → volgorde, 1-based
question_key    TEXT NOT NULL              → 'q1' … 'q8', stabiel over versies heen
title           TEXT NOT NULL              → korte kop ("ISO 27001 Certification Evidence")
body            TEXT NOT NULL              → de volledige vraagtekst
answer_type     TEXT NOT NULL              → nu alleen 'confirmation' (zie §1)
allows_upload   BOOLEAN NOT NULL DEFAULT false
max_files       SMALLINT NOT NULL DEFAULT 0
created_at      TIMESTAMPTZ NOT NULL
```

| Constraint | Dwingt af |
|---|---|
| `UNIQUE (template_id, question_key)` | Eén vraag per key binnen een versie |
| `UNIQUE (template_id, position)` | Geen twee vragen op dezelfde plek |
| `CHECK (answer_type IN ('confirmation'))` | Uitbreidbaar naar B door de lijst te verlengen |
| `CHECK (allows_upload = false OR max_files BETWEEN 1 AND 5)` | Een upload zonder maximum kan niet bestaan |
| `CHECK (allows_upload = true OR max_files = 0)` | Een maximum zonder upload evenmin |
| `template_id → survey_template ON DELETE RESTRICT` | Vragen verdwijnen niet stilzwijgend |

`question_key` is bewust een stabiele tekstsleutel naast de UUID. Bij een nieuwe templateversie
krijgt vraag 4 een nieuwe `question_id`, maar behoudt `question_key = 'q4'` — zo blijven antwoorden
over versies heen vergelijkbaar. Zonder dat is een jaar-op-jaar-vergelijking niet te maken, en dat
is bij een jaarlijkse compliance-survey precies het punt.

Voor Transdev vraag 1: `allows_upload = true`, `max_files = 2`.

### Een lopende ronde bevriest de vragenlijst

Dit is de regel die de tool inhoudelijk lastig maakt, en die vastgelegd moet worden vóór het bouwen.

Een tenant wijzigt vraag 4 terwijl twaalf leveranciers midden in het invullen zitten. Wat dan?

**Voorstel: wijzigen mag altijd, maar raakt alleen nieuwe rondes.** Op het moment dat een
`survey_run` start, ligt de templateversie vast. De run verwijst al naar `template_id`, en een
template met een lopende run is niet meer te wijzigen — alleen te kopiëren naar een nieuwe versie.

Zonder die bevriezing krijg je antwoorden op vragen die inmiddels anders luiden. Bij een
compliance-instrument dat contractueel bewijsmateriaal oplevert, is dat onbruikbaar: je kunt
achteraf niet vaststellen waar iemand precies mee heeft ingestemd.

Concreet betekent dat:

| Toestand van de template | Wijzigen | Kopiëren naar nieuwe versie |
|---|---|---|
| Geen enkele run | ja | ja |
| Eén of meer runs gestart | **nee** | ja |

Dit is de reden waarom `survey_template.version` bestaat. Tot nu toe had die kolom geen betekenis;
hier krijgt hij hem.

**Afdwingen in de database, niet alleen in code.** Een `UPDATE` op een vraag van een bevroren
template moet falen op een trigger of policy, niet op een `if` in de servicelaag. Anders is de
garantie zo sterk als de code die hem toevallig niet omzeilt — en dit is een garantie waar
bewijskracht aan hangt.

### Wie mag beheren

De beheerderskant loopt via spoor 1 (Entra External ID), en die guard bestaat nog niet.

**Voorstel: het datamodel en de validatie nu bouwen, de beheerroutes achter de guard hangen zodra
spoor 1 er is.** De leverancierskant kan dan al werken tegen een vragenlijst die via een seed of
migratie in de database staat — de acht Transdev-vragen zijn precies zo'n seed.

Dat maakt de beheer-UI een afgebakende volgende stap in plaats van een blokkade voor de hele flow.

---

## 3. Het antwoordmodel

### Drie opties, plus één bij een uploadvraag

| Code | Label (EN) | Beschikbaar bij |
|---|---|---|
| `confirmed` | I confirm | elke vraag |
| `not_confirmed` | I do not confirm | elke vraag |
| `not_applicable` | Not applicable | elke vraag |
| `cannot_upload` | I cannot upload our Certificate or SoA because… | **alleen `allows_upload = true`** |

De vierde optie is in de eerste versie van dit ontwerp vastgeklonken aan "vraag 1". Dat is nu
gegeneraliseerd: hij hoort bij elke vraag die een upload vraagt. Bij een tool die de tenant zelf
vult, is "vraag 1" geen stabiel gegeven.

Waarom de optie bestaat: een upload kan mislukken om redenen die niets met compliance te maken
hebben — bestand te groot, certificaat bij een andere afdeling, NDA-beperking. Zonder deze optie
moet een leverancier kiezen tussen een onjuist antwoord en helemaal niet indienen.

De labels zijn Engels en staan vast in de code; alleen de vraagteksten komen uit de database. Dat
is een bewuste beperking van niveau A (§1).

### Wanneer een toelichting verplicht is

| Antwoord | Toelichting |
|---|---|
| `confirmed` | optioneel |
| `not_confirmed` | **verplicht** |
| `not_applicable` | **verplicht** |
| `cannot_upload` | **verplicht** |

De regel is één zin: **alles behalve een bevestiging vereist uitleg.**

Waarom `not_confirmed` ook verplicht is: dat is inhoudelijk het zwaarste antwoord dat een
leverancier kan geven. Bij Transdev-vraag 4 betekent het letterlijk "er zijn incidenten geweest die
niet binnen 48 uur gemeld zijn". Zonder verplichte toelichting krijgt de opdrachtgever een rood
vinkje zonder context en moet er alsnog achteraan gebeld worden — precies het handwerk dat dit
systeem moet wegnemen.

> **Aanname, niet bevestigd.** De opdrachtgever bevestigde de verplichte toelichting bij
> `not_applicable` en `cannot_upload`. Voor `not_confirmed` is dit mijn afleiding. Het is één regel
> in de validatietabel; als het anders moet, kost het geen herontwerp.

### Grenzen aan de toelichting

| | |
|---|---|
| Minimaal (indien verplicht) | 10 tekens na het wegstrepen van spaties |
| Maximaal | 2.000 tekens |

De ondergrens houdt "n/a" en "-" tegen. Die maken het veld formeel gevuld en inhoudelijk leeg, en
zijn daarmee erger dan een leeg veld: in een overzicht zien ze eruit als een antwoord.

10 tekens garandeert geen kwaliteit — "not relevant" haalt het net. Maar het is de grens waaronder
een antwoord aantoonbaar geen informatie draagt. Verder gaan vraagt inhoudelijke beoordeling, en
die hoort bij de opdrachtgever, niet bij een validatieregel.

---

## 4. Schema voor de antwoorden

Twee tabellen naast `survey_question`, beide tenantgebonden, beide met RLS en `USING` + `WITH CHECK`
conform MCM2-CLAUDE.md §7.

### `clm.survey_answer`

```
answer_id       UUID PK
tenant_id       UUID NOT NULL              → RLS-kolom
response_id     UUID NOT NULL              → clm.survey_response, ON DELETE RESTRICT
question_id     UUID NOT NULL              → clm.survey_question, ON DELETE RESTRICT
answer          TEXT NOT NULL              → confirmed | not_confirmed | not_applicable | cannot_upload
comment         TEXT NULL
created_at      TIMESTAMPTZ NOT NULL
updated_at      TIMESTAMPTZ NULL           → concept mag bijgewerkt worden (§7)
```

| Constraint | Dwingt af |
|---|---|
| `UNIQUE (response_id, question_id)` | Eén antwoord per vraag per response |
| `CHECK (answer IN (...))` | Geen ongeldige waarde door een bug |
| `CHECK (answer = 'confirmed' OR length(btrim(comment)) >= 10)` | Toelichtingsplicht op databaseniveau |
| `question_id → survey_question ON DELETE RESTRICT` | Antwoorden verdwijnen niet stilzwijgend |

**Verschil met de eerste versie:** `question_id` als echte foreign key, niet `question_key` als
losse tekst. Nu de vragen in de database staan, is er een tabel om naar te verwijzen — en dan hoort
de koppeling ook door de database bewaakt te worden.

De derde constraint is de kern: dezelfde regel als §3, maar afgedwongen door de database. Een fout
in de validatiecode levert dan een databasefout op, geen halfleeg compliance-antwoord dat er
volledig uitziet.

**Wat de database niet kan afdwingen:** dat `cannot_upload` alleen voorkomt bij een vraag met
`allows_upload = true`. Dat vereist een blik op een andere tabel, wat een CHECK niet kan. Dit hoort
in de validatie én in een trigger — zie testpunt 17 in §8.

### `clm.survey_attachment`

```
attachment_id   UUID PK
tenant_id       UUID NOT NULL              → RLS-kolom
response_id     UUID NOT NULL              → ON DELETE RESTRICT
question_id     UUID NOT NULL              → welke vraag dit bestand hoort
original_name   TEXT NOT NULL              → zoals de leverancier hem aanleverde
storage_key     TEXT NOT NULL UNIQUE       → waar het bestand staat, door de server bepaald
content_type    TEXT NOT NULL              → application/pdf of image/png
byte_size       INTEGER NOT NULL
sha256          TEXT NOT NULL              → integriteitscontrole
created_at      TIMESTAMPTZ NOT NULL
```

| Constraint | Dwingt af |
|---|---|
| `CHECK (byte_size > 0 AND byte_size <= 5242880)` | 5 MB, op databaseniveau |
| `CHECK (content_type IN ('application/pdf','image/png'))` | Alleen de twee toegestane typen |
| `UNIQUE (storage_key)` | Geen twee rijen wijzen naar hetzelfde bestand |

**Het maximum aantal bestanden staat bewust niet in een CHECK.** Dat maximum komt nu uit
`survey_question.max_files` en varieert dus per vraag; een CHECK kan noch over meerdere rijen tellen
noch een andere tabel raadplegen. De telling gebeurt in de transactie, met `SELECT … FOR UPDATE` op
de responserij zodat twee gelijktijdige uploads elkaar niet passeren — hetzelfde patroon als bij het
indienen in het tokenontwerp §5.

**`original_name` en `storage_key` zijn gescheiden.** De leverancier bepaalt de eerste, de server de
tweede. Een bestandsnaam van buiten mag nooit een pad worden: `../../etc/passwd.pdf` is een geldige
bestandsnaam. `storage_key` wordt `<tenant_id>/<response_id>/<uuid>` — volledig servergegenereerd,
geen enkel teken uit de invoer.

**`sha256` van de inhoud.** Bij een compliance-bewijsstuk moet later aantoonbaar zijn dat het
bestand niet gewijzigd is sinds indiening. Dezelfde redenering als achter de append-only audit trail.

---

## 5. Validatie — drie lagen, aflopend van vriendelijk naar hard

| Laag | Wat | Waarom daar |
|---|---|---|
| Browser | Directe terugkoppeling bij het typen | Gemak. Bewijst niets. |
| Server | Volledige regelset vóór het schrijven | Hier valt de beslissing |
| Database | CHECK-constraints uit §4 | Vangnet als de server een fout heeft |

De browserlaag telt niet mee als beveiliging. Een leverancier kan de POST direct sturen; dat is geen
aanval maar normaal gedrag van iemand met een script.

### Wat de server controleert bij het indienen

```
1.  Tokencontrole (bestaand, ontwerp §5 + §5a)          → 404 / 410
2.  Alle vragen van deze template beantwoord?           → 422, met de ontbrekende keys
3.  Onbekende question_id meegestuurd?                  → 422
4.  Hoort de question_id bij de template van deze run?  → 422
5.  Antwoordwaarde geldig voor déze vraag?              → 422  (cannot_upload alleen bij upload)
6.  Toelichting verplicht en aanwezig, ≥ 10 tekens?     → 422, per vraag benoemd
7.  Toelichting ≤ 2.000 tekens?                         → 422
8.  Bij confirmed op een uploadvraag: ≥ 1 bestand?      → 422
9.  Aantal bestanden ≤ max_files van die vraag?         → 422
10. Atomair indienen (bestaand, ontwerp §5)             → 410 bij tweede poging
```

Stap 4 is nieuw ten opzichte van de eerste versie en is niet cosmetisch: nu vragen per tenant
verschillen, moet gecontroleerd worden dat een meegestuurde `question_id` daadwerkelijk bij de
template van *deze* run hoort. Zonder die controle kan een `question_id` van een andere template
meeliften. RLS beschermt tegen een andere *tenant*, niet tegen een andere template binnen dezelfde
tenant.

**Stap 2 t/m 9 vóór stap 10.** Eerst alles valideren, dan pas de status op `submitted` zetten. Bij
een fout in stap 6 mag de response niet half ingediend achterblijven — dan is de link verbruikt
terwijl er niets bruikbaars staat, en dat is onherstelbaar omdat het token gehasht is.

Alles gebeurt in één transactie: antwoorden, statuswijziging en auditregel. Faalt er iets, dan
blijft de link gewoon werken.

### Foutmeldingen benoemen de vraag

Een `422` die alleen "validation failed" zegt, is voor een leverancier onbruikbaar:

```json
{
  "status": "invalid",
  "errors": [
    { "question": "q4", "reason": "comment_required" },
    { "question": "q6", "reason": "comment_too_short" }
  ]
}
```

`question_key`, niet `question_id` — de sleutel is voor een mens leesbaar en lekt geen intern ID.
Geen tenant, geen vendor, geen response-ID: dezelfde terughoudendheid als bij de GET in het
tokenontwerp.

---

## 6. Bestandsvalidatie: de inhoud, niet de naam

Een bestand heet `certificaat.pdf` en bevat een uitvoerbaar programma. De extensie zegt niets, de
door de browser meegestuurde `Content-Type` ook niet — beide komen van de client.

De server controleert de eerste bytes van het bestand zelf:

| Type | Kenmerk aan het begin van het bestand |
|---|---|
| PDF | `%PDF-` |
| PNG | `\x89PNG\r\n\x1a\n` |

Komt dat niet overeen met wat er beweerd wordt, dan wordt het bestand geweigerd. De opgeslagen
`content_type` is wat de server heeft vastgesteld, niet wat de client claimde.

### Grens vóór het lezen, niet erna

De groottelimiet wordt afgedwongen tijdens het ontvangen, niet nadat het bestand binnen is. Een
upload van 500 MB moet afgebroken worden bij 5 MB — anders is de limiet een geheugenprobleem in
plaats van een validatieregel.

### Wat dit ontwerp niet doet: virusscan

OV-7 vroeg om een scanvereiste. Die is niet beantwoord, en dit ontwerp bouwt geen scan.

Dat betekent concreet: **een leverancier kan een besmet bestand uploaden, en het wordt bewaard.**
Het risico is beperkt zolang het bestand alleen gedownload wordt door een beheerder die het in een
PDF-viewer opent — maar het is niet nul, en het hoort een bewuste keuze te zijn.

Wat wél gebeurt, en het risico verkleint:

- Het bestand wordt nooit uitgevoerd of geïnterpreteerd door de server
- `storage_key` is servergegenereerd, dus een bestandsnaam kan geen pad worden
- Bij downloaden gaat het mee als `Content-Disposition: attachment` met de vastgestelde
  `content_type` — nooit inline gerenderd, nooit met een type dat de client bepaalde

Aanbeveling: een scan toevoegen vóór productie. Als losse stap uitvoerbaar zonder dit ontwerp te
wijzigen — het haakpunt is het moment tussen ontvangen en opslaan. **Aparte issue.**

### Waar de bestanden staan

Fase 1 (pilot): op schijf, onder een pad dat niet publiek bereikbaar is, met `storage_key` als
relatief pad. Downloaden kan alleen via een route die de tokencontrole of de
beheerdersauthenticatie passeert — er is geen URL die het bestand rechtstreeks serveert.

Dat is bewust de eenvoudigste vorm die werkt. Objectopslag (S3, Supabase Storage) is de logische
volgende stap, maar voegt in de pilot een externe afhankelijkheid toe zonder een probleem op te
lossen dat we nu hebben. `storage_key` is zo gekozen dat de verhuizing later geen schemawijziging
vereist.

**Let op — dit raakt de backupsituatie uit Issue #30.** De database gaat mee in
`npm run backup:dump`; bestanden op schijf niet. Zonder aanvulling zijn de certificaten het enige
onderdeel van de applicatie zonder backup — en juist het onderdeel dat bewijsmateriaal bevat. Dit
moet meegenomen worden in de dagelijkse backuptaak die nog ingericht wordt.

---

## 7. De routes

### Leverancierskant

Aansluitend op de bestaande `SurveyResponseController`, met de guard op controllerniveau.

| Route | Doel |
|---|---|
| `GET /survey/respond/questions?t=…` | De vragen van deze run plus eventueel al opgeslagen concept |
| `PUT /survey/respond/answers?t=…` | Concept opslaan (nog niet indienen) |
| `POST /survey/respond/attachment?t=…` | Eén bestand uploaden, vóór het indienen |

De bestaande `POST /survey/respond` krijgt een body met de antwoorden. Dat is een wijziging van een
route die nu een lege body accepteert — de bestaande test in
`test/survey-routes.e2e-spec.ts` moet daarop aangepast worden.

### Beheerderskant

Achter de Entra-guard uit spoor 1, dus **nog niet te bouwen** (§2). Voor de volledigheid vastgelegd:

| Route | Doel |
|---|---|
| `GET/POST/PUT /admin/survey/templates` | Vragenlijsten beheren |
| `POST /admin/survey/templates/:id/copy` | Nieuwe versie afsplitsen van een bevroren template |
| `GET/POST/PUT/DELETE /admin/survey/templates/:id/questions` | Vragen beheren |

### Concept opslaan

Acht vragen met verplichte toelichtingen vul je niet in één keer in. Iemand die bij vraag 6 moet
nazoeken of dat incident wel binnen 48 uur gemeld is, verliest bij het sluiten van het tabblad
alles — en het token is niet opnieuw te versturen, want het is gehasht.

Daarom: **antwoorden mogen opgeslagen worden vóór het indienen.** `survey_answer`-rijen bestaan
terwijl de response nog `pending` is; indienen zet alleen de status. Dat werkt zonder extra
tabellen, mits het schrijven geblokkeerd wordt zodra de status `submitted` is — anders is de
éénmaligheid uit AC12 alsnog omzeilbaar.

Die blokkade hoort in de RLS-policy, niet alleen in code:

```sql
-- WITH CHECK op survey_answer: schrijven mag alleen zolang de bijbehorende
-- response nog openstaat. Een bug in de applicatie kan dit niet omzeilen.
EXISTS (
    SELECT 1 FROM clm.survey_response r
     WHERE r.response_id = survey_answer.response_id
       AND r.tenant_id   = clm.current_tenant_id()
       AND r.status      = 'pending'
)
```

Hetzelfde geldt voor `survey_attachment`: na indienen geen uploads meer.

**Let op bij een concept:** de CHECK-constraint op de toelichtingsplicht (§4) geldt óók tijdens het
opslaan van een concept. Iemand die vraag 4 alvast op `not_confirmed` zet zonder toelichting, kan
dat concept niet bewaren. Dat is streng maar verdedigbaar; het alternatief (de constraint pas bij
indienen afdwingen) betekent dat de database de garantie niet meer draagt. Als dit in de praktijk
knelt, is de oplossing een aparte conceptstatus per antwoord — niet het weghalen van de constraint.

---

## 8. Wat bewezen moet worden

Aanvullend op de 13 punten uit het tokenontwerp §6:

| # | Bewijs |
|---|---|
| 14 | Indienen met één ontbrekende vraag faalt; de response blijft `pending` |
| 15 | `not_confirmed` zonder toelichting faalt — in de applicatie én bij een directe INSERT |
| 16 | Een toelichting van "   -   " faalt op de ondergrens |
| 17 | `cannot_upload` bij een vraag met `allows_upload = false` faalt |
| 18 | `confirmed` op een uploadvraag zonder bestand faalt |
| 19 | Een bestand boven `max_files` faalt; ook bij twee gelijktijdige uploads blijft het maximum staan |
| 20 | Een `.pdf` met PNG-inhoud wordt geweigerd op de bytes, niet op de naam |
| 21 | Een bestand van 5 MB + 1 byte wordt geweigerd tijdens ontvangst |
| 22 | Een bestandsnaam met `../` levert een `storage_key` op zonder padverwijzing |
| 23 | Na `submitted` faalt een INSERT op `survey_answer` — op de RLS-policy, niet op code |
| 24 | Antwoorden van tenant A zijn onzichtbaar met de context van tenant B |
| 25 | Een mislukte validatie laat geen halve antwoordset achter (transactie teruggerold) |
| 26 | Een `question_id` van een andere template binnen dezelfde tenant wordt geweigerd (§5 stap 4) |
| 27 | Een vraag van een template met een lopende run is niet te wijzigen — op databaseniveau |
| 28 | Kopiëren naar een nieuwe versie laat lopende responses ongemoeid |

Punt 15, 23 en 27 zijn de belangrijkste: die toetsen dat de garantie in de database zit en niet
alleen in de applicatiecode. Alle drie moeten getest worden met directe SQL die de applicatielaag
overslaat — anders test je je eigen validatiecode en niet de garantie.

Punt 25 sluit het risico af waar §5 voor waarschuwt: een half verbruikte link is onherstelbaar.

Punt 26, 27 en 28 zijn nieuw en vloeien rechtstreeks voort uit de koerswijziging: zodra de tenant
zelf vragen opstelt, ontstaan fouten die bij een vaste vragenlijst niet konden bestaan.

---

## 9. Bewust niet opgelost

| Onderwerp | Reden |
|---|---|
| Antwoordtypen naast bevestiging | Niveau B uit §1; datamodel is erop voorbereid |
| Voorwaardelijke logica, secties | Niveau C uit §1; apart product |
| Virusscan | OV-7 onbeantwoord; risico en haakpunt benoemd in §6. Aparte issue. |
| Nederlandse vertaling | Alleen Engels, zoals besloten. Structuur belet een latere vertaling niet. |
| Objectopslag | Fase 2; `storage_key` is er al op voorbereid |
| Beheer-UI | Wacht op spoor 1 (Entra-guard); datamodel en validatie kunnen vooruit |
| Herinneringsmails | Wacht op OV-9 (SMTP) |
| Export van ingediende antwoorden | OV-4, apart spoor |

---

## 10. Volgorde (na goedkeuring van §1)

1. Migratie: `survey_question`, `survey_answer`, `survey_attachment` — met RLS, policies,
   CHECK-constraints en de bevriezingstrigger uit §2
2. Seed met de acht Transdev-vragen als template `transdev-annual-vendor-it-risk` v1
3. Validatie- en indienlogica; `POST /survey/respond` uitbreiden met de antwoordbody
4. `GET /survey/respond/questions` en `PUT /survey/respond/answers` (concept)
5. Bestandsupload met inhoudscontrole
6. Tests 14 t/m 28
7. Issue aanmaken voor de virusscan; backup van bestanden meenemen in #30
8. Beheerroutes zodra spoor 1 (Entra-guard) er is

Stap 1 is de plek waar het misgaat als het misgaat: drizzle-kit genereert geen RLS, geen
CHECK-constraints en geen triggers — die zijn handwerk, zoals in ADR-010 vastgelegd en bij migratie
0003 al gebleken.

---

## 11. Openstaande punten

- **BLOKKEREND — niveau A, B of C** (§1). Zonder dit antwoord is §2 niet definitief.
- **Bevriezing van een lopende ronde** (§2) is mijn voorstel, niet bevestigd. Het is de regel die
  bepaalt of antwoorden achteraf nog interpreteerbaar zijn.
- **Verplichte toelichting bij `not_confirmed`** is mijn afleiding, niet bevestigd (§3).
- **5 MB per bestand, niet totaal.** Bij twee bestanden is de bovengrens dus 10 MB. Zo gelezen uit
  "files not larger than 5MB".
- **Geen virusscan** (§6). Risico benoemd; de keuze om zonder te gaan is aan de opdrachtgever.
- **Bestanden vallen buiten de huidige backup** (§6, raakt #30).
- **De bestaande `POST /survey/respond`-test** verwacht een lege body en moet aangepast worden.
  Geen ontwerpkwestie, wel werk dat niet vergeten mag worden.
- **Conceptopslag botst met de toelichting-constraint** (§7). Verdedigbaar, maar het kan in de
  praktijk knellen.
