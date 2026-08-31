import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import {
  TenantContextGuard,
  type RequestMetSessie,
} from '../auth/tenant-context.guard';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import { ContractImportService } from './contract-import.service';

/** Zelfde grens als de bestaande bijlage-upload (survey-response.controller.ts). */
const MAX_BESTANDSGROOTTE = 5 * 1024 * 1024;

/**
 * Admin-only contract-import (#198): CSV → preview → bevestigen.
 *
 * Twee guards op klasseniveau, zelfde patroon als `PlatformController`:
 * `TenantContextGuard` stelt de sessie vast, `PlatformAdminGuard` kijkt of
 * die persoon platformbeheerder is. De tenant komt uit `sessie.tenantId` —
 * een platformbeheerder kiest zijn doeltenant vooraf via het bestaande
 * `POST /platform/sessie/wisselen`, niet via een veld in deze routes
 * (MCM2-CLAUDE.md §6).
 */
@Controller('platform/contract-import')
@UseGuards(TenantContextGuard, PlatformAdminGuard)
export class ContractImportController {
  constructor(private readonly imports: ContractImportService) {}

  @Post('preview')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_BESTANDSGROOTTE, files: 1 },
    }),
  )
  async preview(
    @Req() request: RequestMetSessie,
    @UploadedFile()
    bestand:
      { originalname: string; mimetype?: string; buffer: Buffer } | undefined,
  ) {
    if (!bestand) {
      throw new BadRequestException('Er is geen bestand meegestuurd.');
    }

    const sessie = request.sessie!;

    const { jobId, beoordeling } = await this.imports.preview(
      sessie.tenantId,
      sessie.userId,
      bestand,
    );

    return { jobId, beoordeling };
  }

  @Post(':jobId/bevestigen')
  async bevestigen(
    @Param('jobId') jobId: string,
    @Body() _body: unknown,
    @Req() request: RequestMetSessie,
  ) {
    const sessie = request.sessie!;
    return this.imports.bevestigen(sessie.tenantId, jobId);
  }
}
