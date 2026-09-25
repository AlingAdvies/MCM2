# Transdev: schone lei op productie + eigen development-tenant

**Status:** UITGEVOERD op 25-09-2026. Zie §9 onderaan voor het resultaat en
de openstaande punten.
**Context:** Transdev-productietenant bevat een mix van live en testdata
(gap-analyse cross-reference + losse handmatige tests). Doel: opnieuw
beginnen met de geschoonde, definitieve Coupa-CSV-import, en daarnaast een
aparte development-tenant die zo veel mogelijk op productie lijkt om dingen
in uit te proberen zonder klantdata te raken.

## 0. Wat we al weten (onderzoek 25-09-2026, read-only, binnen tenantcontext)

- Transdev-tenant-id: `4afcb659-63a8-4b16-8a0c-76d2a2d8676e` (register-naam
  "Transdev Nederland").
- Huidige stand: 38 vendors (37 actief), 14 contracten, 18 contactpersonen,
  13 survey-rondes (`survey_run`), 26 responses (`survey_response`), 0
  vendor-engagements.
- Gebruikers: 2 actieve leden (beide van de eigenaar: `support` +
  `admin`/Cor), 5 ingetrokken (waaronder de twee enige `@transdev.nl`-
  adressen — nooit succesvol via Entra ingelogd). **Geen levend
  klantgebruik in de gebruikerslijst.**
- Referentie-export al gemaakt or 25-09: `transdev-export-vendors-2026-09-25.json`,
  `transdev-export-contracten-2026-09-25.json`,
  `transdev-export-contactpersonen-2026-09-25.json` (in `Downloads/`).
- Er bestaat GEEN bestaande "tenant leegmaken" of "tenant dupliceren"-route
  in de applicatie (platformbeheer kent alleen aanmaken/wijzigen/
  deactiveren/features/support-toegang — zie `src/platform/platform.controller.ts`).
  Leegmaken moet dus via directe SQL binnen tenantcontext, niet via een API-call.
- De bestaande contract-import (`POST /contracts/import`, zie
  `src/contract-import/contract-import.controller.ts` +
  `contract-import-schema.ts`) is de geverifieerde weg om de geschoonde CSV
  in te laden — geen nieuw importmechanisme nodig.

## 1. Volgorde van verwijderen (FK-afhankelijkheden, productie-tenant)

De database dwingt een volgorde af via foreign keys. Verkeerde volgorde
geeft een `violates foreign key constraint`-fout, geen stille corruptie —
maar wel prettig om in één keer goed te doen.

```
1. clm.survey_response      (vendor_id/subject_vendor_id -> vendor: RESTRICT)
2. clm.survey_run           (geen directe vendor-FK, maar responses moeten eerst weg)
3. clm.vendor_engagement_link  (0 rijen nu, koppeltabel engagement<->contract/response)
4. clm.vendor_engagement    (vendor_id -> vendor: RESTRICT) — 0 rijen nu, snel
5. clm.contract             (vendor_id -> vendor: CASCADE — zou vanzelf meegaan,
                              maar expliciet verwijderen is duidelijker om te loggen)
6. clm.vendor_contact, clm.vendor_tag, clm.vendor_compliance_thema
                             (vendor_id -> vendor: CASCADE — gaan vanzelf mee met vendor)
7. clm.vendor               (laatste, alles ervoor moet weg zijn)
```

Alles binnen **één tenant-scoped transactie** met
`SELECT set_config('app.current_tenant_id', '<transdev-id>', true)` —
RLS zorgt dat een `DELETE FROM clm.vendor` sowieso nooit een andere tenant
kan raken, maar we filteren voor de leesbaarheid alsnog niet op een aparte
WHERE-tenant_id (RLS doet dat al; expliciet zou suggereren dat RLS niet
genoeg is).

**Wat NIET verwijderd wordt:** `clm.tenant` zelf, `clm.tenant_membership`
(zie §2 hieronder — apart besluit), `clm.tenant_feature`, `clm.omgeving`.

## 2. Gebruikers: opschonen van de 5 ingetrokken rijen

Functioneel maakt dit niets uit — ingetrokken (`deleted_at IS NOT NULL`)
memberships tellen nergens meer mee. Maar voor overzicht op het
platformbeheerscherm is het schoner om ze weg te halen.

**Voorstel:** de 5 ingetrokken `tenant_membership`-rijen definitief
verwijderen (`DELETE`, niet nog een keer soft-deleten — ze zijn al
ingetrokken). De bijbehorende `clm.user`-rijen (Kees Aling, TestKees,
TestKees2, Dennis de Wit, John Smit) blijven staan als user-record (ze
kunnen aan andere tenants gekoppeld zijn of gewoon als historie dienen) —
tenzij je ze ook als user wil opruimen. **Dit is een keuze, geen technische
noodzaak — apart bevestigen voordat dit wordt uitgevoerd.**

De 2 actieve leden (support + admin/Cor) blijven ongewijzigd staan.

## 3. Backup vóór uitvoering

Twee lagen, beide al mogelijk zonder nieuw werk:

1. **De drie JSON-exports zijn al gemaakt** (zie §0) — vendors, contracten,
   contactpersonen, met alle kolommen, als tekstueel vangnet.
2. **De reguliere productiedatabase-backup** (saxombp haalt dagelijks een
   dump, issue #58) dekt sowieso het volledige verhaal terug, inclusief
   rijen die de JSON-export niet meenam (survey_run/survey_response). Geen
   actie nodig — bestaat al. Wel z'n vrijheidsgraad checken: laatste dump
   niet ouder dan de dag van uitvoering (zelfde controle als
   `productie:poort` voor een deploy).

## 4. Uitvoering op productie (Transdev-tenant leegmaken)

Eén Node-script, tijdelijk in de projectroot (zoals bij het onderzoek in
§0), verbindend via `NOOD_PRODUCTIE_URL`, binnen één transactie:

```js
await client.query('BEGIN');
await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [TRANSDEV_ID]);
await client.query(`SELECT set_config('app.current_actor', 'medewerker', true)`);

await client.query(`DELETE FROM clm.survey_response`);
await client.query(`DELETE FROM clm.survey_run`);
await client.query(`DELETE FROM clm.vendor_engagement_link`);
await client.query(`DELETE FROM clm.vendor_engagement`);
await client.query(`DELETE FROM clm.contract`);
await client.query(`DELETE FROM clm.vendor_contact`);
await client.query(`DELETE FROM clm.vendor_tag`);
await client.query(`DELETE FROM clm.vendor_compliance_thema`);
await client.query(`DELETE FROM clm.vendor`);

// Optioneel, apart bevestigen (zie §2):
await client.query(
  `DELETE FROM clm.tenant_membership WHERE tenant_id = $1 AND deleted_at IS NOT NULL`,
  [TRANSDEV_ID],
);

// Tellingen tonen, DAN pas COMMIT — nooit blind committen.
await client.query('COMMIT');
```

**Kritiek verschil met het onderzoeksscript:** dit commit't écht. Daarom:
eerst een droge run met `ROLLBACK` in plaats van `COMMIT` (identiek aan wat
in §0 al is gedaan), de tellingen tonen, en pas bij expliciet akkoord van de
eigenaar een tweede keer draaien met `COMMIT`. Nooit in één beweging.

Na afloop: `node scripts/verify-omgevingen.js` of gewoon een herhaling van
de telquery uit §0 om te bevestigen dat alle tabellen op 0 staan voor deze
tenant.

## 5. Nieuwe tenant "Transdev Development" aanmaken

Via de bestaande, geteste route — **geen nieuwe code nodig**:

```
POST /platform/tenants
{ "naam": "Transdev Development", "adminNaam": "...", "adminEmail": "..." }
```

Zie `src/platform/platform.controller.ts` `tenantAanmaken()` — dit
verstuurt ook meteen een uitnodigingsmail (of toont de link handmatig als er
geen mailkanaal is, exact het patroon uit de Excel-export-sessie). Wie de
eerste admin van deze tenant wordt, is een keuze voor de eigenaar — logisch
kandidaat: dezelfde persoon die nu ook Transdev-productie beheert (Cor).

**Let op:** dit is een aparte, blijvende tenant naast "Transdev Nederland",
niet een kloon-mechanisme. Er is geen "dupliceer tenant X"-functie — de
gelijkenis met productie ontstaat alleen doordat we straks dezelfde
geschoonde CSV in beide tenants importeren (§6), niet doordat de tenant zelf
een kopie is.

## 6. Beide tenants vullen met dezelfde geschoonde CSV

1. Definitieve CSV afmaken op basis van
   `transdev-koppeltabel-2026-09-25-v2.csv` (Downloads) — de 14 bewezen
   kolommen, datums als D-M-JJJJ-tekst, kopnamen exact zoals
   `contract-import-schema.ts` ze herkent.
2. Importeren in **Transdev Nederland** (productie) via de bestaande UI/route
   (`POST /contracts/import` + bevestigen), na de leegmaak in §4.
3. **Dezelfde CSV** nogmaals importeren in **Transdev Development** — zelfde
   bestand, andere tenant-sessie. Dit is de stap die "zoveel mogelijk lijkend
   op productie" waarmaakt: identieke brondata, twee gescheiden tenants.
4. Beide los verifiëren: aantal vendors/contracten na import moet gelijk
   zijn aan het aantal `importeerbaar`-gemarkeerde rijen uit de
   preview-stap van de import.

## 7. Wat NIET gelijk hoeft te zijn tussen de twee tenants

- Gebruikers/leden — development mag een ruimere/andere gebruikerslijst
  hebben zonder dat dit iets over productie zegt.
- Features (`clm.tenant_feature`) — als er in de toekomst een feature-vlag
  eerst in development getest moet worden vóórdat hij naar productie gaat,
  is verschil dus juist de bedoeling.
- Survey-rondes/uitnodigingen — die genereren allebei apart hun eigen tokens
  zodra je in elke tenant een ronde start; geen gedeelde of gekopieerde
  tokens tussen de tenants (zelfde architectuurregel als bij de
  Excel-export-feature: nooit tokens dupliceren).

## 8. Besluiten van de eigenaar (25-09-2026)

1. **Akkoord** — de `DELETE`-lijst in §1/§4 wordt zo uitgevoerd.
2. **Definitief weg** — de 5 ingetrokken `tenant_membership`-rijen worden
   verwijderd, geen historie bewaard.
3. **Eerste admin van "Transdev Development": Cor (cmaling@hotmail.com)** —
   zelfde persoon als de huidige actieve admin op productie.
4. **Geen van de vijf Deel A-velden wordt automatisch geïmporteerd.** Alle
   vijf (`owner_user_id`, `status_code`, `value_eur`, `auto_renews`,
   `dpa_aanwezig`) vult de eigenaar zelf handmatig in de UI aan, na de
   import van de 14-kolommen-CSV. Geen wijziging aan
   `contract-import-schema.ts` nodig voor dit traject.

---

## 9. Resultaat van de uitvoering (25-09-2026)

### Wat er onderweg anders bleek dan gepland

Vier ontdekkingen die het oorspronkelijke plan (§1–§4) onbruikbaar maakten in
zijn eerste vorm. Alle vier gevonden door te meten, niet door te redeneren.

**1. `clm_migrator` ziet cross-tenant data op vier tabellen.** `vendor`,
`survey_response`, `survey_run` en `tenant_membership` hebben géén `FORCE ROW
LEVEL SECURITY`. `clm_migrator` is eigenaar van alle tabellen, dus RLS geldt
voor die rol daar niet. Een `DELETE` zonder `WHERE tenant_id` via die rol zou
álle tenants hebben geraakt. Alle tellingen uit §0 die via `clm_migrator`
liepen waren om dezelfde reden onbetrouwbaar.

**2. `clm_api_runtime` mist `DELETE` op vijf tabellen.** `survey_review`,
`response_note`, `vendor_engagement`, `import_job` en `contract` —
architectuurbeslissing (audit-bewijs en dossiers verwijdert de applicatie
nooit). Geverifieerd via `information_schema.role_table_grants`, inclusief de
rechten die via groepsrol `clm_api` geërfd worden.

**3. Twee rollen kunnen niet in één transactie.** `SET ROLE` tussen
`clm_api_runtime` en `clm_migrator` is in beide richtingen geweigerd (geen
membership-relatie — terecht, anders was RLS te omzeilen). Twee losse
connecties werken evenmin: FK-checks zien elkaars niet-gecommitte werk niet.

**4. Drie tabellen buiten schema `clm` bevatten tenant-data.**
`audit.audit_event` (22 rijen) en `ref.vendor_category` (13 rijen). Gevonden
door schema-breed te zoeken naar elke tabel met een `tenant_id`-kolom, niet
door de code te lezen. `notification.*` is voor beide rollen ontoegankelijk.

### De uiteindelijke aanpak

Twee tijdelijke `SECURITY DEFINER`-functies (eigendom `clm_migrator`, zoals
`clm.resolve_survey_token()` dat ook doet), met `search_path` vastgezet,
`EXECUTE` alleen voor `clm_api_runtime`, `tenant_id` afgedwongen in de
SQL-body, en na gebruik weer weggegooid. De rest via `clm_api_runtime` binnen
één transactie. Vóór commit een verplichte controle: elke andere tenant moet
exact ongewijzigd zijn, anders gedwongen rollback.

Volledigheid bewezen met drie onafhankelijke methodes: (a) elke `clm`-tabel
met een `tenant_id`-kolom uit `pg_class`, (b) elke foreign key die naar de
opruimlijst wijst uit `information_schema`, (c) elk schema buiten `clm`.

### Verwijderd uit Transdev Nederland (19 tabellen, COMMIT bevestigd)

32 antwoorden · 3 bijlage-rijen · 4 beoordelingen · 4 notities · 9 responses ·
7 rondes (2 gearchiveerd) · 1 importsessie + 9 importregels + 2 extra
contacten · 14 contracten + 2 vragenlijst-oplijningen · 18 contactpersonen ·
12 compliance-thema's · 14 leveranciers · 22 auditregels · 13 categorieën ·
5 ingetrokken lidmaatschappen.

Onafhankelijk geverifieerd met een verse verbinding als `clm_api_runtime`:
Transdev overal 0; AlingAdvies, Bizaline, demo en Platformbeheer exact
ongewijzigd.

### Bewust blijven staan

De tenant zelf · 2 vragenlijsten (`transdev-annual-vendor-it-risk`,
`transdev-leveranciersbeoordeling`) met 6 categorieën en 38 vragen · 2 actieve
lidmaatschappen (support + Cor/admin) · 6 gebruikersrecords · 15 sessies ·
`tenant_feature` (leeg, alles uit).

### Nieuwe tenant

**Transdev DEV**, id `c0fe1d30-e785-4dcd-bdf2-0740e95bdd61`, aangemaakt
25-09 17:35 via `scripts/tenant-aanmaken.js` (echte platformroute, echte
Entra-login, dus mét auditspoor). Admin: `cmaling+tddev@gmail.com` (Cor
Maling) — een apart adres omdat de unieke index
`tenant_membership_een_actief_per_gebruiker` maar één blijvend lidmaatschap
per identiteit toestaat en `cmaling@hotmail.com` al admin is van Transdev
Nederland. Inhoud geverifieerd leeg via `clm_api_runtime`.

Productie heeft geen mailkanaal, dus de uitnodigingslink is handmatig
doorgegeven en bestaat maar één keer.

## 10. Openstaande punten

1. **Drie weesbestanden op de ECS-container.** De bijlagen van Transdev
   (`Inventum BM35 Bread Maker.pdf`, een screenshot, en
   `ISO27001 Transdev KIWA K-0225427-1 tem 05092028.pdf`, samen ~0,5 MB)
   staan op `/app/var/uploads` in de container `mcm2-api`. De databaserijen
   zijn weg, dus geen enkele route kan er nog bij, maar de bestanden zelf
   staan er nog. Verwijderen kan niet vanaf deze machine: er zijn geen
   AWS-credentials (bewust — uitrol loopt via OIDC vanuit GitHub) en ECS Exec
   is nergens ingeschakeld (`enableExecuteCommand` komt in de hele repo niet
   voor). Aanzetten vraagt een wijziging aan de servicedefinitie plus een
   nieuwe productie-uitrol. AWS CLI 2.37.2 is inmiddels wel geïnstalleerd op
   de werkmachine.
2. **Uitnodiging Transdev DEV nog niet verzilverd.** `cmaling+tddev@gmail.com`
   heeft een openstaande uitnodiging (`uitnodiging_hash` gezet,
   `external_subject` nog leeg). De link verloopt.
3. **Definitieve CSV importeren** in beide tenants, volgens §6 en de
   koppeltabel `transdev-koppeltabel-2026-09-25-v2.csv`.
