# src/auth — geverifieerde identiteit (Issue #7, spoor 1)

Deze module vervangt de ongeverifieerde `X-Tenant-Id`-header door een tenant
die uit een geverifieerd ID-token komt. Zie MCM2-CLAUDE.md §6 en het plan in
`docs/superpowers/plans/2026-07-30-beheerkant-en-demo-tenant.md`.

## Onderdelen

| Bestand | Rol |
|---|---|
| `auth.config.ts` | Leest en valideert de OIDC-configuratie uit environment-variabelen. Faalt hard bij een ontbrekende waarde. |
| `id-token-verificatie.ts` | Controleert handtekening, issuer, audience en geldigheidsduur; levert de identiteit. |

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

## Twee keuzes die makkelijk verkeerd gaan

**`oid`, niet `sub`.** In Entra is `sub` per applicatie verschillend
(pairwise), dus dezelfde persoon krijgt een andere `sub` in een tweede
app-registratie. `oid` is stabiel binnen de tenant. `clm.user.external_subject`
bevat daarom de `oid`.

**`oid`, niet `email`.** Een e-mailadres verandert bij een naamswijziging of
afdelingswissel. Wie daarop koppelt, laat de gebruiker bij zo'n wijziging
stilzwijgend een ander account worden — inclusief verlies van zijn membership.
`email` blijft bestaan als weergavegegeven.
