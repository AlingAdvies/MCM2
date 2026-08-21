# Ontwerp — vragenlijst-gegroepeerde weergave i.p.v. platte rondes-lijst

**Datum:** 2026-08-21
**Issue:** [#154](https://github.com/AlingAdvies/MCM2/issues/154)
**Roadmap:** `docs/architectuur/roadmap-vendor-it-survey.md` §2.2

---

## Probleem

Elke individuele uitnodiging heet in `/beheer/vragenlijsten` een "ronde", en
verschijnt als losse rij in een platte lijst (`GET /runs`, resultaat
`RondeSamenvatting[]`).

Dat werkt voor tenants die daadwerkelijk in rondes denken (bijvoorbeeld
"Vendor IT Risk Q3_26" als één uitgestuurde batch). Het werkt niet voor een
tenant die **druppelsgewijs** uitnodigt — leverancier voor leverancier, niet
in een batch. Voor die tenant levert elke afzonderlijke uitnodiging een eigen
rij in de rondes-lijst op, en die lijst wordt snel onoverzichtelijk zonder dat
het "ronde"-concept er iets aan toevoegt.

**Aanleiding is breder dan alleen verwarring nu.** De term "ronde" is ook al
bezet voor een latere, echte feature: herhaalde meting (dezelfde vragenlijst
periodiek opnieuw uitsturen om trends te zien). Die naamsbotsing wordt
duurder om op te lossen naarmate er meer code op de huidige naam gebouwd
wordt.

## Scope-beslissing (eigenaar, 21-08)

Expliciet gekozen voor de **lichtste** aanpak die de verwarring wegneemt,
zonder een database- of functionaliteitswijziging:

- **Geen nieuw databaseveld.** Geen "rondenaam" die een beheerder zelf
  invult — dat zou een aparte, latere feature zijn (echte herhaalde meting),
  niet dit issue.
- **Geen backend-hernoeming.** `RondeBeheerService`, `RondeSamenvatting`,
  de databasekolom/tabel — die blijven "ronde" heten. Dat is een intern
  implementatiedetail dat de gebruiker nooit ziet, en hernoemen is in deze
  scope niet nodig.
- **Geen API-wijziging.** `GET /runs` levert per ronde al `templateNaam`
  (vragenlijst-titel) en `startedAt` (tijdstip) — precies wat nodig is om te
  groeperen en een tijdsaanduiding te tonen. Geverifieerd in
  `src/survey/vragenlijst-beheer.service.ts` (`RondeSamenvatting`-interface).

Dit is dus **uitsluitend een frontend-wijziging**, in de `MCM2-frontend`-repo.

## Ontwerp

Het beheerscherm (`/beheer/vragenlijsten`) groepeert de resultaten van
`GET /runs` per `templateNaam` in plaats van ze als platte lijst te tonen.

- Elke groep (één per vragenlijst-titel) is uitklapbaar.
- **Ingeklapt:** toont de titel + een samengevoegde voortgangsindicator,
  opgeteld uit de onderliggende rondes van die groep (bijv. "3 van 5
  ingediend").
- **Uitgeklapt:** toont de individuele uitnodigingen (de huidige "rondes")
  eronder, elk met:
  - de betrokken leverancier(s)/deelnemers
  - een tijdsaanduiding, afgeleid van `startedAt` — geen los invoerveld
  - status (open / gesloten / ingetrokken, zoals nu al getoond wordt)
- **Het woord "ronde" verdwijnt uit wat de gebruiker ziet.** De
  tijdsaanduiding vervangt het functioneel als onderscheidend kenmerk tussen
  twee uitnodigingen van dezelfde vragenlijst.

### Wat dit niet doet

- Geen nieuw databaseveld voor een handmatige "rondenaam".
- Geen wijziging aan hoe rondes worden aangemaakt (`POST /runs`).
- Geen wijziging aan de backend-namen (`RondeBeheerService` etc.) of aan de
  databasekolom/tabel.
- Geen wijziging voor tenants die wél met een expliciet rondes-concept
  werken — die feature (handmatig een rondenaam kunnen geven) blijft een
  latere, aparte beslissing, zoals de roadmap al aangaf.

## Waar dit gebouwd wordt

Uitsluitend in `MCM2-frontend` (aparte repository) — het scherm dat
`GET /runs` aanroept en rendert. Geen wijziging in deze repository (`MCM2`)
nodig.

## Bronnen

- Issue [#154](https://github.com/AlingAdvies/MCM2/issues/154)
- `docs/architectuur/roadmap-vendor-it-survey.md` §2.2
- `src/survey/vragenlijst-beheer.controller.ts` (`GET /runs`, `GET /runs/:id`)
- `src/survey/vragenlijst-beheer.service.ts` (`RondeSamenvatting`-interface)
