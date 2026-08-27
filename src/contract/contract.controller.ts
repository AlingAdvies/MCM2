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
  leesContractWijziging,
  leesNieuwContract,
  leesSurveyTemplateKoppeling,
  type SurveyTemplateKoppelingInvoer,
} from './contract-invoer';
import {
  ContractService,
  type ContractWijziging,
  type NieuwContract,
} from './contract.service';

/**
 * Contractroutes, altijd in de context van een leverancier.
 *
 * Zelfde beveiligingspatroon als VendorController: guards op klasseniveau,
 * schrijven vereist de rol admin.
 */
@Controller('vendors/:vendorId/contracts')
@UseGuards(TenantContextGuard, RolGuard)
export class ContractController {
  constructor(private readonly contracts: ContractService) {}

  @Get()
  async lijst(
    @Req() request: RequestMetSessie,
    @Param('vendorId') vendorId: string,
  ) {
    const sessie = request.sessie!;

    const contracten = await this.contracts.lijst(
      sessie.tenantId,
      leesUuid(vendorId),
    );

    return { contracten };
  }

  @Post()
  @VereistRol('admin', 'user')
  @HttpCode(201)
  async maakAan(
    @Req() request: RequestMetSessie,
    @Param('vendorId') vendorId: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let invoer: NieuwContract;

    try {
      invoer = leesNieuwContract(body);
    } catch (err) {
      throw alsHttpFout(err);
    }

    const contract = await this.contracts
      .maakAan(sessie.tenantId, leesUuid(vendorId), invoer)
      .catch(alsRefFout);

    if (!contract) {
      throw new NotFoundException('Leverancier niet gevonden.');
    }

    return contract;
  }

  @Get(':id')
  async detail(
    @Req() request: RequestMetSessie,
    @Param('vendorId') vendorId: string,
    @Param('id') id: string,
  ) {
    const sessie = request.sessie!;

    const contract = await this.contracts.detail(
      sessie.tenantId,
      leesUuid(vendorId),
      leesUuid(id),
    );

    if (!contract) {
      throw new NotFoundException('Contract niet gevonden.');
    }

    return contract;
  }

  @Patch(':id')
  @VereistRol('admin', 'user')
  async wijzig(
    @Req() request: RequestMetSessie,
    @Param('vendorId') vendorId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let wijziging: ContractWijziging;

    try {
      wijziging = leesContractWijziging(body);
    } catch (err) {
      throw alsHttpFout(err);
    }

    const contract = await this.contracts
      .wijzig(sessie.tenantId, leesUuid(vendorId), leesUuid(id), wijziging)
      .catch(alsRefFout);

    if (!contract) {
      throw new NotFoundException('Contract niet gevonden.');
    }

    return contract;
  }

  @Delete(':id')
  @VereistRol('admin', 'user')
  @HttpCode(204)
  async verwijder(
    @Req() request: RequestMetSessie,
    @Param('vendorId') vendorId: string,
    @Param('id') id: string,
  ) {
    const sessie = request.sessie!;

    const gelukt = await this.contracts.verwijder(
      sessie.tenantId,
      leesUuid(vendorId),
      leesUuid(id),
    );

    if (!gelukt) {
      throw new NotFoundException('Contract niet gevonden.');
    }
  }

  @Get(':id/survey-templates')
  async surveyTemplates(
    @Req() request: RequestMetSessie,
    @Param('vendorId') vendorId: string,
    @Param('id') id: string,
  ) {
    const sessie = request.sessie!;

    const koppeling = await this.contracts.surveyTemplates(
      sessie.tenantId,
      leesUuid(vendorId),
      leesUuid(id),
    );

    if (!koppeling) {
      throw new NotFoundException('Contract niet gevonden.');
    }

    return koppeling;
  }

  @Put(':id/survey-templates')
  @VereistRol('admin', 'user')
  async zetSurveyTemplates(
    @Req() request: RequestMetSessie,
    @Param('vendorId') vendorId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let invoer: SurveyTemplateKoppelingInvoer;

    try {
      invoer = leesSurveyTemplateKoppeling(body);
    } catch (err) {
      throw alsHttpFout(err);
    }

    const koppeling = await this.contracts
      .zetSurveyTemplates(
        sessie.tenantId,
        leesUuid(vendorId),
        leesUuid(id),
        invoer.templateIds,
        invoer.wachtlijstTemplateIds,
      )
      .catch(alsRefFout);

    if (!koppeling) {
      throw new NotFoundException('Contract niet gevonden.');
    }

    return koppeling;
  }
}

const UUID_PATROON =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function leesUuid(waarde: string): string {
  if (!UUID_PATROON.test(waarde)) {
    throw new NotFoundException('Niet gevonden.');
  }

  return waarde;
}

function alsHttpFout(err: unknown): unknown {
  if (err instanceof InvoerFout) {
    return new BadRequestException({ message: err.message, veld: err.veld });
  }

  return err;
}

/**
 * Een onbekende status_code, vendor_contact_id of owner_user_id is een
 * gebruikersfout, geen storing. Zelfde vertaling als bij VendorController.
 */
function alsRefFout(err: unknown): never {
  const code = (err as { cause?: { code?: string }; code?: string })?.cause
    ?.code;

  if (code === '23503') {
    throw new BadRequestException({
      message: 'Onbekende status, contactpersoon of contractbeheerder.',
      veld: 'statusCode',
    });
  }

  throw err;
}
