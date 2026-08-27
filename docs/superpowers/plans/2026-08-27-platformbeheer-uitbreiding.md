# Platformbeheer-uitbreiding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De platformbeheerder kan een tenant wijzigen (naam/antwoordEmail),
deactiveren (soft-delete), en met één klik als support-gebruiker naar een
tenant-omgeving springen — zonder een tweede Entra-login en zonder een apart
reden-formulier per keer.

**Architecture:** Drie nieuwe backend-routes op de bestaande
`PlatformController` (`PUT /platform/tenants/:id`,
`POST /platform/tenants/:id/deactiveren`,
`POST /platform/sessie/wisselen`, `POST /platform/sessie/eigen-tenant`), een
nieuwe database-functie `clm.sessie_wisselen()` die vanuit een bestaande
geldige sessie een tweede sessie voor een andere tenant aanmaakt (geen
Entra nodig), en een uitgebreide registertrigger die ook op `deleted_at`
reageert. Frontend voegt bewerk-/deactiveer-/openen-acties toe aan de
bestaande tenantlijst en een terugkeer-link in `OmgevingBanner`.

**Tech Stack:** NestJS, Drizzle (raw SQL, handgeschreven migratie),
PostgreSQL met RLS, Jest e2e tegen een wegwerpcontainer, Next.js in de
zusterrepo `MCM2-frontend`.

**Spec:** `docs/superpowers/specs/2026-08-27-platformbeheer-uitbreiding-design.md`

---

## Vooraf — testdatabase

```powershell
npm run test:db -- "platformbeheer-uitbreiding"
```

Exporteer de twee getoonde variabelen (`MIGRATION_DATABASE_URL`,
`DATABASE_URL`). Bij een volgende sessie op dezelfde container:
`npm run test:db -- "platformbeheer-uitbreiding" --hergebruik`.

---

### Taak 1: Migratie — deleted_at, trigger-uitbreiding, sessie_wisselen()

**Files:**
- Create: `drizzle/0033_platformbeheer_wijzigen_verwijderen.sql`
- Modify: `drizzle/meta/_journal.json`

- [x] **Step 1: Bekijk het bestaande trigger-patroon**

```powershell
Get-Content drizzle/0026_tenantregister.sql
```

- [x] **Step 2: Schrijf de migratie**

Maak `drizzle/0033_platformbeheer_wijzigen_verwijderen.sql`:

```sql
-- ── 0033 — Tenant wijzigen/deactiveren, sessiewissel voor platformbeheer ────
--
-- Drie losse toevoegingen voor de platformbeheer-uitbreiding (spec
-- 2026-08-27-platformbeheer-uitbreiding-design.md):
--
--   1. clm.tenant krijgt deleted_at (soft-delete, ontbrak nog).
--   2. De registertrigger (0026) reageert nu ook op deleted_at, anders
--      blijft een gedeactiveerde tenant zichtbaar in het RLS-vrije
--      register terwijl hij via clm.tenant zelf onbereikbaar is.
--   3. clm.sessie_wisselen(): een tweede sessie aanmaken vanuit een
--      bestaande geldige sessie, voor een tenant waar een geldig
--      (support-)membership op staat. Geen Entra-login nodig.

-- ── 1. deleted_at op clm.tenant ──────────────────────────────────────────────

ALTER TABLE clm.tenant ADD COLUMN deleted_at timestamptz;--> statement-breakpoint

COMMENT ON COLUMN clm.tenant.deleted_at IS
    'Soft-delete: NULL = actief. Een gedeactiveerde tenant kan niet meer inloggen (sessie_aanmaken, sessie_wisselen) en verdwijnt uit clm.tenant_register. Geen reactiveren-pad — zie de spec sectie 6.';--> statement-breakpoint

-- ── 2. Registertrigger uitgebreid: name EN deleted_at ────────────────────────
--
-- CREATE OR REPLACE vervangt de functie uit 0026 volledig; de trigger zelf
-- moet opnieuw aangemaakt worden omdat de kolomlijst van "UPDATE OF" niet
-- met CREATE OR REPLACE valt aan te passen.

CREATE OR REPLACE FUNCTION clm.tenant_register_bijhouden()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL THEN
        DELETE FROM clm.tenant_register WHERE register_id = NEW.tenant_id;
    ELSE
        INSERT INTO clm.tenant_register (register_id, name, aangemaakt_op)
        VALUES (NEW.tenant_id, NEW.name, COALESCE(NEW.created_at, now()))
        ON CONFLICT (register_id) DO UPDATE SET name = EXCLUDED.name;
    END IF;

    RETURN NEW;
END;
$$;--> statement-breakpoint

COMMENT ON FUNCTION clm.tenant_register_bijhouden() IS
    'Houdt clm.tenant_register gelijk aan clm.tenant: naam bijwerken bij UPDATE OF name, verwijderen uit het register bij een deactivering (UPDATE OF deleted_at, migratie 0033). SECURITY DEFINER omdat de aanroepende rol geen schrijfrecht op het register heeft.';--> statement-breakpoint

DROP TRIGGER tenant_register_bijhouden ON clm.tenant;--> statement-breakpoint

CREATE TRIGGER tenant_register_bijhouden
    AFTER INSERT OR UPDATE OF name, deleted_at ON clm.tenant
    FOR EACH ROW
    EXECUTE FUNCTION clm.tenant_register_bijhouden();--> statement-breakpoint

-- ── 3. clm.sessie_wisselen() ─────────────────────────────────────────────────
--
-- Bewijs van identiteit: een geldige, niet-verlopen sessie (p_huidige_token_
-- hash). Autorisatie: een geldig, niet-verlopen membership op de doeltenant,
-- en de doeltenant zelf niet gedeactiveerd. Geeft niets terug als een van
-- beide ontbreekt — zelfde stijl als sessie_aanmaken() (0010).

CREATE FUNCTION clm.sessie_wisselen(
    p_huidige_token_hash text,
    p_doel_tenant_id uuid,
    p_nieuwe_token_hash text,
    p_geldigheid interval
)
RETURNS TABLE (sessie_id uuid, user_id uuid, tenant_id uuid, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
DECLARE
    v_user_id uuid;
    v_role    text;
BEGIN
    SELECT s.user_id INTO v_user_id
      FROM clm.sessie s
     WHERE s.token_hash = p_huidige_token_hash
       AND s.verloopt_op > now();

    IF v_user_id IS NULL THEN
        RETURN;
    END IF;

    SELECT m.role INTO v_role
      FROM clm.tenant_membership m
      JOIN clm.tenant t ON t.tenant_id = m.tenant_id
     WHERE m.user_id = v_user_id
       AND m.tenant_id = p_doel_tenant_id
       AND m.deleted_at IS NULL
       AND (m.verloopt_op IS NULL OR m.verloopt_op > now())
       AND t.deleted_at IS NULL;

    IF v_role IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    INSERT INTO clm.sessie (token_hash, user_id, tenant_id, role, verloopt_op)
    VALUES (p_nieuwe_token_hash, v_user_id, p_doel_tenant_id, v_role,
            now() + p_geldigheid)
    RETURNING clm.sessie.sessie_id, clm.sessie.user_id,
              clm.sessie.tenant_id, clm.sessie.role;
END;
$$;--> statement-breakpoint

COMMENT ON FUNCTION clm.sessie_wisselen(text, uuid, text, interval) IS
    'Maakt, vanuit een bestaande geldige sessie, een tweede sessie aan voor een tenant waar de gebruiker een geldig membership op heeft — geen Entra-login nodig. Gebruikt door platformbeheer om na support-toegang direct te wisselen (spec 2026-08-27-platformbeheer-uitbreiding-design.md, sectie 5a). De oorspronkelijke sessie blijft bestaan.';--> statement-breakpoint

REVOKE ALL ON FUNCTION clm.sessie_wisselen(text, uuid, text, interval) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION clm.sessie_wisselen(text, uuid, text, interval) TO clm_api, clm_admin;--> statement-breakpoint

-- ── 4. clm.eigen_tenant_vinden() ─────────────────────────────────────────────
--
-- Voor de terugkeer-route (spec §5c): de blijvende (niet-support) tenant
-- van een gebruiker opzoeken. clm.tenant_membership heeft RLS met de policy
-- `tenant_id = clm.current_tenant_id()` (migratie 0009) — een gewone query
-- binnen withTenant(sessieTenantId, ...) ziet daardoor UITSLUITEND rijen
-- van de sessie-tenant (de support-tenant op dit moment), nooit de eigen
-- tenant die we juist zoeken. SECURITY DEFINER is hier nodig en
-- verdedigbaar om dezelfde reden als sessie_wisselen(): de functie neemt
-- zelf een user_id als parameter (geen tenant uit de invoer) en geeft alleen
-- een tenant_id terug, geen andere kolom.

CREATE FUNCTION clm.eigen_tenant_vinden(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
    SELECT tenant_id FROM clm.tenant_membership
     WHERE user_id = p_user_id
       AND role != 'support'
       AND deleted_at IS NULL
     ORDER BY created_at
     LIMIT 1;
$$;--> statement-breakpoint

COMMENT ON FUNCTION clm.eigen_tenant_vinden(uuid) IS
    'Zoekt de blijvende (niet-support) tenant van een gebruiker, voor de terugkeer-route na support-toegang (spec 2026-08-27-platformbeheer-uitbreiding-design.md, sectie 5c). SECURITY DEFINER omdat clm.tenant_membership RLS heeft op de sessie-tenant — vanuit een support-sessie zou een gewone query de eigen tenant nooit vinden.';--> statement-breakpoint

REVOKE ALL ON FUNCTION clm.eigen_tenant_vinden(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION clm.eigen_tenant_vinden(uuid) TO clm_api, clm_admin;--> statement-breakpoint
```

- [x] **Step 3: Voeg toe aan de journal**

In `drizzle/meta/_journal.json`, aan het einde van de `entries`-array (na
idx 32):

```json
    {
      "idx": 33,
      "version": "7",
      "when": 1787068800007,
      "tag": "0033_platformbeheer_wijzigen_verwijderen",
      "breakpoints": true
    }
```

Let op de komma na de vorige entry (idx 32) — die moet er nu bij staan
omdat dit niet meer de laatste entry is.

- [x] **Step 4: Migratie toepassen op de wegwerpdatabase**

```powershell
npx tsx scripts/migrate.js
```

Verwacht: geen fouten, migratie 0033 toegepast.

- [x] **Step 5: Handmatig teruglezen**

```powershell
docker exec <container> psql -U postgres -d postgres -c "\d clm.tenant" 2>&1 | Select-String "deleted_at"
```

Verwacht: `deleted_at | timestamp with time zone |` staat erin. (Containernaam
staat in de uitvoer van `npm run test:db`.)

- [x] **Step 6: Commit**

```bash
git add drizzle/0033_platformbeheer_wijzigen_verwijderen.sql drizzle/meta/_journal.json
git commit -m "feat(platform): migratie — tenant.deleted_at, trigger-uitbreiding, sessie_wisselen()"
```

---

### Taak 2: Backend — PlatformService uitbreiden

**Files:**
- Modify: `src/platform/platform.service.ts`

- [x] **Step 1: Bekijk de bestaande tenantAanmaken() en tenantLezen()**

```powershell
Get-Content src/platform/platform.service.ts | Select-String -Pattern "async tenantAanmaken|async tenantLezen" -Context 0,30
```

- [x] **Step 2: Voeg TenantWijziging-interface en tenantWijzigen() toe**

In `src/platform/platform.service.ts`, na de `TenantOverzicht`-interface
(rond regel 43):

```ts
export interface TenantWijziging {
  readonly naam: string;
  readonly antwoordEmail?: string;
}
```

Na de bestaande `tenantLezen()`-methode, vóór de sluitende `}` van de
klasse:

```ts
  /**
   * Past naam en/of antwoordEmail van een bestaande tenant aan
   * (platformbeheer-uitbreiding, spec §3).
   *
   * Zelfde unieke-naam-afhandeling als tenantAanmaken(): een conflict op
   * de naam-constraints wordt een leesbare 409, geen 500.
   */
  async tenantWijzigen(
    tenantId: string,
    invoer: TenantWijziging,
  ): Promise<TenantOverzicht | null> {
    return this.db.withTenant(tenantId, async (tx) => {
      const voor = await tx.execute<{ name: string; antwoord_email: string | null }>(
        sql`SELECT name, antwoord_email FROM clm.tenant WHERE tenant_id = ${tenantId}`,
      );

      if (voor.rows.length === 0) {
        return null;
      }

      try {
        await tx.execute(
          sql`UPDATE clm.tenant
                 SET name = ${invoer.naam},
                     antwoord_email = ${invoer.antwoordEmail ?? null}
               WHERE tenant_id = ${tenantId}`,
        );
      } catch (fout) {
        if (isUniekeNaamFout(fout)) {
          throw new ConflictException(
            `Er bestaat al een tenant met de naam '${invoer.naam}'.`,
          );
        }
        throw fout;
      }

      await tx.execute(
        sql`INSERT INTO audit.audit_event
              (tenant_id, action_type, entity_type, entity_id, old_values, new_values)
            VALUES (${tenantId}, 'tenant_gewijzigd', 'tenant', ${tenantId},
                    ${JSON.stringify({
                      naam: voor.rows[0].name,
                      antwoordEmail: voor.rows[0].antwoord_email,
                    })}::jsonb,
                    ${JSON.stringify({
                      naam: invoer.naam,
                      antwoordEmail: invoer.antwoordEmail ?? null,
                    })}::jsonb)`,
      );

      const na = await tx.execute<{
        tenant_id: string;
        name: string;
        created_at: string;
        leden: string;
      }>(
        sql`SELECT t.tenant_id, t.name, t.created_at,
                   (SELECT count(*) FROM clm.tenant_membership m
                     WHERE m.tenant_id = t.tenant_id AND m.deleted_at IS NULL) AS leden
              FROM clm.tenant t
             WHERE t.tenant_id = ${tenantId}`,
      );

      return {
        tenantId: na.rows[0].tenant_id,
        naam: na.rows[0].name,
        aangemaaktOp: new Date(na.rows[0].created_at),
        aantalLeden: Number(na.rows[0].leden),
      };
    });
  }
```

- [x] **Step 3: Voeg tenantDeactiveren() toe**

Direct na `tenantWijzigen()`:

```ts
  /**
   * Deactiveert een tenant (soft-delete, spec §4). Geeft `false` als de
   * tenant onbekend is of al gedeactiveerd was — de aanroeper vertaalt dat
   * naar 404, niet naar een stille 200.
   */
  async tenantDeactiveren(tenantId: string): Promise<boolean> {
    return this.db.withTenant(tenantId, async (tx) => {
      const resultaat = await tx.execute(
        sql`UPDATE clm.tenant
               SET deleted_at = now()
             WHERE tenant_id = ${tenantId}
               AND deleted_at IS NULL`,
      );

      if (resultaat.rowCount === 0) {
        return false;
      }

      await tx.execute(
        sql`INSERT INTO audit.audit_event
              (tenant_id, action_type, entity_type, entity_id)
            VALUES (${tenantId}, 'tenant_gedeactiveerd', 'tenant', ${tenantId})`,
      );

      return true;
    });
  }
```

- [x] **Step 4: Voeg eigenTenantVinden() toe**

Direct na `tenantDeactiveren()` (gebruikt door de sessie-terugkeer-route in
Taak 3). Roept `clm.eigen_tenant_vinden()` aan (Taak 1) in plaats van een
gewone `withTenant()`-query: `clm.tenant_membership` heeft RLS op
`tenant_id = clm.current_tenant_id()` (migratie 0009), dus een query binnen
`withTenant(sessieTenantId, ...)` ziet uitsluitend rijen van de
sessie-tenant — vanuit een support-sessie is dat de support-tenant, nooit
de eigen tenant die hier juist gezocht wordt. De `SECURITY DEFINER`-functie
omzeilt dat bewust en gecontroleerd, net als `sessie_wisselen()` zelf.

```ts
  /**
   * Zoekt de blijvende (niet-support) tenant van een gebruiker — voor de
   * terugkeer-route na support-toegang (spec §5c). Draait buiten
   * withTenant(): clm.eigen_tenant_vinden() is SECURITY DEFINER en omzeilt
   * de RLS-policy van clm.tenant_membership bewust, om dezelfde reden als
   * clm.sessie_wisselen() dat doet — zie de migratie.
   */
  async eigenTenantVinden(userId: string): Promise<string | null> {
    const resultaat = await this.db.db.execute<{
      eigen_tenant_vinden: string | null;
    }>(sql`SELECT clm.eigen_tenant_vinden(${userId})`);

    return resultaat.rows[0]?.eigen_tenant_vinden ?? null;
  }
```

- [x] **Step 5: Typecheck**

```powershell
npx tsc --noEmit
```

- [x] **Step 6: Commit**

```bash
git add src/platform/platform.service.ts
git commit -m "feat(platform): tenantWijzigen, tenantDeactiveren, eigenTenantVinden"
```

---

### Taak 3: Backend — SessieService.wisselen()

**Files:**
- Modify: `src/auth/sessie.service.ts`

- [x] **Step 1: Bekijk het bestaande aanmaken()-patroon**

```powershell
Get-Content src/auth/sessie.service.ts | Select-String -Pattern "async aanmaken" -Context 0,40
```

- [x] **Step 2: Voeg wisselen() toe**

In `src/auth/sessie.service.ts`, na de bestaande `oplossen()`-methode, vóór
`beeindigen()`:

```ts
  /**
   * Wisselt vanuit een bestaande geldige sessie naar een tweede sessie voor
   * een andere tenant — geen Entra-login nodig (platformbeheer-uitbreiding,
   * spec §5a/§5b).
   *
   * Geeft `null` als het huidige token ongeldig is, of als er geen geldig
   * membership op de doeltenant staat. Beide gevallen krijgen dezelfde
   * uitkomst — de aanroeper heeft aan het onderscheid niets, en het
   * verklapt geen informatie over wélke tenants bestaan.
   */
  async wisselen(
    huidigRuwToken: unknown,
    doelTenantId: string,
  ): Promise<NieuweSessie | null> {
    if (!heeftGeldigeSessieVorm(huidigRuwToken)) {
      return null;
    }

    const huidigeHash = hashSessieToken(huidigRuwToken);
    const nieuwToken = genereerSessieToken();
    const nieuweHash = hashSessieToken(nieuwToken);

    const resultaat = await this.db.db.execute<SessieRij>(
      sql`SELECT * FROM clm.sessie_wisselen(
            ${huidigeHash}, ${doelTenantId}, ${nieuweHash},
            ${GELDIGHEID_INTERVAL}::interval)`,
    );

    const rij = resultaat.rows[0];

    if (!rij) {
      return null;
    }

    return {
      token: nieuwToken,
      sessieId: rij.sessie_id,
      userId: rij.user_id,
      tenantId: rij.tenant_id,
      role: rij.role,
    };
  }
```

- [x] **Step 3: Typecheck**

```powershell
npx tsc --noEmit
```

- [x] **Step 4: Commit**

```bash
git add src/auth/sessie.service.ts
git commit -m "feat(auth): SessieService.wisselen() — nieuwe sessie zonder Entra-login"
```

---

### Taak 4: Backend — routes op PlatformController

**Files:**
- Modify: `src/platform/platform.controller.ts`
- Modify: `src/platform/platform-invoer.ts`
- Test: `test/test-ids.ts`

- [x] **Step 1: Registreer de test-ids**

In `test/test-ids.ts`, na het laatste blok (`'contracten-overzicht'`, vóór
de afsluitende `} as const;`):

```ts
  'platform-uitbreiding': {
    platformbeheerder: id('41'),
    eigenTenant: id('42'),
    doelTenant: id('43'),
    andereTenant: id('44'),
    klantAdmin: id('45'),
    gedeactiveerdeTenant: id('46'),
  },
```

- [x] **Step 2: Voeg leesTenantWijziging() toe aan platform-invoer.ts**

In `src/platform/platform-invoer.ts`, na `leesNieuweTenant()`:

```ts
export function leesTenantWijziging(body: unknown): TenantWijziging {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Verwacht een JSON-object.');
  }

  const invoer = body as Record<string, unknown>;

  return {
    naam: verplichteTekst(invoer.naam, 'naam', MAX_NAAM),
    antwoordEmail: optioneelEmail(invoer.antwoordEmail, 'antwoordEmail'),
  };
}
```

Voeg `TenantWijziging` toe aan de bestaande import van `./platform.service`
bovenaan het bestand:

```ts
import type { NieuweTenant, TenantWijziging } from './platform.service';
```

(Vervang de bestaande `import type { NieuweTenant } from './platform.service';`.)

- [x] **Step 3: Voeg de vier routes toe aan PlatformController**

In `src/platform/platform.controller.ts`:

Breid de constructor uit met `SessieService`:

```ts
  constructor(
    private readonly platform: PlatformService,
    private readonly uitnodigingen: UitnodigingVerzender,
    private readonly sessies: SessieService,
  ) {}
```

Voeg de import toe bovenaan:

```ts
import { SessieService } from '../auth/sessie.service';
```

En breid de import van `platform-invoer` uit:

```ts
import {
  leesNieuweTenant,
  leesSupportReden,
  leesTenantWijziging,
} from './platform-invoer';
```

En `cookieInstellingen`:

```ts
import { cookieInstellingen } from '../auth/sessie';
```

En `Res`, `Put`, `NotFoundException` staan al deels in de bestaande import
uit `@nestjs/common` — breid die uit naar:

```ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
```

En voeg `import type { Response } from 'express';` toe.

Na de bestaande `tenantLezen()`-methode, vóór `supportToegang()`:

```ts
  @Put('tenants/:id')
  async tenantWijzigen(@Param('id') id: string, @Body() body: unknown) {
    try {
      const invoer = leesTenantWijziging(body);
      const tenant = await this.platform.tenantWijzigen(id, invoer);

      if (!tenant) {
        throw new NotFoundException('Onbekende tenant.');
      }

      return tenant;
    } catch (fout) {
      if (fout instanceof InvoerFout) {
        throw new BadRequestException({
          veld: fout.veld,
          melding: fout.message,
        });
      }
      throw fout;
    }
  }

  @Post('tenants/:id/deactiveren')
  async tenantDeactiveren(@Param('id') id: string) {
    const gelukt = await this.platform.tenantDeactiveren(id);

    if (!gelukt) {
      throw new NotFoundException('Onbekende of al gedeactiveerde tenant.');
    }
  }
```

Na de bestaande `supportToegang()`-methode, als laatste twee methoden van
de klasse:

```ts
  /**
   * Eén-klik toegang: support-toegang toekennen én meteen wisselen, zonder
   * apart reden-formulier (spec §5b). De reden is een vaste tekst — dit is
   * precies wat "één klik" betekent.
   */
  @Post('sessie/wisselen')
  async sessieWisselen(
    @Body() body: unknown,
    @Req() request: RequestMetSessie,
    @Res({ passthrough: true }) response: Response,
  ) {
    const tenantId = (body as { tenantId?: unknown })?.tenantId;

    if (typeof tenantId !== 'string' || tenantId.trim() === '') {
      throw new BadRequestException({
        veld: 'tenantId',
        melding: 'tenantId is verplicht.',
      });
    }

    const bestaat = await this.platform.tenantLezen(tenantId);

    if (!bestaat) {
      throw new NotFoundException('Onbekende tenant.');
    }

    const sessie = request.sessie!;

    await this.platform.supportToegangGeven(
      tenantId,
      sessie.userId,
      'Platformbeheer',
    );

    const nieuweSessie = await this.sessies.wisselen(
      request.sessieToken,
      tenantId,
    );

    if (!nieuweSessie) {
      throw new NotFoundException('Wisselen niet gelukt.');
    }

    const sessieCookie = cookieInstellingen();
    response.cookie(sessieCookie.naam, nieuweSessie.token, {
      httpOnly: sessieCookie.httpOnly,
      secure: sessieCookie.secure,
      sameSite: sessieCookie.sameSite,
      path: sessieCookie.path,
      maxAge: sessieCookie.maxAge,
    });

    return { tenantId: nieuweSessie.tenantId, rol: nieuweSessie.role };
  }

  /**
   * Terug naar de eigen (blijvende) tenant, vanuit een support-sessie (spec
   * §5c). Geen tenant-id in de invoer: dat zou het frontend-Sessie-model
   * met een tenant-id belasten, wat MCM2-CLAUDE.md §6 uitsluit.
   */
  @Post('sessie/eigen-tenant')
  async sessieEigenTenant(
    @Req() request: RequestMetSessie,
    @Res({ passthrough: true }) response: Response,
  ) {
    const sessie = request.sessie!;

    const eigenTenantId = await this.platform.eigenTenantVinden(
      sessie.userId,
    );

    if (!eigenTenantId) {
      throw new NotFoundException('Geen eigen tenant gevonden.');
    }

    const nieuweSessie = await this.sessies.wisselen(
      request.sessieToken,
      eigenTenantId,
    );

    if (!nieuweSessie) {
      throw new NotFoundException('Wisselen niet gelukt.');
    }

    const sessieCookie = cookieInstellingen();
    response.cookie(sessieCookie.naam, nieuweSessie.token, {
      httpOnly: sessieCookie.httpOnly,
      secure: sessieCookie.secure,
      sameSite: sessieCookie.sameSite,
      path: sessieCookie.path,
      maxAge: sessieCookie.maxAge,
    });

    return { tenantId: nieuweSessie.tenantId, rol: nieuweSessie.role };
  }
```

- [x] **Step 4: Registreer SessieService in PlatformModule**

`SessieService` wordt al door `AuthModule` geëxporteerd, en
`PlatformModule` importeert `AuthModule` al (`src/platform/platform.module.ts`)
— geen wijziging aan `platform.module.ts` nodig. Bevestig dat door het
bestand te bekijken:

```powershell
Get-Content src/platform/platform.module.ts
```

Verwacht: `imports: [AuthModule, MailModule]` staat er al.

- [x] **Step 5: Typecheck**

```powershell
npx tsc --noEmit
```

Verwacht: geen fouten.

- [x] **Step 6: Commit**

```bash
git add src/platform/platform.controller.ts src/platform/platform-invoer.ts test/test-ids.ts
git commit -m "feat(platform): routes — tenant wijzigen/deactiveren, sessie wisselen/eigen-tenant"
```

---

### Taak 5: Backend e2e-tests — alle 10 tegenproeven

**Files:**
- Create: `test/platform-uitbreiding.e2e-spec.ts`

- [x] **Step 1: Bekijk het bestaande platformbeheer.e2e-spec.ts als sjabloon**

```powershell
Get-Content test/platformbeheer.e2e-spec.ts | Select-String -Pattern "function migratieUrl|function withTenantContext" -Context 0,20
```

- [x] **Step 2: Schrijf de volledige testsuite**

Maak `test/platform-uitbreiding.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Client } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { cookieInstellingen } from '../src/auth/sessie';
import { SessieService } from '../src/auth/sessie.service';
import { TEST_IDS } from './test-ids';

/**
 * Platformbeheer-uitbreiding: tenant wijzigen/deactiveren, en de
 * sessiewissel voor één-klik support-toegang.
 *
 * Dekt de tien tegenproeven uit
 * docs/superpowers/specs/2026-08-27-platformbeheer-uitbreiding-design.md §8.
 */

const {
  platformbeheerder: PLATFORMBEHEERDER_ID,
  eigenTenant: EIGEN_TENANT_ID,
  doelTenant: DOEL_TENANT_ID,
  andereTenant: ANDERE_TENANT_ID,
  klantAdmin: KLANT_ADMIN_ID,
  gedeactiveerdeTenant: GEDEACTIVEERDE_TENANT_ID,
} = TEST_IDS['platform-uitbreiding'];

const STEMPEL = Date.now();
const SUBJECT_PLATFORMBEHEERDER = `oid-platform-uitbr-${STEMPEL}`;

function migratieUrl(): string {
  const runtime = process.env.DATABASE_URL;
  if (!runtime) throw new Error('DATABASE_URL ontbreekt.');
  const doel = new URL(runtime);
  const expliciet = process.env.MIGRATION_DATABASE_URL;
  if (expliciet) {
    const gegeven = new URL(expliciet);
    if (gegeven.host === doel.host && gegeven.pathname === doel.pathname) {
      return expliciet;
    }
  }
  doel.username = 'clm_migrator';
  return doel.toString();
}

async function opruimen(migratieClient: Client): Promise<void> {
  for (const t of [
    EIGEN_TENANT_ID,
    DOEL_TENANT_ID,
    ANDERE_TENANT_ID,
    GEDEACTIVEERDE_TENANT_ID,
  ]) {
    await migratieClient.query('BEGIN');
    await migratieClient.query(`SET LOCAL app.current_tenant_id = '${t}'`);
    await migratieClient.query(
      'DELETE FROM clm.tenant_membership WHERE tenant_id = $1',
      [t],
    );
    await migratieClient.query('DELETE FROM clm."user" WHERE tenant_id = $1', [
      t,
    ]);
    await migratieClient.query('COMMIT');
  }
  // Buiten de tenantcontext-loop: platform_admin en tenant zelf kennen geen
  // RLS-scoping op dezelfde manier, en tenant_register wordt door de trigger
  // beheerd — een DELETE op clm.tenant ruimt hem vanzelf mee als de trigger
  // ook op DELETE zou reageren. Hij reageert dat niet (alleen INSERT/UPDATE),
  // dus het register-restant ruimen we hier expliciet op.
  await migratieClient.query('BEGIN');
  for (const t of [
    EIGEN_TENANT_ID,
    DOEL_TENANT_ID,
    ANDERE_TENANT_ID,
    GEDEACTIVEERDE_TENANT_ID,
  ]) {
    await migratieClient.query(`SET LOCAL app.current_tenant_id = '${t}'`);
    await migratieClient.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [
      t,
    ]);
  }
  await migratieClient.query(
    'DELETE FROM clm.tenant_register WHERE register_id = ANY($1)',
    [[EIGEN_TENANT_ID, DOEL_TENANT_ID, ANDERE_TENANT_ID, GEDEACTIVEERDE_TENANT_ID]],
  );
  await migratieClient.query(
    'DELETE FROM clm.platform_admin WHERE user_id = $1',
    [PLATFORMBEHEERDER_ID],
  );
  await migratieClient.query('COMMIT');
}

describe('Platformbeheer-uitbreiding (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let migratieClient: Client;
  let platformbeheerderCookie: string;
  const cookieNaam = cookieInstellingen().naam;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    migratieClient = new Client({ connectionString: migratieUrl() });
    await migratieClient.connect();
    await opruimen(migratieClient);

    // Eigen tenant van de platformbeheerder, met hemzelf als blijvend admin.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${EIGEN_TENANT_ID}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [EIGEN_TENANT_ID, `platform-uitbr-eigen-${STEMPEL}`],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, email, external_subject)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        PLATFORMBEHEERDER_ID,
        EIGEN_TENANT_ID,
        'Platformbeheerder Test',
        `platform-uitbr-${STEMPEL}@test.nl`,
        SUBJECT_PLATFORMBEHEERDER,
      ],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [PLATFORMBEHEERDER_ID, EIGEN_TENANT_ID],
    );
    await client.query('COMMIT');

    // Platformbeheerder-markering (clm.platform_admin, migratie 0020) —
    // buiten RLS, geen tenantcontext nodig.
    await migratieClient.query(
      'INSERT INTO clm.platform_admin (user_id) VALUES ($1)',
      [PLATFORMBEHEERDER_ID],
    );

    // Doeltenant: waar de platformbeheerder straks "Openen" op klikt.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${DOEL_TENANT_ID}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [DOEL_TENANT_ID, `platform-uitbr-doel-${STEMPEL}`],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, email)
       VALUES ($1, $2, $3, $4)`,
      [
        KLANT_ADMIN_ID,
        DOEL_TENANT_ID,
        'Klant Admin',
        `klant-admin-${STEMPEL}@test.nl`,
      ],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [KLANT_ADMIN_ID, DOEL_TENANT_ID],
    );
    await client.query('COMMIT');

    // Andere tenant: waar géén membership op staat (tegenproef 7).
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${ANDERE_TENANT_ID}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [ANDERE_TENANT_ID, `platform-uitbr-ander-${STEMPEL}`],
    );
    await client.query('COMMIT');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();

    const sessies = app.get(SessieService);
    const sessie = await sessies.aanmaken(SUBJECT_PLATFORMBEHEERDER);
    platformbeheerderCookie = `${cookieNaam}=${sessie!.token}`;
  });

  afterAll(async () => {
    await app.close();
    await opruimen(migratieClient);
    await client.end();
    await migratieClient.end();
  });

  it('1. wijzigen: naam-conflict geeft 409', async () => {
    // Een tweede tenant met dezelfde naam als DOEL_TENANT_ID proberen te
    // zetten via wijzigen — de doeltenantnaam bestaat al (ANDERE_TENANT_ID
    // heeft zijn eigen naam; we hergebruiken die als conflict-doel).
    const anderesNaam = `platform-uitbr-ander-${STEMPEL}`;

    const respons = await request(server)
      .put(`/platform/tenants/${DOEL_TENANT_ID}`)
      .set('Cookie', platformbeheerderCookie)
      .send({ naam: anderesNaam });

    expect(respons.status).toBe(409);
  });

  it('2. wijzigen: audit-event tenant_gewijzigd staat met oude/nieuwe waarden', async () => {
    const nieuweNaam = `platform-uitbr-doel-gewijzigd-${STEMPEL}`;

    const respons = await request(server)
      .put(`/platform/tenants/${DOEL_TENANT_ID}`)
      .set('Cookie', platformbeheerderCookie)
      .send({ naam: nieuweNaam, antwoordEmail: 'nieuw@test.nl' });

    expect(respons.status).toBe(200);
    expect((respons.body as { naam: string }).naam).toBe(nieuweNaam);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${DOEL_TENANT_ID}'`);
    const audit = await client.query<{
      new_values: { naam: string };
    }>(
      `SELECT new_values FROM audit.audit_event
        WHERE tenant_id = $1 AND action_type = 'tenant_gewijzigd'
        ORDER BY created_at DESC LIMIT 1`,
      [DOEL_TENANT_ID],
    );
    await client.query('COMMIT');

    expect(audit.rows[0]?.new_values.naam).toBe(nieuweNaam);
  });

  it('3. deactiveren: de tenant verdwijnt uit GET /platform/tenants', async () => {
    // Zet eerst de naam terug naar iets bekends met dezelfde tenant, en
    // deactiveer daarna.
    const voorLijst = await request(server)
      .get('/platform/tenants')
      .set('Cookie', platformbeheerderCookie);
    const idsVoor = (
      voorLijst.body as { tenants: { tenantId: string }[] }
    ).tenants.map((t) => t.tenantId);
    expect(idsVoor).toContain(DOEL_TENANT_ID);

    const deactiveerRespons = await request(server)
      .post(`/platform/tenants/${DOEL_TENANT_ID}/deactiveren`)
      .set('Cookie', platformbeheerderCookie);
    expect(deactiveerRespons.status).toBe(201);

    const naLijst = await request(server)
      .get('/platform/tenants')
      .set('Cookie', platformbeheerderCookie);
    const idsNa = (
      naLijst.body as { tenants: { tenantId: string }[] }
    ).tenants.map((t) => t.tenantId);
    expect(idsNa).not.toContain(DOEL_TENANT_ID);
  });

  it('4. deactiveren: een gedeactiveerde tenant kan niet meer inloggen', async () => {
    // Los, apart opgebouwd: een tenant die meteen als gedeactiveerd eindigt.
    await client.query('BEGIN');
    await client.query(
      `SET LOCAL app.current_tenant_id = '${GEDEACTIVEERDE_TENANT_ID}'`,
    );
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [GEDEACTIVEERDE_TENANT_ID, `platform-uitbr-gedeact-${STEMPEL}`],
    );
    const gebruikerId = crypto.randomUUID();
    const subject = `oid-gedeact-${STEMPEL}`;
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, email, external_subject)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        gebruikerId,
        GEDEACTIVEERDE_TENANT_ID,
        'Gedeactiveerd Lid',
        `gedeact-${STEMPEL}@test.nl`,
        subject,
      ],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [gebruikerId, GEDEACTIVEERDE_TENANT_ID],
    );
    await client.query('COMMIT');

    await request(server)
      .post(`/platform/tenants/${GEDEACTIVEERDE_TENANT_ID}/deactiveren`)
      .set('Cookie', platformbeheerderCookie);

    const sessies = app.get(SessieService);
    const sessie = await sessies.aanmaken(subject);

    // sessie_aanmaken() zelf kent geen tenant.deleted_at-check in de
    // membership-lookup — dit bewijst dat de tegenproef klopt met de
    // migratie: als dit faalt, ontbreekt een t.deleted_at IS NULL-check in
    // clm.sessie_aanmaken() (0010) die dit plan niet expliciet toevoegt.
    // Zie de opmerking hieronder.
    expect(sessie).toBeNull();
  });

  it('5. deactiveren: sessie_wisselen naar een gedeactiveerde tenant faalt', async () => {
    const respons = await request(server)
      .post('/platform/sessie/wisselen')
      .set('Cookie', platformbeheerderCookie)
      .send({ tenantId: GEDEACTIVEERDE_TENANT_ID });

    expect(respons.status).toBe(404);
  });

  it('6. deactiveren: dubbel deactiveren geeft 404', async () => {
    const respons = await request(server)
      .post(`/platform/tenants/${GEDEACTIVEERDE_TENANT_ID}/deactiveren`)
      .set('Cookie', platformbeheerderCookie);

    expect(respons.status).toBe(404);
  });

  it('7. sessiewissel: zonder geldig membership op de doeltenant faalt', async () => {
    const respons = await request(server)
      .post('/platform/sessie/wisselen')
      .set('Cookie', platformbeheerderCookie)
      .send({ tenantId: ANDERE_TENANT_ID });

    // De platformbeheerder heeft nog geen support-toegang op ANDERE_TENANT_ID
    // op dit punt in de suite. supportToegangGeven() in de route zelf zou
    // die overigens net aanmaken vóór de wisselpoging — dus dit test
    // eigenlijk het gedrag ná automatisch toegekende support-toegang, wat
    // altijd slaagt. Vervang deze aanroep door rechtstreeks
    // SessieService.wisselen() aan te roepen op een tenant waar zeker geen
    // membership staat, om de kale sessie_wisselen()-functie te toetsen:
    const sessies = app.get(SessieService);
    const platformbeheerderSessie = await sessies.oplossen(
      platformbeheerderCookie.split('=')[1],
    );
    expect(platformbeheerderSessie).not.toBeNull();

    const wisselResultaat = await sessies.wisselen(
      platformbeheerderCookie.split('=')[1],
      ANDERE_TENANT_ID,
    );

    expect(wisselResultaat).toBeNull();
    void respons; // De HTTP-route-aanroep hierboven is bewust niet de
    // beslissende assertie — zie de toelichting.
  });

  it('8. sessiewissel: de oorspronkelijke sessie blijft geldig', async () => {
    const sessies = app.get(SessieService);
    const ruwToken = platformbeheerderCookie.split('=')[1];

    const voorWissel = await sessies.oplossen(ruwToken);
    expect(voorWissel).not.toBeNull();

    await sessies.wisselen(ruwToken, DOEL_TENANT_ID);

    const naWissel = await sessies.oplossen(ruwToken);
    expect(naWissel).not.toBeNull();
    expect(naWissel!.tenantId).toBe(EIGEN_TENANT_ID);
  });

  it('9. één-klik Openen: support-membership met reden Platformbeheer en een werkend cookie', async () => {
    const respons = await request(server)
      .post('/platform/sessie/wisselen')
      .set('Cookie', platformbeheerderCookie)
      .send({ tenantId: DOEL_TENANT_ID });

    expect(respons.status).toBe(201);
    expect((respons.body as { rol: string }).rol).toBe('support');

    const nieuwCookie = respons.headers['set-cookie'];
    expect(nieuwCookie).toBeDefined();

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${DOEL_TENANT_ID}'`);
    const membership = await client.query<{ reden: string; role: string }>(
      `SELECT reden, role FROM clm.tenant_membership
        WHERE user_id = $1 AND tenant_id = $2`,
      [PLATFORMBEHEERDER_ID, DOEL_TENANT_ID],
    );
    await client.query('COMMIT');

    expect(membership.rows[0]?.role).toBe('support');
    expect(membership.rows[0]?.reden).toBe('Platformbeheer');
  });

  it('10. terugkeer: /platform/sessie/eigen-tenant wisselt terug naar de blijvende rol', async () => {
    const wisselRespons = await request(server)
      .post('/platform/sessie/wisselen')
      .set('Cookie', platformbeheerderCookie)
      .send({ tenantId: DOEL_TENANT_ID });

    const supportCookieHeader = (
      wisselRespons.headers['set-cookie'] as unknown as string[]
    )[0];
    const supportCookie = supportCookieHeader.split(';')[0];

    const terugRespons = await request(server)
      .post('/platform/sessie/eigen-tenant')
      .set('Cookie', supportCookie);

    expect(terugRespons.status).toBe(201);
    expect((terugRespons.body as { tenantId: string; rol: string })).toEqual({
      tenantId: EIGEN_TENANT_ID,
      rol: 'admin',
    });
  });
});
```

- [x] **Step 3: Run, diagnosticeer elke afwijking**

```powershell
npx jest test/platform-uitbreiding.e2e-spec.ts --forceExit
```

Verwacht bij de eerste run: test 4 faalt waarschijnlijk, met een reden die
hierboven al staat aangekondigd — `clm.sessie_aanmaken()` (migratie 0010)
controleert vandaag alleen `tenant_membership.deleted_at` en
`user.deleted_at`, niet `tenant.deleted_at`. Dat is een gat dat de spec §4
noemt ("Effect van een gedeactiveerde tenant: kan niet meer inloggen") maar
Taak 1 van dit plan niet dicht. **Fix dit nu, terugkerend naar Taak 1**:

Voeg aan `drizzle/0033_platformbeheer_wijzigen_verwijderen.sql`, vóór de
`sessie_wisselen()`-sectie, een vierde stuk toe dat `sessie_aanmaken()`
opnieuw definieert met een extra join op `clm.tenant`:

```sql
-- ── 4. sessie_aanmaken(): ook een gedeactiveerde tenant blokkeert login ──────
--
-- De membership-lookup in 0010 checkt user.deleted_at en membership.
-- deleted_at, maar niet tenant.deleted_at — die kolom bestond toen nog
-- niet. Zonder deze aanpassing kan een lid van een gedeactiveerde tenant
-- alsnog inloggen.

CREATE OR REPLACE FUNCTION clm.sessie_aanmaken(
    p_token_hash text,
    p_external_subject text,
    p_geldigheid interval
)
RETURNS TABLE (sessie_id uuid, user_id uuid, tenant_id uuid, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
DECLARE
    v_user_id   uuid;
    v_tenant_id uuid;
    v_role      text;
BEGIN
    SELECT m.user_id, m.tenant_id, m.role
      INTO v_user_id, v_tenant_id, v_role
      FROM clm.tenant_membership m
      JOIN clm."user" u ON u.user_id = m.user_id
      JOIN clm.tenant t ON t.tenant_id = m.tenant_id
     WHERE u.external_subject = p_external_subject
       AND p_external_subject IS NOT NULL
       AND u.deleted_at IS NULL
       AND m.deleted_at IS NULL
       AND t.deleted_at IS NULL
     ORDER BY m.created_at
     LIMIT 1;

    IF v_user_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    INSERT INTO clm.sessie (
        token_hash, user_id, tenant_id, role, external_subject, verloopt_op
    )
    VALUES (
        p_token_hash, v_user_id, v_tenant_id, v_role, p_external_subject,
        now() + p_geldigheid
    )
    RETURNING clm.sessie.sessie_id, clm.sessie.user_id,
              clm.sessie.tenant_id, clm.sessie.role;
END;
$$;--> statement-breakpoint

COMMENT ON FUNCTION clm.sessie_aanmaken(text, text, interval) IS
    'Maakt een sessie voor de eerste (oudste) membership van een geverifieerd subject. Sluit sinds migratie 0033 ook een gedeactiveerde tenant uit (t.deleted_at), naast een gedeactiveerd lid of membership.';
```

Draai daarna de migratie opnieuw op een verse container
(`npm run test:db -- "platformbeheer-uitbreiding" --hergebruik` volstaat
niet als de container de oude functie al heeft — gebruik zonder
`--hergebruik` om zeker te zijn) en herhaal deze teststap.

Los daarvan: test 7 en de opmerking erin bewijzen dat de
`POST /platform/sessie/wisselen`-route zelf altijd support-toegang
toekent vóór het wisselen — dat is gewenst gedrag (spec §5b, stap 1-2),
maar betekent dat de HTTP-route nooit 404 geeft op "geen membership". De
kale `SessieService.wisselen()`-aanroep in dezelfde test is de eigenlijke
tegenproef voor tegenproef 7 uit de spec. Laat de HTTP-aanroep in de test
staan als documentatie van dat onderscheid, maar vertrouw op de
`wisselResultaat`-assertie.

- [x] **Step 4: Volledige e2e-run (regressie-check)**

```powershell
npx jest --forceExit
```

Verwacht: alle suites groen, inclusief `platform-uitbreiding.e2e-spec.ts`
en de bestaande `platformbeheer.e2e-spec.ts`/`platform-routes.e2e-spec.ts`
(die laatste twee mogen niet breken door de trigger- of
`sessie_aanmaken()`-wijziging).

- [x] **Step 5: Commit**

```bash
git add drizzle/0033_platformbeheer_wijzigen_verwijderen.sql test/platform-uitbreiding.e2e-spec.ts
git commit -m "test(platform): e2e-dekking voor wijzigen/deactiveren/sessiewissel (10 tegenproeven)"
```

---

### Taak 6: Backend — verify:volledig

- [x] **Step 1**

```powershell
npm run verify:volledig
```

Verwacht: groen. Diagnosticeer en fix elk falen vóór verdergaan (CLAUDE.md,
"verify:volledig tussentijds draaien"). Een eenmalig falen op
`e2e\contracten.spec.ts:173` (bekende bestaande flakiness, zie
`docs/STATUS.md`) mag genegeerd worden na een herhaalde, schone run —
elk ander falen niet.

- [x] **Step 2: Commit eventuele fixes apart**

```bash
git add -A
git commit -m "fix: verify:volledig-bevindingen na platformbeheer-uitbreiding (backend)"
```

---

### Taak 7: Frontend — modellen en service uitbreiden

**Files:**
- Modify: `src/core/models/platform.ts`
- Modify: `src/core/services/platformService.ts`

- [x] **Step 1: Voeg de nieuwe modellen toe**

In `src/core/models/platform.ts`, na `NieuweTenantInvoer`:

```ts
/** De invoer voor `PUT /platform/tenants/:id`. */
export interface TenantWijzigingInvoer {
  readonly naam: string;
  readonly antwoordEmail?: string;
}

/** Wat `PUT`/`POST .../deactiveren` teruggeven als de tenant zelf. */
export interface TenantOverzicht {
  readonly tenantId: string;
  readonly naam: string;
  readonly aangemaaktOp: string;
  readonly aantalLeden: number;
}

/** Wat `POST /platform/sessie/wisselen` en `.../eigen-tenant` teruggeven. */
export interface SessieWisselResultaat {
  readonly tenantId: string;
  readonly rol: string;
}
```

- [x] **Step 2: Voeg de service-functies toe**

In `src/core/services/platformService.ts`, na `maakTenantAan()`:

```ts
import type { SchrijfResultaat } from '@/core/models/vendor';
import type {
  NieuweTenant,
  NieuweTenantInvoer,
  SessieWisselResultaat,
  TenantOverzicht,
  TenantRegel,
  TenantWijzigingInvoer,
} from '@/core/models/platform';
```

(Vervang de bestaande import-regel uit `@/core/models/platform` bovenaan
het bestand met deze uitgebreide versie.)

```ts
/** Wijzigt naam en/of antwoordEmail van een bestaande tenant. */
export async function wijzigTenant(
  tenantId: string,
  invoer: TenantWijzigingInvoer,
): Promise<SchrijfResultaat<TenantOverzicht>> {
  if (gebruiktMockData) {
    return {
      ok: true,
      waarde: {
        tenantId,
        naam: invoer.naam,
        aangemaaktOp: new Date().toISOString(),
        aantalLeden: 1,
      },
    };
  }

  try {
    const waarde = await wijzig<TenantOverzicht>(
      `/platform/tenants/${tenantId}`,
      invoer,
    );
    return { ok: true, waarde };
  } catch (fout) {
    return alsSchrijfFout(fout);
  }
}

/** Deactiveert een tenant (soft-delete). */
export async function deactiveerTenant(tenantId: string): Promise<boolean> {
  if (gebruiktMockData) {
    return true;
  }

  try {
    await verstuur(`/platform/tenants/${tenantId}/deactiveren`, {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Eén-klik toegang: support-toegang toekennen én meteen wisselen naar die
 * tenant.
 */
export async function openTenant(
  tenantId: string,
): Promise<SessieWisselResultaat | null> {
  if (gebruiktMockData) {
    return { tenantId, rol: 'support' };
  }

  try {
    return await verstuur<SessieWisselResultaat>('/platform/sessie/wisselen', {
      tenantId,
    });
  } catch {
    return null;
  }
}

/** Terug naar de eigen (blijvende) tenant, vanuit een support-sessie. */
export async function terugNaarEigenTenant(): Promise<SessieWisselResultaat | null> {
  if (gebruiktMockData) {
    return { tenantId: 'mock-eigen-tenant', rol: 'admin' };
  }

  try {
    return await verstuur<SessieWisselResultaat>(
      '/platform/sessie/eigen-tenant',
      {},
    );
  } catch {
    return null;
  }
}
```

Voeg `wijzig` toe aan de bestaande import van `@/core/api/client`
bovenaan het bestand:

```ts
import {
  ApiFout,
  gebruiktMockData,
  haalOp,
  verstuur,
  wijzig,
} from '@/core/api/client';
```

- [x] **Step 3: Typecheck**

```powershell
npx tsc --noEmit
```

- [x] **Step 4: Commit**

```bash
git add src/core/models/platform.ts src/core/services/platformService.ts
git commit -m "feat(platform): modellen en service — wijzigen, deactiveren, sessiewissel"
```

---

### Taak 8: Frontend — bewerk-, deactiveer- en openen-acties op de tenantlijst

**Files:**
- Modify: `src/app/beheer/platform/page.tsx`
- Test: `e2e/platform-uitbreiding.spec.ts`

- [x] **Step 1: Bekijk het bestaande tenantrij-/formulierpatroon**

```powershell
Get-Content src/app/beheer/platform/page.tsx | Select-String -Pattern "data-testid=.tenant-rij" -Context 5,15
```

- [x] **Step 2: Schrijf de falende Playwright-test**

Maak `e2e/platform-uitbreiding.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

/**
 * Platformbeheer-uitbreiding: tenant wijzigen/deactiveren, en het "Openen"
 * (één-klik support-toegang + sessiewissel).
 *
 * Vraagt PLATFORM_COOKIE (een sessiecookie van een echte platformbeheerder)
 * — net als de bestaande platformbeheer-tests, zie hun opzet als die
 * bestaan. Als die variabele elders anders heet, pas de naam hieronder aan.
 */

const COOKIE = process.env.PLATFORM_COOKIE ?? process.env.BEHEER_COOKIE;
const PAGINA = '/beheer/platform';

test.describe('Platformbeheer-uitbreiding', () => {
  test.beforeEach(async ({ context, page }) => {
    test.skip(
      !COOKIE,
      'PLATFORM_COOKIE/BEHEER_COOKIE ontbreekt. Draai `npm run verify:volledig` in de backend-repo.',
    );

    const [naam, ...rest] = COOKIE!.split('=');

    await context.addCookies([
      {
        name: naam,
        value: rest.join('='),
        url:
          page.url() !== 'about:blank' ? page.url() : 'http://localhost:3000',
      },
    ]);
  });

  test('toont bewerken-, deactiveren- en openen-knoppen op elke tenantrij', async ({
    page,
  }) => {
    await page.goto(PAGINA);

    const eersteRij = page.getByTestId('tenant-rij').first();
    await expect(eersteRij.getByTestId('bewerk-tenant-knop')).toBeVisible();
    await expect(
      eersteRij.getByTestId('deactiveer-tenant-knop'),
    ).toBeVisible();
    await expect(eersteRij.getByTestId('open-tenant-knop')).toBeVisible();
  });

  test('bewerken past de naam aan en toont hem in de lijst', async ({
    page,
  }) => {
    await page.goto(PAGINA);

    const eersteRij = page.getByTestId('tenant-rij').first();
    await eersteRij.getByTestId('bewerk-tenant-knop').click();

    const nieuweNaam = `Bewerkt-${Date.now()}`;
    await page.getByTestId('bewerk-naam-veld').fill(nieuweNaam);
    await page.getByTestId('bewerk-opslaan-knop').click();

    await expect(page.getByTestId('tenant-lijst')).toContainText(nieuweNaam);
  });

  test('deactiveren vraagt de tenantnaam ter bevestiging', async ({
    page,
  }) => {
    await page.goto(PAGINA);

    const eersteRij = page.getByTestId('tenant-rij').first();
    const naam = (await eersteRij.locator('span').first().textContent())!.trim();

    await eersteRij.getByTestId('deactiveer-tenant-knop').click();
    await expect(
      page.getByTestId('deactiveer-bevestig-knop'),
    ).toBeDisabled();

    await page.getByTestId('deactiveer-naam-veld').fill(naam);
    await expect(page.getByTestId('deactiveer-bevestig-knop')).toBeEnabled();

    await page.getByTestId('deactiveer-bevestig-knop').click();

    await expect(page.getByTestId('tenant-lijst')).not.toContainText(naam);
  });

  test('openen wisselt naar de tenant en toont de terugkeer-link', async ({
    page,
  }) => {
    await page.goto(PAGINA);

    const eersteRij = page.getByTestId('tenant-rij').first();
    await eersteRij.getByTestId('open-tenant-knop').click();

    await expect(page).toHaveURL(/\/beheer\/leden$/);
    await expect(page.getByTestId('terug-naar-platformbeheer')).toBeVisible();

    await page.getByTestId('terug-naar-platformbeheer').click();
    await expect(page).toHaveURL(/\/beheer\/platform$/);
  });
});
```

- [x] **Step 3: Run, verwacht FAIL**

```powershell
npx playwright test e2e/platform-uitbreiding.spec.ts
```

Verwacht: FAIL — de knoppen bestaan nog niet.

- [x] **Step 4: Bouw de bewerk-flow**

In `src/app/beheer/platform/page.tsx`:

Voeg imports toe:

```ts
import { useRouter } from 'next/navigation';
import { Pencil, Power } from 'lucide-react';
import {
  deactiveerTenant,
  haalTenants,
  maakTenantAan,
  openTenant,
  wijzigTenant,
} from '@/core/services/platformService';
```

(Vervang de bestaande import-regel voor `platformService` en voeg
`useRouter` toe aan de al aanwezige `next/navigation`-import als die er
is — anders een nieuwe regel.)

Voeg state toe, direct na de bestaande `useState`-declaraties:

```ts
  const router = useRouter();
  const [bewerkTenant, setBewerkTenant] = useState<TenantRegel | null>(null);
  const [bewerkNaam, setBewerkNaam] = useState('');
  const [bewerkEmail, setBewerkEmail] = useState('');
  const [bewerkFout, setBewerkFout] = useState<string | null>(null);
  const [bewerkBezig, setBewerkBezig] = useState(false);

  const [deactiveerTarget, setDeactiveerTarget] = useState<TenantRegel | null>(
    null,
  );
  const [deactiveerInvoer, setDeactiveerInvoer] = useState('');
  const [deactiveerBezig, setDeactiveerBezig] = useState(false);

  const [openBezig, setOpenBezig] = useState<string | null>(null);
```

Voeg de handlerfuncties toe, na `kopieer()`:

```ts
  function bewerkStarten(tenant: TenantRegel) {
    setBewerkTenant(tenant);
    setBewerkNaam(tenant.naam);
    setBewerkEmail('');
    setBewerkFout(null);
  }

  async function bewerkOpslaan() {
    if (!bewerkTenant) return;
    setBewerkBezig(true);
    setBewerkFout(null);

    const uitkomst = await wijzigTenant(bewerkTenant.tenantId, {
      naam: bewerkNaam.trim(),
      antwoordEmail: bewerkEmail.trim() || undefined,
    });

    setBewerkBezig(false);

    if (!uitkomst.ok) {
      setBewerkFout(uitkomst.melding);
      return;
    }

    setTenants((huidig) =>
      huidig
        .map((t) =>
          t.tenantId === bewerkTenant.tenantId
            ? { ...t, naam: uitkomst.waarde.naam }
            : t,
        )
        .sort((a, b) => a.naam.localeCompare(b.naam)),
    );
    setBewerkTenant(null);
  }

  async function deactiveerBevestigen() {
    if (!deactiveerTarget) return;
    setDeactiveerBezig(true);

    const gelukt = await deactiveerTenant(deactiveerTarget.tenantId);

    setDeactiveerBezig(false);

    if (!gelukt) {
      setAlgemeneFout('Deactiveren is niet gelukt. Probeer het opnieuw.');
      return;
    }

    setTenants((huidig) =>
      huidig.filter((t) => t.tenantId !== deactiveerTarget.tenantId),
    );
    setDeactiveerTarget(null);
    setDeactiveerInvoer('');
  }

  async function tenantOpenen(tenantId: string) {
    setOpenBezig(tenantId);

    const resultaat = await openTenant(tenantId);

    setOpenBezig(null);

    if (!resultaat) {
      setAlgemeneFout('Openen is niet gelukt. Probeer het opnieuw.');
      return;
    }

    router.push('/beheer/leden');
  }
```

Vervang de bestaande tenantrij-`<li>` (binnen `tenants.map(...)`) door:

```tsx
            {tenants.map((tenant) => (
              <li
                key={tenant.tenantId}
                data-testid="tenant-rij"
                className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 text-sm text-ink last:border-0"
              >
                <span>{tenant.naam}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-muted">
                    {new Date(tenant.aangemaaktOp).toLocaleDateString(
                      'nl-NL',
                    )}
                  </span>
                  <button
                    type="button"
                    data-testid="bewerk-tenant-knop"
                    onClick={() => bewerkStarten(tenant)}
                    title="Bewerken"
                    className="rounded p-1.5 text-ink-muted transition hover:bg-surface hover:text-ink"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    data-testid="deactiveer-tenant-knop"
                    onClick={() => {
                      setDeactiveerTarget(tenant);
                      setDeactiveerInvoer('');
                    }}
                    title="Deactiveren"
                    className="rounded p-1.5 text-ink-muted transition hover:bg-red-50 hover:text-red-700"
                  >
                    <Power size={14} />
                  </button>
                  <button
                    type="button"
                    data-testid="open-tenant-knop"
                    disabled={openBezig === tenant.tenantId}
                    onClick={() => void tenantOpenen(tenant.tenantId)}
                    className="rounded border border-brand-primary px-2.5 py-1 text-xs font-medium text-brand-primary transition hover:bg-brand-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {openBezig === tenant.tenantId ? 'Bezig…' : 'Openen'}
                  </button>
                </div>
              </li>
            ))}
```

Voeg vóór de sluitende `</AppLayout>` (helemaal onderaan, na de bestaande
`<section>` met het aanmaakformulier) de twee dialogen toe:

```tsx
      {bewerkTenant && (
        <div
          role="dialog"
          data-testid="bewerk-dialoog"
          className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-sm rounded-lg bg-card p-5">
            <h3 className="mb-3 text-sm font-semibold text-ink">
              Tenant bewerken
            </h3>

            <div className="mb-3">
              <label
                htmlFor="bewerk-naam"
                className="mb-1.5 block text-xs font-medium text-ink"
              >
                Naam
              </label>
              <input
                id="bewerk-naam"
                type="text"
                value={bewerkNaam}
                onChange={(e) => setBewerkNaam(e.target.value)}
                maxLength={200}
                data-testid="bewerk-naam-veld"
                className="w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
            </div>

            <div className="mb-4">
              <label
                htmlFor="bewerk-email"
                className="mb-1.5 block text-xs font-medium text-ink"
              >
                Antwoordadres (optioneel)
              </label>
              <input
                id="bewerk-email"
                type="email"
                value={bewerkEmail}
                onChange={(e) => setBewerkEmail(e.target.value)}
                maxLength={320}
                data-testid="bewerk-email-veld"
                className="w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
            </div>

            {bewerkFout && (
              <p
                role="alert"
                data-testid="bewerk-fout"
                className="mb-3 text-xs text-red-700"
              >
                {bewerkFout}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBewerkTenant(null)}
                className="rounded border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface"
              >
                Annuleren
              </button>
              <button
                type="button"
                disabled={bewerkBezig}
                data-testid="bewerk-opslaan-knop"
                onClick={() => void bewerkOpslaan()}
                className="rounded bg-brand-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
              >
                {bewerkBezig ? 'Bezig…' : 'Opslaan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deactiveerTarget && (
        <div
          role="dialog"
          data-testid="deactiveer-dialoog"
          className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-sm rounded-lg bg-card p-5">
            <h3 className="mb-2 text-sm font-semibold text-ink">
              Tenant deactiveren
            </h3>
            <p className="mb-3 text-xs text-ink-muted">
              Typ <strong>{deactiveerTarget.naam}</strong> om te bevestigen.
              Leden van deze tenant kunnen daarna niet meer inloggen.
            </p>

            <input
              type="text"
              value={deactiveerInvoer}
              onChange={(e) => setDeactiveerInvoer(e.target.value)}
              data-testid="deactiveer-naam-veld"
              className="mb-4 w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink"
            />

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeactiveerTarget(null)}
                className="rounded border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface"
              >
                Annuleren
              </button>
              <button
                type="button"
                disabled={
                  deactiveerBezig || deactiveerInvoer !== deactiveerTarget.naam
                }
                data-testid="deactiveer-bevestig-knop"
                onClick={() => void deactiveerBevestigen()}
                className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deactiveerBezig ? 'Bezig…' : 'Deactiveren'}
              </button>
            </div>
          </div>
        </div>
      )}
```

- [x] **Step 5: Voeg de terugkeer-link toe aan OmgevingBanner**

Bekijk eerst de huidige inhoud:

```powershell
Get-Content src/shared/components/layout/OmgevingBanner.tsx
```

Voeg een import toe:

```ts
import { terugNaarEigenTenant } from '@/core/services/platformService';
import { useRouter } from 'next/navigation';
```

Voeg, binnen de component, een router en een handler toe:

```ts
  const router = useRouter();

  async function terugNaarPlatformbeheer() {
    const resultaat = await terugNaarEigenTenant();
    if (resultaat) {
      router.push('/beheer/platform');
    }
  }
```

Voeg, zichtbaar zodra `sessie?.rol === 'support'`, de link toe binnen de
bestaande banner-render (exacte plaatsing hangt af van de huidige
structuur — voeg toe als een nieuw blok naast de bestaande
mock-data/omgeving-melding, met dezelfde stijl):

```tsx
      {sessie?.rol === 'support' && (
        <button
          type="button"
          data-testid="terug-naar-platformbeheer"
          onClick={() => void terugNaarPlatformbeheer()}
          className="text-xs font-medium underline"
        >
          Support-toegang bij {sessie.tenantNaam} — Terug naar platformbeheer
        </button>
      )}
```

- [x] **Step 6: Run, verwacht PASS**

```powershell
npx playwright test e2e/platform-uitbreiding.spec.ts
```

- [x] **Step 7: Volledige Playwright-suite (regressie-check)**

```powershell
npx playwright test
```

- [x] **Step 8: Typecheck, format, lint**

```powershell
npx tsc --noEmit
npm run format
npm run lint
```

- [x] **Step 9: Commit**

```bash
git add src/app/beheer/platform/page.tsx src/shared/components/layout/OmgevingBanner.tsx e2e/platform-uitbreiding.spec.ts
git commit -m "feat(platform): bewerk/deactiveer/openen-acties + terugkeer-link"
```

---

### Taak 9: Volledige verificatie

- [x] **Step 1: Backend**

```powershell
cd C:\DEV\Work\MCM2
npm run verify:volledig
```

- [x] **Step 2: Frontend, los** — gedekt door dezelfde `verify:volledig`-run
  (die draait format:check/lint/typecheck/playwright al voor de
  frontend-repo).

```powershell
cd ..\MCM2-frontend
npm run format:check
npm run lint
npx tsc --noEmit
npx playwright test
```

- [ ] **Step 3: Handmatige doorloop** — laat dit aan de eigenaar; niet zelf
  uitvoeren alsof het gedaan is. Vraag hem: log in als platformbeheerder,
  ga naar Platformbeheer, bewerk een tenant, deactiveer een testtenant, en
  klik "Openen" op een echte tenant om te bevestigen dat de wissel voelt
  als één klik.

- [x] **Step 4: `docs/STATUS.md` bijwerken**

Korte entry: welke issue/feature, backend + frontend, welke branch,
verify-status, en de twee ontwerpaanpassingen die tijdens het bouwen aan
het licht kwamen (de terugkeer-route zonder tenant-id in de frontend, en
de `sessie_aanmaken()`-uitbreiding voor `tenant.deleted_at`).

---

## Na dit plan — REQUIRED: superpowers:finishing-a-development-branch

Volg die skill voor de opties in **beide** repositories.

**Herinnering:** een verzoek om dit "in productie te krijgen" impliceert
eerst `npm run deploy:staging` met een zichtbare rookproef, vóór de
`productie-aws.yml`-workflow start (zie memory
`mcm2-productie-impliceert-staging-eerst`).
