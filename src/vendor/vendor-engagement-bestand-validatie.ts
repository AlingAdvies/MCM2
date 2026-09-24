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
] as const satisfies readonly BestandHandtekening<string>[];

const OOXML_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export type ToegestaanEngagementContentType =
  (typeof HANDTEKENINGEN)[number]['contentType'] | (typeof OOXML_TYPES)[number];

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

  if (beweerdType !== undefined && beweerdType !== vastgesteld) {
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
