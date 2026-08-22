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
 * GET /tenant/gebruikers: de keuzelijst voor bv. de contractbeheerder-
 * dropdown. Zelfde twee vragen als de andere suites: mag een reviewer lezen
 * (moet, het is geen gevoelige data), en werkt de sessiegrens.
 */

const { tenant, adminUser, reviewerUser, andereTenant } =
  TEST_IDS['tenant-gebruikers'];

const STEMPEL = Date.now();
const SUBJECT_ADMIN = `oid-tg-admin-${STEMPEL}`;
const SUBJECT_REVIEWER = `oid-tg-reviewer-${STEMPEL}`;

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

describe('Tenant-gebruikers (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let migratieClient: Client;
  let adminCookie: string;
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
      [tenant, 'tenant-gebruikers-test'],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
       VALUES ($1, $2, $3, $4), ($5, $2, $6, $7)`,
      [
        adminUser,
        tenant,
        'Anna Admin',
        SUBJECT_ADMIN,
        reviewerUser,
        'Rob Reviewer',
        SUBJECT_REVIEWER,
      ],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin'), ($3, $2, 'reviewer')`,
      [adminUser, tenant, reviewerUser],
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
  });

  afterAll(async () => {
    await app.close();
    await opruimen(migratieClient);
    await client.end();
    await migratieClient.end();
  });

  it('geeft de gebruikers van de eigen tenant, met naam', async () => {
    const respons = await request(server)
      .get('/tenant/gebruikers')
      .set('Cookie', adminCookie);

    expect(respons.status).toBe(200);
    const namen = (
      respons.body as { gebruikers: { naam: string }[] }
    ).gebruikers.map((g) => g.naam);
    expect(namen).toContain('Anna Admin');
    expect(namen).toContain('Rob Reviewer');
  });

  it('reviewer mag ook lezen — het is een keuzelijst, geen gevoelige data', async () => {
    const sessies = app.get(SessieService);
    const reviewerSessie = await sessies.aanmaken(SUBJECT_REVIEWER);
    const reviewerCookie = `${cookieNaam}=${reviewerSessie!.token}`;

    const respons = await request(server)
      .get('/tenant/gebruikers')
      .set('Cookie', reviewerCookie);

    expect(respons.status).toBe(200);
  });

  it('geeft 401 zonder sessie', async () => {
    await request(server).get('/tenant/gebruikers').expect(401);
  });
});
