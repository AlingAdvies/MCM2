import { createHash, randomUUID } from 'node:crypto';

/**
 * Bestandsvalidatie op de inhoud, niet op de naam (vragenlijst-ontwerp §6).
 *
 * Een bestand heet `certificaat.pdf` en bevat een uitvoerbaar programma. De
 * extensie zegt niets, en de door de browser meegestuurde `Content-Type` ook
 * niet — beide komen van de client. Wat de server vaststelt uit de eerste bytes
 * is het enige dat telt, en dát is wat er in `content_type` belandt.
 *
 * Geen database en geen NestJS: pure functies over bytes, zodat elke regel los
 * te toetsen is.
 */

/** OV-7: maximaal 5 MB per bestand. Gelijk aan de CHECK in migratie 0005. */
export const MAX_BESTANDSGROOTTE = 5 * 1024 * 1024;

/**
 * De twee toegestane typen (OV-7), met hun kenmerk aan het begin van het
 * bestand. Gelijk aan de CHECK-constraint op `content_type`.
 */
const HANDTEKENINGEN = [
  {
    contentType: 'application/pdf',
    // '%PDF-'
    bytes: [0x25, 0x50, 0x44, 0x46, 0x2d],
  },
  {
    contentType: 'image/png',
    // \x89PNG\r\n\x1a\n — de volledige acht bytes, niet alleen 'PNG'. De
    // \r\n en \x1a zitten er in het formaat juist om te merken dat een bestand
    // onderweg door een tekstconversie is gehaald.
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
] as const;

export type ToegestaanContentType =
  (typeof HANDTEKENINGEN)[number]['contentType'];

export type BestandAfkeurReden =
  'leeg' | 'te-groot' | 'onbekend-type' | 'type-komt-niet-overeen';

export type BestandUitkomst =
  | { geldig: true; contentType: ToegestaanContentType; sha256: string }
  | { geldig: false; reden: BestandAfkeurReden };

/**
 * Stelt het type vast uit de eerste bytes.
 *
 * Geeft `null` wanneer de inhoud met geen enkel toegestaan formaat begint. Dat
 * is geen "onbekend maar mogelijk goed" — het is een weigering: alleen PDF en
 * PNG zijn toegestaan.
 */
export function bepaalContentType(
  inhoud: Buffer,
): ToegestaanContentType | null {
  for (const handtekening of HANDTEKENINGEN) {
    if (inhoud.length < handtekening.bytes.length) continue;

    const komtOvereen = handtekening.bytes.every(
      (byte, i) => inhoud[i] === byte,
    );

    if (komtOvereen) return handtekening.contentType;
  }

  return null;
}

/**
 * Toetst een ontvangen bestand.
 *
 * `beweerdType` is wat de client meestuurde. Het wordt uitsluitend gebruikt om
 * een mismatch te *melden* — de opgeslagen waarde komt altijd uit de bytes.
 * Zonder die vergelijking zou een `.pdf` met PNG-inhoud stilzwijgend als PNG
 * worden opgeslagen; dat is technisch veilig, maar het verbergt dat de
 * leverancier iets anders aanleverde dan hij dacht (testpunt 20).
 */
export function valideerBestand(
  inhoud: Buffer,
  beweerdType?: string,
): BestandUitkomst {
  if (inhoud.length === 0) {
    return { geldig: false, reden: 'leeg' };
  }

  // Dit is het vangnet, niet de grens. De echte begrenzing zit in de
  // ontvangstlaag (limits.fileSize), anders is een upload van 500 MB een
  // geheugenprobleem in plaats van een validatieregel — zie §6.
  if (inhoud.length > MAX_BESTANDSGROOTTE) {
    return { geldig: false, reden: 'te-groot' };
  }

  const vastgesteld = bepaalContentType(inhoud);

  if (vastgesteld === null) {
    return { geldig: false, reden: 'onbekend-type' };
  }

  if (beweerdType !== undefined && beweerdType !== vastgesteld) {
    return { geldig: false, reden: 'type-komt-niet-overeen' };
  }

  return {
    geldig: true,
    contentType: vastgesteld,
    // Bij een compliance-bewijsstuk moet later aantoonbaar zijn dat het bestand
    // niet gewijzigd is sinds indiening. Zelfde redenering als achter de
    // append-only audit trail.
    sha256: createHash('sha256').update(inhoud).digest('hex'),
  };
}

/**
 * Bouwt de opslagsleutel: `<tenant>/<response>/<uuid>`.
 *
 * **Geen enkel teken uit de invoer.** Een bestandsnaam als `../../etc/passwd`
 * is volstrekt geldig en zou anders een pad worden (testpunt 22). De originele
 * naam wordt apart bewaard in `original_name` en is uitsluitend bedoeld om te
 * tonen — nooit om mee te schrijven of te lezen.
 */
export function maakOpslagsleutel(
  tenantId: string,
  responseId: string,
): string {
  return `${tenantId}/${responseId}/${randomUUID()}`;
}

/**
 * Maakt een bestandsnaam veilig om te tónen.
 *
 * Niet om mee te schrijven — daarvoor is `maakOpslagsleutel`. Deze functie
 * bestaat omdat de naam terugkomt in een overzicht en in de download-header,
 * en een naam met een regeleinde daar een header-injectie zou opleveren.
 */
export function veiligeWeergavenaam(naam: string): string {
  // Splitsen op beide padscheidingstekens: een naam die op Windows is
  // aangemaakt kan backslashes bevatten, ook als de server op Linux draait.
  const zonderPad = naam.split('/').pop()?.split('\\').pop() ?? 'bestand';

  const opgeschoond = [...zonderPad]
    // Stuurtekens eruit: een regeleinde in een bestandsnaam levert bij het
    // downloaden een header-injectie op in Content-Disposition.
    .filter((teken) => {
      const code = teken.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .trim()
    .slice(0, 255);

  return opgeschoond.length > 0 ? opgeschoond : 'bestand';
}
