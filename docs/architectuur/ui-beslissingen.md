# UI-beslissingen — MCM2 frontend

> Bijgehouden vanaf 2026-08-22, ingesteld naar aanleiding van §1c in
> `MCM2-CLAUDE.md`. Analoog aan de "Bekende beslissingen"-tabel in
> MVM_V2's `CLAUDE.md`: elke keer dat een sessie een frontend-patroon
> vaststelt, komt het hier bij — zodat het niet opnieuw uitgevonden of
> per scherm anders toegepast wordt.
>
> Eén regel per beslissing. Nieuwste bovenaan per sectie.

---

## Layout & dichtheid

| Datum | Beslissing |
|---|---|
| 2026-08-22 | Tabelrijen voor lijsten van entiteiten (contracten, leveranciers) gebruiken een `<table>`, niet een `<ul>`/`<li>`-lijst — meer informatie per rij op minder hoogte. Kolommen tonen de kernvelden direct (naam, contractnummer, contactpersoon, contractbeheerder, status, begin–einde) in plaats van pas na een klik. |

## Formulierpatronen

| Datum | Beslissing |
|---|---|
| 2026-08-22 | Een detailscherm dat een record bewerkt, moet alle bestaande waarden vooringevuld tonen én dezelfde acties toestaan die bij aanmaken beschikbaar zijn (bijvoorbeeld: een nieuwe contactpersoon aanmaken vanuit het bewerkformulier van een contract, niet alleen vanuit het aanmaakformulier). |

## Navigatie & vervolgstappen

| Datum | Beslissing |
|---|---|
| 2026-08-22 | Een gekoppelde actie (survey aan contract koppelen) krijgt een zichtbaar, direct pad naar de vervolgstap (een "nu uitnodigen"-link per gekoppelde template) — niet alleen een vlag die passief elders afgelezen moet worden. |

## Open punten — nog niet als vaste regel vastgelegd

Vastgesteld maar nog niet doorvertaald naar een concrete, herbruikbare
regel; oppakken zodra de bijbehorende schermen herzien worden.

- Contactpersoon-toevoegformulier moet een inklapbare "fold out" zijn,
  niet standaard open.
- Contractrijen in de lijst moeten direct openklikbaar zijn (niet alleen
  via een aparte bewerk-knop) en dan alle bestaande én toekomstige velden
  tonen.
- Onderscheid tussen "survey gekoppeld aan contract" en "op de
  wachtlijst voor de volgende ronde" is functioneel duidelijk maar visueel
  nog verwarrend — een checkbox die default uit staat wordt als afwezige
  koppeling gelezen. Oplossing nog niet gekozen.
