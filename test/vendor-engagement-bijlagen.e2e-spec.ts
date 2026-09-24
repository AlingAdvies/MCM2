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
 * Bijlagen bij een vendor-dossier — max. 3 per engagement, PDF/PNG/DOCX/XLSX,
 * max. 10MB. Zie migratie 0042 en
 * src/vendor/vendor-engagement-bestand-validatie.ts.
 *
 * Eigen tenant-paar t.o.v. vendor-engagements.e2e-spec.ts: suites kunnen in
 * willekeurige volgorde draaien en delen één database (CLAUDE.md §15).
 */

const {
  tenantA,
  tenantB,
  adminA: ADMIN_A,
  vendorA: VENDOR_A,
} = TEST_IDS.vendorEngagementBijlagen;

const SUBJECT_ADMIN = `oid-veb-a-${Date.now()}`;
const PDF_INHOUD = Buffer.concat([
  Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]),
  Buffer.from('testinhoud'),
]);

interface EngagementBody {
  engagement: { engagementId: string };
}

interface AttachmentBody {
  attachment: {
    attachmentId: string;
    originalFilename: string;
    contentType: string;
    sizeBytes: number;
  };
}

describe('Bijlagen bij een vendor-dossier (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let cookieAdminA: string;
  let engagementId: string;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(tenantA, tenantB);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenantA, 'Tenant A (engagement-bijlagen)'],
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
    const sessie = await sessies.aanmaken(SUBJECT_ADMIN);
    expect(sessie).not.toBeNull();
    cookieAdminA = `${naam}=${sessie!.token}`;

    const aanmaak = await request(server)
      .post(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA)
      .send({
        titel: 'Dossier met bijlagen',
        notitieTekst: 'Testnotitie bij aanmaken.',
      })
      .expect(201);

    engagementId = (aanmaak.body as EngagementBody).engagement.engagementId;
  }, 30000);

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(tenantA, tenantB);
    await client.end();
  }, 30000);

  it('accepteert een PDF-bijlage', async () => {
    const antwoord = await request(server)
      .post(`/engagements/${engagementId}/attachments`)
      .set('Cookie', cookieAdminA)
      .attach('file', PDF_INHOUD, {
        filename: 'compliance-bewijs.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    const { attachment } = antwoord.body as AttachmentBody;
    expect(attachment.originalFilename).toBe('compliance-bewijs.pdf');
    expect(attachment.contentType).toBe('application/pdf');
  });

  it('weigert een onbekend bestandstype', async () => {
    await request(server)
      .post(`/engagements/${engagementId}/attachments`)
      .set('Cookie', cookieAdminA)
      .attach('file', Buffer.from('gewoon tekst'), {
        filename: 'notitie.txt',
        contentType: 'text/plain',
      })
      .expect(400);
  });

  it('weigert de vierde bijlage bij een dossier dat er al 3 heeft', async () => {
    const aanmaak = await request(server)
      .post(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA)
      .send({
        titel: 'Dossier tot aan het maximum',
        notitieTekst: 'Testnotitie bij aanmaken.',
      })
      .expect(201);

    const eigenEngagementId = (aanmaak.body as EngagementBody).engagement
      .engagementId;

    for (let i = 0; i < 3; i++) {
      await request(server)
        .post(`/engagements/${eigenEngagementId}/attachments`)
        .set('Cookie', cookieAdminA)
        .attach('file', PDF_INHOUD, {
          filename: `bewijs-${i}.pdf`,
          contentType: 'application/pdf',
        })
        .expect(201);
    }

    await request(server)
      .post(`/engagements/${eigenEngagementId}/attachments`)
      .set('Cookie', cookieAdminA)
      .attach('file', PDF_INHOUD, {
        filename: 'bewijs-4.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
  });

  it('geeft de bijlage terug bij downloaden', async () => {
    const upload = await request(server)
      .post(`/engagements/${engagementId}/attachments`)
      .set('Cookie', cookieAdminA)
      .attach('file', PDF_INHOUD, {
        filename: 'download-test.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    const attachmentId = (upload.body as AttachmentBody).attachment
      .attachmentId;

    const download = await request(server)
      .get(`/engagements/attachments/${attachmentId}`)
      .set('Cookie', cookieAdminA)
      .expect(200);

    expect(download.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(download.body as Buffer)).toEqual(PDF_INHOUD);
  });

  it('trekt een bijlage in via deleted_at, rij blijft bestaan', async () => {
    const upload = await request(server)
      .post(`/engagements/${engagementId}/attachments`)
      .set('Cookie', cookieAdminA)
      .attach('file', PDF_INHOUD, {
        filename: 'wordt-ingetrokken.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    const attachmentId = (upload.body as AttachmentBody).attachment
      .attachmentId;

    await request(server)
      .delete(`/engagements/${engagementId}/attachments/${attachmentId}`)
      .set('Cookie', cookieAdminA)
      .expect(204);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);
    const rij = await client.query<{ deleted_at: Date | null }>(
      'SELECT deleted_at FROM clm.vendor_engagement_attachment WHERE attachment_id = $1',
      [attachmentId],
    );
    await client.query('COMMIT');

    expect(rij.rows).toHaveLength(1);
    expect(rij.rows[0].deleted_at).not.toBeNull();
  });
});
