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
 * Contractroutes: tenantgrens en rolcontrole.
 *
 * Zelfde twee vragen als vendor-detail.e2e-spec.ts: kan een reviewer
 * schrijven (moet niet), en kan tenant A bij de contracten van tenant B zien
 * (moet niet).
 */

const { tenant, adminUser, reviewerUser, andereTenant, andereUser } =
  TEST_IDS['contract-routes'];

const STEMPEL = Date.now();
const SUBJECT_ADMIN = `oid-contract-admin-${STEMPEL}`;
const SUBJECT_REVIEWER = `oid-contract-reviewer-${STEMPEL}`;
const SUBJECT_ANDER = `oid-contract-ander-${STEMPEL}`;

interface ContractAntwoord {
  contractId: string;
  vendorId: string;
  name: string;
  contractNumber: string | null;
  statusCode: string | null;
}

function alsContract(body: unknown): ContractAntwoord {
  return body as ContractAntwoord;
}

/**
 * Migratierol, altijd naar dezelfde database als DATABASE_URL.
 *
 * Nodig omdat clm_api_runtime sinds migratie 0027 geen DELETE meer heeft op
 * clm.contract (NIET_VERWIJDEREN in rechten-contract.ts — een contract wordt
 * zacht verwijderd, net als vendor). Testopruiming ruimt hard op en heeft
 * daarom de migratierol nodig, zelfde patroon als platform-routes.e2e-spec.ts.
 */
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

async function verwijderTestdata(migratieClient: Client): Promise<void> {
  for (const t of [tenant, andereTenant]) {
    await migratieClient.query('BEGIN');
    await migratieClient.query(`SET LOCAL app.current_tenant_id = '${t}'`);
    // contract_survey_template en survey_template moeten eerst weg: FK naar
    // clm.contract.
    await migratieClient.query(
      'DELETE FROM clm.contract_survey_template WHERE tenant_id = $1',
      [t],
    );
    await migratieClient.query(
      'DELETE FROM clm.survey_template WHERE tenant_id = $1',
      [t],
    );
    await migratieClient.query(
      'DELETE FROM clm.contract WHERE tenant_id = $1',
      [t],
    );
    await migratieClient.query(
      'DELETE FROM clm.vendor_contact WHERE tenant_id = $1',
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

describe('Contractroutes (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let migratieClient: Client;
  let sessies: SessieService;

  let adminCookie: string;
  let reviewerCookie: string;
  let vendorId: string;

  const cookieNaam = cookieInstellingen().naam;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    migratieClient = new Client({ connectionString: migratieUrl() });
    await migratieClient.connect();

    await verwijderTestdata(migratieClient);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenant, 'contract-test'],
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

    const vendorResultaat = await client.query<{ vendor_id: string }>(
      `INSERT INTO clm.vendor (tenant_id, name) VALUES ($1, $2)
       RETURNING vendor_id`,
      [tenant, `Testleverancier-${STEMPEL}`],
    );
    vendorId = vendorResultaat.rows[0].vendor_id;

    await client.query('COMMIT');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();

    sessies = app.get(SessieService);

    const adminSessie = await sessies.aanmaken(SUBJECT_ADMIN);
    const reviewerSessie = await sessies.aanmaken(SUBJECT_REVIEWER);

    adminCookie = `${cookieNaam}=${adminSessie!.token}`;
    reviewerCookie = `${cookieNaam}=${reviewerSessie!.token}`;
  });

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(migratieClient);
    await client.end();
    await migratieClient.end();
  });

  it('admin kan een contract aanmaken', async () => {
    const respons = await request(server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie)
      .send({ name: 'Hosting 2024-2027', contractNumber: 'ERP-4711' });

    expect(respons.status).toBe(201);
    const contract = alsContract(respons.body);
    expect(contract.name).toBe('Hosting 2024-2027');
    expect(contract.contractNumber).toBe('ERP-4711');
    expect(contract.vendorId).toBe(vendorId);
  });

  it('reviewer kan geen contract aanmaken (403)', async () => {
    const respons = await request(server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', reviewerCookie)
      .send({ name: 'Verboden contract' });

    expect(respons.status).toBe(403);
  });

  it('admin kan de lijst met contracten van de leverancier ophalen', async () => {
    const respons = await request(server)
      .get(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie);

    expect(respons.status).toBe(200);
    const lijst = (respons.body as { contracten: unknown[] }).contracten;
    expect(Array.isArray(lijst)).toBe(true);
    expect(lijst.length).toBeGreaterThan(0);
  });

  it('reviewer kan de lijst wél lezen (alleen schrijven is geblokkeerd)', async () => {
    const respons = await request(server)
      .get(`/vendors/${vendorId}/contracts`)
      .set('Cookie', reviewerCookie);

    expect(respons.status).toBe(200);
  });

  it('een tweede tenant ziet de contracten van tenant A niet', async () => {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${andereTenant}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [andereTenant, 'contract-test-ander'],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
       VALUES ($1, $2, $3, $4)`,
      [andereUser, andereTenant, 'Bob Buiten', SUBJECT_ANDER],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [andereUser, andereTenant],
    );
    await client.query('COMMIT');

    const andereSessie = await sessies.aanmaken(SUBJECT_ANDER);
    const andereCookie = `${cookieNaam}=${andereSessie!.token}`;

    // Directe vendor-id van tenant A opvragen vanuit tenant B: RLS filtert
    // 'm weg, dus het scherm ziet niets — geen aparte foutmelding die zou
    // verklappen dat de vendor elders wél bestaat.
    const respons = await request(server)
      .get(`/vendors/${vendorId}/contracts`)
      .set('Cookie', andereCookie);

    expect(respons.status).toBe(200);
    expect((respons.body as { contracten: unknown[] }).contracten).toEqual([]);
  });

  it('wijzigen van een niet-bestaand contract geeft 404', async () => {
    const respons = await request(server)
      .patch(
        `/vendors/${vendorId}/contracts/00000000-0000-0000-0000-000000000000`,
      )
      .set('Cookie', adminCookie)
      .send({ name: 'Bestaat niet' });

    expect(respons.status).toBe(404);
  });

  it('een contract aanmaken zonder naam geeft 400 met veldnaam', async () => {
    const respons = await request(server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie)
      .send({});

    expect(respons.status).toBe(400);
    expect((respons.body as { veld: string }).veld).toBe('Naam');
  });

  it('admin kan een contract verwijderen (soft delete)', async () => {
    const aangemaakt = await request(server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie)
      .send({ name: 'Te verwijderen contract' });

    const contractId = alsContract(aangemaakt.body).contractId;

    const verwijderd = await request(server)
      .delete(`/vendors/${vendorId}/contracts/${contractId}`)
      .set('Cookie', adminCookie);

    expect(verwijderd.status).toBe(204);

    const opgehaald = await request(server)
      .get(`/vendors/${vendorId}/contracts/${contractId}`)
      .set('Cookie', adminCookie);

    expect(opgehaald.status).toBe(404);
  });

  it('admin kan opzegtermijn, waarschuwingstermijn en verlengt-automatisch meegeven', async () => {
    const respons = await request(server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie)
      .send({
        name: 'Hosting met opzegtermijn',
        endDate: '2027-12-31',
        noticePeriodDays: '90',
        warningDaysBefore: '30',
        autoRenews: 'ja',
      });

    expect(respons.status).toBe(201);
    expect((respons.body as { noticePeriodDays: number }).noticePeriodDays).toBe(
      90,
    );
    expect(
      (respons.body as { warningDaysBefore: number }).warningDaysBefore,
    ).toBe(30);
    expect((respons.body as { autoRenews: string }).autoRenews).toBe('ja');
  });

  it('warningDaysBefore is 90 wanneer niet meegegeven', async () => {
    const respons = await request(server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie)
      .send({ name: 'Hosting zonder opgave' });

    expect(respons.status).toBe(201);
    expect(
      (respons.body as { warningDaysBefore: number }).warningDaysBefore,
    ).toBe(90);
    expect(
      (respons.body as { noticePeriodDays: number | null }).noticePeriodDays,
    ).toBeNull();
    expect((respons.body as { autoRenews: string | null }).autoRenews).toBeNull();
  });

  it('weigert een ongeldige autoRenews-waarde', async () => {
    const respons = await request(server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie)
      .send({ name: 'Hosting', autoRenews: 'misschien' });

    expect(respons.status).toBe(400);
    expect((respons.body as { veld: string }).veld).toBe('Verlengt automatisch');
  });

  it('admin kan autoRenews wijzigen op een bestaand contract', async () => {
    const aangemaakt = await request(server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie)
      .send({ name: 'Wijzigtest', autoRenews: 'onbekend' });

    const contractId = alsContract(aangemaakt.body).contractId;

    const gewijzigd = await request(server)
      .patch(`/vendors/${vendorId}/contracts/${contractId}`)
      .set('Cookie', adminCookie)
      .send({ autoRenews: 'nee' });

    expect(gewijzigd.status).toBe(200);
    expect((gewijzigd.body as { autoRenews: string }).autoRenews).toBe('nee');
  });

  it('koppelt en ontkoppelt vragenlijst-templates aan een contract', async () => {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    const templateResultaat = await client.query<{ template_id: string }>(
      `INSERT INTO clm.survey_template (tenant_id, name, version)
       VALUES ($1, $2, 1) RETURNING template_id`,
      [tenant, `Testvragenlijst-${STEMPEL}`],
    );
    await client.query('COMMIT');
    const templateId = templateResultaat.rows[0].template_id;

    const aangemaakt = await request(server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie)
      .send({ name: 'Contract met vragenlijst' });
    const contractId = alsContract(aangemaakt.body).contractId;

    const gekoppeld = await request(server)
      .put(`/vendors/${vendorId}/contracts/${contractId}/survey-templates`)
      .set('Cookie', adminCookie)
      .send({ templateIds: [templateId] });

    expect(gekoppeld.status).toBe(200);
    expect((gekoppeld.body as { templateIds: string[] }).templateIds).toEqual([
      templateId,
    ]);

    const opgehaald = await request(server)
      .get(`/vendors/${vendorId}/contracts/${contractId}/survey-templates`)
      .set('Cookie', adminCookie);

    expect((opgehaald.body as { templateIds: string[] }).templateIds).toEqual([
      templateId,
    ]);

    const ontkoppeld = await request(server)
      .put(`/vendors/${vendorId}/contracts/${contractId}/survey-templates`)
      .set('Cookie', adminCookie)
      .send({ templateIds: [] });

    expect(ontkoppeld.status).toBe(200);
    expect((ontkoppeld.body as { templateIds: string[] }).templateIds).toEqual(
      [],
    );
  });

  it('zet en leest wachtlijstTemplateIds naast de gewone koppeling', async () => {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    const templateResultaat = await client.query<{ template_id: string }>(
      `INSERT INTO clm.survey_template (tenant_id, name, version)
       VALUES ($1, $2, 1) RETURNING template_id`,
      [tenant, `Wachtlijsttest-${STEMPEL}`],
    );
    await client.query('COMMIT');
    const templateId = templateResultaat.rows[0].template_id;

    const aangemaakt = await request(server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie)
      .send({ name: 'Contract met wachtlijst' });
    const contractId = alsContract(aangemaakt.body).contractId;

    const gekoppeld = await request(server)
      .put(`/vendors/${vendorId}/contracts/${contractId}/survey-templates`)
      .set('Cookie', adminCookie)
      .send({
        templateIds: [templateId],
        wachtlijstTemplateIds: [templateId],
      });

    expect(gekoppeld.status).toBe(200);
    expect(
      (gekoppeld.body as { wachtlijstTemplateIds: string[] })
        .wachtlijstTemplateIds,
    ).toEqual([templateId]);

    const opgehaald = await request(server)
      .get(`/vendors/${vendorId}/contracts/${contractId}/survey-templates`)
      .set('Cookie', adminCookie);

    expect(
      (opgehaald.body as { wachtlijstTemplateIds: string[] })
        .wachtlijstTemplateIds,
    ).toEqual([templateId]);
  });

  it('reviewer kan geen templates koppelen (403)', async () => {
    const aangemaakt = await request(server)
      .post(`/vendors/${vendorId}/contracts`)
      .set('Cookie', adminCookie)
      .send({ name: 'Contract zonder reviewer-koppeling' });
    const contractId = alsContract(aangemaakt.body).contractId;

    const respons = await request(server)
      .put(`/vendors/${vendorId}/contracts/${contractId}/survey-templates`)
      .set('Cookie', reviewerCookie)
      .send({ templateIds: [] });

    expect(respons.status).toBe(403);
  });
});
