# Platformbeheer-uitbreiding — ontwerp

**Datum:** 2026-08-27
**Issue:** nieuw aan te maken (zie plan)

## 1. Aanleiding

De platformbeheerder kan vandaag een tenant **aanmaken** en tijdelijke
**support-toegang** toekennen (ADR-015, migratie 0020) — beide bestaan al,
backend en frontend. Wat ontbreekt:

1. Een tenant **wijzigen** (naam, antwoord-e-mailadres).
2. Een tenant **verwijderen** — in de praktijk: deactiveren.
3. Een **snelle, ééndruk** manier om als platformbeheerder in een
   tenant-omgeving te komen, zonder een apart formulier per keer in te
   vullen.

"Gebruikers binnen een tenant aanmaken als platformbeheerder" vraagt **geen
nieuwe functionaliteit**: `TenantLedenController` (`/tenant/leden`)
accepteert al `@VereistRol('admin', 'support')`. Zodra de platformbeheerder
via punt 3 in de tenant-context zit met de rol `support`, werkt het
bestaande `/beheer/leden`-scherm voor hem exact zoals voor een tenant-admin.
Dit ontwerp bouwt dus alleen de ontbrekende drie stukken.

De losstaande, acute wens — een tenant aanmaken voor de Transdev-pilot —
gebeurt met de **bestaande** functionaliteit, los van dit plan.

## 2. Waarom niet "permanente superuser-toegang"

Overwogen en verworpen: een platformbeheerdersaccount dat automatisch bij
alle tenants kan, zonder support-toegang.

- **RLS zonder BYPASSRLS is de kern van de beveiliging (ADR-008).** Niemand
  — ook de platformbeheerder niet — leest tenantdata buiten
  `withTenant()`. Permanente cross-tenant-toegang vraagt ofwel BYPASSRLS
  (expliciet verboden) of een blijvend membership in élke tenant (dan is
  het geen support-toegang meer, maar een blijvende zwakke plek).
- **Support-toegang is de audit-trail, geen omweg (Issue #57).** Wie in
  klantdata kijkt, doet dat zichtbaar, tijdelijk (8 uur) en met een reden.
  Dat is precies wat een pilot-klant en een eventuele NIS2/ISO27001-audit
  moeten kunnen navragen.

Wat er ontbrak was niet de beveiliging, maar het **gemak**: een apart
formulier per keer invullen voelt als een aparte handeling. Dat lost dit
ontwerp op met één knop, niet door de grens te verzwakken.

## 3. Tenant wijzigen

`PUT /platform/tenants/:id`, body `{ naam, antwoordEmail? }`. Zelfde
validatie als `leesNieuweTenant()` bij het aanmaken (naam verplicht,
maximale lengte, e-mailformaat). Dezelfde unieke-naam-afhandeling als bij
aanmaken: een conflict op `tenant_name_key` /
`tenant_name_ongeacht_hoofdletters` geeft 409, niet 500.

`PlatformService.tenantWijzigen(tenantId, invoer)` werkt binnen
`withTenant(tenantId, ...)`, een `UPDATE clm.tenant SET name = ..., 
antwoord_email = ... WHERE tenant_id = ...`. De bestaande trigger
(`tenant_register_bijhouden`, `AFTER INSERT OR UPDATE OF name`) houdt het
register vanzelf gelijk zodra de naam verandert — geen aanpassing nodig
voor dit onderdeel.

Een audit-event (`tenant_gewijzigd`) wordt gelogd, met de oude en nieuwe
waarden — zelfde patroon als `tenant_aangemaakt`.

Frontend: een bewerkknop op elke tenantrij in `/beheer/platform`, opent
hetzelfde soort formulier als "nieuwe tenant", vooringevuld met de huidige
naam/antwoordEmail. Geen admin-veld hier — de eerste admin wijzigen loopt
via support-toegang naar `/tenant/leden`, niet via dit formulier (zie §1).

## 4. Tenant verwijderen (soft-delete)

**Vorm:** soft-delete, consistent met de rest van de codebase
(`user.deleted_at`, `vendor.deleted_at`, `tenant_membership.deleted_at`
bestaan al). Geen hard delete — onomkeerbaar en zonder precedent in dit
schema.

**Migratie:** `clm.tenant` krijgt een `deleted_at timestamptz`-kolom (bestaat
vandaag niet). Zie §7 voor de volledige migratie-inhoud, inclusief de
trigger-uitbreiding hieronder.

**Effect van een gedeactiveerde tenant:**
- Verdwijnt uit `/beheer/platform`'s tenantlijst (het register toont hem
  niet meer — zie hieronder).
- Kan niet meer inloggen: zowel `clm.sessie_aanmaken()` als de nieuwe
  `clm.sessie_wisselen()` (§5) moeten `t.deleted_at IS NULL` controleren op
  de doeltenant.
- Bestaande sessies van leden van die tenant blijven tot hun natuurlijke
  vervaldatum geldig (geen actieve intrekking) — een lopende sessie
  afsluiten is een aparte, grotere ingreep en hoort niet bij dit plan.

**Trigger-uitbreiding, cruciaal:** de bestaande trigger reageert alleen op
`AFTER INSERT OR UPDATE OF name`. Een `UPDATE ... SET deleted_at = now()`
raakt die kolom niet en zou het register dus **niet** bijwerken — de tenant
zou dan onbereikbaar zijn vanuit `clm.tenant` (via `withTenant`) maar blijven
staan in het RLS-vrije register, zichtbaar als actief. Dit is een
bestaand-gedrag-gat dat deze feature blootlegt en moet dichten:

```sql
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
$$;

DROP TRIGGER tenant_register_bijhouden ON clm.tenant;
CREATE TRIGGER tenant_register_bijhouden
    AFTER INSERT OR UPDATE OF name, deleted_at ON clm.tenant
    FOR EACH ROW
    EXECUTE FUNCTION clm.tenant_register_bijhouden();
```

Verwijderen uit het register bij deactiveren (in plaats van een eigen
`deleted_at`-kolom op het register zetten) is bewust: het register is de
telefoonlijst voor `/beheer/platform`, en een gedeactiveerde tenant hoort
daar niet meer in — reactiveren (buiten scope van dit plan, expliciet niet
gebouwd) zou hem via dezelfde `UPDATE ... SET name = name` opnieuw kunnen
laten verschijnen.

**Route:** `POST /platform/tenants/:id/deactiveren`, geen body.
`PlatformService.tenantDeactiveren(tenantId)` — `UPDATE clm.tenant SET 
deleted_at = now() WHERE tenant_id = ... AND deleted_at IS NULL`, audit-event
`tenant_gedeactiveerd`. Idempotent laten falen met 404 als de tenant al
gedeactiveerd of onbekend is (zelfde stijl als `tenantLezen()`'s
`NotFoundException`).

**Frontend:** een "Deactiveren"-knop op de tenantrij, met een bevestiging
waarbij de tenantnaam getypt moet worden — zelfde zwaarte als andere
destructieve bevestigingen in dit project (zie `verwijder-contract-bevestig`
in de contracten-toppagina-feature als precedent).

## 5. Eén-klik toegang ("Openen")

**Doel:** de platformbeheerder klikt op een tenantrij en is direct binnen
in de rol `support`, op `/beheer/leden` van die tenant — geen apart
reden-formulier, geen tweede Entra-login.

### 5a. Sessiewissel-mechanisme

Een sessie (`clm.sessie`) is vast gekoppeld aan precies één `tenant_id`.
`clm.sessie_aanmaken()` kiest bij een gegeven `external_subject` altijd de
**eerste** membership (`ORDER BY m.created_at LIMIT 1`) — bruikbaar voor de
oorspronkelijke login, niet voor gericht wisselen naar een specifieke
tenant waar iemand een tweede (support-)membership op heeft.

Nieuwe functie, `clm.sessie_wisselen()`:

```sql
CREATE OR REPLACE FUNCTION clm.sessie_wisselen(
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
    -- Bewijs van identiteit: een geldige, niet-verlopen sessie.
    SELECT s.user_id INTO v_user_id
      FROM clm.sessie s
     WHERE s.token_hash = p_huidige_token_hash
       AND s.verloopt_op > now();

    IF v_user_id IS NULL THEN
        RETURN;
    END IF;

    -- Autorisatie: een geldig, niet-verlopen membership op de doeltenant,
    -- en de doeltenant zelf niet gedeactiveerd.
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
$$;
```

De **oorspronkelijke sessie blijft ongewijzigd bestaan** — dit is een extra
sessie-rij, geen mutatie van de bestaande. De platformbeheerder heeft na de
wissel twee geldige sessiecookies-waardige tokens in omloop, maar de browser
onthoudt er één per keer (het cookie wordt overschreven met het nieuwe
token). Terugkeer (§5c) wisselt opnieuw, ditmaal terug naar de eigen
tenant.

Zelfde rechtenmodel als de bestaande sessiefuncties: `REVOKE ALL ... FROM
PUBLIC`, `GRANT EXECUTE ... TO clm_api, clm_admin`.

### 5b. Backend-route

`POST /platform/sessie/wisselen`, body `{ tenantId }`. Binnen
`PlatformController` (dezelfde twee guards: `TenantContextGuard`,
`PlatformAdminGuard`).

Volgorde in de handler:
1. `PlatformService.supportToegangGeven(tenantId, sessie.userId, 'Platformbeheer')`
   — hergebruikt de bestaande, al geteste functie. Reden is een vaste
   tekst, geen gebruikersinvoer: dit is precies wat "geen apart
   dialoogje" betekent.
2. `SessieService.wisselen(huidigeSessieToken, tenantId)` — nieuwe methode,
   roept `clm.sessie_wisselen()` aan.
3. Zet het nieuwe sessiecookie (zelfde `cookieInstellingen()` als het
   bestaande inlogpad).
4. Antwoord: `{ tenantId, rol: 'support' }` — de frontend navigeert daarna
   zelf naar `/beheer/leden`.

### 5c. Terugkeer

Zolang de sessierol `support` is, toont de sidebar/`OmgevingBanner` een
regel "Support-toegang bij [tenantnaam] — Terug naar platformbeheer". Die
link roept dezelfde `/platform/sessie/wisselen`-route aan, nu met de
platformbeheerder-tenant als doel (bekend uit de sessie vóór de eerste
wissel — de frontend bewaart dat tenant-id lokaal, niet de backend: er is
geen "sessie-geschiedenis"-concept nodig voor één stap terug).

### 5d. Frontend

- `/beheer/platform`: elke tenantrij krijgt een knop "Openen" naast
  Bewerken/Deactiveren. Klik → `POST /platform/sessie/wisselen` →
  `router.push('/beheer/leden')`.
- `OmgevingBanner` (of een vergelijkbare, altijd zichtbare plek): toont de
  terugkeer-link zodra `sessie.rol === 'support'`.

## 6. Wat bewust buiten scope blijft

- **Tenant reactiveren.** Een gedeactiveerde tenant blijft gedeactiveerd;
  geen "ongedaan maken"-knop. Komt er een concrete vraag naar, dan is dat
  een nieuw, klein plan — het is geen natuurlijke uitbreiding van dit
  ontwerp (zie de trigger-toelichting in §4).
- **Eerste-admin wijzigen als aparte platformbeheerfunctie.** Loopt via
  support-toegang naar `/tenant/leden`, net als elke andere
  ledenmutatie (§1).
- **Actief lopende sessies van leden intrekken bij deactiveren.** Ze
  vervallen op hun eigen termijn; vroegtijdig intrekken is een aparte
  ingreep.
- **Meerdere gelijktijdige support-sessies** (twee tenants tegelijk open in
  twee tabbladen). Eén sessiecookie per browser — wisselen is wisselen,
  geen tabblad-gebonden context. Bekend en geaccepteerd, consistent met hoe
  sessies nu al werken.

## 7. Migratie-overzicht (voor het plan)

Eén nieuwe, handgeschreven migratie:
1. `ALTER TABLE clm.tenant ADD COLUMN deleted_at timestamptz;`
2. `CREATE OR REPLACE FUNCTION clm.tenant_register_bijhouden()` (nieuwe
   versie, §4).
3. `DROP TRIGGER` + `CREATE TRIGGER tenant_register_bijhouden` op
   `name, deleted_at`.
4. `CREATE OR REPLACE FUNCTION clm.sessie_wisselen(...)` (§5a).
5. `REVOKE`/`GRANT EXECUTE` op de nieuwe functie, zelfde patroon als
   `sessie_aanmaken`/`sessie_oplossen`.
6. Vergeet niet: toevoegen aan `drizzle/meta/_journal.json` (CLAUDE.md,
   "Een handgeschreven migratie moet in de journal").

## 8. Tegenproeven (worden tests in het plan)

1. Wijzigen: naam-conflict geeft 409, niet 500.
2. Wijzigen: audit-event `tenant_gewijzigd` staat met oude/nieuwe waarden.
3. Deactiveren: de tenant verdwijnt uit `GET /platform/tenants` (het
   register-effect van de trigger-uitbreiding).
4. Deactiveren: een gedeactiveerde tenant kan niet meer inloggen
   (`sessie_aanmaken` faalt voor een lid van die tenant).
5. Deactiveren: `sessie_wisselen` naar een gedeactiveerde tenant faalt.
6. Deactiveren: dubbel deactiveren geeft 404, niet een stille no-op-200.
7. Sessiewissel: zonder geldig membership op de doeltenant faalt de wissel
   (RLS-achtige tegenproef, met een tweede tenant waar geen membership op
   staat).
8. Sessiewissel: de oorspronkelijke sessie blijft na de wissel nog geldig
   (bewijs dat het een extra rij is, geen mutatie).
9. Eén-klik "Openen": één aanroep resulteert in een support-membership mét
   reden 'Platformbeheer' én een bruikbaar nieuw sessiecookie voor die
   tenant.
10. Terugkeer: de link vanuit een support-sessie wisselt terug naar de
    oorspronkelijke tenant-rol (niet opnieuw 'support').
