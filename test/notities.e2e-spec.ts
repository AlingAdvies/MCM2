import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Client } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { cookieInstellingen } from '../src/auth/sessie';
import { SessieService } from '../src/auth/sessie.service';
import { genereerToken, hashToken } from '../src/survey/survey-token';
import { TEST_IDS } from './test-ids';
import { verwijderTestdata } from './opruimen';

/**
 * Notities bij een inzending (migratie 0018).
 *
 * Vier dingen kunnen hier stuk zonder dat iemand het merkt:
 *
 *   1. Kan een LEVERANCIER meelezen wat er over hem geschreven wordt? Hij zit
 *      in dezelfde tenant, dus de tenantgrens alleen volstaat niet.
 *   2. Wordt de datum en de naam van de schrijver meegegeven? Zonder die twee
 *      is een notitie in een dossier waardeloos: "gebeld" — door wie, wanneer?
 *   3. Kan er een notitie geplaatst worden vóór het indienen? Dat MOET kunnen,
 *      anders is het meest bruikbare geval uitgesloten.
 *   4. Wist intrekken de rij in plaats van deleted_at te zetten?
 */

const {
  tenantA,
  tenantB,
  adminA: ADMIN_A,
  templateA: TEMPLATE_A,
  runA: RUN_A,
  vendorA: VENDOR_A,
  responseIngediend: RESPONSE_INGEDIEND,
  responseOpen: RESPONSE_OPEN,
  vendorOpen: VENDOR_OPEN,
  adminB,
  notitieBestaatNiet: NOTITIE_BESTAAT_NIET,
} = TEST_IDS.notities;

const SUBJECT_ADMIN = `oid-nt-a-${Date.now()}`;
const SUBJECT_B = `oid-nt-b-${Date.now()}`;

/** 64 hex-tekens, conform de CHECK op token_hash (migratie 0003). */
const HASH_OPEN = `${'5'.repeat(48)}eeeeeeeeeeeeeeee`;

/**
 * Voor RESPONSE_INGEDIEND wordt de hash niet meer handmatig getypt maar
 * afgeleid van een echt gegenereerd token (zoals antwoord-indienen.e2e-spec.ts
 * dat doet) — nodig om in de leverancierspad-tegenproef als leverancier
 * daadwerkelijk in te kunnen loggen via ?t=. test-ids.ts kent geen bestaande
 * conventie voor een tokenveld (tokens staan daar nergens in): de database
 * bewaart alleen de hash, dus het ruwe token moet sowieso vers gegenereerd
 * worden in de test zelf, in lockstep met de hash die de fixture-insert
 * gebruikt.
 */
const RAW_TOKEN_INGEDIEND = genereerToken();
const HASH_INGEDIEND = hashToken(RAW_TOKEN_INGEDIEND);

interface NotitieBody {
  notitie: {
    noteId: string;
    tekst: string;
    soort: 'werk' | 'vastgesteld';
    authorUserId: string;
    authorNaam: string | null;
    createdAt: string;
  };
}

interface LijstBody {
  notities: Array<{
    noteId: string;
    tekst: string;
    soort: 'werk' | 'vastgesteld';
    authorNaam: string | null;
    createdAt: string;
  }>;
}

describe('Notities bij een inzending (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let cookieAdminA: string;
  let cookieB: string;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(tenantA, tenantB);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);

    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenantA, 'Tenant A (notities)'],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, email, full_name, external_subject)
       VALUES ($1, $2, $3, 'Admin van A', $4)`,
      [ADMIN_A, tenantA, `${SUBJECT_ADMIN}@voorbeeld.nl`, SUBJECT_ADMIN],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [ADMIN_A, tenantA],
    );
    await client.query(
      `INSERT INTO clm.survey_template (template_id, tenant_id, name, version)
       VALUES ($1, $2, 'notitie-test-lijst', 1)`,
      [TEMPLATE_A, tenantA],
    );
    await client.query(
      `INSERT INTO clm.survey_run
         (run_id, tenant_id, template_id, status, survey_kind, is_test, started_at)
       VALUES ($1, $2, $3, 'active', 'vendor_compliance', true, now())`,
      [RUN_A, tenantA, TEMPLATE_A],
    );
    for (const [vendorId, naam] of [
      [VENDOR_A, 'Leverancier van A'],
      [VENDOR_OPEN, 'Leverancier die nog moet'],
    ] as const) {
      await client.query(
        `INSERT INTO clm.vendor (vendor_id, tenant_id, name) VALUES ($1, $2, $3)`,
        [vendorId, tenantA, naam],
      );
    }
    await client.query(
      `INSERT INTO clm.survey_response
         (response_id, tenant_id, run_id, vendor_id, subject_vendor_id,
          token_hash, status, expires_at, submitted_at)
       VALUES ($1, $2, $3, $4, $4, $5, 'submitted',
               now() + interval '30 days', now())`,
      [RESPONSE_INGEDIEND, tenantA, RUN_A, VENDOR_A, HASH_INGEDIEND],
    );
    await client.query(
      `INSERT INTO clm.survey_response
         (response_id, tenant_id, run_id, vendor_id, subject_vendor_id,
          token_hash, status, expires_at)
       VALUES ($1, $2, $3, $4, $4, $5, 'pending', now() + interval '30 days')`,
      [RESPONSE_OPEN, tenantA, RUN_A, VENDOR_OPEN, HASH_OPEN],
    );
    await client.query('COMMIT');

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantB}'`);
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenantB, 'Tenant B (notities)'],
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
      [SUBJECT_ADMIN, 'a'],
      [SUBJECT_B, 'b'],
    ] as const) {
      const sessie = await sessies.aanmaken(subject);
      expect(sessie).not.toBeNull();

      const cookie = `${naam}=${sessie!.token}`;
      if (doel === 'a') cookieAdminA = cookie;
      else cookieB = cookie;
    }
  }, 30000);

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(tenantA, tenantB);
    await client.end();
  }, 30000);

  async function plaats(responseId: string, tekst: string): Promise<string> {
    const antwoord = await request(server)
      .post(`/admin/survey/responses/${responseId}/notes`)
      .set('Cookie', cookieAdminA)
      .send({ tekst })
      .expect(201);

    return (antwoord.body as NotitieBody).notitie.noteId;
  }

  describe('een notitie plaatsen', () => {
    it('geeft de naam van de schrijver en de datum terug', async () => {
      const voor = Date.now();

      const antwoord = await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes`)
        .set('Cookie', cookieAdminA)
        .send({ tekst: 'Gebeld met de leverancier, komt volgende week.' })
        .expect(201);

      const { notitie } = antwoord.body as NotitieBody;

      expect(notitie.tekst).toBe(
        'Gebeld met de leverancier, komt volgende week.',
      );
      // Zonder naam en datum is een notitie in een dossier waardeloos.
      expect(notitie.authorUserId).toBe(ADMIN_A);
      expect(notitie.authorNaam).toBe('Admin van A');
      expect(notitie.createdAt).toBeTruthy();

      const geschrevenOp = new Date(notitie.createdAt).getTime();
      expect(Number.isNaN(geschrevenOp)).toBe(false);
      // Ruime marge; het gaat erom dat het een echt tijdstip is en geen
      // lege string of epoch 0.
      expect(geschrevenOp).toBeGreaterThanOrEqual(voor - 60_000);
      expect(geschrevenOp).toBeLessThanOrEqual(Date.now() + 60_000);
    });

    // Dit is het geval waar de eigenaar om vroeg: notities gaan juist óók over
    // leveranciers die nog niet hebben ingediend.
    it('mag ook op een respons die nog niet is ingediend', async () => {
      await request(server)
        .post(`/admin/survey/responses/${RESPONSE_OPEN}/notes`)
        .set('Cookie', cookieAdminA)
        .send({ tekst: 'Nog niets ontvangen, morgen nabellen.' })
        .expect(201);
    });

    it('weigert een lege notitie', async () => {
      await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes`)
        .set('Cookie', cookieAdminA)
        .send({ tekst: '   ' })
        .expect(400);
    });

    it('negeert een authorUserId uit de body en gebruikt de sessie', async () => {
      const antwoord = await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes`)
        .set('Cookie', cookieAdminA)
        .send({ tekst: 'Op naam van een ander?', authorUserId: adminB })
        .expect(201);

      expect((antwoord.body as NotitieBody).notitie.authorUserId).toBe(ADMIN_A);
    });

    it('geeft 404 op een respons die niet bestaat', async () => {
      await request(server)
        .post(`/admin/survey/responses/${NOTITIE_BESTAAT_NIET}/notes`)
        .set('Cookie', cookieAdminA)
        .send({ tekst: 'Bestaat niet.' })
        .expect(404);
    });

    it("zonder soort in de body wordt 'werk'", async () => {
      const antwoord = await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes`)
        .set('Cookie', cookieAdminA)
        .send({ tekst: 'Gewone werkaantekening.' })
        .expect(201);

      expect((antwoord.body as NotitieBody).notitie.soort).toBe('werk');
    });

    it("met soort 'vastgesteld' legt de overeengekomen wijziging vast", async () => {
      const antwoord = await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes`)
        .set('Cookie', cookieAdminA)
        .send({
          tekst: 'Na overleg akkoord op aangepaste levertermijn.',
          soort: 'vastgesteld',
        })
        .expect(201);

      expect((antwoord.body as NotitieBody).notitie.soort).toBe('vastgesteld');
    });

    it('weigert een onbekend soort', async () => {
      await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes`)
        .set('Cookie', cookieAdminA)
        .send({ tekst: 'Ongeldig soort.', soort: 'definitief' })
        .expect(400);
    });
  });

  describe('notities lezen', () => {
    it('toont de nieuwste eerst, met naam en datum', async () => {
      await plaats(RESPONSE_INGEDIEND, 'Eerste notitie.');
      await plaats(RESPONSE_INGEDIEND, 'Tweede notitie.');

      const antwoord = await request(server)
        .get(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes`)
        .set('Cookie', cookieAdminA)
        .expect(200);

      const { notities } = antwoord.body as LijstBody;

      expect(notities.length).toBeGreaterThanOrEqual(2);
      for (const n of notities) {
        expect(n.authorNaam).toBe('Admin van A');
        expect(n.createdAt).toBeTruthy();
      }
    });

    it('geeft het soort van elke notitie mee', async () => {
      await plaats(RESPONSE_INGEDIEND, 'Werkaantekening voor de lijsttest.');

      const antwoord = await request(server)
        .get(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes`)
        .set('Cookie', cookieAdminA)
        .expect(200);

      const { notities } = antwoord.body as LijstBody;
      for (const n of notities) {
        expect(['werk', 'vastgesteld']).toContain(n.soort);
      }
    });
  });

  describe('een notitie intrekken', () => {
    it('haalt hem uit de lijst maar bewaart de rij', async () => {
      const noteId = await plaats(RESPONSE_INGEDIEND, 'Deze gaat weg.');

      await request(server)
        .delete(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes/${noteId}`)
        .set('Cookie', cookieAdminA)
        .expect(204);

      const lijst = await request(server)
        .get(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes`)
        .set('Cookie', cookieAdminA)
        .expect(200);

      const ids = (lijst.body as LijstBody).notities.map((n) => n.noteId);
      expect(ids).not.toContain(noteId);

      // Wissen zou de historie kapotmaken die deze tabel bewaart.
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
      await client.query(`SET LOCAL app.current_actor = 'medewerker'`);
      const rij = await client.query<{ deleted_at: Date | null }>(
        'SELECT deleted_at FROM clm.response_note WHERE note_id = $1',
        [noteId],
      );
      await client.query('COMMIT');

      expect(rij.rows).toHaveLength(1);
      expect(rij.rows[0].deleted_at).not.toBeNull();
    });

    it('geeft 404 bij een tweede poging', async () => {
      const noteId = await plaats(RESPONSE_INGEDIEND, 'Eenmalig.');
      const pad = `/admin/survey/responses/${RESPONSE_INGEDIEND}/notes/${noteId}`;

      await request(server).delete(pad).set('Cookie', cookieAdminA).expect(204);
      await request(server).delete(pad).set('Cookie', cookieAdminA).expect(404);
    });
  });

  describe('de tenantgrens', () => {
    it('laat tenant B geen notitie plaatsen bij tenant A', async () => {
      await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes`)
        .set('Cookie', cookieB)
        .send({ tekst: 'Meekijken?' })
        .expect(404);
    });

    it('laat tenant B de notities van tenant A niet lezen', async () => {
      await plaats(RESPONSE_INGEDIEND, 'Vertrouwelijk voor A.');

      await request(server)
        .get(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes`)
        .set('Cookie', cookieB)
        .expect(404);
    });

    it('laat tenant B een notitie van tenant A niet intrekken', async () => {
      const noteId = await plaats(RESPONSE_INGEDIEND, 'Blijft staan.');

      await request(server)
        .delete(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes/${noteId}`)
        .set('Cookie', cookieB)
        .expect(404);

      const lijst = await request(server)
        .get(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes`)
        .set('Cookie', cookieAdminA)
        .expect(200);

      const ids = (lijst.body as LijstBody).notities.map((n) => n.noteId);
      expect(ids).toContain(noteId);
    });
  });

  // Tegenproef uit ontwerp §8: een leverancier zit in dezelfde tenant als de
  // notitie over hem, dus de tenantgrens alleen bewijst niets voor dit pad.
  // GET /survey/respond is de enige route die een leverancier zonder account
  // bereikt op basis van zijn token; hij geeft alleen { status, verlooptOp }
  // terug en raakt clm.response_note nergens aan. Getest tegen de echte route
  // (MCM2-CLAUDE.md §15b: test een lek bij de bron), niet met een losse
  // policy-query, omdat die route hier daadwerkelijk bestaat.
  describe('het leverancierspad', () => {
    it('geeft geen response_note terug, ook geen vastgesteld-notitie', async () => {
      await plaats(RESPONSE_INGEDIEND, 'Vertrouwelijke werkaantekening.');
      await request(server)
        .post(`/admin/survey/responses/${RESPONSE_INGEDIEND}/notes`)
        .set('Cookie', cookieAdminA)
        .send({
          tekst: 'Overeengekomen na overleg.',
          soort: 'vastgesteld',
        })
        .expect(201);

      const antwoord = await request(server).get(
        `/survey/respond?t=${RAW_TOKEN_INGEDIEND}`,
      );

      // Wat de route ook teruggeeft (200 met status, of een andere vorm),
      // response_note/notities mag er nergens in voorkomen.
      expect(JSON.stringify(antwoord.body)).not.toContain('response_note');
      expect(JSON.stringify(antwoord.body)).not.toContain(
        'Overeengekomen na overleg.',
      );
    });
  });
});
