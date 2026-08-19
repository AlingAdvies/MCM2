# Runbook — uitrol naar acceptatie en productie

**Type:** A — deployment
**Eigenaar:** de eigenaar (Chris)
**Laatste update:** 2026-08-10
**Vereiste toegang:** Tailscale (voor `saxombp`), GitHub, deze repository
**Raakt:** Issue #12, #18, #51, ADR-012

> ⚠️ **VEROUDERD VOOR PRODUCTIE, sinds 2026-08-19.** Productie draait niet
> meer op `saxombp` — het staat nu op AWS ECS Express Mode (zie
> `docs/STATUS.md` en het projectgeheugen `mcm2-besluit-18-08-naar-aws`).
> Alles hieronder over `mcm2-productie`, poort 3020/5021,
> `ssh root@saxombp ... docker compose -p mcm2-productie`, en de
> `productie.yml`-workflow beschrijft de OUDE route en werkt niet meer voor
> productie-uitrol. **Acceptatie blijft ongewijzigd op saxombp** — die
> onderdelen van dit runbook kloppen nog. Dit bestand wordt herschreven
> zodra de AWS-migratie (frontend-service, custom domain, CI/CD-koppeling)
> volledig af is; tot dan: voor een productie-uitrol niet dit runbook
> volgen, eerst navragen hoe de ECS-deploy nu werkt.

---

## Waarvoor dit bestaat

Bewijzen dat het OTAP-proces werkt: dat hetzelfde artefact dat door de
kwaliteitspoorten kwam ook draait op acceptatie, en daarna ongewijzigd naar
productie gaat. Plus dat terugdraaien werkt — het onderdeel dat in de praktijk
het vaakst nooit beproefd is.

**Wat dit níét is: een productieomgeving met een SLA.** Het draait op één
machine bij de eigenaar thuis, aan thuisinternet, zonder redundantie. ADR-011
heeft dat al beoordeeld en afgewezen als drager van de *pilot*. Voor een
**procesbewijs** is het precies goed, en die twee dingen mogen niet door elkaar
lopen.

---

## De omgevingen

| | Waar | Frontend | Backend | Database |
|---|---|---|---|---|
| **O** ontwikkel | laptop | 3000 | 5001 | container 55450 |
| **T** test | laptop, tijdelijk | — | — | wegwerp 55441 |
| **A** acceptatie | `saxombp` | 3010 | 5011 | 55460 (127.0.0.1) |
| **S** staging | `saxombp` | 3030 | 5031 | **Supabase `clm-staging3`** |
| **P** productie | `saxombp` | 3020 | 5021 | **Supabase `clm-enterprise`** |

Bereikbaar via Tailscale. Acceptatie ook op
`https://saxombp.tail4b29b.ts.net`; niet vanaf internet — alleen vanaf je eigen
apparaten.

> **Staging én productie hebben geen eigen databasecontainer** — beide praten
> met Supabase. Alleen acceptatie heeft er nog een, en dat is opzet: die mag
> stuk.
>
> Dat staging bij Supabase staat, is de reden dat hij bestaat. Productie draait
> Postgres bij AWS in Ierland achter een connection pooler; een repetitie in een
> lokale container bewijst het verkeerde (§1 van het OTAP-plan). De pooler is
> precies waar het anders gaat — verbindingen die anders worden vastgehouden,
> andere timeouts, ander gedrag bij migraties die een tabel vergrendelen.
>
> **De migraties draaien vanuit een workflow**, niet vanaf een laptop:
> staging via de job `staging` in `.github/workflows/ci.yml`, productie via
> `.github/workflows/productie.yml`. Beide uitrolcommando's slaan die stap over
> en zeggen dat ook — je ziet `4/6 Migraties — overgeslagen` met de reden erbij.
>
> **Tot stap 6 (2026-08-12) had productie wél een eigen container**, op poort
> 55470. Die was leeg, terwijl de workflow naar Supabase migreerde: twee dingen
> die "productie" heetten. Zie STATUS.md voor wat daar precies misging.

**Op dezelfde server draait de Saxo-app** onder PM2, op poort 8080 en 8081.
Die is geen onderdeel van MCM2 en mag nooit geraakt worden. Zowel
`deploy-inrichten.js` als `deploy-status.js` controleren dat expliciet.

---

## De keten

```
PR → CI: format, lint, typecheck, unittests, Docker-build, RLS-isolatie
  → merge naar main
     → CI publiceert naar GHCR:  :sha-<commit>  én  :latest
        → npm run deploy:acceptatie
           → npm run deploy:productie   (hetzelfde image)
```

**Het image wordt nooit opnieuw gebouwd.** De server haalt op wat CI heeft
gepubliceerd. Zou hij zelf bouwen, dan is het per definitie een ander artefact —
andere basis-laag, andere npm-resolutie — en dan bewijst een groene acceptatie
niets over productie.

---

## Stap 1 — Eenmalig: de server inrichten

Alleen nodig op een nieuwe server, of na een herinstallatie.

```powershell
npm run deploy:inrichten -- --toon    # laat zien wat er zou gebeuren
npm run deploy:inrichten              # doet het
```

**Verwacht resultaat:** `/opt/mcm2/` met `docker-compose.omgeving.yml`,
`acceptatie.env` en `productie.env`. Map rechten 700, env-bestanden 600.

**Bij afwijking:**
- *"Docker ontbreekt"* → `apt-get install -y docker.io docker-compose-v2`
- *"Poort … is al in gebruik"* → het script noemt welke; kijk wat het is voordat
  je iets afsluit
- *"zou poort … claimen, en daar draait de Saxo-app"* → dit hoort niet te kunnen;
  de poortnummers in het script zijn dan gewijzigd

> **De databasewachtwoorden worden bij het inrichten gegenereerd en staan
> alléén op de server.** Draai je `deploy:inrichten` opnieuw, dan worden
> bestaande `.env`-bestanden **niet** overschreven — anders kan een draaiende
> omgeving niet meer bij zijn eigen data.

---

## Stap 2 — Uitrollen naar acceptatie

```powershell
npm run deploy:acceptatie                          # laatste main-image
npm run deploy:acceptatie -- --versie sha-abc123def456
```

### Staging: migraties gaan vanzelf, de applicatie niet

Na een merge op `main` draait CI de migraties tegen Supabase-staging en leest de
stand terug. Wat er **niet** vanzelf gaat, is de applicatie vervangen:

```powershell
npm run deploy:staging -- --versie sha-abc123def456
```

De samenvatting van elke CI-run drukt dat commando af met de juiste SHA erin, zodat
je hem niet hoeft samen te stellen.

> **Waarom dat handwerk blijft.** CI kan niet bij saxombp. De machine staat thuis
> achter een router; buiten Tailscale bestaat `saxombp.tail4b29b.ts.net` niet eens
> — een publieke DNS-server geeft "non-existent domain".
>
> De Tailscale-action lost dat op, maar loopt op een harde regel: *"devices with a
> tag-based identity can only SSH into other tagged devices."* Een CI-runner
> krijgt onvermijdelijk een label; saxombp heeft er geen. De enige oplossing is
> saxombp óók labelen, en dat **verwijdert de gebruiker als eigenaar** — met
> gevolgen voor de HTTPS-opzet die de inlog draagt.
>
> Besluit eigenaar 2026-08-11: niet doen. Het levert alleen op dat één commando
> vanzelf gaat, en juist dat commando verdwijnt bij een verhuizing naar AWS —
> daar duw je een image en haalt de dienst het zelf op.

**Verwacht resultaat:** zes stappen, alle groen, eindigend met
`UITGEROLD — acceptatie draait op <versie>`.

Wat er gebeurt, in deze volgorde:

| Stap | Wat | Waarom deze volgorde |
|---|---|---|
| 1 | Server bereikbaar en ingericht? | Faalt hier niets stuk |
| 2 | Bevestiging (alleen productie) | — |
| 3 | Image ophalen | Een tikfout in de versie faalt vóórdat er iets vervangen is |
| 4 | Migraties | Vóór de nieuwe code start: migraties zijn voorwaarts compatibel, dus oude code overleeft een nieuw schema — andersom niet |
| 5 | Containers vervangen | — |
| 6 | Rookproef | `docker compose up` slaagt zodra de container start, niet zodra de app werkt |

**De rookproef doet drie controles:**

1. `/health` geeft 200
2. de frontend serveert een pagina
3. een beheerroute geeft **401**, geen 500 — dat bewijst dat de guard draait
   én dat de app de database kon bereiken om dat vast te stellen

**Faalt de rookproef, dan draait het script automatisch terug** naar de vorige
versie en beproeft die opnieuw. Je krijgt dan `TERUGGEDRAAID naar <versie>`.

---

## Stap 3 — Promoveren naar productie

**Sinds 2026-08-11 (stap 4 van het OTAP-plan) loopt dit via GitHub, niet meer
rechtstreeks vanaf de laptop.** De migraties gaan achter vier remmen langs; het
starten van de applicatie blijft één commando met de hand.

### 3a. Vooraf: zorg dat de backup vers is

De poort weigert een uitrol als de backupcontrole ouder is dan 36 uur.

Meestal hoef je niets te doen: de geplande taken draaien dagelijks om 07:00 en
07:30, en de controle van 07:30 schrijft `docs/runbooks/backup-bewijs.json`.
**Wat je wél moet doen is dat bestand committen** — het is het enige wat een
CI-runner over jouw backup te weten kan komen.

Is de taak overgeslagen (Docker stond uit), haal hem dan in:

```powershell
& "C:\DEV\Work\MCM2\scripts\backup-taak.cmd"   # niet: npm run backup:dump
npm run backup:controle
```

> **Gebruik het `.cmd`, niet het npm-script.** `BACKUP_DIR` staat alleen in
> `backup-taak.cmd`. Los gedraaid schrijft `npm run backup:dump` naar `backups/`
> in de projectmap: de dump slaagt, de controle ziet hem niet, en de retentie
> raakt hem niet.

Je kunt de poort ook los draaien om te kijken of alles klaarstaat:

```powershell
npm run productie:poort
```

### 3b. De uitrol starten

Actions → **Uitrol naar productie** → *Run workflow*. Drie velden:

| Veld | Wat |
|---|---|
| `versie` | backend-tag, bijv. `sha-5428bb954884`. Leeg = de laatste van main |
| `frontend_versie` | frontend-tag. Leeg = `latest` |
| `reden` | **verplicht.** Komt in de samenvatting te staan |

> **De tag is twaalf tekens.** `sha-ffd27dc9` bestaat niet, `sha-ffd27dc9472f`
> wel. Dat is twee keer misgegaan (10-08 en 11-08); beide keren hield de rem het
> tegen met *"Er is niets gewijzigd"*. Kijk ze op met
> `ssh root@saxombp "docker images | grep mcm2/api"`.

### 3c. Wat er dan gebeurt

1. **De poort draait** — backup, staging op de stand van de repository,
   productie niet vóór. Blokkeert dit, dan is er niemand lastiggevallen met een
   akkoordverzoek voor niets.
2. **Jij krijgt een akkoordverzoek** van de Environment `productie`. De run staat
   stil tot je drukt.
3. **De poort draait opnieuw** — een akkoord kan een dag wachten, en in die tijd
   kan de wereld veranderd zijn.
4. **Migraties, teruglezen, rechtencontrole** — precies zoals bij staging.
5. **De samenvatting draagt het startcommando**, plus de weg terug.

### 3d. De applicatie starten

Dat doet CI niet, om dezelfde reden als bij staging: een CI-runner krijgt
onvermijdelijk een Tailscale-label, en gelabelde apparaten kunnen niet via SSH
bij een apparaat met een gebruikersidentiteit. Kopieer de regel uit de
samenvatting:

```powershell
npm run deploy:productie -- --versie sha-<versie> --frontend-versie sha-<frontend>
```

Dat script vraagt nog steeds bevestiging, en waarschuwt als deze versie niet op
acceptatie draait:

```
LET OP: op acceptatie draait sha-abc123, niet sha-def456.
Deze versie is daar dus niet beproefd.
```

Dat blokkeert niet. Soms is er een gegronde reden — maar hij moet zichtbaar
zijn, want dit is precies de stap die OTAP voorschrijft en die onder tijdsdruk
wordt overgeslagen.

### De vier remmen, en waar ze zitten

| Rem | Waar | Wat hem tegenhoudt |
|---|---|---|
| Backup vooraf | `productie-poort.js` | geen bewijs, ouder dan 36 uur, of de controle meldde problemen |
| Staging beproefd | `productie-poort.js` | staging staat niet op de stand van de repository |
| Productie niet vóór | `productie-poort.js` | productie telt méér migraties dan het journal |
| Handmatig akkoord | GitHub Environment | jij drukt niet |

De eerste drie zijn beproefd op alle uitkomsten (11-08), exitcodes zonder pipe
gemeten. De vierde is een instelling op GitHub, geen code: staat `productie`
daar niet met een required reviewer, dan draait de job gewoon door.

---

## Terugdraaien

```powershell
npm run deploy:status                                    # welke versie draaide er?
npm run deploy:productie -- --versie sha-<vorige>
```

**Dit is de reden dat CI met `:sha-<commit>` tagt en niet alleen met
`:latest`.** Een onveranderlijke verwijzing is voorwaarde voor rollback:
`:latest` van gisteren bestaat morgen niet meer.

Bij een rollback vraagt productie opnieuw bevestiging, en er wordt opnieuw
gemigreerd. **Let op:** migraties draaien niet terug. Bevatte de slechte versie
een migratie, dan blijft die staan — dat is opzet (geen destructieve migraties
zonder schema-debt issue), maar het betekent dat "terug naar de vorige versie"
het schema niet terugdraait.

**Je hoeft de regel niet zelf samen te stellen.** Elke geslaagde uitrol drukt
hem af, met beide versies erin:

```
  vorige versie was sha-5428bb954884 met frontend sha-635ff21150bd
  terugdraaien:  npm run deploy:acceptatie -- --versie sha-5428bb954884 --frontend-versie sha-635ff21150bd
```

**Beproefd op 2026-08-11**, op acceptatie: heen naar `sha-ffd27dc9472f`, terug
naar `sha-5428bb954884` met de afgedrukte regel. Beide keren alle vier de
rookproeven groen, en de omgeving stond daarna teruggelezen exact zoals hij
stond. Acceptatie en niet productie, omdat `mcm2-productie` op saxombp een
lokale database heeft en niet de Supabase-productiedatabase — dezelfde weg,
zonder risico voor echte gegevens.

> **Er is géén `npm run rollback:…`.** Dat commando bestaat niet en heeft nooit
> bestaan, maar het stond wél in de foutmelding die je kreeg als de containers
> niet startten — dus juist op het moment dat je het nodig had. Hersteld op
> 11-08; die melding draagt nu de echte regel.

---

## Kijken wat er draait

```powershell
npm run deploy:status
```

Toont per omgeving welke containers draaien, met welke image-tag, én of de app
antwoordt. Dat laatste is het punt: een draaiende container is geen werkende
app.

Toont ook of de Saxo-app nog op 8080 en 8081 draait.

---

## Bij afwijking

### "De server is niet bereikbaar"

```powershell
tailscale status | Select-String saxombp
```

Staat er `offline`, dan is de server uit of het netwerk weg. Staat er `active`,
probeer dan `ssh root@saxombp echo ok`.

### Het commando hangt, zonder foutmelding

Dat is bijna altijd **Tailscale SSH dat om herauthenticatie vraagt**:

```
# Tailscale SSH requires an additional check.
# To authenticate, visit: https://login.tailscale.com/a/<code>
```

Open die link en bevestig. Daarna werkt het weer.

> **Dit is periodiek, niet eenmalig per apparaat.** Hier stond eerder dat het
> een eenmalige stap was; op 2026-08-11 kwam het terug op een machine die de
> hele dag had gewerkt. De verlooptijd is een instelling van de Tailscale-tenant
> (`checkPeriod` in de SSH-regel).
>
> **Waarom je het niet meteen ziet:** scripts die `ssh` aanroepen met
> `BatchMode=yes` krijgen die vraag wél, maar tonen hem niet — ze wachten stil
> tot de time-out. `npm run deploy:status` leek daardoor traag in plaats van
> geblokkeerd. Hangt een servercommando: draai `ssh root@saxombp "echo ja"` met
> de hand, dan zie je de link.

### "Kon image … niet ophalen"

Bestaat die tag? Kijk op
https://github.com/orgs/AlingAdvies/packages/container/package/mcm2%2Fapi

Staat het pakket op **private**, dan kan de server er niet bij. Het hoort op
public te staan: het image bevat geen geheimen — de database-URL's en sleutels
komen bij het starten uit de `.env`-bestanden op de server, niet uit het image.

**Er is niets gewijzigd als deze stap faalt** — de draaiende omgeving is dan
niet aangeraakt.

### "De migraties zijn niet gelukt"

De nieuwe code is dan **niet** gestart; de omgeving draait nog op de vorige
versie. Lees de foutmelding: het script toont de laatste twintig regels van de
migratie.

Vertrouw de melding "Migraties voltooid" niet blind — lees terug uit de
database. Dat is in dit project twee keer misgegaan (Issue #86, en migratie 0017
op 2026-08-07).

### De rookproef faalt en terugdraaien lukt ook niet

```powershell
ssh root@saxombp "cd /opt/mcm2 && docker compose -p mcm2-productie logs --tail=50 api"
```

---

## Wat hier bewust niet staat

**Geen automatische uitrol vanuit GitHub Actions.** Dat vraagt een self-hosted
runner op de server, die draaiend gehouden moet worden en toegang tot het
netwerk krijgt. Eerst moet de handmatige keten bewezen zijn; automatiseren van
een proces dat je nog niet vertrouwt levert alleen een snellere manier op om het
fout te doen.

**Geen HTTPS.** Deze omgevingen draaien over http binnen Tailscale. Daarom staat
`SESSIE_COOKIE_INSECURE=true` in beide `.env`-bestanden — zonder dat weigert de
browser het sessiecookie, want dat draagt standaard de `__Host-`prefix. **Bij
verhuizing naar een echte cloud met TLS moet die regel weg uit `productie.env`.**

---

## De frontend rolt mee — met een eigen versie

Sinds 2026-08-10 draait de frontend mee in deze keten. Twee blokkades zijn
achtereenvolgens weggenomen: het ingebakken backend-adres (Issue #51) en het
ontbreken van een gepubliceerd image.

### Twee repositories, twee versies

**Dit is het enige dat je hier echt moet onthouden.** Backend en frontend zitten
in aparte repositories, dus hun commit-SHA's zijn nooit gelijk. De uitrol vraagt
ze allebei:

```powershell
npm run deploy:acceptatie -- --versie sha-abc123def456 --frontend-versie sha-987fed654321
```

Laat je een van beide weg, dan wordt dat `:latest`. Voor acceptatie is dat
prima. **Voor productie niet**: dan is aan de omgeving niet te zien welke code
er draait, en dat is precies wat §6 van het OTAP-plan uitsluit.

Het slotbericht van een geslaagde uitrol drukt de terugdraairegel af met beide
versies erin, zodat je die niet zelf hoeft samen te stellen:

```
  vorige versie was sha-25ffdf847ce0 met frontend sha-f850fc0d4e5f
  terugdraaien:  npm run deploy:acceptatie -- --versie sha-25ffdf847ce0 --frontend-versie sha-f850fc0d4e5f
```

**Bij een rollback gaan beide onderdelen samen terug** naar de combinatie die er
stond. Alleen de backend terugdraaien zou een frontend achterlaten die bij een
andere versie hoort — een toestand die nergens beproefd is.

**De promotiecontrole kijkt naar allebei.** Rol je naar productie uit met een
combinatie die niet op acceptatie stond, dan meldt het script dat per onderdeel.
Het blokkeert niet: soms is er een gegronde reden, maar hij moet zichtbaar zijn.

### Wat er nu extra gecontroleerd wordt

De rookproef controleerde of de frontend een pagina serveert. Dat bewijst niet
dat hij de backend bereikt — sinds #51 loopt dat via een doorgeefluik dat
`API_BASE_URL` bij het starten leest, en dat is een aparte schakel die apart
stuk kan. Staat die variabele verkeerd, dan draait de frontend gewoon door en
blijft elk beheerscherm leeg.

Daarom vraagt de rookproef nu ook een beheerroute op via poort 3000. Zonder
sessie hoort dat **401** te geven:

| Antwoord | Wat het betekent |
|---|---|
| 401 | goed — de aanroep bereikte de backend en werd geweigerd |
| 502 | het doorgeefluik vindt de backend niet — `API_BASE_URL` wijst verkeerd |
| 500 | `API_BASE_URL` is helemaal niet gezet |

`npm run deploy:status` toont dezelfde controle.

> **`API_BASE_URL` is géén browseradres.** Het wordt aangeroepen door de
> frontend-*container*, en daarbinnen is `localhost` de container zelf. Gebruik
> de servicenaam: `http://api:5001`. Dat is het spiegelbeeld van `CORS_ORIGIN`,
> dat juist wél een adres is dat de browser gebruikt — die twee zijn makkelijk
> te verwarren.

---

## Inloggen op een uitgerolde omgeving

**Dit ontbrak tot 2026-08-10 volledig.** `deploy-inrichten.js` genereerde geen
`OIDC_*`-variabelen, dus gaf `/auth/login` een kale `{"statusCode":500}` in de
browser. In het serverlog stond netjes *"Identity-configuratie onvolledig.
Ontbrekende variabelen: …"*, maar daar kijkt niemand als hij op een knop klikt.

### De callback loopt via de frontend, niet via de backend

```
OIDC_REDIRECT_URI=http://saxombp:3010/api/backend/auth/callback
                              ^^^^ frontend-poort, niet 5011
```

**Waarom dat moet.** De backend zet bij `/auth/login` een pogingcookie en leest
dat bij `/auth/callback` terug. Lopen die twee over verschillende herkomsten —
de een via poort 3010, de ander via 5011 — dan stuurt de browser het cookie niet
mee, en mislukt élke login op een ontbrekende state. Sinds Issue #51 klikt de
gebruiker op de frontend, dus moet de callback daar terugkomen.

### Wat er per omgeving in het `.env`-bestand hoort

`deploy-inrichten.js` zet deze nu **leeg** neer, met de reden erbij. Dat is
opzet: het script kent het client-secret niet en hoort het niet uit een lokale
`.env` te vissen — een geheim kopiëren is een bewuste handeling.

| Variabele | Waar vandaan |
|---|---|
| `OIDC_ISSUER`, `OIDC_TOKEN_ENDPOINT`, `OIDC_JWKS_URI`, `OIDC_CLIENT_ID` | `.env.example` §Identity |
| `OIDC_CLIENT_SECRET` | de lokale `.env` — nooit in git |
| `OIDC_REDIRECT_URI` | vooringevuld op de frontend-poort |
| `PORTAAL_BASIS_URL`, `UITNODIGING_BASIS_URL` | vooringevuld op de frontend-poort. Zie hieronder — dit ging op 10-08 mis |
| `NA_LOGIN_URL`, `NA_LOGOUT_URL` | vooringevuld; zonder deze valt de backend terug op `/`, en dat is de backend-poort waar geen scherm staat |

### En dan de stap die niet in code zit

**Het redirect-adres moet geregistreerd staan in de app-registratie bij Entra.**
Staat het er niet, dan weigert Microsoft met `AADSTS50011` — een melding die
over de *reply URL* gaat, niet over je account.

Elke omgeving heeft een eigen adres, dus elke omgeving vraagt een eigen regel in
die lijst:

| Omgeving | Redirect-URI |
|---|---|
| lokaal | `http://localhost:5001/auth/callback` |
| acceptatie | `https://saxombp.tail4b29b.ts.net/api/backend/auth/callback` |
| productie | `https://saxombp.tail4b29b.ts.net/productie/api/backend/auth/callback` — **voorlopig** |

> **Productie draait sinds 12-08 op een sub-pad, en dat is een tussenoplossing
> met een bekend gebrek.** De pagina vraagt zijn eigen bestanden op via
> `/_next/...` zónder `/productie` ervoor, waardoor die bij *acceptatie*
> terechtkomen. Dat valt nu niet op omdat beide omgevingen dezelfde
> frontend-versie draaien — zodra ze uiteenlopen, laadt productie de code van
> acceptatie.
>
> De nette oplossing is een **eigen hostnaam per omgeving**, zoals op AWS. Tot
> die er is: werk je aan de frontend, controleer dan of beide omgevingen nog
> dezelfde versie draaien.

> **Let op de `https`.** Entra accepteert **geen** `http`-adres, behalve op
> `localhost`. Dat is geen instelling die je omzeilt: het invoerveld weigert de
> waarde met *"Must start with HTTPS or http://localhost"*.
>
> Daarom draait acceptatie sinds 2026-08-10 via `tailscale serve` op
> `https://saxombp.tail4b29b.ts.net`. Productie heeft dat nog niet, en kan
> daarom nog geen inlog hebben.

### Waar links naartoe wijzen (Issue #132)

Twee variabelen, allebei het adres van de **frontend**, allebei op 10-08 gemist:

| Variabele | Waarvoor | Pad dat de code erachter zet |
|---|---|---|
| `PORTAAL_BASIS_URL` | de leverancier die een vragenlijst invult | `/portal/survey/<token>` |
| `UITNODIGING_BASIS_URL` | een nieuwe tenantbeheerder | `/api/backend/auth/login?uitnodiging=<token>` |

**Waarom de tweede niet naar de API wijst.** Die link komt uit op `/auth/login`,
en die route zet het uitnodigingstoken in het pogingcookie. Sinds Issue #51
praat de browser alleen nog met de frontend; een link naar de API-poort zou dat
cookie op een andere herkomst zetten dan waar de callback terugkomt, en dan
mislukt de login op een ontbrekende state. Zelfde valkuil als bij
`OIDC_REDIRECT_URI`.

**Wat er misging op 10-08.** De code las `API_BASIS_URL` — een variabele die in
geen enkel voorbeeldbestand stond en dus nooit gezet werd. De eerste tenant op
acceptatie kreeg daardoor een uitnodigingslink naar `http://localhost:5001`, een
adres dat op die server niet bestaat.

**Dat is niet te repareren achteraf.** Het token bestaat alleen op het moment
van aanmaken; er is geen route die het opnieuw toont. Een verkeerde link
betekent: tenant aangemaakt, beheerder kan er niet in, opnieuw beginnen.

Controleren wat de backend werkelijk meestuurt — niet wat er in het bestand
staat:

```powershell
ssh root@saxombp "curl -s -i --max-time 15 'http://localhost:3010/api/backend/auth/login' | grep -i '^location:'"
```

Een `302` naar `ciamlogin.com` betekent dat de configuratie compleet is. Een
`500` betekent dat er nog een variabele mist; welke, staat in
`docker logs mcm2-acceptatie-api-1`.

---

## ⚠ Het compose-bestand op de server loopt niet vanzelf mee

`deploy.js` gebruikt `/opt/mcm2/docker-compose.omgeving.yml`, maar **brengt dat
bestand niet mee**. Het komt daar via `deploy:inrichten`, en dat script weigert
op een server waar al iets draait — terecht, want het zou de
databasewachtwoorden opnieuw zetten.

Wijzig je het bestand in de repository, dan draait de uitrol dus stilzwijgend
door op de oude versie.

**Dat is geen theorie.** Op 2026-08-10, bij de eerste uitrol met frontend, stond
op saxombp nog een versie met `profiles: ["frontend"]` erin terwijl die regel in
de repository al weg was. Gevolg: de frontend-container werd **niet aangemaakt**
— geen fout, geen container, alleen een rookproef die faalde met `kreeg 000`.
Zoeken naar de oorzaak kostte meer tijd dan de uitrol zelf.

**Sindsdien controleert `deploy.js` dit als eerste**, op de inhoud (sha256) en
niet op de datum. Wijkt het af, dan stopt de uitrol vóórdat er iets is
aangeraakt, met beide vingerafdrukken en de commando's om het recht te zetten.

Bijwerken doe je met de hand — bewust, want het bestand raakt **beide**
omgevingen tegelijk, ook productie:

```powershell
# 1. Kijk eerst wat er verschilt
ssh root@saxombp "cat /opt/mcm2/docker-compose.omgeving.yml" | diff - deploy/docker-compose.omgeving.yml

# 2. Backup op de server
ssh root@saxombp "cp /opt/mcm2/docker-compose.omgeving.yml /opt/mcm2/docker-compose.omgeving.yml.bak"

# 3. Kopiëren
ssh root@saxombp "cat > /opt/mcm2/docker-compose.omgeving.yml" < deploy/docker-compose.omgeving.yml

# 4. Teruglezen — niet de melding geloven
ssh root@saxombp "sha256sum /opt/mcm2/docker-compose.omgeving.yml"
```

Een gewijzigd compose-bestand raakt pas aan een draaiende omgeving bij de
eerstvolgende uitrol daarheen. Rol je alleen acceptatie uit, dan blijft
productie ongemoeid draaien tot je daar ook uitrolt.

---

## Wat dit bewijst, en wat niet

**Wel:**
- hetzelfde image dat getest is draait op een andere machine
- migraties horen bij de uitrol en blokkeren hem als ze falen
- acceptatie en productie hebben gescheiden data (eigen volume per omgeving)
- terugdraaien werkt en is beproefd
- een falende uitrol herstelt zichzelf

**Niet:**
- hoge beschikbaarheid — één machine, één stroomvoorziening, thuisinternet
- dat de frontend promoveerbaar is (Issue #51)
- dat het proces onder tijdsdruk gevolgd wordt; dat is wat de
  [onderhoudskalender](onderhoudskalender.md) moet bewaken
