import {
  UitnodigingGegevens,
  stelUitnodigingSamen,
} from './uitnodiging-bericht';

/**
 * De uitnodigingstekst is het enige wat een leverancier van MCM2 ziet vóór hij
 * besluit te klikken. Deze tests leggen vast wat er in moet staan — niet de
 * exacte formulering, want die mag veranderen, maar de elementen zonder welke
 * de mail zijn doel mist.
 */

const GEGEVENS: UitnodigingGegevens = {
  ontvanger: 'contact+vendor1@gmail.com',
  vendorNaam: 'Acme Infrastructuur B.V.',
  tenantNaam: 'Transdev',
  vragenlijstNaam: 'Jaarlijkse IT-risicovragenlijst',
  link: 'https://mcm2.example.nl/portal/survey/abc123',
  verlooptOp: '2026-09-01T12:00:00.000Z',
  antwoordAan: 'contractmanagement@transdev.nl',
};

describe('stelUitnodigingSamen', () => {
  describe('de afzender — ontwerp §3', () => {
    it('zet de opdrachtgever voorop in de afzendernaam', () => {
      // Dit is wat de leverancier in zijn inbox ziet. Zonder herkenbare
      // opdrachtgever klikt hij niet, of meldt hij de mail als phishing.
      const bericht = stelUitnodigingSamen(GEGEVENS);

      expect(bericht.afzenderNaam).toBe('Transdev via MCM2');
    });

    it('stuurt antwoorden naar de opdrachtgever', () => {
      const bericht = stelUitnodigingSamen(GEGEVENS);

      expect(bericht.antwoordAan).toBe('contractmanagement@transdev.nl');
    });

    it('noemt de opdrachtgever in het onderwerp', () => {
      const bericht = stelUitnodigingSamen(GEGEVENS);

      expect(bericht.onderwerp).toContain('Transdev');
      expect(bericht.onderwerp).toContain('Jaarlijkse IT-risicovragenlijst');
    });
  });

  describe('de inhoud', () => {
    it('bevat de link voluit', () => {
      // Voluit en niet verstopt achter een woord: een leverancier die de
      // afzender niet vertrouwt, moet de URL kunnen bekijken zonder te klikken.
      const bericht = stelUitnodigingSamen(GEGEVENS);

      expect(bericht.tekst).toContain(
        'https://mcm2.example.nl/portal/survey/abc123',
      );
    });

    it('noemt de leverancier bij naam', () => {
      const bericht = stelUitnodigingSamen(GEGEVENS);

      expect(bericht.tekst).toContain('Acme Infrastructuur B.V.');
    });

    it('legt uit waarom de ontvanger dit krijgt', () => {
      // Zonder die uitleg leest de mail als ongevraagde post.
      const bericht = stelUitnodigingSamen(GEGEVENS);

      expect(bericht.tekst).toMatch(/omdat u als leverancier/i);
    });

    it('noemt de vervaldatum leesbaar, niet als ISO-tijdstempel', () => {
      // "1 september 2026" en niet "2026-09-01T12:00:00.000Z". Bij een uiterste
      // datum is een misgelezen dag/maand het verschil tussen op tijd en te laat.
      const bericht = stelUitnodigingSamen(GEGEVENS);

      expect(bericht.tekst).toContain('1 september 2026');
      expect(bericht.tekst).not.toContain('2026-09-01T');
    });

    it('waarschuwt dat indienen definitief is', () => {
      // Het portaal kent geen herziening na indienen (vragenlijst-ontwerp §1b).
      // Dat hoort de leverancier te weten vóórdat hij begint.
      const bericht = stelUitnodigingSamen(GEGEVENS);

      expect(bericht.tekst).toMatch(/niet meer gewijzigd/i);
    });
  });

  describe('zonder antwoordadres', () => {
    const zonder: UitnodigingGegevens = {
      ...GEGEVENS,
      antwoordAan: undefined,
    };

    it('laat antwoordAan weg', () => {
      expect(stelUitnodigingSamen(zonder).antwoordAan).toBeUndefined();
    });

    it('nodigt niet uit om te antwoorden', () => {
      // Zou de tekst "beantwoord dit bericht" zeggen zonder Reply-To, dan komt
      // het antwoord bij ons terecht en kunnen wij het niet beantwoorden.
      const bericht = stelUitnodigingSamen(zonder);

      expect(bericht.tekst).not.toMatch(/beantwoord dit bericht/i);
      expect(bericht.tekst).toMatch(/neem contact op/i);
    });
  });

  describe('robuustheid', () => {
    it('valt terug op de ruwe waarde bij een onleesbare datum', () => {
      // Liever een lelijke datum dan "Invalid Date" in een mail aan een klant.
      const bericht = stelUitnodigingSamen({
        ...GEGEVENS,
        verlooptOp: 'geen-datum',
      });

      expect(bericht.tekst).toContain('geen-datum');
      expect(bericht.tekst).not.toContain('Invalid Date');
    });

    it('stuurt naar het opgegeven adres', () => {
      const bericht = stelUitnodigingSamen(GEGEVENS);

      expect(bericht.aan).toBe('contact+vendor1@gmail.com');
    });
  });
});
