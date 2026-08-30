import { Client } from 'pg';

import {
  FORCE_RLS_UITZONDERINGEN,
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

  it('heeft FORCE ROW LEVEL SECURITY op elke tenantgebonden tabel', async () => {
    // Toegevoegd na de externe review van 2026-07-31 (migratie 0011).
    //
    // RLS inschakelen is niet genoeg: PostgreSQL onderwerpt de *eigenaar* van
    // een tabel standaard niet aan row security. Geen BYPASSRLS nodig, geen
    // foutmelding — de policies worden simpelweg overgeslagen.
    //
    // Gemeten vóór 0011, met de tenantcontext op een vreemde tenant:
    //   clm_migrator (eigenaar)   → 1 rij
    //   clm_api_runtime (runtime) → 0 rijen
    //
    // Vandaag is dat geen lek omdat eigenaar en runtime gescheiden zijn
    // (ADR-009). Deze test bestaat omdat niets dát afdwingt: wie ooit
    // DATABASE_URL op de migratierol zet, verliest RLS zonder waarschuwing.
    const { rows } = await client.query<{
      volledige_naam: string;
      force_aan: boolean;
    }>(
      `SELECT n.nspname || '.' || c.relname AS volledige_naam,
              c.relforcerowsecurity        AS force_aan
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY($1) AND c.relkind = 'r'`,
      [TENANT_SCHEMAS],
    );

    const forcePerTabel = new Map(
      rows.map((r) => [r.volledige_naam, r.force_aan]),
    );

    const zonderForce = verwachteTabellen
      .filter((t) => t.tenantgebonden)
      .map((t) => t.volledigeNaam)
      // clm.sessie heeft bewust geen RLS; FORCE zonder policies zou élke
      // toegang blokkeren, ook via de SECURITY DEFINER-functies.
      .filter((naam) => !RLS_UITZONDERINGEN.has(naam))
      // Vijf tabellen die een SECURITY DEFINER-functie moet kunnen lezen
      // vóórdat er tenantcontext is. FORCE brak daar de inlogflow en de
      // surveylinks. Zie de motivatie bij FORCE_RLS_UITZONDERINGEN.
      .filter((naam) => !FORCE_RLS_UITZONDERINGEN.has(naam))
      .filter((naam) => forcePerTabel.get(naam) !== true);

    expect(zonderForce).toEqual([]);
  });

  it('houdt de lijst met FORCE-uitzonderingen kort en bewust', () => {
    // Zelfde reden als bij de RLS-uitzonderingen: zonder deze test wordt de
    // lijst een achterdeur waar een tabel stilletjes in verdwijnt zodra een
    // andere test rood staat. Uitbreiden hoort een expliciete afweging te zijn.
    expect([...FORCE_RLS_UITZONDERINGEN].sort()).toEqual([
      'clm.survey_response',
      'clm.survey_run',
      'clm.tenant_membership',
      'clm.user',
      'clm.vendor',
    ]);
  });

  it('heeft op elke FORCE-uitzondering wél gewoon RLS met policies', async () => {
    // De uitzondering gaat uitsluitend over de eigenaar. Zou op deze tabellen
    // ook RLS zelf wegvallen, dan staan ze volledig open voor de runtime-rol —
    // een heel ander verhaal dan waar deze uitzondering voor bedoeld is.
    for (const volledigeNaam of FORCE_RLS_UITZONDERINGEN) {
      const [schemaNaam, tabelNaam] = volledigeNaam.split('.');

      const { rows } = await client.query<{
        rls_aan: boolean;
        aantal_policies: string;
      }>(
        `SELECT c.relrowsecurity AS rls_aan,
                (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)
                  AS aantal_policies
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2`,
        [schemaNaam, tabelNaam],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].rls_aan).toBe(true);
      expect(Number(rows[0].aantal_policies)).toBeGreaterThan(0);
    }
  });

  it('draait niet als de rol die eigenaar is van de tabellen', async () => {
    // De tweede helft van dezelfde garantie. FORCE ROW LEVEL SECURITY dekt het
    // eigenaarsgat af, maar deze scheiding is de eerste verdedigingslinie en
    // een expliciete keuze uit ADR-009: migreren en draaien zijn twee rollen.
    //
    // Deze test valt om zodra iemand de applicatie op de migratierol laat
    // draaien — precies het scenario waarin het stil misgaat.
    const { rows } = await client.query<{
      eigenaar: string;
      huidige_rol: string;
    }>(
      `SELECT DISTINCT c.relowner::regrole::text AS eigenaar,
              current_user                       AS huidige_rol
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY($1) AND c.relkind = 'r'`,
      [TENANT_SCHEMAS],
    );

    expect(rows.length).toBeGreaterThan(0);

    for (const rij of rows) {
      expect(rij.eigenaar).not.toBe(rij.huidige_rol);
    }
  });

  it('zet op elke SECURITY DEFINER-functie een expliciete search_path', async () => {
    // Een SECURITY DEFINER-functie draait met de rechten van de eigenaar.
    // Zonder vaste search_path kan wie schrijfrechten heeft op een schema in
    // dat pad een gelijknamig object plaatsen en de functie kapen.
    //
    // Alle elf functies hebben dit al sinds migratie 0003, met uitleg ter
    // plekke. Wat ontbrak was deze bewaking: een nieuwe functie zónder
    // search_path zou er nu doorheen glippen. De hardening was er, de
    // controle niet — dat verschil is precies wat de review blootlegde.
    const { rows } = await client.query<{
      functie: string;
      instellingen: string[] | null;
    }>(
      `SELECT n.nspname || '.' || p.proname AS functie,
              p.proconfig                   AS instellingen
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = ANY($1) AND p.prosecdef`,
      [TENANT_SCHEMAS],
    );

    expect(rows.length).toBeGreaterThan(0);

    const zonderSearchPath = rows
      .filter(
        (r) =>
          !(r.instellingen ?? []).some((waarde) =>
            waarde.startsWith('search_path='),
          ),
      )
      .map((r) => r.functie);

    expect(zonderSearchPath).toEqual([]);
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

  it('heeft op elke tabel exact de kolommen die het schema verwacht', async () => {
    // Bewaakt de andere kant van 2026-08-29's bevinding: een handgeschreven
    // migratie kan de database prima wijzigen zonder dat schema.ts ooit
    // wordt bijgewerkt (drizzle-kit generate is stuk, zie Issue #96) — de
    // applicatie leest schema.ts namelijk nergens voor haar eigen queries
    // (die schrijven kolomnamen rechtstreeks in SQL). Vier kolommen waren zo
    // jarenlang onopgemerkt uit de pas gelopen: contract.notice_period_days/
    // warning_days_before/auto_renews (migratie 0029), response_note.soort
    // (0030), tenant.deleted_at (0033), user.uitnodiging_hash (0024).
    //
    // pg_attribute/pg_class/pg_namespace, niet information_schema.columns —
    // zelfde reden als de DEFAULT-test hierboven: clm.sessie is voor de
    // huidige rol soms wél, soms niet leesbaar via information_schema,
    // afhankelijk van de rol waarmee dit script draait. pg_attribute toont
    // de kolom onafhankelijk van GRANT's.
    const { rows } = await client.query<{
      volledige_naam: string;
      column_name: string;
    }>(
      `SELECT n.nspname || '.' || c.relname AS volledige_naam,
              a.attname                     AS column_name
         FROM pg_attribute a
         JOIN pg_class c     ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('clm', 'ref', 'audit')
          AND c.relkind = 'r'
          AND a.attnum > 0
          AND NOT a.attisdropped`,
    );

    const kolommenInDbPerTabel = new Map<string, Set<string>>();
    for (const r of rows) {
      const set = kolommenInDbPerTabel.get(r.volledige_naam) ?? new Set();
      set.add(r.column_name);
      kolommenInDbPerTabel.set(r.volledige_naam, set);
    }

    const ontbrekendInSchema: string[] = [];
    const ontbrekendInDb: string[] = [];

    for (const tabel of verwachteTabellen) {
      const kolommenInDb = kolommenInDbPerTabel.get(tabel.volledigeNaam);
      // Een tabel die niet bestaat, is al gemeld door de test hierboven
      // ("bevat elke tabel uit het schema ook daadwerkelijk in de
      // database") — hier alleen kolomverschillen op tabellen die wél in
      // beide voorkomen, anders dubbel gemeld.
      if (!kolommenInDb) continue;

      const kolommenInSchema = new Set(tabel.kolommen.map((k) => k.naam));

      for (const kolom of kolommenInDb) {
        if (!kolommenInSchema.has(kolom)) {
          ontbrekendInSchema.push(`${tabel.volledigeNaam}.${kolom}`);
        }
      }
      for (const kolom of kolommenInSchema) {
        if (!kolommenInDb.has(kolom)) {
          ontbrekendInDb.push(`${tabel.volledigeNaam}.${kolom}`);
        }
      }
    }

    expect({ ontbrekendInSchema, ontbrekendInDb }).toEqual({
      ontbrekendInSchema: [],
      ontbrekendInDb: [],
    });
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
