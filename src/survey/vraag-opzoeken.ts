import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../db/database.service';
import type { VraagVoorValidatie } from './antwoord-validatie';
import type { AntwoordType } from './vragenlijst-schema';

/**
 * De vragen van een response opzoeken, gedeeld tussen indienen (§5) en
 * concept opslaan (§7) — beide moeten tegen exact dezelfde vragenset
 * valideren, van dezelfde run, in dezelfde volgorde.
 *
 * Losgetrokken uit `AntwoordIndienService` toen concept opslaan een tweede
 * aanroeper van deze query kreeg. Twee kopieën van "van response naar
 * template, nooit andersom" zouden vroeg of laat uiteen gaan lopen.
 */

export interface VraagRij extends Record<string, unknown> {
  question_id: string;
  question_key: string;
  answer_type: string;
  is_required: boolean;
  allows_upload: boolean;
  max_files: number;
  config: Record<string, unknown> | null;
}

/**
 * Van response naar template, nooit andersom. Hiermee is stap 4 uit ontwerp
 * §5 automatisch gedekt: het resultaat bevat uitsluitend de vragen van déze
 * run, dus een question_key van een andere template is per definitie
 * onbekend.
 */
export async function haalVragen(
  tx: TenantTransaction,
  responseId: string,
): Promise<VraagRij[]> {
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
export async function telBestanden(
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

export function naarValidatievraag(rij: VraagRij): VraagVoorValidatie {
  return {
    questionKey: rij.question_key,
    answerType: rij.answer_type as AntwoordType,
    isRequired: rij.is_required,
    allowsUpload: rij.allows_upload,
    maxFiles: rij.max_files,
    config: rij.config ?? {},
  };
}
