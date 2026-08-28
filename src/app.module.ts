import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ContractModule } from './contract/contract.module';
import { DatabaseModule } from './db/database.module';
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
    HealthModule,
    SurveyModule,
    AuthModule,
    VendorModule,
    VendorCategoryModule,
    ContractModule,
    MailModule,
    PlatformModule,
    TenantModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
