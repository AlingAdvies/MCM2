import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { cookieInstellingen } from './sessie';
import { SessieService, type SessieContext } from './sessie.service';

/**
 * Bewaakt elk verzoek van een interne beheerder (Issue #7, spoor 1).
 *
 * Dit is de laag die in het plan als "de laag ertussen" stond:
 *
 *     sessiecookie lezen  →  clm.sessie_oplossen(hash)  →  tenantId
 *
 * De tenantcontext komt daarmee uit een gehashte lookup in de database, niet
 * uit iets dat de client stuurt. De browser bezit één betekenisloze sleutel;
 * er bestaat geen veld waarin een andere tenant benoemd zou kunnen worden.
 * Dat is dezelfde garantie die SurveyTokenGuard voor spoor 2 levert, en de
 * reden dat MCM2-CLAUDE.md §6 een tenant in een header of URL verbiedt.
 *
 * Deze guard doet uitdrukkelijk géén rolcontrole. Hij stelt vast wíé er is en
 * bij welke tenant; wat die persoon mag, is een aparte vraag met een eigen
 * plek. Ze hier samenvoegen zou betekenen dat elke route die authenticatie
 * nodig heeft ook een rolbesluit meekrijgt dat niemand expliciet nam.
 *
 * ── Over "X-Tenant-Id verwijderen" ───────────────────────────────────────────
 *
 * Het plan noemde dat als laatste stap van fase 1. Bij het bouwen bleek er
 * niets te verwijderen: de header bestaat nergens in `src/` of `test/` en is
 * meegegaan met de weggegooide branch feat/fase0-skeleton-vendors. Wat er nog
 * over is, staat uitsluitend in documentatie en gearchiveerde plannen.
 *
 * Daarmee is de stap niet overgeslagen maar van vorm veranderd: van iets
 * weghalen naar bewijzen dat het er niet is, én dat er geen tweede pad naar een
 * tenantcontext bestaat. Nagelopen op 2026-07-31: elke aanroep van withTenant()
 * krijgt zijn tenantId van SurveyTokenGuard (spoor 2), van deze guard (spoor 1)
 * of van het seed-script, waar een beheerder de tenant zelf op de opdrachtregel
 * meegeeft. Geen enkele HTTP-route accepteert een tenant uit de invoer.
 *
 * Drie tests in tenant-context-guard.e2e-spec.ts bewaken dat: een verzoek met
 * alleen een header, een verzoek met alleen een query-parameter, en een verzoek
 * met een ongeldig cookie náást een header. Alle drie horen 401 te geven. Die
 * tests zijn geschreven ná een tegenproef waarin de guard wél op de header
 * terugviel — zonder hen bleef die terugval onopgemerkt.
 */

/** Request met de sessiecontext die deze guard eraan toevoegt. */
export interface RequestMetSessie extends Request {
  sessie?: SessieContext;
  /**
   * Het ruwe token uit het cookie. Alleen nodig voor uitloggen, dat de sessie
   * op de hash moet kunnen beëindigen. Bewust niet op SessieContext: die gaat
   * naar plekken waar het ruwe token niets te zoeken heeft.
   */
  sessieToken?: string;
}

/**
 * Leest het sessiecookie.
 *
 * Kijkt naar beide namen, want de `__Host-`-prefix valt weg zodra `secure`
 * uitstaat (zie sessie.ts). Welke van de twee actief is volgt uit de
 * configuratie, niet uit wat de client aanbiedt: de veilige naam wint altijd
 * wanneer die er staat, zodat een tweede cookie met de onveilige naam een
 * geldige sessie niet kan overschrijven.
 */
function leesCookie(request: Request): string | undefined {
  // cookie-parser vult request.cookies. Zonder die middleware is dit undefined
  // en weigert de guard elk verzoek — zichtbaar falen, geen stille doorgang.
  const cookies = leesCookies(request);

  if (!cookies) {
    return undefined;
  }

  const { naam } = cookieInstellingen();
  const waarde = cookies[naam];

  return typeof waarde === 'string' ? waarde : undefined;
}

/**
 * Haalt de geparste cookies van de request.
 *
 * Het eigen type in plaats van dat van @types/cookie-parser: dat typeert de
 * waarden als `any`, en dan verdwijnt de controle dat er daadwerkelijk een
 * string in het cookie staat. Wat een client stuurt is `unknown` tot het
 * getoetst is.
 */
export function leesCookies(
  request: Request,
): Record<string, unknown> | undefined {
  const kandidaat: unknown = (request as { cookies?: unknown }).cookies;

  return typeof kandidaat === 'object' && kandidaat !== null
    ? (kandidaat as Record<string, unknown>)
    : undefined;
}

@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(private readonly sessies: SessieService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestMetSessie>();

    const token = leesCookie(request);
    const sessie = await this.sessies.oplossen(token);

    if (!sessie) {
      // 401 voor alle drie de gevallen — geen cookie, onbekende sessie,
      // verlopen sessie. Onderscheid maken zou verklappen of een sessie ooit
      // bestaan heeft, en de gebruiker moet in alle drie de gevallen hetzelfde
      // doen: opnieuw inloggen.
      throw new UnauthorizedException('Niet ingelogd of sessie verlopen.');
    }

    request.sessie = sessie;
    request.sessieToken = token;

    return true;
  }
}
