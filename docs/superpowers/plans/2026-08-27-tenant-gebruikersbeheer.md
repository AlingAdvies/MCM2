# Tenant-gebruikersbeheer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een tenant-admin kan zelf collega's uitnodigen, hun rol wijzigen en
hun toegang intrekken — zonder dat de eigenaar dit met de hand in de database
doet. Drie rollen (`admin`/`user`/`reviewer`) in plaats van twee.

**Architecture:** Uitbreiding van het bestaande rollenmodel
(`clm.tenant_membership.role`) en het bestaande uitnodigingstoken-mechanisme
(`src/auth/uitnodigingstoken.ts`, al gebruikt door `PlatformController`).
Nieuwe routes onder `/tenant/leden`, een nieuwe rol `user` met dezelfde
schrijfrechten als `admin` behalve op deze routes zelf, en een nieuw
frontend-scherm. Platformbeheerder-toegang loopt via het bestaande
support-toegang-mechanisme (ADR-015).

**Tech Stack:** NestJS, Drizzle (handgeschreven SQL-migraties, geen
`db:generate`), PostgreSQL met RLS, Jest e2e-tests tegen een wegwerpcontainer,
Next.js in de zusterrepo `MCM2-frontend`.

**Spec:** `docs/superpowers/specs/2026-08-27-tenant-gebruikersbeheer-design.md`

---

## Vooraf — testdatabase

Alle backendtaken draaien tegen een wegwerpcontainer. Vóór Taak 1:

```powershell
npm run test:db -- "tenant-gebruikersbeheer"
```

**Verwacht resultaat:** de container draait, en het script drukt aan het eind
`MIGRATION_DATABASE_URL` en `DATABASE_URL` af. Exporteer beide in de shell
waarin de taken hierna draaien. Bij een volgende sessie op dezelfde container:
`npm run test:db -- "tenant-gebruikersbeheer" --hergebruik`.

---

### Taak 1: Migratie — rol `user` toevoegen

**Files:**
- Create: `drizzle/0032_tenant_membership_rol_user.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/db/schema.ts:122-126`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- clm.tenant_membership krijgt een vierde toegestane rolwaarde: 'user'.
--
-- 'user' (contractbeheerder) krijgt dezelfde schrijfrechten als 'admin' op
-- alles behalve tenant-gebruikersbeheer zelf (Taak 3/4 in dit plan) en de
-- twee routes die zelf bevoegdheden toekennen (koppelReviewer/
-- ontkoppelReviewer, maakRonde — zie
-- docs/superpowers/specs/2026-08-27-tenant-gebruikersbeheer-design.md §3).
--
-- 'support' bestond al sinds migratie 0020 (ADR-015) en blijft ongewijzigd.
-- Geen wijziging aan de primary key of de unieke index
-- tenant_membership_een_actief_per_gebruiker: die blijven zoals migratie 0020
-- ze zette. Zie de spec §7 voor waarom een surrogaatsleutel hier bewust niet
-- gekozen is (botst met PlatformService.supportToegangGeven()).

ALTER TABLE clm.tenant_membership
    DROP CONSTRAINT tenant_membership_role_check;--> statement-breakpoint

ALTER TABLE clm.tenant_membership
    ADD CONSTRAINT tenant_membership_role_check
    CHECK (role IN ('admin', 'user', 'reviewer', 'support'));--> statement-breakpoint

COMMENT ON CONSTRAINT tenant_membership_role_check ON clm.tenant_membership IS
    'Vier rollen. admin, user en reviewer horen bij de klant: user heeft dezelfde schrijfrechten als admin behalve op tenant-gebruikersbeheer zelf (issue #75). support hoort bij het platform — meekijken zonder wijzigen, tijdelijk (ADR-015).';
```

- [ ] **Step 2: Registreer de migratie in `_journal.json`**

Open `drizzle/meta/_journal.json`, zoek de hoogste bestaande `idx` (0031) en
voeg een nieuw item toe met exact hetzelfde patroon als het item ervoor
(`idx: 32`, `tag: "0032_tenant_membership_rol_user"`, `when` als huidige
epoch-ms). **Zonder deze stap slaat `migrate:deploy` de migratie stilzwijgend
over** (CLAUDE.md, "vier dingen die het vaakst misgaan", punt 3).

- [ ] **Step 3: Werk het Drizzle-schema bij**

In `src/db/schema.ts`, regel 122-126, het commentaarblok boven de `role`-kolom
van `tenantMembership`:

```ts
    // 'admin' beheert leveranciers, vragenlijsten en rondes.
    // 'user' (contractbeheerder) mag hetzelfde als 'admin', behalve
    // tenant-gebruikersbeheer zelf (issue #75).
    // 'reviewer' vult interne beoordelingen in en leest resultaten.
    // 'support' kijkt mee vanuit het platform: lezen, tijdelijk, en
    // herkenbaar als zodanig in de audit trail (ADR-015).
```

- [ ] **Step 4: Migratie uitvoeren en teruglezen**

```powershell
npm run migrate:deploy
```

Verwacht resultaat: geen fouten. Teruglezen:

```powershell
node scripts/migratiestand.js
```

Verwacht resultaat: hoogste migratie is `0032_tenant_membership_rol_user`.

- [ ] **Step 5: Handmatige constraint-check**

```powershell
docker exec <container> psql -U postgres -d <db> -c "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'tenant_membership_role_check';"
```

Verwacht resultaat: de definitie bevat `'admin'::text, 'user'::text,
'reviewer'::text, 'support'::text` (volgorde kan afwijken).

- [ ] **Step 6: Commit**

```bash
git add drizzle/0032_tenant_membership_rol_user.sql drizzle/meta/_journal.json src/db/schema.ts
git commit -m "feat(tenant): rol 'user' toegevoegd aan tenant_membership (issue #75)"
```

---

### Taak 2: `RolGuard`/`VereistRol` — meerdere rollen toestaan

**Files:**
- Modify: `src/auth/rol.guard.ts`
- Test: `src/auth/rol.guard.spec.ts` (nieuw, indien nog niet bestaand — check eerst met `Glob`)

- [ ] **Step 1: Schrijf de falende tests**

Maak (of vul aan) `src/auth/rol.guard.spec.ts`:

```ts
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RolGuard, VereistRol, VEREISTE_ROL } from './rol.guard';

function context(
  rollen: string[] | undefined,
  sessieRol: string | undefined,
): ExecutionContext {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(rollen);
  const request = {
    sessie: sessieRol ? { role: sessieRol } : undefined,
  };
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('RolGuard met meerdere toegestane rollen', () => {
  it('laat een sessie door wiens rol in de lijst staat', () => {
    const reflector = new Reflector();
    const spy = jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['admin', 'user']);
    const guard = new RolGuard(reflector);
    const ctx = context(['admin', 'user'], 'user');

    expect(guard.canActivate(ctx)).toBe(true);
    spy.mockRestore();
  });

  it('weigert een sessie wiens rol niet in de lijst staat', () => {
    const reflector = new Reflector();
    const guard = new RolGuard(reflector);
    const ctx = context(['admin', 'user'], 'reviewer');

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('blijft werken met precies één toegestane rol (bestaand gedrag)', () => {
    const reflector = new Reflector();
    const guard = new RolGuard(reflector);
    const ctx = context(['admin'], 'admin');

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('VereistRol met één argument zet een array met dat ene element', () => {
    const decorator = VereistRol('admin');
    // SetMetadata-decorators zijn lastig direct te unit-testen; deze test
    // bewijst het via de metadata-key die VereistRol gebruikt.
    expect(VEREISTE_ROL).toBe('vereisteRol');
    expect(typeof decorator).toBe('function');
  });
});
```

- [ ] **Step 2: Run tests, verwacht FAIL**

```powershell
npx jest src/auth/rol.guard.spec.ts
```

Verwacht: FAIL — `getAllAndOverride` retourneert nu een array, maar
`RolGuard.canActivate` vergelijkt nog met `!==` tegen een `string`.

- [ ] **Step 3: Pas `rol.guard.ts` aan**

Vervang in `src/auth/rol.guard.ts`:

```ts
export const VEREISTE_ROL = 'vereisteRol';

/** Markeert een route of controller als "alleen voor deze rol(len)". */
export const VereistRol = (...rollen: string[]) =>
  SetMetadata(VEREISTE_ROL, rollen);

@Injectable()
export class RolGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const vereist = this.reflector.getAllAndOverride<string[] | undefined>(
      VEREISTE_ROL,
      [context.getHandler(), context.getClass()],
    );

    // Geen eis op deze route: iedereen met een geldige sessie mag door. De
    // authenticatie is dan al gedaan door TenantContextGuard.
    if (!vereist || vereist.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestMetSessie>();
    const sessie = request.sessie;

    // Geen sessie betekent dat TenantContextGuard niet gedraaid heeft — een
    // programmeerfout, geen gebruikersfout. Weigeren in plaats van doorlaten:
    // een guard die bij twijfel toestaat, is geen guard.
    if (!sessie) {
      throw new ForbiddenException('Geen sessie.');
    }

    if (!vereist.includes(sessie.role)) {
      throw new ForbiddenException(
        'U heeft geen rechten voor deze handeling. Neem contact op met uw beheerder.',
      );
    }

    return true;
  }
}
```

Ook het commentaarblok bovenaan het bestand (regels 12-38) blijft ongewijzigd
inhoudelijk correct — geen aanpassing nodig, behalve waar het letterlijk
"deze rol" (enkelvoud) zegt; dat mag blijven staan, het is nog steeds waar per
individuele controle.

- [ ] **Step 4: Run tests, verwacht PASS**

```powershell
npx jest src/auth/rol.guard.spec.ts
```

Verwacht: alle 4 tests slagen.

- [ ] **Step 5: Volledige unit-testsuite draaien**

```powershell
npx jest --testPathIgnorePatterns=e2e-spec
```

Verwacht: geen regressies — `VereistRol('admin')` (één argument) wordt door
bestaande code nog steeds correct als array `['admin']` doorgegeven.

- [ ] **Step 6: Commit**

```bash
git add src/auth/rol.guard.ts src/auth/rol.guard.spec.ts
git commit -m "feat(auth): RolGuard staat meerdere toegestane rollen toe"
```

---

### Taak 3: Bestaande routes openstellen voor `user`

**Files:**
- Modify: `src/vendor/vendor.controller.ts:79,134,169,198,213,244,276`
- Modify: `src/contract/contract.controller.ts:62,112,141,183`
- Modify: `src/tenant/tenant.controller.ts:66`

Dit is een mechanische vervanging: elke `@VereistRol('admin')` in deze drie
bestanden wordt `@VereistRol('admin', 'user')`. **Uitgezonderd:** niets in
deze drie bestanden hoort bij de twee bewust-`admin`-only-routes uit de spec
(die staan in `vragenlijst-beheer.controller.ts`, blijven in Taak 3 met rust
— zie de aparte paragraaf hieronder).

- [ ] **Step 1: Schrijf de falende tests — `vendor.controller.ts`**

Zoek het bestaande e2e-bestand dat rolcontrole op vendor-routes test:

```powershell
Get-ChildItem test -Filter "*vendor*rol*"
Get-ChildItem test -Filter "*vendor*rechten*"
```

Als zo'n bestand bestaat, voeg daar een test-blok aan toe (pas de exacte
sessie-opzet aan het patroon van dat bestand aan). Is er geen dergelijk
bestand, maak `test/vendor-rol-user.e2e-spec.ts` volgens het patroon van
`test/tenant-gebruikers.e2e-spec.ts` (imports, `migratieUrl()`, opruimen),
met test-ids `TEST_IDS['vendor-rol-user']` (toe te voegen aan
`test/test-ids.ts`, prefix `f7`):

```ts
'vendor-rol-user': {
  tenant: id('f7'),
  userRol: id('f8'),
},
```

Test:

```ts
it('een gebruiker met rol user mag een leverancier aanmaken', async () => {
  const respons = await request(app.getHttpServer())
    .post('/vendors')
    .set('Cookie', cookieVoorUser)
    .send({ name: 'Testleverancier user-rol' });

  expect(respons.status).toBe(201);
});
```

- [ ] **Step 2: Run, verwacht FAIL**

```powershell
npx jest test/vendor-rol-user.e2e-spec.ts
```

Verwacht: FAIL met 403 — `user` staat nog niet in de toegestane rollen.

- [ ] **Step 3: Pas de controllers aan**

In elk van de drie bestanden, vervang letterlijk `@VereistRol('admin')` door
`@VereistRol('admin', 'user')` op de genoemde regelnummers. Geen andere
wijziging — de bestaande commentaarblokken erboven (bijv.
`vendor.controller.ts:129-132`, `tenant.controller.ts:32-37`) blijven
inhoudelijk kloppen en hoeven niet herschreven; voeg wel één regel toe direct
boven de decorator waar een uitleg staat:

```ts
  // `user` mag hetzelfde als `admin` op deze route (issue #75) — de
  // uitzonderingen staan in vragenlijst-beheer.controller.ts.
  @VereistRol('admin', 'user')
```

- [ ] **Step 4: Run, verwacht PASS**

```powershell
npx jest test/vendor-rol-user.e2e-spec.ts
```

- [ ] **Step 5: Volledige e2e-run**

```powershell
npx jest --config jest.e2e.config.js
```

Verwacht: alle suites groen, inclusief bestaande vendor/contract/
tenant-suites die `admin` gebruiken (die blijven werken — `admin` staat nog
steeds in de lijst).

- [ ] **Step 6: Commit**

```bash
git add src/vendor/vendor.controller.ts src/contract/contract.controller.ts src/tenant/tenant.controller.ts test/vendor-rol-user.e2e-spec.ts test/test-ids.ts
git commit -m "feat(rechten): rol 'user' krijgt dezelfde schrijfrechten als 'admin' op vendors/contracten/tenant-instellingen"
```

---

### Taak 4: Tegenproef — `user` blijft geweerd van bevoegdheid-toekennende routes

**Files:**
- Test: `test/vendor-rol-user.e2e-spec.ts` (uitbreiden) of nieuw bestand `test/survey-beheer-rol-user.e2e-spec.ts`

Dit is spec-tegenproef 4: `koppelReviewer`, `ontkoppelReviewer` en `maakRonde`
in `src/survey/vragenlijst-beheer.controller.ts` blijven `@VereistRol('admin')`
zónder `user` — **geen wijziging aan die drie regels** (429, 450, 476 zijn de
huidige regelnummers; controleer bij het uitvoeren of ze nog kloppen, want
Taak 3 wijzigt andere bestanden niet dit bestand).

- [ ] **Step 1: Schrijf de test**

```ts
it('een gebruiker met rol user krijgt 403 op het aanmaken van een ronde', async () => {
  const respons = await request(app.getHttpServer())
    .post('/vragenlijstbeheer/runs')
    .set('Cookie', cookieVoorUser)
    .send({ templateId: '...' });

  expect(respons.status).toBe(403);
});

it('een gebruiker met rol user krijgt 403 op het koppelen van een reviewer', async () => {
  const respons = await request(app.getHttpServer())
    .post('/vragenlijstbeheer/templates/<id>/reviewers')
    .set('Cookie', cookieVoorUser)
    .send({ userId: '<id>' });

  expect(respons.status).toBe(403);
});
```

- [ ] **Step 2: Run — verwacht PASS meteen**

```powershell
npx jest test/vendor-rol-user.e2e-spec.ts
```

Dit hoort **meteen te slagen** zonder codewijziging: `vragenlijst-beheer.controller.ts`
is in Taak 3 niet aangeraakt. Slaagt hij niet, dan is dat een teken dat Taak 3
per ongeluk ook dit bestand wijzigde — controleer `git diff` van Taak 3's
commit.

- [ ] **Step 3: Commit**

```bash
git add test/vendor-rol-user.e2e-spec.ts
git commit -m "test(rechten): tegenproef — user blijft geweerd van ronde-aanmaak en reviewer-koppeling"
```

---

### Taak 5: Uitnodig-invoer valideren (`tenant-leden-invoer.ts`)

**Files:**
- Create: `src/tenant/tenant-leden-invoer.ts`
- Test: `src/tenant/tenant-leden-invoer.spec.ts`

- [ ] **Step 1: Bekijk het bestaande patroon**

```powershell
Get-Content src/tenant/tenant-invoer.ts
```

Volg exact hetzelfde patroon (een `leesX(body: unknown): X`-functie die
`InvoerFout` gooit uit `src/vendor/vendor-invoer.ts`).

- [ ] **Step 2: Schrijf de falende tests**

```ts
import { InvoerFout } from '../vendor/vendor-invoer';
import { leesNieuwLid, leesRolWijziging } from './tenant-leden-invoer';

describe('leesNieuwLid', () => {
  it('accepteert een geldig e-mailadres en rol', () => {
    const invoer = leesNieuwLid({
      email: 'collega@transdev.nl',
      rol: 'user',
    });
    expect(invoer).toEqual({ email: 'collega@transdev.nl', rol: 'user' });
  });

  it('weigert een ongeldig e-mailadres', () => {
    expect(() => leesNieuwLid({ email: 'geen-emailadres', rol: 'user' }))
      .toThrow(InvoerFout);
  });

  it('weigert een onbekende rol', () => {
    expect(() =>
      leesNieuwLid({ email: 'collega@transdev.nl', rol: 'superadmin' }),
    ).toThrow(InvoerFout);
  });

  it('weigert de rol support — die wordt nooit via deze route gezet', () => {
    expect(() =>
      leesNieuwLid({ email: 'collega@transdev.nl', rol: 'support' }),
    ).toThrow(InvoerFout);
  });
});

describe('leesRolWijziging', () => {
  it('accepteert admin, user en reviewer', () => {
    expect(leesRolWijziging({ rol: 'admin' })).toEqual({ rol: 'admin' });
    expect(leesRolWijziging({ rol: 'user' })).toEqual({ rol: 'user' });
    expect(leesRolWijziging({ rol: 'reviewer' })).toEqual({ rol: 'reviewer' });
  });

  it('weigert support', () => {
    expect(() => leesRolWijziging({ rol: 'support' })).toThrow(InvoerFout);
  });
});
```

- [ ] **Step 3: Run, verwacht FAIL**

```powershell
npx jest src/tenant/tenant-leden-invoer.spec.ts
```

Verwacht: FAIL — module bestaat nog niet.

- [ ] **Step 4: Implementeer**

```ts
import { InvoerFout } from '../vendor/vendor-invoer';

/** Rollen die via deze route toegekend mogen worden. 'support' nooit — dat
 * gaat uitsluitend via PlatformService.supportToegangGeven(). */
const TOEGESTANE_ROLLEN = ['admin', 'user', 'reviewer'] as const;
type ToegestaneRol = (typeof TOEGESTANE_ROLLEN)[number];

export interface NieuwLid {
  email: string;
  rol: ToegestaneRol;
}

export interface RolWijziging {
  rol: ToegestaneRol;
}

const EMAIL_PATROON = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function leesRol(waarde: unknown): ToegestaneRol {
  if (
    typeof waarde !== 'string' ||
    !TOEGESTANE_ROLLEN.includes(waarde as ToegestaneRol)
  ) {
    throw new InvoerFout('rol', 'Kies admin, user of reviewer.');
  }
  return waarde as ToegestaneRol;
}

export function leesNieuwLid(body: unknown): NieuwLid {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('email', 'Ongeldige invoer.');
  }
  const { email, rol } = body as Record<string, unknown>;

  if (typeof email !== 'string' || !EMAIL_PATROON.test(email)) {
    throw new InvoerFout('email', 'Vul een geldig e-mailadres in.');
  }

  return { email, rol: leesRol(rol) };
}

export function leesRolWijziging(body: unknown): RolWijziging {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('rol', 'Ongeldige invoer.');
  }
  const { rol } = body as Record<string, unknown>;
  return { rol: leesRol(rol) };
}
```

- [ ] **Step 5: Run, verwacht PASS**

```powershell
npx jest src/tenant/tenant-leden-invoer.spec.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/tenant/tenant-leden-invoer.ts src/tenant/tenant-leden-invoer.spec.ts
git commit -m "feat(tenant): invoervalidatie voor tenant-ledenbeheer"
```

---

### Taak 6: `TenantLedenService` — lijst, uitnodigen, rol wijzigen, intrekken

**Files:**
- Create: `src/tenant/tenant-leden.service.ts`
- Test: `src/tenant/tenant-leden.service.spec.ts` (unit, met een test-database via `npm run test:db`)

Dit is de kerntaak. Bekijk eerst `src/platform/platform.service.ts:145-230`
voor het bestaande uitnodig-patroon (token genereren, `withTenant`,
`ConflictException` bij een botsing) — dit hergebruikt exact die stijl.

- [ ] **Step 1: Schrijf de falende tests**

```ts
import { DatabaseService } from '../db/database.service';
import { ConflictException } from '@nestjs/common';
import { TenantLedenService } from './tenant-leden.service';
// Gebruik dezelfde opzet als een bestaande *.service.spec.ts die tegen een
// echte testdatabase draait — zoek het patroon in bijv.
// src/vendor/vendor.service.spec.ts vóór je begint.

describe('TenantLedenService', () => {
  // ... db-opzet zoals het gevonden patroon ...

  it('nodigt een nieuw e-mailadres uit met een token', async () => {
    const resultaat = await service.uitnodigen(tenantId, {
      email: 'nieuw@transdev.nl',
      rol: 'user',
    });

    expect(resultaat.uitnodigingslink).toContain('uitnodiging=');
    expect(resultaat.rol).toBe('user');
  });

  it('weigert een e-mailadres met een al-actieve membership in dezelfde tenant', async () => {
    await service.uitnodigen(tenantId, { email: 'dubbel@transdev.nl', rol: 'user' });

    await expect(
      service.uitnodigen(tenantId, { email: 'dubbel@transdev.nl', rol: 'reviewer' }),
    ).rejects.toThrow(ConflictException);
  });

  it('weigert een e-mailadres met een actieve membership bij een andere tenant', async () => {
    // Maak eerst een membership in tenantB voor dit e-mailadres aan (directe
    // insert, buiten de service om), en verwacht ConflictException bij
    // uitnodigen in tenantA.
  });

  it('nodigt een eerder ingetrokken gebruiker opnieuw uit door de bestaande rij bij te werken', async () => {
    const eerste = await service.uitnodigen(tenantId, {
      email: 'herstel@transdev.nl',
      rol: 'reviewer',
    });
    await service.intrekken(tenantId, eerste.userId, adminUserId);

    const tweede = await service.uitnodigen(tenantId, {
      email: 'herstel@transdev.nl',
      rol: 'user',
    });

    expect(tweede.userId).toBe(eerste.userId);
    expect(tweede.rol).toBe('user');
  });

  it('wijzigt de rol van een bestaand lid', async () => {
    const lid = await service.uitnodigen(tenantId, {
      email: 'wijzig@transdev.nl',
      rol: 'reviewer',
    });

    await service.rolWijzigen(tenantId, lid.userId, 'admin');

    const lijst = await service.lijst(tenantId);
    const bijgewerkt = lijst.find((l) => l.userId === lid.userId);
    expect(bijgewerkt?.rol).toBe('admin');
  });

  it('weigert de laatste admin te degraderen', async () => {
    // In een verse tenant met precies één admin (de aanroeper zelf):
    await expect(
      service.rolWijzigen(tenantId, enigeAdminUserId, 'user'),
    ).rejects.toThrow(ConflictException);
  });

  it('weigert de laatste admin in te trekken', async () => {
    await expect(
      service.intrekken(tenantId, enigeAdminUserId, enigeAdminUserId),
    ).rejects.toThrow(ConflictException);
  });

  it('trekt een gebruiker in zonder de rij te verwijderen', async () => {
    const lid = await service.uitnodigen(tenantId, {
      email: 'intrek@transdev.nl',
      rol: 'reviewer',
    });
    await service.intrekken(tenantId, lid.userId, adminUserId);

    const lijst = await service.lijst(tenantId);
    const ingetrokken = lijst.find((l) => l.userId === lid.userId);
    expect(ingetrokken?.status).toBe('ingetrokken');
  });
});
```

- [ ] **Step 2: Run, verwacht FAIL**

```powershell
npx jest src/tenant/tenant-leden.service.spec.ts
```

- [ ] **Step 3: Implementeer**

```ts
import { ConflictException, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import {
  genereerUitnodigingstoken,
  hashUitnodigingstoken,
} from '../auth/uitnodigingstoken';
import { DatabaseService } from '../db/database.service';

/** Hoe lang een tenant-uitnodiging geldig blijft — zelfde als de
 * platformbeheerder-uitnodiging (PlatformService). */
const UITNODIGING_GELDIGHEID_UREN = 7 * 24;

export interface TenantLid {
  userId: string;
  naam: string;
  email: string;
  rol: string;
  status: 'actief' | 'uitnodiging_open' | 'ingetrokken';
  sinds: Date;
}

export interface NieuwLidResultaat {
  userId: string;
  rol: string;
  uitnodigingslink: string;
}

@Injectable()
export class TenantLedenService {
  constructor(private readonly db: DatabaseService) {}

  async lijst(tenantId: string): Promise<TenantLid[]> {
    return this.db.withTenant(tenantId, async (tx) => {
      const { rows } = await tx.execute<{
        user_id: string;
        full_name: string;
        email: string;
        role: string;
        deleted_at: string | null;
        uitnodiging_hash: string | null;
        created_at: string;
      }>(
        sql`SELECT u.user_id, u.full_name, u.email, m.role,
                   m.deleted_at, u.uitnodiging_hash, m.created_at
              FROM clm.tenant_membership m
              JOIN clm."user" u ON u.user_id = m.user_id
             WHERE m.tenant_id = ${tenantId}
               AND m.role <> 'support'
             ORDER BY u.full_name`,
      );

      return rows.map((r) => ({
        userId: r.user_id,
        naam: r.full_name,
        email: r.email,
        rol: r.role,
        status:
          r.deleted_at !== null
            ? ('ingetrokken' as const)
            : r.uitnodiging_hash !== null
              ? ('uitnodiging_open' as const)
              : ('actief' as const),
        sinds: new Date(r.created_at),
      }));
    });
  }

  async uitnodigen(
    tenantId: string,
    invoer: { email: string; rol: string },
  ): Promise<NieuwLidResultaat> {
    const token = genereerUitnodigingstoken();
    const tokenHash = hashUitnodigingstoken(token);
    const verlooptOp = new Date(
      Date.now() + UITNODIGING_GELDIGHEID_UREN * 60 * 60 * 1000,
    );

    return this.db.withTenant(tenantId, async (tx) => {
      // Bestaat er al een user-rij met dit e-mailadres?
      const bestaand = await tx.execute<{
        user_id: string;
        actieve_membership_tenant: string | null;
        ingetrokken_membership: boolean;
      }>(
        sql`SELECT u.user_id,
                   (SELECT m2.tenant_id FROM clm.tenant_membership m2
                     WHERE m2.user_id = u.user_id
                       AND m2.deleted_at IS NULL
                       AND m2.role <> 'support'
                     LIMIT 1) AS actieve_membership_tenant,
                   EXISTS (
                     SELECT 1 FROM clm.tenant_membership m3
                      WHERE m3.user_id = u.user_id
                        AND m3.tenant_id = ${tenantId}
                        AND m3.deleted_at IS NOT NULL
                   ) AS ingetrokken_membership
              FROM clm."user" u
             WHERE u.email = ${invoer.email}
               AND u.deleted_at IS NULL`,
      );

      if (bestaand.rows.length > 0) {
        const rij = bestaand.rows[0];

        if (rij.actieve_membership_tenant !== null) {
          throw new ConflictException(
            rij.actieve_membership_tenant === tenantId
              ? 'Dit e-mailadres heeft al toegang tot deze tenant.'
              : 'Dit e-mailadres heeft al toegang tot een andere tenant.',
          );
        }

        if (rij.ingetrokken_membership) {
          // Geval 2 (spec §5a): bestaande, ingetrokken rij hergebruiken.
          // Geen nieuwe rij — zie spec §7 voor de reden.
          await tx.execute(
            sql`UPDATE clm.tenant_membership
                   SET role = ${invoer.rol}, deleted_at = NULL
                 WHERE user_id = ${rij.user_id} AND tenant_id = ${tenantId}`,
          );
          await tx.execute(
            sql`UPDATE clm."user"
                   SET uitnodiging_hash = ${tokenHash},
                       koppelbaar_tot = ${verlooptOp.toISOString()}
                 WHERE user_id = ${rij.user_id}`,
          );

          return {
            userId: rij.user_id,
            rol: invoer.rol,
            uitnodigingslink: this.uitnodigingsLink(token),
          };
        }

        // Geval 3, geen actieve en geen ingetrokken membership bij déze
        // tenant, maar de user-rij bestaat wel (bv. nooit gekoppeld geraakt).
        // Nieuwe membership-rij voor deze tenant.
        await tx.execute(
          sql`INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
              VALUES (${rij.user_id}, ${tenantId}, ${invoer.rol})`,
        );
        await tx.execute(
          sql`UPDATE clm."user"
                 SET uitnodiging_hash = ${tokenHash},
                     koppelbaar_tot = ${verlooptOp.toISOString()}
               WHERE user_id = ${rij.user_id}`,
        );

        return {
          userId: rij.user_id,
          rol: invoer.rol,
          uitnodigingslink: this.uitnodigingsLink(token),
        };
      }

      // Geval 1: geheel nieuw e-mailadres.
      const nieuw = await tx.execute<{ user_id: string }>(
        sql`INSERT INTO clm."user"
              (tenant_id, full_name, email, uitnodiging_hash, koppelbaar_tot)
            VALUES (${tenantId}, ${invoer.email}, ${invoer.email},
                    ${tokenHash}, ${verlooptOp.toISOString()})
            RETURNING user_id`,
      );
      const userId = nieuw.rows[0].user_id;

      await tx.execute(
        sql`INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
            VALUES (${userId}, ${tenantId}, ${invoer.rol})`,
      );

      return {
        userId,
        rol: invoer.rol,
        uitnodigingslink: this.uitnodigingsLink(token),
      };
    });
  }

  async rolWijzigen(
    tenantId: string,
    userId: string,
    nieuweRol: string,
  ): Promise<void> {
    return this.db.withTenant(tenantId, async (tx) => {
      if (nieuweRol !== 'admin') {
        await this.weigerAlsLaatsteAdmin(tx, tenantId, userId);
      }

      await tx.execute(
        sql`UPDATE clm.tenant_membership
               SET role = ${nieuweRol}
             WHERE user_id = ${userId} AND tenant_id = ${tenantId}
               AND deleted_at IS NULL`,
      );
    });
  }

  async intrekken(
    tenantId: string,
    userId: string,
    _doorUserId: string,
  ): Promise<void> {
    return this.db.withTenant(tenantId, async (tx) => {
      await this.weigerAlsLaatsteAdmin(tx, tenantId, userId);

      await tx.execute(
        sql`UPDATE clm.tenant_membership
               SET deleted_at = now()
             WHERE user_id = ${userId} AND tenant_id = ${tenantId}
               AND deleted_at IS NULL`,
      );
    });
  }

  /** Gooit ConflictException als het wijzigen/intrekken van `userId` de
   * tenant zonder actieve admin zou achterlaten. */
  private async weigerAlsLaatsteAdmin(
    tx: Parameters<
      Parameters<DatabaseService['withTenant']>[1]
    >[0],
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const { rows } = await tx.execute<{ aantal: string }>(
      sql`SELECT count(*) AS aantal
            FROM clm.tenant_membership
           WHERE tenant_id = ${tenantId}
             AND role = 'admin'
             AND deleted_at IS NULL
             AND user_id <> ${userId}`,
    );

    const overigeAdmins = Number(rows[0].aantal);
    const dezeIsAdmin = await tx.execute<{ role: string }>(
      sql`SELECT role FROM clm.tenant_membership
           WHERE user_id = ${userId} AND tenant_id = ${tenantId}
             AND deleted_at IS NULL`,
    );

    if (
      dezeIsAdmin.rows[0]?.role === 'admin' &&
      overigeAdmins === 0
    ) {
      throw new ConflictException(
        'Dit is de enige beheerder van deze tenant. Wijs eerst een andere beheerder aan.',
      );
    }
  }

  private uitnodigingsLink(token: string): string {
    const basis = process.env.APP_BASE_URL ?? 'http://localhost:3000';
    return `${basis}/api/backend/auth/login?uitnodiging=${encodeURIComponent(token)}`;
  }
}
```

**Let op vóór het draaien:** controleer de exacte signatuur van
`DatabaseService.withTenant` in `src/db/database.service.ts` — het
`tx`-type in `weigerAlsLaatsteAdmin` moet overeenkomen met wat die functie
werkelijk doorgeeft. Pas het type aan als de inferentie hierboven niet
compileert; de query's zelf blijven ongewijzigd.

- [ ] **Step 4: Run, verwacht PASS**

```powershell
npx jest src/tenant/tenant-leden.service.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/tenant/tenant-leden.service.ts src/tenant/tenant-leden.service.spec.ts
git commit -m "feat(tenant): TenantLedenService — lijst, uitnodigen, rol wijzigen, intrekken"
```

---

### Taak 7: Routes — `TenantLedenController`

**Files:**
- Create: `src/tenant/tenant-leden.controller.ts`
- Test: `test/tenant-leden.e2e-spec.ts`
- Modify: `src/tenant/tenant.module.ts` (registreer de nieuwe controller/service)

- [ ] **Step 1: Bekijk `tenant.module.ts`**

```powershell
Get-Content src/tenant/tenant.module.ts
```

- [ ] **Step 2: Schrijf de falende e2e-tests**

Voeg toe aan `test/test-ids.ts`:

```ts
'tenant-leden': {
  tenant: id('f9'),
  admin: id('fa'),
  tweedeAdmin: id('fb'),
  andereTenant: id('fc'),
},
```

Maak `test/tenant-leden.e2e-spec.ts` — volg het opzet-/opruimpatroon van
`test/tenant-gebruikers.e2e-spec.ts` (imports, `migratieUrl()`, `SessieService`,
`cookieParser`). Kerntests (dekken spec-tegenproeven 1, 2, 5, 6, 7, 9, 11):

```ts
describe('POST /tenant/leden', () => {
  it('een admin kan een collega uitnodigen', async () => {
    const respons = await request(app.getHttpServer())
      .post('/tenant/leden')
      .set('Cookie', cookieAdmin)
      .send({ email: 'nieuw@transdev.nl', rol: 'user' });

    expect(respons.status).toBe(201);
    expect(respons.body.uitnodigingslink).toContain('uitnodiging=');
  });

  it('een reviewer krijgt 403', async () => {
    const respons = await request(app.getHttpServer())
      .post('/tenant/leden')
      .set('Cookie', cookieReviewer)
      .send({ email: 'x@transdev.nl', rol: 'user' });

    expect(respons.status).toBe(403);
  });

  it('een user krijgt 403', async () => {
    const respons = await request(app.getHttpServer())
      .post('/tenant/leden')
      .set('Cookie', cookieUser)
      .send({ email: 'x@transdev.nl', rol: 'reviewer' });

    expect(respons.status).toBe(403);
  });
});

describe('GET /tenant/leden — tenantgrens', () => {
  it('toont geen leden van een andere tenant', async () => {
    const respons = await request(app.getHttpServer())
      .get('/tenant/leden')
      .set('Cookie', cookieAdminAndereTenant);

    const ids = respons.body.leden.map((l: { userId: string }) => l.userId);
    expect(ids).not.toContain(adminUserIdVanDeEersteTenant);
  });
});

describe('elke route weigert reviewer en user (tegenproeven 1 en 2)', () => {
  it.each([
    ['GET', '/tenant/leden'],
    ['PUT', `/tenant/leden/${eenBestaandUserId}/rol`],
    ['POST', `/tenant/leden/${eenBestaandUserId}/intrekken`],
  ])('%s %s geeft 403 voor reviewer', async (methode, pad) => {
    const respons = await request(app.getHttpServer())
      [methode.toLowerCase() as 'get' | 'put' | 'post'](pad)
      .set('Cookie', cookieReviewer)
      .send({ rol: 'admin' });

    expect(respons.status).toBe(403);
  });

  it.each([
    ['GET', '/tenant/leden'],
    ['PUT', `/tenant/leden/${eenBestaandUserId}/rol`],
    ['POST', `/tenant/leden/${eenBestaandUserId}/intrekken`],
  ])('%s %s geeft 403 voor user', async (methode, pad) => {
    const respons = await request(app.getHttpServer())
      [methode.toLowerCase() as 'get' | 'put' | 'post'](pad)
      .set('Cookie', cookieUser)
      .send({ rol: 'admin' });

    expect(respons.status).toBe(403);
  });
});

describe('platformbeheerder zonder support-toegang (tegenproef 9)', () => {
  it('krijgt 403 op GET /tenant/leden zonder actieve support-membership', async () => {
    // cookiePlatformbeheerderZonderSupport: een sessie voor een gebruiker die
    // wél platformAdmin is, maar geen (geldige) support-rij heeft in déze
    // tenant. Zie test/platformbeheer.e2e-spec.ts voor hoe zo'n sessie wordt
    // opgezet zonder support-toegang aan te vragen.
    const respons = await request(app.getHttpServer())
      .get('/tenant/leden')
      .set('Cookie', cookiePlatformbeheerderZonderSupport);

    expect(respons.status).toBe(403);
  });

  it('krijgt 200 zodra support-toegang is toegekend', async () => {
    // Roep eerst POST /platform/tenants/:id/toegang aan (bestaande route),
    // dan pas GET /tenant/leden met dezelfde sessie.
    const respons = await request(app.getHttpServer())
      .get('/tenant/leden')
      .set('Cookie', cookiePlatformbeheerderMetSupport);

    expect(respons.status).toBe(200);
  });
});

describe('laatste-admin-bescherming', () => {
  it('kan de enige admin niet degraderen', async () => {
    const respons = await request(app.getHttpServer())
      .put(`/tenant/leden/${enigeAdminUserId}/rol`)
      .set('Cookie', cookieAdmin)
      .send({ rol: 'user' });

    expect(respons.status).toBe(409);
  });

  it('kan de enige admin niet intrekken', async () => {
    const respons = await request(app.getHttpServer())
      .post(`/tenant/leden/${enigeAdminUserId}/intrekken`)
      .set('Cookie', cookieAdmin);

    expect(respons.status).toBe(409);
  });

  it('kan wél degraderen als er een tweede admin is', async () => {
    // tweedeAdmin toegevoegd in beforeAll — degraderen van de eerste admin
    // moet nu lukken.
    const respons = await request(app.getHttpServer())
      .put(`/tenant/leden/${eersteAdminUserId}/rol`)
      .set('Cookie', cookieTweedeAdmin)
      .send({ rol: 'reviewer' });

    expect(respons.status).toBe(204);
  });
});

describe('intrekken bewaart geschiedenis', () => {
  it('een ingetrokken gebruiker kan niet meer inloggen maar blijft zichtbaar', async () => {
    // Roep intrekken aan, controleer daarna GET /tenant/leden bevat de rij
    // nog met status 'ingetrokken', en dat sessie_aanmaken() voor deze
    // gebruiker geen sessie meer oplevert.
  });
});
```

- [ ] **Step 3: Run, verwacht FAIL**

```powershell
npx jest test/tenant-leden.e2e-spec.ts
```

Verwacht: FAIL — de route bestaat nog niet (404).

- [ ] **Step 4: Implementeer de controller**

```ts
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';

import { RolGuard, VereistRol } from '../auth/rol.guard';
import {
  TenantContextGuard,
  type RequestMetSessie,
} from '../auth/tenant-context.guard';
import { InvoerFout } from '../vendor/vendor-invoer';
import { leesNieuwLid, leesRolWijziging } from './tenant-leden-invoer';
import { TenantLedenService } from './tenant-leden.service';

/**
 * Wie er in de eigen tenant mag werken, en met welke rol (issue #75).
 *
 * Alle routes `@VereistRol('admin')` — een `user` mag hetzelfde als een
 * `admin` overal behalve hier: bepalen wie er in de tenant mag is beheer,
 * geen contractbeheerwerk. Zie de spec, §3.
 *
 * De platformbeheerder komt hier via het bestaande support-toegang-mechanisme
 * (ADR-015): met een geldige support-membership is zijn sessierol tijdelijk
 * 'support', niet 'admin' — die rol staat hieronder expliciet toegevoegd
 * waar het scherm ook voor hem moet werken.
 */
@Controller('tenant/leden')
@UseGuards(TenantContextGuard, RolGuard)
export class TenantLedenController {
  constructor(private readonly leden: TenantLedenService) {}

  @Get()
  @VereistRol('admin', 'support')
  async lijst(@Req() request: RequestMetSessie) {
    const leden = await this.leden.lijst(request.sessie!.tenantId);
    return { leden };
  }

  @Post()
  @VereistRol('admin', 'support')
  @HttpCode(201)
  async uitnodigen(@Req() request: RequestMetSessie, @Body() body: unknown) {
    try {
      return await this.leden.uitnodigen(
        request.sessie!.tenantId,
        leesNieuwLid(body),
      );
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

  @Put(':userId/rol')
  @VereistRol('admin', 'support')
  @HttpCode(204)
  async rolWijzigen(
    @Req() request: RequestMetSessie,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ) {
    try {
      await this.leden.rolWijzigen(
        request.sessie!.tenantId,
        userId,
        leesRolWijziging(body).rol,
      );
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

  @Post(':userId/intrekken')
  @VereistRol('admin', 'support')
  @HttpCode(204)
  async intrekken(
    @Req() request: RequestMetSessie,
    @Param('userId') userId: string,
  ) {
    await this.leden.intrekken(
      request.sessie!.tenantId,
      userId,
      request.sessie!.userId,
    );
  }
}
```

**Let op:** `ConflictException` uit de service hoeft niet apart afgevangen te
worden — Nest zet die vanzelf om naar een 409-response.

- [ ] **Step 5: Registreer in `tenant.module.ts`**

Voeg `TenantLedenController` aan `controllers` en `TenantLedenService` aan
`providers` toe, volgens hetzelfde patroon als de bestaande
`TenantController`/`TenantService`.

- [ ] **Step 6: Run, verwacht PASS**

```powershell
npx jest test/tenant-leden.e2e-spec.ts
```

- [ ] **Step 7: Volledige e2e-run**

```powershell
npx jest --config jest.e2e.config.js
```

- [ ] **Step 8: Commit**

```bash
git add src/tenant/tenant-leden.controller.ts src/tenant/tenant.module.ts test/tenant-leden.e2e-spec.ts test/test-ids.ts
git commit -m "feat(tenant): routes voor tenant-ledenbeheer (GET/POST/PUT/intrekken /tenant/leden)"
```

---

### Taak 8: Mailsjabloon voor tenant-uitnodiging

**Files:**
- Modify: `src/mail/uitnodiging-verzender.service.ts`
- Modify: `src/tenant/tenant-leden.service.ts` (mail versturen na succesvolle uitnodiging)
- Test: `src/mail/uitnodiging-verzender.service.spec.ts` (uitbreiden)

- [ ] **Step 1: Bekijk `verstuurAanBeheerder` als sjabloon**

```powershell
Get-Content src/mail/uitnodiging-verzender.service.ts
```

- [ ] **Step 2: Schrijf de falende tests**

Voeg toe aan `src/mail/uitnodiging-verzender.service.spec.ts`:

```ts
describe('verstuurAanTenantLid', () => {
  it('verstuurt een uitnodiging met de rol erin', async () => {
    const kanaal = new LogMailKanaal();
    const verzender = new UitnodigingVerzender(kanaal);

    const uitkomst = await verzender.verstuurAanTenantLid({
      ontvanger: 'collega@transdev.nl',
      tenantNaam: 'Transdev',
      rol: 'user',
      link: 'https://mcm2.example.nl/api/backend/auth/login?uitnodiging=abc',
      verlooptOp: '2026-09-01T12:00:00.000Z',
    });

    expect(uitkomst.verstuurd).toBe(true);
    expect(kanaal.laatste?.onderwerp).toContain('Transdev');
  });
});
```

- [ ] **Step 3: Run, verwacht FAIL**

```powershell
npx jest src/mail/uitnodiging-verzender.service.spec.ts
```

- [ ] **Step 4: Implementeer**

Voeg aan `UitnodigingVerzender` een methode toe naar het exacte patroon van
`verstuurAanBeheerder` (zelfde bestand) — kopieer die methode, hernoem naar
`verstuurAanTenantLid`, pas de invoer-interface aan met een `rol: string`-veld,
en pas de berichttekst aan zodat de rol erin genoemd wordt (bijv. "U bent
uitgenodigd bij Transdev als user."). Gebruik exact dezelfde
`echtVerstuurd`/`verstuurd`-onderscheiding als de bestaande methode (Issue
#131 — zie het commentaar in dat bestand).

- [ ] **Step 5: Run, verwacht PASS**

```powershell
npx jest src/mail/uitnodiging-verzender.service.spec.ts
```

- [ ] **Step 6: Koppel in `TenantLedenService.uitnodigen`**

Injecteer `UitnodigingVerzender` in `TenantLedenService`'s constructor. Na elk
geslaagd pad in `uitnodigen()` (alle drie de gevallen), roep
`verstuurAanTenantLid` aan **ná** de transactie is gecommit (zelfde volgorde
en reden als `PlatformController.tenantAanmaken` — "versturen ná het
aanmaken, nooit erin"). Geef `mailVerstuurd`/`mailFout` mee in
`NieuwLidResultaat`, net als het platformbeheerder-antwoord.

- [ ] **Step 7: Pas de e2e-tests van Taak 7 aan**

Controleer dat `test/tenant-leden.e2e-spec.ts`'s uitnodig-test nu ook
`mailVerstuurd` in de response verwacht — voeg toe indien nog niet aanwezig.

- [ ] **Step 8: Volledige e2e-run**

```powershell
npx jest --config jest.e2e.config.js
```

- [ ] **Step 9: Commit**

```bash
git add src/mail/uitnodiging-verzender.service.ts src/mail/uitnodiging-verzender.service.spec.ts src/tenant/tenant-leden.service.ts test/tenant-leden.e2e-spec.ts
git commit -m "feat(mail): tenant-lid-uitnodiging versturen bij POST /tenant/leden"
```

---

### Taak 9: `verify:volledig` (backend) draaien

- [ ] **Step 1**

```powershell
npm run verify:volledig
```

Verwacht: groen. Faalt hij, diagnosticeer het exacte falen (niet gokken) en
fix vóór verdergaan — conform CLAUDE.md, "verify:volledig tussentijds
draaien".

- [ ] **Step 2: Commit eventuele fixes apart**

```bash
git add -A
git commit -m "fix: verify:volledig-bevindingen na tenant-ledenbeheer"
```

---

### Taak 10: Frontend — API-client voor `/tenant/leden`

**Files:**
- Create: `../MCM2-frontend/src/core/services/tenantLedenService.ts`
- Test: geen apart unit-testbestand — dit is een dunne fetch-wrapper, gedekt
  door de Playwright-tests in Taak 11.

- [ ] **Step 1: Bekijk het bestaande patroon**

```powershell
Get-Content ../MCM2-frontend/src/core/services/vendorService.ts
```

- [ ] **Step 2: Implementeer**

Volg exact het patroon van `vendorService.ts` (fetch-wrapper met
`API_BASE_URL`, `credentials: 'include'`, een `Result<T>`-achtig
succes/faal-onderscheid zoals het bestaande `wijzigVendor`/`verwijderVendor`
gebruikt). Vier functies:

```ts
export interface TenantLid {
  userId: string;
  naam: string;
  email: string;
  rol: 'admin' | 'user' | 'reviewer';
  status: 'actief' | 'uitnodiging_open' | 'ingetrokken';
  sinds: string;
}

export async function haalTenantLeden(): Promise<TenantLid[]> { /* GET /tenant/leden */ }
export async function nodigTenantLidUit(email: string, rol: string) { /* POST /tenant/leden */ }
export async function wijzigTenantLidRol(userId: string, rol: string) { /* PUT /tenant/leden/:userId/rol */ }
export async function trekTenantLidIn(userId: string) { /* POST /tenant/leden/:userId/intrekken */ }
```

Gebruik dezelfde foutafhandeling als `vendorService.ts` — een 409 (laatste
admin) moet als een herkenbare, tonbare fout teruggegeven worden, niet als
een generieke exception.

- [ ] **Step 3: Commit**

```bash
cd ../MCM2-frontend
git add src/core/services/tenantLedenService.ts
git commit -m "feat(tenant): API-client voor tenant-ledenbeheer"
```

---

### Taak 11: Frontend — het scherm

**Files:**
- Create: `../MCM2-frontend/src/app/beheer/leden/page.tsx`
- Modify: `../MCM2-frontend/src/shared/components/layout/Sidebar.tsx`
- Test: `../MCM2-frontend/e2e/tenant-leden.spec.ts`

- [ ] **Step 1: Bekijk een bestaand beheerscherm als sjabloon**

```powershell
Get-Content ../MCM2-frontend/src/app/beheer/status/page.tsx
```

- [ ] **Step 2: Schrijf de falende Playwright-test**

```ts
import { test, expect } from '@playwright/test';

test.describe('Tenant-ledenbeheer', () => {
  test('een admin kan een collega uitnodigen en ziet de link', async ({ page }) => {
    // Login als admin (volg het patroon uit e2e/beheer-leveranciers.spec.ts
    // voor sessie-opzet).
    await page.goto('/beheer/leden');

    await page.getByTestId('nodig-lid-uit').click();
    await page.getByLabel('E-mailadres').fill('nieuw-collega@transdev.nl');
    await page.getByLabel('Rol').selectOption('user');
    await page.getByRole('button', { name: 'Uitnodigen' }).click();

    await expect(page.getByTestId('uitnodigingslink')).toBeVisible();
  });

  test('de laatste-admin-fout wordt getoond, niet stilzwijgend genegeerd', async ({ page }) => {
    await page.goto('/beheer/leden');

    await page.getByTestId(`intrek-${enigeAdminUserId}`).click();
    await page.getByTestId('bevestig-intrekken').click();

    await expect(page.getByText(/enige beheerder/i)).toBeVisible();
  });
});
```

- [ ] **Step 3: Run, verwacht FAIL**

```powershell
cd ../MCM2-frontend
npx playwright test e2e/tenant-leden.spec.ts
```

Verwacht: FAIL — de pagina bestaat nog niet (404).

- [ ] **Step 4: Bouw het scherm**

Structuur, gebaseerd op het `status/page.tsx`-patroon:

- Tabel: naam, e-mail, rol (dropdown, direct wijzigen bij verandering),
  status-badge, sinds-datum, "Toegang intrekken"-knop met bevestiging
  (`data-testid="intrek-{userId}"` / `data-testid="bevestig-intrekken"`).
- "Collega uitnodigen"-knop (`data-testid="nodig-lid-uit"`) → uitklapformulier
  (e-mailveld, rol-dropdown, "Uitnodigen"-knop).
- Na succesvol uitnodigen: toon de link in een blok met `data-testid=
  "uitnodigingslink"` en een kopieerknop, plus of de mail al dan niet echt
  verstuurd is (`mailVerstuurd`).
- Elke foutmelding (409 laatste-admin, validatiefout) zichtbaar in het scherm,
  niet alleen in de console.

- [ ] **Step 5: Voeg het sidebar-item toe**

In `Sidebar.tsx`, naast Start/Status/Leveranciers/Vragenlijsten: een nieuw
item "Gebruikers" of "Leden", zichtbaar wanneer de sessierol `admin` óf
`support` is (bekijk hoe de sidebar vandaag al op rol filtert — volg dat
patroon).

- [ ] **Step 6: Run, verwacht PASS**

```powershell
npx playwright test e2e/tenant-leden.spec.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/app/beheer/leden/page.tsx src/shared/components/layout/Sidebar.tsx e2e/tenant-leden.spec.ts
git commit -m "feat(tenant): scherm voor tenant-ledenbeheer"
```

---

### Taak 12: Volledige verificatie en afronding

- [ ] **Step 1: Backend**

```powershell
cd C:\DEV\Work\MCM2
npm run verify:volledig
```

- [ ] **Step 2: Frontend**

```powershell
cd ..\MCM2-frontend
npm run format:check
npm run lint
npm run typecheck
npx playwright test
```

- [ ] **Step 3: Handmatige doorloop via de demo-stack**

```powershell
cd ..\MCM2
npm run demo
```

Log in als de demo-admin, ga naar het nieuwe scherm, nodig een testcollega
uit, wijzig een rol, trek een toegang in. Bevestig visueel dat de
laatste-admin-fout een begrijpelijke melding toont (niet een rode
technische foutpagina).

- [ ] **Step 4: Beide repo's — status samenvatten**

Werk `docs/STATUS.md` bij met een korte entry: issue #75 gebouwd,
backend + frontend, welke branch, verify-status.

---

## Na dit plan — REQUIRED: superpowers:finishing-a-development-branch

Volg die skill voor de opties (mergen, PR, bewaren, weggooien) in **beide**
repositories (`MCM2` en `MCM2-frontend` hebben elk hun eigen feature-branch en
worden apart afgerond).

**Herinnering (zie memory `mcm2-productie-impliceert-staging-eerst`):** een
verzoek om dit "in productie te krijgen" impliceert altijd eerst
`npm run deploy:staging` en een zichtbare rookproef, vóór de
`productie-aws.yml`-workflow start.
