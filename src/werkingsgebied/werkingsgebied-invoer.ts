/** Zelfde InvoerFout-vorm als vendor-category-invoer.ts: (melding, veld). */
export class InvoerFout extends Error {
  constructor(
    message: string,
    public readonly veld: string,
  ) {
    super(message);
  }
}

const CODE_PATROON = /^[a-z0-9_]{1,50}$/;

export interface NieuwWerkingsgebied {
  code: string;
  label: string;
}

export interface WerkingsgebiedWijziging {
  label: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Zelfde codebeperking als vendor-categorieën: de import maakt codes aan via
 * naarCategorieCode() (kleine letters, cijfers, underscore), dus een
 * handmatig aangemaakt gebied moet dezelfde vorm hebben om te kunnen matchen.
 */
export function leesNieuwWerkingsgebied(body: unknown): NieuwWerkingsgebied {
  if (!isRecord(body)) {
    throw new InvoerFout('Ongeldige invoer.', 'body');
  }

  const code = body.code;
  if (typeof code !== 'string' || !CODE_PATROON.test(code)) {
    throw new InvoerFout(
      'Code moet uit kleine letters, cijfers en underscores bestaan (max 50 tekens).',
      'code',
    );
  }

  const label = body.label;
  if (typeof label !== 'string' || label.trim().length === 0) {
    throw new InvoerFout('Naam mag niet leeg zijn.', 'label');
  }

  return { code, label: label.trim() };
}

export function leesWerkingsgebiedWijziging(
  body: unknown,
): WerkingsgebiedWijziging {
  if (!isRecord(body)) {
    throw new InvoerFout('Ongeldige invoer.', 'body');
  }

  const label = body.label;
  if (typeof label !== 'string' || label.trim().length === 0) {
    throw new InvoerFout('Naam mag niet leeg zijn.', 'label');
  }

  return { label: label.trim() };
}

/** Voor PUT …/contracts/:id/werkingsgebieden — body `{ codes: string[] }`. */
export function leesWerkingsgebiedCodes(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.codes)) {
    throw new InvoerFout('Verwacht een lijst met codes.', 'codes');
  }

  const codes = body.codes.map((c: unknown) => {
    if (typeof c !== 'string' || !CODE_PATROON.test(c)) {
      throw new InvoerFout(`Ongeldige code: ${String(c)}`, 'codes');
    }
    return c;
  });

  return [...new Set(codes)];
}
