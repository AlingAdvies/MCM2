import { isGeldigMailadres } from './mail-adres';

/**
 * Tegenproef 9 uit het mailkanaal-ontwerp §7.
 *
 * De demo-opzet speelt vijf leveranciers na met plusadressering op één
 * Gmail-account. Weigert onze eigen validatie de `+`, dan blokkeert de
 * testopzet zichzelf — en dat merk je pas als je niet snapt waarom er geen
 * uitnodiging aankomt.
 */
describe('isGeldigMailadres', () => {
  describe('plusadressering — de demo-opzet leunt hierop', () => {
    it.each([
      'chris+demo-vendor1@gmail.com',
      'chris+demo-vendor2@gmail.com',
      'chris+van.der.berg@gmail.com',
      'a+b+c@example.org',
    ])('accepteert %s', (adres) => {
      expect(isGeldigMailadres(adres)).toBe(true);
    });
  });

  describe('gewone adressen', () => {
    it.each([
      'contractmanagement@transdev.nl',
      'uitvraag@mcm2mail.nl',
      'voornaam.achternaam@bedrijf.co.uk',
      'info@sub.domein.example.com',
      "o'brien@example.com",
    ])('accepteert %s', (adres) => {
      expect(isGeldigMailadres(adres)).toBe(true);
    });
  });

  describe('weigert wat echt onbruikbaar is', () => {
    it.each([
      ['leeg', ''],
      ['alleen witruimte', '   '],
      ['geen @', 'geenapenstaartje.nl'],
      ['niets voor de @', '@example.com'],
      ['niets na de @', 'iemand@'],
      ['geen punt in het domein', 'iemand@localhost'],
      ['spatie erin', 'ie mand@example.com'],
      ['tweede @', 'a@b@example.com'],
      ['punt direct na @', 'iemand@.example.com'],
      ['eindigt op een punt', 'iemand@example.'],
    ])('weigert %s', (_omschrijving, adres) => {
      expect(isGeldigMailadres(adres)).toBe(false);
    });

    it('weigert een adres langer dan 254 tekens', () => {
      const telang = `${'a'.repeat(250)}@example.com`;
      expect(isGeldigMailadres(telang)).toBe(false);
    });
  });

  describe('robuustheid', () => {
    it('accepteert omringende witruimte', () => {
      // Geplakt uit een spreadsheet of mail is dit een veelvoorkomend geval.
      // Weigeren zou betekenen dat een leverancier geen uitnodiging krijgt om
      // een reden die niemand in het scherm ziet.
      expect(isGeldigMailadres('  iemand@example.com  ')).toBe(true);
    });

    it.each([null, undefined, 42, {}, []])(
      'weigert %p zonder te crashen',
      (waarde) => {
        expect(isGeldigMailadres(waarde as string)).toBe(false);
      },
    );
  });
});
