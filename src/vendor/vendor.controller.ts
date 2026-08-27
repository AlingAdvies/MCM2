import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
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
import {
  InvoerFout,
  leesContact,
  leesNieuweVendor,
  leesThemaCodes,
  leesVendorWijziging,
} from './vendor-invoer';
import {
  VendorService,
  type ContactInvoer,
  type NieuweVendor,
  type VendorWijziging,
} from './vendor.service';

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
@UseGuards(TenantContextGuard, RolGuard)
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
  // `user` mag hetzelfde als `admin` op deze route (issue #75) — de
  // uitzonderingen staan in vragenlijst-beheer.controller.ts.
  @Post()
  @VereistRol('admin', 'user')
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

  /**
   * Eén leverancier met zijn contactpersonen.
   *
   * 404 bij onbekend, verwijderd óf van een andere tenant. Die drie zijn
   * bewust niet te onderscheiden — een apart antwoord zou verklappen dat een
   * id elders wél bestaat.
   */
  @Get(':id')
  async detail(@Req() request: RequestMetSessie, @Param('id') id: string) {
    const sessie = request.sessie!;

    const vendor = await this.vendors.detail(sessie.tenantId, leesUuid(id));

    if (!vendor) {
      throw new NotFoundException('Leverancier niet gevonden.');
    }

    return vendor;
  }

  /**
   * Wijzigt een leverancier. Alleen de meegestuurde velden.
   *
   * `@VereistRol('admin', 'user')`: een reviewer mag lezen maar niet
   * schrijven. `user` mag hetzelfde als `admin` (issue #75). De controle
   * staat hier en niet alleen in het scherm — een verborgen knop bij een
   * open route is geen beveiliging.
   */
  @Patch(':id')
  @VereistRol('admin', 'user')
  async wijzig(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let wijziging: VendorWijziging;

    try {
      wijziging = leesVendorWijziging(body);
    } catch (err) {
      throw alsHttpFout(err);
    }

    const vendor = await this.vendors
      .wijzig(sessie.tenantId, leesUuid(id), wijziging)
      .catch(alsRefFout);

    if (!vendor) {
      throw new NotFoundException('Leverancier niet gevonden.');
    }

    return vendor;
  }

  /**
   * Vervangt de compliance-thema's van een leverancier.
   *
   * PUT, niet PATCH: de body is altijd de complete gewenste set, geen
   * gedeeltelijke wijziging. Een onbekende thema-code geeft een 400 (foreign
   * key-fout omgezet, zelfde patroon als alsRefFout()).
   */
  @Put(':id/compliance-themas')
  @VereistRol('admin', 'user')
  async zetComplianceThemas(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let themaCodes: string[];

    try {
      themaCodes = leesThemaCodes(body);
    } catch (err) {
      throw alsHttpFout(err);
    }

    const vendor = await this.vendors
      .zetComplianceThemas(sessie.tenantId, leesUuid(id), themaCodes)
      .catch(alsThemaRefFout);

    if (!vendor) {
      throw new NotFoundException('Leverancier niet gevonden.');
    }

    return vendor;
  }

  /** Verwijdert een leverancier — soft delete, inclusief zijn contactpersonen. */
  @Delete(':id')
  @VereistRol('admin', 'user')
  @HttpCode(204)
  async verwijder(@Req() request: RequestMetSessie, @Param('id') id: string) {
    const sessie = request.sessie!;

    const gelukt = await this.vendors.verwijder(sessie.tenantId, leesUuid(id));

    if (!gelukt) {
      throw new NotFoundException('Leverancier niet gevonden.');
    }
  }

  // ── Contactpersonen ──────────────────────────────────────────────────────

  @Post(':id/contacts')
  @VereistRol('admin', 'user')
  @HttpCode(201)
  async voegContactToe(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let invoer: ContactInvoer;

    try {
      invoer = leesContact(body, true);
    } catch (err) {
      throw alsHttpFout(err);
    }

    const contact = await this.vendors.voegContactToe(
      sessie.tenantId,
      leesUuid(id),
      invoer,
    );

    if (!contact) {
      throw new NotFoundException('Leverancier niet gevonden.');
    }

    return contact;
  }

  @Patch(':id/contacts/:contactId')
  @VereistRol('admin', 'user')
  async wijzigContact(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Param('contactId') contactId: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let invoer: ContactInvoer;

    try {
      invoer = leesContact(body, false);
    } catch (err) {
      throw alsHttpFout(err);
    }

    const contact = await this.vendors.wijzigContact(
      sessie.tenantId,
      leesUuid(id),
      leesUuid(contactId),
      invoer,
    );

    if (!contact) {
      throw new NotFoundException('Contactpersoon niet gevonden.');
    }

    return contact;
  }

  @Delete(':id/contacts/:contactId')
  @VereistRol('admin', 'user')
  @HttpCode(204)
  async verwijderContact(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Param('contactId') contactId: string,
  ) {
    const sessie = request.sessie!;

    const gelukt = await this.vendors.verwijderContact(
      sessie.tenantId,
      leesUuid(id),
      leesUuid(contactId),
    );

    if (!gelukt) {
      throw new NotFoundException('Contactpersoon niet gevonden.');
    }
  }
}

const UUID_PATROON =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Controleert de vorm van een id vóór de database geraadpleegd wordt.
 *
 * Zonder deze controle levert `/vendors/onzin` een databasefout op ("invalid
 * input syntax for type uuid") die als 500 naar buiten komt. Dat is een fout
 * van de aanvrager, geen storing — en een 500 in het log leidt de aandacht weg
 * van echte problemen. Zelfde redenering als `heeftGeldigeVorm()` bij het
 * surveytoken.
 */
function leesUuid(waarde: string): string {
  if (!UUID_PATROON.test(waarde)) {
    throw new NotFoundException('Leverancier niet gevonden.');
  }

  return waarde;
}

/** Zet een InvoerFout om naar een 400 met het veld erbij. */
function alsHttpFout(err: unknown): unknown {
  if (err instanceof InvoerFout) {
    return new BadRequestException({ message: err.message, veld: err.veld });
  }

  return err;
}

/**
 * Een onbekende classificatiecode is een gebruikersfout, geen storing.
 *
 * De drie code-velden hebben een foreign key naar `ref.vendor_category`,
 * `ref.business_criticality` en `ref.compliance_status`. Een waarde die daar
 * niet in staat geeft een `23503`-fout, en die zou zonder deze vertaling als
 * 500 naar buiten komen — terwijl het scherm gewoon een verkeerde code stuurde.
 */
function alsRefFout(err: unknown): never {
  const code = (err as { cause?: { code?: string }; code?: string })?.cause
    ?.code;

  if (code === '23503') {
    throw new BadRequestException({
      message: 'Onbekende categorie, criticality of compliancestatus.',
      veld: 'categoryCode',
    });
  }

  throw err;
}

/**
 * Een onbekende thema-code is een gebruikersfout, geen storing.
 *
 * `thema_code` heeft een foreign key naar `ref.compliance_thema`. Een waarde
 * die daar niet in staat geeft een `23503`-fout — zelfde patroon als
 * alsRefFout(), maar met een ander veld in de melding.
 */
function alsThemaRefFout(err: unknown): never {
  const code = (err as { cause?: { code?: string }; code?: string })?.cause
    ?.code;

  if (code === '23503') {
    throw new BadRequestException({
      message: 'Onbekend compliance-thema.',
      veld: 'themaCodes',
    });
  }

  throw err;
}
