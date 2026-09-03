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
 * Platformroutes voor per-tenant feature-entitlements (spec
 * docs/superpowers/specs/2026-09-03-tenant-feature-entitlements-design.md).
 *
 * Zelfde kernvraag als platform-routes.e2e-spec.ts: kan een gewone
 * tenant-admin deze routes aanroepen (moet niet — 403), en doet de route
 * wat hij belooft voor een echte platformbeheerder.
 */

const {
  tenant: TENANT,
  beheerder: USER_BEHEERDER,
  klantAdmin: USER_KLANT_ADMIN,
} = TEST_IDS['tenant-feature-routes'];

const SUBJECT_BEHEERDER = `oid-featureroutes-beheer-${Date.now()}`;
const SUBJECT_KLANT_ADMIN = `oid-featureroutes-klant-${Date.now()}`;

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

interface FeaturesAntwoord {
  features: string[];
}

describe('Platformroutes: tenant-features (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let migratieClient: Client;
  let cookieBeheerder: string;
  let cookieKlantAdmin: string;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [TENANT, `featureroutes-${Date.now()}`],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, email, external_subject)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        USER_BEHEERDER,
        TENANT,
        'Featureroutes Beheerder',
        `${SUBJECT_BEHEERDER}@voorbeeld.nl`,
        SUBJECT_BEHEERDER,
      ],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [USER_BEHEERDER, TENANT],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, email, external_subject)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        USER_KLANT_ADMIN,
        TENANT,
        'Gewone Klantadmin',
        `${SUBJECT_KLANT_ADMIN}@voorbeeld.nl`,
        SUBJECT_KLANT_ADMIN,
      ],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'user')`,
      [USER_KLANT_ADMIN, TENANT],
    );
    await client.query('COMMIT');

    migratieClient = new Client({ connectionString: migratieUrl() });
    await migratieClient.connect();
    await migratieClient.query(
      `INSERT INTO clm.platform_admin (user_id, toelichting)
       VALUES ($1, 'e2e tenant-feature-routes') ON CONFLICT DO NOTHING`,
      [USER_BEHEERDER],
    );

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();

    const sessies = app.get(SessieService);
    const cookieNaam = cookieInstellingen().naam;

    const sessieBeheerder = await sessies.aanmaken(SUBJECT_BEHEERDER);
    const sessieKlantAdmin = await sessies.aanmaken(SUBJECT_KLANT_ADMIN);
    expect(sessieBeheerder).not.toBeNull();
    expect(sessieKlantAdmin).not.toBeNull();

    cookieBeheerder = `${cookieNaam}=${sessieBeheerder!.token}`;
    cookieKlantAdmin = `${cookieNaam}=${sessieKlantAdmin!.token}`;
  }, 30000);

  afterAll(async () => {
    await app.close();

    // clm.tenant_feature heeft FORCE ROW LEVEL SECURITY (migratie 0038) —
    // ook clm_migrator (owner) moet de tenantcontext zetten, anders ziet
    // deze DELETE geen rijen en faalt de user-verwijdering hieronder op de
    // achterblijvende foreign key (updated_by).
    await migratieClient.query('BEGIN');
    await migratieClient.query(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
    await migratieClient.query(
      'DELETE FROM clm.tenant_feature WHERE tenant_id = $1',
      [TENANT],
    );
    await migratieClient.query('COMMIT');

    await migratieClient.query(
      'DELETE FROM audit.audit_event WHERE tenant_id = $1',
      [TENANT],
    );
    await migratieClient.query(
      'DELETE FROM clm.platform_admin WHERE user_id = $1',
      [USER_BEHEERDER],
    );

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
    await client.query(
      'DELETE FROM clm.tenant_membership WHERE tenant_id = $1',
      [TENANT],
    );
    await client.query('DELETE FROM clm."user" WHERE tenant_id = $1', [TENANT]);
    await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [TENANT]);
    await client.query('COMMIT');

    await migratieClient.end();
    await client.end();
  }, 30000);

  it('geeft een lege featurelijst voor een verse tenant', async () => {
    const antwoord = await request(server)
      .get(`/platform/tenants/${TENANT}/features`)
      .set('Cookie', cookieBeheerder)
      .expect(200);

    expect((antwoord.body as FeaturesAntwoord).features).toEqual([]);
  });

  it('zet een feature aan en toont die daarna in de lijst', async () => {
    await request(server)
      .put(`/platform/tenants/${TENANT}/features/contractmodule`)
      .set('Cookie', cookieBeheerder)
      .send({ enabled: true })
      .expect(200);

    const antwoord = await request(server)
      .get(`/platform/tenants/${TENANT}/features`)
      .set('Cookie', cookieBeheerder)
      .expect(200);

    expect((antwoord.body as FeaturesAntwoord).features).toEqual([
      'contractmodule',
    ]);
  });

  it('zet een feature weer uit', async () => {
    await request(server)
      .put(`/platform/tenants/${TENANT}/features/contractmodule`)
      .set('Cookie', cookieBeheerder)
      .send({ enabled: false })
      .expect(200);

    const antwoord = await request(server)
      .get(`/platform/tenants/${TENANT}/features`)
      .set('Cookie', cookieBeheerder)
      .expect(200);

    expect((antwoord.body as FeaturesAntwoord).features).toEqual([]);
  });

  it('legt het schakelen vast in de audit trail', async () => {
    await request(server)
      .put(`/platform/tenants/${TENANT}/features/contractmodule`)
      .set('Cookie', cookieBeheerder)
      .send({ enabled: true })
      .expect(200);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
    const { rows } = await client.query<{
      new_values: { featureKey: string; enabled: boolean };
    }>(
      `SELECT new_values FROM audit.audit_event
        WHERE tenant_id = $1 AND action_type = 'tenant_feature_gewijzigd'
        ORDER BY created_at DESC LIMIT 1`,
      [TENANT],
    );
    await client.query('COMMIT');

    expect(rows).toHaveLength(1);
    expect(rows[0].new_values.featureKey).toBe('contractmodule');
    expect(rows[0].new_values.enabled).toBe(true);
  });

  it('weigert een onbekende featureKey met 400', async () => {
    await request(server)
      .put(`/platform/tenants/${TENANT}/features/onbestaande-feature`)
      .set('Cookie', cookieBeheerder)
      .send({ enabled: true })
      .expect(400);
  });

  it('weigert een niet-boolean enabled-waarde met 400', async () => {
    await request(server)
      .put(`/platform/tenants/${TENANT}/features/contractmodule`)
      .set('Cookie', cookieBeheerder)
      .send({ enabled: 'ja' })
      .expect(400);
  });

  it('geeft 404 op een onbekende tenant', async () => {
    await request(server)
      .get('/platform/tenants/00000000-0000-0000-0000-0000000000ff/features')
      .set('Cookie', cookieBeheerder)
      .expect(404);
  });

  // ── De deur ────────────────────────────────────────────────────────────

  it('weigert lezen zonder sessie met 401', async () => {
    await request(server)
      .get(`/platform/tenants/${TENANT}/features`)
      .expect(401);
  });

  it('weigert schakelen voor een gewone tenant-admin met 403', async () => {
    // De belangrijkste test van deze suite: een geldige sessie, een echte
    // admin binnen zijn eigen tenant — maar geen platformbeheerder. Zonder
    // deze grens zou elke klantbeheerder zelf een niet-gekochte feature
    // kunnen aanzetten voor zijn eigen tenant.
    const antwoord = await request(server)
      .put(`/platform/tenants/${TENANT}/features/contractmodule`)
      .set('Cookie', cookieKlantAdmin)
      .send({ enabled: true })
      .expect(403);

    expect(JSON.stringify(antwoord.body)).toContain('platformbeheer');
  });

  it('weigert lezen voor een gewone tenant-admin met 403', async () => {
    await request(server)
      .get(`/platform/tenants/${TENANT}/features`)
      .set('Cookie', cookieKlantAdmin)
      .expect(403);
  });
});
