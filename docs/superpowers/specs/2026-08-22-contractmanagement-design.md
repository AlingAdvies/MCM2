# Ontwerp — Contractmanagement (basismodule)

**Type:** spec — datamodel + relaties, geen implementatieplan
**Eigenaar:** de eigenaar (Chris)
**Opgesteld:** 2026-08-22, uit brainstorming n.a.v. `docs/opmerkingen Vendor IT survey.txt`
(21-08, punt 2) en `docs/architectuur/roadmap-vendor-it-survey.md` §3.1–3.2
(issues [#156](https://github.com/AlingAdvies/MCM2/issues/156),
[#157](https://github.com/AlingAdvies/MCM2/issues/157)).
**Criticality:** productieapp voor een echte klant (AlingAdvies-tenant, straks
Transdev). Geen prototype.
**Platform:** desktop/PC.
**Security:** volledig tenant-gebonden data, dezelfde RLS-discipline als de
rest van het schema — geen uitzondering.

---

## 1. Waarom dit nu, en waarom dit de vorm heeft die het heeft

Twee losse bevindingen uit het testen op productie (21-08) bleken bij
doorvragen dezelfde onderliggende vraag te zijn: *"hoe hangt een contract
samen met een leverancier, een contactpersoon, en een vragenlijst?"* Dat is
precies de vraag die de roadmap in §3.2 al signaleerde als iets dat "een
eigen ontwerpstap vóór er code komt" verdient. Dit document is die stap.

**Twee dingen lagen al klaar voordat dit ontwerp begon**, en die bepalen een
deel van de vorm:

- `survey_run.contract_id` bestaat al sinds migratie 0007 — nullable, bewust
  zonder foreign key, met een commentaar dat zegt: *"zodra clm.contract
  bestaat, is dit één ALTER TABLE erbij."* Dit ontwerp lost die belofte in.
- `clm.vendor_contact` bestaat al als 1-op-veel bij `vendor`, inclusief een
  `is_primary`-vlag. Het contract-datamodel hergebruikt dat patroon in plaats
  van een nieuw contactpersoon-concept te verzinnen.

**Scope van dit document:** het datamodel en de relaties. Niet: de
schermen/UI (aparte implementatiestap), niet de bulk-upload (issue #160,
bouwt hier bovenop maar is een apart ontwerp), niet de vragenlijst-bouwer
(issue #155, ongerelateerd).

---

## 2. Datamodel

### 2.1 `clm.contract` — nieuwe tabel

Naar het bestaande patroon van `clm.vendor` / `clm.vendor_contact`: dezelfde
kolomstijl, dezelfde RLS-opzet, dezelfde `set_updated_at`-trigger, dezelfde
soft-delete via `deleted_at`.

| Kolom | Type | Verplicht | Toelichting |
|---|---|---|---|
| `contract_id` | uuid PK, `gen_random_uuid()` | ja | |
| `tenant_id` | uuid | ja | RLS-kolom, zoals overal |
| `vendor_id` | uuid FK → `clm.vendor(vendor_id)` ON DELETE CASCADE | ja | een leverancier kan meerdere contracten hebben |
| `name` | text | ja | vrije titel, bv. "Hosting 2024–2027" — nodig zodra een vendor meerdere contracten heeft, anders is een lijst niet te onderscheiden |
| `contract_number` | text | nee | extern nummer uit het ERP-systeem van de tenant; geen uniekheidseis (MCM2 controleert de nummering van een extern systeem niet) |
| `vendor_contact_id` | uuid FK → `clm.vendor_contact(contact_id)` ON DELETE SET NULL | nee | contract-specifieke contactpersoon; `NULL` betekent "gebruik de leading (`is_primary = true`) contactpersoon van de vendor" — dit is applicatielogica bij het tonen/gebruiken van het contract, geen database-default |
| `owner_user_id` | uuid FK → `clm.user(user_id)` ON DELETE SET NULL | nee | contractbeheerder; zelfde patroon als `vendor.owner_user_id` |
| `status_code` | text FK → `ref.contract_status(code)` ON DELETE SET NULL | nee | zie §2.3 |
| `value_eur` | numeric(15,2) | nee | contractwaarde |
| `start_date` | date | nee | |
| `end_date` | date | nee | |
| `note` | text | nee | vrij notitieveld, bv. "verwachten geen verlenging na dec-27" |
| `created_at` | timestamptz, `now()` | ja | |
| `updated_at` | timestamptz | nee | via trigger |
| `deleted_at` | timestamptz | nee | soft delete |

**Waarom `vendor_contact_id` nullable met een applicatie-fallback, en niet
een database-default of een verplicht veld:** het is precies wat in de
brainstorming is vastgesteld — een contract mag een eigen contactpersoon
hebben, maar hoeft dat niet. Een database-`DEFAULT` zou het `is_primary`-
contact van de vendor moeten opzoeken op het moment van invoegen, en zou
"bevriezen" op dat moment — verandert de leading contactpersoon van de
vendor later, dan zou een bestaand contract het niet meevolgen zonder dat
expliciet zo bedoeld is. De fallback hoort dus in de leeslaag (API/frontend),
niet in de kolom.

**Waarom geen uniekheidseis op `contract_number`:** het nummer komt uit een
extern systeem dat MCM2 niet beheert. Een uniekheidsconstraint zou fouten
geven op data die buiten MCM2's controle om al dubbel kan zijn (of gewoon
leeg blijft omdat een tenant geen ERP-nummering voert). Blokkerend gedrag
hoort — als het ooit nodig is — bij de bulk-upload-validatie (issue #160),
niet bij de kolom zelf.

### 2.2 `ref.contract_status` — nieuwe ref-tabel

Zelfde patroon als `ref.compliance_status`, `ref.business_criticality`,
`ref.vendor_category`: `code` (PK) + `label`.

| code | label |
|---|---|
| `actief` | Actief |
| `verlopen` | Verlopen |
| `opgezegd` | Opgezegd |

**"Verlopend" staat hier bewust niet in.** Zie §2.3.

### 2.3 "Verlopend" is een afgeleide weergavestatus, geen databasewaarde

Een contract raakt "verlopend" puur door het verstrijken van tijd — niet door
een handeling van een gebruiker. Dat verschilt fundamenteel van `actief` →
`opgezegd` (een besluit) of `actief` → `verlopen` (ook een besluit, of in elk
geval een moment waarop iemand het vaststelt).

**Regel:** een contract toont als "verlopend" in de UI wanneer
`status_code = 'actief' AND end_date IS NOT NULL AND end_date <= vandaag + 90 dagen`.
Dit wordt berekend in de leeslaag (API-response of frontend), nooit
opgeslagen.

**Waarom niet opslaan:** een opgeslagen "verlopend"-status zou ofwel een
achtergrondtaak vereisen die hem dagelijks bijwerkt (nieuw mechanisme, nieuw
risico op stil achterlopen — precies het patroon dat dit project al eerder
trof, zie `MCM2-CLAUDE.md` punt 4b), ofwel zou hij verstoppen achter een
verouderde waarde totdat iemand toevallig het record opent. Een berekende
waarde is per definitie nooit verouderd.

### 2.4 `clm.contract_survey_template` — nieuwe koppeltabel

Many-to-many, geen extra kolommen buiten de sleutels:

| Kolom | Type | Toelichting |
|---|---|---|
| `contract_id` | uuid FK → `clm.contract(contract_id)` ON DELETE CASCADE | |
| `survey_template_id` | uuid FK → `clm.survey_template(survey_template_id)` ON DELETE CASCADE | |
| `tenant_id` | uuid | RLS-kolom |
| `created_at` | timestamptz, `now()` | |

PK: samengesteld op `(contract_id, survey_template_id)`, zoals
`clm.vendor_tag` dat al doet met `(vendor_id, tag)`.

**Doel:** vastleggen welke vragenlijst-templates relevant zijn voor een
contract. Geen frequentie- of verplicht/optioneel-veld — dat raakt de nog
niet gebouwde "rondes/herhaling"-feature (roadmap §2.2) en is bewust
uitgesteld tot die feature er is en de vraag concreet wordt.

**Gebruik (buiten scope van dit ontwerp, ter oriëntatie):** bij het
aanmaken van een nieuwe survey-ronde kan het scherm de templates tonen die
aan het gekozen contract gekoppeld zijn, als voorstel — niet als
verplichting. Een ronde zonder contract, of met een template die niet aan
het contract gekoppeld is, blijft mogelijk (UC1 uit migratie 0007 mag niet
breken).

### 2.5 `survey_run.contract_id` krijgt zijn foreign key

Migratie 0007 introduceerde de kolom bewust zonder FK, met de aankondiging
dat dit later "één ALTER TABLE ... ADD CONSTRAINT" zou zijn zodra
`clm.contract` bestaat. Dat moment is nu:

```sql
ALTER TABLE "clm"."survey_run"
  ADD CONSTRAINT "survey_run_contract_id_contract_contract_id_fk"
  FOREIGN KEY ("contract_id") REFERENCES "clm"."contract"("contract_id")
  ON DELETE SET NULL;
```

`ON DELETE SET NULL` (niet CASCADE, niet RESTRICT): een survey-ronde is een
afgerond of lopend beoordelingsmoment. Een verwijderd contract mag dat
historische bewijs niet laten verdwijnen — de ronde blijft bestaan, verliest
alleen de koppeling. Consistent met hoe `vendor.owner_user_id` en
`vendor.category_code` nu ook `SET NULL` gebruiken in plaats van CASCADE.

Blijft nullable, zoals migratie 0007 al vastlegde: een ronde hoeft niet aan
een contract te hangen.

---

## 3. Relatieoverzicht

```
vendor (1) ──< (N) contract ──> (0..1) vendor_contact   [contract.vendor_contact_id, fallback: vendor_contact.is_primary]
vendor (1) ──< (N) vendor_contact
contract (0..1) ──> (0..1) clm.user                     [contract.owner_user_id]
contract (0..1) ──> (0..1) ref.contract_status           [contract.status_code]
contract (N) ──< contract_survey_template >── (N) survey_template
survey_run (0..1) ──> (0..1) contract                    [survey_run.contract_id]
```

---

## 4. Row Level Security

Geen keuze, de architectuurregel (`MCM2-CLAUDE.md` §7): elke nieuwe
tenant-gebonden tabel krijgt handmatig:

- `ENABLE ROW LEVEL SECURITY`
- `FORCE ROW LEVEL SECURITY`
- een policy met zowel `USING` als `WITH CHECK` op `tenant_id = clm.current_tenant_id()`

Dit geldt voor zowel `clm.contract` als `clm.contract_survey_template`.
`ref.contract_status` is een gedeelde referentietabel zonder `tenant_id` —
zelfde behandeling als `ref.compliance_status` e.a., geen RLS nodig.

---

## 5. Wat dit ontwerp bewust niet doet

- **Geen UI/schermen.** Dat is een aparte implementatiestap na dit ontwerp.
- **Geen bulk-upload.** Issue #160 bouwt hier straks bovenop. Dit datamodel
  is er wel geschikt voor gemaakt: matching kan op `vendor_id` (via
  vendor-naam/KVK, al bestaand mechanisme) + `contract_number`, zonder dat
  daarvoor eerst een aparte migratie nodig is. De eigenaar noemde tijdens de
  brainstorming een verwachte omvang van ~50 contracten nu, oplopend naar
  150+ — dat is een argument om het datamodel nu bulk-vriendelijk te maken,
  niet om de bulk-upload-UI nu al te bouwen.
- **Geen automatische statuswijziging.** Zie §2.3 — "verlopend" is bewust
  nooit een geschreven waarde.
- **Geen contract-specifieke velden per leverancierstype.** De koppeling
  contract → leverancierstype loopt via het bestaande `vendor.category_code`
  — er komt geen apart `category_code` op `contract` zelf, want dat zou een
  contract kunnen laten afwijken van het type van zijn eigen vendor, wat geen
  zinnige toestand is.
- **Geen migratie van bestaande contractdata.** Er bestaat nergens in MCM2
  contractdata (geen tabel, geen seed) — er is dus niets over te zetten.
  `clm.contract` start leeg.

---

## 6. Open vraag voor de implementatiestap

Geen — alle scope-vragen zijn tijdens de brainstorming beantwoord. De
implementatiestap (via `writing-plans`) kan direct volgen op dit document.

---

## Bronnen

- `docs/opmerkingen Vendor IT survey.txt`, 21 augustus, punt 2/2a/2b/2c
- `docs/architectuur/roadmap-vendor-it-survey.md` §3.1–3.2 (issues #156, #157)
- `drizzle/0007_contract_op_survey_run.sql` — de vooraf klaargezette kolom
  en de reden waarom
- `drizzle/0000_baseline_bestaand_schema.sql` — het `vendor`/`vendor_contact`-
  patroon dat dit ontwerp hergebruikt
- `MCM2-CLAUDE.md` §7 — RLS-verplichting voor elke nieuwe tenant-tabel
