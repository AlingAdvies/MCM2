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
  leesNieuwWerkingsgebied,
  leesWerkingsgebiedWijziging,
} from './werkingsgebied-invoer';
import { WerkingsgebiedService } from './werkingsgebied.service';

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
 * Beheer van de eigen werkingsgebieden (concessies, organisatie-onderdelen),
 * per tenant (#234). Zelfde opzet als VendorCategoryController.
 */
@Controller('werkingsgebieden')
@UseGuards(TenantContextGuard, RolGuard)
export class WerkingsgebiedController {
  constructor(private readonly gebieden: WerkingsgebiedService) {}

  @Get()
  async lijst(@Req() request: RequestMetSessie) {
    const sessie = request.sessie!;
    const werkingsgebieden = await this.gebieden.lijst(sessie.tenantId);

    return { werkingsgebieden };
  }

  @Post()
  @VereistRol('admin')
  @HttpCode(201)
  async maakAan(@Req() request: RequestMetSessie, @Body() body: unknown) {
    const sessie = request.sessie!;

    try {
      const invoer = leesNieuwWerkingsgebied(body);

      return await this.gebieden
        .maakAan(sessie.tenantId, invoer)
        .catch(alsDuplicaatFout);
    } catch (err) {
      throw alsHttpFout(err);
    }
  }

  @Patch(':code')
  @VereistRol('admin')
  async wijzig(
    @Req() request: RequestMetSessie,
    @Param('code') code: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let wijziging;
    try {
      wijziging = leesWerkingsgebiedWijziging(body);
    } catch (err) {
      throw alsHttpFout(err);
    }

    const resultaat = await this.gebieden.wijzig(
      sessie.tenantId,
      code,
      wijziging,
    );

    if (!resultaat) {
      throw new NotFoundException('Werkingsgebied niet gevonden.');
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
    const verwijderd = await this.gebieden.verwijder(sessie.tenantId, code);

    if (!verwijderd) {
      throw new NotFoundException('Werkingsgebied niet gevonden.');
    }
  }
}
