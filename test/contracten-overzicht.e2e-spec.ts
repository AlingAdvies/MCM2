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
 * GET /contracts (issue #173): tenant-breed contractenoverzicht. Dekt de
 * tegenproeven uit
 * docs/superpowers/specs/2026-08-27-contracten-toppagina-design.md §5.
 */

const { tenant, admin, reviewer, andereTenant } =
  TEST_IDS['contracten-overzicht'];

const STEMPEL = Date.now();
const SUBJECT_ADMIN = `oid-co-admin-${STEMPEL}`;
const SUBJECT_REVIEWER = `oid-co-reviewer-${STEMPEL}`;

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
      'DELETE FROM clm.contract WHERE tenant_id = $1',
      [t],
    );
    await migratieClient.query('DELETE FROM clm.vendor WHERE tenant_id = $1', [
      t,
    ]);
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

describe('GET /contracts — tenant-breed overzicht (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let migratieClient: Client;
  let adminCookie: string;
  let reviewerCookie: string;
  const cookieNaam = cookieInstellingen().naam;

  let vendorAId: string;
  let vendorBId: string;
  let contract1Id: string;
  let contract2Id: string;
  let contractAndereTenantId: string;

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
      [tenant, 'contracten-overzicht-test'],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, email, external_subject)
       VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)`,
      [
        admin,
        tenant,
        'Anna Admin',
        'anna@contracten-overzicht-test.nl',
        SUBJECT_ADMIN,
        reviewer,
        tenant,
        'Rob Reviewer',
        'rob@contracten-overzicht-test.nl',
        SUBJECT_REVIEWER,
      ],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin'), ($3, $2, 'reviewer')`,
      [admin, tenant, reviewer],
    );

    const vendorRijA = await client.query<{ vendor_id: string }>(
      `INSERT INTO clm.vendor (tenant_id, name) VALUES ($1, $2) RETURNING vendor_id`,
      [tenant, 'Leverancier A'],
    );
    vendorAId = vendorRijA.rows[0].vendor_id;
    const vendorRijB = await client.query<{ vendor_id: string }>(
      `INSERT INTO clm.vendor (tenant_id, name) VALUES ($1, $2) RETURNING vendor_id`,
      [tenant, 'Leverancier B'],
    );
    vendorBId = vendorRijB.rows[0].vendor_id;

    const c1 = await client.query<{ contract_id: string }>(
      `INSERT INTO clm.contract (tenant_id, vendor_id, name, value_eur, end_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING contract_id`,
      [tenant, vendorAId, 'Contract Een', '1000.00', '2027-01-01'],
    );
    contract1Id = c1.rows[0].contract_id;
    const c2 = await client.query<{ contract_id: string }>(
      `INSERT INTO clm.contract (tenant_id, vendor_id, name, value_eur, end_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING contract_id`,
      [tenant, vendorBId, 'Contract Twee', '2000.00', '2026-06-01'],
    );
    contract2Id = c2.rows[0].contract_id;
    await client.query('COMMIT');

    // Een tweede tenant met eigen data — nodig om de RLS-tegenproef
    // (spec §5, tegenproef 2) echt te laten bewijzen dat de query niet
    // per ongeluk tenants samenvoegt.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${andereTenant}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [andereTenant, 'contracten-overzicht-andere-tenant-test'],
    );
    const vendorRijAndereTenant = await client.query<{ vendor_id: string }>(
      `INSERT INTO clm.vendor (tenant_id, name) VALUES ($1, $2) RETURNING vendor_id`,
      [andereTenant, 'Leverancier Andere Tenant'],
    );
    const cAndereTenant = await client.query<{ contract_id: string }>(
      `INSERT INTO clm.contract (tenant_id, vendor_id, name, end_date)
       VALUES ($1, $2, $3, $4) RETURNING contract_id`,
      [
        andereTenant,
        vendorRijAndereTenant.rows[0].vendor_id,
        'Contract Andere Tenant',
        '2026-12-01',
      ],
    );
    contractAndereTenantId = cAndereTenant.rows[0].contract_id;
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
  });

  afterAll(async () => {
    await app.close();
    await opruimen(migratieClient);
    await client.end();
    await migratieClient.end();
  });

  it('toont contracten van meerdere leveranciers, gesorteerd op einddatum', async () => {
    const respons = await request(server)
      .get('/contracts')
      .set('Cookie', adminCookie);

    expect(respons.status).toBe(200);
    const contracten = (
      respons.body as {
        contracten: { contractId: string; vendorNaam: string }[];
      }
    ).contracten;
    const ids = contracten.map((c) => c.contractId);
    expect(ids).toContain(contract1Id);
    expect(ids).toContain(contract2Id);
    // Contract Twee (2026-06-01) hoort vóór Contract Een (2027-01-01).
    expect(ids.indexOf(contract2Id)).toBeLessThan(ids.indexOf(contract1Id));
  });

  it('een reviewer krijgt 200 — lezen mag iedereen', async () => {
    const respons = await request(server)
      .get('/contracts')
      .set('Cookie', reviewerCookie);

    expect(respons.status).toBe(200);
  });

  it('toont het echte valueEur, niet leeg', async () => {
    const respons = await request(server)
      .get('/contracts')
      .set('Cookie', adminCookie);

    const contracten = (
      respons.body as {
        contracten: { contractId: string; valueEur: string | null }[];
      }
    ).contracten;
    const gevonden = contracten.find((c) => c.contractId === contract1Id);
    expect(gevonden?.valueEur).toBe('1000.00');
  });

  it('toont geen contracten van een andere tenant (RLS-tegenproef)', async () => {
    const respons = await request(server)
      .get('/contracts')
      .set('Cookie', adminCookie);

    const contracten = (
      respons.body as { contracten: { contractId: string }[] }
    ).contracten;
    const ids = contracten.map((c) => c.contractId);

    expect(ids).toContain(contract1Id);
    expect(ids).toContain(contract2Id);
    expect(ids).not.toContain(contractAndereTenantId);
    expect(contracten.length).toBe(2);
  });
});
