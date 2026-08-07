# ADR-014 — Elke database zegt zelf of hij wegwerp is

- **Status:** aanvaard — gebouwd en gemerged (PR #103, migratie 0019).
- **Datum:** 2026-08-07
- **Aanleiding:** de e2e-suites draaiden tegen de demo-database en wisten die leeg. Geen enkele bestaande bescherming sloeg aan.
- **Relatie:** ADR-009 (migratierol en CI-database), Issue #86, `docs/runbooks/commandos-en-omgeving.md`

---

## Context

Op 2026-08-07 wees `DATABASE_URL` naar poort **55450** — de demo-database —
terwijl een wegwerpcontainer op 55440 bedoeld was. De e2e-suites maakten hun
testtenants aan en ruimden op. De demo-tenant verdween; 400 testleveranciers
bleven achter.

Er sloeg niets aan, en dat is het eigenlijke probleem.

### Wat er wél was, en waarom het niet hielp

`scripts/db-doelwit.js` (Issue #86) kent **één criterium: is de host lokaal.**
Vijf hostnamen gelden als "op deze machine"; alles daarbuiten wordt geweigerd
zonder `--extern`.

Dat werkt voor productie — Supabase staat op
`aws-1-eu-west-1.pooler.supabase.com` — maar binnen `localhost` onderscheidt
het niets. De demo-database en een wegwerpcontainer zijn voor die controle
identiek.

En die bescherming zat **alleen in vier scripts**. De e2e-tests hadden hem
niet: `test/jest-e2e.setup.ts` bestond uit één regel, `import 'dotenv/config'`.
Zeventien suites lezen `DATABASE_URL` en beginnen met `DELETE FROM`.

### Waarom dit meer is dan een vergissing

Had `DATABASE_URL` naar Supabase gewezen, dan hadden de suites dáár gedraaid.
RLS en de `WHERE tenant_id`-clausules beschermen echte klantdata, maar er waren
testtenants in productie ontstaan. Dat is één vergissing verwijderd van iets
onherstelbaars.

De fout was bovendien **gedragsmatig, niet technisch**: een omgevingsvariabele
gezet en vergeten terug te zetten. Dat kan iedereen overkomen, dus een
werkafspraak is geen oplossing.

---

## Besluit

**Elke database draagt een markering die zegt wat hij is.** Migratie 0019 zet
`clm.omgeving` neer: één rij, met `wegwerp` of `beschermd`.

De standaard is **`beschermd`**. Een database die vergeet zich te benoemen
wordt behandeld als productie. Andersom zou precies de database die niemand
heeft ingericht — de nieuwe, de vergetene, de per ongeluk aangemaakte —
vogelvrij zijn.

Een wegwerpdatabase meldt zich expliciet aan:
```
node scripts/markeer-wegwerp.js "waarvoor"
```

### Twee lagen die verschillende dingen doen

| Controle | Kijkt naar | Vangt |
|---|---|---|
| `eisToestemmingBuitenLokaal` (ADR-009, Issue #86) | de hostnaam | Supabase, andermans machine |
| `eisWegwerpdatabase` (deze ADR) | wat de database over zichzelf zegt | de demo-database, die lokaal én beschermd is |

De demo is lokaal, dus alleen de tweede houdt hem tegen. Beide blijven bestaan.

### Waar de eis geldt

| Wat | Controle |
|---|---|
| Alle e2e-suites | Weigeren te starten tegen `beschermd` |
| `seed:demo -- --verwijder` | Weigert op `beschermd` |
| `migrate:deploy` | Alleen de hostcontrole — migreren mág op productie |
| Seeden zonder `--verwijder` | Alleen de hostcontrole — toevoegen mag |

**Toevoegen mag op een beschermde database, verwijderen niet.** Anders is een
demo-tenant in productie nooit in te richten. De rem zit waar iets
onherstelbaar is.

---

## Overwogen alternatieven

**Poort 55450 verbieden in de tests.** Simpel en meteen effectief, maar breekt
zodra de demo op een andere poort draait, en zegt niets over een database op
een andere machine. Een poortnummer is geen eigenschap van de database.

**Het Docker-label `mcm2.rol=demo` uitlezen.** Bestaat al voor de
demo-container. Werkt alleen als de database in Docker draait op dezelfde
machine — dus niet voor Supabase, en niet na een migratie naar AWS RDS.

**Een omgevingsvariabele.** Zou in een `.env` belanden en daarna nooit meer
opvallen — precies hoe `MIGRATION_DATABASE_URL` stilzwijgend naar productie
bleef wijzen (Issue #86).

**Waarschuwen in plaats van weigeren.** Een melding in een run van 27 suites
leest niemand, en na `verwijderTestdata` is de data weg. De enige bruikbare
bescherming komt vóór de schade.

---

## Gevolgen

**De markering reist mee met de database.** Een dump-en-restore neemt hem over,
een verhuizing naar een andere poort verandert niets, en een kopie van
productie draagt zichtbaar `beschermd` met zich mee. **Dat blijft gelden bij
een migratie naar AWS RDS** — geen enkele regel hoeft opnieuw bedacht te worden.

**CI en `verify:volledig` markeren hun eigen container.** Beide zetten een
wegwerpdatabase op die één run leeft; zonder die stap blokkeert de guard zijn
eigen tests. De stap staat in `.github/workflows/ci.yml` en in
`scripts/verify-volledig.js`.

**Een database zonder `clm.omgeving` faalt ook.** Die heeft migratie 0019 niet
gehad — dat kan een oude wegwerpcontainer zijn, maar net zo goed een kopie van
productie van vóór die migratie. Doorgaan zou betekenen dat de bescherming
zwijgt op het moment dat je hem nodig hebt.

**Er is een uitweg, en die is zichtbaar.** `MCM2_E2E_ONBESCHERMD=ja` voor de
tests, `--ook-beschermd` voor de scripts. Beide staan in de terminalhistorie, zodat
later terug te zien is dat iemand het bewust deed — dezelfde redenering als bij
`--extern` in ADR-009.

**Een bewakingstest houdt de guard aan.** `test/omgevingsmarkering.spec.ts`
(9 tests, geen database nodig) controleert dat de guard geregistreerd staat,
hard faalt, alleen `wegwerp` accepteert, en dat CI én `verify:volledig` hun
container markeren. Zonder die test raakt de guard uitgeschakeld op het moment
dat hij in de weg zit.

---

## Wat dit niet oplost

**Een handmatige `DELETE` in psql kijkt er niet naar.** De markering beschermt
de tests en de schrijvende scripts, niet iemand die zelf een query typt.

**Het is een vangnet, geen vereenvoudiging.** Er zijn nog steeds drie soorten
database die op elkaar lijken: productie, de lokale demo, en wegwerpcontainers.
De demo is het verwarrende geval — lokaal zoals wegwerp, met data die je wilt
houden zoals productie.

De echte vereenvoudiging is die tussencategorie laten verdwijnen: een
DEMO-tenant ín productie voor acceptatie, en lokaal alleen nog wegwerp. Dan
blijft over: *wat blijft bestaan is heilig, wat je net zelf hebt aangemaakt mag
stuk.* Deze bescherming blijft daarbij nodig, maar hoeft dan niet meer het
verschil te maken tussen drie dingen die op elkaar lijken.

---

## Reviewmoment

Bij het opzetten van de DEMO-tenant in productie, en bij een migratie naar AWS
RDS — dan moet blijken of de markering inderdaad zonder aanpassing meereist.

## Bronnen

Issue #86; ADR-009; PR #103; `docs/runbooks/commandos-en-omgeving.md`;
`drizzle/0019_omgevingsmarkering.sql`
