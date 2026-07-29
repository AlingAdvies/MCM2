import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';

import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/db/database.service';
import { VragenlijstImportService } from '../src/survey/vragenlijst-import.service';
import { valideerVragenlijst } from '../src/survey/vragenlijst-schema';

const TENANT = '00000000-0000-0000-0000-0000000000d3';
const SEEDMAP = join(__dirname, '..', 'db', 'seeds');

const seedbestanden = readdirSync(SEEDMAP).filter((naam) =>
  naam.endsWith('.json'),
);

function lees(naam: string): unknown {
  return JSON.parse(readFileSync(join(SEEDMAP, naam), 'utf8'));
}

/**
 * Uniek versienummer per aanroep.
 *
 * Templates zijn uniek op (tenant, naam, versie), en de testdatabase blijft
 * tussen runs staan. Een vast nummer zou de suite bij de tweede run laten
 * omvallen op een botsing die niets met de seed te maken heeft.
 */
let volgnummer = 0;
const testversie = () => 900 + (Date.now() % 100000) + volgnummer++;

/**
 * Bewaakt de seedbestanden zelf.
 *
 * Zonder deze tests is een tikfout in een JSON-bestand pas zichtbaar wanneer
 * iemand de seed draait — in het gunstigste geval een collega, in het ongunstige
 * de klant. De bestanden zijn de eerste vulling van de tool (ontwerp §0) en
 * daarmee productinhoud, geen testdata.
 */
describe('Vragenlijst-seeds (e2e)', () => {
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

    await db.withTenant(TENANT, async (tx) => {
      await tx.execute(
        sql`INSERT INTO clm.tenant (tenant_id, name)
            VALUES (${TENANT}, 'seed-test')
            ON CONFLICT (tenant_id) DO NOTHING`,
      );
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('vindt de twee seedbestanden', () => {
    // Faalt zodra iemand een bestand hernoemt of weghaalt zonder deze test bij
    // te werken — dan klopt de rest van deze suite namelijk ook niet meer.
    expect(seedbestanden.sort()).toEqual([
      'transdev-annual-vendor-it-risk-v1.json',
      'transdev-leveranciersbeoordeling-v1.json',
    ]);
  });

  it.each(seedbestanden)('%s doorstaat de validatie', (naam) => {
    expect(() => valideerVragenlijst(lees(naam))).not.toThrow();
  });

  it.each(seedbestanden)('%s is daadwerkelijk te importeren', async (naam) => {
    // Validatie is vorm; dit toetst dat de database hem ook accepteert —
    // CHECK-constraints, samengestelde FKs en de trigger uit migratie 0005.
    const document = lees(naam) as Record<string, unknown>;

    const resultaat = await service.importeer(TENANT, {
      ...document,
      version: testversie(),
    });

    expect(resultaat.aantalVragen).toBeGreaterThan(0);
  });

  describe('UC1 — de acht Transdev-vragen', () => {
    const uc1 = lees('transdev-annual-vendor-it-risk-v1.json') as {
      questions: {
        question_key: string;
        answer_type: string;
        is_required: boolean;
        allows_upload: boolean;
        max_files: number;
        category_key?: string | null;
      }[];
      categories: unknown[];
    };

    it('bevat acht confirmation-vragen plus één leesblok', () => {
      // De acht vragen uit de klantaanlevering, met het introductieblok ervoor.
      const typen = uc1.questions.map((v) => v.answer_type);

      expect(typen.filter((t) => t === 'confirmation')).toHaveLength(8);
      expect(typen.filter((t) => t === 'instruction')).toHaveLength(1);
      expect(uc1.questions).toHaveLength(9);
    });

    it('heeft geen categorieën — het is een platte lijst', () => {
      // UC1 heeft er geen; een verplichte categorie zou hier een kunstmatige
      // "Algemeen" afdwingen (ontwerp §2).
      expect(uc1.categories).toHaveLength(0);
      expect(
        uc1.questions.every(
          (v) => v.category_key === undefined || v.category_key === null,
        ),
      ).toBe(true);
    });

    it('laat alleen bij vraag 1 een upload toe, met maximaal twee bestanden', () => {
      // OV-7: maximaal 2 bestanden. De vierde antwoordoptie ("I cannot upload…")
      // hoort bij elke vraag die een upload vraagt — hier dus alleen q1.
      const metUpload = uc1.questions.filter((v) => v.allows_upload);

      expect(metUpload).toHaveLength(1);
      expect(metUpload[0].question_key).toBe('q1');
      expect(metUpload[0].max_files).toBe(2);
    });

    it('markeert het leesblok als niet-verplicht', () => {
      // Testpunt 32: een verplicht instruction-blok maakt de vragenlijst
      // onindienbaar.
      const leesblok = uc1.questions.find(
        (v) => v.answer_type === 'instruction',
      );

      expect(leesblok?.is_required).toBe(false);
    });
  });

  describe('UC2 — de interne beoordeling', () => {
    const uc2 = lees('transdev-leveranciersbeoordeling-v1.json') as {
      categories: { key: string; name: string; min_answers: number }[];
      questions: {
        question_key: string;
        answer_type: string;
        category_key: string | null;
        config: Record<string, unknown>;
      }[];
    };

    it('bevat de zes categorieën uit MVM_V2', () => {
      // MVM_V2 is functioneel leidend voor de vragenlijst (besluit 2026-07-29).
      // Let op: het ontwerp noemt vijf categorieën met 29 vragen; de bron heeft
      // er zes met 28 — "Risico's" ontbreekt in het ontwerpdocument.
      expect(uc2.categories.map((c) => c.name)).toEqual([
        'Duidelijkheid',
        'Behoefte',
        'Kwaliteit',
        'Kosten',
        "Risico's",
        'Besturing',
      ]);
    });

    it('zet min_answers op 3, conform MVM_V2', () => {
      // Onder die drempel is de categoriescore null in plaats van een
      // gemiddelde over te weinig punten (ontwerp §2).
      expect(uc2.categories.every((c) => c.min_answers === 3)).toBe(true);
    });

    it('bevat 28 rating-vragen op een schaal van 1 tot 5', () => {
      const ratings = uc2.questions.filter((v) => v.answer_type === 'rating');

      expect(ratings).toHaveLength(28);
      expect(
        ratings.every((v) => v.config.min === 1 && v.config.max === 5),
      ).toBe(true);
    });

    it('sluit af met één open toelichting zonder categorie', () => {
      // MVM_V2's hasRemarks. Zonder categorie, want hij hoort bij het geheel.
      const open = uc2.questions.filter((v) => v.answer_type === 'open_text');

      expect(open).toHaveLength(1);
      expect(open[0].category_key).toBeNull();
    });

    it('koppelt elke rating-vraag aan een bestaande categorie', () => {
      const sleutels = new Set(uc2.categories.map((c) => c.key));

      const losse = uc2.questions.filter(
        (v) =>
          v.answer_type === 'rating' && !sleutels.has(v.category_key ?? ''),
      );

      expect(losse).toHaveLength(0);
    });
  });

  it('legt de categoriekoppeling correct bij een geïmporteerde UC2-lijst', async () => {
    // De rondtrip die ertoe doet: van bestand naar database naar de verdeling
    // die de scoreberekening straks gebruikt.
    const document = lees('transdev-leveranciersbeoordeling-v1.json') as Record<
      string,
      unknown
    >;

    const resultaat = await service.importeer(TENANT, {
      ...document,
      version: testversie(),
    });

    const verdeling = await db.withTenant(TENANT, (tx) =>
      tx.execute<{ naam: string; aantal: string }>(
        sql`SELECT c.name AS naam, count(q.question_id)::text AS aantal
              FROM clm.survey_category c
              LEFT JOIN clm.survey_question q ON q.category_id = c.category_id
             WHERE c.template_id = ${resultaat.templateId}
             GROUP BY c.name, c.position
             ORDER BY c.position`,
      ),
    );

    expect(verdeling.rows).toEqual([
      { naam: 'Duidelijkheid', aantal: '4' },
      { naam: 'Behoefte', aantal: '4' },
      { naam: 'Kwaliteit', aantal: '5' },
      { naam: 'Kosten', aantal: '5' },
      { naam: "Risico's", aantal: '5' },
      { naam: 'Besturing', aantal: '5' },
    ]);
  });
});
