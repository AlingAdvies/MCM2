import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';

import { AuthConfig } from './auth.config';

/**
 * Verifieert ID-tokens van de identity provider (Issue #7, spoor 1, stap 2).
 *
 * Dit is de plek waar "een gebruiker beweert dat hij X is" verandert in "de
 * server weet dat hij X is". Alles daarachter — de tenantcontext, RLS,
 * autorisatie — steunt op de uitkomst hiervan. Vandaar dat elke controle
 * expliciet is en niet op standaardgedrag wordt vertrouwd.
 *
 * Bewust géén eigen JWT-logica. Handtekeningverificatie zelf schrijven is een
 * bekende bron van kwetsbaarheden (de klassieke `alg: none`-omzeiling, of
 * vergelijken van handtekeningen met een niet-constante-tijd-vergelijking).
 * `jose` is exact gepind conform §11.
 */

/** Wat de backend uit een geverifieerd ID-token haalt. */
export interface GeverifieerdeIdentiteit {
  /**
   * De stabiele identifier van de gebruiker: de `oid`-claim.
   *
   * Niet `sub`. In Entra is `sub` per applicatie verschillend (pairwise), dus
   * dezelfde persoon krijgt een andere `sub` in een tweede app-registratie.
   * `oid` is stabiel over applicaties heen binnen dezelfde tenant, en dat is
   * wat `clm.user.external_subject` moet bevatten.
   */
  readonly externalSubject: string;
  /** Weergavegegeven, geen sleutel: een e-mailadres verandert. */
  readonly email?: string;
  readonly naam?: string;
  /** De tenant-ID van de identity provider — niet die van MCM2. */
  readonly identityTenantId?: string;
  /**
   * De `idp`-claim: via welke provider deze login binnenkwam.
   *
   * Bij federatie wijst hij naar de eigen organisatie van de gebruiker. Alleen
   * gebruikt bij de eerste login, als waarborg bij het koppelen van een oid aan
   * een wachtende gebruikersrij.
   */
  readonly identityProvider?: string;
}

/** Wordt geworpen wanneer een token niet te vertrouwen is. */
export class TokenVerificatieFout extends Error {
  constructor(melding: string) {
    super(melding);
    this.name = 'TokenVerificatieFout';
  }
}

/**
 * Alleen asymmetrische algoritmen. Zonder deze lijst zou een aanvaller een
 * token kunnen aanbieden dat met een symmetrisch algoritme (HS256) is
 * ondertekend met de publieke sleutel als geheim — een bekende aanval die
 * werkt zodra de verificatie het algoritme uit het token zelf overneemt.
 */
const TOEGESTANE_ALGORITMEN = ['RS256', 'PS256', 'ES256'];

/**
 * Waar de publieke sleutels vandaan komen.
 *
 * Bewust het gedeelde functietype en niet `ReturnType<typeof createRemoteJWKSet>`:
 * een lokale sleutelset (`createLocalJWKSet`, gebruikt in tests) heeft dezelfde
 * aanroepvorm maar niet de extra velden van de remote variant. `jwtVerify`
 * gebruikt alleen die aanroepvorm, dus dit is het juiste, smalste type.
 */
type SleutelBron = Parameters<typeof jwtVerify>[1];

export class IdTokenVerificateur {
  private readonly jwks: SleutelBron;

  /**
   * @param sleutelBron Alleen voor tests: een lokale sleutelset in plaats van
   * de JWKS van de provider. Daarmee zijn tokens te fabriceren die de echte
   * provider nooit zou afgeven — een verlopen token, een verkeerde `aud`, een
   * handtekening van een vreemde sleutel. Zonder die mogelijkheid zou de
   * negatieve kant van deze module ongetest blijven.
   */
  constructor(
    private readonly config: AuthConfig,
    sleutelBron?: SleutelBron,
  ) {
    this.jwks = sleutelBron ?? createRemoteJWKSet(new URL(config.jwksUri));
  }

  /**
   * Controleert handtekening, herkomst, bestemming en geldigheidsduur, en
   * levert daarna pas de identiteit op.
   *
   * Werpt bij élke twijfel. Er is geen "waarschijnlijk goed": een token is
   * geldig of het telt niet.
   */
  async verifieer(idToken: string): Promise<GeverifieerdeIdentiteit> {
    let payload: JWTPayload;

    try {
      // jwtVerify doet handtekening, iss, aud, exp en nbf in één keer. Dat is
      // bewust: die controles los uitvoeren maakt het mogelijk er per ongeluk
      // één over te slaan.
      const resultaat = await jwtVerify(idToken, this.jwks, {
        issuer: this.config.issuer,
        audience: this.config.clientId,
        algorithms: TOEGESTANE_ALGORITMEN,
        clockTolerance: this.config.clockToleranceSeconds,
      });
      payload = resultaat.payload;
    } catch (err) {
      // De onderliggende melding gaat bewust niet mee naar de aanroeper: die
      // kan claimwaarden bevatten. Wel loggen op de plek waar dit gevangen
      // wordt, niet hier — deze module kent de logger niet.
      throw new TokenVerificatieFout(
        `ID-token niet geldig: ${err instanceof Error ? err.name : 'onbekende fout'}`,
      );
    }

    const oid = payload.oid;

    if (typeof oid !== 'string' || oid.trim() === '') {
      // Zonder oid is er geen stabiele sleutel om de gebruiker aan te koppelen.
      // Terugvallen op `sub` of `email` zou hier verleidelijk zijn en precies
      // verkeerd: `sub` verschilt per applicatie, `email` verandert.
      throw new TokenVerificatieFout(
        'ID-token bevat geen bruikbare oid-claim. Controleer de tokenconfiguratie van de app-registratie.',
      );
    }

    return {
      externalSubject: oid,
      email: leesTekstClaim(payload, 'email'),
      naam: leesTekstClaim(payload, 'name'),
      identityTenantId: leesTekstClaim(payload, 'tid'),
      // Bij federatie wijst deze claim naar de identity provider van de
      // gebruiker zelf, niet naar onze CIAM-tenant — voor een AlingAdvies-
      // account bijvoorbeeld naar login.microsoftonline.com/<hun tenant>.
      //
      // Alleen nodig bij de eerste login, waar een oid aan een wachtende
      // gebruikersrij gekoppeld wordt: dan is "kwam deze login via een
      // federatieve provider" een van de waarborgen. Zie koppelEersteLogin().
      identityProvider: leesTekstClaim(payload, 'idp'),
    };
  }
}

/** Leest een claim alleen wanneer het een niet-lege tekst is. */
function leesTekstClaim(payload: JWTPayload, naam: string): string | undefined {
  const waarde = payload[naam];
  return typeof waarde === 'string' && waarde.trim() !== ''
    ? waarde
    : undefined;
}
