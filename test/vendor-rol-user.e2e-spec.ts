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
 * Issue #75: de rol 'user' (contractbeheerder) krijgt dezelfde schrijfrechten
 * als 'admin' op leveranciers/contracten/tenant-instellingen, maar niet op
 * de twee routes die zelf bevoegdheden toekennen (koppelReviewer/
 * ontkoppelReviewer, maakRonde — vragenlijst-beheer.controller.ts). Die
 * uitzondering staat hier als tegenproef 4 uit de spec, niet in het bestand
 * dat vragenlijst-beheer test — een 'user' die daar nooit is aangeraakt
 * moet gewoon al 403 krijgen zonder enige codewijziging in dat bestand.
 */

const { tenant, userRol } = TEST_IDS['vendor-rol-user'];

const STEMPEL = Date.now();
const SUBJECT_USER = `oid-vru-user-${STEMPEL}`;

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
  await migratieClient.query('BEGIN');
  await migratieClient.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
  await migratieClient.query('DELETE FROM clm.vendor WHERE tenant_id = $1', [
    tenant,
  ]);
  await migratieClient.query(
    'DELETE FROM clm.tenant_membership WHERE tenant_id = $1',
    [tenant],
  );
  await migratieClient.query('DELETE FROM clm."user" WHERE tenant_id = $1', [
    tenant,
  ]);
  await migratieClient.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [
    tenant,
  ]);
  await migratieClient.query('COMMIT');
}

describe('Rol user — zelfde schrijfrechten als admin, met twee uitzonderingen (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let migratieClient: Client;
  let userCookie: string;
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
      [tenant, 'vendor-rol-user-test'],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
       VALUES ($1, $2, $3, $4)`,
      [userRol, tenant, 'Ursula User', SUBJECT_USER],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'user')`,
      [userRol, tenant],
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
    const userSessie = await sessies.aanmaken(SUBJECT_USER);
    userCookie = `${cookieNaam}=${userSessie!.token}`;
  });

  afterAll(async () => {
    await app.close();
    await opruimen(migratieClient);
    await client.end();
    await migratieClient.end();
  });

  it('een gebruiker met rol user mag een leverancier aanmaken', async () => {
    const respons = await request(server)
      .post('/vendors')
      .set('Cookie', userCookie)
      .send({ name: 'Testleverancier user-rol' });

    expect(respons.status).toBe(201);
  });

  it('een gebruiker met rol user mag de tenant-instellingen wijzigen', async () => {
    const respons = await request(server)
      .patch('/tenant/instellingen')
      .set('Cookie', userCookie)
      .send({ antwoordEmail: 'contact@voorbeeld.nl' });

    expect(respons.status).toBe(200);
  });

  it('een gebruiker met rol user krijgt 403 op het aanmaken van een ronde', async () => {
    const respons = await request(server)
      .post('/admin/survey/runs')
      .set('Cookie', userCookie)
      .send({ templateId: 'niet-bestaand' });

    expect(respons.status).toBe(403);
  });

  it('een gebruiker met rol user krijgt 403 op het koppelen van een reviewer', async () => {
    const respons = await request(server)
      .post('/admin/survey/templates/niet-bestaand/reviewers')
      .set('Cookie', userCookie)
      .send({ userId: 'niet-bestaand' });

    expect(respons.status).toBe(403);
  });

  it('een gebruiker met rol user krijgt 403 op het ontkoppelen van een reviewer', async () => {
    const respons = await request(server)
      .delete('/admin/survey/templates/niet-bestaand/reviewers/niet-bestaand')
      .set('Cookie', userCookie);

    expect(respons.status).toBe(403);
  });
});
