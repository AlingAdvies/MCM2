import {
  CanActivate,
  ExecutionContext,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';

import { SurveyTokenService, type WeigerReden } from './survey-token.service';

/**
 * De tenantcontext die uit een geverifieerd token is afgeleid.
 * Nooit uit clientinput — zie SurveyTokenService.
 */
export interface SurveyTokenContext {
  responseId: string;
  tenantId: string;
  expiresAt: Date;
}

/** Request met de context die deze guard eraan toevoegt. */
export interface RequestMetToken extends Request {
  surveyToken?: SurveyTokenContext;
}

const NEDERLANDSE_DATUM = new Intl.DateTimeFormat('nl-NL', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * Meldingen per weigerreden.
 *
 * Onbekend en ingetrokken geven bewust dezelfde tekst én status: een
 * ingetrokken token mag niet te onderscheiden zijn van een niet-bestaand
 * token, anders wordt de foutmelding zelf informatie.
 *
 * Bij 'vendor-inactief' staat bewust geen uitleg over wát er met de
 * leverancier gebeurd is — dat is interne informatie van de klant. Wel een
 * duidelijk eindpunt in plaats van een lege pagina of een crash.
 */
function melding(reden: WeigerReden, datum?: Date): string {
  const wanneer = datum ? NEDERLANDSE_DATUM.format(datum) : null;

  switch (reden) {
    case 'al-ingediend':
      return wanneer
        ? `Deze vragenlijst is al ingediend op ${wanneer}.`
        : 'Deze vragenlijst is al ingediend.';
    case 'verlopen':
      return wanneer
        ? `Deze link is verlopen op ${wanneer}. Neem contact op met de opdrachtgever voor een nieuwe link.`
        : 'Deze link is verlopen. Neem contact op met de opdrachtgever voor een nieuwe link.';
    case 'ronde-gesloten':
      return 'Deze vragenlijstronde is gesloten.';
    case 'ronde-niet-open':
      // De ronde staat nog in 'draft': wel aangemaakt, nog niet opengesteld.
      // Anders geformuleerd dan 'gesloten', want hier valt nog wél iets te
      // verwachten — dit is een tijdelijke toestand, geen eindpunt.
      return 'Deze vragenlijst is nog niet opengesteld. Neem contact op met de opdrachtgever.';
    case 'vendor-inactief':
      return 'Deze link is niet langer beschikbaar. Neem contact op met de opdrachtgever.';
    default:
      return 'Deze link is niet geldig.';
  }
}

/**
 * Bewaakt elk verzoek dat via een leverancierslink binnenkomt.
 *
 * Zie docs/superpowers/specs/2026-07-28-leveranciertoken-ontwerp.md §5.
 * Deze guard vervangt het patroon uit de verwijderde branch
 * feat/fase0-skeleton-vendors, dat de tenant blind uit een header las.
 */
@Injectable()
export class SurveyTokenGuard implements CanActivate {
  constructor(private readonly tokens: SurveyTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestMetToken>();

    const uitkomst = await this.tokens.controleer(request.query?.t);

    if (!uitkomst.geldig) {
      // 404 voor onbekend/ingetrokken: geen informatie prijsgeven.
      // 410 Gone voor de rest: de link heeft bestaan en is nu definitief weg.
      if (uitkomst.reden === 'onbekend' || uitkomst.reden === 'ingetrokken') {
        throw new NotFoundException(melding(uitkomst.reden));
      }
      throw new GoneException(melding(uitkomst.reden, uitkomst.datum));
    }

    request.surveyToken = {
      responseId: uitkomst.responseId,
      tenantId: uitkomst.tenantId,
      expiresAt: uitkomst.expiresAt,
    };

    return true;
  }
}
