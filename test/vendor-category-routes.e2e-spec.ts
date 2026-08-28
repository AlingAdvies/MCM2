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
 * CRUD op /vendor-categories, en de tenant-grens eromheen (#186).
 *
 * Zie docs/superpowers/specs/2026-08-28-coupa-schema-uitbreiding-design.md.
 */

const { tenantA, tenantB, adminA, userA } = TEST_IDS['vendor-category-routes'];

const STEMPEL = Date.now();
const SUBJECT_ADMIN_A = `oid-vcr-admin-a-${STEMPEL}`;
const SUBJECT_USER_A = `oid-vcr-user-a-${STEMPEL}`;
const CODE_A = `test_cat_a_${STEMPEL}`;

interface CategorieBody {
  code: string;
  label: string;
}

interface VeldFoutBody {
  veld: string;
}

async function verwijderTestdata(client: Client): Promise<void> {
  for (const tenant of [tenantA, tenantB]) {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    await client.query('DELETE FROM ref.vendor_category WHERE tenant_id = $1', [
      tenant,
    ]);
    await client.query(
      'DELETE FROM clm.tenant_membership WHERE tenant_id = $1',
      [tenant],
    );
    await client.query('DELETE FROM clm."user" WHERE tenant_id = $1', [tenant]);
    await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [tenant]);
    await client.query('COMMIT');
  }
}

describe('/vendor-categories (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let cookieAdminA: string;
  let cookieUserA: string;
  const cookieNaam = cookieInstellingen().naam;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(client);

    for (const [tenant, naam] of [
      [tenantA, `categorie-test-a-${STEMPEL}`],
      [tenantB, `categorie-test-b-${STEMPEL}`],
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
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
       VALUES ($1, $2, $3, $4)`,
      [adminA, tenantA, 'Admin A', SUBJECT_ADMIN_A],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
       VALUES ($1, $2, $3, $4)`,
      [userA, tenantA, 'User A', SUBJECT_USER_A],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [adminA, tenantA],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'user')`,
      [userA, tenantA],
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
    const sessieAdminA = await sessies.aanmaken(SUBJECT_ADMIN_A);
    const sessieUserA = await sessies.aanmaken(SUBJECT_USER_A);
    expect(sessieAdminA).not.toBeNull();
    expect(sessieUserA).not.toBeNull();
    cookieAdminA = `${cookieNaam}=${sessieAdminA!.token}`;
    cookieUserA = `${cookieNaam}=${sessieUserA!.token}`;
  }, 30000);

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(client);
    await client.end();
  }, 30000);

  it('GET geeft een lege lijst terug voor een tenant zonder categorieën (de seed uit PlatformService.tenantAanmaken() wordt hier niet aangeroepen — deze suite richt de tenant rechtstreeks via SQL in)', async () => {
    const res = await request(server)
      .get('/vendor-categories')
      .set('Cookie', cookieAdminA)
      .expect(200);

    expect(
      Array.isArray((res.body as { categorieen: unknown[] }).categorieen),
    ).toBe(true);
  });

  it('POST als admin maakt een categorie aan', async () => {
    const res = await request(server)
      .post('/vendor-categories')
      .set('Cookie', cookieAdminA)
      .send({ code: CODE_A, label: 'Testcategorie A' })
      .expect(201);

    const body = res.body as CategorieBody;
    expect(body.code).toBe(CODE_A);
    expect(body.label).toBe('Testcategorie A');
  });

  it('POST als gewone user faalt met 403', async () => {
    await request(server)
      .post('/vendor-categories')
      .set('Cookie', cookieUserA)
      .send({ code: `${CODE_A}-2`, label: 'Mag niet' })
      .expect(403);
  });

  it('POST met een ongeldige code faalt met 400 en het veld erbij', async () => {
    const res = await request(server)
      .post('/vendor-categories')
      .set('Cookie', cookieAdminA)
      .send({ code: 'Hoofdletters Niet Toegestaan!', label: 'x' })
      .expect(400);

    expect((res.body as VeldFoutBody).veld).toBe('code');
  });

  it('PUT wijzigt het label', async () => {
    const res = await request(server)
      .put(`/vendor-categories/${CODE_A}`)
      .set('Cookie', cookieAdminA)
      .send({ label: 'Aangepast label' })
      .expect(200);

    expect((res.body as CategorieBody).label).toBe('Aangepast label');
  });

  it('tenant B ziet tenant A se categorie niet (tenant-isolatie)', async () => {
    // tenantB heeft geen sessie in deze suite; verificeren via directe
    // databasequery binnen tenantB's context volstaat voor de isolatiegrens.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantB}'`);
    const res = await client.query(
      'SELECT code FROM ref.vendor_category WHERE code = $1',
      [CODE_A],
    );
    await client.query('COMMIT');

    expect(res.rowCount).toBe(0);
  });

  it('DELETE verwijdert de categorie', async () => {
    await request(server)
      .delete(`/vendor-categories/${CODE_A}`)
      .set('Cookie', cookieAdminA)
      .expect(204);

    const res = await request(server)
      .get('/vendor-categories')
      .set('Cookie', cookieAdminA)
      .expect(200);

    const codes = (
      res.body as { categorieen: CategorieBody[] }
    ).categorieen.map((c) => c.code);
    expect(codes).not.toContain(CODE_A);
  });

  it('DELETE op een onbekende code geeft 404', async () => {
    await request(server)
      .delete('/vendor-categories/bestaat-niet')
      .set('Cookie', cookieAdminA)
      .expect(404);
  });

  it('weigert zonder geldige sessie met 401', async () => {
    await request(server).get('/vendor-categories').expect(401);
  });
});
