import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './db/database.module';
import { HealthModule } from './health/health.module';
import { SurveyModule } from './survey/survey.module';

@Module({
  imports: [DatabaseModule, HealthModule, SurveyModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
