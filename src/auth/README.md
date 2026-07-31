# src/auth — geverifieerde identiteit (Issue #7, spoor 1)

Deze module vervangt de ongeverifieerde `X-Tenant-Id`-header door een tenant
die uit een geverifieerd ID-token komt. Zie MCM2-CLAUDE.md §6 en het plan in
`docs/superpowers/plans/2026-07-30-beheerkant-en-demo-tenant.md`.

## Onderdelen

| Bestand | Rol |
|---|---|
| `auth.config.ts` | Leest en valideert de OIDC-configuratie uit environment-variabelen. Faalt hard bij een ontbrekende waarde. |
| `id-token-verificatie.ts` | Controleert handtekening, issuer, audience en geldigheidsduur; levert de identiteit. |
| `code-inwisselen.ts` | Wisselt de authorization code server-to-server in bij het token-endpoint. |
| `inlogpoging.ts` | PKCE en de state-parameter: de twee dingen die de omweg langs de provider moeten overleven. |
| `sessie.ts` | Sessietoken (genereren, hashen, vormcontrole) en de cookie-instellingen. |
| `sessie.service.ts` | De enige route naar `clm.sessie`, via de drie `SECURITY DEFINER`-functies. |
| `tenant-context.guard.ts` | Sessiecookie → tenantcontext op de request. Dit is de laag die P0 sluit. |
| `auth.controller.ts` | `/auth/login`, `/auth/callback`, `/auth/logout`. |
| `auth.service.ts` | Bindt de bouwstenen aan elkaar; bevat de volgorde, geen eigen securitylogica. |

## De keten in één regel

```
cookie  →  hash  →  clm.sessie_oplossen()  →  tenantId  →  withTenant()
```

Er is geen tweede route. De browser bezit één betekenisloze sleutel; er bestaat
geen veld in het verzoek waarin een andere tenant benoemd kan worden. Zie de
uitleg over `X-Tenant-Id` in `tenant-context.guard.ts`.

## Waarom de configuratie pas bij de eerste inlogpoging gelezen wordt

`AuthService` leest de OIDC-configuratie lui, niet in de constructor. Dat is een
afweging, geen verzwakking — `leesAuthConfig()` faalt nog steeds hard, en de
melding noemt exact welke variabelen ontbreken.

In de constructor zou die fout de **hele applicatie** onstartbaar maken zodra de
OIDC-variabelen ontbreken. Dat raakt twee situaties waarin dat verkeerd is: de
e2e-testsuite (die de `AppModule` opstart zonder identity) en een lokale run
waarin alleen aan de leverancierskant gewerkt wordt.

Geverifieerd in het productie-image op 2026-07-31: `/health` geeft 200,
`/auth/logout` geeft 302, en `/auth/login` geeft 500 met de melding die alle zes
ontbrekende variabelen opsomt.

## Waarom `jose` in `transformIgnorePatterns` staat

`jose` 6 is **ESM-only**: er is geen CommonJS-ingang (`"type": "module"`, en de
`exports`-map wijst uitsluitend naar `dist/webapi/*.js`). De applicatie heeft
daar geen last van — `tsconfig.json` staat op `module: nodenext` en
`npm run build` slaagt.

Jest is het probleem: die draait hier via ts-jest in CommonJS en negeert
standaard alles in `node_modules` bij het transformeren. Het gevolg is
`SyntaxError: Unexpected token 'export'` zodra een test `jose` aanraakt.

De oplossing staat in `package.json` (unit) en `test/jest-e2e.json` (e2e):

```json
"transformIgnorePatterns": ["node_modules/(?!(jose)/)"]
```

Dat betekent: negeer `node_modules` bij transformeren, **behalve** `jose`.
Standaard Jest-configuratie, gedocumenteerd gedrag — geen experimentele
Node-vlaggen en geen aanpassing aan de moduleresolutie van de applicatie.

Dit is bewust zo opgelost en niet met een van de alternatieven:

- **`jose` downgraden naar versie 4** (de laatste met CJS) — dat is achteruit
  bewegen op een securitybibliotheek. Precies verkeerd voor de module die de
  tokenverificatie doet.
- **De hele testsuite naar ESM** — raakt alle 13 bestaande suites en de
  ts-jest-configuratie. Grote verandering voor één dependency, en precies het
  soort ingreep dat MCM2-CLAUDE.md §5 wil vermijden.
- **Een eigen JWT-implementatie** — nooit doen. Handtekeningverificatie zelf
  schrijven is een bekende bron van kwetsbaarheden.

Komt er later een tweede ESM-only dependency bij, dan wordt dit
`node_modules/(?!(jose|die-andere)/)`.

## En het productie-image dan?

`nest build` compileert naar CommonJS, dus in `dist/` staat letterlijk
`require("jose")` op een pakket dat alleen ESM aanbiedt. Dat is precies de
combinatie waarop Prisma 7 in dit project stukliep (zie MCM2-CLAUDE.md §5): de
build slaagde, het artefact deed het niet.

Hier gaat het wél goed, en niet bij toeval: **sinds Node 22 kan `require()` een
ESM-module laden.** De Dockerfile pint `node:24-alpine`.

Geverifieerd op 2026-07-30, niet aangenomen — een geslaagde `nest build` bewijst
alleen dat de types kloppen, niet dat de module op runtime laadt:

```
docker run --rm --entrypoint node <image> -e "require('./dist/auth/id-token-verificatie.js')"
→ node v24.18.0, module laadt, verificatie werpt de verwachte TokenVerificatieFout
```

**Let op bij een Node-downgrade.** Zakt de base-image ooit naar Node 20 of
lager, dan breekt dit — met een runtime-fout in productie, niet met een rode
build. Dat is de reden dat de versie in de Dockerfile expliciet gepind staat
(§11) en dat deze controle hier gedocumenteerd is.

## Wat de tests bewijzen

`id-token-verificatie.spec.ts` draait tegen een **lokaal gegenereerd
sleutelpaar**, niet tegen de echte Entra-tenant. Dat is strenger, niet losser:
tegen de echte provider zijn alleen tokens te testen die hij bereid is af te
geven. Een verlopen token, een verkeerde `aud`, een handtekening van een
vreemde sleutel of een `alg: none`-token krijg je daar niet — en dat zijn
precies de aanvallen.

De verificatielogica is identiek: `jose` weet niet of de sleutels van een
lokale set of van een JWKS-endpoint komen.

## De issuer wijkt af van de andere endpoints — gemeten, niet aangenomen

Op 2026-07-31 aangesloten op de echte Entra-tenant. Eén ding bleek anders dan
elke voor de hand liggende aanname:

```
token endpoint  https://mcm2ciam.ciamlogin.com/<tenant-id>/oauth2/v2.0/token
jwks uri        https://mcm2ciam.ciamlogin.com/<tenant-id>/discovery/v2.0/keys
issuer          https://<tenant-id>.ciamlogin.com/<tenant-id>/v2.0
                       ^^^^^^^^^^^ tenant-ID, niet de tenantnaam
```

De `iss`-claim gebruikt het **tenant-ID** als subdomein, de andere endpoints de
**tenantnaam**. `jwtVerify` vergelijkt de issuer exact, dus met de logische
variant (`mcm2ciam.ciamlogin.com/...`) faalt élke login — en de melding zegt
niet dát het om de issuer gaat.

Vastgesteld via `.well-known/openid-configuration`, niet uit documentatie
afgeleid. Bij een verhuizing naar een andere tenant is dat het eerste dat je
opnieuw ophaalt.

## Waarom `import 'dotenv/config'` bovenaan main.ts staat

Tot 2026-07-31 laadde niets het `.env`-bestand buiten de testsuite: `dotenv`
stond als dependency in `package.json`, maar werd alleen aangeroepen in
`test/jest-e2e.setup.ts`. Lokaal werkte de backend daardoor uitsluitend met
variabelen die al in de shell stonden, en gaf `/auth/login` een 500 met "alle
zes ontbreken" — ook toen ze keurig in `.env` stonden.

De import staat vóór alle andere: `DatabaseService` leest `DATABASE_URL` in zijn
constructor, en die draait bij het samenstellen van de module.

In een container is het een no-op — daar komt de configuratie uit de omgeving
en bestaat er geen `.env`. `dotenv` overschrijft bestaande variabelen niet, dus
de omgeving wint altijd.

## Twee keuzes die makkelijk verkeerd gaan

**`oid`, niet `sub`.** In Entra is `sub` per applicatie verschillend
(pairwise), dus dezelfde persoon krijgt een andere `sub` in een tweede
app-registratie. `oid` is stabiel binnen de tenant. `clm.user.external_subject`
bevat daarom de `oid`.

**`oid`, niet `email`.** Een e-mailadres verandert bij een naamswijziging of
afdelingswissel. Wie daarop koppelt, laat de gebruiker bij zo'n wijziging
stilzwijgend een ander account worden — inclusief verlies van zijn membership.
`email` blijft bestaan als weergavegegeven.
