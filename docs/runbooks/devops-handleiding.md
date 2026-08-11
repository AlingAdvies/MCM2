# DevOps-handleiding — MCM2

**Type:** D — routineoperaties
**Eigenaar:** de eigenaar (Chris)
**Laatste update:** 2026-08-11
**Vereiste toegang:** GitHub (AlingAdvies/MCM2), Tailscale (saxombp), Supabase

Dit document is geschreven vanuit **wat je wilt doen**, niet vanuit hoe het
werkt. Zoek je de techniek erachter, dan staat onder elk stuk een verwijzing.

De rest van de runbooks is naslag; dit is het startpunt.

---

## 1. Waar draait wat

| Omgeving | Waarvoor | Applicatie | Database |
|---|---|---|---|
| **lokaal** | ontwikkelen | je laptop | wegwerpcontainer die je zelf opzet |
| **acceptatie** | uitproberen, inloggen | saxombp `:5011` / `:3010` | container op saxombp |
| **staging** | repetitie vóór productie | saxombp `:5031` / `:3030` | Supabase `clm-staging3` |
| **productie** | echte klanten | saxombp `:5021` | Supabase `clm-enterprise` |

**Waarom staging bij Supabase staat en niet op saxombp:** productie draait
Postgres bij AWS in Ierland achter een connection pooler. Een repetitie in een
lokale container bewijst het verkeerde — de pooler is precies de plek waar het
anders gaat.

> **Let op — twee dingen heten "productie".** Op saxombp draait `mcm2-productie`
> op poort 5021 met een *eigen lokale* database. Dat is procesbewijs, niet de
> echte productie. De echte klantgegevens staan bij Supabase. Dat verschil wordt
> opgeheven in stap 6 van het OTAP-plan.

---

## 2. Het belangrijkste dat je moet weten

**Je laptop wijst standaard naar STAGING.** Sinds 2026-08-11.

Typ je een databasecommando zonder er zelf een adres bij te geven, dan komt het
op de oefendatabase uit. Daar kan niets kapot.

**Wil je bij productie, dan moet je twee keer bewust kiezen:**

1. het adres meegeven (`NOOD_PRODUCTIE_URL` uit `.env`)
2. én `--extern` erbij typen

Doe je maar één van beide, dan stopt het commando met een melding die zegt wat
er aan de hand is.

**Waarom dit telt:** vóór 11 augustus wees je laptop naar productie. Elk
commando raakte dus de echte klantgegevens — niet omdat je dat koos, maar omdat
het de standaard was. Dat is de oorzaak onder de drie incidenten van 4, 7 en 10
augustus.

> Naslag: `.env.example`, en §3.5 van
> [`plan-otap-straat-met-staging.md`](../architectuur/plan-otap-straat-met-staging.md)

---

## 3. "Ik heb iets veranderd en wil het uitrollen"

### Stap 1 — Zorg dat het klopt

```powershell
npm run verify:volledig
```

Dit is **het** bewijs: zeven stappen, van opmaakcontrole tot een browser die
een leverancier aanmaakt en terugziet. Duurt een paar minuten.

> Losse commando's als `npm test` bewijzen niets over het geheel. Gebruik nooit
> `npm run lint` of `npm run format` om "groen" vast te stellen — die
> *wijzigen* bestanden. CI draait `lint:check` en `format:check`.

### Stap 2 — Branch, commit, pull request

Nooit rechtstreeks op `main` werken.

```powershell
git checkout -b feat/waar-het-over-gaat
# ... wijzigen ...
git add -A
git commit -m "feat(scope): wat er verandert"
git push -u origin feat/waar-het-over-gaat
```

Daarna een pull request openen op GitHub, en wachten tot de drie controles
groen zijn.

### Stap 3 — Mergen

Als de PR groen is: **Merge**, en verwijder de branch.

Wat er dan vanzelf gebeurt:

```
merge op main
  → CI: opmaak, tests, build
  → image naar GHCR (met een SHA-tag)
  → migraties naar staging
  → teruglezen of ze er echt staan
```

### Stap 4 — Staging bijwerken (één commando)

CI zet de migraties klaar, maar start de applicatie niet. Dat doe jij:

```powershell
npm run deploy:staging -- --versie sha-<twaalf tekens>
```

De juiste tag staat in de samenvatting van de CI-run.

> **De tag is twaalf tekens.** `sha-ffd27dc9` bestaat niet, `sha-ffd27dc9472f`
> wel. Dat ging twee keer mis; beide keren hield de rem het tegen met
> *"Er is niets gewijzigd"*.

### Stap 5 — Naar productie

Zie hoofdstuk 4 hieronder. Dat is een apart verhaal, met remmen.

> Naslag: [`uitrol-acceptatie-en-productie.md`](uitrol-acceptatie-en-productie.md)

---

## 4. "Ik wil naar productie"

### Vooraf: is de backup bij?

De uitrol weigert als de backupcontrole ouder is dan 36 uur.

Meestal hoef je niets te doen — de geplande taken draaien elke ochtend om 07:00
en 07:30. **Maar je moet het bewijs wél committen:**

```powershell
git add docs/runbooks/backup-bewijs.json
git commit -m "chore(backup): bewijs van vandaag"
git push
```

Controleren of alles klaarstaat:

```powershell
npm run productie:poort
```

### De uitrol starten

1. GitHub → tabblad **Actions**
2. Links: **Uitrol naar productie**
3. Knop **Run workflow**
4. Invullen:

| Veld | Wat |
|---|---|
| `versie` | de backend-tag, bijv. `sha-e8e462d6eec8`. Leeg = laatste van main |
| `frontend_versie` | de frontend-tag. Leeg = `latest` |
| `reden` | **verplicht** — waarom rol je uit? |

### Wat er dan gebeurt

```
→ poort: backup vers? staging op stand? productie niet vóór?
→ JOUW AKKOORD                              ← de run staat stil
→ poort opnieuw (er kan tijd overheen zijn)
→ migraties + teruglezen + rechtencontrole
────────────────────────────────────────────
→ npm run deploy:productie -- --versie …    ← jij, met de hand
```

Bij het akkoord: gele balk bovenaan de runpagina → **Review deployments** →
`productie` aanvinken → **Approve and deploy**.

Onderaan de runpagina verschijnt de samenvatting, mét het startcommando en de
weg terug.

### De vier remmen

| Rem | Wat hem tegenhoudt |
|---|---|
| Backup vooraf | geen bewijs, ouder dan 36 uur, of de controle meldde problemen |
| Staging beproefd | staging staat niet op de stand van de repository |
| Productie niet vóór | productie telt méér migraties dan de repository |
| Jouw akkoord | jij drukt niet |

**Blokkeert er een? Dan is er niets stuk.** De melding zegt erbij wat eraan
schort.

---

## 5. "Er is iets misgegaan, ik wil terug"

Terugdraaien is **geen apart commando**. Het is dezelfde uitrol met de vorige
tag:

```powershell
npm run deploy:status                                   # wat draait er nu?
npm run deploy:productie -- --versie sha-<vorige> --frontend-versie sha-<vorige>
```

Die regel hoef je niet zelf te bedenken — elke geslaagde uitrol drukt hem af:

```
  vorige versie was sha-5428bb954884 met frontend sha-635ff21150bd
  terugdraaien:  npm run deploy:acceptatie -- --versie sha-5428bb954884 --frontend-versie sha-635ff21150bd
```

> **Er is géén `npm run rollback:…`.** Dat commando bestaat niet en heeft nooit
> bestaan.

**Let op bij migraties.** Terugdraaien zet de *applicatie* terug, niet het
*databaseschema*. Dat gaat goed zolang migraties alleen toevoegen (kolommen
erbij). Is er iets verwijderd, dan is de backup terugzetten de weg — niet de
rollback.

> Naslag: [`uitrol-acceptatie-en-productie.md`](uitrol-acceptatie-en-productie.md),
> hoofdstuk "Terugdraaien"

---

## 6. "Ik wil weten hoe het ervoor staat"

```powershell
npm run deploy:status        # welke versie draait waar, en antwoordt het?
npm run productie:poort      # zijn de remmen groen?
npm run backup:controle      # is de backup er, en zit alles erin?
```

`deploy:status` is de nuttigste: hij toont per omgeving de containers, de
image-tag, én of de applicatie antwoordt. Dat laatste is het punt — een
draaiende container is geen werkende app.

---

## 7. Terugkerende taken

### Draait vanzelf

| Wanneer | Wat | Jouw rol |
|---|---|---|
| dagelijks 07:00 | backup van productie | niets |
| dagelijks 07:30 | backupcontrole (laag A + B) | de melding lezen |
| maandag 07:45 | backupcontrole volledig (+ echte restore) | de melding lezen |
| elke merge op main | tests, image, migraties naar staging | niets |

**Draait Docker Desktop niet, dan falen ze allemaal.** Dat is de meest
voorkomende storing: elke herstart zonder handmatige start levert een dag zonder
backup op.

Een gemiste dag inhalen:

```powershell
& "C:\DEV\Work\MCM2\scripts\backup-taak.cmd"   # niet: npm run backup:dump
npm run backup:controle
```

> Gebruik het `.cmd`. `BACKUP_DIR` staat alleen daarin; los gedraaid schrijft
> het npm-script naar de projectmap en ziet de controle de dump niet.

### Moet je zelf doen

| Ritme | Wat |
|---|---|
| wekelijks | levensteken opgemerkt? Blijft het uit, dan is de melder zelf stuk |
| wekelijks | staging wakker houden — een gratis Supabase-project pauzeert na 7 dagen |
| maandelijks | restore-hertest met verificatie van de inhoud |
| maandelijks | `npm audit` nalopen |
| per kwartaal | rollback beproeven op acceptatie |
| vóór productie-uitrol | `backup-bewijs.json` committen |

> Naslag: [`onderhoudskalender.md`](onderhoudskalender.md)

---

## 8. Als het misgaat

### "GESTOPT — deze database is beschermd"

De rem doet zijn werk: je commando kwam bij productie uit. Lees de regel
erboven — daar staat de host en de database.

Was dat niet de bedoeling? Dan is er een variabele overschreven in je terminal.
Sluit hem en begin opnieuw.

Was het wél de bedoeling? Zet `--extern` erachter.

### "Kon image … niet ophalen"

De tag bestaat niet. Kijk ze op:

```powershell
ssh root@saxombp "docker images | grep mcm2/api"
```

Meestal is het de lengte: twaalf tekens, niet acht.

### "De server is niet bereikbaar"

saxombp staat thuis achter Tailscale. Controleer:

```powershell
tailscale status | Select-String saxombp
```

### De workflow blokkeert op de backup

```powershell
npm run productie:poort
```

Die zegt precies welke van de drie remmen afgaat, en wat eraan schort.

### Iets anders

```powershell
npm run deploy:status
```

Toont of de omgevingen antwoorden. Doet er één dat niet, kijk dan op de server:

```powershell
ssh root@saxombp "docker ps -a | grep mcm2"
```

> Naslag: [`uitrol-acceptatie-en-productie.md`](uitrol-acceptatie-en-productie.md),
> hoofdstuk "Bij afwijking"

---

## 9. Wat je nooit doet

| Nooit | Waarom |
|---|---|
| `.env` committen | staat vol wachtwoorden. Staat in `.gitignore`; laat dat zo |
| Rechtstreeks op `main` werken | elke wijziging via een branch en een PR |
| `--no-verify` bij een commit | dan slaan de controles over die je juist beschermen |
| Force-pushen naar `main` | onherstelbaar voor iedereen |
| De demo-database markeren als wegwerp | poort 55450. De e2e-tests wissen hem dan leeg — gebeurd op 7 augustus |
| Een commando verzinnen | staat het niet in `package.json`, dan bestaat het niet |

Alle commando's opvragen:

```powershell
(Get-Content package.json | ConvertFrom-Json).scripts
```

---

## 10. Waar de rest staat

| Zoek je | Kijk in |
|---|---|
| welk commando bestaat en waar het heen praat | [`commandos-en-omgeving.md`](commandos-en-omgeving.md) |
| uitrollen, terugdraaien, inloggen op een omgeving | [`uitrol-acceptatie-en-productie.md`](uitrol-acceptatie-en-productie.md) |
| backups: hoe ze werken, wat te doen bij een melding | [`backupcontrole.md`](backupcontrole.md) |
| wat er wanneer terugkeert | [`onderhoudskalender.md`](onderhoudskalender.md) |
| zelf iets testen zonder de hele doorloop | [`zelf-testen.md`](zelf-testen.md) |
| waar het project nu staat | [`../STATUS.md`](../STATUS.md) |
| waarom de straat zo is opgezet | [`../architectuur/plan-otap-straat-met-staging.md`](../architectuur/plan-otap-straat-met-staging.md) |

**Alle runbooks:** [`README.md`](README.md)
