import { Module } from '@nestjs/common';

import { SurveyAuditService } from './survey-audit.service';
import { SurveyResponseController } from './survey-response.controller';
import { SurveyTokenGuard } from './survey-token.guard';
import { SurveyTokenService } from './survey-token.service';
import { VragenlijstImportService } from './vragenlijst-import.service';

@Module({
  controllers: [SurveyResponseController],
  providers: [
    SurveyAuditService,
    SurveyTokenService,
    SurveyTokenGuard,
    VragenlijstImportService,
  ],
  exports: [
    SurveyAuditService,
    SurveyTokenService,
    SurveyTokenGuard,
    VragenlijstImportService,
  ],
})
export class SurveyModule {}
