import { stelBeheerderUitnodigingSamen } from './beheerder-uitnodiging-bericht';

const BASIS = {
  ontvanger: 'beheerder@transdev.nl',
  beheerderNaam: 'Jan de Vries',
  tenantNaam: 'Transdev',
  link: 'https://mcm2.example.nl/auth/login?uitnodiging=abc123',
  verlooptOp: '2026-11-07T15:47:47.718Z',
};

describe('beheerder-uitnodigingsbericht', () => {
  describe('wat de ontvanger moet zien', () => {
    it('spreekt de beheerder bij naam aan', () => {
      expect(stelBeheerderUitnodigingSamen(BASIS).tekst).toContain(
        'Beste Jan de Vries',
      );
    });

    it('noemt de organisatie waarvoor de omgeving is aangemaakt', () => {
      const { tekst, onderwerp } = stelBeheerderUitnodigingSamen(BASIS);

      expect(tekst).toContain('Transdev');
      expect(onderwerp).toContain('Transdev');
    });

    it('schrijft de link volledig uit', () => {
      // Niet achter "klik hier" verstoppen: wie de afzender niet vertrouwt moet
      // de URL kunnen bekijken zonder te klikken.
      expect(stelBeheerderUitnodigingSamen(BASIS).tekst).toContain(BASIS.link);
    });

    it('noemt de uiterste datum in leesbare vorm', () => {
      // '7 november 2026', niet '07-11-2026': bij een uiterste datum is een
      // misgelezen dag/maand het verschil tussen op tijd en te laat.
      expect(stelBeheerderUitnodigingSamen(BASIS).tekst).toContain(
        '7 november 2026',
      );
    });

    it('zegt dat de link eenmalig is', () => {
      // Wie hem een tweede keer opent krijgt anders een onverklaarbare fout.
      expect(stelBeheerderUitnodigingSamen(BASIS).tekst).toContain('eenmalig');
    });

    it('vertelt wat te doen bij een onverwachte uitnodiging', () => {
      // Zonder deze regel weet iemand die de mail onverwacht krijgt niet wat te
      // doen — precies het moment waarop een uitnodiging als phishing wordt
      // gemeld.
      expect(stelBeheerderUitnodigingSamen(BASIS).tekst).toContain(
        'Verwacht u deze uitnodiging niet',
      );
    });
  });

  describe('wat er bewust NIET in staat', () => {
    it('vraagt nergens om een wachtwoord', () => {
      // Het bekendste phishing-signaal, en juist bij een mail die tot een inlog
      // leidt het verschil tussen vertrouwd en verdacht.
      const { tekst, onderwerp } = stelBeheerderUitnodigingSamen(BASIS);

      expect(tekst.toLowerCase()).not.toContain('wachtwoord');
      expect(onderwerp.toLowerCase()).not.toContain('wachtwoord');
    });

    it('klopt geen urgentie op', () => {
      const tekst = stelBeheerderUitnodigingSamen(BASIS).tekst.toLowerCase();

      for (const woord of ['direct', 'onmiddellijk', 'urgent', 'let op!']) {
        expect(tekst).not.toContain(woord);
      }
    });

    it('zet geen Reply-To — dit bericht komt van het platform', () => {
      // Anders dan de leveranciersmail: de klant heeft nog geen omgeving om
      // namens te spreken, die wordt hier juist geopend.
      expect(stelBeheerderUitnodigingSamen(BASIS).antwoordAan).toBeUndefined();
    });
  });

  describe('afzender', () => {
    it('is MCM2 zelf, niet de tenant', () => {
      expect(stelBeheerderUitnodigingSamen(BASIS).afzenderNaam).toBe('MCM2');
    });

    it('gaat naar het opgegeven adres', () => {
      expect(stelBeheerderUitnodigingSamen(BASIS).aan).toBe(
        'beheerder@transdev.nl',
      );
    });
  });

  describe('randgevallen', () => {
    it('laat een onleesbare datum staan zoals hij is', () => {
      // Beter een ruwe waarde in de mail dan 'Invalid Date' of een lege regel:
      // het eerste is zichtbaar fout, het tweede lijkt bedoeld.
      const bericht = stelBeheerderUitnodigingSamen({
        ...BASIS,
        verlooptOp: 'geen datum',
      });

      expect(bericht.tekst).toContain('geen datum');
      expect(bericht.tekst).not.toContain('Invalid Date');
    });
  });
});
