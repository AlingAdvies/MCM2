# Vastgestelde notitie — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `response_note` krijgt een `soort`-kolom (`werk` / `vastgesteld`) zodat een
beheerder een na overleg met de leverancier overeengekomen wijziging herkenbaar kan
vastleggen, zonder het oorspronkelijke ingediende antwoord aan te tasten.

**Architecture:** Eén handgeschreven migratie voegt de kolom toe met een `CHECK`-constraint,
in de stijl van `survey_review.verdict`. `NotitieService.voegToe()` en de invoervalidatie
(`leesNotitie` in `ronde-invoer.ts`) krijgen het veld erbij; de route-vorm
(`POST/GET/DELETE .../notes`) verandert niet. Een nieuwe e2e-test bewijst dat een
`vastgesteld`-notitie, net als een gewone notitie, niet via het leverancierspad leesbaar is.
Losse fase 2 (aparte repo `MCM2-frontend`) voegt de toggle en de badge toe.

**Tech Stack:** NestJS, Drizzle (handgeschreven SQL-migraties), PostgreSQL met RLS, Jest/Supertest voor e2e. Frontend: Next.js/React, TypeScript.

---

## Spec-referentie

Dit plan implementeert `docs/superpowers/specs/2026-08-24-vastgestelde-notitie-design.md`
volledig: §4 (migratie), §5 (backend), §7 (frontend), §8 (tegenproef). §6 (herinneringen) is
expliciet buiten scope en wordt hier niet gebouwd.

---

## Fase 1 — Backend (deze repo, branch `docs/vastgestelde-notitie-design`)

### Task 1: Migratie — `soort`-kolom op `response_note`

**Files:**
- Create: `drizzle/0030_response_note_soort.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- =============================================================================
-- clm.response_note — kolom "soort": werk versus vastgesteld.
--
-- Aanleiding: docs/superpowers/specs/2026-08-24-vastgestelde-notitie-design.md.
-- Een ingediende respons kan tussen tenant en leverancier besproken worden; de
-- uitkomst van dat overleg moet vastgelegd kunnen worden zonder het
-- oorspronkelijke, bevroren antwoord (survey_answer) aan te tasten.
--
-- ── Waarom een kolom en geen nieuwe tabel ────────────────────────────────────
--
-- Een "vastgestelde" notitie is qua vorm identiek aan een gewone notitie: vrije
-- tekst, wie, wanneer, nooit overschreven, alleen ingetrokken via deleted_at.
-- Het enige verschil is betekenis. Een parallelle tabel zou dezelfde velden
-- dupliceren voor niets.
--
-- Bestaande rijen krijgen 'werk' — geen gedragswijziging voor wat er al staat.
-- =============================================================================

ALTER TABLE "clm"."response_note"
    ADD COLUMN "soort" text NOT NULL DEFAULT 'werk';--> statement-breakpoint

ALTER TABLE "clm"."response_note"
    ADD CONSTRAINT "response_note_soort_check"
    CHECK (soort IN ('werk', 'vastgesteld'));--> statement-breakpoint

COMMENT ON COLUMN clm.response_note.soort IS
    'werk: losse werkaantekening. vastgesteld: een na overleg met de leverancier overeengekomen wijziging, vastgelegd naast het onaangetaste oorspronkelijke antwoord.';
```

- [ ] **Step 2: Voeg de migratie toe aan `drizzle/meta/_journal.json`**

Open `drizzle/meta/_journal.json`, en voeg vóór de sluitende `]` van de `entries`-array een
nieuw item toe (na de `0029_contract_opzegtermijn`-entry):

```json
    {
      "idx": 30,
      "version": "7",
      "when": 1787068800004,
      "tag": "0030_response_note_soort",
      "breakpoints": true
    }
```

MCM2-CLAUDE.md §3: zonder deze entry slaat Drizzle de migratie stilzwijgend over.

- [ ] **Step 3: Voer de migratie uit tegen een wegwerpcontainer**

Zet een eigen acceptatiecontainer op (nooit poort 55450, nooit een Supabase-URL):

```bash
docker run -d --name mcm2-plan-test -p 127.0.0.1:55440:5432 -e POSTGRES_PASSWORD=test postgres:16
```

Wacht tot de container gezond is, markeer hem als wegwerp en draai de migraties:

```bash
DATABASE_URL=postgresql://postgres:test@127.0.0.1:55440/postgres node scripts/markeer-wegwerp.js "plan-test 0030"
MIGRATION_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55440/postgres npm run migrate:deploy
```

Expected: de output noemt `0030_response_note_soort` als toegepast, geen foutmelding.

- [ ] **Step 4: Controleer de kolom en constraint direct in de database**

```bash
docker exec mcm2-plan-test psql -U postgres -c "\d clm.response_note"
```

Expected: `soort` staat in de kolomlijst met `not null default 'werk'::text`, en
`response_note_soort_check` staat bij de constraints.

- [ ] **Step 5: Commit**

```bash
git add drizzle/0030_response_note_soort.sql drizzle/meta/_journal.json
git commit -m "feat(survey): soort-kolom op response_note (werk/vastgesteld)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `NotitieService` — `soort` doorgeven en teruggeven

**Files:**
- Modify: `src/survey/notitie.service.ts`

- [ ] **Step 1: Breid de `Notitie`-interface en de rij-interface uit**

In `src/survey/notitie.service.ts`, pas de bestaande interfaces aan:

```typescript
export interface Notitie {
  noteId: string;
  responseId: string;
  tekst: string;
  /** 'werk' (standaard) of 'vastgesteld' — zie migratie 0030. */
  soort: 'werk' | 'vastgesteld';
  authorUserId: string;
  /** Null wanneer de gebruiker geen naam heeft — dan toont het scherm het adres. */
  authorNaam: string | null;
  /** Wanneer de notitie is geschreven. ISO-8601, altijd gevuld. */
  createdAt: string;
}

interface NotitieRij extends Record<string, unknown> {
  note_id: string;
  response_id: string;
  tekst: string;
  soort: string;
  author_user_id: string;
  author_naam: string | null;
  created_at: Date | string;
}
```

- [ ] **Step 2: Neem `soort` op in `lijst()`**

Vervang de `SELECT` in `lijst()`:

```typescript
        const resultaat = await tx.execute<NotitieRij>(
          sql`SELECT n.note_id,
                     n.response_id,
                     n.tekst,
                     n.soort,
                     n.author_user_id,
                     u.full_name AS author_naam,
                     n.created_at
                FROM clm.response_note n
                LEFT JOIN clm."user" u ON u.user_id = n.author_user_id
               WHERE n.response_id = ${responseId}
                 AND n.deleted_at IS NULL
               ORDER BY n.created_at DESC`,
        );
```

- [ ] **Step 3: `voegToe()` krijgt `soort` als parameter**

Vervang de signatuur en de query in `voegToe()`:

```typescript
  async voegToe(
    tenantId: string,
    responseId: string,
    authorUserId: string,
    tekst: string,
    soort: 'werk' | 'vastgesteld' = 'werk',
  ): Promise<Notitie> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        await this.eisBestaandeRespons(tx, responseId);

        const resultaat = await tx.execute<NotitieRij>(
          sql`WITH nieuw AS (
                INSERT INTO clm.response_note
                       (tenant_id, response_id, tekst, soort, author_user_id)
                VALUES (${tenantId}, ${responseId}, ${tekst}, ${soort}, ${authorUserId})
                RETURNING note_id, response_id, tekst, soort, author_user_id, created_at
              )
              SELECT n.note_id,
                     n.response_id,
                     n.tekst,
                     n.soort,
                     n.author_user_id,
                     u.full_name AS author_naam,
                     n.created_at
                FROM nieuw n
                LEFT JOIN clm."user" u ON u.user_id = n.author_user_id`,
        );

        const rij = resultaat.rows[0];
        if (!rij) {
          throw new BadRequestException(
            'De notitie kon niet worden opgeslagen.',
          );
        }

        return this.naarNotitie(rij);
      },
      'medewerker',
    );
  }
```

- [ ] **Step 4: `naarNotitie()` geeft `soort` mee**

```typescript
  private naarNotitie(r: NotitieRij): Notitie {
    return {
      noteId: r.note_id,
      responseId: r.response_id,
      tekst: r.tekst,
      soort: r.soort === 'vastgesteld' ? 'vastgesteld' : 'werk',
      authorUserId: r.author_user_id,
      authorNaam: r.author_naam,
      createdAt: iso(r.created_at) ?? '',
    };
  }
```

- [ ] **Step 5: Compileer**

```bash
npx tsc --noEmit
```

Expected: geen fouten in `notitie.service.ts`. (`vragenlijst-beheer.controller.ts` geeft op
dit punt nog een fout omdat `voegToe()` daar nog met het oude aantal argumenten wordt
aangeroepen via `leesNotitie` — dat lost Task 3 op.)

- [ ] **Step 6: Commit**

```bash
git add src/survey/notitie.service.ts
git commit -m "feat(survey): NotitieService geeft soort mee (werk/vastgesteld)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Invoervalidatie — `leesNotitie` accepteert `soort`

**Files:**
- Modify: `src/survey/ronde-invoer.ts`
- Modify: `src/survey/vragenlijst-beheer.controller.ts`

- [ ] **Step 1: Pas `leesNotitie` aan om een object terug te geven**

In `src/survey/ronde-invoer.ts`, vervang de huidige `leesNotitie`:

```typescript
export interface NotitieInvoer {
  tekst: string;
  soort: 'werk' | 'vastgesteld';
}

/**
 * Leest de tekst en het soort van een notitie (migratie 0018, soort sinds
 * migratie 0030).
 *
 * Alleen tekst en soort. De schrijver komt uit de sessie en de respons uit
 * het pad — die horen niet in een body waar een client ze kan verzinnen (§6).
 *
 * `soort` is optioneel in de invoer en valt terug op 'werk': bestaande
 * clients die het veld niet meesturen blijven werken zoals voorheen.
 */
export function leesNotitie(body: unknown): NotitieInvoer {
  const invoer = leesObject(body);

  if (typeof invoer.tekst !== 'string') {
    throw new InvoerFout('tekst', 'De notitie moet tekst zijn.');
  }

  const tekst = invoer.tekst.trim();

  if (tekst === '') {
    throw new InvoerFout('tekst', 'Een lege notitie heeft geen zin.');
  }

  if (tekst.length > NOTITIE_MAX_TEKENS) {
    throw new InvoerFout(
      'tekst',
      `Een notitie is maximaal ${NOTITIE_MAX_TEKENS} tekens. Hoort dit ergens anders thuis?`,
    );
  }

  let soort: 'werk' | 'vastgesteld' = 'werk';
  if (invoer.soort !== undefined && invoer.soort !== null) {
    if (invoer.soort !== 'werk' && invoer.soort !== 'vastgesteld') {
      throw new InvoerFout(
        'soort',
        "Het soort moet 'werk' of 'vastgesteld' zijn.",
      );
    }
    soort = invoer.soort;
  }

  return { tekst, soort };
}
```

Let op: dit vervangt de bestaande functie volledig — inclusief het commentaarblok erboven,
dat naar migratie 0030 moet gaan verwijzen naast 0018. Controleer met een `Read` van het
bestand vóór het bewerken wat er precies rond `NOTITIE_MAX_TEKENS` en het commentaar staat,
en pas alleen de functie zelf aan (niet de constante).

- [ ] **Step 2: Werk de aanroep in de controller bij**

In `src/survey/vragenlijst-beheer.controller.ts`, zoek de methode `plaatsNotitie` (rond
regel 268) en vervang:

```typescript
  async plaatsNotitie(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let invoer: ReturnType<typeof leesNotitie>;
    try {
      invoer = leesNotitie(body);
    } catch (err) {
      throw this.naarHttpFout(err);
    }

    const notitie = await this.notities_.voegToe(
      sessie.tenantId,
      id,
      sessie.userId,
      invoer.tekst,
      invoer.soort,
    );

    return { notitie };
  }
```

- [ ] **Step 3: Compileer**

```bash
npx tsc --noEmit
```

Expected: geen fouten.

- [ ] **Step 4: Commit**

```bash
git add src/survey/ronde-invoer.ts src/survey/vragenlijst-beheer.controller.ts
git commit -m "feat(survey): soort-veld in de invoer voor een notitie

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: e2e-tests — `soort` opslaan, teruggeven, en de leverancierspad-tegenproef

**Files:**
- Modify: `test/notities.e2e-spec.ts`
- Modify: `test/test-ids.ts`

- [ ] **Step 1: Voeg een test-id toe voor de leverancierstoken**

In `test/test-ids.ts`, binnen het `notities`-blok (rond regel 262), voeg een veld toe voor
het ruwe token dat bij `RESPONSE_INGEDIEND` hoort — nodig om als leverancier in te loggen op
het bestaande antwoordlees-pad. Zoek eerst hoe een ander e2e-bestand een leveranciers-token
test-id benoemt (bijvoorbeeld `test/beoordelen.e2e-spec.ts` of vergelijkbaar, via
`grep -rn "tokenLeverancier\|rawToken\|token:" test/*.e2e-spec.ts`) en volg exact diezelfde
naamgeving en vorm in het `notities`-blok van `test-ids.ts`. Dit voorkomt een los, verzonnen
veldnaam naast een bestaande conventie.

- [ ] **Step 2: Breid de interfaces in `notities.e2e-spec.ts` uit met `soort`**

```typescript
interface NotitieBody {
  notitie: {
    noteId: string;
    tekst: string;
    soort: 'werk' | 'vastgesteld';
    authorUserId: string;
    authorNaam: string | null;
    createdAt: string;
  };
}

interface LijstBody {
  notities: Array<{
    noteId: string;
    tekst: string;
    soort: 'werk' | 'vastgesteld';
    authorNaam: string | null;
    createdAt: string;
  }>;
}
```

- [ ] **Step 3: Test — een notitie zonder `soort` in de body wordt `werk`**

Voeg toe in `describe('een notitie plaatsen', ...)`:

```typescript
    it("zonder soort in de body wordt 'werk'", async () => {
      const antwoord = await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes`)
        .set('Cookie', cookieAdminA)
        .send({ tekst: 'Gewone werkaantekening.' })
        .expect(201);

      expect((antwoord.body as NotitieBody).notitie.soort).toBe('werk');
    });

    it("met soort 'vastgesteld' legt de overeengekomen wijziging vast", async () => {
      const antwoord = await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes`)
        .set('Cookie', cookieAdminA)
        .send({
          tekst: 'Na overleg akkoord op aangepaste levertermijn.',
          soort: 'vastgesteld',
        })
        .expect(201);

      expect((antwoord.body as NotitieBody).notitie.soort).toBe('vastgesteld');
    });

    it('weigert een onbekend soort', async () => {
      await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes`)
        .set('Cookie', cookieAdminA)
        .send({ tekst: 'Ongeldig soort.', soort: 'definitief' })
        .expect(400);
    });
```

- [ ] **Step 4: Test — de lijst geeft `soort` per notitie mee**

Voeg toe in `describe('notities lezen', ...)`:

```typescript
    it('geeft het soort van elke notitie mee', async () => {
      await plaats(RESPONSE_INGEDIEND, 'Werkaantekening voor de lijsttest.');

      const antwoord = await request(server)
        .get(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes`)
        .set('Cookie', cookieAdminA)
        .expect(200);

      const { notities } = antwoord.body as LijstBody;
      for (const n of notities) {
        expect(['werk', 'vastgesteld']).toContain(n.soort);
      }
    });
```

- [ ] **Step 5: Tegenproef — het leverancierspad kan een `vastgesteld`-notitie niet lezen**

Dit is de tegenproef uit spec §8. Voeg een nieuwe `describe`-blok toe, ná
`describe('de tenantgrens', ...)`. Doorzoek eerst `src/survey/*.ts` op de bestaande route
waarmee een leverancier zijn eigen respons opvraagt (`grep -n "@Post\|@Get"
src/survey/survey-response.controller.ts`) en het exacte tokenpad
(`/survey/:token` of vergelijkbaar — controleer de daadwerkelijke route voordat je dit
schrijft, geen aanname). Vul die route hieronder in op de plek van `<LEVERANCIERS_PAD>`:

```typescript
  describe('het leverancierspad', () => {
    it('geeft geen response_note terug, ook geen vastgesteld-notitie', async () => {
      await plaats(RESPONSE_INGEDIEND, 'Vertrouwelijke werkaantekening.');
      await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes`)
        .set('Cookie', cookieAdminA)
        .send({
          tekst: 'Overeengekomen na overleg.',
          soort: 'vastgesteld',
        })
        .expect(201);

      const antwoord = await request(server).get(
        `<LEVERANCIERS_PAD>/${RAW_TOKEN_INGEDIEND}`,
      );

      // Wat de route ook teruggeeft (200 met de respons, of een andere vorm),
      // response_note/notities mag er nergens in voorkomen.
      expect(JSON.stringify(antwoord.body)).not.toContain('response_note');
      expect(JSON.stringify(antwoord.body)).not.toContain(
        'Overeengekomen na overleg.',
      );
    });
  });
```

Als er geen bestaande route is die de volledige respons inclusief gerelateerde data
teruggeeft aan de leverancier (dus als er domweg geen enkele leverancierspad-route bestaat
die ooit `response_note` zou kunnen meesturen), volstaat een eenvoudigere tegenproef: een
rechtstreekse databasequery met `app.current_actor = 'leverancier'` gezet, die moet
uitkomen op nul rijen:

```typescript
    it('de policy geeft nul rijen met actor leverancier', async () => {
      await plaats(RESPONSE_INGEDIEND, 'Alleen voor medewerkers.');

      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
      await client.query(`SET LOCAL app.current_actor = 'leverancier'`);
      const rijen = await client.query(
        'SELECT * FROM clm.response_note WHERE response_id = $1',
        [RESPONSE_INGEDIEND],
      );
      await client.query('ROLLBACK');

      expect(rijen.rows).toHaveLength(0);
    });
```

Kies de eerste vorm als er een leverancierspad-route bestaat die de test er echt langs
stuurt (conform MCM2-CLAUDE.md §15b: test een lek bij de bron). Gebruik de tweede vorm alleen
als er geen zinvolle route is om de test doorheen te sturen.

- [ ] **Step 6: Run de nieuwe en bestaande tests**

```bash
DATABASE_URL=postgresql://postgres:test@127.0.0.1:55440/postgres npx jest test/notities.e2e-spec.ts -i
```

Expected: alle tests slagen, inclusief de vier nieuwe.

- [ ] **Step 7: Run test-ids en de volledige e2e-run**

Conform MCM2-CLAUDE.md §"Een nieuwe e2e-suite schrijven": één suite die los groen draait kan
de volledige run alsnog rood maken.

```bash
DATABASE_URL=postgresql://postgres:test@127.0.0.1:55440/postgres npx jest test-ids -i
DATABASE_URL=postgresql://postgres:test@127.0.0.1:55440/postgres npm run verify:volledig
```

Expected: beide groen.

- [ ] **Step 8: Commit**

```bash
git add test/notities.e2e-spec.ts test/test-ids.ts
git commit -m "test(survey): soort-veld op notitie, incl. leverancierspad-tegenproef

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Opruimen van de wegwerpcontainer

**Files:** geen

- [ ] **Step 1: Verwijder de testcontainer**

```bash
docker rm -f mcm2-plan-test
```

- [ ] **Step 2: Geen commit nodig (geen bestandswijziging)**

---

## Fase 2 — Frontend (aparte repo `c:/DEV/Work/MCM2-frontend`)

Deze fase hoort in een eigen PR op `MCM2-frontend`, ná fase 1 (de backend-route moet
`soort` al accepteren en teruggeven). Voor de exacte plek: het bestaande responsdetail-scherm
met notities zit vermoedelijk onder `src/app/beheer/status/[responseId]` (zie de
`find`-uitkomst uit de brainstorm: `src/app/beheer/status/[responseId]` bestaat als route).

### Task 6: Model en service — `soort` in het frontend-type

**Files:**
- Modify: `c:/DEV/Work/MCM2-frontend/src/core/models/vragenlijst.ts`
- Modify: `c:/DEV/Work/MCM2-frontend/src/core/services/beoordelenService.ts`

- [ ] **Step 1: Lees beide bestanden volledig eerst**

```bash
cd c:/DEV/Work/MCM2-frontend
grep -n "noteId\|Notitie" src/core/models/vragenlijst.ts
grep -n "notes\|Notitie" src/core/services/beoordelenService.ts
```

Lees beide bestanden volledig met Read voordat je iets wijzigt — de exacte huidige vorm van
het `Notitie`-type en de service-functie is niet aangenomen, alleen dat ze in deze twee
bestanden staan (geverifieerd tijdens het schrijven van dit plan).

- [ ] **Step 2: Voeg `soort` toe aan het type**

Pas het gevonden type aan naar het patroon:

```typescript
export interface Notitie {
  noteId: string;
  tekst: string;
  soort: 'werk' | 'vastgesteld';
  authorNaam: string | null;
  createdAt: string;
}
```

- [ ] **Step 3: Geef `soort` door in de plaats-functie**

Pas de functie die `POST .../notes` aanroept aan zodat ze een optioneel `soort`-argument
doorstuurt in de body (standaard `'werk'` als niet meegegeven), op dezelfde manier als de
bestaande `tekst`-parameter wordt doorgegeven.

- [ ] **Step 4: Compileer**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(notities): soort-veld in het frontend-model en de service

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Toggle bij het notitieveld en badge in de lijst

**Files:**
- Modify: `c:/DEV/Work/MCM2-frontend/src/app/beheer/status/[responseId]/page.tsx`

- [ ] **Step 1: Lees het volledige scherm-bestand eerst**

```bash
cd c:/DEV/Work/MCM2-frontend
grep -n "notitie\|Notitie" "src/app/beheer/status/[responseId]/page.tsx"
```

Open dit bestand met Read voordat je iets wijzigt — dit plan schrijft geen component-JSX
zonder de bestaande structuur gezien te hebben, om geen stijl te breken. Als het notitieblok
in dit bestand niet voorkomt (bijvoorbeeld omdat het in een los subcomponent zit), volg de
import in dit bestand naar dat subcomponent en pas de stappen van dit plan daar toe in
plaats van op `page.tsx`.

- [ ] **Step 2: Voeg een checkbox toe bij het bestaande notitie-tekstveld**

Naast/onder het bestaande `<textarea>` (of vergelijkbaar) voor de notitietekst, een checkbox:

```tsx
<label className="mt-2 flex items-center gap-2 text-sm text-ink-muted">
  <input
    type="checkbox"
    checked={soort === 'vastgesteld'}
    onChange={(e) => setSoort(e.target.checked ? 'vastgesteld' : 'werk')}
    data-testid="notitie-vastgesteld-toggle"
  />
  Vastgesteld na overleg met de leverancier
</label>
```

Voeg de bijbehorende `useState`-hook toe waar de andere formulierstate van dit scherm al
staat:

```tsx
const [soort, setSoort] = useState<'werk' | 'vastgesteld'>('werk');
```

Geef `soort` mee aan de bestaande aanroep die de notitie plaatst, en reset hem naar `'werk'`
zodra het formulier na verzenden leegt (op dezelfde plek waar het tekstveld al geleegd
wordt).

- [ ] **Step 3: Badge in de notitielijst**

Bij het renderen van elke notitie in de lijst, direct naast de datum/naam:

```tsx
{notitie.soort === 'vastgesteld' && (
  <span
    data-testid="notitie-vastgesteld-badge"
    className="ml-2 inline-flex items-center rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800"
  >
    Vastgesteld
  </span>
)}
```

- [ ] **Step 4: Compileer en lint**

```bash
npx tsc --noEmit
npx eslint <het gewijzigde bestand>
```

Expected: geen fouten, geen nieuwe warnings.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(notities): toggle en badge voor vastgestelde notities

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-review — dekking tegen de spec

- §4 (migratie, kolom + CHECK) → Task 1.
- §5 (`NotitieService.voegToe()`, `leesNotitie`, route-vorm ongewijzigd) → Task 2, Task 3.
- §7 (toggle bij notitieveld, badge in lijst, geen apart scherm) → Task 6, Task 7.
- §8 (tegenproef leverancierspad) → Task 4, Step 5.
- §6 (herinneringen expliciet buiten scope) → niet in dit plan, zoals bedoeld.

Geen taak verwijst naar een niet-bestaande functie: `NotitieService.voegToe()`,
`leesNotitie()`, `InvoerFout`, `leesObject()` zijn allemaal geverifieerd in de bestaande
code vóór dit plan geschreven is. De frontend-taken (6, 7) benoemen expliciet "zoek eerst,
lees eerst" omdat de exacte bestandsnamen in `MCM2-frontend` niet geverifieerd zijn tijdens
het schrijven van dit plan — dat is bewust geen aanname, de stap zelf dwingt het opzoeken af
voordat er geschreven wordt.
