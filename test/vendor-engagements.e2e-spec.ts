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
 * Vendor-dossiers (engagements) — migratie 0040/0041/0042.
 *
 * Wat hier kan stuk gaan zonder dat het opvalt:
 *   1. Kan tenant B een engagement van tenant A zien/aanmaken/koppelen?
 *   2. Wordt de auteur uit de sessie genomen, nooit uit de body?
 *   3. Werkt intrekken via deleted_at (rij blijft bestaan)?
 *   4. Kan een engagement zonder links aangemaakt worden (los verzoek)?
 *   5. Weigert een link naar een niet-bestaand contract/response?
 */

const {
  tenantA,
  tenantB,
  adminA: ADMIN_A,
  adminB: ADMIN_B,
  vendorA: VENDOR_A,
  templateA: TEMPLATE_A,
  runA: RUN_A,
  responseA: RESPONSE_A,
  contractA: CONTRACT_A,
  engagementBestaatNiet: ENGAGEMENT_BESTAAT_NIET,
} = TEST_IDS.vendorEngagements;

const SUBJECT_ADMIN = `oid-ve-a-${Date.now()}`;
const SUBJECT_B = `oid-ve-b-${Date.now()}`;
const TOKEN_HASH = `${'7'.repeat(48)}eeeeeeeeeeeeeeee`;

interface EngagementBody {
  engagement: {
    engagementId: string;
    vendorId: string;
    titel: string;
    createdByUserId: string;
    createdByNaam: string | null;
    createdAt: string;
    links: Array<{ linkId: string; linkType: string; linkedId: string }>;
    attachments: unknown[];
  };
}

interface LijstBody {
  engagements: EngagementBody['engagement'][];
}

describe('Vendor-dossiers (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let cookieAdminA: string;
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
      [tenantA, 'Tenant A (engagements)'],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, email, full_name, external_subject)
       VALUES ($1, $2, $3, 'Admin van A', $4)`,
      [ADMIN_A, tenantA, `${SUBJECT_ADMIN}@voorbeeld.nl`, SUBJECT_ADMIN],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [ADMIN_A, tenantA],
    );
    await client.query(
      `INSERT INTO clm.vendor (vendor_id, tenant_id, name) VALUES ($1, $2, $3)`,
      [VENDOR_A, tenantA, 'Leverancier van A'],
    );
    await client.query(
      `INSERT INTO clm.survey_template (template_id, tenant_id, name, version)
       VALUES ($1, $2, 'engagement-test-lijst', 1)`,
      [TEMPLATE_A, tenantA],
    );
    await client.query(
      `INSERT INTO clm.survey_run
         (run_id, tenant_id, template_id, status, survey_kind, is_test, started_at)
       VALUES ($1, $2, $3, 'active', 'vendor_compliance', true, now())`,
      [RUN_A, tenantA, TEMPLATE_A],
    );
    await client.query(
      `INSERT INTO clm.survey_response
         (response_id, tenant_id, run_id, vendor_id, subject_vendor_id,
          token_hash, status, expires_at)
       VALUES ($1, $2, $3, $4, $4, $5, 'pending', now() + interval '30 days')`,
      [RESPONSE_A, tenantA, RUN_A, VENDOR_A, TOKEN_HASH],
    );
    await client.query(
      `INSERT INTO clm.contract (contract_id, tenant_id, vendor_id, name)
       VALUES ($1, $2, $3, 'Testcontract A')`,
      [CONTRACT_A, tenantA, VENDOR_A],
    );
    await client.query('COMMIT');

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantB}'`);
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenantB, 'Tenant B (engagements)'],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, email, full_name, external_subject)
       VALUES ($1, $2, $3, 'Admin van B', $4)`,
      [ADMIN_B, tenantB, `${SUBJECT_B}@voorbeeld.nl`, SUBJECT_B],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [ADMIN_B, tenantB],
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
    await verwijderTestdata(tenantA, tenantB);
    await client.end();
  }, 30000);

  describe('een dossier aanmaken', () => {
    it('mag zonder enige koppeling (los verzoek aan de leverancier)', async () => {
      const antwoord = await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({
          titel: 'Los verzoek cyberveiligheid',
          notitieTekst: 'Testnotitie bij aanmaken.',
        })
        .expect(201);

      const { engagement } = antwoord.body as EngagementBody;
      expect(engagement.titel).toBe('Los verzoek cyberveiligheid');
      expect(engagement.createdByUserId).toBe(ADMIN_A);
      expect(engagement.createdByNaam).toBe('Admin van A');
      expect(engagement.links).toEqual([]);
    });

    it('mag met een initiële link naar een contract', async () => {
      const antwoord = await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({
          titel: 'Cyberveiligheidscontract heronderhandelen',
          notitieTekst: 'Testnotitie bij aanmaken.',
          links: [{ linkType: 'contract', linkedId: CONTRACT_A }],
        })
        .expect(201);

      const { engagement } = antwoord.body as EngagementBody;
      expect(engagement.links).toHaveLength(1);
      expect(engagement.links[0]).toMatchObject({
        linkType: 'contract',
        linkedId: CONTRACT_A,
      });
    });

    it('mag met een initiële link naar een survey-response', async () => {
      const antwoord = await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({
          titel: 'Vervolg op survey-antwoord',
          notitieTekst: 'Testnotitie bij aanmaken.',
          links: [{ linkType: 'survey_response', linkedId: RESPONSE_A }],
        })
        .expect(201);

      const { engagement } = antwoord.body as EngagementBody;
      expect(engagement.links[0]).toMatchObject({
        linkType: 'survey_response',
        linkedId: RESPONSE_A,
      });
    });

    it('weigert een lege titel', async () => {
      await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({ titel: '   ', notitieTekst: 'Testnotitie bij aanmaken.' })
        .expect(400);
    });

    it('weigert een link naar een niet-bestaand contract', async () => {
      await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({
          titel: 'Foute koppeling',
          notitieTekst: 'Testnotitie bij aanmaken.',
          links: [{ linkType: 'contract', linkedId: ENGAGEMENT_BESTAAT_NIET }],
        })
        .expect(400);
    });

    it('negeert createdByUserId uit de body en gebruikt de sessie', async () => {
      const antwoord = await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({
          titel: 'Op naam van een ander?',
          notitieTekst: 'Testnotitie bij aanmaken.',
          createdByUserId: ADMIN_B,
        })
        .expect(201);

      expect((antwoord.body as EngagementBody).engagement.createdByUserId).toBe(
        ADMIN_A,
      );
    });
  });

  describe('een link achteraf toevoegen', () => {
    it('koppelt een tweede survey-ronde aan een bestaand dossier', async () => {
      const aanmaak = await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({
          titel: 'Meerjarig dossier',
          notitieTekst: 'Testnotitie bij aanmaken.',
        })
        .expect(201);

      const engagementId = (aanmaak.body as EngagementBody).engagement
        .engagementId;

      await request(server)
        .post(`/engagements/${engagementId}/links`)
        .set('Cookie', cookieAdminA)
        .send({ linkType: 'contract', linkedId: CONTRACT_A })
        .expect(201);

      const lijst = await request(server)
        .get(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .expect(200);

      const gevonden = (lijst.body as LijstBody).engagements.find(
        (e) => e.engagementId === engagementId,
      );
      expect(gevonden?.links).toHaveLength(1);
    });

    it('weigert een dubbele link naar hetzelfde contract', async () => {
      const aanmaak = await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({
          titel: 'Dubbele koppeling',
          notitieTekst: 'Testnotitie bij aanmaken.',
          links: [{ linkType: 'contract', linkedId: CONTRACT_A }],
        })
        .expect(201);

      const engagementId = (aanmaak.body as EngagementBody).engagement
        .engagementId;

      await request(server)
        .post(`/engagements/${engagementId}/links`)
        .set('Cookie', cookieAdminA)
        .send({ linkType: 'contract', linkedId: CONTRACT_A })
        .expect(400);
    });
  });

  describe('meerdere, onafhankelijke dossiers per leverancier', () => {
    it('staat geen limiet toe op het aantal engagements per vendor', async () => {
      for (let i = 0; i < 4; i++) {
        await request(server)
          .post(`/vendors/${VENDOR_A}/engagements`)
          .set('Cookie', cookieAdminA)
          .send({
            titel: `Dossier nummer ${i}`,
            notitieTekst: 'Testnotitie bij aanmaken.',
          })
          .expect(201);
      }

      const lijst = await request(server)
        .get(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .expect(200);

      expect(
        (lijst.body as LijstBody).engagements.length,
      ).toBeGreaterThanOrEqual(4);
    });
  });

  describe('een dossier intrekken', () => {
    it('haalt hem uit de lijst maar bewaart de rij (deleted_at)', async () => {
      const aanmaak = await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({
          titel: 'Deze gaat weg',
          notitieTekst: 'Testnotitie bij aanmaken.',
        })
        .expect(201);

      const engagementId = (aanmaak.body as EngagementBody).engagement
        .engagementId;

      await request(server)
        .delete(`/engagements/${engagementId}`)
        .set('Cookie', cookieAdminA)
        .expect(204);

      const lijst = await request(server)
        .get(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .expect(200);

      const ids = (lijst.body as LijstBody).engagements.map(
        (e) => e.engagementId,
      );
      expect(ids).not.toContain(engagementId);

      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
      await client.query(`SET LOCAL app.current_actor = 'medewerker'`);
      const rij = await client.query<{ deleted_at: Date | null }>(
        'SELECT deleted_at FROM clm.vendor_engagement WHERE engagement_id = $1',
        [engagementId],
      );
      await client.query('COMMIT');

      expect(rij.rows).toHaveLength(1);
      expect(rij.rows[0].deleted_at).not.toBeNull();
    });

    it('geeft 404 bij een tweede intrekpoging', async () => {
      const aanmaak = await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({ titel: 'Eenmalig', notitieTekst: 'Testnotitie bij aanmaken.' })
        .expect(201);

      const engagementId = (aanmaak.body as EngagementBody).engagement
        .engagementId;
      const pad = `/engagements/${engagementId}`;

      await request(server).delete(pad).set('Cookie', cookieAdminA).expect(204);
      await request(server).delete(pad).set('Cookie', cookieAdminA).expect(404);
    });
  });

  describe('de tenantgrens', () => {
    it('laat tenant B geen dossier aanmaken bij een vendor van tenant A', async () => {
      await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieB)
        .send({
          titel: 'Meekijken?',
          notitieTekst: 'Testnotitie bij aanmaken.',
        })
        .expect(404);
    });

    it('laat tenant B de dossiers van tenant A niet lezen', async () => {
      await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({
          titel: 'Vertrouwelijk voor A',
          notitieTekst: 'Testnotitie bij aanmaken.',
        })
        .expect(201);

      await request(server)
        .get(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieB)
        .expect(404);
    });

    it('laat tenant B een dossier van tenant A niet intrekken', async () => {
      const aanmaak = await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({
          titel: 'Blijft staan',
          notitieTekst: 'Testnotitie bij aanmaken.',
        })
        .expect(201);

      const engagementId = (aanmaak.body as EngagementBody).engagement
        .engagementId;

      await request(server)
        .delete(`/engagements/${engagementId}`)
        .set('Cookie', cookieB)
        .expect(404);

      const lijst = await request(server)
        .get(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .expect(200);

      const ids = (lijst.body as LijstBody).engagements.map(
        (e) => e.engagementId,
      );
      expect(ids).toContain(engagementId);
    });
  });
});
