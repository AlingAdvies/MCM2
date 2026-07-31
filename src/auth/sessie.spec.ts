import {
  SESSIE_COOKIE,
  SESSIE_COOKIE_ONVEILIG,
  SESSIE_TOKEN_LENGTE,
  cookieInstellingen,
  genereerSessieToken,
  hashSessieToken,
  heeftGeldigeSessieVorm,
} from './sessie';

describe('sessietoken', () => {
  describe('genereerSessieToken', () => {
    it('levert een token van de vastgelegde lengte', () => {
      expect(genereerSessieToken()).toHaveLength(SESSIE_TOKEN_LENGTE);
    });

    it('gebruikt alleen base64url-tekens, zodat het token in een cookie past', () => {
      expect(genereerSessieToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('levert bij elke aanroep een ander token', () => {
      // Geen bewijs van entropie — dat volgt uit randomBytes — maar het vangt
      // wel de faalvorm waarbij een constante of een teller wordt gebruikt.
      const tokens = new Set(
        Array.from({ length: 100 }, () => genereerSessieToken()),
      );

      expect(tokens.size).toBe(100);
    });
  });

  describe('hashSessieToken', () => {
    it('levert SHA-256 in hex, precies wat de CHECK-constraint eist', () => {
      expect(hashSessieToken('abc')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('geeft hetzelfde token altijd dezelfde hash', () => {
      const token = genereerSessieToken();

      expect(hashSessieToken(token)).toBe(hashSessieToken(token));
    });

    it('geeft verschillende tokens een verschillende hash', () => {
      expect(hashSessieToken('a')).not.toBe(hashSessieToken('b'));
    });

    it('bevat het ruwe token niet — dat is de hele reden dat er gehasht wordt', () => {
      const token = genereerSessieToken();

      expect(hashSessieToken(token)).not.toContain(token);
    });
  });

  describe('heeftGeldigeSessieVorm', () => {
    it('accepteert een vers gegenereerd token', () => {
      expect(heeftGeldigeSessieVorm(genereerSessieToken())).toBe(true);
    });

    it.each([
      ['leeg', ''],
      ['te kort', 'abc'],
      ['te lang', 'a'.repeat(SESSIE_TOKEN_LENGTE + 1)],
      ['met een plusteken uit gewoon base64', `+${'a'.repeat(42)}`],
      ['met een schuine streep uit gewoon base64', `/${'a'.repeat(42)}`],
      ['met padding', `${'a'.repeat(42)}=`],
    ])('weigert een token dat %s is', (_omschrijving, waarde) => {
      expect(heeftGeldigeSessieVorm(waarde)).toBe(false);
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['een getal', 123],
      ['een object', {}],
      ['een array', []],
    ])('weigert %s zonder te werpen', (_omschrijving, waarde) => {
      // Dit komt rechtstreeks uit een cookie: alles kan er staan.
      expect(heeftGeldigeSessieVorm(waarde)).toBe(false);
    });
  });

  describe('cookieInstellingen', () => {
    it('staat standaard op secure — een vergeten variabele faalt de veilige kant op', () => {
      const instellingen = cookieInstellingen({});

      expect(instellingen.secure).toBe(true);
      expect(instellingen.naam).toBe(SESSIE_COOKIE);
    });

    it('zet secure alleen uit bij een expliciete opt-out', () => {
      const instellingen = cookieInstellingen({
        SESSIE_COOKIE_INSECURE: 'true',
      });

      expect(instellingen.secure).toBe(false);
    });

    it.each([['false'], ['1'], ['ja'], ['TRUE'], ['']])(
      'laat secure aan staan bij de waarde %p',
      (waarde) => {
        // Alleen exact 'true' telt. Anders zou een typefout in een
        // omgevingsvariabele het cookie stilzwijgend onveilig maken.
        expect(
          cookieInstellingen({ SESSIE_COOKIE_INSECURE: waarde }).secure,
        ).toBe(true);
      },
    );

    it('laat de __Host-prefix vallen zodra secure uitstaat', () => {
      // De browser weigert een __Host-cookie zonder Secure. De naam moet dus
      // meebewegen, anders komt het cookie lokaal helemaal niet aan.
      const instellingen = cookieInstellingen({
        SESSIE_COOKIE_INSECURE: 'true',
      });

      expect(instellingen.naam).toBe(SESSIE_COOKIE_ONVEILIG);
      expect(instellingen.naam.startsWith('__Host-')).toBe(false);
    });

    it('houdt httpOnly altijd aan — JavaScript hoort niet bij dit token te kunnen', () => {
      expect(cookieInstellingen({}).httpOnly).toBe(true);
      expect(
        cookieInstellingen({ SESSIE_COOKIE_INSECURE: 'true' }).httpOnly,
      ).toBe(true);
    });

    it('gebruikt sameSite lax, zodat de terugkeer van de provider werkt', () => {
      // Bij 'strict' stuurt de browser het cookie niet mee na de redirect
      // vanaf Entra, en is de gebruiker na een geslaagde login alsnog uitgelogd.
      expect(cookieInstellingen({}).sameSite).toBe('lax');
    });

    it('laat het cookie na 8 uur verlopen, gelijk aan het venster in de database', () => {
      expect(cookieInstellingen({}).maxAge).toBe(8 * 60 * 60 * 1000);
    });
  });
});
