import { ConflictException, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import {
  genereerUitnodigingstoken,
  hashUitnodigingstoken,
} from '../auth/uitnodigingstoken';
import {
  DatabaseService,
  type TenantTransaction,
} from '../db/database.service';
import { UitnodigingVerzender } from '../mail/uitnodiging-verzender.service';

/** Hoe lang een tenant-uitnodiging geldig blijft — zelfde als de
 * platformbeheerder-uitnodiging (PlatformService). */
const UITNODIGING_GELDIGHEID_UREN = 7 * 24;

export interface TenantLid {
  userId: string;
  naam: string;
  email: string;
  rol: string;
  status: 'actief' | 'uitnodiging_open' | 'ingetrokken';
  sinds: Date;
}

export interface NieuwLidResultaat {
  userId: string;
  rol: string;
  uitnodigingslink: string;
  mailVerstuurd: boolean;
  mailEchtVerstuurd: boolean;
  mailFout?: string;
}

/**
 * Wie er in de eigen tenant mag werken, en met welke rol (issue #75).
 *
 * Hergebruikt het bestaande uitnodigingstoken-mechanisme
 * (`src/auth/uitnodigingstoken.ts`, migratie 0024) — hetzelfde patroon als
 * `PlatformController.tenantAanmaken()`, maar dan binnen een bestaande
 * tenant in plaats van een nieuwe.
 *
 * Geen surrogaatsleutel op `tenant_membership`: bij het opnieuw uitnodigen
 * van een ingetrokken lid wordt de bestaande rij bijgewerkt, niet vervangen.
 * Zie docs/superpowers/specs/2026-08-27-tenant-gebruikersbeheer-design.md §7
 * voor de reden (botst anders met `PlatformService.supportToegangGeven()`,
 * die leunt op de bestaande primary key `(user_id, tenant_id)`).
 */
@Injectable()
export class TenantLedenService {
  constructor(
    private readonly db: DatabaseService,
    private readonly uitnodigingen: UitnodigingVerzender,
  ) {}

  async lijst(tenantId: string): Promise<TenantLid[]> {
    return this.db.withTenant(tenantId, async (tx) => {
      const { rows } = await tx.execute<{
        user_id: string;
        full_name: string;
        email: string;
        role: string;
        deleted_at: string | null;
        uitnodiging_hash: string | null;
        created_at: string;
      }>(
        sql`SELECT u.user_id, u.full_name, u.email, m.role,
                   m.deleted_at, u.uitnodiging_hash, m.created_at
              FROM clm.tenant_membership m
              JOIN clm."user" u ON u.user_id = m.user_id
             WHERE m.tenant_id = ${tenantId}
               AND m.role <> 'support'
             ORDER BY u.full_name`,
      );

      return rows.map((r) => ({
        userId: r.user_id,
        naam: r.full_name,
        email: r.email,
        rol: r.role,
        status:
          r.deleted_at !== null
            ? ('ingetrokken' as const)
            : r.uitnodiging_hash !== null
              ? ('uitnodiging_open' as const)
              : ('actief' as const),
        sinds: new Date(r.created_at),
      }));
    });
  }

  async uitnodigen(
    tenantId: string,
    invoer: { email: string; rol: string },
  ): Promise<NieuwLidResultaat> {
    const token = genereerUitnodigingstoken();
    const tokenHash = hashUitnodigingstoken(token);
    const verlooptOp = new Date(
      Date.now() + UITNODIGING_GELDIGHEID_UREN * 60 * 60 * 1000,
    );

    const aangemaakt = await this.db.withTenant(tenantId, async (tx) => {
      // Bestaat er al een user-rij met dit e-mailadres bínnen deze tenant?
      //
      // Bewust geen check op een andere tenant: RLS beperkt elke query in
      // deze transactie tot tenantId (ADR-008, geen BYPASSRLS), dus een
      // gebruiker van een andere tenant is hier principieel onzichtbaar.
      // PlatformController.tenantAanmaken() doet om dezelfde reden ook geen
      // cross-tenant e-mailcontrole — dat zou een aparte, tenant-overstijgende
      // SECURITY DEFINER-functie vragen (zoals sessie_aanmaken()), en de
      // eigenaar heeft besloten dat niet te bouwen voor dit issue (27-08):
      // hetzelfde e-mailadres kan los bij meerdere tenants terechtkomen, wat
      // verwarrend kan zijn maar geen beveiligingslek is — de tenant-
      // isolatie zelf blijft intact.
      const bestaand = await tx.execute<{
        user_id: string;
        actieve_membership: boolean;
        ingetrokken_membership: boolean;
      }>(
        sql`SELECT u.user_id,
                   EXISTS (
                     SELECT 1 FROM clm.tenant_membership m2
                      WHERE m2.user_id = u.user_id
                        AND m2.tenant_id = ${tenantId}
                        AND m2.deleted_at IS NULL
                        AND m2.role <> 'support'
                   ) AS actieve_membership,
                   EXISTS (
                     SELECT 1 FROM clm.tenant_membership m3
                      WHERE m3.user_id = u.user_id
                        AND m3.tenant_id = ${tenantId}
                        AND m3.deleted_at IS NOT NULL
                   ) AS ingetrokken_membership
              FROM clm."user" u
             WHERE u.email = ${invoer.email}
               AND u.deleted_at IS NULL`,
      );

      const tenantRij = await tx.execute<{ name: string }>(
        sql`SELECT name FROM clm.tenant WHERE tenant_id = ${tenantId}`,
      );
      const tenantNaam = tenantRij.rows[0]?.name ?? tenantId;

      if (bestaand.rows.length > 0) {
        const rij = bestaand.rows[0];

        if (rij.actieve_membership) {
          throw new ConflictException(
            'Dit e-mailadres heeft al toegang tot deze tenant.',
          );
        }

        if (rij.ingetrokken_membership) {
          // Geval 2 (spec §5a): bestaande, ingetrokken rij hergebruiken.
          // Geen nieuwe rij — zie spec §7 voor de reden.
          await tx.execute(
            sql`UPDATE clm.tenant_membership
                   SET role = ${invoer.rol}, deleted_at = NULL
                 WHERE user_id = ${rij.user_id} AND tenant_id = ${tenantId}`,
          );
          await tx.execute(
            sql`UPDATE clm."user"
                   SET uitnodiging_hash = ${tokenHash},
                       koppelbaar_tot = ${verlooptOp.toISOString()}
                 WHERE user_id = ${rij.user_id}`,
          );

          return { userId: rij.user_id, tenantNaam };
        }

        // Geval 3: de user-rij bestaat, maar heeft nooit een membership bij
        // déze tenant gehad. Nieuwe membership-rij voor deze tenant.
        await tx.execute(
          sql`INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
              VALUES (${rij.user_id}, ${tenantId}, ${invoer.rol})`,
        );
        await tx.execute(
          sql`UPDATE clm."user"
                 SET uitnodiging_hash = ${tokenHash},
                     koppelbaar_tot = ${verlooptOp.toISOString()}
               WHERE user_id = ${rij.user_id}`,
        );

        return { userId: rij.user_id, tenantNaam };
      }

      // Geval 1: geheel nieuw e-mailadres.
      const nieuw = await tx.execute<{ user_id: string }>(
        sql`INSERT INTO clm."user"
              (tenant_id, full_name, email, uitnodiging_hash, koppelbaar_tot)
            VALUES (${tenantId}, ${invoer.email}, ${invoer.email},
                    ${tokenHash}, ${verlooptOp.toISOString()})
            RETURNING user_id`,
      );
      const userId = nieuw.rows[0].user_id;

      await tx.execute(
        sql`INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
            VALUES (${userId}, ${tenantId}, ${invoer.rol})`,
      );

      return { userId, tenantNaam };
    });

    // Versturen ná de transactie, nooit erin — zelfde volgorde en zelfde
    // reden als PlatformController.tenantAanmaken: een verstuurde mail is
    // niet terug te draaien.
    const link = this.uitnodigingsLink(token);
    const verzending = await this.uitnodigingen.verstuurAanTenantLid({
      ontvanger: invoer.email,
      tenantNaam: aangemaakt.tenantNaam,
      rol: invoer.rol,
      link,
      verlooptOp: verlooptOp.toISOString(),
    });

    return {
      userId: aangemaakt.userId,
      rol: invoer.rol,
      uitnodigingslink: link,
      mailVerstuurd: verzending.verstuurd,
      mailEchtVerstuurd: verzending.echtVerstuurd,
      mailFout: verzending.fout,
    };
  }

  async rolWijzigen(
    tenantId: string,
    userId: string,
    nieuweRol: string,
  ): Promise<void> {
    return this.db.withTenant(tenantId, async (tx) => {
      if (nieuweRol !== 'admin') {
        await this.weigerAlsLaatsteAdmin(tx, tenantId, userId);
      }

      await tx.execute(
        sql`UPDATE clm.tenant_membership
               SET role = ${nieuweRol}
             WHERE user_id = ${userId} AND tenant_id = ${tenantId}
               AND deleted_at IS NULL`,
      );
    });
  }

  async intrekken(tenantId: string, userId: string): Promise<void> {
    return this.db.withTenant(tenantId, async (tx) => {
      await this.weigerAlsLaatsteAdmin(tx, tenantId, userId);

      await tx.execute(
        sql`UPDATE clm.tenant_membership
               SET deleted_at = now()
             WHERE user_id = ${userId} AND tenant_id = ${tenantId}
               AND deleted_at IS NULL`,
      );
    });
  }

  /** Gooit ConflictException als het wijzigen/intrekken van `userId` de
   * tenant zonder actieve admin zou achterlaten. */
  private async weigerAlsLaatsteAdmin(
    tx: TenantTransaction,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const dezeIsAdmin = await tx.execute<{ role: string }>(
      sql`SELECT role FROM clm.tenant_membership
           WHERE user_id = ${userId} AND tenant_id = ${tenantId}
             AND deleted_at IS NULL`,
    );

    if (dezeIsAdmin.rows[0]?.role !== 'admin') {
      return;
    }

    const { rows } = await tx.execute<{ aantal: string }>(
      sql`SELECT count(*) AS aantal
            FROM clm.tenant_membership
           WHERE tenant_id = ${tenantId}
             AND role = 'admin'
             AND deleted_at IS NULL
             AND user_id <> ${userId}`,
    );

    if (Number(rows[0].aantal) === 0) {
      throw new ConflictException(
        'Dit is de enige beheerder van deze tenant. Wijs eerst een andere beheerder aan.',
      );
    }
  }

  private uitnodigingsLink(token: string): string {
    const basis = process.env.APP_BASE_URL ?? 'http://localhost:3000';
    return `${basis}/api/backend/auth/login?uitnodiging=${encodeURIComponent(token)}`;
  }
}
