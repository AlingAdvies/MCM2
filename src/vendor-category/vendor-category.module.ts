import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { VendorCategoryController } from './vendor-category.controller';
import { VendorCategoryService } from './vendor-category.service';

/**
 * Beheer van tenant-eigen vendor-categorieën (#186).
 *
 * AuthModule voor TenantContextGuard, zelfde reden als VendorModule/ContractModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [VendorCategoryController],
  providers: [VendorCategoryService],
  exports: [VendorCategoryService],
})
export class VendorCategoryModule {}
