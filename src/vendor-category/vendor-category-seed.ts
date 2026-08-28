import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

/**
 * De standaardset vendor-categorieën waarmee een nieuwe tenant start.
 * Eenmalige kopie bij tenantaanmaak (PlatformService.tenantAanmaken()) —
 * geen levende koppeling. Na de kopie is de lijst volledig van de tenant:
 * hernoemen, verwijderen en aanvullen via /vendor-categories raakt deze
 * standaardset niet.
 *
 * Dit zijn dezelfde 10 waarden die vóór migratie 0034 al als platform-brede
 * baseline-seed bestonden (migratie 0000) — die rijen zijn bij 0034
 * verwijderd (ze waren geen tenant-specifieke data), en leven hier verder
 * als de standaardset voor elke nieuwe tenant. Bestaande tenants
 * (AlingAdvies, Transdev) krijgen deze set achteraf via een eenmalige,
 * losse seed-actie — geen onderdeel van de migratie zelf. Zie
 * docs/superpowers/specs/2026-08-28-coupa-schema-uitbreiding-design.md.
 */
export const STANDAARD_VENDOR_CATEGORIEEN: ReadonlyArray<{
  code: string;
  label: string;
}> = [
  { code: 'it_services', label: 'IT-diensten' },
  { code: 'consultancy', label: 'Consultancy' },
  { code: 'maintenance', label: 'Onderhoud' },
  { code: 'consulting', label: 'Advies' },
  { code: 'energy', label: 'Energie' },
  { code: 'facilities', label: 'Facilitair' },
  { code: 'insurance', label: 'Verzekeringen' },
  { code: 'security', label: 'Beveiliging' },
  { code: 'telecom', label: 'Telecom' },
  { code: 'other', label: 'Overig' },
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
