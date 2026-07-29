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
import { maskeerDiep, maskeerToken } from '../src/survey/token-maskering';

const TENANT = '00000000-0000-0000-0000-0000000000e1';

/** Supertest typeert `res.body` als `any`; dit maakt de verwachtingen expliciet. */
interface AntwoordBody {
  status?: string;
  verlooptOp?: string;
  message?: string;
}

const body = (res: { body: unknown }): AntwoordBody => res.body as AntwoordBody;

/**
 * Toetst de leverancierroutes van buitenaf: precies zoals een leverancier ze
 * bereikt, via HTTP, zonder login.
 */
describe('Leverancierroutes (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let server: App;

  async function maakLink(opties: {
    naam: string;
    verlooptOver?: number;
    status?: string;
    /** Lifecycle van de ronde (migratie 0005/0006). Default 'active'. */
    rondeStatus?: 'draft' | 'active' | 'finished' | 'archived';
  }): Promise<string> {
    const token = genereerToken();
    const verval =
      opties.verlooptOver === undefined
        ? berekenVervalmoment()
        : new Date(Date.now() + opties.verlooptOver);

    await db.withTenant(TENANT, async (tx) => {
      await tx.execute(
        sql`INSERT INTO clm.tenant (tenant_id, name) VALUES (${TENANT}, 'routes-test')
            ON CONFLICT (tenant_id) DO NOTHING`,
      );
      const vendor = await tx.execute<{ vendor_id: string }>(
        sql`INSERT INTO clm.vendor (tenant_id, name) VALUES (${TENANT}, ${`v-${opties.naam}`})
            RETURNING vendor_id`,
      );
      const template = await tx.execute<{ template_id: string }>(
        sql`INSERT INTO clm.survey_template (tenant_id, name) VALUES (${TENANT}, ${`t-${opties.naam}`})
            RETURNING template_id`,
      );
      // Sinds stap 6 valideert POST /survey/respond de antwoorden tegen de
      // vragen van de ronde. Een template zonder vragen levert daardoor niets
      // op om in te dienen; deze suite gaat over toegang en éénmaligheid, dus
      // één minimale vraag volstaat. De inhoudelijke validatieregels worden
      // getoetst in antwoord-indienen.e2e-spec.ts.
      await tx.execute(
        sql`INSERT INTO clm.survey_question
                (tenant_id, template_id, position, question_key, title, body,
                 answer_type, is_required)
            VALUES (${TENANT}, ${template.rows[0].template_id}, 1, 'q1',
                    'Bevestiging', 'Bevestigt u dit?', 'yes_no', true)`,
      );
      // Sinds migratie 0005 heeft survey_run een expliciete lifecycle met
      // 'draft' als default (ontwerp §2b). Standaard 'active': dat is de
      // toestand waarin een leverancier de link daadwerkelijk gebruikt.
      const run = await tx.execute<{ run_id: string }>(
        sql`INSERT INTO clm.survey_run (tenant_id, template_id, status)
            VALUES (${TENANT}, ${template.rows[0].template_id},
                    ${opties.rondeStatus ?? 'active'}) RETURNING run_id`,
      );
      // subject_vendor_id is sinds migratie 0005 verplicht. Dit is een
      // UC1-respons (vendor_compliance), dus deelnemer en onderwerp zijn
      // dezelfde leverancier — de trigger assert_response_rollen eist dat.
      await tx.execute(
        sql`INSERT INTO clm.survey_response
              (tenant_id, run_id, vendor_id, subject_vendor_id, token_hash,
               status, expires_at, submitted_at)
            VALUES (${TENANT}, ${run.rows[0].run_id}, ${vendor.rows[0].vendor_id},
                    ${vendor.rows[0].vendor_id},
                    ${hashToken(token)}, ${opties.status ?? 'pending'}, ${verval},
                    ${opties.status === 'submitted' ? new Date() : null})`,
      );
    });

    return token;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    db = moduleRef.get(DatabaseService);
  });

  afterAll(async () => {
    await db.withTenant(TENANT, async (tx) => {
      // audit.audit_event wordt bewust NIET opgeruimd: de runtime-rol heeft
      // daar alleen INSERT en SELECT (MCM2-CLAUDE.md §7.7, migratie 0001).
      // Append-only is het punt — een test die dat omzeilt zou de garantie
      // ondermijnen die hij hoort te bewaken.
      // Volgorde is niet vrij: alle survey-tabellen hebben ON DELETE RESTRICT,
      // want een ingediende response is bewijsmateriaal en mag nooit
      // stilzwijgend meeverdwijnen. Antwoorden en vragen dus vóór de template.
      await tx.execute(sql`DELETE FROM clm.survey_answer`);
      await tx.execute(sql`DELETE FROM clm.survey_response`);
      await tx.execute(sql`DELETE FROM clm.survey_run`);
      await tx.execute(sql`DELETE FROM clm.survey_question`);
      await tx.execute(sql`DELETE FROM clm.survey_template`);
      await tx.execute(sql`DELETE FROM clm.vendor`);
      await tx.execute(sql`DELETE FROM clm.tenant`);
    });
    await app.close();
  });

  // ── Toegang ───────────────────────────────────────────────────────────────

  it('geeft de status van een geldige link, zonder vendor- of tenantgegevens', async () => {
    const token = await maakLink({ naam: 'geldig' });

    const res = await request(server)
      .get(`/survey/respond?t=${token}`)
      .expect(200);

    expect(body(res).status).toBe('open');
    expect(body(res).verlooptOp).toBeDefined();

    // Geen informatie die de leverancier niet al heeft.
    const alsTekst = JSON.stringify(res.body);
    expect(alsTekst).not.toContain(TENANT);
    expect(alsTekst).not.toContain('vendor');
  });

  it('weigert een verzoek zonder token met 404', async () => {
    await request(server).get('/survey/respond').expect(404);
  });

  it('weigert een onbekend token met 404, ononderscheidbaar van ingetrokken', async () => {
    const onbekend = await request(server)
      .get(`/survey/respond?t=${genereerToken()}`)
      .expect(404);

    const ingetrokken = await maakLink({
      naam: 'revoked',
      status: 'revoked',
    });
    const res = await request(server)
      .get(`/survey/respond?t=${ingetrokken}`)
      .expect(404);

    // Zelfde status én zelfde melding: het onderscheid mag geen informatie zijn.
    expect(body(res).message).toBe(body(onbekend).message);
  });

  it('weigert een verlopen link met 410 en een begrijpelijke melding', async () => {
    const token = await maakLink({ naam: 'verlopen', verlooptOver: -1000 });

    const res = await request(server)
      .get(`/survey/respond?t=${token}`)
      .expect(410);

    expect(body(res).message).toContain('verlopen');
  });

  // Testpunt 30 op HTTP-niveau: de service weigert de draft-ronde al (zie
  // survey-token-isolatie), hier gaat het erom dat de guard er ook echt een
  // 410 van maakt met een melding die een leverancier verder helpt.
  it('weigert een link naar een nog niet opengestelde ronde met 410', async () => {
    const token = await maakLink({ naam: 'draftronde', rondeStatus: 'draft' });

    const res = await request(server)
      .get(`/survey/respond?t=${token}`)
      .expect(410);

    expect(body(res).message).toContain('nog niet opengesteld');
  });

  it('weigert indienen op een nog niet opengestelde ronde', async () => {
    const token = await maakLink({
      naam: 'draftindienen',
      rondeStatus: 'draft',
    });

    // De guard hangt op controllerniveau, dus POST hoort dezelfde weigering
    // te geven als GET. Zonder deze test zou een guard die alleen op GET
    // controleert onopgemerkt blijven.
    await request(server).post(`/survey/respond?t=${token}`).expect(410);
  });

  // ── Indienen ──────────────────────────────────────────────────────────────

  it('dient een response in en weigert de tweede poging met 410', async () => {
    const token = await maakLink({ naam: 'indienen' });

    const eerste = await request(server)
      .post(`/survey/respond?t=${token}`)
      .send({ answers: [{ questionKey: 'q1', answerCode: 'yes' }] })
      .expect(200);
    expect(body(eerste).status).toBe('ingediend');

    // Tweede poging: de guard ziet nu status 'submitted'.
    await request(server).post(`/survey/respond?t=${token}`).expect(410);

    // En de link toont daarna ook bij GET dat hij gebruikt is.
    const status = await request(server)
      .get(`/survey/respond?t=${token}`)
      .expect(410);
    expect(body(status).message).toContain('ingediend');
  });

  it('legt het indienen vast in de audit trail, zonder het ruwe token', async () => {
    const token = await maakLink({ naam: 'audit' });

    await request(server)
      .post(`/survey/respond?t=${token}`)
      .send({ answers: [{ questionKey: 'q1', answerCode: 'yes' }] })
      .expect(200);

    const regels = await db.withTenant(TENANT, async (tx) => {
      const r = await tx.execute<{ action_type: string; new_values: unknown }>(
        sql`SELECT action_type, new_values FROM audit.audit_event
             WHERE action_type = 'survey_response_ingediend'`,
      );
      return r.rows;
    });

    expect(regels.length).toBeGreaterThan(0);
    // Het ruwe token mag nergens in de audit trail voorkomen.
    expect(JSON.stringify(regels)).not.toContain(token);
  });

  it('staat de applicatierol niet toe auditregels te wijzigen of te verwijderen', async () => {
    // Append-only (MCM2-CLAUDE.md §7.7): de applicatie mag auditregels
    // toevoegen, niet wijzigen of verwijderen. Zonder deze garantie is een
    // audit trail waardeloos — wie kan wissen, kan sporen uitwissen.
    //
    // Toetsen op SQLSTATE 42501 (insufficient_privilege), niet op de
    // foutmelding: die is taalgevoelig en Drizzle verpakt hem bovendien in
    // een eigen fout, waardoor de oorspronkelijke tekst in `cause` belandt.
    const foutcode = async (fn: () => Promise<unknown>): Promise<string> => {
      try {
        await fn();
        return 'GEEN FOUT';
      } catch (err) {
        const oorzaak = (err as { cause?: { code?: string } }).cause;
        return oorzaak?.code ?? (err as { code?: string }).code ?? 'ONBEKEND';
      }
    };

    expect(
      await foutcode(() =>
        db.withTenant(TENANT, (tx) =>
          tx.execute(sql`DELETE FROM audit.audit_event`),
        ),
      ),
    ).toBe('42501');

    expect(
      await foutcode(() =>
        db.withTenant(TENANT, (tx) =>
          tx.execute(
            sql`UPDATE audit.audit_event SET action_type = 'vervalst'`,
          ),
        ),
      ),
    ).toBe('42501');
  });

  // ── Logmaskering (ontwerp §7) ─────────────────────────────────────────────

  it('maskeert het token in URL-achtige tekst', () => {
    const token = genereerToken();

    expect(maskeerToken(`GET /survey/respond?t=${token} 404`)).toBe(
      'GET /survey/respond?t=[GEMASKEERD] 404',
    );
    expect(maskeerToken(`https://host/survey/respond?x=1&t=${token}`)).toBe(
      'https://host/survey/respond?x=1&t=[GEMASKEERD]',
    );

    // Wat geen token is, blijft leesbaar — anders wordt een log onbruikbaar.
    expect(maskeerToken('gewone logregel zonder token')).toBe(
      'gewone logregel zonder token',
    );
  });

  it('houdt de foutmelding van een Error leesbaar', () => {
    // Regressietest. De eerste versie liet maskeerDiep over Object.entries()
    // lopen; bij een Error is die lijst leeg omdat message en stack
    // niet-opsombaar zijn. Gevolg: elke foutmelding werd `{}` — in CI viel dat
    // op doordat de container "Object(0) {}" logde in plaats van de
    // configuratiefout. Bij een incident zou je dan niets zien.
    const token = genereerToken();
    const origineel = new Error(
      `Verzoek mislukt voor /survey/respond?t=${token}`,
    );

    const gemaskeerd = maskeerDiep(origineel) as Error;

    expect(gemaskeerd).toBeInstanceOf(Error);
    expect(gemaskeerd.message).toContain('Verzoek mislukt');
    expect(gemaskeerd.message).toContain('[GEMASKEERD]');
    expect(gemaskeerd.message).not.toContain(token);
  });

  it('maskeert tokens in geneste logcontext', () => {
    const token = genereerToken();

    const gemaskeerd = maskeerDiep({
      url: `/survey/respond?t=${token}`,
      nested: { token, veilig: 'blijft staan' },
    }) as Record<string, unknown>;

    expect(JSON.stringify(gemaskeerd)).not.toContain(token);
    expect(JSON.stringify(gemaskeerd)).toContain('blijft staan');
  });
});
