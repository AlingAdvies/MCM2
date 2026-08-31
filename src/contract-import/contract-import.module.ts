import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PlatformModule } from '../platform/platform.module';
import { ContractImportAuditService } from './contract-import-audit.service';
import { ContractImportController } from './contract-import.controller';
import { ContractImportService } from './contract-import.service';

/**
 * Admin-only contract-import (#198).
 *
 * `AuthModule` levert `TenantContextGuard`, `PlatformModule` levert
 * `PlatformAdminGuard` (geëxporteerd zodat deze module hem kan hergebruiken
 * in plaats van een tweede registratie van dezelfde guard).
 */
@Module({
  imports: [AuthModule, PlatformModule],
  controllers: [ContractImportController],
  providers: [ContractImportService, ContractImportAuditService],
})
export class ContractImportModule {}
