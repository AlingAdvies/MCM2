import { Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';

/**
 * Contracten lezen, aanmaken en wijzigen bij een leverancier.
 *
 * Zelfde opzet als VendorService: raw SQL binnen withTenant(), 'medewerker'
 * als actor, soft delete via deleted_at. Zie
 * docs/superpowers/specs/2026-08-22-contractmanagement-design.md.
 */

export interface SurveyTemplateKoppeling {
  templateIds: string[];
  /** Welke van de gekoppelde templates ook op de wachtlijst staan. */
  wachtlijstTemplateIds: string[];
}

export interface ContractSamenvatting {
  contractId: string;
  name: string;
  contractNumber: string | null;
  vendorContactId: string | null;
  ownerUserId: string | null;
  statusCode: string | null;
  startDate: string | null;
  endDate: string | null;
  vendorContactNaam: string | null;
  ownerGebruikerNaam: string | null;
  createdAt: string;
  noticePeriodDays: number | null;
  warningDaysBefore: number;
  autoRenews: string | null;
  contractType: string | null;
  dpaAanwezig: boolean | null;
  businessRiskTierCode: string | null;
}

export interface ContractTenantBreed extends ContractSamenvatting {
  vendorId: string;
  vendorNaam: string;
  valueEur: string | null;
}

export interface NieuwContract {
  name: string;
  contractNumber?: string | null;
  vendorContactId?: string | null;
  ownerUserId?: string | null;
  statusCode?: string | null;
  valueEur?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  note?: string | null;
  noticePeriodDays?: number | null;
  warningDaysBefore?: number;
  autoRenews?: string | null;
  contractType?: string | null;
  dpaAanwezig?: boolean | null;
  businessRiskTierCode?: string | null;
}

export interface ContractDetail {
  contractId: string;
  vendorId: string;
  name: string;
  contractNumber: string | null;
  vendorContactId: string | null;
  vendorContactNaam: string | null;
  ownerUserId: string | null;
  ownerGebruikerNaam: string | null;
  statusCode: string | null;
  valueEur: string | null;
  startDate: string | null;
  endDate: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string | null;
  noticePeriodDays: number | null;
  warningDaysBefore: number;
  autoRenews: string | null;
  contractType: string | null;
  dpaAanwezig: boolean | null;
  businessRiskTierCode: string | null;
}

/**
 * Wat er gewijzigd mag worden aan een contract. Elk veld optioneel; `null`
 * maakt leeg, `undefined` betekent "niet aangeraakt" — zelfde onderscheid als
 * VendorWijziging.
 */
export interface ContractWijziging {
  name?: string;
  contractNumber?: string | null;
  vendorContactId?: string | null;
  ownerUserId?: string | null;
  statusCode?: string | null;
  valueEur?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  note?: string | null;
  noticePeriodDays?: number | null;
  warningDaysBefore?: number;
  autoRenews?: string | null;
  contractType?: string | null;
  dpaAanwezig?: boolean | null;
  businessRiskTierCode?: string | null;
}

interface ContractRij extends Record<string, unknown> {
  contract_id: string;
  name: string;
  contract_number: string | null;
  vendor_contact_id: string | null;
  owner_user_id: string | null;
  status_code: string | null;
  start_date: string | null;
  end_date: string | null;
  vendor_contact_naam: string | null;
  owner_naam: string | null;
  created_at: Date | string;
  notice_period_days: number | null;
  warning_days_before: number;
  auto_renews: string | null;
  contract_type: string | null;
  dpa_aanwezig: boolean | null;
  business_risk_tier_code: string | null;
}

interface ContractDetailRij extends Record<string, unknown> {
  contract_id: string;
  vendor_id: string;
  name: string;
  contract_number: string | null;
  vendor_contact_id: string | null;
  vendor_contact_naam: string | null;
  owner_user_id: string | null;
  owner_naam: string | null;
  status_code: string | null;
  value_eur: string | null;
  start_date: string | null;
  end_date: string | null;
  note: string | null;
  created_at: Date | string;
  updated_at: Date | string | null;
  notice_period_days: number | null;
  warning_days_before: number;
  auto_renews: string | null;
  contract_type: string | null;
  dpa_aanwezig: boolean | null;
  business_risk_tier_code: string | null;
}

function alsTekst(waarde: Date | string): string {
  return waarde instanceof Date ? waarde.toISOString() : waarde;
}

function alsTekstOfNull(waarde: Date | string | null): string | null {
  return waarde === null ? null : alsTekst(waarde);
}

function leegIsNull(waarde: string | null | undefined): string | null {
  const geknipt = waarde?.trim();
  return geknipt ? geknipt : null;
}

@Injectable()
export class ContractService {
  private readonly logger = new Logger(ContractService.name);

  constructor(private readonly db: DatabaseService) {}

  /** Alle actieve contracten van een leverancier, nieuwste eerst. */
  async lijst(
    tenantId: string,
    vendorId: string,
  ): Promise<ContractSamenvatting[]> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const resultaat = await tx.execute<ContractRij>(
          sql`SELECT c.contract_id, c.name, c.contract_number,
                     c.vendor_contact_id, c.owner_user_id, c.status_code,
                     c.start_date, c.end_date, c.created_at,
                     c.notice_period_days, c.warning_days_before, c.auto_renews,
                     c.contract_type, c.dpa_aanwezig, c.business_risk_tier_code,
                     vc.full_name AS vendor_contact_naam,
                     u.full_name AS owner_naam
                FROM clm.contract c
                LEFT JOIN clm.vendor_contact vc ON vc.contact_id = c.vendor_contact_id
                LEFT JOIN clm."user" u ON u.user_id = c.owner_user_id
               WHERE c.vendor_id = ${vendorId} AND c.deleted_at IS NULL
               ORDER BY c.created_at DESC`,
        );

        return resultaat.rows.map((r) => ({
          contractId: r.contract_id,
          name: r.name,
          contractNumber: r.contract_number,
          vendorContactId: r.vendor_contact_id,
          ownerUserId: r.owner_user_id,
          statusCode: r.status_code,
          startDate: r.start_date,
          endDate: r.end_date,
          vendorContactNaam: r.vendor_contact_naam,
          ownerGebruikerNaam: r.owner_naam,
          createdAt: alsTekst(r.created_at),
          noticePeriodDays: r.notice_period_days,
          warningDaysBefore: r.warning_days_before,
          autoRenews: r.auto_renews,
          contractType: r.contract_type,
          dpaAanwezig: r.dpa_aanwezig,
          businessRiskTierCode: r.business_risk_tier_code,
        }));
      },
      'medewerker',
    );
  }

  /**
   * Alle actieve contracten van de tenant, ongeacht leverancier — voor de
   * contracten-toppagina (issue #173). Dichtstbijzijnde einddatum eerst: een
   * tenant-breed overzicht beantwoordt primair "wat loopt er binnenkort af",
   * anders dan de vendor-gescoped lijst() hierboven (nieuwste eerst).
   */
  async lijstTenantBreed(tenantId: string): Promise<ContractTenantBreed[]> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const resultaat = await tx.execute<
          ContractRij & {
            vendor_id: string;
            vendor_naam: string;
            value_eur: string | null;
          }
        >(
          sql`SELECT c.contract_id, c.vendor_id, c.name, c.contract_number,
                     c.vendor_contact_id, c.owner_user_id, c.status_code,
                     c.value_eur, c.start_date, c.end_date, c.created_at,
                     c.notice_period_days, c.warning_days_before, c.auto_renews,
                     c.contract_type, c.dpa_aanwezig, c.business_risk_tier_code,
                     vc.full_name AS vendor_contact_naam,
                     u.full_name AS owner_naam,
                     v.name AS vendor_naam
                FROM clm.contract c
                LEFT JOIN clm.vendor_contact vc ON vc.contact_id = c.vendor_contact_id
                LEFT JOIN clm."user" u ON u.user_id = c.owner_user_id
                JOIN clm.vendor v ON v.vendor_id = c.vendor_id
               WHERE c.deleted_at IS NULL AND v.deleted_at IS NULL
               ORDER BY c.end_date ASC NULLS LAST`,
        );

        return resultaat.rows.map((r) => ({
          contractId: r.contract_id,
          vendorId: r.vendor_id,
          vendorNaam: r.vendor_naam,
          name: r.name,
          contractNumber: r.contract_number,
          vendorContactId: r.vendor_contact_id,
          ownerUserId: r.owner_user_id,
          statusCode: r.status_code,
          valueEur: r.value_eur,
          startDate: r.start_date,
          endDate: r.end_date,
          vendorContactNaam: r.vendor_contact_naam,
          ownerGebruikerNaam: r.owner_naam,
          createdAt: alsTekst(r.created_at),
          noticePeriodDays: r.notice_period_days,
          warningDaysBefore: r.warning_days_before,
          autoRenews: r.auto_renews,
          contractType: r.contract_type,
          dpaAanwezig: r.dpa_aanwezig,
          businessRiskTierCode: r.business_risk_tier_code,
        }));
      },
      'medewerker',
    );
  }

  /**
   * Maakt een contract aan bij een leverancier.
   *
   * Geeft `null` als de leverancier niet bestaat of niet van deze tenant is
   * — zelfde redenering als VendorService.detail().
   */
  async maakAan(
    tenantId: string,
    vendorId: string,
    invoer: NieuwContract,
  ): Promise<ContractDetail | null> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const vendorBestaat = await tx.execute<{ vendor_id: string }>(
          sql`SELECT vendor_id FROM clm.vendor
             WHERE vendor_id = ${vendorId} AND deleted_at IS NULL`,
        );

        if (vendorBestaat.rows.length === 0) {
          return null;
        }

        const resultaat = await tx.execute<{ contract_id: string }>(
          sql`INSERT INTO clm.contract
                (tenant_id, vendor_id, name, contract_number,
                 vendor_contact_id, owner_user_id, status_code, value_eur,
                 start_date, end_date, note,
                 notice_period_days, warning_days_before, auto_renews,
                 contract_type, dpa_aanwezig, business_risk_tier_code)
              VALUES (${tenantId}, ${vendorId}, ${invoer.name.trim()},
                      ${leegIsNull(invoer.contractNumber)},
                      ${invoer.vendorContactId ?? null},
                      ${invoer.ownerUserId ?? null},
                      ${leegIsNull(invoer.statusCode)},
                      ${invoer.valueEur ?? null},
                      ${invoer.startDate ?? null},
                      ${invoer.endDate ?? null},
                      ${leegIsNull(invoer.note)},
                      ${invoer.noticePeriodDays ?? null},
                      ${invoer.warningDaysBefore ?? 90},
                      ${invoer.autoRenews ?? null},
                      ${leegIsNull(invoer.contractType)},
                      ${invoer.dpaAanwezig ?? null},
                      ${leegIsNull(invoer.businessRiskTierCode)})
              RETURNING contract_id`,
        );

        const contractId = resultaat.rows[0].contract_id;

        this.logger.log(`Contract aangemaakt (${contractId}).`);

        return this.detailBinnenTransactie(tx, vendorId, contractId);
      },
      'medewerker',
    );
  }

  /** Eén contract, mits het bij deze vendor en tenant hoort. */
  async detail(
    tenantId: string,
    vendorId: string,
    contractId: string,
  ): Promise<ContractDetail | null> {
    return this.db.withTenant(
      tenantId,
      (tx) => this.detailBinnenTransactie(tx, vendorId, contractId),
      'medewerker',
    );
  }

  /** Wijzigt een contract. Alleen de meegestuurde velden. */
  async wijzig(
    tenantId: string,
    vendorId: string,
    contractId: string,
    wijziging: ContractWijziging,
  ): Promise<ContractDetail | null> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const bestaat = await tx.execute<{ contract_id: string }>(
          sql`SELECT contract_id FROM clm.contract
             WHERE contract_id = ${contractId}
               AND vendor_id = ${vendorId}
               AND deleted_at IS NULL`,
        );

        if (bestaat.rows.length === 0) {
          return null;
        }

        const zetten: SQL[] = [];

        if (wijziging.name !== undefined) {
          zetten.push(sql`name = ${wijziging.name.trim()}`);
        }
        if (wijziging.contractNumber !== undefined) {
          zetten.push(
            sql`contract_number = ${leegIsNull(wijziging.contractNumber)}`,
          );
        }
        if (wijziging.vendorContactId !== undefined) {
          zetten.push(sql`vendor_contact_id = ${wijziging.vendorContactId}`);
        }
        if (wijziging.ownerUserId !== undefined) {
          zetten.push(sql`owner_user_id = ${wijziging.ownerUserId}`);
        }
        if (wijziging.statusCode !== undefined) {
          zetten.push(sql`status_code = ${leegIsNull(wijziging.statusCode)}`);
        }
        if (wijziging.valueEur !== undefined) {
          zetten.push(sql`value_eur = ${wijziging.valueEur}`);
        }
        if (wijziging.startDate !== undefined) {
          zetten.push(sql`start_date = ${wijziging.startDate}`);
        }
        if (wijziging.endDate !== undefined) {
          zetten.push(sql`end_date = ${wijziging.endDate}`);
        }
        if (wijziging.note !== undefined) {
          zetten.push(sql`note = ${leegIsNull(wijziging.note)}`);
        }
        if (wijziging.noticePeriodDays !== undefined) {
          zetten.push(sql`notice_period_days = ${wijziging.noticePeriodDays}`);
        }
        if (wijziging.warningDaysBefore !== undefined) {
          zetten.push(
            sql`warning_days_before = ${wijziging.warningDaysBefore}`,
          );
        }
        if (wijziging.autoRenews !== undefined) {
          zetten.push(sql`auto_renews = ${wijziging.autoRenews}`);
        }
        if (wijziging.contractType !== undefined) {
          zetten.push(
            sql`contract_type = ${leegIsNull(wijziging.contractType)}`,
          );
        }
        if (wijziging.dpaAanwezig !== undefined) {
          zetten.push(sql`dpa_aanwezig = ${wijziging.dpaAanwezig}`);
        }
        if (wijziging.businessRiskTierCode !== undefined) {
          zetten.push(
            sql`business_risk_tier_code = ${leegIsNull(wijziging.businessRiskTierCode)}`,
          );
        }

        if (zetten.length > 0) {
          zetten.push(sql`updated_at = now()`);

          await tx.execute(
            sql`UPDATE clm.contract
                 SET ${sql.join(zetten, sql`, `)}
               WHERE contract_id = ${contractId}`,
          );

          this.logger.log(`Contract gewijzigd (${contractId}).`);
        }

        return this.detailBinnenTransactie(tx, vendorId, contractId);
      },
      'medewerker',
    );
  }

  /** Verwijdert een contract — soft delete. */
  async verwijder(
    tenantId: string,
    vendorId: string,
    contractId: string,
  ): Promise<boolean> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const resultaat = await tx.execute<{ contract_id: string }>(
          sql`UPDATE clm.contract
               SET deleted_at = now()
             WHERE contract_id = ${contractId}
               AND vendor_id = ${vendorId}
               AND deleted_at IS NULL
             RETURNING contract_id`,
        );

        if (resultaat.rows.length === 0) {
          return false;
        }

        this.logger.log(`Contract verwijderd (${contractId}).`);
        return true;
      },
      'medewerker',
    );
  }

  /** Welke vragenlijst-templates aan dit contract gekoppeld zijn. */
  async surveyTemplates(
    tenantId: string,
    vendorId: string,
    contractId: string,
  ): Promise<SurveyTemplateKoppeling | null> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const bestaat = await tx.execute<{ contract_id: string }>(
          sql`SELECT contract_id FROM clm.contract
             WHERE contract_id = ${contractId}
               AND vendor_id = ${vendorId}
               AND deleted_at IS NULL`,
        );

        if (bestaat.rows.length === 0) {
          return null;
        }

        const resultaat = await tx.execute<{
          survey_template_id: string;
          wachtlijst: boolean;
        }>(
          sql`SELECT survey_template_id, wachtlijst
             FROM clm.contract_survey_template
             WHERE contract_id = ${contractId}
             ORDER BY created_at`,
        );

        return {
          templateIds: resultaat.rows.map((r) => r.survey_template_id),
          wachtlijstTemplateIds: resultaat.rows
            .filter((r) => r.wachtlijst)
            .map((r) => r.survey_template_id),
        };
      },
      'medewerker',
    );
  }

  /**
   * Vervangt de volledige set gekoppelde templates in één transactie.
   *
   * Geen diff (verwijderen wat wegvalt, toevoegen wat nieuw is): bij een klein
   * aantal templates per contract is "alles weg, alles opnieuw" even correct
   * en eenvoudiger. Zie spec §3.2.
   */
  async zetSurveyTemplates(
    tenantId: string,
    vendorId: string,
    contractId: string,
    templateIds: string[],
    wachtlijstTemplateIds: string[],
  ): Promise<SurveyTemplateKoppeling | null> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const bestaat = await tx.execute<{ contract_id: string }>(
          sql`SELECT contract_id FROM clm.contract
             WHERE contract_id = ${contractId}
               AND vendor_id = ${vendorId}
               AND deleted_at IS NULL`,
        );

        if (bestaat.rows.length === 0) {
          return null;
        }

        await tx.execute(
          sql`DELETE FROM clm.contract_survey_template
             WHERE contract_id = ${contractId}`,
        );

        for (const templateId of templateIds) {
          await tx.execute(
            sql`INSERT INTO clm.contract_survey_template
                  (contract_id, survey_template_id, tenant_id, wachtlijst)
                VALUES (${contractId}, ${templateId}, ${tenantId},
                        ${wachtlijstTemplateIds.includes(templateId)})`,
          );
        }

        this.logger.log(
          `Survey-templates gekoppeld aan contract ${contractId}: ${templateIds.length}.`,
        );

        return { templateIds, wachtlijstTemplateIds };
      },
      'medewerker',
    );
  }

  /**
   * Leveranciers die op de wachtlijst staan voor de volgende ronde van
   * deze vragenlijst-template, via een gekoppeld contract. Eén leverancier
   * met meerdere contracten op de wachtlijst voor dezelfde template komt
   * hier maar één keer voor (DISTINCT) — de UI toont een leverancier, geen
   * contract.
   */
  async wachtlijstVoorTemplate(
    tenantId: string,
    templateId: string,
  ): Promise<{ vendorId: string; vendorNaam: string }[]> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const resultaat = await tx.execute<{
          vendor_id: string;
          name: string;
        }>(
          sql`SELECT DISTINCT v.vendor_id, v.name
             FROM clm.contract_survey_template cst
             JOIN clm.contract c ON c.contract_id = cst.contract_id
             JOIN clm.vendor v ON v.vendor_id = c.vendor_id
             WHERE cst.survey_template_id = ${templateId}
               AND cst.wachtlijst = true
               AND c.deleted_at IS NULL
               AND v.deleted_at IS NULL
             ORDER BY v.name`,
        );

        return resultaat.rows.map((r) => ({
          vendorId: r.vendor_id,
          vendorNaam: r.name,
        }));
      },
      'medewerker',
    );
  }

  private async detailBinnenTransactie(
    tx: Parameters<Parameters<DatabaseService['withTenant']>[1]>[0],
    vendorId: string,
    contractId: string,
  ): Promise<ContractDetail | null> {
    const resultaat = await tx.execute<ContractDetailRij>(
      sql`SELECT c.contract_id, c.vendor_id, c.name, c.contract_number,
                 c.vendor_contact_id, c.owner_user_id, c.status_code,
                 c.value_eur, c.start_date, c.end_date, c.note,
                 c.notice_period_days, c.warning_days_before, c.auto_renews,
                 c.contract_type, c.dpa_aanwezig, c.business_risk_tier_code,
                 c.created_at, c.updated_at,
                 vc.full_name AS vendor_contact_naam,
                 u.full_name AS owner_naam
            FROM clm.contract c
            LEFT JOIN clm.vendor_contact vc ON vc.contact_id = c.vendor_contact_id
            LEFT JOIN clm."user" u ON u.user_id = c.owner_user_id
           WHERE c.contract_id = ${contractId}
             AND c.vendor_id = ${vendorId}
             AND c.deleted_at IS NULL`,
    );

    const rij = resultaat.rows[0];

    if (!rij) {
      return null;
    }

    return {
      contractId: rij.contract_id,
      vendorId: rij.vendor_id,
      name: rij.name,
      contractNumber: rij.contract_number,
      vendorContactId: rij.vendor_contact_id,
      vendorContactNaam: rij.vendor_contact_naam,
      ownerUserId: rij.owner_user_id,
      ownerGebruikerNaam: rij.owner_naam,
      statusCode: rij.status_code,
      valueEur: rij.value_eur,
      startDate: rij.start_date,
      endDate: rij.end_date,
      note: rij.note,
      createdAt: alsTekst(rij.created_at),
      updatedAt: alsTekstOfNull(rij.updated_at),
      noticePeriodDays: rij.notice_period_days,
      warningDaysBefore: rij.warning_days_before,
      autoRenews: rij.auto_renews,
      contractType: rij.contract_type,
      dpaAanwezig: rij.dpa_aanwezig,
      businessRiskTierCode: rij.business_risk_tier_code,
    };
  }
}
