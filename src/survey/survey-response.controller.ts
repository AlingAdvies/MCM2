import {
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
  GoneException,
} from '@nestjs/common';

import { SurveyTokenGuard, type RequestMetToken } from './survey-token.guard';
import { SurveyTokenService } from './survey-token.service';

/**
 * De enige endpoints die een externe leverancier bereikt.
 *
 * Geen login, geen account: het token in de query-parameter `t` is de volledige
 * sleutel. `SurveyTokenGuard` leidt daaruit de tenantcontext af — nooit uit een
 * header of een ander clientveld (MCM2-CLAUDE.md §6, Issue #7).
 *
 * De guard staat op controller-niveau: elke route die hier bijkomt is
 * automatisch beschermd. Een nieuwe route vergeten te beveiligen is daarmee
 * geen mogelijkheid.
 */
@Controller('survey/respond')
@UseGuards(SurveyTokenGuard)
export class SurveyResponseController {
  constructor(private readonly tokens: SurveyTokenService) {}

  /**
   * Toont of de link geldig is en tot wanneer.
   *
   * Retourneert bewust géén vendornaam of tenantgegevens: de leverancier weet
   * van wie hij de e-mail kreeg, en wie een geldig token bemachtigt hoort daar
   * niet extra informatie uit te halen.
   *
   * De vragenlijst zelf zit hier nog niet in — die structuur hangt aan OV-6 en
   * OV-8, die nog openstaan bij de klant.
   */
  @Get()
  status(@Req() request: RequestMetToken) {
    // Non-null: de guard heeft dit gezet, anders was het verzoek al geweigerd.
    const context = request.surveyToken!;

    return {
      status: 'open' as const,
      verlooptOp: context.expiresAt.toISOString(),
    };
  }

  /**
   * Dient de response definitief in.
   *
   * Eenmalig en onomkeerbaar (OV-3, AC12). De atomaire update in de service
   * bepaalt wie wint bij gelijktijdige verzoeken; hier wordt alleen het
   * resultaat vertaald naar een HTTP-status.
   *
   * 200 bij succes, 410 Gone bij een tweede poging — dezelfde status die de
   * guard geeft voor een al ingediende link, zodat het gedrag consistent is
   * ongeacht welke laag het opmerkt.
   */
  @Post()
  @HttpCode(200)
  async dienIn(@Req() request: RequestMetToken) {
    const context = request.surveyToken!;

    const gelukt = await this.tokens.dienIn(
      context.tenantId,
      context.responseId,
    );

    if (!gelukt) {
      throw new GoneException('Deze vragenlijst is al ingediend.');
    }

    return { status: 'ingediend' as const };
  }
}
