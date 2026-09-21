import { InvoerFout, leesUitnodigingen } from './ronde-invoer';

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
