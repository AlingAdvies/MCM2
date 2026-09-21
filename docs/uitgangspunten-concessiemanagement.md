# Concessiemanagement — uitgangspunten (geen ontwerp)

*Vastgelegd 2026-09-06, na een hoog-over gesprek naar aanleiding van
`docs/Combinatie_MCM2_Concessiemngt.md`. Dit is een set uitgangspunten om een
later ontwerp op te baseren — nog geen architectuurbesluit, geen bounded
contexts uitgewerkt, geen datamodel. Vervolg gepland.*

---

## Herkomst

`docs/Combinatie_MCM2_Concessiemngt.md` is een uitgebreide opdracht-prompt
(12 secties, 25+ user stories, 5 ADR's) voor een AI-solution-design over het
combineren van MCM2 met concessiemanagement voor Transdev. Bij beoordeling
bleek de opdracht twee dingen te vroeg te doen:

1. **Geen rekening met het bestaande TD/AA-splitsingsvraagstuk**
   (`docs/advies-td-aa-splitsing.md`) — concessiemanagement is exact het
   soort "eerste écht divergerende feature" die CLAUDE.md §0a als trigger
   voor het topologie-besluit noemt.
2. **Een formeel compliance-statusmodel als eerste bouwsteen**
   (Requirement/Obligation met status concept→compliant/non-compliant),
   terwijl een gesprek met de eigenaar liet zien dat de werkelijke situatie
   bij Transdev daar niet bij past — zie hieronder.

Dit document legt vast wat uit dat gesprek naar voren kwam, vóór er
verder gebouwd of ontworpen wordt.

---

## Uitgangspunten

### 1. Twee bounded contexts, verbonden via verwijzing — geen gedeeld domeinmodel

Transdev heeft twee functioneel volledig gescheiden gebruikersgroepen:

- **Concessiemanagement** — Transdev tegenover hun opdrachtgevers (provincies,
  gemeenten). Bewaakt door de **concessiemanager**.
- **Vendor-/contractmanagement** — wat MCM2 nu al doet. Bewaakt door de
  **contractbeheerder/projectmanager**.

Deze twee delen geen entiteiten. Wat ze wél delen: hun infrastructuur (de
volledige Microsoft-suite bij Transdev) — dat is een organisatorisch feit,
geen reden om functioneel te versmelten.

**De koppeling is een verwijzing, geen gedeelde tabel.** Een besluit of actie
uit een concessiedossier kan verwijzen naar een `vendor_id`/`contract_id` in
de bestaande module — zichtbaar als een apart paneel op het bestaande
leveranciersscherm, naar het patroon van `VendorUitvraagPaneel.tsx` (een
paneel dat "Uitvragen" toont; een vergelijkbaar paneel zou
"Concessieverplichtingen" kunnen tonen). Geen kopie van data, geen gedeeld
datamodel.

**Concreet voorbeeld dat de koppeling motiveert:** Transdev heeft 10 à 20
*strategische vendors* (bijv. een busleverancier) die operationeel cruciaal
zijn voor de dagelijkse uitvoering van een concessie. Een afspraak met de
provincie kan direct leiden tot een noodzakelijke actie richting zo'n
vendor — en die koppeling moet bewaakt worden, in twee richtingen: de
concessiemanager moet kunnen zien of de vendor-actie is opgepakt, en de
contractbeheerder moet kunnen navragen wat een vendor-vertraging betekent
voor de afspraak met de provincie.

### 2. Eén doorlopende dossier-tijdlijn, van aanbieding tot en met lopende uitvoering

Transdev wil het concessiemodel al gebruiken **vóórdat er een concessie is**:
in de aanbiedingsfase, waarin een eerste aanbod (eisen + deliverables) in
onderhandeling met de provincie wordt bijgesteld tot een overeenkomst — die
vervolgens, eenmaal gegund, weer verder wordt bijgesteld.

Dit betekent: **een eis/deliverable heeft een versiegeschiedenis die begint
vóór er een formele overeenkomst is, en die geschiedenis loopt na gunning
gewoon door.** Er is geen harde knip waarbij "Concession Agreement" als
nieuwe entiteit ontstaat en de aanbiedingsgeschiedenis wordt losgelaten.

- "Aanbieding" versus "lopende uitvoering" is een **fase-markering op het
  dossier**, geen aparte structuur.
- Het onderliggende mechanisme — voorstel → wijziging → voorstel → ... →
  akkoord → (later opnieuw) wijziging — is in beide fases identiek.

**Organisatorische knip, geen datamodel-knip.** In de praktijk draagt het
aanbiedingsteam het dossier over aan een uitvoeringsteam zodra de concessie
gegund is. Afgesproken uitgangspunt: het "nieuwe" team wordt gebruiker van
**hetzelfde dossier** — geen nieuw dossier, geen gekopieerde geschiedenis.
Dit vraagt **dossier-lidmaatschap dat wijzigt door de tijd**, los van de
tenant-brede rol van een gebruiker (zie punt 3).

### 3. Dossier-lidmaatschap is los van tenant-lidmaatschap

Wie toegang heeft tot een specifiek concessiedossier is een extra
granulariteitsniveau *onder* de bestaande tenant-RLS — niet elke
Transdev-gebruiker met een tenant-membership hoort automatisch bij elk
concessiedossier. Dit lijkt op hoe `clm.tenant_membership` nu al werkt voor
een hele tenant, maar dan een niveau dieper: lidmaatschap per dossier,
wijzigend door de tijd (aanbiedingsteam → uitvoeringsteam), zonder dat het
dossier of zijn geschiedenis daardoor verandert.

### 4. Twee interactiestijlen, bewust niet geüniformeerd

- **Richting opdrachtgever (provincie): Rijnlands.** Veel overleg,
  contractafspraken blijven vaak bewust open to debate. De waarde zit in het
  proces zelf: agenda's, notulen, besluiten vastleggen — **niet** in een
  simpel "voldoet/voldoet niet"-statusoordeel. Dit geldt zowel in de
  aanbiedingsfase als tijdens de lopende uitvoering (punt 2).
- **Richting vendor: strikter**, zoals de bestaande contractmodule al werkt.
  Dat verandert niet.

**Consequentie voor een eventuele MVP:** het zwaartepunt van waarde zit niet
in een compliance-statusmodel (zoals het opdrachtdocument als eerste
bouwsteen voorstelt), maar in het ordelijk vastleggen van overleg → notulen
→ besluit/actie. Op dit moment zwerft dat verspreid over Outlook, Teams,
Word en mondelinge afspraken — die wirwar is zelf het eerste, concrete
probleem dat oplossing verdient.

### 5. Gedeelde infrastructuur — bevestigd in de bestaande code, niet verondersteld

| Laag | Status (geverifieerd 2026-09-04) | Herbruikbaar zoals het nu is? |
|---|---|---|
| **Mail** | `MailKanaal`-interface bestaat al (`src/mail/`); providerwissel (M365 → Resend) is al eens bewezen goedkoop dankzij deze grens. | **Ja, direct.** Concessiemanagement stuurt via dezelfde interface, met eigen sjablonen/afzender indien nodig — zelfde patroon als het bestaande TD/AA-advies voor mail voorstelt. |
| **Externe toegang via token** | `SurveyTokenGuard` bestaat al: leidt tenantcontext af uit een SHA-256-gehashte token, geen account nodig. | **Deels.** Het patroon is herbruikbaar, maar een provincie-medewerker die notulen bevestigt is een ander gebruiksscenario dan een leverancier die een vragenlijst invult. Waarschijnlijk een nieuwe, aparte guard naar hetzelfde ontwerp — niet dezelfde guard-klasse. |
| **Inloggen frontend (Entra)** | Eén Entra External ID-app-registratie, `TenantContextGuard` + sessiecookie, RLS via `clm.current_tenant_id()`. | **Ja, voor interne Transdev-gebruikers** (concessiemanager, contractbeheerder) — zij loggen al zo in. **Nee, voor de provincie-medewerker** — die wordt nooit lid van de Transdev-tenant; die gaat via het tokenpad. |
| **Notificaties** | **Bestaat nog niet als generieke laag.** `scripts/telegram.js` is operationeel (backup, uitnodigingscontrole), geen herbruikbare eindgebruikerslaag. | **Nee — nog te bouwen**, en dan wél gedeeld: een generieke notificatie-abstractie (naar het patroon van `MailKanaal`) zou zowel "leverancier-deadline nadert" als "concessie-overleg over 3 dagen" kunnen bedienen. Goede kandidaat om als **eerste** echt gedeelde kern-uitbreiding te bouwen — nuttig voor zowel TD als AA (staat ook al zo in de roadmap-tabel van `advies-td-aa-splitsing.md`). |
| **Backend gedeeld** | Eén NestJS-monoliet, één Postgres-database, RLS via `clm.current_tenant_id()`. | Concessiemanagement krijgt een **eigen schema-namespace**, eigen migraties, eigen module — nooit vermengd met `clm.*`, naar hetzelfde patroon als het advies al voorschrijft voor NIS2/vragenlijst-builder. |

### 6. Concessiemanagement is een derde categorie naast "kern" en "AA-only": blijvend TD-only

`docs/advies-td-aa-splitsing.md` onderscheidt "kern" (gedeeld) en "AA-only"
(uitschakelbare modules die *ooit* ook voor een andere klant relevant
kunnen worden, zoals NIS2 of de vragenlijst-builder). Concessiemanagement
past in geen van beide:

- Het is **niet kern** — geen enkele AA-klant heeft een concessierelatie
  met een provincie.
- Het is **niet "AA-only" in de bestaande zin** — het zal nooit aan een
  AA-klant aangeboden worden, want functioneel zinloos zonder
  provincie-relatie. Dit is dus geen "toekomstige AA-feature die nu nog
  TD-only is."

**Derde categorie: TD-only, blijvend.** Even strikt gescheiden qua
schema/routes/migraties als een AA-only module (zelfde discipline: eigen
namespace, eigen migraties, volledig uitschakelbaar zonder de kern te
raken), maar zonder de verwachting dat het ooit generiek wordt.

Dit past bij de triagevraag uit CLAUDE.md §0a ("is dit een vermomde
kern-feature die elke klant zou willen?") — het antwoord is hier helder
nee, dus de minst vergaande laag uit de architectuurladder
(`c:\dev\CLAUDE.md`) is niet configuratie of een feature-flag, maar een
eigen maatwerkmodule.

---

## Wat dit document niet beslist

- Het exacte datamodel (entiteiten, tabellen, relaties) — dat is de
  volgende stap, ná deze uitgangspunten.
- Het topologie-besluit uit `docs/advies-td-aa-splitsing.md` §niet-beslist
  (één of twee productdeployments) — concessiemanagement bevestigt dát dit
  besluit ooit nodig is, maar beslist het niet.
- Wie de notificatie-abstractie bouwt en wanneer — alleen dat het een
  logische eerste, gedeelde stap zou zijn.
- De exacte vorm van dossier-lidmaatschap (los tabel, rol-uitbreiding op
  `tenant_membership`, iets anders) — alleen dát het nodig is.
- MVP-scope in detail (welke schermen, welke volgorde) — punt 4 geeft een
  richting (overleg/notulen/besluit vóór compliance-status), geen scope.

## Vervolg

Gepland: verder op 2026-09-06 (of later). Volgende stap is waarschijnlijk
een aangescherpte, project-specifieke versie van de opdracht uit
`docs/Combinatie_MCM2_Concessiemngt.md` — met deze uitgangspunten als
kader, en pas ná het topologie-besluit uit `advies-td-aa-splitsing.md` als
dat inmiddels actueel is.
