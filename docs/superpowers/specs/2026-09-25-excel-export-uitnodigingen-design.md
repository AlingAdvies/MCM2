# Excel-export leveranciersuitnodigingen — design

> **Bron:** issue #222 (`Excel-export leveranciersuitnodigingen t.b.v.
> handmatig mailen via Outlook/Power Automate`) + het UI-ontwerp-comment van
> 24-09-2026 op dat issue. Dit document beantwoordt de drie daar nog open
> vragen en legt het definitieve ontwerp vast.

## Aanleiding

Zolang MCM2 zelf niet mailt, verstuurt de eigenaar leveranciersuitnodigingen
handmatig via Outlook, aangestuurd door Power Automate. Daarvoor is een
Excel-bestand nodig met de geselecteerde leveranciers van één
uitnodigingsronde: bedrijfsnaam, contactpersoon, e-mailadres, de unieke
portaal-link, en rondekenmerken.

## Beantwoording van de drie open vragen uit het issue

1. **CSV of .xlsx?** → **.xlsx.** Power Automate's "List rows present in a
   table"-actie wil een Excel-tabel, geen los CSV-bestand — .xlsx scheelt
   een handmatige tussenstap per ronde.
2. **Datum+naam of een leesbaar volgnummer?** → **Datum + vragenlijstnaam
   volstaat.** Geen schemawijziging nodig.
3. **Zit contactpersoon-naam al in het participants-antwoord?** → **Nee,
   nog niet.** De bestaande LATERAL-join in
   `RondeBeheerService.uitnodigen()` (`src/survey/ronde-beheer.service.ts:548`)
   selecteert alleen `c.email AS contact_email` uit `clm.vendor_contact` —
   `full_name` wordt niet meegenomen. Kleine uitbreiding van een bestaande,
   al-werkende query (zelfde `LEFT JOIN LATERAL`, zelfde
   `is_primary DESC, created_at ASC`-selectie van dé primaire
   contactpersoon), geen nieuwe tabel of migratie.

## Kernbeslissing: client-side export, geen nieuwe backend-route

De export gebruikt **dezelfde tokens/links die al op het scherm staan** na
het aanmaken van de ronde (`POST /admin/survey/runs/:id/participants` met
`verstuurMail: false`). Er komt **geen tweede backend-aanroep** die opnieuw
tokens genereert — dat zou een nieuwe, parallelle set tokens/links opleveren
naast de al-getoonde, met alle verwarring van dien (welke link is nu geldig,
welke is verstuurd/gekopieerd).

De export is dus een **client-side omzetting** van het al-opgehaalde
resultaat naar een `.xlsx`-bestand, getriggerd door een downloadknop op
hetzelfde resultaatscherm.

## Backend — kleine uitbreiding, geen nieuwe route

`src/survey/ronde-beheer.service.ts`:
- De query op regel 548 selecteert ook `c.full_name AS contact_naam`.
- `VendorRij` krijgt `contact_naam: string | null`.
- `Uitnodiging` (interface, regel 53) krijgt `contactNaam?: string` —
  zelfde optionaliteit als `contactEmail`, om dezelfde reden: niet elke
  leverancier heeft een contactpersoon.

`src/survey/vragenlijst-beheer.controller.ts`:
- De `uitnodigen`-route (regel 693) geeft `contactNaam` mee in elk item van
  het al-bestaande `uitnodigingen`-antwoord — zowel in het
  `verstuurMail: false`-pad (regel 722-734) als in het normale mailpad
  (regel 760-770).

Geen migratie, geen nieuwe route, geen wijziging aan het rechtenmodel — dit
blijft binnen de bestaande `@VereistRol('admin')`-grens van de route.

## Frontend — downloadknop + client-side .xlsx-bouw

**Library:** SheetJS (`xlsx`) — kleinste, meest gangbare keuze voor
client-side `.xlsx`-generatie, geen backend-afhankelijkheid nodig voor een
enkel werkblad met platte data.

**Nieuw bestand** `src/core/services/uitnodigingExportService.ts`:
- Neemt de al-opgehaalde `uitnodigingen`-lijst (met `contactNaam` erbij),
  de ronde-datum en vragenlijstnaam.
- Bouwt één werkblad met kolommen, in deze volgorde (uit het
  UI-ontwerp-comment — wat per rij verschilt eerst, vaste context
  achteraan):

  | Kolom | Bron |
  |---|---|
  | Bedrijfsnaam | `vendorNaam` |
  | Contactpersoon | `contactNaam` (leeg als afwezig) |
  | E-mailadres | `contactEmail` (leeg als afwezig) |
  | Link | volledige portaal-URL (zelfde opbouw als de "Alles kopiëren"-knop nu al gebruikt) |
  | Ronde-datum | de datum waarop de ronde is gestart |
  | Vragenlijstnaam | `context.vragenlijstNaam` |
  | Verloopt op | `expiresAt` |

- Triggert een browserdownload met een bestandsnaam die de vragenlijstnaam
  en datum bevat (bijv. `uitnodigingen-<vragenlijstnaam>-<datum>.xlsx`),
  zodat meerdere exports niet elkaar overschrijven in de Downloads-map.

**Wijziging in** `src/app/beheer/vragenlijsten/uitnodigen/page.tsx`:
- Op het resultaatscherm (stap `'klaar'`), in het bestaande rode
  waarschuwingsblok (regel 239-259, zichtbaar bij
  `samenvatting.geenMailkanaal`), naast de "Alles kopiëren"-knop
  (regel 307-324):

  ```
  ⚠ Er is geen mailkanaal ingesteld in deze omgeving.
    Geen van de leveranciers heeft automatisch een mail ontvangen.

    [ Download als Excel-bestand ]
    Gebruik dit bestand om de mails zelf te versturen via Outlook.
  ```

- Bewust geen jargon ("Power Automate") in de UI-tekst — dat is de eigen
  vervolgstap van deze specifieke gebruiker, niet universeel relevant.
- Knop alleen zichtbaar bij `samenvatting.geenMailkanaal` — is er wél mail
  verstuurd, dan is een handmatige export niet relevant.

## Uit scope

- Geen Power Automate-koppeling in MCM2 zelf — de romptekst blijft in
  Power Automate/Outlook, niet in MCM2. Dat houdt de romptekst flexibel
  aanpasbaar zonder code-wijziging.
- Geen leesbaar rondevolgnummer (bijv. "Ronde 3") — datum + vragenlijstnaam
  volstaat als rondekenmerk.
- Geen wijziging aan het bestaande mailpad of aan hoe tokens worden
  aangemaakt.
- Geen backend-export-route — bewust client-side, om dubbele
  tokengeneratie te voorkomen.

## Testplan (kort, voor het implementatieplan)

- Backend: bestaande e2e-suite voor de `uitnodigen`-route uitbreiden met een
  assertie dat `contactNaam` in het antwoord zit wanneer de leverancier een
  primaire contactpersoon heeft, en `undefined` is wanneer niet.
- Frontend: handmatige browserverificatie (zoals bij de vorige feature) —
  ronde aanmaken zonder mailkanaal, downloadknop verschijnt, gedownload
  bestand bevat de juiste kolommen in de juiste volgorde en waarden.
