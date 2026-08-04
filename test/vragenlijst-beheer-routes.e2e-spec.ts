import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
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

const { tenantA, tenantB, userA, userB, reviewerA } =
  TEST_IDS['vragenlijst-beheer-routes'];

const SUBJECT_A = `oid-vlb-a-${Date.now()}`;
const SUBJECT_B = `oid-vlb-b-${Date.now()}`;
const SUBJECT_REVIEWER = `oid-vlb-r-${Date.now()}`;

const TEMPLATE_A = '00000000-0000-0000-0000-0000000008f1';
const TEMPLATE_B = '00000000-0000-0000-0000-0000000008f2';
const RUN_A = '00000000-0000-0000-0000-0000000008f3';
const VENDOR_A = '00000000-0000-0000-0000-0000000008f4';
const RESPONSE_A = '00000000-0000-0000-0000-0000000008f5';

/**
 * 64 hex-tekens, conform de CHECK-constraint op `token_hash` (migratie 0003).
 * De herkenbare staart maakt hem terugzoekbaar in een antwoord — precies wat
 * de test "geeft de token_hash NOOIT terug" nodig heeft.
 */
const TOKEN_HASH = `${'0'.repeat(48)}deadbeefcafe1234`;

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
  const cookieNaam = cookieInstellingen().naam;

  beforeAll(async () => {
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
