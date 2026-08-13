# ADR-017 — Een tenantregister voor platformbeheer

**Status:** aanvaard
**Datum:** 2026-08-13
**Raakt:** ADR-015 (support-toegang), migratie 0011 (FORCE RLS), `clm.tenant`
**Aanleiding:** stap A van `plan-robuuste-simulatie-zonder-aws.md` liep vast

---

## Context

Op 2026-08-13 moest de tenant `AlingAdvies` op productie gevuld worden. Dat
liep vast op iets onverwachts: **er is geen manier om te zien welke tenants er
bestaan.**

De keten van waarnemingen, alle gemeten:

1. `POST /platform/tenants` gaf **409 — bestaat al**. De route werkt dus; het
   verzoek kwam door beide guards tot in de servicelaag.
2. Een telling op `clm.tenant` via `clm_migrator` gaf **0 rijen**.
3. Beide waar: `clm.tenant` heeft RLS **met FORCE**, en `clm_migrator` heeft
   geen `BYPASSRLS`. Zonder tenantcontext levert elke SELECT nul rijen.
4. Bewezen met een INSERT-proef die onvoorwaardelijk terugdraaide: de namen
   `AlingAdvies` én `Platformbeheer` geven `unique_violation`, een verzonnen
   naam niet. De rijen bestaan; ze zijn alleen onzichtbaar.

**Nul rijen betekende "je mag niets zien", niet "er staat niets".** Dat is
exact de meetfout van 2026-08-10, die toen tot dataverlies leidde. Dit ADR
bestaat mede om die val structureel te sluiten.

Het gevolg is een kip-eiprobleem: elke platformhandeling — `GET
/platform/tenants/:id`, `POST /platform/tenants/:id/toegang` — vraagt een
tenant-id, en er is geen weg om die id te achterhalen.

## Onderzoek

Nagezocht op 2026-08-13 (Perplexity, deep research, vijftien bronnen:
PostgreSQL-documentatie, Supabase, pgDash, Cybertec, Azure Database for
PostgreSQL, praktijkblogs). Vraag: hoe lossen bestaande productiesystemen
tenant-overstijgende platformadministratie op bij RLS met FORCE en een
applicatierol zonder `BYPASSRLS`?

| Patroon | Oordeel |
|---|---|
| Aparte rol met `BYPASSRLS` | "Meest robuuste en eenvoudig te begrijpen"; wat Supabase (`service_role`), Prisma en Azure doen |
| **Tenantlijst buiten RLS** | **"Bijzonder aantrekkelijk voor precies dit probleem"** |
| Apart platform-schema | Variant van bovenstaande, zelfde logica |
| `SECURITY DEFINER`-functie | Bruikbaar voor "smalle, goed gedefinieerde admin-functies", maar met valkuilen — niet als hoofdinstrument |
| Admin-conditie in de policy (`OR is_platform_admin`) | **Afgeraden in productie**: één `SET`-statement via SQL-injectie activeert de flag |

De doorslaggevende bevinding:

> *"De tenantlijst is globale metadata bij uitstek... Veel architecten kiezen
> ervoor om de tenantlijst als puur platformobject te beschouwen en deze
> daarom buiten RLS te houden."*

Dat patroon wordt in MCM2 **al toegepast**: `clm.platform_admin` en
`clm.sessie` staan bewust buiten RLS. `clm.tenant` doet dat niet, en daar komt
het probleem vandaan.

## Besluit

**Er komt een apart tenantregister: `clm.tenant_register`. Alleen id, naam en
aanmaakdatum. Geen RLS. Alleen leesbaar voor platformbeheer.**

De sleutelkolom heet **`register_id`**, niet `tenant_id`. Dat is geen
smaakkwestie: §7 van MCM2-CLAUDE.md verplicht RLS op elke tabel met een
`tenant_id`-kolom, en `schema-inventory.ts` leidt dat letterlijk uit de
kolomnaam af. Die regel is juist en mag voor deze ene tabel niet verzwakt
worden — hier is de uuid de sleutel van de registerrij, niet de tenant waartoe
de rij behoort. Gemeten: de eerste versie noemde de kolom `tenant_id` en drie
bewakingstests sloegen terecht aan.

`clm.tenant` blijft volledig ongemoeid — RLS, FORCE, alle policies. Er
verandert geen enkele bestaande regel aan de tenantgrens.

### Waarom een aparte tabel en niet de RLS van `clm.tenant` afhalen

Beide zijn verdedigbaar, en het onderzoek noemt de tweede zelfs directer. De
keuze viel op de aparte tabel omdat die **niets bestaands aanraakt**.
`clm.tenant` is een kerntabel; RLS eraf halen betekent een policy wijzigen en
daarna via `GRANT`/`REVOKE` opnieuw dichtzetten wat de policy deed. Dat vraagt
verificatie op elke rol, en een fout daarin is een cross-tenant lek.

De aparte tabel kost een synchronisatieplicht — twee plekken die gelijk moeten
blijven — en die wordt met een trigger opgelost, niet met applicatiecode. Een
trigger kan niet vergeten worden bij een tweede schrijfweg.

### Waarom geen `BYPASSRLS`-rol

Het onderzoek noemt dit het robuustste patroon, en voor een platform met een
apart beheerkanaal is dat juist. Hier niet, om twee redenen:

**Het is een loper voor een telefoonlijst.** Wat ontbreekt is een lijst
namen — niet toegang tot klantdata. Die toegang bestaat al, via ADR-015, mét
auditspoor en verval. Een rol die álles mag lezen zou dat mechanisme kunnen
omzeilen.

**Er is geen apart beheerkanaal.** Supabase's `service_role` werkt omdat hij
alleen in back-end processen draait. MCM2 heeft één applicatie; een
`BYPASSRLS`-rol zou in dezelfde codebase leven als het klantverkeer, en het
onderzoek noemt precies dat de belangrijkste faalvorm.

### Waarom geen `SECURITY DEFINER`-functie

Dit was het patroon dat bij het bouwen als eerste voor de hand lag, omdat
`clm.resolve_survey_token()` (migratie 0003) het al gebruikt. Het onderzoek
plaatst dat in perspectief: bruikbaar voor smalle gevallen, maar met
`search_path`-manipulatie als reëel risico en lastig te debuggen. Voor een
leesbare lijst van drie kolommen is een tabel zonder RLS eenvoudiger én beter
te controleren.

### Waarom geen admin-conditie in de policy

Afgeraden in productie. Eén SQL-injectie die `SET app.is_platform_admin =
'true'` weet uit te voeren, heft de tenantgrens op álle tabellen op. Dit is de
enige optie die het onderzoek onomwonden afwijst.

## Verhouding tot ADR-015

ADR-015 stelt: **"Platformbeheer krijgt geen leesrecht over tenants heen."**

Dit ADR nuanceert dat, en die nuance moet expliciet zijn:

| Wat | ADR-015 | Dit ADR |
|---|---|---|
| Klantdata (leveranciers, antwoorden, oordelen) | alleen via `support`, tijdelijk, met reden | **ongewijzigd** |
| Bestaan van een tenant (id + naam + datum) | niet geregeld | leesbaar voor platformbeheer |

Het uitgangspunt van ADR-015 blijft dus staan: **wie in de data van een tenant
wil, wordt tijdelijk lid van díé tenant.** Wat erbij komt is uitsluitend de
telefoonlijst die dat mechanisme bruikbaar maakt — zonder id kun je `/toegang`
niet eens aanroepen.

Dat het register geen klantdata bevat is geen bijzaak maar de kern van deze
afweging. Komt er ooit een kolom bij die iets over de klant zégt (aantal
gebruikers, laatste activiteit, abonnement), dan is dat een nieuw besluit —
niet een uitbreiding van dit ADR.

## Gevolgen

### Voor de tenantgrens

Geen. `clm.tenant` houdt RLS en FORCE; geen policy wijzigt; `clm_api_runtime`
krijgt geen enkel recht op het register.

### Voor het informatielek

Wie het register kan lezen, ziet dat andere tenants bestaan en hoe ze heten.
Het onderzoek noemt dit expliciet als afweging. Hier aanvaardbaar: alleen
platformbeheerders kunnen lezen, en dat zijn dezelfde mensen die via ADR-015
toch al in een tenant mogen kijken.

### Voor de synchronisatie

Een trigger op `clm.tenant` houdt het register bij. Bewust een trigger en geen
applicatiecode: `platform.service.ts` is vandaag de enige schrijfweg, maar een
seed, een migratie of een herstelactie is dat morgen ook.

## Tegenproeven

Bij de migratie aan te tonen, geen ervan optioneel:

1. Een nieuwe tenant via `POST /platform/tenants` verschijnt in het register.
2. `clm_api_runtime` kan het register **niet** lezen — `permission denied`.
3. Het register bevat geen enkele kolom met klantgegevens.
4. Een tenant die buiten de route om ontstaat (rechtstreekse INSERT) komt er
   ook in — de trigger vangt dat, geen applicatiecode.
5. `clm.tenant` geeft nog steeds nul rijen zonder tenantcontext; de tenantgrens
   is ongewijzigd.
