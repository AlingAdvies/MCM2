import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../db/database.service';

/** Gebeurtenissen rond een contract-import (#198). */
export type ContractImportAuditActie = 'contract_import_bevestigd';

/**
 * Legt gebeurtenissen rond een contract-import vast in `audit.audit_event`.
 * Naar het patroon van `survey-audit.service.ts`: schrijft binnen de
 * transactie van de aanroeper, zodat een rollback de auditregel meeneemt —
 * een auditregel voor een import die niet gebeurd is, is erger dan geen
 * auditregel.
 */
@Injectable()
export class ContractImportAuditService {
  async leg(
    tx: TenantTransaction,
    gegevens: {
      tenantId: string;
      actie: ContractImportAuditActie;
      jobId: string;
      details: {
        aangemaakteContracten: number;
        aangemaakteVendors: number;
        hergebruikteVendors: number;
        aangemaakteContacten: number;
        hergebruikteContacten: number;
        overgeslagen: number;
      };
    },
  ): Promise<void> {
    await tx.execute(
      sql`INSERT INTO audit.audit_event
            (tenant_id, action_type, entity_type, entity_id, new_values)
          VALUES (${gegevens.tenantId}, ${gegevens.actie}, 'import_job',
                  ${gegevens.jobId},
                  ${JSON.stringify(gegevens.details)}::jsonb)`,
    );
  }
}
