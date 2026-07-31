import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { VendorController } from './vendor.controller';
import { VendorService } from './vendor.service';

/**
 * Leveranciersbeheer.
 *
 * `AuthModule` wordt geïmporteerd omdat `TenantContextGuard` daar vandaan komt.
 * Een guard is een gewone provider: zonder die import kent NestJS hem niet en
 * faalt het opstarten — zichtbaar, niet stil.
 */
@Module({
  imports: [AuthModule],
  controllers: [VendorController],
  providers: [VendorService],
  exports: [VendorService],
})
export class VendorModule {}
