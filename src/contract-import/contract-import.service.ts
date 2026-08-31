import { createHash } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';
import type { TenantTransaction } from '../db/database.service';
import { ContractImportAuditService } from './contract-import-audit.service';
import {
  beoordeelContractImportbestand,
  type ContractImportBeoordeling,
  type ContractImportInvoer,
} from './contract-import-schema';

/**
 * Contract-import: preview + bevestigen, met find-or-create op vendor en
 * vendor_contact (#198).
 *
 * ── Waarom hier eigen, kleine INSERT's staan i.p.v. VendorService/ContractService
 * aan te roepen ────────────────────────────────────────────────────────────────
 * Beide services openen zelf een `withTenant()`-transactie. De import wil één
 * transactie voor de hele CSV (besluit eigenaar, 2026-08-31: eenvoud en een
 * harde alles-of-niets-garantie wegen zwaarder dan hergebruik hier). Die twee
 * eisen zijn niet te combineren zonder de bestaande services te herstructureren
 * — en dat is bewust NIET gedaan (besluit eigenaar, 2026-08-31: "niet te ver
 * gaan", geen wijziging aan bestaande, geteste services voor deze import).
 *
 * De INSERT's hieronder zijn daarom kleine, letterlijke echo's van wat
 * `VendorService.maakAan()` (kolommen: tenant_id, name, category_code,
 * coupa_supplier_number) en het contactpersoon-blok in `vendor.service.ts`
 * doen — alleen smaller, want deze import vult geen KvK, land, website etc.
 * Wijzigt een van die twee services zijn kolommen, dan moet dit bestand
 * meebewegen; er is geen andere koppeling tussen de twee.
 */

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function leegIsNull(waarde: string | null | undefined): string | null {
  if (waarde === null || waarde === undefined) return null;
  const getrimd = waarde.trim();
  return getrimd === '' ? null : getrimd;
}

/**
 * Zet vrije tekst ('ICT', 'Vastgoed & Facility Management') om naar een
 * code-vorm die aansluit bij de bestaande, handmatig aangemaakte
 * categorieën ('it_services', 'facilities'): kleine letters,
 * spaties/leestekens naar underscore, geen dubbele/rand-underscores.
 * Niet uniek gegarandeerd tussen twee verschillende teksten die toevallig
 * tot dezelfde slug normaliseren — de primary key (tenant_id, code) vangt
 * dat af door de bestaande rij te hergebruiken in plaats van te dupliceren.
 */
function naarCategorieCode(tekst: string): string {
  return tekst
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diakritische tekens (é, ë, ...)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export interface PreviewResultaat {
  jobId: string;
  beoordeling: ContractImportBeoordeling;
}

export interface BevestigResultaat {
  jobId: string;
  aangemaakteContracten: number;
  aangemaakteVendors: number;
  hergebruikteVendors: number;
  aangemaakteContacten: number;
  hergebruikteContacten: number;
  aangemaakteCategorieen: number;
  extraContactenGevonden: number;
  overgeslagen: number;
  rijen: {
    regel: number;
    result: 'created' | 'skipped';
    contractId: string | null;
    vendorAangemaakt: boolean;
    vendorAfwijkt: boolean;
    contactAangemaakt: boolean;
    categorieAangemaakt: boolean;
    extraContacten: number;
    bevindingen: string[];
  }[];
}

interface ImportRowRij extends Record<string, unknown> {
  row_id: string;
  row_number: number;
  normalized_data: ContractImportInvoer;
  importable: boolean;
  findings: { code: string; melding: string; blokkerend: boolean }[];
}

@Injectable()
export class ContractImportService {
  private readonly logger = new Logger(ContractImportService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: ContractImportAuditService,
  ) {}

  /**
   * Beoordeelt een CSV-bestand en legt het resultaat vast als `import_job`
   * (status 'preview') met een `import_row` per brondrij. Schrijft nog geen
   * enkel contract, vendor of contactpersoon weg.
   */
  async preview(
    tenantId: string,
    userId: string,
    bestand: { originalname: string; buffer: Buffer },
  ): Promise<PreviewResultaat> {
    const tekst = bestand.buffer.toString('utf8');
    const beoordeling = beoordeelContractImportbestand(tekst);

    const fileHash = this.berekenHash(bestand.buffer);

    const jobId = await this.db.withTenant(tenantId, async (tx) => {
      const jobResultaat = await tx.execute<{ job_id: string }>(
        sql`INSERT INTO clm.import_job
              (tenant_id, import_type, created_by_user_id, filename,
               file_hash, row_count, status)
            VALUES (${tenantId}, 'contract', ${userId},
                    ${bestand.originalname}, ${fileHash},
                    ${beoordeling.rijen.length}, 'preview')
            RETURNING job_id`,
      );

      const job = jobResultaat.rows[0].job_id;

      for (const rij of beoordeling.rijen) {
        const rowResultaat = await tx.execute<{ row_id: string }>(
          sql`INSERT INTO clm.import_row
                (tenant_id, job_id, row_number, raw_data, normalized_data,
                 findings, importable)
              VALUES (${tenantId}, ${job}, ${rij.regel},
                      ${JSON.stringify(rij.invoer.rawAttributes)}::jsonb,
                      ${JSON.stringify(rij.invoer)}::jsonb,
                      ${JSON.stringify(rij.bevindingen)}::jsonb,
                      ${rij.importeerbaar})
              RETURNING row_id`,
        );

        const rowId = rowResultaat.rows[0].row_id;

        // Extra contactgegevens (email_2, full_name_2, ...) meteen bij de
        // preview vastleggen — dit is een hulplijst, geen find-or-create,
        // dus er is niets om pas bij bevestigen te doen (design-document §10.3).
        for (const extra of rij.invoer.extraContacten) {
          await tx.execute(
            sql`INSERT INTO clm.import_extra_contact
                  (tenant_id, row_id, volgnummer, email, full_name)
                VALUES (${tenantId}, ${rowId}, ${extra.volgnummer},
                        ${extra.email}, ${extra.fullName})`,
          );
        }
      }

      return job;
    });

    this.logger.log(
      `Contract-importpreview aangemaakt (${jobId}): ${beoordeling.samenvatting.totaal} rijen, ${beoordeling.samenvatting.importeerbaar} importeerbaar.`,
    );

    return { jobId, beoordeling };
  }

  /**
   * Schrijft de importeerbare rijen van een preview-job definitief weg, in
   * één transactie voor de hele job (besluit eigenaar: eenvoud en een harde
   * alles-of-niets-garantie, geen batches). Een job kan maar één keer
   * bevestigd worden.
   */
  async bevestigen(
    tenantId: string,
    jobId: string,
  ): Promise<BevestigResultaat> {
    if (!UUID_REGEX.test(jobId)) {
      throw new NotFoundException('Onbekende import-job.');
    }

    return this.db.withTenant(tenantId, async (tx) => {
      const jobResultaat = await tx.execute<{
        job_id: string;
        status: string;
      }>(
        sql`SELECT job_id, status FROM clm.import_job WHERE job_id = ${jobId}`,
      );

      if (jobResultaat.rows.length === 0) {
        throw new NotFoundException('Onbekende import-job.');
      }

      if (jobResultaat.rows[0].status === 'bevestigd') {
        throw new ConflictException(
          'Deze import is al eerder bevestigd. Start een nieuwe import.',
        );
      }

      const rijenResultaat = await tx.execute<ImportRowRij>(
        sql`SELECT row_id, row_number, normalized_data, importable, findings
              FROM clm.import_row
             WHERE job_id = ${jobId}
             ORDER BY row_number`,
      );

      let aangemaakteContracten = 0;
      let aangemaakteVendors = 0;
      let hergebruikteVendors = 0;
      let aangemaakteContacten = 0;
      let hergebruikteContacten = 0;
      let aangemaakteCategorieen = 0;
      let extraContactenGevonden = 0;
      let overgeslagen = 0;

      const rijResultaten: BevestigResultaat['rijen'] = [];

      for (const rij of rijenResultaat.rows) {
        const invoer = rij.normalized_data;
        extraContactenGevonden += invoer.extraContacten.length;

        if (!rij.importable) {
          overgeslagen++;
          await tx.execute(
            sql`UPDATE clm.import_row SET result = 'skipped' WHERE row_id = ${rij.row_id}`,
          );
          rijResultaten.push({
            regel: rij.row_number,
            result: 'skipped',
            contractId: null,
            vendorAangemaakt: false,
            vendorAfwijkt: false,
            contactAangemaakt: false,
            categorieAangemaakt: false,
            extraContacten: invoer.extraContacten.length,
            bevindingen: rij.findings.map((f) => f.melding),
          });
          continue;
        }

        const vendorUitkomst = await this.vindOfMaakVendor(
          tx,
          tenantId,
          invoer,
        );
        if (vendorUitkomst.aangemaakt) aangemaakteVendors++;
        else hergebruikteVendors++;
        if (vendorUitkomst.categorieAangemaakt) aangemaakteCategorieen++;

        let contactId: string | null = null;
        let contactAangemaakt = false;

        if (
          leegIsNull(invoer.contactEmail) ||
          leegIsNull(invoer.contactFullName)
        ) {
          const contactUitkomst = await this.vindOfMaakContact(
            tx,
            tenantId,
            vendorUitkomst.vendorId,
            invoer,
          );
          contactId = contactUitkomst.contactId;
          contactAangemaakt = contactUitkomst.aangemaakt;
          if (contactAangemaakt) aangemaakteContacten++;
          else hergebruikteContacten++;
        }

        const contractResultaat = await tx.execute<{ contract_id: string }>(
          sql`INSERT INTO clm.contract
                (tenant_id, vendor_id, name, contract_number, contract_type,
                 start_date, end_date, note, vendor_contact_id,
                 business_risk_tier_code)
              VALUES (${tenantId}, ${vendorUitkomst.vendorId},
                      ${invoer.contractName.trim()},
                      ${leegIsNull(invoer.contractNumber)},
                      ${leegIsNull(invoer.contractType)},
                      ${leegIsNull(invoer.startDate)},
                      ${leegIsNull(invoer.endDate)},
                      ${leegIsNull(invoer.note)},
                      ${contactId},
                      ${leegIsNull(invoer.contractBusinessRiskTierCode)})
              RETURNING contract_id`,
        );

        const contractId = contractResultaat.rows[0].contract_id;
        aangemaakteContracten++;

        await tx.execute(
          sql`UPDATE clm.import_row
                 SET result = 'created',
                     created_contract_id = ${contractId},
                     created_vendor_id = ${vendorUitkomst.aangemaakt ? vendorUitkomst.vendorId : null},
                     matched_vendor_id = ${vendorUitkomst.aangemaakt ? null : vendorUitkomst.vendorId},
                     created_contact_id = ${contactAangemaakt ? contactId : null},
                     matched_contact_id = ${contactId && !contactAangemaakt ? contactId : null}
               WHERE row_id = ${rij.row_id}`,
        );

        rijResultaten.push({
          regel: rij.row_number,
          result: 'created',
          contractId,
          vendorAangemaakt: vendorUitkomst.aangemaakt,
          vendorAfwijkt: vendorUitkomst.afwijkt,
          contactAangemaakt,
          categorieAangemaakt: vendorUitkomst.categorieAangemaakt,
          extraContacten: invoer.extraContacten.length,
          bevindingen: rij.findings.map((f) => f.melding),
        });
      }

      await tx.execute(
        sql`UPDATE clm.import_job
               SET status = 'bevestigd', confirmed_at = now()
             WHERE job_id = ${jobId}`,
      );

      await this.audit.leg(tx, {
        tenantId,
        actie: 'contract_import_bevestigd',
        jobId,
        details: {
          aangemaakteContracten,
          aangemaakteVendors,
          hergebruikteVendors,
          aangemaakteContacten,
          hergebruikteContacten,
          aangemaakteCategorieen,
          extraContactenGevonden,
          overgeslagen,
        },
      });

      this.logger.log(
        `Contract-import bevestigd (${jobId}): ${aangemaakteContracten} contracten, ${aangemaakteVendors} nieuwe/${hergebruikteVendors} bestaande leveranciers, ${aangemaakteCategorieen} nieuwe categorieën, ${extraContactenGevonden} extra contactgegevens gevonden.`,
      );

      return {
        jobId,
        aangemaakteContracten,
        aangemaakteVendors,
        hergebruikteVendors,
        aangemaakteContacten,
        hergebruikteContacten,
        aangemaakteCategorieen,
        extraContactenGevonden,
        overgeslagen,
        rijen: rijResultaten,
      };
    });
  }

  /**
   * Vindt een vendor op `coupa_supplier_number` binnen de tenant, of maakt er
   * een aan. Werkt bewust nooit bij: een gematchte vendor met afwijkende
   * `name`/`category_code` in de CSV blijft in de database ongewijzigd
   * (besluit eigenaar, create_only). Deze functie berekent geen
   * `vendor_afwijkt`-waarschuwing (dat vraagt een vergelijking die niet in
   * het resultaat van `bevestigen()` wordt teruggegeven in deze eenvoudige
   * v1) — zie het design-document §11 voor deze bewuste beperking.
   */
  private async vindOfMaakVendor(
    tx: TenantTransaction,
    tenantId: string,
    invoer: ContractImportInvoer,
  ): Promise<{
    vendorId: string;
    aangemaakt: boolean;
    afwijkt: boolean;
    categorieAangemaakt: boolean;
  }> {
    const coupaNummer = leegIsNull(invoer.vendorCoupaSupplierNumber);

    if (coupaNummer) {
      const bestaand = await tx.execute<{
        vendor_id: string;
        name: string;
        category_code: string | null;
      }>(
        sql`SELECT vendor_id, name, category_code FROM clm.vendor
             WHERE coupa_supplier_number = ${coupaNummer}
               AND deleted_at IS NULL
             LIMIT 1`,
      );

      if (bestaand.rows.length > 0) {
        // Nooit bijwerken (create_only-uitgangspunt, besluit eigenaar
        // 2026-08-31) — alleen signaleren of de CSV afwijkt van wat er al
        // staat, zodat een mens het achteraf kan beoordelen.
        const bestaandeVendor = bestaand.rows[0];
        const categorieCode = leegIsNull(invoer.vendorCategoryCode);
        const afwijkt =
          bestaandeVendor.name.trim() !== invoer.vendorName.trim() ||
          (categorieCode ?? null) !== (bestaandeVendor.category_code ?? null);

        return {
          vendorId: bestaandeVendor.vendor_id,
          aangemaakt: false,
          afwijkt,
          categorieAangemaakt: false,
        };
      }
    }

    const { code: categorieCode, aangemaakt: categorieAangemaakt } =
      await this.vindOfMaakCategorie(tx, tenantId, invoer.vendorCategoryCode);

    const nieuw = await tx.execute<{ vendor_id: string }>(
      sql`INSERT INTO clm.vendor
            (tenant_id, name, category_code, coupa_supplier_number, business_criticality_code)
          VALUES (${tenantId}, ${invoer.vendorName.trim()}, ${categorieCode}, ${coupaNummer},
                  ${leegIsNull(invoer.vendorBusinessCriticalityCode)})
          RETURNING vendor_id`,
    );

    return {
      vendorId: nieuw.rows[0].vendor_id,
      aangemaakt: true,
      afwijkt: false,
      categorieAangemaakt,
    };
  }

  /**
   * Vindt een vendor-categorie op code binnen de tenant, of maakt hem aan.
   *
   * Besluit eigenaar (31-08, na het eerste gebruik tegen een echt
   * Transdev-testbestand): een echte export gebruikt vrije tekst ('ICT',
   * 'Vastgoed & Facility Management') die vrijwel nooit exact overeenkomt
   * met de korte codes die een tenant al heeft ('it_services',
   * 'facilities'). Eerder liet dit veld gewoon leeg bij een onbekende code
   * — dat verloor de categorie stilzwijgend. Nu: aanmaken, met de
   * genormaliseerde tekst als code en de originele tekst als label. Een
   * mens kan later opschonen/samenvoegen via /vendor-categories.
   */
  private async vindOfMaakCategorie(
    tx: TenantTransaction,
    tenantId: string,
    categorieRuw: string | null,
  ): Promise<{ code: string | null; aangemaakt: boolean }> {
    const categorieTekst = leegIsNull(categorieRuw);
    if (!categorieTekst) return { code: null, aangemaakt: false };

    const code = naarCategorieCode(categorieTekst);

    const bestaand = await tx.execute<{ code: string }>(
      sql`SELECT code FROM ref.vendor_category
           WHERE tenant_id = ${tenantId} AND code = ${code}`,
    );

    if (bestaand.rows.length > 0) {
      return { code, aangemaakt: false };
    }

    await tx.execute(
      sql`INSERT INTO ref.vendor_category (tenant_id, code, label)
          VALUES (${tenantId}, ${code}, ${categorieTekst})`,
    );

    return { code, aangemaakt: true };
  }

  /**
   * Vindt een contactpersoon op (vendor_id, email, full_name), of maakt er
   * een aan. Beide velden samen als sleutel (besluit eigenaar): twee rijen
   * met hetzelfde e-mailadres maar een andere naam zijn twee verschillende
   * contactpunten bij dezelfde vendor (bijv. een persoon vs. een
   * afdelingspostbus).
   *
   * `clm.vendor_contact.full_name` is `NOT NULL` (bestaand, niet te wijzigen
   * schema) — alleen `email` is nullable. Bij alleen een e-mailadres (geen
   * naam) gebruikt de INSERT daarom het e-mailadres zelf als voorlopige naam
   * (besluit eigenaar 31-08), en de matchquery zoekt op diezelfde effectieve
   * naam — anders zou een tweede import met dezelfde alleen-email-rij het
   * eerder aangemaakte contact nooit hergebruiken.
   */
  private async vindOfMaakContact(
    tx: TenantTransaction,
    tenantId: string,
    vendorId: string,
    invoer: ContractImportInvoer,
  ): Promise<{ contactId: string; aangemaakt: boolean }> {
    const email = leegIsNull(invoer.contactEmail);
    const naam = leegIsNull(invoer.contactFullName) ?? email;

    // IS NOT DISTINCT FROM i.p.v. `=`: bij een NULL email (alleen naam
    // ingevuld — besluit eigenaar 31-08, geen 'onvolledig' meer) geeft `=`
    // altijd NULL, dus zou de match nooit slagen en elke import een nieuw
    // contact aanmaken in plaats van het bestaande te hergebruiken.
    const bestaand = await tx.execute<{ contact_id: string }>(
      sql`SELECT contact_id FROM clm.vendor_contact
           WHERE vendor_id = ${vendorId}
             AND email IS NOT DISTINCT FROM ${email}
             AND full_name = ${naam}
             AND deleted_at IS NULL
           LIMIT 1`,
    );

    if (bestaand.rows.length > 0) {
      return { contactId: bestaand.rows[0].contact_id, aangemaakt: false };
    }

    // Eerste contactpersoon van de vendor wordt vanzelf primair — zelfde
    // regel als vendor.service.ts, zodat een via import aangemaakte
    // leverancier ook meteen een aanspreekpunt heeft.
    const aantal = await tx.execute<{ n: string }>(
      sql`SELECT count(*) AS n FROM clm.vendor_contact
           WHERE vendor_id = ${vendorId} AND deleted_at IS NULL`,
    );
    const wordtPrimair = Number(aantal.rows[0].n) === 0;

    const nieuw = await tx.execute<{ contact_id: string }>(
      sql`INSERT INTO clm.vendor_contact
            (vendor_id, tenant_id, full_name, email, is_primary)
          VALUES (${vendorId}, ${tenantId}, ${naam}, ${email}, ${wordtPrimair})
          RETURNING contact_id`,
    );

    return { contactId: nieuw.rows[0].contact_id, aangemaakt: true };
  }

  private berekenHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }
}
