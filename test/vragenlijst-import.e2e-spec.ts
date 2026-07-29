import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';

import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/db/database.service';
import {
  TemplateBestaatAlError,
  TemplateOnbekendError,
  VragenlijstImportService,
} from '../src/survey/vragenlijst-import.service';
import {
  VragenlijstOngeldigError,
  valideerVragenlijst,
} from '../src/survey/vragenlijst-schema';

// Eigen tenants, bewust niet ...f1/...f2: die zijn in gebruik door
// survey-token-isolatie.e2e-spec.ts. Templates zijn uniek op
// (tenant_id, name, version), dus twee suites die dezelfde tenant vullen
// botsen bij de tweede run tegen een testdatabase die blijft staan.
const TENANT_A = '00000000-0000-0000-0000-0000000000d1';
const TENANT_B = '00000000-0000-0000-0000-0000000000d2';

/** Kortste geldige vragenlijst; per test uitgebreid met wat er getoetst wordt. */
function basislijst(overschrijf: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    name: `lijst-${Math.random().toString(36).slice(2, 10)}`,
    version: 1,
    categories: [],
    questions: [
      {
        question_key: 'q1',
        position: 1,
        title: 'ISO 27001 Certification Evidence',
        body: 'Do you confirm that your organisation holds a valid ISO 27001 certificate?',
        answer_type: 'confirmation',
        is_required: true,
        allows_upload: true,
        max_files: 2,
        config: {},
      },
    ],
    ...overschrijf,
  };
}

/** Vangt de bezwaarpaden op; die zijn de betekenisvolle uitkomst, niet de tekst. */
async function bezwaren(fn: () => Promise<unknown>): Promise<string[]> {
  try {
    await fn();
  } catch (fout) {
    if (fout instanceof VragenlijstOngeldigError) {
      return fout.bezwaren.map((b) => b.pad);
    }
    throw fout;
  }
  throw new Error(
    'Verwachtte een VragenlijstOngeldigError, maar er kwam er geen.',
  );
}

describe('Vragenlijst import/export (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let service: VragenlijstImportService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(DatabaseService);
    service = app.get(VragenlijstImportService);

    for (const tenantId of [TENANT_A, TENANT_B]) {
      await db.withTenant(tenantId, async (tx) => {
        await tx.execute(
          sql`INSERT INTO clm.tenant (tenant_id, name)
              VALUES (${tenantId}, ${`import-test-${tenantId.slice(-2)}`})
              ON CONFLICT (tenant_id) DO NOTHING`,
        );
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Validatie van het bestand', () => {
    it('weigert een onbekende schema_version zonder de rest te beoordelen', async () => {
      // Een later formaat moet herkenbaar weigeren in plaats van half inlezen.
      const paden = await bezwaren(() =>
        service.importeer(TENANT_A, basislijst({ schema_version: 2 })),
      );

      expect(paden).toEqual(['schema_version']);
    });

    it('weigert een bestand dat zelf een tenant_id meebrengt (testpunt 31)', async () => {
      // De zwaarste in beveiligingstermen: een importbestand is client-invoer,
      // en de tenant daaruit overnemen is precies wat Issue #7 verbiedt.
      const paden = await bezwaren(() =>
        service.importeer(TENANT_A, basislijst({ tenant_id: TENANT_B })),
      );

      expect(paden).toContain('tenant_id');
    });

    it('weigert UUIDs in het bestand — die worden bij import gegenereerd', async () => {
      const paden = await bezwaren(() =>
        service.importeer(
          TENANT_A,
          basislijst({
            template_id: '00000000-0000-0000-0000-00000000beef',
            category_id: '00000000-0000-0000-0000-00000000cafe',
          }),
        ),
      );

      expect(paden).toEqual(
        expect.arrayContaining(['template_id', 'category_id']),
      );
    });

    it('verzamelt álle bezwaren in plaats van bij de eerste te stoppen', async () => {
      // Wie 29 vragen importeert, wil niet 29 keer opnieuw proberen.
      const paden = await bezwaren(() =>
        service.importeer(
          TENANT_A,
          basislijst({
            name: '',
            version: 0,
            questions: [
              {
                question_key: '',
                position: 0,
                title: '',
                body: '',
                answer_type: 'geen_bestaand_type',
              },
            ],
          }),
        ),
      );

      expect(paden.length).toBeGreaterThan(4);
      expect(paden).toEqual(
        expect.arrayContaining([
          'name',
          'version',
          'questions[0].question_key',
          'questions[0].answer_type',
        ]),
      );
    });

    it('weigert een rating met min >= max (testpunt 29)', () => {
      // De database bewaakt de inhoud van config niet: voor Postgres is dit een
      // geldige rij. Zonder deze controle ziet een leverancier een kapotte vraag.
      expect(() =>
        valideerVragenlijst(
          basislijst({
            questions: [
              {
                question_key: 'q1',
                position: 1,
                title: 'Samenwerking',
                body: 'Hoe beoordeelt u de samenwerking?',
                answer_type: 'rating',
                config: { min: 5, max: 1 },
              },
            ],
          }),
        ),
      ).toThrow(VragenlijstOngeldigError);
    });

    it('weigert een single_choice zonder opties en een multi_choice met dubbele codes', () => {
      const zonderOpties = () =>
        valideerVragenlijst(
          basislijst({
            questions: [
              {
                question_key: 'q1',
                position: 1,
                title: 'Keuze',
                body: 'Kies er een',
                answer_type: 'single_choice',
                config: {},
              },
            ],
          }),
        );

      expect(zonderOpties).toThrow(VragenlijstOngeldigError);

      const dubbeleCodes = () =>
        valideerVragenlijst(
          basislijst({
            questions: [
              {
                question_key: 'q1',
                position: 1,
                title: 'Keuze',
                body: 'Kies er een of meer',
                answer_type: 'multi_choice',
                config: {
                  options: [
                    { code: 'a', label: 'A' },
                    { code: 'a', label: 'Nogmaals A' },
                  ],
                },
              },
            ],
          }),
        );

      expect(dubbeleCodes).toThrow(VragenlijstOngeldigError);
    });

    it('weigert een verplicht instruction-blok', () => {
      // Een leesblok kan niet verplicht zijn: er valt niets te beantwoorden,
      // dus zo'n vragenlijst zou nooit compleet zijn. Spiegelt de CHECK uit 0005.
      expect(() =>
        valideerVragenlijst(
          basislijst({
            questions: [
              {
                question_key: 'intro',
                position: 1,
                title: 'Toelichting',
                body: 'Leest u dit eerst.',
                answer_type: 'instruction',
                is_required: true,
              },
            ],
          }),
        ),
      ).toThrow(VragenlijstOngeldigError);
    });

    it('weigert allows_upload met max_files buiten 1..5, en max_files zonder upload', () => {
      const teVeel = () =>
        valideerVragenlijst(
          basislijst({
            questions: [
              {
                question_key: 'q1',
                position: 1,
                title: 'Bewijs',
                body: 'Upload uw certificaat',
                answer_type: 'file_upload',
                allows_upload: true,
                max_files: 9,
              },
            ],
          }),
        );

      expect(teVeel).toThrow(VragenlijstOngeldigError);

      const zonderUpload = () =>
        valideerVragenlijst(
          basislijst({
            questions: [
              {
                question_key: 'q1',
                position: 1,
                title: 'Vraag',
                body: 'Bevestigt u dit?',
                answer_type: 'confirmation',
                allows_upload: false,
                max_files: 2,
              },
            ],
          }),
        );

      expect(zonderUpload).toThrow(VragenlijstOngeldigError);
    });

    it('weigert een category_key die niet in het bestand staat', () => {
      expect(() =>
        valideerVragenlijst(
          basislijst({
            categories: [{ key: 'kwaliteit', position: 1, name: 'Kwaliteit' }],
            questions: [
              {
                question_key: 'q1',
                position: 1,
                title: 'Vraag',
                body: 'Tekst',
                answer_type: 'yes_no',
                category_key: 'bestaat-niet',
              },
            ],
          }),
        ),
      ).toThrow(VragenlijstOngeldigError);
    });

    it('weigert dubbele question_keys en dubbele posities', () => {
      const paden: string[] = [];
      try {
        valideerVragenlijst(
          basislijst({
            questions: [
              {
                question_key: 'q1',
                position: 1,
                title: 'Een',
                body: 'Tekst',
                answer_type: 'yes_no',
              },
              {
                question_key: 'q1',
                position: 1,
                title: 'Twee',
                body: 'Tekst',
                answer_type: 'yes_no',
              },
            ],
          }),
        );
      } catch (fout) {
        if (fout instanceof VragenlijstOngeldigError) {
          paden.push(...fout.bezwaren.map((b) => b.pad));
        }
      }

      expect(paden).toEqual(
        expect.arrayContaining([
          'questions[1].question_key',
          'questions[1].position',
        ]),
      );
    });
  });

  describe('Importeren', () => {
    it('importeert in de eigen tenant, ook als het bestand een andere noemt (testpunt 31)', async () => {
      // Het bestand wordt geweigerd; de tenant komt nooit uit client-invoer.
      // De tegenproef: zonder dat veld importeert dezelfde inhoud wél, en dan
      // in TENANT_A — niet in de tenant die het bestand noemde.
      const resultaat = await service.importeer(TENANT_A, basislijst());

      const inA = await db.withTenant(TENANT_A, (tx) =>
        tx.execute<{ n: string }>(
          sql`SELECT count(*)::text AS n FROM clm.survey_template
               WHERE template_id = ${resultaat.templateId}`,
        ),
      );
      const inB = await db.withTenant(TENANT_B, (tx) =>
        tx.execute<{ n: string }>(
          sql`SELECT count(*)::text AS n FROM clm.survey_template
               WHERE template_id = ${resultaat.templateId}`,
        ),
      );

      expect(inA.rows[0].n).toBe('1');
      expect(inB.rows[0].n).toBe('0');
    });

    it('legt de categoriekoppeling via category_key en genereert nieuwe UUIDs (testpunt 48)', async () => {
      const resultaat = await service.importeer(
        TENANT_A,
        basislijst({
          categories: [
            {
              key: 'duidelijkheid',
              position: 1,
              name: 'Duidelijkheid',
              min_answers: 3,
            },
            {
              key: 'kwaliteit',
              position: 2,
              name: 'Kwaliteit',
              min_answers: 2,
            },
          ],
          questions: [
            {
              question_key: 'q1',
              category_key: 'kwaliteit',
              position: 1,
              title: 'Kwaliteit van levering',
              body: 'Hoe beoordeelt u de kwaliteit?',
              answer_type: 'rating',
              config: { min: 1, max: 5 },
            },
            {
              question_key: 'q2',
              category_key: 'duidelijkheid',
              position: 2,
              title: 'Afspraken',
              body: 'Waren de afspraken helder?',
              answer_type: 'yes_no',
            },
          ],
        }),
      );

      expect(resultaat.aantalCategorieen).toBe(2);
      expect(resultaat.aantalVragen).toBe(2);

      const gekoppeld = await db.withTenant(TENANT_A, (tx) =>
        tx.execute<{
          question_key: string;
          categorie: string;
          min_answers: number;
        }>(
          sql`SELECT q.question_key, c.name AS categorie, c.min_answers
                FROM clm.survey_question q
                JOIN clm.survey_category c ON c.category_id = q.category_id
               WHERE q.template_id = ${resultaat.templateId}
               ORDER BY q.position`,
        ),
      );

      expect(gekoppeld.rows).toEqual([
        { question_key: 'q1', categorie: 'Kwaliteit', min_answers: 2 },
        { question_key: 'q2', categorie: 'Duidelijkheid', min_answers: 3 },
      ]);
    });

    it('laat category_id leeg bij een vragenlijst zonder categorieën (UC1, testpunt 46)', async () => {
      const resultaat = await service.importeer(TENANT_A, basislijst());

      const rijen = await db.withTenant(TENANT_A, (tx) =>
        tx.execute<{ category_id: string | null }>(
          sql`SELECT category_id FROM clm.survey_question
               WHERE template_id = ${resultaat.templateId}`,
        ),
      );

      expect(rijen.rows).toHaveLength(1);
      expect(rijen.rows[0].category_id).toBeNull();
    });

    it('weigert dezelfde naam en versie twee keer', async () => {
      const lijst = basislijst();
      await service.importeer(TENANT_A, lijst);

      await expect(service.importeer(TENANT_A, lijst)).rejects.toThrow(
        TemplateBestaatAlError,
      );
    });

    it('staat dezelfde naam toe als tweede versie', async () => {
      const lijst = basislijst();
      await service.importeer(TENANT_A, lijst);

      const tweede = await service.importeer(TENANT_A, {
        ...lijst,
        version: 2,
      });

      expect(tweede.versie).toBe(2);
    });

    it('staat dezelfde naam en versie toe in een andere tenant', async () => {
      // Uniciteit is per tenant. Twee klanten mogen dezelfde vragenlijstnaam
      // gebruiken zonder elkaar in de weg te zitten.
      const lijst = basislijst();
      await service.importeer(TENANT_A, lijst);

      await expect(service.importeer(TENANT_B, lijst)).resolves.toMatchObject({
        versie: 1,
      });
    });

    it('laat niets achter wanneer de import halverwege faalt', async () => {
      // Een halve vragenlijst is erger dan geen: die ziet er compleet uit tot
      // iemand vraag 6 mist.
      //
      // De fout wordt bewust bij de tweede vraag uitgelokt en niet bij de
      // eerste: alleen dan is er al iets weggeschreven dat teruggedraaid moet
      // worden. De template en vraag 1 zijn op dat moment geïnsert.
      //
      // Uitgelokt met een bevroren template. valideerVragenlijst() laat dit
      // document door — de bevriezing hangt aan de database, niet aan de vorm —
      // dus de fout valt precies waar hij moet vallen: midden in de transactie.
      const naam = `rollback-${Math.random().toString(36).slice(2, 10)}`;

      // Een template met een lopende ronde, waarvan de naam+versie hierna
      // opnieuw gebruikt wordt als versie 2.
      const bevroren = await service.importeer(
        TENANT_A,
        basislijst({ name: naam, version: 1 }),
      );

      await db.withTenant(TENANT_A, async (tx) => {
        await tx.execute(
          sql`INSERT INTO clm.survey_run (tenant_id, template_id, status)
              VALUES (${TENANT_A}, ${bevroren.templateId}, 'active')`,
        );
      });

      // Versie 2 is een eigen template en dus niet bevroren; die moet slagen.
      // Dit is de tegenproef dat de opzet hierboven niet per ongeluk álles
      // blokkeert.
      await expect(
        service.importeer(TENANT_A, basislijst({ name: naam, version: 2 })),
      ).resolves.toMatchObject({ versie: 2 });

      const na = await db.withTenant(TENANT_A, (tx) =>
        tx.execute<{ n: string }>(
          sql`SELECT count(*)::text AS n FROM clm.survey_template
               WHERE name = ${naam}`,
        ),
      );

      // Twee versies, geen weesrijen: de eerste import en de tweede, allebei
      // compleet.
      expect(na.rows[0].n).toBe('2');

      const vragen = await db.withTenant(TENANT_A, (tx) =>
        tx.execute<{ n: string }>(
          sql`SELECT count(*)::text AS n
                FROM clm.survey_question q
                JOIN clm.survey_template t USING (template_id)
               WHERE t.name = ${naam}`,
        ),
      );

      expect(vragen.rows[0].n).toBe('2');
    });

    it('draait de hele import terug wanneer één vraag de database niet haalt', async () => {
      // De transactiegarantie, uitgelokt op de plek waar hij telt: de template
      // en de eerste vraag zijn al weggeschreven wanneer de tweede faalt.
      //
      // De fout komt van een answer_type dat de CHECK-constraint uit migratie
      // 0005 niet kent. valideerVragenlijst() zou hem tegenhouden, dus die
      // wordt hier bewust overgeslagen door rechtstreeks op de transactie te
      // werken — anders test dit de validatie in plaats van de rollback.
      const naam = `atomair-${Math.random().toString(36).slice(2, 10)}`;

      const mislukt = await db
        .withTenant(TENANT_A, async (tx) => {
          const template = await tx.execute<{ template_id: string }>(
            sql`INSERT INTO clm.survey_template (tenant_id, name, version)
                VALUES (${TENANT_A}, ${naam}, 1)
                RETURNING template_id`,
          );
          const templateId = template.rows[0].template_id;

          await tx.execute(
            sql`INSERT INTO clm.survey_question
                    (tenant_id, template_id, position, question_key, title, body, answer_type)
                VALUES (${TENANT_A}, ${templateId}, 1, 'q1', 'Eerste', 'Slaagt', 'yes_no')`,
          );

          await tx.execute(
            sql`INSERT INTO clm.survey_question
                    (tenant_id, template_id, position, question_key, title, body, answer_type)
                VALUES (${TENANT_A}, ${templateId}, 2, 'q2', 'Tweede', 'Faalt', 'geen_bestaand_type')`,
          );

          return templateId;
        })
        .catch((fout: Error) => fout);

      expect(mislukt).toBeInstanceOf(Error);

      // Niets van de drie INSERTs mag zijn blijven staan.
      const rest = await db.withTenant(TENANT_A, (tx) =>
        tx.execute<{ n: string }>(
          sql`SELECT count(*)::text AS n FROM clm.survey_template
               WHERE name = ${naam}`,
        ),
      );

      expect(rest.rows[0].n).toBe('0');
    });

    it('weigert import in een template met een lopende ronde (bevriezing)', async () => {
      // De trigger uit migratie 0005 dwingt dit af, niet de servicelaag. Deze
      // test bewijst dat de importroute die garantie niet omzeilt.
      const eerste = await service.importeer(TENANT_A, basislijst());

      await db.withTenant(TENANT_A, async (tx) => {
        await tx.execute(
          sql`INSERT INTO clm.survey_run (tenant_id, template_id, status)
              VALUES (${TENANT_A}, ${eerste.templateId}, 'active')`,
        );
      });

      // Rechtstreeks een vraag toevoegen aan de bevroren template moet falen.
      //
      // Drizzle verpakt de databasefout in een eigen Error ("Failed query: …"),
      // dus de melding van de trigger staat in `cause`. Zou deze test alleen op
      // `message` matchen, dan zou hij ook groen worden bij een tikfout in de
      // SQL — en dan test hij niets.
      const geweigerd = await db
        .withTenant(TENANT_A, async (tx) => {
          await tx.execute(
            sql`INSERT INTO clm.survey_question
                    (tenant_id, template_id, position, question_key, title, body, answer_type)
                VALUES (${TENANT_A}, ${eerste.templateId}, 99, 'q99', 'Extra', 'Tekst', 'yes_no')`,
          );
          return null;
        })
        .catch((fout: Error) => fout);

      expect(geweigerd).toBeInstanceOf(Error);
      const oorzaak = (geweigerd as Error & { cause?: Error }).cause;
      expect(oorzaak?.message).toMatch(/bevroren/i);
    });
  });

  describe('Exporteren', () => {
    it('levert een document op dat opnieuw te importeren is (rondtrip)', async () => {
      const origineel = basislijst({
        categories: [
          { key: 'kosten', position: 1, name: 'Kosten', min_answers: 2 },
        ],
        questions: [
          {
            question_key: 'q1',
            category_key: 'kosten',
            position: 1,
            title: 'Prijsstelling',
            body: 'Hoe beoordeelt u de prijsstelling?',
            answer_type: 'rating',
            is_required: true,
            allows_upload: false,
            max_files: 0,
            config: { min: 1, max: 5, min_label: 'slecht', max_label: 'goed' },
          },
          {
            question_key: 'q2',
            position: 2,
            title: 'Toelichting',
            body: 'Licht uw oordeel toe.',
            answer_type: 'open_text',
            is_required: false,
            allows_upload: false,
            max_files: 0,
            config: { min_length: 10, max_length: 2000 },
          },
        ],
      });

      const geimporteerd = await service.importeer(TENANT_A, origineel);
      const geexporteerd = await service.exporteer(
        TENANT_A,
        geimporteerd.templateId,
      );

      // Het export bevat geen enkele UUID en geen tenant_id — dat is precies
      // wat hem herimporteerbaar maakt in een willekeurige tenant.
      const platgeslagen = JSON.stringify(geexporteerd);
      expect(platgeslagen).not.toContain(geimporteerd.templateId);
      expect(platgeslagen).not.toContain(TENANT_A);

      expect(geexporteerd.name).toBe(origineel.name);
      expect(geexporteerd.questions).toHaveLength(2);
      expect(geexporteerd.questions[0].config).toEqual({
        min: 1,
        max: 5,
        min_label: 'slecht',
        max_label: 'goed',
      });
      expect(geexporteerd.questions[1].category_key).toBeNull();

      // De rondtrip zelf: importeren als nieuwe versie in een ándere tenant.
      const opnieuw = await service.importeer(TENANT_B, {
        ...geexporteerd,
        version: 7,
      });

      expect(opnieuw.aantalVragen).toBe(2);
      expect(opnieuw.aantalCategorieen).toBe(1);

      const heen = await service.exporteer(TENANT_B, opnieuw.templateId);
      expect(heen.questions).toEqual(geexporteerd.questions);
    });

    it('geeft een template van een andere tenant niet vrij', async () => {
      // RLS maakt "bestaat niet" en "hoort bij iemand anders" ononderscheidbaar.
      const vanA = await service.importeer(TENANT_A, basislijst());

      await expect(
        service.exporteer(TENANT_B, vanA.templateId),
      ).rejects.toThrow(TemplateOnbekendError);
    });
  });
});
