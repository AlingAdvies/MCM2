import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  TenantContextGuard,
  type RequestMetSessie,
} from '../auth/tenant-context.guard';
import { InvoerFout, leesNieuweVendor } from './vendor-invoer';
import { VendorService, type NieuweVendor } from './vendor.service';

/**
 * De eerste beheerroutes van MCM2 (Issue #7 spoor 1, fase 2 van het plan).
 *
 * `@UseGuards(TenantContextGuard)` op klasseniveau, niet per route. Dat is
 * bewust: een guard per methode betekent dat een nieuwe route hem kan missen,
 * en dan is de tenantgrens open zonder dat iets rood wordt. Op klasseniveau
 * geldt hij voor alles wat hier bij komt.
 *
 * Dit is ook de plek waar de laag uit de vorige fase eindelijk gebruikt wordt.
 * Tot nu toe was TenantContextGuard gebouwd en bewezen maar nergens
 * aangesloten — dat stond als openstaand punt in
 * docs/architectuur-en-verificatie.md §8.
 */
@Controller('vendors')
@UseGuards(TenantContextGuard)
export class VendorController {
  constructor(private readonly vendors: VendorService) {}

  /**
   * De leveranciers van de ingelogde tenant.
   *
   * De tenantId komt van `request.sessie`, die de guard heeft gevuld uit een
   * databaselookup op de gehashte sessiesleutel. Er is geen queryparameter en
   * geen kopregel waarmee een andere tenant te benoemen valt.
   */
  @Get()
  async lijst(@Req() request: RequestMetSessie) {
    // De uitroeptekens zijn veilig: zonder sessie is de guard nooit voorbij
    // gekomen. Zelfde patroon als SurveyResponseController.
    const sessie = request.sessie!;

    const vendors = await this.vendors.lijst(sessie.tenantId);

    return { vendors };
  }

  /**
   * Maakt een leverancier aan, eventueel met contactpersoon.
   *
   * 201 bij succes, 400 bij ongeldige invoer (met het veld erbij), 409 wanneer
   * het KvK-nummer al bestaat binnen deze tenant.
   */
  @Post()
  @HttpCode(201)
  async maakAan(@Req() request: RequestMetSessie, @Body() body: unknown) {
    const sessie = request.sessie!;

    let invoer: NieuweVendor;

    try {
      invoer = leesNieuweVendor(body);
    } catch (err) {
      if (err instanceof InvoerFout) {
        // Het veld gaat mee zodat het scherm de melding naast het juiste
        // invoerveld kan tonen in plaats van bovenaan de pagina — dezelfde
        // les als bij de 422 in het leverancierportaal (Issue #42).
        throw new BadRequestException({
          message: err.message,
          veld: err.veld,
        });
      }
      throw err;
    }

    const aangemaakt = await this.vendors.maakAan(sessie.tenantId, invoer);

    return aangemaakt;
  }
}
