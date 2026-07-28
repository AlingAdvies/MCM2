import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';
import { setTenantContext } from './schema';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Db = NodePgDatabase<typeof schema>;
export type TenantTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * De enige plek waar een databaseverbinding wordt geopend (MCM2-CLAUDE.md §8).
 * Domeincode gebruikt withTenant() en opent nooit zelf een client.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;
  readonly db: Db;

  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error(
        'DATABASE_URL ontbreekt. De applicatie draait via de runtime-rol clm_api_runtime (geen BYPASSRLS). Zie .env.example.',
      );
    }

    this.pool = new Pool({ connectionString });
    this.db = drizzle(this.pool, { schema });
  }

  async onModuleInit(): Promise<void> {
    // Faalt hard bij een verkeerd geconfigureerde rol: een runtime-rol met
    // BYPASSRLS maakt RLS betekenisloos als tenant-isolatiegrens (§6).
    const { rows } = await this.pool.query<{
      rolname: string;
      rolbypassrls: boolean;
    }>(
      'SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );

    const role = rows[0];

    if (!role) {
      throw new Error('Kan de huidige databaserol niet vaststellen.');
    }

    if (role.rolbypassrls) {
      throw new Error(
        `De databaserol '${role.rolname}' heeft BYPASSRLS. RLS is dan geen effectieve tenant-isolatiegrens. Gebruik clm_api_runtime. Zie ADR-008.`,
      );
    }

    this.logger.log(`Databaseverbinding actief als rol '${role.rolname}'.`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Voert alle queries uit binnen één transactie op één connectie, met de
   * tenantcontext als eerste statement (§6). Buiten deze methode is er geen
   * tenantcontext, dus levert elke tenantgebonden query nul rijen op.
   *
   * De tenantId hoort uit geverifieerde identiteit te komen — een ID-token of
   * een tokenlookup — nooit uit een header of query-parameter (Issue #7).
   */
  async withTenant<T>(
    tenantId: string,
    fn: (tx: TenantTransaction) => Promise<T>,
  ): Promise<T> {
    if (!UUID_REGEX.test(tenantId)) {
      throw new Error(`Ongeldige tenant-id: '${tenantId}'`);
    }

    return this.db.transaction(async (tx) => {
      await tx.execute(setTenantContext(tenantId));
      return fn(tx);
    });
  }
}
