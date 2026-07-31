import { createHash, randomBytes } from 'node:crypto';

/**
 * Sessietokens voor interne beheerders (Issue #7, spoor 1).
 *
 * Bewust hetzelfde vormmodel als survey-token.ts: 256 bits willekeur, base64url,
 * SHA-256 in de database. Wat er anders is, is het gewicht — een surveylink
 * geeft toegang tot één respons, een sessietoken tot de hele tenant met de
 * rechten van de gebruiker. Reden te meer om niet af te wijken van een patroon
 * dat hier al bewezen is.
 *
 * De naam van het cookie staat hier en niet in de guard: hij wordt op drie
 * plekken gebruikt (zetten bij login, lezen bij elk verzoek, wissen bij
 * uitloggen) en die drie mogen nooit uit elkaar lopen.
 */

/** 32 bytes = 256 bits entropie. Raden is rekenkundig onhaalbaar. */
const TOKEN_BYTES = 32;

/** base64url van 32 bytes levert altijd 43 tekens zonder padding. */
export const SESSIE_TOKEN_LENGTE = 43;

const TOKEN_PATROON = new RegExp(`^[A-Za-z0-9_-]{${SESSIE_TOKEN_LENGTE}}$`);

/**
 * De naam van het sessiecookie.
 *
 * `__Host-`-prefix: de browser accepteert zo'n cookie alleen wanneer het Secure
 * is, geen Domain heeft en op pad `/` staat. Daarmee is het niet te zetten door
 * een subdomein — precies het gat waarlangs een gecompromitteerd subdomein
 * anders een sessie zou kunnen opdringen.
 *
 * Alleen bruikbaar over https. Op localhost (geen https) valt de configuratie
 * terug op de naam zonder prefix; zie cookieInstellingen().
 */
export const SESSIE_COOKIE = '__Host-mcm2_sessie';
export const SESSIE_COOKIE_ONVEILIG = 'mcm2_sessie';

/** Glijdend venster van 8 uur (besluit eigenaar 2026-07-30). */
export const SESSIE_GELDIGHEID_UREN = 8;

/**
 * Genereert een nieuw sessietoken. `randomBytes` is de veilige generator van
 * Node; `Math.random` mag hier nooit gebruikt worden.
 */
export function genereerSessieToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Berekent de hash die in clm.sessie komt. Het ruwe token wordt nooit
 * opgeslagen: wie een databasedump in handen krijgt, kan daarmee niet inloggen.
 *
 * SHA-256 en niet bcrypt/argon2, om dezelfde reden als bij het surveytoken: de
 * invoer is 256 bits willekeur, dus traagheid beschermt tegen niets en kost bij
 * élk verzoek tijd. En dit draait bij élk verzoek.
 */
export function hashSessieToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Controleert de vorm vóórdat de database geraadpleegd wordt. Een verzoek met
 * onzin in het cookie raakt de database dan niet.
 */
export function heeftGeldigeSessieVorm(waarde: unknown): waarde is string {
  return typeof waarde === 'string' && TOKEN_PATROON.test(waarde);
}

/** Cookie-instellingen, afhankelijk van de omgeving. */
export interface CookieInstellingen {
  readonly naam: string;
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: 'lax';
  readonly path: '/';
  readonly maxAge: number;
}

/**
 * Bepaalt hoe het sessiecookie gezet wordt.
 *
 * `httpOnly` staat vast op true en is niet configureerbaar: JavaScript hoort
 * nooit bij dit token te kunnen. Dat is de hele reden dat het ID-token niet
 * naar de browser gaat.
 *
 * `sameSite: 'lax'` en niet 'strict': bij 'strict' stuurt de browser het cookie
 * níét mee wanneer de gebruiker vanaf de Entra-inlogpagina terugkomt, en dan is
 * hij na een geslaagde login alsnog uitgelogd. 'lax' stuurt het wel mee bij
 * navigatie op topniveau, en blokkeert het nog steeds bij verzoeken vanaf een
 * vreemde site.
 *
 * `secure` volgt de omgeving. Buiten productie mag het uit, anders is lokaal
 * ontwikkelen op http onmogelijk — en dan valt ook de `__Host-`-prefix weg,
 * want de browser weigert die zonder Secure.
 */
export function cookieInstellingen(
  env: NodeJS.ProcessEnv = process.env,
): CookieInstellingen {
  // Alleen een expliciete opt-out zet secure uit. Standaard aan: een vergeten
  // variabele hoort de veilige kant op te falen, niet de onveilige.
  const onveiligToegestaan = env.SESSIE_COOKIE_INSECURE === 'true';
  const secure = !onveiligToegestaan;

  return {
    naam: secure ? SESSIE_COOKIE : SESSIE_COOKIE_ONVEILIG,
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSIE_GELDIGHEID_UREN * 60 * 60 * 1000,
  };
}
