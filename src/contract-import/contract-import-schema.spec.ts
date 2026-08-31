import {
  beoordeelContractImportbestand,
  duidBusinessCriticality,
  duidBusinessRiskTier,
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

  it('zet D-M-JJJJ (zonder voorloopnul, zoals een echte Coupa-export) om naar ISO', () => {
    // Regressietest: de eerste versie van deze functie eiste \d{2} en wees
    // dit realistische formaat af als "geen geldige datum" (gevonden 31-08
    // bij het eerste gebruik van het echte Transdev-testbestand).
    expect(leesContractDatum('1-4-2019')).toEqual({
      waarde: '2019-04-01',
      geldig: true,
    });
    expect(leesContractDatum('9-5-2025')).toEqual({
      waarde: '2025-05-09',
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

describe('duidBusinessCriticality', () => {
  it('herkent de Nederlandse waarden', () => {
    expect(duidBusinessCriticality('Hoog')).toBe('high');
    expect(duidBusinessCriticality('Gemiddeld')).toBe('medium');
    expect(duidBusinessCriticality('Laag')).toBe('low');
    expect(duidBusinessCriticality('Kritiek')).toBe('critical');
  });

  it('herkent de Engelse waarden', () => {
    expect(duidBusinessCriticality('High')).toBe('high');
    expect(duidBusinessCriticality('Medium')).toBe('medium');
    expect(duidBusinessCriticality('Low')).toBe('low');
    expect(duidBusinessCriticality('Critical')).toBe('critical');
  });

  it('geeft null bij leeg of onbekend', () => {
    expect(duidBusinessCriticality(null)).toBeNull();
    expect(duidBusinessCriticality('')).toBeNull();
    expect(duidBusinessCriticality('onbekende waarde')).toBeNull();
  });
});

describe('duidBusinessRiskTier', () => {
  it('herkent het tier-cijfer, ongeacht de rest van de tekst', () => {
    // Zoals een echte Transdev-export het schrijft: 'Tier 2  Medium impact',
    // 'Tier 1  High impact (Strategisch)' — alleen het cijfer telt.
    expect(duidBusinessRiskTier('Tier 1  High impact (Strategisch)')).toBe(
      'tier_1',
    );
    expect(duidBusinessRiskTier('Tier 2  Medium impact')).toBe('tier_2');
    expect(duidBusinessRiskTier('Tier 3  Low impact')).toBe('tier_3');
  });

  it('geeft null bij leeg of onbekend', () => {
    expect(duidBusinessRiskTier(null)).toBeNull();
    expect(duidBusinessRiskTier('')).toBeNull();
    expect(duidBusinessRiskTier('geen tier hier')).toBeNull();
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
    expect(isBlokkerend('categorie_wordt_aangemaakt')).toBe(false);
    expect(isBlokkerend('vendor_geen_matchsleutel')).toBe(false);
    expect(isBlokkerend('extra_contactgegevens_gevonden')).toBe(false);
    expect(isBlokkerend('email_ongeldig')).toBe(false);
    expect(isBlokkerend('datum_ongeldig')).toBe(false);
    expect(isBlokkerend('business_criticality_onbekend')).toBe(false);
    expect(isBlokkerend('business_risk_tier_onbekend')).toBe(false);
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

  it('accepteert alleen een e-mailadres zonder naam, zonder waarschuwing', () => {
    // Besluit eigenaar 31-08: een contactpersoon met alleen email of alleen
    // naam wordt gewoon aangemaakt — eerdere versie behandelde dit als
    // 'onvolledig' en sloeg de contactpersoon over, wat te streng bleek.
    const resultaat = beoordeelContractImportbestand(
      bestand('Hosting,CN-1,,,,,Acme B.V.,,SUP-1,jan@acme.nl,'),
    );

    expect(resultaat.rijen[0].importeerbaar).toBe(true);
    expect(resultaat.rijen[0].invoer.contactEmail).toBe('jan@acme.nl');
    expect(resultaat.rijen[0].invoer.contactFullName).toBeNull();
    expect(resultaat.rijen[0].bevindingen.map((b) => b.code)).not.toContain(
      'contactgegevens_onvolledig',
    );
  });

  it('accepteert alleen een naam zonder e-mailadres, zonder waarschuwing', () => {
    const resultaat = beoordeelContractImportbestand(
      bestand('Hosting,CN-1,,,,,Acme B.V.,,SUP-1,,Jan Jansen'),
    );

    expect(resultaat.rijen[0].importeerbaar).toBe(true);
    expect(resultaat.rijen[0].invoer.contactEmail).toBeNull();
    expect(resultaat.rijen[0].invoer.contactFullName).toBe('Jan Jansen');
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

  describe('contract.vendor_contact_id als naam (besluit eigenaar 31-08)', () => {
    it('gebruikt de waarde als naam wanneer vendor_contact.full_name leeg is en de waarde geen UUID is', () => {
      const koppen =
        'contract.name;contract.contract_number;contract.contract_type;contract.start_date;contract.end_date;contract.note;vendor.name;vendor.category_code;vendor.coupa_supplier_number;vendor_contact.email;vendor_contact.email;contract.vendor_contact_id';
      const rij =
        'Hosting;CN-1;;;;;Acme B.V.;;SUP-1;;bart@b4ict.nl;Bart Philips';
      const resultaat = beoordeelContractImportbestand(
        [koppen, rij].join('\n'),
      );

      expect(resultaat.rijen[0].invoer.contactFullName).toBe('Bart Philips');
    });

    it('negeert de waarde als vendor_contact.full_name al gevuld is', () => {
      const koppen =
        'contract.name;contract.contract_number;vendor.name;vendor.coupa_supplier_number;vendor_contact.email;vendor_contact.full_name;contract.vendor_contact_id';
      const rij =
        'Hosting;CN-1;Acme B.V.;SUP-1;jan@acme.nl;Jan Jansen;Andere Naam';
      const resultaat = beoordeelContractImportbestand(
        [koppen, rij].join('\n'),
      );

      expect(resultaat.rijen[0].invoer.contactFullName).toBe('Jan Jansen');
    });

    it('negeert de waarde als het een geldig UUID is', () => {
      const koppen =
        'contract.name;contract.contract_number;vendor.name;vendor.coupa_supplier_number;vendor_contact.email;vendor_contact.full_name;contract.vendor_contact_id';
      const rij =
        'Hosting;CN-1;Acme B.V.;SUP-1;;;12345678-1234-1234-1234-123456789012';
      const resultaat = beoordeelContractImportbestand(
        [koppen, rij].join('\n'),
      );

      expect(resultaat.rijen[0].invoer.contactFullName).toBeNull();
    });
  });

  describe('dubbele primaire contactkolommen (besluit eigenaar 31-08)', () => {
    it('houdt het LAATSTE voorkomen van vendor_contact.email aan als primair, eerdere als extra contact', () => {
      // Besluit eigenaar: in de praktijk staat het betrouwbare adres vaak in
      // de laatste van meerdere gelijknamige kolommen (een echt
      // Transdev-testbestand had de eerste leeg of gevuld met een
      // compliance-URL, de tweede met het echte adres).
      const koppen =
        'contract.name;contract.contract_number;vendor.name;vendor.coupa_supplier_number;vendor_contact.email;vendor_contact.email';
      const rij =
        'Hosting;CN-1;Acme B.V.;SUP-1;https://klant.afas.nl/certificeringen;jan@acme.nl';
      const resultaat = beoordeelContractImportbestand(
        [koppen, rij].join('\n'),
      );

      expect(resultaat.rijen[0].invoer.contactEmail).toBe('jan@acme.nl');
      expect(resultaat.rijen[0].invoer.extraContacten).toHaveLength(1);
      expect(resultaat.rijen[0].invoer.extraContacten[0].email).toBe(
        'https://klant.afas.nl/certificeringen',
      );
    });
  });

  describe('business_criticality en business_risk_tier (gevonden 31-08, ontbraken volledig)', () => {
    const koppen =
      'contract.name;contract.contract_number;vendor.name;vendor.coupa_supplier_number;vendor.business_criticality_code;contract.business_risk_tier_code';

    it('duidt beide velden tegen hun vaste waardenlijst', () => {
      const rij = 'Hosting;CN-1;Acme B.V.;SUP-1;Hoog;Tier 2  Medium impact';
      const resultaat = beoordeelContractImportbestand(
        [koppen, rij].join('\n'),
      );

      expect(resultaat.rijen[0].invoer.vendorBusinessCriticalityCode).toBe(
        'high',
      );
      expect(resultaat.rijen[0].invoer.contractBusinessRiskTierCode).toBe(
        'tier_2',
      );
      expect(resultaat.rijen[0].bevindingen).toHaveLength(0);
    });

    it('waarschuwt bij een niet-herkende waarde, blokkeert niet', () => {
      const rij = 'Hosting;CN-1;Acme B.V.;SUP-1;Onduidelijk;Geen idee';
      const resultaat = beoordeelContractImportbestand(
        [koppen, rij].join('\n'),
      );

      expect(resultaat.rijen[0].importeerbaar).toBe(true);
      expect(
        resultaat.rijen[0].invoer.vendorBusinessCriticalityCode,
      ).toBeNull();
      expect(resultaat.rijen[0].invoer.contractBusinessRiskTierCode).toBeNull();
      expect(resultaat.rijen[0].bevindingen.map((b) => b.code)).toEqual(
        expect.arrayContaining([
          'business_criticality_onbekend',
          'business_risk_tier_onbekend',
        ]),
      );
    });
  });
});
