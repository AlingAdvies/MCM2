import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';

/**
 * Leveranciers lezen en aanmaken, altijd binnen één tenant.
 *
 * Dit is de eerste schrijfroute van de beheerkant, en daarmee het eerste
 * moment waarop de laag uit Issue #7 echt gebruikt wordt: de tenantId komt van
 * `TenantContextGuard`, die hem uit een geverifieerde sessie haalt. De service
 * kent geen andere manier om aan een tenant te komen — er is geen parameter en
 * geen standaardwaarde.
 *
 * Alles loopt via `withTenant()`. Zelfs als de tenantId hierboven ooit fout
 * zou zijn, filtert RLS in de database nog steeds op de ingestelde tenant; de
 * schade blijft dan beperkt tot "verkeerde tenant" en wordt nooit "alle
 * tenants".
 */

/** Een leverancier zoals de lijst hem toont. */
export interface VendorSamenvatting {
  vendorId: string;
  name: string;
  kvkNumber: string | null;
  city: string | null;
  country: string;
  website: string | null;
  /** Aantal actieve contactpersonen — genoeg om te zien of er iemand bekend is. */
  aantalContacten: number;
  createdAt: string;
}

/** Wat er nodig is om een leverancier aan te maken. */
export interface NieuweVendor {
  name: string;
  kvkNumber?: string | null;
  city?: string | null;
  country?: string | null;
  website?: string | null;
  contact?: {
    fullName: string;
    email?: string | null;
    phone?: string | null;
    jobTitle?: string | null;
  };
}

export interface AangemaakteVendor {
  vendorId: string;
  name: string;
  contactId: string | null;
}

// De index-signatuur is een eis van Drizzle's execute<T>.
interface VendorRij extends Record<string, unknown> {
  vendor_id: string;
  name: string;
  kvk_number: string | null;
  city: string | null;
  country: string;
  website: string | null;
  aantal_contacten: string;
  created_at: Date | string;
}

function alsTekst(waarde: Date | string): string {
  return waarde instanceof Date ? waarde.toISOString() : waarde;
}

/** Lege invoer telt als "niet opgegeven", niet als lege tekst. */
function leegIsNull(waarde: string | null | undefined): string | null {
  const geknipt = waarde?.trim();
  return geknipt ? geknipt : null;
}

@Injectable()
export class VendorService {
  private readonly logger = new Logger(VendorService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Alle actieve leveranciers van deze tenant, nieuwste eerst.
   *
   * `deleted_at IS NULL` staat hier en niet in de RLS-policy: migratie 0004
   * heeft dat filter bewust uit de policies gehaald, zodat "verwijderd" een
   * zaak van de applicatie blijft en niet van de isolatiegrens. Die twee door
   * elkaar halen maakt allebei moeilijker te doorgronden.
   */
  async lijst(tenantId: string): Promise<VendorSamenvatting[]> {
    return this.db.withTenant(tenantId, async (tx) => {
      const resultaat = await tx.execute<VendorRij>(
        sql`SELECT v.vendor_id,
                   v.name,
                   v.kvk_number,
                   v.city,
                   v.country,
                   v.website,
                   v.created_at,
                   (SELECT count(*)
                      FROM clm.vendor_contact c
                     WHERE c.vendor_id = v.vendor_id
                       AND c.deleted_at IS NULL) AS aantal_contacten
              FROM clm.vendor v
             WHERE v.deleted_at IS NULL
             ORDER BY v.created_at DESC`,
      );

      return resultaat.rows.map((r) => ({
        vendorId: r.vendor_id,
        name: r.name,
        kvkNumber: r.kvk_number,
        city: r.city,
        country: r.country,
        website: r.website,
        aantalContacten: Number(r.aantal_contacten),
        createdAt: alsTekst(r.created_at),
      }));
    });
  }

  /**
   * Maakt een leverancier aan, eventueel met één contactpersoon.
   *
   * Beide in dezelfde transactie: een leverancier die is aangemaakt terwijl
   * zijn contactpersoon sneuvelde, is erger dan geen leverancier. De invuller
   * ziet dan "gelukt" en mist iemand om de vragenlijst naartoe te sturen.
   *
   * `tenant_id` wordt expliciet meegegeven en komt uit de sessie, niet uit de
   * invoer. Er is geen veld waarmee een aanvrager een andere tenant zou kunnen
   * benoemen; de `WITH CHECK` op de policy zou zo'n poging bovendien weigeren.
   */
  async maakAan(
    tenantId: string,
    invoer: NieuweVendor,
  ): Promise<AangemaakteVendor> {
    return this.db.withTenant(tenantId, async (tx) => {
      const kvk = leegIsNull(invoer.kvkNumber);

      // Vooraf controleren geeft een bruikbare melding; de unieke index blijft
      // de echte garantie. Zonder deze controle krijgt de gebruiker een
      // databasefout te zien in plaats van "dit KvK-nummer bestaat al".
      if (kvk) {
        const bestaand = await tx.execute<{ name: string }>(
          sql`SELECT name FROM clm.vendor
               WHERE kvk_number = ${kvk} AND deleted_at IS NULL
               LIMIT 1`,
        );

        if (bestaand.rows.length > 0) {
          throw new ConflictException(
            `Er bestaat al een leverancier met KvK-nummer ${kvk}: ${bestaand.rows[0].name}.`,
          );
        }
      }

      const vendorResultaat = await tx.execute<{
        vendor_id: string;
        name: string;
      }>(
        sql`INSERT INTO clm.vendor (tenant_id, name, kvk_number, city, country, website)
            VALUES (${tenantId},
                    ${invoer.name.trim()},
                    ${kvk},
                    ${leegIsNull(invoer.city)},
                    ${leegIsNull(invoer.country) ?? 'NL'},
                    ${leegIsNull(invoer.website)})
            RETURNING vendor_id, name`,
      );

      const nieuweVendor = vendorResultaat.rows[0];
      let contactId: string | null = null;

      if (invoer.contact?.fullName?.trim()) {
        // is_primary op true: dit is de eerste contactpersoon, en een
        // leverancier zonder primair contact levert straks geen ontvanger op
        // voor de uitnodiging.
        const contactResultaat = await tx.execute<{ contact_id: string }>(
          sql`INSERT INTO clm.vendor_contact
                (vendor_id, tenant_id, full_name, email, phone, job_title, is_primary)
              VALUES (${nieuweVendor.vendor_id},
                      ${tenantId},
                      ${invoer.contact.fullName.trim()},
                      ${leegIsNull(invoer.contact.email)},
                      ${leegIsNull(invoer.contact.phone)},
                      ${leegIsNull(invoer.contact.jobTitle)},
                      true)
              RETURNING contact_id`,
        );

        contactId = contactResultaat.rows[0].contact_id;
      }

      this.logger.log(
        `Leverancier aangemaakt (${nieuweVendor.vendor_id})${contactId ? ' met contactpersoon' : ''}.`,
      );

      return {
        vendorId: nieuweVendor.vendor_id,
        name: nieuweVendor.name,
        contactId,
      };
    });
  }
}
