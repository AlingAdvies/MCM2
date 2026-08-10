# Runbook — uitrol naar acceptatie en productie

**Type:** A — deployment
**Eigenaar:** de eigenaar (Chris)
**Laatste update:** 2026-08-10
**Vereiste toegang:** Tailscale (voor `saxombp`), GitHub, deze repository
**Raakt:** Issue #12, #18, #51, ADR-012

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
| **P** productie | `saxombp` | 3020 | 5021 | 55470 (127.0.0.1) |

Bereikbaar via Tailscale: `http://saxombp:3010` en `http://saxombp:3020`. Niet
vanaf internet — alleen vanaf je eigen apparaten.

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

```powershell
npm run deploy:productie
```

**Verwacht resultaat:** het script vraagt bevestiging. Typ `ja`.

**Het waarschuwt als deze versie niet op acceptatie staat:**

```
LET OP: op acceptatie draait sha-abc123, niet sha-def456.
Deze versie is daar dus niet beproefd.
```

Dat blokkeert niet. Soms is er een gegronde reden — maar hij moet zichtbaar
zijn, want dit is precies de stap die OTAP voorschrijft en die onder tijdsdruk
wordt overgeslagen.

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

Vraagt Tailscale om verificatie in de browser, doe die dan — dat is een
eenmalige stap per apparaat.

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
