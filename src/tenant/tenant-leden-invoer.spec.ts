import { InvoerFout } from '../vendor/vendor-invoer';
import { leesNieuwLid, leesRolWijziging } from './tenant-leden-invoer';

describe('leesNieuwLid', () => {
  it('accepteert een geldig e-mailadres, naam en rol', () => {
    const invoer = leesNieuwLid({
      email: 'collega@transdev.nl',
      naam: 'Collega Naam',
      rol: 'user',
    });
    expect(invoer).toEqual({
      email: 'collega@transdev.nl',
      naam: 'Collega Naam',
      rol: 'user',
    });
  });

  it('knipt spaties aan het begin en eind van de naam', () => {
    const invoer = leesNieuwLid({
      email: 'collega@transdev.nl',
      naam: '  Collega Naam  ',
      rol: 'user',
    });
    expect(invoer.naam).toBe('Collega Naam');
  });

  it('weigert een ontbrekende naam', () => {
    expect(() =>
      leesNieuwLid({ email: 'collega@transdev.nl', rol: 'user' }),
    ).toThrow(InvoerFout);
  });

  it('weigert een lege naam', () => {
    expect(() =>
      leesNieuwLid({ email: 'collega@transdev.nl', naam: '   ', rol: 'user' }),
    ).toThrow(InvoerFout);
  });

  it('weigert een te lange naam', () => {
    expect(() =>
      leesNieuwLid({
        email: 'collega@transdev.nl',
        naam: 'x'.repeat(201),
        rol: 'user',
      }),
    ).toThrow(InvoerFout);
  });

  it('weigert een ongeldig e-mailadres', () => {
    expect(() =>
      leesNieuwLid({
        email: 'geen-emailadres',
        naam: 'Collega Naam',
        rol: 'user',
      }),
    ).toThrow(InvoerFout);
  });

  it('weigert een onbekende rol', () => {
    expect(() =>
      leesNieuwLid({
        email: 'collega@transdev.nl',
        naam: 'Collega Naam',
        rol: 'superadmin',
      }),
    ).toThrow(InvoerFout);
  });

  it('weigert de rol support — die wordt nooit via deze route gezet', () => {
    expect(() =>
      leesNieuwLid({
        email: 'collega@transdev.nl',
        naam: 'Collega Naam',
        rol: 'support',
      }),
    ).toThrow(InvoerFout);
  });

  it('weigert invoer zonder object', () => {
    expect(() => leesNieuwLid(null)).toThrow(InvoerFout);
    expect(() => leesNieuwLid('geen object')).toThrow(InvoerFout);
  });
});

describe('leesRolWijziging', () => {
  it('accepteert admin, user en reviewer', () => {
    expect(leesRolWijziging({ rol: 'admin' })).toEqual({ rol: 'admin' });
    expect(leesRolWijziging({ rol: 'user' })).toEqual({ rol: 'user' });
    expect(leesRolWijziging({ rol: 'reviewer' })).toEqual({ rol: 'reviewer' });
  });

  it('weigert support', () => {
    expect(() => leesRolWijziging({ rol: 'support' })).toThrow(InvoerFout);
  });
});
