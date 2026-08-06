import { LogMailKanaal } from './log-mail-kanaal';
import { MailBericht, MailKanaal, MailVerzendFout } from './mail-kanaal';

/**
 * Tegenproef 5 uit het mailkanaal-ontwerp §7: de verzendcode werkt zonder
 * netwerkverbinding.
 *
 * Deze tests raken bewust geen enkele externe dienst. Zou dat wel zo zijn, dan
 * is elke test afhankelijk van een sleutel, een domein en een werkende
 * internetverbinding — en dan draaien ze uiteindelijk niet meer.
 */

const BERICHT: MailBericht = {
  aan: 'chris+demo-vendor1@gmail.com',
  afzenderNaam: 'Demo-organisatie via MCM2',
  antwoordAan: 'contractmanagement@demo.nl',
  onderwerp: 'Uitnodiging vragenlijst',
  tekst: 'Vul de vragenlijst in via de link.',
};

describe('LogMailKanaal', () => {
  let kanaal: LogMailKanaal;

  beforeEach(() => {
    kanaal = new LogMailKanaal();
  });

  it('is een MailKanaal', () => {
    // De hele knip staat of valt hiermee: als dit geen MailKanaal is, kan de
    // aanroeper niet tussen implementaties wisselen zonder aanpassing.
    expect(kanaal).toBeInstanceOf(MailKanaal);
  });

  it('verstuurt zonder netwerkverbinding en geeft een providerId terug', async () => {
    const resultaat = await kanaal.verstuur(BERICHT);

    expect(resultaat.providerId).toMatch(/^log-/);
    expect(resultaat.providerId.length).toBeGreaterThan(10);
  });

  it('geeft elk bericht een eigen providerId', async () => {
    // Het providerId is de sleutel waarmee een latere statusmelding gekoppeld
    // wordt (ontwerp §4). Twee berichten met hetzelfde id zouden betekenen dat
    // een bounce aan de verkeerde leverancier hangt.
    const eerste = await kanaal.verstuur(BERICHT);
    const tweede = await kanaal.verstuur({
      ...BERICHT,
      aan: 'chris+demo-vendor2@gmail.com',
    });

    expect(eerste.providerId).not.toBe(tweede.providerId);
  });

  describe('de verzendlijst', () => {
    it('begint leeg', () => {
      expect(kanaal.verzonden).toHaveLength(0);
      expect(kanaal.laatste).toBeUndefined();
    });

    it('bewaart wat er verstuurd is, in volgorde', async () => {
      await kanaal.verstuur({
        ...BERICHT,
        aan: 'chris+demo-vendor1@gmail.com',
      });
      await kanaal.verstuur({
        ...BERICHT,
        aan: 'chris+demo-vendor2@gmail.com',
      });

      expect(kanaal.verzonden).toHaveLength(2);
      expect(kanaal.verzonden[0].aan).toBe('chris+demo-vendor1@gmail.com');
      expect(kanaal.verzonden[1].aan).toBe('chris+demo-vendor2@gmail.com');
    });

    it('bewaart de afzendernaam en het antwoordadres', async () => {
      // Dit is wat een e2e-test straks moet kunnen vaststellen: dat de klant
      // herkenbaar is en dat antwoorden bij de klant terechtkomen. Zonder deze
      // velden in de lijst is dat niet te controleren zonder echte mail.
      await kanaal.verstuur(BERICHT);

      expect(kanaal.laatste?.afzenderNaam).toBe('Demo-organisatie via MCM2');
      expect(kanaal.laatste?.antwoordAan).toBe('contractmanagement@demo.nl');
    });

    it('kan geleegd worden', async () => {
      await kanaal.verstuur(BERICHT);
      kanaal.leeg();

      expect(kanaal.verzonden).toHaveLength(0);
    });
  });

  describe('validatie — even streng als het echte kanaal', () => {
    it('weigert een ongeldig adres met MailVerzendFout', async () => {
      // Zou de testdubbel toegeeflijker zijn dan de echte implementatie, dan
      // zijn groene tests geen bewijs dat het in productie werkt.
      await expect(
        kanaal.verstuur({ ...BERICHT, aan: 'geen-adres' }),
      ).rejects.toThrow(MailVerzendFout);
    });

    it('merkt een geweigerd bericht niet aan als verzonden', async () => {
      await expect(
        kanaal.verstuur({ ...BERICHT, aan: 'geen-adres' }),
      ).rejects.toThrow();

      expect(kanaal.verzonden).toHaveLength(0);
    });

    it('markeert de fout als niet-tijdelijk', async () => {
      // Een fout adres wordt niet beter door het nog eens te proberen. Het
      // onderscheid stuurt straks of de ronde opnieuw mag verzenden.
      await expect(
        kanaal.verstuur({ ...BERICHT, aan: 'geen-adres' }),
      ).rejects.toMatchObject({
        tijdelijk: false,
      });
    });

    it('accepteert plusadressering', async () => {
      // De demo-opzet uit ontwerp §6 leunt hierop.
      await expect(
        kanaal.verstuur({ ...BERICHT, aan: 'chris+demo-vendor5@gmail.com' }),
      ).resolves.toBeDefined();
    });
  });

  describe('antwoordAan is optioneel', () => {
    it('verstuurt ook zonder antwoordadres', async () => {
      // Een tenant kan het (nog) niet ingevuld hebben. Dat mag de uitnodiging
      // niet tegenhouden — dan komt er geen enkele vragenlijst de deur uit
      // omdat één instelling ontbreekt.
      const zonder: MailBericht = {
        aan: BERICHT.aan,
        afzenderNaam: BERICHT.afzenderNaam,
        onderwerp: BERICHT.onderwerp,
        tekst: BERICHT.tekst,
      };

      await expect(kanaal.verstuur(zonder)).resolves.toBeDefined();
      expect(kanaal.laatste?.antwoordAan).toBeUndefined();
    });
  });
});
