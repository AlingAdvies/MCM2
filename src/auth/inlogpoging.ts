import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * De staat van één inlogpoging: PKCE en de state-parameter (Issue #7, spoor 1).
 *
 * Tussen `/auth/login` en `/auth/callback` zit een omweg langs de identity
 * provider. Twee dingen moeten die omweg overleven:
 *
 *   - de **code_verifier**, om te bewijzen dat de callback bij ónze
 *     inlogpoging hoort en niet bij een onderschepte code;
 *   - de **state**, om te bewijzen dat de callback door ons is uitgelokt en
 *     niet door een vreemde site (CSRF op de inlogflow).
 *
 * Ze gaan mee in een kortlevend cookie, niet in het geheugen van het proces.
 * Dezelfde reden als bij de sessies zelf (migratie 0010): met twee containers
 * weet de ene niet wat de andere weet, en dan mislukt de login zodra de
 * callback bij de andere container binnenkomt.
 */

/** 32 bytes willekeur, base64url — ruim boven het minimum uit RFC 7636. */
const BYTES = 32;

/** Kort: dit cookie hoeft alleen de omweg langs de provider te overleven. */
export const INLOGPOGING_GELDIGHEID_MINUTEN = 15;

export const INLOGPOGING_COOKIE = '__Host-mcm2_inlog';
export const INLOGPOGING_COOKIE_ONVEILIG = 'mcm2_inlog';

export interface Inlogpoging {
  readonly state: string;
  readonly codeVerifier: string;
  /**
   * Het uitnodigingstoken, alleen aanwezig wanneer de gebruiker via een
   * uitnodigingslink binnenkwam.
   *
   * Reist mee om precies dezelfde reden als de twee velden hierboven: tussen de
   * klik op de link en de terugkeer van de provider zit een omweg, en het token
   * moet die overleven. Een aparte opslag zou een tweede mechanisme zijn voor
   * hetzelfde probleem.
   *
   * Optioneel, en dat is wezenlijk: een gewone login heeft geen token en mag er
   * niet op stuklopen.
   */
  readonly uitnodigingstoken?: string;
}

/** Genereert een verse inlogpoging. */
export function nieuweInlogpoging(uitnodigingstoken?: string): Inlogpoging {
  return {
    state: randomBytes(BYTES).toString('base64url'),
    codeVerifier: randomBytes(BYTES).toString('base64url'),
    uitnodigingstoken,
  };
}

/**
 * De `code_challenge` die meegaat in de autorisatieaanvraag: SHA-256 van de
 * verifier, base64url. Methode S256, niet `plain` — bij `plain` gaat de
 * verifier zelf over de lijn en beschermt PKCE nergens meer tegen.
 */
export function codeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier, 'utf8').digest('base64url');
}

/**
 * Vergelijkt de state uit de callback met die uit het cookie, in constante
 * tijd. Ongelijke lengtes vallen er meteen uit: timingSafeEqual werpt daarop.
 */
export function stateKlopt(uitCookie: string, uitCallback: unknown): boolean {
  if (typeof uitCallback !== 'string' || uitCallback.length === 0) {
    return false;
  }

  const a = Buffer.from(uitCookie, 'utf8');
  const b = Buffer.from(uitCallback, 'utf8');

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}

/**
 * Serialiseert de poging voor in het cookie.
 *
 * De punt kan als scheidingsteken omdat base64url hem niet bevat: het alfabet
 * is `A-Za-z0-9_-`. Een waarde kan het formaat dus niet van binnenuit breken.
 */
export function serialiseer(poging: Inlogpoging): string {
  const basis = `${poging.state}.${poging.codeVerifier}`;

  return poging.uitnodigingstoken
    ? `${basis}.${poging.uitnodigingstoken}`
    : basis;
}

/**
 * Leest de poging terug. Geeft `null` bij alles wat niet de juiste vorm heeft.
 *
 * Twee delen is een gewone login, drie een login via een uitnodigingslink.
 * Beide worden aanvaard; alles daarbuiten niet. Dat het derde deel mag
 * ontbreken is geen soepelheid maar noodzaak — anders zou deze wijziging elke
 * bestaande login breken.
 */
export function deserialiseer(waarde: unknown): Inlogpoging | null {
  if (typeof waarde !== 'string') {
    return null;
  }

  const delen = waarde.split('.');

  if (delen.length < 2 || delen.length > 3 || !delen[0] || !delen[1]) {
    return null;
  }

  // Een aanwezig maar leeg derde deel is een kapot cookie, geen login zonder
  // token: `a.b.` hoort niet stilzwijgend als gewone login door te gaan.
  if (delen.length === 3 && !delen[2]) {
    return null;
  }

  return {
    state: delen[0],
    codeVerifier: delen[1],
    uitnodigingstoken: delen[2],
  };
}
