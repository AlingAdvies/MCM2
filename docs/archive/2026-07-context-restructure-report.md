# Context Restructure Report — MCM2

**Datum:** 2026-07-24
**Branch:** `chore/restructure-project-context`
**Uitgevoerd:** Fase B, na expliciete goedkeuring op het Fase A-plan (`docs/context-restructure-plan.md`).

---

## 1. Aangemaakte, gewijzigde en gearchiveerde bestanden

### Aangemaakt

| Bestand | Doel |
|---|---|
| `docs/context-restructure-plan.md` | Fase A-analysedocument (classificatie, doelstructuur, conflicttabel) |
| `docs/STATUS.md` | Enige actuele operationele waarheid (54 regels) |
| `docs/context/PROJECT-HISTORY-2026-07-24.md` | Gelabelde samenvatting van de sessiegeschiedenis, geen secrets |
| `docs/archive/MCM2-CLAUDE-2026-07-24-pre-restructure.md` | Volledige, ongewijzigde kopie van de oude `MCM2-CLAUDE.md`, met waarschuwing bovenaan |
| `docs/adr/ADR-001-backendtaal-en-framework.md` | TypeScript/NestJS-keuze |
| `docs/adr/ADR-002-database-supabase-postgresql.md` | Supabase-keuze, met vier expliciete openstaande controls |
| `docs/adr/ADR-003-multi-schema-indeling.md` | `clm`/`ref`/`audit`-schema-indeling |
| `docs/adr/ADR-004-valkey-in-plaats-van-redis.md` | Valkey i.p.v. Redis |
| `docs/adr/ADR-005-nodejs-versie.md` | Node.js 24 |
| `docs/adr/ADR-006-cognito-als-federatielaag.md` | Cognito-principe, uitvoering nog niet afgerond — *nadien herzien: het besluit is op 2026-07-27 gewijzigd naar Microsoft Entra External ID en het bestand is hernoemd naar `ADR-006-ciam-laag-entra-external-id.md`* |
| `docs/context-restructure-report.md` | Dit rapport |
| Mappen: `docs/archive/`, `docs/context/`, `docs/adr/`, `docs/runbooks/` | Nieuwe doelstructuur (runbooks blijft leeg, geen functionaliteit om over te schrijven) |

### Gewijzigd (overschreven)

| Bestand | Wijziging |
|---|---|
| `MCM2-CLAUDE.md` | Volledig vervangen door de door de gebruiker geleverde governance-tekst, ongewijzigd overgenomen |

### Bewust ongewijzigd

- `docs/architecture-review/2026-07-24/*.md` (alle tien documenten) — geen aanleiding om te wijzigen, blijven de bron voor architectuur-/securitybevindingen.
- `docs/superpowers/plans/` en `docs/superpowers/specs/` — historische plannen/specs, buiten scope van deze herstructurering.
- `README.md` — nog ongewijzigde NestJS-CLI-boilerplate; buiten scope, wel gesignaleerd in het Fase A-plan als bevinding (bevat nul projectspecifieke inhoud).
- `claude_master.md` — de opdrachtinstructie die tot de architectuurbeoordeling leidde; blijft in de repository-root staan, geen onderdeel van deze herstructurering om te verplaatsen.
- Productiecode, `prisma/schema.prisma`, `src/`, dependencies, Docker-configuratie, cloudconfiguratie, CI/CD, `.env` — **niets hiervan is aangeraakt.** De ongecommitte wijzigingen die al in de working tree stonden vóór deze opdracht (`prisma/schema.prisma`, `src/app.module.ts`, `src/common/`, `src/prisma/*`) zijn van een eerdere, niet-afgeronde sessie en blijven ongewijzigd staan — ze horen niet bij deze documentatiecommit.

---

## 2. Open blokkades in `docs/STATUS.md`

- **P0:** runtime database role heeft `BYPASSRLS` — RLS is momenteel geen effectieve tenant-isolatiegrens.
- **P0:** tenantcontext komt nog blind uit client-input, zonder geverifieerde identiteit.
- **P1:** ORM-keuze Prisma 6 versus Drizzle nog open; Prisma 7 geblokkeerd wegens een bevestigd Jest/Docker-buildconflict.
- Geen CI/CD-workflows actief (`.github/workflows/` bestaat niet — feitelijk geverifieerd tijdens deze opdracht).
- Vijf resterende Transdev-klantvragen (exportformaat, toelichting-verplichting, upload-validatie, vraagtype-toewijzing, SMTP-details).
- Interne-authenticatie-spike (Cognito+Entra ID) nog niet uitgevoerd.

## 3. Aangemaakte ADR's

Zes ADR's, alle met status "Accepted" (ADR-002 en ADR-006 met expliciete nuance — respectievelijk openstaande controls en een nog niet afgeronde uitvoering, geen onvoorwaardelijk afgedaan besluit):

1. ADR-001 — Backendtaal en framework (TypeScript/NestJS)
2. ADR-002 — Database (Supabase PostgreSQL, met vier open controls: backup/restore-test, tier/SLA-verificatie, runtime-role-scheiding, dataverwerkingsvalidatie)
3. ADR-003 — Multi-schema-indeling (`clm`/`ref`/`audit`)
4. ADR-004 — Valkey in plaats van Redis
5. ADR-005 — Node.js-versie (24)
6. ADR-006 — Cognito als federatielaag (principe geaccepteerd, Transdev-pilot-uitvoering nog niet afgerond)

**Geen ORM-ADR aangemaakt** — conform expliciete instructie, aangezien de Prisma 6 vs. Drizzle-spike nog niet is uitgevoerd.

## 4. Interne documentlinks

Alle links in de nieuwe `MCM2-CLAUDE.md`, `docs/STATUS.md`, de zes ADR's en `docs/context/PROJECT-HISTORY-2026-07-24.md` zijn gecontroleerd tegen het bestandssysteem:

- Alle verwezen paden bestaan (`docs/STATUS.md`, `docs/adr/`, `docs/architecture-review/`, `docs/archive/`, `docs/runbooks/`, `README.md`, beide externe CLAUDE.md-bestanden).
- Eén verwijzing (`docs/context-restructure-report.md`, genoemd in `docs/STATUS.md`) wees vooruit naar dit rapport, dat op het controlemoment nog niet bestond — inmiddels aangemaakt, link is nu geldig.
- `docs/DEPENDENCIES.md`, genoemd als "of"-alternatief voor het versiebeleid, bestaat niet — dit is geen probleem, de tekst noemt het als optie, niet als verplichte verwijzing.

## 5. Gevonden inconsistenties (uit Fase A, nu verwerkt)

- Interne inconsistentie in de oude `MCM2-CLAUDE.md`: "Redis" in de tooling-tabel vs. "Valkey" in de versietabel — opgelost doordat de nieuwe governance-tekst dit onderscheid niet meer als losse tabel bevat (Valkey/versiebeleid is nu apart gedocumenteerd via ADR-004 en verwijst naar `docs/STATUS.md`/`docs/DEPENDENCIES.md` voor actuele versies).
- AWS-beveiligingsdiensten-timing ("inbouwen vanaf Fase 0/1") stond op gespannen voet met de latere Transdev-pilot-prioritering (Before production, niet Before pilot) — opgelost: de nieuwe governance-tekst (sectie 9) maakt expliciet onderscheid tussen "lokaal bouwen", "vóór Transdev-pilot" en "productie/hardening".
- Cognito-uitvoeringsstatus stond als afgerond besluit in de oude tekst, terwijl de Transdev-scope een nog niet uitgevoerde spike introduceerde — opgelost via ADR-006, dat expliciet het principe (Accepted) scheidt van de uitvoeringsstatus (nog niet afgerond).
- ORM-keuze stond als afgerond besluit in oudere sessienotities, terwijl de architectuurbeoordeling dit heropende — opgelost: geen ORM-ADR, P1 expliciet in `docs/STATUS.md`, Prisma-specifieke technische details verhuisd naar `docs/context/` als voorwaardelijke historische context.

## 6. Actuele blockers (herhaling, zie ook §2)

P0 (databaserol + tenantcontext) en P1 (ORM-keuze) blijven de enige twee blokkerende categorieën. Beide zijn onafhankelijk van elkaar oplosbaar — P0 kan en moet eerst, ongeacht de ORM-uitkomst.

## 7. Eerstvolgende veilige, nog niet uitgevoerde stap

**P0-securityherstel**: een inlogbare Postgres-gebruiker koppelen aan de reeds bestaande `clm_api`-rol (`GRANT clm_api TO ...`) en het huidige wachtwoord roteren. Dit is de enige stap die nu al kan, onafhankelijk van de nog te plannen ORM-spike of de resterende Transdev-klantvragen — en is expliciet **niet** onderdeel van deze documentatie-herstructurering, vereist een aparte, nieuwe opdracht met expliciete goedkeuring zodra deze wordt gestart.
