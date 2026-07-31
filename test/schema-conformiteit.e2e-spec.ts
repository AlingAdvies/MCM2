import { Client } from 'pg';

import {
  RLS_UITZONDERINGEN,
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
    // pg_tables en niet information_schema: dat laatste toont uitsluitend
    // objecten waar de huidige rol rechten op heeft. clm.sessie is voor de
    // runtime-rol volledig afgesloten (migratie 0010) en zou daar dus
    // ontbreken — waarmee deze test zou melden dat de tabel niet bestaat,
    // terwijl hij er wel is. Gevonden op 2026-07-30.
    const { rows } = await client.query<{ volledige_naam: string }>(
      `SELECT schemaname || '.' || tablename AS volledige_naam
         FROM pg_tables
        WHERE schemaname IN ('clm', 'ref', 'audit')`,
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
      `SELECT schemaname || '.' || tablename AS volledige_naam
         FROM pg_tables
        WHERE schemaname IN ('clm', 'ref', 'audit')`,
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
      .filter((naam) => !RLS_UITZONDERINGEN.has(naam))
      .filter((naam) => rlsPerTabel.get(naam) !== true);

    expect(zonderRls).toEqual([]);
  });

  it('houdt de lijst met RLS-uitzonderingen kort en bewust', () => {
    // Deze test bestaat om te voorkomen dat de uitzonderingenlijst een
    // achterdeur wordt. Komt er een tabel bij, dan hoort dat een expliciete
    // afweging te zijn met motivatie in schema-inventory.ts — niet een stille
    // toevoeging omdat een andere test rood stond.
    expect([...RLS_UITZONDERINGEN]).toEqual(['clm.sessie']);
  });

  it('sluit elke RLS-uitzondering volledig af voor de runtime-rol', async () => {
    // Een uitzondering op RLS is alleen verdedigbaar als de bescherming ergens
    // anders vandaan komt. Voor clm.sessie is dat: de tabel is onbereikbaar en
    // alle toegang loopt via SECURITY DEFINER-functies. Zonder deze controle
    // zou "geen RLS" stilzwijgend kunnen verworden tot "geen bescherming".
    for (const volledigeNaam of RLS_UITZONDERINGEN) {
      const [schemaNaam, tabelNaam] = volledigeNaam.split('.');

      const { rows } = await client.query<{ privilege_type: string }>(
        `SELECT privilege_type
           FROM information_schema.table_privileges
          WHERE table_schema = $1
            AND table_name = $2
            AND grantee IN ('clm_api', 'clm_admin', 'clm_readonly')`,
        [schemaNaam, tabelNaam],
      );

      expect({
        tabel: volledigeNaam,
        rechten: rows.map((r) => r.privilege_type),
      }).toEqual({ tabel: volledigeNaam, rechten: [] });
    }
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

    for (const tabel of verwachteTabellen
      .filter((t) => t.tenantgebonden)
      .filter((t) => !RLS_UITZONDERINGEN.has(t.volledigeNaam))) {
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
    // pg_attribute/pg_attrdef en niet information_schema.columns: dat laatste
    // toont alleen kolommen waar de huidige rol rechten op heeft, en clm.sessie
    // is voor de runtime-rol volledig afgesloten (migratie 0010). Die tabel zou
    // daar dus stilzwijgend buiten de controle vallen — precies het soort gat
    // waar Issue #29 door kon ontstaan.
    const { rows } = await client.query<{
      volledige_naam: string;
      column_name: string;
      column_default: string | null;
    }>(
      `SELECT n.nspname || '.' || c.relname AS volledige_naam,
              a.attname                     AS column_name,
              pg_get_expr(d.adbin, d.adrelid) AS column_default
         FROM pg_attribute a
         JOIN pg_class c     ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname IN ('clm', 'ref', 'audit')
          AND c.relkind = 'r'
          AND a.attnum > 0
          AND NOT a.attisdropped`,
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

  describe('survey_run.contract_id (migratie 0007)', () => {
    it('bestaat als nullable uuid', async () => {
      // Nullable is een ontwerpkeuze, geen tussenstand: een ronde hoeft niet
      // aan een contract te hangen. Een leverancier kan beoordeeld worden vóór
      // er een overeenkomst is, en de acht Transdev-vragen gaan over de
      // organisatie als geheel. Verplicht stellen zou UC1 breken.
      const { rows } = await client.query<{
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT data_type, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'clm'
            AND table_name = 'survey_run'
            AND column_name = 'contract_id'`,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].data_type).toBe('uuid');
      expect(rows[0].is_nullable).toBe('YES');
    });

    it('heeft nog géén foreign key — clm.contract bestaat niet', async () => {
      // Legt de huidige situatie expliciet vast. Deze test hoort te FALEN op
      // het moment dat clm.contract wordt ingevoerd: dan moet hier een FK
      // liggen, en dan is dit de plek die eraan herinnert. Een ontbrekende FK
      // die niemand opmerkt is precies hoe een verwijzing naar een
      // niet-bestaande rij binnensluipt.
      const { rows: tabel } = await client.query(
        `SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'clm' AND table_name = 'contract'`,
      );

      const { rows: fks } = await client.query(
        `SELECT 1
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name
          WHERE tc.table_schema = 'clm'
            AND tc.table_name = 'survey_run'
            AND tc.constraint_type = 'FOREIGN KEY'
            AND kcu.column_name = 'contract_id'`,
      );

      if (tabel.length > 0) {
        // clm.contract is er inmiddels: dan hóórt de FK er ook te zijn.
        expect(fks.length).toBe(1);
      } else {
        expect(fks.length).toBe(0);
      }
    });

    it('is doorzoekbaar via een index', async () => {
      // Rapportage vraagt straks "alle rondes over contract X". Zonder index
      // is dat een volledige scan over een tabel die per tenant per jaar
      // aangroeit.
      const { rows } = await client.query(
        `SELECT 1 FROM pg_indexes
          WHERE schemaname = 'clm'
            AND tablename = 'survey_run'
            AND indexname = 'survey_run_contract_id_idx'`,
      );

      expect(rows).toHaveLength(1);
    });
  });
});
