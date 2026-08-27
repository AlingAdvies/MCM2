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
 * /tenant/leden (issue #75): een tenant-admin kan zelf collega's uitnodigen,
 * hun rol wijzigen en hun toegang intrekken. Dekt de tegenproeven uit
 * docs/superpowers/specs/2026-08-27-tenant-gebruikersbeheer-design.md §11.
 */

const {
  tenant,
  admin,
  tweedeAdmin,
  reviewer,
  andereTenant,
  adminAndereTenant,
} = TEST_IDS['tenant-leden'];

const STEMPEL = Date.now();
const SUBJECT_ADMIN = `oid-tl-admin-${STEMPEL}`;
const SUBJECT_TWEEDE_ADMIN = `oid-tl-tweede-admin-${STEMPEL}`;
const SUBJECT_REVIEWER = `oid-tl-reviewer-${STEMPEL}`;
const SUBJECT_ADMIN_ANDERE_TENANT = `oid-tl-admin-andere-${STEMPEL}`;

/** Migratierol, altijd naar dezelfde database als DATABASE_URL. */
function migratieUrl(): string {
  const runtime = process.env.DATABASE_URL;
  if (!runtime) throw new Error('DATABASE_URL ontbreekt.');
  const doel = new URL(runtime);
  const expliciet = process.env.MIGRATION_DATABASE_URL;
  if (expliciet) {
    const gegeven = new URL(expliciet);
    if (gegeven.host === doel.host && gegeven.pathname === doel.pathname) {
      return expliciet;
    }
  }
  doel.username = 'clm_migrator';
  return doel.toString();
}

async function opruimen(migratieClient: Client): Promise<void> {
  for (const t of [tenant, andereTenant]) {
    await migratieClient.query('BEGIN');
    await migratieClient.query(`SET LOCAL app.current_tenant_id = '${t}'`);
    await migratieClient.query(
      'DELETE FROM clm.tenant_membership WHERE tenant_id = $1',
      [t],
    );
    await migratieClient.query('DELETE FROM clm."user" WHERE tenant_id = $1', [
      t,
    ]);
    await migratieClient.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [
      t,
    ]);
    await migratieClient.query('COMMIT');
  }
}

describe('Tenant-leden (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let migratieClient: Client;
  let adminCookie: string;
  let reviewerCookie: string;
  let adminAndereTenantCookie: string;
  const cookieNaam = cookieInstellingen().naam;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    migratieClient = new Client({ connectionString: migratieUrl() });
    await migratieClient.connect();
    await opruimen(migratieClient);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenant, 'tenant-leden-test'],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, email, external_subject)
       VALUES ($1, $2, $3, $4, $5)`,
      [admin, tenant, 'Anna Admin', 'anna@tenant-leden-test.nl', SUBJECT_ADMIN],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, email, external_subject)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        reviewer,
        tenant,
        'Rob Reviewer',
        'rob@tenant-leden-test.nl',
        SUBJECT_REVIEWER,
      ],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin'), ($3, $2, 'reviewer')`,
      [admin, tenant, reviewer],
    );
    await client.query('COMMIT');

    // Tweede tenant, met eigen admin — voor de tenantgrens-tegenproef.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${andereTenant}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [andereTenant, 'tenant-leden-andere-test'],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, email, external_subject)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        adminAndereTenant,
        andereTenant,
        'Anton Andere',
        'anton@tenant-leden-andere-test.nl',
        SUBJECT_ADMIN_ANDERE_TENANT,
      ],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [adminAndereTenant, andereTenant],
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
    const adminSessie = await sessies.aanmaken(SUBJECT_ADMIN);
    adminCookie = `${cookieNaam}=${adminSessie!.token}`;
    const reviewerSessie = await sessies.aanmaken(SUBJECT_REVIEWER);
    reviewerCookie = `${cookieNaam}=${reviewerSessie!.token}`;
    const adminAndereTenantSessie = await sessies.aanmaken(
      SUBJECT_ADMIN_ANDERE_TENANT,
    );
    adminAndereTenantCookie = `${cookieNaam}=${adminAndereTenantSessie!.token}`;
  });

  afterAll(async () => {
    await app.close();
    await opruimen(migratieClient);
    await client.end();
    await migratieClient.end();
  });

  describe('POST /tenant/leden', () => {
    it('een admin kan een collega uitnodigen', async () => {
      const respons = await request(server)
        .post('/tenant/leden')
        .set('Cookie', adminCookie)
        .send({ email: 'nieuw@tenant-leden-test.nl', rol: 'user' });

      expect(respons.status).toBe(201);
      expect(
        (respons.body as { uitnodigingslink: string }).uitnodigingslink,
      ).toContain('uitnodiging=');
    });

    it('een reviewer krijgt 403', async () => {
      const respons = await request(server)
        .post('/tenant/leden')
        .set('Cookie', reviewerCookie)
        .send({ email: 'x@tenant-leden-test.nl', rol: 'user' });

      expect(respons.status).toBe(403);
    });

    it('weigert een e-mailadres met een al-actieve membership in dezelfde tenant', async () => {
      await request(server)
        .post('/tenant/leden')
        .set('Cookie', adminCookie)
        .send({ email: 'dubbel@tenant-leden-test.nl', rol: 'reviewer' });

      const respons = await request(server)
        .post('/tenant/leden')
        .set('Cookie', adminCookie)
        .send({ email: 'dubbel@tenant-leden-test.nl', rol: 'user' });

      expect(respons.status).toBe(409);
    });

    it('een e-mailadres met een actieve membership bij een andere tenant is los uitnodigbaar', async () => {
      // Bewust geen 409 hier: RLS maakt een cross-tenant check onmogelijk
      // zonder een aparte SECURITY DEFINER-functie, en de eigenaar heeft
      // besloten die niet te bouwen (27-08) — zie het commentaar in
      // TenantLedenService.uitnodigen(). Hetzelfde e-mailadres kan dus los
      // bij meerdere tenants een user-rij krijgen; de tenant-isolatie zelf
      // blijft intact (elke rij hoort bij precies één tenant).
      const respons = await request(server)
        .post('/tenant/leden')
        .set('Cookie', adminCookie)
        .send({
          email: 'anton@tenant-leden-andere-test.nl',
          rol: 'reviewer',
        });

      expect(respons.status).toBe(201);
    });

    it('nodigt een eerder ingetrokken gebruiker opnieuw uit door de bestaande rij bij te werken', async () => {
      const eerste = await request(server)
        .post('/tenant/leden')
        .set('Cookie', adminCookie)
        .send({ email: 'herstel@tenant-leden-test.nl', rol: 'reviewer' });

      const lijstVoorId = await request(server)
        .get('/tenant/leden')
        .set('Cookie', adminCookie);
      const lidVoor = (
        lijstVoorId.body as {
          leden: { userId: string; email: string }[];
        }
      ).leden.find((l) => l.email === 'herstel@tenant-leden-test.nl');

      await request(server)
        .post(`/tenant/leden/${lidVoor!.userId}/intrekken`)
        .set('Cookie', adminCookie);

      const tweede = await request(server)
        .post('/tenant/leden')
        .set('Cookie', adminCookie)
        .send({ email: 'herstel@tenant-leden-test.nl', rol: 'user' });

      expect(tweede.status).toBe(201);
      expect((tweede.body as { userId: string }).userId).toBe(lidVoor!.userId);
      expect((tweede.body as { rol: string }).rol).toBe('user');
    });
  });

  describe('GET /tenant/leden — tenantgrens', () => {
    it('toont geen leden van een andere tenant', async () => {
      const respons = await request(server)
        .get('/tenant/leden')
        .set('Cookie', adminAndereTenantCookie);

      const ids = (respons.body as { leden: { userId: string }[] }).leden.map(
        (l) => l.userId,
      );
      expect(ids).not.toContain(admin);
    });
  });

  describe('elke route weigert reviewer (tegenproeven 1 en 2)', () => {
    it('GET /tenant/leden geeft 403 voor reviewer', async () => {
      const respons = await request(server)
        .get('/tenant/leden')
        .set('Cookie', reviewerCookie);

      expect(respons.status).toBe(403);
    });

    it('PUT rol geeft 403 voor reviewer', async () => {
      const respons = await request(server)
        .put(`/tenant/leden/${reviewer}/rol`)
        .set('Cookie', reviewerCookie)
        .send({ rol: 'admin' });

      expect(respons.status).toBe(403);
    });

    it('POST intrekken geeft 403 voor reviewer', async () => {
      const respons = await request(server)
        .post(`/tenant/leden/${reviewer}/intrekken`)
        .set('Cookie', reviewerCookie);

      expect(respons.status).toBe(403);
    });
  });

  describe('laatste-admin-bescherming', () => {
    it('kan de enige admin niet degraderen', async () => {
      const respons = await request(server)
        .put(`/tenant/leden/${admin}/rol`)
        .set('Cookie', adminCookie)
        .send({ rol: 'user' });

      expect(respons.status).toBe(409);
    });

    it('kan de enige admin niet intrekken', async () => {
      const respons = await request(server)
        .post(`/tenant/leden/${admin}/intrekken`)
        .set('Cookie', adminCookie);

      expect(respons.status).toBe(409);
    });

    it('kan wél degraderen zodra er een tweede admin is', async () => {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
      await client.query(
        `INSERT INTO clm."user" (user_id, tenant_id, full_name, email, external_subject)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          tweedeAdmin,
          tenant,
          'Tessa TweedeAdmin',
          'tessa@tenant-leden-test.nl',
          SUBJECT_TWEEDE_ADMIN,
        ],
      );
      await client.query(
        `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
         VALUES ($1, $2, 'admin')`,
        [tweedeAdmin, tenant],
      );
      await client.query('COMMIT');

      const respons = await request(server)
        .put(`/tenant/leden/${admin}/rol`)
        .set('Cookie', adminCookie)
        .send({ rol: 'reviewer' });

      expect(respons.status).toBe(204);

      // Terugzetten voor eventuele volgende tests in dit bestand.
      await request(server)
        .put(`/tenant/leden/${admin}/rol`)
        .set('Cookie', adminCookie)
        .send({ rol: 'admin' });
    });
  });

  describe('intrekken bewaart geschiedenis', () => {
    it('een ingetrokken gebruiker blijft zichtbaar met status ingetrokken', async () => {
      const uitnodigen = await request(server)
        .post('/tenant/leden')
        .set('Cookie', adminCookie)
        .send({ email: 'intrek@tenant-leden-test.nl', rol: 'reviewer' });
      const userId = (uitnodigen.body as { userId: string }).userId;

      const intrekken = await request(server)
        .post(`/tenant/leden/${userId}/intrekken`)
        .set('Cookie', adminCookie);
      expect(intrekken.status).toBe(204);

      const lijst = await request(server)
        .get('/tenant/leden')
        .set('Cookie', adminCookie);
      const ingetrokken = (
        lijst.body as {
          leden: { userId: string; status: string }[];
        }
      ).leden.find((l) => l.userId === userId);

      expect(ingetrokken?.status).toBe('ingetrokken');
    });
  });
});
