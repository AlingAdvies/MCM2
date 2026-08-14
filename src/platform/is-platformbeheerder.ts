import { sql } from 'drizzle-orm';

import type { DatabaseService } from '../db/database.service';

/**
 * Stelt vast of een gebruiker platformbeheerder is (migratie 0020, ADR-015).
 *
 * Losse functie, geen Nest-provider: `PlatformAdminGuard` gebruikt hem als
 * poort, `AuthController` (in `AuthModule`) gebruikt hem om `/auth/sessie` een
 * `isPlatformbeheerder`-veld te geven. Twee providers uit verschillende
 * modules laten samenwerken zou een van beide modules naar de ander laten
 * importeren — precies de cirkel die `PlatformModule`'s afhankelijkheid van
 * `AuthModule` (voor `TenantContextGuard`) zou omkeren. Een functie zonder
 * module-binding kent dat probleem niet.
 *
 * Zelfde query als voorheen alleen in de guard stond — nu op één plek.
 */
export async function isPlatformbeheerder(
  db: DatabaseService,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  return db.withTenant(tenantId, async (tx) => {
    const { rows } = await tx.execute<{ bestaat: boolean }>(
      sql`SELECT true AS bestaat
            FROM clm.platform_admin
           WHERE user_id = ${userId}
             AND deleted_at IS NULL`,
    );

    return rows.length > 0;
  });
}
