import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Client } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { SessieService } from '../src/auth/sessie.service';
import { cookieInstellingen } from '../src/auth/sessie';
import { TEST_IDS } from './test-ids';

/**
 * PUT /vendors/:id/compliance-themas — de complete-set-vervanging, en de
 * tenant-grens eromheen.
 *
 * Zie docs/superpowers/specs/2026-08-25-audit-bewijsvoering-design.md, Deel 1.
 */

const { tenantA, tenantB, userA } = TEST_IDS['vendor-compliance-thema'];

const SUBJECT_A = `oid-thema-a-${Date.now()}`;
const SUBJECT_B = `oid-thema-b-${Date.now()}`;

/**
 * Ruimt alle testdata van deze suite op — idempotent, mag draaien op een lege
 * database of op restanten van een eerder afgebroken run.
 *
 * Alles binnen dezelfde `SET LOCAL app.current_tenant_id`-transactie per
 * tenant, inclusief `clm.tenant` zelf. Die laatste stap ontbrak in een eerdere
 * versie — een DELETE op `clm.tenant` zonder tenant-context raakt door RLS
 * stilzwijgend 0 rijen (geen fout, dus onopgemerkt), waardoor de oude
 * tenant-rij nooit echt verdween en elke volgende run op de INSERT
 * struikelde met "duplicate key value violates unique constraint
 * tenant_pkey".
 */
async function verwijderTestdata(client: Client): Promise<void> {
  for (const tenant of [tenantA, tenantB]) {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    await client.query(
      'DELETE FROM clm.vendor_compliance_thema WHERE tenant_id = $1',
      [tenant],
    );
    await client.query('DELETE FROM clm.vendor WHERE tenant_id = $1', [
      tenant,
    ]);
    await client.query(
      'DELETE FROM clm.tenant_membership WHERE tenant_id = $1',
      [tenant],
    );
    await client.query('DELETE FROM clm."user" WHERE tenant_id = $1', [
      tenant,
    ]);
    await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [
      tenant,
    ]);
    await client.query('COMMIT');
  }
}

describe('PUT /vendors/:id/compliance-themas (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let sessies: SessieService;
  let cookieA: string;
  let vendorId: string;
  const cookieNaam = cookieInstellingen().naam;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(client);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenantA, `thema-test-a-${Date.now()}`],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
       VALUES ($1, $2, $3, $4)`,
      [userA, tenantA, 'Admin A', SUBJECT_A],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [userA, tenantA],
    );
    await client.query('COMMIT');

    // tenantB wordt hier bewust niet aangemaakt: deze suite test geen
    // cross-tenant gedrag (dat dekt vendor-routes.e2e-spec.ts al expliciet).
    // Het id is alleen in test-ids.ts gereserveerd zodat een latere suite het
    // niet per ongeluk hergebruikt.

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();

    sessies = moduleRef.get(SessieService);
    const sessieA = await sessies.aanmaken(SUBJECT_A);
    expect(sessieA).not.toBeNull();
    cookieA = `${cookieNaam}=${sessieA!.token}`;

    const aanmaak = await request(server)
      .post('/vendors')
      .set('Cookie', cookieA)
      .send({ name: `Thema-testvendor-${Date.now()}` });

    vendorId = aanmaak.body.vendorId;
  }, 30000);

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(client);
    await client.end();
  }, 30000);

  it('zet een set thema-codes en geeft ze terug in het detail', async () => {
    const res = await request(server)
      .put(`/vendors/${vendorId}/compliance-themas`)
      .set('Cookie', cookieA)
      .send({ themaCodes: ['cybersecurity', 'kwaliteit'] });

    expect(res.status).toBe(200);
    expect([...res.body.complianceThemaCodes].sort()).toEqual([
      'cybersecurity',
      'kwaliteit',
    ]);
  });

  it('vervangt de volledige set, geen samenvoeging', async () => {
    await request(server)
      .put(`/vendors/${vendorId}/compliance-themas`)
      .set('Cookie', cookieA)
      .send({ themaCodes: ['cybersecurity', 'kwaliteit'] });

    const res = await request(server)
      .put(`/vendors/${vendorId}/compliance-themas`)
      .set('Cookie', cookieA)
      .send({ themaCodes: ['continuiteit'] });

    expect(res.status).toBe(200);
    expect(res.body.complianceThemaCodes).toEqual(['continuiteit']);
  });

  it('accepteert een lege lijst — betekent "geen thema meer"', async () => {
    await request(server)
      .put(`/vendors/${vendorId}/compliance-themas`)
      .set('Cookie', cookieA)
      .send({ themaCodes: ['cybersecurity'] });

    const res = await request(server)
      .put(`/vendors/${vendorId}/compliance-themas`)
      .set('Cookie', cookieA)
      .send({ themaCodes: [] });

    expect(res.status).toBe(200);
    expect(res.body.complianceThemaCodes).toEqual([]);
  });

  it('weigert een onbekende thema-code met een 400', async () => {
    const res = await request(server)
      .put(`/vendors/${vendorId}/compliance-themas`)
      .set('Cookie', cookieA)
      .send({ themaCodes: ['niet-bestaand-thema'] });

    expect(res.status).toBe(400);
    expect(res.body.veld).toBe('themaCodes');
  });

  it('weigert een niet-bestaande leverancier met 404', async () => {
    const res = await request(server)
      .put('/vendors/00000000-0000-0000-0000-000000000000/compliance-themas')
      .set('Cookie', cookieA)
      .send({ themaCodes: ['cybersecurity'] });

    expect(res.status).toBe(404);
  });

  it('weigert zonder geldige sessie met 401', async () => {
    await request(server)
      .put(`/vendors/${vendorId}/compliance-themas`)
      .send({ themaCodes: ['cybersecurity'] })
      .expect(401);
  });
});
