# Ontwerp — tokengebaseerde leverancierstoegang (Issue #7, spoor 2)

**Datum:** 2026-07-28
**Status:** ontwerp ter beoordeling — geen code, geen migratie, geen besluit tot dit is goedgekeurd
**Issue:** #7 (P0, spoor "externe leverancier"), met directe raakvlakken aan #8, #9, #10
**Acceptatiecriteria uit scope:** AC11, AC12, AC13 (`docs/architecture-review/2026-07-24/08-transdev-mvp-scope.md`)

---

## 1. Wat dit ontwerp oplost

Een externe leverancier moet een survey kunnen invullen zonder account. De enige toegangssleutel
is een link in een e-mail. Dat betekent dat die link zelf het volledige vertrouwensmodel draagt —
er is geen wachtwoord, geen MFA en geen tweede factor achter.

Concreet moet dit ontwerp vier dingen waarmaken:

| # | Eis | Bron |
|---|---|---|
| 1 | De link is niet te raden | AC (securitygrens 1) |
| 2 | De link vervalt na 30 dagen, serverzijdig | AC11, OV-2 |
| 3 | Na één succesvolle indiening werkt de link niet meer | AC12, OV-3 |
| 4 | Het token geeft toegang tot precies één response, niets anders | AC5/AC9, securitygrens 2 |

Dit ontwerp gaat **niet** over de interne beheerder (spoor 1, Entra External ID) en **niet** over
de certificaat-upload (#9) — zie §9.

---

## 2. Het scharnierpunt: RLS werkt op een sessievariabele

De bestaande tenant-isolatie leunt volledig op één PostgreSQL-functie uit de init-migratie:

```sql
CREATE OR REPLACE FUNCTION clm.current_tenant_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID
$$;
```

Elke policy vergelijkt `tenant_id` met de uitkomst daarvan. De applicatie zet die variabele met
`SET LOCAL` als eerste statement in een transactie.

Voor een ingelogde beheerder is de herkomst van die waarde straks het geverifieerde ID-token.
Voor een leverancier is er geen identiteit — dus moet de tenant **uit het token zelf** komen,
en wel zó dat de leverancier hem niet kan beïnvloeden.

Dat leidt tot de kernregel van dit ontwerp:

> De tenant-context voor een leverancier wordt uitsluitend afgeleid uit een databaselookup op het
> gehashte token. Nooit uit de URL, een header, of enig ander veld dat de client stuurt.

De leverancier stuurt één ding: het ruwe token. De server zoekt dat op, vindt de bijbehorende
`tenant_id` en `response_id`, en zet dáármee de sessievariabele. De leverancier heeft geen enkele
manier om een andere tenant te benoemen — er is geen veld waarin dat zou kunnen.

Dit is exact het patroon dat de geparkeerde branch `feat/fase0-skeleton-vendors` fout deed
(tenant uit `X-Tenant-Id`-header) en dat MCM2-CLAUDE.md §6 verbiedt.

### Kip-en-ei: de lookup zelf valt buiten RLS

De tokenlookup moet gebeuren vóórdat de tenant bekend is. Maar RLS blokkeert elke query zonder
tenant-context. Twee opties:

**Optie A (voorkeur): `SECURITY DEFINER`-functie met minimale returnwaarde.**

```sql
CREATE FUNCTION clm.resolve_survey_token(p_token_hash BYTEA)
RETURNS TABLE (response_id UUID, tenant_id UUID, status TEXT, expires_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
    SELECT response_id, tenant_id, status, expires_at
    FROM clm.survey_response
    WHERE token_hash = p_token_hash
$$;
```

De functie draait met de rechten van de eigenaar (`clm_migrator`) en omzeilt dus RLS — maar
retourneert *alleen* de velden die nodig zijn om de context te zetten en de geldigheid te bepalen.
Geen antwoorden, geen vendorgegevens, geen e-mailadressen. Het aanvalsoppervlak is één rij met een
handvol kolommen, alleen bereikbaar met een correcte tokenhash.

> **Let op:** dit is de vereenvoudigde vorm. §5a breidt de functie uit met twee velden
> (`vendor_active`, `run_closes_at`), omdat een token ook kan doodlopen op gegevens die in de
> 30 dagen zijn gewijzigd. Die uitgebreide versie is de definitieve.

`SET search_path` is hier geen detail maar een vereiste: zonder dat is een `SECURITY DEFINER`-
functie kwetsbaar voor search-path-manipulatie. Dit is gedocumenteerd PostgreSQL-gedrag, zie
`postgresql.org/docs/current/sql-createfunction.html`.

**Optie B (verworpen): een aparte databaserol zonder RLS op alleen deze tabel.**
Verworpen omdat het een tweede runtime-rol introduceert met een permanente uitzondering, terwijl
optie A de uitzondering beperkt tot één functie met een vaste, minimale returnwaarde.

---

## 3. Het token zelf

### Generatie

```
32 willekeurige bytes uit crypto.randomBytes(32)  →  base64url  →  43 tekens
```

32 bytes is 256 bits entropie. Raden is uitgesloten — niet "moeilijk", maar rekenkundig
onhaalbaar. `crypto.randomBytes` is de cryptografisch veilige generator van Node; `Math.random`
is dat uitdrukkelijk niet en mag hier nooit gebruikt worden.

`base64url` (niet gewoon base64) omdat het token in een URL komt: geen `+`, `/` of `=` die
ge-escaped moeten worden.

### Opslag: gehasht, nooit in platte tekst

Het ruwe token bestaat op precies twee plekken: in de verzonden e-mail, en kortstondig in het
geheugen van de server tijdens een request. In de database staat alleen een hash.

```
token_hash = sha256(ruwe_token)        →  BYTEA, 32 bytes
```

**Waarom SHA-256 en niet bcrypt/argon2** — bij wachtwoorden gebruik je een bewust traag algoritme
omdat mensen korte, raadbare wachtwoorden kiezen. Hier is de invoer 256 bits willekeur: een
brute-force is al onhaalbaar, dus de traagheid voegt niets toe en kost bij elke request tijd.
Dit is de standaardafweging voor high-entropy tokens.

**Waarom hashen dan wel** — het scheidt databasetoegang van surveytoegang. Wie een databasedump
in handen krijgt (backup, lek, gestolen inloggegevens) kan daarmee geen enkele openstaande survey
openen. Zonder hashing is één dump gelijk aan toegang tot alle lopende responses.

Gevolg voor de implementatie: een verloren token is **niet** herstelbaar. Er is geen "toon mij de
link opnieuw" — er is alleen "genereer een nieuwe". Dat is een bewuste consequentie, geen gebrek.

### Vorm van de link

```
https://<host>/survey/respond?t=<43 tekens>
```

Het token in de query-parameter, niet in het pad. Reden: een pad-segment belandt vaker in
server-logs en analytics; een query-parameter is makkelijker centraal te maskeren. Beide zijn
gevoelig — zie §7 voor de logging-eis die hierbij hoort.

---

## 4. Schema

Drie nieuwe tabellen in `clm`. Alle drie tenantgebonden, alle drie met RLS en `USING` + `WITH CHECK`
conform MCM2-CLAUDE.md §7.

### `clm.survey_template` en `clm.survey_run`

Minimaal gehouden — dit ontwerp gaat over toegang, niet over de vragenlijst. De vraagstructuur
zelf (vraagtype A/B) hangt aan OV-6 en OV-8, die nog openstaan.

```
survey_template   template_id, tenant_id, name, version, created_at
survey_run        run_id, tenant_id, template_id, started_at, closes_at
```

`version` op de template omdat de scope versionering eist (journey B). Een lopende run verwijst
naar een specifieke versie, zodat een latere templatewijziging bestaande responses niet verandert.

### `clm.survey_response` — de kern

```
response_id     UUID PK
tenant_id       UUID NOT NULL          → RLS-kolom
run_id          UUID NOT NULL          → welke ronde
vendor_id       UUID NOT NULL          → welke leverancier
token_hash      BYTEA NOT NULL UNIQUE  → sha256 van het ruwe token
status          TEXT NOT NULL          → 'pending' | 'submitted' | 'revoked'
expires_at      TIMESTAMPTZ NOT NULL   → aanmaakmoment + 30 dagen
submitted_at    TIMESTAMPTZ NULL       → gezet bij indienen, daarna onveranderlijk
created_at      TIMESTAMPTZ NOT NULL
```

Ontwerpkeuzes die de acceptatiecriteria afdwingen op databaseniveau, niet alleen in code:

| Keuze | Dwingt af |
|---|---|
| `UNIQUE (token_hash)` | Geen twee responses delen een token |
| `UNIQUE (run_id, vendor_id)` | Eén leverancier krijgt één link per ronde |
| `CHECK (status IN ('pending','submitted','revoked'))` | Geen ongeldige status door een bug |
| `CHECK (status <> 'submitted' OR submitted_at IS NOT NULL)` | Ingediend zonder tijdstip is onmogelijk |
| `expires_at NOT NULL` | Een token zonder vervaldatum kan niet bestaan |
| `vendor_id → clm.vendor ON DELETE RESTRICT` | Een leverancier met responses is niet hard te verwijderen (zie §5a) |
| `run_id → clm.survey_run ON DELETE RESTRICT` | Een ronde met responses is niet hard te verwijderen |

Die eerste vijf zijn bewust: AC11 en AC12 zijn dan niet afhankelijk van de correctheid van
applicatiecode. Een fout in de guard leidt tot een databasefout, niet tot een lek.

De twee `RESTRICT`-regels wijken bewust af van het bestaande `vendor_contact`/`vendor_tag`-patroon,
dat `ON DELETE CASCADE` gebruikt. Een contactpersoon mag met de leverancier meeverdwijnen; een
ingediende survey-response is bewijsmateriaal en mag dat nooit. Zie §5a.

### `revoked` als status

De scope noemt intrekbaarheid (§3 van de opdracht: "unieke, intrekbare en verlopen response-links").
`revoked` maakt het mogelijk een link ongeldig te maken zonder de rij te verwijderen — de audit
trail blijft dan intact, wat AC8 vereist.

---

## 5. De guard: wat er bij elk verzoek gebeurt

```
1. Token uit de query lezen
2. Vorm valideren (43 tekens base64url) — afwijkend? direct weigeren, geen databasequery
3. sha256 berekenen
4. clm.resolve_survey_token(hash) aanroepen
5. Geen rij?              → 404
6. status = 'revoked'     → 404
7. status = 'submitted'   → 410 Gone          (AC12)
8. expires_at < now()     → 410 Gone          (AC11)
9. Transactie openen, SET LOCAL app.current_tenant_id = <tenant uit stap 4>
10. Verzoek afhandelen binnen die transactie
```

**Stap 2 vóór stap 4** — een verzoek met onzin in de parameter raakt de database niet. Dat beperkt
de belasting bij een geautomatiseerde poging en houdt de logs schoon.

**404 voor onbekend én ingetrokken.** Een ingetrokken token mag niet te onderscheiden zijn van een
niet-bestaand token, anders wordt de foutmelding zelf informatie. Verlopen en ingediend krijgen wel
410, omdat de leverancier daar een legitiem belang bij heeft: die moet weten dat de link ooit geldig
was en waarom hij dat niet meer is. Dat is een bewuste afweging tussen bruikbaarheid en
informatielekkage — voor een link die de gebruiker zelf per e-mail ontving is de tweede zorg klein.

**Stap 9 is niet-onderhandelbaar.** De tenant komt uit stap 4, dus uit de database, dus uit het
token. Er is geen codepad waarin een clientwaarde hier terechtkomt.

### Het indienen: éénmaligheid afdwingen

De volgorde is niet vrijblijvend. Dit is fout:

```
lees status → is 'pending'? → sla antwoorden op → zet op 'submitted'
```

Tussen lezen en schrijven kan een tweede verzoek binnenkomen (een dubbelklik volstaat). Beide zien
`pending`, beide dienen in. Correct is één atomair statement dat de status als voorwaarde meeneemt:

```sql
UPDATE clm.survey_response
   SET status = 'submitted', submitted_at = now()
 WHERE response_id = $1
   AND status = 'pending'
   AND expires_at > now()
RETURNING response_id;
```

Geen rij terug betekent: iemand was eerder, of hij is verlopen. Dan volgt 410 en worden de
antwoorden niet opgeslagen. De database beslist, niet de applicatielogica.

---

## 5a. Waar het token kan doodlopen — levensduur van de omliggende gegevens

Een token is 30 dagen geldig. In die periode blijft het systeem gewoon in gebruik: de beheerder
wijzigt leveranciers, sluit rondes, ruimt op. De vorige paragrafen controleerden alleen het token
zelf (verlopen, ingediend, ingetrokken) en namen stilzwijgend aan dat de gegevens waar het naar
verwijst intact blijven. Die aanname klopt niet.

Een token kan volledig geldig zijn en toch nergens meer op slaan. Dat is gevaarlijker dan een
token dat weigert, omdat de fout stil is.

### Wat verandert, en wat dat doet

| Gebeurtenis in de 30 dagen | Effect op het token | Ontwerpbesluit |
|---|---|---|
| **Naam van de vendor wijzigt** | Geen. Het token verwijst naar `vendor_id` (een UUID die nooit verandert), niet naar de naam. De rij blijft dezelfde rij. | Geen maatregel nodig — dit is precies waarom naar een ID verwezen wordt en niet naar een naam. |
| **Vendor zacht verwijderd** (`deleted_at` gevuld) | **Stil falen.** De RLS-policy op `clm.vendor` filtert op `deleted_at IS NULL`, dus de leverancier is onzichtbaar — óók voor het token. De response bestaat nog, de vendor niet meer. | Guard-stap 8b: expliciet controleren, 410 met duidelijke melding. Zie hieronder. |
| **Vendor hard verwijderd** (`DELETE`) | **Dataverlies.** Bestaande FK's op `vendor_contact`/`vendor_tag` gebruiken `ON DELETE CASCADE`; zonder expliciete keuze zou `survey_response` meegaan — inclusief reeds ingediende antwoorden. | `ON DELETE RESTRICT` op `survey_response.vendor_id`. Een leverancier met responses is niet hard verwijderbaar; zacht verwijderen blijft mogelijk. |
| **Survey-ronde gesloten** (`closes_at` verstreken) | **Inconsistentie.** Het ontwerp gaf `survey_run` een `closes_at`, maar de guard controleerde die niet. De beheerder sluit de ronde, de tokens werken door. | Guard-stap 8c: `closes_at` meewegen. De striktste van `expires_at` en `closes_at` wint. |
| **Contactpersoon verwijderd of e-mailadres gewijzigd** | Geen technisch effect — de link is al verstuurd en werkt. Wel operationeel: de link ligt in een mailbox die niemand meer leest. | Geen technische maatregel. Wel een zichtbaarheidseis: zie "openstaande links" hieronder. |
| **Template gewijzigd of nieuwe versie** | Geen, mits de run naar een vaste templateversie verwijst (§4). | Al afgedekt door `version` op de template. |
| **Tenant verwijderd** | Niet mogelijk: `vendor_tenant_id_fkey` is al `ON DELETE RESTRICT`. | Bestaand gedrag, geen wijziging. |

### Uitbreiding van de guard

De volgorde uit §5 krijgt drie extra controles, ná stap 8 (`expires_at`) en vóór stap 9
(tenant-context zetten):

```
8b. Bestaat de vendor nog en is deleted_at leeg?   → nee: 410 Gone
8c. Is closes_at van de run verstreken?            → ja:  410 Gone
8d. Is de run zelf niet ingetrokken/geannuleerd?   → ja:  410 Gone
```

Deze controles horen in `clm.resolve_survey_token` zelf, niet in losse queries erna. Reden: de
functie draait `SECURITY DEFINER` en kan daarmee langs de `deleted_at`-filter van de RLS-policy
kijken — dat is precies wat nodig is om het verschil te zien tussen "bestaat niet" en "is zacht
verwijderd". Een gewone query ná het zetten van de tenant-context ziet die rij niet en kan de twee
niet onderscheiden.

De functie uit §2 wordt daarmee:

```sql
CREATE FUNCTION clm.resolve_survey_token(p_token_hash BYTEA)
RETURNS TABLE (
    response_id   UUID,
    tenant_id     UUID,
    status        TEXT,
    expires_at    TIMESTAMPTZ,
    vendor_active BOOLEAN,     -- vendor bestaat én deleted_at IS NULL
    run_closes_at TIMESTAMPTZ  -- NULL = geen sluitdatum
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
    SELECT r.response_id,
           r.tenant_id,
           r.status,
           r.expires_at,
           (v.vendor_id IS NOT NULL AND v.deleted_at IS NULL) AS vendor_active,
           run.closes_at
      FROM clm.survey_response r
      LEFT JOIN clm.vendor     v   ON v.vendor_id = r.vendor_id
      LEFT JOIN clm.survey_run run ON run.run_id  = r.run_id
     WHERE r.token_hash = p_token_hash
$$;
```

De returnwaarde groeit van vier naar zes velden, alle zes booleans of tijdstippen. Er lekt nog
steeds geen inhoudelijke gegevens: geen namen, geen e-mailadressen, geen antwoorden. Het
aanvalsoppervlak blijft "één rij, alleen bereikbaar met een correcte tokenhash".

`LEFT JOIN` en niet `JOIN`: bij een `JOIN` zou een verdwenen vendor de hele rij laten verdwijnen,
en dan is het onderscheid tussen "token bestaat niet" en "vendor weg" weer weg — precies het stille
falen dat deze paragraaf wil uitsluiten.

### Foutmeldingen: onderscheid maken waar dat mag

§5 stelde dat onbekend en ingetrokken allebei 404 krijgen, zodat een foutmelding geen informatie
prijsgeeft. Voor de nieuwe gevallen ligt dat anders — de leverancier hééft een geldige link
ontvangen, dus er valt niets te verbergen dat hij niet al weet:

| Situatie | Antwoord | Melding aan de leverancier |
|---|---|---|
| Token onbekend of ingetrokken | 404 | "Deze link is niet geldig." |
| Verlopen (`expires_at`) | 410 | "Deze link is verlopen op <datum>. Neem contact op met <tenant>." |
| Al ingediend | 410 | "Deze vragenlijst is al ingediend op <datum>." |
| Ronde gesloten | 410 | "Deze vragenlijstronde is gesloten." |
| Vendor niet meer actief | 410 | "Deze link is niet langer beschikbaar. Neem contact op met <tenant>." |

Bij de laatste bewust geen uitleg over wát er met de leverancier gebeurd is — dat is interne
informatie van de klant. Wel een duidelijk eindpunt in plaats van een lege pagina of een crash.

### Zichtbaarheid voor de beheerder

Het stille falen is nu een nette foutmelding voor de leverancier, maar de beheerder merkt er niets
van: die denkt dat er een uitnodiging openstaat. Twee eisen die daaruit volgen:

1. **Zacht verwijderen van een vendor met openstaande responses moet waarschuwen** — "er staan
   N openstaande uitnodigingen; die worden hiermee ongeldig". Niet blokkeren, wel tonen.
2. **Het statusoverzicht (journey D) toont een aparte status** voor responses waarvan de
   onderliggende gegevens weg zijn — niet "openstaand", maar "vervallen". Anders blijft de
   beheerder wachten op een antwoord dat nooit komt.

Beide raken de beheerderskant, niet de guard. Ze horen in het statusoverzicht en de vendor-CRUD,
en worden hier vastgelegd zodat ze niet verloren gaan (zie §11).

---

## 6. Isolatietest (#10) — wat bewezen moet worden

In dezelfde vorm als de bestaande `test/tenant-rls-isolation.e2e-spec.ts`, draaiend in CI tegen
een wegwerpbare Postgres-container. De test is pas geslaagd als elk van deze punten aantoonbaar is:

| # | Bewijs |
|---|---|
| 1 | Token van tenant A geeft nooit toegang tot een response van tenant B |
| 2 | Een verlopen token wordt geweigerd (`expires_at` in het verleden) |
| 3 | Een tweede indiening met hetzelfde token faalt |
| 4 | Twee gelijktijdige indieningen leveren precies één succes op |
| 5 | Een ingetrokken token wordt geweigerd |
| 6 | `resolve_survey_token` met een onbekende hash geeft niets terug |
| 7 | De runtime-rol heeft nog steeds geen `BYPASSRLS` |
| 8 | Zonder tenant-context zijn de survey-tabellen leeg |

Punt 4 verdient een echte gelijktijdigheidstest (twee verbindingen, tegelijk), geen twee
opeenvolgende aanroepen — anders test je de race niet die je wilt uitsluiten.

Aanvullend, uit §5a — de gevallen waarin het token geldig is maar de omliggende gegevens niet:

| # | Bewijs |
|---|---|
| 9 | Naamswijziging van de vendor laat het token ongemoeid werken (het verwijst naar `vendor_id`) |
| 10 | Zacht verwijderde vendor → 410, geen lege pagina en geen crash |
| 11 | Harde `DELETE` op een vendor met responses faalt op de FK (`RESTRICT`) |
| 12 | Token van een gesloten ronde (`closes_at` verstreken) → 410, ook als `expires_at` nog ver weg ligt |
| 13 | `resolve_survey_token` onderscheidt "onbekend" van "vendor zacht verwijderd" (`LEFT JOIN`-gedrag) |

Punt 9 en 11 zijn de directe aanleiding voor deze uitbreiding: het eerste bevestigt dat een
alledaagse beheerhandeling geen schade doet, het tweede dat een destructieve handeling geblokkeerd
wordt in plaats van stilzwijgend data mee te nemen.

---

## 7. Aanvullende eisen die geen tabel zijn

**Logging.** Het ruwe token mag nooit in een logregel belanden. Volledige URL's worden standaard
gelogd door de meeste HTTP-middleware — dat moet expliciet gemaskeerd worden vóór de eerste keer
dat dit endpoint een echte leverancier bedient.

**Audit.** Elk van deze momenten is een `audit.audit_event`-regel (AC8): token aangemaakt, token
voor het eerst gebruikt, response ingediend, token ingetrokken. Het gehashte token mag daarin, het
ruwe nooit.

**Snelheidsbegrenzing.** Raden is met 256 bits zinloos, dus dit is geen securitymaatregel maar
bescherming tegen belasting. Laag geprioriteerd, wel benoemen.

**Verzendmoment.** Het ruwe token bestaat alleen op het moment van aanmaken. Als de e-mail niet
verzonden wordt, is de link weg en moet een nieuwe gegenereerd worden. Dit raakt OV-9 (SMTP-details,
nog niet ontvangen) — het tokenmechanisme kan zonder e-mail gebouwd en getest worden, maar de
volledige journey B/C niet.

---

## 8. Drizzle — de zeven criteria uit §5

Dit ontwerp is de onderbouwing voor ADR-010. De besluitvorming ging niet via de vergelijkende
spike uit Issue #5; deze slice is de plek waar Drizzle zich moet bewijzen. Per criterium:

| # | Criterium uit §5 | Hoe dit ontwerp het adresseert |
|---|---|---|
| 1 | Betrouwbare Docker production build | Te bewijzen bij de eerste build; dit was exact het punt waarop Prisma 7 faalde. Blokkerend criterium. |
| 2 | Tests zonder experimentele Node-vlaggen | Drizzle genereert geen aparte client-engine, dus de generator-/moduleconflicten van Prisma 7 zijn er structureel niet. Te bevestigen, niet aan te nemen. |
| 3 | RLS read/write-isolatie, twee tenants | §6, punt 1 en 8. |
| 4 | `SET LOCAL` + queries in dezelfde transactie/connectie | §5, stap 9–10. Drizzle geeft directe controle over de transactie, wat dit eenvoudiger maakt dan bij een abstractielaag die verbindingen zelf beheert. |
| 5 | Migraties op een lege testdatabase | Draait al zo in CI (`rls-isolation`-job, ADR-009); de nieuwe migratie voegt zich daarin. |
| 6 | Begrijpelijke documentatie, lage herstellast | Drizzle's schema is gewone TypeScript, geen aparte schemataal. Voor een eigenaar die zelf moet kunnen onderhouden is dat winst. |
| 7 | Geen fragiele module-/generator-workarounds | Het hoofdmotief voor de overstap. Te bewijzen, niet te veronderstellen. |

**Volledige omzetting in één keer** (jouw keuze): het bestaande schema — Tenant, User, Vendor,
VendorContact, VendorTag, AuditEvent — gaat naar Drizzle vóórdat de survey-tabellen erbij komen.

Consequenties die daarbij horen:

- De bestaande RLS-test staat nu groen. Die moet ná de omzetting nog steeds groen zijn, met
  dezelfde assertions — dat is het vangnet voor de verbouwing.
- De migratiehistorie in `prisma/migrations/` is uitgevoerd tegen de echte database. Die historie
  wordt niet herschreven; Drizzle neemt de bestaande tabellen als uitgangspunt en levert vanaf
  daar nieuwe migraties. De map wordt niet verwijderd zolang de omzetting niet bewezen is.
- `prisma/roles/bootstrap-roles.sql` staat los van de ORM en blijft ongewijzigd.
- Dit is een aparte stap vóór de tokenimplementatie, met een eigen acceptatiemoment. Niet
  vermengen: als de omzetting en het nieuwe token in één keer gaan en er faalt iets, is de oorzaak
  niet te isoleren.

---

## 9. Wat dit ontwerp bewust niet oplost

| Onderwerp | Reden |
|---|---|
| Certificaat-upload (#9, AC13) | Wacht op OV-7 — scanvereiste en groottelimiet onbeantwoord. Het token draagt straks ook de bestandstoegang; dat ontwerp volgt apart. |
| Vraagtype A/B, antwoordopslag | Wacht op OV-6 (toelichting verplicht?) en OV-8 (welke vraag welk type). |
| Interne beheerder (spoor 1) | Aparte guard, aparte herkomst van tenant-context (Entra ID-token). Deelt alleen de `TenantTransactionService`. |
| E-mailverzending | Wacht op OV-9 (SMTP-details). |
| Exportformaat | OV-4, staat los van dit spoor. |

---

## 10. Voorgestelde volgorde

1. **Drizzle-omzetting** van het bestaande schema, met de bestaande RLS-test als vangnet. Apart
   acceptatiemoment. ADR-010 vastleggen.
2. **Migratie** met de drie survey-tabellen, RLS-policies en `resolve_survey_token`.
3. **Tokengeneratie en guard** volgens §3 en §5.
4. **Isolatietest** volgens §6, toegevoegd aan de CI-poort (sluit #10).
5. **Logmaskering en auditregels** volgens §7.

Stap 1 is de grootste onzekerheid — daar zit de Docker-build die bij Prisma 7 faalde. Als die
faalt, is dat een bevinding over Drizzle die vóór stap 2 bekend moet zijn.

---

## 11. Openstaande punten bij dit ontwerp

- **OV-2 bevestigd op 30 dagen** — vastgelegd in de scope, hier overgenomen als `expires_at`.
- **Intrekbaarheid** is opgenomen als `revoked`-status op basis van de opdrachtformulering
  ("intrekbare response-links"); een concreet klantscenario waarin dit gebruikt wordt is niet
  beschreven. Aangenomen als redelijk, niet bevestigd.
- **Herverzenden van een link** (leverancier is de e-mail kwijt): het ontwerp maakt dit
  noodzakelijkerwijs "nieuw token genereren, oude intrekken". Dit is een gevolg van het hashen,
  geen apart besluit — maar wel iets wat de beheerder moet kunnen doen. Nog geen issue voor.
- **Twee eisen aan de beheerderskant uit §5a**, die buiten dit spoor vallen maar er wel uit
  voortkomen: (a) waarschuwen bij het zacht verwijderen van een vendor met openstaande responses,
  (b) een aparte "vervallen"-status in het statusoverzicht van journey D. Zonder deze twee lost de
  guard het stille falen op voor de leverancier, maar blijft de beheerder wachten op een antwoord
  dat nooit komt. Nog geen issue voor — aanmaken bij goedkeuring van dit ontwerp.
- **`closes_at` op `survey_run`** stond in het oorspronkelijke schemavoorstel zonder dat enige
  regel hem gebruikte. Nu meegenomen in de guard (§5a). Of een ronde überhaupt een sluitdatum
  náást de 30-dagentermijn per token moet hebben, is niet met de klant besproken — aangenomen als
  nuttig, te bevestigen.
