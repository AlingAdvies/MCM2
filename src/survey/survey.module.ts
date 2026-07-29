import { Module } from '@nestjs/common';

import { SurveyAuditService } from './survey-audit.service';
import { SurveyResponseController } from './survey-response.controller';
import { SurveyTokenGuard } from './survey-token.guard';
import { SurveyTokenService } from './survey-token.service';
import { AntwoordIndienService } from './antwoord-indienen.service';
import { BestandOpslagService } from './bestand-opslag.service';
import { BijlageService } from './bijlage.service';
import { VragenlijstImportService } from './vragenlijst-import.service';
import { VragenlijstLeesService } from './vragenlijst-lezen.service';

@Module({
  controllers: [SurveyResponseController],
  providers: [
    SurveyAuditService,
    SurveyTokenService,
    SurveyTokenGuard,
    VragenlijstImportService,
    VragenlijstLeesService,
    AntwoordIndienService,
    BestandOpslagService,
    BijlageService,
  ],
  exports: [
    SurveyAuditService,
    SurveyTokenService,
    SurveyTokenGuard,
    VragenlijstImportService,
    VragenlijstLeesService,
    AntwoordIndienService,
    BestandOpslagService,
    BijlageService,
  ],
})
export class SurveyModule {}
