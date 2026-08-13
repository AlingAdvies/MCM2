# Plan — een robuuste simulatie zonder AWS

**Type:** A — plan
**Eigenaar:** Kees Maling
**Vastgelegd:** 2026-08-13
**Besluit:** geen AWS voorlopig, geen gecompliceerde omwegen
**Vervangt niet:** `plan-otap-straat-met-staging.md` — dit is het vervolg erop

---

## Waarom dit plan er is

Op 13-08 stond de vraag op tafel hoeveel AWS-omgevingen er nodig zijn voor een
robuuste opstelling. Het antwoord — drie — bleek de verkeerde vraag te
beantwoorden. Het besluit werd: **voorlopig geen AWS.**

Daarmee komt de oorspronkelijke doelstelling weer bovenaan te liggen, en die
staat in `CLAUDE.md` §0:

> Een omgeving die de eindsituatie zo goed mogelijk repliceert, om daarop vast
> te stellen dat de geautomatiseerde OTAP en DevOps werkt.

En, doorslaggevend voor de volgorde in dit plan:

> **Waar het werkelijk om gaat is het gedrag, niet de techniek.**
> Eerst de keten aantoonbaar rond mét data erin, daarna pas de kosmetiek.

---

## Wat er al staat, gemeten op 13-08

Niet aangenomen maar teruggelezen uit de systemen.

| Onderdeel | Stand |
|---|---|
| OTAP-keten merge → productie | loopt, vier remmen, één keer echt gedraaid |
| `verify:volledig` | groen — 397 unittests, 66 browsertests |
| Drie omgevingen op saxombp | acceptatie, staging, productie — alle drie antwoorden |
| Terugdraaien | heen-en-terug beproefd op acceptatie |
| Productiedatabase | 26 migraties, `beschermd`, 1 gebruiker, 1 platformbeheerder |

**De simulatie bestaat dus al.** Wat eraan ontbreekt is geen techniek maar
bewijs: er staat geen data in, en er gaat geen alarm af als er iets omvalt.

## Wat er ontbreekt, gelegd naast de vijf punten van het doel

| # | Doelstelling | Stand | Blokkade |
|---|---|---|---|
| 1 | Eindsituatie repliceren | grotendeels | sub-pad; één machine |
| 2 | OTAP aantoonbaar | **ja** | — |
| 3 | Eén echte tenant met data | **nee** | tenant bestaat niet |
| 4 | Demo + test + bewijs | **nee** | volgt uit 3 |
| 5 | Eenvoudig naar AWS | ja | — |

**Punt 3 is de blokkade en dus de eerste stap.** Productie telt vandaag
0 tenants en 0 leveranciers.

---

## De vier stappen

### Stap A — de tenant AlingAdvies, met realistische vulling

**Waarom eerst:** het doel noemt dit expliciet als voorwaarde vóór de
kosmetiek. Zonder data is de keten wel aantoonbaar maar niet bewezen: een
backup van niets zegt niets, en RLS op een lege tabel evenmin.

- Aanmaken via `POST /platform/tenants` — de **platformroute**, niet
  rechtstreeks in de database. Het auditspoor ís de opbrengst (§5.1).
- Vulling in de orde van de tenant die op 10-08 verloren ging: ~20
  leveranciers, 2 vragenlijsten, een lopende ronde met antwoorden en oordelen.
- **Mock data die als klantdata behandeld wordt**: backup, RLS, `beschermd`,
  geen e2e-suites erop.

**De 401 blokkeert dit niet.** Gemeten op 13-08: de route werkt met een geldig
cookie (e2e-suite, 10+ keer groen). Het probleem zit in het cookietransport in
de browser, niet in de route. Zie het onderzoeksblok in `STATUS.md`.

### Stap B — bewaking die zich meldt

**Waarom:** er is vandaag geen alarmering. Een omgeving die omvalt wordt pas
opgemerkt als iemand toevallig kijkt.

- Een controle op **saxombp zelf** (besluit eigenaar 13-08), die periodiek de
  drie omgevingen bevraagt en bij uitblijvend antwoord meldt via Telegram.
- Telegram is er al voor de backups; er komt geen nieuw kanaal bij.

**Waarom dit "robuust" betekent bij één machine.** Redundantie is niet te
bouwen met één computer. Wat wél kan is weten dát hij om is. Dat blijft ook op
AWS nodig — dit is geen wegwerpwerk.

**Bekende beperking, bewust aanvaard:** gaat saxombp volledig om, dan meldt de
bewaking zelf ook niets meer. Het alternatief (bewaken vanaf de laptop) heeft
het spiegelbeeldige gat — staat de laptop uit, dan bewaakt niets. Dat is
hetzelfde gat als de backup nu al heeft.

### Stap C — de 401 en het sub-pad oplossen, klein

**Zonder** tweede Tailscale-node en **zonder** Tailscale Services: beide wegen
zijn beproefd en dicht (STATUS.md).

- Elke omgeving heeft al een eigen doorgeefluik `/api/backend`. Wat ontbreekt
  is dat het sub-pad correct wordt meegegeven, zodat productie zijn bestanden
  niet van acceptatie haalt.
- Configuratie, geen infrastructuurproject.

Dit lost twee dingen tegelijk op: de 401 en het bekende gebrek dat
`/productie` zijn bestanden zonder voorvoegsel ophaalt.

### Stap D — de Supabase-pauze afvangen

Beide Supabase-projecten draaien op het gratis plan en **pauzeren na 7 dagen
stilte**. Voor een omgeving die als demo dient is dat een reëel risico: de demo
staat stil op het moment dat hij nodig is.

Een periodieke leesquery houdt ze wakker. Kost een uur.

---

---

## Waarom een fix in `main` kan zitten en niet in een omgeving

*Vraag van de eigenaar, 13-08. Waargenomen: `unknown` stond nog op acceptatie
terwijl Issue #133 op 11-08 gemerged was.*

**Er zit geen automatische stap tussen `main` en een draaiende omgeving.**

```
merge op main → CI → image naar GHCR → migraties naar staging
──────────────────────────────────────────────────────────────
→ npm run deploy:staging -- --versie sha-…        ← HANDMATIG
```

CI bouwt een **image** en zet het klaar in GHCR. Een draaiende container blijft
draaien op de versie waarmee hij ooit gestart is; een merge raakt hem niet.
Iemand moet `deploy` draaien. Dat is een bewust besluit (eigenaar, 12-08:
handmatig starten is OK) — geen tekortkoming.

Bij Issue #133 kwam er een tweede laag bij: de fix zat in de **broncode** maar
niet in de gecompileerde `dist/` op de machine. Na opnieuw bouwen stond hij er
wel. Zelfde klasse fout, één niveau dieper.

### Het werkelijke gat

Niet dat uitrollen handwerk is, maar dat **niets meet of een omgeving nog op de
laatste versie draait**. Vandaag ontdek je dat door toevallig `unknown` op een
scherm te zien.

Dat is precies wat **stap B** moet opvangen: naast "antwoordt de omgeving nog"
ook "op welke versie draait hij, en is dat de laatste?". `deploy:status` leest
de draaiende versie al — die vergelijking is de aanvulling.

> Let op de verwante valkuil: `deploy:status` toonde staging eerst helemaal niet
> (PR #145). Een controlecommando met een blinde vlek stelt gerust over iets dat
> het niet gemeten heeft.

## Wat dit plan bewust NIET doet

| Niet | Waarom |
|---|---|
| Eigen hostnaam per omgeving | Kosmetiek volgens §0; beide wegen ernaartoe zijn dicht; komt gratis mee bij AWS |
| Poorten openzetten op de thuisrouter | Bouwt een constructie die op AWS niet bestaat — precies waar §0 voor waarschuwt |
| Eigen certificaatbeheer | Idem; Tailscale doet dit nu |
| Redundantie | Niet op te lossen met één machine. Stap B maakt het zichtbaar, dat is wat kan |
| Applicatie automatisch starten | Besluit eigenaar 12-08 — handmatig starten blijft OK |

---

## De AWS-tegenspraak, voorlopig geparkeerd

Twee documenten spreken elkaar tegen en dat is met dit besluit **niet
opgelost, alleen uitgesteld**:

| Document | Zegt |
|---|---|
| `aws-kostenraming-briefing.md` §7 | drie omgevingen (robuustheid) |
| `MCM2 AWS Minimaal — implementatiebrief` | één omgeving ($20–30/maand) |

Beide zijn intern consistent; ze beantwoorden verschillende vragen. Het advies
van 13-08 luidde: **drie omgevingsvormen, twee permanente rekeningen** —
staging en productie permanent, acceptatie ephemeral per pull request. Wat dat
kost is niet uitgerekend.

Pak dit weer op zodra AWS aan de orde is. Niet eerder — en niet stilzwijgend.
