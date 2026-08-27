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

/**
 * Platformbeheer-uitbreiding: tenant wijzigen/deactiveren, en de
 * sessiewissel voor één-klik support-toegang.
 *
 * Dekt de tien tegenproeven uit
 * docs/superpowers/specs/2026-08-27-platformbeheer-uitbreiding-design.md §8.
 */

const {
  platformbeheerder: PLATFORMBEHEERDER_ID,
  eigenTenant: EIGEN_TENANT_ID,
  doelTenant: DOEL_TENANT_ID,
  andereTenant: ANDERE_TENANT_ID,
  klantAdmin: KLANT_ADMIN_ID,
  gedeactiveerdeTenant: GEDEACTIVEERDE_TENANT_ID,
  openTenant: OPEN_TENANT_ID,
} = TEST_IDS['platform-uitbreiding'];

const STEMPEL = Date.now();
const SUBJECT_PLATFORMBEHEERDER = `oid-platform-uitbr-${STEMPEL}`;

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
  for (const t of [
    EIGEN_TENANT_ID,
    DOEL_TENANT_ID,
    ANDERE_TENANT_ID,
    GEDEACTIVEERDE_TENANT_ID,
    OPEN_TENANT_ID,
  ]) {
    await migratieClient.query('BEGIN');
    await migratieClient.query(`SET LOCAL app.current_tenant_id = '${t}'`);
    await migratieClient.query(
      'DELETE FROM clm.tenant_membership WHERE tenant_id = $1',
      [t],
    );
    await migratieClient.query('DELETE FROM clm."user" WHERE tenant_id = $1', [
      t,
    ]);
    await migratieClient.query('COMMIT');
  }
  await migratieClient.query('BEGIN');
  for (const t of [
    EIGEN_TENANT_ID,
    DOEL_TENANT_ID,
    ANDERE_TENANT_ID,
    GEDEACTIVEERDE_TENANT_ID,
    OPEN_TENANT_ID,
  ]) {
    await migratieClient.query(`SET LOCAL app.current_tenant_id = '${t}'`);
    await migratieClient.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [
      t,
    ]);
  }
  await migratieClient.query(
    'DELETE FROM clm.tenant_register WHERE register_id = ANY($1)',
    [
      [
        EIGEN_TENANT_ID,
        DOEL_TENANT_ID,
        ANDERE_TENANT_ID,
        GEDEACTIVEERDE_TENANT_ID,
        OPEN_TENANT_ID,
      ],
    ],
  );
  await migratieClient.query(
    'DELETE FROM clm.platform_admin WHERE user_id = $1',
    [PLATFORMBEHEERDER_ID],
  );
  await migratieClient.query('COMMIT');
}

describe('Platformbeheer-uitbreiding (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let migratieClient: Client;
  let platformbeheerderCookie: string;
  const cookieNaam = cookieInstellingen().naam;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    migratieClient = new Client({ connectionString: migratieUrl() });
    await migratieClient.connect();
    await opruimen(migratieClient);

    await client.query('BEGIN');
    await client.query(
      `SET LOCAL app.current_tenant_id = '${EIGEN_TENANT_ID}'`,
    );
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [EIGEN_TENANT_ID, `platform-uitbr-eigen-${STEMPEL}`],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, email, external_subject)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        PLATFORMBEHEERDER_ID,
        EIGEN_TENANT_ID,
        'Platformbeheerder Test',
        `platform-uitbr-${STEMPEL}@test.nl`,
        SUBJECT_PLATFORMBEHEERDER,
      ],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [PLATFORMBEHEERDER_ID, EIGEN_TENANT_ID],
    );
    await client.query('COMMIT');

    await migratieClient.query(
      'INSERT INTO clm.platform_admin (user_id) VALUES ($1)',
      [PLATFORMBEHEERDER_ID],
    );

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${DOEL_TENANT_ID}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [DOEL_TENANT_ID, `platform-uitbr-doel-${STEMPEL}`],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, email)
       VALUES ($1, $2, $3, $4)`,
      [
        KLANT_ADMIN_ID,
        DOEL_TENANT_ID,
        'Klant Admin',
        `klant-admin-${STEMPEL}@test.nl`,
      ],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [KLANT_ADMIN_ID, DOEL_TENANT_ID],
    );
    await client.query('COMMIT');

    await client.query('BEGIN');
    await client.query(
      `SET LOCAL app.current_tenant_id = '${ANDERE_TENANT_ID}'`,
    );
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [ANDERE_TENANT_ID, `platform-uitbr-ander-${STEMPEL}`],
    );
    await client.query('COMMIT');

    // Losse tenant voor de "Openen"/terugkeer-tests (9, 10): DOEL_TENANT_ID
    // wordt door test 3 gedeactiveerd, en die volgorde-afhankelijkheid mag
    // tests 9/10 niet raken.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${OPEN_TENANT_ID}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [OPEN_TENANT_ID, `platform-uitbr-open-${STEMPEL}`],
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
    const sessie = await sessies.aanmaken(SUBJECT_PLATFORMBEHEERDER);
    platformbeheerderCookie = `${cookieNaam}=${sessie!.token}`;
  });

  afterAll(async () => {
    await app.close();
    await opruimen(migratieClient);
    await client.end();
    await migratieClient.end();
  });

  it('1. wijzigen: naam-conflict geeft 409', async () => {
    const anderesNaam = `platform-uitbr-ander-${STEMPEL}`;

    const respons = await request(server)
      .put(`/platform/tenants/${DOEL_TENANT_ID}`)
      .set('Cookie', platformbeheerderCookie)
      .send({ naam: anderesNaam });

    expect(respons.status).toBe(409);
  });

  it('2. wijzigen: audit-event tenant_gewijzigd staat met oude/nieuwe waarden', async () => {
    const nieuweNaam = `platform-uitbr-doel-gewijzigd-${STEMPEL}`;

    const respons = await request(server)
      .put(`/platform/tenants/${DOEL_TENANT_ID}`)
      .set('Cookie', platformbeheerderCookie)
      .send({ naam: nieuweNaam, antwoordEmail: 'nieuw@test.nl' });

    expect(respons.status).toBe(200);
    expect((respons.body as { naam: string }).naam).toBe(nieuweNaam);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${DOEL_TENANT_ID}'`);
    const audit = await client.query<{
      new_values: { naam: string };
    }>(
      `SELECT new_values FROM audit.audit_event
        WHERE tenant_id = $1 AND action_type = 'tenant_gewijzigd'
        ORDER BY created_at DESC LIMIT 1`,
      [DOEL_TENANT_ID],
    );
    await client.query('COMMIT');

    expect(audit.rows[0]?.new_values.naam).toBe(nieuweNaam);
  });

  it('3. deactiveren: de tenant verdwijnt uit GET /platform/tenants', async () => {
    const voorLijst = await request(server)
      .get('/platform/tenants')
      .set('Cookie', platformbeheerderCookie);
    const idsVoor = (
      voorLijst.body as { tenants: { tenantId: string }[] }
    ).tenants.map((t) => t.tenantId);
    expect(idsVoor).toContain(DOEL_TENANT_ID);

    const deactiveerRespons = await request(server)
      .post(`/platform/tenants/${DOEL_TENANT_ID}/deactiveren`)
      .set('Cookie', platformbeheerderCookie);
    expect(deactiveerRespons.status).toBe(201);

    const naLijst = await request(server)
      .get('/platform/tenants')
      .set('Cookie', platformbeheerderCookie);
    const idsNa = (
      naLijst.body as { tenants: { tenantId: string }[] }
    ).tenants.map((t) => t.tenantId);
    expect(idsNa).not.toContain(DOEL_TENANT_ID);
  });

  it('4. deactiveren: een gedeactiveerde tenant kan niet meer inloggen', async () => {
    await client.query('BEGIN');
    await client.query(
      `SET LOCAL app.current_tenant_id = '${GEDEACTIVEERDE_TENANT_ID}'`,
    );
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [GEDEACTIVEERDE_TENANT_ID, `platform-uitbr-gedeact-${STEMPEL}`],
    );
    const gebruikerId = crypto.randomUUID();
    const subject = `oid-gedeact-${STEMPEL}`;
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, email, external_subject)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        gebruikerId,
        GEDEACTIVEERDE_TENANT_ID,
        'Gedeactiveerd Lid',
        `gedeact-${STEMPEL}@test.nl`,
        subject,
      ],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [gebruikerId, GEDEACTIVEERDE_TENANT_ID],
    );
    await client.query('COMMIT');

    await request(server)
      .post(`/platform/tenants/${GEDEACTIVEERDE_TENANT_ID}/deactiveren`)
      .set('Cookie', platformbeheerderCookie);

    const sessies = app.get(SessieService);
    const sessie = await sessies.aanmaken(subject);

    expect(sessie).toBeNull();
  });

  it('5. deactiveren: sessie_wisselen naar een gedeactiveerde tenant faalt', async () => {
    const respons = await request(server)
      .post('/platform/sessie/wisselen')
      .set('Cookie', platformbeheerderCookie)
      .send({ tenantId: GEDEACTIVEERDE_TENANT_ID });

    expect(respons.status).toBe(404);
  });

  it('6. deactiveren: dubbel deactiveren geeft 404', async () => {
    const respons = await request(server)
      .post(`/platform/tenants/${GEDEACTIVEERDE_TENANT_ID}/deactiveren`)
      .set('Cookie', platformbeheerderCookie);

    expect(respons.status).toBe(404);
  });

  it('7. sessiewissel: zonder geldig membership op de doeltenant faalt', async () => {
    const sessies = app.get(SessieService);
    const ruwToken = platformbeheerderCookie.split('=')[1];

    const platformbeheerderSessie = await sessies.oplossen(ruwToken);
    expect(platformbeheerderSessie).not.toBeNull();

    const wisselResultaat = await sessies.wisselen(ruwToken, ANDERE_TENANT_ID);

    expect(wisselResultaat).toBeNull();
  });

  it('8. sessiewissel: de oorspronkelijke sessie blijft geldig', async () => {
    const sessies = app.get(SessieService);
    const ruwToken = platformbeheerderCookie.split('=')[1];

    const voorWissel = await sessies.oplossen(ruwToken);
    expect(voorWissel).not.toBeNull();

    await sessies.wisselen(ruwToken, DOEL_TENANT_ID);

    const naWissel = await sessies.oplossen(ruwToken);
    expect(naWissel).not.toBeNull();
    expect(naWissel!.tenantId).toBe(EIGEN_TENANT_ID);
  });

  it('9. één-klik Openen: support-membership met reden Platformbeheer en een werkend cookie', async () => {
    const respons = await request(server)
      .post('/platform/sessie/wisselen')
      .set('Cookie', platformbeheerderCookie)
      .send({ tenantId: OPEN_TENANT_ID });

    expect(respons.status).toBe(201);
    expect((respons.body as { rol: string }).rol).toBe('support');

    const nieuwCookie = respons.headers['set-cookie'];
    expect(nieuwCookie).toBeDefined();

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${OPEN_TENANT_ID}'`);
    const membership = await client.query<{ reden: string; role: string }>(
      `SELECT reden, role FROM clm.tenant_membership
        WHERE user_id = $1 AND tenant_id = $2`,
      [PLATFORMBEHEERDER_ID, OPEN_TENANT_ID],
    );
    await client.query('COMMIT');

    expect(membership.rows[0]?.role).toBe('support');
    expect(membership.rows[0]?.reden).toBe('Platformbeheer');
  });

  it('10. terugkeer: /platform/sessie/eigen-tenant wisselt terug naar de blijvende rol', async () => {
    const wisselRespons = await request(server)
      .post('/platform/sessie/wisselen')
      .set('Cookie', platformbeheerderCookie)
      .send({ tenantId: OPEN_TENANT_ID });

    const supportCookieHeader = (
      wisselRespons.headers['set-cookie'] as unknown as string[]
    )[0];
    const supportCookie = supportCookieHeader.split(';')[0];

    const terugRespons = await request(server)
      .post('/platform/sessie/eigen-tenant')
      .set('Cookie', supportCookie);

    expect(terugRespons.status).toBe(201);
    expect(terugRespons.body as { tenantId: string; rol: string }).toEqual({
      tenantId: EIGEN_TENANT_ID,
      rol: 'admin',
    });
  });
});
