import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { WerkingsgebiedController } from './werkingsgebied.controller';
import { WerkingsgebiedService } from './werkingsgebied.service';

/**
 * Beheer van tenant-eigen werkingsgebieden (#234).
 *
 * AuthModule voor TenantContextGuard, zelfde reden als VendorCategoryModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [WerkingsgebiedController],
  providers: [WerkingsgebiedService],
  exports: [WerkingsgebiedService],
})
export class WerkingsgebiedModule {}
