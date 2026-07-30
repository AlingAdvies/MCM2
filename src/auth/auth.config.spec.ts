import { AuthConfigFout, leesAuthConfig } from './auth.config';

/**
 * De configuratie faalt bewust hard bij opstarten in plaats van bij de eerste
 * inlogpoging. Deze tests leggen vast wat "onbruikbaar" precies betekent.
 */

const COMPLEET: NodeJS.ProcessEnv = {
  OIDC_ISSUER: 'https://mcm2ciam.ciamlogin.com/tenant-id/v2.0',
  OIDC_TOKEN_ENDPOINT: 'https://mcm2ciam.ciamlogin.com/tenant-id/oauth2/token',
  OIDC_JWKS_URI: 'https://mcm2ciam.ciamlogin.com/tenant-id/discovery/keys',
  OIDC_CLIENT_ID: 'client-id',
  OIDC_CLIENT_SECRET: 'geheim',
  OIDC_REDIRECT_URI: 'https://localhost:5001/auth/callback',
};

describe('leesAuthConfig', () => {
  it('leest een complete configuratie', () => {
    const config = leesAuthConfig(COMPLEET);

    expect(config.issuer).toBe(COMPLEET.OIDC_ISSUER);
    expect(config.clientId).toBe('client-id');
    expect(config.clockToleranceSeconds).toBe(30);
  });

  it.each([
    'OIDC_ISSUER',
    'OIDC_TOKEN_ENDPOINT',
    'OIDC_JWKS_URI',
    'OIDC_CLIENT_ID',
    'OIDC_CLIENT_SECRET',
    'OIDC_REDIRECT_URI',
  ])('faalt zonder %s', (naam) => {
    const env = { ...COMPLEET };
    delete env[naam];

    expect(() => leesAuthConfig(env)).toThrow(AuthConfigFout);
    expect(() => leesAuthConfig(env)).toThrow(new RegExp(naam));
  });

  it('behandelt een lege waarde als ontbrekend', () => {
    // Een lege variabele in een .env-bestand is een veelgemaakte fout en
    // levert anders een backend op die opstart en pas bij de eerste login
    // stukgaat.
    expect(() =>
      leesAuthConfig({ ...COMPLEET, OIDC_CLIENT_ID: '   ' }),
    ).toThrow(AuthConfigFout);
  });

  it('noemt alle ontbrekende variabelen tegelijk', () => {
    // Eén voor één ontdekken kost evenveel herstarts als er fouten zijn.
    const env: NodeJS.ProcessEnv = { ...COMPLEET };
    delete env.OIDC_ISSUER;
    delete env.OIDC_CLIENT_SECRET;

    expect(() => leesAuthConfig(env)).toThrow(
      /OIDC_ISSUER.*OIDC_CLIENT_SECRET/,
    );
  });

  it('lekt geen secret in de foutmelding', () => {
    const env: NodeJS.ProcessEnv = {
      ...COMPLEET,
      OIDC_CLIENT_SECRET: 'dit-is-het-geheim',
    };
    delete env.OIDC_ISSUER;

    try {
      leesAuthConfig(env);
      throw new Error('had moeten falen');
    } catch (err) {
      expect((err as Error).message).not.toContain('dit-is-het-geheim');
    }
  });

  describe('https-eis', () => {
    it('weigert http voor een externe issuer', () => {
      // Een issuer op http betekent dat tokens onversleuteld reizen: de
      // handtekening klopt dan wel, maar de vertrouwensketen niet.
      expect(() =>
        leesAuthConfig({
          ...COMPLEET,
          OIDC_ISSUER: 'http://mcm2ciam.example.com/v2.0',
        }),
      ).toThrow(/https/);
    });

    it('staat http toe op localhost', () => {
      // Nodig om tegen een lokale nep-provider te kunnen testen.
      const config = leesAuthConfig({
        ...COMPLEET,
        OIDC_ISSUER: 'http://localhost:8080/v2.0',
        OIDC_TOKEN_ENDPOINT: 'http://localhost:8080/token',
        OIDC_JWKS_URI: 'http://localhost:8080/keys',
      });

      expect(config.issuer).toBe('http://localhost:8080/v2.0');
    });

    it('weigert een waarde die geen URL is', () => {
      expect(() =>
        leesAuthConfig({ ...COMPLEET, OIDC_JWKS_URI: 'geen-url' }),
      ).toThrow(/geldige URL/);
    });
  });

  describe('klokspeling', () => {
    it('neemt een opgegeven waarde over', () => {
      const config = leesAuthConfig({
        ...COMPLEET,
        OIDC_CLOCK_TOLERANCE_SECONDS: '60',
      });

      expect(config.clockToleranceSeconds).toBe(60);
    });

    it('weigert een onredelijk grote speling', () => {
      // Elke seconde speling is een seconde waarin een verlopen token nog
      // geldig is. Een uur speling maakt de vervaltijd betekenisloos.
      expect(() =>
        leesAuthConfig({
          ...COMPLEET,
          OIDC_CLOCK_TOLERANCE_SECONDS: '3600',
        }),
      ).toThrow(/tussen 0 en 300/);
    });

    it('weigert een negatieve waarde', () => {
      expect(() =>
        leesAuthConfig({ ...COMPLEET, OIDC_CLOCK_TOLERANCE_SECONDS: '-1' }),
      ).toThrow(/tussen 0 en 300/);
    });

    it('weigert onzin', () => {
      expect(() =>
        leesAuthConfig({ ...COMPLEET, OIDC_CLOCK_TOLERANCE_SECONDS: 'veel' }),
      ).toThrow(/tussen 0 en 300/);
    });
  });
});
