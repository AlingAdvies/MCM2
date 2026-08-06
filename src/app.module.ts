import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './db/database.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { SurveyModule } from './survey/survey.module';
import { VendorModule } from './vendor/vendor.module';

@Module({
  imports: [
    DatabaseModule,
    HealthModule,
    SurveyModule,
    AuthModule,
    VendorModule,
    MailModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
