import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ContractController } from './contract.controller';
import { ContractService } from './contract.service';
import { ContractsOverzichtController } from './contracts-overzicht.controller';

/**
 * Contractbeheer bij een leverancier, plus het tenant-brede overzicht
 * (issue #173).
 *
 * AuthModule voor TenantContextGuard, zelfde reden als VendorModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [ContractController, ContractsOverzichtController],
  providers: [ContractService],
  exports: [ContractService],
})
export class ContractModule {}
