import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
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
import {
  InvoerFout,
  leesNieuweVendorCategorie,
  leesVendorCategorieWijziging,
} from './vendor-category-invoer';
import { VendorCategoryService } from './vendor-category.service';

function alsHttpFout(err: unknown): unknown {
  if (err instanceof InvoerFout) {
    return new BadRequestException({ message: err.message, veld: err.veld });
  }

  return err;
}

function alsDuplicaatFout(err: unknown): never {
  const code = (err as { cause?: { code?: string }; code?: string })?.cause
    ?.code;

  if (code === '23505') {
    throw new BadRequestException({
      message: 'Deze code bestaat al.',
      veld: 'code',
    });
  }

  throw err;
}

/**
 * Beheer van de eigen vendor-categorieën, per tenant (#186).
 *
 * Sinds migratie 0034 is ref.vendor_category tenant-scoped — dit scherm is
 * de enige manier om de lijst zelf aan te passen (naast de uploadtool die
 * een onbekende Coupa-waarde kan aanmaken, zie #190).
 */
@Controller('vendor-categories')
@UseGuards(TenantContextGuard, RolGuard)
export class VendorCategoryController {
  constructor(private readonly categories: VendorCategoryService) {}

  @Get()
  async lijst(@Req() request: RequestMetSessie) {
    const sessie = request.sessie!;
    const categorieen = await this.categories.lijst(sessie.tenantId);

    return { categorieen };
  }

  @Post()
  @VereistRol('admin')
  @HttpCode(201)
  async maakAan(@Req() request: RequestMetSessie, @Body() body: unknown) {
    const sessie = request.sessie!;

    try {
      const invoer = leesNieuweVendorCategorie(body);

      return await this.categories
        .maakAan(sessie.tenantId, invoer)
        .catch(alsDuplicaatFout);
    } catch (err) {
      throw alsHttpFout(err);
    }
  }

  @Put(':code')
  @VereistRol('admin')
  async wijzig(
    @Req() request: RequestMetSessie,
    @Param('code') code: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let wijziging;
    try {
      wijziging = leesVendorCategorieWijziging(body);
    } catch (err) {
      throw alsHttpFout(err);
    }

    const resultaat = await this.categories.wijzig(
      sessie.tenantId,
      code,
      wijziging,
    );

    if (!resultaat) {
      throw new NotFoundException('Categorie niet gevonden.');
    }

    return resultaat;
  }

  @Delete(':code')
  @VereistRol('admin')
  @HttpCode(204)
  async verwijder(
    @Req() request: RequestMetSessie,
    @Param('code') code: string,
  ) {
    const sessie = request.sessie!;
    const verwijderd = await this.categories.verwijder(sessie.tenantId, code);

    if (!verwijderd) {
      throw new NotFoundException('Categorie niet gevonden.');
    }
  }
}
