import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

/**
 * De standaardset vendor-categorieën waarmee een nieuwe tenant start.
 * Eenmalige kopie bij tenantaanmaak (PlatformService.tenantAanmaken()) —
 * geen levende koppeling. Na de kopie is de lijst volledig van de tenant:
 * hernoemen, verwijderen en aanvullen via /vendor-categories raakt deze
 * standaardset niet.
 *
 * Overgenomen uit AlingAdvies' bestaande lijst (migratie 0034 claimt die
 * rijen voor AlingAdvies' eigen tenant_id). Zie
 * docs/superpowers/specs/2026-08-28-coupa-schema-uitbreiding-design.md.
 */
export const STANDAARD_VENDOR_CATEGORIEEN: ReadonlyArray<{
  code: string;
  label: string;
}> = [
  { code: 'ict', label: 'ICT' },
  { code: 'hr', label: 'HR' },
  { code: 'facilitair', label: 'Facilitair' },
  { code: 'financieel', label: 'Financieel' },
  { code: 'juridisch', label: 'Juridisch' },
  { code: 'overig', label: 'Overig' },
];

/**
 * Bouwt de INSERT-statement die de standaardset voor `tenantId` seedt.
 * Wordt binnen dezelfde withTenant()-transactie als de rest van
 * tenantAanmaken() uitgevoerd — vandaar dat dit een SQL-fragment teruggeeft
 * in plaats van zelf te queryen.
 */
export function seedVendorCategorieenSql(tenantId: string): SQL {
  const rijen = STANDAARD_VENDOR_CATEGORIEEN.map(
    (c) => sql`(${tenantId}, ${c.code}, ${c.label})`,
  );

  return sql`INSERT INTO ref.vendor_category (tenant_id, code, label)
      VALUES ${sql.join(rijen, sql`, `)}`;
}
