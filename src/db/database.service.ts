import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';
import { setActorContext, setTenantContext, type Actor } from './schema';

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

    this.pool = new Pool({
      connectionString,
      // Expliciet begrensd, niet de standaard van node-postgres (10).
      //
      // Aanleiding: op 2026-07-31 viel de e2e-suite onregelmatig om — één keer
      // 21 falende tests, daarna drie keer achter elkaar groen. Dat is de
      // vervelendste faalvorm die er is, want hij ondermijnt het vertrouwen in
      // álle tests zonder dat er iets mis is met de code.
      //
      // Oorzaak: Jest draait suites parallel (hier tot 11 tegelijk), elke suite
      // start een eigen Nest-applicatie, en elke applicatie opende tot 10
      // verbindingen. Dat past niet binnen de standaard max_connections=100 van
      // Postgres. Bewezen door max_connections tijdelijk op 30 te zetten: dan
      // faalt de suite reproduceerbaar.
      //
      // Vier is ruim voor de werklast van dit project (één verzoek = één
      // transactie) en houdt de suite binnen de perken. Voor productie is dit
      // eerder te krap dan te ruim; daarom is het instelbaar.
      max: Number(process.env.DATABASE_POOL_MAX ?? 4),
    });
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
   *
   * ── De actor ─────────────────────────────────────────────────────────────
   * Naast de tenant legt elke transactie vast wélke soort aanroeper hem opent:
   * een `medewerker` (sessiepad) of een `leverancier` (tokenpad). Zie
   * drizzle/0013_actor_context.sql.
   *
   * De parameter is bewust optioneel in de signatuur en tegelijk verplicht in
   * de praktijk. Dat lijkt tegenstrijdig en is het niet:
   *
   * - Weglaten levert actor `onbekend` op. Dat is de striktste stand — geen
   *   toegang tot wat achter een actor-eis ligt. Een vergeten actor faalt dus
   *   dicht, niet open.
   * - Een verplichte parameter zou ~70 testregels raken die niets met dit
   *   onderwerp te maken hebben. Die aanpassen levert ruis op in precies de
   *   tests die de tenantgrens bewijzen, en dat is een slechte ruil.
   *
   * Voor productiecode geldt: altijd meegeven. De tegenproef in
   * survey-review.e2e-spec bewaakt dat het tokenpad `leverancier` doorgeeft.
   */
  async withTenant<T>(
    tenantId: string,
    fn: (tx: TenantTransaction) => Promise<T>,
    actor?: Actor,
  ): Promise<T> {
    if (!UUID_REGEX.test(tenantId)) {
      throw new Error(`Ongeldige tenant-id: '${tenantId}'`);
    }

    return this.db.transaction(async (tx) => {
      await tx.execute(setTenantContext(tenantId));

      // Alleen zetten als hij meegegeven is. Niet zetten laat de variabele
      // leeg, en clm.current_actor() maakt daar 'onbekend' van — de striktste
      // uitkomst. Hier expliciet 'onbekend' schrijven zou hetzelfde doen maar
      // suggereren dat het een bewuste keuze van de aanroeper was.
      if (actor) {
        await tx.execute(setActorContext(actor));
      }

      return fn(tx);
    });
  }
}
