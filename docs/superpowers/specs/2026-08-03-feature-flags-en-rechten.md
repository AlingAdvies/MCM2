# Ontwerp — feature flags en rechten: twee lagen, één poort

**Datum:** 2026-08-03
**Status:** ONTWERP — niet gebouwd, geen migratie, geen besluit gevraagd op de invulling
**Aanleiding:** bij fase 2b (sidebar) bleek dat de vraag "wie mag dit menu-item zien"
twee verschillende antwoorden nodig heeft die vandaag geen van beide bestaan.
**Raakt:** fase 2b, Issue #57 (platformbeheer), ADR-006

---

## 0. Waarom dit document er is

De sidebar van MVM_V2 verbergt menu-items op twee gronden tegelijk. Dat is te zien
in `MVM_V2/src/shared/components/layout/Sidebar.tsx`:

```ts
const itCompliancyEnabled = useFeatureFlag(transdevConfig, 'itCompliancyCockpit')
const isAdmin            = canDo(currentUser.role, 'user.manage')
```

Twee aanroepen, twee bronnen, twee betekenissen. Bij het overnemen van die sidebar
naar MCM2 moet duidelijk zijn wélke van de twee je aan het bouwen bent — anders
ontstaat er één vage `magDitZien()` waarin een ingekochte module en een
persoonlijke bevoegdheid door elkaar lopen. Dat is precies het soort verwarring
dat later een beveiligingsfout wordt.

De eigenaar formuleerde het onderscheid op 2026-08-03 zo:

> feature flags hebben 2 soorten gebruik: sommige tenants hebben meer features
> (betaald) dan anderen en binnen een tenant hebben sommige gebruikers meer
> features tot hun beschikking dan anderen

Dit document werkt dat uit. **Er wordt niets gebouwd op basis hiervan** tot de
eigenaar de invulling heeft gekozen; fase 2b bouwt alleen de plek waar de twee
lagen samenkomen.

---

## 1. De twee lagen

| | Laag 1 — **tenantrecht** | Laag 2 — **gebruikersrecht** |
|---|---|---|
| Vraag | Heeft deze klant deze functie? | Mag deze persoon deze functie? |
| Verandert bij | een contract, een upgrade | een functiewissel, een nieuwe collega |
| Wie beheert | Bizaline (leverancier) | de beheerder van de klant |
| Voorbeeld | "Transdev heeft de IT-compliancemodule" | "Sophie mag leveranciers aanmaken, Mark alleen lezen" |
| Bestaat in MCM2 | **nee** | **deels** — `tenant_membership.role` |

**Ze vermenigvuldigen, ze vervangen elkaar niet.** Een menu-item is zichtbaar als
de tenant de feature heeft **én** de gebruiker het recht. De volgorde van
controleren doet er niet toe voor de uitkomst, wél voor de foutmelding: "uw
organisatie heeft deze module niet" is iets anders dan "u heeft hier geen
toegang toe", en een gebruiker die het verschil niet krijgt te horen belt de
verkeerde persoon.

### Waarom niet één lijst rechten

De verleiding is om laag 1 op te lossen door de tenantbeheerder simpelweg geen
rechten uit te delen voor wat niet is ingekocht. Dat werkt niet:

- **Het is omkeerbaar door de verkeerde partij.** Een tenantbeheerder die alle
  rechten mag uitdelen, kan zichzelf een niet-betaalde module toekennen.
- **Het overleeft geen upgrade.** Koopt de klant de module alsnog, dan moet
  iemand handmatig bij alle bestaande gebruikers het recht bijzetten.
- **Het maakt facturatie onbewijsbaar.** "Welke klanten gebruiken module X" is
  dan een vraag over rechtenrijen in plaats van over één veld per tenant.

---

## 2. Wat er vandaag is

**Laag 2, gedeeltelijk.** `clm.tenant_membership.role` is `admin` of `reviewer`,
met een CHECK-constraint op die twee waarden (migratie 0009). De rol reist mee tot
in de sessie: `clm.sessie_oplossen()` geeft hem terug
(`RETURNS TABLE (sessie_id, user_id, tenant_id, role)`, migratie 0010) en
`SessieService` leest hem uit.

**De frontend kan er niet bij.** Er is geen route die de huidige sessie
teruggeeft: `/auth/login`, `/auth/callback` en `/auth/logout`, meer niet. Een
sidebar die de naam van de ingelogde gebruiker toont of een knop verbergt voor
een reviewer, heeft die route nodig. Dat is het enige echte gat dat fase 2b moet
dichten.

**Laag 1 bestaat nergens.** Niet op `clm.tenant`, niet in de frontend, niet in de
configuratie.

---

## 3. Twee rollen zijn te grof, en dat is nu geen probleem

`admin` en `reviewer` dekken de huidige twee handelingen (beheren, beoordelen).
Zodra er een derde soort gebruiker komt — iemand die alleen rapportages leest,
of iemand die wél vragenlijsten opstelt maar geen leveranciers beheert — is de
tweedeling op. Dat is te voorzien maar nog niet aan de orde.

**Het advies is om nu níét naar losse permissies te gaan.** MVM_V2 doet dat wel
(`canDo(role, 'user.manage')`), en dat is de juiste eindvorm. Maar een
permissiemodel ontwerpen tegen twee bestaande rollen levert een abstractie op
voor een probleem dat je nog niet kent. De goedkope voorbereiding is de aanroep
zó te schrijven dat de vervanging later lokaal blijft:

```ts
// Nu: één regel, leest de rol.
// Straks: dezelfde aanroep, andere inhoud.
magBeheren(sessie)   in plaats van   sessie.role === 'admin'
```

Wie overal `role === 'admin'` schrijft, moet later elke plek vinden. Wie één
functie aanroept, vervangt de inhoud daarvan.

---

## 4. Drie manieren om laag 1 vast te leggen

Niet gekozen — dit is de afweging die de eigenaar te zien krijgt.

### A. Kolom op `clm.tenant`

```sql
ALTER TABLE clm.tenant ADD COLUMN feature_flags jsonb NOT NULL DEFAULT '{}';
```

**Voor:** één migratie, één plek, meteen bevraagbaar per tenant. De sessieroute
kan de flags meteen meesturen, dus de frontend hoeft geen tweede verzoek.

**Tegen:** `jsonb` betekent geen enkele controle op wat erin staat. Een typefout
in een flagnaam (`itCompliancy` versus `itCompliancyCockpit`) levert stilzwijgend
`false` op — precies de faalvorm die dit project elders juist vermijdt met
CHECK-constraints. Te ondervangen met een `ref.feature`-tabel en een
koppeltabel, maar dan is optie B eerlijker.

### B. Referentietabel plus koppeltabel

```sql
ref.feature (code, label, omschrijving)
clm.tenant_feature (tenant_id, feature_code, actief_vanaf, actief_tot)
```

**Voor:** een onbekende flagnaam is een foreign-key-fout, geen stille `false`.
Sluit aan op hoe MCM2 `vendor_category` en `compliance_status` al doet. Met
`actief_vanaf`/`actief_tot` is een proefperiode of een opgezegde module
vastlegbaar, en is achteraf te zien wat wanneer aanstond — dat is een
facturatievraag, niet alleen een technische.

**Tegen:** twee tabellen en een migratie voor iets waarvan de eerste echte
toepassing nog niet bestaat. Meer werk vooraf.

### C. Configuratiebestand per tenant, zoals MVM_V2

`tenant.config.ts` met een `featureFlags`-object, in de code.

**Voor:** geen migratie, geen database, direct te lezen in de frontend. Werkt
goed zolang er één klant is.

**Tegen:** een feature aan- of uitzetten wordt een deploy. Bij MVM_V2 kan dat,
want daar is de tenantmap onderdeel van de drielaagse klantaanpassing
(`C:\dev\CLAUDE.md`). Voor MCM2 is het strijdig met de opzet: klantspecificiteit
hoort in configuratie en data, en een betaalde module is data — hij verandert
door een handtekening, niet door een release.

**Neiging van de schrijver, geen besluit:** **B**, en pas bouwen wanneer de
eerste echte betaalde feature bestaat. Tot dan is elke keuze een gok op de vorm.

---

## 5. Wat fase 2b hiervan bouwt

Alleen dit, en bewust niet meer:

1. **Een sessieroute** — `GET /auth/sessie` geeft terug wie is ingelogd
   (naam, rol, tenantnaam). Zonder geldig cookie een 401. Dit is geen
   voorbereiding op iets toekomstigs maar een gat van vandaag: de sidebar kan
   anders geen naam tonen.

2. **Eén functie in de frontend** waar de zichtbaarheid van een menu-item wordt
   bepaald. Die leest nu uitsluitend de rol. De tenantlaag is er later één
   controle bij, op één plek:

   ```ts
   // src/core/auth/rechten.ts — fase 2b
   export function magZien(item: MenuItem, sessie: Sessie): boolean {
     return item.vereistRol ? sessie.role === item.vereistRol : true;
   }
   // Later, wanneer laag 1 bestaat:
   //   && (!item.vereistFeature || sessie.features.includes(item.vereistFeature))
   ```

**Uitdrukkelijk niet in 2b:** geen migratie, geen `featureFlags`-kolom, geen
permissiemodel, geen tenantconfiguratie in de frontend.

---

## 6. De valkuil die dit document eigenlijk moet voorkomen

**Een verborgen menu-item is geen beveiliging.** De sidebar bepaalt wat iemand
*ziet*, niet wat iemand *kan*. Wie het adres kent, roept de route rechtstreeks
aan.

Dat is vandaag geen gat, want de backend controleert zelf: `TenantContextGuard`
weigert zonder geldige sessie, RLS weigert data van een andere tenant. Maar
zodra de eerste route "alleen voor admin" wordt, moet die controle in de
**backend** staan — de sidebar mag hem hooguit weerspiegelen.

Concreet: `POST /vendors` staat nu open voor elke geldige sessie, dus ook voor
een `reviewer`. Verbergt 2b de knop "Leverancier toevoegen" voor reviewers, dan
lijkt dat een rechtenmodel terwijl het een gordijn is. **Ofwel de route krijgt
de controle erbij, ofwel de knop blijft zichtbaar** — de tussenvorm is de
gevaarlijkste, want die wekt de indruk dat er iets geregeld is.

Aanbeveling: in 2b de knop zichtbaar houden voor iedereen, en de rolcontrole op
`POST /vendors` als eigen stap oppakken zodra duidelijk is wat een `reviewer`
precies wel en niet mag. Dat is een productvraag, geen implementatiedetail.

---

## 7. Openstaande vragen voor de eigenaar

Geen daarvan blokkeert fase 2b.

1. **Welke features worden ooit apart verkocht?** Zonder één concreet voorbeeld
   is de vorm van laag 1 niet te kiezen. De IT-compliancemodule van MVM_V2 is
   de enige kandidaat die nu bekend is.
2. **Mag een `reviewer` leveranciers aanmaken?** Nu wel (de route controleert
   niets). Zo niet, dan is dat backendwerk — zie §6.
3. **Komt er een derde rol?** Zo ja, dan is het permissiemodel uit §3 eerder aan
   de orde dan gedacht.
4. **Hoe verhoudt dit zich tot Issue #57** (platformbeheer-toegang tot
   klant-tenants)? Een Bizaline-medewerker die meekijkt bij een klant is een
   derde soort recht, buiten beide lagen. Dat issue staat al open en hoort hier
   niet opgelost te worden.
