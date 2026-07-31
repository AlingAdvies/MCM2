import { Injectable, Logger } from '@nestjs/common';

import { AuthConfig, leesAuthConfig } from './auth.config';
import { CodeInwisselFout, CodeInwisselaar } from './code-inwisselen';
import {
  IdTokenVerificateur,
  TokenVerificatieFout,
  type GeverifieerdeIdentiteit,
} from './id-token-verificatie';
import { Inlogpoging, codeChallenge, nieuweInlogpoging } from './inlogpoging';
import { SessieService, type NieuweSessie } from './sessie.service';

/**
 * Bindt de vier bestaande bouwstenen aan elkaar tot één inlogflow:
 * configuratie, code inwisselen, tokenverificatie en de sessielaag.
 *
 * Bewust een dunne laag zonder eigen securitylogica. Elke controle zit in de
 * module die er verantwoordelijk voor is — handtekening in de verificateur,
 * membership in clm.sessie_aanmaken(). Wat hier staat is de volgorde, en die
 * volgorde is wél essentieel: verifiëren vóór een sessie aanmaken.
 */

/** De scopes voor de autorisatieaanvraag. */
const SCOPES = 'openid profile email';

/** Waar de gebruiker heen gaat na in- en uitloggen. */
const STANDAARD_NA_LOGIN = '/';
const STANDAARD_NA_LOGOUT = '/';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * De configuratie wordt bij de eerste inlogpoging gelezen, niet in de
   * constructor.
   *
   * Dat is een bewuste afweging en geen verzwakking. `leesAuthConfig()` faalt
   * hard bij een ontbrekende variabele, en dat blijft zo — maar in de
   * constructor zou die fout de héle applicatie onstartbaar maken zodra de
   * OIDC-variabelen ontbreken. Dat raakt precies twee situaties waarin dat
   * verkeerd is: de e2e-testsuite (die de AppModule opstart zonder identity) en
   * een lokale run waarin alleen aan de leverancierskant gewerkt wordt.
   *
   * Het alternatief — de identity-module voorwaardelijk laden — verplaatst het
   * probleem naar de moduledefinitie en maakt daar een `if` van. Dan is niet
   * meer aan de routes te zien of ze bestaan.
   *
   * Wat je hiervoor inlevert: een configuratiefout valt bij de eerste
   * inlogpoging op in plaats van bij het opstarten. Dat is zichtbaar genoeg —
   * de melding noemt de ontbrekende variabele — en het is het enige moment
   * waarop de configuratie er daadwerkelijk toe doet.
   */
  private configCache?: AuthConfig;
  private inwisselaarCache?: CodeInwisselaar;
  private verificateurCache?: IdTokenVerificateur;

  constructor(private readonly sessies: SessieService) {}

  private get config(): AuthConfig {
    this.configCache ??= leesAuthConfig();
    return this.configCache;
  }

  private get inwisselaar(): CodeInwisselaar {
    this.inwisselaarCache ??= new CodeInwisselaar(this.config);
    return this.inwisselaarCache;
  }

  private get verificateur(): IdTokenVerificateur {
    this.verificateurCache ??= new IdTokenVerificateur(this.config);
    return this.verificateurCache;
  }

  /**
   * Bouwt de autorisatie-URL en de bijbehorende poging.
   *
   * De authorization endpoint wordt afgeleid van de issuer: Entra External ID
   * zet `/authorize` naast `/token`, en die laatste staat al in de
   * configuratie. Zo hoeft er geen zesde variabele bij die altijd samen met de
   * andere verandert.
   */
  beginInlog(): { url: string; poging: Inlogpoging } {
    const poging = nieuweInlogpoging();

    const parameters = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      scope: SCOPES,
      state: poging.state,
      code_challenge: codeChallenge(poging.codeVerifier),
      code_challenge_method: 'S256',
      // response_mode=query hoort bij response_type=code: de code komt als
      // query-parameter terug, niet als fragment. Een fragment bereikt de
      // server nooit.
      response_mode: 'query',
    });

    return {
      url: `${this.authorizationEndpoint()}?${parameters.toString()}`,
      poging,
    };
  }

  /**
   * Wisselt de code in, verifieert het ID-token en maakt de sessie.
   *
   * Geeft `null` wanneer de gebruiker geen actief membership heeft. Werpt bij
   * alles wat op een technische of vertrouwensfout wijst — dat onderscheid is
   * belangrijk: geen membership is een normale uitkomst, een ongeldig token
   * niet.
   */
  async voltooiInlog(
    code: string,
    codeVerifier: string,
  ): Promise<NieuweSessie | null> {
    let idToken: string;

    try {
      const antwoord = await this.inwisselaar.wisselIn(code, codeVerifier);
      idToken = antwoord.idToken;
    } catch (err) {
      if (err instanceof CodeInwisselFout) {
        // De melding kan een AADSTS-code bevatten die de configuratiefout
        // benoemt. Die hoort in het log, niet in de browser.
        this.logger.warn(`Code inwisselen mislukt: ${err.message}`);
      }
      throw err;
    }

    let identiteit: GeverifieerdeIdentiteit;

    try {
      identiteit = await this.verificateur.verifieer(idToken);
    } catch (err) {
      if (err instanceof TokenVerificatieFout) {
        this.logger.warn(`ID-token afgewezen: ${err.message}`);
      }
      throw err;
    }

    return this.sessies.aanmaken(identiteit.externalSubject);
  }

  /** Beëindigt de sessie bij het ruwe token uit het cookie. */
  async uitloggen(ruwToken: unknown): Promise<void> {
    await this.sessies.beeindigen(ruwToken);
  }

  naLoginBestemming(): string {
    return process.env.NA_LOGIN_URL?.trim() || STANDAARD_NA_LOGIN;
  }

  naLogoutBestemming(): string {
    return process.env.NA_LOGOUT_URL?.trim() || STANDAARD_NA_LOGOUT;
  }

  /**
   * Leidt de authorization endpoint af uit de token endpoint. Bij Entra
   * External ID zijn dat `.../oauth2/v2.0/token` en `.../oauth2/v2.0/authorize`
   * — hetzelfde pad met een ander laatste segment.
   *
   * Klopt die aanname bij een andere provider niet, dan is
   * OIDC_AUTHORIZATION_ENDPOINT de uitweg zonder codewijziging.
   */
  private authorizationEndpoint(): string {
    const expliciet = process.env.OIDC_AUTHORIZATION_ENDPOINT?.trim();

    if (expliciet) {
      return expliciet;
    }

    return this.config.tokenEndpoint.replace(/\/token(\?|$)/, '/authorize$1');
  }
}
