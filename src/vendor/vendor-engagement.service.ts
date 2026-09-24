import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';
import { BestandOpslagService } from '../survey/bestand-opslag.service';
import {
  MAX_BIJLAGEN_PER_ENGAGEMENT,
  maakEngagementOpslagsleutel,
  valideerEngagementBestand,
} from './vendor-engagement-bestand-validatie';

/**
 * Vendor-dossiers (engagements): intensiever, meervoudig mailcontact met een
 * leverancier, vastgelegd als titel + optionele koppeling(en) naar
 * contract(en)/survey-response(s) + bijlagen.
 *
 * Zie docs/superpowers/specs/2026-09-24-vendor-dossiers-design.md.
 *
 * Rechtstreekse SQL via tx.execute(), net als NotitieService — de Drizzle
 * query-builder wordt in deze codebase niet voor de admin-kant gebruikt.
 */

export type LinkType = 'contract' | 'survey_response';

export interface EngagementLink {
  linkId: string;
  linkType: LinkType;
  linkedId: string;
}

export interface EngagementAttachment {
  attachmentId: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  createdAt: string;
}

export interface Engagement {
  engagementId: string;
  vendorId: string;
  titel: string;
  createdByUserId: string;
  createdByNaam: string | null;
  createdAt: string;
  links: EngagementLink[];
  attachments: EngagementAttachment[];
}

interface EngagementRij extends Record<string, unknown> {
  engagement_id: string;
  vendor_id: string;
  titel: string;
  created_by_user_id: string;
  created_by_naam: string | null;
  created_at: Date | string;
}

interface LinkRij extends Record<string, unknown> {
  link_id: string;
  engagement_id: string;
  link_type: string;
  linked_id: string;
}

interface AttachmentRij extends Record<string, unknown> {
  attachment_id: string;
  engagement_id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_by_user_id: string;
  created_at: Date | string;
}

function iso(waarde: Date | string): string {
  return waarde instanceof Date ? waarde.toISOString() : String(waarde);
}

@Injectable()
export class VendorEngagementService {
  constructor(
    private readonly db: DatabaseService,
    private readonly opslag: BestandOpslagService,
  ) {}

  /**
   * Alle engagements van één leverancier, met links en bijlagen, nieuwste
   * eerst. Gebruikt door het vendorscherm (ongefilterd) en door het contract-
   * en surveyscherm (die filteren client-side op link_type/linked_id — zie
   * spec §API: geen aparte endpoints per contract/survey).
   */
  async lijstVoorVendor(
    tenantId: string,
    vendorId: string,
  ): Promise<Engagement[]> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        await this.eisBestaandeVendor(tx, vendorId);

        const engagements = await tx.execute<EngagementRij>(
          sql`SELECT e.engagement_id,
                     e.vendor_id,
                     e.titel,
                     e.created_by_user_id,
                     u.full_name AS created_by_naam,
                     e.created_at
                FROM clm.vendor_engagement e
                LEFT JOIN clm."user" u ON u.user_id = e.created_by_user_id
               WHERE e.vendor_id = ${vendorId}
                 AND e.deleted_at IS NULL
               ORDER BY e.created_at DESC`,
        );

        if (engagements.rows.length === 0) return [];

        const ids = engagements.rows.map((r) => r.engagement_id);

        const links = await tx.execute<LinkRij>(
          sql`SELECT link_id, engagement_id, link_type, linked_id
                FROM clm.vendor_engagement_link
               WHERE engagement_id = ANY(${sql.param(ids)}::uuid[])`,
        );

        const attachments = await tx.execute<AttachmentRij>(
          sql`SELECT attachment_id, engagement_id, original_filename,
                     content_type, size_bytes, uploaded_by_user_id, created_at
                FROM clm.vendor_engagement_attachment
               WHERE engagement_id = ANY(${sql.param(ids)}::uuid[])
                 AND deleted_at IS NULL`,
        );

        return engagements.rows.map((r) =>
          this.naarEngagement(r, links.rows, attachments.rows),
        );
      },
      'medewerker',
    );
  }

  /**
   * Maakt een nieuw engagement aan, met optionele initiële links.
   *
   * De auteur komt uit de sessie, nooit uit de invoer (MCM2-CLAUDE.md §6) —
   * zelfde regel als bij NotitieService.voegToe.
   */
  async aanmaken(
    tenantId: string,
    vendorId: string,
    createdByUserId: string,
    titel: string,
    initieleLinks: ReadonlyArray<{ linkType: LinkType; linkedId: string }>,
  ): Promise<Engagement> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        await this.eisBestaandeVendor(tx, vendorId);

        for (const link of initieleLinks) {
          await this.eisBestaandLinkDoel(tx, link.linkType, link.linkedId);
        }

        const resultaat = await tx.execute<EngagementRij>(
          sql`WITH nieuw AS (
                INSERT INTO clm.vendor_engagement
                       (tenant_id, vendor_id, titel, created_by_user_id)
                VALUES (${tenantId}, ${vendorId}, ${titel}, ${createdByUserId})
                RETURNING engagement_id, vendor_id, titel, created_by_user_id, created_at
              )
              SELECT n.engagement_id,
                     n.vendor_id,
                     n.titel,
                     n.created_by_user_id,
                     u.full_name AS created_by_naam,
                     n.created_at
                FROM nieuw n
                LEFT JOIN clm."user" u ON u.user_id = n.created_by_user_id`,
        );

        const rij = resultaat.rows[0];
        if (!rij) {
          throw new BadRequestException(
            'Het dossier kon niet worden aangemaakt.',
          );
        }

        for (const link of initieleLinks) {
          await tx.execute(
            sql`INSERT INTO clm.vendor_engagement_link
                       (engagement_id, tenant_id, link_type, linked_id)
                VALUES (${rij.engagement_id}, ${tenantId}, ${link.linkType}, ${link.linkedId})`,
          );
        }

        const links = await tx.execute<LinkRij>(
          sql`SELECT link_id, engagement_id, link_type, linked_id
                FROM clm.vendor_engagement_link
               WHERE engagement_id = ${rij.engagement_id}`,
        );

        return this.naarEngagement(rij, links.rows, []);
      },
      'medewerker',
    );
  }

  /** Voegt een extra koppeling toe aan een bestaand engagement. */
  async linkToevoegen(
    tenantId: string,
    engagementId: string,
    linkType: LinkType,
    linkedId: string,
  ): Promise<EngagementLink> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        await this.eisBestaandEngagement(tx, engagementId);
        await this.eisBestaandLinkDoel(tx, linkType, linkedId);

        const resultaat = await tx.execute<LinkRij>(
          sql`INSERT INTO clm.vendor_engagement_link
                     (engagement_id, tenant_id, link_type, linked_id)
              VALUES (${engagementId}, ${tenantId}, ${linkType}, ${linkedId})
              ON CONFLICT (engagement_id, link_type, linked_id) DO NOTHING
              RETURNING link_id, engagement_id, link_type, linked_id`,
        );

        const rij = resultaat.rows[0];
        if (!rij) {
          throw new BadRequestException(
            'Deze koppeling bestaat al, of kon niet worden toegevoegd.',
          );
        }

        return {
          linkId: rij.link_id,
          linkType: rij.link_type as LinkType,
          linkedId: rij.linked_id,
        };
      },
      'medewerker',
    );
  }

  /**
   * Voegt een bijlage toe. Server-side maximum van 3 per engagement,
   * afgedwongen met FOR UPDATE op de engagement-rij — zelfde aanpak als
   * BijlageService.voegToe voor max_files, om te voorkomen dat twee
   * gelijktijdige uploads samen over de grens gaan.
   */
  async bijlageToevoegen(
    tenantId: string,
    engagementId: string,
    uploadedByUserId: string,
    bestand: { originalname: string; mimetype?: string; buffer: Buffer },
  ): Promise<
    | { status: 'opgeslagen'; attachment: EngagementAttachment }
    | { status: 'afgekeurd'; reden: string }
    | { status: 'te-veel-bijlagen' }
  > {
    const gecontroleerd = valideerEngagementBestand(
      bestand.buffer,
      bestand.mimetype,
    );

    if (!gecontroleerd.geldig) {
      return { status: 'afgekeurd', reden: gecontroleerd.reden };
    }

    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const vergrendeld = await tx.execute(
          sql`SELECT engagement_id FROM clm.vendor_engagement
               WHERE engagement_id = ${engagementId}
                 AND deleted_at IS NULL
               FOR UPDATE`,
        );

        if (vergrendeld.rows.length === 0) {
          throw new NotFoundException('Dit dossier bestaat niet.');
        }

        const aantal = await tx.execute<{ aantal: string }>(
          sql`SELECT count(*)::text AS aantal
                FROM clm.vendor_engagement_attachment
               WHERE engagement_id = ${engagementId}
                 AND deleted_at IS NULL`,
        );

        if (
          Number(aantal.rows[0]?.aantal ?? '0') >= MAX_BIJLAGEN_PER_ENGAGEMENT
        ) {
          return { status: 'te-veel-bijlagen' as const };
        }

        const storageKey = maakEngagementOpslagsleutel(tenantId, engagementId);

        await this.opslag.bewaar(storageKey, bestand.buffer);

        const resultaat = await tx.execute<AttachmentRij>(
          sql`INSERT INTO clm.vendor_engagement_attachment
                     (engagement_id, tenant_id, storage_key, original_filename,
                      content_type, size_bytes, uploaded_by_user_id)
              VALUES (${engagementId}, ${tenantId}, ${storageKey},
                      ${bestand.originalname}, ${gecontroleerd.contentType},
                      ${bestand.buffer.length}, ${uploadedByUserId})
              RETURNING attachment_id, engagement_id, original_filename,
                        content_type, size_bytes, uploaded_by_user_id, created_at`,
        );

        const rij = resultaat.rows[0];
        if (!rij) {
          await this.opslag.verwijder(storageKey);
          throw new BadRequestException(
            'De bijlage kon niet worden opgeslagen.',
          );
        }

        return {
          status: 'opgeslagen' as const,
          attachment: this.naarAttachment(rij),
        };
      },
      'medewerker',
    );
  }

  async engagementIntrekken(
    tenantId: string,
    engagementId: string,
  ): Promise<void> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const geraakt = await tx.execute(
          sql`UPDATE clm.vendor_engagement
                 SET deleted_at = now()
               WHERE engagement_id = ${engagementId}
                 AND deleted_at IS NULL`,
        );

        if (geraakt.rowCount === 0) {
          throw new NotFoundException(
            'Dit dossier bestaat niet, of is al ingetrokken.',
          );
        }
      },
      'medewerker',
    );
  }

  async bijlageIntrekken(
    tenantId: string,
    engagementId: string,
    attachmentId: string,
  ): Promise<void> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const geraakt = await tx.execute(
          sql`UPDATE clm.vendor_engagement_attachment
                 SET deleted_at = now()
               WHERE attachment_id = ${attachmentId}
                 AND engagement_id = ${engagementId}
                 AND deleted_at IS NULL`,
        );

        if (geraakt.rowCount === 0) {
          throw new NotFoundException(
            'Deze bijlage bestaat niet, of is al ingetrokken.',
          );
        }
      },
      'medewerker',
    );
  }

  /**
   * Leest de opslagsleutel voor een download, met tenant- en
   * engagement-controle. Geeft null als de bijlage niet (meer) bestaat.
   */
  async bijlageOpslagsleutel(
    tenantId: string,
    attachmentId: string,
  ): Promise<{
    storageKey: string;
    originalFilename: string;
    contentType: string;
  } | null> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const resultaat = await tx.execute<{
          storage_key: string;
          original_filename: string;
          content_type: string;
        }>(
          sql`SELECT storage_key, original_filename, content_type
                FROM clm.vendor_engagement_attachment
               WHERE attachment_id = ${attachmentId}
                 AND deleted_at IS NULL`,
        );

        const rij = resultaat.rows[0];
        if (!rij) return null;

        return {
          storageKey: rij.storage_key,
          originalFilename: rij.original_filename,
          contentType: rij.content_type,
        };
      },
      'medewerker',
    );
  }

  private async eisBestaandeVendor(
    tx: Parameters<Parameters<DatabaseService['withTenant']>[1]>[0],
    vendorId: string,
  ): Promise<void> {
    const gevonden = await tx.execute(
      sql`SELECT 1 FROM clm.vendor WHERE vendor_id = ${vendorId}`,
    );

    if (gevonden.rows.length === 0) {
      throw new NotFoundException('Deze leverancier bestaat niet.');
    }
  }

  private async eisBestaandEngagement(
    tx: Parameters<Parameters<DatabaseService['withTenant']>[1]>[0],
    engagementId: string,
  ): Promise<void> {
    const gevonden = await tx.execute(
      sql`SELECT 1 FROM clm.vendor_engagement
           WHERE engagement_id = ${engagementId} AND deleted_at IS NULL`,
    );

    if (gevonden.rows.length === 0) {
      throw new NotFoundException('Dit dossier bestaat niet.');
    }
  }

  /**
   * Controleert dat het koppeldoel (contract of survey-response) echt
   * bestaat binnen deze tenant, vóórdat er een link naar wordt aangemaakt.
   * linked_id kan geen FK dragen (twee mogelijke doeltabellen — zie migratie
   * 0041), dus dit is de enige plek die dat bestaan afdwingt.
   *
   * `tabel`/`kolom` komen uit een interne switch op `linkType`
   * ('contract' | 'survey_response'), niet rechtstreeks uit gebruikersinvoer
   * — linkType wordt al eerder gevalideerd door de controller tegen exact
   * deze twee waarden vóór deze methode ooit wordt aangeroepen. sql.raw() is
   * hier dus veilig, maar alleen omdat de waarde nooit direct van de client
   * komt.
   */
  private async eisBestaandLinkDoel(
    tx: Parameters<Parameters<DatabaseService['withTenant']>[1]>[0],
    linkType: LinkType,
    linkedId: string,
  ): Promise<void> {
    const tabel =
      linkType === 'contract' ? 'clm.contract' : 'clm.survey_response';
    const kolom = linkType === 'contract' ? 'contract_id' : 'response_id';

    const gevonden = await tx.execute(
      sql`SELECT 1 FROM ${sql.raw(tabel)} WHERE ${sql.raw(kolom)} = ${linkedId}`,
    );

    if (gevonden.rows.length === 0) {
      throw new BadRequestException(
        linkType === 'contract'
          ? 'Dit contract bestaat niet.'
          : 'Deze vragenlijst-inzending bestaat niet.',
      );
    }
  }

  private naarEngagement(
    r: EngagementRij,
    alleLinks: LinkRij[],
    alleAttachments: AttachmentRij[],
  ): Engagement {
    return {
      engagementId: r.engagement_id,
      vendorId: r.vendor_id,
      titel: r.titel,
      createdByUserId: r.created_by_user_id,
      createdByNaam: r.created_by_naam,
      createdAt: iso(r.created_at),
      links: alleLinks
        .filter((l) => l.engagement_id === r.engagement_id)
        .map((l) => ({
          linkId: l.link_id,
          linkType: l.link_type as LinkType,
          linkedId: l.linked_id,
        })),
      attachments: alleAttachments
        .filter((a) => a.engagement_id === r.engagement_id)
        .map((a) => this.naarAttachment(a)),
    };
  }

  private naarAttachment(r: AttachmentRij): EngagementAttachment {
    return {
      attachmentId: r.attachment_id,
      originalFilename: r.original_filename,
      contentType: r.content_type,
      sizeBytes: r.size_bytes,
      uploadedByUserId: r.uploaded_by_user_id,
      createdAt: iso(r.created_at),
    };
  }
}
