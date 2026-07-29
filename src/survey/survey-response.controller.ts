import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Req,
  UseGuards,
  GoneException,
} from '@nestjs/common';

import { SurveyTokenGuard, type RequestMetToken } from './survey-token.guard';
import { SurveyTokenService } from './survey-token.service';
import { VragenlijstLeesService } from './vragenlijst-lezen.service';

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
  constructor(
    private readonly tokens: SurveyTokenService,
    private readonly vragenlijst: VragenlijstLeesService,
  ) {}

  /**
   * Toont of de link geldig is en tot wanneer.
   *
   * Retourneert bewust géén vendornaam of tenantgegevens: de leverancier weet
   * van wie hij de e-mail kreeg, en wie een geldig token bemachtigt hoort daar
   * niet extra informatie uit te halen.
   *
   * De vragenlijst zelf zit hier bewust niet in: dit is de goedkope controle
   * "werkt deze link nog", die het portaal doet vóórdat het de vragen ophaalt.
   * Zie GET /survey/respond/questions.
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
   * Levert de vragenlijst die bij deze link hoort.
   *
   * De `response_id` komt uit de guard, nooit uit de URL of de body — er
   * bestáát geen veld waarin een leverancier een andere respons kan benoemen.
   * Dat is testpunt 39: een interne beoordeling over dezelfde leverancier is
   * langs deze route niet bereikbaar, want de lookup gaat van token naar één
   * respons en nooit van vendor naar een verzameling.
   *
   * De vorm sluit aan op het model dat het leverancierportaal al gebruikt
   * (`MCM2-frontend/src/core/models/survey.ts`): categorieën en losse vragen
   * gescheiden, want een vragenlijst is óf ingedeeld (UC2) óf een platte lijst
   * (UC1).
   *
   * Retourneert bewust geen tenant, vendor of response-ID — dezelfde
   * terughoudendheid als bij de statusroute hierboven.
   */
  @Get('questions')
  async vragen(@Req() request: RequestMetToken) {
    const context = request.surveyToken!;

    const lijst = await this.vragenlijst.haalVragenlijst(
      context.tenantId,
      context.responseId,
    );

    // Een geldig token waarvan de ronde nog geen vragen heeft. Zeldzaam, maar
    // niet onmogelijk: een ronde kan gestart worden op een template die nog
    // leeg is. Een lege lijst teruggeven zou het portaal een formulier zonder
    // vragen laten tonen, wat er kapot uitziet zonder te zeggen waarom.
    if (!lijst) {
      throw new NotFoundException(
        'Er staat op dit moment geen vragenlijst klaar voor deze link.',
      );
    }

    return lijst;
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
