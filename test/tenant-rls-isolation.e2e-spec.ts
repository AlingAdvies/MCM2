import { Client } from 'pg';

const TENANT_A_ID = '00000000-0000-0000-0000-0000000000aa';
const TENANT_B_ID = '00000000-0000-0000-0000-0000000000bb';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TenantRow {
  tenant_id: string;
  name: string;
}

// SET LOCAL accepteert geen query-parameters ($1) — dit is een PostgreSQL-
// eigen restrictie, geen keuze. Vandaar de expliciete UUID-validatie vooraf
// in plaats van een geparametriseerde query.
async function withTenantContext<T>(
  client: Client,
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!UUID_REGEX.test(tenantId)) {
    throw new Error(`Ongeldige tenant-id: '${tenantId}'`);
  }

  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

describe('Tenant RLS-isolatie (e2e, tegen echte database via DATABASE_URL)', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await withTenantContext(client, TENANT_A_ID, async () => {
      await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [
        TENANT_A_ID,
      ]);
    });
    await withTenantContext(client, TENANT_B_ID, async () => {
      await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [
        TENANT_B_ID,
      ]);
    });

    await client.end();
  });

  it('gebruikt geen BYPASSRLS-rol', async () => {
    const res = await client.query<{ rolbypassrls: boolean }>(
      'SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(res.rows[0].rolbypassrls).toBe(false);
  });

  it('toont geen rijen zonder tenant-context (SET LOCAL niet gezet)', async () => {
    const res = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM clm.tenant',
    );
    expect(res.rows[0].count).toBe(0);
  });

  it('staat schrijven toe binnen de eigen tenant-context', async () => {
    await withTenantContext(client, TENANT_A_ID, async () => {
      const res = await client.query<Pick<TenantRow, 'tenant_id'>>(
        'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2) RETURNING tenant_id',
        [TENANT_A_ID, 'rls-test-tenant-a'],
      );
      expect(res.rows[0].tenant_id).toBe(TENANT_A_ID);
    });

    await withTenantContext(client, TENANT_B_ID, async () => {
      const res = await client.query<Pick<TenantRow, 'tenant_id'>>(
        'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2) RETURNING tenant_id',
        [TENANT_B_ID, 'rls-test-tenant-b'],
      );
      expect(res.rows[0].tenant_id).toBe(TENANT_B_ID);
    });
  });

  it('toont bij lezen uitsluitend de eigen tenant, nooit een andere tenant', async () => {
    const rowsForA = await withTenantContext(client, TENANT_A_ID, async () => {
      const res = await client.query<TenantRow>(
        'SELECT tenant_id, name FROM clm.tenant',
      );
      return res.rows;
    });

    expect(rowsForA).toHaveLength(1);
    expect(rowsForA[0].tenant_id).toBe(TENANT_A_ID);
    expect(rowsForA.some((r) => r.tenant_id === TENANT_B_ID)).toBe(false);

    const rowsForB = await withTenantContext(client, TENANT_B_ID, async () => {
      const res = await client.query<TenantRow>(
        'SELECT tenant_id, name FROM clm.tenant',
      );
      return res.rows;
    });

    expect(rowsForB).toHaveLength(1);
    expect(rowsForB[0].tenant_id).toBe(TENANT_B_ID);
    expect(rowsForB.some((r) => r.tenant_id === TENANT_A_ID)).toBe(false);
  });

  it('weigert een write met een tenant_id die niet overeenkomt met de sessiecontext (WITH CHECK)', async () => {
    await expect(
      withTenantContext(client, TENANT_A_ID, async () => {
        await client.query(
          'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
          [TENANT_B_ID, 'cross-tenant-write-poging'],
        );
      }),
    ).rejects.toThrow();
  });
});
