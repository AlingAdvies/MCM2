import {
  Controller,
  Get,
  Logger,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AuthService } from './auth.service';
import {
  INLOGPOGING_COOKIE,
  INLOGPOGING_COOKIE_ONVEILIG,
  INLOGPOGING_GELDIGHEID_MINUTEN,
  deserialiseer,
  serialiseer,
  stateKlopt,
} from './inlogpoging';
import { cookieInstellingen } from './sessie';
import { heeftGeldigeVorm as heeftGeldigeUitnodigingsVorm } from './uitnodigingstoken';
import {
  TenantContextGuard,
  leesCookies,
  type RequestMetSessie,
} from './tenant-context.guard';
import { DatabaseService } from '../db/database.service';
import { TenantFeatureService } from '../features/tenant-feature.service';
import { isPlatformbeheerder } from '../platform/is-platformbeheerder';

/**
 * De drie routes van de inlogflow (Issue #7, spoor 1).
 *
 *   /auth/login     → stuurt door naar de identity provider
 *   /auth/callback  → wisselt de code in, maakt de sessie, zet het cookie
 *   /auth/logout    → verwijdert de sessie en het cookie
 *
 * Alle drie bewust zónder TenantContextGuard: dit zijn precies de routes die
 * bestaan om een sessie te krijgen of kwijt te raken. Een guard erop zou
 * inloggen onmogelijk maken.
 *
 * Er komt hier nergens een tenant uit de invoer. Welke tenant de gebruiker
 * krijgt, volgt uit zijn membership in de database — zie clm.sessie_aanmaken().
 */
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly db: DatabaseService,
    private readonly tenantFeatures: TenantFeatureService,
  ) {}

  /**
   * Begin van de inlogflow: genereer een poging, leg hem in een kortlevend
   * cookie, en stuur de browser naar de provider.
   */
  @Get('login')
  login(
    @Res() response: Response,
    @Query('uitnodiging') uitnodiging?: string,
  ): void {
    // De vorm wordt hier gecontroleerd en niet pas bij de koppeling: onzin in
    // de query hoort niet in een cookie te belanden dat vijftien minuten
    // meereist. Een ongeldige waarde wordt genegeerd, niet geweigerd — de
    // login zelf mag er niet op stuklopen, die verloopt dan gewoon als een
    // gewone login zonder uitnodiging.
    const token = heeftGeldigeUitnodigingsVorm(uitnodiging)
      ? uitnodiging
      : undefined;

    if (uitnodiging && !token) {
      this.logger.warn(
        'Inlogpoging met een uitnodigingsparameter van de verkeerde vorm — genegeerd.',
      );
    }

    const { url, poging } = this.auth.beginInlog(token);

    const sessieCookie = cookieInstellingen();
    const naam = sessieCookie.secure
      ? INLOGPOGING_COOKIE
      : INLOGPOGING_COOKIE_ONVEILIG;

    response.cookie(naam, serialiseer(poging), {
      httpOnly: true,
      secure: sessieCookie.secure,
      // 'lax' en niet 'strict': bij 'strict' stuurt de browser dit cookie niet
      // mee wanneer de gebruiker vanaf de provider terugkomt, en dan mislukt
      // élke login op een ontbrekende state.
      sameSite: 'lax',
      path: '/',
      maxAge: INLOGPOGING_GELDIGHEID_MINUTEN * 60 * 1000,
    });

    response.redirect(url);
  }

  /**
   * De provider stuurt de gebruiker hierheen terug met een authorization code.
   *
   * Volgorde is de garantie: eerst de state controleren, dan pas de code
   * inwisselen. Andersom zou een vreemde site een code kunnen laten inwisselen
   * die hij zelf heeft uitgelokt.
   */
  @Get('callback')
  async callback(
    @Req() request: Request,
    @Res() response: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string,
  ): Promise<void> {
    const sessieCookie = cookieInstellingen();
    const pogingNaam = sessieCookie.secure
      ? INLOGPOGING_COOKIE
      : INLOGPOGING_COOKIE_ONVEILIG;

    // Het pogingcookie is na deze route altijd op, geslaagd of niet. Wissen
    // vóór elke uitgang, zodat een mislukte poging niet opnieuw te gebruiken is.
    response.clearCookie(pogingNaam, { path: '/' });

    // De provider meldt een fout. Die gaat naar het log, niet naar de browser:
    // error_description bevat bij Entra een AADSTS-code die de configuratie
    // beschrijft, en dat is niets voor een eindgebruiker.
    if (error) {
      this.logger.warn(
        `Identity provider weigerde de inlogpoging (${error}): ${errorDescription ?? 'geen beschrijving'}`,
      );
      throw new UnauthorizedException('Inloggen is niet gelukt.');
    }

    const poging = deserialiseer(leesCookies(request)?.[pogingNaam]);

    if (!poging || !stateKlopt(poging.state, state)) {
      // Geen poging in het cookie, of een state die niet klopt. Dat is óf een
      // CSRF-poging óf een cookie dat verlopen is doordat de gebruiker het
      // inlogscherm een kwartier heeft laten staan. Beide krijgen dezelfde
      // melding; het onderscheid is voor de gebruiker niet bruikbaar.
      this.logger.warn(
        'Callback zonder geldige inlogpoging (state komt niet overeen of cookie ontbreekt).',
      );
      throw new UnauthorizedException(
        'Inloggen is niet gelukt. Probeer het opnieuw.',
      );
    }

    const sessie = await this.auth.voltooiInlog(
      code ?? '',
      poging.codeVerifier,
      poging.uitnodigingstoken,
    );

    if (!sessie) {
      // Geverifieerde identiteit zonder actief membership: authenticatie
      // geslaagd, autorisatie niet. Bewust een aparte melding — dit is geen
      // "probeer opnieuw", want opnieuw proberen verandert er niets aan.
      throw new UnauthorizedException(
        'U bent aangemeld, maar heeft geen toegang tot een omgeving. Neem contact op met uw beheerder.',
      );
    }

    response.cookie(sessieCookie.naam, sessie.token, {
      httpOnly: sessieCookie.httpOnly,
      secure: sessieCookie.secure,
      sameSite: sessieCookie.sameSite,
      path: sessieCookie.path,
      maxAge: sessieCookie.maxAge,
    });

    response.redirect(this.auth.naLoginBestemming());
  }

  /**
   * Wie is er ingelogd, en met welke rol.
   *
   * De enige route in deze controller mét de guard. De andere drie bestaan om
   * een sessie te krijgen of kwijt te raken; deze vereist er juist één en geeft
   * 401 zonder.
   *
   * Bestaat omdat de frontend anders niets over de ingelogde gebruiker weet:
   * het sessiecookie is httpOnly en dus onleesbaar voor JavaScript, en dat is
   * met opzet — een token binnen JavaScript-bereik is een XSS-doelwit. De
   * schermen hebben de naam nodig om te tonen wie er is, en de rol om te
   * bepalen wat er zichtbaar hoort te zijn.
   *
   * **Geeft geen userId, sessieId of tenantId terug.** Een scherm heeft ze niet
   * nodig — elke route leidt de tenant zelf af uit het cookie — en een tenantId
   * in een antwoord is precies wat de CI-poort van de frontend verbiedt
   * (MCM2-CLAUDE.md §6). Wat er niet in staat, kan ook niet per ongeluk in een
   * URL belanden.
   *
   * **`isPlatformbeheerder` staat er wél bij, als losse boolean.** Platform-
   * beheer is geen tenantrol (`admin`/`reviewer`) maar een aparte tabel
   * (`clm.platform_admin`, migratie 0020, ADR-015) — vandaar niet in `rol`.
   * Dit veld bepaalt alleen of het platformbeheerscherm getoond wordt; de
   * echte grens blijft `PlatformAdminGuard` op elke platformroute. Verbergen
   * zonder een tweede check op de route zelf zou schijnveiligheid zijn.
   *
   * **`features` — actieve tenant-feature-entitlements (spec 2026-09-03).**
   * Zelfde figuur als `isPlatformbeheerder`: dit veld bepaalt alleen wat de
   * frontend toont (bijv. het contractmenu). Een backend-blokkade op de
   * onderliggende routes zelf is bewust een vervolgstap — zie de spec §6.
   * Route wordt bij elke pagina-laad opnieuw aangeroepen, dus een
   * nieuw-geactiveerde feature is zichtbaar na een pagina-ververs, zonder
   * opnieuw in te loggen.
   */
  @Get('sessie')
  @UseGuards(TenantContextGuard)
  async huidigeSessie(@Req() request: RequestMetSessie) {
    // Veilig: zonder sessie is de guard nooit voorbijgekomen.
    const sessie = request.sessie!;

    const profiel = await this.auth.profiel(sessie);

    if (!profiel) {
      // Geldige sessie, maar de gebruiker bestaat niet meer of is verwijderd.
      // Zeldzaam — het membership zou dan ook weg moeten zijn — maar een lege
      // naam in de sidebar is een raadsel voor wie hem ziet.
      throw new UnauthorizedException('De gebruiker bestaat niet meer.');
    }

    const isBeheerder = await isPlatformbeheerder(
      this.db,
      sessie.tenantId,
      sessie.userId,
    );

    const features = await this.tenantFeatures.lijst(sessie.tenantId);

    return {
      naam: profiel.naam,
      tenantNaam: profiel.tenantNaam,
      rol: sessie.role,
      isPlatformbeheerder: isBeheerder,
      features,
    };
  }

  /**
   * Uitloggen: de sessierij verdwijnt en het cookie wordt gewist.
   *
   * Slaagt altijd, ook zonder geldige sessie. Wie op uitloggen drukt met een
   * verlopen cookie hoort geen foutmelding te krijgen — hij wil hetzelfde
   * resultaat als iedereen, namelijk uitgelogd zijn.
   */
  @Get('logout')
  async logout(
    @Req() request: RequestMetSessie,
    @Res() response: Response,
  ): Promise<void> {
    const sessieCookie = cookieInstellingen();

    await this.auth.uitloggen(leesCookies(request)?.[sessieCookie.naam]);

    response.clearCookie(sessieCookie.naam, { path: '/' });
    response.redirect(this.auth.naLogoutBestemming());
  }
}
