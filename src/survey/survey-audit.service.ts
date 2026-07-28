import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../db/database.service';

/** Gebeurtenissen in de levenscyclus van een leverancierstoken (AC8). */
export type SurveyAuditActie =
  | 'survey_token_aangemaakt'
  | 'survey_token_eerste_gebruik'
  | 'survey_response_ingediend'
  | 'survey_token_ingetrokken';

/**
 * Legt gebeurtenissen rond survey-responses vast in `audit.audit_event`.
 *
 * Twee regels die deze service afdwingt:
 *
 * 1. **Het ruwe token komt hier nooit in.** Alleen de hash, en alleen waar die
 *    betekenis heeft. Een audit trail wordt breder gedeeld en langer bewaard
 *    dan de database zelf; een token daarin is een sleutel die blijft liggen.
 *
 * 2. **Schrijven gebeurt binnen de transactie van de aanroeper.** Daarmee is
 *    de auditregel onlosmakelijk aan de mutatie verbonden: rolt de mutatie
 *    terug, dan verdwijnt de auditregel mee. Een auditregel voor iets dat niet
 *    gebeurd is, is erger dan geen auditregel.
 *
 * De runtime-rol heeft bewust alleen INSERT en SELECT op `audit.audit_event`
 * (migratie 0001, MCM2-CLAUDE.md §7.7): append-only, niet te wijzigen of
 * verwijderen door de applicatie.
 */
@Injectable()
export class SurveyAuditService {
  async leg(
    tx: TenantTransaction,
    gegevens: {
      tenantId: string;
      actie: SurveyAuditActie;
      responseId: string;
      /** Aanvullende context. Nooit het ruwe token — zie klasse-toelichting. */
      details?: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.execute(
      sql`INSERT INTO audit.audit_event
            (tenant_id, action_type, entity_type, entity_id, new_values)
          VALUES (${gegevens.tenantId}, ${gegevens.actie}, 'survey_response',
                  ${gegevens.responseId},
                  ${JSON.stringify(gegevens.details ?? {})}::jsonb)`,
    );
  }
}
