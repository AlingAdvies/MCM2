# Runbook — backupcontrole en Telegram-melding

**Type:** D — routineoperaties
**Eigenaar:** de eigenaar (Chris)
**Laatste update:** 2026-08-10
**Vereiste toegang:** deze PC, Docker Desktop, een Telegram-account
**Ritme:** zie [onderhoudskalender.md](onderhoudskalender.md) §1

> **Status: ingericht en werkend op 2026-08-04.** Beide taken staan in Taakplanner en zijn
> aantoonbaar via Taakplanner gedraaid (niet alleen handmatig). Het testbericht is in Telegram
> aangekomen. De stappen hieronder zijn de herhaalbare procedure — voor een nieuwe machine,
> na een herinstallatie, of om te controleren of het nog klopt.

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

Laag B en C hebben allebei Docker nodig. Staat Docker uit, dan worden ze **overgeslagen**
met één eigen melding — zie "Docker draait niet" hieronder. Laag A werkt zonder Docker en
blijft dus altijd doorlopen.

Laag B vergelijkt de dump met `docs/runbooks/backup-verwachting.json` — een handgeschreven
lijst van wat erin hoort. Die lijst wordt bewust **niet** uit de migraties afgeleid: dan zou
de controle zichzelf verifiëren, en precies dat maakte de fout van 4 augustus onzichtbaar.

---

## Stap 1 — Credentials overnemen uit de Saxo-app

**Besluit eigenaar 2026-08-04: gebruik de bestaande Telegram-bot van de Saxo-app.** Geen aparte
MCM2-bot aanmaken — dit gaat uiteindelijk naar Slack, dus een tweede bot is moeite voor iets
dat toch vervangen wordt.

**Gevolg:** MCM2-meldingen komen in hetzelfde gesprek als de Saxo-meldingen. De berichten
beginnen met "MCM2 backup", dus verwarring is er niet. Zodra iemand anders moet meekijken, is
dat het moment voor Slack — niet voor een tweede Telegram-bot.

**Actie:** haal de twee waarden op uit de `.env` van de Saxo-app. Die staat **op de server**,
niet op deze PC:

```
~/saxo/.env
```

De lokale kopie in `C:\DEV\prive\Saxo\.env` bevat alleen de Saxo-API-sleutels, niet de
Telegram-regels.

Zet ze daarna in `C:\DEV\Work\MCM2\.env`:

```
TELEGRAM_BOT_TOKEN=<zelfde waarde als in ~/saxo/.env>
TELEGRAM_CHAT_ID=<idem>
```

**Let op:** `.env` staat in `.gitignore` en hoort daar te blijven. Committeer deze waarden
nooit.

**Verwacht resultaat:** twee regels in `.env`.

<details>
<summary>Als je later alsnog een eigen bot wilt (vijf minuten)</summary>

1. Open Telegram, zoek **@BotFather**, stuur `/newbot`.
2. Kies een naam en een gebruikersnaam eindigend op `bot`.
3. BotFather geeft een token terug.
4. Start een gesprek met je nieuwe bot en stuur hem één bericht — anders mag hij jou niet
   aanschrijven.
5. Zoek **@userinfobot** en stuur `/start` voor je chat-id.

</details>

---

## Stap 2 — De melding testen

**Actie:**

```powershell
npm run backup:controle:test
```

**Verwacht resultaat:** `OK — testbericht verstuurd`, en een bericht in Telegram:
*"🔔 Testbericht van de MCM2-backupcontrole..."*

**Bij afwijking:**
- *"TELEGRAM_BOT_TOKEN en/of TELEGRAM_CHAT_ID ontbreken"* → stap 1 niet gelukt.
- *"Telegram-bericht mislukt: 401"* → het token klopt niet; controleer of je het volledig hebt
  overgenomen uit `~/saxo/.env` (er zit een dubbele punt in, die hoort erbij).
- *"Telegram-bericht mislukt: 400"* → de chat-id klopt niet.

**Dit is geen optionele stap.** Zonder deze test weet je pas of de melding werkt op het moment
dat je hem het hardst nodig hebt.

---

## Stap 3 — De controle handmatig draaien

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

## Stap 4 — De taken inplannen

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

### Aanmaken via PowerShell

Zoals gebruikt op 2026-08-04:

```powershell
# Dagelijkse controle
$actie = New-ScheduledTaskAction -Execute "C:\DEV\Work\MCM2\scripts\backup-controle-taak.cmd" -WorkingDirectory "C:\DEV\Work\MCM2"
$trigger = New-ScheduledTaskTrigger -Daily -At "07:30"
$principal = New-ScheduledTaskPrincipal -UserId "cmali" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName "MCM2 backupcontrole" -Action $actie -Trigger $trigger -Principal $principal -Settings $settings

# Wekelijkse herstelproef: idem, met -Argument "--volledig",
# -Weekly -DaysOfWeek Monday -At "07:45" en 30 minuten tijdslimiet.
```

**`-StartWhenAvailable` is niet optioneel.** Zonder dat wordt een gemiste run (laptop uit om
07:30) stilzwijgend overgeslagen in plaats van ingehaald — precies de faalvorm die dit runbook
moet voorkomen.

**`-AllowStartIfOnBatteries` bewust anders dan bij de backuptaak.** Die staat op
`DisallowStartIfOnBatteries = True`; een dump maken op accu is te zwaar. Een controle is dat
niet, en op accu draaien is juist het moment waarop je wilt weten of er iets mis is.

> Let op: de parameter heet `-AllowStartIfOnBatteries`, niet `-DisallowStartIfOnBatteries:$false`.
> Die tweede vorm bestaat niet en geeft een foutmelding.

### Verificatie na het inplannen

**Niet alleen de exitcode controleren.** `LastTaskResult = 0` betekent dat `cmd.exe` kon
starten, niet dat de controle iets deed — dat is de valkuil uit §"Waarom via een `.cmd`".
Kijk altijd in het log:

```powershell
Get-ScheduledTaskInfo -TaskName "MCM2 backupcontrole"
Get-Content "$env:USERPROFILE\OneDrive - Aling Advies\MCM2-backups\backup-controle.log" -Tail 20
```

**Verwacht in het log** (stand 2026-08-04, zolang Issue #25 open staat):

```
===== di 04-08-2026 11:15:43 - start
2026-08-04T09:15:45.455Z — 1 probleem(en)
  Laatste dump: mcm2-2026-08-04_05-38-43.dump (3 uur oud)
  PROBLEEM: De dump mist 9 van de 18 tabellen:
===== di 04-08-2026 11:15:45 - PROBLEEM GEMELD, code 1
```

`PROBLEEM GEMELD, code 1` is hier een geldige uitkomst: de controle werkte en heeft gemeld.
Het `.cmd` geeft zelf altijd exitcode 0 terug, zodat Taakplanner de taak niet als kapot
markeert terwijl hij juist deed wat hij moest doen.

**Een andere code dan 0 of 1 hoort er niet te staan.** Zie je bijvoorbeeld
`code -1073740791` met daarboven een regel `Assertion failed: !(handle->flags & ...)`, dan is
Node zelf gecrasht na het versturen. De meldingen zijn dan wél verstuurd — maar de controle
eindigde niet netjes. Dat is opgelost op 2026-08-06 (`process.exitCode` in plaats van
`process.exit()`); komt het terug, dan is er iets anders aan de hand.

---

## Wat je van de melding mag verwachten

**Bij een probleem:** één bericht meteen. Houdt het probleem aan, dan na 48 uur een tweede en
**laatste** bericht. Daarna stilte tot het is opgelost.

Dat is opzet: een probleem dat vijf dagen duurt moet niet vijf keer melden, want dan leer je
het bericht negeren — en dan is de melding net zo stil als het logbestand.

**Bij herstel:** `✅ Hersteld na 4d 2u: de dump is weer compleet`

**Als Docker niet draait:**

```
🔴 MCM2 backup — 06-08, 08:12

Docker draait niet, dus de inhoud van de backup is niet gecontroleerd.
Over de dump zelf is hiermee niets gezegd — niet goed en niet fout.
```

Dit is de waarschijnlijkste storing van allemaal: Docker Desktop start niet mee met Windows,
dus elke herstart zonder handmatige start levert een dag zonder backup op. Waarschijnlijk staat
er dan óók een `MISLUKT` in `backup-taak.log` — de dump heeft dezelfde container nodig.

**Oplossen:** start Docker Desktop (die staat in
`%LOCALAPPDATA%\Programs\DockerDesktop`, niet in Program Files), draai dan het
taakbestand — **niet** `npm run backup:dump`:

```powershell
& "C:\DEV\Work\MCM2\scripts\backup-taak.cmd"   # de gemiste dump alsnog maken
npm run backup:controle                         # en controleren
```

> **Waarom het `.cmd` en niet het npm-script.** `BACKUP_DIR` wordt gezet in
> `backup-taak.cmd`, niet in `package.json`. Draai je `npm run backup:dump` los,
> dan valt het script terug op zijn standaard — `backups/` in de projectmap. De
> dump slaagt, meldt "Geslaagd", en waarschuwt onderaan dat hij op dezelfde
> machine staat. Maar de controle kijkt in OneDrive en ziet hem niet, de
> retentie van 14 dagen raakt hem niet, en hij synchroniseert nergens heen.
>
> Op 2026-08-10 gebeurde dat: een dump van 121 kB in `backups/`, terwijl de
> controle nog steeds die van gisteren als nieuwste zag. `/backups` staat in
> `.gitignore`, dus zichtbaar werd het ook niet.
>
> Het `.cmd` zet `BACKUP_DIR`, schrijft naar OneDrive, logt in `backup-taak.log`
> en geeft de echte exitcode terug — precies wat de geplande taak doet.

> **Waarom dit een eigen melding heeft.** Tot 2026-08-06 meldde de controle in dit geval
> *"De inhoudsopgave is niet leesbaar. Dat wijst op een beschadigde of afgebroken dump."*
> Dat klopte niet: de dump was in orde, alleen Docker stond uit. Zo'n bericht is gevaarlijker
> dan geen bericht — het laat je schrikken voor iets anders dan er aan de hand is, en dat is
> precies hoe je leert meldingen te negeren.

**Als alles goed gaat:** één keer per week een levensteken met de stand van zaken. Dit is het
belangrijkste onderdeel van de hele opzet: zonder levensteken weet je bij uitblijvende
berichten niet of alles goed gaat of dat de melder zelf stuk is.

**Blijft het wekelijkse levensteken uit, dan is er iets mis** — met de controle, met Telegram,
of met de machine. Dat is het signaal om te gaan kijken.

---

## Onderhoud

**Bij elke migratie die een tabel toevoegt of hernoemt:** werk
`docs/runbooks/backup-verwachting.json` bij, inclusief de velden `migratiestand` en
`bijgewerkt`. Dat hoort in de definition of done.

> **Sinds 2026-08-10 wordt dit afgedwongen.** `npm run verify:onderhoud` faalt zodra
> de genoteerde migratiestand lager is dan de hoogste migratie in `drizzle/`, en die
> controle draait mee in `verify:volledig`.
>
> De aanleiding: op 2026-08-10 stond de lijst op `0013` terwijl productie op `0025`
> draaide. Vijf tabellen — `survey_review`, `template_reviewer`, `response_note`,
> `omgeving` en `platform_admin` — ontbraken. De dagelijkse controle meldde daardoor
> *"Compleet: 18 tabellen"*: waar tegen de lijst, onwaar over de database.
>
> De "onbekende tabel"-melding waar dit runbook op vertrouwde, slaat pas aan zodra de
> tabel ook werkelijk in een dump zit. Tussen de migratie en de eerste dump op de
> nieuwe stand zit dus een gat waarin de controle groen meldt over een incomplete
> backup. De poort sluit dat gat aan de andere kant: bij het schrijven van de migratie.

**Bij de overstap naar een managed service:** alleen `haalNieuwsteBackup()` in
`scripts/backup-controle.js` hoeft vervangen te worden. Die functie beantwoordt één vraag:
"geef mij de nieuwste backup als iets waar `pg_restore --list` op werkt." Nu is dat een bestand
in een map; straks een API-aanroep bij de provider. De verwachtingslijst, de vergelijking, de
demping en het bericht blijven ongewijzigd.

Laag A (draait hij?) kan dan vervallen — een managed service bewaakt zichzelf. Laag B en C
blijven: geen enkele provider garandeert dat er in je backup staat wát jij denkt.

**Bij de overstap naar Slack:** alleen `verstuur()` in `scripts/telegram.js` hoeft vervangen te
worden door een webhook-POST. De demping, de statusbestanden, het levensteken en de
berichtteksten blijven ongewijzigd — die logica is niet aan Telegram gebonden.

Eén ding verandert dan wél inhoudelijk: een Slack-kanaal heeft meerdere lezers, en dan wordt
"wie kijkt hiernaar" een echte vraag. Die staat open als Issue #48. Met één lezer is het
antwoord triviaal; met een team niet meer.

---

## De saxombp-laag (sinds 2026-08-25)

Naast de OneDrive-backup (hierboven) draait er een **volledig onafhankelijke** tweede
productiebackup, rechtstreeks op `saxombp` — geen laptop in de keten. Zie
`docs/superpowers/specs/2026-08-25-saxombp-productiebackup-design.md` voor het volledige
ontwerp.

**Wat er draait:**

| Waar | Wat | Wanneer |
|---|---|---|
| saxombp, cron | `/opt/mcm2-backup/saxombp-backup-productie.sh` | dagelijks 06:00 |
| Dump-locatie | `/opt/mcm2-backup/dumps/` op saxombp | 14 dagen bewaard |
| Controle | `scripts/backup-controle.js` (op de laptop, ongewijzigd tijdstip) | leest saxombp via SSH |

**Dit vervangt de laptop-productiebackup nog niet.** Zie "Wanneer de laptoptaak uit mag"
hieronder — dat is een bewust latere, handmatige stap, geen automatisme.

### Het samengevoegde Telegram-bericht

Sinds deze uitbreiding toont het dagelijkse Telegram-bericht de status van beide backups. Een
voorbeeld bij een geslaagde run:

```
✅ MCM2 backup — weekcheck 25-08, 07:30

Laatste dump: mcm2-2026-08-25_05-38-43.dump (3 uur oud)
Compleet: 27 tabellen
saxombp: 1 uur oud, 5 dump(s) bewaard
Bewaard: 12 dump(s)
```

Een probleem op saxombp meldt apart, met een eigen sleutel (`saxombp`) — dus onafhankelijk
gedempt van een eventueel probleem op de OneDrive-kant. `controleerSaxombp()` in
`scripts/backup-controle.js` onderscheidt vier soorten falen, in deze volgorde:

1. **"saxombp is niet bereikbaar via SSH."** — Tailscale staat uit, saxombp staat uit, of het
   netwerk hapert. Zegt niets over de dump zelf. Het bericht bevat de SSH-foutmelding en wijst
   naar Tailscale en de machine zelf.
2. **"Kon de dumpmap niet lezen op saxombp (…)."** — saxombp is wel bereikbaar, maar `ls` op de
   dumpmap zelf gaf een fout (bijvoorbeeld een rechtenprobleem). Bewust apart van "geen dump
   gevonden": een lees-fout stil interpreteren als "geen dumps" zou het verkeerde probleem
   melden.
3. **"Onverwachte bestandsnaam gevonden op saxombp (…)."** — er staat een bestand in de dumpmap
   dat niet aan het verwachte patroon voldoet
   (`mcm2-productie-JJJJ-MM-DDTUU-MM-SS.dump`). Dat bestand wordt niet verwerkt; de melding
   somt de onbekende naam/namen op en vraagt om handmatige controle. Dit is ook de reden dat er
   geen losse `grep` gebruikt wordt: een bestandsnaam die niet aan de whitelist voldoet komt
   nooit in een SSH-commando terecht.
4. **"Geen enkele productiedump gevonden op saxombp (…)"**, of **"De nieuwste productiedump op
   saxombp is X oud (…). De cron-taak op saxombp heeft kennelijk stilgelegen."** — saxombp is
   bereikbaar en de map is leesbaar, maar er staat geen (recente) dump. Dit wijst op de
   cron-taak op saxombp zelf, niet op bereikbaarheid.

### Wanneer de laptoptaak uit mag

**Niet automatisch, niet zomaar.** De bestaande Windows-taak `MCM2 databasebackup` blijft
draaien tot **beide** onderstaande punten aantoonbaar zijn:

1. Minimaal 7 opeenvolgende geslaagde saxombp-dumps (zichtbaar in het samengevoegde
   Telegram-bericht, of via `ssh root@saxombp "ls -la /opt/mcm2-backup/dumps/"`).
2. Minstens één geslaagde restore-test **vanaf een saxombp-dump** — dezelfde route als de
   bestaande restore-test in `docs/runbooks/supabase-verificatie-en-restoretest.md`, maar dan
   met een dumpbestand dat van saxombp is gehaald in plaats van uit OneDrive.

Zodra beide zijn aangetoond: zet de Windows-taak `MCM2 databasebackup` handmatig uit in
Taakplanner. Dat is een besluit en een handeling van de eigenaar — geen script in deze repo
doet dat automatisch.

---

## Bekende beperking

**De controle draait op dezelfde machine als de backup.** Staat de laptop uit, dan draait geen
van beide en komt er geen melding. Dat is hetzelfde gat als Issue #58.

Het wekelijkse levensteken is de enige afdekking: blijft dat uit, dan weet je dat er iets niet
draait. Volledig oplossen vraagt een controle búiten deze machine — werk dat bij de managed
service hoort, niet ervoor.
