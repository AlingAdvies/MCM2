# Vendor-dossiers ("projectjes") — design

**Datum:** 2026-09-24
**Status:** goedgekeurd door eigenaar, klaar voor implementatieplan.

## Doel

Uit klantoverleg met Transdev: rondom een survey en/of contract ontstaat soms
intensiever, meervoudig contact met een leverancier — een "projectje" (bijv.
TD wil dat een leverancier een nieuw cyberveiligheidscontract ondertekent).
Dat contact kan voortkomen uit een survey-antwoord, uit een apart verzoek, of
uit beide. De bestaande notitiefunctie (`response_note`, altijd gekoppeld aan
precies één survey-response, vrije tekst) is hiervoor niet geschikt: dit gaat
breder dan één response, en de voorkeur van de eigenaar is **bijlagen**
(geëxporteerde mailcorrespondentie), niet getypte samenvattingen.

## Use case die de eis bepaalt

Directie vraagt "hoe gaat het met onze leveranciers", medewerker antwoordt
"bijna alles ok, behalve bij leverancier X" — directie vraagt dan direct
"wat speelt daar, geef me de details". Het vendordetailscherm moet die vraag
in één oogopslag kunnen beantwoorden, niet pas na zoeken door losse
contracten en survey-rondes.

## Datamodel

Drie nieuwe tabellen in schema `clm`. Geen wijziging aan bestaande
`response_note`- of `survey_attachment`-tabellen — dit is een eigen concept
met een eigen doel (extern mailcontact-dossier voor de beheerder, geen
interne werk-notitie en geen leverancier-upload bij een vraag).

### `vendor_engagement`

| Kolom | Type | Opmerking |
|---|---|---|
| `engagement_id` | uuid, pk | |
| `tenant_id` | uuid, fk | RLS |
| `vendor_id` | uuid, fk, **verplicht** | de enige harde koppeling |
| `titel` | text, verplicht | vrije tekst, bijv. "Cyberveiligheidscontract Maestronic — heronderhandeling" |
| `created_by_user_id` | uuid, fk | |
| `created_at` | timestamptz | |
| `deleted_at` | timestamptz, nullable | soft-delete, zelfde patroon als `response_note` |

Geen status/workflow-veld in de MVP (expliciete keuze eigenaar). Zichtbaarheid
"er speelt iets" komt uit het enkele feit dat er een niet-verwijderd
engagement bestaat, niet uit een open/gesloten-vlag.

Geen limiet op het aantal engagements per leverancier — een leverancier kan
meerdere, onafhankelijke, gelijktijdig lopende dossiers hebben (bijv. één
over een contract, één apart over een leveringsprobleem). Geen unique
constraint die dat zou beperken.

### `vendor_engagement_link` — koppeltabel

| Kolom | Type | Opmerking |
|---|---|---|
| `link_id` | uuid, pk | |
| `engagement_id` | uuid, fk → `vendor_engagement` | |
| `tenant_id` | uuid, fk | RLS |
| `link_type` | text | `'contract'` of `'survey_response'` |
| `linked_id` | uuid | `contract_id` of `response_id`, afhankelijk van `link_type` |

**Waarom een koppeltabel en niet twee nullable FK-kolommen op
`vendor_engagement` zelf:** een eerdere ontwerpversie had `contractId`/
`responseId` als losse nullable kolommen op de hoofdtabel. Zelfkritiek
(24-09-2026): dat staat maar één contract én één survey tegelijk toe. Een
langer lopend dossier raakt in de praktijk vaak meer dan één survey-ronde
(jaar 1, jaar 2) of meer dan één contract (oud + vernieuwd). De koppeltabel
staat 0..N links van elk type toe, zonder dat een tweede ronde een nieuw
engagement dwingt — dat zou averechts werken tegen het doel "één lopend
dossier blijven volgen".

Een engagement mag **nul** links hebben. De UI nudged naar minstens één link
(zie Frontend), maar dit is geen database-constraint — een harde eis zou
precies het "los verzoek aan de leverancier, nog geen contract of survey"-
scenario blokkeren dat de eigenaar expliciet noemde.

### `vendor_engagement_attachment`

| Kolom | Type | Opmerking |
|---|---|---|
| `attachment_id` | uuid, pk | |
| `engagement_id` | uuid, fk → `vendor_engagement` | |
| `tenant_id` | uuid, fk | RLS |
| `storage_key` | text | via `BestandOpslagService`, hergebruikt |
| `original_filename` | text | |
| `content_type` | text | één van: PDF, PNG, DOCX, XLSX |
| `size_bytes` | integer | max. 10 MB |
| `uploaded_by_user_id` | uuid, fk | |
| `created_at` | timestamptz | |
| `deleted_at` | timestamptz, nullable | soft-delete |

**Maximum 3 bijlagen per engagement**, afgedwongen server-side met dezelfde
`FOR UPDATE`-aanpak als `BijlageService.voegToe()` gebruikt voor
`max_files` — voorkomt dat twee gelijktijdige uploads samen over de grens
gaan.

**Waarom geen principiële FK-actie-discussie op deze relatie:** een eerdere
ontwerpversie koos expliciet `restrict` naar analogie van
`survey_response` ("bewijsmateriaal mag niet stilzwijgend verdwijnen").
Zelfkritiek: `vendor_engagement` is zelf al soft-delete — een engagement
verdwijnt sowieso nooit hard, dus `restrict` verdedigt tegen een pad dat de
applicatie nooit bewandelt. Er bestaat geen hard-delete-route. De FK-actie
is daarom functioneel niet belangrijk; kies de eenvoudigste optie zonder er
een principiële zaak van te maken.

### Bestandsvalidatie

Eigen beleidsmodule (niet `src/survey/bestand-validatie.ts` — die blijft
ongewijzigd voor het leveranciersportaal). **Wel hergebruik van de
signature-detectiemechaniek** uit die module (bytes-aan-het-begin-
herkenning): de generieke detectiefunctie wordt gedeeld, elke module roept
hem aan met zijn eigen lijst toegestane handtekeningen. Duplicatie van
mechaniek levert geen winst op en zou bij een bugfix in één van de twee
kunnen uiteenlopen; duplicatie van *beleid* (welke typen, welke grootte,
welk aantal) is bewust, want dat beleid verschilt structureel:

| | survey-bijlage (bestaand) | vendor-engagement-bijlage (nieuw) |
|---|---|---|
| Typen | PDF, PNG | PDF, PNG, DOCX, XLSX |
| Max. grootte | 5 MB | 10 MB |
| Max. aantal | per vraag (`max_files`) | 3 per engagement |
| Wie uploadt | leverancier (en beheerder namens leverancier) | beheerder/medewerker |

## Autorisatie

Rol `medewerker` — elke gebruiker binnen de tenant mag engagements aanmaken,
bijlagen toevoegen en inzien. **Voorbereid op een latere beperking tot
alleen contractbeheerder/admin**: de rolcheck gebruikt dezelfde
`VereistRol()`-decorator die elders in de codebase al staat, zodat een
latere aanscherping één parameter-wijziging is, geen herbouw van de
autorisatielaag.

## API

- `POST /admin/vendors/:vendorId/engagements` — titel + optionele initiële
  link(s)
- `GET /admin/vendors/:vendorId/engagements` — volledige lijst incl. links en
  bijlage-metadata, voor badge en panel
- `POST /admin/engagements/:id/links` — extra contract- of
  survey-koppeling toevoegen aan een bestaand engagement
- `POST /admin/engagements/:id/attachments` — bijlage toevoegen
  (server-side max.-3-check, nooit alleen client-side)
- `GET /admin/engagements/attachments/:attachmentId` — download
- `DELETE /admin/engagements/:id` — soft-delete van het engagement (en
  daarmee impliciet niet meer zichtbaar; links/attachments blijven
  historisch in de database staan)
- `DELETE /admin/engagements/:id/attachments/:attachmentId` — soft-delete
  van één bijlage

Geen aparte endpoints per contract/survey: de lijst is altijd "alle
engagements van deze vendor"; frontend filtert op `link_type`/`linked_id`
wanneer het panel in een contract- of surveycontext getoond wordt.

## Frontend

### Component: `EngagementPanel`

Eén herbruikbaar component (patroon overgenomen van `MeetingPanel` in
MVM_V2, na expliciete vergelijking — zelfde aanpak: één component met
`vendorId` verplicht en een optionele contextprop, ingeplugd op meerdere
schermen).

Props: `vendorId` (verplicht), `vendorName`, optioneel `contractId` of
`responseId` als context.

### Plaatsing — drie schermen, zelfde component

1. **Vendordetailscherm** (`/beheer/leveranciers/[id]`) — als sectie in de
   bestaande rechterkolom, naast `Contracten` en `VendorUitvraagPaneel`. Geen
   eigen route: dit scherm heeft al het gedocumenteerde patroon
   "badge-strip bovenaan + compacte linkerkolom + brede rechterkolom met
   secties", met in de code al de aantekening dat hier later "documenten"
   bij zouden komen. Volledige, ongefilterde lijst.
2. **Contractdetailscherm** — zelfde component, `contractId` meegegeven;
   toont/filtert op engagements gekoppeld aan dit contract via
   `vendor_engagement_link`.
3. **Survey response-detailscherm** (`/beheer/status/[responseId]`) —
   zelfde component, `responseId` meegegeven.

Aanmaken kan vanaf alle drie de plekken. De meegegeven `contractId`/
`responseId` wordt automatisch als eerste link voorgevuld — net zoals
`MeetingPanel` een optionele `contractId` in het formulier voorinvult.
Vanuit het vendorscherm zelf (geen context) blijven contract/survey
optionele keuzevelden in het formulier.

### Badge

Compacte indicator in de bestaande badge-strip bovenaan het vendorscherm
(bijv. "3 lopende dossiers"). Klikken scrollt naar / vouwt de
`EngagementPanel`-sectie uit op dezelfde pagina — geen navigatie naar een
aparte route, consistent met hoe Contracten/Uitvragen nu al werken.

### Lijst-item

Per engagement: titel, aanmaakdatum + auteur, gekoppelde contract(en)/
survey(s) als kleine tags, aantal bijlagen.

### Bijlagen: downloadlink, geen inline preview

Consistent met hoe survey-bijlagen nu al getoond worden in
`beheer/status/[responseId]/page.tsx` (regel 440-463) — een downloadlink,
geen ingebouwde PDF/afbeeldingviewer. Scheelt bouwwerk en is voor Word/Excel
sowieso niet zonder externe tool te previewen.

### Aanmaakformulier

- Titel (verplicht, vrij tekstveld)
- Bestandsupload, max. 3, met client-side voorcontrole op type/grootte vóór
  versturen (server-side blijft de bindende check)
- **Nudge tegen een "circus van screenshots"** (expliciete eis eigenaar):
  korte tekst bij het uploadveld, bijv. "Voeg het relevante deel toe, niet de
  hele mailwisseling", gecombineerd met de harde grens van max. 3 bestanden
  à 10 MB — bewust beide tegelijk: tekst als gedragssturing, het maximum als
  vangnet
- Optionele contract-/survey-koppeling (vooringevuld indien vanuit die
  context geopend). **Zachte nudge, geen blokkade** als beide leeg blijven:
  een zichtbare waarschuwing vóór opslaan ("Overweeg dit te koppelen aan een
  contract of vragenlijst-ronde, zodat het straks terug te vinden is"), om
  "wezen"-engagements te voorkomen zonder het losse-verzoek-scenario
  onmogelijk te maken

## Wat bewust buiten de MVP blijft

- **Statusworkflow** (open/afgehandeld) — eigenaar koos expliciet om zonder
  te beginnen; zichtbaarheid komt uit het bestaan van het engagement zelf.
- **Campagne-/multi-project-groepering** (voorbeeld eigenaar: "MSR_26 —
  hernieuwde contractonderhandelingen met diverse leveranciers", één
  initiatief over meerdere leveranciers tegelijk). Bewust geen apart
  datamodel hiervoor nu. Eigenaar lost dit voorlopig op met een generieke
  naamgevingsconventie in het titelveld (bijv. een gedeeld voorvoegsel).
  Zonder eigen relationele structuur is hier later een aparte
  "campagne"-tabel + N-op-N-koppeling naar `vendor_engagement` de voor de
  hand liggende uitbreiding, maar dat is een bewuste latere beslissing, geen
  nu-al-voorbereiding.
- **Rolbeperking tot alleen contractbeheerder** — architectuur is er wel op
  voorbereid (zie Autorisatie), maar niet nu geactiveerd.
- **Inline bijlage-preview** — downloadlink volstaat voor de MVP.
- **Effect op een latere "mailen uit de app"-functie** — genoemd door de
  eigenaar als mogelijke toekomstige samenhang, maar geen concreet
  requirement nu. Dit datamodel (engagement + koppeltabel + bijlagen)
  vormt geen belemmering voor een latere uitbreiding waarbij een verstuurde
  mail vanuit de app als bijlage/koppeling in hetzelfde engagement
  terechtkomt, maar dat wordt nu niet expliciet ontworpen.

## Openstaande punten voor het implementatieplan

- Exacte plek van de badge in de bestaande badge-strip-component (visuele
  afstemming, niet functioneel).
- Of `GET .../engagements` de links/attachments in één response meestuurt of
  lazy nagevraagd wordt per engagement — performance-afweging voor het
  implementatieplan, geen designbeslissing.
