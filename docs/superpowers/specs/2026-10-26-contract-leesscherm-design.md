# Contract-leesscherm — design (concept, ter goedkeuring)

**Datum:** 2026-10-26
**Status:** kaartindeling goedgekeurd door eigenaar (26-10). Ongekoppelde dossiers besloten (26-10). Nog niets gebouwd.
**Hangt af van:** #247 (bijlagen/slepen), #248 (dossier als kwestie). Zelfde branch `feat/kwestie-dossier`.

## Aanleiding

Een contract bestaat in MCM2 alleen als bewerkformulier binnen het leveranciersscherm. Je ziet velden, geen stand van zaken. Lessen uit Contract 360 (MVM_V2):

1. **Eerst de stand, dan de gegevens.** Het leesscherm staat vóór het bewerkformulier.
2. **Elke kaart beantwoordt één vraag**; de titel ís de vraag.
3. **Een lege kaart is informatie** ("niet vastgelegd", "geen volgende stap"): het gat wordt zichtbaar, zonder verwijt.
4. **Samenhang tonen** (overige contracten van dezelfde leverancier).

Niet overgenomen: score- en compliancekaart, levensfasen, AI-knop, zes even zware kaarten.

**Toets:** ziet een (incidentele) gebruiker binnen een minuut wat er speelt en wie hij moet bellen?

## Plek en toegang

- Nieuwe route **`/beheer/contracten/[id]`**, alleen lezen. Gebruik: pc.
- Bereikbaar vanuit de contractenlijst en vanuit het contractblok op het leveranciersscherm (naam wordt een link).
- Valt onder het menu Contracten, dat zonder `contractmodule` al verborgen is. Geen extra vlagcontrole nu (zie `_platform/features-en-tiers.md` buiten de repo).
- Knop **"Bewerken"** leidt naar het bestaande formulier; daar verandert niets.

## Opbouw

```
┌ <Contractnaam> ───────────────────────────────────────── [Bewerken] ┐
│ <Leverancier> · nr <nummer> · <werkingsgebieden>                    │
│ looptijd <start> – <eind>  ⚠ verlopen / opzeggen vóór <datum>       │
├──────────────────────────────────────┬──────────────────────────────┤
│ WAT IS AFGESPROKEN (breed)           │ WIE BEL IK                   │
│ type · waarde · opzegtermijn ·       │ leverancier: <contact>       │
│ verlenging · verwerkersovk.          │ intern: <contractbeheerder>  │
│ opmerking                            │ — niet vastgelegd (indien)   │
│ (later: afspraken en werkafspraken)  │                              │
├────────────────────┬─────────────────┴──┬───────────────────────────┤
│ WAT SPEELT ER      │ LAATSTE CONTACT     │ VOLGEND MOMENT            │
│ open dossiers +    │ <datum> · <wat>     │ <datum> · <volgende stap> │
│ laatste stand      │ (afgeleid)          │ of opzegdatum (afgeleid)  │
├────────────────────┬─────────────────────┴───────────────────────────┤
│ KPI-EVALUATIE      │ OVERIGE CONTRACTEN BIJ DEZE LEVERANCIER          │
│ laatste ronde +    │                                                  │
│ status, volgende   │                                                  │
├──────────────────────────────────────────────────────────────────────┤
│ Dossiers bij dit contract (bestaand paneel: aanmaken, slepen, ...)   │
└──────────────────────────────────────────────────────────────────────┘
```

## Kaarten — waar de gegevens vandaan komen

| Kaart | Bron | Leeg = |
|---|---|---|
| Kop | `clm.contract` (naam, nummer, start/eind, status), `contract_werkingsgebied`, leverancier | — |
| Signaal in kop | einddatum verstreken → "verlopen"; einddatum − opzegtermijn binnen `warning_days_before` → "opzeggen vóór …" | geen signaal |
| Wat is afgesproken | contracttype, waarde, opzegtermijn, automatische verlenging, verwerkersovereenkomst, opmerking | "Nog niet vastgelegd" per ontbrekend veld |
| Wie bel ik | `vendor_contact_id` (naam, mail, telefoon), `owner_user_id` (contractbeheerder) | "Niet vastgelegd" |
| Wat speelt er | (1) open dossiers gekoppeld aan dit contract, met laatste stand; (2) daaronder apart **"Speelt bij de leverancier"**: open dossiers van deze leverancier zonder contractkoppeling, met knop **"koppel aan dit contract"** (bestaande route `POST /engagements/:id/links`) | "Geen open kwesties" |
| Laatste contact | jongste datum van notitie of bijlage over de dossiers van dit contract **én** de ongekoppelde dossiers van de leverancier (afgeleid, client-side) | "Nog geen contact vastgelegd" |
| Volgend moment | vroegste volgende-stapdatum van open dossiers (dit contract + ongekoppelde van de leverancier); anders de opzegdatum | "Geen volgende stap" |
| KPI-evaluatie | **bron: interne survey** (besluit eigenaar 26-10). Toont **status** (gepland / loopt / beoordeeld) **én score** van de laatste ronde over dit contract en of een volgende ronde klaarstaat. Bronnen die er al zijn: `contract_survey_template` (welke vragenlijsten bij het contract horen, incl. wachtlijst) en `survey_run.contract_id` (bestaat, nog niet gevuld). Hoe precies: uitwerken bij het bouwen. | "Nog geen KPI-evaluatie ingericht" |
| Overige contracten | andere contracten van dezelfde leverancier, met looptijd | "Geen" |
| Dossiers | bestaand `EngagementPanel` met `contractId` | — |

## Backend

Zo min mogelijk nieuw:
- Eén leesroute **`GET /contracts/:id/overzicht`** die contract, leverancier, contactpersoon, contractbeheerder, werkingsgebieden en overige contracten van die leverancier in één keer teruggeeft. Bestaat er al een route die dit grotendeels levert, dan die hergebruiken (uitzoeken bij het bouwen).
- Dossiers via de bestaande `GET /vendors/:id/engagements`.
- Geen migratie.

## Bewust buiten scope (latere stappen)

- "Wat is afgesproken" met inhoudelijke afspraken en werkafspraken (de vier blokken uit de analyse).
- Overlegritme met agenda en verslag.
- Een expliciete raam/afroep-koppeling tussen contracten (nu alleen "overige contracten bij deze leverancier").
- Telefoonweergave.

## Open vragen aan de eigenaar

*Besloten 26-10:* kaartindeling akkoord; KPI-evaluatie = interne survey, kaart toont status én score.


*Besloten 26-10 — ongekoppelde dossiers:* een ongekoppeld dossier is in de praktijk een kwestie die **de hele leverancier** raakt (bijv. een naamswijziging). Weergave als aparte regel "Speelt bij de leverancier" onder de eigen kwesties; telt mee voor laatste contact en volgend moment; met één klik aan dit contract te koppelen. Dossiers die aan een **ander** contract van dezelfde leverancier hangen, tonen hier niet.

Geen openstaande vragen meer voor dit ontwerp.
