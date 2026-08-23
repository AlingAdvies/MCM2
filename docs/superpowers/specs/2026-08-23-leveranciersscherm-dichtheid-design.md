# Leveranciersdetail: dichtheid, uitklapbare contracten, wachtlijst-signaal

**Status:** ontwerp goedgekeurd, klaar voor implementatieplan
**Datum:** 2026-08-23
**Scherm:** `MCM2-frontend/src/app/beheer/leveranciers/[id]/page.tsx`
**Vervolg op:** de vier open punten uit "21 augustus III" in
`docs/opmerkingen Vendor IT survey.txt`, bevestigd door
`docs/architectuur/evaluatie-schermen-2026-08-22.md`

---

## 1. Aanleiding

Sessie 22-08 sloot af met vier openstaande UI-punten op het
leveranciersdetailscherm (zie `docs/STATUS.md`, sectie "21 augustus III"):

1. Stamgegevens/classificatie/contactpersonen te uitgesponnen — meer
   informatiedichtheid nodig op een breed pc-scherm.
2. Contactpersoon-toevoegformulier moet een fold-out zijn, niet altijd open.
3. Contractrijen moeten direct openklikbaar zijn (niet alleen via edit-knop),
   met alle bestaande én toekomstige velden zichtbaar.
4. Koppeling vs. wachtlijst is functioneel correct maar visueel verwarrend
   (Microsoft/M365-voorbeeld).

Deze sessie is gestart met een bewuste vergelijking met MVM_V2
(`C:\dev\Work\MVM_V2`), expliciet aangewezen door de eigenaar als referentie
waar hij tevreden over is. Twee bevindingen uit die vergelijking veranderden
het oorspronkelijke plan:

- **MVM_V2 lost "toevoegen/bewerken" op met een modal** (zie
  `VendorContactsPanel.tsx`), niet met een inline fold-out. Dat vervangt het
  fold-out-idee uit punt 2.
- **MVM_V2 heeft een aparte Contract 360-pagina.** Overwogen en bewust
  **niet** in deze werkstroom meegenomen — zie issue #173. Dit ontwerp houdt
  contracten ingebed op de leveranciersdetailpagina, zoals op 22-08 al
  besloten.

Tijdens het ontwerpgesprek bracht de eigenaar een vijfde, dwingende eis in:
zichtbare urgentie voor aflopende contracten, vanwege het reële schaderisico
van stilzwijgende verlenging. Het volledige opzegtermijn-mechanisme (met een
harde "verlengt automatisch"-waarschuwing) vraagt een nieuw databaseveld en
is uitgesteld naar issue #174 (front+backend, direct na deze werkstroom). Wat
**nu wél** gebouwd wordt: een kleurgecodeerde einddatum als tussenoplossing.

---

## 2. Scope

**In scope:**
- Layout-herziening van de volledige pagina: badge-strip + twee kolommen.
- Contactpersoon toevoegen/bewerken via modal i.p.v. inline formulier.
- Contractrij: klikbaar om uit te klappen (bestaande + toekomstige velden),
  geen aparte edit-knop meer nodig.
- Wachtlijst-status als expliciet label op de uitgeklapte rij, met een
  directe "nu uitnodigen"-link waar van toepassing (bestaand mechanisme,
  hergebruiken).
- Kleurcodering op de kale einddatum (drie drempels, zie §5).
- Doorklik-scenario: klik op de compliance-badge in de badge-strip scrollt
  naar en klapt de relevante contractrij open (geen navigatie).

**Bewust buiten scope (aparte issues):**
- Contract 360 als eigen toppagina — issue #173.
- Opzegtermijn-veld + "verlengt automatisch"-waarschuwing — issue #174,
  front+backend, direct na deze werkstroom.
- "21 augustus II" punt 1 (contracten in linkerbalk) en punt 2 (dashboard-
  hernoeming + 90-dagen-widget) — ander deel van het scherm/de navigatie,
  niet dit ontwerp.

---

## 3. Layout — badge-strip + twee kolommen

Vervangt de huidige opbouw (drie gestapelde `<section className="p-6">`-
blokken) door:

```
┌─────────────────────────────────────────────────────────────┐
│ Naam leverancier   [Compliance-badge]  [Kritiek]  [Categorie]│  ← badge-strip
├───────────────────────┬───────────────────────────────────────┤
│ Stamgegevens (compact)│ Contracten — tabel, klikbare rijen     │
│ Contactpersonen        │ Lopende uitvragen (VendorUitvraagPaneel│
│  (compact, modal-toevoeg)│  ongewijzigd)                       │
└───────────────────────┴───────────────────────────────────────┘
```

- Grid: `grid-cols-1 xl:grid-cols-3`, linkerkolom `xl:col-span-1`,
  rechterkolom `xl:col-span-2` — zelfde breakpoint-keuze als MVM_V2.
- Paddings verkleinen: `p-4` in plaats van `p-6` op de kaarten;
  bodytekst `text-[12px]`/`text-[13px]` in plaats van de huidige `text-sm`
  overal.
- Secties in de rechterkolom krijgen een koptekstbalk (`px-4 py-3` met
  `border-bottom`) i.p.v. een losse `<h2>` boven een groot blok — patroon
  uit MVM_V2's Certificeringen/Contracten-secties.
- Classificatie (categorie, bedrijfskritiek, compliancestatus) verhuist van
  een los `<fieldset>` in Stamgegevens naar de badge-strip bovenaan. De
  **bewerkbaarheid blijft bestaan** — klik op een badge opent hetzelfde
  bewerkformulier als nu in Stamgegevens, alleen de weergave-plek verandert.
- Design-tokens (`@/shared/design-tokens`) blijven de bron voor kleuren;
  geen hardcoded hex behalve de urgentie-kleurdrempels in §5, die als
  benoemde constanten in de component komen (geen losse hex her en der).

---

## 4. Contactpersoon: modal i.p.v. inline fold-out

Vervangt het huidige altijd-open formulier (regel ~1035,
`nieuweContactpersoon`-state) en het eerder overwogen fold-out-idee.

- Kleine "+ toevoegen"-knop naast de sectiekop "Contactpersonen".
- Klik opent een modal met dezelfde velden als nu (naam, e-mail, functie,
  notitie/`roleDescription`) — hergebruikt de bestaande formulierlogica,
  alleen de presentatie verandert van inline-blok naar modal.
- Bewerken van een bestaande contactpersoon opent dezelfde modal,
  vooringevuld — bewerken=aanmaken-symmetrie blijft behouden (§1c,
  `MCM2-CLAUDE.md`), nu via één gedeelde modal-component in plaats van twee
  aparte inline-vormen.
- Sluiten: expliciete annuleer-knop of klik buiten de modal. Geen wijziging
  aan de backend-routes (`voegContactToe`, `wijzigContact` blijven
  ongewijzigd).

---

## 5. Contractrij: uitklapbaar + urgentiekleur

### Uitklappen
- De hele rij is klikbaar (niet alleen een edit-icoon). Klik toont/verbergt
  een detailregel eronder met alle velden: bestaande (contractnummer,
  startdatum, notitie) én de plek waar toekomstige velden bij komen — geen
  aparte "bewerken"-modus meer nodig voor het simpelweg *bekijken* van
  details.
- Wijzigen van een veld gebeurt in de uitgeklapte rij zelf (bestaand
  `ContractRij`-bewerkgedrag, verplaatst van "altijd zichtbaar na
  edit-klik" naar "zichtbaar na uitklappen").
- De koppeling met survey-templates en de wachtlijst-status (zie hieronder)
  staat in dezelfde uitgeklapte regel.

### Wachtlijst-signaal (punt 4)
- Een gekoppelde survey-template toont expliciet **"wachtlijst AAN"** of
  **"wachtlijst UIT"** als tekstlabel — niet langer alleen een stille
  checkbox.
- Staat de wachtlijst uit, dan direct een "nu uitnodigen"-link ernaast
  (bestaand mechanisme uit `survey_run.contract_id`, sessie 21-08).
- Geen wijziging aan het default-gedrag van de checkbox zelf in deze stap —
  dat was de andere optie uit de open vraag van 22-08, en de eigenaar koos
  voor de visuele verduidelijking, niet voor een gedragswijziging.

### Urgentiekleur op de einddatum (tussenoplossing, issue #174 volgt)
Drie drempels op de kale `endDate`, zonder opzegtermijn-correctie:

| Resterende dagen tot einddatum | Kleur | Label |
|---|---|---|
| > 90 dagen | grijs (standaard tekstkleur) | alleen datum |
| ≤ 90 dagen | oranje | datum + "nog X dagen" |
| ≤ 30 dagen of al verstreken | rood | datum + "nog X dagen" / "X dagen geleden" |

Geen claim over automatische verlenging — dat vraagt het opzegtermijn-veld
uit issue #174. De drempelwaarden (90/30) komen als benoemde constanten in
de component, niet als losse getallen inline.

---

## 6. Doorklik-scenario: badge → contractrij

Klik op de compliance-badge in de badge-strip (bijv. "Niet-compliant"):
1. Scrollt naar de Contracten-sectie (`scrollIntoView` op een vaste
   sectie-id, geen navigatie).
2. Klapt de rij van het contract open dat de laagste/slechtste
   compliance-status draagt, als dat eenduidig af te leiden is uit de
   bestaande data; is dat niet eenduidig, dan scrollt het alleen naar de
   sectie zonder een specifieke rij te forceren open te klappen — geen
   giswerk over welk contract "het probleem" is.

Dit blijft binnen dezelfde pagina — geen navigatie naar een aparte
contractpagina (dat is issue #173).

---

## 7. Wat ongewijzigd blijft

- `VendorUitvraagPaneel` — ongewijzigd, blijft onderaan de rechterkolom.
- Alle backend-routes (`contractService`, `vendorService`) — deze stap is
  puur frontend, geen migratie, geen API-wijziging.
- Verwijderen van een leverancier (bevestigingsflow in Stamgegevens) —
  ongewijzigd, verhuist mee naar de compacte linkerkolom.
- `data-testid`-attributen op bestaande knoppen/velden blijven behouden
  waar de onderliggende functionaliteit hetzelfde blijft, zodat bestaande
  Playwright-tests niet onnodig breken; nieuwe testid's komen bij nieuwe
  interactie-elementen (modal, uitklaptrigger, badge-klik).

---

## 8. Test- en previewstrategie

- Bestaande Playwright-suite (`e2e/*.spec.ts` in `MCM2-frontend`) blijft
  leidend; testid's die van "altijd zichtbaar" naar "zichtbaar na
  interactie" gaan (modal, uitklap) vragen aangepaste tests, geen nieuwe
  testinfrastructuur.
- Preview volgens de vaste procedure (`mcm2-demo-link-incognito-hard-
  reload`): na implementatie een demo-link met incognito + hard reload,
  vóór er gemerged wordt.
- Geen backend-wijziging in deze stap, dus geen migratiecontrole nodig in
  de preview-stap.

---

## 9. Openstaande issues die uit dit ontwerp voortkomen

- **#173** — Contract 360 als eigen toppagina (`/contracten/[id]`),
  inclusief nieuwe backend-route. Niet nu.
- **#174** — Opzegtermijn-veld + "verlengt automatisch"-waarschuwing,
  front+backend in één werkstroom. Eerstvolgende stap na deze werkstroom.
