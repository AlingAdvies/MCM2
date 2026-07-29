import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';
import type { TenantTransaction } from '../db/database.service';
import {
  SCHEMA_VERSIE,
  VragenlijstOngeldigError,
  valideerVragenlijst,
} from './vragenlijst-schema';
import type {
  AntwoordType,
  CategorieInvoer,
  VraagInvoer,
  VragenlijstInvoer,
} from './vragenlijst-schema';

/** Wat een geslaagde import heeft opgeleverd. */
export interface ImportResultaat {
  templateId: string;
  naam: string;
  versie: number;
  aantalCategorieen: number;
  aantalVragen: number;
}

/** Gegooid wanneer de tenant deze naam+versie al heeft. */
export class TemplateBestaatAlError extends Error {
  constructor(naam: string, versie: number) {
    super(
      `Vragenlijst '${naam}' versie ${versie} bestaat al in deze tenant. Importeer als een nieuwe versie.`,
    );
    this.name = 'TemplateBestaatAlError';
  }
}

export class TemplateOnbekendError extends Error {
  constructor(templateId: string) {
    super(`Vragenlijst ${templateId} bestaat niet in deze tenant.`);
    this.name = 'TemplateOnbekendError';
  }
}

interface CategorieRij extends Record<string, unknown> {
  category_id: string;
  position: number;
  name: string;
  min_answers: number;
}

interface VraagRij extends Record<string, unknown> {
  question_key: string;
  category_id: string | null;
  position: number;
  title: string;
  body: string;
  answer_type: string;
  is_required: boolean;
  allows_upload: boolean;
  max_files: number;
  config: Record<string, unknown>;
}

/**
 * Importeert en exporteert de structuur van een vragenlijst (ontwerp §2d).
 *
 * Dit gaat over de vragen, niet over de antwoorden. Export van ingediende
 * antwoorden is een ander spoor (OV-4) en staat hier bewust los van: het ene
 * beschrijft een formulier, het andere bevat bedrijfsgevoelige verklaringen van
 * leveranciers.
 *
 * Import is de plek waar client-invoer het datamodel binnenkomt. Twee regels
 * zijn daarom hard en staan niet ter discussie:
 *
 *  1. `tenant_id` komt uit de sessiecontext, nooit uit het bestand (Issue #7).
 *  2. UUIDs uit het bestand worden genegeerd; alles wordt nieuw gegenereerd.
 *
 * De eerste is de zwaarste in beveiligingstermen — een importbestand is
 * client-invoer, en de tenant daaruit overnemen is exact het patroon waar
 * MCM2-CLAUDE.md §6 over gaat.
 */
@Injectable()
export class VragenlijstImportService {
  private readonly logger = new Logger(VragenlijstImportService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Leest een JSON-document in als nieuwe template binnen de opgegeven tenant.
   *
   * De tenantId hoort uit geverifieerde identiteit te komen — een ID-token of
   * een tokenlookup. Dat deze methode hem als parameter krijgt in plaats van
   * uit de invoer te lezen, is de hele reden dat dit veilig is.
   *
   * Alles gebeurt in één transactie: een halve vragenlijst is erger dan geen
   * vragenlijst, want die ziet er compleet uit tot iemand vraag 6 mist.
   *
   * @throws VragenlijstOngeldigError bij een afgekeurd bestand
   * @throws TemplateBestaatAlError wanneer naam+versie al bezet is
   */
  async importeer(
    tenantId: string,
    document: unknown,
  ): Promise<ImportResultaat> {
    const lijst = valideerVragenlijst(document);

    return this.db.withTenant(tenantId, async (tx) => {
      const templateId = await this.maakTemplate(tx, tenantId, lijst);

      // De koppeling vraag → categorie loopt via category_key uit het bestand.
      // Deze map vertaalt die sleutel naar de UUID die we zojuist zelf hebben
      // gegenereerd; een UUID uit het bestand komt er niet aan te pas.
      const categorieIds = await this.maakCategorieen(
        tx,
        tenantId,
        templateId,
        lijst.categories ?? [],
      );

      await this.maakVragen(
        tx,
        tenantId,
        templateId,
        lijst.questions,
        categorieIds,
      );

      this.logger.log(
        `Vragenlijst '${lijst.name}' v${lijst.version} geïmporteerd: ` +
          `${lijst.questions.length} vragen, ${categorieIds.size} categorieën.`,
      );

      return {
        templateId,
        naam: lijst.name,
        versie: lijst.version,
        aantalCategorieen: categorieIds.size,
        aantalVragen: lijst.questions.length,
      };
    });
  }

  private async maakTemplate(
    tx: TenantTransaction,
    tenantId: string,
    lijst: VragenlijstInvoer,
  ): Promise<string> {
    const bestaand = await tx.execute<{ template_id: string }>(
      sql`SELECT template_id FROM clm.survey_template
           WHERE name = ${lijst.name} AND version = ${lijst.version}`,
    );

    // Afvangen vóór de INSERT levert een uitlegbare fout op in plaats van een
    // schending van survey_template_tenant_name_version_key.
    if (bestaand.rows.length > 0) {
      throw new TemplateBestaatAlError(lijst.name, lijst.version);
    }

    const rij = await tx.execute<{ template_id: string }>(
      sql`INSERT INTO clm.survey_template (tenant_id, name, version)
          VALUES (${tenantId}, ${lijst.name}, ${lijst.version})
          RETURNING template_id`,
    );

    const templateId = rij.rows[0]?.template_id;

    if (!templateId) {
      throw new Error(
        'Aanmaken van de vragenlijst leverde geen template_id op.',
      );
    }

    return templateId;
  }

  private async maakCategorieen(
    tx: TenantTransaction,
    tenantId: string,
    templateId: string,
    categorieen: CategorieInvoer[],
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();

    for (const categorie of categorieen) {
      const rij = await tx.execute<{ category_id: string }>(
        sql`INSERT INTO clm.survey_category
                (tenant_id, template_id, position, name, min_answers)
            VALUES (${tenantId}, ${templateId}, ${categorie.position},
                    ${categorie.name}, ${categorie.min_answers ?? 0})
            RETURNING category_id`,
      );

      const id = rij.rows[0]?.category_id;

      if (!id) {
        throw new Error(
          `Aanmaken van categorie '${categorie.key}' leverde geen category_id op.`,
        );
      }

      ids.set(categorie.key, id);
    }

    return ids;
  }

  private async maakVragen(
    tx: TenantTransaction,
    tenantId: string,
    templateId: string,
    vragen: VraagInvoer[],
    categorieIds: Map<string, string>,
  ): Promise<void> {
    for (const vraag of vragen) {
      const sleutel = vraag.category_key;
      const categorieId =
        sleutel === undefined || sleutel === null || sleutel === ''
          ? null
          : (categorieIds.get(sleutel) ?? null);

      // valideerVragenlijst() heeft al vastgesteld dat elke category_key in het
      // bestand voorkomt; komt hij hier alsnog niet uit de map, dan is er iets
      // grondiger mis dan een invoerfout.
      if (sleutel && !categorieId) {
        throw new Error(
          `Categorie '${sleutel}' is gevalideerd maar niet aangemaakt — dit is een programmeerfout.`,
        );
      }

      const magUploaden = vraag.allows_upload ?? false;

      await tx.execute(
        sql`INSERT INTO clm.survey_question
                (tenant_id, template_id, category_id, position, question_key,
                 title, body, answer_type, config, is_required,
                 allows_upload, max_files)
            VALUES (${tenantId}, ${templateId}, ${categorieId}, ${vraag.position},
                    ${vraag.question_key}, ${vraag.title}, ${vraag.body},
                    ${vraag.answer_type},
                    ${JSON.stringify(vraag.config ?? {})}::jsonb,
                    ${vraag.is_required ?? true}, ${magUploaden},
                    ${vraag.max_files ?? 0})`,
      );
    }
  }

  /**
   * Levert de structuur van een template op als JSON-document.
   *
   * Het resultaat is exact wat importeer() weer inleest — dat is niet alleen
   * netjes, het is de functie: klonen en een nieuwe versie afsplitsen zijn
   * dezelfde operatie als exporteren-en-importeren (ontwerp §2d).
   *
   * Bevat bewust geen enkele UUID en geen tenant_id. Een export die je aan een
   * andere tenant geeft, mag daar niets over de herkomst prijsgeven.
   *
   * @throws TemplateOnbekendError wanneer de template niet in deze tenant staat
   */
  async exporteer(
    tenantId: string,
    templateId: string,
  ): Promise<VragenlijstInvoer> {
    return this.db.withTenant(tenantId, async (tx) => {
      const template = await tx.execute<{ name: string; version: number }>(
        sql`SELECT name, version FROM clm.survey_template
             WHERE template_id = ${templateId}`,
      );

      const kop = template.rows[0];

      // Geen rij betekent hier "bestaat niet of hoort bij een andere tenant" —
      // RLS maakt dat onderscheid onzichtbaar, en dat is precies de bedoeling.
      if (!kop) {
        throw new TemplateOnbekendError(templateId);
      }

      const categorieen = await tx.execute<CategorieRij>(
        sql`SELECT category_id, position, name, min_answers
              FROM clm.survey_category
             WHERE template_id = ${templateId}
             ORDER BY position`,
      );

      // De sleutel in het exportbestand wordt afgeleid van de naam, niet van de
      // UUID: een export moet leesbaar en herimporteerbaar zijn zonder iets
      // over de interne identiteiten te verklappen.
      const sleutels = new Map<string, string>();
      const gebruikt = new Set<string>();

      for (const categorie of categorieen.rows) {
        let sleutel = maakSleutel(categorie.name);
        let volgnummer = 2;
        while (gebruikt.has(sleutel)) {
          sleutel = `${maakSleutel(categorie.name)}-${volgnummer++}`;
        }
        gebruikt.add(sleutel);
        sleutels.set(categorie.category_id, sleutel);
      }

      const vragen = await tx.execute<VraagRij>(
        sql`SELECT question_key, category_id, position, title, body,
                   answer_type, is_required, allows_upload, max_files, config
              FROM clm.survey_question
             WHERE template_id = ${templateId}
             ORDER BY position`,
      );

      return {
        schema_version: SCHEMA_VERSIE,
        name: kop.name,
        version: kop.version,
        categories: categorieen.rows.map((categorie) => ({
          key: sleutels.get(categorie.category_id) as string,
          position: categorie.position,
          name: categorie.name,
          min_answers: categorie.min_answers,
        })),
        questions: vragen.rows.map((vraag) => ({
          question_key: vraag.question_key,
          category_key: vraag.category_id
            ? (sleutels.get(vraag.category_id) ?? null)
            : null,
          position: vraag.position,
          title: vraag.title,
          body: vraag.body,
          answer_type: vraag.answer_type as AntwoordType,
          is_required: vraag.is_required,
          allows_upload: vraag.allows_upload,
          max_files: vraag.max_files,
          config: vraag.config ?? {},
        })),
      };
    });
  }
}

/** Maakt van 'Duidelijkheid & Kosten' → 'duidelijkheid-kosten'. */
function maakSleutel(naam: string): string {
  const sleutel = naam
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  // Een naam die volledig uit leestekens bestaat levert een lege sleutel op;
  // die zou bij herimport als "geen categorie" gelezen worden.
  return sleutel.length > 0 ? sleutel : 'categorie';
}

export { VragenlijstOngeldigError };
