import { Module } from '@nestjs/common';

import { FeatureModule } from '../features/feature.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RolGuard } from './rol.guard';
import { SessieService } from './sessie.service';
import { TenantContextGuard } from './tenant-context.guard';

/**
 * De identity-laag (Issue #7, spoor 1).
 *
 * `SessieService`, `TenantContextGuard` en `RolGuard` worden geëxporteerd omdat
 * elke module met beheerroutes ze nodig heeft. `AuthService` niet: die is er
 * alleen voor de inlogflow zelf, en een tweede aanroeper zou betekenen dat er
 * ergens anders ook sessies gemaakt worden.
 *
 * De twee guards zijn bewust gescheiden: TenantContextGuard stelt vast wie er
 * is, RolGuard wat die persoon mag. Zie de kop van rol.guard.ts.
 *
 * `FeatureModule` levert TenantFeatureService voor het features-veld op
 * GET /auth/sessie (spec 2026-09-03).
 */
@Module({
  imports: [FeatureModule],
  controllers: [AuthController],
  providers: [AuthService, SessieService, TenantContextGuard, RolGuard],
  exports: [SessieService, TenantContextGuard, RolGuard],
})
export class AuthModule {}
