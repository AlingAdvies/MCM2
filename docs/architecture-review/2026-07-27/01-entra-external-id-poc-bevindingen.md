# Entra External ID PoC — technische bevindingen (2026-07-27)

## Status: federatie werkt, sign-up-flow loopt vast op een clientside UI-fout

Dit document legt vast wat is opgebouwd voor de Entra External ID-proof-of-concept
(zie ADR-006, herzien), wat aantoonbaar werkt, en waar de flow precies vastloopt.
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

1. **De hele OIDC-federatieketen tot en met token-uitgifte door `alingadvies.nl`**:
   - "Run user flow" toont de knop "Sign in with AlingAdvies" op het inlogscherm
     (na een eerdere propagatievertraging: uitvinken/opslaan/aanvinken/opslaan als
     workaround toegepast).
   - Klikken daarop redirect correct naar `alingadvies.nl`'s eigen inlogscherm.
   - Inloggen met `kees@alingadvies.nl` + Microsoft Authenticator (MFA) slaagt.
   - De Network-trace toont een correcte `ProcessAuth` → `oauth2` (callback naar
     `mcm2ciam-federation-trust`'s redirect endpoint) → `attribute-collection-fabric`
     keten, allemaal HTTP 200.
2. **De reply-URL-configuratie werkt**: een bewust geannuleerde flow (via de
   "Cancel"-knop op het attribute-collection-scherm) resulteert correct in een
   `?error=access_denied&error_subcode=cancel`-redirect naar `https://jwt.ms` — het
   verwachte, correcte gedrag bij annulering. Dit bewijst dat de volledige
   redirect/callback-keten (inclusief `mcm2-api-poc`'s reply URL) functioneel juist
   is geconfigureerd.

## Waar het vastloopt

Op het **"Add details" / attribute-collection-scherm** (na succesvolle federatie-login,
vóór de daadwerkelijke gebruikersaanmaak in `mcm2ciam`):

- Het scherm vraagt om **Surname** (verplicht "Collect attribute").
- Na het (zelf, expliciet) invullen van een waarde en klikken op **Next**:
  gebeurt er **niets zichtbaars** — geen navigatie, geen foutmelding, geen nieuw
  request in de Network-tab na de klik.
- De **Cancel**-knop op hetzelfde scherm werkt wel (zie hierboven).
- Een handmatige **reload** van de pagina op dit punt resulteert in
  `AADSTS900144: The request body must contain the following parameter: 'state'`
  — dit is een **verwachte bijwerking van de reload zelf** (reload gooit de
  OAuth `state`-parameter weg), **geen** aanwijzing voor de onderliggende oorzaak
  van het vastlopen van "Next".

### Uitgesloten oorzaken

- **Niet** een server-/federatieprobleem: de keten tot dit scherm werkt aantoonbaar
  (zie hierboven), en Cancel op hetzelfde scherm functioneert normaal.
- **Niet** een verkeerd/verlopen client secret: dat gaf eerder een andere,
  identificeerbare fout (zie "Secret ID vs. Value"-incident hierboven), inmiddels
  hersteld en de flow komt er nu ver voorbij.
- **Niet** een user-flow-propagatievertraging: dat speelde eerder (IdP niet
  zichtbaar op het inlogscherm) en is toen al met de uitvink/aanvink-workaround
  opgelost.

### Waarschijnlijke oorzaak (nog niet bevestigd)

Het patroon — "Cancel" werkt, "Next" doet zichtbaar niets, geen nieuw network-request,
geen console-fout waargenomen tot nu toe — wijst op een **clientside (JavaScript/UI)
probleem specifiek op de Next-knop van het attribute-collection-scherm**, niet op de
achterliggende Entra-configuratie. Kandidaten, in afnemende waarschijnlijkheid:

1. **Browserextensie-interferentie** (ad-blocker, wachtwoordmanager) die een
   onzichtbare overlay over de knop legt of de klik-event onderschept — in een
   eerdere Network-trace was `adblock-uiscripts-rightclick_hook.js` zichtbaar,
   wat een actieve ad-blocker bevestigt. **Nog niet getest**: dezelfde flow in een
   schoon incognito-venster zonder extensies.
2. **Stille clientside-validatiefout** op het Surname-veld (bv. minimale lengte,
   toegestane tekens) die de Next-actie blokkeert zonder zichtbare foutmelding.
   Nog niet getest met een ander/eenvoudiger woord dan "Aling".
3. Een JavaScript-fout in de Console specifiek op het moment van de Next-klik —
   tot nu toe alleen de Network-tab bekeken op dit exacte moment, niet de Console.

---

## Eerstvolgende concrete stappen (nog uit te voeren)

In volgorde van meest naar minst waarschijnlijk om de oorzaak snel te vinden:

1. Herhaal de volledige flow in een **schoon incognito-venster zonder extensies**
   (expliciet controleren dat ad-blocker/wachtwoordmanager niet actief zijn in dat
   venster — bij Chrome/Edge staat dit standaard uit in incognito tenzij
   "Allow in incognito" is aangevinkt voor de extensie).
2. Als dat niet werkt: herhaal met **Console-tab open** (niet Network) op het
   moment van de Next-klik, en documenteer elke regel die verschijnt.
3. Als dat niet werkt: probeer een **ander Surname-woord** (bv. "Test") in plaats
   van "Aling", om een stille validatieregel uit te sluiten.
4. Als niets hiervan de oorzaak blootlegt: overweeg de **Return claim**-instelling
   te heroverwegen — deze user-flow-wizard toonde geen "Return claim"-kolom (alleen
   "Collect attribute"), wat kan betekenen dat deze Entra External ID-tenant een
   nieuwere wizard-versie gebruikt waarin verplichte attributen anders worden
   verwerkt dan in de documentatie beschreven. Vergelijk met een test waarbij
   Surname **niet** als verplicht "Collect attribute" staat (puur ter diagnose,
   niet als permanente configuratie — e-mail is het enige attribuut dat MCM2
   functioneel nodig heeft).
5. Zodra de "Next"-blokkade is opgelost en een token op `jwt.ms` verschijnt:
   de claims in dat token controleren (met name `email`, `sub`, `oid`/`tid`) —
   dat bepaalt hoe de NestJS-backend straks de tenant/membership uit het
   token kan afleiden (vervolgstap van Issue #7, nog niet gestart).

## Wat dit niet oplost (ter herinnering, uit ADR-006)

Deze PoC bewijst het technische Cognito-vrije federatiepatroon met `alingadvies.nl`
als voorbeeldtenant. Het lost niet op: (a) of Transdev's eigen IT-afdeling een
vergelijkbare app-registratie in hún tenant kan/wil aanmaken — aparte, latere
afhankelijkheid; (b) het tokengebaseerde externe-leverancier-mechanisme uit
Issue #7 (spoor 2) — staat hier volledig los van.
