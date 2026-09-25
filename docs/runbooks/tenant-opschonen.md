# Runbook — een tenant leegmaken zonder de andere te raken

**Type:** A — eenmalige databasehandeling, onomkeerbaar
**Eigenaar:** de eigenaar (Chris)
**Laatste update:** 2026-09-25
**Vereiste toegang:** `PRODUCTIE_RUNTIME_URL` én `NOOD_PRODUCTIE_URL` in `.env`, Node
**Duur:** ongeveer een uur, waarvan de droge runs het meeste kosten

> **Voor het eerst uitgevoerd op 2026-09-25** (tenant Transdev Nederland).
> Alles hieronder is gemeten op productie, niet beredeneerd. Zie
> `docs/superpowers/plans/2026-09-25-transdev-schone-lei-plus-dev-tenant.md`
> voor het volledige verslag van die uitvoering.
>
> **Sinds 2026-09-25 bestaat `scripts/tenant-opschonen.js`**, dat de stappen
> hieronder uitvoert. Het is bewust GEEN generiek script dat de tabellenlijst
> automatisch afleidt uit de foreign-key-graaf — een eerste poging daartoe
> introduceerde een nieuwe volgordefout in plaats van het bewezen proces te
> herhalen. Het script bevat daarom de vaste, hardgecodeerde tabellenlijst en
> -volgorde uit deze uitvoering. Komt er een nieuwe tabel bij die tenant-data
> bevat, werk dan eerst stap 2 hieronder handmatig bij en pas daarna het
> script, met de hand — niet door het algoritme te verbeteren.
>
> ```
> node scripts/tenant-opschonen.js --tenant-id <uuid> --extern         # droge run
> node scripts/tenant-opschonen.js --tenant-id <uuid> --extern --commit # echt
> ```
>
> Getest tegen een wegwerpcontainer met twee gevulde tenants (2026-09-25):
> droge run en commit allebei groen, doeltenant volledig leeg, andere tenant
> exact ongewijzigd — onafhankelijk geverifieerd met een verse verbinding.

---

## Waarom dit runbook bestaat

Bij de eerste uitvoering moest de eigenaar **drie keer zelf om een
controlemechanisme vragen**, en elke keer leverde dat een gemiste tabel op:

1. Eerste vraag → `import_job`, `import_row`, `import_extra_contact` ontbraken.
2. Tweede vraag → `audit.audit_event` en `ref.vendor_category` ontbraken,
   want die staan buiten schema `clm`.
3. Derde vraag → de geüploade bestanden bleken helemaal niet in de database
   te staan, maar op de schijf van de container.

De oorzaak was steeds dezelfde: de tabellenlijst was opgebouwd met handmatig
grep-werk in `schema.ts`. Dat voelt grondig en is het niet. **Dit runbook
vervangt dat door drie zoekopdrachten tegen de database zelf.**

Wie dit overslaat, maakt een tenant leeg die niet leeg is.

---

## Wat je vooraf moet weten over de rollen

Twee rollen, en het verschil is hier niet academisch.

| | `clm_api_runtime` | `clm_migrator` |
|---|---|---|
| Uit | `PRODUCTIE_RUNTIME_URL` | `NOOD_PRODUCTIE_URL` |
| Eigenaar van de tabellen | nee | **ja** |
| RLS geldt | altijd | **niet op tabellen zonder FORCE RLS** |
| `DELETE`-recht | op de meeste tabellen | overal |

**Vier tabellen missen `FORCE ROW LEVEL SECURITY`**: `vendor`,
`survey_response`, `survey_run`, `tenant_membership` (gemeten 25-09, issue
#206). RLS geldt daar niet voor de eigenaar, dus `clm_migrator` ziet en
schrijft daar dwars door de tenantgrens heen. Een `DELETE FROM clm.vendor`
via die rol raakt **alle tenants**.

Daar komt bij: `clm_api_runtime` mist bewust `DELETE` op vijf tabellen —
`survey_review`, `response_note`, `vendor_engagement`, `import_job` en
`contract`. Audit-bewijs en dossiers verwijdert de applicatie nooit.

En je kunt niet even van rol wisselen: `SET ROLE` is tussen deze twee rollen
in **beide richtingen geweigerd** (geen membership-relatie — terecht, anders
was RLS te omzeilen). Twee losse connecties werken evenmin: die delen geen
transactie, dus foreign-key-controles zien elkaars niet-gecommitte werk niet.

**Gevolg:** je hebt beide rollen nodig, binnen één transactie, en dat kan
alleen via een `SECURITY DEFINER`-functie. Zie stap 5.

---

## Stap 1 — Vaststellen wat er werkelijk staat

Nooit tellen via `clm_migrator` zonder tenantcontext: dat geeft óf te veel
(tabellen zonder FORCE RLS) óf nul (de RLS-policy evalueert `tenant_id =
NULL`, wat nooit matcht — ook niet met een expliciete `WHERE` erbovenop).

Tel via `clm_api_runtime`, met **beide** context-variabelen gezet:

```js
await client.query('BEGIN');
await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
await client.query(`SELECT set_config('app.current_actor', 'medewerker', true)`);
// ... tellen ...
await client.query('ROLLBACK');
```

De actor is niet optioneel. Policies als die op `survey_review` eisen
`clm.current_actor() = 'medewerker'`; zonder die regel telt hij nul en denk
je dat de tabel leeg is. Dat is op 25-09 daadwerkelijk misgegaan.

**Bij afwijking:** telt een tabel nul terwijl je data verwacht, ga er dan
niet vanuit dat hij leeg is. Zie `mcm2-nul-rijen-is-geen-bevinding`.

---

## Stap 2 — De tabellenlijst opbouwen, drie keer, uit de database

Dit is de kern van dit runbook. Niet grepen in `schema.ts`, maar drie
zoekopdrachten die elkaar aanvullen. Alle drie uitvoeren, ook als de eerste
al compleet lijkt.

### 2a — Elke tabel in `clm` met een `tenant_id`-kolom

```sql
SELECT c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'clm' AND c.relkind = 'r'
   AND EXISTS (SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
       AND a.attnum > 0 AND NOT a.attisdropped)
 ORDER BY c.relname;
```

Op 25-09 gaf dit **28 tabellen**. Elf daarvan horen bij de tenant zelf en
blijven staan (zie stap 3).

### 2b — Elke foreign key die naar je opruimlijst wijst

Vangt de tabellen die geen eigen `tenant_id` hebben maar wel data van deze
tenant bevatten via een verwijzing.

```sql
SELECT tc.table_name AS bron, kcu.column_name, ccu.table_name AS doel, rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
  JOIN information_schema.referential_constraints rc
    ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
 WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'clm'
   AND ccu.table_name = ANY(<jouw lijst>)
 ORDER BY ccu.table_name, tc.table_name;
```

Let op de `delete_rule`:

- **CASCADE** — gaat vanzelf mee. Niet apart verwijderen, wél meetellen in de
  eindcontrole.
- **RESTRICT** — blokkeert. Moet eerder in de volgorde.
- **SET NULL** — blokkeert niet, maar laat verweesde verwijzingen achter.
  Verwijder de bronrij eerder, anders blijft er rommel staan die naar niets
  meer wijst.

Op 25-09 vond dit `import_row` (drie SET NULL-verwijzingen),
`vendor_engagement_attachment` (RESTRICT) en `vendor_engagement_note`.

### 2c — Elk schema buiten `clm`

De makkelijkst te missen categorie.

```sql
SELECT n.nspname, c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r'
   AND n.nspname NOT IN ('clm','pg_catalog','information_schema')
   AND EXISTS (SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
       AND a.attnum > 0 AND NOT a.attisdropped)
 ORDER BY n.nspname, c.relname;
```

Op 25-09: `audit.audit_event`, `ref.vendor_category`, en twee tabellen in
`notification` die voor beide rollen ontoegankelijk zijn (leeg scaffold).

---

## Stap 3 — Beslissen wat blijft staan

Niet alles met een `tenant_id` is data. Deze horen normaal te **blijven**,
maar leg het per keer expliciet voor aan de eigenaar:

| Tabel | Waarom blijven | Wanneer toch weg |
|---|---|---|
| `tenant` | de tenant zelf | alleen bij deactiveren |
| `tenant_membership` (actief) | anders kan niemand meer inloggen | nooit |
| `tenant_membership` (ingetrokken) | historie | meestal wél opruimen |
| `user`, `sessie` | kunnen aan andere tenants hangen | zelden |
| `survey_template`, `survey_category`, `survey_question` | de vragenlijst als formulier, niet de antwoorden | als de sjablonen zelf testversies zijn |
| `template_reviewer`, `tenant_feature` | inrichting | zelden |
| `audit.audit_event` | het auditspoor ís de opbrengst | als de eigenaar er expliciet om vraagt |
| `ref.vendor_category` | labels die de import hergebruikt | als de categorieën rommelig zijn |

**Vraag ook altijd naar deze twee**, want ze zijn onzichtbaar in de tellingen:

- **Lopende uitnodigingen.** `SELECT status, count(*) FILTER (WHERE expires_at
  > now()) FROM clm.survey_response GROUP BY status` — zitten er
  niet-verlopen `pending`-tokens bij, dan krijgt een leverancier met een link
  in zijn mailbox straks een foutmelding.
- **Geüploade bestanden.** Zie stap 7.

---

## Stap 4 — Backup controleren

`docs/runbooks/backup-bewijs.json` lezen: `gecontroleerdOp` mag niet ouder
zijn dan vandaag, en `lagen` hoort minstens `["A","B"]` te bevatten.

**Wat de backup NIET dekt:** de geüploade bestanden. Die staan op schijf en
gaan niet mee in `pg_dump` (issue #30). Wat je daar weggooit is echt weg.
Meld dat expliciet aan de eigenaar vóór hij akkoord geeft.

---

## Stap 5 — De verwijdervolgorde en de SECURITY DEFINER-functie

Volgorde volgt uit de foreign keys van stap 2b. De vorm die op 25-09 werkte:

1. **Via `clm_api_runtime`:** de bladeren die naar `survey_response` wijzen en
   die deze rol wél mag verwijderen (`survey_answer`, `survey_attachment`),
   plus koppeltabellen zonder echte FK (`vendor_engagement_link` —
   `linked_id` heeft geen foreign key, dus niets blokkeert, maar verweesde
   rijen blijven wel achter als je hem later doet).
2. **Via de SECURITY DEFINER-functie:** de tabellen zonder `DELETE`-recht,
   in FK-volgorde. Op 25-09: `survey_review`, `response_note`,
   `vendor_engagement`, `import_job`, `contract`.
3. **Via `clm_api_runtime`:** de rest (`survey_response`, `survey_run`,
   `vendor_contact`, `vendor_tag`, `vendor_compliance_thema`, `vendor`).
4. **Via een tweede functie, ná `vendor`:** de tabellen buiten `clm`
   (`audit.audit_event`, `ref.vendor_category` — die laatste kan pas weg als
   geen `vendor.category_code` er meer naar verwijst).
5. **Via `clm_api_runtime`, met expliciete `WHERE tenant_id`:**
   `tenant_membership`. Hier beschermt RLS niet (geen FORCE RLS), dus de
   `WHERE` is hier geen franje maar de enige bescherming.

De functie, met alle drie de veiligheidseisen erin:

```sql
CREATE OR REPLACE FUNCTION clm.tijdelijk_leegmaken_beperkte_tabellen(p_tenant_id uuid)
RETURNS TABLE(tabel text, aantal bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = clm, pg_temp   -- voorkomt search_path-manipulatie
AS $$
DECLARE n_review bigint; /* ... */
BEGIN
  DELETE FROM clm.survey_review WHERE tenant_id = p_tenant_id;  -- filter IN de body
  GET DIAGNOSTICS n_review = ROW_COUNT;
  -- ... de overige tabellen, in FK-volgorde ...
  RETURN QUERY SELECT 'survey_review'::text, n_review /* ... */;
END;
$$;
```

Daarna, niet vergeten:

```sql
GRANT EXECUTE ON FUNCTION clm.tijdelijk_leegmaken_beperkte_tabellen(uuid) TO clm_api_runtime;
REVOKE EXECUTE ON FUNCTION clm.tijdelijk_leegmaken_beperkte_tabellen(uuid) FROM PUBLIC;
```

Drie eisen, alle drie verplicht (bron: PostgreSQL-documentatie en
Cybertec, geraadpleegd 25-09):

- `search_path` expliciet vastzetten;
- `tenant_id` afdwingen in de SQL-body, niet als los meegegeven filter dat de
  aanroeper kan overslaan;
- `EXECUTE` alleen aan de rol die hem nodig heeft, nooit `PUBLIC`.

**De functie is tijdelijk.** `DROP FUNCTION` aan het eind, ook als de run
mislukt. Dit is geen applicatiecode.

Dit patroon is niet nieuw in MCM2: `clm.resolve_survey_token()` (migratie
0003) doet hetzelfde. Zie ook de waarschuwing in
`commandos-en-omgeving.md` over FORCE RLS en SECURITY DEFINER.

---

## Stap 6 — Droge run, en de controle die vóór commit draait

**Altijd eerst met `ROLLBACK`.** Een omgevingsvariabele als schakelaar
(`COMMIT_ECHT=1`) werkt goed: zonder die vlag rolt het script terug.

De controle die het script zelf moet doen, binnen dezelfde transactie, vóór
de commit:

1. **Nulmeting** per tenant — de op te schonen tenant én alle andere, over
   alle tabellen uit stap 2.
2. **Na de deletes opnieuw tellen**, met echte queries. Niet vertrouwen op de
   `rowCount` die de functie teruggaf: die kan liegen bij een fout in de
   functie zelf.
3. **Vergelijken.** Elke andere tenant moet **exact** gelijk zijn aan de
   nulmeting. Wijkt er één getal af → gedwongen `ROLLBACK`, geen commit.
4. **De doeltenant moet overal 0 zijn**, inclusief de CASCADE-tabellen die je
   niet expliciet verwijdert.

Deze controle heeft op 25-09 twee keer terecht een rollback afgedwongen, beide
keren door een fout in de controle zelf (ontbrekende actor-context, en een
`WHERE` zonder tenantcontext). Dat is precies waarvoor hij bedoeld is: liever
een valse alarmbel dan een stille cross-tenant delete.

Draai de droge run net zo lang tot hij **volledig groen** is. Pas dan met
`COMMIT_ECHT=1`.

---

## Stap 7 — Wat de database niet dekt: de geüploade bestanden

Bijlagen staan **niet** in de database, maar als bestand op
`/app/var/uploads` in de container `mcm2-api` (`UPLOAD_DIR`, zie
`src/survey/bestand-opslag.service.ts`). De databaserij verwijderen maakt ze
onbereikbaar, niet weg.

Zoek ze vóór de opschoning op, want daarna weet je niet meer welke het waren:

```sql
SELECT attachment_id, storage_key, original_name, byte_size
  FROM clm.survey_attachment;  -- binnen tenantcontext
```

**Op 25-09 bleek verwijderen niet mogelijk** en dat is nog steeds zo:

- Geen AWS-credentials op de werkmachine — bewust, de uitrol loopt via OIDC
  vanuit GitHub Actions.
- ECS Exec is nergens ingeschakeld; `enableExecuteCommand` komt in de hele
  repo niet voor. Aanzetten vraagt een wijziging aan de servicedefinitie plus
  een nieuwe productie-uitrol.

AWS CLI 2.37.2 staat inmiddels wel op de werkmachine geïnstalleerd.

**Vertel de eigenaar dit vóór hij akkoord geeft**, niet erna: de bestanden
zitten in geen enkele backup, dus "later opruimen" betekent dat ze er
voorlopig blijven staan, en "nu weggooien" kan simpelweg niet.

---

## Stap 8 — Verifiëren met een verse verbinding

Niet vertrouwen op de meting binnen de transactie die zojuist gecommit is.
Open een **nieuwe** verbinding als `clm_api_runtime`, zet tenantcontext én
actor, en tel opnieuw — voor de opgeschoonde tenant én minstens twee andere.

Verwacht: doeltenant overal 0, andere tenants exact zoals vóór de operatie.

---

## Een nieuwe tenant ernaast zetten

Gebruik `scripts/tenant-aanmaken.js`, niet een directe INSERT. Het script
loopt via de echte platformroute met een echte Entra-login, en dát levert het
auditspoor op.

```powershell
$env:API_URL = "https://clm.alingadvies.nl/api/backend"
$env:DATABASE_URL = "<NOOD_PRODUCTIE_URL uit .env>"
node scripts/tenant-aanmaken.js --naam "<naam>" --admin-naam "<naam>" `
     --admin-email "<adres>" --extern
```

Drie dingen die op 25-09 misgingen en tijd kostten:

1. **Log in als platformbeheerder, niet als tenant-admin.** Alleen wie in
   `clm.platform_admin` staat mag dit; een `admin`-rol binnen een tenant is
   iets anders en geeft een 403. Gebruik een **privévenster**, anders logt de
   browser je stilzwijgend in met het verkeerde account.
2. **De inlogcode werkt één keer.** Herlaad de `localhost:5001`-pagina niet;
   een tweede poging geeft een 400 van het token-endpoint.
3. **Eén identiteit, één blijvend lidmaatschap.** De unieke index
   `tenant_membership_een_actief_per_gebruiker` staat maar één niet-`support`
   membership per gebruiker toe. Is de beoogde admin al admin elders, gebruik
   dan een tweede adres (een plusadres volstaat). Zie
   `mcm2-twee-identiteiten-niet-twee-memberships`.

Productie heeft geen mailkanaal, dus de uitnodigingslink wordt niet verstuurd
maar getoond. **Hij bestaat maar één keer** — geen enkele route kan hem
opnieuw tonen.

---

## Checklist

- [ ] Stap 2 — komt er een nieuwe tabel bij? Eerst de drie zoekopdrachten
      handmatig herhalen, dan pas `scripts/tenant-opschonen.js` bijwerken
- [ ] Stap 3 — voorgelegd wat blijft staan, inclusief lopende uitnodigingen
      en geüploade bestanden (het script toont dit automatisch)
- [ ] Stap 4 — backup van vandaag, lagen A+B (`docs/runbooks/backup-bewijs.json`)
- [ ] `node scripts/tenant-opschonen.js --tenant-id <uuid> --extern` —
      droge run volledig groen, geen afwijking bij andere tenants
- [ ] Stap 7 — bestanden benoemd, en gemeld dat ze buiten de backup vallen
- [ ] `node scripts/tenant-opschonen.js --tenant-id <uuid> --extern --commit`
- [ ] Stap 8 — geverifieerd met een verse verbinding (los van het script)
