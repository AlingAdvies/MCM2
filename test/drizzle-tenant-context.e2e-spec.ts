import { sql } from 'drizzle-orm';
import { NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../src/db/schema';
import { setTenantContext, tenant, vendor } from '../src/db/schema';

const TENANT_A_ID = '00000000-0000-0000-0000-0000000000ca';
const TENANT_B_ID = '00000000-0000-0000-0000-0000000000cb';

/**
 * Bewijst dat tenant-isolatie ook geldt via de Drizzle-querylaag, niet alleen
 * via ruwe pg-queries (tenant-rls-isolation.e2e-spec.ts). Dit is criterium 3
 * en 4 uit MCM2-CLAUDE.md §5: SET LOCAL plus tenantqueries binnen dezelfde
 * transactie en connectie.
 */
describe('Drizzle tenant-context (e2e)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;

  // Spiegelt DatabaseService.withTenant(): dezelfde transactie, dezelfde
  // connectie, tenantcontext als eerste statement.
  const withTenant = async <T>(
    tenantId: string,
    fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
  ): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.execute(setTenantContext(tenantId));
      return fn(tx);
    });

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });

    await withTenant(TENANT_A_ID, async (tx) => {
      await tx
        .insert(tenant)
        .values({ tenantId: TENANT_A_ID, name: 'drizzle-test-a' });
      await tx
        .insert(vendor)
        .values({ tenantId: TENANT_A_ID, name: 'vendor-van-a' });
    });

    await withTenant(TENANT_B_ID, async (tx) => {
      await tx
        .insert(tenant)
        .values({ tenantId: TENANT_B_ID, name: 'drizzle-test-b' });
      await tx
        .insert(vendor)
        .values({ tenantId: TENANT_B_ID, name: 'vendor-van-b' });
    });
  });

  afterAll(async () => {
    for (const id of [TENANT_A_ID, TENANT_B_ID]) {
      await withTenant(id, async (tx) => {
        await tx.execute(sql`DELETE FROM clm.vendor`);
        await tx.execute(sql`DELETE FROM clm.tenant`);
      });
    }
    await pool.end();
  });

  it('draait niet als een BYPASSRLS-rol', async () => {
    const res = await db.execute<{ rolbypassrls: boolean }>(
      sql`SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(res.rows[0].rolbypassrls).toBe(false);
  });

  it('levert zonder tenant-context geen rijen op', async () => {
    // Buiten withTenant() is app.current_tenant_id niet gezet.
    expect(await db.select().from(vendor)).toHaveLength(0);
  });

  it('toont via de Drizzle-querylaag uitsluitend de eigen tenant', async () => {
    const vendorsForA = await withTenant(TENANT_A_ID, (tx) =>
      tx.select().from(vendor),
    );

    expect(vendorsForA).toHaveLength(1);
    expect(vendorsForA[0].name).toBe('vendor-van-a');
    expect(vendorsForA.some((v) => v.tenantId === TENANT_B_ID)).toBe(false);

    const vendorsForB = await withTenant(TENANT_B_ID, (tx) =>
      tx.select().from(vendor),
    );

    expect(vendorsForB).toHaveLength(1);
    expect(vendorsForB[0].name).toBe('vendor-van-b');
  });

  it('weigert een cross-tenant write via de WITH CHECK-policy', async () => {
    await expect(
      withTenant(TENANT_A_ID, (tx) =>
        tx.insert(vendor).values({
          tenantId: TENANT_B_ID,
          name: 'cross-tenant-poging',
        }),
      ),
    ).rejects.toThrow();
  });

  it('laat de tenantcontext niet lekken naar een volgende transactie', async () => {
    // SET LOCAL geldt per transactie; na afloop moet de context weg zijn,
    // anders zou een hergebruikte poolverbinding data van de vorige tenant
    // kunnen tonen.
    await withTenant(TENANT_A_ID, (tx) => tx.select().from(vendor));

    expect(await db.select().from(vendor)).toHaveLength(0);
  });

  it('voert geen SQL uit die in de tenant-id is meegesmokkeld', async () => {
    // set_config() neemt de waarde als parameter, niet als SQL-tekst: de
    // string wordt letterlijk opgeslagen, niet uitgevoerd. Vervolgens faalt
    // clm.current_tenant_id() op de ::UUID-cast zodra een policy hem leest.
    // Dat is een andere, sterkere garantie dan de UUID-regexcontrole in
    // DatabaseService.withTenant() — die is de eerste verdedigingslinie, dit
    // de tweede.
    await expect(
      withTenant("'; DROP TABLE clm.vendor; --", (tx) =>
        tx.select().from(vendor),
      ),
    ).rejects.toThrow();

    const stillThere = await withTenant(TENANT_A_ID, (tx) =>
      tx.select().from(vendor),
    );
    expect(stillThere).toHaveLength(1);
  });
});
