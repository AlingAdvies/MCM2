import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TEST_IDS, alleTestIds } from './test-ids';

/**
 * Bewaakt de afspraak uit test-ids.ts.
 *
 * Een unittest, geen e2e-test: hij leest bestanden en heeft geen database
 * nodig. Daarmee draait hij in de snelle poort en niet pas in de trage.
 *
 * Dit is de controle die het register betekenis geeft. Zonder deze test is
 * "elke suite een eigen blok" een goed voornemen dat de eerste keer sneuvelt
 * dat iemand haast heeft.
 */
describe("test-ids: geen botsende UUID's tussen suites", () => {
  it('deelt geen enkel id twee keer uit', () => {
    const ids = alleTestIds();
    const gezien = new Map<string, number>();

    for (const waarde of ids) {
      gezien.set(waarde, (gezien.get(waarde) ?? 0) + 1);
    }

    const dubbel = [...gezien.entries()]
      .filter(([, aantal]) => aantal > 1)
      .map(([waarde]) => waarde);

    // Dit is de faalvorm die op 2026-07-31 een onregelmatig falende suite
    // opleverde: twee suites die dezelfde tenant aanmaken en opruimen.
    expect(dubbel).toEqual([]);
  });

  it('geeft elke suite minstens één id', () => {
    for (const [suite, blok] of Object.entries(TEST_IDS)) {
      expect(Object.keys(blok).length).toBeGreaterThan(0);
      expect(suite).not.toBe('');
    }
  });

  it('gebruikt geen enkele e2e-suite een UUID die niet uit het register komt', () => {
    // De strengste controle: zoekt letterlijke test-UUID's in de suites en
    // eist dat ze in het register staan. Zonder deze test kan iemand een id
    // in een suite hardcoderen, langs het register heen, en dan botst het
    // alsnog — precies wat er gebeurd was.
    const testMap = __dirname;
    const geregistreerd = new Set(alleTestIds());
    const patroon = /'00000000-0000-0000-0000-[0-9a-f]{12}'/g;

    const overtredingen: string[] = [];

    for (const naam of readdirSync(testMap)) {
      if (!naam.endsWith('.e2e-spec.ts')) continue;

      const inhoud = readFileSync(join(testMap, naam), 'utf8');

      for (const treffer of inhoud.match(patroon) ?? []) {
        const waarde = treffer.slice(1, -1);
        if (!geregistreerd.has(waarde)) {
          overtredingen.push(`${naam}: ${waarde}`);
        }
      }
    }

    expect(overtredingen).toEqual([]);
  });
});
