# Handmatige verzendregistratie + heruitnodigen na intrekken — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een beheerder kan (1) per deelnemer vastleggen "deze uitnodiging is apart verzonden op [datum]" wanneer de mail buiten MCM2 om is verstuurd (bijv. via Power Automate), zichtbaar in de berekende status en meegeteld in de dashboardtelling; en (2) een ingetrokken deelnemer opnieuw uitnodigen binnen dezelfde ronde, met een nieuw token, zonder de ronde te resetten.

**Architecture:** Eén nieuwe, nullable timestamp-kolom `clm.survey_response.handmatig_verzonden_op` (feit, geen afgeleide status — past in het bestaande "berekend, niet opgeslagen"-principe van `respons-status.ts`). Eén nieuwe route om die kolom te zetten (eenmalig, niet corrigeerbaar — geen intrek-route ervoor). `bepaalStatus()` krijgt een nieuwe tussenstatus `apart_verzonden` tussen `opgestuurd` en `terug`. Voor heruitnodigen: de bestaande `revoked`-rij wordt hergebruikt (UPDATE, nieuw token) in plaats van een nieuwe rij aan te maken — dat botst niet met de bestaande unieke index `(run_id, vendor_id)` en vereist dus geen schemawijziging aan die index.

**Tech Stack:** NestJS, Drizzle (handgeschreven SQL-migraties), Postgres met RLS, Jest (unit + e2e via supertest).

---

## Overzicht van de wijziging

| Onderdeel | Bestand | Wat |
|---|---|---|
| Migratie | `drizzle/0044_survey_response_handmatig_verzonden.sql` | Nieuwe kolom `handmatig_verzonden_op` |
| Schema | `src/db/schema.ts` | Drizzle-kolomdefinitie erbij |
| Statuslogica | `src/survey/respons-status.ts` | Nieuwe status `apart_verzonden`, nieuw veld in `StatusFeiten` |
| Unit-test | `src/survey/respons-status.spec.ts` (nieuw) | Test voor `bepaalStatus()` inclusief de nieuwe tak |
| Service | `src/survey/ronde-beheer.service.ts` | `registreerHandmatigeVerzending()` + `heruitnodigen()` |
| Route | `src/survey/vragenlijst-beheer.controller.ts` | Twee nieuwe POST-routes |
| Dashboard-query | `src/survey/contractmanager.service.ts` | `handmatigVerzondenOp` meenemen in `StatusItem` + query |
| e2e-test | `test/ronde-beheer-routes.e2e-spec.ts` | Tests voor beide nieuwe routes |

---

## Task 1: Migratie — kolom `handmatig_verzonden_op`

**Files:**
- Create: `drizzle/0044_survey_response_handmatig_verzonden.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- =============================================================================
-- clm.survey_response.handmatig_verzonden_op — registratie van een verzending
-- die buiten het mailkanaal van MCM2 om is gedaan (bijv. via Power Automate).
--
-- Dit is een FEIT, geen afgeleide status: past in het principe van
-- respons-status.ts ("berekend, niet opgeslagen") omdat de kolom niet de
-- status zelf vastlegt, alleen het moment van een handeling die buiten het
-- systeem plaatsvond en die het systeem niet zelf kan waarnemen. bepaalStatus()
-- leest deze kolom als extra feit naast submitted_at, net zoals closes_at.
--
-- Eenmalig, bewust niet corrigeerbaar via een aparte "intrek"-route (besluit
-- eigenaar 2026-09-26): een verkeerd gezette datum blijft zichtbaar in plaats
-- van stilzwijgend te verdwijnen. Een nieuwe registratie op dezelfde respons
-- overschrijft de vorige waarde (zie ronde-beheer.service.ts,
-- registreerHandmatigeVerzending()).
-- =============================================================================

ALTER TABLE "clm"."survey_response"
    ADD COLUMN "handmatig_verzonden_op" timestamp with time zone;
```

- [ ] **Step 2: Voeg de migratie toe aan het journal**

Open `drizzle/meta/_journal.json` en voeg toe als laatste entry vóór de sluitende `]`:

```json
    {
      "idx": 44,
      "version": "7",
      "when": 1787068800018,
      "tag": "0044_survey_response_handmatig_verzonden",
      "breakpoints": true
    }
```

- [ ] **Step 3: Draai de migratie tegen een wegwerpdatabase**

Volg `npm run test:db -- "handmatige verzendregistratie"` (zet een wegwerpcontainer op, draait alle migraties, drukt `MIGRATION_DATABASE_URL`/`DATABASE_URL` af — zie `docs/runbooks/commandos-en-omgeving.md`). Exporteer die twee variabelen zoals het script aangeeft.

Run: `npm run migrate:deploy`
Expected: eindigt met alle migraties toegepast, inclusief `0044_survey_response_handmatig_verzonden`, geen fout.

- [ ] **Step 4: Verifieer de kolom bestaat**

```powershell
docker exec <container-naam> psql -U clm_migrator -d postgres -c "SELECT column_name FROM information_schema.columns WHERE table_schema='clm' AND table_name='survey_response' AND column_name='handmatig_verzonden_op';"
```

Expected: één rij, `handmatig_verzonden_op`.

- [ ] **Step 5: Commit**

```powershell
git add drizzle/0044_survey_response_handmatig_verzonden.sql drizzle/meta/_journal.json
git commit -m "feat(survey): migratie voor handmatige verzendregistratie"
```

---

## Task 2: Drizzle-schema bijwerken

**Files:**
- Modify: `src/db/schema.ts:851` (survey_response tabel, na `submittedAt`)

- [ ] **Step 1: Voeg de kolom toe aan de Drizzle-tabeldefinitie**

Zoek de `surveyResponse`-tabeldefinitie in `src/db/schema.ts` (rond regel 851, direct na `submittedAt`):

```typescript
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
```

Voeg er direct na toe:

```typescript
    /**
     * Wanneer een beheerder handmatig heeft geregistreerd dat deze
     * uitnodiging apart is verzonden (bijv. via een extern mailproces).
     * Nullable: de meeste responses gaan via het ingebouwde mailkanaal en
     * hebben dit nooit nodig. Zie respons-status.ts voor hoe dit meetelt in
     * de berekende status.
     */
    handmatigVerzondenOp: timestamp('handmatig_verzonden_op', {
      withTimezone: true,
    }),
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: geen fouten.

- [ ] **Step 3: Commit**

```powershell
git add src/db/schema.ts
git commit -m "feat(survey): handmatigVerzondenOp in Drizzle-schema"
```

---

## Task 3: Statuslogica — nieuwe status `apart_verzonden`

> **Uitvoeringscorrectie (2026-09-26):** dit plan nam aan dat er geen
> testbestand voor `respons-status.ts` bestond. Dat klopte niet — er bestaat
> al `test/respons-status.spec.ts` (17 tests, volledige dekking van
> `bepaalStatus()`). De onderstaande stappen zijn uitgevoerd door de nieuwe
> tests toe te voegen aan dát bestand (nieuwe `describe`-blok "handmatige
> verzendregistratie"), niet door een nieuw bestand `src/survey/respons-status.spec.ts`
> aan te maken. De `feiten()`-helper in `test/respons-status.spec.ts` is
> bijgewerkt met `handmatigVerzondenOp: null` — zonder die wijziging faalden
> 5 van de 17 bestaande tests (ze werden `apart_verzonden` in plaats van hun
> verwachte status, omdat `undefined !== null`). Zie commit `f485b1b`.

**Files (zoals daadwerkelijk gewijzigd):**
- Modify: `src/survey/respons-status.ts`
- Modify: `test/respons-status.spec.ts` (niet: nieuw bestand)

- [ ] **Step 1: Schrijf de falende test eerst**

~~Er bestaat nog geen testbestand voor `respons-status.ts`. Maak `src/survey/respons-status.spec.ts` aan:~~ (achterhaald, zie correctie hierboven — voeg toe aan `test/respons-status.spec.ts`)

```typescript
import { bepaalStatus, type StatusFeiten } from './respons-status';

function feiten(overrides: Partial<StatusFeiten> = {}): StatusFeiten {
  return {
    submittedAt: null,
    closesAt: null,
    rondeStatus: 'active',
    laatsteOordeel: null,
    handmatigVerzondenOp: null,
    ...overrides,
  };
}

describe('bepaalStatus', () => {
  it('geeft opgestuurd zonder handmatige verzending en zonder inzending', () => {
    expect(bepaalStatus(feiten())).toBe('opgestuurd');
  });

  it('geeft apart_verzonden wanneer handmatig geregistreerd, nog niet ingediend', () => {
    expect(
      bepaalStatus(feiten({ handmatigVerzondenOp: '2026-09-26T10:00:00Z' })),
    ).toBe('apart_verzonden');
  });

  it('geeft terug zodra ingediend, ook als er ooit handmatig verzonden is', () => {
    expect(
      bepaalStatus(
        feiten({
          handmatigVerzondenOp: '2026-09-26T10:00:00Z',
          submittedAt: '2026-09-27T10:00:00Z',
        }),
      ),
    ).toBe('terug');
  });

  it('geeft te_laat ook met een handmatige verzending, bij overschreden deadline', () => {
    const gisteren = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(
      bepaalStatus(
        feiten({ handmatigVerzondenOp: gisteren, closesAt: gisteren }),
      ),
    ).toBe('te_laat');
  });
});
```

- [ ] **Step 2: Run de test, verwacht een compilatiefout**

Run: `npx jest src/survey/respons-status.spec.ts`
Expected: FAIL — `handmatigVerzondenOp` bestaat niet op `StatusFeiten`, en `apart_verzonden` is geen geldige `ResponsStatus`.

- [ ] **Step 3: Werk `respons-status.ts` bij**

In `src/survey/respons-status.ts`, wijzig `RESPONS_STATUSSEN` (regel 38-46):

```typescript
export const RESPONS_STATUSSEN = [
  'opgestuurd',
  'apart_verzonden',
  'te_laat',
  'terug',
  'beoordeeld',
  'goedgekeurd',
  'afgekeurd',
  'gepland',
] as const;
```

Werk `STATUS_LABEL` bij (regel 51-59):

```typescript
export const STATUS_LABEL: Record<ResponsStatus, string> = {
  opgestuurd: 'Opgestuurd, nog niet terug',
  apart_verzonden: 'Apart verzonden, nog niet terug',
  te_laat: 'Te laat',
  terug: 'Terug, nog niet beoordeeld',
  beoordeeld: 'Beoordeeld, nog niet goedgekeurd',
  goedgekeurd: 'Beoordeeld en goedgekeurd',
  afgekeurd: 'Afgekeurd',
  gepland: 'Nog niet uitgenodigd',
};
```

Werk `StatusFeiten` bij (regel 62-71), voeg toe na `closesAt`:

```typescript
  /** Sluitdatum van de ronde. Null betekent: geen deadline. */
  closesAt: Date | string | null;
  /**
   * Wanneer een beheerder handmatig heeft geregistreerd dat deze uitnodiging
   * apart is verzonden (buiten het ingebouwde mailkanaal om). Null wanneer
   * dat nooit is gebeurd.
   */
  handmatigVerzondenOp: Date | string | null;
```

Werk `bepaalStatus()` bij (regel 107-122) — voeg de nieuwe tak toe vóór de `te_laat`-check, want een handmatige verzending sluit "te laat" niet uit:

```typescript
export function bepaalStatus(feiten: StatusFeiten): ResponsStatus {
  const ingediend = tijd(feiten.submittedAt);

  if (ingediend === null) {
    const sluit = tijd(feiten.closesAt);

    if (
      feiten.rondeStatus === 'active' &&
      sluit !== null &&
      sluit < Date.now()
    ) {
      return 'te_laat';
    }

    if (feiten.handmatigVerzondenOp !== null) {
      return 'apart_verzonden';
    }

    return 'opgestuurd';
  }
```

Voeg ook een doc-comment toe boven deze tak die uitlegt waarom de volgorde zo is (te_laat gaat vóór apart_verzonden):

```typescript
    // 'te_laat' gaat vóór 'apart_verzonden': een handmatige verzending
    // verandert niets aan de deadline. Een leverancier die apart is benaderd
    // maar de deadline al miste, moet nog steeds als te laat opvallen.
```

- [ ] **Step 4: Run de test opnieuw**

Run: `npx jest src/survey/respons-status.spec.ts`
Expected: PASS, alle 4 tests groen.

- [ ] **Step 5: Zoek alle bestaande aanroepen van `bepaalStatus()` en `StatusFeiten` en werk ze bij**

```powershell
(Get-Content package.json | Out-Null); Select-String -Path "src\survey\*.ts" -Pattern "bepaalStatus\(" -List
```

Verwacht resultaat: `src/survey/contractmanager.service.ts` (afgehandeld in Task 5). Controleer of er nog andere aanroepers zijn — indien ja, die ook aanpassen met `handmatigVerzondenOp: null` als tijdelijke waarde totdat Task 5 de echte query bijwerkt.

- [ ] **Step 6: Volledige typecheck**

Run: `npm run typecheck`
Expected: fouten op elke plek die `StatusFeiten` bouwt zonder `handmatigVerzondenOp` — dat is verwacht en wordt in Task 5 opgelost. Noteer welke bestanden falen.

- [ ] **Step 7: Commit**

```powershell
git add src/survey/respons-status.ts src/survey/respons-status.spec.ts
git commit -m "feat(survey): nieuwe status apart_verzonden voor handmatige verzendregistratie"
```

---

## Task 4: Service — `registreerHandmatigeVerzending()`

**Files:**
- Modify: `src/survey/ronde-beheer.service.ts` (na `trekDeelnemerIn()`, rond regel 474)

- [ ] **Step 1: Schrijf de methode**

Voeg toe in `RondeBeheerService`, direct na `trekDeelnemerIn()`:

```typescript
  /**
   * Registreert dat een beheerder deze uitnodiging apart heeft verzonden,
   * buiten het ingebouwde mailkanaal om (bijv. via een extern mailproces
   * zoals Power Automate, na een Excel-export).
   *
   * ── Waarom dit een apart feit is, geen statusovergang ───────────────────────
   *
   * `survey_response.status` blijft 'pending' — er verandert niets aan de
   * tokengeldigheid of aan wat de leverancier kan doen. Dit legt alleen vast
   * wanneer een handeling BUITEN MCM2 heeft plaatsgevonden, zodat het
   * dashboard niet langer "opgestuurd" toont voor iets waarvan de eigenaar
   * weet dat de mail nog moet vertrekken (of juist al is vertrokken zonder
   * dat het ingebouwde mailkanaal het weet).
   *
   * ── Waarom geen validatie op de huidige status ──────────────────────────────
   *
   * In tegenstelling tot intrekken mag dit op elke respons die nog bestaat,
   * ook een 'submitted' of 'revoked' respons — de registratie beschrijft een
   * moment in het verleden ("ik heb dit toen verzonden"), niet een huidige
   * toestand. Een leverancier kan intussen al hebben ingediend terwijl de
   * beheerder deze registratie pas nu bijwerkt.
   *
   * ── Waarom eenmalig zetten volstaat (besluit eigenaar 2026-09-26) ───────────
   *
   * Geen aparte intrek-route: een tweede aanroep overschrijft de eerdere
   * datum. Dat is bewust minder streng dan `trekDeelnemerIn()` — een verkeerd
   * gezette datum is een correctie, geen bewijs dat ongedaan gemaakt wordt.
   */
  async registreerHandmatigeVerzending(
    tenantId: string,
    runId: string,
    responseId: string,
    verzondenOp: Date,
  ): Promise<{ responseId: string; handmatigVerzondenOp: string }> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const bijgewerkt = await tx.execute<{
          response_id: string;
          handmatig_verzonden_op: string;
        }>(
          sql`UPDATE clm.survey_response
                 SET handmatig_verzonden_op = ${verzondenOp.toISOString()}
               WHERE response_id = ${responseId} AND run_id = ${runId}
              RETURNING response_id, handmatig_verzonden_op`,
        );

        if (bijgewerkt.rows.length === 0) {
          throw new NotFoundException(
            'Deze deelnemer bestaat niet binnen deze ronde.',
          );
        }

        return {
          responseId: bijgewerkt.rows[0].response_id,
          handmatigVerzondenOp: bijgewerkt.rows[0].handmatig_verzonden_op,
        };
      },
      'medewerker',
    );
  }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: geen nieuwe fouten in dit bestand (`NotFoundException` is al geïmporteerd — controleer de bestaande imports bovenaan het bestand, `trekDeelnemerIn()` gebruikt hem al).

- [ ] **Step 3: Commit**

```powershell
git add src/survey/ronde-beheer.service.ts
git commit -m "feat(survey): registreerHandmatigeVerzending in RondeBeheerService"
```

---

## Task 5: Service — `heruitnodigen()` (opnieuw uitnodigen na intrekken)

**Files:**
- Modify: `src/survey/ronde-beheer.service.ts` (na `registreerHandmatigeVerzending()`)

- [ ] **Step 1: Schrijf de methode**

```typescript
  /**
   * Geeft een ingetrokken deelnemer een nieuw token binnen dezelfde ronde.
   *
   * ── Waarom UPDATE en geen nieuwe rij ─────────────────────────────────────────
   *
   * De unieke index `survey_response_run_vendor_key` staat maar één actieve
   * rij per (run_id, vendor_id) toe. Een 'revoked' rij telt daar ook in mee
   * — een tweede INSERT voor dezelfde combinatie zou op die index stuklopen.
   * In plaats daarvan hergebruikt dit de bestaande rij: nieuw token, status
   * terug naar 'pending', submitted_at blijft zoals het was (null, want een
   * ingetrokken respons was per definitie nog niet ingediend —
   * trekDeelnemerIn() staat dat niet toe op een 'submitted' respons).
   *
   * ── Waarom alleen vanuit 'revoked' ────────────────────────────────────────
   *
   * Een 'pending' respons heeft al een geldig token — heruitnodigen zou dat
   * zonder reden ongeldig maken terwijl de leverancier de oorspronkelijke
   * link misschien al heeft. Een 'submitted' respons opnieuw uitnodigen zou
   * een ingediend antwoord laten overschrijven; dat hoort net zo min hier als
   * bij trekDeelnemerIn().
   */
  async heruitnodigen(
    tenantId: string,
    runId: string,
    responseId: string,
    geldigheidDagen: number,
  ): Promise<{ responseId: string; vendorId: string; token: string; expiresAt: string }> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const huidige = await tx.execute<{
          response_id: string;
          vendor_id: string | null;
          status: string;
        }>(
          sql`SELECT response_id, vendor_id, status FROM clm.survey_response
               WHERE response_id = ${responseId} AND run_id = ${runId}`,
        );

        const r = huidige.rows[0];

        if (!r) {
          throw new NotFoundException(
            'Deze deelnemer bestaat niet binnen deze ronde.',
          );
        }

        if (r.status !== 'revoked') {
          throw new ConflictException(
            `Deze deelnemer heeft status '${r.status}' en kan alleen opnieuw uitgenodigd worden vanuit 'revoked'.`,
          );
        }

        const token = genereerToken();
        const verloopt = new Date(
          Date.now() + geldigheidDagen * 24 * 60 * 60 * 1000,
        );

        const bijgewerkt = await tx.execute<{
          response_id: string;
          vendor_id: string;
          expires_at: string;
        }>(
          sql`UPDATE clm.survey_response
                 SET status = 'pending',
                     token_hash = ${hashToken(token)},
                     expires_at = ${verloopt.toISOString()},
                     handmatig_verzonden_op = NULL
               WHERE response_id = ${responseId}
              RETURNING response_id, vendor_id, expires_at`,
        );

        return {
          responseId: bijgewerkt.rows[0].response_id,
          vendorId: bijgewerkt.rows[0].vendor_id,
          token,
          expiresAt: bijgewerkt.rows[0].expires_at,
        };
      },
      'medewerker',
    );
  }
```

**Let op:** `handmatig_verzonden_op` wordt bewust op `NULL` gezet bij heruitnodigen — een nieuwe uitnodigingsronde voor deze leverancier heeft nog geen eigen verzendregistratie, ook al had de vorige (ingetrokken) poging er misschien een.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: geen fouten (`genereerToken`, `hashToken`, `ConflictException` zijn al geïmporteerd bovenaan het bestand — zie regel 10 en de bestaande `trekDeelnemerIn`/`uitnodigen`-methoden).

- [ ] **Step 3: Commit**

```powershell
git add src/survey/ronde-beheer.service.ts
git commit -m "feat(survey): heruitnodigen van een ingetrokken deelnemer binnen dezelfde ronde"
```

---

## Task 6: Routes toevoegen

**Files:**
- Modify: `src/survey/vragenlijst-beheer.controller.ts` (na `trekDeelnemerIn()`, rond regel 678)
- Modify: `src/survey/ronde-invoer.ts` (nieuwe invoer-validatie)

- [ ] **Step 1: Voeg invoervalidatie toe in `ronde-invoer.ts`**

Bekijk eerst het bestaande patroon van `leesStatus()` of vergelijkbare kleine validators in `src/survey/ronde-invoer.ts` (zoek `export function lees`). Voeg toe:

```typescript
/** Invoer voor het registreren van een handmatige verzending. */
export interface HandmatigeVerzending {
  verzondenOp: Date;
}

export function leesHandmatigeVerzending(body: unknown): HandmatigeVerzending {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('verzondenOp' in body) ||
    typeof (body as { verzondenOp: unknown }).verzondenOp !== 'string'
  ) {
    throw new InvoerFout('verzondenOp', 'verzondenOp is verplicht (ISO-datum).');
  }

  const datum = new Date((body as { verzondenOp: string }).verzondenOp);

  if (Number.isNaN(datum.getTime())) {
    throw new InvoerFout('verzondenOp', 'verzondenOp is geen geldige datum.');
  }

  if (datum.getTime() > Date.now()) {
    throw new InvoerFout(
      'verzondenOp',
      'verzondenOp mag niet in de toekomst liggen.',
    );
  }

  return { verzondenOp: datum };
}
```

Controleer de exacte naam en het gooi-gedrag van `InvoerFout` bovenaan `ronde-invoer.ts` (waarschijnlijk al geïmporteerd/gedefinieerd — volg het patroon van de bestaande `leesStatus`/`leesUitnodigingen`-functies exact, inclusief foutklasse-naam).

- [ ] **Step 2: Voeg de twee routes toe in de controller**

In `src/survey/vragenlijst-beheer.controller.ts`, direct na `trekDeelnemerIn()` (na regel 678):

```typescript
  /**
   * Registreert dat een beheerder deze uitnodiging apart heeft verzonden,
   * buiten het ingebouwde mailkanaal om. Zie
   * `RondeBeheerService.registreerHandmatigeVerzending()` voor de reden dat
   * dit geen statusovergang is maar een los feit.
   *
   * @VereistRol('admin'): zelfde grens als de andere schrijfroutes hier.
   */
  @Post('runs/:id/participants/:responseId/handmatig-verzonden')
  @VereistRol('admin')
  @HttpCode(200)
  async registreerHandmatigeVerzending(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Param('responseId') responseId: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let invoer: ReturnType<typeof leesHandmatigeVerzending>;

    try {
      invoer = leesHandmatigeVerzending(body);
    } catch (err) {
      throw this.naarHttpFout(err);
    }

    return this.rondes.registreerHandmatigeVerzending(
      sessie.tenantId,
      id,
      responseId,
      invoer.verzondenOp,
    );
  }

  /**
   * Geeft een ingetrokken deelnemer een nieuw token binnen dezelfde ronde.
   * Zie `RondeBeheerService.heruitnodigen()` voor waarom dit een UPDATE is
   * en geen nieuwe rij.
   *
   * @VereistRol('admin'): zelfde grens als de andere schrijfroutes hier.
   */
  @Post('runs/:id/participants/:responseId/heruitnodigen')
  @VereistRol('admin')
  @HttpCode(200)
  async heruitnodigen(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Param('responseId') responseId: string,
  ) {
    const sessie = request.sessie!;

    // Zelfde standaard-geldigheidsduur als bij het aanmaken van een ronde:
    // GELDIGHEID_STANDAARD_DAGEN (30 dagen, ronde-invoer.ts:45). De
    // uitnodigen()-route staat een afwijkend aantal dagen toe via de body
    // (invoer.geldigheidDagen, zie leesUitnodigingen()); heruitnodigen()
    // neemt bewust geen body-parameter mee en gebruikt altijd de standaard —
    // dit is een correctie op één bestaande uitnodiging, geen nieuwe
    // beleidskeuze over geldigheidsduur.
    const uitkomst = await this.rondes.heruitnodigen(
      sessie.tenantId,
      id,
      responseId,
      GELDIGHEID_STANDAARD_DAGEN,
    );

    return {
      ...uitkomst,
      link: this.portaalLink(uitkomst.token),
    };
  }
```

Importeer `GELDIGHEID_STANDAARD_DAGEN` uit `./ronde-invoer` bovenaan de controller (controleer of hij al geïmporteerd is — `leesUitnodigingen` komt uit hetzelfde bestand).

- [ ] **Step 3: Importeer `leesHandmatigeVerzending`**

Voeg toe aan de bestaande import van `ronde-invoer.ts` bovenaan `vragenlijst-beheer.controller.ts`.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: geen fouten.

- [ ] **Step 5: Commit**

```powershell
git add src/survey/vragenlijst-beheer.controller.ts src/survey/ronde-invoer.ts
git commit -m "feat(survey): routes voor handmatige verzendregistratie en heruitnodigen"
```

---

## Task 7: Dashboard — `handmatigVerzondenOp` meenemen

**Files:**
- Modify: `src/survey/contractmanager.service.ts`

- [ ] **Step 1: Voeg het veld toe aan `StatusItem` (na `uitgestuurdOp`, regel 66)**

```typescript
  uitgestuurdOp: string | null;
  /**
   * Wanneer een beheerder handmatig heeft geregistreerd dat deze uitnodiging
   * apart is verzonden. Null wanneer dat nooit is gebeurd. Zie
   * respons-status.ts voor hoe dit de berekende status beïnvloedt.
   */
  handmatigVerzondenOp: string | null;
```

- [ ] **Step 2: Voeg de kolom toe aan `StatusRij` (na `uitgestuurd_op`, regel 95)**

```typescript
  uitgestuurd_op: Date | string | null;
  handmatig_verzonden_op: Date | string | null;
```

- [ ] **Step 3: Voeg de kolom toe aan de SQL-query (na `s.created_at AS uitgestuurd_op`, regel 183)**

```sql
                     s.created_at    AS uitgestuurd_op,
                     s.handmatig_verzonden_op,
```

- [ ] **Step 4: Geef het veld door in `bepaalStatus()` en de mapping (rond regel 232-243)**

```typescript
          uitgestuurdOp: iso(r.uitgestuurd_op),
          handmatigVerzondenOp: iso(r.handmatig_verzonden_op),
          submittedAt: iso(r.submitted_at),
          closesAt: iso(r.closes_at),
          status: bepaalStatus({
            submittedAt: r.submitted_at,
            closesAt: r.closes_at,
            rondeStatus: r.ronde_status,
            laatsteOordeel: r.laatste_oordeel,
            handmatigVerzondenOp: r.handmatig_verzonden_op,
          }),
```

- [ ] **Step 5: Controleer `haalGeplandeVendors()` (rond regel 316)**

Dit is een 'gepland'-item zonder response — die krijgt `handmatigVerzondenOp: null` net zoals de andere response-gebonden velden daar al `null` zijn. Voeg toe aan het object rond regel 316:

```typescript
          uitgestuurdOp: null,
          handmatigVerzondenOp: null,
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: geen fouten.

- [ ] **Step 7: Zoek en werk overige aanroepers van `StatusItem`/`bepaalStatus` bij**

```powershell
Select-String -Path "src\survey\*.ts" -Pattern "bepaalStatus\(|StatusItem" -List
```

Werk elke resterende plek bij die dit nog niet heeft (bijv. `beoordeling.service.ts` als die ook `bepaalStatus()` aanroept — controleer expliciet).

- [ ] **Step 8: Volledige typecheck**

Run: `npm run typecheck`
Expected: geen fouten meer in de hele backend.

- [ ] **Step 9: Commit**

```powershell
git add src/survey/contractmanager.service.ts
git commit -m "feat(survey): handmatigVerzondenOp meenemen in het statusoverzicht"
```

---

## Task 8: e2e-tests

**Files:**
- Modify: `test/ronde-beheer-routes.e2e-spec.ts`

- [ ] **Step 1: Test voor handmatige verzendregistratie**

Voeg toe na de bestaande intrekken-tests (na regel ~1120, zoek de sectie `// ── Eén deelnemer intrekken`):

```typescript
  // ── Handmatige verzendregistratie ────────────────────────────────────────

  it('registreert een handmatige verzending', async () => {
    const runId = await nieuweRonde();
    const responseId = await nodigUit(runId, VENDOR_1);

    const antwoord = await request(server)
      .post(
        `/admin/survey/runs/${runId}/participants/${responseId}/handmatig-verzonden`,
      )
      .set('Cookie', cookieAdminA)
      .send({ verzondenOp: '2026-09-26T09:00:00.000Z' })
      .expect(200);

    expect(antwoord.body.handmatigVerzondenOp).toBe(
      '2026-09-26T09:00:00.000Z',
    );

    const ronde = await request(server)
      .get(`/admin/survey/runs/${runId}`)
      .set('Cookie', cookieAdminA)
      .expect(200);

    const deelnemer = (
      ronde.body as {
        deelnemers: Array<{ responseId: string; status: string }>;
      }
    ).deelnemers.find((d) => d.responseId === responseId);

    // De onderliggende status verandert niet — alleen het feit is vastgelegd.
    expect(deelnemer?.status).toBe('pending');
  });

  it('weigert een toekomstige datum bij handmatige verzendregistratie', async () => {
    const runId = await nieuweRonde();
    const responseId = await nodigUit(runId, VENDOR_1);

    const morgen = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await request(server)
      .post(
        `/admin/survey/runs/${runId}/participants/${responseId}/handmatig-verzonden`,
      )
      .set('Cookie', cookieAdminA)
      .send({ verzondenOp: morgen })
      .expect(400);
  });

  it('overschrijft een eerdere handmatige verzendregistratie', async () => {
    const runId = await nieuweRonde();
    const responseId = await nodigUit(runId, VENDOR_1);

    await request(server)
      .post(
        `/admin/survey/runs/${runId}/participants/${responseId}/handmatig-verzonden`,
      )
      .set('Cookie', cookieAdminA)
      .send({ verzondenOp: '2026-09-26T09:00:00.000Z' })
      .expect(200);

    const tweede = await request(server)
      .post(
        `/admin/survey/runs/${runId}/participants/${responseId}/handmatig-verzonden`,
      )
      .set('Cookie', cookieAdminA)
      .send({ verzondenOp: '2026-09-26T15:00:00.000Z' })
      .expect(200);

    expect(tweede.body.handmatigVerzondenOp).toBe('2026-09-26T15:00:00.000Z');
  });

  it('geeft 404 bij handmatige verzendregistratie op een niet-bestaande deelnemer', async () => {
    const runId = await nieuweRonde();

    await request(server)
      .post(
        `/admin/survey/runs/${runId}/participants/00000000-0000-0000-0000-00000000dead/handmatig-verzonden`,
      )
      .set('Cookie', cookieAdminA)
      .send({ verzondenOp: '2026-09-26T09:00:00.000Z' })
      .expect(404);
  });

  // ── Heruitnodigen na intrekken ───────────────────────────────────────────

  it('geeft een nieuw token bij heruitnodigen van een ingetrokken deelnemer', async () => {
    const runId = await nieuweRonde();
    const responseId = await nodigUit(runId, VENDOR_1);

    await request(server)
      .post(`/admin/survey/runs/${runId}/participants/${responseId}/intrekken`)
      .set('Cookie', cookieAdminA)
      .send({})
      .expect(200);

    const antwoord = await request(server)
      .post(
        `/admin/survey/runs/${runId}/participants/${responseId}/heruitnodigen`,
      )
      .set('Cookie', cookieAdminA)
      .send({})
      .expect(200);

    expect(antwoord.body.responseId).toBe(responseId);
    expect(typeof antwoord.body.token).toBe('string');
    expect(antwoord.body.token.length).toBeGreaterThan(0);
    expect(typeof antwoord.body.link).toBe('string');

    const ronde = await request(server)
      .get(`/admin/survey/runs/${runId}`)
      .set('Cookie', cookieAdminA)
      .expect(200);

    const deelnemer = (
      ronde.body as {
        deelnemers: Array<{ responseId: string; status: string }>;
      }
    ).deelnemers.find((d) => d.responseId === responseId);

    expect(deelnemer?.status).toBe('pending');
  });

  it('weigert heruitnodigen van een deelnemer die nog pending is', async () => {
    const runId = await nieuweRonde();
    const responseId = await nodigUit(runId, VENDOR_1);

    await request(server)
      .post(
        `/admin/survey/runs/${runId}/participants/${responseId}/heruitnodigen`,
      )
      .set('Cookie', cookieAdminA)
      .send({})
      .expect(409);
  });

  it('geeft 404 bij heruitnodigen van een niet-bestaande deelnemer', async () => {
    const runId = await nieuweRonde();

    await request(server)
      .post(
        `/admin/survey/runs/${runId}/participants/00000000-0000-0000-0000-00000000dead/heruitnodigen`,
      )
      .set('Cookie', cookieAdminA)
      .send({})
      .expect(404);
  });

  it('laat tenant B niet heruitnodigen bij een deelnemer van tenant A', async () => {
    const runId = await nieuweRonde();
    const responseId = await nodigUit(runId, VENDOR_1);

    await request(server)
      .post(`/admin/survey/runs/${runId}/participants/${responseId}/intrekken`)
      .set('Cookie', cookieAdminA)
      .send({})
      .expect(200);

    await request(server)
      .post(
        `/admin/survey/runs/${runId}/participants/${responseId}/heruitnodigen`,
      )
      .set('Cookie', cookieAdminB)
      .send({})
      .expect(404);
  });
```

**Let op:** controleer vóór het toevoegen de exacte naam van `cookieAdminB` en het patroon van tenant-isolatie-tests elders in hetzelfde bestand (zie de bestaande `'laat tenant B niet intrekken...'`-test rond regel 1113) — volg dat patroon exact, inclusief eventuele setup die `cookieAdminB` vereist.

- [ ] **Step 2: Run de nieuwe tests**

Run: `npx jest test/ronde-beheer-routes.e2e-spec.ts -t "handmatig|heruitnodig"`
Expected: alle nieuwe tests PASS. (Vereist een lopende wegwerpdatabase — zie `docs/runbooks/commandos-en-omgeving.md` §"Een nieuwe e2e-suite schrijven".)

- [ ] **Step 3: Run de volledige e2e-suite van dit bestand**

Run: `npx jest test/ronde-beheer-routes.e2e-spec.ts`
Expected: alle tests PASS, inclusief de al bestaande.

- [ ] **Step 4: Run de volledige e2e-run**

Run: `npx jest --config test/jest-e2e.json` (of het exacte commando uit `package.json` — controleer `npm run test:e2e` of vergelijkbaar)
Expected: alle tests PASS. Dit is verplicht vóór afronding (zie CLAUDE.md §5: "Draai altijd de volledige e2e-run", niet alleen de nieuwe suite — vier unieke sleutels missen `tenant_id` en een suite die los groen draait kan de volledige run alsnog rood maken).

- [ ] **Step 5: Commit**

```powershell
git add test/ronde-beheer-routes.e2e-spec.ts
git commit -m "test(survey): e2e-tests voor handmatige verzendregistratie en heruitnodigen"
```

---

## Task 9: Volledige verificatie

**Files:** geen wijzigingen, alleen verificatie.

- [ ] **Step 1: Draai de volledige verificatie**

Run: `npm run verify:volledig`
Expected: alles groen. Dit is het enige bewijs dat telt (CLAUDE.md: "Groen is alleen groen via verify").

- [ ] **Step 2: Bij een falende stap**

Volg `docs/runbooks/commandos-en-omgeving.md` §"Bij een falende test of onverwacht resultaat" — controleer eerst de bekende architectuurvallen (FORCE RLS + SECURITY DEFINER, `clm."user"` aan één tenant gebonden, PATCH/PUT-mismatches) vóór een nieuwe diagnose-aanpak.

---

## Wat dit plan bewust niet doet

- **Geen frontend-wijziging.** Dit plan levert alleen de backend-routes. Een knop/veld in het rondebeheer-scherm ("apart verzonden op...", "heruitnodigen") is een aparte, latere stap in de MCM2-frontend-repo — pas oppakken zodra de backend hier staat en beproefd is.
- **Geen wijziging aan `uitnodigen()`.** Een geheel nieuwe leverancier toevoegen aan een ronde blijft zoals het was; dit plan raakt alleen het pad ná een intrekking.
- **Geen koppeling met de Excel-export.** De export blijft ongewijzigd — dit plan voegt alleen de mogelijkheid toe om ná de export, handmatig, een verzendmoment vast te leggen.
- **Geen terugkoppeling vanaf het leveranciersportaal** (bijv. "eerste keer op de link geklikt"). Dat was optie 2 uit het eerdere advies en is bewust uitgesteld tot na de eerste praktijkronde.
