import {
  InvoerFout,
  leesHandmatigeVerzending,
  leesIntrekken,
  leesNietAangekomen,
  leesUitnodigingen,
  TOELICHTING_MAX_TEKENS,
} from './ronde-invoer';

const VENDOR_ID = 'a2371a1c-8af4-40db-b832-96540b97f941';

describe('leesUitnodigingen — verstuurMail', () => {
  it('is standaard true wanneer het veld ontbreekt', () => {
    const resultaat = leesUitnodigingen({
      vendorIds: [VENDOR_ID],
    });

    expect(resultaat.verstuurMail).toBe(true);
  });

  it('accepteert expliciet false', () => {
    const resultaat = leesUitnodigingen({
      vendorIds: [VENDOR_ID],
      verstuurMail: false,
    });

    expect(resultaat.verstuurMail).toBe(false);
  });

  it('accepteert expliciet true', () => {
    const resultaat = leesUitnodigingen({
      vendorIds: [VENDOR_ID],
      verstuurMail: true,
    });

    expect(resultaat.verstuurMail).toBe(true);
  });

  it('weigert een niet-boolean waarde', () => {
    expect(() =>
      leesUitnodigingen({
        vendorIds: [VENDOR_ID],
        verstuurMail: 'nee',
      }),
    ).toThrow(InvoerFout);
  });
});

describe('leesHandmatigeVerzending — adres verplicht (#258)', () => {
  const verleden = '2026-11-01T09:00:00.000Z';

  it('leest datum, adres en toelichting', () => {
    const r = leesHandmatigeVerzending({
      verzondenOp: verleden,
      adres: '  security@leverancier.voorbeeld.nl ',
      toelichting: ' Gebeld, moet naar IT ',
    });

    expect(r.verzondenOp.toISOString()).toBe(verleden);
    expect(r.adres).toBe('security@leverancier.voorbeeld.nl');
    expect(r.toelichting).toBe('Gebeld, moet naar IT');
  });

  it('weigert een registratie zonder adres', () => {
    expect(() => leesHandmatigeVerzending({ verzondenOp: verleden })).toThrow(
      InvoerFout,
    );
    expect(() =>
      leesHandmatigeVerzending({ verzondenOp: verleden, adres: '   ' }),
    ).toThrow(InvoerFout);
  });

  it('weigert iets dat geen e-mailadres is', () => {
    expect(() =>
      leesHandmatigeVerzending({
        verzondenOp: verleden,
        adres: 'Jan de Vries',
      }),
    ).toThrow(InvoerFout);
  });

  it('maakt van een lege toelichting null', () => {
    const r = leesHandmatigeVerzending({
      verzondenOp: verleden,
      adres: 'a@b.voorbeeld.nl',
      toelichting: '  ',
    });
    expect(r.toelichting).toBeNull();
  });

  it('weigert een toelichting boven de grens', () => {
    expect(() =>
      leesHandmatigeVerzending({
        verzondenOp: verleden,
        adres: 'a@b.voorbeeld.nl',
        toelichting: 'x'.repeat(TOELICHTING_MAX_TEKENS + 1),
      }),
    ).toThrow(InvoerFout);
  });
});

describe('leesIntrekken — body mag ontbreken (#258)', () => {
  it('accepteert geen body, een lege body en een reden', () => {
    expect(leesIntrekken(undefined)).toEqual({ toelichting: null });
    expect(leesIntrekken({})).toEqual({ toelichting: null });
    expect(leesIntrekken({ toelichting: ' Verkeerd adres ' })).toEqual({
      toelichting: 'Verkeerd adres',
    });
  });
});

describe('leesNietAangekomen (#258)', () => {
  it('adres en toelichting zijn allebei optioneel', () => {
    expect(leesNietAangekomen({})).toEqual({ adres: null, toelichting: null });
    expect(
      leesNietAangekomen({
        adres: 'info@x.voorbeeld.nl',
        toelichting: 'Onbestelbaar',
      }),
    ).toEqual({ adres: 'info@x.voorbeeld.nl', toelichting: 'Onbestelbaar' });
  });

  it('weigert een ongeldig adres als het wel is ingevuld', () => {
    expect(() => leesNietAangekomen({ adres: 'geen adres' })).toThrow(
      InvoerFout,
    );
  });
});
