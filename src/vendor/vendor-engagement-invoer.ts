import type { LinkType } from './vendor-engagement.service';

const MAX_TITEL = 300;
const MAX_NOTITIE = 500;

export class InvoerFout extends Error {
  constructor(
    readonly veld: string,
    melding: string,
  ) {
    super(melding);
    this.name = 'InvoerFout';
  }
}

export interface NieuwEngagementInvoer {
  titel: string;
  notitieTekst: string;
  links: ReadonlyArray<{ linkType: LinkType; linkedId: string }>;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(waarde: unknown): waarde is string {
  return typeof waarde === 'string' && UUID_REGEX.test(waarde);
}

function leesNotitieTekst(waarde: unknown): string {
  if (
    typeof waarde !== 'string' ||
    waarde.trim() === '' ||
    waarde.length > MAX_NOTITIE
  ) {
    throw new InvoerFout(
      'notitieTekst',
      `notitieTekst is verplicht en mag maximaal ${MAX_NOTITIE} tekens zijn.`,
    );
  }
  return waarde.trim();
}

function leesLink(waarde: unknown): { linkType: LinkType; linkedId: string } {
  if (typeof waarde !== 'object' || waarde === null) {
    throw new InvoerFout('links', 'Elke link moet een object zijn.');
  }

  const obj = waarde as Record<string, unknown>;

  if (obj.linkType !== 'contract' && obj.linkType !== 'survey_response') {
    throw new InvoerFout(
      'links',
      "linkType moet 'contract' of 'survey_response' zijn.",
    );
  }

  if (!isUuid(obj.linkedId)) {
    throw new InvoerFout('links', 'linkedId moet een geldige uuid zijn.');
  }

  return { linkType: obj.linkType, linkedId: obj.linkedId };
}

export function leesNieuwEngagement(body: unknown): NieuwEngagementInvoer {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Ongeldige invoer.');
  }

  const obj = body as Record<string, unknown>;

  if (
    typeof obj.titel !== 'string' ||
    obj.titel.trim() === '' ||
    obj.titel.length > MAX_TITEL
  ) {
    throw new InvoerFout(
      'titel',
      `titel is verplicht en mag maximaal ${MAX_TITEL} tekens zijn.`,
    );
  }

  const notitieTekst = leesNotitieTekst(obj.notitieTekst);

  const linksRaw = obj.links;
  const links =
    linksRaw === undefined
      ? []
      : Array.isArray(linksRaw)
        ? linksRaw.map(leesLink)
        : (() => {
            throw new InvoerFout('links', 'links moet een lijst zijn.');
          })();

  return { titel: obj.titel.trim(), notitieTekst, links };
}

export function leesNieuweLink(body: unknown): {
  linkType: LinkType;
  linkedId: string;
} {
  return leesLink(body);
}

export function leesNieuweNotitie(body: unknown): { tekst: string } {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Ongeldige invoer.');
  }

  const obj = body as Record<string, unknown>;
  return { tekst: leesNotitieTekst(obj.tekst) };
}

/** Afronden van een dossier (#248): korte uitkomst verplicht, zelfde grens als een notitie. */
export function leesAfronding(body: unknown): { uitkomst: string } {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Ongeldige invoer.');
  }

  const obj = body as Record<string, unknown>;
  if (
    typeof obj.uitkomst !== 'string' ||
    obj.uitkomst.trim() === '' ||
    obj.uitkomst.length > MAX_NOTITIE
  ) {
    throw new InvoerFout(
      'uitkomst',
      `uitkomst is verplicht en mag maximaal ${MAX_NOTITIE} tekens zijn.`,
    );
  }
  return { uitkomst: obj.uitkomst.trim() };
}

const MAX_VOLGENDE_STAP = 300;
const DATUM_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Volgende stap van een dossier (#248). Beide velden optioneel; null of een
 * lege tekst wist het veld.
 */
export function leesVolgendeStap(body: unknown): {
  tekst: string | null;
  datum: string | null;
} {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Ongeldige invoer.');
  }

  const obj = body as Record<string, unknown>;

  let tekst: string | null = null;
  if (obj.tekst !== undefined && obj.tekst !== null) {
    if (typeof obj.tekst !== 'string' || obj.tekst.length > MAX_VOLGENDE_STAP) {
      throw new InvoerFout(
        'tekst',
        `tekst mag maximaal ${MAX_VOLGENDE_STAP} tekens zijn.`,
      );
    }
    tekst = obj.tekst.trim() === '' ? null : obj.tekst.trim();
  }

  let datum: string | null = null;
  if (obj.datum !== undefined && obj.datum !== null && obj.datum !== '') {
    if (
      typeof obj.datum !== 'string' ||
      !DATUM_REGEX.test(obj.datum) ||
      Number.isNaN(new Date(`${obj.datum}T00:00:00Z`).getTime())
    ) {
      throw new InvoerFout('datum', 'datum moet de vorm JJJJ-MM-DD hebben.');
    }
    datum = obj.datum;
  }

  return { tekst, datum };
}
