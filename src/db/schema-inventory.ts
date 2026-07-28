import { getTableConfig } from 'drizzle-orm/pg-core';

import * as schema from './schema';

export interface TabelInventaris {
  /** Volledige naam, bijv. 'clm.vendor'. */
  volledigeNaam: string;
  schema: string;
  naam: string;
  /** Heeft deze tabel een tenant_id-kolom? Bepaalt of RLS verplicht is. */
  tenantgebonden: boolean;
}

/**
 * Leidt af welke tabellen er horen te bestaan, rechtstreeks uit het
 * Drizzle-schema. Bewust geen hardgecodeerde lijst: die veroudert zodra er een
 * tabel bijkomt, en een verificatie die alleen controleert wat hij toevallig
 * kent stelt gerust zonder iets te bewijzen.
 *
 * 'tenantgebonden' wordt afgeleid uit de aanwezigheid van een tenant_id-kolom.
 * Dat is dezelfde regel die MCM2-CLAUDE.md §7 hanteert: iedere tabel met
 * tenant_id heeft RLS en policies met zowel USING als WITH CHECK nodig.
 */
export function inventariseerSchema(): TabelInventaris[] {
  const tabellen: TabelInventaris[] = [];

  for (const exportwaarde of Object.values(schema)) {
    let config: ReturnType<typeof getTableConfig>;

    try {
      config = getTableConfig(exportwaarde as never);
    } catch {
      // Geen tabel (relatie-definitie, helper, pgSchema-object) — overslaan.
      continue;
    }

    const schemaNaam = config.schema ?? 'public';

    tabellen.push({
      volledigeNaam: `${schemaNaam}.${config.name}`,
      schema: schemaNaam,
      naam: config.name,
      tenantgebonden: config.columns.some((k) => k.name === 'tenant_id'),
    });
  }

  return tabellen.sort((a, b) =>
    a.volledigeNaam.localeCompare(b.volledigeNaam),
  );
}

/**
 * Schema's waarin tenantgebonden tabellen kunnen staan. `ref` valt hier bewust
 * buiten: dat bevat tenant-agnostische lookup-data zonder RLS.
 */
export const TENANT_SCHEMAS = ['clm', 'audit'] as const;
