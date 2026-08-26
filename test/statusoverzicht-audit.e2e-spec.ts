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
 * Het uitgebreide statusoverzicht: 'gepland' voor relevante leveranciers
 * zonder respons, en het thema-filter.
 *
 * Zie docs/superpowers/specs/2026-08-25-audit-bewijsvoering-design.md, Deel 2/3.
 */

const { tenant, user } = TEST_IDS['statusoverzicht-audit'];
const SUBJECT = `oid-statusoverzicht-audit-${Date.now()}`;

interface WerkvoorraadItem {
  responseId: string | null;
  vendorId: string;
  status: string;
}

interface WerkvoorraadBody {
  scope: string;
  werkvoorraad: WerkvoorraadItem[];
}

interface VendorAanmaakBody {
  vendorId: string;
}

/** Idempotent, alles binnen dezelfde tenant-transactie — zie de toelichting
 * in vendor-compliance-thema.e2e-spec.ts over waarom dat nodig is. */
async function verwijderTestdata(client: Client): Promise<void> {
  await client.query('BEGIN');
  await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
  await client.query(
    'DELETE FROM clm.vendor_compliance_thema WHERE tenant_id = $1',
    [tenant],
  );
  await client.query('DELETE FROM clm.vendor WHERE tenant_id = $1', [tenant]);
  await client.query('DELETE FROM clm.tenant_membership WHERE tenant_id = $1', [
    tenant,
  ]);
  await client.query('DELETE FROM clm."user" WHERE tenant_id = $1', [tenant]);
  await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [tenant]);
  await client.query('COMMIT');
}

describe('Statusoverzicht — gepland en thema-filter (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let cookie: string;
  const cookieNaam = cookieInstellingen().naam;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(client);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenant, `audit-overzicht-${Date.now()}`],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
       VALUES ($1, $2, $3, $4)`,
      [user, tenant, 'Beheerder', SUBJECT],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [user, tenant],
    );
    await client.query('COMMIT');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();

    const sessies = moduleRef.get(SessieService);
    const sessie = await sessies.aanmaken(SUBJECT);
    expect(sessie).not.toBeNull();
    cookie = `${cookieNaam}=${sessie!.token}`;
  }, 30000);

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(client);
    await client.end();
  }, 30000);

  it('toont een relevante leverancier zonder respons als gepland', async () => {
    const aanmaak = await request(server)
      .post('/vendors')
      .set('Cookie', cookie)
      .send({ name: `Relevante-vendor-${Date.now()}` });
    const { vendorId } = aanmaak.body as VendorAanmaakBody;

    await request(server)
      .patch(`/vendors/${vendorId}`)
      .set('Cookie', cookie)
      .send({ businessCriticalityCode: 'high' });

    const res = await request(server)
      .get('/admin/survey/mijn-vendors?scope=organisatie')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { werkvoorraad } = res.body as WerkvoorraadBody;
    const item = werkvoorraad.find((i) => i.vendorId === vendorId);
    expect(item).toBeDefined();
    expect(item!.status).toBe('gepland');
    expect(item!.responseId).toBeNull();
  });

  it('toont een leverancier met criticaliteit "low" niet als gepland', async () => {
    const aanmaak = await request(server)
      .post('/vendors')
      .set('Cookie', cookie)
      .send({ name: `Lage-criticaliteit-vendor-${Date.now()}` });
    const { vendorId } = aanmaak.body as VendorAanmaakBody;

    await request(server)
      .patch(`/vendors/${vendorId}`)
      .set('Cookie', cookie)
      .send({ businessCriticalityCode: 'low' });

    const res = await request(server)
      .get('/admin/survey/mijn-vendors?scope=organisatie')
      .set('Cookie', cookie);

    const { werkvoorraad } = res.body as WerkvoorraadBody;
    const item = werkvoorraad.find((i) => i.vendorId === vendorId);
    expect(item).toBeUndefined();
  });

  it('filtert gepland-vendors op thema', async () => {
    const aanmaak = await request(server)
      .post('/vendors')
      .set('Cookie', cookie)
      .send({ name: `Thema-vendor-${Date.now()}` });
    const { vendorId } = aanmaak.body as VendorAanmaakBody;

    await request(server)
      .patch(`/vendors/${vendorId}`)
      .set('Cookie', cookie)
      .send({ businessCriticalityCode: 'high' });

    await request(server)
      .put(`/vendors/${vendorId}/compliance-themas`)
      .set('Cookie', cookie)
      .send({ themaCodes: ['kwaliteit'] });

    const metFilter = await request(server)
      .get('/admin/survey/mijn-vendors?scope=organisatie&thema=cybersecurity')
      .set('Cookie', cookie);

    const { werkvoorraad: werkvoorraadMetFilter } =
      metFilter.body as WerkvoorraadBody;
    expect(
      werkvoorraadMetFilter.find((i) => i.vendorId === vendorId),
    ).toBeUndefined();

    const zonderFilter = await request(server)
      .get('/admin/survey/mijn-vendors?scope=organisatie&thema=kwaliteit')
      .set('Cookie', cookie);

    const { werkvoorraad: werkvoorraadZonderFilter } =
      zonderFilter.body as WerkvoorraadBody;
    expect(
      werkvoorraadZonderFilter.find((i) => i.vendorId === vendorId),
    ).toBeDefined();
  });
});
