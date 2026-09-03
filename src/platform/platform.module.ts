import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { FeatureModule } from '../features/feature.module';
import { MailModule } from '../mail/mail.module';
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
 *
 * `MailModule` levert UitnodigingVerzender, waarmee de nieuwe beheerder zijn
 * uitnodigingslink krijgt. Zonder RESEND_API_KEY is dat het logkanaal: de mail
 * belandt dan in het log en het token staat in het antwoord, dus een omgeving
 * zonder mailconfiguratie blijft bruikbaar.
 *
 * `FeatureModule` levert TenantFeatureService voor de tenant-features-routes
 * (spec 2026-09-03) — geregistreerd in `FeatureModule` zelf, hier alleen
 * geïmporteerd, niet opnieuw als provider.
 */
@Module({
  imports: [AuthModule, MailModule, FeatureModule],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformAdminGuard],
  exports: [PlatformService, PlatformAdminGuard],
})
export class PlatformModule {}
