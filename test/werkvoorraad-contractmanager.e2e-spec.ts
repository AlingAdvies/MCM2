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
 * De werkvoorraad van de contractmanager (plan 2026-08-07, §4.1 B4).
 *
 * Vier dingen kunnen hier stuk zonder dat iemand het merkt:
 *
 *   1. Toont "van mij" ook vendors van een collega? Dan is de lijst
 *      betekenisloos en kan de contractmanager hem net zo goed niet gebruiken.
 *   2. Verdwijnt een vendor ZONDER contractmanager uit beeld? Juist die vendor
 *      is degene waar niemand naar omkijkt.
 *   3. Blokkeert de schakelaar "hele organisatie"? Dat mag niet — de koppeling
 *      is een hulpmiddel en geen grens (ADR-013 besluit 3).
 *   4. Berekent deze route zijn eigen status in plaats van respons-status.ts
 *      te gebruiken? Dan zijn er twee waarheden.
 *
 * De statuslogica zelf staat in test/respons-status.spec.ts — dat zijn
 * unittests zonder database. Hier wordt alleen bewezen dat de route hem
 * gebruikt en de juiste feiten aanlevert.
 */

const {
  tenantA,
  tenantB,
  managerA: MANAGER_A,
  collegaA: COLLEGA_A,
  templateA: TEMPLATE_A,
  runA: RUN_A,
  vendorVanMij: VENDOR_VAN_MIJ,
  vendorVanCollega: VENDOR_VAN_COLLEGA,
  vendorZonderEigenaar: VENDOR_ZONDER_EIGENAAR,
  responseVanMij: RESPONSE_VAN_MIJ,
  responseVanCollega: RESPONSE_VAN_COLLEGA,
  responseZonderEigenaar: RESPONSE_ZONDER_EIGENAAR,
  adminB,
} = TEST_IDS['werkvoorraad-contractmanager'];

const SUBJECT_MANAGER = `oid-wv-m-${Date.now()}`;
const SUBJECT_COLLEGA = `oid-wv-c-${Date.now()}`;
const SUBJECT_B = `oid-wv-b-${Date.now()}`;

/**
 * 64 hex-tekens. Het herhaalde teken moet uniek zijn over ALLE suites heen:
 * survey_response_token_hash_key kent geen tenant_id. Bezet waren 0 t/m 6.
 */
const HASH_VAN_MIJ = `${'7'.repeat(48)}7a11e70000000001`;
const HASH_VAN_COLLEGA = `${'7'.repeat(48)}7a11e70000000002`;
const HASH_ZONDER = `${'7'.repeat(48)}7a11e70000000003`;

interface WerkvoorraadBody {
  scope: string;
  werkvoorraad: Array<{
    responseId: string;
    vendorId: string | null;
    vendorNaam: string | null;
    eigenaarUserId: string | null;
    eigenaarNaam: string | null;
    status: string;
    laatsteOordeel: string | null;
    aantalOordelen: number;
    aantalNotities: number;
  }>;
}

async function verwijderTestdata(client: Client) {
  for (const tenant of [tenantA, tenantB]) {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);
    for (const tabel of [
      'clm.response_note',
      'clm.survey_review',
      'clm.survey_answer',
      'clm.survey_response',
      'clm.survey_run',
      'clm.survey_question',
      'clm.survey_template',
      'clm.vendor',
      'clm.tenant_membership',
      'clm."user"',
      'clm.tenant',
    ]) {
      await client.query(`DELETE FROM ${tabel} WHERE tenant_id = $1`, [tenant]);
    }
    await client.query('COMMIT');
  }
}

describe('Werkvoorraad contractmanager (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let cookieManager: string;
  let cookieB: string;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(client);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);

    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenantA, 'Tenant A (werkvoorraad)'],
    );
    for (const [userId, subject, naam] of [
      [MANAGER_A, SUBJECT_MANAGER, 'Manager van A'],
      [COLLEGA_A, SUBJECT_COLLEGA, 'Collega van A'],
    ] as const) {
      await client.query(
        `INSERT INTO clm."user" (user_id, tenant_id, email, full_name, external_subject)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, tenantA, `${subject}@voorbeeld.nl`, naam, subject],
      );
      await client.query(
        `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
         VALUES ($1, $2, 'admin')`,
        [userId, tenantA],
      );
    }

    await client.query(
      `INSERT INTO clm.survey_template (template_id, tenant_id, name, version)
       VALUES ($1, $2, 'werkvoorraad-test-lijst', 1)`,
      [TEMPLATE_A, tenantA],
    );
    // closes_at in de toekomst: anders zou 'te_laat' de statustests
    // onvoorspelbaar maken. De 'te_laat'-tak wordt in de unittests gedekt.
    await client.query(
      `INSERT INTO clm.survey_run
         (run_id, tenant_id, template_id, status, survey_kind, is_test,
          started_at, closes_at)
       VALUES ($1, $2, $3, 'active', 'vendor_compliance', true, now(),
               now() + interval '30 days')`,
      [RUN_A, tenantA, TEMPLATE_A],
    );

    // Drie vendors: van mij, van een collega, en één zonder contractmanager.
    for (const [vendorId, naam, eigenaar] of [
      [VENDOR_VAN_MIJ, 'Leverancier van mij', MANAGER_A],
      [VENDOR_VAN_COLLEGA, 'Leverancier van collega', COLLEGA_A],
      [VENDOR_ZONDER_EIGENAAR, 'Leverancier zonder beheerder', null],
    ] as const) {
      await client.query(
        `INSERT INTO clm.vendor (vendor_id, tenant_id, name, owner_user_id)
         VALUES ($1, $2, $3, $4)`,
        [vendorId, tenantA, naam, eigenaar],
      );
    }

    // Eén ingediende respons en twee die nog openstaan. Dat de contractmanager
    // óók de openstaande ziet is het verschil met de beoordeelstapel.
    await client.query(
      `INSERT INTO clm.survey_response
         (response_id, tenant_id, run_id, vendor_id, subject_vendor_id,
          token_hash, status, expires_at, submitted_at)
       VALUES ($1, $2, $3, $4, $4, $5, 'submitted',
               now() + interval '30 days', now())`,
      [RESPONSE_VAN_MIJ, tenantA, RUN_A, VENDOR_VAN_MIJ, HASH_VAN_MIJ],
    );
    for (const [responseId, vendorId, hash] of [
      [RESPONSE_VAN_COLLEGA, VENDOR_VAN_COLLEGA, HASH_VAN_COLLEGA],
      [RESPONSE_ZONDER_EIGENAAR, VENDOR_ZONDER_EIGENAAR, HASH_ZONDER],
    ] as const) {
      await client.query(
        `INSERT INTO clm.survey_response
           (response_id, tenant_id, run_id, vendor_id, subject_vendor_id,
            token_hash, status, expires_at)
         VALUES ($1, $2, $3, $4, $4, $5, 'pending', now() + interval '30 days')`,
        [responseId, tenantA, RUN_A, vendorId, hash],
      );
    }
    await client.query('COMMIT');

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantB}'`);
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenantB, 'Tenant B (werkvoorraad)'],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, email, full_name, external_subject)
       VALUES ($1, $2, $3, 'Admin van B', $4)`,
      [adminB, tenantB, `${SUBJECT_B}@voorbeeld.nl`, SUBJECT_B],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [adminB, tenantB],
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
    const naam = cookieInstellingen().naam;
    for (const [subject, doel] of [
      [SUBJECT_MANAGER, 'm'],
      [SUBJECT_B, 'b'],
    ] as const) {
      const sessie = await sessies.aanmaken(subject);
      expect(sessie).not.toBeNull();

      const cookie = `${naam}=${sessie!.token}`;
      if (doel === 'm') cookieManager = cookie;
      else cookieB = cookie;
    }
  }, 30000);

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(client);
    await client.end();
  }, 30000);

  async function haal(scope?: string): Promise<WerkvoorraadBody> {
    const pad = scope
      ? `/admin/survey/mijn-vendors?scope=${scope}`
      : '/admin/survey/mijn-vendors';

    const antwoord = await request(server)
      .get(pad)
      .set('Cookie', cookieManager)
      .expect(200);

    return antwoord.body as WerkvoorraadBody;
  }

  describe('van mij', () => {
    it('toont alleen vendors die ik beheer', async () => {
      const { werkvoorraad, scope } = await haal();

      expect(scope).toBe('mij');

      const ids = werkvoorraad.map((w) => w.responseId);
      expect(ids).toContain(RESPONSE_VAN_MIJ);
      // Dit is de kern: zou dit falen, dan is de lijst betekenisloos.
      expect(ids).not.toContain(RESPONSE_VAN_COLLEGA);
      expect(ids).not.toContain(RESPONSE_ZONDER_EIGENAAR);
    });

    it('noemt de contractmanager bij naam', async () => {
      const { werkvoorraad } = await haal();
      const mijne = werkvoorraad.find((w) => w.responseId === RESPONSE_VAN_MIJ);

      expect(mijne?.eigenaarUserId).toBe(MANAGER_A);
      expect(mijne?.eigenaarNaam).toBe('Manager van A');
      expect(mijne?.vendorNaam).toBe('Leverancier van mij');
    });
  });

  describe('hele organisatie', () => {
    it('toont ook de vendors van een collega', async () => {
      const { werkvoorraad, scope } = await haal('organisatie');

      expect(scope).toBe('organisatie');

      const ids = werkvoorraad.map((w) => w.responseId);
      expect(ids).toContain(RESPONSE_VAN_MIJ);
      expect(ids).toContain(RESPONSE_VAN_COLLEGA);
    });

    // Een vendor zonder contractmanager is degene waar niemand naar omkijkt.
    // Verdwijnt hij ook uit het organisatiebrede overzicht, dan is hij
    // onzichtbaar geworden — precies het tegenovergestelde van een centrale
    // waarheid.
    it('toont een vendor zonder contractmanager', async () => {
      const { werkvoorraad } = await haal('organisatie');
      const wees = werkvoorraad.find(
        (w) => w.responseId === RESPONSE_ZONDER_EIGENAAR,
      );

      expect(wees).toBeDefined();
      expect(wees?.eigenaarUserId).toBeNull();
      expect(wees?.eigenaarNaam).toBeNull();
      expect(wees?.vendorNaam).toBe('Leverancier zonder beheerder');
    });

    it('valt terug op "van mij" bij een onbekende scope', async () => {
      const { werkvoorraad, scope } = await haal('onzin');

      expect(scope).toBe('mij');
      expect(werkvoorraad.map((w) => w.responseId)).not.toContain(
        RESPONSE_VAN_COLLEGA,
      );
    });
  });

  describe('de status komt uit respons-status.ts', () => {
    it('toont een openstaande respons als opgestuurd', async () => {
      const { werkvoorraad } = await haal('organisatie');
      const open = werkvoorraad.find(
        (w) => w.responseId === RESPONSE_VAN_COLLEGA,
      );

      expect(open?.status).toBe('opgestuurd');
    });

    it('toont een ingediende respons zonder oordeel als terug', async () => {
      const { werkvoorraad } = await haal();
      const mijne = werkvoorraad.find((w) => w.responseId === RESPONSE_VAN_MIJ);

      expect(mijne?.status).toBe('terug');
      expect(mijne?.aantalOordelen).toBe(0);
    });

    it('verschuift naar beoordeeld en dan naar goedgekeurd', async () => {
      await request(server)
        .post(`/admin/survey/responses/${RESPONSE_VAN_MIJ}/reviews`)
        .set('Cookie', cookieManager)
        .send({ verdict: 'goed', toelichting: 'Compleet.' })
        .expect(201);

      let mijne = (await haal()).werkvoorraad.find(
        (w) => w.responseId === RESPONSE_VAN_MIJ,
      );
      expect(mijne?.status).toBe('beoordeeld');
      expect(mijne?.laatsteOordeel).toBe('goed');

      await request(server)
        .post(`/admin/survey/responses/${RESPONSE_VAN_MIJ}/reviews`)
        .set('Cookie', cookieManager)
        .send({ verdict: 'goedgekeurd' })
        .expect(201);

      mijne = (await haal()).werkvoorraad.find(
        (w) => w.responseId === RESPONSE_VAN_MIJ,
      );
      expect(mijne?.status).toBe('goedgekeurd');
      // Het meningsverschil moet zichtbaar blijven: twee oordelen, niet één.
      expect(mijne?.aantalOordelen).toBe(2);
    });

    // Besluit eigenaar 2026-08-07: het laatste oordeel telt, ook als dat een
    // goedkeuring ongedaan maakt. Een goedkeuring die blijft staan terwijl er
    // een afwijzing onder hangt is niet herstelbaar zonder dat iemand het merkt.
    it('valt terug op beoordeeld als er na goedkeuring een afwijzing komt', async () => {
      await request(server)
        .post(`/admin/survey/responses/${RESPONSE_VAN_MIJ}/reviews`)
        .set('Cookie', cookieManager)
        .send({ verdict: 'niet_goed', toelichting: 'Toch een probleem.' })
        .expect(201);

      const mijne = (await haal()).werkvoorraad.find(
        (w) => w.responseId === RESPONSE_VAN_MIJ,
      );

      expect(mijne?.status).toBe('beoordeeld');
      expect(mijne?.laatsteOordeel).toBe('niet_goed');
    });

    it('telt de notities mee', async () => {
      await request(server)
        .post(`/admin/survey/responses/${RESPONSE_VAN_MIJ}/notes`)
        .set('Cookie', cookieManager)
        .send({ tekst: 'Gebeld, komt volgende week.' })
        .expect(201);

      const mijne = (await haal()).werkvoorraad.find(
        (w) => w.responseId === RESPONSE_VAN_MIJ,
      );

      expect(mijne?.aantalNotities).toBe(1);
    });
  });

  describe('de tenantgrens', () => {
    it('toont tenant B niets van tenant A', async () => {
      const antwoord = await request(server)
        .get('/admin/survey/mijn-vendors?scope=organisatie')
        .set('Cookie', cookieB)
        .expect(200);

      const { werkvoorraad } = antwoord.body as WerkvoorraadBody;
      const ids = werkvoorraad.map((w) => w.responseId);

      expect(ids).not.toContain(RESPONSE_VAN_MIJ);
      expect(ids).not.toContain(RESPONSE_VAN_COLLEGA);
    });
  });
});
