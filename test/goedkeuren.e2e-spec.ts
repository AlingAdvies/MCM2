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
 * Goedkeuren als vierde oordeel (migratie 0017).
 *
 * Zie docs/superpowers/plans/2026-08-07-statuswaarheid-per-vendor.md §3.2 en §7.
 *
 * "Kan ik een goedkeuring opslaan" is de makkelijke helft. Vier dingen kunnen
 * hier stuk zonder dat iemand het merkt:
 *
 *   1. Legt de goedkeuring vast op naam van iemand ánders dan de ingelogde
 *      gebruiker? Dat is de voorwaarde die de eigenaar aan V1 verbond:
 *      iedereen mag goedkeuren, MITS de identiteit van de keurder vastligt.
 *   2. Eist goedkeuren een toelichting? Dat hoort niet — bij een goedkeuring is
 *      de handtekening de inhoud. Maar de eis bij niet_goed moet blijven staan.
 *   3. Wist intrekken de rij, in plaats van deleted_at te zetten? Dan is de
 *      historie weg die deze tabel juist bewaart.
 *   4. Kan tenant B goedkeuren of intrekken bij tenant A?
 */

const {
  tenantA,
  tenantB,
  adminA: ADMIN_A,
  collegaA: COLLEGA_A,
  templateA: TEMPLATE_A,
  runA: RUN_A,
  vendorA: VENDOR_A,
  responseIngediend: RESPONSE_INGEDIEND,
  adminB,
  reviewBestaatNiet: REVIEW_BESTAAT_NIET,
} = TEST_IDS.goedkeuren;

const SUBJECT_ADMIN = `oid-gk-a-${Date.now()}`;
const SUBJECT_COLLEGA = `oid-gk-c-${Date.now()}`;
const SUBJECT_B = `oid-gk-b-${Date.now()}`;

/** 64 hex-tekens, conform de CHECK op token_hash (migratie 0003). */
const HASH_INGEDIEND = `${'3'.repeat(48)}cccccccccccccccc`;

interface BeoordelingBody {
  beoordeling: {
    reviewId: string;
    verdict: string;
    toelichting: string;
    reviewerUserId: string;
    reviewerNaam: string | null;
    createdAt: string;
  };
}

interface LijstBody {
  beoordelingen: Array<{
    reviewId: string;
    verdict: string;
    toelichting: string;
    reviewerNaam: string | null;
  }>;
}

async function verwijderTestdata(client: Client) {
  for (const tenant of [tenantA, tenantB]) {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    // Actor 'medewerker' is nodig: zonder dat weigert de policy op
    // survey_review élke rij, ook bij het opruimen.
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);
    for (const tabel of [
      'clm.survey_review',
      'clm.survey_answer',
      'clm.survey_response',
      'clm.survey_run',
      'clm.survey_question',
      'clm.survey_template',
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

describe('Goedkeuren van een respons (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let cookieAdminA: string;
  let cookieB: string;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(client);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);

    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenantA, 'Tenant A (goedkeuren)'],
    );
    for (const [userId, subject, naam, rol] of [
      [ADMIN_A, SUBJECT_ADMIN, 'Admin van A', 'admin'],
      [COLLEGA_A, SUBJECT_COLLEGA, 'Collega van A', 'reviewer'],
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
       VALUES ($1, $2, 'goedkeur-test-lijst', 1)`,
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
      [RESPONSE_INGEDIEND, tenantA, RUN_A, VENDOR_A, HASH_INGEDIEND],
    );
    await client.query('COMMIT');

    // Tenant B, zodat de tenantgrens iets te verbergen heeft.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantB}'`);
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenantB, 'Tenant B (goedkeuren)'],
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
      [SUBJECT_ADMIN, 'a'],
      [SUBJECT_B, 'b'],
    ] as const) {
      const sessie = await sessies.aanmaken(subject);
      expect(sessie).not.toBeNull();

      const cookie = `${naam}=${sessie!.token}`;
      if (doel === 'a') cookieAdminA = cookie;
      else cookieB = cookie;
    }
  }, 30000);

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(client);
    await client.end();
  }, 30000);

  /** Legt een goedkeuring vast en geeft het review-id terug. */
  async function keurGoed(cookie: string): Promise<string> {
    const antwoord = await request(server)
      .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
      .set('Cookie', cookie)
      .send({ verdict: 'goedgekeurd', toelichting: 'Akkoord namens IT.' })
      .expect(201);

    return (antwoord.body as BeoordelingBody).beoordeling.reviewId;
  }

  describe('een goedkeuring vastleggen', () => {
    it('legt een goedkeuring vast op een ingediende respons', async () => {
      const antwoord = await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
        .set('Cookie', cookieAdminA)
        .send({ verdict: 'goedgekeurd', toelichting: 'Akkoord namens IT.' })
        .expect(201);

      const body = antwoord.body as BeoordelingBody;

      expect(body.beoordeling.verdict).toBe('goedgekeurd');
      expect(body.beoordeling.reviewerUserId).toBe(ADMIN_A);
      expect(body.beoordeling.reviewerNaam).toBe('Admin van A');
    });

    it('staat goedkeuren zonder toelichting toe', async () => {
      // Bij een goedkeuring is de handtekening de inhoud — wie en wanneer, en
      // dat legt de tabel zelf vast. De onderbouwingseis bestaat omdat
      // "niet goed" zonder reden later niet te herleiden is.
      await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
        .set('Cookie', cookieAdminA)
        .send({ verdict: 'goedgekeurd' })
        .expect(201);
    });

    it('blijft een toelichting eisen bij niet_goed', async () => {
      // De keerzijde van de test hierboven: het versoepelen voor goedgekeurd
      // mag de eis bij de inhoudelijke afwijzingen niet stilletjes opheffen.
      const antwoord = await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
        .set('Cookie', cookieAdminA)
        .send({ verdict: 'niet_goed' })
        .expect(400);

      expect((antwoord.body as { message: string }).message).toContain(
        'Licht toe',
      );
    });

    it('blijft een toelichting eisen bij nadere_vragen', async () => {
      await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
        .set('Cookie', cookieAdminA)
        .send({ verdict: 'nadere_vragen' })
        .expect(400);
    });
  });

  describe('de identiteit van de keurder (V1)', () => {
    // "Iedereen mag goedkeuren, mits de identiteit van de keurder vastligt"
    // (eigenaar 2026-08-07). Zonder deze test is die voorwaarde een belofte.
    it('negeert een reviewerUserId uit de body en gebruikt de sessie', async () => {
      const antwoord = await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
        .set('Cookie', cookieAdminA)
        .send({
          verdict: 'goedgekeurd',
          toelichting: 'Akkoord.',
          // Een poging om de goedkeuring op naam van een collega te zetten.
          reviewerUserId: COLLEGA_A,
        })
        .expect(201);

      const body = antwoord.body as BeoordelingBody;

      expect(body.beoordeling.reviewerUserId).toBe(ADMIN_A);
      expect(body.beoordeling.reviewerUserId).not.toBe(COLLEGA_A);
      expect(body.beoordeling.reviewerNaam).toBe('Admin van A');
    });
  });

  describe('een oordeel intrekken (V2)', () => {
    it('trekt een oordeel in en laat het uit de lijst verdwijnen', async () => {
      const reviewId = await keurGoed(cookieAdminA);

      await request(server)
        .delete(
          `/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews/${reviewId}`,
        )
        .set('Cookie', cookieAdminA)
        .expect(204);

      const lijst = await request(server)
        .get(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
        .set('Cookie', cookieAdminA)
        .expect(200);

      const ids = (lijst.body as LijstBody).beoordelingen.map(
        (b) => b.reviewId,
      );
      expect(ids).not.toContain(reviewId);
    });

    it('bewaart een ingetrokken oordeel in de database', async () => {
      // De belangrijkste test van dit blok: intrekken zet deleted_at en
      // verwijdert niets. Wissen zou de historie kapotmaken die deze tabel
      // juist bewaart — en een goedkeuring die spoorloos kan verdampen maakt
      // de status onbetrouwbaar.
      const reviewId = await keurGoed(cookieAdminA);

      await request(server)
        .delete(
          `/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews/${reviewId}`,
        )
        .set('Cookie', cookieAdminA)
        .expect(204);

      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
      await client.query(`SET LOCAL app.current_actor = 'medewerker'`);
      const rij = await client.query<{ deleted_at: Date | null }>(
        'SELECT deleted_at FROM clm.survey_review WHERE review_id = $1',
        [reviewId],
      );
      await client.query('COMMIT');

      expect(rij.rows).toHaveLength(1);
      expect(rij.rows[0].deleted_at).not.toBeNull();
    });

    it('geeft 404 bij een tweede poging tot intrekken', async () => {
      const reviewId = await keurGoed(cookieAdminA);
      const pad = `/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews/${reviewId}`;

      await request(server).delete(pad).set('Cookie', cookieAdminA).expect(204);
      await request(server).delete(pad).set('Cookie', cookieAdminA).expect(404);
    });

    it('geeft 404 bij het intrekken van een onbekend oordeel', async () => {
      await request(server)
        .delete(
          `/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews/${REVIEW_BESTAAT_NIET}`,
        )
        .set('Cookie', cookieAdminA)
        .expect(404);
    });
  });

  describe('de tenantgrens', () => {
    // 404 en niet 403: het verschil tussen "bestaat niet" en "mag je niet
    // zien" hoort niet naar buiten te lekken.
    it('laat tenant B niet goedkeuren op een respons van tenant A', async () => {
      await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
        .set('Cookie', cookieB)
        .send({ verdict: 'goedgekeurd', toelichting: 'Akkoord.' })
        .expect(404);
    });

    it('laat tenant B geen oordeel van tenant A intrekken', async () => {
      const reviewId = await keurGoed(cookieAdminA);

      await request(server)
        .delete(
          `/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews/${reviewId}`,
        )
        .set('Cookie', cookieB)
        .expect(404);

      // En het oordeel staat er nog: een mislukte poging mag niets wijzigen.
      const lijst = await request(server)
        .get(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
        .set('Cookie', cookieAdminA)
        .expect(200);

      const ids = (lijst.body as LijstBody).beoordelingen.map(
        (b) => b.reviewId,
      );
      expect(ids).toContain(reviewId);
    });
  });
});
