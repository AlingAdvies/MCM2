import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessieService } from './sessie.service';
import { TenantContextGuard } from './tenant-context.guard';

/**
 * De identity-laag (Issue #7, spoor 1).
 *
 * `SessieService` en `TenantContextGuard` worden geëxporteerd omdat elke module
 * met beheerroutes de guard nodig heeft. `AuthService` niet: die is er alleen
 * voor de inlogflow zelf, en een tweede aanroeper zou betekenen dat er ergens
 * anders ook sessies gemaakt worden.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, SessieService, TenantContextGuard],
  exports: [SessieService, TenantContextGuard],
})
export class AuthModule {}
