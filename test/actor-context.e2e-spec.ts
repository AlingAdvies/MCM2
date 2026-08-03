import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Test, TestingModule } from '@nestjs/testing';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../src/db/database.service';
import { TEST_IDS } from './test-ids';

const TENANT = TEST_IDS['actor-context'].tenant;

/**
 * Bewijst dat `app.current_actor` daadwerkelijk in de database aankomt.
 *
 * ── Waarom deze test bestaat vóór de eerste policy ───────────────────────────
 *
 * Migratie 0013 verandert bewust geen gedrag: geen enkele bestaande policy
 * leunt op de actor. Dat maakt hem veilig om uit te rollen, maar het betekent
 * ook dat een fout erin volledig onzichtbaar is — alles blijft groen, ook als
 * de variabele nooit gezet wordt.
 *
 * Migratie 0014 gaat er wél op leunen. Als de doorgifte dan stuk blijkt, is de
 * uitkomst niet een foutmelding maar nul rijen op een plek waar een medewerker
 * iets hoort te zien. Dat is precies de faalvorm die dit project probeert uit
 * te sluiten: stil, en pas zichtbaar wanneer iemand er last van heeft.
 *
 * Vandaar deze test nu, en niet samen met survey_review.
 */
describe('Actor-context (e2e)', () => {
  let moduleRef: TestingModule;
  let db: DatabaseService;

  const leesActor = (actor?: 'medewerker' | 'leverancier') =>
    db.withTenant(
      TENANT,
      async (tx) => {
        const r = await tx.execute<{ actor: string }>(
          sql`SELECT clm.current_actor() AS actor`,
        );
        return r.rows[0].actor;
      },
      actor,
    );

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [DatabaseService],
    }).compile();

    db = moduleRef.get(DatabaseService);
    await db.onModuleInit();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('geeft de actor door aan de database', async () => {
    await expect(leesActor('medewerker')).resolves.toBe('medewerker');
    await expect(leesActor('leverancier')).resolves.toBe('leverancier');
  });

  /**
   * De kern van het ontwerp: niet zetten faalt dicht, niet open.
   *
   * Was de standaard 'medewerker' geweest, dan zou elke aanroeper die de actor
   * vergeet stilzwijgend de ruimste rechten krijgen — en dat is nooit op te
   * merken, want het werkt gewoon.
   */
  it('levert onbekend op wanneer de actor niet is meegegeven', async () => {
    await expect(leesActor()).resolves.toBe('onbekend');
  });

  /**
   * De actor mag niet overleven buiten zijn transactie.
   *
   * set_config(..., true) is transactielokaal, maar de verbindingenpool geeft
   * dezelfde connectie aan een volgend verzoek. Lekte de waarde, dan zou een
   * leveranciersverzoek de actor van een eerdere medewerker kunnen erven — een
   * rechtenlek dat alleen onder belasting optreedt en dus vrijwel niet te
   * reproduceren is.
   *
   * Deze test dwingt hergebruik af door de pool op één verbinding te zetten
   * (DATABASE_POOL_MAX) is hier niet nodig: de aanroepen zijn sequentieel, dus
   * de tweede pakt per definitie een vrijgekomen connectie.
   */
  it('laat de actor niet lekken naar een volgende transactie', async () => {
    await leesActor('medewerker');
    await expect(leesActor()).resolves.toBe('onbekend');

    await leesActor('leverancier');
    await expect(leesActor()).resolves.toBe('onbekend');
  });

  /**
   * Tegenproef-ondersteuning: de actor is per transactie, niet per proces.
   *
   * Twee gelijktijdige transacties met verschillende actors mogen elkaar niet
   * beïnvloeden. Zonder deze garantie zou de policy op survey_review afhangen
   * van timing.
   */
  it('houdt gelijktijdige transacties uit elkaar', async () => {
    const [a, b, c] = await Promise.all([
      leesActor('medewerker'),
      leesActor('leverancier'),
      leesActor(),
    ]);

    expect(a).toBe('medewerker');
    expect(b).toBe('leverancier');
    expect(c).toBe('onbekend');
  });

  /**
   * Bewaakt dat de drie leverancierspaden zichzelf niet als medewerker
   * aankondigen.
   *
   * ── Waarom deze test de broncode leest en niet het gedrag ────────────────
   *
   * Deze controle is er gekomen door een tegenproef die groen bleef. Op
   * 2026-08-03 is `vragenlijst-lezen.service.ts` van 'leverancier' naar
   * 'medewerker' gezet — het ernstigste wat er met dit mechanisme mis kan gaan,
   * want daarmee krijgt een leverancier straks toegang tot beoordelingen over
   * zichzelf. Alle 268 tests bleven groen.
   *
   * Dat is terecht en tegelijk onacceptabel. Terecht, omdat er nog geen policy
   * bestaat die de actor gebruikt: migratie 0013 verandert bewust geen gedrag,
   * en tot migratie 0014 is er niets dat een verkeerde actor kan merken.
   * Onacceptabel, omdat de doorgifte daarmee tot dat moment volledig onbewaakt
   * is — en dit is precies het venster waarin iemand een nieuwe survey-route
   * bouwt en de actor vergeet of overneemt van het verkeerde voorbeeld.
   *
   * Een gedragstest is hier dus niet mogelijk. De broncode lezen is lelijker,
   * maar het is het verschil tussen een bewaakte afspraak en een goed
   * voornemen — dezelfde afweging als in test-ids.spec.ts.
   *
   * Zodra migratie 0014 er is, blijft deze test staan: hij vangt de fout bij de
   * bron, terwijl een policytest hem pas vangt op de ene plek waar hij toevallig
   * zichtbaar wordt (MCM2-CLAUDE.md §15b, tegenproef 6).
   */
  it('kondigt elk leverancierspad aan als leverancier', () => {
    // De drie paden die een leverancier met zijn token bereikt. vragenlijst-
    // import staat er bewust niet bij: dat is beheerwerk achter een sessie.
    const leverancierspaden = [
      'src/survey/vragenlijst-lezen.service.ts',
      'src/survey/antwoord-indienen.service.ts',
      'src/survey/bijlage.service.ts',
      'src/survey/survey-token.service.ts',
    ];

    for (const pad of leverancierspaden) {
      const bron = readFileSync(join(__dirname, '..', pad), 'utf8');

      expect({ pad, medewerker: bron.includes("'medewerker'") }).toEqual({
        pad,
        medewerker: false,
      });
      expect({ pad, leverancier: bron.includes("'leverancier'") }).toEqual({
        pad,
        leverancier: true,
      });
    }
  });
});
