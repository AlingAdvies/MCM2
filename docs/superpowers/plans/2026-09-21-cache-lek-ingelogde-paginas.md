# Cache-lek op ingelogde pagina's dichten — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elke pagina onder `/beheer/*` (en de overige niet-publieke routes) wordt
per request vers gerenderd door Next.js, nooit uit de Full Route Cache
geserveerd — ongeacht sessiestatus van de bezoeker. Een geautomatiseerde test
bewaakt dit blijvend, zodat een toekomstige nieuwe pagina die vergeet dit in
te stellen de build laat falen in plaats van ongemerkt naar productie te gaan.

**Architecture:** Dit is Next.js' eigen **Full Route Cache** (bevestigd via
de `x-nextjs-cache`/`x-nextjs-prerender`-responseheaders). Er bestaat wél een
Application Load Balancer in deze AWS-opzet (`ecs-express-gateway-alb`,
automatisch door ECS Express Mode aangemaakt op 19-08-2026) — maar een ALB
routeert verkeer op laag 7 en cachet zelf niets; AWS's eigen documentatie
kent geen `Cache-Control`-override-attribuut voor ALB-listener-rules (wél
voor CORS/security-headers). Het AWS-instrument dat caching daadwerkelijk
regelt is CloudFront, en dat ontbreekt hier. Er is dus geen infrastructuurlaag
beschikbaar die dit specifieke probleem kan oplossen, ondanks dat er wél een
load balancer aanwezig is. De officiële Next.js-documentatie waarschuwt
bovendien dat `force-dynamic` op een gedeeld `layout.tsx` niet betrouwbaar
overerft naar child-routes — de garantie geldt per route-segment. Daarom:
**expliciet `export const dynamic = 'force-dynamic'` op elke afzonderlijke
`page.tsx`** die sessie-afhankelijke inhoud kan tonen, plus een e2e-test die
voor elke zo'n route controleert dat de responseheader `x-nextjs-cache`
afwezig is.

**Tech Stack:** Next.js 15 App Router, Playwright (e2e), geen
backend-wijziging, geen infrastructuurwijziging (de aanwezige ALB is niet het
juiste instrument voor dit probleem; CloudFront zou dat wel zijn, maar
ontbreekt).

---

## Achtergrond — het gevonden probleem, met bewijs

Op 21-09-2026 bleek uit productie (`clm.alingadvies.nl`) dat elke
niet-parametrische route onder `/beheer/*` (dus met uitzondering van
detailpagina's als `/beheer/status/[responseId]`) statisch geprerenderd en
gecachet wordt:

```
x-nextjs-cache: HIT
x-nextjs-prerender: 1
Cache-Control: s-maxage=31536000
```

Geverifieerd: de gecachete HTML-shell zelf bevat geen tenant-data (data komt
altijd via een aparte, niet-gecachete client-side fetch die de sessie correct
controleert — bevestigd met `curl` tegen `/api/backend/auth/sessie`, gaf
`401` zonder cookie). Er is dus **geen acuut datalek** vastgesteld, maar de
situatie is fragiel: een toekomstige wijziging die per ongeluk data in een
Server Component op deze routes zet, zou dat lek per direct en onopgemerkt
naar alle bezoekers serveren.

Dit is een erkende kwetsbaarheidsklasse ("Web Cache Deception" /
"cached authenticated content") — zie CVE-2026-50170 (Angular), het
Railway-CDN-incident, en de OWASP-testrichtlijn "Testing for Browser Cache
Weaknesses", die expliciet voorschrijft dat elke pagina met gevoelige inhoud
de server moet instrueren om niets te cachen.

**Waarom niet centraal via layout.tsx of middleware:** de officiële Next.js
route-segment-config-documentatie zegt dat `force-*`-opties per segment
gelden, niet betrouwbaar via een parent layout overerven. Middleware kan
headers zetten, maar Next.js schrijft proxy/response-headers vóór de route
handler draait — een header die de handler zelf zet, wordt in bepaalde
volgordes stilzwijgend genegeerd in plaats van overschreven. Vertrouwen op
één centrale plek zou dus een schijnzekerheid zijn. Vandaar: expliciet per
pagina, met een test die het geheel bewaakt in plaats van op overerving te
vertrouwen.

**Wat hier bewust NIET gebeurt:** een tweede, infrastructuurlaag als vangnet
toevoegen. Er bestaat wél een ALB (`ecs-express-gateway-alb`, geverifieerd in
de AWS-console — de eerdere aanname in
`docs/MCM2 AWS Minimaal — implementatiebrief voor Claude Code.md` dat er
"geen ALB" zou zijn, klopt dus niet (meer) voor de huidige Express
Mode-uitrol). Maar een ALB routeert laag-7-verkeer en cachet zelf niets; AWS
biedt voor ALB-listener-rules geen `Cache-Control`-override-attribuut (wel
voor CORS/security-headers). Het instrument dat dit zou kunnen — CloudFront —
ontbreekt. Een CloudFront-laag toevoegen zou een aparte
architectuurbeslissing zijn met eigen kosten (§167 van hetzelfde document
noemt CloudFront/WAF als optie bij veel publiek verkeer of misbruik) —
buiten de scope van dit plan. Task 3 legt dit vast als open
architectuurvraag voor een apart besluit.

---

## Task 1: `force-dynamic` op elke sessie-afhankelijke pagina

**Files (16 bestanden onder `/beheer`):**
- Modify: `src/app/beheer/page.tsx`
- Modify: `src/app/beheer/contracten/page.tsx`
- Modify: `src/app/beheer/instellingen/page.tsx`
- Modify: `src/app/beheer/leden/page.tsx`
- Modify: `src/app/beheer/leveranciers/page.tsx`
- Modify: `src/app/beheer/leveranciers/[id]/page.tsx`
- Modify: `src/app/beheer/platform/page.tsx`
- Modify: `src/app/beheer/platform/contract-import/page.tsx`
- Modify: `src/app/beheer/status/page.tsx`
- Modify: `src/app/beheer/status/[responseId]/page.tsx`
- Modify: `src/app/beheer/vendor-categorieen/page.tsx`
- Modify: `src/app/beheer/vragenlijsten/page.tsx`
- Modify: `src/app/beheer/vragenlijsten/[id]/page.tsx`
- Modify: `src/app/beheer/vragenlijsten/[id]/wachtlijst/page.tsx`
- Modify: `src/app/beheer/vragenlijsten/rondes/[id]/page.tsx`
- Modify: `src/app/beheer/vragenlijsten/uitnodigen/page.tsx`
- Modify: `src/app/demo-aanmelden/page.tsx` (zet ook een sessiecookie — moet
  nooit gecachet worden)

**Niet aanpassen:**
- `src/app/page.tsx` — de root-startpagina bevat geen sessie-afhankelijke
  data (bevestigen in Step 1 hieronder; als dat klopt, mag deze gecachet
  blijven — dat is legitiem en gewenst voor een marketing/redirect-pagina).
- `src/app/portal/survey/[token]/page.tsx` — al dynamisch (bevestigd via
  `curl`: `Cache-Control: private, no-cache, no-store, max-age=0,
  must-revalidate`, geen `x-nextjs-cache`-header), want de route bevat een
  dynamisch `[token]`-segment. Geen wijziging nodig, wel meenemen in de
  bewakingstest van Task 2 zodat een toekomstige wijziging dit niet stil
  laat regresseren.

- [ ] **Step 1: Bevestig dat `src/app/page.tsx` geen sessie-data toont**

Lees het bestand. Als het puur een redirect of marketingtekst is zonder
`fetch()` naar `/api/backend/*` of gebruik van sessie-state, hoeft het niet
aangepast te worden. Noteer de bevinding in de commit-message van Step 3.

- [ ] **Step 2: Voeg de route-segment-config toe aan elk bestand uit de lijst**

Voor elk van de 16 `/beheer/*`-bestanden en `demo-aanmelden/page.tsx`: open
het bestand, en voeg direct na de laatste top-level `import`-statement (vóór
de eerste component/functie-declaratie) toe:

```typescript
/**
 * Nooit statisch prerenderen of cachen (Next.js Full Route Cache).
 *
 * Deze pagina toont sessie-afhankelijke gegevens. Zonder deze regel serveert
 * Next.js een tijdens `next build` gegenereerde, gedeelde HTML-versie aan
 * elke bezoeker — ongeacht wie hij is of of hij is ingelogd. Op 21-09-2026
 * bleek dit in productie het geval (x-nextjs-cache: HIT, s-maxage: 1 jaar),
 * zonder acuut datalek (de gecachete shell bevat zelf geen data), maar wel
 * een fragiele situatie die bij de eerstvolgende Server Component met
 * data-fetching een echt cache-lek tussen gebruikers zou zijn.
 *
 * `force-dynamic` overerft niet betrouwbaar via een parent layout (Next.js
 * route-segment-config-documentatie) — vandaar expliciet op elke pagina
 * apart, bewaakt door de test in e2e/geen-statische-cache.spec.ts.
 */
export const dynamic = 'force-dynamic';
```

Voor bestanden die al `'use client'` bovenaan hebben (client components):
plaats de `export const dynamic` regel er toch in — Next.js leest deze
export ook uit een client-component-bestand op het top-level module-niveau,
mits het bestand zelf geen `'use client'`-only beperking op deze export
legt. **Controleer dit per bestand**: als TypeScript/Next.js een foutmelding
geeft bij een `'use client'`-bestand, verplaats de `export const dynamic`
naar een nieuw, klein `layout.tsx` in dezelfde map in plaats van het in de
`page.tsx` zelf te zetten (Next.js staat toe dat een layout op hetzelfde
route-segment als de page deze config draagt). Documenteer in de
commit-message welke aanpak voor welk bestand nodig bleek.

- [ ] **Step 3: Bouw en controleer dat de build geen statische paden meer rapporteert voor deze routes**

```bash
cd C:\DEV\Work\MCM2-frontend
npm run build
```

Verwacht in de build-output: elke `/beheer/*`-route en `/demo-aanmelden`
gemarkeerd als `ƒ (Dynamic)` in de routes-tabel die Next.js na de build
afdrukt, niet als `○ (Static)` of `● (SSG)`.

- [ ] **Step 4: Commit**

```bash
git add src/app/beheer src/app/demo-aanmelden
git commit -m "fix(cache): force-dynamic op elke sessie-afhankelijke pagina"
```

---

## Task 2: Geautomatiseerde bewakingstest

**Files:**
- Create: `C:\DEV\Work\MCM2-frontend\e2e\geen-statische-cache.spec.ts`

Deze test draait tegen de gebouwde, gestarte productie-achtige stack (zoals
`verify:volledig` die al opzet) en controleert voor elke bekende
sessie-afhankelijke route dat de response geen `x-nextjs-cache`-header
draagt. Dit is de garantie dat een toekomstige nieuwe pagina die vergeet
`force-dynamic` te zetten, de CI-run laat falen in plaats van ongemerkt naar
productie te gaan.

- [ ] **Step 1: Bekijk een bestaand e2e-testbestand voor het basispatroon**

Lees `e2e/vragenlijsten.spec.ts` (regel 1-40) voor het `BEHEER_COOKIE`/
`test.skip`-patroon dat alle e2e-suites in deze repo gebruiken.

- [ ] **Step 2: Schrijf de test**

```typescript
import { expect, test } from '@playwright/test';

/**
 * Bewaakt dat geen enkele sessie-afhankelijke pagina door Next.js'
 * Full Route Cache wordt geserveerd.
 *
 * ── Waarom dit een aparte suite is, los van de functionele e2e-tests ───────
 *
 * Op 21-09-2026 bleek in productie dat elke niet-parametrische /beheer/*-
 * route statisch geprerenderd en 1 jaar gecachet werd (x-nextjs-cache: HIT),
 * ongeacht sessiestatus. Geen acuut datalek (de gecachete HTML bevat zelf
 * geen data), maar een fragiele situatie: de eerste Server Component die
 * ooit data ophaalt op zo'n route, lekt die data naar elke bezoeker.
 *
 * `force-dynamic` overerft niet via een parent layout (Next.js-documentatie),
 * dus deze test controleert élke route apart — een nieuwe pagina die
 * vergeet dit in te stellen, hoort hier ook aan toegevoegd te worden, en het
 * ontbreken daarvan is precies het soort fout die deze suite moet vangen.
 *
 * Getest via de HTTP-response-header, niet via de UI: `x-nextjs-cache` en
 * `x-nextjs-prerender` zijn Next.js' eigen signalen dat de Full Route Cache
 * heeft geserveerd. Hun afwezigheid bewijst dat de pagina per request vers
 * is gerenderd.
 */

const COOKIE = process.env.BEHEER_COOKIE;
const BASIS = process.env.NEXT_PUBLIC_FRONTEND_URL ?? 'http://localhost:3000';

/**
 * Elke bekende sessie-afhankelijke route. Nieuwe pagina's onder /beheer
 * horen hier bij toegevoegd te worden — dat is de handeling die deze test
 * afdwingt.
 */
const SESSIE_AFHANKELIJKE_ROUTES = [
  '/beheer',
  '/beheer/contracten',
  '/beheer/instellingen',
  '/beheer/leden',
  '/beheer/leveranciers',
  '/beheer/platform',
  '/beheer/status',
  '/beheer/vendor-categorieen',
  '/beheer/vragenlijsten',
  '/beheer/vragenlijsten/uitnodigen',
  '/demo-aanmelden',
];

test.describe('Geen statische cache op sessie-afhankelijke pagina\'s', () => {
  test.skip(!COOKIE, 'BEHEER_COOKIE ontbreekt.');

  for (const route of SESSIE_AFHANKELIJKE_ROUTES) {
    test(`${route} wordt niet door de Full Route Cache geserveerd`, async ({
      request,
    }) => {
      const antwoord = await request.get(`${BASIS}${route}`, {
        headers: { Cookie: COOKIE! },
      });

      // Aanwezigheid van deze header — ongeacht de waarde (HIT, MISS of
      // STALE) — bewijst dat de route door het statische-cache-mechanisme
      // loopt. Alleen volledige afwezigheid is veilig: `force-dynamic`
      // zorgt dat Next.js deze header nooit zet.
      expect(
        antwoord.headers()['x-nextjs-cache'],
        `${route} draagt x-nextjs-cache — deze route wordt gecachet en toont mogelijk dezelfde inhoud aan elke bezoeker`,
      ).toBeUndefined();

      expect(
        antwoord.headers()['x-nextjs-prerender'],
        `${route} draagt x-nextjs-prerender — deze route is statisch geprerenderd`,
      ).toBeUndefined();
    });
  }
});
```

- [ ] **Step 3: Draai de test tegen de huidige (nog niet gefixte) code om te bevestigen dat hij het probleem vangt**

```bash
cd C:\DEV\Work\MCM2
npm run verify:volledig
```

Als Task 1 nog niet is uitgevoerd op het moment dat je dit test-schrijven
doet: verwacht FAIL op alle routes uit de lijst. Als Task 1 al klaar is:
verwacht PASS. Voer Task 1 en Task 2 in de volgorde van dit plan uit (Task 1
eerst) zodat je hier PASS ziet — de bedoeling van deze stap is bevestigen dat
de test daadwerkelijk aanslaat op het probleem, niet dat hij toevallig altijd
groen is.

**Om dat te bevestigen zonder Task 1 terug te draaien:** kopieer tijdelijk
één regel `export const dynamic = 'force-static';` in
`src/app/beheer/leveranciers/page.tsx`, draai de test, bevestig FAIL op die
ene route, verwijder de tijdelijke regel weer, draai de test opnieuw en
bevestig PASS. Dit is de tegenproef die aantoont dat de test niet stil groen
zou blijven als iemand per ongeluk de bescherming weghaalt.

- [ ] **Step 4: Commit**

```bash
git add e2e/geen-statische-cache.spec.ts
git commit -m "test(cache): bewaak dat sessie-afhankelijke pagina's nooit statisch gecachet worden"
```

---

## Task 3: Vastleggen als architectuurgat, geen tweede laag bouwen

**Files:**
- Modify: `C:\DEV\Work\MCM2\docs\ARCHITECTUUR.md` (of het equivalente
  platformgaranties-document — lees eerst welk bestand de vier bestaande
  platformgaranties beschrijft, zie MEMORY `mcm2-normatief-architectuurdocument`)

Dit plan bouwt bewust geen tweede, infrastructuurlaag als cache-vangnet, niet
omdat er geen load balancer zou zijn (die is er wél,
`ecs-express-gateway-alb`), maar omdat een ALB geen cache-headers kan
afdwingen — dat is een CloudFront-taak, en CloudFront ontbreekt. Dat betekent:
dit plan levert één laag van bescherming, niet de "defense in depth" met
twee onafhankelijke lagen die de industriestandaard voorschrijft (OWASP, en
het lesgeld dat Railway/Angular betaalden). Dat gat moet expliciet
vastgelegd worden, niet stilzwijgend geaccepteerd.

- [ ] **Step 1: Vind het juiste document**

```bash
grep -rl "Platformgarantie" docs/ARCHITECTUUR.md
```

- [ ] **Step 2: Voeg een sectie toe (exacte plek hangt af van de bestaande
  structuur — volg het patroon van de andere platformgaranties in het
  document)**

```markdown
## Bekend gat: geen tweede cachebeschermingslaag

Sinds 21-09-2026 dwingt elke sessie-afhankelijke pagina op applicatieniveau
`force-dynamic` af (zie e2e/geen-statische-cache.spec.ts). Dat is één laag.

De industriestandaard (OWASP, en het lesgeld dat Railway en Angular
betaalden bij vergelijkbare incidenten) schrijft twee onafhankelijke lagen
voor: applicatie én infrastructuur (een cachende laag die cache-headers
afdwingt, los van wat de applicatie zelf teruggeeft). Er bestaat wél een ALB
(`ecs-express-gateway-alb`), maar die cachet zelf niets en kan geen
Cache-Control-headers overschrijven — AWS biedt dat niet aan als
ALB-listener-rule-attribuut. Het instrument dat dit wél zou kunnen,
CloudFront, ontbreekt in de huidige opzet.

Risico van één laag: als een toekomstige Next.js-versie of een
configuratiewijziging de werking van `force-dynamic` verandert (vergelijkbaar
met wat Next.js zelf in meerdere CVE's overkwam), is er geen vangnet.

**Nog te beslissen, geen actie nu:** of dit risico groot genoeg is om een
CDN/WAF-laag toe te voegen (kosten, zie kostenraming-briefing §167), of dat
de bewakingstest (Task 2) als voldoende mitigatie geldt gezien de huidige
schaal. Trigger om dit te heroverwegen: méér publiek verkeer, een nieuwe
Server Component die daadwerkelijk sessie-data server-side rendert, of een
volgende Next.js-major-upgrade.
```

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTUUR.md
git commit -m "docs(architectuur): cache-beschermingsgat vastgelegd, geen tweede laag (nog)"
```

---

## Self-review — gedaan

**Spec-dekking:** "ik wil niet dat dit ooit gebeurt" → Task 1 (fix) + Task 2
(blijvende bewaking, met tegenproef die aantoont dat de test het probleem
ook echt vangt). "Dit kan toch niet beperkt zijn tot Beheer" (gebruikersvraag)
→ Task 1 neemt ook `/demo-aanmelden` mee; Task 1 Step 1 controleert expliciet
of de root-pagina wél veilig statisch mag blijven, in plaats van dat aan te
nemen.

**Geen placeholders:** volledige code in elke stap. Waar een aanpak per
bestand kan verschillen (client component vs. server component), is dat
expliciet als een te nemen beslissing tijdens uitvoering benoemd, niet als
vage instructie.

**Type-consistentie:** niet van toepassing (geen gedeelde types tussen
taken) — wel is de routelijst in Task 2's test dezelfde als de bestandenlijst
in Task 1, op de dynamische-route-uitzonderingen na (die zijn al veilig).

**Eerlijkheid over scope:** Task 3 legt vast wat dit plan bewust NIET
oplost (de ontbrekende tweede laag), in plaats van te doen alsof één laag de
volledige industriestandaard dekt.
