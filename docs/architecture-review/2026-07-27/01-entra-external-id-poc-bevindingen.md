# Entra External ID PoC — technische bevindingen (2026-07-27)

## Status: PoC geslaagd — volledige federatieketen werkt end-to-end

Dit document legt vast wat is opgebouwd voor de Entra External ID-proof-of-concept
(zie ADR-006, herzien), wat aantoonbaar werkt, en welke diagnose is uitgevoerd op een
tijdelijke blokkade die uiteindelijk vanzelf verdween zonder configuratiewijziging.
Bedoeld als startpunt voor de volgende sessie — niet opnieuw vanaf nul beginnen.

---

## Opzet: wat er staat

### Tenant `alingadvies.nl` (bestaande workforce-tenant, tenant-ID `3ce5523c-cc8b-4422-a310-8bdfa3715168`)

Twee app-registraties:

1. **`MCM2-Cognito-Federation`** (client ID `d369dcf9-26ec-4b6d-8a58-911884891107`) —
   overblijfsel van de losgelaten Cognito-poging (zie ADR-006). Niet meer in gebruik,
   niet verwijderd. Kan later opgeruimd worden.
2. **`mcm2ciam-federation-trust`** (client ID `aab9af4b-ae9f-4a30-945f-4ed199879a83`) —
   de app-registratie die de federatie met `mcm2ciam` daadwerkelijk draagt. Bevat:
   - Redirect URI's (Web-platform):
     - `https://mcm2ciam.ciamlogin.com/17b5535b-0a0b-4025-b381-b50b462496bc/federation/oauth2`
     - `https://mcm2ciam.ciamlogin.com/mcm2ciam.onmicrosoft.com/federation/oauth2`
   - API permissions (Microsoft Graph, delegated, admin consent verleend):
     `User.Read`, `email`, `openid`, `profile`
   - Client secret aangemaakt (waarde bij de eigenaar bewaard, niet in dit document
     of de git-historie)

### Tenant `mcm2ciam.onmicrosoft.com` (nieuwe Entra External ID-tenant, tenant-ID `17b5535b-0a0b-4025-b381-b50b462496bc`)

- Aangemaakt onder een nieuwe Azure Pay-As-You-Go-subscription (`MCM2-CIAM-PoC`),
  resource group `rg-mcm2-ciam`, regio Germany West Central (West Europe niet
  beschikbaar voor dit resourcetype). Budget alert ingesteld (€10, 50%/80%-drempels).
- App-registratie **`mcm2-api-poc`** (client ID `df9055c4-891d-4461-a518-dbfb3cef470d`) —
  de "relying party"-app die de user flow test. Redirect URI: `https://jwt.ms`
  (Microsoft's eigen tokeninspectiepagina, toegevoegd na een eerste "geen reply URL"-fout).
- Externe identity provider **"Sign in with AlingAdvies"** (Custom OIDC, onder
  External Identities → All identity providers → Custom):
  - OpenID Issuer URI: `https://login.microsoftonline.com/3ce5523c-cc8b-4422-a310-8bdfa3715168/v2.0`
  - Well-known endpoint: `https://login.microsoftonline.com/organizations/v2.0/.well-known/openid-configuration`
  - Client ID: `aab9af4b-ae9f-4a30-945f-4ed199879a83`
  - Client Authentication: `client_secret_post`
  - Client Secret: waarde van `mcm2ciam-federation-trust` (**let op** — een eerste
    poging gebruikte per ongeluk het "Secret ID" in plaats van de "Value"; dat is
    hersteld door een nieuw secret aan te maken en de juiste Value in te vullen)
- User flow **`mcm2-admin-signin`** (Sign up and sign in), met:
  - Identity provider: "Sign in with AlingAdvies" aangevinkt
  - Collect attribute: Email Address, Surname (geen "Return claim"-kolom aanwezig
    in deze versie van de wizard — normaal, geen fout)
  - Applications: `mcm2-api-poc` gekoppeld

---

## Wat aantoonbaar werkt

De volledige keten is end-to-end doorlopen en geslaagd op 2026-07-27:

1. **"Run user flow"** toont de knop "Sign in with AlingAdvies" op het inlogscherm
   (na een eerdere propagatievertraging: uitvinken/opslaan/aanvinken/opslaan als
   workaround toegepast).
2. **Federatie-redirect** naar `alingadvies.nl`'s eigen inlogscherm werkt.
3. **Authenticatie** met `kees@alingadvies.nl` + Microsoft Authenticator (MFA) slaagt.
4. **Callback** naar `mcm2ciam-federation-trust`'s redirect endpoint (`/federation/oauth2`),
   HTTP 200 — zichtbaar in de Network-trace als `ProcessAuth` → `oauth2`.
5. **Attribute collection** ("Add details", Surname-veld) laadt en verstuurt correct:
   het `POST .../common/validateuserattributes`-request (fetch, HTTP 200, 4.0 kB)
   is waargenomen in de Network-tab onder het Fetch/XHR-filter.
6. **Gebruikersaanmaak in `mcm2ciam`** en aflevering van een geldige authorization code
   op de reply-URL:
   `https://jwt.ms/?code=1.AbMAW1O1Fw...&session_state=006ef65a-...`
   Geen `error=`-parameter. Dit is het bewijs dat de PoC geslaagd is.

**Waarom `jwt.ms` er leeg uitzag ondanks succes:** de user flow is geconfigureerd met
`Response type: code` (authorization code flow). Daarbij komt er géén token in het
URL-fragment, maar een authorization code die server-to-server ingewisseld moet worden.
`jwt.ms` leest alleen tokens uit het fragment en blijft daarom leeg. Dit is correct
gedrag, geen fout — de `?code=`-parameter in de adresbalk is het daadwerkelijke resultaat.

## Tijdelijke blokkade — opgetreden en verdwenen, oorzaak niet vastgesteld

Tussen de eerste pogingen en de geslaagde run trad een blokkade op die het vastleggen
waard is, omdat hij zich mogelijk opnieuw voordoet.

**Symptoom:** op het attribute-collection-scherm ("Add details" / Surname) deed de
**Next**-knop niets zichtbaars — geen navigatie, geen foutmelding, en geen nieuw
request zichtbaar in de Network-tab. De **Cancel**-knop op hetzelfde scherm werkte wel
(produceerde correct `?error=access_denied&error_subcode=cancel` naar de reply-URL).
Een handmatige reload op dat punt gaf `AADSTS900144: The request body must contain the
following parameter: 'state'` — dat is een bijwerking van de reload zelf (de OAuth
`state` gaat verloren), geen aanwijzing voor de onderliggende oorzaak.

**Hoe het is opgelost:** het is **niet** opgelost door een configuratiewijziging.
Tussen de laatste mislukte en de eerste geslaagde poging is niets aan de Entra-,
app-registratie- of user-flow-configuratie gewijzigd. Het verschil was een **verse
incognito-sessie** en een Network-tab gefilterd op Fetch/XHR.

**Onderzochte en uitgesloten oorzaken.** Op basis van Microsoft Learn-documentatie zijn
drie hypotheses onderzocht en alle drie weerlegd door inspectie van de daadwerkelijke
configuratie:

| Hypothese | Uitkomst |
|---|---|
| Ontbrekende `email` optional claim op `mcm2ciam-federation-trust` (Token configuration) | **Weerlegd** — `email`, `family_name` en `given_name` stonden er al, en `email` staat op token type **ID** (het enige type dat External ID leest) |
| Ontbrekende/onvolledige Claims mapping op de OIDC-provider in `mcm2ciam` | **Weerlegd** — de mapping was al correct vooringevuld met de OIDC-standaardnamen (`sub`, `name`, `given_name`, `family_name`, `email`, `email_verified`); er viel niets te wijzigen |
| Ontbrekende "Return claim"-kolom in de user-flow-wizard | **Weerlegd als probleem** — die kolom bestaat correct niet in external tenants (dat is workforce-tenant-documentatie). In external tenants worden tokenclaims elders geconfigureerd: App registrations → Attributes & Claims |

**Serverside diagnose was niet beschikbaar.** De external tenant biedt geen
**Sign-up logs** (menu-item ontbreekt; mogelijk niet uitgerold of licentie-afhankelijk —
tenant draait op Microsoft Entra ID Free). De reguliere **Sign-in logs** bevatten
uitsluitend de eigen beheersessies (Application: "Azure Portal"), geen enkele regel voor
`mcm2-api-poc` — consistent met een flow die strandt vóór gebruikersaanmaak en dus geen
sign-in-event genereert.

**Meest plausibele verklaring, niet bewezen:** sessie-/statevervuiling uit eerdere
afgebroken pogingen (meerdere half-voltooide flows, reloads middenin een OAuth-sessie).
Dit is een vermoeden op basis van het feit dat een schone incognito-sessie het enige
verschil was — er is geen bewijs voor. Genoteerd als waarschuwing, niet als vastgestelde
oorzaak.

**Praktische les voor volgende keer:** test deze flow altijd in een verse
incognito-sessie, doorloop hem in één keer zonder reloads, en filter de Network-tab op
**Fetch/XHR** met zoekterm `validate` om `validateuserattributes` te kunnen zien — dat
request is een fetch, geen navigatie, en is in een ongefilterde lijst makkelijk te missen.

---

## Eerstvolgende concrete stappen

1. **Authorization code inwisselen voor tokens** (server-to-server, `POST` naar het
   `/token`-endpoint van `mcm2ciam` met de code, client ID en PKCE-verifier). Pas daarna
   zijn de daadwerkelijke claims zichtbaar. Dit hoort thuis in de NestJS-backend, niet in
   een browsertest.
2. **Claims inspecteren** in het verkregen ID-token — met name `email`, `sub`, `oid`,
   `tid`. Dat bepaalt hoe de backend de tenant en membership kan afleiden (de kern van
   Issue #7).
3. **NestJS-guard bouwen** die het ID-token verifieert tegen de JWKS van `mcm2ciam` en de
   tenantcontext daaruit afleidt — in plaats van uit een ongeverifieerde header. Bouw dit
   config-gedreven (issuer-URL, JWKS-endpoint, client ID als environment-variabelen), zodat
   een latere verhuizing naar een Bizaline-tenant een configuratiewijziging blijft.
4. **Opruimen:** de ongebruikte app-registratie `MCM2-Cognito-Federation` in
   `alingadvies.nl` (overblijfsel van de losgelaten Cognito-poging) kan verwijderd worden.
   Het AWS-account `727732213368` is niet meer nodig voor identity — er zijn geen
   Cognito-resources aangemaakt, dus er valt niets af te breken.

## Wat dit niet oplost (ter herinnering, uit ADR-006)

Deze PoC bewijst het technische Cognito-vrije federatiepatroon met `alingadvies.nl`
als voorbeeldtenant. Het lost niet op: (a) of Transdev's eigen IT-afdeling een
vergelijkbare app-registratie in hún tenant kan/wil aanmaken — aparte, latere
afhankelijkheid; (b) het tokengebaseerde externe-leverancier-mechanisme uit
Issue #7 (spoor 2) — staat hier volledig los van.
