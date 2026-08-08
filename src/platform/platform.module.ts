import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

/**
 * Platformbeheer (ADR-015, migratie 0020).
 *
 * `AuthModule` levert TenantContextGuard; PlatformAdminGuard staat hier omdat
 * hij alleen door deze module gebruikt wordt. Een guard is een gewone
 * provider: zonder registratie kent NestJS hem niet en faalt het opstarten —
 * zichtbaar, niet stil.
 */
@Module({
  imports: [AuthModule],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformAdminGuard],
  exports: [PlatformService],
})
export class PlatformModule {}
