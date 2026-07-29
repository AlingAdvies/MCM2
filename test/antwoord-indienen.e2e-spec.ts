import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/db/database.service';
import {
  berekenVervalmoment,
  genereerToken,
  hashToken,
} from '../src/survey/survey-token';

const TENANT = '00000000-0000-0000-0000-0000000000b1';

interface VraagOpzet {
  key: string;
  type: string;
  verplicht?: boolean;
  upload?: boolean;
  maxFiles?: number;
  config?: Record<string, unknown>;
}

interface FoutBody {
  status?: string;
  errors?: { question: string; reason: string }[];
  message?: {
    status?: string;
    errors?: { question: string; reason: string }[];
  };
}

let teller = 0;

/** De redenen uit een 422, als "vraag:reden" — dat leest prettiger in asserties. */
function redenen(res: { body: unknown }): string[] {
  const body = res.body as FoutBody;
  const fouten = body.errors ?? body.message?.errors ?? [];
  return fouten.map((f) => `${f.question}:${f.reason}`);
}

/**
 * Toetst POST /survey/respond met antwoorden (ontwerp §5).
 *
 * Van buitenaf via HTTP, precies zoals het portaal hem aanroept. De browserlaag
 * telt niet mee als beveiliging — een leverancier kan deze POST direct sturen,
 * en dat is geen aanval maar normaal gedrag van iemand met een script.
 */
describe('Antwoorden indienen (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let server: App;

  /** Zet een ronde neer met de opgegeven vragen en levert het token. */
  async function maakRonde(
    vragen: VraagOpzet[],
    opties: { rondeStatus?: string } = {},
  ): Promise<{ token: string; responseId: string }> {
    const token = genereerToken();
    const naam = `r${teller++}-${Date.now()}`;

    const responseId = await db.withTenant(TENANT, async (tx) => {
      const vendor = await tx.execute<{ vendor_id: string }>(
        sql`INSERT INTO clm.vendor (tenant_id, name)
            VALUES (${TENANT}, ${`v-${naam}`}) RETURNING vendor_id`,
      );
      const template = await tx.execute<{ template_id: string }>(
        sql`INSERT INTO clm.survey_template (tenant_id, name, version)
            VALUES (${TENANT}, ${`t-${naam}`}, 1) RETURNING template_id`,
      );
      const templateId = template.rows[0].template_id;

      let positie = 0;
      for (const vraag of vragen) {
        positie += 1;
        await tx.execute(
          sql`INSERT INTO clm.survey_question
                  (tenant_id, template_id, position, question_key, title, body,
                   answer_type, is_required, allows_upload, max_files, config)
              VALUES (${TENANT}, ${templateId}, ${positie}, ${vraag.key},
                      ${`Titel ${vraag.key}`}, ${`Tekst ${vraag.key}`},
                      ${vraag.type}, ${vraag.verplicht ?? true},
                      ${vraag.upload ?? false}, ${vraag.maxFiles ?? 0},
                      ${JSON.stringify(vraag.config ?? {})}::jsonb)`,
        );
      }

      const run = await tx.execute<{ run_id: string }>(
        sql`INSERT INTO clm.survey_run (tenant_id, template_id, status)
            VALUES (${TENANT}, ${templateId}, ${opties.rondeStatus ?? 'active'})
            RETURNING run_id`,
      );

      const response = await tx.execute<{ response_id: string }>(
        sql`INSERT INTO clm.survey_response
                (tenant_id, run_id, vendor_id, subject_vendor_id, token_hash,
                 expires_at)
            VALUES (${TENANT}, ${run.rows[0].run_id},
                    ${vendor.rows[0].vendor_id}, ${vendor.rows[0].vendor_id},
                    ${hashToken(token)}, ${berekenVervalmoment().toISOString()})
            RETURNING response_id`,
      );

      return response.rows[0].response_id;
    });

    return { token, responseId };
  }

  const dienIn = (token: string, answers: unknown) =>
    request(server).post(`/survey/respond?t=${token}`).send({ answers });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    db = moduleRef.get(DatabaseService);

    await db.withTenant(TENANT, async (tx) => {
      await tx.execute(
        sql`INSERT INTO clm.tenant (tenant_id, name)
            VALUES (${TENANT}, 'indienen-test')
            ON CONFLICT (tenant_id) DO NOTHING`,
      );
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Volledigheid (testpunt 14, 32) ────────────────────────────────────────

  it('weigert indienen met een ontbrekend verplicht antwoord; response blijft pending', async () => {
    // Testpunt 14. De link moet daarna nog werken: het token is gehasht en dus
    // niet opnieuw te versturen, dus een half verbruikte link is onherstelbaar.
    const { token, responseId } = await maakRonde([
      { key: 'q1', type: 'yes_no' },
      { key: 'q2', type: 'yes_no' },
    ]);

    const res = await dienIn(token, [
      { questionKey: 'q1', answerCode: 'yes' },
    ]).expect(422);

    expect(redenen(res)).toContain('q2:answer_required');

    const status = await db.withTenant(TENANT, (tx) =>
      tx.execute<{ status: string }>(
        sql`SELECT status FROM clm.survey_response
             WHERE response_id = ${responseId}`,
      ),
    );
    expect(status.rows[0].status).toBe('pending');
  });

  it('laat een instruction-blok buiten beschouwing bij de volledigheid (testpunt 32)', async () => {
    // De waarschijnlijkste bug van het hele ontwerp: een leesblok dat meetelt
    // als onbeantwoorde vraag maakt de vragenlijst onindienbaar.
    const { token } = await maakRonde([
      { key: 'intro', type: 'instruction', verplicht: false },
      { key: 'q1', type: 'yes_no' },
    ]);

    await dienIn(token, [{ questionKey: 'q1', answerCode: 'yes' }]).expect(200);
  });

  it('weigert een antwoord op een instruction-blok', async () => {
    const { token } = await maakRonde([
      { key: 'intro', type: 'instruction', verplicht: false },
      { key: 'q1', type: 'yes_no' },
    ]);

    const res = await dienIn(token, [
      { questionKey: 'intro', answerText: 'iets' },
      { questionKey: 'q1', answerCode: 'yes' },
    ]).expect(422);

    expect(redenen(res)).toContain('intro:instruction_has_no_answer');
  });

  it('laat een niet-verplichte vraag leeg blijven', async () => {
    const { token } = await maakRonde([
      { key: 'q1', type: 'yes_no' },
      { key: 'q2', type: 'open_text', verplicht: false },
    ]);

    await dienIn(token, [{ questionKey: 'q1', answerCode: 'yes' }]).expect(200);
  });

  // ── Toelichting (testpunt 15, 16) ─────────────────────────────────────────

  it('eist een toelichting bij elke niet-bevestiging (testpunt 15)', async () => {
    const { token } = await maakRonde([{ key: 'q1', type: 'confirmation' }]);

    for (const code of ['not_confirmed', 'not_applicable']) {
      const res = await dienIn(token, [
        { questionKey: 'q1', answerCode: code },
      ]).expect(422);

      expect(redenen(res)).toContain('q1:comment_required');
    }
  });

  it('weigert een toelichting van "   -   " op de ondergrens (testpunt 16)', async () => {
    // Formeel gevuld, inhoudelijk leeg — erger dan een leeg veld, want in een
    // overzicht ziet het eruit als een antwoord.
    const { token } = await maakRonde([{ key: 'q1', type: 'confirmation' }]);

    const res = await dienIn(token, [
      { questionKey: 'q1', answerCode: 'not_confirmed', comment: '   -   ' },
    ]).expect(422);

    expect(redenen(res)).toContain('q1:comment_too_short');
  });

  it('accepteert een bevestiging zonder toelichting', async () => {
    const { token } = await maakRonde([{ key: 'q1', type: 'confirmation' }]);

    await dienIn(token, [
      { questionKey: 'q1', answerCode: 'confirmed' },
    ]).expect(200);
  });

  it('weigert een toelichting boven 2.000 tekens', async () => {
    const { token } = await maakRonde([{ key: 'q1', type: 'confirmation' }]);

    const res = await dienIn(token, [
      {
        questionKey: 'q1',
        answerCode: 'not_confirmed',
        comment: 'x'.repeat(2001),
      },
    ]).expect(422);

    expect(redenen(res)).toContain('q1:comment_too_long');
  });

  // ── Uploadregels (testpunt 17, 18) ────────────────────────────────────────

  it('weigert cannot_upload op een vraag zonder upload (testpunt 17)', async () => {
    const { token } = await maakRonde([{ key: 'q1', type: 'confirmation' }]);

    const res = await dienIn(token, [
      {
        questionKey: 'q1',
        answerCode: 'cannot_upload',
        comment: 'Het certificaat ligt bij een andere afdeling.',
      },
    ]).expect(422);

    expect(redenen(res)).toContain('q1:upload_option_not_available');
  });

  it('weigert confirmed op een uploadvraag zonder bestand (testpunt 18)', async () => {
    const { token } = await maakRonde([
      { key: 'q1', type: 'confirmation', upload: true, maxFiles: 2 },
    ]);

    const res = await dienIn(token, [
      { questionKey: 'q1', answerCode: 'confirmed' },
    ]).expect(422);

    expect(redenen(res)).toContain('q1:file_required');
  });

  it('staat cannot_upload met toelichting toe op een uploadvraag', async () => {
    // De reden dat deze optie bestaat: een upload kan mislukken om redenen die
    // niets met compliance te maken hebben.
    const { token } = await maakRonde([
      { key: 'q1', type: 'confirmation', upload: true, maxFiles: 2 },
    ]);

    await dienIn(token, [
      {
        questionKey: 'q1',
        answerCode: 'cannot_upload',
        comment: 'Ons certificaat valt onder een NDA met de certificeerder.',
      },
    ]).expect(200);
  });

  // ── Waardevalidatie per type (testpunt 33, 34, 35, 36) ────────────────────

  it('weigert een single_choice-code die niet in config.options staat (testpunt 33)', async () => {
    // Dit kan een CHECK niet: de toegestane codes staan in de config van de
    // vraag, en een CHECK mag geen andere tabel raadplegen.
    const { token } = await maakRonde([
      {
        key: 'q1',
        type: 'single_choice',
        config: {
          options: [
            { code: 'a', label: 'A' },
            { code: 'b', label: 'B' },
          ],
        },
      },
    ]);

    const res = await dienIn(token, [
      { questionKey: 'q1', answerCode: 'z' },
    ]).expect(422);

    expect(redenen(res)).toContain('q1:unknown_option');
  });

  it('weigert een rating buiten bereik en een niet-geheel getal (testpunt 34)', async () => {
    const { token } = await maakRonde([
      { key: 'q1', type: 'rating', config: { min: 1, max: 5 } },
    ]);

    const buiten = await dienIn(token, [
      { questionKey: 'q1', answerNumber: 9 },
    ]).expect(422);
    expect(redenen(buiten)).toContain('q1:out_of_range');

    const gebroken = await dienIn(token, [
      { questionKey: 'q1', answerNumber: 3.5 },
    ]).expect(422);
    expect(redenen(gebroken)).toContain('q1:not_an_integer');

    // En de tegenproef: binnen bereik werkt wél.
    await dienIn(token, [{ questionKey: 'q1', answerNumber: 4 }]).expect(200);
  });

  it('weigert multi_choice met duplicaten of buiten min/max (testpunt 35)', async () => {
    const { token } = await maakRonde([
      {
        key: 'q1',
        type: 'multi_choice',
        config: {
          options: [
            { code: 'a', label: 'A' },
            { code: 'b', label: 'B' },
            { code: 'c', label: 'C' },
          ],
          min_select: 2,
          max_select: 3,
        },
      },
    ]);

    const dubbel = await dienIn(token, [
      { questionKey: 'q1', answerCodes: ['a', 'a'] },
    ]).expect(422);
    expect(redenen(dubbel)).toContain('q1:duplicate_options');

    const teWeinig = await dienIn(token, [
      { questionKey: 'q1', answerCodes: ['a'] },
    ]).expect(422);
    expect(redenen(teWeinig)).toContain('q1:too_few_options');

    await dienIn(token, [
      { questionKey: 'q1', answerCodes: ['a', 'b'] },
    ]).expect(200);
  });

  it('weigert een answerType dat afwijkt van de vraag (testpunt 36)', async () => {
    // De samengestelde foreign key vangt dit ook af, maar dan als databasefout
    // in plaats van een leesbare 422.
    const { token } = await maakRonde([{ key: 'q1', type: 'yes_no' }]);

    const res = await dienIn(token, [
      { questionKey: 'q1', answerType: 'rating', answerNumber: 3 },
    ]).expect(422);

    expect(redenen(res)).toContain('q1:answer_type_mismatch');
  });

  it('weigert een number met te veel decimalen en een pct buiten 0–100', async () => {
    const { token } = await maakRonde([
      {
        key: 'q1',
        type: 'number',
        config: { format: 'pct', decimals: 1, min: 0, max: 100 },
      },
    ]);

    const tePrecies = await dienIn(token, [
      { questionKey: 'q1', answerNumber: 12.345 },
    ]).expect(422);
    expect(redenen(tePrecies)).toContain('q1:too_many_decimals');

    const buiten = await dienIn(token, [
      { questionKey: 'q1', answerNumber: 150 },
    ]).expect(422);
    expect(redenen(buiten)).toContain('q1:out_of_range');

    await dienIn(token, [{ questionKey: 'q1', answerNumber: 99.5 }]).expect(
      200,
    );
  });

  // ── Onbekende en dubbele vragen (testpunt 26) ─────────────────────────────

  it('weigert een question_key die niet bij deze ronde hoort (testpunt 26)', async () => {
    // RLS beschermt tegen een andere tenant, dit tegen een andere template
    // binnen dezelfde tenant.
    const { token } = await maakRonde([{ key: 'q1', type: 'yes_no' }]);

    const res = await dienIn(token, [
      { questionKey: 'q1', answerCode: 'yes' },
      { questionKey: 'van-een-andere-lijst', answerCode: 'yes' },
    ]).expect(422);

    expect(redenen(res)).toContain('van-een-andere-lijst:unknown_question');
  });

  it('weigert twee antwoorden op dezelfde vraag', async () => {
    const { token } = await maakRonde([{ key: 'q1', type: 'yes_no' }]);

    const res = await dienIn(token, [
      { questionKey: 'q1', answerCode: 'yes' },
      { questionKey: 'q1', answerCode: 'no' },
    ]).expect(422);

    expect(redenen(res)).toContain('q1:duplicate_answer');
  });

  it('meldt álle fouten tegelijk in plaats van alleen de eerste', async () => {
    // Wie acht vragen invult wil niet acht keer opnieuw proberen.
    const { token } = await maakRonde([
      { key: 'q1', type: 'confirmation' },
      { key: 'q2', type: 'rating', config: { min: 1, max: 5 } },
      { key: 'q3', type: 'yes_no' },
    ]);

    const res = await dienIn(token, [
      { questionKey: 'q1', answerCode: 'not_confirmed' },
      { questionKey: 'q2', answerNumber: 99 },
    ]).expect(422);

    expect(redenen(res).sort()).toEqual([
      'q1:comment_required',
      'q2:out_of_range',
      'q3:answer_required',
    ]);
  });

  // ── Wegschrijven en afsluiten (testpunt 23, 25) ───────────────────────────

  it('schrijft niets weg bij een afgekeurde indiening (testpunt 25)', async () => {
    // Een mislukte validatie mag geen halve antwoordset achterlaten.
    const { token, responseId } = await maakRonde([
      { key: 'q1', type: 'yes_no' },
      { key: 'q2', type: 'confirmation' },
    ]);

    await dienIn(token, [
      { questionKey: 'q1', answerCode: 'yes' },
      { questionKey: 'q2', answerCode: 'not_confirmed' },
    ]).expect(422);

    const aantal = await db.withTenant(TENANT, (tx) =>
      tx.execute<{ n: string }>(
        sql`SELECT count(*)::text AS n FROM clm.survey_answer
             WHERE response_id = ${responseId}`,
      ),
    );

    expect(aantal.rows[0].n).toBe('0');
  });

  it('schrijft elk antwoord in de juiste kolom weg', async () => {
    const { token, responseId } = await maakRonde([
      { key: 'bevestig', type: 'confirmation' },
      { key: 'tekst', type: 'open_text' },
      { key: 'cijfer', type: 'rating', config: { min: 1, max: 5 } },
      {
        key: 'meerkeuze',
        type: 'multi_choice',
        config: {
          options: [
            { code: 'a', label: 'A' },
            { code: 'b', label: 'B' },
          ],
        },
      },
    ]);

    await dienIn(token, [
      { questionKey: 'bevestig', answerCode: 'confirmed' },
      { questionKey: 'tekst', answerText: 'Een toelichting van enige lengte.' },
      { questionKey: 'cijfer', answerNumber: 4 },
      { questionKey: 'meerkeuze', answerCodes: ['a', 'b'] },
    ]).expect(200);

    const rijen = await db.withTenant(TENANT, (tx) =>
      tx.execute<{
        question_key: string;
        answer_code: string | null;
        answer_codes: string[] | null;
        answer_text: string | null;
        answer_number: string | null;
      }>(
        sql`SELECT q.question_key, a.answer_code, a.answer_codes,
                   a.answer_text, a.answer_number
              FROM clm.survey_answer a
              JOIN clm.survey_question q ON q.question_id = a.question_id
             WHERE a.response_id = ${responseId}
             ORDER BY q.position`,
      ),
    );

    expect(rijen.rows).toHaveLength(4);
    expect(rijen.rows[0].answer_code).toBe('confirmed');
    expect(rijen.rows[1].answer_text).toBe('Een toelichting van enige lengte.');
    expect(Number(rijen.rows[2].answer_number)).toBe(4);
    expect(rijen.rows[3].answer_codes).toEqual(['a', 'b']);

    // De vormconstraint: elk type vult precies één kolom en laat de rest leeg.
    expect(rijen.rows[0].answer_text).toBeNull();
    expect(rijen.rows[2].answer_code).toBeNull();
  });

  it('weigert een tweede indiening met 410 en laat de eerste ongemoeid', async () => {
    const { token, responseId } = await maakRonde([
      { key: 'q1', type: 'yes_no' },
    ]);

    await dienIn(token, [{ questionKey: 'q1', answerCode: 'yes' }]).expect(200);
    await dienIn(token, [{ questionKey: 'q1', answerCode: 'no' }]).expect(410);

    const rij = await db.withTenant(TENANT, (tx) =>
      tx.execute<{ answer_code: string }>(
        sql`SELECT answer_code FROM clm.survey_answer
             WHERE response_id = ${responseId}`,
      ),
    );

    // De tweede poging mag het eerste antwoord niet overschrijven.
    expect(rij.rows[0].answer_code).toBe('yes');
  });

  it('blokkeert schrijven na indienen op de RLS-policy zelf (testpunt 23)', async () => {
    // Niet de applicatie maar de database weigert dit. Getoetst met directe
    // SQL die de servicelaag overslaat — anders test je je eigen code en niet
    // de garantie.
    const { token, responseId } = await maakRonde([
      { key: 'q1', type: 'yes_no' },
    ]);

    await dienIn(token, [{ questionKey: 'q1', answerCode: 'yes' }]).expect(200);

    const questionId = await db.withTenant(TENANT, async (tx) => {
      const r = await tx.execute<{ question_id: string }>(
        sql`SELECT a.question_id FROM clm.survey_answer a
             WHERE a.response_id = ${responseId}`,
      );
      return r.rows[0].question_id;
    });

    const geweigerd = await db
      .withTenant(TENANT, async (tx) => {
        await tx.execute(
          sql`INSERT INTO clm.survey_answer
                  (tenant_id, response_id, question_id, answer_type, answer_code)
              VALUES (${TENANT}, ${responseId}, ${questionId}, 'yes_no', 'no')`,
        );
        return null;
      })
      .catch((fout: Error) => fout);

    expect(geweigerd).toBeInstanceOf(Error);
    const oorzaak = (geweigerd as Error & { cause?: Error }).cause;
    expect(oorzaak?.message).toMatch(/row-level security/i);
  });

  it('legt het aantal antwoorden vast in de audit trail', async () => {
    const { token, responseId } = await maakRonde([
      { key: 'q1', type: 'yes_no' },
      { key: 'q2', type: 'yes_no' },
    ]);

    await dienIn(token, [
      { questionKey: 'q1', answerCode: 'yes' },
      { questionKey: 'q2', answerCode: 'no' },
    ]).expect(200);

    const regels = await db.withTenant(TENANT, (tx) =>
      tx.execute<{ new_values: { aantalAntwoorden?: number } }>(
        sql`SELECT new_values FROM audit.audit_event
             WHERE entity_id = ${responseId}
               AND action_type = 'survey_response_ingediend'`,
      ),
    );

    expect(regels.rows).toHaveLength(1);
    expect(regels.rows[0].new_values.aantalAntwoorden).toBe(2);
  });

  it('weigert een body zonder answers-lijst', async () => {
    const { token } = await maakRonde([{ key: 'q1', type: 'yes_no' }]);

    const res = await request(server)
      .post(`/survey/respond?t=${token}`)
      .send({ answers: 'geen lijst' })
      .expect(422);

    expect(redenen(res)).toContain('(body):answers_must_be_a_list');
  });
});
