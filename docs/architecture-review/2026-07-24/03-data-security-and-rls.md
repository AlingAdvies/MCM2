# Data Security en Row-Level Security — MCM2

---

## Kritieke bevinding — bevestigd, niet aangenomen

De actieve `DATABASE_URL`-connectie gebruikt de Supabase-gebruikersnaam `postgres.agojesdovwsupidwlevh` (het standaardpatroon `postgres.<project-ref>` van de Session Pooler wijst altijd naar de Postgres-hoofdrol van het project, geen aparte applicatierol).

Query uitgevoerd tegen deze connectie:

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
```

Resultaat:
```
rolname: 'postgres', rolsuper: false, rolbypassrls: true
```

**Gevolg:** elke RLS-policy op elke tabel in `clm`, `ref` of `audit` wordt door deze rol **genegeerd**, ongeacht hoe correct de policy zelf is opgesteld (`USING`/`WITH CHECK`, beide aanwezig — zie migratiebestand `prisma/migrations/20260724140521_init_tenant_vendor_audit/migration.sql`). De eerdere verificatie in dit project ("query zonder tenant-context geeft 0 rijen") was geldig omdat de tabel op dat moment leeg was — het was geen bewijs dat RLS de rol blokkeert, en zou dat ook niet hebben gedaan als er wél data in stond.

Dit is **onafhankelijk van de ORM-keuze** (Prisma, Drizzle, Kysely of kaal `pg` maakt hier geen verschil) — het zit in de databaserol van de connectiestring.

---

## Vereist rollenmodel

| Rol | Gebruik | Eigenschappen |
|---|---|---|
| **Owner/migratie-rol** | `prisma migrate deploy` / equivalent in CI, en handmatige DDL-noodgevallen | Mag schema wijzigen, hoeft geen `BYPASSRLS`, alleen gebruikt in CI en door de eigenaar zelf, nooit in de draaiende applicatie |
| **Runtime-rol (applicatie)** | `PrismaService`/equivalent, alle request-verkeer | **`NOBYPASSRLS`** (expliciet, niet de default aannemen), alleen `SELECT`/`INSERT`/`UPDATE`/`DELETE`-rechten op de specifieke tabellen, geen `CREATE`/`DROP`/`ALTER` |
| **Support/break-glass-rol** (optioneel, later) | Handmatige supportvragen die cross-tenant-inzicht vereisen | Aparte, gelogde, tijdelijk geactiveerde rol — nooit de standaardverbinding |

**Actie vereist (zie 06-prioritized-roadmap.md, categorie P0):** een dedicated Postgres-rol aanmaken in Supabase zonder `BYPASSRLS`, met alleen de rechten die de applicatie nodig heeft, en `DATABASE_URL` daarop laten wijzen. Het huidige wachtwoord (gebruikt voor de `postgres`-superuser-rol) dient te worden geroteerd zodra de nieuwe rol in gebruik is, omdat het wachtwoord in de sessie zichtbaar is geweest tijdens `docker compose config`-diagnostiek.

---

## Tenant-contextverificatie — huidige tekortkoming

`src/common/tenant/tenant.middleware.ts` leidt de tenant af uit:
1. `X-Tenant-Id`-header (client-gestuurd, geen verificatie), of
2. `?tenant=`-querystring-parameter → naam-lookup in `clm.tenant`, of
3. fallback naar `'demo'`.

Geen van deze paden controleert of de aanvrager daadwerkelijk bij die tenant hoort. Zolang er geen authenticatielaag is (Cognito is Fase 2), kan elke client zich voordoen als elke tenant door simpelweg een andere UUID/naam mee te sturen.

**Dit is acceptabel als tijdelijke, expliciet erkende beperking voor Fase 0/1** (geen externe gebruikers, alleen interne ontwikkeling tegen de `demo`-tenant), **niet acceptabel zodra een tweede echte tenant of externe gebruiker wordt toegevoegd.**

## Threat-scenario's

| Scenario | Huidige blootstelling | Mitigatie |
|---|---|---|
| Kwaadwillende client stuurt willekeurige `X-Tenant-Id` | **Volledig mogelijk nu** — middleware accepteert elke geldige UUID zonder verificatie | Tenant-claim uit geverifieerd JWT (Cognito), header negeren buiten expliciete, apart geautoriseerde support-flows |
| Applicatiebug omzeilt RLS via de huidige rol | **Volledig mogelijk nu** — rol heeft `BYPASSRLS` | Runtime-rol zonder `BYPASSRLS` (zie boven) |
| SQL-injectie via `tenantId` in `SET LOCAL` | Voorkomen — `withTenant()` valideert met UUID-regex vóór stringinterpolatie | Blijft nodig ongeacht ORM: `SET LOCAL` accepteert geen query-parameters, dus expliciete validatie vóór de raw SQL-string blijft verplicht |
| Achtergrondtaken/exports zonder requestcontext | Nog niet gebouwd — geen `BullMQ`-consumer bestaat nog | Ontwerp vereist: elke achtergrondtaak moet zijn eigen `SET LOCAL`-transactie openen met een expliciet meegegeven tenantId, nooit impliciet uit een request-scope |
| Supportmedewerker heeft cross-tenant-inzicht nodig | Nog niet ontworpen | Aparte, gelogde break-glass-rol/flow, met verplichte audit-event-registratie van elk gebruik |

## Verplichte geautomatiseerde tenant-isolatietests

Het bestaande implementatieplan (Taak 14) had al een tenant-isolatietest-opzet (twee testtenants, cross-tenant lezen/schrijven verwacht geblokkeerd). Deze test is **nooit uitgevoerd** omdat de e2e-testomgeving faalt op het Prisma 7/Jest-conflict (zie 01-current-state-inventory.md). Zodra de ORM-keuze definitief is (zie 04), moet deze test:

1. Draaien tegen de **runtime-rol**, niet tegen de owner/migratie-rol — anders test hij niets zinvols (zie kritieke bevinding hierboven).
2. Expliciet controleren dat `rolbypassrls = false` voor de gebruikte testverbinding, als voorwaarde vóór de eigenlijke isolatietest (fail-fast als de rol verkeerd is geconfigureerd).
3. Onderdeel worden van de verplichte CI-poort (zie 05-otap-and-maintenance-model.md) — een PR die deze test niet laat slagen, is niet mergebaar.

## Audit-trailontwerp

Reeds aanwezig in het schema: `audit.audit_event` (append-only, `tenant_id`, `action_type`, `entity_type`, `entity_id`, `old_values`/`new_values` als JSONB, `created_at`). `AuditService.record()` (Taak 9 van het implementatieplan, nog niet gecommit op moment van deze review) schrijft binnen dezelfde transactie als de mutatie zelf — correct patroon, mits de onderliggende transactie ook echt binnen de RLS-context valt (afhankelijk van de rol-fix hierboven).

**Open risico:** er is nog geen retentie-/onveranderlijkheidsgarantie op `audit.audit_event` zelf (bijv. een `REVOKE UPDATE, DELETE`-policy voor de runtime-rol op deze specifieke tabel, zodat zelfs een gecompromitteerde applicatie audit-records niet kan wijzigen/verwijderen). Aanbevolen toe te voegen aan de rollenmodel-migratie.

## Open risico's (samenvattend)

1. `rolbypassrls: true` op de actieve connectie — **kritiek, nu oplosbaar, onafhankelijk van ORM-keuze**.
2. Tenant-context zonder identiteitsverificatie — **kritiek voor elke situatie met meer dan één tenant/externe gebruiker**, acceptabel als tijdelijke, gedateerde uitzondering voor Fase 0/1 intern gebruik.
3. Geen `REVOKE`-bescherming op `audit.audit_event` tegen de runtime-rol.
4. Geen ontwerp voor achtergrondtaken/cross-tenant-support-toegang — nog te maken zodra deze functionaliteit wordt gebouwd.
5. Wachtwoord van de huidige (te vervangen) rol is zichtbaar geweest in terminal-output tijdens deze review — rotatie aanbevolen als voorzorg, ongeacht de rol-vervanging.
