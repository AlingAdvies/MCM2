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

| Eis | Waarde | Toelichting |
|---|---|---|
| RPO | **1 uur** | Een verloren survey-inzending is niet opnieuw op te vragen bij de leverancier. Dagelijkse backups zijn hier niet voldoende: een storing om 16:00 zou een hele werkdag aan inzendingen kosten. Vereist point-in-time recovery. |
| RTO | **4 uur binnen kantooruren** | De pilot is niet 24/7 kritiek, maar een dag stilstand tijdens een lopende surveyronde is niet uit te leggen aan de klant. |
| Restore getest | Vóór de pilotstart, met realistische datavolumes | Een restore van een lege database bewijst niets over een gevulde. |
| Hertest-frequentie | **Elk kwartaal**, plus na elke schemawijziging die tabellen toevoegt | |

### Fase 3 — Productie met betalende klanten

| Eis | Waarde | Toelichting |
|---|---|---|
| RPO | **15 minuten** | Meerdere klanten betekent dat verlies niet met één telefoontje op te lossen is. |
| RTO | **2 uur** | Contractueel te onderbouwen; hangt af van wat er in klantovereenkomsten wordt toegezegd. |
| Restore getest | **Elk kwartaal**, gedocumenteerd met datum, duur en uitkomst | ISO27001 vereist aantoonbaarheid, niet alleen uitvoering. |
| Aanvullend | Herstel naar een **ander** project/regio minstens één keer bewezen | Beschermt tegen uitval van de provider zelf, niet alleen tegen een fout in de data. |

> De getallen in fase 3 zijn een uitgangspunt. Zodra er contractuele toezeggingen aan klanten worden gedaan, zijn díe leidend en moet dit ADR daarop worden bijgesteld.

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
