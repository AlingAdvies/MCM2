import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { RolGuard, VereistRol } from '../auth/rol.guard';
import {
  TenantContextGuard,
  type RequestMetSessie,
} from '../auth/tenant-context.guard';
import { BestandOpslagService } from '../survey/bestand-opslag.service';
import { veiligeWeergavenaam } from '../survey/bestand-validatie';
import { MAX_BESTANDSGROOTTE } from './vendor-engagement-bestand-validatie';
import {
  InvoerFout,
  leesNieuwEngagement,
  leesNieuweLink,
} from './vendor-engagement-invoer';
import { VendorEngagementService } from './vendor-engagement.service';

/**
 * Vendor-dossiers (engagements): zie
 * docs/superpowers/specs/2026-09-24-vendor-dossiers-design.md.
 *
 * Rollen 'admin' en 'user' nu — elke gebruiker in de tenant mag aanmaken/
 * inzien, consistent met VendorController. @VereistRol hier is bewust zo
 * gekozen dat een latere beperking tot alleen 'admin' (contractbeheerder)
 * één parameter-wijziging is.
 *
 * Let op: 'medewerker' in RLS-policies (clm.current_actor()) is een ander
 * begrip dan de sessierol hier — dat is de databaserol die de e2e-fixtures
 * met SET LOCAL app.current_actor zetten, niet de tenant-membership-rol
 * ('admin'/'user'/'support'/'reviewer') die deze guard controleert.
 */
@Controller()
@UseGuards(TenantContextGuard, RolGuard)
export class VendorEngagementController {
  constructor(
    private readonly engagements: VendorEngagementService,
    private readonly opslag: BestandOpslagService,
  ) {}

  @Get('vendors/:vendorId/engagements')
  @VereistRol('admin', 'user')
  async lijst(
    @Req() request: RequestMetSessie,
    @Param('vendorId') vendorId: string,
  ) {
    const sessie = request.sessie!;
    const engagements = await this.engagements.lijstVoorVendor(
      sessie.tenantId,
      vendorId,
    );
    return { engagements };
  }

  @Post('vendors/:vendorId/engagements')
  @VereistRol('admin', 'user')
  @HttpCode(201)
  async aanmaken(
    @Req() request: RequestMetSessie,
    @Param('vendorId') vendorId: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let invoer: ReturnType<typeof leesNieuwEngagement>;
    try {
      invoer = leesNieuwEngagement(body);
    } catch (err) {
      throw this.naarHttpFout(err);
    }

    const engagement = await this.engagements.aanmaken(
      sessie.tenantId,
      vendorId,
      sessie.userId,
      invoer.titel,
      invoer.links,
    );

    return { engagement };
  }

  @Post('engagements/:id/links')
  @VereistRol('admin', 'user')
  @HttpCode(201)
  async linkToevoegen(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let invoer: ReturnType<typeof leesNieuweLink>;
    try {
      invoer = leesNieuweLink(body);
    } catch (err) {
      throw this.naarHttpFout(err);
    }

    const link = await this.engagements.linkToevoegen(
      sessie.tenantId,
      id,
      invoer.linkType,
      invoer.linkedId,
    );

    return { link };
  }

  /**
   * Veldnaam 'file', consistent met de bestaande beheer-uploadroute
   * (VragenlijstBeheerController.bijlageToevoegen).
   */
  @Post('engagements/:id/attachments')
  @VereistRol('admin', 'user')
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_BESTANDSGROOTTE, files: 1 },
    }),
  )
  async bijlageToevoegen(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @UploadedFile()
    bestand:
      { originalname: string; mimetype?: string; buffer: Buffer } | undefined,
  ) {
    const sessie = request.sessie!;

    if (!bestand) {
      throw new BadRequestException('Geen bestand ontvangen.');
    }

    const uitkomst = await this.engagements.bijlageToevoegen(
      sessie.tenantId,
      id,
      sessie.userId,
      bestand,
    );

    if (uitkomst.status === 'afgekeurd') {
      throw new BadRequestException(`Bestand afgekeurd: ${uitkomst.reden}.`);
    }

    if (uitkomst.status === 'te-veel-bijlagen') {
      throw new BadRequestException(
        'Dit dossier heeft al het maximum van 3 bijlagen.',
      );
    }

    return { attachment: uitkomst.attachment };
  }

  @Get('engagements/attachments/:attachmentId')
  @VereistRol('admin', 'user')
  async downloaden(
    @Req() request: RequestMetSessie,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ) {
    const sessie = request.sessie!;

    const gegevens = await this.engagements.bijlageOpslagsleutel(
      sessie.tenantId,
      attachmentId,
    );

    if (!gegevens) {
      res.status(404).json({ melding: 'Deze bijlage bestaat niet.' });
      return;
    }

    const inhoud = await this.opslag.lees(gegevens.storageKey);
    const naam = veiligeWeergavenaam(gegevens.originalFilename);

    res.setHeader('Content-Type', gegevens.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${naam}"`);
    res.send(inhoud);
  }

  @Delete('engagements/:id')
  @VereistRol('admin', 'user')
  @HttpCode(204)
  async intrekken(@Req() request: RequestMetSessie, @Param('id') id: string) {
    const sessie = request.sessie!;
    await this.engagements.engagementIntrekken(sessie.tenantId, id);
  }

  @Delete('engagements/:id/attachments/:attachmentId')
  @VereistRol('admin', 'user')
  @HttpCode(204)
  async bijlageIntrekken(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    const sessie = request.sessie!;
    await this.engagements.bijlageIntrekken(sessie.tenantId, id, attachmentId);
  }

  private naarHttpFout(err: unknown): Error {
    if (err instanceof InvoerFout) {
      return new BadRequestException(err.message);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
