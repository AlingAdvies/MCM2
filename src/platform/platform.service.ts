import { ConflictException, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';

/** Hoe lang support-toegang standaard geldig is. */
export const SUPPORT_TOEGANG_UREN = 8;

/**
 * Hoe lang een uitnodiging voor een eerste admin geldig blijft.
 *
 * Negentig dagen: ruim genoeg voor een klant die een paar weken nodig heeft om
 * te beginnen, kort genoeg om niet jaren een koppelbare rij te laten staan.
 * Verloopt hij, dan moet de platformbeheerder opnieuw uitnodigen — een
 * zichtbare handeling in plaats van een deur die open blijft.
 */
export const UITNODIGING_GELDIG_DAGEN = 90;

export interface NieuweTenant {
  readonly naam: string;
  /** Wordt de eerste admin. Zijn oid volgt bij de eerste login. */
  readonly adminEmail: string;
  readonly adminNaam: string;
}

export interface TenantOverzicht {
  readonly tenantId: string;
  readonly naam: string;
  readonly aangemaaktOp: Date;
  readonly aantalLeden: number;
}

export interface SupportToegang {
  readonly tenantId: string;
  readonly verlooptOp: Date;
  readonly reden: string;
}

/**
 * Platformbeheer: tenants aanmaken en tijdelijke support-toegang toekennen
 * (ADR-015, migratie 0020).
 *
 * ── Waarom hier withTenant() met de dóél-tenant staat ────────────────────────
 *
 * Elke schrijfactie loopt via de tenantcontext van de tenant waar hij landt,
 * niet die van de aanroeper. Dat is geen omweg maar de kern: ook een
 * platformbeheerder schrijft binnen RLS, en een fout in deze service kan
 * daardoor geen rijen in een andere tenant raken.
 *
 * De tenant komt hier wél uit de invoer, en dat is de enige plek in de
 * applicatie waar dat mag — bewaakt door PlatformAdminGuard. Voor alle andere
 * routes geldt onverkort dat de tenant uit de sessie komt (§6).
 */
/**
 * De twee indexen die een dubbele tenantnaam tegenhouden.
 *
 * `tenant_name_key` (baseline) bewaakt de exacte schrijfwijze,
 * `tenant_name_ongeacht_hoofdletters` (0021) vangt wat die doorlaat.
 */
const NAAM_CONSTRAINTS = new Set([
  'tenant_name_key',
  'tenant_name_ongeacht_hoofdletters',
]);

/**
 * Herkent een dubbele tenantnaam.
 *
 * Drizzle verpakt de pg-fout in een DrizzleQueryError; de PostgreSQL-code
 * (23505) en de constraintnaam staan in `cause`. Op de constraintnaam toetsen
 * en niet alleen op 23505: een andere unieke index zou anders óók als
 * "naam bestaat al" naar buiten komen, en dat is een misleidende melding.
 */
function isUniekeNaamFout(fout: unknown): boolean {
  const oorzaak = (fout as { cause?: unknown })?.cause ?? fout;
  const details = oorzaak as { code?: string; constraint?: string };

  return (
    details?.code === '23505' &&
    typeof details?.constraint === 'string' &&
    NAAM_CONSTRAINTS.has(details.constraint)
  );
}

@Injectable()
export class PlatformService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Maakt een tenant met zijn eerste beheerder.
   *
   * De gebruikersrij krijgt géén `external_subject`: die is pas bekend als de
   * persoon voor het eerst inlogt bij Entra. De partiële unieke index op die
   * kolom (migratie 0009, `WHERE external_subject IS NOT NULL`) staat dat
   * uitdrukkelijk toe — precies met deze situatie in gedachten.
   */
  async tenantAanmaken(invoer: NieuweTenant): Promise<TenantOverzicht> {
    const tenantId = crypto.randomUUID();

    return this.db.withTenant(tenantId, async (tx) => {
      // ── Waarom hier geen "bestaat de naam al?"-query staat ─────────────────
      //
      // Die zou niets vinden. We draaien in de tenantcontext van de nieuwe,
      // nog niet bestaande tenant, en RLS verbergt elke andere tenant — een
      // SELECT levert dus altijd nul rijen op, hoeveel gelijknamige tenants er
      // ook zijn.
      //
      // De unieke index `tenant_name_key` (baseline 0000) doet het werk wel,
      // want een constraint kent geen RLS. Vandaar: proberen, en de fout
      // vertalen naar iets wat het scherm kan tonen.
      try {
        await tx.execute(
          sql`INSERT INTO clm.tenant (tenant_id, name) VALUES (${tenantId}, ${invoer.naam})`,
        );
      } catch (fout) {
        if (isUniekeNaamFout(fout)) {
          throw new ConflictException(
            `Er bestaat al een tenant met de naam '${invoer.naam}'.`,
          );
        }
        throw fout;
      }

      // koppelbaar_tot maakt dit een uitnodiging: bij zijn eerste Entra-login
      // koppelt clm.koppel_eerste_login() de oid aan deze rij (migratie 0023).
      // Zonder die datum is de rij niet koppelbaar en kan deze admin nooit
      // inloggen — NULL is daar de veilige stand.
      const gebruiker = await tx.execute<{ user_id: string }>(
        sql`INSERT INTO clm."user" (tenant_id, full_name, email, koppelbaar_tot)
            VALUES (${tenantId}, ${invoer.adminNaam}, ${invoer.adminEmail},
                    now() + ${`${UITNODIGING_GELDIG_DAGEN} days`}::interval)
            RETURNING user_id`,
      );

      const userId = gebruiker.rows[0].user_id;

      await tx.execute(
        sql`INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
            VALUES (${userId}, ${tenantId}, 'admin')`,
      );

      await tx.execute(
        sql`INSERT INTO audit.audit_event
              (tenant_id, action_type, entity_type, entity_id, new_values)
            VALUES (${tenantId}, 'tenant_aangemaakt', 'tenant', ${tenantId},
                    ${JSON.stringify({
                      naam: invoer.naam,
                      eersteAdmin: invoer.adminEmail,
                    })}::jsonb)`,
      );

      const rij = await tx.execute<{ created_at: Date }>(
        sql`SELECT created_at FROM clm.tenant WHERE tenant_id = ${tenantId}`,
      );

      return {
        tenantId,
        naam: invoer.naam,
        aangemaaktOp: rij.rows[0].created_at,
        aantalLeden: 1,
      };
    });
  }

  /**
   * Kent de platformbeheerder tijdelijke support-toegang toe tot één tenant.
   *
   * Geen impersonatie: hij komt binnen als zichzelf, in de rol `support`, en
   * blijft daarmee in elk spoor te onderscheiden van een medewerker van de
   * klant. Dat is de eis uit Issue #57 en de reden dat 'support' bestaat.
   */
  async supportToegangGeven(
    tenantId: string,
    beheerderUserId: string,
    reden: string,
  ): Promise<SupportToegang> {
    return this.db.withTenant(tenantId, async (tx) => {
      // Een bestaande support-rij wordt vervangen, niet gedupliceerd: de
      // primaire sleutel is (user_id, tenant_id). Verlengen is hetzelfde als
      // opnieuw toekennen, met een nieuwe reden en een nieuwe einddatum.
      const rij = await tx.execute<{ verloopt_op: Date }>(
        sql`INSERT INTO clm.tenant_membership
              (user_id, tenant_id, role, verloopt_op, reden, toegekend_door)
            VALUES (${beheerderUserId}, ${tenantId}, 'support',
                    now() + ${`${SUPPORT_TOEGANG_UREN} hours`}::interval,
                    ${reden}, ${beheerderUserId})
            ON CONFLICT (user_id, tenant_id) DO UPDATE
              SET role = 'support',
                  verloopt_op = now() + ${`${SUPPORT_TOEGANG_UREN} hours`}::interval,
                  reden = ${reden},
                  deleted_at = NULL
            RETURNING verloopt_op`,
      );

      await tx.execute(
        sql`INSERT INTO audit.audit_event
              (tenant_id, action_type, entity_type, entity_id, new_values)
            VALUES (${tenantId}, 'support_toegang_toegekend', 'tenant_membership',
                    ${tenantId},
                    ${JSON.stringify({
                      beheerder: beheerderUserId,
                      reden,
                      urenGeldig: SUPPORT_TOEGANG_UREN,
                    })}::jsonb)`,
      );

      return { tenantId, verlooptOp: rij.rows[0].verloopt_op, reden };
    });
  }

  /**
   * Alle tenants, voor het beheerscherm.
   *
   * Deze query moet langs RLS heen kijken — een lijst van álle tenants is per
   * definitie tenant-overstijgend. Dat kan alleen omdat clm.tenant een
   * policy heeft op current_tenant_id(): zonder context levert hij niets op.
   * Vandaar de lus over de tenants die de beheerder mag zien, niet één query.
   *
   * Voor nu is dat één tenant per aanroep en dus onbruikbaar als overzicht.
   * De lijst komt in fase 3, samen met het scherm; hier staat alleen wat de
   * route vandaag nodig heeft.
   */
  async tenantLezen(tenantId: string): Promise<TenantOverzicht | null> {
    return this.db.withTenant(tenantId, async (tx) => {
      const { rows } = await tx.execute<{
        tenant_id: string;
        name: string;
        created_at: Date;
        leden: string;
      }>(
        sql`SELECT t.tenant_id, t.name, t.created_at,
                   (SELECT count(*) FROM clm.tenant_membership m
                     WHERE m.tenant_id = t.tenant_id AND m.deleted_at IS NULL) AS leden
              FROM clm.tenant t
             WHERE t.tenant_id = ${tenantId}`,
      );

      if (rows.length === 0) {
        return null;
      }

      return {
        tenantId: rows[0].tenant_id,
        naam: rows[0].name,
        aangemaaktOp: rows[0].created_at,
        aantalLeden: Number(rows[0].leden),
      };
    });
  }
}
