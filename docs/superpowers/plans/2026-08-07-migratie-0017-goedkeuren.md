# Goedkeuren als vierde oordeel — implementatieplan (migratie 0017)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `goedgekeurd` toevoegen als vierde `verdict` op `clm.survey_review`, zodat de laatste status uit de statusketen (§3 van `2026-08-07-statuswaarheid-per-vendor.md`) vastgelegd kan worden — met de identiteit van de goedkeurder gewaarborgd.

**Architecture:** Geen nieuwe tabel. Goedkeuren is dezelfde soort uitspraak als de bestaande drie oordelen — genoemd persoon, genoemd moment, nooit overschreven — dus dezelfde tabel, dezelfde RLS-policy, dezelfde append-only-regel. De migratie vervangt alleen de CHECK-constraint. De backend krijgt één extra toegestane waarde plus één nieuwe route om in te trekken (V2).

**Tech Stack:** NestJS, Drizzle (handgeschreven SQL-migraties), PostgreSQL met RLS, Jest + supertest voor e2e.

---

## Context die de uitvoerder moet kennen

**Lees eerst** `docs/superpowers/plans/2026-08-07-statuswaarheid-per-vendor.md` §3.2 en §7. Dit plan voert daar stap 1 van uit.

**Drie dingen die in dit project anders zijn dan je gewend bent:**

1. **`db:generate` is onbruikbaar.** De Drizzle-snapshots in `drizzle/meta` lopen tot `0007` terwijl er 16 migraties zijn; het genereert een migratie die bestaande tabellen opnieuw wil aanmaken (Issue #96). **Schrijf de migratie met de hand**, in de stijl van `drizzle/0015_survey_review.sql`.

2. **Test-id's zijn centraal vastgelegd** in `test/test-ids.ts` en er staat een bewakingstest op. Verzin nooit een UUID in een testbestand — voeg hem toe aan `test-ids.ts`. Hoogste vergeven staart is nu `ef`; dit plan gebruikt `f0` en verder.

3. **De RLS-policy op `survey_review` eist actor `medewerker`**, niet alleen de tenant. Alle databasetoegang loopt via `db.withTenant(tenantId, fn, 'medewerker')`.

**Draaien van tests:** e2e vereist een lopende Postgres. `npm run test:e2e -- <bestand>` voor één suite.

---

## Bestandsoverzicht

| Bestand | Wat er verandert |
|---|---|
| `drizzle/0017_goedkeuren.sql` | **Nieuw.** CHECK vervangen door vier waarden. |
| `src/survey/beoordeling.service.ts` | `OORDELEN` uitbreiden; `trekIn()` toevoegen. |
| `src/survey/ronde-invoer.ts` | Toelichtingsregel voor `goedgekeurd` (zie Taak 3). |
| `src/survey/vragenlijst-beheer.controller.ts` | Route `DELETE .../reviews/:reviewId`. |
| `test/test-ids.ts` | Id's voor de nieuwe suite (`f0`–`f7`). |
| `test/goedkeuren.e2e-spec.ts` | **Nieuw.** De suite voor dit alles. |

`src/db/schema.ts` verandert **niet**: Drizzle legt CHECK-constraints daar niet vast, dus de vier waarden staan in de migratie en in `OORDELEN`.

---

## Taak 1: De migratie

**Files:**
- Create: `drizzle/0017_goedkeuren.sql`

- [ ] **Stap 1: Zet een verse wegwerpdatabase op**

**Lees eerst `docs/runbooks/commandos-en-omgeving.md`.** Kern: `.env` wijst naar Supabase. `npm run migrate:deploy` zonder overschreven variabele raakt de echte database — dat is Issue #86.

```powershell
docker run -d --name mcm2test0017 -e POSTGRES_PASSWORD=pw -p 55440:5432 postgres:17.6
docker exec -i mcm2test0017 psql -U postgres -q < db/roles/bootstrap-roles.sql
docker exec mcm2test0017 psql -U postgres -d postgres -c "ALTER ROLE clm_migrator WITH PASSWORD 'pw'; ALTER ROLE clm_api_runtime WITH PASSWORD 'pw';"
```

Bouw de keten op tot en met 0016:
```powershell
$env:MIGRATION_DATABASE_URL="postgresql://clm_migrator:pw@localhost:55440/postgres"
npm run migrate:deploy
```

Expected: alle migraties t/m `0016_template_reviewer.sql` worden toegepast, en de melding noemt `localhost:55440` — **niet** `supabase.com`. Staat daar Supabase, dan is de variabele niet doorgekomen: stop.

- [ ] **Stap 2: Schrijf de migratie**

Create `drizzle/0017_goedkeuren.sql`:

```sql
-- =============================================================================
-- Goedkeuren als vierde oordeel op clm.survey_review.
--
-- Aanleiding: docs/superpowers/plans/2026-08-07-statuswaarheid-per-vendor.md
-- §3.2. De eigenaar wil dat de app de centrale waarheid is voor de status van
-- een vragenlijst per leverancier. Drie van de vier statussen waren al af te
-- leiden uit bestaande gegevens; "beoordeeld en goedgekeurd" was de enige die
-- nergens bestond.
--
-- ── Waarom hier en niet in een eigen tabel ───────────────────────────────────
--
-- Goedkeuren is dezelfde soort uitspraak als de drie bestaande oordelen: van
-- een genoemd persoon, op een genoemd moment, over één respons, en nooit
-- overschreven. Een aparte tabel zou dezelfde kolommen, dezelfde policy en
-- dezelfde append-only-regel dupliceren, plus een query opleveren die twee
-- tabellen moet samenvoegen om "wat is de huidige status" te beantwoorden.
--
-- ── Waarom niet op survey_response ───────────────────────────────────────────
--
-- survey_response.status (migratie 0003) is de INVULstatus: waar staat de
-- leverancier in zijn eigen proces (pending/submitted/revoked). Goedkeuring is
-- een uitspraak van de ORGANISATIE over die inzending. Die twee in één kolom
-- levert waarden op die elkaar ongemerkt uitsluiten — kan een 'revoked'
-- respons goedgekeurd zijn?
--
-- ── Wat dit NIET verandert ───────────────────────────────────────────────────
--
-- De RLS-policy niet, de kolommen niet, de rechten niet. Alleen de verzameling
-- toegestane waarden. Bestaande rijen blijven geldig: 'goedgekeurd' komt erbij,
-- er gaat niets af.
-- =============================================================================

ALTER TABLE clm.survey_review
    DROP CONSTRAINT survey_review_verdict_check;--> statement-breakpoint

ALTER TABLE clm.survey_review
    ADD CONSTRAINT survey_review_verdict_check
    CHECK (verdict IN ('goed', 'nadere_vragen', 'niet_goed', 'goedgekeurd'));--> statement-breakpoint

COMMENT ON CONSTRAINT survey_review_verdict_check ON clm.survey_review IS
    'Vier oordelen. De eerste drie zijn inhoudelijk; goedgekeurd is een processtap die de inzending afsluit. Het scherm zet ze daarom niet als vier gelijkwaardige knoppen naast elkaar.';
```

- [ ] **Stap 3: Pas de migratie toe op de wegwerpdatabase**

Met `MIGRATION_DATABASE_URL` nog gezet uit stap 1:
```powershell
npm run migrate:deploy
```
Expected: `0017_goedkeuren.sql` wordt toegepast zonder fout, doelwit `localhost:55440`.

- [ ] **Stap 4: Controleer de schemaconformiteit**

Run:
```powershell
$env:DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55440/postgres"
npm run verify:schema
```

Expected: GOEDGEKEURD.

**Er is bewust géén los verwachtingsbestand om bij te werken.** `scripts/verify-schema.js` draait `test/schema-conformiteit.e2e-spec.ts`, die de verwachting rechtstreeks uit het Drizzle-schema afleidt — een tweede lijst zou binnen één sprint gaan afwijken. Zakt deze stap, dan wijkt de database áf van `src/db/schema.ts`, niet van een lijstje.

Deze migratie raakt alleen een CHECK-constraint en geen tabelstructuur, dus `src/db/schema.ts` hoeft niet mee te veranderen: Drizzle legt CHECK-constraints daar niet vast. De waarheid over de toegestane waarden staat op twee plekken — de migratie en `OORDELEN` in `beoordeling.service.ts` — en Taak 2 houdt die gelijk.

- [ ] **Stap 5: Bewijs dat de constraint echt vier waarden toestaat**

Lees de constraint terug uit de database zelf, in plaats van te vertrouwen dat de migratie deed wat er staat. **`psql` staat niet op deze machine** — het loopt via de container:

```powershell
docker exec mcm2test0017 psql -U postgres -d postgres -t -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'survey_review_verdict_check';"
```

Expected: alle vier de waarden, inclusief `goedgekeurd`.

**Staan er nog drie waarden, dan is de migratie overgeslagen** — ook al meldde `migrate:deploy` "Migraties voltooid". Drizzle leest `drizzle/meta/_journal.json`, niet de map. Voeg een entry toe (zie stap 2b) en draai opnieuw.

- [ ] **Stap 2b: Registreer de migratie in het journal**

Zonder deze stap bestaat het `.sql`-bestand niet voor Drizzle. Voeg toe aan `drizzle/meta/_journal.json`, ná de entry van `0016_template_reviewer`:

```json
    {
      "idx": 17,
      "version": "7",
      "when": 1786435200000,
      "tag": "0017_goedkeuren",
      "breakpoints": true
    }
```

- [ ] **Stap 6: Commit**

```bash
git add drizzle/0017_goedkeuren.sql
git commit -m "feat(survey): goedgekeurd als vierde oordeel (migratie 0017)"
```

---

## Taak 2: De backend accepteert `goedgekeurd`

**Files:**
- Modify: `src/survey/beoordeling.service.ts:42`
- Test: `test/goedkeuren.e2e-spec.ts` (nieuw, opgezet in deze taak)

- [ ] **Stap 1: Voeg de test-id's toe**

Modify `test/test-ids.ts`. Voeg toe ná het blok `'beoordelaar-koppelen'`:

```ts
  // Goedkeuren (migratie 0017). Staarten f0 t/m f7; ef was de hoogste
  // vergeven staart. Gecontroleerd tegen alleTestIds().
  goedkeuren: {
    tenantA: '00000000-0000-0000-0000-0000000000f0',
    tenantB: '00000000-0000-0000-0000-0000000000f1',
    adminA: '00000000-0000-0000-0000-0000000000f2',
    /** Tweede medewerker in A: bewijst dat de identiteit uit de sessie komt. */
    collegaA: '00000000-0000-0000-0000-0000000000f3',
    templateA: '00000000-0000-0000-0000-0000000000f4',
    runA: '00000000-0000-0000-0000-0000000000f5',
    vendorA: '00000000-0000-0000-0000-0000000000f6',
    /** Ingediend — hierop mag goedgekeurd worden. */
    responseIngediend: '00000000-0000-0000-0000-0000000000f7',
  },
```

- [ ] **Stap 2: Draai de bewakingstest op test-id's**

Run:
```powershell
npm test -- test-ids
```
Expected: PASS. Zakt dit op een dubbele id, kies dan de eerstvolgende vrije staart en werk het commentaar bij.

- [ ] **Stap 3: Schrijf de falende test**

Create `test/goedkeuren.e2e-spec.ts`. Neem de opzet (app opstarten, sessiecookie, seed) letterlijk over uit `test/beoordeling.e2e-spec.ts` — dezelfde imports, dezelfde `beforeAll`-structuur — en vervang de id's door `TEST_IDS.goedkeuren`. De eerste test:

```ts
it('legt een goedkeuring vast op een ingediende respons', async () => {
  const antwoord = await request(app.getHttpServer() as App)
    .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
    .set('Cookie', cookieAdminA)
    .send({ verdict: 'goedgekeurd', toelichting: 'Akkoord namens IT.' })
    .expect(201);

  const body = antwoord.body as BeoordelingBody;
  expect(body.beoordeling.verdict).toBe('goedgekeurd');
  expect(body.beoordeling.reviewerUserId).toBe(ADMIN_A);
});
```

- [ ] **Stap 4: Draai de test en zie hem falen**

Run:
```powershell
npm run test:e2e -- goedkeuren
```
Expected: FAIL met status 400 en de melding `Onbekend oordeel. Toegestaan: goed, nadere_vragen, niet_goed.` — de validatie in `ronde-invoer.ts` kent de nieuwe waarde nog niet.

- [ ] **Stap 5: Voeg de waarde toe**

Modify `src/survey/beoordeling.service.ts` regel 41-43:

```ts
/**
 * De vier toegestane oordelen. Gelijk aan de CHECK uit migratie 0017.
 *
 * De eerste drie zijn inhoudelijk: wat vindt de beoordelaar van de inzending.
 * `goedgekeurd` is een processtap die de inzending afsluit — dezelfde vorm
 * (naam, datum, nooit overschreven), maar een andere betekenis. Het scherm zet
 * ze daarom niet als vier gelijkwaardige knoppen naast elkaar.
 */
export const OORDELEN = [
  'goed',
  'nadere_vragen',
  'niet_goed',
  'goedgekeurd',
] as const;
```

- [ ] **Stap 6: Draai de test en zie hem slagen**

Run:
```powershell
npm run test:e2e -- goedkeuren
```
Expected: PASS.

- [ ] **Stap 7: Commit**

```bash
git add src/survey/beoordeling.service.ts test/test-ids.ts test/goedkeuren.e2e-spec.ts
git commit -m "feat(survey): goedkeuren als oordeel accepteren"
```

---

## Taak 3: Toelichting bij goedkeuren is optioneel

De bestaande regel (`ronde-invoer.ts:321`) luidt: alles behalve `goed` vereist een toelichting. Zonder wijziging zou `goedgekeurd` dus een verplichte toelichting krijgen.

**Dat is niet wat we willen.** De onderbouwingseis bestaat omdat *"niet goed" zonder reden later niet te herleiden is*. Een goedkeuring is de bevestiging dat het akkoord is; daar is de handtekening de inhoud, niet de uitleg.

**Files:**
- Modify: `src/survey/ronde-invoer.ts:321-326`
- Test: `test/goedkeuren.e2e-spec.ts`

- [ ] **Stap 1: Schrijf de falende test**

Voeg toe aan `test/goedkeuren.e2e-spec.ts`:

```ts
it('staat goedkeuren zonder toelichting toe', async () => {
  await request(app.getHttpServer() as App)
    .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
    .set('Cookie', cookieAdminA)
    .send({ verdict: 'goedgekeurd' })
    .expect(201);
});

it('blijft een toelichting eisen bij niet_goed', async () => {
  const antwoord = await request(app.getHttpServer() as App)
    .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
    .set('Cookie', cookieAdminA)
    .send({ verdict: 'niet_goed' })
    .expect(400);

  expect((antwoord.body as { message: string }).message).toContain('Licht toe');
});
```

De tweede test is er niet voor de sier: hij bewaakt dat het versoepelen voor `goedgekeurd` de eis bij de andere oordelen niet stilletjes opheft.

- [ ] **Stap 2: Draai en zie de eerste falen**

Run:
```powershell
npm run test:e2e -- goedkeuren
```
Expected: de eerste test FAIL met 400 (`Licht toe waarom...`), de tweede PASS.

- [ ] **Stap 3: Pas de regel aan**

Modify `src/survey/ronde-invoer.ts`, vervang regels 321-326:

```ts
  // Een toelichting is verplicht bij de inhoudelijke afwijzingen, niet bij
  // 'goed' en niet bij 'goedgekeurd'. Reden: "niet goed" zonder reden is later
  // niet te herleiden. Bij een goedkeuring is de handtekening de inhoud — wie
  // en wanneer, en dat legt de tabel zelf vast.
  const vereistToelichting = verdict === 'nadere_vragen' || verdict === 'niet_goed';

  if (vereistToelichting && toelichting === '') {
    throw new InvoerFout(
      'toelichting',
      'Licht toe waarom. Zonder onderbouwing is dit oordeel later niet te herleiden.',
    );
  }
```

- [ ] **Stap 4: Draai en zie beide slagen**

Run:
```powershell
npm run test:e2e -- goedkeuren
```
Expected: PASS, beide.

- [ ] **Stap 5: Commit**

```bash
git add src/survey/ronde-invoer.ts test/goedkeuren.e2e-spec.ts
git commit -m "feat(survey): toelichting optioneel bij goedkeuren"
```

---

## Taak 4: De identiteit komt uit de sessie (V1)

Dit is de voorwaarde die de eigenaar aan V1 verbond: *iedereen mag goedkeuren, mits de identiteit van de keurder vastligt.* De code doet dit al (`beoordeling.service.ts:130-135` neemt `reviewerUserId` als parameter, de controller vult hem uit `sessie.userId`). **Deze taak bewijst het en bewaakt het.**

**Files:**
- Test: `test/goedkeuren.e2e-spec.ts`

- [ ] **Stap 1: Schrijf de tegenproef**

```ts
it('negeert een reviewerUserId uit de body en gebruikt de sessie', async () => {
  const antwoord = await request(app.getHttpServer() as App)
    .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
    .set('Cookie', cookieAdminA)
    .send({
      verdict: 'goedgekeurd',
      toelichting: 'Akkoord.',
      // Een poging om de goedkeuring op naam van een collega te zetten.
      reviewerUserId: COLLEGA_A,
    })
    .expect(201);

  const body = antwoord.body as BeoordelingBody;
  expect(body.beoordeling.reviewerUserId).toBe(ADMIN_A);
  expect(body.beoordeling.reviewerUserId).not.toBe(COLLEGA_A);
});
```

- [ ] **Stap 2: Draai de test**

Run:
```powershell
npm run test:e2e -- goedkeuren
```
Expected: PASS meteen — de code doet dit al goed.

- [ ] **Stap 3: Bewijs dat de test iets meet (§15b tegenproef)**

Deze test slaagt zonder codewijziging, dus moet je aantonen dat hij zou falen als de bescherming wegviel. Wijzig **tijdelijk** in `vragenlijst-beheer.controller.ts` de aanroep:

```ts
    const beoordeling = await this.beoordelingen_.voegToe(
      sessie.tenantId,
      id,
      (body as { reviewerUserId?: string }).reviewerUserId ?? sessie.userId,
      invoer,
    );
```

Run:
```powershell
npm run test:e2e -- goedkeuren
```
Expected: **precies deze ene test FAIL**, de andere PASS.

**Draai de wijziging daarna volledig terug** met:
```bash
git checkout src/survey/vragenlijst-beheer.controller.ts
```
en draai de suite opnieuw — alles PASS. Noteer de uitkomst in de PR-body.

- [ ] **Stap 4: Commit**

```bash
git add test/goedkeuren.e2e-spec.ts
git commit -m "test(survey): de goedkeurder komt uit de sessie, nooit uit de body"
```

---

## Taak 5: Een goedkeuring intrekken (V2)

**Files:**
- Modify: `src/survey/beoordeling.service.ts` (methode `trekIn`)
- Modify: `src/survey/vragenlijst-beheer.controller.ts` (route)
- Test: `test/goedkeuren.e2e-spec.ts`

- [ ] **Stap 1: Schrijf de falende tests**

```ts
it('trekt een oordeel in en laat het uit de lijst verdwijnen', async () => {
  const gemaakt = await request(app.getHttpServer() as App)
    .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
    .set('Cookie', cookieAdminA)
    .send({ verdict: 'goedgekeurd', toelichting: 'Akkoord.' })
    .expect(201);

  const reviewId = (gemaakt.body as BeoordelingBody).beoordeling.reviewId;

  await request(app.getHttpServer() as App)
    .delete(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews/${reviewId}`)
    .set('Cookie', cookieAdminA)
    .expect(204);

  const lijst = await request(app.getHttpServer() as App)
    .get(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
    .set('Cookie', cookieAdminA)
    .expect(200);

  const ids = (lijst.body as { beoordelingen: { reviewId: string }[] })
    .beoordelingen.map((b) => b.reviewId);
  expect(ids).not.toContain(reviewId);
});

it('bewaart een ingetrokken oordeel in de database', async () => {
  const gemaakt = await request(app.getHttpServer() as App)
    .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
    .set('Cookie', cookieAdminA)
    .send({ verdict: 'goedgekeurd', toelichting: 'Akkoord.' })
    .expect(201);

  const reviewId = (gemaakt.body as BeoordelingBody).beoordeling.reviewId;

  await request(app.getHttpServer() as App)
    .delete(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews/${reviewId}`)
    .set('Cookie', cookieAdminA)
    .expect(204);

  // Wissen zou de historie kapotmaken die deze tabel juist bewaart.
  const rij = await db.query(
    `SELECT deleted_at FROM clm.survey_review WHERE review_id = $1`,
    [reviewId],
  );
  expect(rij.rows).toHaveLength(1);
  expect(rij.rows[0].deleted_at).not.toBeNull();
});

it('geeft 404 bij het intrekken van een onbekend oordeel', async () => {
  await request(app.getHttpServer() as App)
    .delete(
      `/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews/00000000-0000-0000-0000-00000000ffff`,
    )
    .set('Cookie', cookieAdminA)
    .expect(404);
});
```

De tweede test is de belangrijkste: hij bewijst dat intrekken een `deleted_at` zet en geen `DELETE` uitvoert. Gebruik dezelfde `Client`-opzet als `beoordeling.e2e-spec.ts` voor de directe databasecontrole.

- [ ] **Stap 2: Draai en zie ze falen**

Run:
```powershell
npm run test:e2e -- goedkeuren
```
Expected: FAIL met 404 op de DELETE-route (bestaat nog niet).

- [ ] **Stap 3: Voeg de servicemethode toe**

Modify `src/survey/beoordeling.service.ts`, ná `voegToe`:

```ts
  /**
   * Trekt een oordeel in.
   *
   * Zet `deleted_at` en verwijdert niets. De tabel is append-only: wissen zou
   * de historie kapotmaken die deze tabel juist bewaart, en een goedkeuring die
   * spoorloos kan verdampen maakt de status onbetrouwbaar.
   *
   * Wie mag intrekken is niet beperkt, consequent met beoordelen zelf (plan
   * §2a): elke handeling ligt met naam en datum vast, dus niemand kan iets
   * stilletjes doen.
   */
  async trekIn(
    tenantId: string,
    responseId: string,
    reviewId: string,
  ): Promise<void> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const geraakt = await tx.execute(
          sql`UPDATE clm.survey_review
                 SET deleted_at = now()
               WHERE review_id = ${reviewId}
                 AND response_id = ${responseId}
                 AND deleted_at IS NULL`,
        );

        if (geraakt.rowCount === 0) {
          throw new NotFoundException(
            'Dit oordeel bestaat niet, of is al ingetrokken.',
          );
        }
      },
      'medewerker',
    );
  }
```

- [ ] **Stap 4: Voeg de route toe**

Modify `src/survey/vragenlijst-beheer.controller.ts`, ná de `@Post('responses/:id/reviews')`-methode:

```ts
  /**
   * Trekt een oordeel in.
   *
   * Geen `@VereistRol('admin')`, consequent met beoordelen zelf: elke handeling
   * ligt met naam en datum vast. 204 bij succes, 404 als het oordeel niet
   * bestaat binnen deze tenant of al is ingetrokken.
   */
  @Delete('responses/:id/reviews/:reviewId')
  @HttpCode(204)
  async trekBeoordelingIn(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Param('reviewId') reviewId: string,
  ): Promise<void> {
    const sessie = request.sessie!;

    await this.beoordelingen_.trekIn(sessie.tenantId, id, reviewId);
  }
```

Controleer dat `Delete` en `HttpCode` in de import uit `@nestjs/common` staan; `Delete` staat er al (regel 269 gebruikt hem), `HttpCode` mogelijk nog niet.

- [ ] **Stap 5: Draai en zie ze slagen**

Run:
```powershell
npm run test:e2e -- goedkeuren
```
Expected: PASS, alle tests in de suite.

- [ ] **Stap 6: Commit**

```bash
git add src/survey/beoordeling.service.ts src/survey/vragenlijst-beheer.controller.ts test/goedkeuren.e2e-spec.ts
git commit -m "feat(survey): een oordeel intrekken zonder de historie te wissen"
```

---

## Taak 6: Tenantisolatie en leverancierafscherming

De policy verandert niet, maar een nieuwe route verdient een eigen bewijs. Zonder deze taak is er geen test die aantoont dat tenant B niet kan intrekken bij A.

**Files:**
- Test: `test/goedkeuren.e2e-spec.ts`

- [ ] **Stap 1: Schrijf de tests**

```ts
it('laat tenant B niet goedkeuren op een respons van tenant A', async () => {
  await request(app.getHttpServer() as App)
    .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
    .set('Cookie', cookieAdminB)
    .send({ verdict: 'goedgekeurd', toelichting: 'Akkoord.' })
    .expect(404);
});

it('laat tenant B geen oordeel van tenant A intrekken', async () => {
  const gemaakt = await request(app.getHttpServer() as App)
    .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
    .set('Cookie', cookieAdminA)
    .send({ verdict: 'goedgekeurd', toelichting: 'Akkoord.' })
    .expect(201);

  const reviewId = (gemaakt.body as BeoordelingBody).beoordeling.reviewId;

  await request(app.getHttpServer() as App)
    .delete(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews/${reviewId}`)
    .set('Cookie', cookieAdminB)
    .expect(404);
});
```

404 en niet 403: het verschil tussen "bestaat niet" en "mag je niet zien" hoort niet naar buiten te lekken (zie de toelichting bij `responses/:id/answers`).

- [ ] **Stap 2: Draai de tests**

Run:
```powershell
npm run test:e2e -- goedkeuren
```
Expected: PASS — RLS regelt dit.

- [ ] **Stap 3: Tegenproef op de isolatie (§15b)**

Wijzig **tijdelijk** in `beoordeling.service.ts` de `trekIn`-aanroep van `'medewerker'` naar `'leverancier'`:

Run:
```powershell
npm run test:e2e -- goedkeuren
```
Expected: de intrek-tests FAIL — de policy eist actor `medewerker`.

Draai terug met `git checkout src/survey/beoordeling.service.ts`, draai opnieuw, alles PASS. Noteer in de PR-body.

- [ ] **Stap 4: Commit**

```bash
git add test/goedkeuren.e2e-spec.ts
git commit -m "test(survey): tenantisolatie op goedkeuren en intrekken"
```

---

## Taak 7: Volledige controle en PR

- [ ] **Stap 1: Draai alles**

Run:
```powershell
npm run lint:check
npm run typecheck
npm test
npm run test:e2e
```
Expected: alles groen. Noteer het aantal e2e-tests — dat was 358 vóór dit werk.

- [ ] **Stap 2: Bewijs de migratieketen vanaf leeg**

Run:
```powershell
npm run verify:volledig
```

Dit is het zwaarste controlescript (`scripts/verify-volledig.js`) en het dichtst bij wat CI doet. Expected: schemaconformiteit GOEDGEKEURD, RLS geforceerd, alle suites groen.

**Waarom dit niet overgeslagen mag worden bij een migratie:** de vorige stap bewijst dat 0017 werkt op *jouw* database, die al 0016 had. Dit bewijst dat de hele keten vanaf leeg klopt — precies wat de `rls-isolation`-job in CI controleert, en waar op 2026-08-06 twee migraties ongecontroleerd op stapelden.

- [ ] **Stap 3: Push en maak de PR**

```bash
git push -u origin feat/goedkeuren-migratie-0017
```

PR-body moet bevatten:
- Wat erbij komt (één CHECK-constraint, één route, één waarde)
- **Waarom geen aparte tabel** (§3.2 van de uitwerking, kort samengevat)
- **Waarom toelichting optioneel is bij goedkeuren** maar niet bij `niet_goed`
- **De twee tegenproeven uit Taak 4 stap 3 en Taak 6 stap 3**, met wat er precies omviel
- Aantal e2e-tests voor en na

- [ ] **Stap 4: Wacht op groene CI en meld het**

Run:
```powershell
gh pr checks --watch
```

Merge niet zonder overleg met de eigenaar.

---

## Zelfcontrole op dit plan

**Dekking van de uitwerking:** §3.2 (goedgekeurd als vierde verdict) → Taak 1+2. §7 V1 (identiteit vastgelegd) → Taak 4. §7 V2 (intrekken zichtbaar) → Taak 5. §7 V3 (laatste oordeel telt) → **niet hier**: dat is de statusberekening en hoort bij stap 3 van de uitwerking, niet bij deze migratie.

**Wat dit plan bewust niet doet:** de statusberekening (§3.3), `response_note` (migratie 0018), de werkvoorraad van de contractmanager, en alle schermen. Elk daarvan krijgt een eigen plan. Dit plan levert één migratie plus de routes die hem bruikbaar maken.

**Alle commando's in dit plan zijn geverifieerd tegen `package.json` en `scripts/`** op 2026-08-07. Let op twee valkuilen die tijdens het schrijven naar boven kwamen:

- Er is **geen** `npm run migrate` en **geen** `migrate:status`. Migraties draaien met `npm run migrate:deploy`, via `MIGRATION_DATABASE_URL` (rol `clm_migrator`), niet via `DATABASE_URL`. Dat verschil is precies waar Issue #86 op misging: het script meldde "Migraties voltooid" tegen de verkeerde database.
- Er is **geen** los bestand met verwachte schemadefinities. `verify:schema` leidt de verwachting af uit het Drizzle-schema.
