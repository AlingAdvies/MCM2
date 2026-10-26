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
 *
 * Migratie 0048 (#248) — dossier als kwestie:
 *   5. Is een nieuw dossier open, en weigert afronden zonder uitkomst?
 *   6. Wordt de uitkomst de laatste notitie, en vervalt de volgende stap?
 *   7. Kan een afgerond dossier heropend worden, en niet dubbel afgerond?
 *   8. Weigert een volgende stap op een afgerond dossier en een foute datum?
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

  async function nieuwDossier(titel: string): Promise<string> {
    const response = await request(server)
      .post(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA)
      .send({ titel, notitieTekst: 'Startstand.' })
      .expect(201);
    return (response.body as EngagementBody).engagement.engagementId;
  }

  async function haalDossier(engagementId: string) {
    const lijst = await request(server)
      .get(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA)
      .expect(200);
    return (
      lijst.body as {
        engagements: Array<
          EngagementBody['engagement'] & {
            status: string;
            afgerondOp: string | null;
            volgendeStap: { tekst: string | null; datum: string | null } | null;
          }
        >;
      }
    ).engagements.find((e) => e.engagementId === engagementId);
  }

  test('een nieuw dossier is open en heeft geen volgende stap', async () => {
    const id = await nieuwDossier('Kwestie: nieuw');
    const dossier = await haalDossier(id);
    expect(dossier?.status).toBe('open');
    expect(dossier?.afgerondOp).toBeNull();
    expect(dossier?.volgendeStap).toBeNull();
  });

  test('zet een volgende stap met datum, en wist die weer', async () => {
    const id = await nieuwDossier('Kwestie: volgende stap');

    await request(server)
      .put(`/engagements/${id}/volgende-stap`)
      .set('Cookie', cookieAdminA)
      .send({ tekst: 'Wachten op voorstel', datum: '2026-11-15' })
      .expect(204);

    expect((await haalDossier(id))?.volgendeStap).toEqual({
      tekst: 'Wachten op voorstel',
      datum: '2026-11-15',
    });

    await request(server)
      .put(`/engagements/${id}/volgende-stap`)
      .set('Cookie', cookieAdminA)
      .send({ tekst: null, datum: null })
      .expect(204);

    expect((await haalDossier(id))?.volgendeStap).toBeNull();
  });

  test('weigert een ongeldige datum bij de volgende stap', async () => {
    const id = await nieuwDossier('Kwestie: foute datum');
    await request(server)
      .put(`/engagements/${id}/volgende-stap`)
      .set('Cookie', cookieAdminA)
      .send({ datum: '15-11-2026' })
      .expect(400);
  });

  test('weigert afronden zonder uitkomst', async () => {
    const id = await nieuwDossier('Kwestie: afronden zonder uitkomst');
    await request(server)
      .post(`/engagements/${id}/afronden`)
      .set('Cookie', cookieAdminA)
      .send({ uitkomst: '  ' })
      .expect(400);
    expect((await haalDossier(id))?.status).toBe('open');
  });

  test('afronden: uitkomst wordt de laatste notitie en de volgende stap vervalt', async () => {
    const id = await nieuwDossier('Kwestie: afronden');

    await request(server)
      .put(`/engagements/${id}/volgende-stap`)
      .set('Cookie', cookieAdminA)
      .send({ tekst: 'Bellen', datum: '2026-11-01' })
      .expect(204);

    await request(server)
      .post(`/engagements/${id}/afronden`)
      .set('Cookie', cookieAdminA)
      .send({ uitkomst: 'Akkoord bereikt, zie mail.' })
      .expect(204);

    const dossier = await haalDossier(id);
    expect(dossier?.status).toBe('afgerond');
    expect(dossier?.afgerondOp).not.toBeNull();
    expect(dossier?.laatsteNotitie?.tekst).toBe('Akkoord bereikt, zie mail.');
    expect(dossier?.laatsteNotitie?.createdByUserId).toBe(ADMIN_A);
    expect(dossier?.volgendeStap).toBeNull();

    await request(server)
      .post(`/engagements/${id}/afronden`)
      .set('Cookie', cookieAdminA)
      .send({ uitkomst: 'Nog een keer.' })
      .expect(400);

    await request(server)
      .put(`/engagements/${id}/volgende-stap`)
      .set('Cookie', cookieAdminA)
      .send({ tekst: 'Toch nog iets' })
      .expect(400);
  });

  test('heropenen: status terug naar open, uitkomst blijft als notitie', async () => {
    const id = await nieuwDossier('Kwestie: heropenen');

    await request(server)
      .post(`/engagements/${id}/afronden`)
      .set('Cookie', cookieAdminA)
      .send({ uitkomst: 'Afgehandeld.' })
      .expect(204);

    await request(server)
      .post(`/engagements/${id}/heropenen`)
      .set('Cookie', cookieAdminA)
      .expect(204);

    const dossier = await haalDossier(id);
    expect(dossier?.status).toBe('open');
    expect(dossier?.afgerondOp).toBeNull();
    expect(dossier?.laatsteNotitie?.tekst).toBe('Afgehandeld.');

    await request(server)
      .post(`/engagements/${id}/heropenen`)
      .set('Cookie', cookieAdminA)
      .expect(400);
  });

  test('404 bij afronden van een onbekend dossier', async () => {
    await request(server)
      .post('/engagements/00000000-0000-4000-8000-000000000999/afronden')
      .set('Cookie', cookieAdminA)
      .send({ uitkomst: 'Bestaat niet.' })
      .expect(404);
  });
});
