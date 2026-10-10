import {
  InvoerFout,
  leesNieuwWerkingsgebied,
  leesWerkingsgebiedCodes,
  leesWerkingsgebiedWijziging,
} from './werkingsgebied-invoer';

describe('werkingsgebied-invoer', () => {
  it('accepteert een geldige nieuwe invoer en knipt de naam bij', () => {
    expect(leesNieuwWerkingsgebied({ code: 'anf', label: '  ANF ' })).toEqual({
      code: 'anf',
      label: 'ANF',
    });
  });

  it('weigert een code met hoofdletters of spaties', () => {
    for (const code of ['ANF', 'utrecht binnen', '', 'a'.repeat(51)]) {
      expect(() => leesNieuwWerkingsgebied({ code, label: 'x' })).toThrow(
        InvoerFout,
      );
    }
  });

  it('weigert een lege naam, ook bij wijzigen', () => {
    expect(() => leesNieuwWerkingsgebied({ code: 'anf', label: '  ' })).toThrow(
      InvoerFout,
    );
    expect(() => leesWerkingsgebiedWijziging({ label: '' })).toThrow(
      InvoerFout,
    );
  });

  it('leesWerkingsgebiedCodes haalt dubbele codes weg', () => {
    expect(leesWerkingsgebiedCodes({ codes: ['anf', 'hwgo', 'anf'] })).toEqual([
      'anf',
      'hwgo',
    ]);
  });

  it('leesWerkingsgebiedCodes accepteert een lege lijst (alles ontkoppelen)', () => {
    expect(leesWerkingsgebiedCodes({ codes: [] })).toEqual([]);
  });

  it('leesWerkingsgebiedCodes weigert een niet-lijst of een ongeldige code', () => {
    expect(() => leesWerkingsgebiedCodes({ codes: 'anf' })).toThrow(InvoerFout);
    expect(() => leesWerkingsgebiedCodes({})).toThrow(InvoerFout);
    expect(() => leesWerkingsgebiedCodes({ codes: ['ANF'] })).toThrow(
      InvoerFout,
    );
    expect(() => leesWerkingsgebiedCodes({ codes: [3] })).toThrow(InvoerFout);
  });
});
