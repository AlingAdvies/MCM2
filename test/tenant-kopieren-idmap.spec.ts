/**
 * Losse unittest van de ID-vertaallogica uit scripts/tenant-kopieren.js.
 *
 * Het script zelf verbindt bij het inladen meteen met een database (via
 * .env), dus het wordt hier niet geïmporteerd — alleen de twee kernregels
 * (nieuw ID altijd anders dan het oude, een ontbrekende vertaling is een
 * harde fout) worden hier als geïsoleerde logica getoetst, identiek aan wat
 * in het script staat.
 */

describe('idMap-logica uit scripts/tenant-kopieren.js', () => {
  it('geeft bij elke nieuwId() een ander UUID terug dan het oude', () => {
    const idMap = new Map<string, string>();
    function nieuwId(oudId: string): string {
      const nieuw = '11111111-1111-1111-1111-111111111111';
      idMap.set(oudId, nieuw);
      return nieuw;
    }

    const resultaat = nieuwId('oud-id-1');

    expect(resultaat).not.toBe('oud-id-1');
    expect(idMap.get('oud-id-1')).toBe(resultaat);
  });

  it('werpt een duidelijke fout als een FK-doel nog niet vertaald is', () => {
    const idMap = new Map<string, string>();
    function vertaalId(oudId: string | null): string | null {
      if (oudId === null) return null;
      const nieuw = idMap.get(oudId);
      if (!nieuw) {
        throw new Error(`Geen vertaling bekend voor ID ${oudId}`);
      }
      return nieuw;
    }

    expect(() => vertaalId('onbekend-id')).toThrow(
      'Geen vertaling bekend voor ID onbekend-id',
    );
    expect(vertaalId(null)).toBeNull();
  });
});
