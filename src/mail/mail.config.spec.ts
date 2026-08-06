import { MailConfigFout, leesMailConfig } from './mail.config';

/**
 * De configuratie kent drie toestanden, en het onderscheid daartussen is de
 * hele reden dat dit bestand bestaat:
 *
 *   niets ingesteld  → null, draai met LogMailKanaal (geen fout)
 *   volledig         → een MailConfig
 *   half             → een fout bij opstarten
 *
 * Die laatste is de gevaarlijke: stil terugvallen op het logkanaal betekent dat
 * de beheerder denkt dat er mail uitgaat terwijl er niets gebeurt.
 */

const COMPLEET: NodeJS.ProcessEnv = {
  RESEND_API_KEY: 're_test_sleutel',
  MAIL_AFZENDER_ADRES: 'uitvraag@mcm2mail.nl',
};

describe('leesMailConfig', () => {
  describe('niets ingesteld — geen fout', () => {
    it('geeft null bij een lege omgeving', () => {
      expect(leesMailConfig({})).toBeNull();
    });

    it('geeft null als beide variabelen leeg zijn', () => {
      // Een lege variabele in .env is een veelgemaakte fout. Als "leeg" iets
      // anders zou betekenen dan "afwezig", zou de ene helft van het team
      // draaien met een logkanaal en de andere met een crash.
      expect(
        leesMailConfig({ RESEND_API_KEY: '', MAIL_AFZENDER_ADRES: '  ' }),
      ).toBeNull();
    });
  });

  describe('volledig ingesteld', () => {
    it('leest sleutel en afzenderadres', () => {
      const config = leesMailConfig(COMPLEET);

      expect(config).not.toBeNull();
      expect(config?.apiSleutel).toBe('re_test_sleutel');
      expect(config?.afzenderAdres).toBe('uitvraag@mcm2mail.nl');
    });

    it('haalt witruimte weg', () => {
      const config = leesMailConfig({
        RESEND_API_KEY: '  re_test_sleutel  ',
        MAIL_AFZENDER_ADRES: '  uitvraag@mcm2mail.nl  ',
      });

      expect(config?.apiSleutel).toBe('re_test_sleutel');
      expect(config?.afzenderAdres).toBe('uitvraag@mcm2mail.nl');
    });
  });

  describe('half ingesteld — faalt hard', () => {
    it('faalt met alleen een afzenderadres', () => {
      expect(() =>
        leesMailConfig({ MAIL_AFZENDER_ADRES: 'uitvraag@mcm2mail.nl' }),
      ).toThrow(MailConfigFout);
    });

    it('faalt met alleen een sleutel', () => {
      expect(() =>
        leesMailConfig({ RESEND_API_KEY: 're_test_sleutel' }),
      ).toThrow(MailConfigFout);
    });

    it('noemt in de fout welke variabele ontbreekt', () => {
      // Een foutmelding die niet zegt wát er mist, kost de lezer een zoektocht
      // door de broncode.
      expect(() => leesMailConfig({ MAIL_AFZENDER_ADRES: 'a@b.nl' })).toThrow(
        /RESEND_API_KEY/,
      );
      expect(() => leesMailConfig({ RESEND_API_KEY: 're_x' })).toThrow(
        /MAIL_AFZENDER_ADRES/,
      );
    });

    it('valt niet stil terug op het logkanaal', () => {
      // De kern van deze hele paragraaf: half ingesteld mag nooit null
      // opleveren. Zou dat wel zo zijn, dan start MCM2 op alsof alles klopt en
      // verstuurt het niets.
      expect(() => leesMailConfig({ RESEND_API_KEY: 're_x' })).toThrow();
    });
  });

  describe('afzenderadres wordt gevalideerd', () => {
    it('weigert een adres zonder @', () => {
      // Resend geeft hierop `invalid_from_address` — maar pas bij de eerste
      // verzending, als de ronde al loopt.
      expect(() =>
        leesMailConfig({ ...COMPLEET, MAIL_AFZENDER_ADRES: 'geen-adres' }),
      ).toThrow(MailConfigFout);
    });

    it('weigert een adres zonder punt in het domein', () => {
      expect(() =>
        leesMailConfig({
          ...COMPLEET,
          MAIL_AFZENDER_ADRES: 'uitvraag@localhost',
        }),
      ).toThrow(MailConfigFout);
    });

    it('noemt het foute adres in de melding', () => {
      expect(() =>
        leesMailConfig({ ...COMPLEET, MAIL_AFZENDER_ADRES: 'geen-adres' }),
      ).toThrow(/geen-adres/);
    });
  });

  describe('de sleutel lekt niet', () => {
    it('zet de sleutel niet in een foutmelding', () => {
      // MCM2-CLAUDE.md §6: nooit loggen, nooit in een foutmelding. Een
      // configuratiefout is precies het moment waarop dat per ongeluk gebeurt.
      const geheim = 're_dit_is_geheim_abc123';

      try {
        leesMailConfig({
          RESEND_API_KEY: geheim,
          MAIL_AFZENDER_ADRES: 'fout-adres',
        });
        throw new Error('had moeten falen');
      } catch (err) {
        expect((err as Error).message).not.toContain(geheim);
      }
    });
  });
});
