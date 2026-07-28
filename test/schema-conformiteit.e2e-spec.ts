import { Client } from 'pg';

import {
  TENANT_SCHEMAS,
  inventariseerSchema,
} from '../src/db/schema-inventory';

/**
 * Bewaakt dat de database overeenkomt met het Drizzle-schema — en, belangrijker,
 * dat elke tenantgebonden tabel daadwerkelijk RLS heeft.
 *
 * Dit is een CI-poort, geen eenmalige controle. Reden: drizzle-kit genereert
 * geen RLS (zie ADR-010). Een nieuwe tabel met tenant_id krijgt dus niet
 * automatisch een policy, en zonder deze test zou dat pas bij een datalek
 * opvallen.
 *
 * De verwachte tabellen komen uit het schema zelf, niet uit een lijst in dit
 * bestand: een hardgecodeerde lijst veroudert bij de eerste nieuwe tabel en
 * blijft dan "geslaagd" melden over een situatie die hij niet meer dekt.
 */
describe('Schema-conformiteit (e2e)', () => {
  let client: Client;
  const verwachteTabellen = inventariseerSchema();

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it('vindt tabellen in het Drizzle-schema om te controleren', () => {
    // Vangnet: als de introspectie stukgaat door een Drizzle-upgrade, zou een
    // lege lijst elke andere test hieronder triviaal laten slagen.
    expect(verwachteTabellen.length).toBeGreaterThan(0);
    expect(
      verwachteTabellen.some((t) => t.volledigeNaam === 'clm.vendor'),
    ).toBe(true);
  });

  it('bevat elke tabel uit het schema ook daadwerkelijk in de database', async () => {
    const { rows } = await client.query<{ volledige_naam: string }>(
      `SELECT table_schema || '.' || table_name AS volledige_naam
         FROM information_schema.tables
        WHERE table_schema IN ('clm', 'ref', 'audit')
          AND table_type = 'BASE TABLE'`,
    );

    const aanwezig = new Set(rows.map((r) => r.volledige_naam));
    const ontbrekend = verwachteTabellen
      .map((t) => t.volledigeNaam)
      .filter((naam) => !aanwezig.has(naam));

    expect(ontbrekend).toEqual([]);
  });

  it('kent geen tabellen in de database die niet in het schema staan', async () => {
    // Een tabel die wél in de database staat maar niet in het schema is
    // ontstaan buiten de migratieketen om — bijvoorbeeld handmatig via het
    // Supabase-dashboard, wat MCM2-CLAUDE.md §7.2 verbiedt.
    const { rows } = await client.query<{ volledige_naam: string }>(
      `SELECT table_schema || '.' || table_name AS volledige_naam
         FROM information_schema.tables
        WHERE table_schema IN ('clm', 'ref', 'audit')
          AND table_type = 'BASE TABLE'`,
    );

    const verwacht = new Set(verwachteTabellen.map((t) => t.volledigeNaam));
    const onbekend = rows
      .map((r) => r.volledige_naam)
      .filter((naam) => !verwacht.has(naam));

    expect(onbekend).toEqual([]);
  });

  it('heeft RLS ingeschakeld op elke tenantgebonden tabel', async () => {
    const { rows } = await client.query<{
      volledige_naam: string;
      rowsecurity: boolean;
    }>(
      `SELECT schemaname || '.' || tablename AS volledige_naam, rowsecurity
         FROM pg_tables
        WHERE schemaname = ANY($1)`,
      [TENANT_SCHEMAS],
    );

    const rlsPerTabel = new Map(
      rows.map((r) => [r.volledige_naam, r.rowsecurity]),
    );

    const zonderRls = verwachteTabellen
      .filter((t) => t.tenantgebonden)
      .map((t) => t.volledigeNaam)
      .filter((naam) => rlsPerTabel.get(naam) !== true);

    expect(zonderRls).toEqual([]);
  });

  it('heeft op elke tenantgebonden tabel een policy met zowel USING als WITH CHECK', async () => {
    const { rows } = await client.query<{
      volledige_naam: string;
      policyname: string;
      qual: string | null;
      with_check: string | null;
    }>(
      `SELECT schemaname || '.' || tablename AS volledige_naam,
              policyname, qual, with_check
         FROM pg_policies
        WHERE schemaname = ANY($1)`,
      [TENANT_SCHEMAS],
    );

    const gebrekkig: string[] = [];

    for (const tabel of verwachteTabellen.filter((t) => t.tenantgebonden)) {
      const policies = rows.filter(
        (r) => r.volledige_naam === tabel.volledigeNaam,
      );

      if (policies.length === 0) {
        gebrekkig.push(`${tabel.volledigeNaam}: geen policy`);
        continue;
      }

      // USING zonder WITH CHECK laat lezen correct werken maar staat een
      // cross-tenant write toe — precies het gat dat §7 wil sluiten.
      for (const p of policies) {
        if (!p.qual) {
          gebrekkig.push(`${tabel.volledigeNaam}/${p.policyname}: geen USING`);
        }
        if (!p.with_check) {
          gebrekkig.push(
            `${tabel.volledigeNaam}/${p.policyname}: geen WITH CHECK`,
          );
        }
      }
    }

    expect(gebrekkig).toEqual([]);
  });

  it('heeft op elke kolom met een schema-default ook een DEFAULT in de database', async () => {
    // Toegevoegd na Issue #29: alle 12 UUID-kolommen in de Supabase-database
    // misten DEFAULT gen_random_uuid(), terwijl schema en baseline die wel
    // voorschrijven. Oorzaak: Prisma genereerde UUID's in de applicatielaag
    // (@default(uuid()) is een Prisma-level default, geen SQL-clausule),
    // Drizzle verwacht dat de database het doet.
    //
    // De vorige versie van deze test gaf GOEDGEKEURD op precies die database.
    // Een INSERT zonder expliciete UUID faalt dan op een NOT NULL-constraint.
    const { rows } = await client.query<{
      volledige_naam: string;
      column_name: string;
      column_default: string | null;
    }>(
      `SELECT table_schema || '.' || table_name AS volledige_naam,
              column_name, column_default
         FROM information_schema.columns
        WHERE table_schema IN ('clm', 'ref', 'audit')`,
    );

    const defaultInDb = new Map(
      rows.map((r) => [
        `${r.volledige_naam}.${r.column_name}`,
        r.column_default,
      ]),
    );

    const ontbrekend: string[] = [];

    for (const tabel of verwachteTabellen) {
      for (const kolom of tabel.kolommen.filter((k) => k.heeftDefault)) {
        const sleutel = `${tabel.volledigeNaam}.${kolom.naam}`;
        if (!defaultInDb.get(sleutel)) {
          ontbrekend.push(sleutel);
        }
      }
    }

    expect(ontbrekend).toEqual([]);
  });

  it('draait niet als een rol die RLS omzeilt', async () => {
    const { rows } = await client.query<{ rolbypassrls: boolean }>(
      'SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );

    expect(rows[0].rolbypassrls).toBe(false);
  });
});
