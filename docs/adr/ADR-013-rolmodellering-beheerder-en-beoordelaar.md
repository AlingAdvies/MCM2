# ADR-013 — Wie beheert en wie beoordeelt: waar die rollen aan hangen

- **Status:** voorgesteld — vastgelegd op basis van de domeincontext van de eigenaar (2026-08-06), te bevestigen bij de eerste pilotronde.
- **Datum:** 2026-08-06
- **Aanleiding:** bij het ontwerpen van het overzichtsscherm ("wat wacht er op mij?") bleek dat MCM2 geen antwoord heeft op de vraag *van wie* een openstaande beoordeling is. De tenant kent `admin` en `reviewer`, maar niets koppelt een persoon aan een vendor of aan een vragenlijst.
- **Relatie:** fase C van `docs/superpowers/plans/2026-08-03-surveybeheer.md`, ADR-006 (identity), `docs/architecture-review/2026-07-24/08-transdev-mvp-scope.md`

---

## Context

De MVP richt zich op **vendor IT compliance** binnen het domein contractmanagement. De domeincontext, zoals de eigenaar hem op 2026-08-06 beschreef:

- Vendors hebben contracten.
- Sommige contracten — en daarmee sommige vendors — hebben een complianceverplichting.
- Binnen de tenant worden contracten en vendors beheerd door **contractmanagers**, met een account via Entra ID.
- De contractmanager is ook verantwoordelijk voor de surveys van zijn vendors.
- De ingediende surveys worden **beoordeeld door een beoordelaar, niet altijd dezelfde persoon**.
- Verschillende contracten kunnen verschillende compliance-eisen hebben, en dus verschillende vragenlijsten. IT-contracten krijgen de Vendor IT Compliance-vragenlijst.

Wat MCM2 daarvan vandaag kent:

| Uit de context | In het model |
|---|---|
| Contractmanager | `clm.vendor.owner_user_id` — **bestaat, wordt nergens gebruikt** |
| Beoordelaar | rol `reviewer` in `tenant_membership` — bestaat, maar aan niets gekoppeld |
| Contracten | **niet aanwezig** — expliciet buiten de MVP-scope |
| Verplichting per contract | niet aanwezig |

Zolang niets van dit alles gekoppeld is, kan een overzichtsscherm alleen "alles in de tenant" tonen. Bij vijftig vendors en één beoordelaar is dat nog te doen; het schaalt niet, en het beantwoordt de vraag "wat wacht er op mij" niet.

---

## Besluit 1 — De beheerder hangt aan de vendor

`clm.vendor.owner_user_id` wordt in gebruik genomen als **de contractmanager die deze vendor beheert**.

De kolom bestaat al sinds migratie 0000 en staat in `src/db/schema.ts`; er is geen migratie nodig. Wat ontbreekt is invulling: hem zetten bij het aanmaken van een vendor, tonen in het scherm, en erop kunnen filteren.

**Waarom aan de vendor en niet aan de ronde:** een ronde is een gebeurtenis, een vendor is een blijvende relatie. Wie de vendor beheert, verandert zelden; wie een specifieke ronde uitzette, is een historisch feit dat al in `created_by` staat.

---

## Besluit 2 — De beoordelaar hangt aan de vragenlijst

Een nieuwe koppeltabel `clm.template_reviewer` verbindt een gebruiker aan een `survey_template`.

```
clm.template_reviewer
  ├── tenant_id      (RLS, zoals alles)
  ├── template_id    welke vragenlijst
  ├── user_id        wie hem beoordeelt
  └── created_at / created_by
```

**Waarom aan de vragenlijst en niet aan de vendor of de ronde.** Beoordelen is vakinhoud, geen eigenaarschap. Wie een IT-compliancevragenlijst kan beoordelen — bij Transdev de CISO — kan dat voor élke vendor. De contractmanager van vendor X kan dat voor géén enkele, ook niet voor zijn eigen vendor.

Dat onderscheid is de kern: **beheren is eigenaarschap, beoordelen is expertise.** Die twee horen niet aan hetzelfde object te hangen, en dat is precies waarom ze in dit model uit elkaar getrokken worden.

Het schaalt ook de goede kant op: komt er een Privacy/AVG-vragenlijst bij, dan koppel je daar de FG aan zonder één vendor of ronde aan te raken.

### Meerdere beoordelaars per vragenlijst zijn toegestaan

Geen unieke sleutel op `template_id`. Bij Transdev is het er waarschijnlijk één, maar die ene gaat met vakantie.

Nu toestaan kost niets; later verruimen is een migratie op productiedata.

---

## Besluit 3 — De koppeling is een hulpmiddel, geen autorisatiegrens

**Dit is het belangrijkste besluit in deze ADR, en het minst vanzelfsprekende.**

Een gekoppelde beoordelaar krijgt de betreffende inzendingen in zijn werkvoorraad. Maar **elke reviewer binnen de tenant mag elke inzending beoordelen** — de koppeling bepaalt wat je standaard ziet, niet wat je mag.

### Waarom niet exclusief

De voor de hand liggende keuze bij compliance is een harde grens: alleen de CISO beoordeelt IT-compliance. Die keuze is hier bewust níét gemaakt, om twee redenen.

**Een harde grens legt het proces stil bij afwezigheid.** Is de CISO ziek, dan blijven de inzendingen liggen tot hij terug is, of moet iemand met databasetoegang de koppeling wijzigen. Dat tweede is erger dan het probleem: een noodgreep buiten de app om, zonder spoor.

**Besluit eigenaar 2026-08-06: de fallback is de contractmanager.** Die zorgt er intern — buiten de app — voor dat de beoordeling door een geautoriseerd persoon gedaan wordt. Dat werkt alleen als de app het niet blokkeert.

Dat is een bewuste verschuiving: **de autorisatie ligt bij de organisatie, de app legt vast wie het feitelijk deed.** Voor een compliancedossier is dat verdedigbaar, en het hangt aan één ding uit het surveybeheerplan §2a: elk oordeel is met naam en datum vastgelegd en wordt nooit overschreven. Wie beoordeelt buiten zijn vakgebied, doet dat zichtbaar.

Zonder die historie zou dit besluit niet houdbaar zijn en zou de grens hard moeten.

### Wat er dan wél hard blijft

De rolgrens uit fase C verandert niet:

- **Rondes starten, deelnemers toevoegen, vendors wijzigen** — `@VereistRol('admin')`
- **Lezen en beoordelen** — ook een reviewer

Een reviewer die een inzending buiten zijn vakgebied beoordeelt is een organisatorische afweging. Een reviewer die een ronde start is een rechtenfout, en die blijft geblokkeerd.

---

## Besluit 4 — De contractlaag komt er nu niet

Contracten staan expliciet buiten de MVP-scope: *"Contracten, taken, issues, certificeringen — niet nodig voor de survey-flow zelf"* (`08-transdev-mvp-scope.md` r. 25).

De domeincontext zegt dat een complianceverplichting eigenlijk aan het **contract** hangt, niet aan de vendor. Dat klopt, en het is de juiste doelarchitectuur. Voor de pilot verandert het niets:

**Alle vendors in de Transdev-pilot hebben dezelfde verplichting** — de Vendor IT Compliance-vragenlijst. Er is één vragenlijst. Een contractlaag zou vandaag voor elke vendor hetzelfde antwoord geven.

Wat het wél zou kosten: een tabel, een koppeltabel naar vragenlijsten, beheerschermen om contracten in te voeren, en migratie van bestaande vendors. Een fase op zich, die vóór de pilot geen enkele beslissing anders doet uitvallen.

### Wat er verandert als contracten er komen

Vastgelegd zodat dit een bewuste beperking blijft en geen vergeten laag:

- `survey_run` krijgt een verwijzing naar het contract waarvoor de ronde loopt.
- **Welke vragenlijst van toepassing is, wordt een eigenschap van het contract** in plaats van een keuze van de beheerder bij het starten van een ronde.
- De beheerder verschuift mogelijk van de vendor naar het contract — één vendor kan meerdere contracten hebben met verschillende managers.

Dat laatste is de reden dat besluit 1 hier expliciet staat: als de contractlaag komt, is `vendor.owner_user_id` een kandidaat om te verhuizen, en dan moet duidelijk zijn dat hij ooit bewust op de vendor is gezet.

---

## Gevolgen

### Voor het overzichtsscherm

"Wat wacht er op mij" betekent voor twee rollen iets anders, en dat zijn **twee werkvoorraden, geen twee filters op dezelfde lijst**:

| Rol | Werkvoorraad |
|---|---|
| Contractmanager | rondes op vendors die ik beheer: wie moet nog invullen, wie is te laat, welke uitnodiging kwam niet aan |
| Beoordelaar | ingediende antwoorden op vragenlijsten waaraan ik gekoppeld ben, over alle vendors heen |

De CISO wil niet zien wie er nog moet invullen — daar gaat hij niet over. De contractmanager wil niet de beoordeelstapel van de hele organisatie.

Met een schakelaar **"van mij" / "hele organisatie"**, want besluit 3 zegt dat de rest zichtbaar moet blijven.

### Voor fase C

Fase C zegt nu *"alle vier de routes mogen door een reviewer"*, zonder onderscheid. Dat blijft gelden — besluit 3 maakt de koppeling een sorteermiddel, geen guard. Wat erbij komt:

- migratie `template_reviewer` naast `survey_review`
- de routes leveren "van mij"-informatie mee, zodat het scherm kan sorteren zonder een tweede uitvraag

### Wat dit niet oplost

- **Wie krijgt een melding als er iets binnenkomt.** Dezelfde open vraag als bij de backupmeldingen (Issue #48): een werkvoorraad die je moet gaan bekijken, is geen signaal. Deze ADR maakt de stapel zichtbaar; niet dat iemand ernaar kijkt.
- **Beoordelaar per vendor.** Als Transdev ooit wil dat vendor X door een andere CISO beoordeeld wordt dan vendor Y, past dit model daar niet op. Dan is de koppeling niet template → user maar (template, vendor) → user. Geen reden om daar nu op te bouwen.

---

## Tegenproeven

Conform `MCM2-CLAUDE.md` §15b, te schrijven vóór de code bestaat:

1. **Een reviewer van tenant A ziet geen `template_reviewer`-rijen van tenant B.** De standaardbehandeling, maar hij hoort erbij: dit is een nieuwe tabel en RLS is geen eigenschap die je erft.
2. **Een leverancierspad kan `template_reviewer` niet lezen.** De actor-eis uit migratie 0013 in `USING` én `WITH CHECK`.
3. **Een reviewer die niet gekoppeld is, kan wél beoordelen.** Dit is de tegenproef op besluit 3: slaagt hij niet, dan is er per ongeluk een harde grens gebouwd en ligt het proces stil zodra iemand ziek is.
4. **Een reviewer die niet gekoppeld is, ziet die inzending níét in zijn eigen werkvoorraad.** De keerzijde van 3: de koppeling moet wél iets doen, anders is de tabel decoratie.
