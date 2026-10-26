import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';

import { TEST_IDS } from './test-ids';

/**
 * Migratie 0047: de contractmodule alsnog aan voor bestaande tenants.
 *
 * ── Waarom deze test eerst tenants aanmaakt en dán migreert ─────────────────
 *
 * Migratie 0038 deed hetzelfde met een kale `INSERT ... SELECT FROM
 * clm.tenant`. Op een verse database (CI, `npm run test:db`) bestaan er bij het
 * migreren nog geen tenants, dus die INSERT voegde nul rijen toe — en dat was
 * daar ook goed. Op productie bestonden er wél tenants, maar zag de migratierol
 * ze niet (FORCE RLS zonder tenantcontext), en ook daar: nul rijen. Een test
 * op een lege database kan het verschil niet zien. Deze dus niet: eerst
 * tenants, dan de migratie, dan per tenant tellen.
 *
 * De migratie wordt hier opnieuw uitgevoerd op een database die hem al gehad
 * heeft. Dat mag: hij is idempotent (ON CONFLICT DO NOTHING), en dat is
 * precies wat de tweede test ook bewijst.
 */

const IDS = TEST_IDS['contractmodule-herstel'];
const ALLE = [
  IDS.bestaandeTenant,
  IDS.tenantMetBewusteKeuze,
  IDS.verwijderdeTenant,
];

const MIGRATIE = readFileSync(
  join(__dirname, '..', 'drizzle', '0047_contractmodule_herstel.sql'),
  'utf8',
);

/** Migratierol, altijd naar dezelfde database als DATABASE_URL. */
function migratieUrl(): string {
  const runtime = process.env.DATABASE_URL;
  if (!runtime) throw new Error('DATABASE_URL ontbreekt.');

  const doel = new URL(runtime);
  const expliciet = process.env.MIGRATION_DATABASE_URL;

  if (expliciet) {
    const gegeven = new URL(expliciet);
    if (gegeven.host === doel.host && gegeven.pathname === doel.pathname) {
      return expliciet;
    }
  }

  doel.username = 'clm_migrator';
  return doel.toString();
}

describe('migratie 0047 — contractmodule herstellen', () => {
  let migrator: Client;

  /** De contractmodule-rij van één tenant, gelezen mét tenantcontext. */
  async function contractmodule(tenant: string): Promise<boolean | null> {
    await migrator.query('BEGIN');
    await migrator.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    const { rows } = await migrator.query<{ enabled: boolean }>(
      `SELECT enabled FROM clm.tenant_feature
        WHERE tenant_id = $1 AND feature_key = 'contractmodule'`,
      [tenant],
    );
    await migrator.query('COMMIT');
    return rows[0]?.enabled ?? null;
  }

  /**
   * Draait de migratie geïsoleerd: in één transactie, met clm.tenant in
   * SHARE-modus vast, en daarna ROLLBACK.
   *
   * Waarom (26-10): de migratie raakt bewust álle tenants. Draaide hij hier
   * met autocommit, dan kregen ook de tenants van parallel lopende suites
   * een contractmodule-rij — en botste het met hun eigen inserts en
   * opruimacties (afwisselend een FK-fout hier, een afgebroken transactie in
   * sessie-route.e2e-spec.ts). Binnen de transactie ziet geen andere suite
   * iets, en de SHARE-lock houdt tenants tegen die net verdwijnen.
   * `controle` leest binnen dezelfde transactie, via leesBinnen().
   */
  async function migreerGeisoleerd(controle: () => Promise<void>) {
    await migrator.query('BEGIN');
    try {
      await migrator.query('LOCK TABLE clm.tenant IN SHARE MODE');
      await migrator.query(MIGRATIE);
      await controle();
    } finally {
      await migrator.query('ROLLBACK');
    }
  }

  /** Zoals contractmodule(), maar binnen een al geopende transactie. */
  async function leesBinnen(tenant: string): Promise<boolean | null> {
    await migrator.query(
      `SELECT set_config('app.current_tenant_id', $1, true)`,
      [tenant],
    );
    const { rows } = await migrator.query<{ enabled: boolean }>(
      `SELECT enabled FROM clm.tenant_feature
        WHERE tenant_id = $1 AND feature_key = 'contractmodule'`,
      [tenant],
    );
    await migrator.query(
      `SELECT set_config('app.current_tenant_id', '', true)`,
    );
    return rows[0]?.enabled ?? null;
  }

  async function ruimOp(): Promise<void> {
    for (const t of ALLE) {
      await migrator.query('BEGIN');
      await migrator.query(`SET LOCAL app.current_tenant_id = '${t}'`);
      await migrator.query(
        'DELETE FROM clm.tenant_feature WHERE tenant_id = $1',
        [t],
      );
      await migrator.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [t]);
      await migrator.query('COMMIT');
    }
    await migrator.query(
      'DELETE FROM clm.tenant_register WHERE register_id = ANY($1)',
      [ALLE],
    );
  }

  beforeAll(async () => {
    migrator = new Client({ connectionString: migratieUrl() });
    await migrator.connect();
    await ruimOp();

    for (const t of ALLE) {
      await migrator.query('BEGIN');
      await migrator.query(`SET LOCAL app.current_tenant_id = '${t}'`);
      await migrator.query(
        'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
        [t, `contractmodule-herstel-${t.slice(-2)}`],
      );
      await migrator.query('COMMIT');
    }

    // Een tenant waarvoor de platformbeheerder de module bewust uitzette:
    // de herstelmigratie mag die keuze niet overschrijven.
    await migrator.query('BEGIN');
    await migrator.query(
      `SET LOCAL app.current_tenant_id = '${IDS.tenantMetBewusteKeuze}'`,
    );
    await migrator.query(
      `INSERT INTO clm.tenant_feature (tenant_id, feature_key, enabled)
       VALUES ($1, 'contractmodule', false)`,
      [IDS.tenantMetBewusteKeuze],
    );
    await migrator.query('COMMIT');

    await migrator.query('BEGIN');
    await migrator.query(
      `SET LOCAL app.current_tenant_id = '${IDS.verwijderdeTenant}'`,
    );
    await migrator.query(
      'UPDATE clm.tenant SET deleted_at = now() WHERE tenant_id = $1',
      [IDS.verwijderdeTenant],
    );
    await migrator.query('COMMIT');
  }, 30000);

  afterAll(async () => {
    await ruimOp();
    await migrator.end();
  });

  it('tegenproef: de aanpak van 0038 voegt als migratierol niets toe', async () => {
    // Zonder tenantcontext ziet clm_migrator door FORCE RLS geen tenants.
    // In een transactie die teruggedraaid wordt: het gaat om de telling.
    await migrator.query('BEGIN');
    const { rowCount } = await migrator.query(
      `INSERT INTO clm.tenant_feature (tenant_id, feature_key, enabled)
       SELECT tenant_id, 'contractmodule', true FROM clm.tenant
        WHERE deleted_at IS NULL AND tenant_id = $1
       ON CONFLICT DO NOTHING`,
      [IDS.bestaandeTenant],
    );
    await migrator.query('ROLLBACK');

    expect(rowCount).toBe(0);
  });

  it('zet de module aan voor een actieve tenant zonder rij', async () => {
    expect(await contractmodule(IDS.bestaandeTenant)).toBeNull();

    await migreerGeisoleerd(async () => {
      expect(await leesBinnen(IDS.bestaandeTenant)).toBe(true);
    });
  });

  it('laat een bewuste keuze van de platformbeheerder staan', async () => {
    await migreerGeisoleerd(async () => {
      expect(await leesBinnen(IDS.tenantMetBewusteKeuze)).toBe(false);
    });
  });

  it('geeft een verwijderde tenant geen rij', async () => {
    await migreerGeisoleerd(async () => {
      expect(await leesBinnen(IDS.verwijderdeTenant)).toBeNull();
    });
  });

  it('laat geen tenantcontext achter op de verbinding', async () => {
    await migreerGeisoleerd(async () => {
      const { rows } = await migrator.query<{ ctx: string | null }>(
        'SELECT clm.current_tenant_id()::text AS ctx',
      );
      expect(rows[0].ctx).toBeNull();
    });
  });
});
