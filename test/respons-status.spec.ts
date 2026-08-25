import {
  bepaalStatus,
  STATUS_LABEL,
  RESPONS_STATUSSEN,
  type StatusFeiten,
} from '../src/survey/respons-status';

/**
 * De statusberekening (plan 2026-08-07, §3).
 *
 * Unittests en geen e2e: hier zit geen database of RLS bij, alleen de regel
 * zelf. Die regel is de centrale waarheid van de app, dus elke tak verdient
 * een eigen test — inclusief de gevallen die de eigenaar expliciet noemde.
 */

const DAG = 24 * 60 * 60 * 1000;

function feiten(overschrijf: Partial<StatusFeiten> = {}): StatusFeiten {
  return {
    submittedAt: null,
    closesAt: null,
    rondeStatus: 'active',
    laatsteOordeel: null,
    ...overschrijf,
  };
}

describe('bepaalStatus', () => {
  describe('nog niet ingediend', () => {
    it('is opgestuurd zonder sluitdatum', () => {
      expect(bepaalStatus(feiten())).toBe('opgestuurd');
    });

    it('is opgestuurd zolang de sluitdatum niet is gepasseerd', () => {
      expect(
        bepaalStatus(feiten({ closesAt: new Date(Date.now() + 7 * DAG) })),
      ).toBe('opgestuurd');
    });

    it('is te laat zodra de sluitdatum is gepasseerd', () => {
      expect(
        bepaalStatus(feiten({ closesAt: new Date(Date.now() - 1 * DAG) })),
      ).toBe('te_laat');
    });

    // Een ronde in draft is nog niet uitgestuurd; dan is er niets te laat.
    it.each(['draft', 'finished', 'archived'])(
      'is niet te laat bij een ronde met status %s',
      (rondeStatus) => {
        expect(
          bepaalStatus(
            feiten({ closesAt: new Date(Date.now() - 1 * DAG), rondeStatus }),
          ),
        ).toBe('opgestuurd');
      },
    );

    it('accepteert een ISO-string net zo goed als een Date', () => {
      const verleden = new Date(Date.now() - 1 * DAG).toISOString();

      expect(bepaalStatus(feiten({ closesAt: verleden }))).toBe('te_laat');
    });
  });

  describe('ingediend', () => {
    const ingediend = { submittedAt: new Date(Date.now() - 2 * DAG) };

    it('is terug zolang er geen oordeel is', () => {
      expect(bepaalStatus(feiten(ingediend))).toBe('terug');
    });

    // Een gepasseerde sluitdatum doet er niet meer toe zodra er is ingediend.
    it('is terug, ook als de sluitdatum is gepasseerd', () => {
      expect(
        bepaalStatus(
          feiten({ ...ingediend, closesAt: new Date(Date.now() - 1 * DAG) }),
        ),
      ).toBe('terug');
    });

    it.each(['goed', 'nadere_vragen'])(
      'is beoordeeld bij het inhoudelijke oordeel %s',
      (laatsteOordeel) => {
        expect(bepaalStatus(feiten({ ...ingediend, laatsteOordeel }))).toBe(
          'beoordeeld',
        );
      },
    );

    // 'niet_goed' krijgt een eigen status: voor een auditor moet een
    // afkeuring in één oogopslag opvallen, niet verdwijnen achter de
    // neutrale 'beoordeeld'-badge naast een 'goed'-oordeel.
    it('is afgekeurd wanneer het laatste oordeel niet_goed is', () => {
      expect(
        bepaalStatus(feiten({ ...ingediend, laatsteOordeel: 'niet_goed' })),
      ).toBe('afgekeurd');
    });

    it('is goedgekeurd wanneer het laatste oordeel goedgekeurd is', () => {
      expect(
        bepaalStatus(feiten({ ...ingediend, laatsteOordeel: 'goedgekeurd' })),
      ).toBe('goedgekeurd');
    });
  });

  describe('het laatste oordeel telt (besluit eigenaar 2026-08-07)', () => {
    const ingediend = { submittedAt: new Date(Date.now() - 2 * DAG) };

    // Dit is de vervolgvraag op V3, en het minst vanzelfsprekende geval:
    // schrijft iemand ná een goedkeuring alsnog 'niet_goed', dan staat de
    // inzending weer op 'afgekeurd' (was 'beoordeeld' vóór de eigen
    // afgekeurd-status). Een goedkeuring die blijft staan terwijl er een
    // afwijzing onder hangt, is niet herstelbaar zonder dat iemand het merkt.
    it('valt terug op afgekeurd als er na goedkeuring een afwijzing komt', () => {
      expect(
        bepaalStatus(feiten({ ...ingediend, laatsteOordeel: 'niet_goed' })),
      ).toBe('afgekeurd');
    });

    // De keerzijde: een ingetrokken goedkeuring hoort niet meer te tellen. Dat
    // regelt de query (deleted_at IS NULL); hier bewijst de test dat de functie
    // niets anders doet dan naar het meegegeven laatste oordeel kijken.
    it('kijkt alleen naar het meegegeven laatste oordeel', () => {
      expect(bepaalStatus(feiten({ ...ingediend, laatsteOordeel: null }))).toBe(
        'terug',
      );
    });
  });

  describe('labels', () => {
    it('heeft voor elke status een Nederlands label', () => {
      for (const status of RESPONS_STATUSSEN) {
        expect(STATUS_LABEL[status]).toBeTruthy();
      }
    });

    // De labels zijn wat de gebruiker leest; ze horen letterlijk bij de
    // formulering van de eigenaar te blijven.
    it('noemt de vier statussen zoals de eigenaar ze formuleerde', () => {
      expect(STATUS_LABEL.opgestuurd).toBe('Opgestuurd, nog niet terug');
      expect(STATUS_LABEL.terug).toBe('Terug, nog niet beoordeeld');
      expect(STATUS_LABEL.beoordeeld).toBe('Beoordeeld, nog niet goedgekeurd');
      expect(STATUS_LABEL.goedgekeurd).toBe('Beoordeeld en goedgekeurd');
    });
  });
});
