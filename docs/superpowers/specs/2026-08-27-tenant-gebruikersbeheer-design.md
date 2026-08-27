# Ontwerp — tenant-gebruikersbeheer (issue #75, stuk 1 van het beheermenu)

**Datum:** 2026-08-27
**Status:** ONTWERP — goedgekeurd door de eigenaar, klaar voor implementatieplan
**Aanleiding:** voorbereiding op de Transdev-pilot (issue #180). Membership-rijen
worden vandaag met de hand in de database gezet; er bestaat geen weg waarlangs
een tenantbeheerder zelf een collega toegang geeft.
**Raakt:** Issue #75, spec `2026-08-04-beheermenu-tenantinstellingen.md` §3a/§7/§8
(dit stuk beantwoordt vraag 1 uit §8), ADR-006 (Entra External ID), ADR-015
(platformbeheer support-toegang), migratie 0009 (`tenant_membership`), migratie
0024 (uitnodigingstoken)

---

## 0. Waar dit over gaat, in één alinea

Een tenant-admin kan vandaag geen collega's toevoegen, van rol wijzigen of hun
toegang intrekken — dat gaat allemaal via de eigenaar, met de hand in de
database. Dit ontwerp levert een nieuw beheerscherm (`/beheer/gebruikers` of
vergelijkbaar) waarmee een `admin` dat zelf doet, plus een nieuwe rol `user`
(contractbeheerder) naast de bestaande `admin`/`reviewer`.

---

## 1. Vooronderzoek: bestaat hier al een 3rd-party dienst voor?

Op verzoek van de eigenaar onderzocht (27-08) vóór het bouwen: Permit.io,
Cerbos, Oso, Authzed/SpiceDB, en specifiek wat AWS, Microsoft en Supabase zelf
bieden — relevant omdat MCM2 al bij alle drie zit.

**Geen van de onderzochte opties past zonder een architectuurwijziging die
niemand vroeg:**

| Optie | Waarom het niet past |
|---|---|
| Permit.io / Cerbos / Oso / Authzed | Werken op de **applicatielaag**, naast Postgres RLS — niet erin. MCM2's tenant-isolatie zit juist in `FORCE ROW LEVEL SECURITY`-policies (spec 2026-08-04 §4a); die blijven hoe dan ook zelf gebouwd. Voor drie rollen is een externe policy-engine bovendien zwaar gereedschap: nieuwe afhankelijkheid, nieuw account, sync-risico tussen de dienst en de RLS-policies die het echte werk doen. |
| Supabase RBAC/RLS-claims | Gebouwd op **Supabase Auth** als identity provider. MCM2 gebruikt Supabase alleen als kale PostgreSQL-database (ADR-002); identity zit bij Entra External ID (ADR-006). Dit zou Supabase Auth erbij vragen — een verschuiving die niet is aangevraagd. |
| AWS Verified Permissions | Bevestigd via AWS' eigen documentatie: werkt naast Postgres RLS, niet erin geïntegreerd — vervangt dus alleen het stuk dat `RolGuard` vandaag al doet. Vraagt bovendien een AWS-account dat er nog niet is (zie CLAUDE.md §0b: "AWS is een richting, geen middel"). |
| Entra External ID app-rollen | Zijn **per applicatie-registratie**, niet per tenant. MCM2 heeft één app-registratie voor alle tenants; "admin bij Transdev, reviewer bij een andere klant" kan Entra's app-rollen niet uitdrukken. Zou per-tenant membership-logica alsnog in MCM2 zelf vragen — geen winst. |

**Besluit (eigenaar, 27-08): zelf bouwen**, zoals hieronder beschreven.

---

## 2. De blokkerende vraag uit de vorige spec, beantwoord

Spec `2026-08-04-beheermenu-tenantinstellingen.md` §8, vraag 1: *hoe komt een
uitgenodigde collega tot stand in Entra External ID?*

**Beantwoord (27-08):** Entra External ID staat self-service sign-up toe
zonder domeinrestrictie — bevestigd via [Microsoft's eigen
documentatie](https://learn.microsoft.com/en-us/entra/external-id/self-service-sign-up-overview)
("Upon completion of sign-up, an account is provisioned for the user in the
directory") en via de eigen waarneming van de eigenaar (een tenant van buiten
het `alingadvies.nl`-domein kon al zelf inloggen). Geen aanwijzing van een
API-connector met domeinfilter in dit project.

**Gevolg:** MCM2 hoeft geen Entra-account aan te maken. Het bestaande
uitnodigingstoken-mechanisme (`src/auth/uitnodigingstoken.ts`, migratie 0024,
al gebruikt door `PlatformController.tenantAanmaken`) volstaat: MCM2 geeft een
token uit en koppelt bij de eerste login. Dit is precies het patroon dat de
platformbeheerder-route al bewijst.

---

## 3. Rollen: van twee naar drie

`clm.tenant_membership.role` krijgt een derde waarde naast `admin`/`reviewer`:
**`user`** (contractbeheerder).

**Betekenis (besluit eigenaar, 27-08):** `user` krijgt dezelfde schrijfrechten
als `admin` op alles, **behalve het gebruikersbeheerscherm zelf** — een `user`
kan geen collega's uitnodigen, rollen wijzigen of toegang intrekken.

**Twee routes blijven bewust `admin`-only, ook voor `user`** — niet uit
omissie maar omdat ze zelf bevoegdheden toekennen, niet alleen
contractbeheerwerk zijn:

- `koppelReviewer`/`ontkoppelReviewer` (`vragenlijst-beheer.controller.ts`) —
  "bepalen wíé er beoordeelt is beheer" (bestaand commentaar in de code).
- `maakRonde` (`vragenlijst-beheer.controller.ts`) — een ronde uitzetten geeft
  tokens uit aan externe partijen; dat is een andere bevoegdheid dan
  contractbeheer.

Alle overige bestaande `@VereistRol('admin')`-routes (leveranciers, contacten,
contracten, survey-templates koppelen) worden `@VereistRol('admin', 'user')`.

**Laatste-admin-regel ongewijzigd:** een tenant moet altijd minimaal één
`admin` houden. `user` en `reviewer` tellen niet mee — zij kunnen een tenant
niet beheren als de laatste admin verdwijnt.

---

## 4. Technische aanpassing: `RolGuard`/`VereistRol`

`VereistRol` accepteert vandaag precies één rol (`string`). Wordt uitgebreid
naar meerdere toegestane rollen (`...rollen: string[]`), met `OR`-semantiek:
de sessie moet één van de genoemde rollen hebben.

```ts
export const VereistRol = (...rollen: string[]) =>
  SetMetadata(VEREISTE_ROL, rollen);
```

`RolGuard.canActivate` vergelijkt de rol van de sessie tegen de lijst in
plaats van tegen één waarde. Bestaande aanroepen met één argument
(`VereistRol('admin')`) blijven werken zonder wijziging — de nieuwe vorm is
een superset.

---

## 5. Nieuwe routes

**Padkeuze:** `GET /tenant/gebruikers` bestaat al (`TenantController`,
`src/tenant/tenant.controller.ts`) — een simpele keuzelijst
(`{userId, naam}`, geen rol/status, zonder `@VereistRol`, gebruikt elders om
bijv. een reviewer te koppelen aan een template). De nieuwe, uitgebreidere
gebruikersbeheer-routes krijgen daarom een eigen pad, `/tenant/leden`, om
geen bestaand endpoint te hergebruiken voor een ander doel of contract.

Nieuwe controller (`src/tenant/tenant-leden.controller.ts`), alle routes
`@VereistRol('admin')`:

| Route | Doet |
|---|---|
| `GET /tenant/leden` | Lijst: naam, e-mail, rol, status (actief / uitnodiging open / ingetrokken), sinds wanneer |
| `POST /tenant/leden` | Uitnodigen: e-mail + rol (`admin`/`user`/`reviewer`) |
| `PUT /tenant/leden/:userId/rol` | Rol wijzigen |
| `POST /tenant/leden/:userId/intrekken` | Toegang intrekken (`deleted_at`, geen `DELETE`) |

### 5a. Uitnodigen — drie gevallen die de route moet onderscheiden

De bestaande platformbeheerder-route (`PlatformController.tenantAanmaken`)
maakt altijd een gloednieuwe tenant + gloednieuwe `user`-rij — dat scenario
komt hier niet voor. Deze route nodigt uit **binnen een bestaande tenant**, en
moet daarom rekening houden met drie gevallen voor het opgegeven e-mailadres:

1. **Geheel nieuw e-mailadres** — geen bestaande `clm.user`-rij. Zelfde
   patroon als `tenantAanmaken`: nieuwe `user`-rij + nieuwe membership-rij,
   token genereren, mail versturen, link ook in het antwoord (eenmalig
   zichtbaar, zelfde reden als bij de platformbeheerder-route).
2. **Bestaat, met een ingetrokken (`deleted_at`) membership bij deze tenant**
   — de bestaande rij wordt bijgewerkt (`UPDATE`: nieuwe rol, `deleted_at =
   NULL`), niet een nieuwe rij aangemaakt — zie §7 voor de reden. Nieuw
   token, nieuwe mail.
3. **Bestaat, met een actieve membership** — bij deze tenant (dubbele
   uitnodiging) of bij een andere tenant. Beide worden vooraf gecontroleerd en
   geven een duidelijke fout (`ConflictException`, "dit e-mailadres heeft al
   toegang" / "dit e-mailadres heeft al toegang tot een andere tenant") — niet
   de rauwe database-constraint-fout van
   `tenant_membership_een_actief_per_gebruiker`.

### 5b. Rol wijzigen en intrekken — laatste-admin-check

Beide routes tellen eerst het aantal actieve `admin`-memberships in de tenant.
Zou de wijziging dat aantal op nul brengen, dan `ConflictException` vóór er
iets geschreven wordt — geen gedeeltelijke toestand.

---

## 6. Platformbeheerder-toegang

**Besluit (eigenaar, 27-08): via de bestaande support-toegang (ADR-015),
geen nieuwe uitzondering.**

De platformbeheerder ziet dit scherm niet standaard. Hij vraagt eerst
tijdelijke, geauditeerde support-toegang aan tot de tenant
(`POST platform/tenants/:id/toegang`, bestaande route) en ziet dan hetzelfde
gebruikersscherm als de tenant-admin, via hetzelfde mechanisme waarmee hij nu
al bij andere tenantgebonden data komt.

Geen wijziging nodig aan `TenantContextGuard`/`PlatformAdminGuard` zelf — dit
is hergebruik van een bestaand mechanisme, geen nieuw stuk.

---

## 7. Database

**Migratie `0032_tenant_membership_rol_user.sql`:**

- CHECK-constraint op `clm.tenant_membership.role` uitbreiden:
  `CHECK (role IN ('admin', 'user', 'reviewer', 'support'))` — `support`
  bestaat al sinds migratie 0020 (ADR-015, platformbeheer) en blijft
  ongewijzigd; deze migratie voegt alleen `user` toe.
- Geen nieuwe tabel. Uitnodigen hergebruikt de bestaande `uitnodiging_hash`-
  kolom op `clm.user` (migratie 0024).

**Besluit (eigenaar, 27-08), na heroverweging tijdens het schrijven van het
implementatieplan: géén surrogaatsleutel.** De oorspronkelijke aanname hier
(zie de git-historie van dit document) bleek een bestaande, werkende route
te breken: `PlatformService.supportToegangGeven()` gebruikt
`ON CONFLICT (user_id, tenant_id) DO UPDATE`, wat rechtstreeks leunt op de
huidige primary key `tenant_membership_pkey (user_id, tenant_id)`. Een
surrogaatsleutel zou die query moeten herschrijven — een onnodig risico voor
bewezen code, voor een rol (`support`) die voorlopig alleen door de eigenaar
zelf wordt ingevuld.

**In plaats daarvan (§5a-geval 2, opnieuw uitnodigen na intrekken):** de
bestaande, ingetrokken rij wordt hergebruikt via `UPDATE` (rol, nieuw
`uitnodiging_hash`, `deleted_at = NULL`) in plaats van een nieuwe rij toe te
voegen. De primary key en de bestaande unieke index
`tenant_membership_een_actief_per_gebruiker` blijven ongewijzigd, en
`supportToegangGeven()` hoeft niet aangepast te worden. Het enige verlies:
de periode van intrekking is niet meer als een aparte, afgesloten
membership-rij zichtbaar (alleen het laatste `created_at`/`deleted_at`) —
maar `audit.audit_event` legt zowel de intrekking als de heruitnodiging al
apart vast (zelfde patroon als `supportToegangGeven()` vandaag al doet), dus
de geschiedenis blijft reconstrueerbaar via de audittrail.

`sessie_aanmaken()` (migratie 0010) is al bestand tegen dit patroon: hij
selecteert op `u.external_subject`, filtert op `m.deleted_at IS NULL` en
neemt `ORDER BY m.created_at LIMIT 1` — geen wijziging nodig. `RolGuard` leest
de rol uit `clm.sessie.role` (gekopieerd bij het inloggen), nooit
rechtstreeks uit `tenant_membership` — ook daar geen wijziging nodig.

---

## 8. Frontend

Nieuw sidebar-item, zichtbaar voor:
- `admin` binnen zijn eigen tenant (rechtstreeks — geen support-toegang nodig).
- Platformbeheerder met actieve support-toegang tot de bekeken tenant (§6).

Eén scherm:
- Tabel: naam, e-mail, rol, status, sinds wanneer.
- "Collega uitnodigen"-knop → klein uitklapformulier (e-mail + rol-dropdown).
  Na versturen: eenmalige weergave van de uitnodigingslink (terugvaloptie als
  de mail faalt of niet aankomt) plus `mailVerstuurd`/`echtVerstuurd`-status,
  zelfde patroon als `PlatformController.tenantAanmaken`.
- Per rij: rol-dropdown (direct wijzigen) + "Toegang intrekken"-knop met
  bevestigingsstap (onomkeerbaar-ogend genoeg om een tweede klik te vragen,
  zelfde soort bevestiging als elders in de app).

---

## 9. Mailversturen bij uitnodigen

**Besluit (eigenaar, 27-08): automatisch mailen, link ook tonen.** Zelfde
patroon als de bestaande tenant-aanmaak: de route probeert direct te mailen
via het platform-mailkanaal (`UitnodigingVerzender`, Resend), en toont de link
ook in het scherm als terugvaloptie. Vraagt een nieuwe mailsjabloonvariant
("je bent uitgenodigd bij tenant X als rol Y") naast de bestaande
beheerder-uitnodiging.

---

## 10. Wat dit ontwerp expliciet niet doet

- **Geen fijnmaziger rechtenmodel dan drie rollen.** `admin`/`user`/`reviewer`,
  geen aparte permissies per actie.
- **Geen wijziging aan hoe reviewers/koppelReviewer/maakRonde werken** — die
  blijven `admin`-only, zie §3.
- **Geen e-mailinstellingen (SMTP) of verzendscherm (handpicked/bulk).** Dat
  zijn stuk 2 en 3 uit de vorige spec (§7), niet dit stuk.
- **Geen tenant-brede zichtbaarheid voor de platformbeheerder buiten
  support-toegang.** Zie §6 — bewust via het bestaande, tijdelijke mechanisme.

---

## 11. Tegenproeven

Conform MCM2-CLAUDE.md §15b horen deze te falen vóórdat de code bestaat.

1. Een `reviewer` krijgt 403 op elke gebruikersbeheer-route.
2. Een `user` krijgt óók 403 op elke gebruikersbeheer-route (niet alleen
   `reviewer`).
3. Een `user` mag wél de bestaande admin-routes (leverancier aanmaken,
   contract aanmaken) — nieuw gedrag, test per bestaand endpoint dat al
   `@VereistRol('admin', 'user')` wordt.
4. Een `user` krijgt 403 op `koppelReviewer`/`ontkoppelReviewer`/`maakRonde` —
   deze blijven `admin`-only (§3).
5. De laatste `admin` kan zichzelf niet degraderen via `PUT .../rol`.
6. De laatste `admin` kan zichzelf niet intrekken via
   `POST .../intrekken`.
7. Een gebruiker van tenant A krijgt nul rijen op `GET /tenant/gebruikers`
   van tenant B (RLS-tegenproef).
8. Een ingetrokken gebruiker kan niet meer inloggen, maar zijn eerdere acties
   (bijv. een beoordeling) blijven zichtbaar met zijn naam.
9. Platformbeheerder zonder actieve support-toegang krijgt 403 op
   `GET /tenant/gebruikers`; mét support-toegang krijgt hij 200.
10. Een ingetrokken gebruiker opnieuw uitnodigen levert een actieve membership
    op (de bestaande rij bijgewerkt, `deleted_at = NULL`, nieuwe rol/token);
    de intrekking en de heruitnodiging staan beide apart in
    `audit.audit_event`.
11. Uitnodigen van een e-mailadres met een al-actieve membership (eigen of
    andere tenant) geeft een duidelijke `ConflictException`, geen
    database-constraint-crash.

---

## 12. Volgorde van bouwen (advies voor het implementatieplan)

1. **Migratie:** rol-CHECK uitbreiden met `user` (§7) — kleine, geïsoleerde
   wijziging, geen impact op bestaande functies of routes.
2. **`RolGuard`/`VereistRol`** naar meerdere rollen, plus de mechanische
   aanpassing van bestaande routes naar `admin`, `user`.
3. **De vier nieuwe routes**, inclusief de drie uitnodig-gevallen (§5a) en de
   laatste-admin-checks (§5b).
4. **Mailsjabloon** voor de tenant-uitnodiging.
5. **Frontend-scherm.**
6. **Platformbeheerder-doorkijk** via support-toegang (§6) — laatste stap,
   want leunt op alles ervoor.
