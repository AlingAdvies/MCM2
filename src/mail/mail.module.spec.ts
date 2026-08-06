import { Test } from '@nestjs/testing';

import { LogMailKanaal } from './log-mail-kanaal';
import { MailKanaal } from './mail-kanaal';
import { MailModule } from './mail.module';
import { ResendMailKanaal } from './resend-mail-kanaal';

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: jest.fn() } })),
}));

/**
 * De knip uit ontwerp §5 bestaat pas echt als een aanroeper `MailKanaal` kan
 * vragen zonder te weten welke implementatie hij krijgt.
 *
 * Zonder deze tests is de abstractie decoratie: hij staat in het bestand, maar
 * niets dwingt af dat de keuze klopt — en die keuze bepaalt of er werkelijk
 * mail de deur uit gaat.
 */
describe('MailModule', () => {
  const oorspronkelijkeEnv = process.env;

  beforeEach(() => {
    // Een kopie zonder de mailvariabelen: anders bepaalt de .env van de
    // ontwikkelaar de uitkomst, en dan is de test op de ene machine groen en
    // op de andere rood.
    process.env = { ...oorspronkelijkeEnv };
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_AFZENDER_ADRES;
  });

  afterEach(() => {
    process.env = oorspronkelijkeEnv;
  });

  async function bouw() {
    return Test.createTestingModule({ imports: [MailModule] }).compile();
  }

  describe('zonder configuratie', () => {
    it('levert een MailKanaal', async () => {
      const moduleRef = await bouw();

      expect(moduleRef.get(MailKanaal)).toBeInstanceOf(MailKanaal);
    });

    it('kiest LogMailKanaal — er gaat aantoonbaar niets uit', async () => {
      // De veilige toestand. Een half werkend mailkanaal dat soms wél
      // verstuurt is erger dan een kanaal dat eerlijk niets doet.
      const moduleRef = await bouw();

      expect(moduleRef.get(MailKanaal)).toBeInstanceOf(LogMailKanaal);
    });

    it('geeft dezelfde instantie voor MailKanaal en LogMailKanaal', async () => {
      // Twee instanties zouden twee verzendlijsten betekenen: een test
      // controleert de ene terwijl de code in de andere schrijft. Dat is een
      // testfout die eruitziet als een codefout.
      const moduleRef = await bouw();

      expect(moduleRef.get(MailKanaal)).toBe(moduleRef.get(LogMailKanaal));
    });
  });

  describe('met volledige configuratie', () => {
    beforeEach(() => {
      process.env.RESEND_API_KEY = 're_test_sleutel';
      process.env.MAIL_AFZENDER_ADRES = 'uitvraag@mcm2mail.nl';
    });

    it('kiest ResendMailKanaal', async () => {
      const moduleRef = await bouw();

      expect(moduleRef.get(MailKanaal)).toBeInstanceOf(ResendMailKanaal);
    });

    it('levert niet langer het logkanaal', async () => {
      // De keuze moet echt wisselen. Zou dit LogMailKanaal blijven, dan is een
      // ingestelde sleutel betekenisloos en gaat er niets uit terwijl de
      // beheerder denkt van wel.
      const moduleRef = await bouw();

      expect(moduleRef.get(MailKanaal)).not.toBeInstanceOf(LogMailKanaal);
    });
  });

  describe('met halve configuratie', () => {
    it('weigert op te starten met alleen een sleutel', async () => {
      // Stil terugvallen op het logkanaal zou betekenen dat iemand die
      // halverwege het instellen is gestopt, denkt dat er mail uitgaat.
      process.env.RESEND_API_KEY = 're_test_sleutel';

      await expect(bouw()).rejects.toThrow(/MAIL_AFZENDER_ADRES/);
    });

    it('weigert op te starten met alleen een afzenderadres', async () => {
      process.env.MAIL_AFZENDER_ADRES = 'uitvraag@mcm2mail.nl';

      await expect(bouw()).rejects.toThrow(/RESEND_API_KEY/);
    });
  });
});
