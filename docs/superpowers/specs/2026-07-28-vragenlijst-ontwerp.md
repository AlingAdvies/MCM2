# Ontwerp — vragenlijst-tool, antwoorden en certificaat-upload

**Datum:** 2026-07-28, scope vastgesteld 2026-07-29
**Status:** ✅ **BOUWBAAR — niveau B vastgesteld door de opdrachtgever op 2026-07-29.**
**Issues:** #9 (certificaat-upload, AC13), en het inhoudelijke deel van #7 dat OV-6/OV-8 blokkeerde
**Bron:** `Transdev Annual Vendor IT Risk SurveyV1_0.md` (aangeleverd 2026-07-28)
**Referentie:** `VendorComply Help en Manual.md` §2.1–2.3, §3.1–3.4 — een bestaand, werkend product
waarvan de vraagtypen en lifecycle zijn overgenomen (zie §1a)
**Bouwt voort op:** `2026-07-28-leveranciertoken-ontwerp.md` (toegang), dat hier als gegeven geldt

---

## 0. Lees dit eerst — twee scopewijzigingen, op 2026-07-28 en 2026-07-29

**Wijziging 1 (2026-07-28) — de vragen horen in de database, niet in code.**

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
blijft: de toelichtingsregels (§3), de bestandsvalidatie (§6) en de RLS-garanties.

**Wijziging 2 (2026-07-29) — niveau B in plaats van A.**

Aanleiding was `VendorComply Help en Manual.md`, de handleiding van een bestaand, werkend product.
Dat document leverde geen wensenlijst maar keuzes die de praktijk al hebben overleefd. Het eerdere
advies in dit document (niveau A) rustte op het argument dat er nog geen tweede vraagvorm was om
tegen te ontwerpen; dat argument verviel zodra er acht bewezen vraagtypen op tafel lagen. Zie §1.

**Wat door wijziging 2 wél herzien is ten opzichte van 2026-07-28:** het antwoordschema (§4) is
ingrijpend veranderd — één `answer TEXT`-kolom volstaat niet meer voor acht typen. Nieuw zijn §2a
(de typen), §2b (lifecycle), §2c (deelnemers) en §2d (import/export). Wie de vorige versie kent,
moet in elk geval §2a en §4 opnieuw lezen.

**Wijziging 3 (2026-07-29) — er zijn twee use cases, niet één.**

Dit document ging tot nu toe uit van één soort respondent: een externe leverancier met een token.
De opdrachtgever heeft verduidelijkt dat de MVP **twee** soorten surveys moet ondersteunen, en dat
er niets gebouwd hoeft te worden dat daarbuiten valt:

| | Use case | Wie vult in | Over welke leverancier |
|---|---|---|---|
| **UC1** | Vendor compliance (bv. IT) | de leverancier zelf | zichzelf |
| **UC2** | Interne beoordeling | een Transdev-collega | dezelfde leverancier |

**Dat raakte het datamodel, niet alleen de tekst.** Bij UC1 vallen "wie vult in" en "over wie gaat
het" samen; bij UC2 niet. `survey_response.vendor_id` was `NOT NULL` met een foreign key naar
`vendor`, en bij UC2 is de invuller een collega die daar niet in past. Zie §1c.

Dit is de scopegrens van de MVP: **UC1 en UC2, niets daarbuiten.**

---

## 1. Niveau B — vastgesteld op 2026-07-29

De vraag die de omvang bepaalde, was hoeveel vrijheid de tenant krijgt:

| | Niveau | Wat de tenant kan | Besluit |
|---|---|---|---|
| **A** | Vaste vraagvorm, vrije tekst | Vraagteksten, volgorde, upload aan/uit. Eén antwoordtype. | te krap |
| **B** | Meerdere antwoordtypen | Als A, plus per vraag een antwoordtype kiezen uit acht. | ✅ **gekozen** |
| **C** | Volledige formulierbouwer | Als B, plus voorwaardelijke logica, secties, herhaalbare blokken. | uitgesteld |

Het eerdere advies in dit document was A, met als onderbouwing dat alle acht Transdev-vragen
hetzelfde antwoordtype hebben en er dus geen tweede vraagvorm was om tegen te ontwerpen.

**Die onderbouwing is vervallen.** VendorComply §2.1 levert acht vraagtypen die zich in de praktijk
bewezen hebben. Het bezwaar tegen vooruitbouwen — dat je de verkeerde abstractie kiest als je de
variatie nog niet gezien hebt — geldt niet meer wanneer een werkend product je precies laat zien
welke variatie er in de praktijk nodig blijkt.

### 1a. Wat uit VendorComply is overgenomen, en wat niet

VendorComply is een **referentie, geen compatibiliteitseis**. Er is geen gedeelde database, geen
gedeeld schema en geen migratiepad tussen beide producten. Wat overgenomen is, is overgenomen omdat
het een goede keuze is — niet om ergens op aan te sluiten.

**Overgenomen (§2.1, §2.2, §3.3):**

| Onderdeel | Waar het landt |
|---|---|
| De acht vraagtypen | §2, `answer_type` |
| Lifecycle Draft → Active → Finished/Archived | §2b |
| Test Mode vóór publicatie | §2b |
| Drie manieren om deelnemers toe te voegen | §2c |
| Deadline met overdue-markering | §2b |
| Import/export als JSON-schema | §2d |

Import/export verdient een aparte opmerking: het lijkt een gemaksfunctie, maar het levert
"template klonen" en "nieuwe versie afsplitsen" er vrijwel gratis bij, en het is tevens de manier
waarop beide vragenlijsten (UC1 en UC2) de database in komen — geen apart seed-script dat later uit
de pas loopt met het echte importpad.

**Uitgesteld — bewust niet in dit ontwerp:**

| Onderdeel | Reden |
|---|---|
| Logic jumps (voorwaardelijke logica) | Niveau C. Verandert "welke vragen zie je" van een lijst in een berekening, en raakt daarmee validatie, voortgang, export en verplichtstelling tegelijk. Eigen bouwstap ná een werkende B. |
| AI-beoordeling (Gemini) | Externe dienst. Brengt bovendien een verwerkersvraag mee: leverancierscertificaten en compliance-antwoorden naar een externe AI-dienst sturen is een AVG/NIS2-besluit, geen technische keuze. |
| EFQM KPI-sync | Externe koppeling, niet nodig voor de pilot. |
| Marketing Mode (publieke anonieme surveys) | Valt buiten UC1 en UC2 (§1c). Een open link zonder bekende respondent botst bovendien met het tokenontwerp, dat elke respons aan een geadresseerde koppelt. |
| Radar/spider charts | Rapportage, volgt op werkende data. |

### 1b. Draft/auto-save en "request revisions" — bewust niet

VendorComply §3.4 beschrijft antwoorden die in Draft staan met auto-save, en §2.2 fase 4 laat een
owner een ingediende response terugzetten naar Draft voor revisie.

**Besluit opdrachtgever 2026-07-29: geen van beide, niet voor nu.**

Dat is een belangrijke bevestiging, want het betekent dat de tokenlaag die op 2026-07-29 in `main`
is gemerged **ongewijzigd blijft**. Die laag is bewust éénmalig: één atomair
`UPDATE … WHERE status = 'pending'`, en een 410 zodra er is ingediend. Auto-save en "request
revisions" hadden allebei gevraagd dat indienen terugdraaibaar wordt — een wijziging in de laag die
net groen is geworden, niet een uitbreiding erop.

**Wat dit betekent voor §7 van dit ontwerp:** het conceptopslag-mechanisme dat daar beschreven staat
(`PUT /survey/respond/answers`) blijft wél bestaan, maar in de smalle vorm. Het verschil:

| | Wel | Niet |
|---|---|---|
| Antwoorden opslaan vóór indienen, expliciet door de leverancier | ✅ | |
| Automatisch opslaan tijdens typen (auto-save) | | ❌ |
| Herzien ná indienen | | ❌ |
| Owner zet response terug naar Draft | | ❌ |

Concept opslaan blijft nodig om een praktische reden die niets met auto-save te maken heeft: acht
vragen met verplichte toelichtingen vul je niet in één keer in, en het token is gehasht en dus niet
opnieuw te versturen. Zonder opslaan verliest iemand die een tabblad sluit alles, onherstelbaar.

### 1a-bis. Vergelijking met MVM_V2 (2026-07-29)

MVM_V2 heeft al werkende surveyschermen op mock data, en de klant heeft die gezien. Ze zijn op
2026-07-29 vergeleken met dit ontwerp. **De twee modellen zijn onafhankelijk van elkaar ontworpen
en komen grotendeels overeen** — dat is een sterker signaal dan wanneer ze op elkaar waren
afgestemd.

| MVM_V2 (`src/core/models/index.ts`) | Dit ontwerp | Uitkomst |
|---|---|---|
| `QuestionType`: `text \| yes_no \| multiple_choice \| date \| upload` | acht typen (§2a) | deelverzameling, sluit aan |
| `required` | `is_required` | zelfde |
| `options[]` | `config.options[]` | zelfde |
| `order` | `position` | zelfde |
| `requiresEvidence` | `allows_upload` | zelfde, andere naam |
| `confirmationStyle: boolean` | eigen type `confirmation` | dit ontwerp is expliciever |
| `date` als type | ontbreekt | **niet bouwen**, zie hieronder |
| `frameworkRef` ("NIS2 Art. 21.2.b") | ontbreekt | **niet bouwen**, zie hieronder |
| `categories[]` met score per categorie | platte lijst | zie §1c |

**`frameworkRef` wordt niet gebouwd** (besluit opdrachtgever 2026-07-29). Het koppelt een vraag aan
een normartikel en dient rapportage over raamwerkdekking. Dat loopt vooruit op meerdere
compliance-frameworks; **nu bouwen we NIS2**.

Belangrijk onderscheid daarbij, zodat dit besluit later niet verkeerd gelezen wordt: **de tool is
al framework-agnostisch, alleen de vragen zijn framework-specifiek.** Niets in dit ontwerp neemt
aan dat er één vragenlijst bestaat — `survey_template` heeft `name` en `version`, en een tweede
vragenlijst voor een ander framework is straks simpelweg een tweede import (§2d). Wat hier wegvalt
is uitsluitend de *metadata* die vastlegt bij welk artikel een vraag hoort. Er hoeft dus niets
gebouwd te worden om die deur open te houden; hij staat al open.

**`date` als negende vraagtype wordt niet gebouwd.** Geen van de acht Transdev-vragen gebruikt het
en UC2 is een rating. Acht typen volstaan voor beide use cases. Toevoegen is later één waarde in de
`CHECK`-lijst plus een validatieregel en een kolom die er al is (`answer_text` of een aparte
`answer_date`) — geen verbouwing.

**Wat wél uit MVM_V2 wordt overgenomen:** de designtaal (`src/shared/design-tokens.ts`), het
layout, en de schermen als functionele specificatie. Zie het frontendspoor; dat staat los van dit
ontwerp.

### 1c. Twee use cases — de scopegrens van de MVP

De MVP ondersteunt precies twee soorten surveys. **Functionaliteit die daarbuiten valt, wordt niet
gebouwd** — dat is een expliciete instructie van de opdrachtgever en het is de maatstaf waartegen
elk voorstel in dit document getoetst hoort te worden.

#### UC1 — Vendor compliance (extern)

De bestaande casus. Een externe leverancier beantwoordt vragen over de eigen organisatie. De acht
Transdev-vragen zijn hiervan de eerste vulling. Toegang via token, want de leverancier heeft geen
account.

#### UC2 — Interne beoordeling

Nieuw. Een Transdev-collega geeft aan hoe een leverancier in de praktijk scoort. Kort en eenvoudig —
in de praktijk een `rating` met eventueel een `open_text` erbij.

**"Leverancier" en "dienstverlener" zijn hier hetzelfde.** Het gaat om dezelfde partij en dezelfde
`clm.vendor`-rij; alleen de kant van waaruit ernaar gekeken wordt verschilt. Dit document gebruikt
daarom consequent **leverancier**.

Dat is geen woordkeuze maar de kern van het model: **dezelfde leverancier kan in beide surveys
zitten.** Wat hij zelf verklaart (UC1) en hoe hij in de praktijk scoort (UC2) zijn twee beelden van
één partij, en `subject_vendor_id` is de kolom die ze aan elkaar knoopt. Zonder dat zou je twee
losse datasets hebben die niet te koppelen zijn — en juist de vergelijking tussen die twee is
waarschijnlijk wat UC2 waardevol maakt.

**Drie besluiten van de opdrachtgever op 2026-07-29 bepalen hoe dit werkt:**

| Vraag | Besluit | Gevolg |
|---|---|---|
| Hoe krijgt een collega toegang? | **Ook via een token-link** | De bestaande tokenlaag blijft ongewijzigd en werkt meteen. De MVP wacht niet op de Entra-guard. |
| Meerdere collega's per leverancier? | **Ja** | `UNIQUE (run_id, vendor_id)` moet eraf — die staat er nu wel. |
| Ziet de leverancier de interne score? | **Nee, volledig intern** | Vraagt een harde scheiding, afgedwongen in de database. |

Dat de interne route ook via een token loopt, is de belangrijkste van de drie: het betekent dat
UC2 **geen enkele wijziging in de toegangslaag vraagt**. Dezelfde guard, dezelfde
`resolve_survey_token()`, dezelfde éénmaligheid. Alleen het datamodel eronder verbreedt.

#### Wat dit in het model verandert

`survey_response` gaat uit van één partij die zowel invult als beoordeeld wordt. Bij UC2 vallen die
uit elkaar. Drie wijzigingen, alle drie op een tabel die vanochtend gemerged is:

```
survey_run.survey_kind      TEXT NOT NULL DEFAULT 'vendor_compliance'
                            → 'vendor_compliance' (UC1) | 'internal_review' (UC2)

survey_response.vendor_id   UUID NULL          → was NOT NULL; leeg bij UC2
survey_response.subject_vendor_id  UUID NOT NULL  → over wie de survey gaat
survey_response.respondent_user_id UUID NULL   → welke collega invult (alleen UC2)
survey_response.respondent_label   TEXT NULL   → naam/rol, als er geen user-record is
```

| Kolom | UC1 | UC2 |
|---|---|---|
| `vendor_id` — de leverancier als **deelnemer** | de leverancier | **leeg** |
| `subject_vendor_id` — de leverancier als **onderwerp** | de leverancier (dezelfde rij) | de beoordeelde leverancier |
| `respondent_user_id` | leeg | de collega, indien bekend |
| `respondent_label` | leeg | naam of rol van de collega |

De twee kolommen leggen twee **rollen** vast, niet twee partijen. Bij UC1 vervult de leverancier
beide rollen tegelijk — hij is deelnemer én onderwerp — en wijzen de kolommen naar dezelfde rij.
Bij UC2 vervult hij alleen de tweede: hij vult niets in, er wordt over hem ingevuld.

**`subject_vendor_id` is bij beide gevuld, en dat is het punt.** De vraag "welke leverancier betreft
dit?" heeft bij elke survey een antwoord. Daardoor is rapportage per leverancier één query in plaats
van twee met een `UNION`, en — belangrijker — staan de zelfverklaring uit UC1 en de praktijkscore
uit UC2 over dezelfde partij automatisch naast elkaar.

Dat `vendor_id` bij UC1 dezelfde rij aanwijst is dus geen redundantie: het is de expliciete
vastlegging dat de leverancier daar zelf aan het woord is.

**Waarom `respondent_label` naast `respondent_user_id`.** Een collega die een token krijgt, hoeft
geen `clm.user`-record te hebben; de tokenroute vraagt geen account. Zonder tekstveld zou je voor
elke invuller eerst een gebruiker moeten aanmaken, en dat is precies het soort werk dat de
tokenroute wil vermijden. Zodra spoor 1 er is, kan `respondent_user_id` gevuld worden.

#### De constraints die hierbij horen

| Constraint | Dwingt af |
|---|---|
| `CHECK (survey_kind IN ('vendor_compliance','internal_review'))` | Alleen de twee use cases |
| `CHECK (survey_kind <> 'vendor_compliance' OR vendor_id = subject_vendor_id)` | Bij UC1 vallen invuller en onderwerp samen |
| `CHECK (survey_kind <> 'internal_review' OR vendor_id IS NULL)` | Bij UC2 is de invuller geen leverancier |
| `UNIQUE (run_id, vendor_id)` **vervalt** | Meerdere collega's per leverancier |
| *vervangen door:* `UNIQUE (run_id, vendor_id) WHERE vendor_id IS NOT NULL` | Bij UC1 nog steeds één respons per leverancier |

Die laatste is een **partiële unieke index**, en hij is nauwkeuriger dan wat er nu staat: bij UC1
blijft de garantie "één leverancier, één respons" volledig overeind, terwijl UC2 er niet door
geraakt wordt omdat `vendor_id` daar leeg is. Zonder die partiële vorm zou het weghalen van de
constraint ook UC1 verzwakken — en dat is precies wat je niet wilt.

#### De scheiding tussen intern en extern

Een leverancier mag de interne beoordelingen over zichzelf nooit zien. **De bestaande architectuur
regelt dit al**, en het is nuttig om precies te benoemen waarom — anders wordt er beveiliging
bijgebouwd die er al is.

Een leverancier heeft **geen toegang tot de Transdev-tenant**. Er is geen account, geen sessie en
geen tenantcontext die hem toebehoort. Wat hij heeft is één token, dat via
`resolve_survey_token()` precies één `response_id` oplevert — die van hemzelf. Er bestaat geen
route van "ik ken deze leverancier" naar "toon alle responses over deze leverancier": de lookup
gaat van tokenhash naar één respons, nooit van vendor naar een verzameling.

Een interne beoordeling is een aparte respons met een eigen token. Dat token krijgt de leverancier
niet. Daarmee is de scheiding een gevolg van het toegangsmodel, niet van een extra filter dat
iemand kan vergeten.

**Wat wél nodig is, is één regel discipline bij het bouwen:** leesroutes op de leverancierskant
filteren op `response_id`, nooit op `subject_vendor_id`. Zodra iemand een route bouwt die "alle
responses van deze vendor" ophaalt, ontstaat het lek dat er nu niet is. Dat is testpunt 39 — geen
nieuwe maatregel, maar het vastleggen dat de bestaande garantie ook onder de nieuwe kolommen blijft
gelden.

**Let op — dit raakt de bestaande auditregels.** Een interne beoordeling is bewijsmateriaal in
dezelfde zin als een compliance-antwoord: hij hoort in `audit.audit_event`, met dezelfde
transactiegarantie. De bestaande implementatie doet dat al per respons en vraagt geen wijziging.

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
answer_type     TEXT NOT NULL              → een van de acht typen uit §2a
config          JSONB NOT NULL DEFAULT '{}' → typespecifieke instellingen, zie §2a
is_required     BOOLEAN NOT NULL DEFAULT true
allows_upload   BOOLEAN NOT NULL DEFAULT false
max_files       SMALLINT NOT NULL DEFAULT 0
created_at      TIMESTAMPTZ NOT NULL
```

| Constraint | Dwingt af |
|---|---|
| `UNIQUE (template_id, question_key)` | Eén vraag per key binnen een versie |
| `UNIQUE (template_id, position)` | Geen twee vragen op dezelfde plek |
| `CHECK (answer_type IN (…acht waarden…))` | Alleen bekende typen |
| `CHECK (allows_upload = false OR max_files BETWEEN 1 AND 5)` | Een upload zonder maximum kan niet bestaan |
| `CHECK (allows_upload = true OR max_files = 0)` | Een maximum zonder upload evenmin |
| `CHECK (answer_type <> 'instruction' OR is_required = false)` | Een leesblok kan niet verplicht zijn |
| `template_id → survey_template ON DELETE RESTRICT` | Vragen verdwijnen niet stilzwijgend |

`question_key` is bewust een stabiele tekstsleutel naast de UUID. Bij een nieuwe templateversie
krijgt vraag 4 een nieuwe `question_id`, maar behoudt `question_key = 'q4'` — zo blijven antwoorden
over versies heen vergelijkbaar. Zonder dat is een jaar-op-jaar-vergelijking niet te maken, en dat
is bij een jaarlijkse compliance-survey precies het punt.

Voor Transdev vraag 1: `answer_type = 'confirmation'`, `allows_upload = true`, `max_files = 2`.

### 2a. De acht antwoordtypen

Overgenomen uit VendorComply §2.1/§3.3, met één toevoeging: `confirmation` bestaat daar niet en is
het type dat de acht Transdev-vragen nodig hebben (zie §3).

| `answer_type` | Wat de leverancier doet | `config` bevat | Antwoord landt in |
|---|---|---|---|
| `instruction` | niets — leesblok, kop of toelichting | — | *geen antwoordrij* |
| `confirmation` | I confirm / do not confirm / n.v.t. / kan niet uploaden | — | `answer_code` |
| `open_text` | vrije tekst | `min_length`, `max_length` | `answer_text` |
| `yes_no` | ja of nee | — | `answer_code` (`yes`/`no`) |
| `single_choice` | één optie kiezen | `options[]` | `answer_code` |
| `multi_choice` | meerdere opties kiezen | `options[]`, `min_select`, `max_select` | `answer_codes[]` |
| `rating` | een getal op een schaal | `min`, `max`, `min_label`, `max_label` | `answer_number` |
| `number` | getal, bedrag of percentage | `format` (`plain`/`eur`/`usd`/`pct`), `decimals`, `min`, `max` | `answer_number` |
| `file_upload` | alleen bestanden, geen keuze | — | *geen waarde, alleen bijlagen* |

Twee typen zijn bijzonder en verdienen aandacht bij het bouwen:

**`instruction` levert geen antwoord op.** Het is een leesblok. Het telt niet mee in de voortgang,
kan niet verplicht zijn (CHECK hierboven), en er hoort geen rij in `survey_answer` bij. Bij het
valideren van "alle vragen beantwoord?" moeten deze vragen worden overgeslagen — anders is een
vragenlijst met een inleidend tekstblok nooit compleet in te dienen. Dit is de meest waarschijnlijke
bug bij het bouwen van §5 stap 2.

**`file_upload` heeft geen antwoordwaarde**, alleen bijlagen. Dat is iets anders dan `confirmation`
met `allows_upload = true`, waar de leverancier zowel een keuze maakt *als* een bestand levert.

### Waarom `config` een JSONB is en geen twintig kolommen

De alternatieven waren: een kolom per instelling (`rating_min`, `rating_max`, `number_format`, …),
of een aparte tabel per vraagtype. Beide zijn slechter.

Kolommen per instelling geeft een tabel waarin bij elke rij het merendeel van de kolommen `NULL` is,
en waarbij elk nieuw vraagtype een migratie kost. Een tabel per type geeft acht tabellen die
grotendeels hetzelfde doen, met acht keer RLS en acht keer policies — en RLS is in dit project
handwerk (ADR-010).

`config` is bewust **niet** de plek waar het antwoord landt, alleen waar de vraag beschreven staat.
Een verkeerd gevulde `config` levert een onbruikbare vraag op; hij kan nooit een antwoord vervalsen
of RLS omzeilen.

**De prijs: de database bewaakt de inhoud van `config` niet.** Een `rating` met `min = 5` en
`max = 1` is voor Postgres een geldige rij. Dat moet in de servicelaag gevalideerd worden bij het
opslaan van de vraag, en het is een testpunt (§8, punt 29). Dit is een bewuste afweging: de garanties
die er echt toe doen — tenantisolatie, toelichtingsplicht, éénmaligheid — zitten wél in de database.

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

## 2b. Lifecycle van een vragenlijst

Overgenomen uit VendorComply §2.2. De statussen horen op `survey_run` (de ronde), niet op
`survey_template` (de vragenlijst) — een template kan meerdere rondes hebben die elk hun eigen
status doorlopen.

```
draft ──→ active ──→ finished ──→ archived
  │                      ↑
  └──────────────────────┘  (sluiten zonder ooit actief te zijn geweest)
```

| Status | Vendor ziet de survey | Indienen mag | Wijzigen van de template |
|---|---|---|---|
| `draft` | nee | nee | ja |
| `active` | ja | ja | **nee — bevroren** |
| `finished` | nee | nee | nee |
| `archived` | nee | nee | nee |

**`survey_run` krijgt hiervoor een `status`-kolom.** Nu heeft die tabel alleen `started_at`,
`closes_at` en `revoked_at` — de status is daar impliciet uit af te leiden, en dat is precies het
soort afleiding dat bij de eerste uitzondering misgaat.

**Dit sluit aan op de bestaande guard.** Die weegt `closes_at` en `revoked_at` al mee en geeft 410
bij een gesloten ronde. De statuskolom maakt dat expliciet in plaats van afgeleid; de guard moet
uitgebreid worden zodat alles behalve `active` een 410 oplevert. Dat is een wijziging in bestaande,
geteste code — testpunt 30.

### Deadline en overdue

`survey_run.closes_at` bestaat al en fungeert als deadline. VendorComply markeert verlopen surveys
rood op beide dashboards; dat is een presentatiekwestie zonder schemawijziging — `closes_at < now()`
bij status `active` is de volledige definitie.

**Let op de bestaande asymmetrie:** de guard hanteert de striktste van `expires_at` (per token) en
`closes_at` (per ronde). Een deadline verlengen op de ronde verlengt daarmee niet automatisch de
tokens. Dat is verdedigbaar, maar het moet in de beheer-UI zichtbaar zijn, anders verlengt iemand de
deadline en werkt de helft van de links alsnog niet.

### Test Mode

VendorComply §2.2 laat een owner een survey in een sandbox doorlopen vóór publicatie, met omzeiling
van de normale login. Dat is waardevol — een vragenlijst met acht vragen en verplichte toelichtingen
wil je één keer zelf doorlopen hebben.

**Hoe dit hier moet werken, en waarom niet zoals VendorComply het doet:** "bypassing normal login
requirements" is in MCM2 geen optie. De hele tokenlaag bestaat omdat toegang nooit uit
client-invoer mag komen (MCM2-CLAUDE.md §6, Issue #7).

**Voorstel: Test Mode is een echte run met een echt token, gemarkeerd als test.**

```
survey_run.is_test  BOOLEAN NOT NULL DEFAULT false
```

Een testrun gebruikt exact hetzelfde pad als een echte run — dezelfde guard, dezelfde validatie,
dezelfde `resolve_survey_token()`. Het verschil zit uitsluitend in wat erna gebeurt: testruns tellen
niet mee in rapportages, en de beheerder kan ze zonder bezwaar verwijderen (de enige survey-data die
géén `ON DELETE RESTRICT` nodig heeft, want het is geen bewijsmateriaal).

Dat is aantoonbaar beter dan een sandbox-route die de guard omzeilt: je test dan namelijk het
werkelijke pad, niet een nabootsing ervan. Een sandbox die de guard overslaat, bewijst niet dat de
echte flow werkt — en dat is nu juist wat je wilt weten vóór je twaalf leveranciers uitnodigt.

---

## 2c. Deelnemers toevoegen — drie routes

Overgenomen uit VendorComply §2.2 fase 2. Alle drie leiden tot hetzelfde eindpunt: een
`survey_response`-rij met een token, precies zoals de bestaande tokenlaag die aanmaakt.

| Manier | Invoer | Bijzonderheid |
|---|---|---|
| Entity mapping | Selectie uit bestaande `vendor` / `vendor_contact` | Enige die aan een bekende vendor koppelt |
| Quick paste | Plaktekst met e-mailadressen, komma of regeleinde gescheiden | Moet vendors aanmaken of matchen |
| CSV-import | `.csv` met contactgegevens | Idem, plus foutrapportage per regel |

**Het knelpunt verschilt per use case, en dat is wezenlijk.**

**Bij UC1** is de deelnemer de leverancier zelf. `vendor_id` en `subject_vendor_id` wijzen naar
dezelfde rij, en een geplakt e-mailadres moet dus aan een vendor gekoppeld worden. Twee opties:

1. **Automatisch een vendor aanmaken** bij een onbekend e-mailadres, met het domein als naam.
   Snel, maar vervuilt het vendorbestand met halve records.
2. **Weigeren en terugmelden** welke adressen geen bekende vendor hebben, met een expliciete
   "aanmaken"-stap. Meer handelingen, schoner bestand.

Advies: **optie 2.** Het vendorbestand is bij een compliance-instrument geen bijzaak — het is de
lijst waar de rapportage op leunt. Automatisch aanmaken levert binnen een jaar dubbele vendors op
(`transdev.nl` en `Transdev Nederland` als twee records), en dat is achteraf duur op te ruimen.

**Bij UC2 speelt dat niet.** De deelnemer is een Transdev-collega; die hoeft aan geen enkel
vendorrecord gekoppeld te worden en `vendor_id` blijft leeg. De leverancier komt hier niet voor als
deelnemer maar als **onderwerp** — hij vult niets in, er wordt over hem ingevuld.

Wat de beheerder aangeeft:

| Wat de beheerder aangeeft | Landt in |
|---|---|
| Over welke leverancier deze ronde gaat | `subject_vendor_id` (verplicht) |
| Welke collega's die beoordelen | `respondent_label`, met een e-mailadres voor de tokenlink |

Dat is een wezenlijk andere schermflow, en het verschil zit in wat je selecteert:

| | UC1 | UC2 |
|---|---|---|
| Je kiest | een lijst leveranciers | **één** leverancier |
| Ieder krijgt | een eigen vragenlijst over zichzelf | — |
| Daarna kies je | — | de collega's die hem beoordelen |
| Aantal responses | één per leverancier | één per collega |

**Twee schermen, geen gedeelde variant met een schakelaar** — dat laatste levert een scherm op dat
beide dingen half doet. Bij UC1 is de leverancier de deelnemer, bij UC2 het onderwerp; dat is een
te wezenlijk verschil om achter een keuzerondje te verbergen.

Quick paste en CSV-import werken bij UC2 op de collega-adressen. Het inlezen is daar juist eenvoudiger
dan bij UC1, omdat de koppelingsvraag uit de vorige alinea niet speelt.

De uniciteitsregel is aangepast aan dit onderscheid (§1c): `UNIQUE (run_id, vendor_id)` wordt
partieel en geldt alleen waar `vendor_id` gevuld is. Bij UC1 blijft "één leverancier, één respons"
dus volledig gelden; bij UC2 kunnen meerdere collega's dezelfde leverancier beoordelen. Een
UC1-import die een vendor dubbel bevat, moet nog steeds een nette fout geven in plaats van een
databaseconflict.

---

## 2d. Import/export van de vragenlijststructuur

Overgenomen uit VendorComply §2.1. Eén JSON-bestand dat de volledige structuur van een template
beschrijft: de vragen, hun volgorde, typen en `config`.

```json
{
  "schema_version": 1,
  "name": "transdev-annual-vendor-it-risk",
  "version": 1,
  "questions": [
    {
      "question_key": "q1",
      "position": 1,
      "title": "ISO 27001 Certification Evidence",
      "body": "…",
      "answer_type": "confirmation",
      "is_required": true,
      "allows_upload": true,
      "max_files": 2,
      "config": {}
    }
  ]
}
```

Dit levert vier dingen op waarvan er maar één expliciet gevraagd is:

- **Template klonen** — exporteren en weer importeren, bijvoorbeeld om naast de UC1-vragenlijst een
  UC2-variant op te zetten
- **Nieuwe versie afsplitsen** van een bevroren template (§2) is dezelfde operatie
- **De seed van beide vragenlijsten** is gewoon zo'n bestand, geen apart migratiescript

Die laatste is de reden om dit vroeg te bouwen in plaats van laat: het vervangt werk dat anders
tweemaal gedaan wordt.

**Drie regels die bij import hard moeten zijn:**

| Regel | Waarom |
|---|---|
| `tenant_id` komt **nooit** uit het bestand, altijd uit de sessiecontext | Een importbestand mag geen tenantgrens kunnen oversteken |
| `question_id` staat **niet** in het export en wordt bij import nieuw gegenereerd | Anders importeer je een verwijzing naar andermans rij |
| `schema_version` wordt gecontroleerd | Een later formaat moet herkenbaar weigeren in plaats van half inlezen |

De eerste is de belangrijkste en is precies het patroon waar Issue #7 over gaat: een veld uit
client-invoer dat de tenant bepaalt. Een importbestand is client-invoer. Testpunt 31.

---

## 3. Het `confirmation`-type

Dit is één van de acht typen uit §2a, en het type dat alle acht Transdev-vragen gebruiken. Het staat
apart beschreven omdat de toelichtingsregels eromheen door de opdrachtgever zijn bevestigd en op
databaseniveau worden afgedwongen.

De regels in deze paragraaf gelden **alleen voor `confirmation`**. Voor de andere zeven typen geldt
§3a.

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

De labels zijn Engels en staan vast in de code; alleen de vraagteksten komen uit de database. Dat is
bewust: bij `confirmation` hoort de betekenis van de vier opties vast te liggen, anders is een
jaar-op-jaar-vergelijking niet te maken. Een tenant die andere keuzeteksten wil, gebruikt
`single_choice` — dáár komen de opties wél uit `config`.

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

## 3a. De andere zeven typen

Bij `confirmation` is de toelichtingsplicht inhoudelijk bepaald: een niet-bevestiging vraagt uitleg.
Die redenering laat zich niet zomaar overzetten. Wat is bij een `rating` van 2 uit 5 het equivalent
van "niet bevestigd"?

**Voorstel: geen automatische toelichtingsplicht bij de andere typen. Wel per vraag instelbaar.**

```
survey_question.config.comment = "none" | "optional" | "required"
```

Standaard `optional`. De tenant die bij een rating onder een drempel uitleg wil, kan dat aanzetten —
maar dan voor de hele vraag, niet voorwaardelijk op de gegeven waarde. Voorwaardelijke
toelichtingsplicht is voorwaardelijke logica, en dat is niveau C.

Wat wél per type geldt:

| Type | Verplicht betekent | Aanvullende validatie |
|---|---|---|
| `instruction` | n.v.t. — kan niet verplicht zijn | geen antwoordrij toegestaan |
| `open_text` | niet-lege tekst na `btrim` | `min_length` / `max_length` uit `config` |
| `yes_no` | een van beide gekozen | waarde is `yes` of `no` |
| `single_choice` | één optie gekozen | code moet in `config.options[]` voorkomen |
| `multi_choice` | ≥ 1 optie gekozen | elke code in `options[]`; aantal binnen `min_select`/`max_select`; geen duplicaten |
| `rating` | een waarde gekozen | geheel getal, binnen `min`…`max` |
| `number` | een waarde ingevuld | binnen `min`…`max`; decimalen conform `config.decimals`; bij `pct` tussen 0 en 100 |
| `file_upload` | ≥ 1 bestand geüpload | aantal ≤ `max_files` |

**De ondergrens van 10 tekens geldt alleen waar een toelichting verplicht is** — dus bij
`confirmation` altijd bij een niet-bevestiging, en elders alleen bij `comment = "required"`. Bij
`open_text` is de tekst het antwoord zelf, niet de toelichting; daar geldt `min_length` uit `config`
en die staat standaard op 1.

**Wat de database hier wél en niet kan afdwingen.** Dit is het punt waar niveau B duurder is dan A:

| Regel | Waar afgedwongen |
|---|---|
| Toelichtingsplicht bij `confirmation` | ✅ CHECK-constraint (§4) |
| Waarde landt in de juiste kolom voor het type | ✅ CHECK-constraint (§4) |
| Gekozen optie bestaat in `config.options[]` | ❌ servicelaag — vereist een blik op de vraagrij |
| Rating binnen `min`…`max` | ❌ servicelaag — idem |
| `multi_choice` binnen `min_select`/`max_select` | ❌ servicelaag — idem |

Een CHECK kan geen andere tabel raadplegen. Deze drie regels leunen daarmee op de servicelaag, en
dat is een reëel verschil met de garanties die dit project elders hanteert. **Wie ze in de database
wil, heeft een trigger nodig** — uitvoerbaar, maar dat is werk dat pas de moeite waard is als blijkt
dat de servicelaag hier daadwerkelijk faalt. Voor nu: expliciet benoemd, met testpunten 33 t/m 35.

## 4. Schema voor de antwoorden

Twee tabellen naast `survey_question`, beide tenantgebonden, beide met RLS en `USING` + `WITH CHECK`
conform MCM2-CLAUDE.md §7.

### `clm.survey_answer`

```
answer_id       UUID PK
tenant_id       UUID NOT NULL              → RLS-kolom
response_id     UUID NOT NULL              → clm.survey_response, ON DELETE RESTRICT
question_id     UUID NOT NULL              → clm.survey_question, ON DELETE RESTRICT
answer_type     TEXT NOT NULL              → gekopieerd van de vraag, zie hieronder
answer_code     TEXT NULL                  → confirmation, yes_no, single_choice
answer_codes    TEXT[] NULL                → multi_choice
answer_text     TEXT NULL                  → open_text
answer_number   NUMERIC NULL               → rating, number
comment         TEXT NULL
created_at      TIMESTAMPTZ NOT NULL
updated_at      TIMESTAMPTZ NULL           → concept mag bijgewerkt worden (§7)
```

**Aparte kolommen per waardesoort, geen `answer JSONB` en geen `answer TEXT` voor alles.** Dat is de
belangrijkste ontwerpkeuze van niveau B, en de reden is bruikbaarheid achteraf: een rating in een
`NUMERIC` is te sorteren, te middelen en in een rapportage te aggregeren. Dezelfde waarde als tekst
in een JSONB is dat niet — daar moet elke query eerst casten, en één niet-numerieke waarde laat de
hele query klappen. Bij een compliance-instrument waarvan de uitkomst jaar op jaar vergeleken wordt,
is dat het verschil tussen bruikbare en onbruikbare data.

De prijs is vier kolommen die meestal `NULL` zijn. Dat is in Postgres vrijwel gratis (een NULL kost
één bit in de row header) en het levert typering en aggregeerbaarheid op.

**`answer_type` staat gedupliceerd op de antwoordrij.** Dat is bewust redundant. Het maakt de
onderstaande CHECK-constraint mogelijk — zonder die kolom zou de constraint de vraagtabel moeten
raadplegen, en dat kan een CHECK niet. De consistentie tussen beide wordt afgedwongen met een
samengestelde foreign key:

```sql
-- survey_question krijgt hiervoor UNIQUE (question_id, answer_type)
FOREIGN KEY (question_id, answer_type)
    REFERENCES clm.survey_question (question_id, answer_type)
```

Daarmee kan `answer_type` op de antwoordrij nooit afwijken van die op de vraag — de database bewaakt
het, niet de code.

| Constraint | Dwingt af |
|---|---|
| `UNIQUE (response_id, question_id)` | Eén antwoord per vraag per response |
| `CHECK (answer_type IN (…zeven waarden…))` | `instruction` uitgesloten: leesblok krijgt geen antwoordrij |
| **Vormconstraint per type** (hieronder) | Waarde staat in de juiste kolom, andere kolommen leeg |
| `CHECK (answer_type <> 'confirmation' OR answer_code = 'confirmed' OR length(btrim(comment)) >= 10)` | Toelichtingsplicht op databaseniveau |
| `FOREIGN KEY (question_id, answer_type)` | Type van het antwoord matcht het type van de vraag |
| `question_id → survey_question ON DELETE RESTRICT` | Antwoorden verdwijnen niet stilzwijgend |

De vormconstraint zorgt dat elk type precies één waardekolom vult en de rest leeg laat:

```sql
CHECK (
  CASE answer_type
    WHEN 'confirmation'   THEN answer_code  IS NOT NULL AND answer_codes IS NULL
                               AND answer_text IS NULL AND answer_number IS NULL
    WHEN 'yes_no'         THEN answer_code  IN ('yes','no') AND answer_codes IS NULL
                               AND answer_text IS NULL AND answer_number IS NULL
    WHEN 'single_choice'  THEN answer_code  IS NOT NULL AND answer_codes IS NULL
                               AND answer_text IS NULL AND answer_number IS NULL
    WHEN 'multi_choice'   THEN answer_codes IS NOT NULL AND array_length(answer_codes,1) >= 1
                               AND answer_code IS NULL AND answer_text IS NULL
                               AND answer_number IS NULL
    WHEN 'open_text'      THEN answer_text  IS NOT NULL AND length(btrim(answer_text)) >= 1
                               AND answer_code IS NULL AND answer_codes IS NULL
                               AND answer_number IS NULL
    WHEN 'rating'         THEN answer_number IS NOT NULL AND answer_number = trunc(answer_number)
                               AND answer_code IS NULL AND answer_codes IS NULL
                               AND answer_text IS NULL
    WHEN 'number'         THEN answer_number IS NOT NULL
                               AND answer_code IS NULL AND answer_codes IS NULL
                               AND answer_text IS NULL
    WHEN 'file_upload'    THEN answer_code IS NULL AND answer_codes IS NULL
                               AND answer_text IS NULL AND answer_number IS NULL
  END
)
```

Zonder deze constraint kan een bug een rating als tekst wegschrijven of een keuzecode in
`answer_number` proppen. Dat merk je pas maanden later bij de eerste rapportage, wanneer de data
niet meer te repareren is omdat niemand weet wat er oorspronkelijk bedoeld was.

**Verschil met de eerste versie:** `question_id` als echte foreign key, niet `question_key` als
losse tekst. Nu de vragen in de database staan, is er een tabel om naar te verwijzen — en dan hoort
de koppeling ook door de database bewaakt te worden.

**Wat de database niet kan afdwingen:** dat `cannot_upload` alleen voorkomt bij een vraag met
`allows_upload = true`, en dat een gekozen optie daadwerkelijk in `config.options[]` staat (§3a).
Beide vereisen een blik op de vraagrij, wat een CHECK niet kan. Dit hoort in de validatie én in een
trigger — zie testpunten 17 en 33 in §8.

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
1b. Ronde heeft status 'active'? (§2b)                  → 410
2.  Alle verplichte vragen beantwoord?                  → 422, met de ontbrekende keys
    → vragen met answer_type = 'instruction' overslaan
    → vragen met is_required = false overslaan
3.  Onbekende question_id meegestuurd?                  → 422
4.  Hoort de question_id bij de template van deze run?  → 422
5.  answer_type in het antwoord = dat van de vraag?     → 422
6.  Waarde geldig voor dít type? (§3a-tabel)            → 422
    → single/multi_choice: code bestaat in config.options[]
    → multi_choice: aantal binnen min_select/max_select, geen duplicaten
    → rating: geheel getal binnen min…max
    → number: binnen min…max, decimalen conform config, pct tussen 0 en 100
    → open_text: lengte binnen min_length…max_length
    → confirmation: cannot_upload alleen bij allows_upload = true
7.  Toelichting verplicht en aanwezig, ≥ 10 tekens?     → 422, per vraag benoemd
    → confirmation: verplicht bij alles behalve 'confirmed'
    → overige typen: alleen bij config.comment = 'required'
8.  Toelichting ≤ 2.000 tekens?                         → 422
9.  Bij confirmed op een uploadvraag: ≥ 1 bestand?      → 422
9b. Bij answer_type = 'file_upload': ≥ 1 bestand?       → 422
10. Aantal bestanden ≤ max_files van die vraag?         → 422
11. Atomair indienen (bestaand, ontwerp §5)             → 410 bij tweede poging
```

Vier stappen verdienen toelichting.

**Stap 1b is nieuw** en volgt uit de statuskolom op `survey_run` (§2b). De bestaande guard weegt
`closes_at` en `revoked_at`; die moet nu ook de status meewegen.

**Stap 2 heeft twee uitzonderingen die makkelijk vergeten worden.** Een `instruction` is een leesblok
en levert nooit een antwoord op; een vraag met `is_required = false` mag leeg blijven. Wie beide
vergeet, bouwt een vragenlijst die met een inleidend tekstblok nooit in te dienen is. Dit is de
waarschijnlijkste bug in deze paragraaf — testpunt 32.

**Stap 4 is niet cosmetisch:** nu vragen per tenant verschillen, moet gecontroleerd worden dat een
meegestuurde `question_id` daadwerkelijk bij de template van *deze* run hoort. Zonder die controle
kan een `question_id` van een andere template meeliften. RLS beschermt tegen een andere *tenant*,
niet tegen een andere template binnen dezelfde tenant.

**Stap 5 is nieuw bij niveau B.** De client stuurt een antwoord met een type mee; dat type moet
overeenkomen met wat de vraag voorschrijft. De samengestelde foreign key uit §4 vangt dit ook af,
maar dan als databasefout in plaats van een leesbare 422.

**Stap 2 t/m 10 vóór stap 11.** Eerst alles valideren, dan pas de status op `submitted` zetten. Bij
een fout in stap 7 mag de response niet half ingediend achterblijven — dan is de link verbruikt
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
| `GET /admin/survey/templates/:id/export` | JSON-schema exporteren (§2d) |
| `POST /admin/survey/templates/import` | JSON-schema importeren (§2d) |
| `POST /admin/survey/runs/:id/participants` | Deelnemers toevoegen, drie manieren (§2c) |
| `POST /admin/survey/runs/:id/status` | Lifecycle-overgang (§2b) |
| `POST /admin/survey/runs/test` | Testrun starten met `is_test = true` (§2b) |

### Concept opslaan — expliciet, niet automatisch

Acht vragen met verplichte toelichtingen vul je niet in één keer in. Iemand die bij vraag 6 moet
nazoeken of dat incident wel binnen 48 uur gemeld is, verliest bij het sluiten van het tabblad
alles — en het token is niet opnieuw te versturen, want het is gehasht.

Daarom: **antwoorden mogen opgeslagen worden vóór het indienen.** `survey_answer`-rijen bestaan
terwijl de response nog `pending` is; indienen zet alleen de status. Dat werkt zonder extra
tabellen, mits het schrijven geblokkeerd wordt zodra de status `submitted` is — anders is de
éénmaligheid uit AC12 alsnog omzeilbaar.

**Geen auto-save** (besluit 2026-07-29, §1b). De leverancier slaat expliciet op met een knop; er
wordt niet tijdens het typen weggeschreven. Dat scheelt een aanzienlijke hoeveelheid werk aan
conflictafhandeling en debounce-logica, en het houdt het aantal schrijfacties op de database laag.

**Geen herziening na indienen** (idem). Zodra de status `submitted` is, ligt alles vast. De
`WITH CHECK`-policy hieronder is precies wat dat afdwingt.

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

**Let op bij een concept:** de CHECK-constraints uit §4 gelden óók tijdens het opslaan van een
concept. Iemand die vraag 4 alvast op `not_confirmed` zet zonder toelichting, kan dat concept niet
bewaren. Hetzelfde geldt voor de vormconstraint: een half ingevuld antwoord past er niet in.

Dat is streng maar verdedigbaar; het alternatief (de constraints pas bij indienen afdwingen)
betekent dat de database de garantie niet meer draagt. **De praktische vorm is dat een concept
alleen volledig ingevulde antwoorden bevat** — een vraag is af of hij staat er niet in. Dat is
werkbaar: de leverancier vult vraag 1 t/m 3 in, slaat op, en gaat later verder met 4 t/m 8.

Wat dit uitsluit is het halverwege bewaren van één vraag ("ik heb `not_confirmed` gekozen maar de
toelichting nog niet geschreven"). Als dat in de praktijk knelt, is de oplossing een aparte
conceptkolom of een conceptstatus per antwoord — niet het weghalen van de constraint. Zonder
auto-save (§1b) is de kans dat dit knelt aanzienlijk kleiner, want de leverancier bepaalt zelf
wanneer er opgeslagen wordt.

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

Aanvullend uit niveau B (§1) en de VendorComply-overname (§1a):

| # | Bewijs |
|---|---|
| 29 | Een `rating` met `min > max` in `config` wordt geweigerd bij het opslaan van de vraag |
| 30 | Een ronde met status ≠ `active` levert 410 op, ook binnen `closes_at` (§2b) |
| 31 | Een importbestand met een vreemde `tenant_id` importeert in de eigen tenant, nooit die uit het bestand (§2d) |
| 32 | Een vragenlijst met een `instruction`-blok is in te dienen zonder antwoord op dat blok (§5 stap 2) |
| 33 | Een `single_choice` met een code die niet in `config.options[]` staat, wordt geweigerd |
| 34 | Een `rating` buiten `min`…`max` wordt geweigerd; een niet-geheel getal eveneens |
| 35 | `multi_choice` met duplicaten of buiten `min_select`/`max_select` wordt geweigerd |
| 36 | Een antwoord met een `answer_type` dat afwijkt van de vraag faalt — op de foreign key, niet op code |
| 37 | Een `rating`-waarde in `answer_text` faalt op de vormconstraint (§4) |
| 38 | Een testrun (`is_test = true`) doorloopt exact hetzelfde guardpad als een echte run |

Aanvullend uit de twee use cases (§1c):

| # | Bewijs |
|---|---|
| 39 | Een leverancierstoken geeft uitsluitend de eigen respons — een interne beoordeling over dezelfde `subject_vendor_id` is er niet mee bereikbaar |
| 40 | Twee collega's kunnen dezelfde leverancier beoordelen in één ronde (UC2) |
| 41 | Dezelfde leverancier twee keer in één ronde faalt op de partiële unieke index (UC1) |
| 42 | Bij `survey_kind = 'vendor_compliance'` faalt een respons waar `vendor_id <> subject_vendor_id` |
| 43 | Bij `survey_kind = 'internal_review'` faalt een respons met een gevulde `vendor_id` |
| 44 | Een UC2-respons is in te dienen zonder enig `clm.user`-record voor de invuller |

Punt 15, 23, 27, 36 en 37 zijn de belangrijkste: die toetsen dat de garantie in de database zit en
niet alleen in de applicatiecode. Alle vijf moeten getest worden met directe SQL die de
applicatielaag overslaat — anders test je je eigen validatiecode en niet de garantie.

Punt 25 sluit het risico af waar §5 voor waarschuwt: een half verbruikte link is onherstelbaar.

Punt 26, 27 en 28 vloeien voort uit de koerswijziging: zodra de tenant zelf vragen opstelt, ontstaan
fouten die bij een vaste vragenlijst niet konden bestaan.

Punt 32 is de meest waarschijnlijke bug van het hele ontwerp. Een `instruction`-blok dat meetelt als
onbeantwoorde vraag maakt de vragenlijst onindienbaar, en dat merk je pas bij de eerste template die
er een gebruikt — niet bij de acht Transdev-vragen, want die hebben er geen.

Punt 31 is de zwaarste in beveiligingstermen: een importbestand is client-invoer, en `tenant_id`
daaruit overnemen is exact het patroon dat Issue #7 verbiedt.

Punt 39 legt vast dat de scheiding tussen interne en externe beoordelingen ook onder de nieuwe
kolommen blijft gelden. De garantie volgt uit het toegangsmodel — een leverancier heeft geen
tenanttoegang, alleen één token voor één respons — maar juist daarom moet er een test op staan: het
is het soort garantie dat stilzwijgend sneuvelt zodra iemand een route bouwt die op
`subject_vendor_id` filtert in plaats van op `response_id`.

---

## 9. Bewust niet opgelost

**De scopegrens is UC1 en UC2 (§1c).** Alles wat daarbuiten valt, wordt niet gebouwd — dat is een
expliciete instructie van de opdrachtgever en niet alleen een prioriteitskeuze. Bij twijfel over
een voorstel is de toets: *dient dit UC1 of UC2?* Zo niet, dan hoort het in deze tabel.

| Onderwerp | Reden |
|---|---|
| Voorwaardelijke logica (logic jumps), secties | Niveau C. Uitgesteld op 2026-07-29 (§1a). Eigen bouwstap ná een werkende B. |
| AI-beoordeling (Gemini) | Uitgesteld op 2026-07-29 (§1a). Externe dienst plus een openstaande verwerkersvraag. |
| EFQM KPI-sync | Uitgesteld op 2026-07-29 (§1a) |
| `frameworkRef` — vraag koppelen aan een normartikel | Uitgesteld op 2026-07-29 (§1a-bis). Loopt vooruit op meerdere frameworks; nu bouwen we NIS2. De tool zelf is al framework-agnostisch. |
| `date` als negende vraagtype | Uitgesteld op 2026-07-29 (§1a-bis). Geen van beide use cases gebruikt het. |
| Marketing Mode (publieke anonieme surveys) | Uitgesteld op 2026-07-29 (§1a). Botst met één-link-per-vendor. |
| Radar/spider charts, rapportage | Uitgesteld op 2026-07-29 (§1a). Volgt op werkende data. |
| Auto-save tijdens typen | Uitgesteld op 2026-07-29 (§1b). Expliciet opslaan blijft wel. |
| Herzien na indienen / "request revisions" | Uitgesteld op 2026-07-29 (§1b). Zou de éénmaligheid van het token doorbreken. |
| Virusscan | OV-7 onbeantwoord; risico en haakpunt benoemd in §6. Aparte issue. |
| Nederlandse vertaling | Alleen Engels, zoals besloten. Structuur belet een latere vertaling niet. |
| Objectopslag | Fase 2; `storage_key` is er al op voorbereid |
| Beheer-UI | Wacht op spoor 1 (Entra-guard); datamodel en validatie kunnen vooruit |
| Herinneringsmails | Wacht op OV-9 (SMTP) |
| Export van ingediende antwoorden | OV-4, apart spoor. **Niet te verwarren met §2d**, dat de vragenlijst*structuur* exporteert, niet de antwoorden. |

---

## 10. Bouwvolgorde

De volgorde is zo gekozen dat er na elke stap iets werkt dat te testen is, en dat de stappen die de
bestaande, groene tokenlaag raken zo vroeg mogelijk komen — daar is de kans op verrassingen het
grootst.

| # | Stap | Levert op |
|---|---|---|
| 1 | Migratie: `survey_question`, `survey_answer`, `survey_attachment`, plus `status`, `is_test` en `survey_kind` op `survey_run` en de vier respondentkolommen op `survey_response` (§1c) — met RLS, policies, CHECK-constraints, de partiële unieke index, de samengestelde FK uit §4 en de bevriezingstrigger uit §2 | Het datamodel staat, beide use cases |
| 2 | Guard uitbreiden met de statuscontrole (§2b, stap 1b) | Bestaande laag blijft groen — testpunt 30 |
| 3 | Import/export van het JSON-schema (§2d) | Nodig voor stap 4; levert klonen en versioneren mee |
| 4 | Seed: de acht Transdev-vragen als template `transdev-annual-vendor-it-risk` v1 (UC1) plus een korte interne beoordelingsvragenlijst (UC2), beide via stap 3 | Beide use cases gevuld |
| 5 | `GET /survey/respond/questions` — vragen ophalen incl. `config` per type | Leverancier ziet de vragenlijst |
| 6 | Validatie- en indienlogica (§5); `POST /survey/respond` uitbreiden met de antwoordbody | De kern |
| 7 | `PUT /survey/respond/answers` (concept, expliciet opslaan) | Bruikbaar bij acht vragen |
| 8 | Bestandsupload met inhoudscontrole (§6) | Issue #9 |
| 9 | Tests 14 t/m 38 | Bewijs |
| 10 | Beheerroutes: lifecycle, deelnemers, templatebeheer — zodra spoor 1 (Entra-guard) er is | Tenant beheert zelf |

**Stap 3 vóór stap 4 is bewust.** De seed is gewoon een importbestand; als import eerst werkt,
bestaat er geen apart seed-script dat later uit de pas loopt met het echte importpad.

**Stap 1 is de plek waar het misgaat als het misgaat:** drizzle-kit genereert geen RLS, geen
CHECK-constraints en geen triggers — die zijn handwerk, zoals in ADR-010 vastgelegd en bij migratie
0003 al gebleken. De vormconstraint uit §4 en de samengestelde foreign key zijn hier de twee stukken
die met de hand geschreven en met directe SQL getoetst moeten worden.

**Stap 10 blokkeert de rest niet.** Tot spoor 1 er is, komt de vragenlijst via import (stap 3) in de
database. De leverancierskant werkt dan volledig.

---

## 11. Openstaande punten

**Beslist op 2026-07-29, niet langer open:**

- ~~Niveau A, B of C~~ → **B** (§1)
- ~~Auto-save en "request revisions"~~ → **beide niet** (§1b)
- ~~Welke VendorComply-features overnemen~~ → zie de twee tabellen in §1a
- ~~Toegang voor interne invullers (UC2)~~ → **ook via token-link** (§1c). De toegangslaag blijft
  daarmee ongewijzigd en de MVP wacht niet op de Entra-guard.
- ~~Meerdere collega's per leverancier~~ → **ja** (§1c). `UNIQUE (run_id, vendor_id)` wordt
  partieel.
- ~~Ziet de leverancier de interne score~~ → **nee, volledig intern** (§1c)

**BLOKKEREND voor stap 1 van de bouwvolgorde — één vraag:**

- **Heeft de interne beoordeling (UC2) categorieën met een score per categorie?** MVM_V2 heeft ze
  (`InternalSurveyTemplate.categories[]`, met `minAnswersPerCategory` en een berekende score per
  categorie), en het portaalscherm toont de vragenlijst daar als stappen per categorie.
  VendorComply noemde hetzelfde onder "topic sections". Bij de acht Transdev-vragen (UC1) zijn er
  géén categorieën.

  Dit staat als enige punt vóór de migratie, want het is een tabel erbij (`survey_category`) plus
  een verwijzing op `survey_question`. **Achteraf toevoegen raakt elke query, elk scherm en de
  scoreberekening** — dat is de reden dat dit blokkerend is en `date` niet.

  Als het antwoord "één lijst, één totaalscore" is, blijft het ontwerp zoals het nu staat.

**Nog open — voorstellen van mij, niet bevestigd:**

- **Bevriezing van een lopende ronde** (§2). Het is de regel die bepaalt of antwoorden achteraf nog
  interpreteerbaar zijn. Ik zou hem aanhouden, maar hij is niet expliciet bevestigd.
- **Verplichte toelichting bij `not_confirmed`** (§3). Mijn afleiding uit de bevestigde regels voor
  `not_applicable` en `cannot_upload`.
- **Onbekend e-mailadres bij import: weigeren of vendor aanmaken** (§2c). Advies: weigeren. Speelt
  alleen bij UC1. Dit moet vóór stap 10 beslist zijn, niet eerder.
- **Of UC1 en UC2 dezelfde vragenlijst-templates delen** (§1c). Het model staat het toe — een
  template is niet aan een `survey_kind` gebonden. Ik zou dat zo laten: een tenant die een
  interne vragenlijst per ongeluk aan een leverancier stuurt, maakt een beheerfout, geen
  systeemfout. Als daar wel een grens hoort, is het één kolom op `survey_template`.
- **Hoe meerdere interne scores over dezelfde leverancier samengevat worden** (§1c). Nu worden
  ze alleen opgeslagen. Middelen, spreiding tonen of los laten staan is een rapportagevraag, en
  rapportage is uitgesteld (§1a). Het datamodel belet geen van de varianten.
- **Toelichting bij de andere zeven typen is per vraag instelbaar en staat standaard op optioneel**
  (§3a). Alternatief zou zijn: nooit een toelichting buiten `confirmation`.

**Bekende beperkingen, bewust geaccepteerd:**

- **Drie validatieregels leunen op de servicelaag, niet op de database** (§3a): geldige optiecode,
  rating binnen bereik, `multi_choice`-aantallen. Een CHECK kan de vraagrij niet raadplegen. Een
  trigger zou dit oplossen; dat is werk dat pas loont als de servicelaag hier aantoonbaar faalt.
- **`config` wordt door de database niet inhoudelijk bewaakt** (§2a). Een `rating` met `min > max`
  is voor Postgres een geldige rij. Validatie zit in de servicelaag, testpunt 29.
- **5 MB per bestand, niet totaal.** Bij twee bestanden is de bovengrens dus 10 MB. Zo gelezen uit
  "files not larger than 5MB".
- **Geen virusscan** (§6). Risico benoemd; de keuze om zonder te gaan is aan de opdrachtgever.
- **Bestanden vallen buiten de huidige backup** (§6, raakt #30).
- **Conceptopslag vereist volledig ingevulde antwoorden** (§7). Een half ingevulde vraag past niet
  in de constraints. Werkbaar, maar het is een echte beperking.

**Werk dat niet vergeten mag worden:**

- **De bestaande `POST /survey/respond`-test** verwacht een lege body en moet aangepast worden.
- **De bestaande guard krijgt een statuscontrole** (§2b). Dat is een wijziging in code die nu groen
  is; testpunt 30 hoort daarbij geschreven te worden vóór de wijziging.
- **`survey_run` krijgt drie kolommen** (`status`, `is_test`, `survey_kind`) die er nu niet zijn.
- **`survey_response` krijgt drie kolommen** (`subject_vendor_id`, `respondent_user_id`,
  `respondent_label`) en `vendor_id` wordt **nullable**. Dat laatste is een versoepeling op een
  tabel die vanochtend gemerged is; de bestaande UC1-garantie wordt overgenomen door de partiële
  unieke index en de twee CHECK-constraints uit §1c. **Bij het bouwen eerst controleren dat de
  bestaande tests 39 t/m 43 dekken** — een `NOT NULL` weghalen zonder vervanging is precies hoe
  garanties stilletjes verdwijnen.
- **`survey_question` krijgt `UNIQUE (question_id, answer_type)`** — nodig voor de samengestelde
  foreign key uit §4, en niet vanzelfsprekend op een kolom die al primary key is.
- **Twee beheerschermen, niet één** (§2c). Bij UC1 is de leverancier de deelnemer, bij UC2 het
  onderwerp. Een gedeeld scherm met een schakelaar doet beide half.
