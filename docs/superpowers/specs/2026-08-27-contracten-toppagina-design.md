# Ontwerp — contracten-toppagina (issue #173, #171)

**Datum:** 2026-08-27
**Status:** ONTWERP — goedgekeurd door de eigenaar, klaar voor implementatieplan
**Aanleiding:** contracten zijn vandaag alleen zichtbaar genest onder één
leverancier (`Contracten.tsx` in het leveranciersdetailscherm). Er bestaat
geen tenant-breed overzicht en geen eigen navigatie-item.
**Raakt:** Issue #173 ("Contract 360: eigen toppagina"), Issue #171
("Contracten opnemen in de navigatie") — dit ontwerp behandelt beide als één
samenhangend stuk werk.
**Inspiratiebron:** MVM_V2 (`src/app/contracts/page.tsx`,
`src/app/contracts/[id]/page.tsx`) — bekeken op verzoek van de eigenaar,
draait op mock data (zie memory `mcm2-mvm-v2-als-bron`). Alleen de
lay-out/kolomkeuze is overgenomen; geen van de achterliggende datamodellen
(taken, issues, interacties, geplande meetings, KPI-invoer, PDF-upload,
AI-koppeling, CATS-levenscyclusfasering) bestaat in MCM2 en wordt hier niet
gebouwd.

---

## 0. Waar dit over gaat, in één alinea

Een nieuwe, tenant-brede contractenlijst (`/beheer/contracten`) met een eigen
sidebar-item. **Geen aparte contract-detailpagina** — een klik op een
contract in de lijst gaat naar het bestaande leveranciersdetailscherm, met
het Contracten-blok en dat specifieke contract al opengeklapt. Geen nieuwe
databasevelden of -tabellen; alleen een nieuwe, tenant-brede leesquery op het
bestaande `clm.contract`-model.

---

## 1. Scope-besluiten van de eigenaar (27-08)

| Vraag | Besluit |
|---|---|
| Volle MVM_V2-omvang (taken/issues/KPI's/AI) overnemen? | **Nee.** Alleen wat MCM2 al heeft, in een nieuwe route. |
| Eigen contracten-lijstpagina, tenant-breed? | **Ja.** |
| Kolommen/filters | Naam, leverancier, status, einddatum (+ dagen-resterend-indicator), waarde. Statusfilter. **Geen tijdlijn/Gantt-weergave.** |
| Gerelateerde contracten van dezelfde leverancier | **Ja**, op de bestaande detailweergave (query op `vendor_id`, geen nieuw veld). |
| Garantieperiode-veld | **Nee** — vraagt een nieuw databaseveld, buiten scope. |
| Eigen `/beheer/contracten/[id]`-detailpagina | **Nee**, herzien tijdens het ontwerp: een klik op een contract gaat naar het **bestaande leveranciersscherm**, met het Contracten-blok en dat contract automatisch opengeklapt. |
| Sidebar-item "Contracten" | **Ja**, geen `vereistRol` (lezen mag iedereen, zelfde afweging als de bestaande items). |

---

## 2. Backend — nieuwe tenant-brede route

### 2.1 Wat er vandaag bestaat

`GET /vendors/:vendorId/contracts` (`ContractController`,
`ContractService.lijst()`) is **altijd** vendor-gescoped. De query geeft
géén `value_eur` terug in `ContractSamenvatting` — dat veld zit wel in het
schema, maar wordt in de bestaande lijst-samenvatting niet meegegeven
(alleen mogelijk aanwezig in de detail-aanroep, niet geverifieerd tijdens dit
ontwerp — check bij implementatie).

### 2.2 Nieuwe route

`GET /contracts` (los van een vendor-pad, dus een nieuwe controller of een
uitbreiding van een bestaande tenant-brede controller — te bepalen in het
implementatieplan). Query: dezelfde velden als de bestaande
`ContractSamenvatting`, **plus**:
- `valueEur` (ontbreekt vandaag in de lijst-query, moet worden toegevoegd)
- `vendorId` en `vendorName` (join met `clm.vendor`, nodig om de leverancier
  te tonen en om naar het juiste leveranciersscherm te kunnen linken)

Rechten: geen `@VereistRol` — lezen mag elke geldige sessie, consistent met
hoe de vendor-gescoped lijst vandaag werkt en met de andere tenant-brede
lijsten (leveranciers, vragenlijsten).

Sortering: `ORDER BY end_date ASC NULLS LAST` (dichtstbijzijnde einddatum
eerst) — een andere volgorde dan de bestaande vendor-gescoped lijst
(`created_at DESC`), omdat een tenant-breed overzicht primair de vraag "wat
loopt er binnenkort af" beantwoordt.

---

## 3. Frontend

### 3.1 `/beheer/contracten` — nieuwe lijstpagina

Tabel, zelfde stijl als de bestaande leverancierslijst/statusoverzicht:

| Kolom | Inhoud |
|---|---|
| Contract | Naam, klikbaar |
| Leverancier | Naam, klikbaar naar `/beheer/leveranciers/[vendorId]` |
| Status | Badge, zelfde stijl als elders |
| Einddatum | Datum + dagen-resterend/verlopen-indicator (zelfde patroon als `daysUntilExpiry` uit MVM_V2, herbouwd tegen MCM2's `endDate`) |
| Waarde | `valueEur`, valutaformaat |

Statusfilter: klikbare badges bovenin, zelfde patroon als
`/beheer/status` (issue #75-sessie voegde dat patroon daar al toe) — niet
een pulldown, voor consistentie binnen de app.

Geen tijdlijn/Gantt-weergave, geen typefilter (bestaat niet als apart veld
in MCM2's model), geen CATS-fase-filter.

### 3.2 Klik op een contractrij — naar het leveranciersscherm

Navigeert naar `/beheer/leveranciers/[vendorId]?contract={contractId}`.

**Besluit: query-param, geen hash.** Een `#hash` bereikt de server nooit en
is alleen met `window.location.hash` in een `useEffect` te lezen — dat geeft
een merkbare flits (eerst dicht, dan open) op elke paginalading. Een
query-param (`useSearchParams()`) is direct beschikbaar bij het eerste
render.

Op het leveranciersdetailscherm (`page.tsx`) leest de pagina die parameter
en geeft hem door aan `Contracten.tsx` als initiële waarde voor
`opengeklapt` (state bestaat al: `useState<string | null>(null)`, wordt nu
geïnitialiseerd vanuit de parameter in plaats van altijd `null`). De
bestaande `scrollHaakId`-mechaniek (al aanwezig, `id="contracten-sectie"`)
zorgt dat de pagina naar dat blok scrollt.

**Geen nieuwe uitklap-mechaniek nodig** — beide bouwstenen
(`opengeklapt`-state, `scrollHaakId`) bestaan al in `Contracten.tsx`; dit is
een kleine aanpassing van waar de initiële waarde vandaan komt, geen nieuw
component.

### 3.3 "Andere contracten bij deze leverancier"

Op het leveranciersdetailscherm, onderaan het uitgeklapte contract (of
onderaan het Contracten-blok — te bepalen in het implementatieplan): een
korte lijst van de overige contracten bij dezelfde leverancier (naam,
status, einddatum), elk klikbaar om dát contract uit te klappen. Gebruikt de
bestaande vendor-gescoped lijst-data die `Contracten.tsx` al ophaalt — geen
extra API-aanroep nodig, alleen filteren op "niet het huidige contract".

### 3.4 Sidebar

Nieuw item "Contracten" tussen Leveranciers en Vragenlijsten, geen
`vereistRol` — zelfde afweging als de bestaande items zonder rol-eis
("lezen mag een reviewer/user ook, de backend bepaalt de echte grens").

---

## 4. Wat dit ontwerp expliciet niet doet

- **Geen taken, issues, interacties, geplande meetings, KPI-invoer,
  PDF-upload, AI-interrogatie-koppeling.** Geen van deze datamodellen
  bestaat in MCM2; dit ontwerp bouwt ze niet.
- **Geen CATS-levenscyclusfasering.** MCM2's contractmodel kent geen
  fase-concept.
- **Geen garantieperiode-blok.** Vraagt een nieuw databaseveld, bewust
  buiten scope (zie §1).
- **Geen tijdlijn/Gantt-weergave.**
- **Geen aparte `/beheer/contracten/[id]`-detailpagina.** Herzien tijdens
  het ontwerp — een klik gaat naar het bestaande leveranciersscherm.
- **Geen wijziging aan het bestaande "+ Nieuw contract"-aanmaakformulier.**
  Blijft op het leveranciersscherm, want dat hoort bij de
  leverancierscontext (een contract wordt altijd bij een specifieke
  leverancier aangemaakt).

---

## 5. Tegenproeven

1. `GET /contracts` toont contracten van meerdere leveranciers in één
   tenant, gesorteerd op einddatum.
2. `GET /contracts` van tenant A toont nul contracten van tenant B
   (RLS-tegenproef, zelfde patroon als overal).
3. Een `reviewer`-sessie krijgt 200 op `GET /contracts` (lezen mag
   iedereen).
4. De waarde-kolom toont het echte `valueEur`-bedrag, niet leeg (dekt de
   bijvangst uit §2.1 — dat veld ontbrak in de bestaande lijst-query).
5. Een klik op een contractrij in `/beheer/contracten` navigeert naar het
   juiste leveranciersscherm mét het juiste contract al uitgeklapt, zonder
   dat de gebruiker zelf hoeft te scrollen of te klikken.
6. Op het leveranciersscherm, bij een leverancier met meerdere contracten:
   "andere contracten bij deze leverancier" toont de overige contracten,
   niet het huidige.
7. Statusfilter op `/beheer/contracten` toont alleen contracten met de
   geselecteerde status; "wis filter" toont weer alles.

---

## 6. Volgorde van bouwen (advies voor het implementatieplan)

1. Backend: `GET /contracts`-route + query-uitbreiding (`valueEur`,
   `vendorId`/`vendorName`).
2. Frontend: `/beheer/contracten`-lijstpagina + sidebar-item.
3. Frontend: leveranciersscherm leest de nieuwe parameter, initialiseert
   `opengeklapt` daarmee, scrollt naar het blok.
4. Frontend: "andere contracten bij deze leverancier"-lijstje binnen het
   uitgeklapte contract.
