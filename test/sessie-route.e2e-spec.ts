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
 * GET /auth/sessie — wie is er ingelogd (fase 2b).
 *
 * ── Waarom deze suite bestaat ──────────────────────────────────────────────
 * De browsertests in de frontend controleren wat er in de sidebar *terechtkomt*.
 * Dat bleek niet genoeg: bij een tegenproef waarin de route een `tenantId`
 * meestuurde, bleven alle acht browsertests groen — de sidebar toont dat veld
 * namelijk niet, dus het kwam nooit in beeld terwijl het wél over de lijn ging.
 *
 * Een lek test je bij de bron, niet bij de plek waar je hoopt dat het niet
 * opduikt. Vandaar deze suite, op het antwoord van de route zelf.
 *
 * ── Wat er niet in het antwoord hoort ──────────────────────────────────────
 * Geen tenantId, userId of sessieId. MCM2-CLAUDE.md §6 verbiedt een tenant in
 * de client, en er staat een CI-poort op de frontend die op datzelfde patroon
 * afgaat. Wat de backend niet verstuurt, kan de frontend niet lekken.
 */

const TENANT = TEST_IDS['sessie-route'].tenant;
const USER = TEST_IDS['sessie-route'].user;

// Uniek per run: external_subject heeft een globale unieke index, dus een vaste
// waarde laat een tweede run falen op een rij van de vorige.
const SUBJECT = `oid-sessieroute-${Date.now()}`;

const TENANT_NAAM = 'Sessieroute-test';
const VOLLEDIGE_NAAM = 'Sanne Sessie';

/** Wat de route hoort terug te geven — en niets anders. */
interface SessieBody {
  naam: string;
  tenantNaam: string;
  rol: string;
}

async function verwijderTestdata(client: Client): Promise<void> {
  await client.query('BEGIN');
  await client.query(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
  await client.query('DELETE FROM clm.tenant_membership WHERE tenant_id = $1', [
    TENANT,
  ]);
  await client.query('DELETE FROM clm."user" WHERE tenant_id = $1', [TENANT]);
  await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [TENANT]);
  await client.query('COMMIT');
}

describe('GET /auth/sessie (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let sessies: SessieService;
  let token: string;

  const cookieNaam = cookieInstellingen().naam;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(client);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [TENANT, TENANT_NAAM],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
       VALUES ($1, $2, $3, $4)`,
      [USER, TENANT, VOLLEDIGE_NAAM, SUBJECT],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [USER, TENANT],
    );
    await client.query('COMMIT');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    server = app.getHttpServer();
    sessies = app.get(SessieService);

    // Een échte sessie via sessie_aanmaken(), inclusief membershipcontrole.
    const sessie = await sessies.aanmaken(SUBJECT);
    token = sessie!.token;
  });

  afterAll(async () => {
    await sessies.beeindigen(token);
    await app.close();
    await verwijderTestdata(client);
    await client.end();
  });

  // ── Toegang ──────────────────────────────────────────────────────────────

  it('geeft 401 zonder cookie', async () => {
    await request(server).get('/auth/sessie').expect(401);
  });

  it('geeft 401 bij een onbekend token', async () => {
    await request(server)
      .get('/auth/sessie')
      .set('Cookie', `${cookieNaam}=${'z'.repeat(43)}`)
      .expect(401);
  });

  it('geeft de naam, tenantnaam en rol bij een geldige sessie', async () => {
    const antwoord = await request(server)
      .get('/auth/sessie')
      .set('Cookie', `${cookieNaam}=${token}`)
      .expect(200);

    expect(antwoord.body).toEqual({
      naam: VOLLEDIGE_NAAM,
      tenantNaam: TENANT_NAAM,
      rol: 'admin',
    });
  });

  // ── Wat er níét in mag ───────────────────────────────────────────────────

  it('stuurt geen tenantId, userId of sessieId mee', async () => {
    const antwoord = await request(server)
      .get('/auth/sessie')
      .set('Cookie', `${cookieNaam}=${token}`)
      .expect(200);

    // toEqual hierboven dekt dit al, maar deze test benoemt wát er niet mag en
    // waarom. Zonder hem leest de volgende ontwikkelaar `toEqual` als "dit is
    // wat er nu in zit" in plaats van "dit is de volledige toegestane lijst",
    // en dan is een veld erbij zetten een kleine wijziging in plaats van een
    // besluit.
    const body = antwoord.body as SessieBody;
    const ruw = JSON.stringify(body);

    expect(ruw).not.toContain(TENANT);
    expect(ruw).not.toContain(USER);
    expect(Object.keys(body).sort()).toEqual(['naam', 'rol', 'tenantNaam']);

    // Geen enkel veld dat op een UUID lijkt. Vangt ook een id dat onder een
    // andere naam meelift.
    expect(ruw).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
  });

  it('stuurt het ruwe sessietoken niet terug', async () => {
    const antwoord = await request(server)
      .get('/auth/sessie')
      .set('Cookie', `${cookieNaam}=${token}`)
      .expect(200);

    // Het cookie is httpOnly zodat JavaScript er niet bij kan. Het token in het
    // antwoord zetten zou die bescherming ongedaan maken langs de achterdeur.
    expect(JSON.stringify(antwoord.body)).not.toContain(token);
  });
});
