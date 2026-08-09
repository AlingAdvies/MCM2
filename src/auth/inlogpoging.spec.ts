import { createHash } from 'node:crypto';

import {
  codeChallenge,
  deserialiseer,
  nieuweInlogpoging,
  serialiseer,
  stateKlopt,
} from './inlogpoging';
import { genereerUitnodigingstoken } from './uitnodigingstoken';

describe('inlogpoging', () => {
  describe('nieuweInlogpoging', () => {
    it('levert een state en een code_verifier', () => {
      const poging = nieuweInlogpoging();

      expect(poging.state).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(poging.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('gebruikt niet dezelfde waarde voor state en verifier', () => {
      // Ze beschermen tegen verschillende aanvallen. Dezelfde waarde zou
      // betekenen dat wie de state ziet — die staat in de URL — ook de
      // verifier kent, en dan beschermt PKCE nergens meer tegen.
      const poging = nieuweInlogpoging();

      expect(poging.state).not.toBe(poging.codeVerifier);
    });

    it('levert bij elke aanroep verse waarden', () => {
      const states = new Set(
        Array.from({ length: 100 }, () => nieuweInlogpoging().state),
      );

      expect(states.size).toBe(100);
    });
  });

  describe('codeChallenge', () => {
    it('is SHA-256 van de verifier in base64url (methode S256)', () => {
      const verifier = 'test-verifier';
      const verwacht = createHash('sha256')
        .update(verifier, 'utf8')
        .digest('base64url');

      expect(codeChallenge(verifier)).toBe(verwacht);
    });

    it('geeft de verifier zelf niet prijs', () => {
      // Bij methode 'plain' zou de challenge de verifier zélf zijn. Deze test
      // valt om zodra iemand daarop terugvalt.
      const verifier = nieuweInlogpoging().codeVerifier;

      expect(codeChallenge(verifier)).not.toBe(verifier);
    });

    it('gebruikt base64url, want de challenge gaat in een URL', () => {
      expect(codeChallenge('abc')).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe('stateKlopt', () => {
    it('accepteert een exact gelijke state', () => {
      const { state } = nieuweInlogpoging();

      expect(stateKlopt(state, state)).toBe(true);
    });

    it('weigert een andere state — dit is de CSRF-bescherming', () => {
      expect(
        stateKlopt(nieuweInlogpoging().state, nieuweInlogpoging().state),
      ).toBe(false);
    });

    it('weigert een state die alleen in lengte verschilt', () => {
      const { state } = nieuweInlogpoging();

      expect(stateKlopt(state, state.slice(0, -1))).toBe(false);
      expect(stateKlopt(state, `${state}x`)).toBe(false);
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['leeg', ''],
      ['een getal', 123],
      ['een object', {}],
    ])(
      'weigert %s uit de callback zonder te werpen',
      (_omschrijving, waarde) => {
        // Dit komt uit een query-parameter: alles kan er staan.
        expect(stateKlopt(nieuweInlogpoging().state, waarde)).toBe(false);
      },
    );
  });

  describe('serialiseren en terugleze', () => {
    it('leest terug wat erin ging', () => {
      const poging = nieuweInlogpoging();

      expect(deserialiseer(serialiseer(poging))).toEqual(poging);
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['leeg', ''],
      ['zonder scheidingsteken', 'alleenstate'],
      ['met een leeg eerste deel', '.verifier'],
      ['met een leeg tweede deel', 'state.'],
      ['met een leeg derde deel', 'state.verifier.'],
      ['met te veel delen', 'a.b.c.d'],
      ['een getal', 42],
    ])('geeft null bij een cookie dat %s is', (_omschrijving, waarde) => {
      expect(deserialiseer(waarde)).toBeNull();
    });
  });

  describe('het uitnodigingstoken over de omweg langs de provider', () => {
    it('reist mee en komt er ongeschonden uit', () => {
      const poging = nieuweInlogpoging('token-uit-de-link');

      expect(deserialiseer(serialiseer(poging))?.uitnodigingstoken).toBe(
        'token-uit-de-link',
      );
    });

    it('ontbreekt bij een gewone login, en dat mag', () => {
      // De belangrijkste van deze twee: elke bestaande login gaat langs dit
      // pad, en die heeft geen token. Zou het veld verplicht zijn, dan zou
      // niemand meer kunnen inloggen.
      const poging = nieuweInlogpoging();

      expect(serialiseer(poging).split('.')).toHaveLength(2);
      expect(deserialiseer(serialiseer(poging))?.uitnodigingstoken).toBe(
        undefined,
      );
    });

    it('overleeft een echt token, dat base64url is', () => {
      // Het scheidingsteken is een punt, en base64url bevat er geen. Deze test
      // legt vast waaróm dat formaat werkt: met een alfabet dat wél punten kent
      // zou een token het cookie van binnenuit kunnen breken.
      const token = genereerUitnodigingstoken();
      const poging = nieuweInlogpoging(token);

      expect(token).not.toContain('.');
      expect(deserialiseer(serialiseer(poging))?.uitnodigingstoken).toBe(token);
    });
  });
});
