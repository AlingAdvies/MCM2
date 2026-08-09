import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';

/**
 * De instellingen van de eigen tenant.
 *
 * ── Waarom dit een eigen module is en niet bij platform hoort ────────────────
 *
 * `PlatformService` doet dingen áán een tenant, van buitenaf, als
 * platformbeheerder. Deze service doet dingen *binnen* de eigen tenant, als
 * beheerder van die tenant. Het verschil is niet cosmetisch:
 *
 *   PlatformController   tenant komt uit de invoer  → PlatformAdminGuard
 *   TenantController     tenant komt uit de sessie  → de gewone regel (§6)
 *
 * Ze in één controller stoppen zou betekenen dat de uitzondering en de regel
 * naast elkaar wonen, en dan is één vergeten guard genoeg om de tenantgrens
 * te openen.
 *
 * ── Opgezet op uitbreiding ──────────────────────────────────────────────────
 *
 * Vandaag staat hier één veld: het antwoordadres (migratie 0025). De vorm is
 * bewust die van een gedeeltelijke wijziging — `TenantWijziging` met optionele
 * velden, en een UPDATE die alleen aanraakt wat is meegegeven. Een tweede veld
 * (tenantnaam, later de instellingen uit #75/#76) past er dan bij zonder dat
 * deze opzet op de schop hoeft.
 *
 * Wat er nog niet is en bewust nog niet: de tenantnaam. Die staat in elke
 * leveranciersmail, en wijzigen raakt dus wat leveranciers zien. Bovendien
 * geeft de unieke index een 409 bij een botsing. Doenlijk, maar een eigen
 * afweging — zie de openstaande punten in de PR.
 */

export interface TenantInstellingen {
  readonly tenantId: string;
  readonly naam: string;
  /** Waar een antwoord van een leverancier heen gaat. `null` = niet ingesteld. */
  readonly antwoordEmail: string | null;
}

/**
 * Wat een beheerder mag wijzigen.
 *
 * Elk veld optioneel: wie alleen het antwoordadres aanpast, hoort de rest niet
 * te hoeven meesturen. `null` is een geldige waarde en betekent "wissen" —
 * onderscheiden van `undefined`, dat "niet aanraken" betekent.
 */
export interface TenantWijziging {
  readonly antwoordEmail?: string | null;
}

@Injectable()
export class TenantService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * De instellingen van de eigen tenant.
   *
   * Geen tenantId-parameter uit de invoer: die komt van de aanroeper, die hem
   * uit de sessie haalt. RLS zou een vreemde tenant sowieso verbergen, maar de
   * vorm van deze methode maakt het al onmogelijk om er een andere te vragen.
   */
  async lezen(tenantId: string): Promise<TenantInstellingen> {
    return this.db.withTenant(tenantId, async (tx) => {
      const { rows } = await tx.execute<{
        tenant_id: string;
        name: string;
        antwoord_email: string | null;
      }>(
        sql`SELECT tenant_id, name, antwoord_email
              FROM clm.tenant
             WHERE tenant_id = ${tenantId}`,
      );

      // Nul rijen kan hier eigenlijk niet — de sessie verwijst naar deze
      // tenant, dus hij bestaat. Toch afvangen: een lege lijst stil doorgeven
      // als lege instellingen zou een verwijderde tenant laten lijken op een
      // tenant zonder antwoordadres.
      if (rows.length === 0) {
        throw new NotFoundException('Deze omgeving bestaat niet meer.');
      }

      return {
        tenantId: rows[0].tenant_id,
        naam: rows[0].name,
        antwoordEmail: rows[0].antwoord_email,
      };
    });
  }

  /**
   * Wijzigt de instellingen en geeft de nieuwe stand terug.
   *
   * Teruggeven en niet alleen bevestigen: het scherm hoort te tonen wat er nu
   * werkelijk staat, niet wat het opstuurde. Dat scheelt een tweede aanroep en
   * maakt zichtbaar wanneer de database iets anders bewaarde dan verwacht —
   * bijvoorbeeld een adres met witruimte eromheen.
   */
  async wijzigen(
    tenantId: string,
    wijziging: TenantWijziging,
  ): Promise<TenantInstellingen> {
    // Niets meegegeven is geen fout maar een no-op: de huidige stand
    // teruggeven is precies wat de aanroeper dan wil weten.
    if (wijziging.antwoordEmail === undefined) {
      return this.lezen(tenantId);
    }

    return this.db.withTenant(tenantId, async (tx) => {
      const { rows } = await tx.execute<{
        tenant_id: string;
        name: string;
        antwoord_email: string | null;
      }>(
        sql`UPDATE clm.tenant
               SET antwoord_email = ${wijziging.antwoordEmail}
             WHERE tenant_id = ${tenantId}
         RETURNING tenant_id, name, antwoord_email`,
      );

      if (rows.length === 0) {
        throw new NotFoundException('Deze omgeving bestaat niet meer.');
      }

      // Het antwoordadres bepaalt waar vragen van leveranciers heen gaan.
      // Wie het wijzigt verlegt dus de post van een hele organisatie, en dat
      // hoort navolgbaar te zijn (§7.7).
      await tx.execute(
        sql`INSERT INTO audit.audit_event
              (tenant_id, action_type, entity_type, entity_id, new_values)
            VALUES (${tenantId}, 'tenant_instellingen_gewijzigd', 'tenant',
                    ${tenantId},
                    ${JSON.stringify({
                      antwoordEmail: wijziging.antwoordEmail,
                    })}::jsonb)`,
      );

      return {
        tenantId: rows[0].tenant_id,
        naam: rows[0].name,
        antwoordEmail: rows[0].antwoord_email,
      };
    });
  }
}
