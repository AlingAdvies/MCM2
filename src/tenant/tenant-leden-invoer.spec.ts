import { InvoerFout } from '../vendor/vendor-invoer';
import { leesNieuwLid, leesRolWijziging } from './tenant-leden-invoer';

describe('leesNieuwLid', () => {
  it('accepteert een geldig e-mailadres en rol', () => {
    const invoer = leesNieuwLid({
      email: 'collega@transdev.nl',
      rol: 'user',
    });
    expect(invoer).toEqual({ email: 'collega@transdev.nl', rol: 'user' });
  });

  it('weigert een ongeldig e-mailadres', () => {
    expect(() =>
      leesNieuwLid({ email: 'geen-emailadres', rol: 'user' }),
    ).toThrow(InvoerFout);
  });

  it('weigert een onbekende rol', () => {
    expect(() =>
      leesNieuwLid({ email: 'collega@transdev.nl', rol: 'superadmin' }),
    ).toThrow(InvoerFout);
  });

  it('weigert de rol support — die wordt nooit via deze route gezet', () => {
    expect(() =>
      leesNieuwLid({ email: 'collega@transdev.nl', rol: 'support' }),
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
