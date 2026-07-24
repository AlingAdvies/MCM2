# Executive Summary — MCM2 Architectuurbeoordeling

**Datum:** 2026-07-24 (bijgewerkt: MVP-scope Transdev toegevoegd)
**Scope:** onafhankelijke architectuur-, security- en onderhoudbaarheidsbeoordeling van de MCM2-backend (Fase 0), vóór verdere implementatie.
**Aanleiding:** Prisma 7 gaf tijdens implementatie een structureel conflict tussen Jest-tests en de gecompileerde Docker-productiebuild. Dit is uitgegroeid tot een bredere beoordeling van de gehele stack, nu aangescherpt met een concrete eerste MVP-klant: **Transdev Nederland, Vendor IT Compliance Survey** (zie 08-transdev-mvp-scope.md).

---

## Huidige status

MCM2 bevindt zich in Fase 0: een NestJS-skeleton, Docker Compose (api + minio + valkey), en een eerste Prisma-schema met migratie (4 kernmodellen: tenant, user, vendor-cluster, audit-event) zijn opgezet en tegen de Supabase-database (`clm-enterprise`, Postgres 17.6) uitgevoerd. Er is nog geen enkele domeinmodule gebouwd. Met de Transdev-scope is nu een **concrete, kleine eerste productieslice** vastgesteld: leveranciersbeheer + jaarlijkse compliance-survey met tijdgebonden, tokengebaseerde externe respons-links (zie 08-transdev-mvp-scope.md) — dit vervangt "willekeurig het vendors-endpoint bouwen" als richtinggevend criterium voor elke volgende technische keuze.

De frontend (MVM_V2) draait momenteel volledig op mock-data, geen auth-mechanisme, en de bredere MVP_TRANSDEV.md-scope (42 gap-items) noemt nog Azure Entra ID en een open AWS-vs-Azure-beslissing (T-11) — dit staat op gespannen voet met de huidige opdracht die AWS als beoogd productiedoel vaststelt. Dit is een open klantvraag (zie 08-transdev-mvp-scope.md, OV-1), geen zelfstandig genomen besluit.

## P0 — securityherstel, vóór elke andere actie (nieuw, hoogste prioriteit)

**Dit is onafhankelijk van de ORM-keuze, de Transdev-scope, of enige andere beslissing in dit document — en kan per direct.**

1. De huidige databaseverbinding gebruikt de Supabase `postgres`-superuser-rol, bevestigd met `rolbypassrls: true`. RLS is nu geen werkende beveiligingsgrens.
2. **Concreet, tijdens legacy discovery bevestigd (zie 09-legacy-discovery-plan.md):** een correct rollenmodel (`clm_api`, `clm_admin`, `clm_readonly`, `clm_audit_reader`, alle met `rolbypassrls=false`) bestaat al in de database — het is nooit afgemaakt. Er is nergens een `GRANT clm_api TO <inlogbare-gebruiker>`-statement uitgevoerd. Dit is dus geen nieuw ontwerp, maar het afmaken van een reeds aanwezig, correct plan.
3. Tenant-context wordt afgeleid uit een client-gestuurde header, zonder identiteitsverificatie — acceptabel als tijdelijke, gedateerde uitzondering voor intern gebruik, niet voor de Transdev-pilot met een echte externe leverancierstoegang (zie hieronder).

## Overige risico's

3. **Hoog, reproduceerbaar:** Prisma 7's WASM Client Engine geeft een bevestigd, structureel conflict tussen Jest-e2e-tests en de gecompileerde Docker-build (twee open, onopgeloste GitHub-issues).
4. **Middel:** geen CI/CD-straat, geen Dependabot-beleid, Docker-build zonder `npm ci`/multi-stage/non-root-user, één ongepind image.
5. **Middel:** geen logging/monitoring, geen gedocumenteerde backup/restore-procedure.
6. **Laag, informatief:** MVM_V2-inconsistenties (tenant-waarde `demo` vs. `transdev`, `contractService` altijd mock).

## Aanbevolen doelstack — ORM-spike nu getoetst aan de Transdev-slice

De ORM-spike (zie 04-orm-decision-record.md) wordt niet langer in het abstract uitgevoerd — **het enige criterium is of de gekozen optie de Transdev-survey-slice (vendor/contactpersoon, versieerbare template, tijdgebonden externe token, tenant-isolatie, audit) foutloos en zonder multi-schema-gedoe kan bouwen.** Prisma 6 en Drizzle blijven de twee kandidaten; geen van beide is nu al definitief gekozen.

## AWS — kleine acceptatieomgeving, niet de volledige doelarchitectuur

Voor de Transdev-pilot is **niet** de volledige AWS-productiearchitectuur (ECS Fargate-cluster, alle beveiligingsdiensten) nodig. Voorgesteld: één kleine, eenvoudige AWS-acceptatieomgeving (bijv. één Fargate-service of zelfs een eenvoudiger compute-optie, achter een basis-ALB, zonder WAF/GuardDuty/KMS/CloudTrail nu) — puur om vóór de pilot te bewijzen dat het Docker-image ook buiten de lokale machine draait. De volledige beveiligingslaag blijft "Before production", niet "Before pilot" (zie geactualiseerde 06-prioritized-roadmap.md).

## Interne vs. externe identiteit — expliciet gesplitst

Transdev-beheerder (intern, moet geauthenticeerd zijn — mechanisme nog open, zie OV-1) en externe leverancier (geen account, uitsluitend een tijdgebonden, niet-raadbaar token per survey-response) zijn **twee volledig gescheiden toegangsmodellen**, niet variaties van hetzelfde autorisatiepatroon. Dit is een architectuurprincipe, geen implementatiedetail — het bepaalt dat er twee aparte guard-mechanismen nodig zijn, niet één generieke.

## Beslissingen die de eigenaar nu moet nemen

1. **P0-securityherstel direct uitvoeren** (rolkoppeling afmaken + wachtwoordrotatie) — onafhankelijk van al het overige.
2. **Akkoord op de spike-aanpak, nu getoetst aan de Transdev-slice specifiek**, vóór een definitieve ORM-keuze.
3. **Beantwoorden van de resterende open Transdev-klantvragen** (OV-4, OV-6 t/m OV-9 — zie 08-transdev-mvp-scope.md) — met name OV-1 is inmiddels beantwoord en bepaalt via BP0/BP3 (zie 06-prioritized-roadmap.md) of een volwaardige interne authenticatie haalbaar is binnen de deadline.

## Tijdshorizon (geactualiseerd)

| Wanneer | Wat |
|---|---|
| **Nu (P0, vóór elke volgende regel productiecode)** | Databaserol-koppeling afmaken (`clm_api` → inlogbare gebruiker), wachtwoordrotatie |
| **Vóór de Transdev-pilot** | ORM-spike getoetst aan de survey-slice, kleine AWS-acceptatieomgeving, interne vs. externe identiteitssplitsing werkend, CI/CD-straat met tenant-isolatietest, de vijf open Transdev-vragen beantwoord |
| **Vóór productie (betalende klanten, bredere MVP_TRANSDEV.md-scope)** | Volledige OTAP-doorloop bewezen, backup/restore-test, dependency-updatebeleid, volledige AWS-beveiligingslaag |
| **Later** | Volledige AWS-doelarchitectuur (Fase 5), bredere MVP_TRANSDEV.md-functionaliteit (requirements, vergaderingen, e-mail-ingestion) buiten de survey-slice |

Volledige onderbouwing per punt in de overige documenten in deze map, met name 08 (scope) en 09 (legacy discovery).
