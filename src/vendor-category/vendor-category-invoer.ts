/** Zelfde InvoerFout-vorm als vendor-invoer.ts / contract-invoer.ts. */
export class InvoerFout extends Error {
  constructor(
    message: string,
    public readonly veld: string,
  ) {
    super(message);
  }
}

const CODE_PATROON = /^[a-z0-9_]{1,50}$/;

export interface NieuweVendorCategorie {
  code: string;
  label: string;
}

export interface VendorCategorieWijziging {
  label: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * De code wordt door de gebruiker getypt (dit is geen gegenereerde UUID,
 * anders dan de meeste primary keys in dit project) en komt terug in de
 * dropdown op het leveranciersscherm — vandaar de beperking tot
 * kleine letters/cijfers/underscore, geen vrije tekst.
 */
export function leesNieuweVendorCategorie(
  body: unknown,
): NieuweVendorCategorie {
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
    throw new InvoerFout('Label mag niet leeg zijn.', 'label');
  }

  return { code, label: label.trim() };
}

export function leesVendorCategorieWijziging(
  body: unknown,
): VendorCategorieWijziging {
  if (!isRecord(body)) {
    throw new InvoerFout('Ongeldige invoer.', 'body');
  }

  const label = body.label;
  if (typeof label !== 'string' || label.trim().length === 0) {
    throw new InvoerFout('Label mag niet leeg zijn.', 'label');
  }

  return { label: label.trim() };
}
