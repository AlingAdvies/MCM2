import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  TenantContextGuard,
  type RequestMetSessie,
} from '../auth/tenant-context.guard';
import { InvoerFout } from '../vendor/vendor-invoer';
import { PlatformAdminGuard } from './platform-admin.guard';
import { leesNieuweTenant, leesSupportReden } from './platform-invoer';
import { PlatformService } from './platform.service';

/**
 * Platformbeheer: een tenant aanmaken, en tijdelijk meekijken (ADR-015).
 *
 * Twee guards op klasseniveau, in deze volgorde: TenantContextGuard stelt de
 * sessie vast, PlatformAdminGuard kijkt of die persoon platformbeheerder is.
 * Op klasseniveau en niet per methode — een nieuwe route hier zou de guard
 * anders kunnen missen, en dan staat platformbeheer open zonder dat iets rood
 * wordt. Zelfde afweging als in VendorController.
 *
 * ── De enige plek waar een tenant uit de invoer komt ─────────────────────────
 *
 * MCM2-CLAUDE.md §6 verbiedt een tenant in een header of URL, en
 * TenantContextGuard dwingt dat af voor de hele applicatie. Deze controller is
 * de uitzondering, en dat kan alleen omdat PlatformAdminGuard ervoor staat:
 * de tenant in het pad is niet wíé je bent, maar wáár je iets aan doet.
 *
 * Dat verschil is precies waarom platformbeheer een aparte tabel heeft en geen
 * rol binnen een tenant.
 */
@Controller('platform')
@UseGuards(TenantContextGuard, PlatformAdminGuard)
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Post('tenants')
  async tenantAanmaken(@Body() body: unknown) {
    try {
      const invoer = leesNieuweTenant(body);
      const tenant = await this.platform.tenantAanmaken(invoer);

      return {
        ...tenant,
        // De eerste admin kan pas inloggen nadat hij zich bij Entra heeft
        // gemeld; zijn oid koppelt dan aan deze rij. Het scherm hoort dat te
        // vertellen, anders lijkt een aangemaakte tenant onbruikbaar.
        melding:
          `Tenant aangemaakt. ${invoer.adminNaam} kan inloggen zodra hij zich ` +
          'met dit e-mailadres bij de identity provider aanmeldt.',
      };
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

  @Get('tenants/:id')
  async tenantLezen(@Param('id') id: string) {
    const tenant = await this.platform.tenantLezen(id);

    if (!tenant) {
      throw new NotFoundException('Onbekende tenant.');
    }

    return tenant;
  }

  /**
   * Tijdelijke support-toegang tot één tenant.
   *
   * Geen impersonatie: de beheerder komt binnen als zichzelf, in de rol
   * `support`, en blijft daarmee te onderscheiden van een medewerker van de
   * klant (Issue #57).
   */
  @Post('tenants/:id/toegang')
  async supportToegang(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: RequestMetSessie,
  ) {
    try {
      const reden = leesSupportReden(body);
      const bestaat = await this.platform.tenantLezen(id);

      if (!bestaat) {
        throw new NotFoundException('Onbekende tenant.');
      }

      // De sessie is gegarandeerd aanwezig: beide guards hebben gedraaid.
      const sessie = request.sessie!;

      return await this.platform.supportToegangGeven(id, sessie.userId, reden);
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
