import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { TenantTransaction } from '../db/database.service';
import type { GeldigAntwoord } from './antwoord-validatie';

/**
 * Schrijft gevalideerde antwoorden weg — gedeeld tussen indienen (§5) en
 * concept opslaan (§7), die verder niets met elkaar te maken hebben behalve
 * deze ene stap.
 *
 * `ON CONFLICT ... DO UPDATE` omdat er al een concept kan staan: de
 * leverancier vulde vraag 1 t/m 3 in, sloeg op, en dient later alles in. Een
 * gewone INSERT zou dan botsen op UNIQUE (response_id, question_id). Bij
 * concept opslaan werkt dezelfde `ON CONFLICT` in de andere richting: een
 * eerder opgeslagen antwoord op vraag 2 wordt overschreven als de leverancier
 * teruggaat en het aanpast.
 *
 * De RLS-policy op `survey_answer` (migratie 0005) staat schrijven alleen toe
 * zolang de response `pending` is — dat geldt voor beide aanroepers zonder dat
 * deze functie het zelf hoeft te controleren.
 */
export async function schrijfAntwoorden(
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
