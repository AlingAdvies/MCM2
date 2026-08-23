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
| 2026-08-23 | Een rij in een lijst (contactpersoon, contract) is zelf klikbaar om de bijbehorende bewerkactie te openen — niet alleen een klein icoon ernaast. Vastgesteld nadat de eigenaar tijdens een preview de bewerkknop van een contactpersoon over het hoofd zag: de intuïtie is "klik op de naam", consistent met hoe de contractrij al werkte. Icoon/knop mag blijven staan voor wie expliciet wil klikken, maar is niet de enige weg. |
| 2026-08-22 | Tabelrijen voor lijsten van entiteiten (contracten, leveranciers) gebruiken een `<table>`, niet een `<ul>`/`<li>`-lijst — meer informatie per rij op minder hoogte. Kolommen tonen de kernvelden direct (naam, contractnummer, contactpersoon, contractbeheerder, status, begin–einde) in plaats van pas na een klik. |

## Formulierpatronen

| Datum | Beslissing |
|---|---|
| 2026-08-23 | Contactpersoon toevoegen/bewerken gaat via een modal, niet een inline "fold out" — patroon overgenomen van MVM_V2 (`VendorContactsPanel.tsx`) na expliciete vergelijking. Eén modal-component voor zowel aanmaken als bewerken (bewerken=aanmaken-symmetrie). |
| 2026-08-22 | Een detailscherm dat een record bewerkt, moet alle bestaande waarden vooringevuld tonen én dezelfde acties toestaan die bij aanmaken beschikbaar zijn (bijvoorbeeld: een nieuwe contactpersoon aanmaken vanuit het bewerkformulier van een contract, niet alleen vanuit het aanmaakformulier). |

## Regels en waarschuwingen

| Datum | Beslissing |
|---|---|
| 2026-08-23 | Waarschuwen, niet blokkeren, bij een risicovolle maar legitieme actie (bijv. de enige primaire contactpersoon niet-primair maken). Expliciet principe van de eigenaar: de beheerder is een zelfstandig werkende professional die met veel verschillende leveranciers/contracten/omstandigheden omgaat — een te hard afgedwongen regel duwt hem terug naar Excel. Een bevestigingsvraag (`window.confirm` of gelijkwaardig) die de consequentie benoemt is de standaardvorm; een harde blokkade is de uitzondering, niet de default. |

## Navigatie & vervolgstappen

| Datum | Beslissing |
|---|---|
| 2026-08-22 | Een gekoppelde actie (survey aan contract koppelen) krijgt een zichtbaar, direct pad naar de vervolgstap (een "nu uitnodigen"-link per gekoppelde template) — niet alleen een vlag die passief elders afgelezen moet worden. |

## Afgeronde punten (was: open, zie git-historie voor de context)

Alle vier onderstaande punten stonden hier eerder als "nog niet
vastgelegd" en zijn inmiddels gebouwd — de bijbehorende regel staat nu in
de tabellen hierboven, niet meer hier.

- ~~Contactpersoon-toevoegformulier moet een inklapbare "fold out" zijn~~
  — opgelost via een modal (zie Formulierpatronen, 2026-08-23).
- ~~Contractrijen in de lijst moeten direct openklikbaar zijn~~ — opgelost,
  de rij zelf is de trigger (zie Layout & dichtheid, 2026-08-22/23).
- ~~Onderscheid tussen "survey gekoppeld" en "op de wachtlijst" was
  visueel verwarrend~~ — opgelost met een expliciet "wachtlijst AAN/UIT"-
  label i.p.v. een stille checkbox.
- ~~Geen manier om een primaire contactpersoon terug naar niet-primair te
  zetten~~ — opgelost, zie Regels en waarschuwingen (2026-08-23).
