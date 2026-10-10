import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Client } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { cookieInstellingen } from '../src/auth/sessie';
import { SessieService } from '../src/auth/sessie.service';
import { verwijderTestdata } from './opruimen';
import { TEST_IDS } from './test-ids';

/**
 * Werkingsgebieden: beheer van de lijst en de tenant-grens eromheen (#234).
 * Zie docs/superpowers/plans/2026-10-10-werkingsgebied-contracten.md.
 */

const { tenantA, tenantB, adminA, userA } = TEST_IDS['werkingsgebied-routes'];

const STEMPEL = Date.now();
const SUBJECT_ADMIN_A = `oid-wgr-admin-a-${STEMPEL}`;
const SUBJECT_USER_A = `oid-wgr-user-a-${STEMPEL}`;

interface GebiedBody {
  code: string;
  label: string;
}

interface VeldFoutBody {
  veld: string;
}

describe('/werkingsgebieden (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let cookieAdminA: string;
  let cookieUserA: string;
  const cookieNaam = cookieInstellingen().naam;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(tenantA, tenantB);

    for (const [tenant, naam] of [
      [tenantA, `Tenant A (werkingsgebied-routes ${STEMPEL})`],
      [tenantB, `Tenant B (werkingsgebied-routes ${STEMPEL})`],
    ] as const) {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
      await client.query(
        'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
        [tenant, naam],
      );
      await client.query('COMMIT');
    }

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
    for (const [userId, naam, subject, rol] of [
      [adminA, 'Admin A', SUBJECT_ADMIN_A, 'admin'],
      [userA, 'User A', SUBJECT_USER_A, 'user'],
    ] as const) {
      await client.query(
        `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
         VALUES ($1, $2, $3, $4)`,
        [userId, tenantA, naam, subject],
      );
      await client.query(
        `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
         VALUES ($1, $2, $3)`,
        [userId, tenantA, rol],
      );
    }
    await client.query('COMMIT');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();

    const sessies = app.get(SessieService);
    const sessieAdminA = await sessies.aanmaken(SUBJECT_ADMIN_A);
    const sessieUserA = await sessies.aanmaken(SUBJECT_USER_A);
    expect(sessieAdminA).not.toBeNull();
    expect(sessieUserA).not.toBeNull();
    cookieAdminA = `${cookieNaam}=${sessieAdminA!.token}`;
    cookieUserA = `${cookieNaam}=${sessieUserA!.token}`;
  }, 30000);

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(tenantA, tenantB);
    await client.end();
  }, 30000);

  describe('beheer van de lijst', () => {
    it('een admin maakt een gebied aan en ziet het terug in de lijst', async () => {
      const res = await request(server)
        .post('/werkingsgebieden')
        .set('Cookie', cookieAdminA)
        .send({ code: 'anf', label: 'ANF' })
        .expect(201);

      expect(res.body as GebiedBody).toEqual({ code: 'anf', label: 'ANF' });

      const lijst = await request(server)
        .get('/werkingsgebieden')
        .set('Cookie', cookieUserA)
        .expect(200);

      const codes = (
        lijst.body as { werkingsgebieden: GebiedBody[] }
      ).werkingsgebieden.map((g) => g.code);
      expect(codes).toContain('anf');
    });

    it('een dubbele code geeft 400 met veld code', async () => {
      const res = await request(server)
        .post('/werkingsgebieden')
        .set('Cookie', cookieAdminA)
        .send({ code: 'anf', label: 'Nog een keer' })
        .expect(400);

      expect((res.body as VeldFoutBody).veld).toBe('code');
    });

    it('een ongeldige code geeft 400 met veld code', async () => {
      const res = await request(server)
        .post('/werkingsgebieden')
        .set('Cookie', cookieAdminA)
        .send({ code: 'Utrecht Binnen', label: 'x' })
        .expect(400);

      expect((res.body as VeldFoutBody).veld).toBe('code');
    });

    it('een gewone user mag niet toevoegen, hernoemen of verwijderen', async () => {
      await request(server)
        .post('/werkingsgebieden')
        .set('Cookie', cookieUserA)
        .send({ code: 'hwgo', label: 'HWGO' })
        .expect(403);
      await request(server)
        .patch('/werkingsgebieden/anf')
        .set('Cookie', cookieUserA)
        .send({ label: 'x' })
        .expect(403);
      await request(server)
        .delete('/werkingsgebieden/anf')
        .set('Cookie', cookieUserA)
        .expect(403);
    });

    it('PATCH wijzigt de naam', async () => {
      const res = await request(server)
        .patch('/werkingsgebieden/anf')
        .set('Cookie', cookieAdminA)
        .send({ label: 'Arnhem-Nijmegen-Foodvalley' })
        .expect(200);

      expect((res.body as GebiedBody).label).toBe('Arnhem-Nijmegen-Foodvalley');
    });

    it('tenant B ziet de gebieden van tenant A niet', async () => {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantB}'`);
      const res = await client.query(
        'SELECT code FROM clm.werkingsgebied WHERE code = $1',
        ['anf'],
      );
      await client.query('COMMIT');

      expect(res.rowCount).toBe(0);
    });

    it('DELETE verwijdert het gebied; daarna geeft dezelfde code 404', async () => {
      await request(server)
        .post('/werkingsgebieden')
        .set('Cookie', cookieAdminA)
        .send({ code: 'weg_ermee', label: 'Tijdelijk' })
        .expect(201);

      await request(server)
        .delete('/werkingsgebieden/weg_ermee')
        .set('Cookie', cookieAdminA)
        .expect(204);

      await request(server)
        .delete('/werkingsgebieden/weg_ermee')
        .set('Cookie', cookieAdminA)
        .expect(404);
    });

    it('weigert zonder geldige sessie met 401', async () => {
      await request(server).get('/werkingsgebieden').expect(401);
    });
  });
});
