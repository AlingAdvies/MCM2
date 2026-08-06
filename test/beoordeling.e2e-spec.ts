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
 * Beoordelen van een ingediende respons (fase C2 van het surveybeheerplan).
 *
 * De makkelijke helft — "kan ik een oordeel opslaan" — is niet waar deze suite
 * om draait. Vier dingen kunnen hier stuk zonder dat iemand het merkt:
 *
 *   1. Kan een LEVERANCIER het oordeel over zichzelf lezen? Dat mag nooit, en
 *      het is de eerste tabel waar de tenantgrens daarvoor niet volstaat.
 *   2. Kan tenant B een oordeel van A zien of eraan toevoegen?
 *   3. Wordt een tweede oordeel toegevoegd of overschrijft het het eerste?
 *   4. Kan er beoordeeld worden op iets dat nog niet is ingediend?
 *
 * De derde is de reden dat een reviewer dit mag zonder admin te zijn (plan
 * §2a). Zou een oordeel het vorige overschrijven, dan hoorde daar admin te
 * staan — dan kan iemand namelijk stilletjes de geschiedenis herschrijven.
 */

const {
  tenantA,
  tenantB,
  adminA,
  reviewerA,
  templateA: TEMPLATE_A,
  runA: RUN_A,
  vendorA: VENDOR_A,
  responseIngediend: RESPONSE_INGEDIEND,
  responseOpen: RESPONSE_OPEN,
  adminB,
  vendorOpen: VENDOR_OPEN,
} = TEST_IDS.beoordeling;

const SUBJECT_ADMIN = `oid-bo-a-${Date.now()}`;
const SUBJECT_REVIEWER = `oid-bo-r-${Date.now()}`;
const SUBJECT_B = `oid-bo-b-${Date.now()}`;

/** 64 hex-tekens, conform de CHECK op token_hash (migratie 0003). */
const HASH_INGEDIEND = `${'1'.repeat(48)}aaaaaaaaaaaaaaaa`;
const HASH_OPEN = `${'2'.repeat(48)}bbbbbbbbbbbbbbbb`;

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
    // De actor moet 'medewerker' zijn: zonder dat weigert de policy op
    // survey_review élke rij, ook bij het opruimen. Dat is precies wat de
    // policy hoort te doen.
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

describe('Beoordelen van een respons (e2e)', () => {
  // Met de generic erbij: zonder <App> geeft getHttpServer() `any` terug en
  // slaat no-unsafe-assignment aan.
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let cookieAdmin: string;
  let cookieReviewer: string;
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
      [tenantA, 'Tenant A (beoordeling)'],
    );
    for (const [userId, subject, naam, rol] of [
      [adminA, SUBJECT_ADMIN, 'Admin van A', 'admin'],
      [reviewerA, SUBJECT_REVIEWER, 'Reviewer van A', 'reviewer'],
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
       VALUES ($1, $2, 'beoordeel-test-lijst', 1)`,
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
    // Tweede leverancier: survey_response_run_vendor_key staat maar één
    // respons per vendor per ronde toe.
    await client.query(
      `INSERT INTO clm.vendor (vendor_id, tenant_id, name)
       VALUES ($1, $2, 'Leverancier die nog moet')`,
      [VENDOR_OPEN, tenantA],
    );

    // Eén ingediende respons en één die nog openstaat. Dat onderscheid is het
    // hele punt van de controle "beoordelen mag pas na indienen".
    await client.query(
      `INSERT INTO clm.survey_response
         (response_id, tenant_id, run_id, vendor_id, subject_vendor_id,
          token_hash, status, expires_at, submitted_at)
       VALUES ($1, $2, $3, $4, $4, $5, 'submitted',
               now() + interval '30 days', now())`,
      [RESPONSE_INGEDIEND, tenantA, RUN_A, VENDOR_A, HASH_INGEDIEND],
    );
    await client.query(
      `INSERT INTO clm.survey_response
         (response_id, tenant_id, run_id, vendor_id, subject_vendor_id,
          token_hash, status, expires_at)
       VALUES ($1, $2, $3, $4, $4, $5, 'pending', now() + interval '30 days')`,
      [RESPONSE_OPEN, tenantA, RUN_A, VENDOR_OPEN, HASH_OPEN],
    );
    await client.query('COMMIT');

    // Tenant B, zodat de tenantgrens iets te verbergen heeft.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantB}'`);
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenantB, 'Tenant B (beoordeling)'],
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
      [SUBJECT_ADMIN, 'admin'],
      [SUBJECT_REVIEWER, 'reviewer'],
      [SUBJECT_B, 'b'],
    ] as const) {
      const sessie = await sessies.aanmaken(subject);

      // Null betekent dat de gebruiker of het membership niet gevonden is;
      // dan klopt de opzet hierboven niet en zijn alle tests hieronder
      // betekenisloos. Hier stoppen is duidelijker dan een cookie 'undefined'.
      expect(sessie).not.toBeNull();

      const cookie = `${naam}=${sessie!.token}`;
      if (doel === 'admin') cookieAdmin = cookie;
      else if (doel === 'reviewer') cookieReviewer = cookie;
      else cookieB = cookie;
    }
  }, 30000);

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(client);
    await client.end();
  }, 30000);

  describe('een oordeel vastleggen', () => {
    it('legt een oordeel vast met de naam van de beoordelaar', async () => {
      const antwoord = await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
        .set('Cookie', cookieAdmin)
        .send({ verdict: 'goed', toelichting: 'Ziet er compleet uit.' })
        .expect(201);

      const body = antwoord.body as BeoordelingBody;

      expect(body.beoordeling.verdict).toBe('goed');
      expect(body.beoordeling.toelichting).toBe('Ziet er compleet uit.');
      // De reviewer komt uit de sessie, niet uit de body.
      expect(body.beoordeling.reviewerUserId).toBe(adminA);
      expect(body.beoordeling.reviewerNaam).toBe('Admin van A');
    });

    it('laat een REVIEWER ook beoordelen — dat is zijn rol', async () => {
      // Besluit eigenaar 2026-08-03. Hem dit ontzeggen maakt de rol
      // betekenisloos en de admin een flessenhals.
      await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
        .set('Cookie', cookieReviewer)
        .send({
          verdict: 'nadere_vragen',
          toelichting: 'Vraag 3 is onduidelijk.',
        })
        .expect(201);
    });

    // Dit is waarom een reviewer geen admin hoeft te zijn: hij kan niets
    // stilletjes veranderen, alleen iets toevoegen dat van hem is.
    it('voegt een tweede oordeel TOE in plaats van het eerste te overschrijven', async () => {
      const antwoord = await request(server)
        .get(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
        .set('Cookie', cookieAdmin)
        .expect(200);

      const body = antwoord.body as LijstBody;

      expect(body.beoordelingen).toHaveLength(2);
      // Nieuwste eerst.
      expect(body.beoordelingen[0].verdict).toBe('nadere_vragen');
      expect(body.beoordelingen[1].verdict).toBe('goed');
      expect(body.beoordelingen[0].reviewerNaam).toBe('Reviewer van A');
    });

    it('weigert een oordeel op een respons die nog niet is ingediend', async () => {
      const antwoord = await request(server)
        .post(`/admin/survey/responses/${RESPONSE_OPEN}/reviews`)
        .set('Cookie', cookieAdmin)
        .send({ verdict: 'goed', toelichting: '' })
        .expect(400);

      // De melding moet uitleggen waarom, niet alleen dat het niet mag —
      // daarom een servicecontrole en geen CHECK-constraint.
      expect(JSON.stringify(antwoord.body)).toContain('nog niet ingediend');
    });

    it('weigert een onbekend oordeel', async () => {
      await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
        .set('Cookie', cookieAdmin)
        .send({ verdict: 'twijfelachtig', toelichting: 'iets' })
        .expect(400);
    });

    it('eist een toelichting bij niet_goed', async () => {
      const antwoord = await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
        .set('Cookie', cookieAdmin)
        .send({ verdict: 'niet_goed', toelichting: '   ' })
        .expect(400);

      expect(JSON.stringify(antwoord.body)).toContain('toelichting');
    });

    it('staat een lege toelichting toe bij goed', async () => {
      await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
        .set('Cookie', cookieAdmin)
        .send({ verdict: 'goed' })
        .expect(201);
    });

    it('geeft 404 op een respons die niet bestaat', async () => {
      await request(server)
        .post(
          '/admin/survey/responses/00000000-0000-0000-0000-00000000dead/reviews',
        )
        .set('Cookie', cookieAdmin)
        .send({ verdict: 'goed', toelichting: '' })
        .expect(404);
    });
  });

  describe('de tenantgrens', () => {
    it('geeft tenant B een 404 op de respons van A', async () => {
      await request(server)
        .get(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
        .set('Cookie', cookieB)
        .expect(404);
    });

    it('laat tenant B geen oordeel toevoegen aan een respons van A', async () => {
      await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/reviews`)
        .set('Cookie', cookieB)
        .send({ verdict: 'goed', toelichting: '' })
        .expect(404);
    });
  });

  /**
   * De kern van migratie 0015, en de reden dat app.current_actor bestaat.
   *
   * Een leverancier zit in dezelfde tenant als de medewerker die hem
   * beoordeelt. Elke andere tabel in dit project zegt "zelfde tenant = mag het
   * zien". Hier niet — en dat verschil kon de database vóór migratie 0013 niet
   * eens uitdrukken.
   *
   * Deze tests praten rechtstreeks met de database in plaats van via een route,
   * want er ís geen route waarlangs een leverancier dit zou proberen. Dat is
   * precies waarom de grens in de database moet liggen en niet in een guard:
   * een toekomstige route die de actor vergeet, stuit hier alsnog op.
   */
  describe('een leverancier komt er niet bij', () => {
    it('ziet geen enkel oordeel, ook niet over zichzelf', async () => {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
      await client.query(`SET LOCAL app.current_actor = 'leverancier'`);

      const { rows } = await client.query(
        'SELECT * FROM clm.survey_review WHERE response_id = $1',
        [RESPONSE_INGEDIEND],
      );

      await client.query('COMMIT');

      expect(rows).toHaveLength(0);
    });

    it('kan zelf geen oordeel wegschrijven', async () => {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
      await client.query(`SET LOCAL app.current_actor = 'leverancier'`);

      // De actor-eis staat ook in WITH CHECK. Zonder dat zou een
      // leverancierspad kunnen schrijven wat het niet kan lezen — een lek dat
      // pas opvalt als de rij er al staat.
      await expect(
        client.query(
          `INSERT INTO clm.survey_review
             (tenant_id, response_id, verdict, toelichting, reviewer_user_id)
           VALUES ($1, $2, 'goed', 'stiekem', $3)`,
          [tenantA, RESPONSE_INGEDIEND, adminA],
        ),
      ).rejects.toThrow(/row-level security/i);

      await client.query('ROLLBACK');
    });

    it('een medewerker ziet ze wél — de tests hierboven meten geen lege tabel', async () => {
      // Zonder deze test zouden de twee hierboven ook slagen als de tabel
      // gewoon leeg was, en dan bewijzen ze niets.
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
      await client.query(`SET LOCAL app.current_actor = 'medewerker'`);

      const { rows } = await client.query(
        'SELECT * FROM clm.survey_review WHERE response_id = $1',
        [RESPONSE_INGEDIEND],
      );

      await client.query('COMMIT');

      expect(rows.length).toBeGreaterThan(0);
    });
  });
});
