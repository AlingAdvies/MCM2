# MCM2 — normatieve architectuur

> **Wat dit document is.** De korte, actuele samenvatting van wat het systeem
> *nu* garandeert — niet hoe we erbij kwamen. Elke bewering hieronder wijst
> naar code, een test of een commando waarmee ze te verifiëren is; er staat
> geen mening in. Geschiedenis, alternatieven en de argumentatie achter een
> keuze staan in de ADR's (`docs/adr/`) en `docs/STATUS.md` — dit document
> vervangt die niet, het is de plek waar je begint.
>
> **Wat dit document niet is.** Geen inleiding tot het project (zie
> `CLAUDE.md`/`MCM2-CLAUDE.md`), geen changelog (zie `docs/STATUS.md`), geen
> vervanging van een ADR. Wijzig een garantie hieronder nooit stilzwijgend in
> een feature-PR — dat gaat altijd via een nieuwe of herziene ADR.
>
> **Bijgewerkt:** 2026-08-28, naar aanleiding van een externe
> architectuurbeoordeling op de graphify-kennisgraaf van backend + frontend.
> Die beoordeling adviseerde expliciet: *"de belangrijkste investering vanaf
> hier is het voorkomen dat de opgebouwde kennis versnipperd raakt — houd de
> actuele architectuur compact, normatief en toetsbaar, en behandel de
> kernketens als formele platformcontracts."* Dit document is dat.
> (`docs/architecture-review/2026-08-28-graphify-architectuurbeoordeling.md`)
>
> **Houd dit actueel.** Een garantie die hier staat maar niet meer klopt is
> gevaarlijker dan geen document. Wijzig je code die een garantie hieronder
> raakt (de guard, de rolrechten, FORCE RLS, de vier remmen), werk dan deze
> pagina bij in dezelfde PR — net zoals `docs/runbooks/backup-verwachting.json`
> bij elke schemawijziging bijgewerkt hoort te worden.

---

## Hoe een contract hier werkt

Elk platformcontract hieronder volgt hetzelfde vaste patroon:

- **Garantie** — één zin: wat wordt beloofd, aan de rest van het systeem.
- **Wordt afgedwongen door** — de exacte code die dit waarmaakt.
- **Wordt bewezen door** — de tests die falen zodra de garantie breekt.
- **Mag gewijzigd worden via** — de ADR('s) die hierover gaan.

Vier contracten dekken de grenzen waar een fout het duurst is: wie de tenant
bepaalt, wie ingelogd is, wat de database wel/niet toestaat, en hoe code
productie bereikt.

---

## Contract 1 — Tenantcontext & database-toegang

**Garantie.** De actieve tenant komt uitsluitend uit een server-side,
gehashte lookup tegen de database (sessiecookie of surveytoken) — nooit uit
een client-gestuurde header, query-parameter of body-veld. Zonder een
expliciet gezette tenantcontext levert elke tenantgebonden query nul rijen
op, nooit een fout die per ongeluk alles teruggeeft.

**Wordt afgedwongen door**
- `src/auth/tenant-context.guard.ts` — `TenantContextGuard.canActivate()`
  leest uitsluitend het sessiecookie, lost het serverzijdig op, en weigert
  (`401`) bij al het overige. Geen enkel pad leest een header of
  query-parameter.
- `src/db/database.service.ts` — `onModuleInit()` weigert te starten als de
  actieve databaserol `BYPASSRLS` heeft. `withTenant()` is de enige plek die
  een transactie opent, zet `SET LOCAL app.current_tenant_id` als eerste
  statement, en valideert de tenant-id-vorm vóór gebruik.
- Domeincode gebruikt uitsluitend `withTenant()` — geen andere plek opent
  zelf een databaseclient (MCM2-CLAUDE.md §8).

**Wordt bewezen door**
- `test/tenant-context-guard.e2e-spec.ts` — negeert een tenant in header of
  query-parameter, valt niet terug op zo'n header bij een ongeldig cookie.
- `test/tenant-rls-isolation.e2e-spec.ts` en
  `test/drizzle-tenant-context.e2e-spec.ts` — rechtstreeks tegen de database:
  geen `BYPASSRLS`-rol, geen rijen zonder tenantcontext, een cross-tenant
  write wordt geweigerd door de `WITH CHECK`-policy, geen lek van context
  naar een volgende transactie.

**Mag gewijzigd worden via** ADR-006, ADR-008, ADR-016.

---

## Contract 2 — Sessie & authenticatie

**Garantie.** Interne gebruikers loggen in via OIDC met PKCE tegen een
provider-agnostische configuratie. Na verificatie van het ID-token krijgt de
browser een willekeurig, betekenisloos sessietoken in een `httpOnly`-cookie;
alleen de SHA-256-hash ervan staat in de database, en de sessie verloopt
server-side na 8 uur inactiviteit (glijdend venster).

**Wordt afgedwongen door**
- `src/auth/auth.service.ts` — vaste volgorde: token inwisselen → ID-token
  verifiëren → pas dan een sessie aanmaken.
- `src/auth/id-token-verificatie.ts` — `jose`'s `jwtVerify()`, controleert
  issuer/audience, staat alleen asymmetrische algoritmen toe (nooit
  `alg:none` of HS256), leest de stabiele `oid`-claim (niet `sub`).
- `src/auth/sessie.ts` — cookienaam `__Host-mcm2_sessie` (vereist `secure`,
  geen `Domain`, pad `/`), `httpOnly` vast aan, `sameSite: 'lax'`, `secure`
  standaard aan (alleen uit via `SESSIE_COOKIE_INSECURE=true`, nooit in
  acceptatie/productie).
- Migratie `0010_sessie.sql` — tabel `clm.sessie` is volledig dicht voor de
  runtime-rol (`REVOKE ALL`); toegang uitsluitend via drie
  `SECURITY DEFINER`-functies (zie Contract 3).

**Wordt bewezen door**
- `test/sessie.e2e-spec.ts` — de tabel is dicht voor de runtime-rol; elke
  sessiefunctie apart getest.
- `test/tenant-context-guard.e2e-spec.ts` — een beëindigde of verlopen sessie
  wordt geweigerd, het venster schuift op bij gebruik, het ruwe sessietoken
  gaat nooit naar de controller.
- `test/sessie-route.e2e-spec.ts` — `GET /auth/sessie` stuurt geen
  tenantId/userId/sessieId of het ruwe token terug.
- `test/eerste-login.e2e-spec.ts` — de koppelflow voor uitgenodigde
  gebruikers werkt precies één keer en bewaart geen sleutelmateriaal in de
  audit trail.

**Mag gewijzigd worden via** ADR-006, ADR-016.

---

## Contract 3 — Database-rollen & RLS

**Garantie.** De applicatie draait altijd als een runtime-rol zonder
`BYPASSRLS` en zonder ownership. RLS geldt met `FORCE` ook voor de
tabeleigenaar, op elke tenanttabel behalve een kort, bewust gedocumenteerd
lijstje. Elke uitzondering is uitsluitend bereikbaar via smalle,
`search_path`-vastgezette `SECURITY DEFINER`-functies met expliciete
`GRANT EXECUTE`.

**Rollen** (`db/roles/bootstrap-roles.sql`): `clm_api_runtime` (`LOGIN`,
erft van `clm_api`) is de rol waarmee de applicatie draait, nooit
`BYPASSRLS`. `clm_migrator` (`LOGIN`, eigenaar van de schema's) is
uitsluitend voor migraties. `clm_readonly`/`clm_audit_reader` zijn
alleen-lezen-groepen. Audit is append-only: `clm_api`/`clm_admin` krijgen op
`audit` alleen `SELECT, INSERT`, nooit `UPDATE`/`DELETE`.

**Wordt afgedwongen door**
- `src/db/database.service.ts` — weigert te starten bij `rolbypassrls = true`
  op de actieve rol.
- `drizzle/0011_force_row_level_security.sql` — `FORCE ROW LEVEL SECURITY`
  op acht tenanttabellen plus `audit.audit_event`. Vijf tabellen krijgen
  bewust géén FORCE (`clm."user"`, `clm.tenant_membership`,
  `clm.survey_response`, `clm.survey_run`, `clm.vendor`) omdat de
  `SECURITY DEFINER`-functies eronder die tabellen moeten kunnen lezen vóórdat
  een tenantcontext bestaat.

**Alle `SECURITY DEFINER`-functies** (kip-ei-oplossingen: een lookup die moet
gebeuren vóórdat de tenantcontext bekend is — zie MCM2-CLAUDE.md §6 voor de
kwartaal-auditeis):

| Functie | Migratie | Reden |
|---|---|---|
| `clm.resolve_survey_token` | 0003 (herzien 0006, 0008) | Leverancierstoken-lookup vóór tenantcontext |
| `clm.gebruiker_bij_subject` | 0009 | Gebruiker+membership zoeken op external_subject |
| `clm.sessie_aanmaken` | 0010 (herschreven 0033) | Sessie aanmaken, kip-ei bij login |
| `clm.sessie_oplossen` | 0010 | Sessie-lookup bij elk verzoek — heetste route |
| `clm.sessie_beeindigen` | 0010 | Sessie beëindigen + opruimen |
| `clm.koppel_eerste_login` | 0023 (herzien 0024) | Oid koppelen aan wachtende gebruikersrij |
| `clm.tenant_register_bijhouden` | 0026 (herschreven 0033) | Trigger, houdt tenantregister gelijk (ADR-017) |
| `clm.sessie_wisselen` | 0033 | Tenant wisselen binnen sessie (support-toegang) |
| `clm.eigen_tenant_vinden` | 0033 | Blijvende tenant vinden na support-toegang |
| `clm.gebruikersnaam` | 0033 | Naam ophalen los van tenantcontext |

Alle bovenstaande zetten expliciet `SET search_path = clm, pg_temp` en
volgen `REVOKE ALL ... FROM PUBLIC` + gerichte `GRANT EXECUTE`.

**Wordt bewezen door**
- `test/schema-conformiteit.e2e-spec.ts` — RLS + FORCE op elke tenanttabel,
  de FORCE-uitzonderingenlijst blijft kort en bewust, elke uitzondering heeft
  wél gewone RLS met policies, elke `SECURITY DEFINER`-functie heeft een
  expliciete `search_path`, draait niet als tabel-eigenaar, elke
  tenantgebonden tabel heeft zowel `USING` als `WITH CHECK`.

**Mag gewijzigd worden via** ADR-008, ADR-009, ADR-010, ADR-017.

---

## Contract 4 — Deployment & backup/herstel

**Garantie.** Elke uitrol naar productie doorloopt vier remmen: handmatig
akkoord, actueel backupbewijs, vastgestelde migratiestand vóór/na, en
aantoonbaar terugdraaibaar. De enige backup tijdens de pilotfase is een
eigen dagelijkse `pg_dump` met dagelijkse geautomatiseerde controle en
periodieke restore-test — niet een providerbackup.

**De vier remmen** (`.github/workflows/productie-aws.yml`)
1. **Handmatig akkoord** — GitHub Environment `productie` met verplichte
   reviewer; pauzeert de uitrol tot goedkeuring.
2. **Backup vooraf** — `scripts/productie-poort.js` weigert bij ontbrekend
   bewijs, een bewijs ouder dan 36 uur, of een bewijs dat zelf problemen
   meldde (`docs/runbooks/backup-bewijs.json`).
3. **Migratiestand** — vastgelegd vóór de uitrol, na de uitrol teruggelezen
   uit de database en vergeleken met het journal — nooit de meldtekst
   geloofd (`scripts/migratiestand.js`).
4. **Terugdraaien** — de vorige image-tags staan al klaar vóór de uitrol
   begint; rollback is dezelfde workflow met de vorige tag. Een
   verwijderende migratie is met alleen een rollback niet te herstellen —
   dan is een backuprestore nodig.

**Backup/herstel**
- Drie lagen (`docs/runbooks/backupcontrole.md`): A — dump jonger dan 36 uur
  (dagelijks 07:00). B — volledigheid tegen
  `docs/runbooks/backup-verwachting.json` (dagelijks 07:30). C — echte
  restore in een wegwerpcontainer (wekelijks, maandag 07:45). Draait via
  Windows Taakplanner op de laptop van de eigenaar, niet via CI.
- Normen per fase (ADR-011): pilotfase — RPO 24 uur, RTO 4 uur, restore
  maandelijks hertest. Betalende klanten — RPO 15 min, RTO 2 uur, restore
  elk kwartaal plus minstens één bewezen herstel naar een ander
  project/regio.

**Wordt bewezen door** de CI-workflow zelf (`productie-poort.js` faalt de
pipeline zichtbaar bij een gebroken rem), `docs/runbooks/backup-bewijs.json`
als gegenereerd bewijsbestand, en het meetregister in
`docs/runbooks/supabase-verificatie-en-restoretest.md`.

**Mag gewijzigd worden via** ADR-011.

---

## Extra — huidige productieopstelling (AWS)

*Feitelijke stand, geen garantie — dit verandert vaker dan de contracten
hierboven en hoort bij elke wijziging hier bijgewerkt te worden.*

**AWS.** Account "AlingAdvies", regio `eu-west-1`. **ECS Express Mode** (App
Runner is losgelaten — accepteert sinds 30-04-2026 geen nieuwe klanten meer).
Twee ECS-services: `mcm2-api` (backend) en `web-23bd` (frontend), cluster
`default`. Custom domain `clm.alingadvies.nl`, login end-to-end bevestigd
sinds 2026-08-20. S3-bucket `mcm2-deploy-eu-west-1`. Laatste bevestigde
productie-uitrol: 2026-08-28 (migratie 0034, Coupa-schema-uitbreiding).

**Supabase.** Beide projecten `eu-west-1`, Postgres 17.6, **Free plan**
(bewuste risicoacceptatie, ADR-011 — geen providerbackup, pauzeert na ~7
dagen inactiviteit, gemitigeerd door de eigen dagelijkse dump).

| | Productie | Staging |
|---|---|---|
| Project | `clm-enterprise` | `clm-staging3` |
| Ref | `agojesdovwsupidwlevh` | `ljdldwfylcbubzglxjoa` |

**GHCR.** Images `ghcr.io/alingadvies/mcm2/api` en
`ghcr.io/alingadvies/mcm2-frontend/web`, getagd met de korte commit-SHA.
Token verloopt rond 8 november 2026 (zie `CLAUDE.md`).

**Entra.** CIAM-domein `mcm2ciam.ciamlogin.com`. Redirect-URI productie:
`https://clm.alingadvies.nl/api/backend/auth/callback`.

---

## Bij conflicten

Zelfde volgorde als `CLAUDE.md` en `MCM2-CLAUDE.md` §14 — dit document staat
ertussen: het is normatiever dan een los plan, maar wijkt voor een expliciete
actuele blokkade of het runbook over wat technisch kan en mag.

```text
Security en actuele blokkades
  -> docs/runbooks/commandos-en-omgeving.md   (wat technisch kan en mag)
    -> dit document (docs/ARCHITECTUUR.md)     (wat het systeem garandeert)
      -> MCM2-CLAUDE.md                        (hoe we werken)
        -> actuele ADR's en docs/STATUS.md
          -> projectdocumentatie
            -> oude plannen, pilots en sessiehistorie
```
