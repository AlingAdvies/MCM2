import {
  beoordeelContractImportbestand,
  emailGeldig,
  isBlokkerend,
  leesContractDatum,
} from './contract-import-schema';

/**
 * Unittests op een pure functie: geen database, geen HTTP, geen tenant.
 * Zelfde opzet als `vendor/leverancier-import-schema.spec.ts`.
 */

describe('leesContractDatum', () => {
  it('zet DD-MM-JJJJ om naar ISO', () => {
    expect(leesContractDatum('01-01-2024')).toEqual({
      waarde: '2024-01-01',
      geldig: true,
    });
  });

  it('geeft null bij een leeg veld', () => {
    expect(leesContractDatum(null)).toEqual({ waarde: null, geldig: true });
    expect(leesContractDatum('')).toEqual({ waarde: null, geldig: true });
    expect(leesContractDatum('  ')).toEqual({ waarde: null, geldig: true });
  });

  it('verwerpt een ISO-datum (dit bestand verwacht DD-MM-JJJJ)', () => {
    expect(leesContractDatum('2024-01-01').geldig).toBe(false);
  });

  it('verwerpt een niet-bestaande datum (31 februari)', () => {
    expect(leesContractDatum('31-02-2026').geldig).toBe(false);
  });

  it('verwerpt willekeurige tekst', () => {
    expect(leesContractDatum('volgende week').geldig).toBe(false);
  });

  it('accepteert een geldige schrikkeldag', () => {
    expect(leesContractDatum('29-02-2024')).toEqual({
      waarde: '2024-02-29',
      geldig: true,
    });
  });

  it('verwerpt een schrikkeldag in een niet-schrikkeljaar', () => {
    expect(leesContractDatum('29-02-2026').geldig).toBe(false);
  });
});

describe('emailGeldig', () => {
  it('accepteert een gewoon adres', () => {
    expect(emailGeldig('jan@acme.nl')).toBe(true);
  });

  it('accepteert leeg', () => {
    expect(emailGeldig(null)).toBe(true);
    expect(emailGeldig('')).toBe(true);
  });

  it('verwerpt een adres zonder @', () => {
    expect(emailGeldig('jan-acme.nl')).toBe(false);
  });
});

describe('isBlokkerend', () => {
  it('blokkeert een ontbrekende contractnaam', () => {
    expect(isBlokkerend('contract_naam_ontbreekt')).toBe(true);
  });

  it('blokkeert een ontbrekende vendornaam', () => {
    expect(isBlokkerend('vendor_naam_ontbreekt')).toBe(true);
  });

  it('blokkeert een ongeldige datumvolgorde', () => {
    expect(isBlokkerend('datum_volgorde_ongeldig')).toBe(true);
  });

  it('blokkeert geen waarschuwingen', () => {
    expect(isBlokkerend('vendor_afwijkt')).toBe(false);
    expect(isBlokkerend('categorie_onbekend')).toBe(false);
    expect(isBlokkerend('contactgegevens_onvolledig')).toBe(false);
    expect(isBlokkerend('vendor_geen_matchsleutel')).toBe(false);
    expect(isBlokkerend('email_ongeldig')).toBe(false);
    expect(isBlokkerend('datum_ongeldig')).toBe(false);
  });
});

describe('beoordeelContractImportbestand', () => {
  const KOPPEN =
    'contract.name,contract.contract_number,contract.contract_type,contract.start_date,contract.end_date,contract.note,vendor.name,vendor.category_code,vendor.coupa_supplier_number,vendor_contact.email,vendor_contact.full_name';

  function bestand(...rijen: string[]): string {
    return [KOPPEN, ...rijen].join('\n');
  }

  it('herkent alle negen kolommen op hun punt-notatie', () => {
    const resultaat = beoordeelContractImportbestand(
      bestand(
        'Hosting,CN-1,Dienstenovereenkomst,01-01-2024,31-12-2027,Toelichting,Acme B.V.,it,SUP-1,jan@acme.nl,Jan Jansen',
      ),
    );

    expect(Object.keys(resultaat.herkendeKolommen)).toHaveLength(11);
    expect(resultaat.onbekendeKolommen).toEqual([]);
    expect(resultaat.rijen[0].importeerbaar).toBe(true);
  });

  it('blokkeert een rij zonder contractnaam', () => {
    const resultaat = beoordeelContractImportbestand(
      bestand(',CN-1,,,,,Acme B.V.,,,,'),
    );

    expect(resultaat.rijen[0].importeerbaar).toBe(false);
    expect(resultaat.rijen[0].bevindingen.map((b) => b.code)).toContain(
      'contract_naam_ontbreekt',
    );
  });

  it('blokkeert een rij zonder vendornaam', () => {
    const resultaat = beoordeelContractImportbestand(
      bestand('Hosting,CN-1,,,,,,,,,'),
    );

    expect(resultaat.rijen[0].importeerbaar).toBe(false);
    expect(resultaat.rijen[0].bevindingen.map((b) => b.code)).toContain(
      'vendor_naam_ontbreekt',
    );
  });

  it('waarschuwt bij een ontbrekend coupa-nummer, blokkeert niet', () => {
    const resultaat = beoordeelContractImportbestand(
      bestand('Hosting,CN-1,,,,,Acme B.V.,,,,'),
    );

    expect(resultaat.rijen[0].importeerbaar).toBe(true);
    expect(resultaat.rijen[0].bevindingen.map((b) => b.code)).toContain(
      'vendor_geen_matchsleutel',
    );
  });

  it('blokkeert wanneer de einddatum vóór de begindatum ligt', () => {
    const resultaat = beoordeelContractImportbestand(
      bestand('Hosting,CN-1,,31-12-2027,01-01-2024,,Acme B.V.,,SUP-1,,'),
    );

    expect(resultaat.rijen[0].importeerbaar).toBe(false);
    expect(resultaat.rijen[0].bevindingen.map((b) => b.code)).toContain(
      'datum_volgorde_ongeldig',
    );
  });

  it('waarschuwt bij alleen een e-mailadres zonder naam', () => {
    const resultaat = beoordeelContractImportbestand(
      bestand('Hosting,CN-1,,,,,Acme B.V.,,SUP-1,jan@acme.nl,'),
    );

    expect(resultaat.rijen[0].importeerbaar).toBe(true);
    expect(resultaat.rijen[0].bevindingen.map((b) => b.code)).toContain(
      'contactgegevens_onvolledig',
    );
  });

  it('waarschuwt bij alleen een naam zonder e-mailadres', () => {
    const resultaat = beoordeelContractImportbestand(
      bestand('Hosting,CN-1,,,,,Acme B.V.,,SUP-1,,Jan Jansen'),
    );

    expect(resultaat.rijen[0].importeerbaar).toBe(true);
    expect(resultaat.rijen[0].bevindingen.map((b) => b.code)).toContain(
      'contactgegevens_onvolledig',
    );
  });

  it('zet startDate/endDate om naar ISO in de genormaliseerde invoer', () => {
    const resultaat = beoordeelContractImportbestand(
      bestand('Hosting,CN-1,,01-01-2024,31-12-2027,,Acme B.V.,,SUP-1,,'),
    );

    expect(resultaat.rijen[0].invoer.startDate).toBe('2024-01-01');
    expect(resultaat.rijen[0].invoer.endDate).toBe('2027-12-31');
  });

  it('bewaart onbekende kolommen in rawAttributes zonder ze te blokkeren', () => {
    const resultaat = beoordeelContractImportbestand(
      [
        KOPPEN + ',extra_kolom',
        'Hosting,CN-1,,,,,Acme B.V.,,SUP-1,,,een waarde',
      ].join('\n'),
    );

    expect(resultaat.onbekendeKolommen).toContain('extra_kolom');
    expect(resultaat.rijen[0].invoer.rawAttributes['extra_kolom']).toBe(
      'een waarde',
    );
  });
});
