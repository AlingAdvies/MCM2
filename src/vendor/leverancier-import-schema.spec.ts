import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  bepaalScheidingsteken,
  beoordeelImportbestand,
  duidImpact,
  emailGeldig,
  kvkGeldig,
  leesBedrag,
  leesCsv,
} from './leverancier-import-schema';

/**
 * Unittests op een pure functie: geen database, geen HTTP, geen tenant.
 *
 * Dit is de laag die de architectuurreview van 2026-07-29 miste (Issue #54):
 * randgevallen als een leeg veld, een bedrag met duizendtalscheiding of een
 * ontsnapt aanhalingsteken zijn hier drie regels, en als e2e-testgeval een
 * wegwerp-Postgres plus een HTTP-rondgang. Wat de database afdwingt blijft
 * e2e; dit hoort hier.
 */

const VOORBEELD = join(
  __dirname,
  '..',
  '..',
  'db',
  'seeds',
  'voorbeeld-leveranciers-coupa.csv',
);

describe('bepaalScheidingsteken', () => {
  it('herkent de komma', () => {
    expect(bepaalScheidingsteken('a,b,c')).toBe(',');
  });

  it('herkent de puntkomma van een Nederlandse Excel', () => {
    // Alle vier Transdev-specificatiebestanden in MVM_V2 gebruiken puntkomma's.
    expect(bepaalScheidingsteken('Object;Naam;Beschrijving')).toBe(';');
  });

  it('negeert scheidingstekens binnen aanhalingstekens', () => {
    // Eén echte puntkomma, drie komma's tussen aanhalingstekens: de puntkomma
    // wint. Zonder de aanhalingstekencontrole zou dit de komma opleveren.
    expect(bepaalScheidingsteken('"a,b,c,d";tweede')).toBe(';');
  });

  it('valt terug op de komma bij één kolom', () => {
    expect(bepaalScheidingsteken('alleen-een-kop')).toBe(',');
  });
});

describe('leesCsv', () => {
  it('leest koppen en rijen', () => {
    const r = leesCsv('naam,plaats\nSiemens,Den Haag\nAlstom,Ridderkerk');
    expect(r.koppen).toEqual(['naam', 'plaats']);
    expect(r.rijen).toEqual([
      ['Siemens', 'Den Haag'],
      ['Alstom', 'Ridderkerk'],
    ]);
  });

  it('leest een ontsnapt aanhalingsteken binnen een veld', () => {
    // Dít is het geval waarop de parser in MVM_V2 stukloopt: die wisselt
    // `inQuotes` bij élk aanhalingsteken en kapt de naam af.
    const r = leesCsv('naam\n"Jansen ""De Bouwer"" B.V."');
    expect(r.rijen[0][0]).toBe('Jansen "De Bouwer" B.V.');
  });

  it('leest een regeleinde binnen een veld tussen aanhalingstekens', () => {
    const r = leesCsv('naam,tekst\nSiemens,"regel 1\nregel 2"');
    expect(r.rijen).toHaveLength(1);
    expect(r.rijen[0][1]).toBe('regel 1\nregel 2');
  });

  it('verwijdert de UTF-8 BOM die Excel voor de eerste kop zet', () => {
    // Deze test legt het gedr\u00E1g vast, niet het mechanisme: de BOM verdwijnt
    // door de `.trim()` op de koppen, niet door een eigen regel daarvoor. Zie
    // de toelichting in `leesCsv` \u2014 een losse `replace` bleek nergens rood te
    // krijgen en is daarom verwijderd.
    const r = leesCsv('\uFEFFnaam,plaats\nSiemens,Den Haag');
    expect(r.koppen[0]).toBe('naam');
    expect(r.koppen[0].charCodeAt(0)).toBe('n'.charCodeAt(0));
  });

  it('leest CRLF en LF door elkaar', () => {
    const r = leesCsv('a,b\r\n1,2\n3,4\r\n');
    expect(r.rijen).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('laat volledig lege rijen weg', () => {
    const r = leesCsv('a,b\n1,2\n\n,\n3,4');
    expect(r.rijen).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('geeft een lege uitkomst bij een leeg bestand', () => {
    expect(leesCsv('').rijen).toEqual([]);
    expect(leesCsv('').koppen).toEqual([]);
  });

  it('leest een bestand met alleen een koprij', () => {
    const r = leesCsv('naam,plaats');
    expect(r.koppen).toEqual(['naam', 'plaats']);
    expect(r.rijen).toEqual([]);
  });
});

describe('leesBedrag', () => {
  it.each([
    ['4800000', 4800000],
    ['4.800.000,00', 4800000],
    ['4,800,000.00', 4800000],
    ['€ 4800000', 4800000],
    ['1.234', 1234],
    ['1234,56', 1234.56],
    ['0', 0],
  ])('leest %s als %s', (ruw, verwacht) => {
    expect(leesBedrag(ruw)).toEqual({ waarde: verwacht, geldig: true });
  });

  it('geeft leeg terug bij een leeg veld, zonder dat fout te noemen', () => {
    expect(leesBedrag('')).toEqual({ waarde: null, geldig: true });
    expect(leesBedrag(null)).toEqual({ waarde: null, geldig: true });
  });

  it('meldt tekst als ongeldig', () => {
    expect(leesBedrag('n.v.t.')).toEqual({ waarde: null, geldig: false });
    expect(leesBedrag('circa 40k')).toEqual({ waarde: null, geldig: false });
  });
});

describe('kvkGeldig', () => {
  it('accepteert acht cijfers', () => {
    expect(kvkGeldig('34212178')).toBe(true);
  });

  it('accepteert leeg — niet elke leverancier is Nederlands', () => {
    expect(kvkGeldig('')).toBe(true);
    expect(kvkGeldig(null)).toBe(true);
  });

  it.each(['123', '123456789', '3421217a', '34 212 178'])(
    'weigert %s',
    (ruw) => {
      expect(kvkGeldig(ruw)).toBe(false);
    },
  );
});

describe('emailGeldig', () => {
  it.each(['d.hoekstra@siemens.com', 'kenji.watanabe@hitachirail.com'])(
    'accepteert %s',
    (e) => expect(emailGeldig(e)).toBe(true),
  );

  it.each([
    'geen-apenstaartje',
    'twee@@apenstaartjes.nl',
    'geen@punt',
    '@begint-met-apenstaartje.nl',
  ])('weigert %s', (e) => expect(emailGeldig(e)).toBe(false));

  it('accepteert leeg', () => {
    expect(emailGeldig('')).toBe(true);
    expect(emailGeldig(null)).toBe(true);
  });
});

describe('duidImpact', () => {
  it.each([
    ['High Impact', 'high'],
    ['high', 'high'],
    ['Hoog', 'high'],
    ['Medium Impact', 'medium'],
    ['Midden', 'medium'],
    ['Low Impact', 'low'],
    ['Laag', 'low'],
  ])('duidt %s als %s', (ruw, verwacht) => {
    expect(duidImpact(ruw)).toBe(verwacht);
  });

  it('geeft null bij een onbekende waarde in plaats van te gokken', () => {
    // Gokken zou een leverancier stil de verkeerde impact geven, en dat is
    // erger dan een waarschuwing die iemand moet oplossen.
    expect(duidImpact('Onbekende Waarde')).toBeNull();
    expect(duidImpact('')).toBeNull();
    expect(duidImpact(null)).toBeNull();
  });
});

describe('beoordeelImportbestand — het voorbeeldbestand', () => {
  const beoordeling = beoordeelImportbestand(readFileSync(VOORBEELD, 'utf8'));

  it('herkent alle negen gemapte kolommen', () => {
    expect(Object.keys(beoordeling.herkendeKolommen)).toHaveLength(9);
    expect(beoordeling.herkendeKolommen['Supplier Name']).toBe('name');
    expect(beoordeling.herkendeKolommen['KvK Number']).toBe('kvkNumber');
  });

  it('meldt de onbekende kolom in plaats van hem stil te laten vallen', () => {
    expect(beoordeling.onbekendeKolommen).toEqual(['Supplier Status']);
  });

  it('bewaart élke kolom in rawAttributes, ook de gemapte', () => {
    const siemens = beoordeling.rijen.find(
      (r) => r.invoer.externalCode === 'COUPA-SIE-001',
    );
    // Tien koppen in het bestand, dus tien sleutels — verrijken later vraagt
    // dan geen herimport.
    expect(Object.keys(siemens!.invoer.rawAttributes)).toHaveLength(10);
    expect(siemens!.invoer.rawAttributes['Supplier Status']).toBe('Active');
  });

  it('telt 28 rijen, 26 importeerbaar, 2 geblokkeerd', () => {
    expect(beoordeling.samenvatting.totaal).toBe(28);
    expect(beoordeling.samenvatting.importeerbaar).toBe(26);
    expect(beoordeling.samenvatting.geblokkeerd).toBe(2);
  });

  it('blokkeert de rij zonder naam', () => {
    const rij = beoordeling.rijen.find((r) => r.invoer.name === '');
    expect(rij!.importeerbaar).toBe(false);
    expect(rij!.bevindingen.map((b) => b.code)).toContain('naam_ontbreekt');
  });

  it('blokkeert de dubbele leverancier en wijst naar de eerste regel', () => {
    const dubbel = beoordeling.rijen.filter((r) =>
      r.bevindingen.some((b) => b.code === 'dubbel_in_bestand'),
    );
    expect(dubbel).toHaveLength(1);
    expect(dubbel[0].importeerbaar).toBe(false);
    // De melding moet zeggen wáár het duplicaat staat, anders moet iemand
    // 142 regels doorzoeken.
    expect(dubbel[0].bevindingen[0].melding).toContain('regel 2');
  });

  it('waarschuwt zonder te blokkeren bij een fout KvK-nummer, e-mail of impact', () => {
    for (const code of [
      'kvk_ongeldig',
      'email_ongeldig',
      'impact_onbekend',
    ] as const) {
      const rij = beoordeling.rijen.find((r) =>
        r.bevindingen.some((b) => b.code === code),
      );
      expect(rij).toBeDefined();
      // Waarschuwen en niet blokkeren: een fout KvK-nummer is achteraf te
      // corrigeren, een ontbrekende naam niet.
      expect(rij!.importeerbaar).toBe(true);
    }
  });

  it('leest de leverancier met aanhalingstekens in de naam correct', () => {
    const rij = beoordeling.rijen.find((r) => r.invoer.name.includes('Jansen'));
    expect(rij!.invoer.name).toBe('Jansen "De Bouwer" B.V.');
    expect(rij!.importeerbaar).toBe(true);
  });

  it('verwijst met regelnummers naar wat de gebruiker in Excel ziet', () => {
    // Eerste gegevensrij is regel 2, want de koprij is regel 1.
    expect(beoordeling.rijen[0].regel).toBe(2);
    expect(beoordeling.rijen[0].invoer.name).toBe('Siemens Mobility B.V.');
  });
});

describe('beoordeelImportbestand — dubbelherkenning', () => {
  it('ziet twee vestigingen met dezelfde naam en ander KvK-nummer als twee leveranciers', () => {
    // Dit is waarom de sleutel KvK vóór naam gebruikt: een holding met twee
    // vestigingen is geen duplicaat.
    const b = beoordeelImportbestand(
      'Supplier Name,KvK Number\nHolding B.V.,11111111\nHolding B.V.,22222222',
    );
    expect(b.samenvatting.geblokkeerd).toBe(0);
  });

  it('valt terug op de naam als er geen KvK-nummer is', () => {
    const b = beoordeelImportbestand(
      'Supplier Name,KvK Number\nZonder Nummer B.V.,\nZonder Nummer B.V.,',
    );
    expect(b.samenvatting.geblokkeerd).toBe(1);
  });

  it('negeert verschil in hoofdletters bij de naamvergelijking', () => {
    const b = beoordeelImportbestand(
      'Supplier Name\nSiemens Mobility B.V.\nSIEMENS MOBILITY B.V.',
    );
    expect(b.samenvatting.geblokkeerd).toBe(1);
  });
});

describe('beoordeelImportbestand — Nederlandse koppen en puntkomma', () => {
  it("leest een Nederlandse export met puntkomma's", () => {
    const b = beoordeelImportbestand(
      'Leveranciersnaam;KvK-nummer;Plaats;Jaarbedrag\nSiemens Mobility B.V.;34212178;Den Haag;4.800.000,00',
    );
    expect(b.scheidingsteken).toBe(';');
    expect(b.samenvatting.importeerbaar).toBe(1);
    expect(b.rijen[0].invoer.name).toBe('Siemens Mobility B.V.');
    expect(b.rijen[0].invoer.kvkNumber).toBe('34212178');
    expect(b.rijen[0].invoer.annualSpendEur).toBe(4800000);
  });
});

describe('beoordeelImportbestand — grensgevallen', () => {
  it('geeft nul rijen bij een leeg bestand in plaats van te falen', () => {
    const b = beoordeelImportbestand('');
    expect(b.samenvatting.totaal).toBe(0);
    expect(b.koppen).toEqual([]);
  });

  it('meldt alle kolommen als onbekend wanneer de koprij niet klopt', () => {
    // Het scenario dat in MVM_V2 stil 142 leveranciers zonder naam oplevert:
    // een bestand met verkeerde koppen. Hier is elke rij geblokkeerd én is
    // zichtbaar dat geen enkele kolom herkend is.
    const b = beoordeelImportbestand('kolom1,kolom2\nSiemens,Den Haag');
    expect(Object.keys(b.herkendeKolommen)).toHaveLength(0);
    expect(b.onbekendeKolommen).toEqual(['kolom1', 'kolom2']);
    expect(b.samenvatting.importeerbaar).toBe(0);
  });

  it('verwerkt een rij met minder cellen dan koppen', () => {
    const b = beoordeelImportbestand('Supplier Name,City,KvK Number\nSiemens');
    expect(b.rijen[0].invoer.name).toBe('Siemens');
    expect(b.rijen[0].invoer.city).toBeNull();
    expect(b.rijen[0].importeerbaar).toBe(true);
  });
});
