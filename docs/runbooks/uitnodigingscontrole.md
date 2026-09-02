# Runbook — Telegram-melding bij nieuwe actieve leden (Transdev Nederland)

**Type:** D — routineoperatie
**Eigenaar:** de eigenaar (Chris)
**Laatste update:** 2026-09-02
**Vereiste toegang:** deze PC, de bestaande Telegram-bot (zie
`backupcontrole.md`), `.env` met `PRODUCTIE_RUNTIME_URL`

## Waarvoor

Meldt via Telegram zodra een uitgenodigd lid van de tenant "Transdev
Nederland" op productie voor het eerst inlogt (en daarmee `actief` wordt op
`beheer/leden`). Zie
`docs/superpowers/specs/2026-09-02-telegram-uitnodigingscontrole-design.md`
voor het ontwerp en de afweging tegen een realtime serveroplossing.

**Alleen Transdev Nederland, alleen productie.** Andere tenants en andere
omgevingen worden bewust niet gemeld.

Beproefd tegen productie op 2026-09-02: een geaccepteerde testuitnodiging
leverde correct één Telegram-bericht op, een herhaalde run zonder wijziging
gaf terecht niets.

## Taakplanner instellen (eenmalig)

1. Open Taakplanner → **Taak maken** (niet "Eenvoudige taak").
2. **Algemeen:** naam `MCM2 tenant-uitnodigingscontrole`. "Uitvoeren of de
   gebruiker nu is aangemeld of niet" — zelfde keuze als de bestaande
   backup-taken.
3. **Triggers:** nieuw → Elke dag herhalen, Herhaal taak elke: **1 uur**,
   gedurende: **onbeperkt**.
4. **Acties:** nieuw → Programma: `node`, Argumenten:
   `scripts/uitnodiging-controle.js`, Starten in:
   `C:\DEV\Work\MCM2` (of het actuele pad van deze repository).
5. **Voorwaarden:** "Alleen starten indien op netvoeding" uitzetten (laptop
   draait ook op batterij), zelfde als de backup-taken.

## Wat je ziet

- Een Telegram-bericht per nieuw actief lid:
  `✅ Nieuw lid actief bij Transdev Nederland` gevolgd door naam, e-mail en
  rol.
- **Geen bericht** bij: de allereerste keer draaien (nulstand), een
  onbereikbare database (bijv. laptop offline, of Supabase gepauzeerd), of
  wanneer er simpelweg niemand nieuw is.

## Bij afwijking

| Situatie | Betekenis | Actie |
|---|---|---|
| Geen berichten al een tijd, maar je verwachtte er wel een | De taak draait niet, of de database is onbereikbaar | Vraag Claude: "draai de uitnodigingscontrole handmatig en laat de uitvoer zien" |
| `Tenant 'Transdev Nederland' niet gevonden` | Kan bij dit script niet meer optreden — de tenant-UUID staat vast in de code, geen naam-lookup meer (zie het commentaar bij `TENANT_ID` in `scripts/uitnodiging-controle.js`) | Als dit toch verschijnt, is er iets fundamenteel anders mis; vraag Claude erbij |
| Telegram-bericht blijft uit ondanks een geslaagde run | Telegram-configuratie ontbreekt of is verlopen | Zie `backupcontrole.md` §Telegram-regels — zelfde bot, zelfde configuratie |

## Bekende, losstaande bug (niet dit script)

Het intrekken van een lid op `beheer/leden` toont soms een foutmelding
("Er ging iets mis. Probeer het opnieuw.") terwijl het intrekken zelf wél
gelukt is — de server antwoordt met 204 zonder body, wat de frontend
verkeerd interpreteert. Een F5/ververs bevestigt dat het echt gelukt is.
Zelfde patroon als een eerder gefixte bug op de survey-intrekken-route
(commit `8c54164`); voor `tenant-leden.controller.ts` staat dit nog open.

## Lokale status

Het script onthoudt welke leden het al zag in
`%USERPROFILE%\.mcm2-uitnodigingscontrole\gezien.json`. Dat bestand
verwijderen forceert een nieuwe "eerste run" (nulstand, geen berichten) bij
de eerstvolgende keer draaien.
