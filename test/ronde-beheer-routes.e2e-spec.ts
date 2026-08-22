import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { cookieInstellingen } from '../src/auth/sessie';
import { SessieService } from '../src/auth/sessie.service';
import { TEST_IDS } from './test-ids';

/**
 * Rondes starten en leveranciers uitnodigen (fase B van het surveybeheerplan).
 *
 * ── Wat hier op het spel staat ──────────────────────────────────────────────
 *
 * Dit zijn de eerste routes die tokens uitgeven aan externe partijen. Een fout
 * hier is niet terug te draaien: een uitgegeven token bestaat, en het ruwe
 * token is na dit ene antwoord nergens meer op te vragen.
 *
 * De vragen die deze suite beantwoordt:
 *
 *   1. Krijgt de aanroeper werkelijk een bruikbaar token, en staat in de
 *      database alleen de hash?
 *   2. Kan een reviewer een ronde starten? (Nee — lezen mag, uitzetten niet.)
 *   3. Kan tenant A een leverancier van tenant B uitnodigen?
 *   4. Wat gebeurt er bij een status­overgang die niet mag?
 *   5. Bevriest een actieve ronde de vragenlijst?
 *
 * ── Waarom de hash apart gecontroleerd wordt ────────────────────────────────
 *
 * Het is verleidelijk om alleen te toetsen dat er een token terugkomt. Maar de
 * hele opzet van de tokenlaag staat of valt met wat er níét in de database
 * staat. Een implementatie die het ruwe token opslaat werkt precies hetzelfde
 * vanuit de browser — en is stuk op de enige manier die telt.
 */

const {
  tenantA,
  tenantB,
  adminA,
  reviewerA,
  adminB,
  templateA: TEMPLATE_A,
  templateLeeg: TEMPLATE_LEEG,
  templateB: TEMPLATE_B,
  vendor1: VENDOR_1,
  vendor2: VENDOR_2,
  vendor3: VENDOR_3,
  vendorB: VENDOR_B,
  vendorWeg: VENDOR_WEG,
  contract1: CONTRACT_1,
  onbestaand: ONBESTAAND,
} = TEST_IDS['ronde-beheer-routes'];

const SUBJECT_ADMIN_A = `oid-rb-a-${Date.now()}`;
const SUBJECT_REVIEWER = `oid-rb-r-${Date.now()}`;
const SUBJECT_ADMIN_B = `oid-rb-b-${Date.now()}`;

interface Uitnodiging {
  responseId: string;
  vendorId: string;
  vendorNaam: string;
  token: string;
  expiresAt: string;
  verstuurd: boolean;
  verzendFout?: string;
}

interface UitnodigingAntwoord {
  uitnodigingen: Uitnodiging[];
  /** Alleen échte verzendingen — sinds Issue #131. */
  verzonden: number;
  mislukt: number;
  /** Waar wanneer er geen mailkanaal is: de links moeten met de hand door. */
  geenMailkanaal: boolean;
}

interface RondeAntwoord {
  runId: string;
  templateNaam: string;
  status: string;
  surveyKind: string;
  isTest: boolean;
  closesAt: string | null;
  contractId: string | null;
}

/**
 * Migratierol, altijd naar dezelfde database als DATABASE_URL.
 *
 * Nodig omdat clm_api_runtime geen DELETE heeft op clm.contract
 * (NIET_VERWIJDEREN in rechten-contract.ts — een contract wordt zacht
 * verwijderd). Testopruiming ruimt hard op, dus heeft de migratierol nodig
 * voor die ene tabel — zelfde patroon als contract-routes.e2e-spec.ts.
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

async function verwijderTestdata(client: Client): Promise<void> {
  const migratieClient = new Client({ connectionString: migratieUrl() });
  await migratieClient.connect();

  for (const tenant of [tenantA, tenantB]) {
    await migratieClient.query('BEGIN');
    await migratieClient.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    await migratieClient.query(
      'DELETE FROM clm.contract WHERE tenant_id = $1',
      [tenant],
    );
    await migratieClient.query('COMMIT');

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    for (const tabel of [
      'clm.survey_answer',
      'clm.survey_attachment',
      'clm.survey_response',
      'clm.survey_run',
      'clm.survey_question',
      'clm.survey_category',
      'clm.survey_template',
      'clm.vendor_contact',
      'clm.vendor',
      'clm.tenant_membership',
      'clm."user"',
      'clm.tenant',
    ]) {
      await client.query(`DELETE FROM ${tabel} WHERE tenant_id = $1`, [tenant]);
    }
    await client.query('COMMIT');
  }

  await migratieClient.end();
}

describe('Ronde-beheerroutes (e2e)', () => {
  // Eén limiet voor de hele suite in plaats van 32 losse regels.
  //
  // Elke test hier doet minstens één HTTP-verzoek tegen een echte database, en
  // sommige twee (een ronde aanmaken, dan iets ermee doen). Binnen Jests
  // standaard van 5 seconden past dat alleen op een verder onbelaste machine;
  // in de volledige e2e-run viel er daardoor onregelmatig één om — welke hing
  // af van de volgorde. Zelfde faalvorm als in demo-seed (2026-08-04 en
  // 2026-08-07).
  jest.setTimeout(20_000);

  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let cookieAdminA: string;
  let cookieReviewer: string;
  let cookieAdminB: string;
  const cookieNaam = cookieInstellingen().naam;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(client);

    for (const [tenant, user, subject, naam, rol] of [
      [tenantA, adminA, SUBJECT_ADMIN_A, 'Aisha de admin', 'admin'],
      [tenantA, reviewerA, SUBJECT_REVIEWER, 'Ruben de reviewer', 'reviewer'],
      [tenantB, adminB, SUBJECT_ADMIN_B, 'Bram uit B', 'admin'],
    ] as const) {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);

      await client.query(
        `INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [tenant, `rb-test-${tenant.slice(-2)}`],
      );
      await client.query(
        `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
         VALUES ($1, $2, $3, $4)`,
        [user, tenant, naam, subject],
      );
      await client.query(
        `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
         VALUES ($1, $2, $3)`,
        [user, tenant, rol],
      );
      await client.query('COMMIT');
    }

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);

    // Een vragenlijst met echte vragen, en één zonder — die tweede toetst dat
    // je geen lege lijst kunt uitzetten.
    for (const [id, naam] of [
      [TEMPLATE_A, 'ronde-test-lijst'],
      [TEMPLATE_LEEG, 'ronde-test-leeg'],
    ] as const) {
      await client.query(
        `INSERT INTO clm.survey_template (template_id, tenant_id, name, version)
         VALUES ($1, $2, $3, 1)`,
        [id, tenantA, naam],
      );
    }

    for (const [key, positie, type] of [
      ['intro', 1, 'instruction'],
      ['v1', 2, 'confirmation'],
      ['v2', 3, 'confirmation'],
    ] as const) {
      await client.query(
        `INSERT INTO clm.survey_question
           (tenant_id, template_id, position, question_key, title, body,
            answer_type, is_required, allows_upload, max_files, config)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, false, 0, '{}'::jsonb)`,
        [
          tenantA,
          TEMPLATE_A,
          positie,
          key,
          `Titel ${key}`,
          `Toelichting bij ${key}`,
          type,
        ],
      );
    }

    // De lege lijst krijgt alleen een instructie: die telt niet als vraag, dus
    // dit is de valkuil die 'geen vragen' moet vangen.
    await client.query(
      `INSERT INTO clm.survey_question
         (tenant_id, template_id, position, question_key, title, body,
          answer_type, is_required, allows_upload, max_files, config)
       VALUES ($1, $2, 1, 'alleen-intro', 'Alleen uitleg', 'Geen vraag',
               'instruction', false, false, 0, '{}'::jsonb)`,
      [tenantA, TEMPLATE_LEEG],
    );

    for (const [id, naam, kvk] of [
      [VENDOR_1, 'Eerste Leverancier B.V.', '10000001'],
      [VENDOR_2, 'Tweede Leverancier B.V.', '10000002'],
      [VENDOR_3, 'Derde Leverancier B.V.', '10000003'],
      [VENDOR_WEG, 'Verwijderde Leverancier B.V.', '10000004'],
    ] as const) {
      await client.query(
        `INSERT INTO clm.vendor (vendor_id, tenant_id, name, kvk_number)
         VALUES ($1, $2, $3, $4)`,
        [id, tenantA, naam, kvk],
      );
    }

    // Alleen VENDOR_1 krijgt een contactpersoon met e-mailadres. Dat verschil
    // is opzettelijk: de uitnodigingsroute moet beide gevallen aankunnen, en
    // een leverancier zonder adres hoort zichtbaar te mislukken in plaats van
    // stilzwijgend overgeslagen te worden.
    await client.query(
      `INSERT INTO clm.vendor_contact
              (vendor_id, tenant_id, full_name, email, is_primary)
       VALUES ($1, $2, 'Contact Eerste', 'contact+vendor1@example.test', true)`,
      [VENDOR_1, tenantA],
    );

    // Zacht verwijderd: hij bestaat nog als rij maar mag niet uitgenodigd.
    await client.query(
      `UPDATE clm.vendor SET deleted_at = now() WHERE vendor_id = $1`,
      [VENDOR_WEG],
    );

    // Voor de contractId-koppeling: een contract bij VENDOR_1.
    await client.query(
      `INSERT INTO clm.contract (contract_id, tenant_id, vendor_id, name)
       VALUES ($1, $2, $3, 'Testcontract voor rondes')`,
      [CONTRACT_1, tenantA, VENDOR_1],
    );

    await client.query('COMMIT');

    // Tenant B: eigen vragenlijst en eigen leverancier.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantB}'`);
    await client.query(
      `INSERT INTO clm.survey_template (template_id, tenant_id, name, version)
       VALUES ($1, $2, 'lijst-van-b', 1)`,
      [TEMPLATE_B, tenantB],
    );
    await client.query(
      `INSERT INTO clm.vendor (vendor_id, tenant_id, name, kvk_number)
       VALUES ($1, $2, 'Leverancier van B B.V.', '20000001')`,
      [VENDOR_B, tenantB],
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

    const [a, r, b] = await Promise.all([
      sessies.aanmaken(SUBJECT_ADMIN_A),
      sessies.aanmaken(SUBJECT_REVIEWER),
      sessies.aanmaken(SUBJECT_ADMIN_B),
    ]);

    cookieAdminA = `${cookieNaam}=${a!.token}`;
    cookieReviewer = `${cookieNaam}=${r!.token}`;
    cookieAdminB = `${cookieNaam}=${b!.token}`;
  });

  afterAll(async () => {
    await app?.close();
    await verwijderTestdata(client);
    await client.end();
  });

  /** Maakt een verse ronde en geeft zijn id terug. */
  async function nieuweRonde(templateId = TEMPLATE_A): Promise<string> {
    const antwoord = await request(server)
      .post('/admin/survey/runs')
      .set('Cookie', cookieAdminA)
      .send({ templateId })
      .expect(201);

    return (antwoord.body as RondeAntwoord).runId;
  }

  // ── Een ronde aanmaken ────────────────────────────────────────────────────

  it('maakt een ronde aan in status draft', async () => {
    const antwoord = await request(server)
      .post('/admin/survey/runs')
      .set('Cookie', cookieAdminA)
      .send({ templateId: TEMPLATE_A })
      .expect(201);

    const ronde = antwoord.body as RondeAntwoord;

    // Draft en niet active: de vragenlijst mag pas bevriezen wanneer de
    // beheerder daar bewust voor kiest.
    expect(ronde.status).toBe('draft');
    expect(ronde.templateNaam).toBe('ronde-test-lijst');
    expect(ronde.surveyKind).toBe('vendor_compliance');
    expect(ronde.isTest).toBe(false);
  });

  it('neemt een sluitdatum over', async () => {
    const overDertigDagen = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const antwoord = await request(server)
      .post('/admin/survey/runs')
      .set('Cookie', cookieAdminA)
      .send({ templateId: TEMPLATE_A, closesAt: overDertigDagen })
      .expect(201);

    expect((antwoord.body as RondeAntwoord).closesAt).not.toBeNull();
  });

  it('neemt een contractId over en geeft hem terug', async () => {
    const antwoord = await request(server)
      .post('/admin/survey/runs')
      .set('Cookie', cookieAdminA)
      .send({ templateId: TEMPLATE_A, contractId: CONTRACT_1 })
      .expect(201);

    expect((antwoord.body as RondeAntwoord).contractId).toBe(CONTRACT_1);
  });

  it('geeft 404 bij een onbekend contractId', async () => {
    await request(server)
      .post('/admin/survey/runs')
      .set('Cookie', cookieAdminA)
      .send({
        templateId: TEMPLATE_A,
        contractId: ONBESTAAND,
      })
      .expect(404);
  });

  it('weigert een sluitdatum in het verleden', async () => {
    const gisteren = new Date(Date.now() - 86_400_000).toISOString();

    const antwoord = await request(server)
      .post('/admin/survey/runs')
      .set('Cookie', cookieAdminA)
      .send({ templateId: TEMPLATE_A, closesAt: gisteren })
      .expect(400);

    // Het veld hoort erbij, zodat het scherm de melding naast het juiste
    // invoerveld kan tonen in plaats van bovenaan de pagina.
    expect((antwoord.body as { veld: string }).veld).toBe('closesAt');
  });

  it('weigert een vragenlijst zonder vragen', async () => {
    // TEMPLATE_LEEG heeft alleen een instructiescherm. Uitzetten zou de
    // leverancier een lijst zonder vragen voorschotelen en die toestand
    // vervolgens bevriezen.
    const antwoord = await request(server)
      .post('/admin/survey/runs')
      .set('Cookie', cookieAdminA)
      .send({ templateId: TEMPLATE_LEEG })
      .expect(400);

    expect((antwoord.body as { message: string }).message).toContain(
      'geen vragen',
    );
  });

  it('geeft 404 voor een vragenlijst van een andere tenant', async () => {
    // Niet 403: dat zou verklappen dat dit id ergens bestaat.
    await request(server)
      .post('/admin/survey/runs')
      .set('Cookie', cookieAdminA)
      .send({ templateId: TEMPLATE_B })
      .expect(404);
  });

  it('weigert een reviewer die een ronde wil starten', async () => {
    // Lezen mag hij (fase A), uitzetten niet. Dit is het verschil tussen
    // meekijken en tokens uitgeven aan externe partijen.
    await request(server)
      .post('/admin/survey/runs')
      .set('Cookie', cookieReviewer)
      .send({ templateId: TEMPLATE_A })
      .expect(403);
  });

  it('weigert een verzoek zonder sessie', async () => {
    await request(server)
      .post('/admin/survey/runs')
      .send({ templateId: TEMPLATE_A })
      .expect(401);
  });

  // ── Uitnodigen ────────────────────────────────────────────────────────────

  it('verstuurt de uitnodiging en meldt per leverancier wat er gebeurd is', async () => {
    // In de e2e-omgeving staat geen RESEND_API_KEY, dus draait het logkanaal:
    // er gaat niets over het netwerk. Wat hier bewezen wordt is de keten
    // eromheen — dat de route verstuurt, en dat de uitkomst per leverancier
    // terugkomt in plaats van in een logregel te verdwijnen.
    //
    // VENDOR_1 heeft een contactpersoon, VENDOR_2 niet. Beide horen in het
    // antwoord te staan met hun eigen uitkomst.
    const runId = await nieuweRonde();

    const antwoord = await request(server)
      .post(`/admin/survey/runs/${runId}/participants`)
      .set('Cookie', cookieAdminA)
      .send({ vendorIds: [VENDOR_1, VENDOR_2] })
      .expect(201);

    const body = antwoord.body as UitnodigingAntwoord;

    // Sinds Issue #131 telt `verzonden` alleen échte verzendingen. Hier stond
    // `1`, en die één was de leverancier die het logkanaal "verstuurde" — een
    // mail die nooit bestond. Nul is het eerlijke antwoord.
    expect(body.verzonden).toBe(0);
    // `mislukt` blijft 1: dat is VENDOR_2, zonder e-mailadres. Er is een
    // verschil tussen "niet verstuurd omdat er geen kanaal is" en "niet
    // verstuurd omdat deze leverancier geen adres heeft", en dat verschil
    // hoort zichtbaar te blijven.
    expect(body.mislukt).toBe(1);
    // Het vlaggetje dat het scherm nodig heeft om "0 verstuurd" uit te leggen
    // bij een ronde waar niets mis mee is.
    expect(body.geenMailkanaal).toBe(true);

    const eerste = body.uitnodigingen.find((u) => u.vendorId === VENDOR_1);
    const tweede = body.uitnodigingen.find((u) => u.vendorId === VENDOR_2);

    // Er ging niets uit, dus geen vinkje — ook al ging er niets fout.
    expect(eerste?.verstuurd).toBe(false);
    expect(eerste?.verzendFout).toBeUndefined();

    // Zonder e-mailadres geen uitnodiging — en dat staat er met reden bij.
    expect(tweede?.verstuurd).toBe(false);
    expect(tweede?.verzendFout).toMatch(/geen e-mailadres/i);

    // Het token blijft in het antwoord staan, ook voor wie geen mail kreeg.
    // Dit is het enige moment waarop het bestaat; voor die leverancier is dit
    // de enige manier om de link alsnog door te geven.
    expect(tweede?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('maakt de tokens ook aan als de mail niet verstuurd kan worden', async () => {
    // Versturen gebeurt ná de transactie. Een mislukte mail mag de tokens niet
    // terugdraaien: vier leveranciers die de uitnodiging wél kregen zouden dan
    // op een dode link klikken.
    const runId = await nieuweRonde();

    const antwoord = await request(server)
      .post(`/admin/survey/runs/${runId}/participants`)
      .set('Cookie', cookieAdminA)
      .send({ vendorIds: [VENDOR_2] })
      .expect(201);

    const body = antwoord.body as UitnodigingAntwoord;

    expect(body.mislukt).toBe(1);

    // Tenantcontext expliciet zetten, anders filtert RLS elke rij weg en lijkt
    // de tabel leeg — zelfde patroon als de hash-test hieronder.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
    const rijen = await client.query(
      'SELECT response_id FROM clm.survey_response WHERE run_id = $1',
      [runId],
    );
    await client.query('COMMIT');

    // De deelnemer staat er, ondanks de mislukte verzending.
    expect(rijen.rows).toHaveLength(1);
  });

  it('geeft een bruikbaar token terug en bewaart alleen de hash', async () => {
    const runId = await nieuweRonde();

    const antwoord = await request(server)
      .post(`/admin/survey/runs/${runId}/participants`)
      .set('Cookie', cookieAdminA)
      .send({ vendorIds: [VENDOR_1, VENDOR_2] })
      .expect(201);

    const { uitnodigingen } = antwoord.body as UitnodigingAntwoord;

    expect(uitnodigingen).toHaveLength(2);

    for (const uitnodiging of uitnodigingen) {
      // 43 tekens base64url — de vorm die de tokenguard accepteert. Een token
      // van een andere lengte wordt geweigerd vóórdat de database geraadpleegd
      // wordt, dus dit is geen cosmetische controle.
      expect(uitnodiging.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      // En dit is de kern: in de database staat de hash, niet het token.
      //
      // De tenantcontext moet hier expliciet gezet worden. Zonder die regel
      // filtert RLS elke rij weg en komt er nul terug — wat er als een lege
      // tabel uitziet terwijl de data er gewoon staat. Kostte bij de eerste
      // run een verkeerde conclusie; tegelijk is het het bewijs dat RLS ook
      // buiten de applicatie om zijn werk doet.
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);

      const opgeslagen = await client.query<{ token_hash: string }>(
        'SELECT token_hash FROM clm.survey_response WHERE response_id = $1',
        [uitnodiging.responseId],
      );

      await client.query('COMMIT');

      const verwacht = createHash('sha256')
        .update(uitnodiging.token, 'utf8')
        .digest('hex');

      expect(opgeslagen.rows[0].token_hash).toBe(verwacht);
      expect(opgeslagen.rows[0].token_hash).not.toBe(uitnodiging.token);
    }

    // Twee deelnemers, twee verschillende tokens. Eén generator die per
    // ongeluk hetzelfde token hergebruikt zou hier opvallen.
    expect(uitnodigingen[0].token).not.toBe(uitnodigingen[1].token);
  });

  it('gebruikt 30 dagen wanneer er geen geldigheid is opgegeven', async () => {
    const runId = await nieuweRonde();

    const antwoord = await request(server)
      .post(`/admin/survey/runs/${runId}/participants`)
      .set('Cookie', cookieAdminA)
      .send({ vendorIds: [VENDOR_1] })
      .expect(201);

    const { uitnodigingen } = antwoord.body as UitnodigingAntwoord;
    const dagen =
      (new Date(uitnodigingen[0].expiresAt).getTime() - Date.now()) /
      86_400_000;

    expect(dagen).toBeGreaterThan(29.9);
    expect(dagen).toBeLessThan(30.1);
  });

  it('neemt een afwijkende geldigheid over', async () => {
    const runId = await nieuweRonde();

    const antwoord = await request(server)
      .post(`/admin/survey/runs/${runId}/participants`)
      .set('Cookie', cookieAdminA)
      .send({ vendorIds: [VENDOR_1], geldigheidDagen: 7 })
      .expect(201);

    const { uitnodigingen } = antwoord.body as UitnodigingAntwoord;
    const dagen =
      (new Date(uitnodigingen[0].expiresAt).getTime() - Date.now()) /
      86_400_000;

    expect(dagen).toBeGreaterThan(6.9);
    expect(dagen).toBeLessThan(7.1);
  });

  it('weigert een geldigheid buiten de grenzen', async () => {
    const runId = await nieuweRonde();

    for (const dagen of [0, 181, 2.5]) {
      const antwoord = await request(server)
        .post(`/admin/survey/runs/${runId}/participants`)
        .set('Cookie', cookieAdminA)
        .send({ vendorIds: [VENDOR_1], geldigheidDagen: dagen })
        .expect(400);

      expect((antwoord.body as { veld: string }).veld).toBe('geldigheidDagen');
    }
  });

  it('weigert een leverancier van een andere tenant, zonder er iets uit te geven', async () => {
    const runId = await nieuweRonde();

    const antwoord = await request(server)
      .post(`/admin/survey/runs/${runId}/participants`)
      .set('Cookie', cookieAdminA)
      .send({ vendorIds: [VENDOR_1, VENDOR_B] })
      .expect(400);

    expect((antwoord.body as { veld: string }).veld).toBe('vendorIds');

    // En VENDOR_1 heeft géén uitnodiging gekregen: het verzoek wordt in zijn
    // geheel afgewezen. Een deelselectie uitnodigen zou de beheerder in de
    // waan laten dat iedereen een link heeft.
    const aantal = await client.query<{ count: string }>(
      'SELECT count(*) FROM clm.survey_response WHERE run_id = $1',
      [runId],
    );

    expect(Number(aantal.rows[0].count)).toBe(0);
  });

  it('weigert een zacht verwijderde leverancier', async () => {
    const runId = await nieuweRonde();

    await request(server)
      .post(`/admin/survey/runs/${runId}/participants`)
      .set('Cookie', cookieAdminA)
      .send({ vendorIds: [VENDOR_WEG] })
      .expect(400);
  });

  it('weigert dezelfde leverancier twee keer in één verzoek', async () => {
    const runId = await nieuweRonde();

    const antwoord = await request(server)
      .post(`/admin/survey/runs/${runId}/participants`)
      .set('Cookie', cookieAdminA)
      .send({ vendorIds: [VENDOR_1, VENDOR_1] })
      .expect(400);

    expect((antwoord.body as { message: string }).message).toContain(
      'meer dan één keer',
    );
  });

  it('weigert een lege lijst leveranciers', async () => {
    const runId = await nieuweRonde();

    await request(server)
      .post(`/admin/survey/runs/${runId}/participants`)
      .set('Cookie', cookieAdminA)
      .send({ vendorIds: [] })
      .expect(400);
  });

  it('meldt het wanneer iedereen al is uitgenodigd', async () => {
    const runId = await nieuweRonde();

    await request(server)
      .post(`/admin/survey/runs/${runId}/participants`)
      .set('Cookie', cookieAdminA)
      .send({ vendorIds: [VENDOR_1] })
      .expect(201);

    await request(server)
      .post(`/admin/survey/runs/${runId}/participants`)
      .set('Cookie', cookieAdminA)
      .send({ vendorIds: [VENDOR_1] })
      .expect(409);
  });

  it('slaat over wie er al in zit en nodigt de rest wel uit', async () => {
    const runId = await nieuweRonde();

    await request(server)
      .post(`/admin/survey/runs/${runId}/participants`)
      .set('Cookie', cookieAdminA)
      .send({ vendorIds: [VENDOR_1] })
      .expect(201);

    const antwoord = await request(server)
      .post(`/admin/survey/runs/${runId}/participants`)
      .set('Cookie', cookieAdminA)
      .send({ vendorIds: [VENDOR_1, VENDOR_2] })
      .expect(201);

    const { uitnodigingen } = antwoord.body as UitnodigingAntwoord;

    // Alleen de nieuwe. VENDOR_1 krijgt geen tweede token — dat zou zijn
    // eerste link stilzwijgend naast een tweede zetten.
    expect(uitnodigingen).toHaveLength(1);
    expect(uitnodigingen[0].vendorId).toBe(VENDOR_2);
  });

  it('weigert een reviewer die leveranciers wil uitnodigen', async () => {
    const runId = await nieuweRonde();

    await request(server)
      .post(`/admin/survey/runs/${runId}/participants`)
      .set('Cookie', cookieReviewer)
      .send({ vendorIds: [VENDOR_1] })
      .expect(403);
  });

  it('laat tenant B niet uitnodigen voor een ronde van tenant A', async () => {
    const runId = await nieuweRonde();

    // 404 en niet 403: de ronde bestaat niet vóór B, en dat hoort hij niet te
    // kunnen afleiden uit het antwoord.
    await request(server)
      .post(`/admin/survey/runs/${runId}/participants`)
      .set('Cookie', cookieAdminB)
      .send({ vendorIds: [VENDOR_B] })
      .expect(404);
  });

  // ── Status ────────────────────────────────────────────────────────────────

  it('zet een ronde van draft naar active', async () => {
    const runId = await nieuweRonde();

    const antwoord = await request(server)
      .patch(`/admin/survey/runs/${runId}/status`)
      .set('Cookie', cookieAdminA)
      .send({ status: 'active' })
      .expect(200);

    expect((antwoord.body as RondeAntwoord).status).toBe('active');
  });

  it('weigert een overgang die niet mag, met wat er wel kan', async () => {
    const runId = await nieuweRonde();

    const antwoord = await request(server)
      .patch(`/admin/survey/runs/${runId}/status`)
      .set('Cookie', cookieAdminA)
      .send({ status: 'archived' })
      .expect(409);

    // De melding noemt de mogelijke vervolgstappen. Zonder dat weet de
    // beheerder alleen dat het niet mag, niet wat wél kan.
    expect((antwoord.body as { message: string }).message).toContain('active');
  });

  it('accepteert dezelfde status zonder te klagen', async () => {
    const runId = await nieuweRonde();

    // Twee keer op dezelfde knop drukken hoort geen foutmelding op te leveren.
    await request(server)
      .patch(`/admin/survey/runs/${runId}/status`)
      .set('Cookie', cookieAdminA)
      .send({ status: 'draft' })
      .expect(200);
  });

  it('weigert een onbekende status', async () => {
    const runId = await nieuweRonde();

    await request(server)
      .patch(`/admin/survey/runs/${runId}/status`)
      .set('Cookie', cookieAdminA)
      .send({ status: 'verzonnen' })
      .expect(400);
  });

  it('weigert een reviewer die de status wil wijzigen', async () => {
    const runId = await nieuweRonde();

    await request(server)
      .patch(`/admin/survey/runs/${runId}/status`)
      .set('Cookie', cookieReviewer)
      .send({ status: 'active' })
      .expect(403);
  });

  it('laat geen deelnemers meer toe zodra de ronde is afgerond', async () => {
    const runId = await nieuweRonde();

    await request(server)
      .patch(`/admin/survey/runs/${runId}/status`)
      .set('Cookie', cookieAdminA)
      .send({ status: 'active' })
      .expect(200);

    await request(server)
      .patch(`/admin/survey/runs/${runId}/status`)
      .set('Cookie', cookieAdminA)
      .send({ status: 'finished' })
      .expect(200);

    // Een nieuwe link uitgeven zou de rapportage over die ronde achteraf
    // veranderen.
    await request(server)
      .post(`/admin/survey/runs/${runId}/participants`)
      .set('Cookie', cookieAdminA)
      .send({ vendorIds: [VENDOR_3] })
      .expect(409);
  });

  it('laat wel deelnemers toe aan een lopende ronde', async () => {
    // Besluit eigenaar 2026-08-04: je vergeet er een, of er komt een
    // leverancier bij. Dat moet kunnen zonder een nieuwe ronde te starten.
    const runId = await nieuweRonde();

    await request(server)
      .post(`/admin/survey/runs/${runId}/participants`)
      .set('Cookie', cookieAdminA)
      .send({ vendorIds: [VENDOR_1] })
      .expect(201);

    await request(server)
      .patch(`/admin/survey/runs/${runId}/status`)
      .set('Cookie', cookieAdminA)
      .send({ status: 'active' })
      .expect(200);

    await request(server)
      .post(`/admin/survey/runs/${runId}/participants`)
      .set('Cookie', cookieAdminA)
      .send({ vendorIds: [VENDOR_2] })
      .expect(201);
  });

  // ── De bevriezing ─────────────────────────────────────────────────────────

  it('bevriest de vragenlijst zodra er een ronde op loopt', async () => {
    const runId = await nieuweRonde();

    await request(server)
      .patch(`/admin/survey/runs/${runId}/status`)
      .set('Cookie', cookieAdminA)
      .send({ status: 'active' })
      .expect(200);

    // De trigger survey_question_bevriezing (migratie 0005) hoort dit te
    // weigeren. Deze test staat hier en niet bij de migratie omdat fase B de
    // eerste plek is waar een ronde via een róute actief wordt — als de
    // grendel niet valt, merkt de beheerder dat pas wanneer een leverancier
    // andere vragen krijgt dan waar de ronde over ging.
    await expect(
      (async () => {
        await client.query('BEGIN');
        await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
        await client.query(
          `UPDATE clm.survey_question SET title = 'Gewijzigd na start'
            WHERE template_id = $1 AND question_key = 'v1'`,
          [TEMPLATE_A],
        );
        await client.query('COMMIT');
      })(),
    ).rejects.toThrow();

    await client.query('ROLLBACK').catch(() => undefined);
  });

  // ── Het lek dat nooit mag ontstaan ────────────────────────────────────────

  it('geeft de token_hash nooit terug in het rondedetail', async () => {
    const runId = await nieuweRonde();

    const uitgenodigd = await request(server)
      .post(`/admin/survey/runs/${runId}/participants`)
      .set('Cookie', cookieAdminA)
      .send({ vendorIds: [VENDOR_1] })
      .expect(201);

    const { uitnodigingen } = uitgenodigd.body as UitnodigingAntwoord;
    const hash = createHash('sha256')
      .update(uitnodigingen[0].token, 'utf8')
      .digest('hex');

    const detail = await request(server)
      .get(`/admin/survey/runs/${runId}`)
      .set('Cookie', cookieAdminA)
      .expect(200);

    // De hele body doorzoeken en niet één veld: een lek test je bij de bron,
    // niet op de plek waar je hoopt dat het niet opduikt (tegenproef 6).
    const body = JSON.stringify(detail.body);

    expect(body).not.toContain(hash);
    expect(body).not.toContain(uitnodigingen[0].token);
    expect(body).not.toContain('token');
  });

  // ── Wachtlijst ───────────────────────────────────────────────────────────

  it('geeft de leverancier terug die op de wachtlijst staat voor deze template', async () => {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
    await client.query(
      `INSERT INTO clm.contract_survey_template
         (contract_id, survey_template_id, tenant_id, wachtlijst)
       VALUES ($1, $2, $3, true)`,
      [CONTRACT_1, TEMPLATE_A, tenantA],
    );
    await client.query('COMMIT');

    const antwoord = await request(server)
      .get(`/admin/survey/templates/${TEMPLATE_A}/wachtlijst`)
      .set('Cookie', cookieAdminA)
      .expect(200);

    const { leveranciers } = antwoord.body as {
      leveranciers: { vendorId: string; vendorNaam: string }[];
    };

    expect(leveranciers.some((l) => l.vendorId === VENDOR_1)).toBe(true);
  });

  it('geeft een lege lijst als niemand op de wachtlijst staat', async () => {
    const antwoord = await request(server)
      .get(`/admin/survey/templates/${TEMPLATE_LEEG}/wachtlijst`)
      .set('Cookie', cookieAdminA)
      .expect(200);

    expect((antwoord.body as { leveranciers: unknown[] }).leveranciers).toEqual(
      [],
    );
  });
});
