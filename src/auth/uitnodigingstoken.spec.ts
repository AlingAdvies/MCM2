import {
  UITNODIGINGSTOKEN_LENGTE,
  genereerUitnodigingstoken,
  hashUitnodigingstoken,
  heeftGeldigeVorm,
} from './uitnodigingstoken';

describe('uitnodigingstoken', () => {
  describe('genereren', () => {
    it('levert 43 tekens base64url — 256 bits entropie', () => {
      const token = genereerUitnodigingstoken();

      expect(token).toHaveLength(UITNODIGINGSTOKEN_LENGTE);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('levert bij elke aanroep iets anders', () => {
      const tokens = new Set(
        Array.from({ length: 100 }, () => genereerUitnodigingstoken()),
      );

      expect(tokens.size).toBe(100);
    });

    it('bevat geen punt, want die scheidt de velden in het pogingcookie', () => {
      // Zie inlogpoging.ts: het token reist mee in een cookie waarin de punt
      // het scheidingsteken is. Een token met een punt zou dat formaat van
      // binnenuit breken.
      const tokens = Array.from({ length: 100 }, () =>
        genereerUitnodigingstoken(),
      );

      expect(tokens.every((t) => !t.includes('.'))).toBe(true);
    });
  });

  describe('hashen', () => {
    it('levert SHA-256 in hex — 64 tekens, zoals de CHECK-constraint eist', () => {
      expect(hashUitnodigingstoken(genereerUitnodigingstoken())).toMatch(
        /^[0-9a-f]{64}$/,
      );
    });

    it('geeft voor hetzelfde token altijd dezelfde hash', () => {
      const token = genereerUitnodigingstoken();

      expect(hashUitnodigingstoken(token)).toBe(hashUitnodigingstoken(token));
    });

    it('geeft voor een ander token een andere hash', () => {
      expect(hashUitnodigingstoken(genereerUitnodigingstoken())).not.toBe(
        hashUitnodigingstoken(genereerUitnodigingstoken()),
      );
    });

    it('is niet terug te rekenen naar het token', () => {
      // Geen bewijs van onomkeerbaarheid — dat is een eigenschap van SHA-256 —
      // maar wel de eis die ertoe doet: wie de database leest, heeft niet het
      // token. Dat is de scheiding tussen databasetoegang en uitnodiging.
      const token = genereerUitnodigingstoken();

      expect(hashUitnodigingstoken(token)).not.toContain(token);
    });
  });

  describe('vormcontrole', () => {
    it('aanvaardt een echt token', () => {
      expect(heeftGeldigeVorm(genereerUitnodigingstoken())).toBe(true);
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['leeg', ''],
      ['een getal', 42],
      ['een object', {}],
      ['te kort', 'abc'],
      ['een hash in plaats van een token', 'a'.repeat(64)],
    ])('weigert %s zonder te werpen', (_omschrijving, waarde) => {
      // Dit komt uit een query-parameter of een cookie: alles kan er staan.
      expect(heeftGeldigeVorm(waarde)).toBe(false);
    });

    it('weigert tekens die buiten base64url vallen', () => {
      const token = genereerUitnodigingstoken();

      expect(heeftGeldigeVorm(`${token.slice(0, -1)}.`)).toBe(false);
      expect(heeftGeldigeVorm(`${token.slice(0, -1)}+`)).toBe(false);
      expect(heeftGeldigeVorm(`${token.slice(0, -1)}/`)).toBe(false);
    });

    it('weigert een token dat één teken te lang of te kort is', () => {
      const token = genereerUitnodigingstoken();

      expect(heeftGeldigeVorm(token.slice(0, -1))).toBe(false);
      expect(heeftGeldigeVorm(`${token}x`)).toBe(false);
    });
  });
});
