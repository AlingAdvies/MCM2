# ADR-015 — Platformbeheer-toegang tot klant-tenants

**Status:** aanvaard
**Datum:** 2026-08-08
**Sluit:** Issue #57
**Raakt:** ADR-013 (rollen binnen een tenant), migratie 0009, MCM2-CLAUDE.md §6, §7.7

---

## Context

Migratie 0009 legt vast: **één actief membership per gebruiker**, afgedwongen
met een unieke index. Bewust de strengste stand, met in het commentaar al de
uitweg benoemd — *"alleen platformbeheer heeft meerdere tenants nodig, en dat
vraagt een eigen, auditbaar mechanisme (Issue #57)"*.

Dat moment is er. De eigenaar wil een tenant kunnen aanmaken vanuit de
applicatie, en op termijn een helpdesk bemensen die in een klantomgeving kan
meekijken. Vandaag gebeurt dat via directe databasetoegang, buiten de
applicatie om.

Issue #57 stelt de kern scherp:

> Support-toegang tot klantdata is een wezenlijk ander soort toegang dan gewone
> gebruikerstoegang, en hoort ook als zodanig zichtbaar te zijn. Een
> platformbeheerder een gewone `tenant_membership`-rij geven zou hem in de audit
> trail ononderscheidbaar maken van een medewerker van de klant.

## Onderzoek

Nagezocht op 2026-08-08, twintig bronnen: ISO/IEC 27001:2022 (A.8.15 logging,
A.8.16 monitoring), SOC 2 Trust Services Criteria (CC6.2 system access, CC6.3
authorization, CC7.2 ongoing monitoring), en de feitelijke praktijk bij Okta,
Atlassian, Microsoft 365, Google Workspace, AWS Support, Zendesk, Adobe
Commerce en Broadcom.

De uitkomst is eenduidig voor kleinschalige B2B SaaS op PostgreSQL met RLS:

| Patroon | Oordeel 2025–2026 |
|---|---|
| Alziende platformrol over alle tenants | Alleen nog als **break-glass** voor noodgevallen |
| Just-in-time, tenant-scoped toegang | **Aanbevolen** |
| Impersonatie ("log in as customer") | Gangbaar, maar omgeven met waarborgen; af te raden waar een leesrol volstaat |

Twee bevindingen wegen door:

**Toerekening.** Authress noemt impersonatie "insecure by design". Het bezwaar
is niet techniek maar boekhouding: wie een handeling verricht terwijl hij een
klantgebruiker imiteert, laat die handeling op naam van die klantgebruiker
achter. In een product waar *"wie keurde dit goed"* de kernvraag is, is dat
onaanvaardbaar. AWS en Broadcom gebruiken daarom een aparte, herkenbare
supportrol.

**Duur.** Okta hanteert 24 uur voor support-impersonatie; Microsoft trekt
diagnostische toegang in bij het sluiten van de case, met 30 dagen als
bovengrens. De literatuur adviseert uren tot één werkdag als standaard.

## Besluit

**Platformbeheer krijgt geen leesrecht over tenants heen. Wie moet meekijken,
wordt tijdelijk lid van díé ene tenant, in een eigen rol.**

Vier onderdelen:

### 1. `clm.platform_admin` — wie is platformbeheerder

Een aparte tabel, geen kolom op `clm."user"`. Platformbeheerder-zijn is een
eigenschap tegenover het plátform, niet tegenover de tenant waar iemand
administratief thuishoort. De tabel staat bewust buiten RLS: hij hoort bij geen
enkele tenant.

### 2. `support` als derde rol in `tenant_membership`

Naast `admin` en `reviewer`. Een **leesrol**: meekijken zonder wijzigen.

Dit is het antwoord op de eis uit Issue #57. Een platformbeheerder die als
`support` in de trail staat is per definitie te onderscheiden van een
medewerker van de klant — precies wat een gewone membership-rij níét zou doen.

### 3. Toegang verloopt

`verloopt_op`, `reden` en `toegekend_door` op `tenant_membership`. `NULL` in
`verloopt_op` is een gewoon, blijvend membership; een waarde maakt het
tijdelijk. Standaard acht uur.

**Toegang is een gebeurtenis, geen toestand.**

### 4. De unieke index vervalt voor `support`

`tenant_membership_een_actief_per_gebruiker` wordt partieel op
`role <> 'support'`. Een gewone gebruiker houdt daarmee exact de bescherming
van 0009 — één actieve tenant, ook bij een bug in de applicatielaag. Alleen een
supportrol mag ernaast bestaan.

Dat is nauwer dan de `DROP INDEX` die 0009 voorzag, en dus veiliger: de
versoepeling geldt alleen voor de rol waarvoor ze bedoeld is.

## Wat de tenantgrens blijft doen

Ongewijzigd. Geen uitzondering in RLS, geen `BYPASSRLS`, geen aanpassing aan
`TenantContextGuard`. Een supportsessie doorloopt exact hetzelfde pad als een
klantsessie: de tenant komt uit een gehashte lookup op het sessiecookie, nooit
uit de invoer.

Dat is de winst van dit ontwerp ten opzichte van een alziende rol: RLS
beschermt ook tegen een verkeerd geschreven supportquery. Bij een
superuser doet het dat niet.

## Gevolgen

### Voor de audit trail

Het toekennen van support-toegang wordt vastgelegd in `audit.audit_event`
(append-only, §7.7): wie, welke tenant, welke reden, tot wanneer. Het membership
zelf is daarnaast zijn eigen spoor — het staat in de ledenlijst van de tenant.

### Voor de klant

Zichtbaar in de ledenlijst. Een supportmedewerker verschijnt daar met rol
`support` en een einddatum.

### Voor de AVG

Support-toegang tot persoonsgegevens van klantmedewerkers en
leverancierscontacten hoort in de verwerkersovereenkomst. Dit ADR levert de
technische onderbouwing; de contractuele kant is een aparte actie en **nog
niet gedaan**.

## Wat nu niet gebouwd wordt

Er zijn nog geen betalende tenants. Uitgesteld, niet vergeten:

- Een scherm waarop de tenant ziet wie er toegang had
- Melding aan de tenant bij toekenning
- Goedkeuring door een tweede persoon
- Logs buiten de database (WORM/SIEM) — nu staan ze op dezelfde Supabase
- Automatische opruiming van verlopen rijen (nu: filteren bij lezen)

Deze worden actueel zodra er een tenant is die niet van onszelf is. Een
meldmail aan jezelf is theater.

**Het auditspoor is de uitzondering en wordt nu al gebouwd.** Een gebeurtenis
die niet is vastgelegd, is achteraf niet te herstellen; een scherm is over drie
maanden net zo goedkoop.

## Alternatieven, en waarom niet

| Alternatief | Waarom niet |
|---|---|
| Alziende platformrol | Standing privilege over alle tenants; door de literatuur teruggebracht tot break-glass. Eén gecompromitteerde sessie raakt élke klant. |
| Impersonatie ("log in as") | Toerekening: handelingen komen op naam van de klantgebruiker. Dodelijk in een product dat over goedkeuren gaat. |
| Klant moet elke keer goedkeuren | Netst, maar je kunt niet helpen als de klant juist niet binnenkomt — en dat is vaak het supportgeval. Later toe te voegen als optie. |
| `DROP INDEX` zoals 0009 voorzag | Zou de bescherming voor álle gebruikers opheffen. De partiële variant beperkt de versoepeling tot `support`. |

## Tegenproeven

Bij migratie 0020 aan te tonen, geen ervan optioneel:

1. Een membership met verstreken `verloopt_op` geeft **nergens** toegang.
2. `support` kan lezen maar niet schrijven.
3. Een gewone gebruiker kan nog steeds géén tweede actief membership krijgen.
4. Het toekennen staat in `audit.audit_event`.
