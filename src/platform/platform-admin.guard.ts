import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { RequestMetSessie } from '../auth/tenant-context.guard';
import { DatabaseService } from '../db/database.service';

/**
 * Bewaakt de platformroutes: alleen wie in `clm.platform_admin` staat mag hier
 * langs (migratie 0020, ADR-015).
 *
 * ── Waarom náást TenantContextGuard en niet erin ─────────────────────────────
 *
 * Dezelfde reden als bij RolGuard: die guard stelt vast wíé er is en bij welke
 * tenant. Wat iemand mag is een aparte vraag. Hier komt er een derde bij —
 * mag deze persoon iets doen dat *buiten* elke tenant staat — en dat hoort al
 * helemaal niet vermengd te raken met het vaststellen van de tenantcontext.
 *
 * De volgorde is dus: TenantContextGuard stelt de sessie vast, deze guard
 * kijkt of die gebruiker platformbeheerder is.
 *
 * ── Waarom de vraag naar de database gaat en niet naar de sessie ─────────────
 *
 * Platformbeheerder-zijn staat niet in het sessiecookie en hoort daar ook niet.
 * Een sessie leeft acht uur; het intrekken van platformbeheer moet direct
 * werken, niet pas bij de volgende login. Eén indexlookup op de primaire
 * sleutel per platformverzoek is die zekerheid ruimschoots waard — en het gaat
 * om een handvol routes, niet om de hele applicatie.
 *
 * ── Waarom withTenant() ondanks dat de tabel buiten RLS staat ────────────────
 *
 * `clm.platform_admin` heeft geen tenant_id en dus geen RLS-policy. De query
 * zou zonder tenantcontext werken. Toch loopt hij via withTenant(), omdat
 * DatabaseService de enige weg naar de database is (ADR-008): een tweede,
 * contextloze weg openen zou precies de uitzondering zijn waarvan dit ontwerp
 * juist wilde afzien. De tenant van de sessie is hier verder betekenisloos.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestMetSessie>();
    const sessie = request.sessie;

    // Geen sessie betekent dat TenantContextGuard niet gedraaid heeft — een
    // programmeerfout. Weigeren, niet doorlaten: een guard die bij twijfel
    // toestaat is geen guard.
    if (!sessie) {
      throw new ForbiddenException('Geen sessie.');
    }

    const isBeheerder = await this.db.withTenant(
      sessie.tenantId,
      async (tx) => {
        const { rows } = await tx.execute<{ bestaat: boolean }>(
          sql`SELECT true AS bestaat
                FROM clm.platform_admin
               WHERE user_id = ${sessie.userId}
                 AND deleted_at IS NULL`,
        );

        return rows.length > 0;
      },
    );

    if (!isBeheerder) {
      // 403 en niet 404: de gebruiker is geverifieerd en weet dat deze route
      // bestaat. Verbergen zou hem laten zoeken naar een probleem dat er niet
      // is. Zelfde afweging als in RolGuard.
      throw new ForbiddenException(
        'Deze handeling is voorbehouden aan het platformbeheer.',
      );
    }

    return true;
  }
}
