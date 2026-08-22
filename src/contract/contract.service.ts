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

export interface ContractSamenvatting {
  contractId: string;
  name: string;
  contractNumber: string | null;
  statusCode: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
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
}

export interface ContractDetail {
  contractId: string;
  vendorId: string;
  name: string;
  contractNumber: string | null;
  vendorContactId: string | null;
  ownerUserId: string | null;
  statusCode: string | null;
  valueEur: string | null;
  startDate: string | null;
  endDate: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string | null;
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
}

interface ContractRij extends Record<string, unknown> {
  contract_id: string;
  name: string;
  contract_number: string | null;
  status_code: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: Date | string;
}

interface ContractDetailRij extends Record<string, unknown> {
  contract_id: string;
  vendor_id: string;
  name: string;
  contract_number: string | null;
  vendor_contact_id: string | null;
  owner_user_id: string | null;
  status_code: string | null;
  value_eur: string | null;
  start_date: string | null;
  end_date: string | null;
  note: string | null;
  created_at: Date | string;
  updated_at: Date | string | null;
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
          sql`SELECT contract_id, name, contract_number, status_code,
                     start_date, end_date, created_at
                FROM clm.contract
               WHERE vendor_id = ${vendorId} AND deleted_at IS NULL
               ORDER BY created_at DESC`,
        );

        return resultaat.rows.map((r) => ({
          contractId: r.contract_id,
          name: r.name,
          contractNumber: r.contract_number,
          statusCode: r.status_code,
          startDate: r.start_date,
          endDate: r.end_date,
          createdAt: alsTekst(r.created_at),
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
                 start_date, end_date, note)
              VALUES (${tenantId}, ${vendorId}, ${invoer.name.trim()},
                      ${leegIsNull(invoer.contractNumber)},
                      ${invoer.vendorContactId ?? null},
                      ${invoer.ownerUserId ?? null},
                      ${leegIsNull(invoer.statusCode)},
                      ${invoer.valueEur ?? null},
                      ${invoer.startDate ?? null},
                      ${invoer.endDate ?? null},
                      ${leegIsNull(invoer.note)})
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

  private async detailBinnenTransactie(
    tx: Parameters<Parameters<DatabaseService['withTenant']>[1]>[0],
    vendorId: string,
    contractId: string,
  ): Promise<ContractDetail | null> {
    const resultaat = await tx.execute<ContractDetailRij>(
      sql`SELECT contract_id, vendor_id, name, contract_number,
                 vendor_contact_id, owner_user_id, status_code, value_eur,
                 start_date, end_date, note, created_at, updated_at
            FROM clm.contract
           WHERE contract_id = ${contractId}
             AND vendor_id = ${vendorId}
             AND deleted_at IS NULL`,
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
      ownerUserId: rij.owner_user_id,
      statusCode: rij.status_code,
      valueEur: rij.value_eur,
      startDate: rij.start_date,
      endDate: rij.end_date,
      note: rij.note,
      createdAt: alsTekst(rij.created_at),
      updatedAt: alsTekstOfNull(rij.updated_at),
    };
  }
}
