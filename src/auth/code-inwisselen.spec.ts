import { AuthConfig } from './auth.config';
import { CodeInwisselaar, CodeInwisselFout } from './code-inwisselen';

const config: AuthConfig = {
  issuer: 'https://mcm2ciam.ciamlogin.com/tenant/v2.0',
  tokenEndpoint: 'https://mcm2ciam.ciamlogin.com/tenant/oauth2/token',
  jwksUri: 'https://mcm2ciam.ciamlogin.com/tenant/discovery/keys',
  clientId: 'client-id',
  clientSecret: 'het-geheim',
  redirectUri: 'https://localhost:5001/auth/callback',
  clockToleranceSeconds: 30,
};

/** Bouwt een nep-fetch die één vast antwoord teruggeeft. */
function nepFetch(
  antwoord: Partial<Response> & { jsonWaarde?: unknown; jsonFaalt?: boolean },
): { fetch: typeof fetch; aanroepen: Array<[string, RequestInit]> } {
  const aanroepen: Array<[string, RequestInit]> = [];

  const fetchImpl = ((url: string, init: RequestInit) => {
    aanroepen.push([url, init]);
    return Promise.resolve({
      ok: antwoord.ok ?? true,
      status: antwoord.status ?? 200,
      json: () =>
        antwoord.jsonFaalt
          ? Promise.reject(new Error('geen JSON'))
          : Promise.resolve(antwoord.jsonWaarde),
    });
  }) as unknown as typeof fetch;

  return { fetch: fetchImpl, aanroepen };
}

describe('CodeInwisselaar', () => {
  describe('geslaagd inwisselen', () => {
    it('geeft het id_token terug', async () => {
      const { fetch } = nepFetch({
        jsonWaarde: {
          id_token: 'het-id-token',
          access_token: 'het-access-token',
          expires_in: 3600,
        },
      });

      const resultaat = await new CodeInwisselaar(config, fetch).wisselIn(
        'de-code',
        'de-verifier',
      );

      expect(resultaat.idToken).toBe('het-id-token');
      expect(resultaat.accessToken).toBe('het-access-token');
      expect(resultaat.verlooptOverSeconden).toBe(3600);
    });

    it('verstuurt de verplichte OAuth-velden als formulier', async () => {
      const { fetch, aanroepen } = nepFetch({
        jsonWaarde: { id_token: 'x' },
      });

      await new CodeInwisselaar(config, fetch).wisselIn(
        'de-code',
        'de-verifier',
      );

      const [url, init] = aanroepen[0];
      expect(url).toBe(config.tokenEndpoint);
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe(
        'application/x-www-form-urlencoded',
      );

      const verstuurd = new URLSearchParams(init.body as string);
      expect(verstuurd.get('grant_type')).toBe('authorization_code');
      expect(verstuurd.get('code')).toBe('de-code');
      expect(verstuurd.get('code_verifier')).toBe('de-verifier');
      expect(verstuurd.get('redirect_uri')).toBe(config.redirectUri);
      expect(verstuurd.get('client_id')).toBe(config.clientId);
    });

    it('werkt zonder access_token in het antwoord', async () => {
      // MCM2 gebruikt het access token nu niet; het ontbreken ervan mag het
      // inloggen niet blokkeren.
      const { fetch } = nepFetch({ jsonWaarde: { id_token: 'x' } });

      const resultaat = await new CodeInwisselaar(config, fetch).wisselIn(
        'code',
        'verifier',
      );

      expect(resultaat.idToken).toBe('x');
      expect(resultaat.accessToken).toBeUndefined();
    });
  });

  describe('weigert onbruikbare invoer', () => {
    it('weigert een lege code', async () => {
      const { fetch, aanroepen } = nepFetch({ jsonWaarde: {} });

      await expect(
        new CodeInwisselaar(config, fetch).wisselIn('  ', 'verifier'),
      ).rejects.toThrow(CodeInwisselFout);

      // En doet geen netwerkaanroep met lege invoer.
      expect(aanroepen).toHaveLength(0);
    });

    it('weigert een lege code_verifier', async () => {
      const { fetch } = nepFetch({ jsonWaarde: {} });

      await expect(
        new CodeInwisselaar(config, fetch).wisselIn('code', ''),
      ).rejects.toThrow(/code_verifier/);
    });
  });

  describe('verwerkt een afwijzing', () => {
    it('geeft de OAuth-foutcode door', async () => {
      // De AADSTS-code is vaak het enige aanknopingspunt bij een
      // configuratiefout; die moet zichtbaar blijven.
      const { fetch } = nepFetch({
        ok: false,
        status: 400,
        jsonWaarde: {
          error: 'invalid_grant',
          error_description:
            'AADSTS70008: The provided authorization code has expired.',
        },
      });

      await expect(
        new CodeInwisselaar(config, fetch).wisselIn('oud', 'verifier'),
      ).rejects.toThrow(/AADSTS70008/);
    });

    it('houdt de HTTP-status vast', async () => {
      const { fetch } = nepFetch({
        ok: false,
        status: 401,
        jsonWaarde: { error: 'invalid_client' },
      });

      try {
        await new CodeInwisselaar(config, fetch).wisselIn('code', 'verifier');
        throw new Error('had moeten falen');
      } catch (err) {
        expect((err as CodeInwisselFout).status).toBe(401);
      }
    });

    it('gaat om met een foutantwoord dat geen JSON is', async () => {
      const { fetch } = nepFetch({ ok: false, status: 502, jsonFaalt: true });

      await expect(
        new CodeInwisselaar(config, fetch).wisselIn('code', 'verifier'),
      ).rejects.toThrow(/status 502/);
    });

    it('faalt bij een antwoord zonder id_token', async () => {
      // Gebeurt wanneer de openid-scope ontbreekt: het inwisselen slaagt, maar
      // er is niets te verifiëren. Zonder deze controle zou de fout pas veel
      // later en op een onlogische plek opduiken.
      const { fetch } = nepFetch({
        jsonWaarde: { access_token: 'alleen-dit' },
      });

      await expect(
        new CodeInwisselaar(config, fetch).wisselIn('code', 'verifier'),
      ).rejects.toThrow(/geen id_token/);
    });

    it('faalt wanneer het endpoint onbereikbaar is', async () => {
      const fetchImpl = (() =>
        Promise.reject(
          new TypeError('fetch failed'),
        )) as unknown as typeof fetch;

      await expect(
        new CodeInwisselaar(config, fetchImpl).wisselIn('code', 'verifier'),
      ).rejects.toThrow(/niet bereikbaar/);
    });
  });

  describe('secrets', () => {
    it('lekt het client secret niet in een foutmelding', async () => {
      // De request-body bevat het secret. Een foutafhandeling die de body
      // meestuurt naar de logs, zet het daarmee op schijf.
      const { fetch } = nepFetch({
        ok: false,
        status: 400,
        jsonWaarde: { error: 'invalid_client', error_description: 'fout' },
      });

      try {
        await new CodeInwisselaar(config, fetch).wisselIn('code', 'verifier');
        throw new Error('had moeten falen');
      } catch (err) {
        expect((err as Error).message).not.toContain('het-geheim');
      }
    });

    it('lekt het client secret niet bij een netwerkfout', async () => {
      const fetchImpl = (() =>
        Promise.reject(
          new Error(`verbinding mislukt naar ${config.tokenEndpoint}`),
        )) as unknown as typeof fetch;

      try {
        await new CodeInwisselaar(config, fetchImpl).wisselIn('c', 'v');
        throw new Error('had moeten falen');
      } catch (err) {
        expect((err as Error).message).not.toContain('het-geheim');
      }
    });
  });
});
