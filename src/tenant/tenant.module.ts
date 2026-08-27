import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { TenantController } from './tenant.controller';
import { TenantLedenController } from './tenant-leden.controller';
import { TenantLedenService } from './tenant-leden.service';
import { TenantService } from './tenant.service';

/**
 * Instellingen van de eigen omgeving.
 *
 * `AuthModule` wordt geïmporteerd omdat `TenantContextGuard` en `RolGuard`
 * daar vandaan komen. Een guard is een gewone provider: zonder die import kent
 * NestJS hem niet en faalt het opstarten — zichtbaar, niet stil.
 *
 * Los van `PlatformModule` met opzet: daar komt de tenant uit de invoer en
 * staat er een extra guard voor, hier komt hij uit de sessie. Zie de uitleg in
 * `tenant.controller.ts`.
 */
@Module({
  imports: [AuthModule, MailModule],
  controllers: [TenantController, TenantLedenController],
  providers: [TenantService, TenantLedenService],
  exports: [TenantService],
})
export class TenantModule {}
