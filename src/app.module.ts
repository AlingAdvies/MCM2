import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ContractImportModule } from './contract-import/contract-import.module';
import { ContractModule } from './contract/contract.module';
import { DatabaseModule } from './db/database.module';
import { FeatureModule } from './features/feature.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { PlatformModule } from './platform/platform.module';
import { SurveyModule } from './survey/survey.module';
import { TenantModule } from './tenant/tenant.module';
import { VendorCategoryModule } from './vendor-category/vendor-category.module';
import { VendorModule } from './vendor/vendor.module';

@Module({
  imports: [
    DatabaseModule,
    FeatureModule,
    HealthModule,
    SurveyModule,
    AuthModule,
    VendorModule,
    VendorCategoryModule,
    ContractModule,
    ContractImportModule,
    MailModule,
    PlatformModule,
    TenantModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
