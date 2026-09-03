import { Module } from '@nestjs/common';

import { TenantFeatureService } from './tenant-feature.service';

/**
 * Per-tenant feature-entitlements (spec
 * docs/superpowers/specs/2026-09-03-tenant-feature-entitlements-design.md).
 *
 * Exporteert TenantFeatureService voor PlatformModule (de schakelroutes) en
 * AuthModule (het features-veld op GET /auth/sessie).
 */
@Module({
  providers: [TenantFeatureService],
  exports: [TenantFeatureService],
})
export class FeatureModule {}
