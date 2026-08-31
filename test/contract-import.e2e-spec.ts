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
 * Admin-only contract-import (#198): preview → bevestigen, met find-or-create
 * op vendor en vendor_contact.
 *
 * Dekt wat het design-document (§9) als testplan vaststelde: matching
 * (coupa_supplier_number, email+full_name), autorisatie
 * (platformbeheerder-only), tenantisolatie, rollback/idempotency van de
 * bevestig-stap, en de create_only-garantie op zowel contract als vendor.
 */

const { tenant, andereTenant } = TEST_IDS['contract-import'];

const STEMPEL = Date.now();
const SUBJECT_PLATFORM = `oid-import-platform-${STEMPEL}`;
const SUBJECT_GEWOON = `oid-import-gewoon-${STEMPEL}`;

const KOPPEN =
  'contract.name,contract.contract_number,contract.contract_type,contract.start_date,contract.end_date,contract.note,vendor.name,vendor.category_code,vendor.coupa_supplier_number,vendor_contact.email,vendor_contact.full_name';

function csv(...rijen: string[]): Buffer {
  return Buffer.from([KOPPEN, ...rijen].join('\n'), 'utf8');
}

/** Voert een enkele SELECT uit binnen de tenantcontext van `tenant`. */
async function selecteerBinnenTenant<T extends Record<string, unknown>>(
  c: Client,
  tenantId: string,
  queryTekst: string,
  params: unknown[],
): Promise<T[]> {
  await c.query('BEGIN');
  await c.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
  const resultaat = await c.query<T>(queryTekst, params);
  await c.query('COMMIT');
  return resultaat.rows;
}

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

async function verwijderTestdata(migratieClient: Client): Promise<void> {
  await migratieClient.query(
    'DELETE FROM clm.platform_admin WHERE user_id IN (SELECT user_id FROM clm."user" WHERE external_subject = $1)',
    [SUBJECT_PLATFORM],
  );

  for (const t of [tenant, andereTenant]) {
    await migratieClient.query('BEGIN');
    await migratieClient.query(`SET LOCAL app.current_tenant_id = '${t}'`);
    await migratieClient.query(
      'DELETE FROM clm.import_row WHERE tenant_id = $1',
      [t],
    );
    await migratieClient.query(
      'DELETE FROM clm.import_job WHERE tenant_id = $1',
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

describe('Contract-import (e2e, #198)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let migratieClient: Client;
  let sessies: SessieService;

  let platformCookie: string;
  let gewoneCookie: string;

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
      [tenant, `contract-import-test-${STEMPEL}`],
    );
    await client.query('COMMIT');

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${andereTenant}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [andereTenant, `contract-import-ander-${STEMPEL}`],
    );
    await client.query('COMMIT');

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);

    const platformUser = await client.query<{ user_id: string }>(
      `INSERT INTO clm."user" (tenant_id, full_name, external_subject)
       VALUES ($1, $2, $3) RETURNING user_id`,
      [tenant, 'Platform Beheerder', SUBJECT_PLATFORM],
    );
    const gewoneUser = await client.query<{ user_id: string }>(
      `INSERT INTO clm."user" (tenant_id, full_name, external_subject)
       VALUES ($1, $2, $3) RETURNING user_id`,
      [tenant, 'Gewone Gebruiker', SUBJECT_GEWOON],
    );

    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin'), ($3, $2, 'admin')`,
      [platformUser.rows[0].user_id, tenant, gewoneUser.rows[0].user_id],
    );
    await client.query('COMMIT');

    // clm.platform_admin ligt buiten RLS/tenantcontext — via de migratierol.
    await migratieClient.query(
      'INSERT INTO clm.platform_admin (user_id) VALUES ($1)',
      [platformUser.rows[0].user_id],
    );

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();

    sessies = app.get(SessieService);

    const platformSessie = await sessies.aanmaken(SUBJECT_PLATFORM);
    const gewoneSessie = await sessies.aanmaken(SUBJECT_GEWOON);

    platformCookie = `${cookieNaam}=${platformSessie!.token}`;
    gewoneCookie = `${cookieNaam}=${gewoneSessie!.token}`;
  });

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(migratieClient);
    await client.end();
    await migratieClient.end();
  });

  describe('Autorisatie', () => {
    it('weigert preview voor een niet-platformbeheerder (403)', async () => {
      const respons = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', gewoneCookie)
        .attach('file', csv('Hosting,CN-1,,,,,Acme B.V.,,SUP-1,,'), {
          filename: 'contracten.csv',
          contentType: 'text/csv',
        });

      expect(respons.status).toBe(403);
    });

    it('staat preview toe voor een platformbeheerder', async () => {
      const respons = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach('file', csv('Hosting,CN-1,,,,,Acme B.V.,,SUP-1,,'), {
          filename: 'contracten.csv',
          contentType: 'text/csv',
        });

      expect(respons.status).toBe(201);
      const body = respons.body as { jobId: string };
      expect(body.jobId).toBeTruthy();
    });
  });

  describe('Preview en bevestigen', () => {
    it('beoordeelt een bestand zonder iets weg te schrijven', async () => {
      const naam = `Preview-vendor-${STEMPEL}`;
      const respons = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach(
          'file',
          csv(`Hosting,CN-1,,,,,${naam},,SUP-PREV-${STEMPEL},,`),
          { filename: 'contracten.csv', contentType: 'text/csv' },
        );

      expect(respons.status).toBe(201);

      const vendorRijen = await selecteerBinnenTenant(
        client,
        tenant,
        'SELECT vendor_id FROM clm.vendor WHERE name = $1',
        [naam],
      );
      expect(vendorRijen).toHaveLength(0);
    });

    it('bevestigt een importeerbare rij: maakt vendor, contact en contract aan', async () => {
      const vendorNaam = `Bevestig-vendor-${STEMPEL}`;
      const coupaNummer = `SUP-CONF-${STEMPEL}`;

      const preview = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach(
          'file',
          csv(
            `Hosting,CN-CONF,Dienstenovereenkomst,01-01-2024,31-12-2027,Toelichting,${vendorNaam},,${coupaNummer},jan@example.nl,Jan Jansen`,
          ),
          { filename: 'contracten.csv', contentType: 'text/csv' },
        );

      const jobId = (preview.body as { jobId: string }).jobId;

      const bevestig = await request(server)
        .post(`/platform/contract-import/${jobId}/bevestigen`)
        .set('Cookie', platformCookie)
        .send({});

      expect(bevestig.status).toBe(201);
      const resultaat = bevestig.body as {
        aangemaakteContracten: number;
        aangemaakteVendors: number;
        aangemaakteContacten: number;
      };
      expect(resultaat.aangemaakteContracten).toBe(1);
      expect(resultaat.aangemaakteVendors).toBe(1);
      expect(resultaat.aangemaakteContacten).toBe(1);

      const vendorRijen = await selecteerBinnenTenant<{ vendor_id: string }>(
        client,
        tenant,
        'SELECT vendor_id FROM clm.vendor WHERE name = $1',
        [vendorNaam],
      );
      expect(vendorRijen).toHaveLength(1);

      const contractRijen = await selecteerBinnenTenant<{
        name: string;
        vendor_contact_id: string | null;
      }>(
        client,
        tenant,
        'SELECT name, start_date, end_date, vendor_contact_id FROM clm.contract WHERE vendor_id = $1',
        [vendorRijen[0].vendor_id],
      );
      expect(contractRijen[0].name).toBe('Hosting');
      expect(contractRijen[0].vendor_contact_id).not.toBeNull();
    });

    it('weigert een tweede bevestiging van dezelfde job (409)', async () => {
      const preview = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach(
          'file',
          csv(
            `Idempotent,CN-IDEM,,,,,Idempotent-vendor-${STEMPEL},,SUP-IDEM-${STEMPEL},,`,
          ),
          { filename: 'contracten.csv', contentType: 'text/csv' },
        );
      const jobId = (preview.body as { jobId: string }).jobId;

      const eerste = await request(server)
        .post(`/platform/contract-import/${jobId}/bevestigen`)
        .set('Cookie', platformCookie)
        .send({});
      expect(eerste.status).toBe(201);

      const tweede = await request(server)
        .post(`/platform/contract-import/${jobId}/bevestigen`)
        .set('Cookie', platformCookie)
        .send({});
      expect(tweede.status).toBe(409);
    });

    it('slaat een geblokkeerde rij over (skipped), zonder een contract aan te maken', async () => {
      const preview = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach(
          // Geen contractnaam: blokkerend.
          'file',
          csv(`,CN-SKIP,,,,,Skip-vendor-${STEMPEL},,SUP-SKIP-${STEMPEL},,`),
          { filename: 'contracten.csv', contentType: 'text/csv' },
        );
      const jobId = (preview.body as { jobId: string }).jobId;

      const bevestig = await request(server)
        .post(`/platform/contract-import/${jobId}/bevestigen`)
        .set('Cookie', platformCookie)
        .send({});

      expect(bevestig.status).toBe(201);
      const resultaat = bevestig.body as {
        aangemaakteContracten: number;
        overgeslagen: number;
      };
      expect(resultaat.aangemaakteContracten).toBe(0);
      expect(resultaat.overgeslagen).toBe(1);

      const vendorRijen = await selecteerBinnenTenant(
        client,
        tenant,
        'SELECT vendor_id FROM clm.vendor WHERE name = $1',
        [`Skip-vendor-${STEMPEL}`],
      );
      expect(vendorRijen).toHaveLength(0);
    });
  });

  describe('Vendor-matching', () => {
    it('hergebruikt een bestaande vendor op coupa_supplier_number, maakt geen dubbele aan', async () => {
      const coupaNummer = `SUP-MATCH-${STEMPEL}`;
      const naam = `Match-vendor-${STEMPEL}`;

      const preview = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach(
          'file',
          csv(
            `Contract A,CN-A,,,,,${naam},,${coupaNummer},,`,
            `Contract B,CN-B,,,,,${naam},,${coupaNummer},,`,
          ),
          { filename: 'contracten.csv', contentType: 'text/csv' },
        );
      const jobId = (preview.body as { jobId: string }).jobId;

      const bevestig = await request(server)
        .post(`/platform/contract-import/${jobId}/bevestigen`)
        .set('Cookie', platformCookie)
        .send({});

      const resultaat = bevestig.body as {
        aangemaakteContracten: number;
        aangemaakteVendors: number;
        hergebruikteVendors: number;
      };
      expect(resultaat.aangemaakteContracten).toBe(2);
      expect(resultaat.aangemaakteVendors).toBe(1);
      expect(resultaat.hergebruikteVendors).toBe(1);

      const vendorRijen = await selecteerBinnenTenant(
        client,
        tenant,
        'SELECT vendor_id FROM clm.vendor WHERE coupa_supplier_number = $1',
        [coupaNummer],
      );
      expect(vendorRijen).toHaveLength(1);
    });

    it('maakt altijd een nieuwe vendor aan zonder coupa_supplier_number, ook bij gelijke naam', async () => {
      const naam = `Geen-sleutel-vendor-${STEMPEL}`;

      const preview = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach(
          'file',
          csv(
            `Contract A,CN-A,,,,,${naam},,,,`,
            `Contract B,CN-B,,,,,${naam},,,,`,
          ),
          { filename: 'contracten.csv', contentType: 'text/csv' },
        );
      const jobId = (preview.body as { jobId: string }).jobId;

      const bevestig = await request(server)
        .post(`/platform/contract-import/${jobId}/bevestigen`)
        .set('Cookie', platformCookie)
        .send({});

      const resultaat = bevestig.body as { aangemaakteVendors: number };
      expect(resultaat.aangemaakteVendors).toBe(2);

      const vendorRijen = await selecteerBinnenTenant(
        client,
        tenant,
        'SELECT vendor_id FROM clm.vendor WHERE name = $1',
        [naam],
      );
      expect(vendorRijen).toHaveLength(2);
    });

    it('werkt een gematchte vendor nooit bij, ook niet bij een afwijkende naam', async () => {
      const coupaNummer = `SUP-AFWIJK-${STEMPEL}`;
      const oorspronkelijkeNaam = `Oorspronkelijk-${STEMPEL}`;

      const eerstePreview = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach(
          'file',
          csv(`Contract A,CN-A,,,,,${oorspronkelijkeNaam},,${coupaNummer},,`),
          { filename: 'contracten.csv', contentType: 'text/csv' },
        );
      await request(server)
        .post(
          `/platform/contract-import/${(eerstePreview.body as { jobId: string }).jobId}/bevestigen`,
        )
        .set('Cookie', platformCookie)
        .send({});

      const tweedePreview = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach(
          'file',
          csv(`Contract B,CN-B,,,,,Andere-naam-${STEMPEL},,${coupaNummer},,`),
          { filename: 'contracten.csv', contentType: 'text/csv' },
        );
      const bevestig = await request(server)
        .post(
          `/platform/contract-import/${(tweedePreview.body as { jobId: string }).jobId}/bevestigen`,
        )
        .set('Cookie', platformCookie)
        .send({});

      expect(
        (bevestig.body as { rijen: { vendorAfwijkt: boolean }[] }).rijen[0]
          .vendorAfwijkt,
      ).toBe(true);

      const vendorRijen = await selecteerBinnenTenant<{ name: string }>(
        client,
        tenant,
        'SELECT name FROM clm.vendor WHERE coupa_supplier_number = $1',
        [coupaNummer],
      );
      expect(vendorRijen[0].name).toBe(oorspronkelijkeNaam);
    });
  });

  describe('Contact-matching', () => {
    it('hergebruikt een contact op email+full_name binnen dezelfde vendor', async () => {
      const coupaNummer = `SUP-CONTACT-${STEMPEL}`;
      const naam = `Contact-vendor-${STEMPEL}`;

      const preview = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach(
          'file',
          csv(
            `Contract A,CN-A,,,,,${naam},,${coupaNummer},jan@voorbeeld.nl,Jan Jansen`,
            `Contract B,CN-B,,,,,${naam},,${coupaNummer},jan@voorbeeld.nl,Jan Jansen`,
          ),
          { filename: 'contracten.csv', contentType: 'text/csv' },
        );
      const jobId = (preview.body as { jobId: string }).jobId;

      const bevestig = await request(server)
        .post(`/platform/contract-import/${jobId}/bevestigen`)
        .set('Cookie', platformCookie)
        .send({});

      const resultaat = bevestig.body as {
        aangemaakteContacten: number;
        hergebruikteContacten: number;
      };
      expect(resultaat.aangemaakteContacten).toBe(1);
      expect(resultaat.hergebruikteContacten).toBe(1);
    });

    it('maakt twee aparte contacten bij gelijk email maar andere naam (afdelingspostbus-scenario)', async () => {
      const coupaNummer = `SUP-POSTBUS-${STEMPEL}`;
      const naam = `Postbus-vendor-${STEMPEL}`;

      const preview = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach(
          'file',
          csv(
            `Contract A,CN-A,,,,,${naam},,${coupaNummer},info@voorbeeld.nl,Jan Jansen`,
            `Contract B,CN-B,,,,,${naam},,${coupaNummer},info@voorbeeld.nl,Inkoopafdeling`,
          ),
          { filename: 'contracten.csv', contentType: 'text/csv' },
        );
      const jobId = (preview.body as { jobId: string }).jobId;

      const bevestig = await request(server)
        .post(`/platform/contract-import/${jobId}/bevestigen`)
        .set('Cookie', platformCookie)
        .send({});

      const resultaat = bevestig.body as { aangemaakteContacten: number };
      expect(resultaat.aangemaakteContacten).toBe(2);
    });

    it('maakt een contactpersoon aan met alleen een e-mailadres (geen naam)', async () => {
      // Besluit eigenaar 31-08: alleen-email of alleen-naam is niet langer
      // 'onvolledig' — eerdere versie sloeg dit soort contacten over.
      const coupaNummer = `SUP-ALLEENMAIL-${STEMPEL}`;
      const naam = `Alleen-mail-vendor-${STEMPEL}`;

      const preview = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach(
          'file',
          csv(
            `Contract A,CN-A,,,,,${naam},,${coupaNummer},security@voorbeeld.nl,`,
          ),
          { filename: 'contracten.csv', contentType: 'text/csv' },
        );
      const jobId = (preview.body as { jobId: string }).jobId;

      const bevestig = await request(server)
        .post(`/platform/contract-import/${jobId}/bevestigen`)
        .set('Cookie', platformCookie)
        .send({});

      const resultaat = bevestig.body as { aangemaakteContacten: number };
      expect(resultaat.aangemaakteContacten).toBe(1);

      // full_name is NOT NULL in clm.vendor_contact — zonder een naam in de
      // bron gebruikt de import het e-mailadres zelf als voorlopige naam
      // (besluit eigenaar 31-08).
      const contactRijen = await selecteerBinnenTenant<{
        email: string;
        full_name: string;
      }>(
        client,
        tenant,
        `SELECT email, full_name FROM clm.vendor_contact
           WHERE email = $1`,
        ['security@voorbeeld.nl'],
      );
      expect(contactRijen).toHaveLength(1);
      expect(contactRijen[0].full_name).toBe('security@voorbeeld.nl');
    });

    it('maakt een contactpersoon aan met alleen een naam (geen e-mailadres)', async () => {
      const coupaNummer = `SUP-ALLEENNAAM-${STEMPEL}`;
      const naam = `Alleen-naam-vendor-${STEMPEL}`;

      const preview = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach(
          'file',
          csv(`Contract A,CN-A,,,,,${naam},,${coupaNummer},,Patrick Scheun`),
          { filename: 'contracten.csv', contentType: 'text/csv' },
        );
      const jobId = (preview.body as { jobId: string }).jobId;

      const bevestig = await request(server)
        .post(`/platform/contract-import/${jobId}/bevestigen`)
        .set('Cookie', platformCookie)
        .send({});

      const resultaat = bevestig.body as { aangemaakteContacten: number };
      expect(resultaat.aangemaakteContacten).toBe(1);
    });

    it('hergebruikt een alleen-email-contact bij een tweede rij met dezelfde email (NULL-veilige match)', async () => {
      const coupaNummer = `SUP-NULLMATCH-${STEMPEL}`;
      const naam = `Nullmatch-vendor-${STEMPEL}`;

      const preview = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach(
          'file',
          csv(
            `Contract A,CN-A,,,,,${naam},,${coupaNummer},info@voorbeeld.nl,`,
            `Contract B,CN-B,,,,,${naam},,${coupaNummer},info@voorbeeld.nl,`,
          ),
          { filename: 'contracten.csv', contentType: 'text/csv' },
        );
      const jobId = (preview.body as { jobId: string }).jobId;

      const bevestig = await request(server)
        .post(`/platform/contract-import/${jobId}/bevestigen`)
        .set('Cookie', platformCookie)
        .send({});

      const resultaat = bevestig.body as {
        aangemaakteContacten: number;
        hergebruikteContacten: number;
      };
      expect(resultaat.aangemaakteContacten).toBe(1);
      expect(resultaat.hergebruikteContacten).toBe(1);
    });
  });

  describe('Business-criticality en business-risk-tier (#198, gevonden 31-08)', () => {
    it('slaat beide velden correct op als de brontekst herkend wordt', async () => {
      const naam = `Criticality-vendor-${STEMPEL}`;
      const coupaNummer = `SUP-CRIT-${STEMPEL}`;

      const koppen =
        'contract.name;contract.contract_number;vendor.name;vendor.coupa_supplier_number;vendor.business_criticality_code;contract.business_risk_tier_code';
      const bestand = Buffer.from(
        [
          koppen,
          `Contract A;CN-A;${naam};${coupaNummer};Hoog;Tier 2  Medium impact`,
        ].join('\n'),
        'utf8',
      );

      const preview = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach('file', bestand, {
          filename: 'contracten.csv',
          contentType: 'text/csv',
        });
      const jobId = (preview.body as { jobId: string }).jobId;

      await request(server)
        .post(`/platform/contract-import/${jobId}/bevestigen`)
        .set('Cookie', platformCookie)
        .send({});

      const vendorRijen = await selecteerBinnenTenant<{
        business_criticality_code: string | null;
      }>(
        client,
        tenant,
        'SELECT business_criticality_code FROM clm.vendor WHERE coupa_supplier_number = $1',
        [coupaNummer],
      );
      expect(vendorRijen[0].business_criticality_code).toBe('high');

      const contractRijen = await selecteerBinnenTenant<{
        business_risk_tier_code: string | null;
      }>(
        client,
        tenant,
        `SELECT c.business_risk_tier_code FROM clm.contract c
           JOIN clm.vendor v ON v.vendor_id = c.vendor_id
          WHERE v.coupa_supplier_number = $1`,
        [coupaNummer],
      );
      expect(contractRijen[0].business_risk_tier_code).toBe('tier_2');
    });

    it('laat beide velden leeg bij een niet-herkende waarde, blokkeert de rij niet', async () => {
      const naam = `Onbekend-crit-vendor-${STEMPEL}`;
      const coupaNummer = `SUP-ONBEKEND-${STEMPEL}`;

      const koppen =
        'contract.name;contract.contract_number;vendor.name;vendor.coupa_supplier_number;vendor.business_criticality_code;contract.business_risk_tier_code';
      const bestand = Buffer.from(
        [
          koppen,
          `Contract A;CN-A;${naam};${coupaNummer};Onduidelijk;Geen idee`,
        ].join('\n'),
        'utf8',
      );

      const preview = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach('file', bestand, {
          filename: 'contracten.csv',
          contentType: 'text/csv',
        });

      const previewBody = preview.body as {
        jobId: string;
        beoordeling: { rijen: { importeerbaar: boolean }[] };
      };
      expect(previewBody.beoordeling.rijen[0].importeerbaar).toBe(true);

      const bevestig = await request(server)
        .post(`/platform/contract-import/${previewBody.jobId}/bevestigen`)
        .set('Cookie', platformCookie)
        .send({});

      const resultaat = bevestig.body as { aangemaakteContracten: number };
      expect(resultaat.aangemaakteContracten).toBe(1);

      const vendorRijen = await selecteerBinnenTenant<{
        business_criticality_code: string | null;
      }>(
        client,
        tenant,
        'SELECT business_criticality_code FROM clm.vendor WHERE coupa_supplier_number = $1',
        [coupaNummer],
      );
      expect(vendorRijen[0].business_criticality_code).toBeNull();
    });
  });

  describe('Categorie-aanmaak (#198, bevindingen 31-08)', () => {
    it('maakt een onbekende categorie aan i.p.v. hem leeg te laten', async () => {
      const naam = `Categorie-vendor-${STEMPEL}`;
      const categorieTekst = `Vastgoed & Facility Management ${STEMPEL}`;

      const preview = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach(
          'file',
          csv(
            `Contract A,CN-CAT,,,,,${naam},${categorieTekst},SUP-CAT-${STEMPEL},,`,
          ),
          { filename: 'contracten.csv', contentType: 'text/csv' },
        );
      const jobId = (preview.body as { jobId: string }).jobId;

      const bevestig = await request(server)
        .post(`/platform/contract-import/${jobId}/bevestigen`)
        .set('Cookie', platformCookie)
        .send({});

      const resultaat = bevestig.body as {
        aangemaakteCategorieen: number;
        rijen: { categorieAangemaakt: boolean }[];
      };
      expect(resultaat.aangemaakteCategorieen).toBe(1);
      expect(resultaat.rijen[0].categorieAangemaakt).toBe(true);

      const categorieRijen = await selecteerBinnenTenant<{
        code: string;
        label: string;
      }>(
        client,
        tenant,
        'SELECT code, label FROM ref.vendor_category WHERE label = $1',
        [categorieTekst],
      );
      expect(categorieRijen).toHaveLength(1);
    });

    it('hergebruikt een net aangemaakte categorie binnen dezelfde import', async () => {
      const naam1 = `Categorie-vendor-a-${STEMPEL}`;
      const naam2 = `Categorie-vendor-b-${STEMPEL}`;
      const categorieTekst = `Nieuwe categorie ${STEMPEL}`;

      const preview = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach(
          'file',
          csv(
            `Contract A,CN-A,,,,,${naam1},${categorieTekst},SUP-CATA-${STEMPEL},,`,
            `Contract B,CN-B,,,,,${naam2},${categorieTekst},SUP-CATB-${STEMPEL},,`,
          ),
          { filename: 'contracten.csv', contentType: 'text/csv' },
        );
      const jobId = (preview.body as { jobId: string }).jobId;

      const bevestig = await request(server)
        .post(`/platform/contract-import/${jobId}/bevestigen`)
        .set('Cookie', platformCookie)
        .send({});

      const resultaat = bevestig.body as { aangemaakteCategorieen: number };
      expect(resultaat.aangemaakteCategorieen).toBe(1);

      const categorieRijen = await selecteerBinnenTenant(
        client,
        tenant,
        'SELECT code FROM ref.vendor_category WHERE label = $1',
        [categorieTekst],
      );
      expect(categorieRijen).toHaveLength(1);
    });
  });

  describe('Extra contactgegevens (#198, bevindingen 31-08)', () => {
    it('legt vendor_contact.email_2/full_name_2 apart vast, zonder ze te verwerken als het primaire contact', async () => {
      const naam = `Extracontact-vendor-${STEMPEL}`;

      const koppenMetExtra =
        'contract.name;contract.contract_number;contract.contract_type;contract.start_date;contract.end_date;contract.note;vendor.name;vendor.category_code;vendor.coupa_supplier_number;vendor_contact.email;vendor_contact.full_name;vendor_contact.email_2;vendor_contact.full_name_2';
      const rij = `Contract met extra contact;CN-EXTRA;;;;;${naam};;SUP-EXTRA-${STEMPEL};jan@voorbeeld.nl;Jan Jansen;afdeling@voorbeeld.nl;Inkoopafdeling`;
      const bestand = Buffer.from([koppenMetExtra, rij].join('\n'), 'utf8');

      const preview = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach('file', bestand, {
          filename: 'contracten.csv',
          contentType: 'text/csv',
        });

      expect(preview.status).toBe(201);
      const previewBody = preview.body as {
        jobId: string;
        beoordeling: { rijen: { bevindingen: { code: string }[] }[] };
      };
      expect(
        previewBody.beoordeling.rijen[0].bevindingen.map((b) => b.code),
      ).toContain('extra_contactgegevens_gevonden');

      const bevestig = await request(server)
        .post(`/platform/contract-import/${previewBody.jobId}/bevestigen`)
        .set('Cookie', platformCookie)
        .send({});

      const resultaat = bevestig.body as {
        extraContactenGevonden: number;
        aangemaakteContacten: number;
      };
      expect(resultaat.extraContactenGevonden).toBe(1);
      // Het primaire paar (Jan Jansen) is het enige dat een echte
      // vendor_contact-rij oplevert — de extra blijft in de hulptabel.
      expect(resultaat.aangemaakteContacten).toBe(1);

      const extraRijen = await selecteerBinnenTenant<{
        email: string;
        full_name: string;
      }>(
        client,
        tenant,
        `SELECT ec.email, ec.full_name FROM clm.import_extra_contact ec
           JOIN clm.import_row ir ON ir.row_id = ec.row_id
          WHERE ir.job_id = $1`,
        [previewBody.jobId],
      );
      expect(extraRijen).toHaveLength(1);
      expect(extraRijen[0].email).toBe('afdeling@voorbeeld.nl');
      expect(extraRijen[0].full_name).toBe('Inkoopafdeling');
    });
  });

  describe('Tenantisolatie', () => {
    it('een import-job van deze tenant is niet zichtbaar vanuit een andere tenantcontext', async () => {
      const preview = await request(server)
        .post('/platform/contract-import/preview')
        .set('Cookie', platformCookie)
        .attach(
          'file',
          csv(
            `Isolatie,CN-ISO,,,,,Isolatie-vendor-${STEMPEL},,SUP-ISO-${STEMPEL},,`,
          ),
          { filename: 'contracten.csv', contentType: 'text/csv' },
        );
      const jobId = (preview.body as { jobId: string }).jobId;

      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${andereTenant}'`);
      const vanuitAndereTenant = await client.query(
        'SELECT job_id FROM clm.import_job WHERE job_id = $1',
        [jobId],
      );
      await client.query('COMMIT');

      expect(vanuitAndereTenant.rows).toHaveLength(0);
    });
  });
});
