# Een tenant aanmaken in de app, en wie dat mag

**Datum:** 2026-08-08
**Aanleiding:** de eigenaar wil live kunnen zien hoe een nieuwe tenant ontstaat —
niet als demo, niet als simulatie. Casus: AlingAdvies wordt klant, de eigenaar
maakt de tenant aan, en `kees@alingadvies.nl` logt daarna in en vult hem.

---

## Wat er vandaag niet bestaat

Er is **geen enkele weg** waarlangs een tenant via de applicatie ontstaat.
Vijf controllers (`auth`, `health`, `survey-response`, `vragenlijst-beheer`,
`vendor`), geen daarvan raakt `clm.tenant`. Elke tenant tot nu toe komt uit
`seed-demo-tenant.js`, `echte-login.js` of een handmatige insert.

Er bestaat ook geen rol bóven de tenant. `tenant_membership.role` kent
`admin` en `reviewer`, en allebei gelden binnen één tenant.

## Wat wél bewezen is (2026-08-08)

| | |
|---|---|
| Productiedatabase | schema 0019, leeg, 0 tenants |
| Entra-login `kees@alingadvies.nl` | **werkt** — via federatie met `alingadvies.nl`, met MFA |
| `oid` in het ID-token | aanwezig, 36 tekens; issuer en audience kloppen |
| `external_subject` nullable | ja, met partiële unieke index — een rij zonder `oid` mag |

De login liep eerst stuk op `AADSTS50056` (*password does not exist in the
directory*). Oorzaak: `kees@alingadvies.nl` is in `mcm2ciam` een **federatieve**
gebruiker; zijn wachtwoord staat in `alingadvies.nl`. De weg is de knop
"Sign in with AlingAdvies", niet het wachtwoordveld. Zie de PoC-bevindingen van
2026-07-27.

---

## Besluit — meekijken via tijdelijk membership, niet via een alziende rol

De eigenaar wil dat de platformbeheerder in een tenant kan meekijken, om later
een helpdesk te kunnen bemensen. De eerste vorm daarvan — een platformrol die
dwars door alle tenants heen leest — is **verworpen door de eigenaar** ten
gunste van een betere: de platformbeheerder **wordt lid** van de tenant waar hij
moet helpen.

Daarmee blijft de tenantgrens volledig intact: RLS, `TenantContextGuard` en de
tests die bewijzen dat geen enkele route een tenant uit de invoer accepteert,
hoeven geen uitzondering te krijgen.

| | Alziende platformrol | Tijdelijk membership |
|---|---|---|
| Tenantgrens | doorbroken | intact |
| Auditspoor | apart bouwen | het membership zelf ís het spoor |
| Klant ziet wie toegang heeft | nee | ja, in de ledenlijst |
| Gestolen sessie raakt | alle tenants | één tenant |

**Toegang is een gebeurtenis, geen toestand.** De platformbeheerder kent zichzelf
toegang toe met een reden en een einddatum; daarna vervalt het vanzelf.

Dit wordt **ADR-015**. ADR-013 gaat over rollen *binnen* een tenant en blijft
ongewijzigd.

### Getoetst aan de industrie (2026-08-08)

Nagezocht in twintig bronnen: ISO 27001 A.8.15/A.8.16, SOC 2 CC6.2/CC6.3/CC7.2,
en de praktijk bij Okta, Atlassian, Microsoft 365, Google Workspace, AWS
Support, Zendesk en Broadcom. De uitkomst bevestigt het besluit hierboven —
voor kleinschalige B2B SaaS op Postgres met RLS is *just-in-time,
tenant-scoped* toegang de aanbevolen vorm, en een alziende platformrol geldt
nog slechts als **break-glass** voor noodgevallen.

Twee dingen die de bronnen toevoegen aan het besluit:

**Meekijken is géén impersonatie.** Bouw een eigen `support`-rol die leest;
niet een "login as" waarbij je de klant wórdt. Authress noemt impersonatie
"insecure by design", en het echte bezwaar is toerekening: als een
platformbeheerder een oordeel goedkeurt terwijl hij Kees imiteert, staat er in
de audit trail dat Kées dat deed. In een compliance-product waar "wie keurde
dit goed" de kernvraag is, is dat onaanvaardbaar. AWS en Broadcom doen het om
dezelfde reden met een aparte supportrol.

**Duur: uren tot één werkdag.** Okta hanteert 24 uur, Microsoft trekt in bij
het sluiten van de case (max 30 dagen). Acht uur is een verdedigbare standaard.

### Wat nu wél en wat later — er zijn nog geen betalende tenants

Vuistregel: wat in het **datamodel** zit is achteraf duur om te wijzigen en
doen we nu goed; een **scherm** is later net zo goedkoop te bouwen als nu.

| | Nu | Later |
|---|---|---|
| `verloopt_op`, `reden`, `toegekend_door` in het model | ✔ | |
| Verlopen toegang geeft aantoonbaar niets | ✔ | |
| Vastleggen in `audit.audit_event` | ✔ | |
| `support`-rol als leesrol (naast `admin`/`reviewer`) | ✔ | |
| Scherm waarop de tenant ziet wie erbij was | | ✔ |
| Melding aan de tenant bij toegang | | ✔ |
| Goedkeuringsstroom met tweede persoon | | ✔ |
| Logs buiten de database (WORM/SIEM) | | ✔ |
| Automatische opruiming van verlopen rijen | | ✔ |

De rechterkolom is bewust uitgesteld, niet vergeten. Ze wordt actueel zodra er
een tenant is die niet van onszelf is — dát is het moment waarop transparantie
naar de klant betekenis krijgt. Tot die tijd is de platformbeheerder de enige
gebruiker en is een meldmail aan jezelf theater.

**Wat we nu al niet mogen verzwakken:** het auditspoor. Dat is de enige van de
vier gaten die achteraf niet te repareren is — een gebeurtenis die niet is
vastgelegd, is weg.

---

## Fase 1 — Migratie 0020: de platformrol

Handgeschreven, in de stijl van `0015_survey_review.sql`, **met journal-entry**
(zonder die entry slaat Drizzle hem stil over — zie het runbook).

1. `clm.platform_admin` — welke gebruiker is platformbeheerder.
   Verwijst naar `clm."user"`. Bewust een aparte tabel en geen kolom op `user`:
   het is een eigenschap van de persoon tegenover het platform, niet tegenover
   de tenant waar hij administratief thuishoort.
2. Uitbreiding van `tenant_membership` met de velden voor tijdelijke toegang:
   `verloopt_op` (nullable — NULL is een gewoon, blijvend membership),
   `reden` en `toegekend_door`.
3. `support` als derde waarde in `tenant_membership_role_check`, naast `admin`
   en `reviewer`. Een leesrol: meekijken zonder te kunnen wijzigen, en
   herkenbaar in elk auditspoor. Dit is de plek waar de constraint verruimd
   wordt zoals 0017 dat deed voor `goedgekeurd`.
4. RLS-policy's in de lijn van de bestaande tabellen. `clm_api_runtime` houdt
   dezelfde rechten als nu; er komt geen `BYPASSRLS` bij.

**Drie tegenproeven, geen van alle optioneel:**

1. Een membership met een verstreken `verloopt_op` geeft **nergens** toegang.
   Eén vergeten filter in één query is precies hoe dit stilletjes misgaat.
2. `support` kan lezen maar niet schrijven — probeer een oordeel op te slaan en
   verwacht een weigering.
3. Het toekennen zelf staat in `audit.audit_event`, met wie, welke tenant,
   welke reden en tot wanneer.

## Fase 2 — De route en de guard

- `PlatformAdminGuard` — náást `TenantContextGuard`, niet erin. De bestaande
  guard doet uitdrukkelijk geen rolcontrole en dat blijft zo.
- `POST /platform/tenants` — naam + e-mailadres van de eerste admin. Maakt in
  één transactie: de tenant, een `clm.user`-rij **zonder** `external_subject`,
  en een `tenant_membership` met rol `admin`.
- `GET /platform/tenants` — de lijst, voor het beheerscherm.
- `POST /platform/tenants/:id/toegang` — de platformbeheerder kent zichzelf een
  tijdelijk `support`-membership toe, met een reden en een einddatum. Legt vast
  in `audit.audit_event`. Dit is de helpdeskfunctie in zijn kleinste bruikbare
  vorm: geen goedkeuringsstroom, geen melding aan de tenant — die komen erbij
  zodra er een tenant is die niet van onszelf is.

De `oid` wordt bij de eerste login gekoppeld op e-mailadres. Dat kan veilig
omdat de partiële unieke index NULL toestaat.

**Let op bij het koppelen:** koppel alleen als er precies één wachtende rij met
dat e-mailadres is, en alleen als `external_subject` nog NULL is. Anders is het
een aanvalsvector: wie een e-mailadres kent zou zich aan een bestaande rij
kunnen hechten.

## Fase 3 — Het scherm

In `MCM2-frontend`, achter de platformrol. Twee velden, een lijst, en een
bevestiging die toont wat er is aangemaakt.

## Fase 4 — De echte test

1. Eigenaar maakt tenant **AlingAdvies** aan met `kees@alingadvies.nl` als admin.
2. Kees logt in via Entra — federatie, MFA — en zijn `oid` koppelt zich.
3. Kees vult de tenant met de demo-data (`seed:demo --echte-tokens`, dat mag op
   een beschermde database: seeden voegt toe, alleen `--verwijder` eist wegwerp).
4. AlingAdvies is daarmee de tenant waarmee demo's gedaan worden.

**In deze test wordt de platformrol niet gebruikt om mee te kijken** — Kees is
gewoon de tenant-admin. Dat houdt de test zuiver: hij bewijst dat een gewone
tenant-admin het kan, niet dat de eigenaar het via een omweg kan.

---

## Waar dit draait

De applicatie draait **nergens in productie** — alleen de database staat op
Supabase (AWS App Runner is een voornemen uit ADR-012, geen draaiende omgeving).
Besluit van de eigenaar: eerst bouwen en beproeven met de app lokaal, schrijvend
naar de productiedatabase. De tenant, de login en de data zijn dan echt en
blijven staan; alleen de server is lokaal.

`OIDC_REDIRECT_URI` staat op `http://localhost:5001/auth/callback` en klopt voor
die opzet. Bij een echte uitrol moet hij mee veranderen, óók in de
app-registratie in Entra.

## Wat hier niet in zit

- Uitnodigingsmails. De eerste admin wordt door de platformbeheerder ingevuld.
- Zelfregistratie door klanten.
- Facturatie of abonnementen.
- Het helpdeskscherm zelf — fase 1 en 2 leggen alleen het fundament.
