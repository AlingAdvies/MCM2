# Contract: opzegtermijn, waarschuwingstermijn, verlengt-automatisch

**Status:** ontwerp goedgekeurd, klaar voor implementatieplan
**Datum:** 2026-08-23
**Issue:** [#174](https://github.com/AlingAdvies/MCM2/issues/174)
**Vervolg op:** de urgentiekleur-tussenoplossing uit
`docs/superpowers/specs/2026-08-23-leveranciersscherm-dichtheid-design.md`
§5, die dit ontwerp vervangt.

---

## 1. Aanleiding

Bij het bouwen van de urgentiekleur-tussenoplossing (23-08, ochtend) merkte
de eigenaar op dat voor een contractbeheerder twee dingen het belangrijkst
zijn: compliance-status en tijdige waarschuwing vóór de einddatum. Er treedt
veel schade op door onbedoelde stilzwijgende verlenging van contracten. De
tussenoplossing (kleur op de kale `end_date`, drempels 90/30 dagen, geen
opzegtermijn-correctie) was bewust een eerste stap; dit ontwerp levert de
echte, opzegtermijn-bewuste waarschuwing.

**Correctie op een eerdere aanname.** Issue #174 stelde dat MVM_V2 dit al
had opgelost (`noticePeriodDays`, `daysUntilExpiry`). Bij nadere
bestudering tijdens deze brainstorm bleek dat niet zo: MVM_V2 toont
`noticePeriodDays` alleen als los informatief veld naast de einddatum,
zonder een berekening die de opzegdatum zelf (einddatum − opzegtermijn)
afzet tegen vandaag, en zonder waarschuwingslogica. De waarschuwingslogica
in dit ontwerp is dus nieuw, niet overgenomen.

**Kernprincipe, expliciet door de eigenaar vastgesteld:** de tool bewaakt
*tijdigheid* — waarschuwt dat een moment nadert — maar beslist niet wát er
moet gebeuren. Of een contract daadwerkelijk automatisch verlengt, staat
vaak niet gestructureerd vastgelegd (verspreid over de organisatie); dat is
een apart, door de beheerder zelf in te vullen feit, geen afgeleide waarde.

---

## 2. Scope

**In scope:**
- Drie nieuwe velden op `clm.contract`: opzegtermijn, waarschuwingstermijn
  (instelbaar per contract, default 90 dagen), verlengt-automatisch
  (ja/nee/onbekend, default onbekend).
- Nieuwe waarschuwingslogica die de bestaande urgentiekleur-tussenoplossing
  (`contractUrgentie.ts`) **vervangt**, geen aparte laag ernaast.
- Contractformulier (aanmaken + bewerken): de drie nieuwe velden.
- Contractrij: toont de nieuwe waarschuwingsstaat met een tekst die het
  "waarom" benoemt.
- Berekenfunctie geïsoleerd (geen React-afhankelijkheden) zodat een latere
  backend-notificatie (issue #148) dezelfde regel kan herimplementeren
  zonder te gokken wat de frontend precies doet.

**Bewust buiten scope:**
- De notificatiefunctie zelf (issue #148) — dit ontwerp legt alleen de
  herbruikbare berekening vast, bouwt geen notificatiekanaal.
- Een instellingenscherm voor een tenant-brede default-waarschuwingstermijn
  — de instelling is per contract, niet per tenant, in deze ronde.

---

## 3. Datamodel — migratie 0029 op `clm.contract`

```sql
ALTER TABLE clm.contract
  ADD COLUMN notice_period_days  integer,
  ADD COLUMN warning_days_before integer NOT NULL DEFAULT 90,
  ADD COLUMN auto_renews         text;

ALTER TABLE clm.contract
  ADD CONSTRAINT contract_auto_renews_check
  CHECK (auto_renews IN ('ja', 'nee', 'onbekend') OR auto_renews IS NULL);
```

- **`notice_period_days`** (nullable): opzegtermijn in dagen. Niet elk
  contract heeft deze bekend — nullable is de correcte modellering, geen
  lege string.
- **`warning_days_before`** (NOT NULL, default 90): hoeveel dagen vóór de
  referentiedatum (zie §4) gewaarschuwd wordt. Instelbaar per contract, niet
  per tenant. Bestaande rijen krijgen de default via `ADD COLUMN ...
  DEFAULT`, geen aparte UPDATE nodig.
- **`auto_renews`** (nullable, CHECK i.p.v. een aparte ref-tabel): drie
  vaste waarden die nooit per tenant configureerbaar worden — een aparte
  `ref.contract_auto_renews`-tabel zoals `ref.contract_status` zou hier
  overbodige indirectie zijn voor een gesloten, niet-uitbreidbare lijst.
  Bewuste afwijking van het `contract_status`-patroon; opgeschreven zodat
  een volgende sessie niet per ongeluk "consistentie" afdwingt door alsnog
  een ref-tabel toe te voegen.
- **Default van `auto_renews` bij aanmaken is `NULL`** (weergegeven als
  "Onbekend" in de UI), niet een verplicht in te vullen veld — eerlijk over
  wat nog niet uitgezocht is.

---

## 4. Waarschuwingslogica

Vervangt `contractUrgentie.ts` in zijn geheel. Blijft een pure functie
(geen React, geen fetch) — dat is de eis voor herbruikbaarheid richting
issue #148.

### Referentiedatum

```
referentiedatum = notice_period_days is ingevuld
  ? end_date − notice_period_days dagen   (de opzegdatum)
  : end_date                              (geen opzegtermijn bekend, dus de
                                            einddatum zelf is het laatste
                                            moment dat ertoe doet)
```

### Staten, in volgorde van toenemende urgentie

| Staat | Voorwaarde | Betekenis |
|---|---|---|
| `neutraal` | referentiedatum ligt meer dan `warning_days_before` dagen in de toekomst | geen actie nodig |
| `waarschuwing` | referentiedatum ligt binnen `warning_days_before` dagen, maar meer dan 14 dagen weg | tijd om uit te zoeken/te handelen |
| `alarm` | referentiedatum ligt binnen 14 dagen, of is al verstreken | bijna te laat — vaste, niet-instelbare drempel, los van `warning_days_before` |

De 14-dagen-alarmdrempel is bewust vast (niet instelbaar): dat is de "dit
wordt nu echt urgent"-grens, onafhankelijk van hoe ruim de beheerder zijn
eigen waarschuwingstermijn heeft gezet.

### Tekst bij de staat (het "waarom")

- Met `notice_period_days` ingevuld: *"opzegtermijn nadert"* /
  *"opzegtermijn bijna verstreken"* / *"opzegtermijn verstreken"*
- Zonder `notice_period_days`: *"geen opzegtermijn bekend — einddatum
  nadert"* / *"geen opzegtermijn bekend — einddatum bijna daar"* /
  *"einddatum verstreken"*

Geen claim over automatische verlenging in deze tekst zelf — dat is precies
waar `auto_renews` apart voor bestaat (zie §5).

---

## 5. `auto_renews` — apart getoond, niet vermengd met de waarschuwing

- Toont als eigen label naast (niet in plaats van) de waarschuwingsstaat:
  "Verlengt automatisch: Ja" / "Nee" / "Onbekend".
- Bij `onbekend` én een `waarschuwing`/`alarm`-staat: dit is het moment
  waarop het voor de beheerder het meest waardevol is om dat uit te zoeken
  — geen automatische actie, wel de twee signalen naast elkaar zodat de
  samenhang zichtbaar is.
- Bewerkbaar in het contractformulier als een simpele driekeuze
  (Ja/Nee/Onbekend), default Onbekend bij aanmaken.

---

## 6. UI

### Contractformulier (aanmaken + bewerken)
Drie nieuwe velden, in de bestaande `ContractFormuliervelden`-component:
- Opzegtermijn (dagen) — getal, leeg toegestaan
- Waarschuwingstermijn (dagen) — getal, voorgevuld met 90 bij aanmaken
- Verlengt automatisch — Ja / Nee / Onbekend, voorgevuld Onbekend bij
  aanmaken

### Contractrij (compact) en uitgeklapte rij (detail)
- Compacte rij: vervangt de huidige kale-einddatum-kleur door de nieuwe
  waarschuwingsstaat-kleur, met de korte "waarom"-tekst eronder (zoals
  `EindeIndicator` nu al doet, alleen met de nieuwe logica).
- Uitgeklapte rij: toont opzegtermijn, waarschuwingstermijn en
  verlengt-automatisch als velden, naast de bestaande contractvelden.

---

## 7. Herbruikbaarheid voor issue #148

De berekenfunctie (`contractWaarschuwing.ts`, vervangt
`contractUrgentie.ts`) accepteert alleen primitieve waarden (`endDate`,
`noticePeriodDays`, `warningDaysBefore`, een referentiedatum voor "vandaag"
— injecteerbaar, niet `new Date()` hardcoded, zodat een latere
backend-implementatie of een test dezelfde functie met een vaste datum kan
aanroepen). Geen afhankelijkheid van React, fetch, of de DOM. Dat maakt het
een kandidaat om ongewijzigd te kopiëren naar een toekomstige
notificatiejob, of — als de architectuur van #148 dat vraagt — te
verplaatsen naar een gedeeld pakket. Die verplaatsing zelf is geen
onderdeel van dit issue.

---

## 8. Wat ongewijzigd blijft

- Backend-routes (`POST/PATCH /vendors/:vendorId/contracts/...`) — de
  nieuwe velden gaan gewoon mee in de bestaande `ContractInvoer`/
  `ContractWijziging`-vorm, geen nieuwe route.
- De rest van het leveranciersscherm (badge-strip, modal, uitklapbare rij
  als mechanisme) — dit ontwerp verandert alleen wát er in de rij getoond
  wordt, niet de structuur eromheen.

---

## 9. Test- en verificatiestrategie

- Backend: `contract-invoer.spec.ts` uitbreiden (validatie van de drie
  nieuwe velden), `test/contract-routes.e2e-spec.ts` uitbreiden (aanmaken/
  wijzigen met de nieuwe velden, tegen een wegwerpdatabase).
- Frontend: de berekenfunctie krijgt handmatige verificatie zoals
  `contractUrgentie.ts` deed (geen Jest in deze repo — zie de
  toelichting in het vorige plan), met een reeks vaste datums die elke
  staat-grens raken (net binnen `warning_days_before`, net binnen 14 dagen,
  net verstreken, met en zonder `notice_period_days`).
- E2e (Playwright): contractrij toont de juiste tekst/kleur voor een
  contract met een bekende einddatum en opzegtermijn.
- `backup-verwachting.json` bijwerken naar migratie 0029.
