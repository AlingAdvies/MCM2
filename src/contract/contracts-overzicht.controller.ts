import { Controller, Get, Req, UseGuards } from '@nestjs/common';

import { RolGuard } from '../auth/rol.guard';
import {
  TenantContextGuard,
  type RequestMetSessie,
} from '../auth/tenant-context.guard';
import { ContractService } from './contract.service';

/**
 * Contracten van de hele tenant, ongeacht leverancier (issue #173) — het
 * tenant-brede tegenhanger van ContractController, die altijd onder een
 * vendor-pad hangt. Geen `@VereistRol`: lezen mag elke geldige sessie,
 * consistent met de vendor-gescoped lijst en de andere tenant-brede
 * overzichten (leveranciers, vragenlijsten).
 */
@Controller('contracts')
@UseGuards(TenantContextGuard, RolGuard)
export class ContractsOverzichtController {
  constructor(private readonly contracts: ContractService) {}

  @Get()
  async lijst(@Req() request: RequestMetSessie) {
    const sessie = request.sessie!;
    const contracten = await this.contracts.lijstTenantBreed(sessie.tenantId);
    return { contracten };
  }
}
