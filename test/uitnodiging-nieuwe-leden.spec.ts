// Tests voor scripts/uitnodiging-nieuwe-leden.js — de pure vergelijkingsfunctie
// achter de Telegram-melding bij een geaccepteerde tenant-uitnodiging.
//
// Zelfde patroon als test/db-doelwit.spec.ts: het script staat in scripts/
// (buiten de applicatiebuild) en wordt hier via require() getest, omdat de
// Jest-config alleen *.spec.ts binnen src/ en test/ oppikt.

/* eslint-disable @typescript-eslint/no-require-imports,
                  @typescript-eslint/no-unsafe-assignment,
                  @typescript-eslint/no-unsafe-call */
const { bepaalNieuweLeden } = require('../scripts/uitnodiging-nieuwe-leden.js');

describe('bepaalNieuweLeden', () => {
  it('herkent een lid dat er bij de vorige run nog niet bij stond', () => {
    const vorige = new Set(['a']);
    const huidige = [
      { userId: 'a', naam: 'Bestaand', email: 'a@x.nl', rol: 'lezer' },
      { userId: 'b', naam: 'Nieuw', email: 'b@x.nl', rol: 'beheerder' },
    ];

    const resultaat = bepaalNieuweLeden(vorige, huidige);

    expect(resultaat).toEqual([
      { userId: 'b', naam: 'Nieuw', email: 'b@x.nl', rol: 'beheerder' },
    ]);
  });

  it('geeft een lege lijst als er niets nieuw is', () => {
    const vorige = new Set(['a', 'b']);
    const huidige = [
      { userId: 'a', naam: 'A', email: 'a@x.nl', rol: 'lezer' },
      { userId: 'b', naam: 'B', email: 'b@x.nl', rol: 'lezer' },
    ];

    expect(bepaalNieuweLeden(vorige, huidige)).toEqual([]);
  });

  it('behandelt een lege vorige lijst als eerste run: alles is "nieuw"', () => {
    const vorige = new Set();
    const huidige = [{ userId: 'a', naam: 'A', email: 'a@x.nl', rol: 'lezer' }];

    // Bewuste keuze (spec: "Kapotte/onleesbare lokale statusfile wordt
    // behandeld als lege lijst"): een lege vorige-lijst levert altijd alle
    // huidige leden op als "nieuw". De aanroeper (uitnodiging-controle.js)
    // onderdrukt berichten bij een allereerste run apart, niet deze functie.
    expect(bepaalNieuweLeden(vorige, huidige)).toEqual([
      { userId: 'a', naam: 'A', email: 'a@x.nl', rol: 'lezer' },
    ]);
  });
});
