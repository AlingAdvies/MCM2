# OTAP en Onderhoudsmodel — MCM2

> **Historisch document — externe architectuurreview van 2026-07-24.**
> Twee delen hiervan zijn opgevolgd en mogen niet meer als actueel gelezen worden:
>
> - **De paragraaf "Backup/restore" is feitelijk achterhaald.** Er staat dat
>   Supabase managed backups biedt "afhankelijk van het gekozen plan". Op
>   2026-07-28 is vastgesteld dat het Free-plan waar dit project op draait
>   **géén enkele backup** levert. Leidend is **ADR-011**.
> - **De "Maandelijkse onderhoudskalender (voorstel)" is nooit vastgesteld** en is
>   opgevolgd door **`docs/runbooks/onderhoudskalender.md`**, dat wel de
>   werkelijke ritmes bevat. Waar de twee elkaar tegenspreken — de restore-hertest
>   staat hier op "per kwartaal", in ADR-011 op maandelijks — wint de kalender.
>
> De rest van dit document (CI-poorten, dependency-beleid, versiebeleid) staat er
> onveranderd en is nog steeds bruikbaar als referentie.

---

## P0 — securityherstel, voorafgaand aan elke OTAP-stap

**Dit onderdeel gaat vóór alle andere OTAP-inrichting.** Geen CI-poort, staging-omgeving of productiepromotie heeft waarde zolang de databaseverbinding via een rol met `rolbypassrls: true` loopt (zie 03-data-security-and-rls.md). Concreet, twee acties, geen van beide afhankelijk van de rest van dit document:

1. Een inlogbare Postgres-gebruiker koppelen aan de reeds bestaande `clm_api`-rol (`GRANT clm_api TO <nieuwe-gebruiker>`) — deze rol bestaat al met `rolbypassrls=false`, alleen de koppeling ontbreekt (zie 09-legacy-discovery-plan.md).
2. Wachtwoordrotatie van de huidige `postgres`-superuser-rol, en `DATABASE_URL` laten wijzen naar de nieuwe, beperkte gebruiker.

Pas ná deze twee stappen heeft een CI-poort als "RLS-isolatietest" (zie hieronder) enige bewijskracht.

## Kleine AWS-acceptatieomgeving vóór de pilot — niet de volledige doelarchitectuur

Voor de Transdev-pilot (zie 08-transdev-mvp-scope.md) is een **minimale** AWS-acceptatieomgeving voldoende om te bewijzen dat het Docker-image ook buiten de lokale machine draait: één eenvoudige compute-optie (bijv. één Fargate-service of een vergelijkbaar minimale variant) achter een basis-load balancer, met de bestaande Supabase-database (geen aparte AWS-database nodig). **Nog niet nodig voor de pilot:** WAF, GuardDuty, KMS, CloudTrail, SNS-alarmering, malware-scan — deze blijven "Before production" (zie geactualiseerde 06-prioritized-roadmap.md), niet "Before pilot". Dit voorkomt dat de acceptatieomgeving zelf een groter project wordt dan de survey-slice die hij moet dragen.

## OTAP-flow

```
Feature-branch (feat/[onderwerp])
  → Pull Request naar main
      → GitHub Actions: verplichte kwaliteitspoorten (zie hieronder) — ALLE moeten slagen
  → Automatische deploy naar acceptatie-omgeving (staging) bij groene PR + merge
      → Handmatige functionele controle op staging (preview-URL of vaste staging-omgeving)
  → Handmatige productie-approval (nooit automatisch)
      → Dezelfde immutable Docker-image die op acceptatie draaide, gepromoveerd naar productie
      → Feature flags standaard UIT voor nieuwe/klantspecifieke functionaliteit
  → Rollback: vorige immutable image opnieuw activeren — gedocumenteerde, eenvoudige actie
```

Dit bouwt voort op wat al in `MCM2-CLAUDE.md` staat vastgelegd (OTAP-stappen O/T/A/P) — deze sectie maakt het concreet en toetsbaar.

## Verplichte CI-kwaliteitspoorten

Elke pull request naar `main` moet **alle** onderstaande checks doorstaan vóórdat mergen mogelijk is:

| Check | Commando (indicatief) | Faalt de PR bij |
|---|---|---|
| Format | `prettier --check` | Niet-geformatteerde bestanden |
| Lint | `eslint` (zonder `--fix` in CI) | Elke error (huidige 23 errors moeten eerst opgelost worden — zie 06-prioritized-roadmap.md) |
| Typecheck | `tsc --noEmit` of `nest build` | Elke TypeScript-fout |
| Unit tests | `jest` | Elke falende test |
| E2e tests | `jest --config test/jest-e2e.json` | Elke falende test — **momenteel blokkerend kapot, zie 01-current-state-inventory.md; moet opgelost zijn vóór deze poort geactiveerd kan worden** |
| RLS-isolatietest | Specifieke e2e-suite: twee testtenants, cross-tenant lezen/schrijven moet 0 resultaten/404 geven | Elke lek — **moet draaien tegen de runtime-rol, niet de owner-rol (zie 03-data-security-and-rls.md)** |
| Token-isolatietest (Transdev-specifiek) | Specifieke e2e-suite: een survey-response-token van tenant/vendor A mag nooit data óf het geüploade certificaat van tenant/vendor B retourneren, ook niet via geraden/opeenvolgende token-waarden of directe bestands-URL's | Elke lek — dit is acceptatiecriteria AC9/AC13 uit 08-transdev-mvp-scope.md, dus verplicht vóór de pilot, niet optioneel |
| Migratie-test op lege database | `migrate deploy` (of ORM-equivalent) tegen een verse Postgres-container in CI | Elke migratiefout |
| Docker-build | `docker build` | Elke buildfout |
| Dependency-scan | `npm audit` (met gedocumenteerde, beoordeelde uitzonderingen — zie hieronder) | Nieuwe high/critical-severity kwetsbaarheden buiten de geaccepteerde lijst |

**Huidige stand:** geen van deze poorten bestaat als geautomatiseerde CI-stap (`.github/workflows/` ontbreekt volledig). Dit is de belangrijkste ontbrekende stap richting "vóór eerste pilot".

**Bekende, beoordeelde `npm audit`-uitzondering:** `find-my-way`-kwetsbaarheid in `@prisma/dev` (dev-tooling van de Prisma CLI zelf, niet in productiecode, niet netwerkbereikbaar). Dit soort uitzonderingen moet expliciet gedocumenteerd worden (bijv. in een `audit-ci.json`-allowlist met vervaldatum/reviewmoment), niet stilzwijgend genegeerd.

## Dependency-updatebeleid (Dependabot)

Nog niet geconfigureerd (`.github/dependabot.yml` ontbreekt). Voorgesteld beleid:

| Update-type | Beleid |
|---|---|
| **Patch** (`x.y.Z`) | Automatisch aanmaken, automatisch mergen zodra CI groen is (laag risico, geen API-wijzigingen per semver-conventie) |
| **Minor** (`x.Y.z`) | Automatisch aanmaken, handmatige review vóór merge (nieuwe features, zelden breaking, maar de moeite waard om te zien) |
| **Major** (`X.y.z`) | Automatisch aanmaken als los issue/PR, **nooit automatisch mergen** — vereist expliciete beoordeling, en voor kernafhankelijkheden (NestJS, de gekozen ORM, TypeScript) een korte impact-check vergelijkbaar met deze architectuurbeoordeling. De Prisma 7-episode in dit project is het directe bewijs waarom dit noodzakelijk is. |

## Versiebeleid

- Elke dependency-versie expliciet vastgelegd via `package-lock.json` (reeds het geval) — **maar** `npm ci` moet in Docker/CI gebruikt worden in plaats van `npm install` om dit ook daadwerkelijk af te dwingen (huidige Dockerfile gebruikt `npm install`, zie 01-current-state-inventory.md).
- Docker-images gepind op een specifieke versie/tag, nooit `latest` — huidige afwijking: `minio/minio:latest` moet vervangen worden door een vastgepinde versie.
- Node.js-versie vastgelegd in zowel `Dockerfile` (`node:24-alpine`) als een `.nvmrc`/`engines`-veld in `package.json` (laatste ontbreekt nog) zodat lokale ontwikkelomgevingen consistent blijven met Docker.
- Release-tagging: elke productie-promotie krijgt een git-tag die correspondeert met de immutable image-tag, zodat rollback ondubbelzinnig is.

## Backup/restore

Supabase biedt managed backups (afhankelijk van het gekozen plan/tier — dit is nog niet expliciet gecontroleerd/bevestigd voor het `clm-enterprise`-project en is een open actiepunt). Voorgesteld:

1. Bevestigen welk Supabase-backup-schema actief is (point-in-time-recovery-venster, back-upfrequentie).
2. Eén keer per kwartaal een daadwerkelijke restore-test uitvoeren naar een wegwerpbare testomgeving — een backup die nooit getest is, is geen bewezen backup.
3. Documenteren wie (de eigenaar zelf, met een stappenplan) een restore kan uitvoeren zonder specialistische hulp.

## Eenvoudige runbooks (indicatief, uit te werken zodra de betreffende functionaliteit bestaat)

| Situatie | Eigenaarshandeling | Specialistische hulp nodig bij |
|---|---|---|
| Health-check faalt in productie | Herstart de container via het CI/CD-dashboard (Fargate/ECS-equivalent) | Als herstart niet helpt binnen 15 minuten |
| Dependency-scan meldt nieuwe kwetsbaarheid | Beoordeel Dependabot-PR, merge indien patch/minor en CI groen | Bij major-versie-impact of onduidelijke breaking-change-risico's |
| Rollback na een mislukte release | Vorige image-tag opnieuw promoveren (gedocumenteerd commando) | Als de databasemigratie zelf niet terug te draaien is (zie Database-regels in MCM2-CLAUDE.md — geen destructieve migraties zonder eerst een schema-debt-issue) |
| Vermoeden van een datalek | Volg het incident-responsproces (zie `incident-response.md`-skill, Bizaline IT) | Altijd — dit is per definitie een specialistenmoment |

## Maandelijkse onderhoudskalender (voorstel)

| Frequentie | Actie |
|---|---|
| Wekelijks (automatisch) | Dependabot-patch-PR's laten mergen na groene CI |
| Maandelijks | Dependabot-minor-PR's beoordelen en mergen; `npm audit`-uitzonderingslijst controleren op vervaldatum |
| Per kwartaal | Backup-restore-test; review van deze architectuurbeoordeling op nog-geldigheid (met name het versiebeleid in `MCM2-CLAUDE.md`) |
| Per major-dependency-update | Korte impact-analyse vergelijkbaar met deze review — nooit blind updaten van NestJS, de ORM, of TypeScript |
