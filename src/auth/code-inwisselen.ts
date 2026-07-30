import { AuthConfig } from './auth.config';

/**
 * Wisselt een authorization code in voor tokens (Issue #7, spoor 1, stap 1).
 *
 * De PoC van 2026-07-27 eindigde met een geldige `?code=...` op de reply-URL.
 * Dit is de stap daarna: die code server-to-server inwisselen bij het
 * token-endpoint. Server-to-server is niet vrijblijvend — het client secret
 * gaat mee, en dat mag de browser nooit zien.
 *
 * PKCE gaat mee (`code_verifier`). Voor een vertrouwelijke client met een
 * secret is dat strikt genomen niet verplicht, maar het beschermt tegen
 * onderschepping van de code op de terugweg naar de browser. De user flow uit
 * de PoC is al op `response_type=code` geconfigureerd.
 */

/** Wat het token-endpoint teruggeeft, voor zover wij het gebruiken. */
export interface TokenAntwoord {
  /** Het ID-token: bewijst wie de gebruiker is. Gaat naar de verificateur. */
  readonly idToken: string;
  /**
   * Het access token. Bewaard maar nu ongebruikt: MCM2 roept geen Microsoft
   * Graph aan. Zodra dat wel gebeurt, is dit de plek waar het vandaan komt.
   */
  readonly accessToken?: string;
  readonly verlooptOverSeconden?: number;
}

/** Wordt geworpen wanneer het inwisselen niet lukt. */
export class CodeInwisselFout extends Error {
  constructor(
    melding: string,
    readonly status?: number,
  ) {
    super(melding);
    this.name = 'CodeInwisselFout';
  }
}

/** Vorm van een geslaagd antwoord van het token-endpoint. */
interface RuwTokenAntwoord {
  id_token?: unknown;
  access_token?: unknown;
  expires_in?: unknown;
}

/** Vorm van een foutantwoord volgens RFC 6749 §5.2. */
interface RuwFoutAntwoord {
  error?: unknown;
  error_description?: unknown;
}

export class CodeInwisselaar {
  /**
   * @param fetchImpl Alleen voor tests: een eigen fetch in plaats van de
   * globale. Het alternatief — een echt HTTP-endpoint opzetten in een unittest
   * — zou de test traag en afhankelijk van het netwerk maken.
   */
  constructor(
    private readonly config: AuthConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Wisselt de code in. Werpt `CodeInwisselFout` bij elke afwijking.
   *
   * @param code De authorization code uit de callback.
   * @param codeVerifier De PKCE-verifier die bij deze inlogpoging hoort.
   */
  async wisselIn(code: string, codeVerifier: string): Promise<TokenAntwoord> {
    if (!code.trim()) {
      throw new CodeInwisselFout('Geen authorization code ontvangen.');
    }

    if (!codeVerifier.trim()) {
      throw new CodeInwisselFout('Geen PKCE code_verifier beschikbaar.');
    }

    // application/x-www-form-urlencoded, niet JSON: zo schrijft OAuth 2.0 het
    // voor (RFC 6749 §4.1.3) en zo verwacht Entra het.
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code_verifier: codeVerifier,
    });

    let respons: Response;

    try {
      respons = await this.fetchImpl(this.config.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });
    } catch (err) {
      // Netwerkfout: het endpoint is onbereikbaar. Bewust geen details van de
      // onderliggende fout doorgeven — die kan de volledige URL bevatten, en
      // die staat vol met tenant-identificatie.
      throw new CodeInwisselFout(
        `Token-endpoint niet bereikbaar: ${err instanceof Error ? err.name : 'onbekende fout'}`,
      );
    }

    if (!respons.ok) {
      throw new CodeInwisselFout(
        await leesFoutmelding(respons),
        respons.status,
      );
    }

    let ruw: RuwTokenAntwoord;

    try {
      ruw = (await respons.json()) as RuwTokenAntwoord;
    } catch {
      throw new CodeInwisselFout(
        'Token-endpoint gaf een antwoord dat geen JSON is.',
        respons.status,
      );
    }

    if (typeof ruw.id_token !== 'string' || ruw.id_token.trim() === '') {
      // Zonder ID-token is er niets te verifiëren. Dit gebeurt wanneer de
      // `openid`-scope ontbreekt in de autorisatieaanvraag — een
      // configuratiefout die anders pas veel later opvalt.
      throw new CodeInwisselFout(
        'Antwoord bevat geen id_token. Ontbreekt de openid-scope in de autorisatieaanvraag?',
      );
    }

    return {
      idToken: ruw.id_token,
      accessToken:
        typeof ruw.access_token === 'string' ? ruw.access_token : undefined,
      verlooptOverSeconden:
        typeof ruw.expires_in === 'number' ? ruw.expires_in : undefined,
    };
  }
}

/**
 * Leest de foutmelding uit een afgewezen antwoord.
 *
 * OAuth-foutantwoorden zijn machineleesbaar (`error`, `error_description`) en
 * bevatten bij Entra vaak een AADSTS-code die het probleem exact benoemt. Die
 * gaat mee, want zonder die code is een configuratiefout niet te vinden.
 *
 * Wat níét meegaat is de request-body: daar staat het client secret in.
 */
async function leesFoutmelding(respons: Response): Promise<string> {
  let ruw: RuwFoutAntwoord;

  try {
    ruw = (await respons.json()) as RuwFoutAntwoord;
  } catch {
    return `Token-endpoint gaf status ${respons.status}.`;
  }

  const code = typeof ruw.error === 'string' ? ruw.error : 'onbekend';
  const beschrijving =
    typeof ruw.error_description === 'string' ? ruw.error_description : '';

  return beschrijving
    ? `Token-endpoint weigerde de code (${code}): ${beschrijving}`
    : `Token-endpoint weigerde de code (${code}).`;
}
