# Per-tenant feature-entitlements — ontwerp

**Datum:** 2026-09-03
**Issue:** nieuw aan te maken (zie plan)

## 1. Aanleiding

De contractmodule (`src/contract/`, tabel `clm.contract`) is al
tenant-generiek gebouwd — geen Transdev-specifieke code, alle toegang loopt
via `sessie.tenantId` en RLS. De eigenaar wil hem als apart vermarktbare
feature van het AA-multitenant-product kunnen aanbieden: niet elke AA-tenant
krijgt hem automatisch, de platformbeheerder bepaalt per tenant of hij
beschikbaar is.

Dit is de eerste toepassing van een breder, generiek mechanisme: welke
tenant welke optionele feature mag gebruiken. Toekomstige AA-only
functionaliteit (NIS2, freemium, vragenlijst-builder — zie
`docs/advies-td-aa-splitsing.md`) hergebruikt hetzelfde mechanisme zonder
nieuw databaseontwerp.

## 2. Scope en bewuste keuzes

- **Alleen de platformbeheerder schakelt.** Geen tenant-admin-laag erbovenop
  — dit is een verkoop-/pakketbeslissing, geen tenant-voorkeur.
- **Nu: frontend-verberging. Backend-blokkade op de contractroutes zelf is
  bewust uitgesteld** (zie §6) — met een concrete trigger voor wanneer dat
  alsnog moet.
- **Cross-tenant-isolatie verandert niet.** RLS op `tenant_id` blijft de
  harde grens tussen tenants, volledig los van dit mechanisme. Zonder
  backend-check kan een tenant zonder de feature ten hoogste zijn éígen
  contracten blijven gebruiken — geen toegang tot andermans data.
- **Featuredefinities staan in de code, aan/uit-status in de database.** Een
  `feature_key` zonder bijbehorende code is dan onmogelijk; de
  platformbeheerder kan nooit een niet-bestaande feature "aanmaken".
- **Default: uit tenzij aangezet**, voor nieuwe tenant/feature-combinaties.
  Bestaande tenants verliezen niets — zie de migratiestap in §4.

## 3. Datamodel

Nieuwe tabel, migratie `00xx_tenant_feature.sql`:

```sql
CREATE TABLE clm.tenant_feature (
    tenant_id    uuid NOT NULL REFERENCES clm.tenant(tenant_id) ON DELETE CASCADE,
    feature_key  text NOT NULL,
    enabled      boolean NOT NULL,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   uuid REFERENCES clm."user"(user_id),
    CONSTRAINT tenant_feature_pkey PRIMARY KEY (tenant_id, feature_key)
);
```

Geen rij voor een tenant/feature-combinatie betekent: uit. Dat is de
"default uit"-keuze in de praktijk — er hoeft geen expliciete `enabled =
false`-rij aangemaakt te worden voor elke nieuwe tenant. `enabled` heeft
bewust géén kolom-default: elke rij die wél bestaat, ontstaat via een
expliciete handeling (de migratie in §4, of een platformbeheerder die
schakelt) — nooit stilzwijgend "aan" via een default die iemand later
makkelijk over het hoofd ziet.

**RLS voor tenant-isolatie op lezen én schrijven — via de gewone
tenant-runtime, niet via een aparte databaserol.** Anders dan
`clm.platform_admin` (geen RLS, GRANT-only, nooit door de webapplicatie
geschreven — die tabel wordt buiten de app om beheerd): hier moet de
platformbeheerder juist via de webapplicatie kunnen schakelen, dus
`clm_api`/`clm_admin` (de groepsrollen achter de runtime-login `clm_api_runtime`)
behouden de SELECT/INSERT/UPDATE die `ALTER DEFAULT PRIVILEGES` (migratie
0001) al standaard geeft aan elke nieuwe clm-tabel. Alleen DELETE wordt
teruggedraaid — schakelen is altijd een update van `enabled`, een rij
verdwijnt nooit. De echte grens zit in `PlatformAdminGuard` op de route
(§5), net zoals bij `clm.contract`: de databaserol is niet de beveiliging,
RLS + de guard samen zijn dat.

```sql
ALTER TABLE clm.tenant_feature ENABLE ROW LEVEL SECURITY;
ALTER TABLE clm.tenant_feature FORCE ROW LEVEL SECURITY;

-- clm.current_tenant_id() leest de sessievariabele app.current_tenant_id,
-- gezet door DatabaseService.withTenant() — dezelfde functie als elke
-- andere RLS-policy in dit schema gebruikt (migratie 0000).
CREATE POLICY tenant_feature_isolation ON clm.tenant_feature
    USING (tenant_id = clm.current_tenant_id());

REVOKE DELETE ON clm.tenant_feature FROM clm_api, clm_admin;
```

De platformbeheer-servicelaag (§5) schrijft via `withTenant()` net als
`PlatformService` dat nu al doet voor tenant-brede operaties — de
`tenant_id`-kolom in de rij bepaalt welke tenant geraakt wordt, niet de
sessie-tenant van de platformbeheerder. Dit is dezelfde figuur als
`PlatformController` al toepast: de tenant in de invoer is "waar je iets aan
doet", niet "wie je bent" (zie `platform.controller.ts`, klassecomment).
`withTenant()` zet daarbij automatisch de tenantcontext die de RLS-policy
hierboven leest — ook bij het opruimen in tests moet die context expliciet
gezet worden, óók voor de migratierol: FORCE ROW LEVEL SECURITY geldt ook
voor de tabel-eigenaar.

**Feature-registry in code** — nieuw bestand `src/features/feature-registry.ts`:

```ts
export const FEATURE_KEYS = ['contractmodule'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
```

Een nieuwe schakelbare feature = één regel hier toevoegen. De
platformbeheer-API valideert een `featureKey` in de invoer tegen deze lijst
(onbekende sleutel → 400, niet stilzwijgend genegeerd).

## 4. Migratie: bestaande tenants behouden de contractmodule

Dezelfde migratie die de tabel aanmaakt, zet in één `INSERT ... SELECT` de
rij `enabled = true` voor `feature_key = 'contractmodule'` voor élke
bestaande, niet-verwijderde tenant (`clm.tenant WHERE deleted_at IS NULL`).
Zonder deze stap verdwijnt de contractmodule bij uitrol voor Transdev,
AlingAdvies, demo, Bizaline en Platformbeheer — die zijn er nu allemaal al
mee aan het werken.

```sql
INSERT INTO clm.tenant_feature (tenant_id, feature_key, enabled)
SELECT tenant_id, 'contractmodule', true
FROM clm.tenant
WHERE deleted_at IS NULL;
```

Een tenant die na deze migratie wordt aangemaakt, krijgt geen automatische
rij — die start op "uit tenzij de platformbeheerder hem aanzet", zoals
bedoeld voor het verkoopbare AA-product.

## 5. Backend

**Nieuwe module** `src/features/` met `TenantFeatureService`:

- `lijst(tenantId): Promise<FeatureKey[]>` — actieve features van één
  tenant, gebruikt door zowel het platformbeheerscherm als het
  sessie-endpoint.
- `zetten(tenantId, featureKey, enabled, updatedByUserId): Promise<void>` —
  upsert op de samengestelde primary key.

**Nieuwe routes op `PlatformController`** (erft de bestaande
`TenantContextGuard` + `PlatformAdminGuard` op klasseniveau — geen nieuwe
guard-toevoeging nodig, dat is precies waarom de guards daar op klasseniveau
staan):

```
GET  /platform/tenants/:id/features
PUT  /platform/tenants/:id/features/:featureKey   body: { enabled: boolean }
```

`PUT` valideert `featureKey` tegen `FEATURE_KEYS` (400 bij onbekende
sleutel, zelfde patroon als `leesTenantWijziging`/`InvoerFout` elders in
deze controller) en `enabled` als boolean.

**`GET /auth/sessie` uitgebreid** (`auth.controller.ts`, bestaande route)
met een `features: FeatureKey[]`-veld — de actieve features van
`sessie.tenantId`, opgehaald via dezelfde `TenantFeatureService.lijst()`.
Geen nieuwe login nodig: dit endpoint wordt al bij elke pagina-laad
opnieuw aangeroepen en leest live uit de database (zoals `isPlatformbeheerder`
er nu ook al zo in zit) — een pagina-ververs is voldoende om een
nieuw-geactiveerde feature te zien.

## 6. Frontend-consequentie (MCM2-frontend-repo)

Het contractmenu-item en de contractschermen verschijnen alleen als
`'contractmodule'` in `features` uit `/auth/sessie` zit. Dit is **puur
presentatie**, geen beveiligingsgrens — de contractroutes zelf blijven
open voor wie de URL rechtstreeks aanroept.

**Bewust uitgesteld: backend-blokkade op de contractroutes.** Zonder die
blokkade kan een tenant zonder de feature zijn éígen, al bestaande
contracten blijven gebruiken via de API — geen datalek (RLS blokkeert
cross-tenant sowieso), wel een gemiste verkoopgrens. Concrete trigger om
dit alsnog te bouwen: zodra een AA-tenant zonder de feature zelfstandig
(zonder tussenkomst van de platformbeheerder) gebruikers kan uitnodigen die
bij de contractroutes zouden kunnen komen, of zodra een toekomstige
schakelbare feature wél gevoelige data ontsluit. Vervolgissue, niet nu.

Het nieuwe platformbeheerscherm-tabblad "Features" (per tenant, lijst
schakelaars in de bestaande stijl van het platformbeheer) is eveneens
frontend-werk in de MCM2-frontend-repo.

## 7. Tests

E2e, in de contractlaag én in de platform-laag:

1. **Platformbeheerder kan schakelen.** `PUT
   /platform/tenants/:id/features/contractmodule` met `enabled: false`,
   gevolgd door `GET .../features` bevestigt de nieuwe stand.
2. **Sessie-endpoint toont de juiste stand.** Na het uitzetten van
   `contractmodule` voor een tenant bevat `GET /auth/sessie` voor een
   gebruiker van die tenant geen `'contractmodule'` meer in `features`; na
   het aanzetten wél.
3. **Alleen de platformbeheerder mag schakelen.** Een gewone tenant-admin
   (geen `platform_admin`-rij) die `PUT
   /platform/tenants/:id/features/:featureKey` aanroept krijgt 403 —
   bewijst dat de bestaande klasseniveau-guards ook deze nieuwe route
   dekken. Klein om nu mee te schrijven, voorkomt dat een latere refactor
   de guard stilzwijgend laat vallen zonder dat iets het opmerkt.
4. **Onbekende featureKey → 400.** `PUT .../features/onbestaande-key`
   wordt geweigerd, niet stilzwijgend genegeerd of aangemaakt.

## 8. Wat dit ontwerp niet beslist

- **Backend-blokkade op de contractroutes zelf** — vervolgissue, trigger
  in §6.
- **Tenant-admin-laag** (zelf features aan/uit kunnen zetten binnen wat de
  platformbeheerder toestaat) — niet gevraagd, niet gebouwd.
- **Prijsstelling/pakketten** — welke features bij welk AA-abonnement
  horen is een commerciële vraag, geen technische. Dit ontwerp levert het
  schakelmechanisme, niet de pakketlogica erachter.
- **UI voor de featurelijst zelf** (mooie namen, omschrijvingen per
  feature in het platformbeheerscherm) — invulling daarvan volgt de
  bestaande stijl van het platformbeheerscherm, geen apart ontwerp nodig.
