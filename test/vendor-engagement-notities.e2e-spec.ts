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
 * Vendor-dossier-notities — migratie 0043.
 *
 * Wat hier kan stuk gaan zonder dat het opvalt:
 *   1. Weigert aanmaken zonder notitie (nieuw verplicht veld)?
 *   2. Verschijnt een later toegevoegde notitie als laatsteNotitie?
 *   3. Valt na intrekken van de laatste notitie terug op de voorlaatste?
 *   4. Blijft de auteur uit de sessie, nooit uit de body?
 */

const {
  tenantA,
  adminA: ADMIN_A,
  vendorA: VENDOR_A,
} = TEST_IDS.vendorEngagementNotities;

const SUBJECT_ADMIN = `oid-ven-a-${Date.now()}`;

interface EngagementBody {
  engagement: {
    engagementId: string;
    laatsteNotitie: {
      noteId: string;
      tekst: string;
      createdByUserId: string;
      createdByNaam: string | null;
      createdAt: string;
    } | null;
  };
}

interface NoteBody {
  note: {
    noteId: string;
    tekst: string;
  };
}

describe('Vendor-dossier-notities (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let cookieAdminA: string;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(tenantA);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);

    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenantA, 'Tenant A (engagement-notities)'],
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
      [VENDOR_A, tenantA, 'Leverancier van A (notities)'],
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
  });

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(tenantA);
    await client.end();
  }, 30000);

  test('weigert aanmaken zonder notitieTekst', async () => {
    const response = await request(server)
      .post(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA)
      .send({ titel: 'Dossier zonder notitie' });

    expect(response.status).toBe(400);
  });

  test('maakt een dossier aan met notitie, en toont die als laatsteNotitie', async () => {
    const response = await request(server)
      .post(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA)
      .send({
        titel: 'Dossier met notitie',
        notitieTekst: 'Wacht op reactie leverancier.',
      });

    expect(response.status).toBe(201);
    const body = response.body as EngagementBody;
    expect(body.engagement.laatsteNotitie?.tekst).toBe(
      'Wacht op reactie leverancier.',
    );
    expect(body.engagement.laatsteNotitie?.createdByUserId).toBe(ADMIN_A);
  });

  test('voegt een nieuwe notitie toe aan een bestaand dossier, en die wordt de laatste', async () => {
    const aanmaakResponse = await request(server)
      .post(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA)
      .send({
        titel: 'Dossier voor notitie-update',
        notitieTekst: 'Eerste status.',
      });

    const engagementId = (aanmaakResponse.body as EngagementBody).engagement
      .engagementId;

    const notitieResponse = await request(server)
      .post(`/engagements/${engagementId}/notes`)
      .set('Cookie', cookieAdminA)
      .send({ tekst: 'Tweede, bijgewerkte status.' });

    expect(notitieResponse.status).toBe(201);

    const lijstResponse = await request(server)
      .get(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA);

    const gevonden = (
      lijstResponse.body as { engagements: EngagementBody['engagement'][] }
    ).engagements.find((e) => e.engagementId === engagementId);

    expect(gevonden?.laatsteNotitie?.tekst).toBe('Tweede, bijgewerkte status.');
  });

  test('valt na intrekken van de laatste notitie terug op de voorlaatste', async () => {
    const aanmaakResponse = await request(server)
      .post(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA)
      .send({
        titel: 'Dossier voor terugval-test',
        notitieTekst: 'Status A.',
      });

    const engagementId = (aanmaakResponse.body as EngagementBody).engagement
      .engagementId;

    const tweedeNotitieResponse = await request(server)
      .post(`/engagements/${engagementId}/notes`)
      .set('Cookie', cookieAdminA)
      .send({ tekst: 'Status B.' });

    const tweedeNoteId = (tweedeNotitieResponse.body as NoteBody).note.noteId;

    const intrekResponse = await request(server)
      .delete(`/engagements/${engagementId}/notes/${tweedeNoteId}`)
      .set('Cookie', cookieAdminA);

    expect(intrekResponse.status).toBe(204);

    const lijstResponse = await request(server)
      .get(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA);

    const gevonden = (
      lijstResponse.body as { engagements: EngagementBody['engagement'][] }
    ).engagements.find((e) => e.engagementId === engagementId);

    expect(gevonden?.laatsteNotitie?.tekst).toBe('Status A.');
  });

  test('404 bij intrekken van een al-ingetrokken notitie', async () => {
    const aanmaakResponse = await request(server)
      .post(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA)
      .send({
        titel: 'Dossier voor dubbel-intrek-test',
        notitieTekst: 'Status.',
      });

    const engagementId = (aanmaakResponse.body as EngagementBody).engagement
      .engagementId;
    const noteId = (aanmaakResponse.body as EngagementBody).engagement
      .laatsteNotitie!.noteId;

    const eersteIntrek = await request(server)
      .delete(`/engagements/${engagementId}/notes/${noteId}`)
      .set('Cookie', cookieAdminA);
    expect(eersteIntrek.status).toBe(204);

    const tweedeIntrek = await request(server)
      .delete(`/engagements/${engagementId}/notes/${noteId}`)
      .set('Cookie', cookieAdminA);
    expect(tweedeIntrek.status).toBe(404);
  });

  test('weigert een te lange notitietekst (>500 tekens)', async () => {
    const response = await request(server)
      .post(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA)
      .send({
        titel: 'Dossier met te lange notitie',
        notitieTekst: 'x'.repeat(501),
      });

    expect(response.status).toBe(400);
  });
});
