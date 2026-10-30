# ADR-018 — Afscherming tussen concessies: redelijk, in de applicatie

- **Status:** voorgesteld — nog niets van gebouwd.
- **Datum:** 2026-10-30
- **Aanleiding:** de concessiemodule (CCM) vraagt dat een gebruiker alleen de concessies ziet
  waaraan hij is toegewezen. De eerste uitwerking (`docs/architectuur/ccm-opzet-en-besluiten.md`,
  concept 30-10) legde die afscherming als RLS-policy in de database. Dat vraagt een wijziging aan
  de gedeelde kern en zet achtergrondverwerking klem, terwijl de eis zelf zo zwaar niet is.
- **Relatie:** `docs/ARCHITECTUUR.md` (platformgaranties 1 en 3), ADR-003 (schema-indeling),
  ADR-011 (voorbeeld van een bewust geaccepteerd risico), ADR-015 (toegang als gebeurtenis).

---

## Context

MCM2 kent één harde grens: de tenant. Een tenant is een klantorganisatie; RLS met FORCE in de
database zorgt dat een programmeerfout in de applicatie nooit gegevens van de ene klant aan de
andere laat zien. Die grens is er omdat er meerdere klanten op hetzelfde platform staan.

Concessies voegen een tweede grens toe, **binnen** één tenant. Alle gebruikers van de
concessiemodule zijn medewerkers van Transdev. De eis van de eigenaar (30-10): "niet in andere
concessies mogen" betekent **redelijke afscherming** — wie een concessie niet nodig heeft, ziet
haar niet en komt er niet per ongeluk bij. Het hoeft niet bestand te zijn tegen een collega die
er bewust op uit is; die vindt dezelfde stukken langs andere weg (SharePoint, mail).

De twee grenzen verschillen dus in tegenpartij en in vereiste sterkte:

| Grens | Tegen wie | Sterkte |
|---|---|---|
| Tussen tenants | Andere organisaties | Hard: een fout in de applicatie mag niets lekken |
| Tussen concessies | Collega's binnen Transdev | Redelijk: niet zichtbaar, niet per ongeluk bereikbaar |

Wat een databasepolicy per concessie zou kosten:

- De database weet nu niet wélke gebruiker vraagt; `withTenant()` zet alleen
  `app.current_tenant_id` en `app.current_actor`. Een gebruikers-id erbij is een wijziging aan
  platformgarantie 1, voor één module en één klant.
- Achtergrondwerk zonder ingelogde gebruiker — tekst uit documenten halen, een zoekindex
  bijwerken, later samenvattingen — moet alle concessies kunnen lezen. Dat vraagt een uitzondering
  op de policy (een `SECURITY DEFINER`-functie of een aparte rol): precies het soort gat dat de
  policy moest voorkomen.

## Besluit

1. **Tussen tenants verandert niets.** Elke tabel in schema `concessie` krijgt `tenant_id`, RLS
   met FORCE, een regel in `src/db/rechten-contract.ts` en expliciete `GRANT`s, zoals elke andere
   tenanttabel.
2. **Tussen concessies wordt afgeschermd in de applicatie**, op één centrale plek:
   - de toewijzing is de rolbezetting uit ADR-019: gebruiker, functie, concessie, geldig vanaf
     en tot; een functie met het kenmerk "centraal" ziet alle concessies;
   - één controle die elke concessieroute aanroept: staat `concessiemodule` aan voor deze tenant,
     en is deze gebruiker (nu) aan deze concessie toegewezen? Zo niet: 404, alsof de concessie
     niet bestaat;
   - lijsten en zoekresultaten filteren in dezelfde query op toegewezen concessies;
   - toewijzen en intrekken komen in de audit trail, met datum en verlener (lijn ADR-015).
3. **Eén dekkende test**: alle concessieroutes worden aangeroepen door een gebruiker zonder
   toewijzing en moeten 404 geven. De lijst routes komt uit de applicatie zelf, niet uit een
   handgeschreven opsomming, zodat een nieuwe route zonder controle meteen rood wordt.
4. **Achtergrondwerk** leest binnen de tenant zonder concessiefilter. Het filter geldt bij het
   tonen, niet bij het verwerken.
5. **Geen wijziging aan `withTenant()`** of aan de sessiecontext voor deze module.

## Geaccepteerd risico

Een programmeerfout in de concessiemodule — een route zonder de centrale controle, een query
zonder filter — kan een Transdev-medewerker stukken van een concessie laten zien waaraan hij niet
is toegewezen. Gegevens van andere klanten blijven buiten bereik; die grens ligt in de database.

Dit risico is bewust geaccepteerd door de eigenaar (30-10): de tegenpartij is een collega, de
stukken zijn binnen Transdev ook langs andere weg te vinden, en de test uit punt 3 maakt een
vergeten controle zichtbaar voordat hij productie haalt.

## Wanneer dit heropend wordt

- Er komen gebruikers van buiten Transdev in de concessiemodule (provincie, gemeente, partner).
  Dan wordt de grens tussen concessies een grens tussen organisaties en hoort hij in de database.
- Transdev of een auditor eist aantoonbare afscherming op databaseniveau.
- Een tweede klant wil afscherming binnen de tenant voor contracten (bijvoorbeeld per afdeling).
  Dan is dit een kern-feature en hoort de afweging opnieuw, voor kern en concessies samen.

## Gevolgen

- De concessiemodule raakt de gedeelde kern niet voor toegang.
- Voor de pilot (één concessie, HWGO) is de toewijzing nog niet nodig: wie de module ziet, ziet
  HWGO. De rolbezetting per concessie (ADR-019) komt mee met de tweede concessie; de centrale
  controle en de test uit punt 3 komen er vanaf de eerste route.
- `docs/ARCHITECTUUR.md` krijgt, zodra de module gebouwd wordt, een korte regel bij garantie 3:
  binnen een tenant bestaat afscherming per concessie, in de applicatie, met dit ADR als bron.
