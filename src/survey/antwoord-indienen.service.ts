import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';
import type { TenantTransaction } from '../db/database.service';
import { SurveyAuditService } from './survey-audit.service';
import { valideerAntwoorden } from './antwoord-validatie';
import type {
  AntwoordFout,
  GeldigAntwoord,
  VraagVoorValidatie,
} from './antwoord-validatie';
import type { AntwoordType } from './vragenlijst-schema';

/** Waarom een indiening niet is doorgegaan. Bepaalt de HTTP-status. */
export type IndienUitkomst =
  | { status: 'ingediend' }
  | { status: 'ongeldig'; fouten: AntwoordFout[] }
  | { status: 'niet-meer-open' };

interface VraagRij extends Record<string, unknown> {
  question_id: string;
  question_key: string;
  answer_type: string;
  is_required: boolean;
  allows_upload: boolean;
  max_files: number;
  config: Record<string, unknown> | null;
}

/**
 * Neemt een volledige indiening aan: valideren, wegschrijven, afsluiten.
 *
 * De volgorde uit ontwerp §5 is niet vrijblijvend. **Eerst alles valideren, dan
 * pas de status op `submitted` zetten.** Faalt de validatie halverwege, dan mag
 * de response niet half ingediend achterblijven — de link is dan verbruikt
 * terwijl er niets bruikbaars staat, en dat is onherstelbaar omdat het token
 * gehasht is en niet opnieuw te versturen.
 *
 * Alles gebeurt in één transactie: antwoorden, statuswijziging en auditregel.
 * Faalt er iets, dan blijft de link gewoon werken.
 */
@Injectable()
export class AntwoordIndienService {
  private readonly logger = new Logger(AntwoordIndienService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: SurveyAuditService,
  ) {}

  async dienIn(
    tenantId: string,
    responseId: string,
    invoer: unknown,
  ): Promise<IndienUitkomst> {
    return this.db
      .withTenant<IndienUitkomst>(tenantId, async (tx) => {
        const vragen = await this.haalVragen(tx, responseId);

        // Geen vragen betekent: er valt niets in te dienen. Behandeld als
        // "niet meer open" in plaats van als lege geldige indiening — anders
        // zou een lege template een response kunnen afsluiten zonder inhoud.
        if (vragen.length === 0) {
          return { status: 'niet-meer-open' };
        }

        const bestanden = await this.telBestanden(tx, responseId);

        const uitkomst = valideerAntwoorden(
          vragen.map(naarValidatievraag),
          invoer,
          bestanden,
        );

        if (!uitkomst.geldig) {
          // Bewust vóór elke schrijfactie. De transactie heeft nog niets
          // gewijzigd, dus er valt niets terug te draaien en de link blijft
          // bruikbaar (testpunt 25).
          return { status: 'ongeldig', fouten: uitkomst.fouten };
        }

        const idPerSleutel = new Map(
          vragen.map((v) => [v.question_key, v.question_id]),
        );

        await this.schrijfAntwoorden(
          tx,
          tenantId,
          responseId,
          uitkomst.antwoorden,
          idPerSleutel,
        );

        // Pas hierna afsluiten. Eén atomair statement met de status als
        // voorwaarde, net als in SurveyTokenService.dienIn(): de database
        // beslist wie wint bij gelijktijdige verzoeken, niet de volgorde waarin
        // ze toevallig aankomen.
        const afgesloten = await tx.execute<{ response_id: string }>(
          sql`UPDATE clm.survey_response AS r
               SET status = 'submitted', submitted_at = now()
             WHERE r.response_id = ${responseId}
               AND r.status = 'pending'
               AND r.expires_at > now()
               AND EXISTS (
                     SELECT 1 FROM clm.survey_run run
                      WHERE run.run_id = r.run_id
                        AND run.status = 'active'
                   )
         RETURNING r.response_id`,
        );

        if (afgesloten.rows.length !== 1) {
          // Iemand was eerder, of de ronde is inmiddels dicht. De transactie
          // rolt terug door de fout hieronder niet te gooien maar de uitkomst
          // te melden — Drizzle commit anders de zojuist geschreven antwoorden.
          throw new NietMeerOpenError();
        }

        await this.audit.leg(tx, {
          tenantId,
          actie: 'survey_response_ingediend',
          responseId,
          details: { aantalAntwoorden: uitkomst.antwoorden.length },
        });

        this.logger.log(
          `Response ${responseId} ingediend met ${uitkomst.antwoorden.length} antwoorden.`,
        );

        return { status: 'ingediend' };
      })
      .catch((fout: unknown) => {
        // NietMeerOpenError is geen storing maar het verwachte gedrag bij een
        // tweede poging. Door hem als fout te gooien rolt de transactie terug;
        // hier wordt hij weer een gewone uitkomst.
        if (fout instanceof NietMeerOpenError) {
          this.logger.warn(
            `Indienen geweigerd voor response ${responseId}: al ingediend, verlopen of ronde gesloten.`,
          );
          return { status: 'niet-meer-open' };
        }
        throw fout;
      });
  }

  private async haalVragen(
    tx: TenantTransaction,
    responseId: string,
  ): Promise<VraagRij[]> {
    // Van response naar template, nooit andersom — dezelfde regel als in
    // VragenlijstLeesService. Hiermee is stap 4 uit ontwerp §5 automatisch
    // gedekt: `vragen` bevat uitsluitend de vragen van déze run, dus een
    // question_key van een andere template is per definitie onbekend.
    const resultaat = await tx.execute<VraagRij>(
      sql`SELECT q.question_id, q.question_key, q.answer_type, q.is_required,
                 q.allows_upload, q.max_files, q.config
            FROM clm.survey_response r
            JOIN clm.survey_run      run ON run.run_id    = r.run_id
            JOIN clm.survey_question q   ON q.template_id = run.template_id
           WHERE r.response_id = ${responseId}
           ORDER BY q.position`,
    );

    return resultaat.rows;
  }

  /** Aantal reeds geüploade bijlagen per question_key. */
  private async telBestanden(
    tx: TenantTransaction,
    responseId: string,
  ): Promise<Map<string, number>> {
    const resultaat = await tx.execute<{
      question_key: string;
      aantal: string;
    }>(
      sql`SELECT q.question_key, count(*)::text AS aantal
            FROM clm.survey_attachment a
            JOIN clm.survey_question q ON q.question_id = a.question_id
           WHERE a.response_id = ${responseId}
           GROUP BY q.question_key`,
    );

    return new Map(
      resultaat.rows.map((rij) => [rij.question_key, Number(rij.aantal)]),
    );
  }

  /**
   * Schrijft de antwoorden weg.
   *
   * `ON CONFLICT ... DO UPDATE` omdat er al een concept kan staan (§7): de
   * leverancier vulde vraag 1 t/m 3 in, sloeg op, en dient later alles in. Een
   * gewone INSERT zou dan botsen op UNIQUE (response_id, question_id).
   */
  private async schrijfAntwoorden(
    tx: TenantTransaction,
    tenantId: string,
    responseId: string,
    antwoorden: GeldigAntwoord[],
    idPerSleutel: Map<string, string>,
  ): Promise<void> {
    for (const antwoord of antwoorden) {
      const questionId = idPerSleutel.get(antwoord.questionKey);

      if (!questionId) {
        // De validatie heeft al vastgesteld dat elke sleutel bekend is; komt
        // hij hier alsnog niet uit de map, dan is er iets grondiger mis.
        throw new Error(
          `Vraag '${antwoord.questionKey}' is gevalideerd maar heeft geen question_id — dit is een programmeerfout.`,
        );
      }

      await tx.execute(
        sql`INSERT INTO clm.survey_answer
                (tenant_id, response_id, question_id, answer_type,
                 answer_code, answer_codes, answer_text, answer_number, comment)
            VALUES (${tenantId}, ${responseId}, ${questionId},
                    ${antwoord.answerType},
                    ${antwoord.answerCode},
                    ${codesAlsArray(antwoord.answerCodes)},
                    ${antwoord.answerText},
                    ${antwoord.answerNumber},
                    ${antwoord.comment})
            ON CONFLICT (response_id, question_id) DO UPDATE
               SET answer_code   = EXCLUDED.answer_code,
                   answer_codes  = EXCLUDED.answer_codes,
                   answer_text   = EXCLUDED.answer_text,
                   answer_number = EXCLUDED.answer_number,
                   comment       = EXCLUDED.comment,
                   updated_at    = now()`,
      );
    }
  }
}

/**
 * Intern signaal dat de response niet meer openstond.
 *
 * Als fout gegooid en niet als returnwaarde, omdat alleen een fout de
 * transactie terugdraait. Zonder dat zouden de zojuist geschreven antwoorden
 * blijven staan bij een response die iemand anders al had ingediend.
 */
class NietMeerOpenError extends Error {
  constructor() {
    super('De response stond niet meer open.');
    this.name = 'NietMeerOpenError';
  }
}

/**
 * Zet een lijst codes om naar iets dat Postgres als `text[]` accepteert.
 *
 * Drizzle geeft een JS-array door als `record` — de INSERT faalt dan met
 * "column answer_codes is of type text[] but expression is of type record".
 * De omweg via een JSON-array met `jsonb_array_elements_text` is bewust: een
 * array-literal opbouwen zou quoting vereisen van komma's, aanhalingstekens en
 * accolades die in een optiecode kunnen voorkomen, en dat is precies het soort
 * handwerk waar een injectiefout in sluipt.
 */
function codesAlsArray(codes: string[] | null): SQL {
  if (codes === null) {
    return sql`NULL::text[]`;
  }

  return sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(codes)}::jsonb))`;
}

function naarValidatievraag(rij: VraagRij): VraagVoorValidatie {
  return {
    questionKey: rij.question_key,
    answerType: rij.answer_type as AntwoordType,
    isRequired: rij.is_required,
    allowsUpload: rij.allows_upload,
    maxFiles: rij.max_files,
    config: rij.config ?? {},
  };
}
