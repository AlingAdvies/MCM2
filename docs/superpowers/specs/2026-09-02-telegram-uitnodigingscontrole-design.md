# Telegram-melding bij geaccepteerde tenant-uitnodiging — ontwerp

**Datum:** 2026-09-02
**Status:** ontwerp, nog niet gebouwd

## Probleem

Op het scherm `beheer/leden` (`TenantLedenService.lijst()`) is per lid te zien
of een uitnodiging nog open staat (`uitnodiging_open`) of is geaccepteerd
(`actief`). Er is geen melding wanneer die overgang plaatsvindt — de eigenaar
moet zelf het scherm openen om te zien of iemand is toegetreden.

De eigenaar wil dit weten voor de tenant **Transdev Nederland** op productie:
zodra een uitgenodigd lid voor het eerst inlogt (en daarmee `actief` wordt),
moet er een Telegram-bericht komen.

## Scope

- **Alleen tenant "Transdev Nederland"**, niet AlingAdvies en niet andere
  tenants.
- **Alleen productie** — daar accepteren echte gebruikers hun uitnodiging.
- Geen onderscheid naar wie de uitnodiging verstuurde: elke overgang naar
  `actief` binnen deze tenant telt.
- Mag een cyclus missen (bijv. laptop uit/in slaapstand) — geen inhaalslag,
  geen foutmelding bij het ontbreken van Telegram-configuratie.

## Aanpak

Een nieuwe, losse geplande taak op de laptop van de eigenaar, naar het
bestaande patroon van `scripts/backup-controle.js` +
`scripts/telegram.js` — geen wijziging aan de NestJS-backend, geen nieuwe
secret op `saxombp` of AWS.

**Waarom niet vanuit de server (afgewogen en verworpen):** de acceptatie
gebeurt in een `SECURITY DEFINER`-databasefunctie (`sessie_aanmaken()`),
niet in applicatiecode die makkelijk een neveneffect kan versturen. Een
melding vanaf de server zou het Telegram-token als nieuw secret naar zowel
`saxombp` (staging/acceptatie) als AWS ECS (productie) vragen, en een
wijziging in de auth-flow. De eigenaar heeft dit expliciet afgewezen ten
gunste van de laptop-aanpak: minder ingrijpend, hergebruikt bewezen code,
realtime is niet nodig.

## Nieuw script: `scripts/uitnodiging-controle.js`

Volgt de vorm van `scripts/backup-controle.js`.

1. Leest de productie-leesverbinding uit `.env`
   (`PRODUCTIE_RUNTIME_URL`, rol `clm_api_runtime` — niet `clm_migrator`,
   want die heeft BYPASSRLS en dit script hoeft dat niet; puur lezen via de
   normale RLS-rol is hier voldoende en veiliger).
2. Roept `meldDoelwit()` (uit `scripts/db-doelwit.js`) aan vóór de eerste
   query, zodat altijd zichtbaar is welke database geraakt wordt.
   **Geen** `eisOnbeschermdeDatabase()` — dat is een rem voor schrijvende
   scripts; dit script leest alleen en moet juist wél tegen de beschermde
   productiedatabase kunnen draaien, elke keer, zonder `--extern`.
3. Vindt de tenant via naam (`SELECT tenant_id FROM clm.tenant WHERE name =
   'Transdev Nederland'`) — geen hardcoded UUID, zodat een naamswijziging het
   script niet stilzwijgend laat falen.
4. Selecteert actieve leden van die tenant:
   ```sql
   SELECT u.user_id, u.full_name, u.email, m.role
     FROM clm.tenant_membership m
     JOIN clm."user" u ON u.user_id = m.user_id
    WHERE m.tenant_id = $1
      AND m.deleted_at IS NULL
      AND m.role <> 'support'
      AND u.uitnodiging_hash IS NULL
   ```
   (Zelfde statuslogica als `TenantLedenService.lijst()`: `uitnodiging_hash
   IS NULL` betekent geaccepteerd.)
5. Vergelijkt de opgehaalde `user_id`-verzameling met een lokaal bestand
   onder `~/.mcm2-uitnodigingscontrole/gezien.json` (lijst van user_id's die
   bij de vorige run al `actief` waren).
6. Voor elke `user_id` die nu voor het eerst in de lijst staat: stuurt één
   Telegram-bericht via `Telegram.verstuur()`
   (`scripts/telegram.js`, geen demping nodig — dit is geen aanhoudend
   probleem maar een eenmalig feit):
   ```
   ✅ Nieuw lid actief bij Transdev Nederland
   Jan Jansen (jan@bedrijf.nl) — rol: beheerder
   ```
7. Schrijft de bijgewerkte `user_id`-verzameling terug naar
   `gezien.json`.
8. Geen Telegram-configuratie in `.env` → `Telegram.verstuur()` is al een
   stille no-op (bestaand gedrag, ongewijzigd).
9. Geen `--extern`-vlag nodig: dit is een leesscript tegen een bewust
   gekozen productiedatabase, geen migratie en geen schrijfactie. De
   bestaande productie-remmen (`eisOnbeschermdeDatabase`) gelden voor
   schrijvende scripts en zijn hier niet van toepassing — wel blijft
   `meldDoelwit()` verplicht, zodat de uitvoer altijd toont welke database
   geraakt is.

## Foutafhandeling

- Database onbereikbaar (bijv. Supabase gepauzeerd na 7 dagen stilte,
  zie bestaande risico in STATUS.md): het script logt de fout en stopt
  zonder Telegram-bericht. Geen crash-melding naar Telegram — dat zou de
  ruis zijn die de eigenaar expliciet niet wil bij een offline laptop, en
  hoort niet thuis in dit script (dat risico wordt al elders bewaakt: de
  bestaande wekelijkse "wakker houden"-taak).
- Tenant "Transdev Nederland" niet gevonden: logt een duidelijke fout en
  stopt (`process.exitCode = 1`), zonder Telegram-bericht.
- Kapotte/onleesbare lokale statusfile: wordt behandeld als lege lijst
  (eerste run) — dat kan hooguit een gemiste melding voor een reeds oud
  lid opleveren bij het allereerste herstel, niet een crash.

## Taakplanner

Nieuwe, aparte Windows-taakplannertaak: **"MCM2 tenant-uitnodigingscontrole"**,
elk uur. Niet samengevoegd met de bestaande backup-taken (die draaien
dagelijks/wekelijks op een ander ritme). De eigenaar richt de taak zelf in
Taakplanner in — Claude levert het exacte commando en de aanbevolen
instellingen (Trigger: elk uur, Start In: projectmap, "Run whether user is
logged on or not" optioneel net als bij de bestaande taken).

## npm-script

`npm run uitnodiging:controle` → `node scripts/uitnodiging-controle.js`,
zodat het net als de andere scripts via `package.json` vindbaar is
(MCM2-CLAUDE.md §2: "verzin nooit een commando").

## Wat dit niet bouwt

- Geen melding voor AlingAdvies of andere tenants.
- Geen melding bij het versturen van een uitnodiging (dat gebeurt al via
  e-mail, `UitnodigingVerzender`).
- Geen inhaalslag bij een gemiste cyclus.
- Geen wijziging aan de backend, aan RLS, of aan het bestaande Leden-scherm.
- Geen nieuwe secret-uitrol naar `saxombp` of AWS.

## Testen

- Unit-achtige test voor de vergelijkingslogica (welke user_id's zijn nieuw
  ten opzichte van de vorige lijst), los van de database — zelfde stijl als
  andere scripts in dit project die met een echte database praten maar hun
  pure logica apart testbaar houden.
- Handmatige proef: tijdelijk een tweede testadres bij Transdev Nederland
  uitnodigen op productie, accepteren, en controleren dat het script het
  bericht stuurt — vóórdat de geplande taak wordt ingesteld.
