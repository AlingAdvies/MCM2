# ADR-011 — Backup- en hersteleisen per fase

- **Status:** voorgesteld — de getallen hieronder zijn onderbouwde uitgangspunten, geen gemeten waarden. Ze worden bevestigd of bijgesteld zodra de eerste restore-test is uitgevoerd (Issue #19).
- **Datum:** 2026-07-28
- **Aanleiding:** de vraag "hoe stellen we blijvend vast dat de backupstrategie passend is, ook bij een groeiende database?" Tot nu toe was er wél een backup-issue (#19), maar geen norm om "passend" aan af te meten.
- **Relatie:** ADR-002 (Supabase als database, control 1 en 2 nog open), `docs/runbooks/supabase-verificatie-en-restoretest.md`.

---

## Context

Op het moment van schrijven bevat de database negen lege tabellen. Dataverlies zou vrijwel niets kosten: het schema is uit migraties opnieuw op te bouwen.

Dat verandert zodra de Transdev-pilot draait. Dan staan er ongeveer 50 leveranciers in, survey-antwoorden van externe partijen, en geüploade certificaten. **Antwoorden van leveranciers zijn niet herhaalbaar:** een leverancier die zijn survey heeft ingediend, dient hem geen tweede keer in omdat wij data kwijt zijn. Bovendien is indienen volgens de scope definitief (OV-3, geen correctieflow) — een verloren inzending is dus niet alleen ongemak, maar breekt een expliciet ontwerpuitgangspunt.

Zonder vastgelegde eisen kun je alleen vaststellen *dát* er backups zijn, niet of ze volstaan.

## Twee getallen die alles bepalen

| Term | Betekenis in gewone taal | Waarom het ertoe doet |
|---|---|---|
| **RPO** (Recovery Point Objective) | Hoeveel werk mag je maximaal kwijtraken, uitgedrukt in tijd | Bepaalt hoe vaak er een backup moet zijn. Een dagelijkse backup betekent: tot 24 uur werk weg. |
| **RTO** (Recovery Time Objective) | Hoe lang mag het duren voordat alles weer draait | Bepaalt of "we hebben een backup" genoeg is, of dat je een sneller herstelpad nodig hebt. |

Deze twee zijn geen technische details maar een bedrijfsbeslissing: ze zeggen hoeveel schade acceptabel is.

## Besluit — eisen per fase

### Fase 1 — Ontwikkeling (nu, tot de pilot start)

| Eis | Waarde | Toelichting |
|---|---|---|
| RPO | 24 uur | Alleen testdata; verlies kost hooguit een middag opnieuw invoeren. |
| RTO | 1 werkdag | Niemand wacht op deze omgeving. |
| Restore getest | **Minimaal één keer aantoonbaar geslaagd vóór de pilot start** | Dit is de harde eis van deze fase — zie Issue #19. |
| Hertest-frequentie | Bij elke wijziging in de databaselaag | ADR-010 was zo'n wijziging. |

### Fase 2 — Transdev-pilot (vanaf ~1 september 2026)

> **Herzien op 2026-07-28 na een expliciete beslissing van de eigenaar: de pilot draait op
> Supabase Free.** De oorspronkelijke norm hieronder (RPO 1 uur) is niet haalbaar op dat plan.
> De aangepaste norm en de risico-acceptatie staan in de sectie "Risico-acceptatie Free Plan"
> verderop. De oorspronkelijke waarden blijven staan als referentie voor wat een betaald plan
> zou opleveren.

| Eis | Oorspronkelijke norm | Feitelijk op Free | Toelichting |
|---|---|---|---|
| RPO | 1 uur | **24 uur**, mits de dagelijkse dump draait — anders **oneindig** | Supabase Free levert geen enkele backup. De 24 uur komt volledig uit de eigen geplande dump (zie hieronder), niet uit de provider. |
| RTO | 4 uur binnen kantooruren | **4 uur**, onveranderd | Herstel vanuit een dump duurde bij een lege database seconden. Realistisch blijft 4 uur ruim, ook bij groei. |
| Restore getest | Vóór de pilotstart, met realistische datavolumes | **Onveranderd, en nu strikter nodig** | Zonder providerbackup is de eigen dump het enige vangnet. Die moet aantoonbaar herstelbaar zijn, niet aangenomen. |
| Hertest-frequentie | Elk kwartaal | **Maandelijks tijdens actieve surveyrondes** | Vaker, juist omdat het vangnet handmatig is. |

### Fase 3 — Productie met betalende klanten

| Eis | Waarde | Toelichting |
|---|---|---|
| RPO | **15 minuten** | Meerdere klanten betekent dat verlies niet met één telefoontje op te lossen is. |
| RTO | **2 uur** | Contractueel te onderbouwen; hangt af van wat er in klantovereenkomsten wordt toegezegd. |
| Restore getest | **Elk kwartaal**, gedocumenteerd met datum, duur en uitkomst | ISO27001 vereist aantoonbaarheid, niet alleen uitvoering. |
| Aanvullend | Herstel naar een **ander** project/regio minstens één keer bewezen | Beschermt tegen uitval van de provider zelf, niet alleen tegen een fout in de data. |

> De getallen in fase 3 zijn een uitgangspunt. Zodra er contractuele toezeggingen aan klanten worden gedaan, zijn díe leidend en moet dit ADR daarop worden bijgesteld.

## Risico-acceptatie Free Plan (besluit eigenaar, 2026-07-28)

De eigenaar heeft besloten de Transdev-pilot op **Supabase Free** te draaien. Motivatie: bekendheid
met het platform, en de verwachting het pauzeerprobleem praktisch op te lossen. Dit is een bewuste
afweging, geen omissie — daarom hier vastgelegd met de risico's die erbij horen.

### Wat je hiermee accepteert

| Risico | Gevolg | Mitigatie |
|---|---|---|
| **Geen enkele providerbackup** | Bij verlies van het project is alles weg. Niet "korte bewaartermijn" — géén backup. | Eigen geplande `pg_dump` (zie hieronder). Zonder die dump is er geen vangnet. |
| **Pauzeren na ~7 dagen inactiviteit** | Een surveylink die 30 dagen geldig is, werkt niet meer als de database slaapt. De leverancier ziet een fout, niet een formulier. | Geplande activiteit (dagelijkse dump houdt het project meteen actief). |
| **Verwijdering na langere inactiviteit** | Project weg, 90 dagen bewaartermijn op het volume. | Idem — zolang de dump draait, is dit niet aan de orde. |
| **Ingediende surveys zijn onherhaalbaar** | Een leverancier dient niet opnieuw in omdat wij data kwijt zijn. Indienen is definitief (OV-3, geen correctieflow). | Maximaal 24 uur verlies i.p.v. alles, mits de dump draait. |

### Voorwaarde waaronder dit verdedigbaar is

**De geplande dump is geen aanbeveling maar een voorwaarde.** Zonder dat draait de pilot met een
onherstelbare database, en dat is niet uit te leggen aan een klant wiens leveranciers gegevens
hebben aangeleverd.

Concreet, vóór de eerste leverancierslink de deur uit gaat:

1. `npm run backup:dump` draait dagelijks, geautomatiseerd (Windows Taakplanner of een
   GitHub Actions-schedule).
2. Minstens één dump is aantoonbaar teruggezet en geverifieerd met `scripts/verify-schema.js`
   plus de volledige e2e-suite — de route uit runbook stap 1b-alt.
3. De dumps staan **niet** op dezelfde machine als de enige kopie. Een laptop die stukgaat mag geen
   dataverlies betekenen.

Punt 3 is niet triviaal: een dump op de ontwikkelmachine beschermt tegen "Supabase valt om", niet
tegen "de laptop valt om". Voor de pilot volstaat een tweede locatie (OneDrive, externe schijf);
voor productie hoort dit naar objectopslag.

### Wanneer dit besluit opnieuw op tafel moet

- **Bij de eerste betalende klant** — dan is Free niet langer verdedigbaar.
- **Bij een tweede tenant** — meer data, meer partijen, hogere impact bij verlies.
- **Als de dagelijkse dump structureel faalt of wordt overgeslagen** — dan vervalt de enige
  mitigatie en is er feitelijk geen backup meer.
- **Als de pilot langer duurt dan één surveyronde** — dan is de tijdelijkheid weg die deze keuze
  draagt.

Bij productie geldt onverkort fase 3 hieronder: Free is daar geen optie.

## Hoe blijft dit passend bij groei?

Het kernprobleem: een restore-test die vandaag slaagt bewijst niets over volgend jaar. Een lege database herstelt in seconden; tien gigabyte aan certificaten kan uren duren. Drie maatregelen:

### 1. De schemacontrole groeit automatisch mee

`test/schema-conformiteit.e2e-spec.ts` leidt af welke tabellen er horen te bestaan uit `src/db/schema.ts` — geen hardgecodeerde lijst. De test faalt bij:

- een tabel uit het schema die in de database ontbreekt;
- een tabel in de database die niet in het schema staat (ontstaan buiten de migratieketen om, wat §7.2 verbiedt);
- **een tenantgebonden tabel zonder RLS** — afgeleid uit de aanwezigheid van een `tenant_id`-kolom;
- een policy zonder `USING` of zonder `WITH CHECK`.

Draait als CI-poort. Een nieuwe tabel zonder RLS laat de build falen in plaats van stil door te glippen — noodzakelijk omdat drizzle-kit geen RLS genereert (ADR-010).

Beide faalscenario's zijn op 2026-07-28 daadwerkelijk uitgelokt en bevestigd; de test is niet alleen groen, hij wordt ook rood wanneer dat hoort.

### 2. Meten bij elke restore-test

Bij elke restore-test worden drie dingen genoteerd in het runbook:

- **datum en databaseomvang** op dat moment;
- **hoe lang de restore duurde**, van start tot geverifieerd;
- **de uitkomst** van `scripts/verify-schema.js`.

Daarmee ontstaat een reeks: duurt een restore vorig kwartaal 4 minuten en nu 45, dan is dat zichtbaar vóórdat het een probleem wordt. Zonder die meting is groei onzichtbaar tot het te laat is.

### 3. Toetsmoment aan de fase gekoppeld

De hertest-frequentie hangt aan de fase, niet aan een losse afspraak. Overgang naar een volgende fase (pilotstart, eerste betalende klant) is zelf het moment waarop dit ADR opnieuw langs de eisen gaat.

## Gevolgen

- **Fase 2 vereist waarschijnlijk een betaald Supabase-plan.** Een RPO van 1 uur betekent point-in-time recovery; op het Free-plan is dat niet beschikbaar en pauzeert een project bovendien na inactiviteit. Dit is een kostenbeslissing die vóór 1 september genomen moet worden — zie runbook stap 2.
- **De eerste restore-test blokkeert de pilot.** Zonder aantoonbaar geslaagde restore mag er geen klantdata in.
- **Elke nieuwe tabel is een moment.** De CI-poort dwingt RLS af, maar de vraag "verandert dit wat we bij verlies kwijtraken?" blijft een menselijke afweging.

## Openstaand

- De getallen zijn **niet gemeten**. Na de eerste restore-test moet blijken of een RTO van 4 uur realistisch is voor deze provider, of juist ruim.
- Wat Supabase feitelijk biedt (backupvenster, PITR, SLA) is nog niet vastgesteld — runbook stap 2. Blijkt het aanbod onder deze eisen te liggen, dan is dat een argument in de bredere vraag of Supabase de juiste keuze blijft.
- Backup van **geüploade bestanden** (certificaten, Issue #9) valt buiten dit ADR: die gaan naar objectopslag (MinIO/S3), niet naar de database. Vereist een eigen afweging zodra dat gebouwd wordt.

## Reviewmoment

Bij de start van elke nieuwe fase, en direct na de eerste restore-test.
