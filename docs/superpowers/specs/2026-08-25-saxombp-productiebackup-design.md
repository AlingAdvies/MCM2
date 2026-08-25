# Ontwerp — onafhankelijke productiebackup op saxombp

**Datum:** 2026-08-25
**Status:** ONTWERP — goedgekeurd door de eigenaar, klaar voor implementatieplan
**Aanleiding:** issue #58 — de dagelijkse databasebackup hangt af van de ontwikkellaptop.
Zonder de laptop draait er geen backup, en Supabase Free-projecten pauzeren bovendien na ~7
dagen inactiviteit.
**Raakt:** `scripts/backup-dump.js` (bestaand, blijft ongewijzigd), `scripts/backup-controle.js`
(wordt uitgebreid), `docs/adr/ADR-011-backup-en-hersteleisen.md` (vult "overwogen alternatief:
database op eigen server" verder in — niet als database, wel als tweede backuplocatie, zoals
dat ADR zelf al voorzag), `docs/runbooks/backupcontrole.md`.

---

## 0. Waar dit over gaat, in één alinea

Vandaag draait de productiebackup als Windows-taak op de ontwikkellaptop en schrijft naar
OneDrive. Staat de laptop een week uit, dan is er een week geen backup. Dit ontwerp voegt een
**tweede, volledig onafhankelijke backup toe die op `saxombp` zelf draait** — een altijd-aan
Linux-machine, bereikbaar via Tailscale, die rechtstreeks bij Supabase een `pg_dump` van de
productiedatabase haalt. Geen tussenkomst van de laptop, geen mens die op een moment moet
klikken.

Na een bewezen proefperiode vervangt dit de laptop-productiebackup — zie §7.

## 1. Scope: alleen productie

Dit ontwerp dekt uitsluitend de **productiedatabase**. Acceptatie draait al lokaal op
saxombp zelf (`127.0.0.1:55460`) en heeft geen externe backup nodig in deze scope. Staging is
bewust wegwerp-gemarkeerd en blijft hier buiten beschouwing. Besluit eigenaar, 25-08.

## 2. Het obstakel dat dit ontwerp oplost: SSH-herauthenticatie

Een eerdere aanpak (laptop kopieert de dump via SSH naar saxombp) bleek niet haalbaar zonder
een dagelijkse, handmatige klik: Tailscale SSH vraagt periodiek (default elke 12 uur, zie
Tailscale-documentatie over `checkPeriod` in de ACL) om een browser-herauthenticatie vóór een
SSH-sessie tot stand komt. Een onbewaakte, ongeplande taak kan die vraag niet zelf beantwoorden.

**Correctie op een eerdere aanname in dit project:** "Disable key expiry" (een per-node
instelling in de Tailscale-adminconsole) lost dit niet op. Dat gaat over de *node key* (de
Tailscale-netwerkverbinding zelf, geldig tot een vaste datum); de SSH-herauthenticatie is een
volledig gescheiden mechanisme (gebruikersidentiteit vlak vóór een SSH-sessie). Beide bestonden
al los van elkaar; ze zijn nooit gekoppeld geweest.

**De oplossing in dit ontwerp:** het obstakel wordt niet opgelost maar **vermeden**. Door de
dump op saxombp zelf te laten draaien in plaats van de dump via SSH naar saxombp te sturen, is
er helemaal geen SSH-verbinding meer nodig voor de dagelijkse taak. SSH blijft alleen nodig voor
incidenteel, interactief beheer (zoals nu al het geval is via `verify-omgevingen.js`) — dat
blijft onderhevig aan de periodieke herauth, wat voor een handeling waarbij een mens aanwezig is
geen probleem is.

Saxombp niet taggen blijft een staand besluit van de eigenaar (zie projectgeheugen
`mcm2-saxombp-niet-taggen`) — dit ontwerp raakt dat besluit niet en stelt geen tagging voor.

## 3. Architectuur

```
Supabase (productie)
        │  pg_dump, rechtstreeks
        ▼
   saxombp (cron, 06:00 dagelijks)
        │
        ▼
/opt/mcm2-backup/dumps/  (14 dagen bewaard)
```

Volledig los van de bestaande laptop→OneDrive-keten, die tijdens de proefperiode (§7)
ongewijzigd blijft draaien.

## 4. Credential-opzet

**Besluit eigenaar, 25-08:** een los `.env`-bestand op saxombp
(`/opt/mcm2-backup/.env`), bestandsrechten `600`, alleen leesbaar door `root`. Bevat
`BACKUP_DATABASE_URL` met dezelfde waarde als de huidige `BACKUP_DATABASE_URL` in de lokale
`.env` van de eigenaar (productie, `postgres`-rol met BYPASSRLS — zie §5 voor waarom die rol
nodig is). Geen apart, beperkter dump-account in Supabase in deze eerste versie — dat is een
mogelijke latere verharding, geen blokkade nu.

**Dit is de eerste keer dat het productiewachtwoord permanent buiten de laptop en GitHub
Secrets komt te staan.** Dat is bewust en expliciet besloten, niet stilzwijgend meegenomen.
De eigenaar heeft gevraagd dit bestand namens hem neer te zetten via de bestaande, werkende
root-SSH-verbinding — dat gebeurt als losse, uitvoerende stap bij de implementatie, niet als
onderdeel van een gecommit bestand (het wachtwoord zelf komt nooit in git).

## 5. Het script: `scripts/saxombp-backup-productie.sh`

Gecommit in de repo (net als `backup-taak.cmd`), daarna handmatig naar saxombp gekopieerd. Geen
automatische deploy-pipeline naar saxombp voor dit bestand — het wijzigt zelden en een aparte
pipeline zou hier meer complexiteit toevoegen dan het oplevert.

**Vorm, parallel aan het bestaande `scripts/backup-dump.js`:**

1. Leest `BACKUP_DATABASE_URL` uit `/opt/mcm2-backup/.env`.
2. `docker run --rm postgres:17.6 ... pg_dump ... --format=custom --no-owner --no-privileges
   --schema=clm --schema=ref --schema=audit` — exact dezelfde image, schema's en vlaggen als
   `backup-dump.js`, zodat de inhoud op dezelfde manier gevalideerd kan worden door de
   bestaande verwachtingslijst (`docs/runbooks/backup-verwachting.json`).
3. Bestandsnaam: `mcm2-productie-<datum-tijd>.dump`.
4. Waarschuwing in het logbestand als de vorige dump ouder dan 36 uur is — zelfde signaal als
   `backup-dump.js`.
5. Dumps ouder dan 14 dagen verwijderen (besluit eigenaar, 25-08 — zelfde termijn als de
   bestaande laptop-backup).
6. Logregel bij start, einde en uitkomst (geslaagd/mislukt), naar
   `/opt/mcm2-backup/backup.log`.

**Waarom de `postgres`-rol (BYPASSRLS) nodig is:** sinds migratie 0011 staat `FORCE ROW LEVEL
SECURITY` op alle tabellen. Een rol zonder BYPASSRLS leest via `pg_dump` nul rijen of krijgt een
harde fout — exact hetzelfde probleem dat `backup-dump.js` al documenteert. Dezelfde
afweging geldt hier onverkort.

**Wat het script bewust niet doet:** geen Telegram-melding vanuit het script zelf. Die laag
blijft bij `backup-controle.js` (§6) — een enkel controlepunt in plaats van twee plekken die
onafhankelijk van elkaar naar Telegram kunnen schrijven.

## 6. Uitbreiding van de bestaande Telegram-controle

`scripts/backup-controle.js` (draait vanaf de laptop, ongewijzigd tijdstip 07:30) krijgt een
tweede, aparte controle naast de bestaande OneDrive-check:

- Leest de saxombp-dumpmap via SSH: `ssh root@saxombp "ls -la /opt/mcm2-backup/dumps/"` —
  dezelfde SSH-vorm die `scripts/verify-omgevingen.js` al gebruikt (`BatchMode=yes`,
  `ConnectTimeout=15`). Dit is een incidentele, door een mens gestarte controle (de eigenaar
  draait `npm run backup:controle` of de geplande laptoptaak doet dat namens hem), dus de
  periodieke SSH-herauthenticatie is hier geen obstakel — mocht die ooit opnieuw nodig zijn,
  dan valt dat op via een duidelijke foutmelding, niet via stilzwijgend uitblijven.
- Als saxombp niet bereikbaar is (Tailscale uit, machine down, SSH-time-out): een **apart,
  herkenbaar signaal** ("saxombp niet bereikbaar"), nooit hetzelfde bericht als "geen dump
  gevonden" — dat onderscheid voorkomt het soort verwarrende melding dat het bestaande runbook
  al eerder repareerde voor de Docker-uit-situatie (zie `backupcontrole.md`, "Als Docker niet
  draait").

**Besluit eigenaar, 25-08: één samengevoegd Telegram-bericht**, niet twee losse. Het dagelijkse
bericht toont de status van beide backups in één overzicht, bijvoorbeeld:

```
✅ MCM2 backup — 25-08, 07:30
OneDrive: OK (3 uur oud)
saxombp:  OK (1 uur oud)
```

of bij een probleem op één van de twee:

```
🔴 MCM2 backup — 25-08, 07:30
OneDrive: OK (3 uur oud)
saxombp:  PROBLEEM — niet bereikbaar
```

Dezelfde dempingslogica als vandaag (één melding direct, een herhaling na 48 uur bij
aanhoudend probleem, daarna stilte tot opgelost) geldt voor het samengevoegde bericht als
geheel — niet per sub-locatie, om te voorkomen dat twee onafhankelijke dempingstellers
verwarrend door elkaar heen gaan melden.

## 7. Uitfasering van de laptop-productiebackup

**Besluit eigenaar, 25-08:** zodra saxombp dit zelfstandig en betrouwbaar doet, is de
laptop-taak voor productie overbodig — de laptop dumpt vandaag namelijk uitsluitend productie
(`BACKUP_DATABASE_URL` in de huidige `.env` wijst al naar productie, niet naar acceptatie of
staging).

**Niet direct uitzetten.** Een proefperiode van 1-2 weken waarin beide backups naast elkaar
draaien, zichtbaar via het samengevoegde Telegram-bericht uit §6.

**Concreet criterium om de laptoptaak `MCM2 databasebackup` uit te zetten**, beide vereist:

1. Minimaal 7 opeenvolgende geslaagde saxombp-dumps (dekt een normale werkweek plus een
   weekend — het moment waarop een stille storing het meest waarschijnlijk onopgemerkt blijft).
2. Minstens één geslaagde restore-test vanaf een saxombp-dump: teruggezet en geverifieerd met
   `scripts/verify-schema.js` plus de volledige e2e-suite, dezelfde route als ADR-011 al eist
   voor de bestaande laptop-dump.

Zolang niet aan beide is voldaan, blijft de laptoptaak actief. Het uitzetten zelf is een
handeling van de eigenaar in Taakplanner, geen geautomatiseerde stap in dit ontwerp.

## 8. Wat dit ontwerp bewust niet doet

- **Geen wijziging aan de bestaande laptop→OneDrive-backup** tijdens de proefperiode — die
  blijft ongewijzigd draaien tot §7's criterium gehaald is.
- **Geen backup van acceptatie of staging** vanaf saxombp — buiten scope, zie §1.
- **Geen apart, beperkter Supabase-dumpaccount** in deze eerste versie — zie §4, mogelijke
  latere verharding.
- **Geen automatische deploy-pipeline** die het script naar saxombp synchroniseert bij elke
  wijziging — handmatig kopiëren volstaat voor iets dat zelden verandert.
- **Geen wijziging aan hoe restore-tests werken** — die procedure (`docs/runbooks/
  supabase-verificatie-en-restoretest.md`) blijft ongewijzigd; dit ontwerp levert alleen een
  extra bronbestand op om vandaan te herstellen.

## 9. Relatie tot ADR-011

ADR-011 (§"Overwogen alternatief: database op eigen server") wees saxombp expliciet af als
**databaseserver** voor de pilot, maar noemde als bewust ingezet alternatief: *"Tweede
opslaglocatie voor de dagelijkse dumps [...] Concreet: BACKUP_DIR naar een map op die server,
of de dump er na afloop naartoe kopiëren."* Dit ontwerp voert exact dat scenario uit, met één
verfijning ten opzichte van de oorspronkelijke tekst: niet de laptop kopieert de dump ernaartoe
(dat obstakel is #2 hierboven), maar saxombp maakt de dump zelf, rechtstreeks bij de bron.
