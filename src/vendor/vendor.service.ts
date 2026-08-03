import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

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

/** Een contactpersoon zoals het detailscherm hem toont. */
export interface Contactpersoon {
  contactId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  isPrimary: boolean;
}

/**
 * Een leverancier met alles wat het detailscherm nodig heeft.
 *
 * Ruimer dan `VendorSamenvatting`: de lijst toont vijf kolommen, het
 * detailscherm de stamgegevens plus de classificatie. Bewust twee vormen en
 * geen enkele brede — de lijst haalt 21 rijen op en heeft geen sbi-omschrijving
 * nodig.
 */
export interface VendorDetail {
  vendorId: string;
  name: string;
  kvkNumber: string | null;
  vestigingsnummer: string | null;
  statutoryName: string | null;
  city: string | null;
  country: string;
  website: string | null;
  categoryCode: string | null;
  businessCriticalityCode: string | null;
  complianceStatusCode: string | null;
  createdAt: string;
  updatedAt: string | null;
  contacten: Contactpersoon[];
}

/**
 * Wat er gewijzigd mag worden aan een leverancier.
 *
 * Elk veld is optioneel: een PATCH stuurt alleen wat verandert. `null` is een
 * betekenisvolle waarde (leegmaken), `undefined` betekent "niet aangeraakt" —
 * dat onderscheid is de reden dat dit geen `Partial<VendorDetail>` is.
 *
 * Bewust **niet** wijzigbaar: `risk_score`, `annual_spend_eur`,
 * `last_review_date` en `next_review_date`. Die horen uit een beoordeling of
 * uit een inkoopsysteem te komen; een handmatig ingevulde risicoscore botst
 * met een berekende zodra die er is. Besluit van de eigenaar, 2026-08-03.
 */
export interface VendorWijziging {
  name?: string;
  kvkNumber?: string | null;
  vestigingsnummer?: string | null;
  statutoryName?: string | null;
  city?: string | null;
  country?: string | null;
  website?: string | null;
  categoryCode?: string | null;
  businessCriticalityCode?: string | null;
  complianceStatusCode?: string | null;
}

/** Wat er nodig is om een contactpersoon toe te voegen of te wijzigen. */
export interface ContactInvoer {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  isPrimary?: boolean;
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

interface VendorDetailRij extends Record<string, unknown> {
  vendor_id: string;
  name: string;
  kvk_number: string | null;
  vestigingsnummer: string | null;
  statutory_name: string | null;
  city: string | null;
  country: string;
  website: string | null;
  category_code: string | null;
  business_criticality_code: string | null;
  compliance_status_code: string | null;
  created_at: Date | string;
  updated_at: Date | string | null;
}

interface ContactRij extends Record<string, unknown> {
  contact_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  is_primary: boolean;
}

function alsTekst(waarde: Date | string): string {
  return waarde instanceof Date ? waarde.toISOString() : waarde;
}

function alsTekstOfNull(waarde: Date | string | null): string | null {
  return waarde === null ? null : alsTekst(waarde);
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

  /**
   * Eén leverancier met zijn contactpersonen.
   *
   * Geeft `null` als hij niet bestaat, verwijderd is, óf bij een andere tenant
   * hoort. Die drie zijn hier bewust niet te onderscheiden: RLS filtert een
   * vreemde tenant al weg vóórdat deze query iets ziet, dus "bestaat niet" en
   * "niet van u" komen als hetzelfde binnen. Dat is precies goed — een
   * onderscheid zou verklappen dat een id elders wél bestaat.
   */
  async detail(
    tenantId: string,
    vendorId: string,
  ): Promise<VendorDetail | null> {
    return this.db.withTenant(tenantId, (tx) =>
      this.detailBinnenTransactie(tx, vendorId),
    );
  }

  /**
   * Wijzigt een leverancier. Alleen de meegestuurde velden.
   *
   * Geeft `null` wanneer de leverancier niet bestaat of niet van deze tenant
   * is — zelfde redenering als bij detail().
   *
   * De kolommen worden één voor één opgebouwd omdat `undefined` en `null`
   * verschillende dingen betekenen: niet meegestuurd blijft staan, expliciet
   * `null` maakt leeg. Een generieke "schrijf alles"-variant zou elk veld dat
   * het formulier niet kent stilzwijgend wissen.
   */
  async wijzig(
    tenantId: string,
    vendorId: string,
    wijziging: VendorWijziging,
  ): Promise<VendorDetail | null> {
    const kvk =
      wijziging.kvkNumber === undefined
        ? undefined
        : leegIsNull(wijziging.kvkNumber);

    return this.db.withTenant(tenantId, async (tx) => {
      const bestaat = await tx.execute<{ vendor_id: string }>(
        sql`SELECT vendor_id FROM clm.vendor
             WHERE vendor_id = ${vendorId} AND deleted_at IS NULL`,
      );

      if (bestaat.rows.length === 0) {
        return null;
      }

      // Zelfde controle als bij aanmaken, plus "en niet ikzelf": zonder die
      // uitzondering kan een leverancier zijn eigen KvK-nummer niet opnieuw
      // opslaan.
      if (kvk) {
        const botsing = await tx.execute<{ name: string }>(
          sql`SELECT name FROM clm.vendor
               WHERE kvk_number = ${kvk}
                 AND vendor_id <> ${vendorId}
                 AND deleted_at IS NULL
               LIMIT 1`,
        );

        if (botsing.rows.length > 0) {
          throw new ConflictException(
            `Er bestaat al een leverancier met KvK-nummer ${kvk}: ${botsing.rows[0].name}.`,
          );
        }
      }

      const zetten: SQL[] = [];

      if (wijziging.name !== undefined) {
        zetten.push(sql`name = ${wijziging.name.trim()}`);
      }
      if (kvk !== undefined) {
        zetten.push(sql`kvk_number = ${kvk}`);
      }
      if (wijziging.vestigingsnummer !== undefined) {
        zetten.push(
          sql`vestigingsnummer = ${leegIsNull(wijziging.vestigingsnummer)}`,
        );
      }
      if (wijziging.statutoryName !== undefined) {
        zetten.push(
          sql`statutory_name = ${leegIsNull(wijziging.statutoryName)}`,
        );
      }
      if (wijziging.city !== undefined) {
        zetten.push(sql`city = ${leegIsNull(wijziging.city)}`);
      }
      if (wijziging.country !== undefined) {
        zetten.push(sql`country = ${leegIsNull(wijziging.country) ?? 'NL'}`);
      }
      if (wijziging.website !== undefined) {
        zetten.push(sql`website = ${leegIsNull(wijziging.website)}`);
      }
      if (wijziging.categoryCode !== undefined) {
        zetten.push(sql`category_code = ${leegIsNull(wijziging.categoryCode)}`);
      }
      if (wijziging.businessCriticalityCode !== undefined) {
        zetten.push(
          sql`business_criticality_code = ${leegIsNull(wijziging.businessCriticalityCode)}`,
        );
      }
      if (wijziging.complianceStatusCode !== undefined) {
        zetten.push(
          sql`compliance_status_code = ${leegIsNull(wijziging.complianceStatusCode)}`,
        );
      }

      // Niets meegestuurd: geen UPDATE draaien, maar wel het detail teruggeven.
      // Een lege PATCH is geen fout — hij verandert alleen niets.
      if (zetten.length > 0) {
        zetten.push(sql`updated_at = now()`);

        await tx.execute(
          sql`UPDATE clm.vendor
                 SET ${sql.join(zetten, sql`, `)}
               WHERE vendor_id = ${vendorId}`,
        );

        this.logger.log(`Leverancier gewijzigd (${vendorId}).`);
      }

      return this.detailBinnenTransactie(tx, vendorId);
    });
  }

  /**
   * Verwijdert een leverancier — soft delete, conform §7.
   *
   * De contactpersonen gaan mee: ze horen bij deze leverancier en zonder hem
   * zijn ze betekenisloos. Bewust géén harde DELETE, want een leverancier kan
   * in een surveyronde voorkomen en die respons is bewijsmateriaal.
   */
  async verwijder(tenantId: string, vendorId: string): Promise<boolean> {
    return this.db.withTenant(tenantId, async (tx) => {
      const resultaat = await tx.execute<{ vendor_id: string }>(
        sql`UPDATE clm.vendor
               SET deleted_at = now()
             WHERE vendor_id = ${vendorId}
               AND deleted_at IS NULL
             RETURNING vendor_id`,
      );

      if (resultaat.rows.length === 0) {
        return false;
      }

      await tx.execute(
        sql`UPDATE clm.vendor_contact
               SET deleted_at = now()
             WHERE vendor_id = ${vendorId}
               AND deleted_at IS NULL`,
      );

      this.logger.log(`Leverancier verwijderd (${vendorId}).`);
      return true;
    });
  }

  // ── Contactpersonen ──────────────────────────────────────────────────────

  /**
   * Voegt een contactpersoon toe aan een bestaande leverancier.
   *
   * Wordt hij primair, dan verliezen de anderen die vlag — er is er hoogstens
   * één. Dat is geen databaseconstraint maar wel de bedoeling: bij het
   * versturen van een uitnodiging moet één adres de voor de hand liggende
   * keuze zijn.
   */
  async voegContactToe(
    tenantId: string,
    vendorId: string,
    invoer: ContactInvoer,
  ): Promise<Contactpersoon | null> {
    return this.db.withTenant(tenantId, async (tx) => {
      const bestaat = await tx.execute<{ vendor_id: string }>(
        sql`SELECT vendor_id FROM clm.vendor
             WHERE vendor_id = ${vendorId} AND deleted_at IS NULL`,
      );

      if (bestaat.rows.length === 0) {
        return null;
      }

      // Eerste contactpersoon wordt vanzelf primair: anders heeft een
      // leverancier contacten maar geen aanspreekpunt.
      const aantal = await tx.execute<{ n: string }>(
        sql`SELECT count(*) AS n FROM clm.vendor_contact
             WHERE vendor_id = ${vendorId} AND deleted_at IS NULL`,
      );

      const wordtPrimair =
        invoer.isPrimary === true || Number(aantal.rows[0].n) === 0;

      if (wordtPrimair) {
        await tx.execute(
          sql`UPDATE clm.vendor_contact
                 SET is_primary = false, updated_at = now()
               WHERE vendor_id = ${vendorId} AND is_primary = true`,
        );
      }

      const resultaat = await tx.execute<ContactRij>(
        sql`INSERT INTO clm.vendor_contact
                (vendor_id, tenant_id, full_name, email, phone, job_title,
                 is_primary)
            VALUES (${vendorId}, ${tenantId},
                    ${invoer.fullName!.trim()},
                    ${leegIsNull(invoer.email)},
                    ${leegIsNull(invoer.phone)},
                    ${leegIsNull(invoer.jobTitle)},
                    ${wordtPrimair})
            RETURNING contact_id, full_name, email, phone, job_title, is_primary`,
      );

      const c = resultaat.rows[0];
      this.logger.log(`Contactpersoon toegevoegd (${c.contact_id}).`);

      return {
        contactId: c.contact_id,
        fullName: c.full_name,
        email: c.email,
        phone: c.phone,
        jobTitle: c.job_title,
        isPrimary: c.is_primary,
      };
    });
  }

  /** Wijzigt een contactpersoon. Alleen de meegestuurde velden. */
  async wijzigContact(
    tenantId: string,
    vendorId: string,
    contactId: string,
    invoer: ContactInvoer,
  ): Promise<Contactpersoon | null> {
    return this.db.withTenant(tenantId, async (tx) => {
      const bestaat = await tx.execute<{ contact_id: string }>(
        sql`SELECT contact_id FROM clm.vendor_contact
             WHERE contact_id = ${contactId}
               AND vendor_id = ${vendorId}
               AND deleted_at IS NULL`,
      );

      if (bestaat.rows.length === 0) {
        return null;
      }

      if (invoer.isPrimary === true) {
        await tx.execute(
          sql`UPDATE clm.vendor_contact
                 SET is_primary = false, updated_at = now()
               WHERE vendor_id = ${vendorId}
                 AND contact_id <> ${contactId}
                 AND is_primary = true`,
        );
      }

      const zetten: SQL[] = [];

      if (invoer.fullName !== undefined) {
        zetten.push(sql`full_name = ${invoer.fullName.trim()}`);
      }
      if (invoer.email !== undefined) {
        zetten.push(sql`email = ${leegIsNull(invoer.email)}`);
      }
      if (invoer.phone !== undefined) {
        zetten.push(sql`phone = ${leegIsNull(invoer.phone)}`);
      }
      if (invoer.jobTitle !== undefined) {
        zetten.push(sql`job_title = ${leegIsNull(invoer.jobTitle)}`);
      }
      if (invoer.isPrimary !== undefined) {
        zetten.push(sql`is_primary = ${invoer.isPrimary}`);
      }

      if (zetten.length > 0) {
        zetten.push(sql`updated_at = now()`);

        await tx.execute(
          sql`UPDATE clm.vendor_contact
                 SET ${sql.join(zetten, sql`, `)}
               WHERE contact_id = ${contactId}`,
        );
      }

      const resultaat = await tx.execute<ContactRij>(
        sql`SELECT contact_id, full_name, email, phone, job_title, is_primary
              FROM clm.vendor_contact
             WHERE contact_id = ${contactId}`,
      );

      const c = resultaat.rows[0];

      return {
        contactId: c.contact_id,
        fullName: c.full_name,
        email: c.email,
        phone: c.phone,
        jobTitle: c.job_title,
        isPrimary: c.is_primary,
      };
    });
  }

  /**
   * Verwijdert een contactpersoon — soft delete.
   *
   * Was hij de primaire, dan wordt de eerstvolgende het. Zonder die stap houdt
   * een leverancier contacten over zonder aanspreekpunt, en dat valt pas op op
   * het moment dat er een uitnodiging verstuurd moet worden.
   */
  async verwijderContact(
    tenantId: string,
    vendorId: string,
    contactId: string,
  ): Promise<boolean> {
    return this.db.withTenant(tenantId, async (tx) => {
      const resultaat = await tx.execute<{ is_primary: boolean }>(
        sql`UPDATE clm.vendor_contact
               SET deleted_at = now()
             WHERE contact_id = ${contactId}
               AND vendor_id = ${vendorId}
               AND deleted_at IS NULL
             RETURNING is_primary`,
      );

      if (resultaat.rows.length === 0) {
        return false;
      }

      if (resultaat.rows[0].is_primary) {
        await tx.execute(
          sql`UPDATE clm.vendor_contact
                 SET is_primary = true, updated_at = now()
               WHERE contact_id = (
                 SELECT contact_id FROM clm.vendor_contact
                  WHERE vendor_id = ${vendorId} AND deleted_at IS NULL
                  ORDER BY created_at
                  LIMIT 1
               )`,
        );
      }

      this.logger.log(`Contactpersoon verwijderd (${contactId}).`);
      return true;
    });
  }

  /**
   * Detail ophalen binnen een lopende transactie.
   *
   * Nodig omdat wijzig() zijn resultaat moet teruggeven zonder de transactie
   * te verlaten: een tweede withTenant() zou een nieuwe verbinding pakken en
   * de zojuist geschreven rij mogelijk nog niet zien.
   */
  private async detailBinnenTransactie(
    tx: Parameters<Parameters<DatabaseService['withTenant']>[1]>[0],
    vendorId: string,
  ): Promise<VendorDetail | null> {
    const resultaat = await tx.execute<VendorDetailRij>(
      sql`SELECT vendor_id, name, kvk_number, vestigingsnummer,
                 statutory_name, city, country, website,
                 category_code, business_criticality_code,
                 compliance_status_code, created_at, updated_at
            FROM clm.vendor
           WHERE vendor_id = ${vendorId} AND deleted_at IS NULL`,
    );

    const rij = resultaat.rows[0];

    if (!rij) {
      return null;
    }

    const contacten = await tx.execute<ContactRij>(
      sql`SELECT contact_id, full_name, email, phone, job_title, is_primary
            FROM clm.vendor_contact
           WHERE vendor_id = ${vendorId} AND deleted_at IS NULL
           ORDER BY is_primary DESC, full_name`,
    );

    return {
      vendorId: rij.vendor_id,
      name: rij.name,
      kvkNumber: rij.kvk_number,
      vestigingsnummer: rij.vestigingsnummer,
      statutoryName: rij.statutory_name,
      city: rij.city,
      country: rij.country,
      website: rij.website,
      categoryCode: rij.category_code,
      businessCriticalityCode: rij.business_criticality_code,
      complianceStatusCode: rij.compliance_status_code,
      createdAt: alsTekst(rij.created_at),
      updatedAt: alsTekstOfNull(rij.updated_at),
      contacten: contacten.rows.map((c) => ({
        contactId: c.contact_id,
        fullName: c.full_name,
        email: c.email,
        phone: c.phone,
        jobTitle: c.job_title,
        isPrimary: c.is_primary,
      })),
    };
  }
}
