import type { LinkType } from './vendor-engagement.service';

const MAX_TITEL = 300;

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
  links: ReadonlyArray<{ linkType: LinkType; linkedId: string }>;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(waarde: unknown): waarde is string {
  return typeof waarde === 'string' && UUID_REGEX.test(waarde);
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

  const linksRaw = obj.links;
  const links =
    linksRaw === undefined
      ? []
      : Array.isArray(linksRaw)
        ? linksRaw.map(leesLink)
        : (() => {
            throw new InvoerFout('links', 'links moet een lijst zijn.');
          })();

  return { titel: obj.titel.trim(), links };
}

export function leesNieuweLink(body: unknown): {
  linkType: LinkType;
  linkedId: string;
} {
  return leesLink(body);
}
