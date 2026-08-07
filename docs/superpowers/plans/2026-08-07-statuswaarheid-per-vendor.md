# Statuswaarheid per vendor — uitwerking

> **Dit document beschrijft wat en waarom, nog niet stap voor stap hoe.**
> De drie openstaande vragen zijn beantwoord door de eigenaar op 2026-08-07
> (§7). Volgende stap: omzetten in taken met teststappen, te beginnen bij
> migratie 0017.

**Doel:** de app wordt de centrale waarheid voor de status van elke vragenlijst
per leverancier, zodat een klein team dat elkaar toch al spreekt, niet meer hoeft
te vragen "hoe staat het met X".

**Aanleiding:** eigenaar, 2026-08-07. Bij het bespreken van de schermen voor fase
C bleek de behoefte anders te liggen dan het oorspronkelijke plan aannam. Niet
een beoordeelmachine met rollen en grenzen, maar een statusoverzicht dat de
organisatie helpt.

---

## 1. Wat de eigenaar vroeg, in zijn eigen ordening

> "De app moet vooral de hele organisatie helpen door de centrale waarheid te
> zijn voor de status van de survey per vendor: opgestuurd en nog niet terug,
> terug maar nog niet beoordeeld, beoordeeld maar nog niet goedgekeurd,
> beoordeeld en goedgekeurd."

Daarnaast, in dezelfde toelichting:

1. **Toegankelijk voor de collega's** — contractmanagers en beoordelaars zitten
   in hetzelfde gebouw en vinden elkaar op tien manieren. De app hoeft ze niet
   uit elkaar te houden.
2. **Notities bij een beoordeling**, bedoeld voor collega's.
3. **Hulp bij het versturen van de juiste survey naar de juiste vendor** — met
   nadruk op een goed mailadres.
4. **Hulp bij een heads-up wegens tijdsoverschrijding.**
5. **Uitdrukkelijk geen "totaal geautomatiseerde fabriek".**

Punt 5 is een ontwerpinstructie en geen bijzin. Het is de reden dat dit document
op meerdere plekken kiest voor tonen boven afdwingen.

---

## 2. Wat dit vervangt uit het oorspronkelijke plan

`docs/superpowers/plans/2026-08-03-surveybeheer.md` §Fase C "Frontend" beschrijft
drie schermen: voortgang per ronde, antwoorden lezen met beoordeelblok, en twee
werkvoorraden met een schakelaar "van mij" / "hele organisatie".

**Wat blijft:** de drie schermen, en de twee werkvoorraden als aparte lijsten
(ADR-013 besluit 3 — één lijst met een filter bedient allebei half).

**Wat verandert:** de statusketen wordt het ordenende principe in plaats van de
rondevoortgang. En er komt een vierde status bij, `goedgekeurd`, die nog nergens
bestaat.

**Wat verviel tijdens het gesprek:** een vrijgavestap waarbij de contractmanager
een respons vrijgeeft voordat een beoordelaar eraan mag. Dat is in de bespreking
van 2026-08-07 uitdrukkelijk losgelaten als te ingewikkeld voor de omvang van
het team. Zie §6 — het is bewust geen harde grens geworden, en dat heeft gevolgen
die vastgelegd moeten blijven.

---

## 3. De statusketen

### 3.1 De vier statussen en waar ze vandaan komen

| Status | Afleidbaar uit wat er nu is? |
|---|---|
| Opgestuurd, nog niet terug | **Ja** — `survey_response.submitted_at IS NULL` |
| Terug, nog niet beoordeeld | **Ja** — `submitted_at` gevuld, geen rij in `survey_review` |
| Beoordeeld, nog niet goedgekeurd | **Ja** — minstens één `survey_review` |
| Beoordeeld en goedgekeurd | **Nee — bestaat niet** |

Drie van de vier zijn af te leiden uit bestaande gegevens. Alleen de laatste is
nieuw.

Er is een vijfde toestand die de eigenaar niet noemde maar die het scherm moet
tonen, omdat hij anders onzichtbaar in "opgestuurd, nog niet terug" verdwijnt:

| Extra | Afleidbaar uit |
|---|---|
| Te laat | `submitted_at IS NULL` en `closes_at < now()` bij een `active` ronde |

Dat is dezelfde regel die wens 4 (heads-up bij overschrijding) nodig heeft, dus
hij hoort hier thuis en niet in een apart hoekje.

### 3.2 Waarom goedkeuring geen kolom op `survey_response` wordt

`survey_response.status` bestaat al, met een CHECK op `pending / submitted /
revoked` (migratie 0003). Dat is de **invulstatus**: waar staat de leverancier
in zijn eigen proces.

Goedkeuring is een oordeel van de *organisatie* over die inzending. Die twee
door elkaar halen levert een kolom op die twee dingen tegelijk betekent, en
statuswaarden die elkaar uitsluiten zonder dat iemand dat bedoeld heeft — kan
een `revoked` respons goedgekeurd zijn?

Bovendien is de reden die in migratie 0015 staat om `survey_review` een eigen
tabel te geven, hier onverkort van toepassing:

> Omdat er meerdere oordelen mogen zijn en geen enkele wordt overschreven. Elk
> oordeel staat met naam en datum vast. Een kolom op survey_response zou het
> vorige oordeel wissen (…) en juist in een compliance-dossier is "wat vond men
> er eerder van" de vraag die je later stelt.

Datzelfde geldt voor goedkeuring, en sterker nog: een goedkeuring die later
wordt ingetrokken is precies het geval waarin je wilt kunnen zien dát het is
ingetrokken en door wie.

**Voorstel:** goedkeuring wordt een `verdict`-waarde erbij op `survey_review`,
niet een nieuwe tabel en niet een kolom.

```sql
-- migratie 0017
ALTER TABLE clm.survey_review DROP CONSTRAINT survey_review_verdict_check;
ALTER TABLE clm.survey_review
    ADD CONSTRAINT survey_review_verdict_check
    CHECK (verdict IN ('goed', 'nadere_vragen', 'niet_goed', 'goedgekeurd'));
```

Waarom dat past: goedkeuren is óók een uitspraak van een genoemd persoon op een
genoemd moment over één respons, die nooit overschreven wordt. Dezelfde vorm,
dezelfde RLS-policy, dezelfde append-only-redenering. Een aparte tabel zou die
regels dupliceren zonder verschil te maken.

Waarom het toch aandacht vraagt: `goedgekeurd` is geen *inhoudelijk* oordeel
zoals de andere drie, maar een procesbevestiging. Het scherm moet ze dus niet
als vier gelijkwaardige knoppen naast elkaar zetten. Zie §4.2.

**Alternatief dat is overwogen en afgevallen:** een aparte tabel
`survey_approval`. Netter in theorie — goedkeuring is een ander soort uitspraak —
maar het levert een tweede tabel op met exact dezelfde kolommen, dezelfde policy
en dezelfde append-only-regel, plus een query die twee tabellen moet samenvoegen
om "wat is de huidige status" te beantwoorden. Dat is meer bouwwerk voor
hetzelfde resultaat.

### 3.3 De status is afgeleid, niet opgeslagen

De statusketen wordt **berekend**, niet als veld bijgehouden. Eén functie in de
backend die per respons de status bepaalt, en één plek waar die regel staat.

Dat is belangrijk omdat een opgeslagen status onvermijdelijk uit de pas gaat
lopen met de onderliggende feiten — er is dan een rij die zegt "beoordeeld"
terwijl er geen oordeel staat, en dan is de centrale waarheid juist geen
waarheid meer.

---

## 4. Wat er gebouwd wordt

### 4.1 Backend (repo `MCM2`)

| # | Wat | Migratie |
|---|---|---|
| B1 | `verdict` uitbreiden met `goedgekeurd` | 0017 |
| B2 | `clm.response_note` — losse notities | 0018 |
| B3 | Statusberekening op één plek, meegeleverd in de bestaande responsroutes | — |
| B4 | Werkvoorraad contractmanager: rondes op vendors met `owner_user_id` = ik | — |
| B5 | Overzichtsroute per vendor: alle rondes met hun status | — |

**B2 — waarom notities een eigen tabel worden.** De eigenaar vroeg om een
notitie voor collega's die géén beoordeling is ("gebeld, komt volgende week").
Die in `survey_review` persen zou een `verdict` afdwingen die er niet is, of een
vierde nepwaarde introduceren. Een eigen tabel is hier het eenvoudigst:

```sql
-- migratie 0018
CREATE TABLE clm.response_note (
    note_id     uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    tenant_id   uuid NOT NULL REFERENCES clm.tenant(tenant_id) ON DELETE restrict,
    response_id uuid NOT NULL REFERENCES clm.survey_response(response_id) ON DELETE restrict,
    tekst       text NOT NULL,
    author_user_id uuid NOT NULL REFERENCES clm."user"(user_id) ON DELETE restrict,
    created_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);
```

Met **dezelfde policy als `survey_review`**, inclusief de actor-eis in zowel
`USING` als `WITH CHECK`:

```sql
CREATE POLICY response_note_isolation ON clm.response_note
    USING       (tenant_id = clm.current_tenant_id() AND clm.current_actor() = 'medewerker')
    WITH CHECK  (tenant_id = clm.current_tenant_id() AND clm.current_actor() = 'medewerker');
```

Dat is geen kopieerwerk maar noodzaak: een notitie over een leverancier is voor
collega's, en de leverancier zit in dezelfde tenant. Zonder de actor-eis leest
hij mee. Dit is exact de situatie waar migratie 0015 voor gebouwd is.

**B4 — de contractmanager-werkvoorraad.** `vendor.owner_user_id` bestaat in het
schema (`src/db/schema.ts:153`) maar wordt door **geen enkele route gebruikt** —
geverifieerd, twee treffers in de hele `src/`, beide in het schema zelf. De
werkvoorraad van de contractmanager moet dus vanaf nul, in tegenstelling tot die
van de beoordelaar (`GET /admin/survey/mijn-beoordelingen`, bestaat al).

### 4.2 Frontend (repo `MCM2-frontend`)

Drie schermen, zoals in het oorspronkelijke plan, maar geordend op status.

**S1 — Statusoverzicht per vendor.** Het scherm dat de eigenaar eigenlijk vroeg.
Eén regel per leverancier per ronde, met de status uit §3.1 en het laatste
oordeel erbij. Dit is waar iemand kijkt die wil weten "hoe staat het ervoor".

**S2 — Respons lezen, beoordelen, notitie plaatsen.** De antwoorden, daaronder
de oordelen op datum, de notities, en de invoervelden. Drie inhoudelijke knoppen
(Goed / Nadere vragen / Niet goed) plus **apart daarvan** een goedkeuringsactie —
visueel gescheiden, want het is een processtap en geen vierde mening (§3.2).

Toelichting verplicht bij *nadere vragen* en *niet goed*; dat is bestaande
backendlogica en het scherm moet het vooraf zeggen in plaats van achteraf een
foutmelding tonen.

Bij *nadere vragen* een expliciete zin: **de leverancier merkt hier niets van, u
neemt zelf contact op.** Dit staat al in het oorspronkelijke plan en blijft
staan — een knop die suggereert dat er iets verstuurd wordt terwijl dat niet
gebeurt, is erger dan geen knop.

**S3 — Twee werkvoorraden.** Contractmanager (B4) en beoordelaar (bestaand), als
aparte lijsten. Schakelaar "van mij" / "hele organisatie", **standaard op "van
mij"** (besluit eigenaar 2026-08-07).

### 4.3 Wens 3 en 4 — apart, en waarom

**Hulp bij het juiste mailadres.** Dat `vendor_contact.email` nullable is, is
geen gat maar opzet: een leverancier heeft meerdere contactpersonen en lang niet
elk daarvan hoeft een mailadres te hebben. Alleen degene die de survey krijgt
moet er een hebben, en **dat vangt de backend al af**
(`src/survey/ronde-beheer.service.ts:351-365`):

```sql
LEFT JOIN LATERAL (
       SELECT email FROM clm.vendor_contact
        WHERE vendor_id = v.vendor_id
          AND deleted_at IS NULL
          AND email IS NOT NULL          -- alleen wie te mailen is
        ORDER BY is_primary DESC, created_at ASC
        LIMIT 1
     ) c ON true
```

De keuze is voorspelbaar (primaire contactpersoon eerst, daarna de oudste) en de
`LEFT JOIN` is bewust: een leverancier zonder mailbaar contact blijft in de
lijst staan, het token wordt aangemaakt, en alleen het versturen mislukt — wat
de verzender gemeld krijgt.

**Wat er dan nog te winnen valt, is zichtbaarheid vooraf.** Nu merk je pas bij
het versturen dat er niemand te mailen is. Een leverancier zonder mailbaar
contact zou al in het uitnodigingsscherm herkenbaar moeten zijn, vóór je op
verzenden drukt.

Er is bovendien een bevinding die hier tegenaan ligt: *"een geldig gevormd maar
niet-bestaand mailadres levert Geslaagd op"* (STATUS.md, 2026-08-06) — het bewijs
dat de bounce-webhook nodig is. Een adres kán immers ingevuld en toch verkeerd
zijn, en dát is het overgebleven risico.

**Heads-up bij tijdsoverschrijding.** De berekening (`closes_at < now()` bij
`active`) hoort in de statusketen en zit daarom in §3.1. Maar *een seintje
sturen* is iets anders dan *het zichtbaar maken*, en hangt aan e-mail (fase D)
en Issue #16.

**Voorstel:** beide worden eigen stappen ná de statusketen. Het zichtbare deel
van "te laat" komt wel meteen mee, want dat is dezelfde regel.

---

## 5. Volgorde

De statusketen eerst en compleet, omdat de rest eraan hangt.

| Stap | Wat | Waar |
|---|---|---|
| 1 | Migratie 0017 (`goedgekeurd`) + statusberekening + tests | MCM2 |
| 2 | Migratie 0018 (`response_note`) + routes + tests | MCM2 |
| 3 | B4 en B5: werkvoorraad contractmanager, overzicht per vendor | MCM2 |
| 4 | S1: statusoverzicht per vendor | MCM2-frontend |
| 5 | S2: lezen, beoordelen, notitie | MCM2-frontend |
| 6 | S3: twee werkvoorraden | MCM2-frontend |
| — | *Daarna:* mailadres-hulp (wens 3), heads-up (wens 4) | beide |

Stap 1 t/m 3 zijn backend en gaan in aparte PR's per migratie — dat is de
werkwijze die bij fase C ook is aangehouden en die bij het mergen op 2026-08-07
zijn nut bewees.

**Let op bij het ketenen van PR's:** richt een PR die op een andere branch staat
op `main` **vóórdat** de onderliggende gemerged wordt. Anders klapt hij dicht
zoals #95 op 2026-08-07 — heropenen kan dan niet meer.

---

## 6. Eén ding dat vastgelegd moet blijven

Tijdens de bespreking is een vrijgavestap overwogen (contractmanager geeft vrij,
daarna mag de beoordelaar) en daarna losgelaten omdat het team klein is en
elkaar toch spreekt.

**Dat is de juiste keuze voor deze organisatie, en hij botst niet met ADR-013 —
juist doordat hij is losgelaten.** `src/survey/beoordelaar.service.ts` zegt in
zoveel woorden:

> **Voor wie hier later iets bouwt:** gebruik `template_reviewer` nooit om een
> beoordeling te blokkeren. Een harde grens legt het proces stil zodra de
> gekoppelde beoordelaar ziek is, en dan wijzigt iemand met databasetoegang de
> koppeling — een noodgreep buiten de app om, zonder spoor.

Een vrijgave die beoordelen blokkeert zou precies zo'n harde grens zijn geweest.
Wordt de wens later opnieuw gesteld, dan is dat een aanpassing van ADR-013 en
geen detail — met dezelfde vraag erbij: wat gebeurt er als degene die moet
vrijgeven twee weken weg is.

De statusketen doet wat de vrijgave zou moeten doen, zonder iemand tegen te
houden: je ziet dát er nog niet beoordeeld is.

---

## 7. Besloten (eigenaar, 2026-08-07)

**V1 — Wie mag goedkeuren? → Iedereen, mits de identiteit vastligt.**

Geen `@VereistRol('admin')`, consequent met beoordelen. De voorwaarde die de
eigenaar erbij stelde is precies de onderbouwing die er al lag: elk oordeel
staat met naam en datum vast en wordt nooit overschreven (plan §2a).

**Die voorwaarde is een bouwopdracht, geen bijzin.** Concreet betekent het:

- De goedkeurder komt **uit de sessie, nooit uit de body** — dezelfde regel als
  bij beoordelen (`vragenlijst-beheer.controller.ts:187-194`). Anders kan iemand
  goedkeuren op naam van een collega, en in een compliance-dossier is dat de
  handtekening die moet kloppen.
- `reviewer_user_id` is `NOT NULL` met `ON DELETE restrict` (migratie 0015,
  *"een oordeel zonder naam is waardeloos in een compliance-dossier"*). Dat geldt
  onverkort voor een goedkeuring.
- Het scherm toont bij elke goedkeuring **wie** en **wanneer**, niet alleen dát
  het is goedgekeurd.

Er komt een tegenproef die dit bewijst: een poging om goed te keuren met een
andere `userId` in de body legt de goedkeuring vast op naam van de ingelogde
gebruiker, niet die van de body.

**V2 — Mag een goedkeuring ingetrokken worden? → Ja, met zichtbare intrekking.**

Via `deleted_at`, zoals de tabel al werkt. Het scherm toont dát er is
ingetrokken en door wie; de intrekking verdwijnt niet stilletjes uit beeld. Een
goedkeuring die spoorloos kan verdampen is geen centrale waarheid.

**V3 — Twee tegenstrijdige oordelen? → Het laatste telt, maar het meningsverschil
blijft zichtbaar.**

De statusberekening neemt het laatste oordeel (`ORDER BY created_at DESC
LIMIT 1`, zoals de bestaande werkvoorraadquery). Maar het overzicht toont
daarnaast dat er méér oordelen zijn — anders verdwijnt een meningsverschil uit
beeld, en dat is juist wat je wilt zien.

`WerkvoorraadItem` levert `aantalOordelen` daar nu al voor
(`beoordelaar.service.ts:48`); dat veld gaat mee naar het statusoverzicht.

---

## 8. Wat af is wanneer

Je opent één scherm en ziet per leverancier waar zijn vragenlijst staat:
opgestuurd, terug, beoordeeld, goedgekeurd — of te laat. Je kunt een inzending
openen, lezen, beoordelen en er een notitie voor een collega bij zetten. Een
tweede oordeel wist het eerste niet. En je ziet je eigen stapel, met één klik de
hele organisatie erbij.

Niet af, bewust: automatische herinneringen, bouncedetectie, en alles wat de
eigenaar met "geen totaal geautomatiseerde fabriek" heeft afgegrensd.
