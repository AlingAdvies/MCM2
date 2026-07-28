import { Module } from '@nestjs/common';

import { SurveyAuditService } from './survey-audit.service';
import { SurveyResponseController } from './survey-response.controller';
import { SurveyTokenGuard } from './survey-token.guard';
import { SurveyTokenService } from './survey-token.service';

@Module({
  controllers: [SurveyResponseController],
  providers: [SurveyAuditService, SurveyTokenService, SurveyTokenGuard],
  exports: [SurveyAuditService, SurveyTokenService, SurveyTokenGuard],
})
export class SurveyModule {}
