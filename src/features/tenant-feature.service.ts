import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';
import { FeatureKey } from './feature-registry';

/**
 * Leest en schrijft `clm.tenant_feature` (spec
 * docs/superpowers/specs/2026-09-03-tenant-feature-entitlements-design.md).
 *
 * `lijst()` draait binnen de tenantcontext van de opvrager zelf (gebruikt
 * door GET /auth/sessie — elke tenant leest alleen zijn eigen rijen, RLS
 * dwingt dat af). `zetten()` draait binnen de tenantcontext van de tenant
 * die de platformbeheerder wijzigt — dezelfde figuur als
 * `PlatformService.tenantWijzigen()`: de tenant in de invoer is "waar je
 * iets aan doet", niet "wie je bent".
 */
@Injectable()
export class TenantFeatureService {
  constructor(private readonly db: DatabaseService) {}

  async lijst(tenantId: string): Promise<FeatureKey[]> {
    return this.db.withTenant(tenantId, async (tx) => {
      const { rows } = await tx.execute<{ feature_key: string }>(
        sql`SELECT feature_key FROM clm.tenant_feature
             WHERE tenant_id = ${tenantId} AND enabled = true`,
      );

      return rows.map((r) => r.feature_key as FeatureKey);
    });
  }

  async zetten(
    tenantId: string,
    featureKey: FeatureKey,
    enabled: boolean,
    updatedByUserId: string,
  ): Promise<void> {
    await this.db.withTenant(tenantId, async (tx) => {
      await tx.execute(
        sql`INSERT INTO clm.tenant_feature
              (tenant_id, feature_key, enabled, updated_at, updated_by)
            VALUES (${tenantId}, ${featureKey}, ${enabled}, now(), ${updatedByUserId})
            ON CONFLICT (tenant_id, feature_key)
            DO UPDATE SET enabled = ${enabled}, updated_at = now(), updated_by = ${updatedByUserId}`,
      );

      await tx.execute(
        sql`INSERT INTO audit.audit_event
              (tenant_id, action_type, entity_type, entity_id, new_values)
            VALUES (${tenantId}, 'tenant_feature_gewijzigd', 'tenant_feature', ${tenantId},
                    ${JSON.stringify({ featureKey, enabled })}::jsonb)`,
      );
    });
  }
}
