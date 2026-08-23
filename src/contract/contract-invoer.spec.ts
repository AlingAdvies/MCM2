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
