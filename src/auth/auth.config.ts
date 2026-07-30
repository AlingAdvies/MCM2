/**
 * Configuratie voor de identity-laag (Issue #7, spoor 1).
 *
 * Alles komt uit environment-variabelen, conform de PoC-bevindingen (stap 3):
 * een latere verhuizing van de Entra-tenant `mcm2ciam` naar een Bizaline-tenant
 * moet een configuratiewijziging blijven, geen codewijziging. Daarom staat er
 * nergens in deze module een hardcoded issuer, client-ID of endpoint.
 *
 * Om diezelfde reden heten de variabelen OIDC_* en niet ENTRA_*: ADR-006 vraagt
 * een generieke identity-/claimsinterface. Entra External ID is de huidige
 * provider, niet per definitie de enige.
 */

/** Vorm van de identity-configuratie, na validatie. */
export interface AuthConfig {
  /**
   * De verwachte `iss`-claim én de basis voor discovery. Voor Entra External ID
   * ziet die eruit als `https://<tenant>.ciamlogin.com/<tenant-id>/v2.0`.
   */
  readonly issuer: string;
  /** Waar de authorization code ingewisseld wordt. */
  readonly tokenEndpoint: string;
  /** Waar de publieke sleutels staan om de handtekening te controleren. */
  readonly jwksUri: string;
  /** De verwachte `aud`-claim: onze eigen app-registratie. */
  readonly clientId: string;
  /**
   * Het secret van diezelfde app-registratie. Nooit loggen, nooit in git, nooit
   * in een foutmelding. Zie MCM2-CLAUDE.md §6.
   */
  readonly clientSecret: string;
  /** Moet exact overeenkomen met een redirect-URI in de app-registratie. */
  readonly redirectUri: string;
  /**
   * Speling op tijdclaims (`exp`, `nbf`) in seconden, voor klokverschil tussen
   * onze server en de identity provider. Klein houden: elke seconde speling is
   * een seconde waarin een verlopen token nog geldig is.
   */
  readonly clockToleranceSeconds: number;
}

/** Wordt geworpen wanneer de identity-configuratie onbruikbaar is. */
export class AuthConfigFout extends Error {
  constructor(melding: string) {
    super(melding);
    this.name = 'AuthConfigFout';
  }
}

const VERPLICHT = [
  'OIDC_ISSUER',
  'OIDC_TOKEN_ENDPOINT',
  'OIDC_JWKS_URI',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_REDIRECT_URI',
] as const;

const STANDAARD_KLOKSPELING_SECONDEN = 30;

/**
 * Leest en valideert de identity-configuratie.
 *
 * Faalt hard bij een ontbrekende waarde. Dat is opzet: een backend die
 * opstart met een half ingevulde identity-configuratie zou pas bij de eerste
 * inlogpoging stukgaan, en dan op een plek waar de oorzaak niet zichtbaar is.
 *
 * De foutmelding noemt wél welke variabele ontbreekt, maar nooit de waarde van
 * een andere — een melding als "verwacht X maar kreeg Y" zou een secret in de
 * logs kunnen zetten.
 */
export function leesAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const ontbreekt = VERPLICHT.filter((naam) => !env[naam]?.trim());

  if (ontbreekt.length > 0) {
    throw new AuthConfigFout(
      `Identity-configuratie onvolledig. Ontbrekende variabelen: ${ontbreekt.join(', ')}. Zie .env.example.`,
    );
  }

  // Non-null assertions zijn hier veilig: de filter hierboven heeft elke naam
  // uit VERPLICHT al op een niet-lege waarde gecontroleerd.
  const issuer = env.OIDC_ISSUER!.trim();

  // https verplicht, met één uitzondering. Een issuer op http betekent dat de
  // tokens over een onversleutelde verbinding komen; dan is de handtekening
  // wel geldig maar de vertrouwensketen niet. localhost is uitgezonderd zodat
  // een test met een lokale nep-provider mogelijk blijft.
  for (const [naam, waarde] of [
    ['OIDC_ISSUER', issuer],
    ['OIDC_TOKEN_ENDPOINT', env.OIDC_TOKEN_ENDPOINT!.trim()],
    ['OIDC_JWKS_URI', env.OIDC_JWKS_URI!.trim()],
  ] as const) {
    let url: URL;
    try {
      url = new URL(waarde);
    } catch {
      throw new AuthConfigFout(`${naam} is geen geldige URL.`);
    }

    const isLokaal =
      url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !isLokaal) {
      throw new AuthConfigFout(
        `${naam} moet https gebruiken (alleen localhost mag http).`,
      );
    }
  }

  const speling = env.OIDC_CLOCK_TOLERANCE_SECONDS?.trim();
  let clockToleranceSeconds = STANDAARD_KLOKSPELING_SECONDEN;

  if (speling) {
    const waarde = Number(speling);
    if (!Number.isFinite(waarde) || waarde < 0 || waarde > 300) {
      throw new AuthConfigFout(
        'OIDC_CLOCK_TOLERANCE_SECONDS moet een getal tussen 0 en 300 zijn.',
      );
    }
    clockToleranceSeconds = waarde;
  }

  return {
    issuer,
    tokenEndpoint: env.OIDC_TOKEN_ENDPOINT!.trim(),
    jwksUri: env.OIDC_JWKS_URI!.trim(),
    clientId: env.OIDC_CLIENT_ID!.trim(),
    clientSecret: env.OIDC_CLIENT_SECRET!,
    redirectUri: env.OIDC_REDIRECT_URI!.trim(),
    clockToleranceSeconds,
  };
}
