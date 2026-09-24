import {
  MAX_BESTANDSGROOTTE,
  MAX_BIJLAGEN_PER_ENGAGEMENT,
  valideerEngagementBestand,
} from './vendor-engagement-bestand-validatie';

const PDF_HEADER = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
// DOCX/XLSX zijn beide ZIP-containers: 'PK\x03\x04'.
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

describe('valideerEngagementBestand', () => {
  it('accepteert een PDF', () => {
    const resultaat = valideerEngagementBestand(
      Buffer.concat([PDF_HEADER, Buffer.from('rest')]),
      'application/pdf',
    );
    expect(resultaat.geldig).toBe(true);
  });

  it('accepteert een PNG', () => {
    const resultaat = valideerEngagementBestand(
      Buffer.concat([PNG_HEADER, Buffer.from('rest')]),
      'image/png',
    );
    expect(resultaat.geldig).toBe(true);
  });

  it('accepteert een DOCX (ZIP-signature + juist beweerd type)', () => {
    const resultaat = valideerEngagementBestand(
      Buffer.concat([ZIP_HEADER, Buffer.from('rest')]),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(resultaat.geldig).toBe(true);
  });

  it('accepteert een XLSX (ZIP-signature + juist beweerd type)', () => {
    const resultaat = valideerEngagementBestand(
      Buffer.concat([ZIP_HEADER, Buffer.from('rest')]),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(resultaat.geldig).toBe(true);
  });

  it('weigert een ZIP-signature zonder geldig beweerd OOXML-type', () => {
    const resultaat = valideerEngagementBestand(
      Buffer.concat([ZIP_HEADER, Buffer.from('rest')]),
      'application/zip',
    );
    expect(resultaat).toEqual({ geldig: false, reden: 'onbekend-type' });
  });

  it('weigert een bestand groter dan 10 MB', () => {
    const groot = Buffer.concat([
      PDF_HEADER,
      Buffer.alloc(MAX_BESTANDSGROOTTE),
    ]);
    const resultaat = valideerEngagementBestand(groot, 'application/pdf');
    expect(resultaat).toEqual({ geldig: false, reden: 'te-groot' });
  });

  it('weigert een onbekend bestandstype', () => {
    const resultaat = valideerEngagementBestand(
      Buffer.from('gewoon tekst, geen bekende signature'),
      'text/plain',
    );
    expect(resultaat).toEqual({ geldig: false, reden: 'onbekend-type' });
  });

  it('weigert een leeg bestand', () => {
    const resultaat = valideerEngagementBestand(Buffer.alloc(0));
    expect(resultaat).toEqual({ geldig: false, reden: 'leeg' });
  });

  it('exporteert het maximum van 3 bijlagen per engagement', () => {
    expect(MAX_BIJLAGEN_PER_ENGAGEMENT).toBe(3);
  });

  it('exporteert een maximum van 10 MB', () => {
    expect(MAX_BESTANDSGROOTTE).toBe(10 * 1024 * 1024);
  });
});
