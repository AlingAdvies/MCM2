import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';

import { RolGuard, VereistRol } from '../auth/rol.guard';
import {
  TenantContextGuard,
  type RequestMetSessie,
} from '../auth/tenant-context.guard';
import { InvoerFout } from '../vendor/vendor-invoer';
import { leesTenantWijziging } from './tenant-invoer';
import { TenantService } from './tenant.service';

/**
 * De instellingen van de eigen omgeving.
 *
 * ── Waar de tenant vandaan komt ─────────────────────────────────────────────
 *
 * Uit de sessie, altijd. Er is geen tenant-parameter in het pad en geen veld in
 * de body — een beheerder kan hier dus per constructie niet de instellingen van
 * een andere organisatie opvragen of wijzigen.
 *
 * Dat is de gewone regel (§6). `PlatformController` is de uitzondering daarop,
 * en die woont bewust in een eigen module met een eigen guard ervoor.
 *
 * ── Waarom `admin` en niet elke ingelogde gebruiker ─────────────────────────
 *
 * Het antwoordadres bepaalt waar vragen van leveranciers van de héle
 * organisatie heen gaan. Een beoordelaar hoort dat niet te kunnen verleggen.
 * Backendcontrole met `@VereistRol('admin')`, niet alleen een verborgen
 * menu-item — een route die alleen in het scherm dicht zit, is niet dicht.
 *
 * Lezen mag wél iedereen met een sessie: het scherm toont de instellingen ook
 * aan wie ze niet mag wijzigen, en dat is beter dan een leeg vlak zonder uitleg.
 */
@Controller('tenant')
@UseGuards(TenantContextGuard, RolGuard)
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  @Get('instellingen')
  async lezen(@Req() request: RequestMetSessie) {
    // Veilig: zonder sessie is de guard nooit voorbijgekomen.
    return this.tenants.lezen(request.sessie!.tenantId);
  }

  /**
   * De gebruikers van de eigen tenant, voor een keuzelijst.
   *
   * Geen `@VereistRol`: het is een keuzelijst, geen gevoelige data — zelfde
   * redenering als bij `lezen()` hierboven.
   */
  @Get('gebruikers')
  async gebruikersLijst(@Req() request: RequestMetSessie) {
    const gebruikers = await this.tenants.gebruikers(request.sessie!.tenantId);
    return { gebruikers };
  }

  @Patch('instellingen')
  @VereistRol('admin')
  async wijzigen(@Req() request: RequestMetSessie, @Body() body: unknown) {
    try {
      return await this.tenants.wijzigen(
        request.sessie!.tenantId,
        leesTenantWijziging(body),
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
}
