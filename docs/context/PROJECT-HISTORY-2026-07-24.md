# Project History — MCM2 (samenvatting t/m 2026-07-24)

Compacte, gelabelde samenvatting van de sessiegeschiedenis vóór de contextherstructurering. Bron: `docs/archive/MCM2-CLAUDE-2026-07-24-pre-restructure.md` (volledige, ongefilterde sessieverslagen) en `docs/architecture-review/2026-07-24/`.

**Labels:** `Historisch feit` · `Nog te verifiëren` · `Vervangen besluit` · `Open risico` · `Actuele verwijzing`

**Bevat geen secrets, wachtwoorden of volledige connection strings.** Waar een connectiestring relevant is, staat alleen de structuur/projectref, nooit het wachtwoord.

---

## Relatie tussen MCM2, MVM_V2 en mvm-api-pilot

`Historisch feit` — MCM2 is opgezet als vervanger van de C#-backend-pilot `mvm-api-pilot`, voor het bestaande, functioneel geaccepteerde Next.js-frontend-project MVM_V2. De C#-pilot dient als functionele specificatie (endpoint-vorm, businesslogica), niet als technische bron om te kopiëren.

`Historisch feit` — Er bestaat een los document `MVP_TRANSDEV.md` (buiten deze repository, in de bredere DEV-workspace) met een bredere MVP-scope (42 gap-analyse-items). Dit noemt nog Azure Entra ID als vastgelegde keuze en een open AWS-vs-Azure-hostingbeslissing (T-11).

`Actuele verwijzing` — De huidige, geldende scope-afbakening (survey-slice, niet de volle 42-item-scope) staat in `docs/architecture-review/2026-07-24/08-transdev-mvp-scope.md`.

---

## Database- en Supabase-besluiten

`Historisch feit` — `mvm-api-pilot` gebruikt(e) twee gescheiden Supabase-projecten via twee EF Core DbContexts:
- Eén project voor een oude, losstaande pilot-database met alleen een eenvoudige `public.vendors`-tabel — **niet gebruikt voor MCM2**.
- Eén project voor de `clm-enterprise`-database met het volledige Hay CDM-schema (`clm.*`, `ref.*`, `audit.*`) — **dit is de database die MCM2 gebruikt.**

`Historisch feit` — Bevestigde Postgres-serverversie van het `clm-enterprise`-project: 17.6 (opgevraagd via `SHOW server_version`).

`Historisch feit` — Bij eerste verbindingspoging gaf de Supabase Session Pooler een "tenant/user not found"-fout. Oorzaak: het Supabase-project stond gepauzeerd (gebeurt automatisch bij inactiviteit op de gratis tier). Opgelost door het project via het Supabase-dashboard te hervatten ("resume"). Geen technisch/code-probleem.

`Open risico` — De bestaande `audit`/`clm`/`ref`-schemas in dit Supabase-project bevatten oorspronkelijk het volledige, al gevulde schema van `mvm-api-pilot` (tientallen tabellen: contract, task, issue, certification, document, etc.). Dit is **na expliciete, tweevoudige bevestiging van de projecteigenaar** (bevestigd: wegwerpbare ontwikkeldata, geen productiedata) verwijderd via expliciete, zichtbare SQL (`DROP SCHEMA ... CASCADE`) — niet via het ondoorzichtige `prisma migrate reset`-commando. Twee andere bestaande schemas (`notification`, `staging`) en alle Supabase-systeemschemas zijn nooit aangeraakt.

`Historisch feit` — Vier database-rollen (`clm_api`, `clm_admin`, `clm_readonly`, `clm_audit_reader`) zijn al eerder gedefinieerd in de originele `mvm-api-pilot`-migraties, met `NOLOGIN` en (bevestigd via latere verificatie) zonder `BYPASSRLS`. Deze rollen overleefden de schema-drop (rollen zijn cluster-breed in PostgreSQL, niet schema-gebonden) en bestaan dus nog. **Ontbrekend:** nooit is een inlogbare gebruiker aan `clm_api` gekoppeld (`GRANT clm_api TO ...`) — dit verklaart waarom de huidige verbinding via de kale Supabase-superuser-rol loopt.

`Open risico` — De huidige runtime-databaseverbinding gebruikt de Supabase `postgres`-superuser-rol, bevestigd met `rolbypassrls: true`. Dit is een actieve P0-blokkade.

`Actuele verwijzing` — Volledige impactanalyse: `docs/architecture-review/2026-07-24/03-data-security-and-rls.md`. Actuele status: `docs/STATUS.md`.

---

## Docker/WSL/lokale ontwikkelcontext (naslag, geen actieve instructie)

`Historisch feit` — Bij aanvang was Docker niet geïnstalleerd; WSL2 stond niet aan op de ontwikkelmachine. Traject: `wsl --install` faalde herhaaldelijk omdat gebruikte PowerShell-vensters niet daadwerkelijk verhoogd (Administrator) waren ondanks de indruk dat ze dat waren. Root cause uiteindelijk gevonden via `dism.exe /online /get-featureinfo`: de Windows-feature "Microsoft-Windows-Subsystem-Linux" stond op `Disabled` (VirtualMachinePlatform stond al wel aan). Opgelost met `dism.exe /online /enable-feature`, gevolgd door een herstart. Daarna werkten WSL2 en Docker Desktop normaal.

`Historisch feit` — Geen Docker-account/login nodig voor lokaal gebruik van Docker Desktop.

---

## Reeds uitgevoerde technische stappen

`Historisch feit` — NestJS-skeleton en health-check-endpoint (Taak 1-2 van het oorspronkelijke 16-taken-implementatieplan) zijn gebouwd, getest en gecommit.

`Historisch feit` — Docker Compose-stack (mcm2-api + minio + valkey) is opgezet en health-check via Docker is geverifieerd.

`Historisch feit` — Eerste Prisma-schema (4 modellen: Tenant, User, Vendor-cluster, AuditEvent, plus ref-lookup-tabellen) en de bijbehorende migratie zijn uitgevoerd tegen de schone `clm-enterprise`-database, inclusief RLS-policies (`USING`+`WITH CHECK`) en seed-data.

`Open risico` — De RLS-policies zelf zijn correct opgesteld, maar **niet effectief** zolang de runtime-rol `BYPASSRLS` heeft (zie hierboven). Een eerdere "RLS werkt"-verificatie in deze sessie was vals-positief: de tabel was toen leeg, wat geen bewijs is dat RLS de rol daadwerkelijk blokkeert.

`Vervangen besluit` — Tenant-resolutie werd oorspronkelijk 1-op-1 uit de C#-pilot overgenomen: header → query-param → fallback "demo", zonder identiteitsverificatie. Dit was een bewuste, pragmatische Fase 0-keuze, maar is inmiddels **erkend als onvoldoende** zodra er een externe/tweede tenant bijkomt (zie P0 in `docs/STATUS.md`).

---

## Prisma 7 — historische technische context (voorwaardelijk, geen actieve instructie)

`Vervangen besluit` — Prisma ORM werd initieel gekozen (niet Supabase JS client, niet Kysely, niet Drizzle) omdat de opdrachtgever geen IT-professional is en fool-proof/onderhoudbaar zwaarder woog dan minimale abstractie. **Deze keuze is inmiddels heropend** — zie P1 in `docs/STATUS.md` en `docs/architecture-review/2026-07-24/04-orm-decision-record.md`.

`Historisch feit` — Tijdens implementatie bleek Prisma major-versie 7 een reeks harde breaking changes te introduceren t.o.v. het oorspronkelijke plan (geschreven voor Prisma 5/6):
- De generator-provider moet `"prisma-client"` zijn (niet het oudere `"prisma-client-js"`), met een verplicht `output`-pad.
- `datasource db { url = ... }` in `schema.prisma` wordt niet meer geaccepteerd — de connectiestring voor de CLI verhuist naar een los `prisma.config.ts`; de runtime-client vereist een verplichte driver-adapter (`@prisma/adapter-pg`) die aan de `PrismaClient`-constructor wordt doorgegeven.
- De `multiSchema`-preview-flag is niet meer nodig (General Availability sinds Prisma 6.13).
- Alle imports van `PrismaClient`/`Prisma` moeten via het gegenereerde output-pad lopen in plaats van rechtstreeks `@prisma/client`.
- De generator-provider is ESM-first en genereert standaard syntax die niet compatibel is met een CommonJS-testrunner (Jest via ts-jest) — vereist expliciete `moduleFormat = "cjs"` én `importFileExtension = "ts"` generator-instellingen om unit-tests te laten werken.
- **Bevestigd, reproduceerbaar, structureel probleem:** de combinatie van instellingen die Jest-tests laat slagen (`importFileExtension = "ts"`) is **incompatibel** met de gecompileerde Docker-productiebuild (`node dist/main.js` crasht met een module-resolutiefout), en omgekeerd. Daarnaast faalt elke e2e-test die een echte databaseverbinding opzet op een `TypeError: A dynamic import callback was invoked without --experimental-vm-modules`-fout, veroorzaakt door Prisma 7's WASM-gebaseerde query-compiler.
- Twee onafhankelijke bronresearches bevestigden dat dit een bekend, nog onopgelost issue is op de officiële Prisma-repository (niet een lokale configuratiefout).

`Nog te verifiëren` — Of Prisma 6 (met de oudere, bewezen engine-architectuur) dit specifieke conflict vermijdt zonder een nieuw, vergelijkbaar probleem te introduceren voor de exacte Transdev-survey-schema-indeling (meerdere Postgres-schemas). Dit is precies het doel van de nog uit te voeren P1-spike.

`Actuele verwijzing` — Volledige beslismatrix en spike-opzet: `docs/architecture-review/2026-07-24/04-orm-decision-record.md`. Deze historische Prisma-7-technische-details zijn **niet** een instructie om te volgen — ze zijn alleen relevant als de spike alsnog voor Prisma kiest, of als referentiemateriaal mocht een vergelijkbaar versie-conflict zich later herhalen.

---

## Bekende secrets-/credentialrisico's (zonder secrets te tonen)

`Open risico` — `mvm-api-pilot` bevat een configuratiebestand met een Supabase-wachtwoord in leesbare tekst. Dit bestand stond op het moment van eerdere controle niet in de git-tracked bestanden van de huidige HEAD van dat project, maar mogelijk wel in eerdere commits — dit is destijds als "nog te verifiëren" genoteerd en nooit definitief afgerond. Dit wachtwoord hoort bij dezelfde databaserol die ook voor MCM2 in gebruik was/is — de geplande P0-rolrotatie in `docs/STATUS.md` lost dit lek in dezelfde beweging op, mits daadwerkelijk uitgevoerd.

`Open risico` — Tijdens diagnosewerk in deze projectgeschiedenis toonde het commando `docker compose config` het database-wachtwoord in leesbare tekst in de terminal-output, puur door omgevingsvariabelen te interpoleren. Dit is gemeld, niet elders herhaald. Reden voor de expliciete waarschuwing in de huidige `MCM2-CLAUDE.md` over dit soort schijnbaar onschuldige diagnosecommando's.

`Historisch feit` — Secretsbeheer voor Fase 0 is bewust bij een lokale `.env` (nooit gecommit) gehouden — geen overkill voor een team van één developer. Een toekomstige overstap naar Doppler of 1Password-CLI is expliciet als latere, aparte beslissing genoteerd, niet als iets om nu voor te bereiden anders dan consequent alle secrets via omgevingsvariabelen te laten lopen.

---

## Transdev als eerste concrete MVP-use-case

`Historisch feit` — Na de initiële architectuur-/securitybeoordeling is een concrete eerste klant-usecase toegevoegd: Transdev Nederland, met een jaarlijkse Vendor IT Compliance Survey als de kleinste bewijsbare productieslice (niet de volledige, bredere MVP-scope uit het externe `MVP_TRANSDEV.md`-document).

`Historisch feit` — Klantvragen zijn deels beantwoord door de projecteigenaar, optredend als Transdev-beheerder voor de pilot: 30-dagen-tokenvervaltermijn voor survey-response-links, niet-corrigeerbare (definitieve) indiening, verzending via Transdev's eigen SMTP namens `contractmanagement@transdev.nl` (i.p.v. het eerder voorziene Amazon SES), circa 50 vendors in de eerste ronde, deadline 1 september 2026. Interne authenticatie: mogelijk testbaar via een Microsoft-zakelijk account van de projecteigenaar in een Cognito+Entra ID-federatiespike, met een tijdelijk vereenvoudigd alternatief als fallback.

`Nog te verifiëren` — Vijf klantvragen staan nog open (exportformaat, of toelichting bij bepaalde antwoordopties verplicht is, upload-validatie-eisen, welke vraag welk type heeft, en de daadwerkelijke SMTP-verbindingsdetails).

`Actuele verwijzing` — Volledige scope, rollen, journeys en acceptatiecriteria: `docs/architecture-review/2026-07-24/08-transdev-mvp-scope.md`. Actuele openstaande vragen: `docs/STATUS.md`.

---

## AWS als toekomstig productiedoel

`Historisch feit` — AWS is gekozen als beoogd productiedoel omdat MCM2/Bizaline op termijn een bestaande Bizaline-applicatie moet vervangen die al op AWS draait (gedeelde Route 53, SES, billing-account-voordelen). Dit is een bewuste "goedkoopste moment"-overweging: rechtstreeks tegen een andere provider bouwen en later naar AWS migreren zou een herbouw zijn.

`Historisch feit` — Cognito is gekozen als federatielaag vóór het bestaande Entra ID (niet als vervanging) — Microsoft-tenants blijven inloggen via Entra ID, Cognito routeert en geeft het JWT uit. Reden: een tweede identity-provider wordt dan een configuratie-actie, geen herbouw.

`Vervangen besluit` — Eerder vastgelegd principe "geen AWS-specifieke code vóór Fase 5" is genuanceerd: vóór de Transdev-pilot is een kleine, minimale AWS-acceptatieomgeving toegestaan (niet de volledige doelarchitectuur), om te bewijzen dat het Docker-image ook buiten de lokale ontwikkelmachine draait.

`Actuele verwijzing` — Volledige AWS-fasering: `docs/architecture-review/2026-07-24/06-prioritized-roadmap.md` en de huidige `MCM2-CLAUDE.md`, sectie AWS-richting.
