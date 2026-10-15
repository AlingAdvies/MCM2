# ADR 0006 — Transdev is geen voorwaarde voor de NIS2-module; fundament groeit incrementeel

**Status:** voorstel — 14-10-2026, ter bevestiging door Kees. Wijzigt de *volgorde* in `../roadmap.md`; ADR 0005 (module op mcm2) blijft inhoudelijk staan.

## Context

De roadmap (24-08-2026) liet de NIS2-module wachten op: stap 1 Transdev-survey → stap 2a gedeeld fundament → stap 3 NIS2-module. Stap 1 was bedoeld als goedkope input. Inmiddels leverde de uitgezette pilotlijst geen enkele respons op en verschuift Transdev naar een contractmanagement-use-case. Wachten op Transdev blokkeert de NIS2-doorontwikkeling en de start van de marketing.

Wat in mcm2 al bestaat (gelezen 14-10-2026 in `src/survey`, `src/features`, `docs/STATUS.md`, niet getest): vragenlijst-templates als JSON (negen antwoordtypes, categorieën, bestandsupload), rondes, tokenlinks voor leveranciers zonder account, berekende responsstatus, beoordelaars met oordeel, bijlagen, notities, audit-events, Excel-export van uitnodigingen, en een register van schakelbare features per tenant (nu alleen `contractmodule`).

## Voorstel

1. **Transdev is geen voorwaarde meer.** De Transdev-pilot loopt door zonder extra inspanning. Eventuele frictie-inzichten blijven welkom, maar blokkeren niets.
2. **Stap 2a wordt incrementeel i.p.v. blokkerend.** De bestaande survey-motor is de orchestratielaag. Verfijn tenant-/leveranciers-/rollenmodel en notificaties samen met het eerste NIS2-werk, niet daarvoor.
3. **Eerste bouwstap is een dunne doorsnede op een eigen tenant** (AlingAdvies of demo): SC10-template laden → uitzetten → invullen → beoordelen → (daarna) risicomatrix. Geen aparte engine.
4. **NIS2 wordt een schakelbare module** via één nieuwe feature-key (`nis2module`) in het bestaande register. Label `product:aa`. Zolang NIS2 puur additief is, blijft de topologie "één repo, gedeelde kern" en is het TD/AA-topologiebesluit (CLAUDE.md §0a van mcm2) nog niet nodig. Het wordt wél nodig bij de aanmeldflow/proefperiode en bij de mail-afzender (fase D).
5. **Scoring (blok 7):** de survey-motor kent een oordeel maar geen score. Voorkeur: NIS2-eigen tabellen die naar bestaande responses verwijzen, zodat de kern schoon blijft. Pas beslissen na de doorsnede.

## Aandachtspunten

- **Auteursrecht op de SC-documenten.** ADR 0003 (punt 3) gaat uit van hergebruik zonder IP-restrictie, op basis van een uitspraak van Kees. Het openbare document *"NIS2 SC10 Mapping met ISO27001"* (versie 15-12-2025) draagt echter de vermelding dat kopiëren, wijzigen of gebruiken zonder toestemming niet is toegestaan. Gezien is alleen dit korte document, niet de volledige normteksten. Het conceptsjabloon (`../templates/sc10-basic-concept-v0.json`) is daarom in eigen woorden geformuleerd, per maatregelcode, en pas voor productie te gebruiken na schriftelijke afstemming met Stichting Kwaliteitsinnovatie (het in ADR 0003 al genoemde vervolgtraject). Dit is geen juridisch oordeel.
- **Productie heeft geen mailkanaal** (docs/STATUS.md mcm2, 25-09-2026: uitnodigingslinks worden handmatig doorgegeven). Voor uitzetten en proefaanmelding is dat een harde afhankelijkheid, en tevens de eerste echt divergerende feature tussen TD en AA (afzender).
- **Respons is het kernrisico**, niet de techniek: zie `marktsignalen-ncsc-2026-10.md` (intern document, buiten de publieke repo: OneDrive\MCM2-klantdata\_platform\nis2\) (S1). Kies pilotklanten met een echte deadline en korte lijsten.

## Gevolgen

- `../roadmap.md`: stap 1 en 2a zijn niet langer voorwaarde; zie aanvulling daar.
- Bouwen vanuit gebruiker en scherm: zie `../overview/gebruikersontwerp-nis2.md`.

## Zie ook

`0005-nis2-as-module-on-mcm2.md`, `0003-align-with-nis2-supply-chain-scheme.md`, `marktsignalen-ncsc-2026-10.md` (intern document, buiten de publieke repo: OneDrive\MCM2-klantdata\_platform\nis2\)
