# Blok 1 — Leveranciers- &amp; dienstenregister

**Status:** concept — scope herzien 24-08-2026 (ADR 0005). Geen eigen datamodel meer; dit IS het gedeelde mcm2-leveranciersregister.

## Belangrijke wijziging (ADR 0005, bevestigd)

Dit blok was eerst opgezet als een eigen, licht leveranciersregister, met een optionele/latere sync vanuit mcm2 (ADR 0001, vervallen). Dat is omgedraaid: er is nu **één** leveranciers- en contactpersonenregister, gedeeld tussen mcm2 en de NIS2-tool. Een leverancier die in mcm2 bestaat vanwege een contract, is dezelfde leverancier die in de NIS2-tool beoordeeld wordt — geen import, geen sync, geen twee records die uit elkaar kunnen lopen.

## Doel

Stamgegevens van leveranciers en contactpersonen als gedeelde data tussen mcm2 (contractmanagement) en de NIS2-tool (leveranciersbeoordeling). Eén leverancier kan meerdere diensten/contracten en meerdere NIS2-beoordelingen hebben.

## Scope

- **In scope (stap 2a):** het bestaande mcm2-leveranciers-/contactpersonenmodel doorlichten en waar nodig uitbreiden met velden die de NIS2-tool nodig heeft maar mcm2 niet (bv. een NIS2-specifiek contactpersoon-type, zie `../overview/glossary.md`).
- **Buiten scope:** een aparte importfunctie vanuit mcm2 — die is niet meer nodig, want het is dezelfde data. (Blok 12, import vanuit de ZCERT-excel, blijft wel bestaan — dat is een ander soort import, voor nieuwe klanten zonder mcm2-historie.)

## Herkomst

ZCERT-excel, tabblad "Algemeen — intake", deel 1 (door de leverancier ingevulde bedrijfsgegevens) — nu te mappen op de bestaande mcm2-leveranciersstructuur in plaats van een nieuw schema.

## Kernentiteiten (gedeeld met mcm2)

- Leverancier (bedrijfsnaam, adres, KvK-nummer) — bestaand mcm2-model, eventueel aan te vullen
- Contactpersoon (generieke rollen: security contact, privacy contact — zie glossary.md, niet "CISO/FGO") — mogelijk nieuw contactpersoon-type binnen het bestaande model
- Dienst / Product — nieuw voor NIS2 (mcm2 kent primair contracten, niet per se "diensten" als aparte entiteit — te verifiëren bij de doorlichting in stap 2a)

## Business rules

- Uniciteit: KvK-nummer uniek per tenant — ongewijzigd, nu gehandhaafd op het gedeelde model.
- Status: actief/inactief — ongewijzigd.

## Workflow / statussen

Organisatiegebruiker koppelt een dienst aan een bestaande (of nieuwe) leverancier in het gedeelde register, vóórdat stream A (blok 2/3) start. Voor een leverancier die al in mcm2 staat vanwege een contract, is er geen aparte "toevoegstap" nodig.

## Schermen (indicatief)

- Registeroverzicht (lijst van leveranciers) — mogelijk hetzelfde scherm als in mcm2, met een NIS2-beoordelingskolom toegevoegd
- Leverancierskaart (stamgegevens, contactpersonen, gekoppelde diensten/contracten, NIS2-beoordelingen) — één kaart, twee "gezichten"
- Dienst toevoegen/koppelen (nieuw t.o.v. mcm2, voor zover mcm2 dit nog niet als aparte entiteit kent)

## Afhankelijkheden

Blok 0 (gedeeld tenant-/rollenfundament). Voedt blok 2 (classificatie per dienst).

## Wettelijke referentie

Ondersteunend aan art. 21 lid 2 sub d (identificatie van directe leveranciers is de eerste stap).

## Open vraag

Kent mcm2 al een "dienst"-entiteit los van een contract, of moet die worden toegevoegd? Dit bepaalt hoeveel van dit blok daadwerkelijk nieuwbouw is versus doorlichting — te beantwoorden in stap 2a.

## Acceptatiecriteria (concept)

- [ ] Een leverancier die al in mcm2 bestaat, is direct (zonder import/sync-actie) bruikbaar in de NIS2-tool.
- [ ] Een leverancier kan gekoppeld worden aan meerdere diensten, en een dienst kan meerdere keren beoordeeld worden (historie).
- [ ] KvK-nummer dubbel binnen dezelfde tenant wordt geweigerd/gewaarschuwd — op het gedeelde model, dus ook zichtbaar/voorkomen vanuit mcm2's kant.
