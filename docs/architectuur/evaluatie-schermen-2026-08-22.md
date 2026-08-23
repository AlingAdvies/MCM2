# Evaluatie bestaande schermen tegen §1c (MCM2-CLAUDE.md)

> Uitgevoerd 2026-08-22, direct na het opstellen van §1c. Toetst de
> bestaande frontend-schermen (`MCM2-frontend`) aan de vijf punten uit die
> richtlijn: tokens, dichtheid, bewerken=aanmaken, direct pad naar
> vervolgstap, navigatieplek. Geen nieuwe regels — alleen bevindingen en
> een prioritering, ter voorbereiding op de vier punten uit "21 augustus
> III".

## Samenvatting

| Scherm | Tokens | Dichtheid | Bewerken=aanmaken | Vervolgstap | Oordeel |
|---|---|---|---|---|---|
| `/beheer/leveranciers` (lijst) | ✅ | ✅ | n.v.t. | ✅ (uitnodigen-knop) | Goed — referentiepatroon |
| `/beheer/vragenlijsten` (overzicht) | ✅ | ✅ | n.v.t. | ⚠️ deels | Goed |
| `/beheer/leveranciers/[id]` (detail) | ✅ | ❌ | ⚠️ deels | ⚠️ deels | Herzien nodig — zie hieronder |
| `/beheer/vragenlijsten/uitnodigen` | ✅ | ✅ | n.v.t. | ✅ | Goed |
| `/beheer/vragenlijsten/[id]/wachtlijst` | ✅ | ✅ | n.v.t. | ✅ | Goed |

**Kernbevinding:** het tokenbestand wordt overal consequent gebruikt —
geen hardcoded hex-kleuren gevonden in `src/app`. Het probleem zit niet in
tokendiscipline maar in twee dingen die §1c nieuw invoert: dichtheid
(schermen zijn nog gebouwd als gestapelde losse kaarten, niet als dicht
paneel) en de bewerken=aanmaken-symmetrie (deels al gefixed deze sessie,
deels nog niet).

---

## `/beheer/leveranciers/[id]` — het scherm met de bekende klachten

Dit is precies het scherm waar "21 augustus III" over gaat. De opbouw:
`Stamgegevens` → `Contactpersonen` → `Contracten`, elk een eigen
`<section className="rounded-lg border border-line bg-card p-6">`,
verticaal gestapeld met `mb-8`/`mb-6` ertussen.

### Dichtheid — ❌, bevestigt punt 1 uit de notitie
Drie brede kaarten onder elkaar, elk met eigen `p-6` en interne
`grid gap-4 sm:grid-cols-2` of `sm:grid-cols-3`. Op een breed pc-scherm
(de doelgroep, zie §1c) betekent dat: veel witruimte links/rechts van elk
grid, en veel verticaal scrollen om van stamgegevens naar contracten te
komen. Geen van de drie secties maakt gebruik van een layout die de volle
breedte benut (bijvoorbeeld stamgegevens en contactpersonen naast elkaar
in twee kolommen op een breed scherm).
→ Directe match met genoteerd open punt in `ui-beslissingen.md`.

### Bewerken = aanmaken — ⚠️ deels
- **Contactpersonen**: al symmetrisch. `ContactRij` heeft een eigen
  bewerkstand (toegevoegd vóór deze sessie), en het toevoegformulier staat
  onderaan de lijst.
- **Contracten**: sinds deze sessie ook symmetrisch — `ContractRij` heeft
  een `nieuweContactpersoon`-toggle net als `NieuwContractFormulier`, met
  de bugfix dat `onContactpersoonAangemaakt` nu correct doorwerkt naar de
  bovenliggende `Contactpersonen`-sectie.
- **Nog niet symmetrisch**: het contactpersoon-toevoegformulier in
  `Contactpersonen` staat **altijd open** onderaan de lijst (regel 789),
  in plaats van een fold-out zoals punt 2 van de notitie vraagt. Dat is
  geen bewerken=aanmaken-probleem maar een apart dichtheidsprobleem: een
  altijd-open formulier met 4 velden neemt blijvend ruimte in, ook als
  niemand op dat moment een contact toevoegt.

### Vervolgstap — ⚠️ deels
`VendorUitvraagPaneel` (onderaan) toont lopende uitvragen — dat pad
bestaat. Maar binnen `Contracten` is de koppeling tussen een
survey-template en de eigenlijke verzending nog het onderwerp van het
onopgeloste punt in `ui-beslissingen.md` (checkbox-wachtlijst vs.
koppeling, visueel niet onderscheidend genoeg).

### Navigatieplek — geen bevinding
Contractensectie zit terecht op de leveranciersdetailpagina, niet als
eigen toppagina — conform de UI-spec van deze sessie.

---

## Directe koppeling met "21 augustus III"

| # | Notitiepunt | Bevestigd door deze evaluatie? |
|---|---|---|
| 1 | Stamgegevens/classificatie/contactpersonen indikken, meer breedte gebruiken | Ja — zie Dichtheid hierboven |
| 2 | Contactpersoon-toevoegen moet fold-out zijn | Ja — huidige formulier staat altijd open |
| 3 | Contractrijen moeten direct openklikbaar zijn, ook toekomstige velden | Nog niet beoordeeld — vereist ontwerp van een uitklapbare rij, niet alleen een evaluatie van bestaande code |
| 4 | Wachtlijst-"bug" bij Microsoft/M365 | Al onderzocht vorige sessie: geen databug — `wachtlijst = false` terwijl koppeling bestond. Valt samen met het onopgeloste UX-punt in `ui-beslissingen.md` |

## Aanbevolen volgorde voor de volgende sessie

1. Dichtheid van `/beheer/leveranciers/[id]` herzien — grootste, meest
   zichtbare impact, raakt punt 1 van de notitie direct.
2. Contactpersoon-formulier fold-out maken (punt 2) — kleine, geïsoleerde
   wijziging, goed te combineren met punt 1 omdat het ruimte vrijmaakt.
3. Contractrij uitklapbaar maken in plaats van alleen via edit-knop
   (punt 3) — grotere wijziging, raakt `ContractRij`-structuur.
4. Koppeling/wachtlijst-onderscheid oplossen (punt 4) — was al in
   behandeling, vereist nog een keuze van de eigenaar (visuele
   verduidelijking vs. gedragswijziging).

Elke stap hierboven die een blijvend patroon oplevert, hoort na afloop in
`docs/architectuur/ui-beslissingen.md` vastgelegd te worden — dat is
precies waarvoor dat bestand nu bestaat.
