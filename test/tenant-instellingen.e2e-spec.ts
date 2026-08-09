import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Client } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { cookieInstellingen } from '../src/auth/sessie';
import { SessieService } from '../src/auth/sessie.service';
import { verwijderTestdata } from './opruimen';
import { TEST_IDS } from './test-ids';

/**
 * Het beheerscherm voor de eigen omgeving, van buitenaf.
 *
 * ── Wat hier bewezen moet worden ─────────────────────────────────────────────
 *
 * Niet dat een beheerder zijn antwoordadres kan instellen — dat is het
 * makkelijke deel. Wél dat de route dichtzit voor wie hem niet hoort te
 * gebruiken, en dat hij per constructie niet aan een andere tenant kan komen.
 *
 * Deze routes zijn de tegenhanger van `PlatformController`: daar komt de tenant
 * uit de invoer met een extra guard ervoor, hier uit de sessie. Er is geen
 * tenant-parameter, dus de vraag "kan ik de instellingen van een ander
 * opvragen" heeft hier geen vorm — en dat is precies wat getest wordt.
 */

const {
  tenantA: TENANT_A,
  tenantB: TENANT_B,
  adminA: USER_ADMIN_A,
  reviewerA: USER_REVIEWER_A,
  adminB: USER_ADMIN_B,
} = TEST_IDS['tenant-instellingen'];

const SUBJECT_ADMIN_A = `oid-tenantinst-admin-a-${Date.now()}`;
const SUBJECT_REVIEWER_A = `oid-tenantinst-rev-a-${Date.now()}`;
const SUBJECT_ADMIN_B = `oid-tenantinst-admin-b-${Date.now()}`;

const ADRES_A = `contract-a-${Date.now()}@voorbeeld.nl`;
const ADRES_B = `contract-b-${Date.now()}@voorbeeld.nl`;

interface Instellingen {
  tenantId?: string;
  naam?: string;
  antwoordEmail?: string | null;
  veld?: string;
}

const body = (res: { body: unknown }) => res.body as Instellingen;

describe('Tenantinstellingen (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let cookieAdminA: string;
  let cookieReviewerA: string;
  let cookieAdminB: string;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    for (const [tenant, naam, adres] of [
      [TENANT_A, `tenantinst-a-${Date.now()}`, ADRES_A],
      [TENANT_B, `tenantinst-b-${Date.now()}`, ADRES_B],
    ] as const) {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
      await client.query(
        'INSERT INTO clm.tenant (tenant_id, name, antwoord_email) VALUES ($1, $2, $3)',
        [tenant, naam, adres],
      );
      await client.query('COMMIT');
    }

    for (const [tenant, user, subject, rol] of [
      [TENANT_A, USER_ADMIN_A, SUBJECT_ADMIN_A, 'admin'],
      [TENANT_A, USER_REVIEWER_A, SUBJECT_REVIEWER_A, 'reviewer'],
      [TENANT_B, USER_ADMIN_B, SUBJECT_ADMIN_B, 'admin'],
    ] as const) {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
      await client.query(
        `INSERT INTO clm."user" (user_id, tenant_id, full_name, email, external_subject)
         VALUES ($1, $2, $3, $4, $5)`,
        [user, tenant, rol, `${subject}@voorbeeld.nl`, subject],
      );
      await client.query(
        `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
         VALUES ($1, $2, $3)`,
        [user, tenant, rol],
      );
      await client.query('COMMIT');
    }

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();

    const sessies = app.get(SessieService);
    const cookieNaam = cookieInstellingen().naam;

    const sA = await sessies.aanmaken(SUBJECT_ADMIN_A);
    const sR = await sessies.aanmaken(SUBJECT_REVIEWER_A);
    const sB = await sessies.aanmaken(SUBJECT_ADMIN_B);
    expect(sA).not.toBeNull();
    expect(sR).not.toBeNull();
    expect(sB).not.toBeNull();

    cookieAdminA = `${cookieNaam}=${sA!.token}`;
    cookieReviewerA = `${cookieNaam}=${sR!.token}`;
    cookieAdminB = `${cookieNaam}=${sB!.token}`;
  }, 30000);

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(TENANT_A, TENANT_B);
    await client.end();
  }, 30000);

  describe('de deur', () => {
    it('weigert lezen zonder sessie met 401', async () => {
      await request(server).get('/tenant/instellingen').expect(401);
    });

    it('weigert wijzigen zonder sessie met 401', async () => {
      await request(server)
        .patch('/tenant/instellingen')
        .send({ antwoordEmail: 'kwaad@voorbeeld.nl' })
        .expect(401);
    });

    it('weigert wijzigen door een beoordelaar met 403', async () => {
      // Het antwoordadres bepaalt waar vragen van leveranciers van de héle
      // organisatie heen gaan. Een beoordelaar hoort dat niet te kunnen
      // verleggen — en de grens hoort in de backend te zitten, niet alleen in
      // een verborgen menu-item.
      await request(server)
        .patch('/tenant/instellingen')
        .set('Cookie', cookieReviewerA)
        .send({ antwoordEmail: 'omgeleid@voorbeeld.nl' })
        .expect(403);
    });

    it('laat een beoordelaar wél lezen', async () => {
      // Bewust ruimer dan wijzigen: het scherm toont de instellingen ook aan
      // wie ze niet mag aanpassen, en dat is beter dan een leeg vlak.
      const antwoord = await request(server)
        .get('/tenant/instellingen')
        .set('Cookie', cookieReviewerA)
        .expect(200);

      expect(body(antwoord).antwoordEmail).toBe(ADRES_A);
    });
  });

  describe('de tenantgrens', () => {
    it('toont elke beheerder uitsluitend zijn eigen omgeving', async () => {
      // Er is geen tenant-parameter in het pad en geen veld in de body, dus
      // "de instellingen van een ander opvragen" heeft hier geen vorm. Deze
      // test legt vast dat de route werkelijk uit de sessie leest.
      const a = await request(server)
        .get('/tenant/instellingen')
        .set('Cookie', cookieAdminA)
        .expect(200);

      const b = await request(server)
        .get('/tenant/instellingen')
        .set('Cookie', cookieAdminB)
        .expect(200);

      expect(body(a).tenantId).toBe(TENANT_A);
      expect(body(a).antwoordEmail).toBe(ADRES_A);
      expect(body(b).tenantId).toBe(TENANT_B);
      expect(body(b).antwoordEmail).toBe(ADRES_B);
    });

    it('raakt de andere tenant niet bij een wijziging', async () => {
      await request(server)
        .patch('/tenant/instellingen')
        .set('Cookie', cookieAdminA)
        .send({ antwoordEmail: `nieuw-${Date.now()}@voorbeeld.nl` })
        .expect(200);

      const b = await request(server)
        .get('/tenant/instellingen')
        .set('Cookie', cookieAdminB)
        .expect(200);

      expect(body(b).antwoordEmail).toBe(ADRES_B);
    });
  });

  describe('wijzigen', () => {
    it('stelt het antwoordadres in en geeft de nieuwe stand terug', async () => {
      const nieuw = `ingesteld-${Date.now()}@voorbeeld.nl`;

      const antwoord = await request(server)
        .patch('/tenant/instellingen')
        .set('Cookie', cookieAdminA)
        .send({ antwoordEmail: nieuw })
        .expect(200);

      expect(body(antwoord).antwoordEmail).toBe(nieuw);

      // Teruglezen via een tweede aanroep: het antwoord van een PATCH kan
      // kloppen terwijl er niets is opgeslagen.
      const opnieuw = await request(server)
        .get('/tenant/instellingen')
        .set('Cookie', cookieAdminA)
        .expect(200);

      expect(body(opnieuw).antwoordEmail).toBe(nieuw);
    });

    it('wist het adres bij een lege waarde', async () => {
      await request(server)
        .patch('/tenant/instellingen')
        .set('Cookie', cookieAdminA)
        .send({ antwoordEmail: '' })
        .expect(200);

      const antwoord = await request(server)
        .get('/tenant/instellingen')
        .set('Cookie', cookieAdminA)
        .expect(200);

      expect(body(antwoord).antwoordEmail).toBeNull();
    });

    it('laat het adres met rust wanneer het veld ontbreekt', async () => {
      // De tegenproef bij "wissen bij een lege waarde": zonder dit onderscheid
      // zou een scherm dat straks een ander veld wijzigt het antwoordadres
      // stilzwijgend wissen.
      const gezet = `blijft-${Date.now()}@voorbeeld.nl`;

      await request(server)
        .patch('/tenant/instellingen')
        .set('Cookie', cookieAdminA)
        .send({ antwoordEmail: gezet })
        .expect(200);

      await request(server)
        .patch('/tenant/instellingen')
        .set('Cookie', cookieAdminA)
        .send({})
        .expect(200);

      const antwoord = await request(server)
        .get('/tenant/instellingen')
        .set('Cookie', cookieAdminA)
        .expect(200);

      expect(body(antwoord).antwoordEmail).toBe(gezet);
    });

    it('weigert een ongeldig adres met 400 en noemt het veld', async () => {
      const antwoord = await request(server)
        .patch('/tenant/instellingen')
        .set('Cookie', cookieAdminA)
        .send({ antwoordEmail: 'geen-adres' })
        .expect(400);

      expect(JSON.stringify(antwoord.body)).toContain('antwoordEmail');
    });

    it('legt de wijziging vast in de audit trail', async () => {
      // Wie het antwoordadres wijzigt verlegt de post van een hele organisatie.
      // Dat hoort navolgbaar te zijn (§7.7).
      const adres = `audit-${Date.now()}@voorbeeld.nl`;

      await request(server)
        .patch('/tenant/instellingen')
        .set('Cookie', cookieAdminA)
        .send({ antwoordEmail: adres })
        .expect(200);

      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${TENANT_A}'`);
      const { rows } = await client.query<{
        new_values: Record<string, unknown>;
      }>(
        `SELECT new_values FROM audit.audit_event
          WHERE tenant_id = $1
            AND action_type = 'tenant_instellingen_gewijzigd'
          ORDER BY created_at DESC
          LIMIT 1`,
        [TENANT_A],
      );
      await client.query('COMMIT');

      expect(rows).toHaveLength(1);
      expect(rows[0].new_values.antwoordEmail).toBe(adres);
    });
  });
});
