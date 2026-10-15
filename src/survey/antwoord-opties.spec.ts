import { optiesUit } from './antwoord-opties';

describe('optiesUit', () => {
  it('geeft code en label van een keuzevraag terug', () => {
    expect(
      optiesUit('single_choice', {
        options: [
          { code: 'ja', label: 'Ja, en ik kan het aantonen' },
          { code: 'nee', label: 'Nee' },
        ],
        comment: 'optional',
      }),
    ).toEqual([
      { code: 'ja', label: 'Ja, en ik kan het aantonen' },
      { code: 'nee', label: 'Nee' },
    ]);
  });

  it('geldt ook voor multi_choice', () => {
    expect(
      optiesUit('multi_choice', { options: [{ code: 'a', label: 'A' }] }),
    ).toEqual([{ code: 'a', label: 'A' }]);
  });

  it('geeft null bij een type zonder eigen opties', () => {
    // Bij confirmation liggen de opties vast in de code, niet in de config.
    expect(optiesUit('confirmation', {})).toBeNull();
    expect(optiesUit('open_text', { options: [] })).toBeNull();
  });

  it('slaat onleesbare opties over in plaats van te crashen', () => {
    // config is JSONB; de database bewaakt de inhoud niet.
    expect(
      optiesUit('single_choice', {
        options: [{ code: 'ok', label: 'Ok' }, { code: 3 }, 'los'],
      }),
    ).toEqual([{ code: 'ok', label: 'Ok' }]);
    expect(optiesUit('single_choice', null)).toEqual([]);
  });
});
