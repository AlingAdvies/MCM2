import { isGeldigMailadres } from '../mail/mail-adres';
import { InvoerFout } from '../vendor/vendor-invoer';

/**
 * Validatie van wat het scherm voor tenant-gebruikersbeheer opstuurt
 * (issue #75). Zelfde stijl en dezelfde `InvoerFout` als `vendor-invoer.ts`
 * en `tenant-invoer.ts`.
 *
 * `isGeldigMailadres()` en niet een eigen regex: zelfde reden als in
 * `tenant-invoer.ts` — het mailkanaal, de database en elk invoerscherm
 * horen hetzelfde e-mailadres toe te staan.
 */

/** Rollen die via deze route toegekend mogen worden. 'support' nooit — dat
 * gaat uitsluitend via PlatformService.supportToegangGeven(). */
const TOEGESTANE_ROLLEN = ['admin', 'user', 'reviewer'] as const;
type ToegestaneRol = (typeof TOEGESTANE_ROLLEN)[number];

/** Zelfde grens als full_name elders (vendor-invoer.ts). */
const MAX_NAAM = 200;

export interface NieuwLid {
  email: string;
  naam: string;
  rol: ToegestaneRol;
}

export interface RolWijziging {
  rol: ToegestaneRol;
}

export interface GegevensWijziging {
  naam: string;
  email: string;
}

function leesRol(waarde: unknown): ToegestaneRol {
  if (
    typeof waarde !== 'string' ||
    !TOEGESTANE_ROLLEN.includes(waarde as ToegestaneRol)
  ) {
    throw new InvoerFout('rol', 'Kies admin, user of reviewer.');
  }
  return waarde as ToegestaneRol;
}

function leesNaam(waarde: unknown): string {
  if (typeof waarde !== 'string' || waarde.trim() === '') {
    throw new InvoerFout('naam', 'Naam is verplicht.');
  }

  const geknipt = waarde.trim();

  if (geknipt.length > MAX_NAAM) {
    throw new InvoerFout('naam', `Naam mag hoogstens ${MAX_NAAM} tekens zijn.`);
  }

  return geknipt;
}

export function leesNieuwLid(body: unknown): NieuwLid {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('email', 'Verwacht een JSON-object.');
  }
  const { email, naam, rol } = body as Record<string, unknown>;

  if (typeof email !== 'string' || !isGeldigMailadres(email)) {
    throw new InvoerFout('email', 'Vul een geldig e-mailadres in.');
  }

  return { email, naam: leesNaam(naam), rol: leesRol(rol) };
}

export function leesRolWijziging(body: unknown): RolWijziging {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('rol', 'Verwacht een JSON-object.');
  }
  const { rol } = body as Record<string, unknown>;
  return { rol: leesRol(rol) };
}

export function leesGegevensWijziging(body: unknown): GegevensWijziging {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('email', 'Verwacht een JSON-object.');
  }
  const { email, naam } = body as Record<string, unknown>;

  if (typeof email !== 'string' || !isGeldigMailadres(email)) {
    throw new InvoerFout('email', 'Vul een geldig e-mailadres in.');
  }

  return { email, naam: leesNaam(naam) };
}
