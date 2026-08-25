# Contactinfo op de vragenlijst — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** de leverancier ziet in de vragenlijst zelf wie hij bij vragen kan benaderen, gevuld
uit een prioriteitsketen (tenant-antwoordadres → contract-eigenaar → vendor-eigenaar → geen
regel), zonder dat er verder iets nieuws over de tenant/vendor/respons lekt op het
leverancierspad.

**Architecture:** `VragenlijstLeesService` (backend) krijgt één extra query die, uitsluitend
vanaf `response_id`, de drie bronnen in volgorde probeert en het resultaat toevoegt aan het
bestaande `Vragenlijst`-object dat `GET /survey/respond/questions` teruggeeft. Geen migratie
— alle drie bronnen bestaan al. De bestaande lek-detectietest in
`test/vragenlijst-ophalen.e2e-spec.ts` wordt uitgebreid, niet vervangen. Losse Fase 2 (aparte
repo `MCM2-frontend`) toont de contactregel onderaan het portaalscherm.

**Tech Stack:** NestJS, Drizzle (raw SQL via `tx.execute`), PostgreSQL met RLS, Jest/Supertest
voor e2e. Frontend: Next.js/React, TypeScript.

---

## Spec-referentie

Dit plan implementeert `docs/superpowers/specs/2026-08-25-contactinfo-vragenlijst-design.md`
volledig: §2 (prioriteitsketen), §3 (route-keuze — geen wijziging nodig, hij ligt al vast),
§4 (backend-implementatie inclusief beveiligingscomment), §5 (tegenproef), §6 (frontend), §7
(scope-grenzen, geen actie nodig — niets daarvan wordt gebouwd).

---

## Fase 1 — Backend (deze repo, branch `docs/contactinfo-vragenlijst-design`)

### Task 1: `Contactinfo`-interface en `haalContactinfo()` op `VragenlijstLeesService`

**Files:**
- Modify: `src/survey/vragenlijst-lezen.service.ts`

- [ ] **Step 1: Voeg de `Contactinfo`-interface toe en breid `Vragenlijst` uit**

In `src/survey/vragenlijst-lezen.service.ts`, direct na de bestaande `Vragenlijst`-interface
(rond regel 77-84), voeg toe:

```typescript
/**
 * Wie de leverancier kan benaderen bij vragen over deze vragenlijst.
 *
 * `naam` is `null` wanneer de bron het tenant-antwoordadres is (een generiek
 * adres, geen persoon) — zie de bewuste-uitzondering-comment op
 * `haalContactinfo()` hieronder voor de volledige toelichting.
 */
export interface Contactinfo {
  naam: string | null;
  email: string;
}
```

Pas de bestaande `Vragenlijst`-interface aan:

```typescript
export interface Vragenlijst {
  name: string;
  /** Leeg bij een platte lijst (UC1); gevuld bij een ingedeelde lijst (UC2). */
  categories: Categorie[];
  /** Vragen zonder categorie. Bij UC1 staat hier alles in. */
  questions: Vraag[];
  closesAt: string | null;
  contactinfo: Contactinfo | null;
}
```

- [ ] **Step 2: Voeg de rij-interface voor de contactinfo-query toe**

Direct na `VraagRij` (rond regel 86-101), voeg toe:

```typescript
interface ContactinfoRij extends Record<string, unknown> {
  tenant_antwoord_email: string | null;
  contract_owner_naam: string | null;
  contract_owner_email: string | null;
  vendor_owner_naam: string | null;
  vendor_owner_email: string | null;
}
```

- [ ] **Step 3: Voeg `haalContactinfo()` toe als private methode**

Voeg deze methode toe aan de `VragenlijstLeesService`-class, na `haalOpgeslagenBijlagen`
(aan het einde van de class, vóór de sluitende `}`):

```typescript
  /**
   * Contactinfo voor de leverancier: wie te benaderen bij vragen over deze
   * vragenlijst.
   *
   * ── Bewuste uitzondering op de regel dat dit pad geen tenant-info teruggeeft ──
   *
   * Zie de class-comment hierboven en die van `SurveyResponseController`: dit
   * pad geeft standaard geen tenant-, vendor- of responsdata terug. Dit veld
   * is een bewuste, individuele uitzondering (besluit eigenaar 25-08,
   * docs/superpowers/specs/2026-08-25-contactinfo-vragenlijst-design.md),
   * niet een precedent voor meer. Drie redenen: de leverancier kent de
   * afzender al uit de uitnodigingsmail, dit is een zakelijk adres binnen
   * een bestaande contractrelatie (geen bijzonder persoonsgegeven), en er
   * komt verder geen tenant-/vendor-/responsdata bij. Elke volgende
   * toevoeging aan dit pad vraagt een eigen afweging — dit dekt alleen
   * contactinfo.
   *
   * ── Prioriteit ──────────────────────────────────────────────────────────
   *
   * 1. tenant.antwoord_email (geen naam — generiek tenant-adres)
   * 2. contract.owner_user_id, via survey_run.contract_id, als de ronde aan
   *    een contract hangt
   * 3. vendor.owner_user_id, via survey_response.vendor_id
   * 4. Geen van de drie aanwezig → null
   *
   * Eén query met alle drie bronnen als losse LEFT JOINs, in plaats van drie
   * aparte queries: de keuze tussen de drie gebeurt hierna in code op basis
   * van welke kolom niet-leeg is, dat is duidelijker te lezen dan geneste
   * COALESCE-logica over meerdere joins met eigen NULL-gedrag.
   *
   * `survey_run.contract_id` heeft geen foreign key naar `clm.contract` (zie
   * schema.ts, historische reden) — de LEFT JOIN levert dus gewoon niets op
   * als er geen bijbehorend contract bestaat, zonder foutmelding.
   */
  private async haalContactinfo(
    tx: TenantTransaction,
    responseId: string,
  ): Promise<Contactinfo | null> {
    const resultaat = await tx.execute<ContactinfoRij>(
      sql`SELECT t.antwoord_email                     AS tenant_antwoord_email,
                 contract_owner.full_name              AS contract_owner_naam,
                 contract_owner.email                  AS contract_owner_email,
                 vendor_owner.full_name                AS vendor_owner_naam,
                 vendor_owner.email                    AS vendor_owner_email
            FROM clm.survey_response r
            JOIN clm.survey_run      run ON run.run_id    = r.run_id
            JOIN clm.tenant          t   ON t.tenant_id   = r.tenant_id
            LEFT JOIN clm.contract        con           ON con.contract_id = run.contract_id
            LEFT JOIN clm."user"          contract_owner ON contract_owner.user_id = con.owner_user_id
            LEFT JOIN clm.vendor           v             ON v.vendor_id = r.vendor_id
            LEFT JOIN clm."user"          vendor_owner   ON vendor_owner.user_id = v.owner_user_id
           WHERE r.response_id = ${responseId}`,
    );

    const rij = resultaat.rows[0];
    if (!rij) return null;

    if (rij.tenant_antwoord_email) {
      return { naam: null, email: rij.tenant_antwoord_email };
    }

    if (rij.contract_owner_email) {
      return { naam: rij.contract_owner_naam, email: rij.contract_owner_email };
    }

    if (rij.vendor_owner_email) {
      return { naam: rij.vendor_owner_naam, email: rij.vendor_owner_email };
    }

    return null;
  }
```

Let op: de JOIN gaat via `r.vendor_id` (de leverancier als deelnemer), niet via
`r.subject_vendor_id`. Bij UC1 zijn die twee gelijk (zie de comment op `surveyResponse` in
`schema.ts`); bij UC2 is `vendor_id` leeg (een collega vult in, geen leverancier) en levert de
vendor-JOIN dan terecht niets op — een interne beoordeling toont geen leveranciers-contactinfo
aan een collega, dat is geen bug maar correct: dat scherm heeft geen leverancierscontact
nodig.

- [ ] **Step 4: Roep `haalContactinfo()` aan in `haalVragenlijst()` en neem het op in de return**

In `haalVragenlijst()`, na de regel `const bijlagen = await this.haalOpgeslagenBijlagen(tx, responseId);` (rond regel 242), voeg toe:

```typescript
        const contactinfo = await this.haalContactinfo(tx, responseId);
```

En in de `return`-statement aan het einde van de functie (rond regel 284-297), voeg
`contactinfo` toe aan het geretourneerde object:

```typescript
        return {
          name: eerste.template_name,
          categories: [...categorieen.values()],
          questions: losseVragen,
          closesAt:
            sluit === null
              ? null
              : sluit instanceof Date
                ? sluit.toISOString()
                : new Date(sluit).toISOString(),
          contactinfo,
        };
```

- [ ] **Step 5: Compileer**

```bash
npx tsc --noEmit
```

Expected: geen fouten.

- [ ] **Step 6: Commit**

```bash
git add src/survey/vragenlijst-lezen.service.ts
git commit -m "feat(survey): contactinfo op de vragenlijst voor de leverancier

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: e2e-tests — de prioriteitsketen en de lek-detectietest bijwerken

**Files:**
- Modify: `test/vragenlijst-ophalen.e2e-spec.ts`

- [ ] **Step 1: Breid de `VragenlijstVorm`-interface uit**

In `test/vragenlijst-ophalen.e2e-spec.ts`, pas de bestaande `VragenlijstVorm`-interface aan
(rond regel 34-44):

```typescript
interface VragenlijstVorm {
  name: string;
  categories: {
    key: string;
    name: string;
    minAnswers: number;
    questions: VraagVorm[];
  }[];
  questions: VraagVorm[];
  closesAt: string | null;
  contactinfo: { naam: string | null; email: string } | null;
}
```

- [ ] **Step 2: Werk de bestaande lek-detectietest bij om `contactinfo` toe te staan**

De bestaande test `'lekt geen tenant, vendor of response-ID'` (rond regel 236-263) scant alle
veldnamen op een regex die o.a. `vendor` bevat. `contactinfo` zelf bevat geen van die
sleutelwoorden in zijn veldnamen (`contactinfo`, `naam`, `email`), dus die test hoeft niet
aangepast te worden om te blijven slagen — maar hij test op dit moment een `Vragenlijst` die
nog geen `contactinfo` heeft. Voeg een nieuwe test toe, direct na de bestaande
`'lekt geen tenant, vendor of response-ID'`-test, in hetzelfde `describe('UC1 — de acht
Transdev-vragen', ...)`-blok:

```typescript
    it('geeft contactinfo mee zonder tenant/vendor/response-ID erin te lekken', () => {
      // Zelfde scan als de vorige test, nu specifiek gericht op het nieuwe
      // veld: contactinfo mag een naam en e-mailadres bevatten, maar geen van
      // de verboden sleutels (tenant/vendor/response/token/template_id) als
      // veldnaam, en de UUID van de tenant mag nergens in de waarden staan.
      expect(lijst.contactinfo).not.toBeNull();
      expect(lijst.contactinfo?.email).toBeTruthy();

      const velden = new Set<string>();
      const verzamel = (waarde: unknown): void => {
        if (Array.isArray(waarde)) {
          waarde.forEach(verzamel);
        } else if (typeof waarde === 'object' && waarde !== null) {
          for (const [sleutel, inhoud] of Object.entries(waarde)) {
            velden.add(sleutel);
            verzamel(inhoud);
          }
        }
      };
      verzamel(lijst.contactinfo);

      const verdacht = [...velden].filter((veld) =>
        /tenant|vendor|response|token|template_?id/i.test(veld),
      );

      expect(verdacht).toEqual([]);
      expect(JSON.stringify(lijst.contactinfo)).not.toContain(TENANT_A);
    });
```

- [ ] **Step 3: Nieuw testblok voor de prioriteitsketen — voorbereidend, `maakLink` uitbreiden**

`maakLink()` (rond regel 67-123) maakt vandaag alleen een `vendor` zonder `owner_user_id` aan
en heeft geen weg om een tenant-antwoordadres, een contract, of een vendor-eigenaar te zetten.
Voeg een nieuw testblok toe — een eigen `describe`, ná `describe('Een ronde zonder vragen',
...)` aan het einde van het bestand, vóór de laatste sluitende `});` van de buitenste
`describe`:

```typescript
  describe('Contactinfo — de prioriteitsketen', () => {
    /**
     * Maakt een gebruiker aan (voor owner_user_id-koppelingen) en geeft diens
     * id, naam en e-mailadres terug.
     */
    async function maakGebruiker(
      tenantId: string,
      naam: string,
    ): Promise<{ userId: string; email: string }> {
      const subject = `oid-contactinfo-${naam}-${Date.now()}-${Math.random()}`;
      const email = `${subject}@voorbeeld.nl`;

      return db.withTenant(tenantId, async (tx) => {
        const rij = await tx.execute<{ user_id: string }>(
          sql`INSERT INTO clm."user" (tenant_id, email, full_name, external_subject)
              VALUES (${tenantId}, ${email}, ${naam}, ${subject})
              RETURNING user_id`,
        );
        return { userId: rij.rows[0].user_id, email };
      });
    }

    it('gebruikt het tenant-antwoordadres als dat is ingesteld', async () => {
      const templateId = await importeerSeed(
        TENANT_A,
        'transdev-annual-vendor-it-risk-v1.json',
      );

      await db.withTenant(TENANT_A, async (tx) => {
        await tx.execute(
          sql`UPDATE clm.tenant SET antwoord_email = 'contact@transdev-test.nl'
               WHERE tenant_id = ${TENANT_A}`,
        );
      });

      const { token } = await maakLink({
        tenantId: TENANT_A,
        templateId,
        naam: 'contactinfo-tenant',
      });

      const res = await request(server)
        .get('/survey/respond/questions')
        .query({ t: token })
        .expect(200);

      const lijst = res.body as VragenlijstVorm;
      expect(lijst.contactinfo).toEqual({
        naam: null,
        email: 'contact@transdev-test.nl',
      });

      // Opruimen: dit tenant-brede veld mag andere tests in dit bestand niet
      // beïnvloeden.
      await db.withTenant(TENANT_A, async (tx) => {
        await tx.execute(
          sql`UPDATE clm.tenant SET antwoord_email = NULL
               WHERE tenant_id = ${TENANT_A}`,
        );
      });
    });

    it('valt terug op de contract-eigenaar als er geen tenant-antwoordadres is', async () => {
      const templateId = await importeerSeed(
        TENANT_A,
        'transdev-annual-vendor-it-risk-v1.json',
      );

      // Zeker weten dat er geen tenant-antwoordadres is voor dit scenario.
      await db.withTenant(TENANT_A, async (tx) => {
        await tx.execute(
          sql`UPDATE clm.tenant SET antwoord_email = NULL
               WHERE tenant_id = ${TENANT_A}`,
        );
      });

      const contractOwner = await maakGebruiker(TENANT_A, 'Contract Eigenaar');

      const { token } = await maakLink({
        tenantId: TENANT_A,
        templateId,
        naam: 'contactinfo-contract',
      });

      // maakLink() zet geen contract_id op de ronde; die koppeling leggen we
      // hier expliciet, na het aanmaken van de link, om maakLink() niet met
      // een optie te hoeven uitbreiden die alleen dit ene testgeval gebruikt.
      // We vinden de response via token_hash (dezelfde hash-functie als
      // maakLink() gebruikt om het token op te slaan), maken daarna een
      // contract aan met owner_user_id, en koppelen de bijbehorende run eraan.
      await db.withTenant(TENANT_A, async (tx) => {
        const contractRij = await tx.execute<{ contract_id: string }>(
          sql`INSERT INTO clm.contract (tenant_id, vendor_id, name, owner_user_id)
              SELECT r.tenant_id, r.vendor_id, 'contactinfo-testcontract', ${contractOwner.userId}
                FROM clm.survey_response r
               WHERE r.token_hash = ${hashToken(token)}
              RETURNING contract_id`,
        );

        await tx.execute(
          sql`UPDATE clm.survey_run
                 SET contract_id = ${contractRij.rows[0].contract_id}
               WHERE run_id = (
                 SELECT run_id FROM clm.survey_response
                  WHERE token_hash = ${hashToken(token)}
               )`,
        );
      });

      const res = await request(server)
        .get('/survey/respond/questions')
        .query({ t: token })
        .expect(200);

      const lijst = res.body as VragenlijstVorm;
      expect(lijst.contactinfo).toEqual({
        naam: 'Contract Eigenaar',
        email: contractOwner.email,
      });
    });

    it('valt terug op de vendor-eigenaar als er geen tenant-adres en geen contract-eigenaar is', async () => {
      const templateId = await importeerSeed(
        TENANT_A,
        'transdev-annual-vendor-it-risk-v1.json',
      );

      await db.withTenant(TENANT_A, async (tx) => {
        await tx.execute(
          sql`UPDATE clm.tenant SET antwoord_email = NULL
               WHERE tenant_id = ${TENANT_A}`,
        );
      });

      const vendorOwner = await maakGebruiker(TENANT_A, 'Vendor Eigenaar');

      const vendorId = await db.withTenant(TENANT_A, async (tx) => {
        const rij = await tx.execute<{ vendor_id: string }>(
          sql`INSERT INTO clm.vendor (tenant_id, name, owner_user_id)
              VALUES (${TENANT_A}, 'v-contactinfo-vendor', ${vendorOwner.userId})
              RETURNING vendor_id`,
        );
        return rij.rows[0].vendor_id;
      });

      const { token } = await maakLink({
        tenantId: TENANT_A,
        templateId,
        naam: 'contactinfo-vendor',
        vendorId,
      });

      const res = await request(server)
        .get('/survey/respond/questions')
        .query({ t: token })
        .expect(200);

      const lijst = res.body as VragenlijstVorm;
      expect(lijst.contactinfo).toEqual({
        naam: 'Vendor Eigenaar',
        email: vendorOwner.email,
      });
    });

    it('geeft null als geen van de drie bronnen iets oplevert', async () => {
      const templateId = await importeerSeed(
        TENANT_A,
        'transdev-annual-vendor-it-risk-v1.json',
      );

      await db.withTenant(TENANT_A, async (tx) => {
        await tx.execute(
          sql`UPDATE clm.tenant SET antwoord_email = NULL
               WHERE tenant_id = ${TENANT_A}`,
        );
      });

      // Nieuwe vendor zonder owner_user_id, geen contract erbij — de default
      // situatie van maakLink() zonder verdere aanpassing.
      const { token } = await maakLink({
        tenantId: TENANT_A,
        templateId,
        naam: 'contactinfo-leeg',
      });

      const res = await request(server)
        .get('/survey/respond/questions')
        .query({ t: token })
        .expect(200);

      const lijst = res.body as VragenlijstVorm;
      expect(lijst.contactinfo).toBeNull();
    });
  });
```

- [ ] **Step 4: Run de nieuwe en bestaande tests**

Gebruik de `mcm2test`-container (127.0.0.1:55440, rol `clm_api_runtime`, wachtwoord `pw` —
bevestigd werkend en gemarkeerd `wegwerp` in eerder werk op deze machine; controleer bij
twijfel met `docker exec mcm2test psql -U postgres -c "SELECT * FROM clm.omgeving;"` dat hij
nog steeds `wegwerp` is voordat je hem gebruikt):

```bash
DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55440/postgres" npx jest --config ./test/jest-e2e.json test/vragenlijst-ophalen.e2e-spec.ts -i
```

Expected: alle tests slagen, inclusief de vijf nieuwe (1 uitbreiding op UC1-blok + 4 in het
nieuwe `describe`-blok).

- [ ] **Step 5: Run de volledige e2e-suite**

Conform MCM2-CLAUDE.md §"Een nieuwe e2e-suite schrijven": één suite die los groen draait kan
de volledige run alsnog rood maken.

```bash
DATABASE_URL="postgresql://clm_api_runtime:pw@localhost:55440/postgres" npx jest --config ./test/jest-e2e.json -i
```

Expected: alle suites groen (op het moment van schrijven: 37 suites, 524+ tests — dit plan
voegt 5 nieuwe tests toe, dus het totaal moet met 5 omhoog).

- [ ] **Step 6: Commit**

```bash
git add test/vragenlijst-ophalen.e2e-spec.ts
git commit -m "test(survey): contactinfo-prioriteitsketen en lek-detectie op de vragenlijst

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Fase 2 — Frontend (aparte repo `c:/DEV/Work/MCM2-frontend`)

Deze fase hoort in een eigen PR op `MCM2-frontend`, ná fase 1 (de backend-route moet
`contactinfo` al teruggeven).

### Task 3: Model — `Contactinfo` in het frontend-type

**Files:**
- Modify: `c:/DEV/Work/MCM2-frontend/src/core/models/survey.ts`

- [ ] **Step 1: Lees het bestand rond de `Vragenlijst`-interface**

```bash
cd c:/DEV/Work/MCM2-frontend
grep -n "export interface Vragenlijst" -A 15 src/core/models/survey.ts
```

- [ ] **Step 2: Voeg `Contactinfo` toe en breid `Vragenlijst` uit**

Direct vóór de bestaande `export interface Vragenlijst { ... }` (rond regel 93), voeg toe:

```typescript
/**
 * Wie de leverancier kan benaderen bij vragen over deze vragenlijst. `naam`
 * is `null` wanneer het tenant-antwoordadres de bron is (een generiek adres,
 * geen persoon). `null` als geheel wanneer geen van de bronnen iets oplevert
 * — dan toont het portaal geen contactregel.
 */
export interface Contactinfo {
  naam: string | null;
  email: string;
}
```

Pas de bestaande `Vragenlijst`-interface aan om `contactinfo` toe te voegen:

```typescript
export interface Vragenlijst {
  name: string;
  /** Leeg bij een platte lijst; gevuld bij een ingedeelde vragenlijst. */
  categories: Categorie[];
  /** Vragen zonder categorie. Bij UC1 staat hier alles in. */
  questions: Vraag[];
  /** Deadline van de ronde, ISO-8601. */
  closesAt: string | null;
  contactinfo: Contactinfo | null;
}
```

Werk ook de class-comment bovenaan het bestand bij (rond regel 1-12) — die zegt nu nog
letterlijk "Wat hier NIET in staat is net zo belangrijk als wat er wel in staat: geen tenant,
geen vendor-ID, geen response-ID." Voeg daar een zin aan toe die de bewuste uitzondering
benoemt, zonder de rest van die paragraaf te verwijderen:

```typescript
/**
 * Het model van een vragenlijst zoals de leverancierskant hem ziet.
 *
 * Volgt het datamodel uit migratie 0005 (vragenlijst-ontwerp §2, §2a, §4).
 * Bewust géén kopie van MVM_V2's InternalSurveyTemplate: dat model kent alleen
 * ratings, terwijl MCM2 acht antwoordtypen heeft.
 *
 * Wat hier NIET in staat is net zo belangrijk als wat er wel in staat: geen
 * tenant, geen vendor-ID, geen response-ID. De leverancierskant heeft die niet
 * nodig en de backend geeft ze niet — dezelfde terughoudendheid als in de
 * guard (leveranciertoken-ontwerp §5). Eén bewuste uitzondering: `contactinfo`
 * (naam optioneel, e-mailadres van de afzendende partij) — zie de
 * toelichting op `haalContactinfo()` in de backend
 * (`src/survey/vragenlijst-lezen.service.ts`) voor de volledige afweging.
 */
```

- [ ] **Step 3: Compileer**

```bash
npx tsc --noEmit
```

Expected: geen fouten. Als er een fout optreedt op een plek die mock-data gebruikt (zie het
patroon uit een eerder plan: `src/data/survey.mock.ts` kan een `Vragenlijst`-object bevatten
dat nu een verplicht veld mist), zoek dat bestand op en voeg `contactinfo: null` toe aan elk
mock-`Vragenlijst`-object:

```bash
grep -rn "closesAt" src/data/survey.mock.ts
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(survey): contactinfo in het frontend-model

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Contactregel onderaan het portaalscherm

**Files:**
- Modify: `c:/DEV/Work/MCM2-frontend/src/app/portal/survey/[token]/page.tsx`

- [ ] **Step 1: Lees het volledige scherm-bestand**

```bash
cd c:/DEV/Work/MCM2-frontend
cat "src/app/portal/survey/[token]/page.tsx"
```

Dit bestand is 503 regels — lees het geheel met Read voordat je iets wijzigt, om de plek te
vinden waar het formulier eindigt en de indienknop staat (`toestand === 'formulier'`-tak), en
om de bestaande stijlconventies (Tailwind-klassen, `tokens`-object uit
`@/shared/design-tokens`, Lucide-iconen) te volgen.

- [ ] **Step 2: Voeg de contactregel toe, vlak vóór de indienknop**

Zoek de plek waar het formulier gerenderd wordt (de `toestand === 'formulier'`-tak) en waar
de indien-/verzendknop staat. Voeg daar direct vóór een blok toe:

```tsx
{vragenlijst?.contactinfo && (
  <p className="mb-4 text-sm text-ink-muted">
    Vragen over deze vragenlijst? Neem contact op
    {vragenlijst.contactinfo.naam
      ? ` met ${vragenlijst.contactinfo.naam} (${vragenlijst.contactinfo.email}).`
      : ` via ${vragenlijst.contactinfo.email}.`}
  </p>
)}
```

Pas de variabelenaam (`vragenlijst`) aan op de daadwerkelijke naam van de state-variabele die
de opgehaalde `Vragenlijst` bevat in dit bestand (zoek met
`grep -n "useState<Vragenlijst" "src/app/portal/survey/[token]/page.tsx"` om de exacte naam
te vinden — gok niet, dit bestand is niet vooraf gelezen tijdens het schrijven van dit plan).
Pas ook de className aan op wat er in dit bestand al gebruikt wordt voor vergelijkbare
hulptekst (zoek naar `text-ink-muted` of vergelijkbare bestaande klassen in hetzelfde
bestand en gebruik die, in plaats van een nieuwe stijl te introduceren).

Geen contactregel wanneer `contactinfo` `null` is — geen "geen contactpersoon bekend"-tekst.

- [ ] **Step 3: Compileer en lint**

```bash
npx tsc --noEmit
npx eslint "src/app/portal/survey/[token]/page.tsx"
```

Expected: geen fouten, geen nieuwe warnings.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(survey): contactregel op het leverancierportaal

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-review — dekking tegen de spec

- §2 (prioriteitsketen tenant → contract-eigenaar → vendor-eigenaar → null) → Task 1 (query +
  logica), Task 2 (drie scenario's + het null-geval, vier losse tests).
- §3 (landt op `GET /survey/respond/questions`, niet op de status-route) → Task 1 (wijzigt
  alleen `haalVragenlijst()`, geen wijziging aan `SurveyResponseController.status()`).
- §4 (backend-implementatie, letterlijke beveiligingscomment) → Task 1, Step 3 — de comment
  in dit plan is de letterlijke tekst uit spec §1/§4.
- §5 (tegenproef: wel contactinfo, geen tenant/vendor/response/token/template-sleutels) →
  Task 2, Step 2.
- §6 (frontend: model + contactregel, geen regel bij `null`) → Task 3, Task 4.
- §7 (geen migratie, geen wijziging aan de status-route, geen precedent, geen ander
  contactkanaal) → impliciet gedekt: geen enkele taak in dit plan raakt een migratiebestand,
  de status-route, of voegt een ander veld toe dan `contactinfo`.

**Type-consistentie gecontroleerd:** `Contactinfo` (backend, Task 1) en `Contactinfo`
(frontend, Task 3) hebben identieke velden (`naam: string | null`, `email: string`).
`haalContactinfo()` (Task 1) wordt precies één keer aangeroepen, in `haalVragenlijst()` (Task
1, Step 4) — geen andere taak roept hem aan of verwacht een andere signatuur.
