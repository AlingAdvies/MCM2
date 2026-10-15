import { bouwResultaten } from './ronde-resultaten';

const vragen = [
  {
    questionKey: 'intro',
    title: 'Waarom',
    answerType: 'instruction',
    categorieNaam: null,
    config: {},
  },
  {
    questionKey: 'q1',
    title: '1.2 Beleid',
    answerType: 'single_choice',
    categorieNaam: 'Organisatorisch',
    config: {
      options: [
        { code: 'ja', label: 'Ja' },
        { code: 'nee', label: 'Nee' },
      ],
    },
  },
];

describe('bouwResultaten', () => {
  it('telt per vraag de gekozen opties van ingediende antwoorden', () => {
    const uitkomst = bouwResultaten(vragen, [
      {
        responseId: 'r1',
        vendorNaam: 'Alfa',
        ingediend: true,
        antwoorden: { q1: 'ja' },
      },
      {
        responseId: 'r2',
        vendorNaam: 'Bravo',
        ingediend: true,
        antwoorden: { q1: 'nee' },
      },
      {
        responseId: 'r3',
        vendorNaam: 'Charlie',
        ingediend: true,
        antwoorden: { q1: 'ja' },
      },
    ]);

    expect(uitkomst.vragen).toHaveLength(1);
    expect(uitkomst.vragen[0].verdeling).toEqual({ ja: 2, nee: 1 });
    expect(uitkomst.vragen[0].opties).toEqual([
      { code: 'ja', label: 'Ja' },
      { code: 'nee', label: 'Nee' },
    ]);
  });

  it('laat leesblokken weg', () => {
    const uitkomst = bouwResultaten(vragen, []);
    expect(uitkomst.vragen.map((v) => v.questionKey)).toEqual(['q1']);
  });

  it('telt een concept van een niet-ingediende leverancier niet mee', () => {
    // Een concept kan nog veranderen; het hoort niet in een resultaat.
    const uitkomst = bouwResultaten(vragen, [
      {
        responseId: 'r1',
        vendorNaam: 'Alfa',
        ingediend: true,
        antwoorden: { q1: 'ja' },
      },
      {
        responseId: 'r2',
        vendorNaam: 'Bravo',
        ingediend: false,
        antwoorden: { q1: 'nee' },
      },
    ]);

    expect(uitkomst.vragen[0].verdeling).toEqual({ ja: 1 });
    expect(uitkomst.leveranciers.find((l) => l.vendorNaam === 'Bravo')).toEqual(
      {
        responseId: 'r2',
        vendorNaam: 'Bravo',
        ingediend: false,
        antwoorden: {},
      },
    );
  });

  it('telt de ingediende leveranciers', () => {
    const uitkomst = bouwResultaten(vragen, [
      { responseId: 'r1', vendorNaam: 'Alfa', ingediend: true, antwoorden: {} },
      {
        responseId: 'r2',
        vendorNaam: 'Bravo',
        ingediend: false,
        antwoorden: {},
      },
    ]);
    expect(uitkomst.aantalIngediend).toBe(1);
    expect(uitkomst.aantalDeelnemers).toBe(2);
  });
});
