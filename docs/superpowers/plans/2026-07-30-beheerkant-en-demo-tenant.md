# Implementatieplan — beheerkant, demo-tenant en robuuste OTAP

**Datum:** 2026-07-30
**Status:** ter goedkeuring
**Aanleiding:** drie samenhangende doelen van de eigenaar (zie §1)
**Raakt:** Issue #7 (spoor 1), #12, #16, #18, #23

---

## 1. Wat de eigenaar wil bereiken

Letterlijk gevraagd, in deze volgorde:

1. Een frontend die eruitziet als MVM_V2, degelijk en robuust verbonden met MCM2.
   Inloggen als tenant, en als die tenant vendors aanmaken met contactpersonen en
   e-mailadressen — zodat surveys verstuurd kunnen worden.
2. In diezelfde bijna-productieomgeving een volledig werkende **demo-tenant** die met
   mock data te vullen is.
3. Aantoonbaar zien dat de **OTAP-straat robuust werkt**.

## 2. Besluiten die dit plan sturen

Genomen op 2026-07-30, na afweging:

| Besluit | Keuze | Reden |
|---|---|---|
| Loginmechanisme | **Meteen Entra External ID**, geen tijdelijke tussenlaag | Een tijdelijke sessielogin bouw je twee keer en levert een tweede autorisatiepad op dat later opgeruimd moet worden. De PoC is al geslaagd; het resterende werk is backend-werk, geen onderzoek. |
| Demo-tenant | **Seed-script, gebouwd ná de guard** | Het script is omgevingsonafhankelijk (alleen `DATABASE_URL`) en draait later ongewijzigd tegen acceptatie. Maar het moet gebruikers met een Entra-identiteit kunnen vullen — dus pas schrijven als het membership-model vaststaat, anders vult het de verkeerde kolommen. |
| Uiterlijk | **Layout en navigatie overnemen, niet de compliance-panelen** | MVM_V2's vendordetailscherm heeft panelen (`SecurityReviewPanel`, `VendorDocumentRequirementsPanel`, `InteractionPanel`, contracten, certificeringen) waarvoor MCM2 geen datamodel heeft. Getrouw overnemen zou de UI het datamodel laten bepalen — de omgekeerde volgorde van §8. |
| OTAP | **Eerst lokaal robuust, dan AWS** | Conform STATUS.md. Issue #12 (AWS-acceptatie) blijft open maar is geen voorwaarde voor de eerste drie doelen. |

## 3. Wat er al ligt — en waarom dit kleiner is dan het klinkt

Geverifieerd tegen de draaiende OTAP-database op 2026-07-30, niet uit gespreksgeheugen:

- **`clm.vendor`** bestaat en is rijk: `name`, `kvk_number`, `vestigingsnummer`,
  `statutory_name`, `trade_names`, `legal_form`, `sbi_code`, `category_code`,
  `business_criticality_code`, `compliance_status_code`, `annual_spend_eur`,
  `risk_score`, `owner_user_id`, `last_review_date`, `next_review_date`, soft delete.
- **`clm.vendor_contact`** bestaat al, mét `email`, `phone`, `job_title`, `is_primary`
  en RLS. **Contactpersonen vragen dus geen nieuwe migratie.**
- **`clm.user`** bestaat, met RLS en een FK vanuit `vendor.owner_user_id`.
- **`DatabaseService.withTenant()`** heeft al exact de juiste vorm: het neemt een
  `tenantId`, zet die met `SET LOCAL` als eerste statement in één transactie, en
  weigert een niet-UUID. De docstring zegt zelfs al dat de tenantId uit geverifieerde
  identiteit hoort te komen.
- **CSV-parser** (`src/vendor/`) valideert al leveranciersimport, 58 unittests groen.
  Schrijft bewust nog niets weg.

**Wat dat betekent:** de guard hoeft de databaselaag niet te herbouwen. Hij hoeft
alleen te *bepalen* welke `tenantId` in `withTenant()` gaat, op een geverifieerde
manier. De schrijfroutes voor vendors zijn daarna gewone CRUD binnen een bestaand,
RLS-beschermd model.

**Wat ontbreekt:** `clm.user` heeft geen koppeling naar een externe identiteit
(geen `external_subject`/`oid`), en er is geen membership-tabel. Zonder dat kan de
guard niet bewijzen dat een ingelogde persoon bij een tenant hoort. Dat is de enige
echte modeluitbreiding in dit plan.

## 4. Bouwvolgorde

Vier fasen. Elke fase eindigt met iets dat aantoonbaar werkt en een controlemoment.

---

### Fase 1 — Geverifieerde identiteit en membership (Issue #7, spoor 1)

Dit is de flessenhals. Alles daarna hangt hieraan.

#### 1a. Migratie: identiteit en membership

Nieuwe migratie `0009_identiteit_en_membership.sql`:

- `clm.user` krijgt `external_subject text` — de stabiele identifier uit het
  ID-token (`oid`, niet `email`: een e-mailadres verandert, `oid` niet).
  Nullable, want bestaande rijen en seed-gebruikers hebben er geen.
- `UNIQUE (external_subject)` waar niet-null — één Entra-identiteit is één gebruiker.
- Nieuwe tabel `clm.tenant_membership`: `user_id`, `tenant_id`, `role`, `created_at`,
  soft delete. Primaire sleutel op `(user_id, tenant_id)`.
  RLS met `USING` én `WITH CHECK`, conform §7.
- Rol als `text` met CHECK op een kleine set (`admin`, `reviewer`) — geen aparte
  rollentabel voor twee waarden.

**Waarom een aparte membershiptabel en niet `user.tenant_id`?** `clm.user` heeft al
een `tenant_id`, maar dat maakt een gebruiker permanent van één tenant. §6 staat een
tenant-switch expliciet toe wanneer de gebruiker aantoonbaar lid is van beide. Zonder
membershiptabel is die switch niet te bouwen zonder de gebruiker te dupliceren.

Tenant-isolatietest verplicht (§7.4): een membership van tenant A mag niet leesbaar
of schrijfbaar zijn in de context van tenant B.

#### 1b. Authorization code inwisselen en token verifiëren

Nieuwe module `src/auth/`:

- **Config-gedreven**, conform de PoC-bevindingen stap 3: issuer-URL, JWKS-endpoint,
  client-ID en secret als environment-variabelen. Een latere verhuizing naar een
  Bizaline-tenant blijft dan een configuratiewijziging.
- `POST` naar het `/token`-endpoint van `mcm2ciam` met code + PKCE-verifier.
- ID-token verifiëren tegen de **JWKS** van de issuer: handtekening, `iss`, `aud`,
  `exp`, `nbf`. Niet zelf JWT-logica schrijven — een bestaande, gepinde bibliotheek
  (`jose`), conform §11.
- Claims uitlezen: `oid`, `email`, `tid`.

**Uitdrukkelijk niet:** het ID-token doorgeven aan de frontend als bearer token dat
bij elke call meegaat. De sessie loopt via een **httpOnly, secure, SameSite cookie**
die naar een server-side sessie verwijst. Een token in JavaScript-bereik is een
XSS-doelwit.

#### 1c. De guard

`TenantContextGuard`:

1. Leest de sessie uit de cookie.
2. Zoekt de `clm.user` op via `external_subject`.
3. Controleert membership voor de gevraagde tenant.
4. Zet de tenantId in de request-context; `withTenant()` gebruikt uitsluitend díé waarde.

**De `X-Tenant-Id`-route gaat eruit** zodra de guard staat. Zolang beide bestaan is
er een tweede pad naar tenantcontext, en dan is P0 niet dicht.

Er is geen productiedata die hierop leunt: de enige plek waar de header nu gebruikt
wordt, is testopzet.

#### 1d. Tests

- Membership-isolatie (cross-tenant read én write), verplicht per §7.4.
- Guard weigert: geen sessie, onbekende `external_subject`, geldige gebruiker zonder
  membership voor de gevraagde tenant, verlopen token.
- **Tegenproef**, conform de werkwijze in dit project: membershipcontrole tijdelijk
  uitschakelen en vaststellen dat precies de bedoelde tests omvallen. Groene tests
  zonder tegenproef bewijzen niets.

**Klaar wanneer:** je kunt inloggen via Entra, de backend leidt je tenant af uit het
geverifieerde ID-token, en een gebruiker zonder membership komt er niet in.

---

### Fase 2 — Vendorbeheer: schrijfroutes en schermen

#### 2a. Backend

`src/vendor/` uitbreiden met:

- `GET /vendors` — lijst, tenant uit de guard.
- `GET /vendors/:id` — detail inclusief contactpersonen.
- `POST /vendors` — aanmaken.
- `PATCH /vendors/:id` — wijzigen.
- `POST /vendors/:id/contacts`, `PATCH`/`DELETE` op contacten.
- **CSV-import activeren:** de bestaande parser krijgt eindelijk zijn schrijfpad.
  De geweigerde-e-mailregel uit ontwerp §2c hoort hier (onbekende vendor → weigeren
  en terugmelden, niet automatisch aanmaken).

Alles via `withTenant()`. Auditregels voor aanmaken/wijzigen/verwijderen, conform §7.7
(append-only voor de runtime-rol).

**Soft delete, geen harde delete.** `deleted_at` bestaat al op beide tabellen.

#### 2b. Frontend

In `MCM2-frontend`, naast het bestaande portaal:

- **Layout van MVM_V2 overnemen**: sidebar, kleuren, typografie, schermindeling.
  Kopiëren met bronvermelding, niet koppelen (ADR-012) — zoals de design tokens al
  gedaan zijn.
- Vendorlijst met zoeken en filteren.
- Vendordetail: stamgegevens + contactpersonen.
- Formulieren voor aanmaken/wijzigen van vendor en contactpersoon.

**Bewust niet overgenomen:** de compliance-panelen van MVM_V2. Zie §2.

**De bestaande CI-poorten blijven gelden:** geen leveranciersspecifieke imports, en
nooit een tenant in een URL. Die tweede poort is precies wat MVM_V2's `?tenant=demo`
zou tegenhouden.

**Klaar wanneer:** je logt in als tenant, maakt een vendor aan met contactpersoon en
e-mailadres, en ziet die terug in de lijst — in de browser, tegen de echte backend.

---

### Fase 3 — Demo-tenant met mock data

`scripts/seed-demo-tenant.js`, in de vorm van de bestaande seedscripts
(idempotent, `DATABASE_URL`-gedreven, plain JavaScript).

Vult:

- Eén demo-tenant.
- Gebruikers mét `external_subject` en membership — anders kun je er niet in inloggen
  en kijk je naar onbereikbare data. **Dit is de reden dat deze fase ná fase 1 komt.**
- Leveranciers en contactpersonen, afgeleid uit `vendors.mock.ts` van MVM_V2 en het
  bestaande `db/seeds/voorbeeld-leveranciers-coupa.csv`.
- Beide vragenlijsten (hergebruikt: `seed-vragenlijsten.js`).
- Een actieve surveyronde met een paar responses in verschillende stadia — open,
  concept, ingediend — zodat de statusweergave iets te tonen heeft.

**Herhaalbaar en weggooibaar.** Twee keer draaien geeft hetzelfde resultaat.

**Let op:** dit script is *geen* testfixture. `otap-doorloop.js` houdt zijn eigen
opzet; twee scripts die dezelfde rijen claimen gaan elkaar in de weg zitten.

**Klaar wanneer:** één commando vult een demo-tenant, je logt erin en ziet gevulde
schermen.

---

### Fase 4 — OTAP-straat robuust

`scripts/otap-doorloop.js` uitbreiden van de huidige 21 controles met:

- Login-keten: authorization code → token → sessie → guard laat door.
- Guard weigert een gebruiker zonder membership.
- Vendor aanmaken via de API, terugvinden in de lijst, cross-tenant onzichtbaar.
- Contactpersoon toevoegen.
- Demo-seed draaien en verifiëren dat het resultaat klopt.
- De frontend praat écht met de backend (bestaande controle, uitbreiden naar de
  nieuwe schermen).

Plus twee dingen die de straat pas robuust maken:

- **Idempotentie bewijzen**: twee keer achter elkaar draaien zonder `down -v`, beide
  keren groen. Dat is eerder misgegaan (bevinding 2 van 2026-07-29).
- **Vanaf niets**: `down -v` gevolgd door een volledige doorloop.

**Klaar wanneer:** één commando bewijst de hele keten, twee keer achter elkaar, en
ook vanaf een lege database.

Issue #18 blijft daarna open — die vraagt A en P, en die omgevingen bestaan nog niet
(#12). Dat is bewust: dit plan maakt O en T robuust.

---

## 5. Wat dit plan expliciet niet doet

- **Geen AWS-acceptatieomgeving** (#12). Losse beslissing, kost geld, niet nodig voor
  deze drie doelen.
- **Geen e-mailverzending** (#13). "Surveys kunnen versturen" betekent hier: de
  gegevens staan klaar en de ronde is te starten. Het daadwerkelijk versturen wacht
  op de SMTP-details van Transdev (OV-9, nog open) — dat is een klantafhankelijkheid,
  geen bouwkeuze.
- **Geen compliance-panelen** uit MVM_V2. Zie §2.
- **Geen aanpassingen aan de tokenlaag** voor leveranciers. Die is af, gemerged en
  bewezen; dit plan raakt hem niet.

## 6. Risico's en aandachtspunten

| Risico | Impact | Beheersing |
|---|---|---|
| Entra-flow blijkt weerbarstiger dan de PoC suggereert | Fase 1 loopt uit | De PoC is end-to-end geslaagd tot een geldige code; het resterende werk is server-side en goed gedocumenteerd. Bij de eerste blokkade: eerst Microsoft Learn lezen, niet gokken (§6 van MCM2-CLAUDE.md, en de les uit de PoC zelf). |
| Client secret van `mcm2ciam-federation-trust` | Secret in configuratie | Nooit in git, nooit in logs. Via environment-variabele, `.env` blijft ge-ignored. Rotatie mogelijk zonder codewijziging. |
| Sessiecookies over http bij lokaal draaien | `secure`-cookie werkt niet op http | Cookie-instellingen omgevingsafhankelijk maken; `secure` verplicht buiten ontwikkeling. Expliciet gemarkeerd, conform §6 over tijdelijke lokale ontwikkelcontext. |
| Demo-tenant en OTAP-doorloop botsen | Onbetrouwbare tests | Gescheiden tenants en gescheiden UUID-reeksen. |
| Scope groeit tijdens fase 2 (MVM_V2 heeft veel schermen) | Fase 2 loopt uit | De grens staat in §5. Een paneel toevoegen vraagt een datamodel-onderbouwing, geen UI-argument. |
| `deleted_at` en RLS | Migratie 0004 haalde `deleted_at` bewust uit de RLS-policies | Filtering op soft delete hoort in de query, niet in de policy. Bij het bouwen van de vendorroutes expliciet meenemen. |

## 7. Openstaande punten die dit plan raakt maar niet oplost

- **#30 (geen backups)** blijft de zwaarste blokkade voor alles wat de
  productiedatabase raakt. Dit plan bouwt tegen wegwerpcontainers en raakt
  `clm-enterprise` niet — maar #30 blijft openstaan en vraagt uitvoering door de
  eigenaar (dagelijkse dump inplannen, `BACKUP_DIR` naar een tweede locatie).
- **#46** heeft een harde datum: pilot rond 1 september, en geüploade certificaten
  staan op een containerschijf die bij de eerstvolgende image-vervanging leeg is.
  Staat los van dit plan, maar loopt op een klok.
- **#16** (export- en reminderacties krijgen expliciet `tenantId` mee) wordt door de
  guard makkelijker op te lossen, maar valt buiten deze scope.
- **#23** (MVM_V2-inconsistenties) wordt hier deels omzeild door bewust niet getrouw
  te kopiëren.

## 8. Volgorde in één oogopslag

```
Fase 1  identiteit + membership + guard      → inloggen werkt, P0 dicht
Fase 2  vendorroutes + schermen              → vendor aanmaken in de browser
Fase 3  demo-tenant seed                     → gevulde schermen
Fase 4  OTAP-doorloop uitgebreid             → de keten bewezen, twee keer
```

Elke fase krijgt een eigen feature branch, conform het branch-ritueel. Na elke fase:
STATUS.md bijwerken (§13b) en een controlemoment met de eigenaar.
