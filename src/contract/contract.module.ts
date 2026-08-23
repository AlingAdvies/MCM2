import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ContractController } from './contract.controller';
import { ContractService } from './contract.service';

/**
 * Contractbeheer bij een leverancier.
 *
 * AuthModule voor TenantContextGuard, zelfde reden als VendorModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [ContractController],
  providers: [ContractService],
  exports: [ContractService],
})
export class ContractModule {}
