import { leesNieuwContract, InvoerFout } from './contract-invoer';

describe('leesNieuwContract', () => {
  it('accepteert een minimale geldige invoer (alleen naam)', () => {
    const invoer = leesNieuwContract({ name: 'Hosting 2024-2027' });

    expect(invoer.name).toBe('Hosting 2024-2027');
    expect(invoer.contractNumber).toBeNull();
  });

  it('weigert een lege naam', () => {
    expect(() => leesNieuwContract({ name: '' })).toThrow(InvoerFout);
  });

  it('weigert een ontbrekende naam', () => {
    expect(() => leesNieuwContract({})).toThrow(InvoerFout);
  });

  it('knipt witruimte van de naam', () => {
    const invoer = leesNieuwContract({ name: '  Hosting  ' });
    expect(invoer.name).toBe('Hosting');
  });

  it('accepteert een geldige startDate en endDate (ISO-datum)', () => {
    const invoer = leesNieuwContract({
      name: 'Hosting',
      startDate: '2024-01-01',
      endDate: '2027-12-31',
    });

    expect(invoer.startDate).toBe('2024-01-01');
    expect(invoer.endDate).toBe('2027-12-31');
  });

  it('weigert een endDate vóór de startDate', () => {
    expect(() =>
      leesNieuwContract({
        name: 'Hosting',
        startDate: '2027-01-01',
        endDate: '2024-01-01',
      }),
    ).toThrow(InvoerFout);
  });

  it('weigert een niet-ISO datum', () => {
    expect(() =>
      leesNieuwContract({ name: 'Hosting', startDate: '01-01-2024' }),
    ).toThrow(InvoerFout);
  });

  it('accepteert een geldig geldbedrag', () => {
    const invoer = leesNieuwContract({ name: 'Hosting', valueEur: '1500.50' });
    expect(invoer.valueEur).toBe('1500.50');
  });

  it('weigert een negatief geldbedrag', () => {
    expect(() =>
      leesNieuwContract({ name: 'Hosting', valueEur: '-100' }),
    ).toThrow(InvoerFout);
  });

  it('weigert een niet-numeriek geldbedrag', () => {
    expect(() =>
      leesNieuwContract({ name: 'Hosting', valueEur: 'abc' }),
    ).toThrow(InvoerFout);
  });
});

describe('leesNieuwContract — opzegtermijn en verlengt-automatisch', () => {
  it('accepteert een geldige noticePeriodDays', () => {
    const invoer = leesNieuwContract({
      name: 'Hosting',
      noticePeriodDays: '90',
    });
    expect(invoer.noticePeriodDays).toBe(90);
  });

  it('laat noticePeriodDays leeg zonder invoer', () => {
    const invoer = leesNieuwContract({ name: 'Hosting' });
    expect(invoer.noticePeriodDays).toBeNull();
  });

  it('weigert een negatieve noticePeriodDays', () => {
    expect(() =>
      leesNieuwContract({ name: 'Hosting', noticePeriodDays: '-5' }),
    ).toThrow(InvoerFout);
  });

  it('weigert een niet-numerieke noticePeriodDays', () => {
    expect(() =>
      leesNieuwContract({ name: 'Hosting', noticePeriodDays: 'abc' }),
    ).toThrow(InvoerFout);
  });

  it('vult warningDaysBefore met 90 als het ontbreekt', () => {
    const invoer = leesNieuwContract({ name: 'Hosting' });
    expect(invoer.warningDaysBefore).toBe(90);
  });

  it('accepteert een expliciete warningDaysBefore', () => {
    const invoer = leesNieuwContract({
      name: 'Hosting',
      warningDaysBefore: '30',
    });
    expect(invoer.warningDaysBefore).toBe(30);
  });

  it('weigert een negatieve warningDaysBefore', () => {
    expect(() =>
      leesNieuwContract({ name: 'Hosting', warningDaysBefore: '-1' }),
    ).toThrow(InvoerFout);
  });

  it('accepteert ja/nee/onbekend voor autoRenews', () => {
    for (const waarde of ['ja', 'nee', 'onbekend']) {
      const invoer = leesNieuwContract({ name: 'Hosting', autoRenews: waarde });
      expect(invoer.autoRenews).toBe(waarde);
    }
  });

  it('laat autoRenews null zonder invoer (onbekend is de default)', () => {
    const invoer = leesNieuwContract({ name: 'Hosting' });
    expect(invoer.autoRenews).toBeNull();
  });

  it('weigert een ongeldige waarde voor autoRenews', () => {
    expect(() =>
      leesNieuwContract({ name: 'Hosting', autoRenews: 'misschien' }),
    ).toThrow(InvoerFout);
  });
});
