import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  GoneException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { AntwoordIndienService } from './antwoord-indienen.service';
import { BijlageService } from './bijlage.service';
import { MAX_BESTANDSGROOTTE } from './bestand-validatie';
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
    private readonly indienen: AntwoordIndienService,
    private readonly bijlagen: BijlageService,
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
   * Dient de response definitief in, met de antwoorden.
   *
   * Eenmalig en onomkeerbaar (OV-3, AC12). De atomaire update in de service
   * bepaalt wie wint bij gelijktijdige verzoeken; hier wordt alleen het
   * resultaat vertaald naar een HTTP-status.
   *
   * Drie uitkomsten:
   *
   *   200  ingediend
   *   422  de antwoorden voldoen niet — met per vraag de reden
   *   410  al ingediend, verlopen of ronde gesloten
   *
   * 410 is dezelfde status die de guard geeft voor een al ingediende link,
   * zodat het gedrag consistent is ongeacht welke laag het opmerkt.
   *
   * Bij een 422 is er niets weggeschreven en blijft de link bruikbaar
   * (testpunt 25). Dat is essentieel: het token is gehasht en dus niet opnieuw
   * te versturen, dus een half verbruikte link zou onherstelbaar zijn.
   */
  @Post()
  @HttpCode(200)
  async dienIn(
    @Req() request: RequestMetToken,
    @Body() body: { answers?: unknown } | undefined,
  ) {
    const context = request.surveyToken!;

    const uitkomst = await this.indienen.dienIn(
      context.tenantId,
      context.responseId,
      body?.answers ?? [],
    );

    if (uitkomst.status === 'ongeldig') {
      // De vorm uit ontwerp §5: question_key en een machineleesbare reden.
      // Een 422 die alleen "validation failed" zegt, is voor een leverancier
      // onbruikbaar.
      throw new UnprocessableEntityException({
        status: 'invalid',
        errors: uitkomst.fouten,
      });
    }

    if (uitkomst.status === 'niet-meer-open') {
      throw new GoneException('Deze vragenlijst is al ingediend.');
    }

    return { status: 'ingediend' as const };
  }

  /**
   * Neemt één bijlage aan bij een vraag, vóór het indienen.
   *
   * Per bestand en niet als onderdeel van de indien-POST: acht certificaten in
   * één request zou betekenen dat één mislukte upload de hele indiening ongedaan
   * maakt, en dat de groottegrens per request in plaats van per bestand geldt.
   *
   * **De grens ligt in de ontvangstlaag, niet erna** (§6). `limits.fileSize`
   * breekt de upload af zodra 5 MB gepasseerd is; zonder dat zou een upload van
   * 500 MB eerst volledig in het geheugen komen en daarna pas geweigerd worden
   * — een geheugenprobleem in plaats van een validatieregel.
   *
   * Bewust in het geheugen en niet naar een tijdelijke map: bij 5 MB is dat
   * goedkoop, en het scheelt een tweede plek waar een bestand kan achterblijven
   * als er iets misgaat.
   */
  @Post('attachment')
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_BESTANDSGROOTTE, files: 1 },
    }),
  )
  async voegBijlageToe(
    @Req() request: RequestMetToken,
    @Query('question') questionKey: string | undefined,
    @UploadedFile()
    bestand:
      { originalname: string; mimetype?: string; buffer: Buffer } | undefined,
  ) {
    const context = request.surveyToken!;

    if (!questionKey) {
      throw new BadRequestException(
        'Geef met de parameter `question` aan bij welke vraag dit bestand hoort.',
      );
    }

    if (!bestand) {
      throw new BadRequestException('Er is geen bestand meegestuurd.');
    }

    const uitkomst = await this.bijlagen.voegToe(
      context.tenantId,
      context.responseId,
      questionKey,
      bestand,
    );

    switch (uitkomst.status) {
      case 'opgeslagen':
        return {
          status: 'opgeslagen' as const,
          attachmentId: uitkomst.attachmentId,
          // Wat de server heeft vastgesteld uit de bytes, niet wat de client
          // beweerde. Teruggeven maakt zichtbaar dat er gecontroleerd is.
          contentType: uitkomst.contentType,
        };

      case 'afgekeurd':
        if (uitkomst.reden === 'te-groot') {
          throw new PayloadTooLargeException('Dit bestand is groter dan 5 MB.');
        }
        throw new UnprocessableEntityException({
          status: 'invalid_file',
          reason: uitkomst.reden,
        });

      case 'onbekende-vraag':
        throw new NotFoundException(
          'Deze vraag hoort niet bij deze vragenlijst.',
        );

      case 'geen-upload-vraag':
        throw new UnprocessableEntityException({
          status: 'invalid_file',
          reason: 'question_accepts_no_files',
        });

      case 'te-veel-bestanden':
        throw new UnprocessableEntityException({
          status: 'invalid_file',
          reason: 'too_many_files',
          maximum: uitkomst.maximum,
        });

      case 'niet-meer-open':
        throw new GoneException('Deze vragenlijst is al ingediend.');
    }
  }
}
