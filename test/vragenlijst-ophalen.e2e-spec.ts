import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/db/database.service';
import {
  berekenVervalmoment,
  genereerToken,
  hashToken,
} from '../src/survey/survey-token';
import { VragenlijstImportService } from '../src/survey/vragenlijst-import.service';

const TENANT_A = '00000000-0000-0000-0000-0000000000c1';
const TENANT_B = '00000000-0000-0000-0000-0000000000c2';
const SEEDMAP = join(__dirname, '..', 'db', 'seeds');

interface VraagVorm {
  questionKey: string;
  title: string;
  body: string;
  answerType: string;
  isRequired: boolean;
  allowsUpload: boolean;
  maxFiles: number;
  config: Record<string, unknown>;
}

interface VragenlijstVorm {
  name: string;
  categories: {
    key: string;
    name: string;
    minAnswers: number;
    questions: VraagVorm[];
  }[];
  questions: VraagVorm[];
  closesAt: string | null;
}

let volgnummer = 0;
const uniekeVersie = () => 700 + (Date.now() % 100000) + volgnummer++;

/**
 * Toetst GET /survey/respond/questions van buitenaf — precies zoals het
 * leverancierportaal hem bereikt: via HTTP, met alleen een token.
 */
describe('Vragenlijst ophalen (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let importService: VragenlijstImportService;
  let server: App;

  /**
   * Zet een volledige keten neer: template → run → response → token.
   *
   * `vendorId` meegeven koppelt de respons aan een bestaande leverancier in
   * plaats van een nieuwe aan te maken. Dat is nodig om het UC1/UC2-scenario na
   * te bootsen: twee responses over dezelfde leverancier, met verschillende
   * vragenlijsten.
   */
  async function maakLink(opties: {
    tenantId: string;
    templateId: string;
    naam: string;
    rondeStatus?: string;
    sluitOver?: number;
    vendorId?: string;
    /** UC2: de invuller is een collega, dus vendor_id blijft leeg. */
    interneBeoordeling?: boolean;
  }): Promise<{ token: string; vendorId: string }> {
    const token = genereerToken();

    const vendorId = await db.withTenant(opties.tenantId, async (tx) => {
      if (opties.vendorId) return opties.vendorId;

      const vendor = await tx.execute<{ vendor_id: string }>(
        sql`INSERT INTO clm.vendor (tenant_id, name)
            VALUES (${opties.tenantId}, ${`v-${opties.naam}`})
            RETURNING vendor_id`,
      );
      return vendor.rows[0].vendor_id;
    });

    await db.withTenant(opties.tenantId, async (tx) => {
      const run = await tx.execute<{ run_id: string }>(
        sql`INSERT INTO clm.survey_run
                (tenant_id, template_id, status, survey_kind, closes_at)
            VALUES (${opties.tenantId}, ${opties.templateId},
                    ${opties.rondeStatus ?? 'active'},
                    ${
                      opties.interneBeoordeling
                        ? 'internal_review'
                        : 'vendor_compliance'
                    },
                    ${
                      opties.sluitOver === undefined
                        ? null
                        : new Date(Date.now() + opties.sluitOver).toISOString()
                    })
            RETURNING run_id`,
      );

      await tx.execute(
        sql`INSERT INTO clm.survey_response
                (tenant_id, run_id, vendor_id, subject_vendor_id,
                 respondent_label, token_hash, expires_at)
            VALUES (${opties.tenantId}, ${run.rows[0].run_id},
                    ${opties.interneBeoordeling ? null : vendorId},
                    ${vendorId},
                    ${opties.interneBeoordeling ? 'collega' : null},
                    ${hashToken(token)},
                    ${berekenVervalmoment().toISOString()})`,
      );
    });

    return { token, vendorId };
  }

  async function importeerSeed(
    tenantId: string,
    bestand: string,
  ): Promise<string> {
    const document = JSON.parse(
      readFileSync(join(SEEDMAP, bestand), 'utf8'),
    ) as Record<string, unknown>;

    const resultaat = await importService.importeer(tenantId, {
      ...document,
      version: uniekeVersie(),
    });

    return resultaat.templateId;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(DatabaseService);
    importService = app.get(VragenlijstImportService);
    server = app.getHttpServer();

    for (const tenantId of [TENANT_A, TENANT_B]) {
      await db.withTenant(tenantId, async (tx) => {
        await tx.execute(
          sql`INSERT INTO clm.tenant (tenant_id, name)
              VALUES (${tenantId}, ${`ophalen-${tenantId.slice(-2)}`})
              ON CONFLICT (tenant_id) DO NOTHING`,
        );
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('UC1 — de acht Transdev-vragen', () => {
    let token: string;
    let lijst: VragenlijstVorm;

    beforeAll(async () => {
      const templateId = await importeerSeed(
        TENANT_A,
        'transdev-annual-vendor-it-risk-v1.json',
      );
      ({ token } = await maakLink({
        tenantId: TENANT_A,
        templateId,
        naam: 'uc1',
        sluitOver: 30 * 24 * 60 * 60 * 1000,
      }));

      const res = await request(server)
        .get('/survey/respond/questions')
        .query({ t: token })
        .expect(200);

      lijst = res.body as VragenlijstVorm;
    });

    it('levert negen vragen als platte lijst, zonder categorieën', () => {
      // UC1 heeft geen categorieën; alles hoort in `questions` te staan.
      expect(lijst.categories).toHaveLength(0);
      expect(lijst.questions).toHaveLength(9);
    });

    it('houdt de volgorde aan uit het bestand', () => {
      expect(lijst.questions.map((v) => v.questionKey)).toEqual([
        'intro',
        'q1',
        'q2',
        'q3',
        'q4',
        'q5',
        'q6',
        'q7',
        'q8',
      ]);
    });

    it('geeft het leesblok als instruction, niet verplicht', () => {
      // Testpunt 32: het portaal moet dit blok kunnen overslaan bij het
      // bepalen of alles beantwoord is.
      const intro = lijst.questions[0];

      expect(intro.answerType).toBe('instruction');
      expect(intro.isRequired).toBe(false);
    });

    it('geeft de uploadvraag met allowsUpload en maxFiles', () => {
      const q1 = lijst.questions.find((v) => v.questionKey === 'q1');

      expect(q1?.answerType).toBe('confirmation');
      expect(q1?.allowsUpload).toBe(true);
      expect(q1?.maxFiles).toBe(2);
    });

    it('geeft de deadline van de ronde mee', () => {
      expect(lijst.closesAt).not.toBeNull();
      expect(new Date(lijst.closesAt as string).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it('lekt geen tenant, vendor of response-ID', () => {
      // Dezelfde terughoudendheid als de statusroute: wie een geldig token
      // bemachtigt, hoort daar geen extra gegevens uit te kunnen halen.
      //
      // Getoetst op de VELDNAMEN en op de UUIDs, niet op losse woorden in de
      // JSON. De vraagteksten bevatten namelijk zelf "vendor compliance" — een
      // regex over de hele body zou daarop afgaan en daarmee iets anders
      // toetsen dan bedoeld.
      const velden = new Set<string>();
      const verzamel = (waarde: unknown): void => {
        if (Array.isArray(waarde)) {
          waarde.forEach(verzamel);
        } else if (typeof waarde === 'object' && waarde !== null) {
          for (const [sleutel, inhoud] of Object.entries(waarde)) {
            velden.add(sleutel);
            verzamel(inhoud);
          }
        }
      };
      verzamel(lijst);

      const verdacht = [...velden].filter((veld) =>
        /tenant|vendor|response|token|template_?id/i.test(veld),
      );

      expect(verdacht).toEqual([]);
      expect(JSON.stringify(lijst)).not.toContain(TENANT_A);
    });
  });

  describe('UC2 — de interne beoordeling', () => {
    let lijst: VragenlijstVorm;

    beforeAll(async () => {
      const templateId = await importeerSeed(
        TENANT_A,
        'transdev-leveranciersbeoordeling-v1.json',
      );
      const { token } = await maakLink({
        tenantId: TENANT_A,
        templateId,
        naam: 'uc2',
        interneBeoordeling: true,
      });

      const res = await request(server)
        .get('/survey/respond/questions')
        .query({ t: token })
        .expect(200);

      lijst = res.body as VragenlijstVorm;
    });

    it('groepeert de vragen in zes categorieën, op volgorde', () => {
      expect(lijst.categories.map((c) => c.name)).toEqual([
        'Duidelijkheid',
        'Behoefte',
        'Kwaliteit',
        'Kosten',
        "Risico's",
        'Besturing',
      ]);
    });

    it('verdeelt de 28 ratingvragen over de categorieën', () => {
      expect(lijst.categories.map((c) => c.questions.length)).toEqual([
        4, 4, 5, 5, 5, 5,
      ]);
    });

    it('zet de vraag zonder categorie apart', () => {
      // De afsluitende open toelichting hoort bij het geheel, niet bij één
      // categorie. Het portaal toont hem daarom los.
      expect(lijst.questions).toHaveLength(1);
      expect(lijst.questions[0].answerType).toBe('open_text');
    });

    it('geeft minAnswers per categorie mee', () => {
      // Onder die drempel is de categoriescore null in plaats van een
      // gemiddelde over te weinig punten (ontwerp §2).
      expect(lijst.categories.every((c) => c.minAnswers === 3)).toBe(true);
    });

    it('vertaalt config naar camelCase', () => {
      // De database heeft min_label/max_label; het portaal verwacht
      // minLabel/maxLabel. Die vertaling hoort in de backend, anders gaan
      // frontend en backend uit elkaar lopen zodra er een veld bijkomt.
      const eerste = lijst.categories[0].questions[0];

      expect(eerste.answerType).toBe('rating');
      expect(eerste.config).toMatchObject({
        min: 1,
        max: 5,
        minLabel: 'Zeer ondermaats',
        maxLabel: 'Uitstekend',
      });
      expect(eerste.config).not.toHaveProperty('min_label');
    });

    it('geeft closesAt als null wanneer de ronde geen deadline heeft', () => {
      expect(lijst.closesAt).toBeNull();
    });
  });

  describe('Toegang', () => {
    it('weigert een verzoek zonder token met 404', async () => {
      await request(server).get('/survey/respond/questions').expect(404);
    });

    it('weigert een onbekend token met 404', async () => {
      await request(server)
        .get('/survey/respond/questions')
        .query({ t: genereerToken() })
        .expect(404);
    });

    it('weigert een ronde die nog in draft staat met 410', async () => {
      // De guard weegt de lifecycle mee (migratie 0006). Deze route erft dat
      // gedrag doordat de guard op controllerniveau staat.
      const templateId = await importeerSeed(
        TENANT_A,
        'transdev-annual-vendor-it-risk-v1.json',
      );
      const { token } = await maakLink({
        tenantId: TENANT_A,
        templateId,
        naam: 'draft',
        rondeStatus: 'draft',
      });

      await request(server)
        .get('/survey/respond/questions')
        .query({ t: token })
        .expect(410);
    });

    it('geeft een leverancier uitsluitend zijn eigen respons (testpunt 39)', async () => {
      // De kern van de scheiding tussen UC1 en UC2. Twee responses in
      // dezelfde tenant, op verschillende vragenlijsten. Het token van de een
      // mag nooit de vragen van de ander opleveren.
      //
      // Deze test bewaakt de garantie die sneuvelt zodra iemand een route
      // bouwt die op subject_vendor_id filtert in plaats van op response_id.
      const uc1Template = await importeerSeed(
        TENANT_A,
        'transdev-annual-vendor-it-risk-v1.json',
      );
      const uc2Template = await importeerSeed(
        TENANT_A,
        'transdev-leveranciersbeoordeling-v1.json',
      );

      // Cruciaal: ÉÉN leverancier, twee responses. De UC2-beoordeling gaat
      // over dezelfde partij (`subject_vendor_id`), maar wordt ingevuld door
      // een collega. Zouden dit twee verschillende leveranciers zijn, dan zou
      // deze test ook slagen met een route die op subject_vendor_id filtert —
      // en dan bewijst hij niets. Geverifieerd door dat lek in te bouwen: met
      // twee vendors bleef alles groen, met één vendor valt hij om.
      const { token: tokenExtern, vendorId } = await maakLink({
        tenantId: TENANT_A,
        templateId: uc1Template,
        naam: 'gedeelde-vendor',
      });
      const { token: tokenIntern } = await maakLink({
        tenantId: TENANT_A,
        templateId: uc2Template,
        naam: 'intern',
        vendorId,
        interneBeoordeling: true,
      });

      const extern = await request(server)
        .get('/survey/respond/questions')
        .query({ t: tokenExtern })
        .expect(200);
      const intern = await request(server)
        .get('/survey/respond/questions')
        .query({ t: tokenIntern })
        .expect(200);

      const externeLijst = extern.body as VragenlijstVorm;
      const interneLijst = intern.body as VragenlijstVorm;

      // De externe leverancier ziet de compliance-vragen, niet de interne
      // beoordeling — en andersom.
      expect(externeLijst.categories).toHaveLength(0);
      expect(externeLijst.questions).toHaveLength(9);
      expect(interneLijst.categories).toHaveLength(6);

      // Geen enkele vraagsleutel van de interne beoordeling komt voor in wat
      // de leverancier krijgt.
      const interneSleutels = interneLijst.categories
        .flatMap((c) => c.questions)
        .map((v) => v.questionKey);
      const externeSleutels = externeLijst.questions.map((v) => v.questionKey);

      expect(
        externeSleutels.filter((s) => interneSleutels.includes(s)),
      ).toEqual([]);
    });

    it('geeft een UC2-link toegang, ook al is de invuller geen leverancier', async () => {
      // Regressietest voor de bug die migratie 0008 repareert.
      //
      // resolve_survey_token() bepaalde vendor_active via een join op
      // survey_response.vendor_id. Bij UC2 is die kolom bewust NULL — de
      // invuller is een collega — waardoor de join niets opleverde,
      // vendor_active false werd en de guard élke interne beoordeling met 410
      // afwees. De fix joint op subject_vendor_id, die bij beide use cases
      // gevuld is.
      //
      // Deze test hoort te falen zodra iemand die join terugdraait.
      const templateId = await importeerSeed(
        TENANT_A,
        'transdev-leveranciersbeoordeling-v1.json',
      );
      const { token } = await maakLink({
        tenantId: TENANT_A,
        templateId,
        naam: 'uc2-toegang',
        interneBeoordeling: true,
      });

      await request(server)
        .get('/survey/respond/questions')
        .query({ t: token })
        .expect(200);
    });

    it('weigert een UC2-link zodra de beoordeelde leverancier is verwijderd', async () => {
      // De keerzijde van bovenstaande fix: vendor_active moet nog steeds
      // wérken. Een beoordeling over een leverancier die uit het bestand is
      // gehaald, hoort niet meer ingevuld te worden — ook niet door een
      // collega. Zonder deze test zou "join op subject_vendor_id" ook kunnen
      // betekenen "controleer helemaal niets meer".
      const templateId = await importeerSeed(
        TENANT_A,
        'transdev-leveranciersbeoordeling-v1.json',
      );
      const { token, vendorId } = await maakLink({
        tenantId: TENANT_A,
        templateId,
        naam: 'uc2-verwijderd',
        interneBeoordeling: true,
      });

      await db.withTenant(TENANT_A, async (tx) => {
        await tx.execute(
          sql`UPDATE clm.vendor SET deleted_at = now()
               WHERE vendor_id = ${vendorId}`,
        );
      });

      await request(server)
        .get('/survey/respond/questions')
        .query({ t: token })
        .expect(410);
    });

    it('geeft een token van tenant A nooit de vragen van tenant B', async () => {
      const templateB = await importeerSeed(
        TENANT_B,
        'transdev-annual-vendor-it-risk-v1.json',
      );
      const { token: tokenB } = await maakLink({
        tenantId: TENANT_B,
        templateId: templateB,
        naam: 'tenant-b',
      });

      // Het token van B werkt in B, en levert daar B's eigen vragenlijst.
      const res = await request(server)
        .get('/survey/respond/questions')
        .query({ t: tokenB })
        .expect(200);

      const lijst = res.body as VragenlijstVorm;
      expect(lijst.questions).toHaveLength(9);
      expect(JSON.stringify(lijst)).not.toContain(TENANT_A);
    });
  });

  describe('Een ronde zonder vragen', () => {
    it('geeft 404 met een leesbare melding in plaats van een leeg formulier', async () => {
      // Een lege template is zeldzaam maar mogelijk: een ronde kan gestart
      // worden voordat er vragen in staan. Een lege lijst teruggeven zou het
      // portaal een formulier zonder vragen laten tonen — kapot ogend zonder
      // uit te leggen waarom.
      const leeg = await db.withTenant(TENANT_A, async (tx) => {
        const rij = await tx.execute<{ template_id: string }>(
          sql`INSERT INTO clm.survey_template (tenant_id, name, version)
              VALUES (${TENANT_A}, ${`leeg-${uniekeVersie()}`}, 1)
              RETURNING template_id`,
        );
        return rij.rows[0].template_id;
      });

      const { token } = await maakLink({
        tenantId: TENANT_A,
        templateId: leeg,
        naam: 'leeg',
      });

      const res = await request(server)
        .get('/survey/respond/questions')
        .query({ t: token })
        .expect(404);

      const body = res.body as { message?: string };
      expect(body.message).toMatch(/geen vragenlijst/i);
      // Geen framework-404: die begint met "Cannot GET" en lekt het routepad.
      expect(body.message).not.toMatch(/^Cannot /);
    });
  });
});
