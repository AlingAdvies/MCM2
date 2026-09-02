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
gaf terecht niets. De geplande taak zelf is diezelfde dag aangemaakt en
handmatig getest (`Start-ScheduledTask`, resultaat 0, logregel bevestigd).

## Taakplanner

De taak **"MCM2 tenant-uitnodigingscontrole"** staat al ingesteld — elk uur,
via `scripts/uitnodiging-controle-taak.cmd` (zelfde wrapper-vorm als
`backup-controle-taak.cmd`: vast node-pad, logt naar
`%USERPROFILE%\.mcm2-uitnodigingscontrole\taak.log`, `cd` naar de projectmap
vóór het script draait). `StartWhenAvailable` staat aan en er is geen
batterij-restrictie — zelfde instellingen als de bestaande backup-taken, zodat
een gemiste cyclus (laptop uit) later alsnog ingehaald wordt zodra de laptop
weer aan staat, en de taak niet stopt zodra hij van netvoeding naar batterij
gaat.

Mocht de taak ooit opnieuw ingericht moeten worden:

```powershell
schtasks /Create /TN "MCM2 tenant-uitnodigingscontrole" /TR "C:\DEV\Work\MCM2\scripts\uitnodiging-controle-taak.cmd" /SC HOURLY /MO 1 /RL LIMITED /F
```

gevolgd door (`StartWhenAvailable`/batterij-instellingen zet `schtasks /Create`
niet goed):

```powershell
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Set-ScheduledTask -TaskName "MCM2 tenant-uitnodigingscontrole" -Settings $settings
```

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
