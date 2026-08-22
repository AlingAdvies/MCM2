import type { NieuwContract, ContractWijziging } from './contract.service';

/**
 * Validatie van wat een browser opstuurt bij het aanmaken/wijzigen van een
 * contract. Zelfde opzet als vendor-invoer.ts: handmatig op `unknown`, ruime
 * regels — wat hier wordt tegengehouden is het soort invoer dat op een
 * vergissing wijst, niet elke denkbare afwijking.
 */

const MAX_NAAM = 200;
const MAX_KORT = 100;
const MAX_NOTITIE = 2000;

export class InvoerFout extends Error {
  constructor(
    readonly veld: string,
    melding: string,
  ) {
    super(melding);
    this.name = 'InvoerFout';
  }
}

function verplichteTekst(
  waarde: unknown,
  veld: string,
  maxLengte: number,
): string {
  if (typeof waarde !== 'string' || waarde.trim() === '') {
    throw new InvoerFout(veld, `${veld} is verplicht.`);
  }

  const geknipt = waarde.trim();

  if (geknipt.length > maxLengte) {
    throw new InvoerFout(
      veld,
      `${veld} mag maximaal ${maxLengte} tekens bevatten.`,
    );
  }

  return geknipt;
}

function optioneleTekst(
  waarde: unknown,
  veld: string,
  maxLengte: number,
): string | null {
  if (waarde === undefined || waarde === null || waarde === '') {
    return null;
  }

  if (typeof waarde !== 'string') {
    throw new InvoerFout(veld, `${veld} moet tekst zijn.`);
  }

  const geknipt = waarde.trim();

  if (geknipt === '') {
    return null;
  }

  if (geknipt.length > maxLengte) {
    throw new InvoerFout(
      veld,
      `${veld} mag maximaal ${maxLengte} tekens bevatten.`,
    );
  }

  return geknipt;
}

function optioneleUuid(waarde: unknown, veld: string): string | null {
  if (waarde === undefined || waarde === null || waarde === '') {
    return null;
  }

  const UUID_PATROON =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (typeof waarde !== 'string' || !UUID_PATROON.test(waarde)) {
    throw new InvoerFout(veld, `${veld} is geen geldige id.`);
  }

  return waarde;
}

const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;

function optioneleDatum(waarde: unknown, veld: string): string | null {
  if (waarde === undefined || waarde === null || waarde === '') {
    return null;
  }

  if (typeof waarde !== 'string' || !ISO_DATUM.test(waarde)) {
    throw new InvoerFout(veld, `${veld} moet een datum zijn (JJJJ-MM-DD).`);
  }

  return waarde;
}

/**
 * Een geldbedrag als tekst, zodat precisie niet verloren gaat via number.
 * Numeriek(15,2) in de database — twee decimalen, geen extra validatie op
 * decimalenaantal hier: de database wijst een te lange waarde zelf af.
 */
function optioneelBedrag(waarde: unknown, veld: string): string | null {
  if (waarde === undefined || waarde === null || waarde === '') {
    return null;
  }

  if (typeof waarde !== 'string' || !/^\d+(\.\d{1,2})?$/.test(waarde)) {
    throw new InvoerFout(veld, `${veld} moet een geldig bedrag zijn.`);
  }

  return waarde;
}

function controleerDatumVolgorde(
  startDate: string | null,
  endDate: string | null,
): void {
  if (startDate && endDate && startDate > endDate) {
    throw new InvoerFout(
      'endDate',
      'De einddatum kan niet vóór de begindatum liggen.',
    );
  }
}

/** Leest en valideert de body van POST /vendors/:vendorId/contracts. */
export function leesNieuwContract(body: unknown): NieuwContract {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Er is geen contract meegestuurd.');
  }

  const ruw = body as Record<string, unknown>;

  const startDate = optioneleDatum(ruw.startDate, 'Begindatum');
  const endDate = optioneleDatum(ruw.endDate, 'Einddatum');
  controleerDatumVolgorde(startDate, endDate);

  return {
    name: verplichteTekst(ruw.name, 'Naam', MAX_NAAM),
    contractNumber: optioneleTekst(
      ruw.contractNumber,
      'Contractnummer',
      MAX_KORT,
    ),
    vendorContactId: optioneleUuid(ruw.vendorContactId, 'Contactpersoon'),
    ownerUserId: optioneleUuid(ruw.ownerUserId, 'Contractbeheerder'),
    statusCode: optioneleTekst(ruw.statusCode, 'Status', MAX_KORT),
    valueEur: optioneelBedrag(ruw.valueEur, 'Waarde'),
    startDate,
    endDate,
    note: optioneleTekst(ruw.note, 'Notitie', MAX_NOTITIE),
  };
}

/** Leest de body van PATCH /vendors/:vendorId/contracts/:id. */
export function leesContractWijziging(body: unknown): ContractWijziging {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Er is geen wijziging meegestuurd.');
  }

  const ruw = body as Record<string, unknown>;
  const wijziging: ContractWijziging = {};

  if ('name' in ruw) {
    wijziging.name = verplichteTekst(ruw.name, 'Naam', MAX_NAAM);
  }
  if ('contractNumber' in ruw) {
    wijziging.contractNumber = optioneleTekst(
      ruw.contractNumber,
      'Contractnummer',
      MAX_KORT,
    );
  }
  if ('vendorContactId' in ruw) {
    wijziging.vendorContactId = optioneleUuid(
      ruw.vendorContactId,
      'Contactpersoon',
    );
  }
  if ('ownerUserId' in ruw) {
    wijziging.ownerUserId = optioneleUuid(ruw.ownerUserId, 'Contractbeheerder');
  }
  if ('statusCode' in ruw) {
    wijziging.statusCode = optioneleTekst(ruw.statusCode, 'Status', MAX_KORT);
  }
  if ('valueEur' in ruw) {
    wijziging.valueEur = optioneelBedrag(ruw.valueEur, 'Waarde');
  }
  if ('startDate' in ruw) {
    wijziging.startDate = optioneleDatum(ruw.startDate, 'Begindatum');
  }
  if ('endDate' in ruw) {
    wijziging.endDate = optioneleDatum(ruw.endDate, 'Einddatum');
  }
  if ('note' in ruw) {
    wijziging.note = optioneleTekst(ruw.note, 'Notitie', MAX_NOTITIE);
  }

  controleerDatumVolgorde(
    wijziging.startDate ?? null,
    wijziging.endDate ?? null,
  );

  return wijziging;
}

const UUID_PATROON_KOPPELING =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Leest de body van PUT .../contracts/:id/survey-templates. */
export function leesSurveyTemplateKoppeling(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Er is geen koppeling meegestuurd.');
  }

  const ruw = body as Record<string, unknown>;

  if (!('templateIds' in ruw)) {
    throw new InvoerFout('templateIds', 'templateIds is verplicht.');
  }

  if (!Array.isArray(ruw.templateIds)) {
    throw new InvoerFout('templateIds', 'templateIds moet een lijst zijn.');
  }

  for (const waarde of ruw.templateIds) {
    if (typeof waarde !== 'string' || !UUID_PATROON_KOPPELING.test(waarde)) {
      throw new InvoerFout('templateIds', "Een van de id's is ongeldig.");
    }
  }

  // Dubbele ids negeren, niet weigeren: een dubbelklik in de checkbox-lijst
  // is een UI-detail, geen fout van de gebruiker.
  return [...new Set(ruw.templateIds as string[])];
}
