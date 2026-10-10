import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';
import type {
  NieuwWerkingsgebied,
  WerkingsgebiedWijziging,
} from './werkingsgebied-invoer';

export interface Werkingsgebied {
  code: string;
  label: string;
}

/**
 * CRUD op de werkingsgebieden van de ingelogde tenant (#234).
 *
 * Zelfde opzet als VendorCategoryService. Verwijderen ontkoppelt de
 * contracten in dat gebied (ON DELETE CASCADE op de koppeltabel, migratie
 * 0046) — de contracten zelf blijven bestaan.
 */
@Injectable()
export class WerkingsgebiedService {
  constructor(private readonly db: DatabaseService) {}

  async lijst(tenantId: string): Promise<Werkingsgebied[]> {
    return this.db.withTenant(tenantId, async (tx) => {
      const rij = await tx.execute<{ code: string; label: string }>(
        sql`SELECT code, label FROM clm.werkingsgebied
            WHERE tenant_id = ${tenantId}
            ORDER BY label`,
      );

      return rij.rows;
    });
  }

  async maakAan(
    tenantId: string,
    invoer: NieuwWerkingsgebied,
  ): Promise<Werkingsgebied> {
    return this.db.withTenant(tenantId, async (tx) => {
      const rij = await tx.execute<{ code: string; label: string }>(
        sql`INSERT INTO clm.werkingsgebied (tenant_id, code, label)
            VALUES (${tenantId}, ${invoer.code}, ${invoer.label})
            RETURNING code, label`,
      );

      return rij.rows[0];
    });
  }

  async wijzig(
    tenantId: string,
    code: string,
    wijziging: WerkingsgebiedWijziging,
  ): Promise<Werkingsgebied | null> {
    return this.db.withTenant(tenantId, async (tx) => {
      const rij = await tx.execute<{ code: string; label: string }>(
        sql`UPDATE clm.werkingsgebied
            SET label = ${wijziging.label}
            WHERE tenant_id = ${tenantId} AND code = ${code}
            RETURNING code, label`,
      );

      return rij.rows[0] ?? null;
    });
  }

  async verwijder(tenantId: string, code: string): Promise<boolean> {
    return this.db.withTenant(tenantId, async (tx) => {
      const rij = await tx.execute(
        sql`DELETE FROM clm.werkingsgebied
            WHERE tenant_id = ${tenantId} AND code = ${code}`,
      );

      return (rij.rowCount ?? 0) > 0;
    });
  }
}
