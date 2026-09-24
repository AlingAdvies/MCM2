import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BestandOpslagService } from '../survey/bestand-opslag.service';
import { VendorController } from './vendor.controller';
import { VendorEngagementController } from './vendor-engagement.controller';
import { VendorEngagementService } from './vendor-engagement.service';
import { VendorService } from './vendor.service';

/**
 * Leveranciersbeheer.
 *
 * `AuthModule` wordt geïmporteerd omdat `TenantContextGuard` daar vandaan komt.
 * Een guard is een gewone provider: zonder die import kent NestJS hem niet en
 * faalt het opstarten — zichtbaar, niet stil.
 *
 * `BestandOpslagService` staat ook als provider in `SurveyModule` — geen
 * module-koppeling hier, de klasse heeft geen state die tussen de twee moet
 * worden gedeeld, dus een tweede eigen registratie is de eenvoudigste route.
 */
@Module({
  imports: [AuthModule],
  controllers: [VendorController, VendorEngagementController],
  providers: [VendorService, VendorEngagementService, BestandOpslagService],
  exports: [VendorService, VendorEngagementService],
})
export class VendorModule {}
