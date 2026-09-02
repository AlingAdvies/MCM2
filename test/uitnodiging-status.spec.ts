// Tests voor scripts/uitnodiging-status.js — de lokale "welke user_id's
// kende ik al"-statusfile achter de Telegram-melding bij een geaccepteerde
// tenant-uitnodiging.
//
// Zelfde patroon als test/db-doelwit.spec.ts.

/* eslint-disable @typescript-eslint/no-require-imports,
                  @typescript-eslint/no-unsafe-assignment,
                  @typescript-eslint/no-unsafe-call,
                  @typescript-eslint/no-unsafe-member-access */
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  leesGezienIds,
  schrijfGezienIds,
} = require('../scripts/uitnodiging-status.js');

describe('uitnodiging-status', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uitnodiging-status-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('geeft een lege Set als het bestand nog niet bestaat (eerste run)', () => {
    const pad = path.join(tmpDir, 'gezien.json');
    expect(leesGezienIds(pad)).toEqual(new Set());
  });

  it('geeft een lege Set als het bestand kapotte JSON bevat', () => {
    const pad = path.join(tmpDir, 'gezien.json');
    fs.writeFileSync(pad, '{ dit is geen json');
    expect(leesGezienIds(pad)).toEqual(new Set());
  });

  it('rondtrip: schrijven en teruglezen levert dezelfde ids op', () => {
    const pad = path.join(tmpDir, 'gezien.json');
    schrijfGezienIds(pad, new Set(['a', 'b', 'c']));
    expect(leesGezienIds(pad)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('maakt de bovenliggende map aan als die nog niet bestaat', () => {
    const pad = path.join(tmpDir, 'nog-niet-bestaand', 'gezien.json');
    schrijfGezienIds(pad, new Set(['x']));
    expect(leesGezienIds(pad)).toEqual(new Set(['x']));
  });
});
