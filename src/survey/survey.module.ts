import { Module } from '@nestjs/common';

import { SurveyTokenGuard } from './survey-token.guard';
import { SurveyTokenService } from './survey-token.service';

@Module({
  providers: [SurveyTokenService, SurveyTokenGuard],
  exports: [SurveyTokenService, SurveyTokenGuard],
})
export class SurveyModule {}
