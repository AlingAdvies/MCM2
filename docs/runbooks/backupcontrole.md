# Runbook — backupcontrole en Telegram-melding

**Type:** D — routineoperaties
**Eigenaar:** de eigenaar (Chris)
**Laatste update:** 2026-08-04
**Vereiste toegang:** deze PC, Docker Desktop, een Telegram-account

> Ontwerp en onderbouwing: `docs/superpowers/specs/2026-08-04-backupcontrole-en-signalering.md`

---

## Waarom dit runbook bestaat

Op 2026-08-04 bleken twee dingen tegelijk mis:

1. **De dagelijkse dump miste negen van de achttien tabellen** — alle vragenlijsten, alle
   antwoorden, alle geüploade certificaten en het complete rechtenmodel. Dat was er altijd al
   zo geweest; alle dumps waren exact 21.683 bytes groot.
2. **De taak had vier dagen stilgelegen** (31 juli → 4 augustus). Het script waarschuwde
   correct in het log — maar niemand las dat log.

Dit runbook richt de controle in die beide gevallen wél zou hebben gemeld.

---

## Wat de controle doet

| Laag | Vraag | Wanneer |
|---|---|---|
| A | Is er een dump jonger dan 36 uur? | dagelijks |
| B | Zit alles erin wat erin hoort? | dagelijks |
| C | Komt het er na een echte restore ook weer uit? | wekelijks |

Laag B vergelijkt de dump met `docs/runbooks/backup-verwachting.json` — een handgeschreven
lijst van wat erin hoort. Die lijst wordt bewust **niet** uit de migraties afgeleid: dan zou
de controle zichzelf verifiëren, en precies dat maakte de fout van 4 augustus onzichtbaar.

---

## Stap 1 — Telegram-bot aanmaken

**Actie:** maak een eigen bot voor MCM2. Niet die van een privéproject hergebruiken — een
klantomgeving hoort niet in hetzelfde kanaal.

1. Open Telegram, zoek **@BotFather**, stuur `/newbot`.
2. Kies een naam (bijv. `MCM2 backupwacht`) en een gebruikersnaam eindigend op `bot`.
3. BotFather geeft een token terug: een lange tekenreeks met een dubbele punt erin.
4. Start een gesprek met je nieuwe bot en stuur hem één bericht (anders mag hij jou niet
   aanschrijven).
5. Zoek **@userinfobot** en stuur `/start` — die geeft je chat-id, een getal.

**Verwacht resultaat:** een token en een chat-id.

**Bij afwijking:** krijgt de bot geen berichten door, controleer dan of je hem zelf éérst een
bericht hebt gestuurd. Telegram staat niet toe dat een bot een onbekende aanschrijft.

---

## Stap 2 — Credentials in `.env` zetten

**Actie:** voeg in `C:\DEV\Work\MCM2\.env` toe:

```
TELEGRAM_BOT_TOKEN=<het token van BotFather>
TELEGRAM_CHAT_ID=<het getal van userinfobot>
```

**Let op:** `.env` staat in `.gitignore` en hoort daar te blijven. Committeer deze waarden
nooit.

**Verwacht resultaat:** twee regels in `.env`.

---

## Stap 3 — De melding testen

**Actie:**

```powershell
npm run backup:controle:test
```

**Verwacht resultaat:** `OK — testbericht verstuurd`, en een bericht in Telegram:
*"🔔 Testbericht van de MCM2-backupcontrole..."*

**Bij afwijking:**
- *"TELEGRAM_BOT_TOKEN en/of TELEGRAM_CHAT_ID ontbreken"* → stap 2 niet gelukt.
- *"Telegram-bericht mislukt: 401"* → het token klopt niet.
- *"Telegram-bericht mislukt: 400"* → de chat-id klopt niet, of je hebt de bot nog geen
  bericht gestuurd (zie stap 1, punt 4).

**Dit is geen optionele stap.** Zonder deze test weet je pas of de melding werkt op het moment
dat je hem het hardst nodig hebt.

---

## Stap 4 — De controle handmatig draaien

**Actie:**

```powershell
npm run backup:controle
```

**Verwacht resultaat op 2026-08-04** (zolang Issue #25 open staat):

```
🔴 MCM2 backup — 04-08, 10:09

De dump mist 9 van de 18 tabellen:
  • clm.sessie
  • clm.survey_answer
  ...
```

Dat is correct gedrag: de controle klaagt terecht, en blijft dat doen tot de migratiestand van
`clm-enterprise` is bijgewerkt.

**De wekelijkse variant, met echte herstelproef:**

```powershell
npm run backup:controle:volledig
```

Die duurt ongeveer een halve minuut en heeft Docker nodig.

---

## Stap 5 — De taken inplannen

Twee taken in Taakplanner, ná de bestaande taak `MCM2 databasebackup` (die draait om 07:00).

**Taak 1 — dagelijkse controle**

| Veld | Waarde |
|---|---|
| Naam | `MCM2 backupcontrole` |
| Trigger | Dagelijks, 07:30 |
| Actie | Programma starten |
| Programma | `C:\DEV\Work\MCM2\scripts\backup-controle-taak.cmd` |
| Beginnen in | `C:\DEV\Work\MCM2` |

**Taak 2 — wekelijkse herstelproef**

| Veld | Waarde |
|---|---|
| Naam | `MCM2 backupcontrole volledig` |
| Trigger | Wekelijks, maandag 07:45 |
| Actie | Programma starten |
| Programma | `C:\DEV\Work\MCM2\scripts\backup-controle-taak.cmd` |
| Argumenten | `--volledig` |
| Beginnen in | `C:\DEV\Work\MCM2` |

**Waarom 07:30 en niet 07:00:** de backup zelf draait om 07:00 en duurt seconden. Een half uur
marge is ruim, ook als Docker traag opstart.

**Waarom via een `.cmd` en niet rechtstreeks:** een taak die het commando direct aanroept meldt
"geslaagd" zodra `cmd.exe` zelf kon starten, ook als er daarbinnen niets gebeurde. Dat is op
2026-07-30 daadwerkelijk gebeurd bij de backuptaak. Het `.cmd`-bestand geeft de echte exitcode
door en logt altijd.

**Verificatie na het inplannen:**

```powershell
Get-ScheduledTaskInfo -TaskName "MCM2 backupcontrole"
Get-Content "$env:USERPROFILE\OneDrive - Aling Advies\MCM2-backups\backup-controle.log" -Tail 20
```

---

## Wat je van de melding mag verwachten

**Bij een probleem:** één bericht meteen. Houdt het probleem aan, dan na 48 uur een tweede en
**laatste** bericht. Daarna stilte tot het is opgelost.

Dat is opzet: een probleem dat vijf dagen duurt moet niet vijf keer melden, want dan leer je
het bericht negeren — en dan is de melding net zo stil als het logbestand.

**Bij herstel:** `✅ Hersteld na 4d 2u: de dump is weer compleet`

**Als alles goed gaat:** één keer per week een levensteken met de stand van zaken. Dit is het
belangrijkste onderdeel van de hele opzet: zonder levensteken weet je bij uitblijvende
berichten niet of alles goed gaat of dat de melder zelf stuk is.

**Blijft het wekelijkse levensteken uit, dan is er iets mis** — met de controle, met Telegram,
of met de machine. Dat is het signaal om te gaan kijken.

---

## Onderhoud

**Bij elke migratie die een tabel toevoegt of hernoemt:** werk
`docs/runbooks/backup-verwachting.json` bij. Vergeet je dat, dan meldt de controle een
"onbekende tabel" — vervelend, maar zichtbaar. Dat hoort in de definition of done.

**Bij de overstap naar een managed service:** alleen `haalNieuwsteBackup()` in
`scripts/backup-controle.js` hoeft vervangen te worden. Die functie beantwoordt één vraag:
"geef mij de nieuwste backup als iets waar `pg_restore --list` op werkt." Nu is dat een bestand
in een map; straks een API-aanroep bij de provider. De verwachtingslijst, de vergelijking, de
demping en het bericht blijven ongewijzigd.

Laag A (draait hij?) kan dan vervallen — een managed service bewaakt zichzelf. Laag B en C
blijven: geen enkele provider garandeert dat er in je backup staat wát jij denkt.

---

## Bekende beperking

**De controle draait op dezelfde machine als de backup.** Staat de laptop uit, dan draait geen
van beide en komt er geen melding. Dat is hetzelfde gat als Issue #58.

Het wekelijkse levensteken is de enige afdekking: blijft dat uit, dan weet je dat er iets niet
draait. Volledig oplossen vraagt een controle búiten deze machine — werk dat bij de managed
service hoort, niet ervoor.
