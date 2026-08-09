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
import { verwijderTestdata } from './opruimen';

/**
 * Beoordelaars koppelen aan een vragenlijst (fase C3, ADR-013).
 *
 * Deze suite bouwt de vier tegenproeven uit ADR-013 §Tegenproeven, en de
 * derde en vierde horen als **paar** gelezen te worden:
 *
 *   3. Een reviewer die NIET gekoppeld is, kan wél beoordelen.
 *      Slaagt dit niet, dan is er per ongeluk een harde grens gebouwd en ligt
 *      het proces stil zodra de gekoppelde beoordelaar ziek is.
 *
 *   4. Diezelfde reviewer ziet die inzending NIET in zijn werkvoorraad.
 *      De keerzijde: zonder deze test kan de koppeling decoratie zijn zonder
 *      dat iets dat merkt.
 *
 * Alleen samen tonen ze dat de koppeling doet wat ADR-013 besluit 3 zegt:
 * bepalen wat je ziet, niet wat je mag.
 */

const {
  tenantA,
  tenantB,
  adminA,
  reviewerGekoppeld,
  reviewerLos,
  adminB,
  templateA: TEMPLATE_A,
  templateB: TEMPLATE_B,
  runA: RUN_A,
  vendorA: VENDOR_A,
  responseIngediend: RESPONSE_INGEDIEND,
  bestaatNiet: BESTAAT_NIET,
} = TEST_IDS['beoordelaar-koppelen'];

const SUBJECT_ADMIN = `oid-bk-a-${Date.now()}`;
const SUBJECT_GEKOPPELD = `oid-bk-g-${Date.now()}`;
const SUBJECT_LOS = `oid-bk-l-${Date.now()}`;
const SUBJECT_B = `oid-bk-b-${Date.now()}`;

const TOKEN_HASH = `${'3'.repeat(48)}cccccccccccccccc`;

interface BeoordelaarsBody {
  beoordelaars: Array<{ userId: string; naam: string; email: string }>;
}

interface WerkvoorraadBody {
  werkvoorraad: Array<{
    responseId: string;
    templateNaam: string;
    vendorNaam: string | null;
    laatsteOordeel: string | null;
    aantalOordelen: number;
  }>;
}

describe('Beoordelaar koppelen aan een vragenlijst (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let cookieAdmin: string;
  let cookieGekoppeld: string;
  let cookieLos: string;
  let cookieB: string;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(tenantA, tenantB);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);

    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenantA, 'Tenant A (koppelen)'],
    );
    for (const [userId, subject, naam, rol] of [
      [adminA, SUBJECT_ADMIN, 'Admin van A', 'admin'],
      [reviewerGekoppeld, SUBJECT_GEKOPPELD, 'CISO (gekoppeld)', 'reviewer'],
      [reviewerLos, SUBJECT_LOS, 'Collega (niet gekoppeld)', 'reviewer'],
    ] as const) {
      await client.query(
        `INSERT INTO clm."user" (user_id, tenant_id, email, full_name, external_subject)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, tenantA, `${subject}@voorbeeld.nl`, naam, subject],
      );
      await client.query(
        `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
         VALUES ($1, $2, $3)`,
        [userId, tenantA, rol],
      );
    }

    await client.query(
      `INSERT INTO clm.survey_template (template_id, tenant_id, name, version)
       VALUES ($1, $2, 'IT-compliance', 1)`,
      [TEMPLATE_A, tenantA],
    );
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
    await client.query(
      `INSERT INTO clm.survey_response
         (response_id, tenant_id, run_id, vendor_id, subject_vendor_id,
          token_hash, status, expires_at, submitted_at)
       VALUES ($1, $2, $3, $4, $4, $5, 'submitted',
               now() + interval '30 days', now())`,
      [RESPONSE_INGEDIEND, tenantA, RUN_A, VENDOR_A, TOKEN_HASH],
    );
    await client.query('COMMIT');

    // Tenant B met een eigen vragenlijst, zodat de tenantgrens iets te
    // verbergen heeft.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantB}'`);
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenantB, 'Tenant B (koppelen)'],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, email, full_name, external_subject)
       VALUES ($1, $2, $3, 'Admin van B', $4)`,
      [adminB, tenantB, `${SUBJECT_B}@voorbeeld.nl`, SUBJECT_B],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [adminB, tenantB],
    );
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

    const sessies = app.get(SessieService);
    const naam = cookieInstellingen().naam;
    for (const [subject, doel] of [
      [SUBJECT_ADMIN, 'admin'],
      [SUBJECT_GEKOPPELD, 'gekoppeld'],
      [SUBJECT_LOS, 'los'],
      [SUBJECT_B, 'b'],
    ] as const) {
      const sessie = await sessies.aanmaken(subject);
      expect(sessie).not.toBeNull();
      const cookie = `${naam}=${sessie!.token}`;
      if (doel === 'admin') cookieAdmin = cookie;
      else if (doel === 'gekoppeld') cookieGekoppeld = cookie;
      else if (doel === 'los') cookieLos = cookie;
      else cookieB = cookie;
    }

    // De koppeling die het hele verhaal draagt: alleen de CISO is gekoppeld.
    await request(server)
      .post(`/admin/survey/templates/${TEMPLATE_A}/reviewers`)
      .set('Cookie', cookieAdmin)
      .send({ userId: reviewerGekoppeld })
      .expect(204);
  }, 30000);

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(tenantA, tenantB);
    await client.end();
  }, 30000);

  describe('koppelen en ontkoppelen', () => {
    it('toont de gekoppelde beoordelaar met naam', async () => {
      const antwoord = await request(server)
        .get(`/admin/survey/templates/${TEMPLATE_A}/reviewers`)
        .set('Cookie', cookieAdmin)
        .expect(200);

      const body = antwoord.body as BeoordelaarsBody;

      expect(body.beoordelaars).toHaveLength(1);
      expect(body.beoordelaars[0].userId).toBe(reviewerGekoppeld);
      expect(body.beoordelaars[0].naam).toBe('CISO (gekoppeld)');
    });

    it('is idempotent: twee keer koppelen geeft geen fout', async () => {
      await request(server)
        .post(`/admin/survey/templates/${TEMPLATE_A}/reviewers`)
        .set('Cookie', cookieAdmin)
        .send({ userId: reviewerGekoppeld })
        .expect(204);

      const antwoord = await request(server)
        .get(`/admin/survey/templates/${TEMPLATE_A}/reviewers`)
        .set('Cookie', cookieAdmin)
        .expect(200);

      expect((antwoord.body as BeoordelaarsBody).beoordelaars).toHaveLength(1);
    });

    it('staat meerdere beoordelaars per vragenlijst toe', async () => {
      // ADR-013: bij Transdev is het er waarschijnlijk één, maar die ene gaat
      // met vakantie.
      await request(server)
        .post(`/admin/survey/templates/${TEMPLATE_A}/reviewers`)
        .set('Cookie', cookieAdmin)
        .send({ userId: adminA })
        .expect(204);

      const antwoord = await request(server)
        .get(`/admin/survey/templates/${TEMPLATE_A}/reviewers`)
        .set('Cookie', cookieAdmin)
        .expect(200);

      expect((antwoord.body as BeoordelaarsBody).beoordelaars).toHaveLength(2);

      // Weer weghalen, anders verstoort het de werkvoorraadtests hieronder.
      await request(server)
        .delete(`/admin/survey/templates/${TEMPLATE_A}/reviewers/${adminA}`)
        .set('Cookie', cookieAdmin)
        .expect(204);
    });

    it('geeft 204 bij ontkoppelen van iemand die niet gekoppeld was', async () => {
      await request(server)
        .delete(
          `/admin/survey/templates/${TEMPLATE_A}/reviewers/${reviewerLos}`,
        )
        .set('Cookie', cookieAdmin)
        .expect(204);
    });

    it('weigert een gebruiker die niet bestaat', async () => {
      await request(server)
        .post(`/admin/survey/templates/${TEMPLATE_A}/reviewers`)
        .set('Cookie', cookieAdmin)
        .send({ userId: BESTAAT_NIET })
        .expect(404);
    });

    it('weigert een ongeldig user-id met een 400', async () => {
      await request(server)
        .post(`/admin/survey/templates/${TEMPLATE_A}/reviewers`)
        .set('Cookie', cookieAdmin)
        .send({ userId: 'geen-uuid' })
        .expect(400);
    });

    // Koppelen is beheer, beoordelen is de rol van een reviewer. Zonder deze
    // grens kan een reviewer zichzelf aan elke lijst hangen.
    it('laat een REVIEWER niet koppelen — dat is beheer', async () => {
      await request(server)
        .post(`/admin/survey/templates/${TEMPLATE_A}/reviewers`)
        .set('Cookie', cookieGekoppeld)
        .send({ userId: reviewerLos })
        .expect(403);
    });

    it('laat een REVIEWER niet ontkoppelen', async () => {
      await request(server)
        .delete(
          `/admin/survey/templates/${TEMPLATE_A}/reviewers/${reviewerGekoppeld}`,
        )
        .set('Cookie', cookieGekoppeld)
        .expect(403);
    });
  });

  // ── Tegenproef 1 uit ADR-013 ────────────────────────────────────────────────
  describe('de tenantgrens', () => {
    it('geeft tenant B een 404 op de vragenlijst van A', async () => {
      await request(server)
        .get(`/admin/survey/templates/${TEMPLATE_A}/reviewers`)
        .set('Cookie', cookieB)
        .expect(404);
    });

    it('laat tenant B geen beoordelaar koppelen aan een lijst van A', async () => {
      await request(server)
        .post(`/admin/survey/templates/${TEMPLATE_A}/reviewers`)
        .set('Cookie', cookieB)
        .send({ userId: adminB })
        .expect(404);
    });

    it('toont B geen enkele koppeling van A', async () => {
      const antwoord = await request(server)
        .get(`/admin/survey/templates/${TEMPLATE_B}/reviewers`)
        .set('Cookie', cookieB)
        .expect(200);

      expect((antwoord.body as BeoordelaarsBody).beoordelaars).toHaveLength(0);
    });
  });

  // ── Tegenproef 2 uit ADR-013 ────────────────────────────────────────────────
  describe('een leverancier komt er niet bij', () => {
    it('kan geen enkele koppeling lezen', async () => {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
      await client.query(`SET LOCAL app.current_actor = 'leverancier'`);

      const { rows } = await client.query(
        'SELECT * FROM clm.template_reviewer WHERE template_id = $1',
        [TEMPLATE_A],
      );

      await client.query('COMMIT');

      expect(rows).toHaveLength(0);
    });

    it('een medewerker ziet ze wél — de test hierboven meet geen lege tabel', async () => {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
      await client.query(`SET LOCAL app.current_actor = 'medewerker'`);

      const { rows } = await client.query(
        'SELECT * FROM clm.template_reviewer WHERE template_id = $1',
        [TEMPLATE_A],
      );

      await client.query('COMMIT');

      expect(rows.length).toBeGreaterThan(0);
    });
  });

  /**
   * ── Tegenproef 3 en 4 uit ADR-013 — het paar ────────────────────────────────
   *
   * Dit is het belangrijkste besluit uit ADR-013 (besluit 3): de koppeling
   * bepaalt wat je ziet, niet wat je mag.
   */
  describe('de koppeling is een hulpmiddel, geen grens', () => {
    // Tegenproef 3. Slaagt dit niet, dan is er per ongeluk een harde grens
    // gebouwd en ligt het proces stil zodra de CISO ziek is.
    it('laat een NIET-gekoppelde reviewer wél beoordelen', async () => {
      await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
        .set('Cookie', cookieLos)
        .send({
          verdict: 'goed',
          toelichting: 'Ingevallen voor de CISO.',
        })
        .expect(201);
    });

    // Tegenproef 4. De keerzijde: zonder deze test kan de koppeling decoratie
    // zijn zonder dat iets dat merkt.
    it('toont die inzending NIET in de werkvoorraad van de niet-gekoppelde reviewer', async () => {
      const antwoord = await request(server)
        .get('/admin/survey/mijn-beoordelingen')
        .set('Cookie', cookieLos)
        .expect(200);

      expect((antwoord.body as WerkvoorraadBody).werkvoorraad).toHaveLength(0);
    });

    it('toont hem WEL in de werkvoorraad van de gekoppelde reviewer', async () => {
      const antwoord = await request(server)
        .get('/admin/survey/mijn-beoordelingen')
        .set('Cookie', cookieGekoppeld)
        .expect(200);

      const body = antwoord.body as WerkvoorraadBody;

      expect(body.werkvoorraad).toHaveLength(1);
      expect(body.werkvoorraad[0].responseId).toBe(RESPONSE_INGEDIEND);
      expect(body.werkvoorraad[0].templateNaam).toBe('IT-compliance');
      expect(body.werkvoorraad[0].vendorNaam).toBe('Leverancier van A');
    });

    it('toont het laatste oordeel bij de inzending in de werkvoorraad', async () => {
      // ADR-013: anders moet je zeventien schermen openen om te zien wie er nog
      // openstaat, en dan wordt de lijst niet gebruikt.
      const antwoord = await request(server)
        .get('/admin/survey/mijn-beoordelingen')
        .set('Cookie', cookieGekoppeld)
        .expect(200);

      const body = antwoord.body as WerkvoorraadBody;

      expect(body.werkvoorraad[0].laatsteOordeel).toBe('goed');
      expect(body.werkvoorraad[0].aantalOordelen).toBeGreaterThan(0);
    });
  });
});
