import { LogMailKanaal } from './log-mail-kanaal';
import { MailKanaal, MailVerzendFout } from './mail-kanaal';
import {
  TeVersturenUitnodiging,
  UitnodigingVerzender,
} from './uitnodiging-verzender.service';

/**
 * De kernvraag van deze service: wat gebeurt er als één van de vijf faalt?
 *
 * Alles terugdraaien kan niet — de tokens staan al in de database. Stil
 * doorgaan mag niet — dan blijkt een gemiste leverancier pas bij de deadline.
 * Deze tests leggen de derde weg vast: doorgaan, en per deelnemer teruggeven
 * wat er gebeurd is.
 */

const CONTEXT = {
  tenantNaam: 'Transdev',
  vragenlijstNaam: 'Jaarlijkse IT-risicovragenlijst',
  antwoordAan: 'contractmanagement@transdev.nl',
};

function uitnodiging(
  n: number,
  overschrijf: Partial<TeVersturenUitnodiging> = {},
): TeVersturenUitnodiging {
  return {
    responseId: `response-${n}`,
    vendorNaam: `Leverancier ${n}`,
    ontvanger: `contact+vendor${n}@gmail.com`,
    link: `https://mcm2.example.nl/portal/survey/token${n}`,
    verlooptOp: '2026-09-01T12:00:00.000Z',
    ...overschrijf,
  };
}

/** Een kanaal dat faalt op de adressen die je opgeeft. */
class FalendKanaal extends MailKanaal {
  readonly verstuurd: string[] = [];

  constructor(
    private readonly faaltOp: Set<string>,
    private readonly tijdelijk = false,
  ) {
    super();
  }

  verstuur(bericht: { aan: string }) {
    if (this.faaltOp.has(bericht.aan)) {
      return Promise.reject(
        new MailVerzendFout('Resend weigerde de verzending', this.tijdelijk),
      );
    }
    this.verstuurd.push(bericht.aan);
    return Promise.resolve({ providerId: `id-${this.verstuurd.length}` });
  }
}

describe('UitnodigingVerzender', () => {
  describe('als alles goed gaat', () => {
    let kanaal: LogMailKanaal;
    let verzender: UitnodigingVerzender;

    beforeEach(() => {
      kanaal = new LogMailKanaal();
      verzender = new UitnodigingVerzender(kanaal);
    });

    it('verstuurt er één per uitnodiging', async () => {
      const uitkomsten = await verzender.verstuurAllemaal(
        [uitnodiging(1), uitnodiging(2), uitnodiging(3)],
        CONTEXT,
      );

      expect(uitkomsten).toHaveLength(3);
      expect(uitkomsten.every((u) => u.verstuurd)).toBe(true);
      expect(kanaal.verzonden).toHaveLength(3);
    });

    it('geeft per uitnodiging een providerId terug', async () => {
      // Dat id is de sleutel waarmee een latere bounce gekoppeld wordt
      // (ontwerp §4). Ontbreekt het, dan is die statusmelding niet te herleiden.
      const uitkomsten = await verzender.verstuurAllemaal(
        [uitnodiging(1)],
        CONTEXT,
      );

      expect(uitkomsten[0].providerId).toBeDefined();
    });

    it('gebruikt de tenantnaam in de afzender', async () => {
      await verzender.verstuurAllemaal([uitnodiging(1)], CONTEXT);

      expect(kanaal.laatste?.afzenderNaam).toBe('Transdev via MCM2');
      expect(kanaal.laatste?.antwoordAan).toBe(
        'contractmanagement@transdev.nl',
      );
    });

    it('houdt de volgorde aan', async () => {
      // Serieel en niet parallel: bij de daglimiet weet je dan precies vanaf
      // welke leverancier het misging.
      await verzender.verstuurAllemaal(
        [uitnodiging(1), uitnodiging(2), uitnodiging(3)],
        CONTEXT,
      );

      expect(kanaal.verzonden.map((b) => b.aan)).toEqual([
        'contact+vendor1@gmail.com',
        'contact+vendor2@gmail.com',
        'contact+vendor3@gmail.com',
      ]);
    });
  });

  describe('als er één faalt', () => {
    it('gaat door met de rest', async () => {
      // Dit is de kern. Stoppen bij de eerste fout zou betekenen dat drie
      // leveranciers geen uitnodiging krijgen omdat de tweede een fout adres had.
      const kanaal = new FalendKanaal(new Set(['contact+vendor2@gmail.com']));
      const verzender = new UitnodigingVerzender(kanaal);

      const uitkomsten = await verzender.verstuurAllemaal(
        [uitnodiging(1), uitnodiging(2), uitnodiging(3)],
        CONTEXT,
      );

      expect(uitkomsten).toHaveLength(3);
      expect(kanaal.verstuurd).toEqual([
        'contact+vendor1@gmail.com',
        'contact+vendor3@gmail.com',
      ]);
    });

    it('markeert alleen de mislukte als niet-verstuurd', async () => {
      const kanaal = new FalendKanaal(new Set(['contact+vendor2@gmail.com']));
      const verzender = new UitnodigingVerzender(kanaal);

      const uitkomsten = await verzender.verstuurAllemaal(
        [uitnodiging(1), uitnodiging(2), uitnodiging(3)],
        CONTEXT,
      );

      expect(uitkomsten.map((u) => u.verstuurd)).toEqual([true, false, true]);
    });

    it('geeft de reden mee, zodat het scherm hem kan tonen', async () => {
      // Zonder reden weet de beheerder dat er iets misging maar niet wat, en
      // dan kan hij niet gericht ingrijpen.
      const kanaal = new FalendKanaal(new Set(['contact+vendor1@gmail.com']));
      const verzender = new UitnodigingVerzender(kanaal);

      const [uitkomst] = await verzender.verstuurAllemaal(
        [uitnodiging(1)],
        CONTEXT,
      );

      expect(uitkomst.fout).toContain('Resend weigerde');
      expect(uitkomst.vendorNaam).toBe('Leverancier 1');
    });

    it('geeft door of opnieuw proberen zin heeft', async () => {
      const tijdelijk = new UitnodigingVerzender(
        new FalendKanaal(new Set(['contact+vendor1@gmail.com']), true),
      );
      const blijvend = new UitnodigingVerzender(
        new FalendKanaal(new Set(['contact+vendor1@gmail.com']), false),
      );

      const [a] = await tijdelijk.verstuurAllemaal([uitnodiging(1)], CONTEXT);
      const [b] = await blijvend.verstuurAllemaal([uitnodiging(1)], CONTEXT);

      expect(a.tijdelijk).toBe(true);
      expect(b.tijdelijk).toBe(false);
    });

    it('werpt niet — de aanroeper moet de hele lijst krijgen', async () => {
      // Zou dit werpen, dan verliest de aanroeper de uitkomst van de
      // uitnodigingen die wél gelukt zijn.
      const kanaal = new FalendKanaal(
        new Set(['contact+vendor1@gmail.com', 'contact+vendor2@gmail.com']),
      );
      const verzender = new UitnodigingVerzender(kanaal);

      await expect(
        verzender.verstuurAllemaal([uitnodiging(1), uitnodiging(2)], CONTEXT),
      ).resolves.toHaveLength(2);
    });
  });

  describe('leverancier zonder e-mailadres', () => {
    it('meldt dat als een mislukking, niet als succes', async () => {
      // Ontbrekende stamdata hoort net zo zichtbaar te zijn als een geweigerde
      // verzending. Anders is die leverancier stilzwijgend overgeslagen.
      const kanaal = new LogMailKanaal();
      const verzender = new UitnodigingVerzender(kanaal);

      const [uitkomst] = await verzender.verstuurAllemaal(
        [uitnodiging(1, { ontvanger: undefined })],
        CONTEXT,
      );

      expect(uitkomst.verstuurd).toBe(false);
      expect(uitkomst.fout).toMatch(/geen e-mailadres/i);
    });

    it('probeert niet te versturen', async () => {
      const kanaal = new LogMailKanaal();
      const verzender = new UitnodigingVerzender(kanaal);

      await verzender.verstuurAllemaal(
        [uitnodiging(1, { ontvanger: undefined })],
        CONTEXT,
      );

      expect(kanaal.verzonden).toHaveLength(0);
    });

    it('houdt de andere leveranciers niet tegen', async () => {
      const kanaal = new LogMailKanaal();
      const verzender = new UitnodigingVerzender(kanaal);

      const uitkomsten = await verzender.verstuurAllemaal(
        [uitnodiging(1, { ontvanger: undefined }), uitnodiging(2)],
        CONTEXT,
      );

      expect(uitkomsten[0].verstuurd).toBe(false);
      expect(uitkomsten[1].verstuurd).toBe(true);
    });
  });

  describe('zonder antwoordadres', () => {
    it('verstuurt gewoon door', async () => {
      // Een tenant die zijn contactadres niet heeft ingevuld mag geen ronde
      // blokkeren.
      const kanaal = new LogMailKanaal();
      const verzender = new UitnodigingVerzender(kanaal);

      const uitkomsten = await verzender.verstuurAllemaal([uitnodiging(1)], {
        tenantNaam: 'Transdev',
        vragenlijstNaam: 'Vragenlijst',
      });

      expect(uitkomsten[0].verstuurd).toBe(true);
      expect(kanaal.laatste?.antwoordAan).toBeUndefined();
    });
  });

  describe('lege lijst', () => {
    it('doet niets en geeft niets terug', async () => {
      const kanaal = new LogMailKanaal();
      const verzender = new UitnodigingVerzender(kanaal);

      await expect(verzender.verstuurAllemaal([], CONTEXT)).resolves.toEqual(
        [],
      );
      expect(kanaal.verzonden).toHaveLength(0);
    });
  });
});
