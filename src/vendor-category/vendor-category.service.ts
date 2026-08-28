import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';
import type {
  NieuweVendorCategorie,
  VendorCategorieWijziging,
} from './vendor-category-invoer';

export interface VendorCategorie {
  code: string;
  label: string;
}

/**
 * CRUD op de vendor-categorieën van de ingelogde tenant.
 *
 * Zelfde opzet als ContractService: raw SQL binnen withTenant(), geen
 * soft delete (dit is een simpele lijst, geen auditwaardige entiteit —
 * verwijderen ontkoppelt bestaande vendors via ON DELETE SET NULL,
 * zie migratie 0034).
 */
@Injectable()
export class VendorCategoryService {
  constructor(private readonly db: DatabaseService) {}

  async lijst(tenantId: string): Promise<VendorCategorie[]> {
    return this.db.withTenant(tenantId, async (tx) => {
      const rij = await tx.execute<{ code: string; label: string }>(
        sql`SELECT code, label FROM ref.vendor_category
            WHERE tenant_id = ${tenantId}
            ORDER BY label`,
      );

      return rij.rows;
    });
  }

  async maakAan(
    tenantId: string,
    invoer: NieuweVendorCategorie,
  ): Promise<VendorCategorie> {
    return this.db.withTenant(tenantId, async (tx) => {
      const rij = await tx.execute<{ code: string; label: string }>(
        sql`INSERT INTO ref.vendor_category (tenant_id, code, label)
            VALUES (${tenantId}, ${invoer.code}, ${invoer.label})
            RETURNING code, label`,
      );

      return rij.rows[0];
    });
  }

  async wijzig(
    tenantId: string,
    code: string,
    wijziging: VendorCategorieWijziging,
  ): Promise<VendorCategorie | null> {
    return this.db.withTenant(tenantId, async (tx) => {
      const rij = await tx.execute<{ code: string; label: string }>(
        sql`UPDATE ref.vendor_category
            SET label = ${wijziging.label}
            WHERE tenant_id = ${tenantId} AND code = ${code}
            RETURNING code, label`,
      );

      return rij.rows[0] ?? null;
    });
  }

  /** Verwijdert de categorie; vendors die 'm gebruikten tonen daarna geen categorie meer (ON DELETE SET NULL). */
  async verwijder(tenantId: string, code: string): Promise<boolean> {
    return this.db.withTenant(tenantId, async (tx) => {
      const rij = await tx.execute(
        sql`DELETE FROM ref.vendor_category
            WHERE tenant_id = ${tenantId} AND code = ${code}`,
      );

      return (rij.rowCount ?? 0) > 0;
    });
  }
}
