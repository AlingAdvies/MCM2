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
import { TEST_IDS } from './test-ids';

const { tenant: TENANT } = TEST_IDS['antwoord-concept-opslaan'];

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

function redenen(res: { body: unknown }): string[] {
  const body = res.body as FoutBody;
  const fouten = body.errors ?? body.message?.errors ?? [];
  return fouten.map((f) => `${f.question}:${f.reason}`);
}

/**
 * Toetst PUT /survey/respond/answers — concept opslaan (ontwerp §7).
 *
 * Zelfde opzet als antwoord-indienen.e2e-spec.ts: een eigen `maakRonde()` die
 * rechtstreeks in de database een ronde met token neerzet, en HTTP-aanroepen
 * op precies de manier waarop het portaal dit endpoint gebruikt.
 */
describe('Antwoord-concept opslaan (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let server: App;

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

  const bewaar = (token: string, answers: unknown) =>
    request(server).put(`/survey/respond/answers?t=${token}`).send({ answers });

  const dienIn = (token: string, answers: unknown) =>
    request(server).post(`/survey/respond?t=${token}`).send({ answers });

  interface VraagUitAntwoord {
    questionKey: string;
    savedAnswer: {
      answerCode: string | null;
      comment: string | null;
    } | null;
  }

  const vragen = (token: string) =>
    request(server).get(`/survey/respond/questions?t=${token}`);

  async function opgeslagenAntwoorden(
    responseId: string,
  ): Promise<Map<string, { code: string | null; comment: string | null }>> {
    const rows = await db.withTenant(TENANT, (tx) =>
      tx.execute<{
        question_key: string;
        answer_code: string | null;
        comment: string | null;
      }>(
        sql`SELECT q.question_key, a.answer_code, a.comment
              FROM clm.survey_answer a
              JOIN clm.survey_question q ON q.question_id = a.question_id
             WHERE a.response_id = ${responseId}`,
      ),
    );
    return new Map(
      rows.rows.map((r) => [
        r.question_key,
        { code: r.answer_code, comment: r.comment },
      ]),
    );
  }

  async function responseStatus(responseId: string): Promise<string> {
    const rows = await db.withTenant(TENANT, (tx) =>
      tx.execute<{ status: string }>(
        sql`SELECT status FROM clm.survey_response
             WHERE response_id = ${responseId}`,
      ),
    );
    return rows.rows[0].status;
  }

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
            VALUES (${TENANT}, 'concept-opslaan-test')
            ON CONFLICT (tenant_id) DO NOTHING`,
      );
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('slaat een gedeeltelijke set antwoorden op zonder de status te wijzigen', async () => {
    const { token, responseId } = await maakRonde([
      { key: 'q1', type: 'yes_no' },
      { key: 'q2', type: 'yes_no' },
      { key: 'q3', type: 'yes_no' },
    ]);

    // Alleen q1 — q2 en q3 zijn verplicht maar dat mag bij een concept.
    await bewaar(token, [{ questionKey: 'q1', answerCode: 'yes' }]).expect(200);

    expect(await responseStatus(responseId)).toBe('pending');

    const antwoorden = await opgeslagenAntwoorden(responseId);
    expect(antwoorden.get('q1')?.code).toBe('yes');
    expect(antwoorden.has('q2')).toBe(false);
    expect(antwoorden.has('q3')).toBe(false);
  });

  it('overschrijft een eerder opgeslagen antwoord bij een tweede keer opslaan', async () => {
    const { token, responseId } = await maakRonde([
      { key: 'q1', type: 'yes_no' },
    ]);

    await bewaar(token, [{ questionKey: 'q1', answerCode: 'yes' }]).expect(200);
    await bewaar(token, [{ questionKey: 'q1', answerCode: 'no' }]).expect(200);

    const antwoorden = await opgeslagenAntwoorden(responseId);
    expect(antwoorden.get('q1')?.code).toBe('no');
  });

  it('vult een tweede opslag aan zonder de eerste te wissen', async () => {
    // De praktijk uit ontwerp §7: vraag 1 t/m 3 nu, de rest later.
    const { token, responseId } = await maakRonde([
      { key: 'q1', type: 'yes_no' },
      { key: 'q2', type: 'yes_no' },
    ]);

    await bewaar(token, [{ questionKey: 'q1', answerCode: 'yes' }]).expect(200);
    await bewaar(token, [{ questionKey: 'q2', answerCode: 'no' }]).expect(200);

    const antwoorden = await opgeslagenAntwoorden(responseId);
    expect(antwoorden.get('q1')?.code).toBe('yes');
    expect(antwoorden.get('q2')?.code).toBe('no');
  });

  it('geeft een opgeslagen concept terug bij een nieuw bezoek aan de link', async () => {
    // De kern van teruglezen: opslaan zonder dit is een doodlopend pad — de
    // leverancier ziet zijn eigen werk niet terug bij het opnieuw openen.
    const { token } = await maakRonde([
      { key: 'q1', type: 'yes_no' },
      { key: 'q2', type: 'yes_no' },
    ]);

    await bewaar(token, [{ questionKey: 'q1', answerCode: 'yes' }]).expect(200);

    const res = await vragen(token).expect(200);
    const body = res.body as { questions: VraagUitAntwoord[] };

    const q1 = body.questions.find((v) => v.questionKey === 'q1');
    const q2 = body.questions.find((v) => v.questionKey === 'q2');

    expect(q1?.savedAnswer?.answerCode).toBe('yes');
    expect(q2?.savedAnswer).toBeNull();
  });

  it('accepteert een lege set zonder iets weg te schrijven', async () => {
    const { token, responseId } = await maakRonde([
      { key: 'q1', type: 'yes_no', verplicht: false },
    ]);

    await bewaar(token, []).expect(200);

    const antwoorden = await opgeslagenAntwoorden(responseId);
    expect(antwoorden.size).toBe(0);
  });

  it('weigert een ongeldig antwoord binnen het concept, met dezelfde reden als bij indienen', async () => {
    const { token } = await maakRonde([{ key: 'q1', type: 'confirmation' }]);

    // not_confirmed zonder toelichting: zelfde regel als bij POST /survey/respond.
    const res = await bewaar(token, [
      { questionKey: 'q1', answerCode: 'not_confirmed' },
    ]).expect(422);

    expect(redenen(res)).toContain('q1:comment_required');
  });

  it('weigert een instruction-blok als antwoord, ook in een concept', async () => {
    const { token } = await maakRonde([
      { key: 'intro', type: 'instruction', verplicht: false },
      { key: 'q1', type: 'yes_no', verplicht: false },
    ]);

    const res = await bewaar(token, [
      { questionKey: 'intro', answerText: 'iets' },
    ]).expect(422);

    expect(redenen(res)).toContain('intro:instruction_has_no_answer');
  });

  it('weigert een onbekende question_key', async () => {
    const { token } = await maakRonde([
      { key: 'q1', type: 'yes_no', verplicht: false },
    ]);

    const res = await bewaar(token, [
      { questionKey: 'niet-bestaand', answerCode: 'yes' },
    ]).expect(422);

    expect(redenen(res)).toContain('niet-bestaand:unknown_question');
  });

  it('laat niets weggeschreven bij een ongeldig antwoord in dezelfde poging', async () => {
    // Net als bij indienen (testpunt 25): een mislukte validatie mag geen
    // halve set achterlaten. q1 is geldig, q2 niet — geen van beide mag staan.
    const { token, responseId } = await maakRonde([
      { key: 'q1', type: 'yes_no', verplicht: false },
      { key: 'q2', type: 'confirmation', verplicht: false },
    ]);

    await bewaar(token, [
      { questionKey: 'q1', answerCode: 'yes' },
      { questionKey: 'q2', answerCode: 'not_confirmed' },
    ]).expect(422);

    const antwoorden = await opgeslagenAntwoorden(responseId);
    expect(antwoorden.size).toBe(0);
  });

  it('weigert opslaan na indienen — de link blijft niet bruikbaar om te wijzigen', async () => {
    const { token } = await maakRonde([
      { key: 'q1', type: 'yes_no', verplicht: false },
    ]);

    await dienIn(token, [{ questionKey: 'q1', answerCode: 'yes' }]).expect(200);

    await bewaar(token, [{ questionKey: 'q1', answerCode: 'no' }]).expect(410);
  });

  it('weigert opslaan als de ronde nog niet open is (draft)', async () => {
    const { token } = await maakRonde(
      [{ key: 'q1', type: 'yes_no', verplicht: false }],
      { rondeStatus: 'draft' },
    );

    await bewaar(token, [{ questionKey: 'q1', answerCode: 'yes' }]).expect(410);
  });

  it('weigert opslaan zonder token', async () => {
    await request(server)
      .put('/survey/respond/answers')
      .send({ answers: [] })
      .expect(404);
  });

  it('laat een later indienen alsnog werken met de opgeslagen antwoorden aangevuld', async () => {
    // De kern van het ontwerp: concept opslaan is geen aparte werkelijkheid,
    // het is dezelfde survey_answer-rij die POST /survey/respond ook gebruikt.
    const { token, responseId } = await maakRonde([
      { key: 'q1', type: 'yes_no' },
      { key: 'q2', type: 'yes_no' },
    ]);

    await bewaar(token, [{ questionKey: 'q1', answerCode: 'yes' }]).expect(200);

    await dienIn(token, [
      { questionKey: 'q1', answerCode: 'yes' },
      { questionKey: 'q2', answerCode: 'no' },
    ]).expect(200);

    expect(await responseStatus(responseId)).toBe('submitted');

    const antwoorden = await opgeslagenAntwoorden(responseId);
    expect(antwoorden.get('q1')?.code).toBe('yes');
    expect(antwoorden.get('q2')?.code).toBe('no');
  });
});
