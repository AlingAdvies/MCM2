import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { SurveyAuditService } from './survey-audit.service';
import { SurveyResponseController } from './survey-response.controller';
import { SurveyTokenGuard } from './survey-token.guard';
import { SurveyTokenService } from './survey-token.service';
import { AntwoordIndienService } from './antwoord-indienen.service';
import { BestandOpslagService } from './bestand-opslag.service';
import { BijlageService } from './bijlage.service';
import { RondeBeheerService } from './ronde-beheer.service';
import { VragenlijstBeheerController } from './vragenlijst-beheer.controller';
import { VragenlijstBeheerService } from './vragenlijst-beheer.service';
import { VragenlijstImportService } from './vragenlijst-import.service';
import { VragenlijstLeesService } from './vragenlijst-lezen.service';

/**
 * Twee controllers, twee werelden, en dat verschil is opzettelijk.
 *
 * `SurveyResponseController` (`survey/respond`) is de leverancierskant: geen
 * account, alleen een token, achter `SurveyTokenGuard`.
 *
 * `VragenlijstBeheerController` (`admin/survey`) is de tenantkant: een
 * ingelogde medewerker achter `TenantContextGuard`. Sinds migratie 0013 kondigt
 * elk pad zich ook in de database aan als `leverancier` of `medewerker`.
 *
 * `AuthModule` wordt daarvoor geïmporteerd: `TenantContextGuard` komt daar
 * vandaan en heeft `SessieService` nodig. Zonder die import faalt het opstarten
 * met "Nest can't resolve dependencies of the TenantContextGuard" — zichtbaar,
 * niet stil. Zelfde reden als in VendorModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [SurveyResponseController, VragenlijstBeheerController],
  providers: [
    SurveyAuditService,
    SurveyTokenService,
    SurveyTokenGuard,
    VragenlijstBeheerService,
    RondeBeheerService,
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
    VragenlijstBeheerService,
    RondeBeheerService,
    VragenlijstImportService,
    VragenlijstLeesService,
    AntwoordIndienService,
    BestandOpslagService,
    BijlageService,
  ],
})
export class SurveyModule {}
