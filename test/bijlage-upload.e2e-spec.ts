import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

const TENANT = '00000000-0000-0000-0000-0000000000a5';

/** Een minimaal geldig PDF-bestand: de handtekening plus wat inhoud. */
const PDF = Buffer.concat([
  Buffer.from('%PDF-1.7\n'),
  Buffer.from('certificaatinhoud'),
]);

/** Een minimaal geldig PNG-bestand: de acht handtekeningbytes plus inhoud. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('beeldinhoud'),
]);

let teller = 0;

/**
 * Toetst de bijlage-upload van buitenaf (vragenlijst-ontwerp §6, Issue #9).
 *
 * De regel die alles bepaalt: **de inhoud telt, niet de naam.** Een bestand
 * heet `certificaat.pdf` en bevat iets heel anders; extensie en de door de
 * browser meegestuurde Content-Type komen allebei van de client.
 */
describe('Bijlage-upload (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let server: App;
  let uploadMap: string;

  async function maakRonde(opties: {
    upload?: boolean;
    maxFiles?: number;
    responseStatus?: string;
  }): Promise<{ token: string; responseId: string }> {
    const token = genereerToken();
    const naam = `b${teller++}-${Date.now()}`;

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

      await tx.execute(
        sql`INSERT INTO clm.survey_question
                (tenant_id, template_id, position, question_key, title, body,
                 answer_type, is_required, allows_upload, max_files)
            VALUES (${TENANT}, ${templateId}, 1, 'q1', 'Certificaat',
                    'Bevestigt u dit?', 'confirmation', true,
                    ${opties.upload ?? true}, ${opties.maxFiles ?? 2})`,
      );
      // Tweede vraag zonder upload, om te toetsen dat een bestand daar wordt
      // geweigerd.
      await tx.execute(
        sql`INSERT INTO clm.survey_question
                (tenant_id, template_id, position, question_key, title, body,
                 answer_type, is_required, allows_upload, max_files)
            VALUES (${TENANT}, ${templateId}, 2, 'q2', 'Zonder upload',
                    'Bevestigt u dit?', 'confirmation', true, false, 0)`,
      );

      const run = await tx.execute<{ run_id: string }>(
        sql`INSERT INTO clm.survey_run (tenant_id, template_id, status)
            VALUES (${TENANT}, ${templateId}, 'active') RETURNING run_id`,
      );

      const response = await tx.execute<{ response_id: string }>(
        sql`INSERT INTO clm.survey_response
                (tenant_id, run_id, vendor_id, subject_vendor_id, token_hash,
                 status, expires_at, submitted_at)
            VALUES (${TENANT}, ${run.rows[0].run_id},
                    ${vendor.rows[0].vendor_id}, ${vendor.rows[0].vendor_id},
                    ${hashToken(token)}, ${opties.responseStatus ?? 'pending'},
                    ${berekenVervalmoment().toISOString()},
                    ${opties.responseStatus === 'submitted' ? new Date() : null})
            RETURNING response_id`,
      );

      return response.rows[0].response_id;
    });

    return { token, responseId };
  }

  const upload = (token: string, vraag: string) =>
    request(server).post(
      `/survey/respond/attachment?t=${token}&question=${vraag}`,
    );

  beforeAll(async () => {
    // Eigen tijdelijke map per run: de tests schrijven echte bestanden, en die
    // horen niet in de projectmap achter te blijven.
    uploadMap = await mkdtemp(join(tmpdir(), 'mcm2-uploads-'));
    process.env.UPLOAD_DIR = uploadMap;

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
            VALUES (${TENANT}, 'bijlage-test')
            ON CONFLICT (tenant_id) DO NOTHING`,
      );
    });
  });

  afterAll(async () => {
    await app.close();
    await rm(uploadMap, { recursive: true, force: true });
    delete process.env.UPLOAD_DIR;
  });

  // ── De gelukkige weg ──────────────────────────────────────────────────────

  it('neemt een PDF aan en bewaart wat de server heeft vastgesteld', async () => {
    const { token, responseId } = await maakRonde({});

    const res = await upload(token, 'q1')
      .attach('file', PDF, 'certificaat.pdf')
      .expect(201);

    expect((res.body as { contentType: string }).contentType).toBe(
      'application/pdf',
    );

    const rij = await db.withTenant(TENANT, (tx) =>
      tx.execute<{
        content_type: string;
        byte_size: number;
        sha256: string;
        original_name: string;
        storage_key: string;
      }>(
        sql`SELECT content_type, byte_size, sha256, original_name, storage_key
              FROM clm.survey_attachment WHERE response_id = ${responseId}`,
      ),
    );

    expect(rij.rows).toHaveLength(1);
    expect(rij.rows[0].content_type).toBe('application/pdf');
    expect(rij.rows[0].byte_size).toBe(PDF.length);
    expect(rij.rows[0].sha256).toMatch(/^[0-9a-f]{64}$/);

    // Het bestand staat er ook echt, met exact dezelfde bytes.
    const opSchijf = await readFile(join(uploadMap, rij.rows[0].storage_key));
    expect(opSchijf.equals(PDF)).toBe(true);
  });

  it('neemt ook een PNG aan', async () => {
    const { token } = await maakRonde({});

    const res = await upload(token, 'q1')
      .attach('file', PNG, 'bewijs.png')
      .expect(201);

    expect((res.body as { contentType: string }).contentType).toBe('image/png');
  });

  // ── Inhoud boven naam (testpunt 20) ───────────────────────────────────────

  it('weigert een .pdf met PNG-inhoud op de bytes, niet op de naam (testpunt 20)', async () => {
    const { token, responseId } = await maakRonde({});

    const res = await upload(token, 'q1')
      .attach('file', PNG, {
        filename: 'certificaat.pdf',
        contentType: 'application/pdf',
      })
      .expect(422);

    expect(res.body).toMatchObject({
      status: 'invalid_file',
      reason: 'type-komt-niet-overeen',
    });

    // Niets weggeschreven, en geen bestand achtergebleven.
    const aantal = await db.withTenant(TENANT, (tx) =>
      tx.execute<{ n: string }>(
        sql`SELECT count(*)::text AS n FROM clm.survey_attachment
             WHERE response_id = ${responseId}`,
      ),
    );
    expect(aantal.rows[0].n).toBe('0');
  });

  it('weigert een bestand dat geen PDF of PNG is', async () => {
    const { token } = await maakRonde({});

    const res = await upload(token, 'q1')
      .attach('file', Buffer.from('gewoon een tekstbestand'), 'notitie.pdf')
      .expect(422);

    expect(res.body).toMatchObject({ reason: 'onbekend-type' });
  });

  it('weigert een leeg bestand', async () => {
    const { token } = await maakRonde({});

    await upload(token, 'q1')
      .attach('file', Buffer.alloc(0), 'leeg.pdf')
      .expect(422);
  });

  // ── Grenzen (testpunt 19, 21) ─────────────────────────────────────────────

  it('weigert een bestand van 5 MB + 1 byte tijdens ontvangst (testpunt 21)', async () => {
    // De grens ligt in de ontvangstlaag, niet erna: multer breekt af zodra de
    // limiet gepasseerd is, dus dit bestand komt nooit volledig binnen.
    const { token } = await maakRonde({});

    const teGroot = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.alloc(5 * 1024 * 1024 + 1 - 9, 0x41),
    ]);

    await upload(token, 'q1').attach('file', teGroot, 'groot.pdf').expect(413);
  });

  it('weigert meer bestanden dan max_files (testpunt 19)', async () => {
    const { token } = await maakRonde({ maxFiles: 2 });

    await upload(token, 'q1').attach('file', PDF, 'een.pdf').expect(201);
    await upload(token, 'q1').attach('file', PDF, 'twee.pdf').expect(201);

    const res = await upload(token, 'q1')
      .attach('file', PDF, 'drie.pdf')
      .expect(422);

    expect(res.body).toMatchObject({ reason: 'too_many_files', maximum: 2 });
  });

  it('houdt het maximum aan bij herhaalde uploads (testpunt 19)', async () => {
    // Het maximum per vraag komt uit survey_question.max_files en kan niet in
    // een CHECK: die kan noch over meerdere rijen tellen noch een andere tabel
    // raadplegen. De telling gebeurt daarom in de transactie.
    const { token, responseId } = await maakRonde({ maxFiles: 2 });

    await upload(token, 'q1').attach('file', PDF, 'een.pdf').expect(201);
    await upload(token, 'q1').attach('file', PDF, 'twee.pdf').expect(201);
    await upload(token, 'q1').attach('file', PDF, 'drie.pdf').expect(422);

    const aantal = await db.withTenant(TENANT, (tx) =>
      tx.execute<{ n: string }>(
        sql`SELECT count(*)::text AS n FROM clm.survey_attachment
             WHERE response_id = ${responseId}`,
      ),
    );
    expect(aantal.rows[0].n).toBe('2');
  });

  it('laat twee tegelijk gestarte uploads het maximum niet overschrijden', async () => {
    // BEPERKING VAN DEZE TEST, expliciet vastgelegd zodat niemand hem
    // overschat: hij toont dat het maximum standhoudt bij twee aanroepen die
    // tegelijk gestart worden, maar hij bewijst NIET dat de FOR UPDATE in
    // BijlageService daarvoor nodig is. Met die vergrendeling verwijderd loopt
    // deze test namelijk ook groen — gemeten, niet aangenomen.
    //
    // De reden is dat twee transacties via dezelfde pg-Pool in de praktijk
    // achter elkaar aan de beurt komen zodra de eerste zijn connectie
    // teruggeeft. Een echte overlap uitlokken vraagt twee losse verbindingen
    // en een gecontroleerd wachtpunt binnen de transactie — dat zou een haak in
    // productiecode kosten, en dat is de prijs niet waard voor een
    // vergrendeling die goedkoop en correct is.
    //
    // FOR UPDATE blijft dus staan als bescherming tegen het geval dat de
    // transacties wél overlappen (meerdere processen, tragere schijf); wat
    // hier bewezen wordt is uitsluitend de uitkomst, niet het mechanisme.
    const { token, responseId } = await maakRonde({ maxFiles: 1 });

    const uitkomsten = await Promise.all([
      upload(token, 'q1').attach('file', PDF, 'a.pdf'),
      upload(token, 'q1').attach('file', PDF, 'b.pdf'),
    ]);

    expect(uitkomsten.map((r) => r.status).sort()).toEqual([201, 422]);

    const aantal = await db.withTenant(TENANT, (tx) =>
      tx.execute<{ n: string }>(
        sql`SELECT count(*)::text AS n FROM clm.survey_attachment
             WHERE response_id = ${responseId}`,
      ),
    );
    expect(aantal.rows[0].n).toBe('1');
  });

  it('weigert een derde bestand wanneer max_files 2 is, ook na herhaalde pogingen', async () => {
    // De praktische kant van dezelfde regel: het maximum houdt stand.
    const { token, responseId } = await maakRonde({ maxFiles: 1 });

    await upload(token, 'q1').attach('file', PDF, 'een.pdf').expect(201);
    await upload(token, 'q1').attach('file', PDF, 'twee.pdf').expect(422);
    await upload(token, 'q1').attach('file', PDF, 'drie.pdf').expect(422);

    const aantal = await db.withTenant(TENANT, (tx) =>
      tx.execute<{ n: string }>(
        sql`SELECT count(*)::text AS n FROM clm.survey_attachment
             WHERE response_id = ${responseId}`,
      ),
    );
    expect(aantal.rows[0].n).toBe('1');
  });

  // ── Padveiligheid (testpunt 22) ───────────────────────────────────────────

  it('maakt van een bestandsnaam met ../ een storage_key zonder padverwijzing (testpunt 22)', async () => {
    const { token, responseId } = await maakRonde({});

    await upload(token, 'q1')
      .attach('file', PDF, '../../etc/passwd.pdf')
      .expect(201);

    const rij = await db.withTenant(TENANT, (tx) =>
      tx.execute<{ storage_key: string; original_name: string }>(
        sql`SELECT storage_key, original_name FROM clm.survey_attachment
             WHERE response_id = ${responseId}`,
      ),
    );

    // De opslagsleutel bevat geen enkel teken uit de invoer.
    expect(rij.rows[0].storage_key).not.toContain('..');
    expect(rij.rows[0].storage_key).toMatch(
      new RegExp(`^${TENANT}/${responseId}/[0-9a-f-]{36}$`),
    );
    // De getoonde naam is ontdaan van het pad.
    expect(rij.rows[0].original_name).toBe('passwd.pdf');

    // En het bestand staat binnen de uploadmap, niet erbuiten.
    const opSchijf = await readFile(join(uploadMap, rij.rows[0].storage_key));
    expect(opSchijf.equals(PDF)).toBe(true);
  });

  // ── Toegang en toestand ───────────────────────────────────────────────────

  it('weigert een bestand bij een vraag die geen upload toestaat', async () => {
    const { token } = await maakRonde({});

    const res = await upload(token, 'q2')
      .attach('file', PDF, 'ergens.pdf')
      .expect(422);

    expect(res.body).toMatchObject({ reason: 'question_accepts_no_files' });
  });

  it('weigert een vraag die niet bij deze vragenlijst hoort', async () => {
    const { token } = await maakRonde({});

    await upload(token, 'van-een-andere-lijst')
      .attach('file', PDF, 'ergens.pdf')
      .expect(404);
  });

  it('weigert een upload zonder question-parameter', async () => {
    const { token } = await maakRonde({});

    await request(server)
      .post(`/survey/respond/attachment?t=${token}`)
      .attach('file', PDF, 'ergens.pdf')
      .expect(400);
  });

  it('weigert een upload zonder bestand', async () => {
    const { token } = await maakRonde({});

    await upload(token, 'q1').expect(400);
  });

  it('weigert uploaden na indienen met 410', async () => {
    const { token } = await maakRonde({ responseStatus: 'submitted' });

    // De guard grijpt hier al in — een ingediende response geeft 410 op elke
    // route van deze controller.
    await upload(token, 'q1').attach('file', PDF, 'te-laat.pdf').expect(410);
  });

  it('weigert een upload met een onbekend token', async () => {
    await request(server)
      .post(`/survey/respond/attachment?t=${genereerToken()}&question=q1`)
      .attach('file', PDF, 'ergens.pdf')
      .expect(404);
  });

  // ── Samenspel met indienen ────────────────────────────────────────────────

  it('maakt indienen met confirmed op een uploadvraag mogelijk zodra er een bestand is', async () => {
    // Dit is waarom stap 8 nodig was: de validatie eist een bestand bij
    // 'confirmed' op een uploadvraag (testpunt 18). Zonder upload was die vraag
    // niet bevestigend te beantwoorden.
    const { token } = await maakRonde({});

    // Eerst zonder bestand: geweigerd.
    await request(server)
      .post(`/survey/respond?t=${token}`)
      .send({
        answers: [
          { questionKey: 'q1', answerCode: 'confirmed' },
          { questionKey: 'q2', answerCode: 'confirmed' },
        ],
      })
      .expect(422);

    await upload(token, 'q1')
      .attach('file', PDF, 'certificaat.pdf')
      .expect(201);

    // Met bestand: aanvaard.
    await request(server)
      .post(`/survey/respond?t=${token}`)
      .send({
        answers: [
          { questionKey: 'q1', answerCode: 'confirmed' },
          { questionKey: 'q2', answerCode: 'confirmed' },
        ],
      })
      .expect(200);
  });
});
