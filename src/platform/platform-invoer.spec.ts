import { InvoerFout } from '../vendor/vendor-invoer';
import { leesNieuweTenant } from './platform-invoer';

const GELDIG = {
  naam: 'Transdev',
  adminNaam: 'Jan de Vries',
  adminEmail: 'jan@transdev.nl',
};

describe('leesNieuweTenant', () => {
  describe('het antwoordadres (migratie 0025)', () => {
    it('neemt een geldig adres over', () => {
      const invoer = leesNieuweTenant({
        ...GELDIG,
        antwoordEmail: 'contractmanagement@transdev.nl',
      });

      expect(invoer.antwoordEmail).toBe('contractmanagement@transdev.nl');
    });

    it('staat plusadressering toe', () => {
      // Hierop leunt de hele testopzet van het mailkanaal: één inbox, meerdere
      // onderscheidbare adressen. Een validator die '+' weigert blokkeert niet
      // een randgeval maar de manier waarop we het systeem aantoonbaar maken.
      const invoer = leesNieuweTenant({
        ...GELDIG,
        antwoordEmail: 'contractmanagement+mcm2@transdev.nl',
      });

      expect(invoer.antwoordEmail).toBe('contractmanagement+mcm2@transdev.nl');
    });

    it.each([
      ['ontbreekt', {}],
      ['undefined is', { antwoordEmail: undefined }],
      ['null is', { antwoordEmail: null }],
      ['een lege string is', { antwoordEmail: '' }],
      ['alleen spaties bevat', { antwoordEmail: '   ' }],
    ])('geeft undefined wanneer het veld %s', (_omschrijving, extra) => {
      // Leeg is een geldige keuze en geen halve invoer: niet elke klant heeft
      // een gedeeld postvak. Undefined en niet '' — een lege string zou als
      // "wel ingevuld" door de keten reizen en een leeg Reply-To opleveren.
      expect(leesNieuweTenant({ ...GELDIG, ...extra }).antwoordEmail).toBe(
        undefined,
      );
    });

    it.each([
      ['zonder apenstaartje', 'geen-adres'],
      ['zonder domein', 'iemand@'],
      ['zonder punt in het domein', 'iemand@localhost'],
      ['met een spatie', 'ie mand@transdev.nl'],
    ])('weigert een adres %s', (_omschrijving, waarde) => {
      expect(() =>
        leesNieuweTenant({ ...GELDIG, antwoordEmail: waarde }),
      ).toThrow(InvoerFout);
    });

    it('weigert een waarde die geen tekst is', () => {
      expect(() => leesNieuweTenant({ ...GELDIG, antwoordEmail: 42 })).toThrow(
        InvoerFout,
      );
    });

    it('noemt het veld bij naam in de fout', () => {
      // Het scherm zet de melding bij het juiste invoerveld; zonder veldnaam
      // staat de fout bovenaan het formulier en zoekt de gebruiker zelf.
      try {
        leesNieuweTenant({ ...GELDIG, antwoordEmail: 'onzin' });
        fail('had moeten werpen');
      } catch (fout) {
        expect((fout as InvoerFout).veld).toBe('antwoordEmail');
      }
    });
  });

  describe('de bestaande velden blijven verplicht', () => {
    it('leest een tenant zonder antwoordadres gewoon in', () => {
      const invoer = leesNieuweTenant(GELDIG);

      expect(invoer.naam).toBe('Transdev');
      expect(invoer.adminNaam).toBe('Jan de Vries');
      expect(invoer.adminEmail).toBe('jan@transdev.nl');
    });

    it.each(['naam', 'adminNaam', 'adminEmail'])(
      'weigert een ontbrekende %s',
      (veld) => {
        const zonder: Record<string, unknown> = { ...GELDIG };
        delete zonder[veld];

        expect(() => leesNieuweTenant(zonder)).toThrow(InvoerFout);
      },
    );
  });
});
