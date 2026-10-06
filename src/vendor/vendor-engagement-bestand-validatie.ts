import { createHash, randomUUID } from 'node:crypto';

import {
  detecteerContentType,
  type BestandHandtekening,
} from '../survey/bestand-validatie';

/**
 * Bestandsvalidatie voor bijlagen bij een vendor-dossier (engagement).
 *
 * Eigen beleidsmodule, los van src/survey/bestand-validatie.ts: die blijft
 * ongewijzigd voor het leveranciersportaal (PDF/PNG, 5MB). Hier gelden andere
 * regels omdat het doel anders is — een beheerder legt hier geëxporteerde
 * mailcorrespondentie vast, vaak een Word- of Excel-bijlage, en de eigenaar
 * wilde bewust ruimte voor een representatief compliance-document (~4,4 MB
 * gemeten voorbeeld). Zie
 * docs/superpowers/specs/2026-09-24-vendor-dossiers-design.md
 * §Bestandsvalidatie.
 *
 * De signature-detectiemechaniek zelf komt uit bestand-validatie.ts —
 * gedeeld mechaniek, gescheiden beleid.
 */

export const MAX_BESTANDSGROOTTE = 10 * 1024 * 1024;

/** Nudge tegen een "circus van screenshots" (eis eigenaar, 24-09-2026). */
export const MAX_BIJLAGEN_PER_ENGAGEMENT = 3;

const HANDTEKENINGEN = [
  {
    contentType: 'application/pdf',
    bytes: [0x25, 0x50, 0x44, 0x46, 0x2d],
  },
  {
    contentType: 'image/png',
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  {
    // .msg (Outlook-bericht): OLE/CFBF-compound-document, vaste header
    // ongeacht inhoud — zelfde soort byte-exacte herkenning als PDF/PNG.
    contentType: 'application/vnd.ms-outlook',
    bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  },
] as const satisfies readonly BestandHandtekening<string>[];

const OOXML_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

/**
 * .eml heeft geen vaste byte-signature (platte RFC822-tekst), dus geen
 * entry in HANDTEKENINGEN — dat mechanisme werkt alleen met vaste bytes op
 * offset 0. In plaats daarvan: de eerste regel moet een herkenbare
 * RFC822-headernaam zijn. Bewust een kleine, vaste lijst — een losse
 * "staat er een dubbele punt in de eerste regel"-check zou te veel gewone
 * tekstbestanden ten onrechte doorlaten.
 */
const EML_HEADER_PREFIXEN = [
  'Return-Path:',
  'Received:',
  'From:',
  'Date:',
  'Message-ID:',
  'Message-Id:',
] as const;

function lijktOpEml(inhoud: Buffer): boolean {
  // Alleen de eerste regel bekijken (tot de eerste \n, of de eerste 200
  // bytes als er geen regeleinde is) — een mailbestand begint met een
  // header, niet ergens middenin.
  const eersteRegelEind = inhoud.indexOf(0x0a);
  const grens =
    eersteRegelEind === -1 ? Math.min(inhoud.length, 200) : eersteRegelEind;
  const eersteRegel = inhoud.subarray(0, grens).toString('utf-8');

  return EML_HEADER_PREFIXEN.some((prefix) => eersteRegel.startsWith(prefix));
}

export type ToegestaanEngagementContentType =
  | (typeof HANDTEKENINGEN)[number]['contentType']
  | (typeof OOXML_TYPES)[number]
  | 'message/rfc822';

/** Alle content-types die deze module kent — gebruikt om een onbetrouwbaar/onbekend beweerd type te onderscheiden van een echte mismatch. */
const ALLE_BEKENDE_TYPES = new Set<string>([
  ...HANDTEKENINGEN.map((h) => h.contentType),
  ...OOXML_TYPES,
  'message/rfc822',
]);

export type BestandAfkeurReden =
  'leeg' | 'te-groot' | 'onbekend-type' | 'type-komt-niet-overeen';

export type EngagementBestandUitkomst =
  | {
      geldig: true;
      contentType: ToegestaanEngagementContentType;
      sha256: string;
    }
  | { geldig: false; reden: BestandAfkeurReden };

/**
 * Toetst een geüploade bijlage.
 *
 * DOCX en XLSX zijn beide OOXML/ZIP-containers met een identieke signature
 * ('PK\x03\x04'); het onderscheid zit in de interne mappenstructuur, niet in
 * de eerste bytes. Voor deze twee typen is `beweerdType` daarom niet
 * optioneel te negeren zoals bij PDF/PNG: bij een ZIP-signature moet het
 * beweerde type één van de twee toegestane OOXML-waarden zijn, anders wordt
 * het geweigerd. Dat is geen verzwakking van de controle — de signature
 * bevestigt nog steeds "dit is een ZIP-container", en de CHECK-constraint in
 * migratie 0042 laat toch alleen deze twee specifieke waarden door.
 */
export function valideerEngagementBestand(
  inhoud: Buffer,
  beweerdType?: string,
): EngagementBestandUitkomst {
  if (inhoud.length === 0) {
    return { geldig: false, reden: 'leeg' };
  }

  if (inhoud.length > MAX_BESTANDSGROOTTE) {
    return { geldig: false, reden: 'te-groot' };
  }

  if (lijktOpEml(inhoud)) {
    if (beweerdType !== undefined && beweerdType !== 'message/rfc822') {
      return { geldig: false, reden: 'type-komt-niet-overeen' };
    }

    return {
      geldig: true,
      contentType: 'message/rfc822',
      sha256: createHash('sha256').update(inhoud).digest('hex'),
    };
  }

  const isZip =
    inhoud.length >= 4 &&
    inhoud[0] === 0x50 &&
    inhoud[1] === 0x4b &&
    inhoud[2] === 0x03 &&
    inhoud[3] === 0x04;

  if (isZip) {
    if (
      beweerdType === undefined ||
      !(OOXML_TYPES as readonly string[]).includes(beweerdType)
    ) {
      return { geldig: false, reden: 'onbekend-type' };
    }

    return {
      geldig: true,
      contentType: beweerdType as ToegestaanEngagementContentType,
      sha256: createHash('sha256').update(inhoud).digest('hex'),
    };
  }

  const vastgesteld = detecteerContentType(inhoud, HANDTEKENINGEN);

  if (vastgesteld === null) {
    return { geldig: false, reden: 'onbekend-type' };
  }

  // .msg (OLE/CFBF) krijgt vaak een generiek of ontbrekend beweerd type mee
  // van de browser (bijv. application/octet-stream) — anders dan PDF/PNG,
  // waarvoor browsers doorgaans wél een betrouwbaar, specifiek MIME-type
  // meegeven. Voor .msg daarom alleen weigeren bij een expliciet ANDER,
  // eveneens bekend content-type (een echte mismatch, bijv. een bestand met
  // .msg-signature maar beweerd als 'application/pdf') — een generiek of
  // onbekend beweerd type blokkeert niet. PDF/PNG blijven de bestaande,
  // strikte mismatch-check gebruiken: daarvoor is een afwijkend beweerd
  // type altijd een reden tot weigeren, ongeacht of dat type zelf bekend is.
  const beweerdTypeBlokkeert =
    vastgesteld === 'application/vnd.ms-outlook'
      ? beweerdType !== undefined &&
        beweerdType !== vastgesteld &&
        ALLE_BEKENDE_TYPES.has(beweerdType)
      : beweerdType !== undefined && beweerdType !== vastgesteld;

  if (beweerdTypeBlokkeert) {
    return { geldig: false, reden: 'type-komt-niet-overeen' };
  }

  return {
    geldig: true,
    contentType: vastgesteld,
    sha256: createHash('sha256').update(inhoud).digest('hex'),
  };
}

/** Bouwt de opslagsleutel: `<tenant>/<engagement>/<uuid>`. */
export function maakEngagementOpslagsleutel(
  tenantId: string,
  engagementId: string,
): string {
  return `${tenantId}/${engagementId}/${randomUUID()}`;
}
