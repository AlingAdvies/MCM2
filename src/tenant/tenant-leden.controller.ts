import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';

import { RolGuard, VereistRol } from '../auth/rol.guard';
import {
  TenantContextGuard,
  type RequestMetSessie,
} from '../auth/tenant-context.guard';
import { InvoerFout } from '../vendor/vendor-invoer';
import {
  leesGegevensWijziging,
  leesNieuwLid,
  leesRolWijziging,
} from './tenant-leden-invoer';
import { TenantLedenService } from './tenant-leden.service';

/**
 * Wie er in de eigen tenant mag werken, en met welke rol (issue #75).
 *
 * Alle routes `@VereistRol('admin', 'support')` — een `user` mag hetzelfde
 * als een `admin` overal behalve hier: bepalen wie er in de tenant mag is
 * beheer, geen contractbeheerwerk. Zie de spec, §3.
 *
 * De platformbeheerder komt hier via het bestaande support-toegang-mechanisme
 * (ADR-015): met een geldige support-membership is zijn sessierol tijdelijk
 * 'support', niet 'admin' — die rol staat hieronder expliciet toegevoegd
 * zodat het scherm ook voor hem werkt (spec §6).
 *
 * `/tenant/leden` en niet `/tenant/gebruikers`: die laatste bestaat al
 * (TenantController) als simpele naam-only keuzelijst zonder rolcontrole,
 * gebruikt elders (bv. de reviewer-koppel-dropdown). Een eigen pad voorkomt
 * dat twee routes met verschillend contract op dezelfde naam botsen.
 */
@Controller('tenant/leden')
@UseGuards(TenantContextGuard, RolGuard)
export class TenantLedenController {
  constructor(private readonly leden: TenantLedenService) {}

  @Get()
  @VereistRol('admin', 'support')
  async lijst(@Req() request: RequestMetSessie) {
    const leden = await this.leden.lijst(request.sessie!.tenantId);
    return { leden };
  }

  @Post()
  @VereistRol('admin', 'support')
  @HttpCode(201)
  async uitnodigen(@Req() request: RequestMetSessie, @Body() body: unknown) {
    try {
      return await this.leden.uitnodigen(
        request.sessie!.tenantId,
        leesNieuwLid(body),
      );
    } catch (fout) {
      if (fout instanceof InvoerFout) {
        throw new BadRequestException({
          veld: fout.veld,
          melding: fout.message,
        });
      }
      throw fout;
    }
  }

  @Put(':userId/rol')
  @VereistRol('admin', 'support')
  @HttpCode(204)
  async rolWijzigen(
    @Req() request: RequestMetSessie,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ) {
    try {
      await this.leden.rolWijzigen(
        request.sessie!.tenantId,
        userId,
        leesRolWijziging(body).rol,
      );
    } catch (fout) {
      if (fout instanceof InvoerFout) {
        throw new BadRequestException({
          veld: fout.veld,
          melding: fout.message,
        });
      }
      throw fout;
    }
  }

  @Put(':userId')
  @VereistRol('admin', 'support')
  @HttpCode(204)
  async gegevensWijzigen(
    @Req() request: RequestMetSessie,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ) {
    try {
      await this.leden.gegevensWijzigen(
        request.sessie!.tenantId,
        userId,
        leesGegevensWijziging(body),
      );
    } catch (fout) {
      if (fout instanceof InvoerFout) {
        throw new BadRequestException({
          veld: fout.veld,
          melding: fout.message,
        });
      }
      throw fout;
    }
  }

  @Post(':userId/intrekken')
  @VereistRol('admin', 'support')
  @HttpCode(204)
  async intrekken(
    @Req() request: RequestMetSessie,
    @Param('userId') userId: string,
  ) {
    await this.leden.intrekken(request.sessie!.tenantId, userId);
  }
}
