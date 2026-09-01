import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { cookieInstellingen } from '../src/auth/sessie';
import { SessieService } from '../src/auth/sessie.service';
import { TEST_IDS } from './test-ids';

/**
 * De beheerroutes van de vragenlijsten (fase A van het surveybeheerplan).
 *
 * De vraag die deze suite beantwoordt is niet "werkt het lezen" — dat is de
 * makkelijke helft. Het gaat om drie dingen die stuk kunnen zonder dat iemand
 * het merkt:
 *
 *   1. Kan tenant A een vragenlijst of ronde van tenant B zien?
 *   2. Komt de `token_hash` van een deelnemer ooit uit een route?
 *   3. Telt de lijst een instructiescherm mee als vraag?
 *
 * De derde lijkt cosmetisch en is dat niet: het scherm belooft de beheerder
 * hoeveel vragen de leverancier krijgt. Zit daar een introductie tussen, dan
 * klopt de belofte niet — en dat merk je pas bij de eerste echte ronde.
 */

const {
  tenantA,
  tenantB,
  userA,
  userB,
  reviewerA,
  templateA: TEMPLATE_A,
  templateB: TEMPLATE_B,
  runA: RUN_A,
  vendorA: VENDOR_A,
  responseA: RESPONSE_A,
} = TEST_IDS['vragenlijst-beheer-routes'];

const SUBJECT_A = `oid-vlb-a-${Date.now()}`;
const SUBJECT_B = `oid-vlb-b-${Date.now()}`;
const SUBJECT_REVIEWER = `oid-vlb-r-${Date.now()}`;

/**
 * 64 hex-tekens, conform de CHECK-constraint op `token_hash` (migratie 0003).
 * De herkenbare staart maakt hem terugzoekbaar in een antwoord — precies wat
 * de test "geeft de token_hash NOOIT terug" nodig heeft.
 */
const TOKEN_HASH = `${'0'.repeat(48)}deadbeefcafe1234`;

const ATTACHMENT_A = randomUUID();
const ATTACHMENT_STORAGE_KEY = `beheer-test/${ATTACHMENT_A}.pdf`;
const ATTACHMENT_INHOUD = Buffer.from('%PDF-1.7\ntest-certificaat');

interface LijstAntwoord {
  vragenlijsten: Array<{
    templateId: string;
    name: string;
    aantalVragen: number;
    aantalItems: number;
    aantalRondes: number;
  }>;
}

interface DetailAntwoord {
  templateId: string;
  name: string;
  aantalVragen: number;
  aantalItems: number;
  vragen: Array<{ questionKey: string; answerType: string; position: number }>;
  categorieen: Array<{ name: string }>;
}

interface RondesAntwoord {
  rondes: Array<{
    runId: string;
    templateNaam: string;
    status: string;
    aantalDeelnemers: number;
    aantalIngediend: number;
  }>;
}

interface RondeDetailAntwoord extends RondesAntwoord {
  runId: string;
  deelnemers: Array<{
    responseId: string;
    vendorNaam: string | null;
    status: string;
  }>;
}

async function verwijderTestdata(client: Client): Promise<void> {
  for (const tenant of [tenantA, tenantB]) {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    for (const tabel of [
      // Bijlagen en antwoorden vóór de respons: beide hebben een FK naar
      // survey_response, dus andersom weigert Postgres de DELETE.
      'clm.survey_attachment',
      'clm.survey_answer',
      'clm.survey_response',
      'clm.survey_run',
      'clm.survey_question',
      'clm.survey_category',
      'clm.survey_template',
      'clm.vendor_contact',
      'clm.vendor',
      'clm.tenant_membership',
      'clm."user"',
      'clm.tenant',
    ]) {
      await client.query(`DELETE FROM ${tabel} WHERE tenant_id = $1`, [tenant]);
    }
    await client.query('COMMIT');
  }
}

describe('Vragenlijst-beheerroutes (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let cookieA: string;
  let cookieB: string;
  let cookieReviewer: string;
  let uploadMap: string;
  const cookieNaam = cookieInstellingen().naam;

  beforeAll(async () => {
    // Eigen tijdelijke map, zelfde patroon als bijlage-upload.e2e-spec.ts:
    // de downloadroute leest een echt bestand van schijf.
    uploadMap = await mkdtemp(join(tmpdir(), 'mcm2-vlb-uploads-'));
    process.env.UPLOAD_DIR = uploadMap;
    await mkdir(join(uploadMap, 'beheer-test'), { recursive: true });
    await writeFile(join(uploadMap, ATTACHMENT_STORAGE_KEY), ATTACHMENT_INHOUD);

    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(client);

    for (const [tenant, user, subject, naam] of [
      [tenantA, userA, SUBJECT_A, 'Anna uit A'],
      [tenantB, userB, SUBJECT_B, 'Bob uit B'],
    ] as const) {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
      await client.query(
        'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
        [tenant, `vlb-test-${tenant.slice(-2)}`],
      );
      await client.query(
        `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
         VALUES ($1, $2, $3, $4)`,
        [user, tenant, naam, subject],
      );
      await client.query(
        `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
         VALUES ($1, $2, 'admin')`,
        [user, tenant],
      );
      await client.query('COMMIT');
    }

    // Een reviewer in tenant A: fase A stelt dat lezen ook voor hem mag.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
       VALUES ($1, $2, $3, $4)`,
      [reviewerA, tenantA, 'Rachid de reviewer', SUBJECT_REVIEWER],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'reviewer')`,
      [reviewerA, tenantA],
    );

    // Vragenlijst in A: één instructie plus twee echte vragen. Dat is de
    // vorm van de Transdev-lijst in het klein — en precies wat de telling
    // moet onderscheiden.
    await client.query(
      `INSERT INTO clm.survey_template (template_id, tenant_id, name, version)
       VALUES ($1, $2, 'beheer-test-lijst', 1)`,
      [TEMPLATE_A, tenantA],
    );
    for (const [key, positie, type] of [
      ['intro', 1, 'instruction'],
      ['v1', 2, 'confirmation'],
      ['v2', 3, 'confirmation'],
    ] as const) {
      await client.query(
        `INSERT INTO clm.survey_question
           (tenant_id, template_id, position, question_key, title, body, answer_type,
            is_required, allows_upload, max_files, config)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, false, 0, '{}'::jsonb)`,
        [
          tenantA,
          TEMPLATE_A,
          positie,
          key,
          `Titel ${key}`,
          `Toelichting bij ${key}`,
          type,
        ],
      );
    }

    // Een ronde met één deelnemer die nog niet heeft ingediend.
    await client.query(
      `INSERT INTO clm.survey_run
         (run_id, tenant_id, template_id, status, survey_kind, is_test, started_at)
       VALUES ($1, $2, $3, 'active', 'vendor_compliance', true, now())`,
      [RUN_A, tenantA, TEMPLATE_A],
    );
    await client.query(
      `INSERT INTO clm.vendor (vendor_id, tenant_id, name)
       VALUES ($1, $2, 'Leverancier van A')`,
      [VENDOR_A, tenantA],
    );
    // De hash moet 64 hex-tekens zijn (CHECK-constraint uit migratie 0003).
    // Deze waarde is herkenbaar genoeg om in het antwoord terug te zoeken en
    // voldoet toch aan de vorm — zie de test die hem nergens mag vinden.
    await client.query(
      `INSERT INTO clm.survey_response
         (response_id, tenant_id, run_id, vendor_id, subject_vendor_id,
          token_hash, status, expires_at)
       VALUES ($1, $2, $3, $4, $4, $5, 'pending', now() + interval '30 days')`,
      [RESPONSE_A, tenantA, RUN_A, VENDOR_A, TOKEN_HASH],
    );

    // Precies één van de twee echte vragen beantwoorden. Dat is bewust een
    // halve respons: de antwoordenroute moet de onbeantwoorde vraag tónen en
    // niet weglaten, en dat is met twee beantwoorde vragen niet te bewijzen.
    await client.query(
      // 'confirmed' en niet 'ja': de vormconstraint uit migratie 0005 staat bij
      // answer_type 'confirmation' alleen confirmed/not_confirmed/
      // not_applicable/cannot_upload toe.
      `INSERT INTO clm.survey_answer
         (tenant_id, response_id, question_id, answer_type, answer_code, comment)
       SELECT $1, $2, q.question_id, 'confirmation', 'confirmed', 'Toelichting bij v1'
         FROM clm.survey_question q
        WHERE q.template_id = $3 AND q.question_key = 'v1'`,
      [tenantA, RESPONSE_A, TEMPLATE_A],
    );

    // Eén bijlage bij v1, voor de downloadroute-tests hieronder.
    await client.query(
      `INSERT INTO clm.survey_attachment
         (attachment_id, tenant_id, response_id, question_id, original_name,
          storage_key, content_type, byte_size, sha256)
       SELECT $1, $2, $3, q.question_id, 'certificaat.pdf', $4,
              'application/pdf', $5, $6
         FROM clm.survey_question q
        WHERE q.template_id = $7 AND q.question_key = 'v1'`,
      [
        ATTACHMENT_A,
        tenantA,
        RESPONSE_A,
        ATTACHMENT_STORAGE_KEY,
        ATTACHMENT_INHOUD.length,
        '0'.repeat(64),
        TEMPLATE_A,
      ],
    );
    await client.query('COMMIT');

    // Vragenlijst in B, zodat de tenantgrens iets te verbergen heeft.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantB}'`);
    await client.query(
      `INSERT INTO clm.survey_template (template_id, tenant_id, name, version)
       VALUES ($1, $2, 'lijst-van-B', 1)`,
      [TEMPLATE_B, tenantB],
    );
    await client.query('COMMIT');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();

    const sessies = moduleRef.get(SessieService);
    const sessieA = await sessies.aanmaken(SUBJECT_A);
    const sessieB = await sessies.aanmaken(SUBJECT_B);
    const sessieR = await sessies.aanmaken(SUBJECT_REVIEWER);

    expect(sessieA).not.toBeNull();
    expect(sessieB).not.toBeNull();
    expect(sessieR).not.toBeNull();

    cookieA = `${cookieNaam}=${sessieA!.token}`;
    cookieB = `${cookieNaam}=${sessieB!.token}`;
    cookieReviewer = `${cookieNaam}=${sessieR!.token}`;
  }, 30000);

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(client);
    await client.end();
    await rm(uploadMap, { recursive: true, force: true });
    delete process.env.UPLOAD_DIR;
  }, 30000);

  describe('zonder geldige sessie is er geen toegang', () => {
    it.each([
      ['/admin/survey/templates'],
      ['/admin/survey/runs'],
      [`/admin/survey/templates/${TEMPLATE_A}`],
      [`/admin/survey/runs/${RUN_A}`],
    ])('weigert %s zonder cookie', async (pad) => {
      await request(server).get(pad).expect(401);
    });
  });

  describe('de tenantgrens', () => {
    it('toont A alleen de vragenlijst van A', async () => {
      const antwoord = await request(server)
        .get('/admin/survey/templates')
        .set('Cookie', cookieA)
        .expect(200);

      const body = antwoord.body as LijstAntwoord;
      const namen = body.vragenlijsten.map((v) => v.name);

      expect(namen).toContain('beheer-test-lijst');
      expect(namen).not.toContain('lijst-van-B');
    });

    it('geeft 404 op de vragenlijst van een andere tenant', async () => {
      // Niet 403: het bestaan van een vragenlijst bij een andere tenant is
      // zelf informatie. 404 laat in het midden of hij bestaat.
      await request(server)
        .get(`/admin/survey/templates/${TEMPLATE_B}`)
        .set('Cookie', cookieA)
        .expect(404);
    });

    it('geeft 404 op de ronde van een andere tenant', async () => {
      await request(server)
        .get(`/admin/survey/runs/${RUN_A}`)
        .set('Cookie', cookieB)
        .expect(404);
    });

    it('toont B geen enkele ronde van A', async () => {
      const antwoord = await request(server)
        .get('/admin/survey/runs')
        .set('Cookie', cookieB)
        .expect(200);

      expect((antwoord.body as RondesAntwoord).rondes).toHaveLength(0);
    });
  });

  describe('een instructie is geen vraag', () => {
    it('telt in de lijst 2 vragen bij 3 items', async () => {
      const antwoord = await request(server)
        .get('/admin/survey/templates')
        .set('Cookie', cookieA)
        .expect(200);

      const lijst = (antwoord.body as LijstAntwoord).vragenlijsten.find(
        (v) => v.name === 'beheer-test-lijst',
      );

      expect(lijst).toBeDefined();
      expect(lijst!.aantalVragen).toBe(2);
      expect(lijst!.aantalItems).toBe(3);
    });

    it('toont in het detail wél alle drie de items, op volgorde', async () => {
      // De beheerder moet zien wát er uitgestuurd wordt, en de introductie
      // hoort daarbij — hij staat als eerste op het scherm van de leverancier.
      const antwoord = await request(server)
        .get(`/admin/survey/templates/${TEMPLATE_A}`)
        .set('Cookie', cookieA)
        .expect(200);

      const body = antwoord.body as DetailAntwoord;

      expect(body.vragen.map((v) => v.questionKey)).toEqual([
        'intro',
        'v1',
        'v2',
      ]);
      expect(body.vragen[0].answerType).toBe('instruction');
      expect(body.aantalVragen).toBe(2);
    });
  });

  describe('rondes en deelnemers', () => {
    it('toont de ronde met voortgang', async () => {
      const antwoord = await request(server)
        .get('/admin/survey/runs')
        .set('Cookie', cookieA)
        .expect(200);

      const rondes = (antwoord.body as RondesAntwoord).rondes;

      expect(rondes).toHaveLength(1);
      expect(rondes[0].templateNaam).toBe('beheer-test-lijst');
      expect(rondes[0].status).toBe('active');
      expect(rondes[0].aantalDeelnemers).toBe(1);
      expect(rondes[0].aantalIngediend).toBe(0);
    });

    it('toont de deelnemer met leveranciersnaam', async () => {
      const antwoord = await request(server)
        .get(`/admin/survey/runs/${RUN_A}`)
        .set('Cookie', cookieA)
        .expect(200);

      const body = antwoord.body as RondeDetailAntwoord;

      expect(body.deelnemers).toHaveLength(1);
      expect(body.deelnemers[0].vendorNaam).toBe('Leverancier van A');
      expect(body.deelnemers[0].status).toBe('pending');
    });

    it('geeft de token_hash van een deelnemer NOOIT terug', async () => {
      // Het ruwe token bestaat één keer, bij uitgifte (fase B). Daarna alleen
      // de hash — en die hoort nergens uit een route te komen. Een lijst die
      // hem meestuurt geeft een aanvaller de helft van het werk.
      //
      // Het hele antwoord doorzoeken, niet één veld: als iemand later een
      // kolom toevoegt aan de selectie, moet deze test dat vangen.
      const antwoord = await request(server)
        .get(`/admin/survey/runs/${RUN_A}`)
        .set('Cookie', cookieA)
        .expect(200);

      const alsTekst = JSON.stringify(antwoord.body);

      expect(alsTekst).not.toContain(TOKEN_HASH);
      expect(alsTekst).not.toContain('deadbeefcafe1234');
      expect(alsTekst).not.toContain('token_hash');
      expect(alsTekst).not.toContain('tokenHash');
    });
  });

  describe('een reviewer mag lezen', () => {
    // Besluit uit fase A: resultaten inzien ís de rol van een reviewer. Hem
    // dat ontzeggen maakt de rol betekenisloos en de admin een flessenhals.
    it.each([
      ['de vragenlijsten', '/admin/survey/templates'],
      ['de rondes', '/admin/survey/runs'],
    ])('laat een reviewer %s lezen', async (_naam, pad) => {
      await request(server).get(pad).set('Cookie', cookieReviewer).expect(200);
    });

    it('laat een reviewer het detail van een vragenlijst lezen', async () => {
      await request(server)
        .get(`/admin/survey/templates/${TEMPLATE_A}`)
        .set('Cookie', cookieReviewer)
        .expect(200);
    });
  });

  describe('de antwoorden van één respons (fase C)', () => {
    interface AntwoordenBody {
      responseId: string;
      vendorNaam: string | null;
      templateNaam: string;
      aantalVragen: number;
      aantalBeantwoord: number;
      antwoorden: Array<{
        questionKey: string;
        answerType: string;
        position: number;
        antwoord: {
          answerCode: string | null;
          comment: string | null;
        } | null;
        bijlagen: unknown[];
      }>;
    }

    async function haalAntwoorden(cookie: string) {
      const antwoord = await request(server)
        .get(`/admin/survey/responses/${RESPONSE_A}/answers`)
        .set('Cookie', cookie)
        .expect(200);
      return antwoord.body as AntwoordenBody;
    }

    it('toont de respons met leverancier en vragenlijst erbij', async () => {
      const body = await haalAntwoorden(cookieA);

      expect(body.responseId).toBe(RESPONSE_A);
      expect(body.vendorNaam).toBe('Leverancier van A');
      expect(body.templateNaam).toBe('beheer-test-lijst');
    });

    // Dit is de kern van de route. Een respons waarvan één vraag open staat
    // moet die vraag tónen; zouden we vanaf survey_answer joinen, dan
    // verdwijnt hij en lijkt een halve respons compleet.
    it('toont ook de vraag die NIET beantwoord is', async () => {
      const body = await haalAntwoorden(cookieA);

      const v2 = body.antwoorden.find((a) => a.questionKey === 'v2');

      expect(v2).toBeDefined();
      expect(v2!.antwoord).toBeNull();
    });

    it('geeft het antwoord terug op de vraag die wél beantwoord is', async () => {
      const body = await haalAntwoorden(cookieA);

      const v1 = body.antwoorden.find((a) => a.questionKey === 'v1');

      expect(v1!.antwoord).not.toBeNull();
      expect(v1!.antwoord!.answerCode).toBe('confirmed');
      expect(v1!.antwoord!.comment).toBe('Toelichting bij v1');
    });

    it('telt 1 van 2 beantwoord, zonder het instructiescherm mee te rekenen', async () => {
      const body = await haalAntwoorden(cookieA);

      // Drie items, waarvan één instructie: dat zijn twee echte vragen.
      // Dezelfde afbakening als de lijst- en detailroute hierboven.
      expect(body.aantalVragen).toBe(2);
      expect(body.aantalBeantwoord).toBe(1);
    });

    it('houdt het instructiescherm in de lijst, op volgorde', async () => {
      const body = await haalAntwoorden(cookieA);

      // De leverancier zág dat scherm. Laat je het weg, dan loopt de
      // nummering niet meer gelijk met wat hij voor zich had.
      expect(body.antwoorden.map((a) => a.questionKey)).toEqual([
        'intro',
        'v1',
        'v2',
      ]);
      expect(body.antwoorden[0].answerType).toBe('instruction');
    });

    it('geeft de token_hash ook hier NOOIT terug', async () => {
      const antwoord = await request(server)
        .get(`/admin/survey/responses/${RESPONSE_A}/answers`)
        .set('Cookie', cookieA)
        .expect(200);

      const alsTekst = JSON.stringify(antwoord.body);

      expect(alsTekst).not.toContain(TOKEN_HASH);
      expect(alsTekst).not.toContain('deadbeefcafe1234');
      expect(alsTekst).not.toContain('token_hash');
      expect(alsTekst).not.toContain('tokenHash');
    });

    it('geeft de storage_key van een bijlage nooit terug', async () => {
      // Het interne pad hoort niet uit een overzichtsroute te komen;
      // downloaden loopt via een eigen route met eigen controle.
      const antwoord = await request(server)
        .get(`/admin/survey/responses/${RESPONSE_A}/answers`)
        .set('Cookie', cookieA)
        .expect(200);

      const alsTekst = JSON.stringify(antwoord.body);

      expect(alsTekst).not.toContain('storage_key');
      expect(alsTekst).not.toContain('storageKey');
    });

    it('geeft de bijlage terug in het antwoord, met de juiste naam en grootte', async () => {
      const body = await haalAntwoorden(cookieA);

      const v1 = body.antwoorden.find((a) => a.questionKey === 'v1') as {
        bijlagen: Array<{
          attachmentId: string;
          originalName: string;
          byteSize: number;
          contentType: string;
        }>;
      };

      expect(v1.bijlagen).toHaveLength(1);
      expect(v1.bijlagen[0].attachmentId).toBe(ATTACHMENT_A);
      expect(v1.bijlagen[0].originalName).toBe('certificaat.pdf');
      expect(v1.bijlagen[0].byteSize).toBe(ATTACHMENT_INHOUD.length);
      expect(v1.bijlagen[0].contentType).toBe('application/pdf');
    });

    it('laat een reviewer de antwoorden lezen', async () => {
      // Voor een reviewer is dit de kernroute: beoordelen kan niet zonder de
      // antwoorden te zien.
      await request(server)
        .get(`/admin/survey/responses/${RESPONSE_A}/answers`)
        .set('Cookie', cookieReviewer)
        .expect(200);
    });

    it('geeft tenant B een 404 op de respons van A', async () => {
      // Niet 403: het verschil tussen "bestaat niet" en "mag je niet zien"
      // hoort niet naar buiten te lekken. RLS maakt de rij onzichtbaar.
      await request(server)
        .get(`/admin/survey/responses/${RESPONSE_A}/answers`)
        .set('Cookie', cookieB)
        .expect(404);
    });

    it('geeft 404 op een niet-bestaande respons', async () => {
      await request(server)
        .get(
          '/admin/survey/responses/00000000-0000-0000-0000-00000000dead/answers',
        )
        .set('Cookie', cookieA)
        .expect(404);
    });
  });

  describe('het downloaden van een bijlage', () => {
    it('geeft de bytes van het bestand terug, met de juiste headers', async () => {
      const res = await request(server)
        .get(`/admin/survey/attachments/${ATTACHMENT_A}`)
        .set('Cookie', cookieA)
        .expect(200);

      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain('certificaat.pdf');
      expect(Buffer.compare(res.body as Buffer, ATTACHMENT_INHOUD)).toBe(0);
    });

    it('laat een reviewer de bijlage ook downloaden', async () => {
      // Zelfde regel als bij de antwoordenroute: beoordelen kan niet zonder
      // het geüploade bewijs te kunnen openen.
      await request(server)
        .get(`/admin/survey/attachments/${ATTACHMENT_A}`)
        .set('Cookie', cookieReviewer)
        .expect(200);
    });

    it('geeft tenant B een 404 op de bijlage van A', async () => {
      // RLS maakt de rij onzichtbaar — zelfde patroon als de andere
      // tenantgrens-tests hierboven.
      await request(server)
        .get(`/admin/survey/attachments/${ATTACHMENT_A}`)
        .set('Cookie', cookieB)
        .expect(404);
    });

    it('geeft 404 op een niet-bestaande bijlage', async () => {
      await request(server)
        .get('/admin/survey/attachments/00000000-0000-0000-0000-00000000dead')
        .set('Cookie', cookieA)
        .expect(404);
    });

    it('geeft geen toegang zonder geldige sessie', async () => {
      await request(server)
        .get(`/admin/survey/attachments/${ATTACHMENT_A}`)
        .expect(401);
    });
  });

  describe('de uitvragen van één leverancier', () => {
    /**
     * ── Waarom deze route bestaat ─────────────────────────────────────────
     *
     * Op 2026-08-09 nodigde de eigenaar een leverancier uit, kreeg de mail,
     * vulde de vragenlijst in en diende hem in — en kon in de app nergens
     * terugvinden dát hij hem had uitgestuurd. De data stond er wel, maar
     * alleen te vinden via Rondes, en dat is de omgekeerde vraag van wat een
     * contractmanager stelt.
     */
    it('toont wat er bij deze leverancier loopt', async () => {
      const antwoord = await request(server)
        .get(`/admin/survey/vendors/${VENDOR_A}/uitvragen`)
        .set('Cookie', cookieA)
        .expect(200);

      const { uitvragen } = antwoord.body as {
        uitvragen: Array<Record<string, unknown>>;
      };

      expect(uitvragen).toHaveLength(1);
      expect(uitvragen[0].responseId).toBe(RESPONSE_A);
      expect(uitvragen[0].runId).toBe(RUN_A);
      expect(uitvragen[0].status).toBe('pending');
      expect(uitvragen[0].ingediendOp).toBeNull();
      expect(uitvragen[0].templateNaam).toBeTruthy();
    });

    it('lekt het token niet', async () => {
      // Het paneel toont de status van een uitvraag, niet de sleutel ernaartoe.
      // Zou de hash meekomen, dan staat sleutelmateriaal in een scherm dat
      // iedereen met een sessie mag openen.
      const antwoord = await request(server)
        .get(`/admin/survey/vendors/${VENDOR_A}/uitvragen`)
        .set('Cookie', cookieA)
        .expect(200);

      const ruw = JSON.stringify(antwoord.body);

      expect(ruw).not.toContain(TOKEN_HASH);
      expect(ruw).not.toContain('token');
    });

    it('laat een reviewer meekijken', async () => {
      // Lezen mag: wie beoordeelt, hoort te zien wat er bij een leverancier
      // loopt. Dezelfde afweging als bij rondes en vragenlijsten.
      await request(server)
        .get(`/admin/survey/vendors/${VENDOR_A}/uitvragen`)
        .set('Cookie', cookieReviewer)
        .expect(200);
    });

    it('geeft een lege lijst voor een leverancier van een andere tenant', async () => {
      // Geen 403 maar niets: dat een vendorId elders bestaat is zelf al
      // informatie. RLS doet het werk, de route hoeft niets te weten.
      const antwoord = await request(server)
        .get(`/admin/survey/vendors/${VENDOR_A}/uitvragen`)
        .set('Cookie', cookieB)
        .expect(200);

      expect((antwoord.body as { uitvragen: unknown[] }).uitvragen).toEqual([]);
    });

    it('geeft een lege lijst voor een onbekende leverancier', async () => {
      const antwoord = await request(server)
        .get(
          '/admin/survey/vendors/00000000-0000-0000-0000-00000000dead/uitvragen',
        )
        .set('Cookie', cookieA)
        .expect(200);

      expect((antwoord.body as { uitvragen: unknown[] }).uitvragen).toEqual([]);
    });

    it('weigert zonder sessie', async () => {
      await request(server)
        .get(`/admin/survey/vendors/${VENDOR_A}/uitvragen`)
        .expect(401);
    });
  });

  describe('onbekende id’s', () => {
    it('geeft 404 op een niet-bestaande vragenlijst', async () => {
      await request(server)
        .get('/admin/survey/templates/00000000-0000-0000-0000-00000000dead')
        .set('Cookie', cookieA)
        .expect(404);
    });

    it('geeft 404 op een niet-bestaande ronde', async () => {
      await request(server)
        .get('/admin/survey/runs/00000000-0000-0000-0000-00000000dead')
        .set('Cookie', cookieA)
        .expect(404);
    });
  });
});
