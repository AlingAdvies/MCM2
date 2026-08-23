# Ontwerp — Contractmanagement: scherm en ontbrekende backend-routes

**Type:** spec — vervolg op de datamodel-spec, dekt UI en de routes die
ontbraken om die UI te voeden
**Eigenaar:** de eigenaar (Chris)
**Opgesteld:** 2026-08-22, na een harde en terechte constatering tijdens de
verificatie van de backend-only implementatie: een complete backend zonder
enig scherm is niet te gebruiken en niet echt te testen. Zie
`docs/superpowers/plans/2026-08-22-contractmanagement.md` voor wat al
gebouwd is.
**Criticality:** productieapp voor een echte klant.
**Platform:** desktop/PC, zelfde als de rest van MCM2.

---

## 1. Waarom dit een aparte spec is, en niet een uitbreiding van de vorige

De vorige spec (`2026-08-22-contractmanagement-design.md`) beschreef bewust
alleen het datamodel — §5 zei letterlijk "geen UI/schermen, dat is een
aparte implementatiestap". Die afbakening was op zichzelf verdedigbaar,
maar het gevolg bleek een gat: een backend die niemand kan bereiken is niet
"later nog een schil eromheen", het is een onaf product. Dit document is
die aparte implementatiestap, nu uitgewerkt.

**Twee dingen ontbreken nog in de backend en horen bij dit werk, niet bij
een derde spec:**

1. Er bestaat een tabel `clm.contract_survey_template` (migratie 0027) maar
   geen enkele route ervoor.
2. Er bestaat geen route om de gebruikers van de eigen tenant op te halen —
   nodig voor de contractbeheerder-dropdown.

Dat zijn geen nieuwe ontwerpkeuzes over het datamodel, alleen ontbrekende
lees/schrijf-paden erboven. Vandaar dat ze hier meelopen in plaats van een
eigen spec te krijgen.

---

## 2. Waar dit scherm hoort, en waarom niet zoals MVM_V2

MVM_V2 heeft contracten als een eigen top-level scherm (`/contracts`) met
een sorteerbare tabel, tijdlijnweergave en CATS-levenscyclusfasen
(initiatie/implementatie/uitvoering/monitoring/wijziging/beëindiging).

**MCM2 doet dit anders, bewust:**

- De backend maakt een contract al vendor-gebonden
  (`/vendors/:vendorId/contracts`), niet los. Een los top-level scherm zou
  die relatie in de UI moeten herhalen (een vendor-kiezer) terwijl het
  vendor-detailscherm al precies die context biedt.
- MCM2 kent geen CATS-levenscyclus, geen issues-koppeling, geen
  tijdlijnweergave — dat zijn features van een veel verder ontwikkeld
  contractmanagement-product. Ze meenemen zou een schijn van volledigheid
  geven die de backend niet waarmaakt.

**Besluit:** een nieuwe sectie `Contracten` op
`/beheer/leveranciers/[id]`, in de bestaande structuur van dat scherm:
Stamgegevens → Contactpersonen → **Contracten** (nieuw) →
VendorUitvraagPaneel. Zelfde patroon als `Contactpersonen`/`ContactRij`:
een lijst met inline bewerken, een toevoegformulier eronder.

Wat wél uit MVM_V2 wordt overgenomen, als UI-idee (niet als code — MVM_V2
draait op mock data en een ander framework-patroon):

- Statuskleur per contract (groen=actief, oranje=nadert einde,
  rood=verlopen)
- Een "dagen resterend"/"dagen verlopen"-indicator bij de einddatum

---

## 3. Backend — twee ontbrekende stukken

### 3.1 Route voor tenant-gebruikers

**Nieuwe route:** `GET /tenant/gebruikers`, in `TenantModule` (niet
`ContractModule`: het is generieke tenantdata, geen contract-specifieke
logica, en een toekomstig scherm dat ook een gebruikerslijst nodig heeft
hoeft dan niet naar `ContractModule` te kijken).

Antwoord: `{ gebruikers: [{ userId, naam }] }` — alleen wat een dropdown
nodig heeft. Geen e-mailadres, geen rol: dat is meer dan dit scherm gebruikt
en zou een nieuwe blootstelling zijn die niet bij deze taak hoort.

Toegankelijk voor elke ingelogde gebruiker van de tenant (`RolGuard` staat
lezen toe voor zowel admin als reviewer, zelfde patroon als
`GET /vendors/:id/contracts`) — het is een keuzelijst, geen gevoelige data.

### 3.2 Routes voor de survey-templatekoppeling

**`GET /vendors/:vendorId/contracts/:id/survey-templates`**
Antwoord: `{ templateIds: string[] }` — de ids van de templates die nu aan
dit contract gekoppeld zijn.

**`PUT /vendors/:vendorId/contracts/:id/survey-templates`**
Body: `{ templateIds: string[] }` (mag leeg zijn — "geen enkele vragenlijst
gekoppeld" is een geldige stand, vastgesteld tijdens de brainstorming).

Implementatie: binnen één transactie de bestaande koppelingen voor dit
contract verwijderen en de meegestuurde set opnieuw invoegen. Geen
diff-berekening (verwijderen wat wegvalt, toevoegen wat nieuw is) — bij een
klein aantal templates per contract (naar verwachting 1–3) is
"alles weg, alles opnieuw" net zo correct en eenvoudiger te redeneren over
dan een diff, en de tabel heeft toch geen extra kolommen die verloren
zouden gaan bij het verwijderen van een rij.

**Waarom een aparte PUT en geen onderdeel van `PATCH .../contracts/:id`:**
tijdens de brainstorming vastgesteld dat dit een eigen knop en een eigen
opslaan-actie krijgt in de UI, los van de rest van het contractformulier
— zelfde structuur als contactpersonen nu al een eigen CRUD-blok zijn naast
de vendor-stamgegevens. Een aparte route hoort bij een aparte UI-actie.

**Rollen:** `@VereistRol('admin')`, zelfde als de rest van
`ContractController`.

**RLS:** geen wijziging nodig — `clm.contract_survey_template` heeft al
zijn policy uit migratie 0027. Een query moet wel expliciet filteren op
`contract_id` én controleren dat dat contract bij de opgegeven `vendorId`
en de sessie-tenant hoort (zelfde 404-redenering als de rest van
`ContractController`: onbekend en "niet van u" zijn niet te onderscheiden).

### 3.3 Contract-detail breidt uit met namen, niet alleen id's

`ContractDetail` (en de lijst) krijgt `vendorContactNaam: string | null` en
`ownerGebruikerNaam: string | null` naast de bestaande `vendorContactId` /
`ownerUserId`. Reden: het scherm toont een naam in de lijst en de kaart,
niet een uuid — zonder deze uitbreiding zou elke rij een aparte lookup naar
`vendor_contact`/`user` moeten doen, wat exact het n+1-probleem is dat
`VendorService.lijst()` met zijn subquery-aanpak al vermijdt.

Implementatie: een `LEFT JOIN` in de bestaande `detailBinnenTransactie` en
`lijst`-query van `ContractService`, geen nieuwe tabel of migratie.

---

## 4. Frontend — de `Contracten`-sectie

### 4.1 Lijst (patroon: `Contactpersonen`/`ContactRij`)

Elke rij toont: naam, contractnummer (klein, onder de naam — zelfde
plaatsing als de KvK-referentie in MVM_V2's contractlijst), statusbadge,
begindatum–einddatum met een indicator:

- Status `actief` én einddatum binnen 90 dagen → oranje "Xd resterend"
- Status `actief` én einddatum verder weg of leeg → geen indicator, alleen
  de datum
- Einddatum in het verleden → rood "Xd verlopen" (ongeacht opgeslagen
  status — een contract dat niemand heeft bijgewerkt naar `verlopen` moet
  dat toch laten zien, zie spec §2.3 van het datamodel-document)
- Contactpersoon-naam en beheerder-naam, of "—" als leeg

Acties per rij: bewerken (inline formulier, zelfde interactiepatroon als
`ContactRij`), verwijderen (met bevestigingsstap, zelfde patroon als
vendor zelf verwijderen).

### 4.2 Bewerk-/aanmaakformulier

Velden, in deze volgorde: naam (verplicht), contractnummer, status
(dropdown uit `ref.contract_status`), begindatum, einddatum, waarde,
contactpersoon (dropdown, gevuld uit `vendor.contacten` — dezelfde data die
de Contactpersonen-sectie al heeft, geen nieuwe fetch), contractbeheerder
(dropdown, gevuld uit `GET /tenant/gebruikers`), notitie (tekstveld,
meerdere regels).

Één "Opslaan"-knop voor al deze velden samen — dezelfde
`PATCH .../contracts/:id` (of `POST` bij aanmaken) als de backend al biedt.

**Bij aanmaken staat de vragenlijst-koppeling nog niet in dit formulier**:
een contract heeft eerst een `contractId` nodig voordat er iets aan
gekoppeld kan worden. Na het aanmaken toont de nieuwe rij meteen het
koppelingsblok (leeg, klaar om in te vullen) — geen aparte "eerst opslaan,
dan pas koppelen"-stap die de gebruiker zelf moet herkennen.

### 4.3 Vragenlijst-koppeling — los blok binnen de contractkaart

Onder de rest van de contractvelden, met een eigen kop "Van toepassing
zijnde vragenlijst(en)": een checkbox-lijst van alle vragenlijst-templates
van de tenant (uit `GET /admin/survey/templates`, hergebruikt — geen
zoekveld nodig bij een klein aantal), en een eigen knop "Vragenlijsten
koppelen" die alleen dit blok opslaat via
`PUT .../contracts/:id/survey-templates`.

Eigen foutmelding, eigen "bezig"-status, los van de rest van het
formulier — zelfde onafhankelijkheid als de contactpersonen-sectie nu al
heeft ten opzichte van de vendor-stamgegevens.

### 4.4 Wat dit scherm bewust niet doet

- Geen knop om vanuit een contract direct een survey-ronde te starten. De
  koppeling legt alleen vast wélke templates van toepassing zijn; het
  daadwerkelijk uitsturen blijft bij het bestaande
  `/beheer/vragenlijsten/uitnodigen`-scherm. Een filter daar op basis van
  deze koppeling is denkbaar, maar is een aparte, latere uitbreiding met
  een eigen afweging — niet nu meegenomen.
- Geen tijdlijnweergave, geen CATS-fasen, geen issues-koppeling (zie §2).
- Geen bulk-acties op contracten — dat is issue #160 (bulk-upload
  contractdata), een apart traject.

---

## 5. Wat dit ontwerp bewust niet doet — herhaling van de datamodel-spec

Zoals in `2026-08-22-contractmanagement-design.md` §5: geen automatische
statuswijziging (de "Xd verlopen"-indicator in §4.1 is weergave, geen
schrijfactie), geen migratie van bestaande contractdata, geen
bulk-upload-UI.

---

## 6. Open vraag voor de implementatiestap

Geen voor §1–5 — de brainstorming had alle scope-vragen daar beantwoord.
§7–9 zijn een latere aanvulling (22-08, na de derde preview) met hun eigen
scope-vastlegging.

---

## 7. Contractenlijst als tabel, niet als kaarten

**Bevinding (derde preview):** met meerdere contracten per leverancier is
de kaartweergave uit §4.1 te ruim — elke rij neemt veel verticale hoogte
in, en contactpersoon/beheerder/status/data zijn niet in één oogopslag te
vergelijken tussen contracten.

**Wijziging:** de lijst uit §4.1 wordt een compacte HTML-tabel met
kolommen: Naam, Contractnummer, Contactpersoon, Contractbeheerder, Status,
Begindatum, Einddatum, acties (bewerken/verwijderen). Zelfde databron
(`ContractSamenvatting`, met de namen die Task 3 van het backend-plan al
toevoegde), alleen de weergave verandert — geen backend-wijziging.

Het "Xd resterend"/"Xd verlopen"-label (§4.1, `EindeIndicator`) blijft
bestaan maar verhuist naar een compacte notatie onder de einddatum in
dezelfde kolom, niet ernaast.

## 8. Contactpersoon toevoegen bij het BEWERKEN van een bestaand contract

**Bevinding (derde preview):** Task 12 voegde de "nieuwe contactpersoon
aanmaken"-toggle alleen toe aan het aanmaakformulier (`NieuwContractFormulier`).
Bij het bewerken van een al bestaand contract (`ContractRij` in
bewerkstand) ontbreekt diezelfde optie — een contactpersoon toevoegen kan
dan alleen via de aparte Contactpersonen-sectie, wat het contract-
bewerkformulier onvolledig maakt.

**Wijziging:** dezelfde toggle-en-drie-velden-aanpak uit Task 12, nu ook in
`ContractRij`'s bewerkstand. Bij opslaan: eerst de contactpersoon aanmaken
(`voegContactToe`, bestaande route), dan het contract bijwerken met het
nieuwe `contactId`.

**Notitieveld bij contactpersoon zichtbaar maken.** De backend-kolom
`vendor_contact.role_description` bestaat al sinds de basistabel (zie
`2026-08-22-contractmanagement-design.md` §1) maar staat nergens in de UI
— nog niet bij de Contactpersonen-sectie, en dus ook niet bij deze nieuwe
toggle. Beide plekken krijgen een "Notitie"-tekstveld (bv. "is vervanger
van X voor IT-zaken") dat naar `roleDescription` schrijft. Dit raakt drie
plekken: `Contactpersonen`/`ContactRij` (het bestaande blok), de toggle in
`NieuwContractFormulier` (Task 12), en de nieuwe toggle in `ContractRij`
hier.

## 9. Wachtlijst: een leverancier automatisch voorstellen bij de volgende ronde

**Bevinding (derde preview):** de bestaande survey-templatekoppeling
(§4.3, Task 2) legt vast *welke* vragenlijst bij een contract hoort, en
Task 13 voegde een knop toe om *nu direct* uit te nodigen. Wat ontbrak: een
manier om een leverancier te markeren voor een *toekomstige* ronde, zonder
dat er nu al iemand op een knop drukt — bijvoorbeeld omdat de huidige ronde
al loopt en deze leverancier voor de ronde daarna moet meedoen.

**Expliciet niet gevraagd:** volautomatisch verzenden. De eigenaar was
hier scherp: *"dit hoeft geen volautomatisch proces te worden [...]
contractbeheerders hebben een hulpmiddel nodig waar ze alle relevante
informatie in één keer onder de knop hebben, maar beslissen zelf."* Dit
is dus een **voorstel, geen trigger** — een mens selecteert en verstuurt
nog steeds bewust, via het bestaande uitnodigen-scherm.

### 9.1 Datamodel: één kolom op de bestaande koppeltabel

`clm.contract_survey_template` krijgt een kolom
`wachtlijst boolean NOT NULL DEFAULT false` (nieuwe migratie 0028, niet
een wijziging van migratie 0027 — die is al uitgerold). Geen nieuwe tabel:
de wachtlijst-status hoort per definitie bij een specifieke
contract-template-koppeling, en die koppeling bestaat al.

Uitvinkbaar zoals de eigenaar vroeg: de kolom is een gewone boolean die de
beheerder aan/uit zet, geen automatisch proces dat hem wijzigt.

### 9.2 Zichtbaar en instelbaar: alleen op het contract, geen apart overzicht (nu)

Bewust beperkt tot het bestaande `SurveyTemplateKoppelingBlok`
(§4.3/Task 2): elke checkbox voor een gekoppelde template krijgt een
tweede, kleinere checkbox ernaast — "op de wachtlijst voor de volgende
ronde" — opgeslagen met dezelfde `PUT .../survey-templates`-aanroep
(kolom `wachtlijst` naast `templateIds` in de body).

Een centraal overzicht "alle leveranciers die klaarstaan voor ronde X" is
een expliciet latere stap — zie §9.4.

### 9.3 Nieuw, apart startpunt: "Ronde starten vanuit wachtlijst"

Het bestaande uitnodigen-scherm (`/beheer/vragenlijsten/uitnodigen`) werkt
"leverancier eerst, vragenlijst daarna" — de wachtlijst werkt andersom
("vragenlijst eerst, dan wie er klaarstaat"). Dat bestaande scherm wordt
niet omgebouwd (zou alle huidige gebruik en tests raken); in plaats
daarvan komt er een nieuw, klein scherm:

`/beheer/vragenlijsten/[id]/wachtlijst` (of vergelijkbaar, binnen de
bestaande `/beheer/vragenlijsten`-sectie): toont per vragenlijst-template
de leveranciers met `wachtlijst = true` op een gekoppeld contract, elk
aangevinkt in een leverancierslijst die er verder uitziet als de bestaande
selectielijst op `/beheer/leveranciers`. De beheerder kan uitvinken of
aanvullen, en springt dan door naar het bestaande uitnodigen-scherm
(`?leveranciers=...&templateId=...`) — dezelfde overgang die Task 13 al
bouwde vanuit een los contract.

**Toegangspunt:** een link/knop bij elke vragenlijst op
`/beheer/vragenlijsten` ("N leveranciers staan klaar"), zichtbaar zodra
`wachtlijst`-aantal > 0.

### 9.4 Wat hier bewust niet gebeurt

- Geen automatisch versturen — bevestigd door de eigenaar, zie boven.
- Geen apart, centraal "alle wachtlijsten"-dashboard — dat is een
  logische vervolgstap zodra dit scherm in gebruik is, maar een eigen
  afweging (welke rol mag het zien, hoe filteren bij veel vragenlijsten)
  die nu niet wordt voorgekookt.
- Geen wijziging van de bestaande `?leveranciers=`-flow op
  `/beheer/leveranciers` zelf — die blijft precies zoals hij is.

---

## Bronnen

- `docs/superpowers/specs/2026-08-22-contractmanagement-design.md` — het
  datamodel dat dit scherm bedient
- `docs/superpowers/plans/2026-08-22-contractmanagement.md` — de al
  gebouwde backend (migratie 0027, ContractService/Controller/Module)
- `MCM2-frontend/src/app/beheer/leveranciers/[id]/page.tsx` — het
  bestaande patroon (`Contactpersonen`/`ContactRij`) dat dit scherm volgt
- MVM_V2 `src/app/contracts/page.tsx` — inspiratiebron voor
  statusweergave en dagen-resterend-indicator, niet gekopieerd (mock data,
  ander framework-patroon, features die MCM2 niet heeft)
- `src/survey/vragenlijst-beheer.controller.ts` — bestaande
  `GET /admin/survey/templates`, hergebruikt voor de checkbox-lijst
