import { MailBericht, MailKanaal, MailVerzendFout } from './mail-kanaal';
import { MailConfig } from './mail.config';
import { ResendMailKanaal } from './resend-mail-kanaal';

/**
 * De Resend-SDK wordt hier nagebootst. Deze tests raken geen netwerk: ze meten
 * onze vertaling van "wat Resend teruggeeft" naar "wat de aanroeper moet weten",
 * en dat is precies het stuk waar de stille faalvormen zitten.
 *
 * Wat ze NIET bewijzen: dat een mail werkelijk aankomt. Dat vraagt een
 * geverifieerd domein en een echte verzending — stap 3 uit ontwerp §9, en
 * tegenproef 1.
 */

/**
 * De opties waarmee onze code Resend aanroept.
 *
 * Expliciet getypeerd en niet `any`: zo controleren de tests hieronder de
 * werkelijke velden en niet wat de compiler toevallig doorlaat.
 */
interface VerstuurOpties {
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

const verstuurMock = jest.fn<Promise<unknown>, [VerstuurOpties]>();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: verstuurMock },
  })),
}));

/** De opties van de n-de aanroep, getypeerd. */
function opties(n = 0): VerstuurOpties {
  return verstuurMock.mock.calls[n][0];
}

const CONFIG: MailConfig = {
  apiSleutel: 're_test_sleutel',
  afzenderAdres: 'uitvraag@mcm2mail.nl',
};

const BERICHT: MailBericht = {
  aan: 'chris+demo-vendor1@gmail.com',
  afzenderNaam: 'Transdev via MCM2',
  antwoordAan: 'contractmanagement@transdev.nl',
  onderwerp: 'Uitnodiging vragenlijst',
  tekst: 'Vul de vragenlijst in via de link.',
};

/** Wat de SDK teruggeeft bij succes. */
function geslaagd(id = 'resend-id-123') {
  return { data: { id }, error: null };
}

/** Wat de SDK teruggeeft bij een fout — geen throw, maar een error-veld. */
function geweigerd(name: string, message = 'ging mis') {
  return { data: null, error: { name, message } };
}

describe('ResendMailKanaal', () => {
  let kanaal: ResendMailKanaal;

  beforeEach(() => {
    verstuurMock.mockReset();
    kanaal = new ResendMailKanaal(CONFIG);
  });

  it('is een MailKanaal', () => {
    expect(kanaal).toBeInstanceOf(MailKanaal);
  });

  describe('de afzenderconstructie — ontwerp §3', () => {
    it('zet de klantnaam in de display name en ons adres erachter', async () => {
      verstuurMock.mockResolvedValue(geslaagd());

      await kanaal.verstuur(BERICHT);

      expect(verstuurMock).toHaveBeenCalledWith(
        expect.objectContaining({
          from: '"Transdev via MCM2" <uitvraag@mcm2mail.nl>',
        }),
      );
    });

    it('stuurt Reply-To naar het adres van de tenant', async () => {
      // Zonder dit komen vragen van leveranciers bij ons terecht, en wij kunnen
      // ze niet beantwoorden.
      verstuurMock.mockResolvedValue(geslaagd());

      await kanaal.verstuur(BERICHT);

      expect(verstuurMock).toHaveBeenCalledWith(
        expect.objectContaining({ replyTo: 'contractmanagement@transdev.nl' }),
      );
    });

    it('laat replyTo weg als de tenant geen antwoordadres heeft', async () => {
      // Een lege replyTo is een validatiefout bij Resend. Dan zou één
      // ontbrekende instelling de hele ronde tegenhouden.
      verstuurMock.mockResolvedValue(geslaagd());

      await kanaal.verstuur({
        aan: BERICHT.aan,
        afzenderNaam: BERICHT.afzenderNaam,
        onderwerp: BERICHT.onderwerp,
        tekst: BERICHT.tekst,
      });

      expect(opties()).not.toHaveProperty('replyTo');
    });

    it('weert tekens waarmee een tenantnaam de header kan breken', async () => {
      // De afzendernaam komt uit de database en is door een tenantbeheerder in
      // te vullen. Een `<` of een aanhalingsteken erin mag geen tweede adres
      // kunnen binnensmokkelen.
      verstuurMock.mockResolvedValue(geslaagd());

      await kanaal.verstuur({
        ...BERICHT,
        afzenderNaam: 'Kwaad" <aanvaller@elders.nl> "',
      });

      const from = opties().from;
      expect(from).toBe('"Kwaad aanvaller@elders.nl" <uitvraag@mcm2mail.nl>');
      expect(from).not.toContain('<aanvaller@elders.nl>');
    });

    it('valt terug op het kale adres bij een lege afzendernaam', async () => {
      verstuurMock.mockResolvedValue(geslaagd());

      await kanaal.verstuur({ ...BERICHT, afzenderNaam: '   ' });

      expect(opties().from).toBe('uitvraag@mcm2mail.nl');
    });
  });

  describe('geslaagde verzending', () => {
    it('geeft het bericht-id van Resend terug', async () => {
      // Dit id is de sleutel waarmee een latere bounce gekoppeld wordt
      // (ontwerp §4). Zonder dat is een statusmelding niet te herleiden.
      verstuurMock.mockResolvedValue(geslaagd('abc-123'));

      const resultaat = await kanaal.verstuur(BERICHT);

      expect(resultaat.providerId).toBe('abc-123');
    });

    it('stuurt onderwerp en tekst mee', async () => {
      verstuurMock.mockResolvedValue(geslaagd());

      await kanaal.verstuur(BERICHT);

      expect(verstuurMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'chris+demo-vendor1@gmail.com',
          subject: 'Uitnodiging vragenlijst',
          text: 'Vul de vragenlijst in via de link.',
        }),
      );
    });
  });

  describe('de daglimiet — tegenproef 6', () => {
    it('werpt bij daily_quota_exceeded in plaats van stil te slagen', async () => {
      // Het gratis plan stopt bij 100 per dag en rekent niets bij. Zou dit
      // stil doorgaan, dan staat er "verstuurd" bij vierhonderd leveranciers
      // die niets hebben gekregen — en dat blijkt pas bij de deadline.
      //
      // De foutcode wordt hier meegecontroleerd, en dat is geen franje: een
      // sabotage waarbij het hele `error`-veld genegeerd werd, liet deze test
      // aanvankelijk groen. Hij viel dan door naar de "geen id"-controle en
      // wierp om de verkeerde reden — precies het soort test dat §15b een
      // meting zonder betekenis noemt.
      verstuurMock.mockResolvedValue(
        geweigerd('daily_quota_exceeded', 'limiet bereikt'),
      );

      await expect(kanaal.verstuur(BERICHT)).rejects.toThrow(
        /daily_quota_exceeded/,
      );
    });

    it('merkt de daglimiet aan als tijdelijk', async () => {
      // Morgen mag het weer. Dat maakt het tijdelijk — maar de aanroeper moet
      // het nog steeds als mislukt vastleggen.
      verstuurMock.mockResolvedValue(geweigerd('daily_quota_exceeded'));

      await expect(kanaal.verstuur(BERICHT)).rejects.toMatchObject({
        tijdelijk: true,
      });
    });

    it.each([
      'rate_limit_exceeded',
      'monthly_quota_exceeded',
      'internal_server_error',
    ])('merkt %s aan als tijdelijk', async (code) => {
      verstuurMock.mockResolvedValue(geweigerd(code));

      await expect(kanaal.verstuur(BERICHT)).rejects.toMatchObject({
        tijdelijk: true,
      });
    });
  });

  describe('blijvende fouten', () => {
    it.each([
      'invalid_from_address',
      'validation_error',
      'invalid_api_key',
      'restricted_api_key',
    ])('merkt %s aan als niet-tijdelijk', async (code) => {
      // Opnieuw proberen heeft geen zin: er is een instelling fout. Het
      // onderscheid stuurt of de ronde mag herverzenden.
      verstuurMock.mockResolvedValue(geweigerd(code));

      await expect(kanaal.verstuur(BERICHT)).rejects.toMatchObject({
        tijdelijk: false,
      });
    });

    it('noemt de foutcode in de melding', async () => {
      verstuurMock.mockResolvedValue(
        geweigerd('invalid_from_address', 'domein niet geverifieerd'),
      );

      await expect(kanaal.verstuur(BERICHT)).rejects.toThrow(
        /invalid_from_address/,
      );
    });
  });

  describe('een antwoord zonder id', () => {
    it('werpt in plaats van een leeg providerId terug te geven', async () => {
      // Zonder id is een latere bounce niet te koppelen. Stil doorgaan levert
      // een gat in de keten op dat pas weken later opvalt.
      verstuurMock.mockResolvedValue({ data: null, error: null });

      await expect(kanaal.verstuur(BERICHT)).rejects.toThrow(/geen bericht-id/);
    });
  });

  describe('validatie vóór de netwerkaanroep', () => {
    it('weigert een ongeldig ontvangeradres', async () => {
      await expect(
        kanaal.verstuur({ ...BERICHT, aan: 'geen-adres' }),
      ).rejects.toThrow(MailVerzendFout);
    });

    it('roept Resend niet aan bij een ongeldig adres', async () => {
      // Een netwerkaanroep die zeker faalt, kost tijd en telt mee voor de
      // daglimiet.
      await expect(
        kanaal.verstuur({ ...BERICHT, aan: 'geen-adres' }),
      ).rejects.toThrow();

      expect(verstuurMock).not.toHaveBeenCalled();
    });

    it('accepteert plusadressering', async () => {
      verstuurMock.mockResolvedValue(geslaagd());

      await expect(
        kanaal.verstuur({ ...BERICHT, aan: 'chris+demo-vendor5@gmail.com' }),
      ).resolves.toBeDefined();
    });
  });
});
