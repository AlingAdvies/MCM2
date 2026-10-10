import { randomUUID } from 'node:crypto';

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

  describe('koppeling aan contracten en beheer', () => {
    const vendorId = randomUUID();
    let contractId: string;

    interface ContractBody {
      contractId: string;
      beheer: string | null;
      werkingsgebiedCodes: string[];
    }

    beforeAll(async () => {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
      await client.query(
        'INSERT INTO clm.vendor (vendor_id, tenant_id, name) VALUES ($1, $2, $3)',
        [vendorId, tenantA, 'Leverancier (werkingsgebied-routes)'],
      );
      await client.query('COMMIT');

      for (const [code, label] of [
        ['hwgo', 'HWGO'],
        ['utrecht_binnen', 'Utrecht Binnen'],
      ]) {
        await request(server)
          .post('/werkingsgebieden')
          .set('Cookie', cookieAdminA)
          .send({ code, label })
          .expect(201);
      }

      const res = await request(server)
        .post(`/vendors/${vendorId}/contracts`)
        .set('Cookie', cookieAdminA)
        .send({ name: 'Contract (werkingsgebied-routes)', beheer: 'centraal' })
        .expect(201);
      const body = res.body as ContractBody;
      contractId = body.contractId;

      expect(body.beheer).toBe('centraal');
      expect(body.werkingsgebiedCodes).toEqual([]);
    });

    it('PUT koppelt gebieden; het detail geeft ze gesorteerd terug', async () => {
      const res = await request(server)
        .put(`/vendors/${vendorId}/contracts/${contractId}/werkingsgebieden`)
        .set('Cookie', cookieUserA)
        .send({ codes: ['utrecht_binnen', 'anf'] })
        .expect(200);

      expect(
        (res.body as { werkingsgebiedCodes: string[] }).werkingsgebiedCodes,
      ).toEqual(['anf', 'utrecht_binnen']);

      const detail = await request(server)
        .get(`/vendors/${vendorId}/contracts/${contractId}`)
        .set('Cookie', cookieUserA)
        .expect(200);
      expect((detail.body as ContractBody).werkingsgebiedCodes).toEqual([
        'anf',
        'utrecht_binnen',
      ]);
    });

    it('PUT met een onbekende code geeft 400 met veld codes en wijzigt niets', async () => {
      const res = await request(server)
        .put(`/vendors/${vendorId}/contracts/${contractId}/werkingsgebieden`)
        .set('Cookie', cookieAdminA)
        .send({ codes: ['anf', 'bestaat_niet'] })
        .expect(400);
      expect((res.body as VeldFoutBody).veld).toBe('codes');

      const detail = await request(server)
        .get(`/vendors/${vendorId}/contracts/${contractId}`)
        .set('Cookie', cookieAdminA)
        .expect(200);
      expect((detail.body as ContractBody).werkingsgebiedCodes).toEqual([
        'anf',
        'utrecht_binnen',
      ]);
    });

    it('PATCH bewaart beheer; een onbekende waarde geeft 400', async () => {
      const res = await request(server)
        .patch(`/vendors/${vendorId}/contracts/${contractId}`)
        .set('Cookie', cookieAdminA)
        .send({ beheer: 'operationeel' })
        .expect(200);
      expect((res.body as ContractBody).beheer).toBe('operationeel');

      await request(server)
        .patch(`/vendors/${vendorId}/contracts/${contractId}`)
        .set('Cookie', cookieAdminA)
        .send({ beheer: 'regionaal' })
        .expect(400);
    });

    it('het tenant-brede overzicht bevat werkingsgebieden en beheer', async () => {
      const res = await request(server)
        .get('/contracts')
        .set('Cookie', cookieUserA)
        .expect(200);

      const contract = (
        res.body as { contracten: ContractBody[] }
      ).contracten.find((c) => c.contractId === contractId);
      expect(contract?.werkingsgebiedCodes).toEqual(['anf', 'utrecht_binnen']);
      expect(contract?.beheer).toBe('operationeel');
    });

    it('de leverancierslijst kent de gebieden via de actieve contracten', async () => {
      const res = await request(server)
        .get('/vendors')
        .set('Cookie', cookieUserA)
        .expect(200);

      const vendor = (
        res.body as {
          vendors: { vendorId: string; werkingsgebiedCodes: string[] }[];
        }
      ).vendors.find((v) => v.vendorId === vendorId);
      expect(vendor?.werkingsgebiedCodes).toEqual(['anf', 'utrecht_binnen']);
    });

    it('een gebied verwijderen ontkoppelt het, het contract blijft bestaan', async () => {
      await request(server)
        .delete('/werkingsgebieden/utrecht_binnen')
        .set('Cookie', cookieAdminA)
        .expect(204);

      const detail = await request(server)
        .get(`/vendors/${vendorId}/contracts/${contractId}`)
        .set('Cookie', cookieAdminA)
        .expect(200);
      expect((detail.body as ContractBody).werkingsgebiedCodes).toEqual([
        'anf',
      ]);
    });

    it('een soft-deleted contract telt niet mee in de leverancierslijst', async () => {
      await request(server)
        .delete(`/vendors/${vendorId}/contracts/${contractId}`)
        .set('Cookie', cookieAdminA)
        .expect((res) => {
          expect([200, 204]).toContain(res.status);
        });

      const res = await request(server)
        .get('/vendors')
        .set('Cookie', cookieUserA)
        .expect(200);
      const vendor = (
        res.body as {
          vendors: { vendorId: string; werkingsgebiedCodes: string[] }[];
        }
      ).vendors.find((v) => v.vendorId === vendorId);
      expect(vendor?.werkingsgebiedCodes).toEqual([]);
    });
  });
});
