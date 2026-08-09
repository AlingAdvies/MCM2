import { InvoerFout } from '../vendor/vendor-invoer';
import { leesTenantWijziging } from './tenant-invoer';

describe('leesTenantWijziging', () => {
  describe('het onderscheid tussen niet-aanraken en wissen', () => {
    it('geeft een leeg object wanneer het veld ontbreekt', () => {
      // Zonder dit onderscheid zou een scherm dat straks alleen de tenantnaam
      // wijzigt het antwoordadres stilzwijgend wissen — precies het soort
      // stille bijwerking dat pas opvalt als een leverancier antwoordt en
      // niemand het leest.
      expect(leesTenantWijziging({})).toEqual({});
      expect(leesTenantWijziging({ ietsAnders: 'x' })).toEqual({});
    });

    it.each([
      ['null', null],
      ['een lege string', ''],
      ['alleen spaties', '   '],
    ])('wist het adres bij %s', (_omschrijving, waarde) => {
      // Bewust wissen moet kunnen: een tenant die zijn antwoordadres intrekt
      // krijgt de alternatieve zin in de berichttekst.
      expect(leesTenantWijziging({ antwoordEmail: waarde })).toEqual({
        antwoordEmail: null,
      });
    });
  });

  describe('geldige adressen', () => {
    it('neemt een gewoon adres over', () => {
      expect(
        leesTenantWijziging({ antwoordEmail: 'contract@transdev.nl' }),
      ).toEqual({ antwoordEmail: 'contract@transdev.nl' });
    });

    it('staat plusadressering toe', () => {
      // Hierop leunt de testopzet van het mailkanaal: één inbox, meerdere
      // onderscheidbare adressen.
      expect(
        leesTenantWijziging({ antwoordEmail: 'contract+mcm2@transdev.nl' }),
      ).toEqual({ antwoordEmail: 'contract+mcm2@transdev.nl' });
    });

    it('haalt witruimte eromheen weg', () => {
      expect(
        leesTenantWijziging({ antwoordEmail: '  contract@transdev.nl  ' }),
      ).toEqual({ antwoordEmail: 'contract@transdev.nl' });
    });
  });

  describe('wat geweigerd wordt', () => {
    it.each([
      ['zonder apenstaartje', 'geen-adres'],
      ['zonder domein', 'iemand@'],
      ['zonder punt in het domein', 'iemand@localhost'],
      ['met een spatie erin', 'ie mand@transdev.nl'],
    ])('weigert een adres %s', (_omschrijving, waarde) => {
      expect(() => leesTenantWijziging({ antwoordEmail: waarde })).toThrow(
        InvoerFout,
      );
    });

    it('weigert een waarde die geen tekst is', () => {
      expect(() => leesTenantWijziging({ antwoordEmail: 42 })).toThrow(
        InvoerFout,
      );
    });

    it('weigert een adres langer dan 254 tekens', () => {
      // Zelfde grens als de CHECK-constraint uit migratie 0025. Zou de
      // applicatie ruimer zijn, dan levert een te lang adres een databasefout
      // op in plaats van een leesbare melding bij het invoerveld.
      expect(() =>
        leesTenantWijziging({
          antwoordEmail: `${'a'.repeat(250)}@transdev.nl`,
        }),
      ).toThrow(InvoerFout);
    });

    it.each([
      ['null', null],
      ['een getal', 42],
      ['een string', 'geen object'],
    ])('weigert een body die %s is', (_omschrijving, body) => {
      expect(() => leesTenantWijziging(body)).toThrow(InvoerFout);
    });

    it('noemt het veld bij naam in de fout', () => {
      // Het scherm zet de melding bij het juiste invoerveld; zonder veldnaam
      // staat de fout bovenaan het formulier en zoekt de gebruiker zelf.
      try {
        leesTenantWijziging({ antwoordEmail: 'onzin' });
        fail('had moeten werpen');
      } catch (fout) {
        expect((fout as InvoerFout).veld).toBe('antwoordEmail');
      }
    });
  });
});
