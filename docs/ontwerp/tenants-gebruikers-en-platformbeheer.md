# Tenants, gebruikers en platformbeheer — het ontwerp

**Datum:** 2026-08-08
**Status:** voorstel, ter review
**Aanleiding:** bij het aanmaken van de eerste echte tenant ontstonden
workarounds. Dit document zet het ontwerp vast vóór er verder gebouwd wordt.

---

## Voor de reviewer

**Wat ik van je wil weten** staat in §9. De rest is context om die vragen te
kunnen beantwoorden.

**Als je weinig tijd hebt:** lees §0 (wat is dit product), §3 (het principe),
§5.2 (het openstaande gat) en §9 (de vragen). Dat is de kern.

**Wat dit document niet is:** geen implementatieplan en geen
architectuuroverzicht van het hele systeem. Het gaat over één afgebakend
onderwerp — hoe tenants en gebruikers ontstaan, inloggen en bekeken worden, en
welke rol de leverancier van het platform daarin heeft.

**Eerdere besluiten waar dit op voortbouwt:** ADR-006 (identity via Entra
External ID), ADR-008 (rolmodel in de database), ADR-013 (rollen binnen een
tenant), ADR-015 (platformbeheer-toegang). Waar dit document daarvan afwijkt,
staat dat expliciet.

---

## 0. Wat is dit product, en voor wie

**MCM2** is de backend van MyVendorManager: een multi-tenant SaaS-platform voor
**Contract & Vendor Lifecycle Management**, gericht op Nederlandse organisaties.
Het vervangt een eerdere C#-pilot en wordt onderdeel van de Bizaline-suite.

De vastgelegde ontwerpprioriteit (MCM2-CLAUDE.md §2), in deze volgorde:

1. **Security en betrouwbare tenant-isolatie**
2. Onderhoudbaarheid en herstelbaarheid
3. Functionele aansluiting op de geaccepteerde demo
4. Reproduceerbare OTAP en deployment
5. Pas daarna performance en schaal

> Bouw een veilig, begrijpelijk, aantoonbaar onderhoudbaar SaaS-platform dat de
> eigenaar met VS Code en Claude Code kan beheren, zonder afhankelijkheid van
> verborgen kennis, handmatige serverhandelingen of fragiele technische
> workarounds.

Die laatste zin is de reden dat dit document bestaat.

### De eerste concrete toepassing

Een jaarlijkse **Vendor IT Compliance Survey** voor Transdev Nederland:

```text
Transdev-beheerder
  → beheert leveranciers en contactpersonen
  → start een jaarlijkse survey-campagne
  → gebruikt een versieerbare vragenlijst
  → verstuurt een unieke, tijdgebonden response-link
  → leverancier vult antwoorden in en dient veilig in
  → Transdev beoordeelt status en antwoorden
  → alle acties zijn tenant-geïsoleerd en auditbaar
```

Belangrijk voor het begrip: **de vragenlijst is een tool, geen vaste inhoud.**
De Transdev-vragen zijn de eerste vulling en de PoC-casus, niet de scope.

### Twee toegangssporen, fundamenteel verschillend

| | Spoor 1 — interne beheerder | Spoor 2 — externe leverancier |
|---|---|---|
| Wie | medewerker van de klant | leverancier van de klant |
| Identiteit | Entra External ID (federatie) | **geen account** |
| Toegang via | sessiecookie na login | tijdgebonden token in een link |
| Tenantcontext uit | `tenant_membership` | het token |

**Dit document gaat uitsluitend over spoor 1.** Spoor 2 (de leverancier met een
tokenlink) is af, werkt, en verandert niet. Dat een leverancier géén account
heeft is een bewuste keuze: leveranciers hebben geen Entra-account bij de
klantorganisatie, en een accountloos mechanisme houdt de drempel laag.

### De technische omgeving

| | |
|---|---|
| Backend | NestJS / TypeScript, Node 22 |
| Database | PostgreSQL 17 op Supabase, **row-level security als tenantgrens** |
| Migraties | Drizzle, handgeschreven SQL |
| Identiteit | Microsoft Entra External ID (CIAM), OIDC |
| Frontend | Next.js, aparte repository, uitgerold als containerimage |
| Uitrol | de applicatie draait vandaag **nergens in productie** — alleen de database staat er. AWS App Runner is een voornemen (ADR-012). |

**RLS is geen extra laag maar dé tenantgrens.** Elke query draait binnen een
transactie die begint met `SET LOCAL app.current_tenant_id`; de policies
filteren daarop. De applicatierol heeft bewust géén `BYPASSRLS`. Dat is een
niet-onderhandelbare regel (§6 van de projectinstructies), en het verklaart
veel van wat hieronder volgt.

### Schaal en context

- **Nul betalende tenants vandaag.** De eerste wordt AlingAdvies — de eigen
  organisatie van de eigenaar, bedoeld voor demo's.
- Verwachting op termijn: tientallen tenants, geen duizenden.
- Eén beheerder (de eigenaar), die het platform met VS Code beheert.
- ISO 27001 is behaald; NIS2 is van toepassing op klanten. Auditbaarheid is
  daarmee een eis, geen luxe.

---

## 1. Wat er misging, en waarom

Op 2026-08-08 is de platformlaag gebouwd en strandde de eerste echte tenant op
een 500. Drie dingen bleken pas bij het uitvoeren:

| Wat | Wanneer ontdekt |
|---|---|
| `clm_api_runtime` heeft geen rechten op `clm.tenant_membership` | bij de eerste POST |
| `tenant_name_key` is hoofdlettergevoelig | door een e2e-test |
| `ALTER DEFAULT PRIVILEGES` uit 0001 staat niet op productie | bij het uitzoeken van de 500 |

Alle drie waren vooraf zichtbaar geweest. De oorzaak is niet techniek maar
volgorde: er is gebouwd en daarna geplakt.

**De diepere oorzaak is dat er geen expliciet rechtenmodel bestaat.** De rechten
van de applicatierol zijn een optelsom van `ALTER DEFAULT PRIVILEGES` (0001),
losse `GRANT`s in latere migraties, en wat toevallig wel of niet greep. Dat is
niet te overzien en dus niet te verifiëren — en precies daarom viel het gat op
productie pas op toen een route het raakte.

---

## 2. De feitelijke stand (productie, gemeten 2026-08-08)

### Rechten van de applicatierol per tabel

| Groep | Tabellen | Rechten |
|---|---|---|
| Normale tenantdata | `tenant`, `user`, `vendor*`, `survey_*` | `SELECT, INSERT, UPDATE, DELETE` |
| Alleen toevoegen | `response_note`, `survey_review`, `template_reviewer` | geen `DELETE` (append-only van aard) |
| Alleen lezen | `omgeving`, `platform_admin` | `SELECT` |
| **Geen enkel recht** | `sessie`, `tenant_membership` | — |

### En dat laatste is twee verschillende dingen

**`clm.sessie` is bewust dichtgezet.** Migratie 0010 bevat een expliciete
`REVOKE ALL ON clm.sessie FROM clm_api, clm_admin, clm_readonly`, met de reden
in het tabelcommentaar: de sessie wordt opgezocht *vóórdat* de tenantcontext
bestaat, dus RLS kan hem niet beschermen. In plaats daarvan loopt alle toegang
via drie `SECURITY DEFINER`-functies. **Dit is goed ontwerp en blijft zoals het
is.**

**`clm.tenant_membership` is een gat.** Migratie 0009 geeft die tabel geen
enkele `GRANT`. Lokaal werkt het toch, omdat `ALTER DEFAULT PRIVILEGES` uit 0001
elke nieuwe tabel van rechten voorziet. Op productie is die default niet
geregistreerd — daar staan alleen defaults van `postgres` en `supabase_admin` —
en dus viel de tabel buiten de boot.

Dat het nooit opviel, komt doordat geen enkele bestaande route in
`tenant_membership` schrijft. De platformroute is de eerste.

### RLS-stand

Vier tabellen missen `FORCE ROW LEVEL SECURITY`: `survey_response`,
`survey_run`, `tenant_membership`, `user`, `vendor`. Zonder `FORCE` omzeilt de
**eigenaar** van de tabel de policies. De applicatierol is niet de eigenaar, dus
dit is geen open deur — maar het is wel een verschil met de rest, en het maakte
vandaag een van mijn eigen tegenproeven ongeldig.

---

## 2c. Waarborgen die er al zijn

Toegevoegd na de review van 2026-08-08. Twee van de drie bevindingen daar
betroffen dingen die al geregeld waren maar nergens stonden — een reviewer neemt
dan terecht aan dat ze ontbreken. Wat hier staat is geverifieerd tegen de
productiedatabase, niet uit de migraties overgeschreven.

### `SECURITY DEFINER` met een vaste `search_path`

Een `SECURITY DEFINER`-functie zonder vaste `search_path` is een bekend
escalatiepad: wie `CREATE`-recht heeft op een doorzocht schema kan een object
schaduwen en zo code laten draaien met de rechten van de functie-eigenaar — dwars
door RLS heen.

Alle vijf de functies in `clm` hebben `SET search_path = clm, pg_temp`, en
`EXECUTE` is overal ingetrokken van `PUBLIC`:

| Functie | `search_path` | `EXECUTE` |
|---|---|---|
| `gebruiker_bij_subject` | `clm, pg_temp` | alleen `clm_api`, `clm_admin`, `clm_migrator` |
| `sessie_aanmaken` | idem | idem |
| `sessie_oplossen` | idem | idem |
| `sessie_beeindigen` | idem | idem |
| `resolve_survey_token` | idem | idem |

Migratie 0009 legt de reden expliciet vast: *"`SET search_path` is niet
optioneel bij SECURITY DEFINER."*

**Wat wel ontbreekt: een test.** Vandaag is dit een eigenschap van vijf
migraties die iemand bij een zesde kan vergeten. Zie stap 2 van §6.

### De tenantgrens zelf

- De applicatierol heeft géén `BYPASSRLS`. Een startcontrole in
  `DatabaseService` weigert op te starten als dat toch zo is.
- Geen enkele HTTP-route accepteert een tenant uit de invoer — behalve de
  platformroutes, en die staan achter een guard (§5.1). Drie e2e-tests lokken
  het tegendeel uit: een header, een query-parameter, en een ongeldig cookie
  náást een header. Alle drie horen 401 te geven.
- `clm.sessie` heeft een expliciete `REVOKE ALL` (0010): de sessie wordt
  opgezocht vóórdat de tenantcontext bestaat, dus RLS kan hem niet beschermen.

### Wat er al gerepareerd is

De hoofdletterongevoelige tenantnaam uit §1 is **opgelost** in migratie 0021,
gedraaid op productie en teruggelezen op 2026-08-08. Hij staat daarom niet in de
reparatielijst van §6.

---

## 2b. Use cases

De vijf stromen die dit ontwerp moet dragen. UC-A tot en met UC-C zijn nieuw;
UC-D en UC-E bestaan al en mogen niet breken.

### UC-A — Een nieuwe klant wordt tenant

> *AlingAdvies wil klant worden. De eigenaar is akkoord (er is betaald). Hij
> maakt de tenant aan, en Kees van AlingAdvies vult hem daarna zelf.*

| | |
|---|---|
| **Actor** | platformbeheerder |
| **Voorwaarde** | staat in `clm.platform_admin` |
| **Stappen** | 1. vult naam + naam/e-mail van de eerste admin in<br>2. systeem maakt tenant, gebruiker (nog zonder `oid`) en membership `admin`<br>3. systeem legt vast in de audit trail |
| **Resultaat** | de tenant bestaat, met één wachtende admin |
| **Mag niet** | een gewone tenant-admin kan dit niet; een dubbele naam wordt geweigerd, ook als alleen hoofdletters verschillen |

### UC-B — De eerste admin logt voor het eerst in

> *Kees klikt op inloggen, doorloopt Entra met MFA, en komt in de omgeving van
> AlingAdvies terecht.*

| | |
|---|---|
| **Actor** | de eerste admin van een nieuwe tenant |
| **Voorwaarde** | er staat een gebruikersrij met zijn e-mailadres en `external_subject IS NULL` |
| **Stappen** | 1. login via Entra (federatie + MFA)<br>2. systeem herkent een onbekende `oid`<br>3. systeem koppelt die aan de wachtende rij, op e-mailadres<br>4. sessie, en vanaf nu werkt inloggen normaal |
| **Resultaat** | Kees is admin van AlingAdvies |
| **Mag niet** | koppelen aan een rij die al een `oid` heeft; koppelen bij twee kandidaten; koppelen op een onbevestigd e-mailadres |

**Dit is het openstaande gat.** Vandaag breekt de keten hier — zie §5.2.

### UC-C — De helpdesk kijkt mee

> *Een klant meldt dat ronde 3 niet opent. De beheerder moet in die omgeving
> kunnen kijken, zonder alziende toegang tot alle klanten.*

| | |
|---|---|
| **Actor** | platformbeheerder |
| **Stappen** | 1. kent zichzelf `support` toe op één tenant, met reden en einddatum (8 uur)<br>2. ziet die tenant zoals een gebruiker hem ziet<br>3. de toegang vervalt vanzelf |
| **Resultaat** | het probleem is te onderzoeken; de klant ziet in zijn ledenlijst wie er was |
| **Mag niet** | schrijven; andere tenants zien; onbeperkt geldig blijven; als de klant zelf in de audit trail verschijnen |

### UC-D — Dagelijks werk in een tenant *(bestaat, mag niet breken)*

Een `admin` beheert leveranciers en zet vragenlijsten uit; een `reviewer` vult
beoordelingen in. Beiden zien uitsluitend hun eigen tenant, afgedwongen door RLS.

### UC-E — Een leverancier vult een vragenlijst in *(bestaat, mag niet breken)*

Zonder account, via een tijdgebonden tokenlink. Spoor 2 — raakt dit ontwerp
niet, maar deelt wel de database en de RLS-policies.

### Wat expliciet géén use case is

| | Waarom niet |
|---|---|
| Een klant meldt zich zelf aan | Er is geen selfservice-onboarding; dat vraagt facturatie en verificatie |
| De klant nodigt zijn eigen collega's uit | Wenselijk, maar later — nu is er één admin per tenant |
| De platformbeheerder leest alle klantdata | Bewust verworpen, zie ADR-015 |
| Een gebruiker werkt in twee tenants | Geblokkeerd door een unieke index, met opzet — behalve `support` |

---

## 3. Het principe

> **Elk recht is expliciet, staat in de migratie die de tabel aanmaakt, en
> wordt door een test bewaakt.**

Geen enkel recht mag afhangen van `ALTER DEFAULT PRIVILEGES`. Die instelling is
omgevingsafhankelijk — precies wat "transporteerbaar" uitsluit. Wat op een
wegwerpdatabase werkt moet op Supabase werken en op elke volgende provider.

Drie regels die daaruit volgen:

1. **Een tabel zonder expliciete `GRANT` is een fout**, geen "krijgt het wel
   via de default".
2. **Een rechtenkeuze staat in de migratie, met de reden erbij** — zoals 0010
   dat al voorbeeldig doet voor `sessie`.
3. **Een test leest de rechten terug uit de database** en vergelijkt ze met wat
   het ontwerp voorschrijft. Niet met wat er toevallig staat.

---

## 4. Het rollenmodel

Vier lagen, van buiten naar binnen. Elke laag beantwoordt één vraag.

```
  Wie ben je?          →  Entra (oid)          →  clm.user.external_subject
  Waar mag je werken?  →  clm.tenant_membership →  tenantcontext (RLS)
  Wat mag je daar?     →  role: admin/reviewer  →  RolGuard
  Mag je platformwerk? →  clm.platform_admin    →  PlatformAdminGuard
```

### De vier rollen

| Rol | Waar vastgelegd | Bereik | Wat |
|---|---|---|---|
| `admin` | `tenant_membership.role` | één tenant | beheert leveranciers, vragenlijsten, rondes |
| `reviewer` | `tenant_membership.role` | één tenant | vult beoordelingen in, leest resultaten |
| `support` | `tenant_membership.role` | één tenant, tijdelijk | leest mee vanuit het platform |
| platformbeheerder | `clm.platform_admin` | het platform | maakt tenants, kent zichzelf `support` toe |

### Waarom platformbeheer geen tenantrol is

Een platformbeheerder doet iets dat *buiten* elke tenant staat: een tenant
áánmaken. Dat past per definitie niet in een tabel die zegt "waar mag deze
persoon werken". Vandaar een aparte tabel zonder `tenant_id`.

En waarom meekijken dán wél een tenantrol is: omdat het binnen één tenant
gebeurt, en omdat de klant moet kunnen zien wie er in zijn omgeving keek. Een
`support`-rij staat in zijn ledenlijst. Een alziende platformrol zou daar
onzichtbaar blijven — dat was het besluit van 2026-08-08 (ADR-015).

**De platformbeheerder is nooit tegelijk `admin` van een klant-tenant.** Zijn
eigen membership zit in de tenant `Platformbeheer`; in een klantomgeving komt hij
alleen als `support`, tijdelijk, met een reden. Dat onderscheid is wat hem in de
audit trail herkenbaar houdt.

---

## 5. De drie stromen, van begin tot eind

### 5.1 Een tenant aanmaken

```
Platformbeheerder                Applicatie                    Database
      │                              │                            │
      │  POST /platform/tenants      │                            │
      │  { naam, adminNaam,          │                            │
      │    adminEmail }              │                            │
      │─────────────────────────────>│                            │
      │                              │  TenantContextGuard        │
      │                              │   → wie ben je?            │
      │                              │  PlatformAdminGuard        │
      │                              │   → sta je in              │
      │                              │     platform_admin?        │
      │                              │───────────────────────────>│
      │                              │                            │
      │                              │  withTenant(nieuwe id):    │
      │                              │   INSERT tenant            │
      │                              │   INSERT user (zonder oid) │
      │                              │   INSERT membership admin  │
      │                              │   INSERT audit_event       │
      │                              │───────────────────────────>│
      │  201 + tenantId              │                            │
      │<─────────────────────────────│                            │
```

**Waarom de gebruiker zonder `external_subject` wordt aangemaakt:** die waarde
komt uit Entra en bestaat pas na de eerste login. De partiële unieke index uit
0009 (`WHERE external_subject IS NOT NULL`) staat meerdere lege waarden toe —
precies met deze situatie in gedachten.

**Waarom de tenant hier uit de invoer komt:** dit is de enige plek in de
applicatie waar dat mag. Overal elders komt de tenant uit de sessie (§6). De
uitzondering kan alleen bestaan omdat `PlatformAdminGuard` ervoor staat, en is
daarom zwaarder getest dan de regel.

### 5.2 Inloggen — en de koppeling van de eerste admin

```
Kees            Entra              Applicatie                Database
  │               │                     │                        │
  │ /auth/login   │                     │                        │
  │──────────────────────────────────-->│                        │
  │<── redirect naar Entra ─────────────│                        │
  │──────────────>│                     │                        │
  │  federatie +  │                     │                        │
  │  MFA          │                     │                        │
  │<──────────────│                     │                        │
  │  ?code=...    │                     │                        │
  │────────────────────────────────────>│                        │
  │               │  code inwisselen    │                        │
  │               │<────────────────────│                        │
  │               │  id_token (oid)     │                        │
  │               │────────────────────>│                        │
  │                                     │ gebruiker_bij_subject  │
  │                                     │  (SECURITY DEFINER —   │
  │                                     │   nog geen tenant!)    │
  │                                     │───────────────────────>│
  │                                     │ sessie_aanmaken        │
  │                                     │───────────────────────>│
  │<── cookie met betekenisloze sleutel ─│                        │
```

**Het kip-ei dat 0009/0010 al oplossen:** de guard moet de gebruiker opzoeken
vóórdat de tenant bekend is — de tenant vólgt immers uit zijn membership. Maar
`clm.user` staat onder RLS. Vandaar `gebruiker_bij_subject()` als
`SECURITY DEFINER`. Dat is bestaand, goed ontwerp.

**Wat nog niet bestaat: de koppeling bij de eerste login.** Een gebruiker die is
aangemaakt zonder `oid` kan vandaag níét inloggen — `gebruiker_bij_subject`
zoekt op `external_subject`, en die is `NULL`. De keten breekt hier.

Dat is het echte gat, en het is geen implementatiedetail maar een ontwerpkeuze:

**Voorstel — koppelen op e-mailadres, één keer, onder strikte voorwaarden.**
Bij een login met een `oid` die nog niet bekend is, zoekt de applicatie een
gebruiker met dat e-mailadres én `external_subject IS NULL`. Is er **precies
één**, dan wordt de `oid` gekoppeld en de gebeurtenis vastgelegd.

Voorwaarden, alle vier nodig:

1. Precies één match — bij meer: weigeren, niet gokken.
2. `external_subject` moet `NULL` zijn — nooit een bestaande koppeling
   overschrijven.
3. Het e-mailadres moet uit een geverifieerde claim komen (`email_verified`),
   anders kan wie een adres kent zich aan een wachtende rij hechten.
4. De koppeling gaat in `audit.audit_event`.

*Alternatief dat ik heb overwogen en afraad:* een uitnodigingslink met token.
Veiliger op papier, maar het voegt een mailketen en een tokenlevenscyclus toe
vóórdat er één klant is. Terug te bouwen zodra dat nodig is; de koppeling op
e-mail blijft dan bestaan als tweede weg.

### 5.3 Tenants en gebruikers inzien

| Wie | Ziet | Via |
|---|---|---|
| `admin` / `reviewer` | eigen tenant | RLS op de tenantcontext |
| `support` | de tenant waar hij te gast is, zolang de toegang geldt | RLS, plus filter op `verloopt_op` |
| platformbeheerder | **de lijst van tenants**, niet hun inhoud | aparte route, zie hieronder |

Het inzien van álle tenants is het enige dat structureel buiten RLS valt: een
lijst van alle tenants is per definitie tenant-overstijgend.

**Voorstel:** één `SECURITY DEFINER`-functie, `clm.platform_tenants()`, die
uitsluitend teruggeeft: `tenant_id`, `naam`, `aangemaakt_op`, `aantal_leden`.
Geen klantdata. Uitvoerrecht alleen voor de applicatierol, en de functie
controleert zélf of de aanroeper in `platform_admin` staat.

Dat is dezelfde vorm die `sessie_oplossen` en `gebruiker_bij_subject` al
gebruiken — geen nieuw patroon, maar het bestaande toegepast op een nieuw
probleem. En het is het alternatief voor wat ik vandaag deed: een lus die per
tenant een aparte query doet, wat geen overzicht oplevert.

---

## 6. Wat er moet gebeuren

In deze volgorde, elk met een eigen migratie en tegenproef.

### Stap 1 — Migratie 0022: het rechtengat dichten

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON clm.tenant_membership TO clm_api, clm_admin;
GRANT SELECT ON clm.tenant_membership TO clm_readonly;
```

En `FORCE ROW LEVEL SECURITY` op de vijf tabellen die het missen, zodat de
RLS-stand gelijk is over de hele database.

**`clm.sessie` blijft ongemoeid** — die is bewust dichtgezet (0010).

### Stap 2 — Een contract voor de databaserechten

De belangrijkste stap van dit document: hij verandert een klasse fouten van
"ontdekt bij gebruik in productie" naar "ontdekt bij commit".

Eén bestand in de testcode legt vast wat de stand *hoort* te zijn; één test
leest terug wat er werkelijk staat. Drie dingen, niet één — de review wees erop
dat rechten op tabellen maar de helft van het verhaal zijn:

| Wat | Waarom |
|---|---|
| **Tabelrechten** per rol | het gat van vandaag: `tenant_membership` had er geen |
| **`search_path`** op elke `SECURITY DEFINER`-functie | vandaag goed, maar niets bewaakt dat de zesde functie het ook krijgt |
| **`EXECUTE`-rechten** op die functies | `PUBLIC` moet eraf; nu staat dat alleen in tekst |

Een nieuwe tabel of functie zonder regel in dat bestand hoort de test rood te
maken. Anders groeit het contract niet mee.

### Stap 3 — De koppeling bij eerste login

Volgens §5.2, met **vijf** voorwaarden (de vijfde kwam uit de review):

1. precies één wachtende rij met dat e-mailadres
2. `external_subject` is nog `NULL`
3. het e-mailadres komt uit een geverifieerde claim
4. de koppeling gaat in `audit.audit_event`
5. **de wachtende rij is niet verlopen** — zie hieronder

Tegenproeven: twee wachtende rijen met hetzelfde adres → weigeren; een
bestaande koppeling → nooit overschrijven; een onbevestigd e-mailadres →
weigeren; een verlopen rij → weigeren.

**Vervaltermijn op de wachtende rij.** Een gebruiker zonder `oid` is nu
onbeperkt koppelbaar; dat venster hoort te sluiten. Voorstel: een kolom
`koppelbaar_tot` op `clm."user"`, standaard 90 dagen. Verloopt hij, dan moet de
platformbeheerder de uitnodiging opnieuw zetten — een handeling die zichtbaar
is, in plaats van een deur die open blijft staan.

Dit is goedkoper dan een uitnodigingstoken en dekt hetzelfde risico: het
faalpatroon dat we willen vermijden is een account-overname door wie een
e-mailadres kent en eerder inlogt dan de bedoelde persoon.

### Stap 4 — Het verval van support-toegang, per verzoek

De review stelde een vraag die ik niet had beantwoord: wordt `verloopt_op` bij
**elk** verzoek getoetst, of alleen bij het aanmaken van de sessie?

Het antwoord moet "elk verzoek" zijn. Anders overleeft een lopende sessie het
verval van de toegang, en is "acht uur" een belofte die de eerste keer al niet
klopt.

Concreet: `TenantContextGuard` leest de sessie via `sessie_oplossen()`, en die
functie moet een membership met een verstreken `verloopt_op` behandelen alsof
het er niet is. Dat hoort in de functie thuis en niet in de applicatielaag —
daar is het één vergeten filter van een lek verwijderd.

Plus: de duur wordt een **instelbare** waarde, geen constante in een migratie.
Bijstellen mag geen migratie kosten.

### Stap 5 — `clm.platform_tenants()` voor het overzicht

Met in de tegenproef: `search_path` gepind, `EXECUTE` ingetrokken van `PUBLIC`,
en de controle dat de aanroeper in `platform_admin` staat.

En dan pas het scherm.

---

## 7. Wat dit ontwerp bewust niet doet

- **Geen tenantbeheer door de klant zelf.** Zelfregistratie, facturatie en
  abonnementen staan hier niet in.
- **Geen impersonatie.** Meekijken gebeurt als `support`, herkenbaar in de
  audit trail. Zie ADR-015.
- **Geen uitnodigingsmails.** De eerste admin wordt door de platformbeheerder
  ingevuld; de koppeling gebeurt bij zijn eerste login.
- **Geen transparantiescherm voor de klant.** Uitgesteld tot er een tenant is
  die niet van onszelf is — maar het auditspoor wordt nu al geschreven, want
  dat is achteraf niet te herstellen.

Toegevoegd na de review:

- **Geen offboarding.** Er is geen beschreven pad voor het intrekken van een
  `tenant_membership` of het loskoppelen van een `external_subject` als iemand
  de klantorganisatie verlaat. De tabellen kunnen het (`deleted_at` staat er
  overal), maar er is geen route en geen scherm.

  **Dit is de zwakste uitstelbeslissing in dit document.** Bij één tenant van
  onszelf is het onschuldig; zodra er een echte klant is, is "wie mocht hier
  ooit werken en mag dat nog" een vraag die een auditor stelt. Het hoort in de
  eerste ronde ná dit ontwerp, niet veel later.

- **Geen escalatiepad vanuit `support`.** Een supportmedewerker die het
  probleem ziet maar niet mag oplossen, heeft vandaag geen volgende stap
  binnen de app — geen notitie voor de tenant-admin, geen verzoek om
  schrijfrecht. Dat is aanvaardbaar zolang de eigenaar zelf de helpdesk is;
  bij de eerste echte helpdeskcase is het het eerste wat opvalt.

- **Geen tweede platformbeheerder via de app.** `clm.platform_admin` is
  `SELECT`-only voor de applicatierol, dus iemand toevoegen kan alleen via
  `npm run platform:inrichten` of rechtstreeks op de database. Voor één
  eigenaar geen probleem, maar het is een schaalgrens en geen ontwerpprincipe.

---

## 8. Waarom dit transporteerbaar is

Alles wat de applicatie nodig heeft, staat in de migratieketen: tabellen,
policies, functies én rechten. Een verse database op elke PostgreSQL 17 krijgt
daarmee dezelfde stand als productie.

Wat er vandaag misging kwam doordat één schakel — de rechten — buiten die keten
viel en van een omgevingsinstelling afhing. Stap 1 en 2 halen die schakel binnen.

**Toets:** een wegwerpdatabase na `migrate:deploy` moet dezelfde rechten- en
RLS-stand hebben als productie. Zodra de rechtencontrole uit stap 2 bestaat, is
dat een test in plaats van een aanname.

---

## 9. Vragen aan de reviewer

> **Ronde 1 is beantwoord** (review van 2026-08-08, met de reactie in
> `reactie-op-review.md`). Zes van de zeven punten zijn verwerkt in §2c, §6 en
> §7. De vragen hieronder staan er nog omdat ze niet uitputtend beantwoord zijn
> — waar een antwoord al ligt, staat dat erbij.

Op volgorde van belang. Bij elke vraag staat waarom het antwoord uitmaakt.

### 9.1 De koppeling bij de eerste login (§5.2) — de zwaarste

Een gebruiker wordt aangemaakt zonder `oid`; die komt pas bij zijn eerste login.
Het voorstel is koppelen op **e-mailadres**, één keer, onder vier voorwaarden:
precies één match, `external_subject` nog leeg, geverifieerd e-mailadres, en
vastgelegd in de audit trail.

- Is dat verantwoord, of moet het een uitnodigingslink met token worden?
- Zijn de vier voorwaarden volledig, of ontbreekt er een?
- **Specifiek:** is `email_verified` van de identity provider een voldoende
  waarborg? Bij federatie komt die claim van de organisatie van de gebruiker,
  niet van onze eigen tenant.

> **Ronde 1:** verantwoord bevonden, mits er een vervaltermijn op de wachtende
> rij komt — die is nu de vijfde voorwaarde (stap 3). Het risico dat overblijft
> heet de *Non-Verifying IdP Attack*: het vertrouwen verschuift naar de
> identity provider van de klant. Voor B2B-federatie klein, niet nul.
>
> **Open:** is die restrisico-afweging houdbaar zodra er klanten zijn met een
> eigen IdP die wij niet kennen?

### 9.2 Is het rechtenprincipe (§3) het juiste antwoord?

Voorstel: elk recht expliciet in de migratie, nooit leunen op
`ALTER DEFAULT PRIVILEGES`, en een test die de rechten terugleest.

- Lost dit de klasse fouten op, of dekt het alleen het symptoom van vandaag?
- Zijn er meer omgevingsafhankelijke aannames van deze soort die we missen?

### 9.3 Klopt het rollenmodel (§4)?

Vier rollen: `admin`, `reviewer`, `support` binnen een tenant, plus
platformbeheerder daarboven.

- Is `support` als leesrol voldoende voor echt supportwerk, of loopt een
  helpdesk vast omdat hij niets kan wijzigen?
- Is acht uur een verstandige standaardduur?
- Moet de platformbeheerder tegelijk `admin` van een klant-tenant kunnen zijn?
  Nu bewust niet.

### 9.4 `SECURITY DEFINER` voor het tenantoverzicht (§5.3)

Een lijst van alle tenants valt per definitie buiten RLS. Voorstel: één
`SECURITY DEFINER`-functie die alleen naam, datum en ledenaantal teruggeeft, en
die zélf controleert of de aanroeper platformbeheerder is.

- Is dat de juiste vorm, of is een aparte leesrol met beperkte rechten beter?
- `SECURITY DEFINER` is een krachtig middel; wordt het hier te makkelijk
  ingezet?

### 9.5 Wat ontbreekt er in dit ontwerp?

De vraag die de vorige vier overkoepelt. Wat zou een reviewer verwachten in een
ontwerp over tenants, gebruikers en beheerdersrechten dat hier niet staat?

Bekende openstaande punten, zodat je die niet hoeft te melden:

- De applicatie draait nergens in productie (alleen de database).
- Geen transparantiescherm voor de klant; wel het auditspoor.
- Geen uitnodigingsmails, geen zelfregistratie, geen facturatie.
- De verwerkersovereenkomst moet support-toegang nog benoemen.
- Logs staan in dezelfde database als de data (geen WORM/SIEM).

---

## 10. Beoordelingskader

Waaraan dit ontwerp getoetst mag worden, in de volgorde die het project
hanteert:

1. **Security en tenant-isolatie** — kan een tenant ooit data van een andere
   zien? Kan de applicatierol meer dan hij nodig heeft?
2. **Onderhoudbaarheid en herstelbaarheid** — is dit over een jaar nog te
   begrijpen zonder de auteur?
3. **Transporteerbaarheid** — werkt dit op elke PostgreSQL 17, of hangt het aan
   Supabase?
4. **Aantoonbaarheid** — is elke aanname een test, of blijft er iets over dat
   "waarschijnlijk goed zit"?

Punt 4 is waar dit document vandaan komt. Drie dingen die vandaag misgingen,
gingen mis omdat ze werden aangenomen in plaats van gemeten.
