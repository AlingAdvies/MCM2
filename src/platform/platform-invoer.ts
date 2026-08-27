import { InvoerFout } from '../vendor/vendor-invoer';

import type { NieuweTenant, TenantWijziging } from './platform.service';

/**
 * Validatie van wat het beheerscherm opstuurt bij het aanmaken van een tenant.
 *
 * Zelfde stijl en dezelfde `InvoerFout` als `vendor-invoer.ts`: handmatig, met
 * `unknown` als invoer. Een tweede validatiestijl ernaast zou het geheel
 * ongelijkmatig maken zonder iets op te lossen.
 */

const MAX_NAAM = 200;
const MAX_EMAIL = 320; // RFC 5321: 64 lokaal + @ + 255 domein.

function verplichteTekst(
  waarde: unknown,
  veld: string,
  maxLengte: number,
): string {
  if (typeof waarde !== 'string' || waarde.trim() === '') {
    throw new InvoerFout(veld, `${veld} is verplicht.`);
  }

  const schoon = waarde.trim();

  if (schoon.length > maxLengte) {
    throw new InvoerFout(
      veld,
      `${veld} mag hoogstens ${maxLengte} tekens zijn.`,
    );
  }

  return schoon;
}

/**
 * Bewust ruim: één @, iets ervoor, en een punt erachter.
 *
 * Strenger valideren op e-mail levert vooral valse afwijzingen op — de
 * werkelijke syntaxis van RFC 5322 laat meer toe dan welke reguliere expressie
 * dan ook fatsoenlijk vangt. Of het adres bestaat blijkt toch pas als er post
 * naartoe gaat.
 */
function email(waarde: unknown, veld: string): string {
  const tekst = verplichteTekst(waarde, veld, MAX_EMAIL);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(tekst)) {
    throw new InvoerFout(veld, `${veld} is geen geldig e-mailadres.`);
  }

  return tekst;
}

export function leesNieuweTenant(body: unknown): NieuweTenant {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Verwacht een JSON-object.');
  }

  const invoer = body as Record<string, unknown>;

  return {
    naam: verplichteTekst(invoer.naam, 'naam', MAX_NAAM),
    adminNaam: verplichteTekst(invoer.adminNaam, 'adminNaam', MAX_NAAM),
    adminEmail: email(invoer.adminEmail, 'adminEmail'),
    antwoordEmail: optioneelEmail(invoer.antwoordEmail, 'antwoordEmail'),
  };
}

/** Validatie voor `PUT /platform/tenants/:id` (platformbeheer-uitbreiding). */
export function leesTenantWijziging(body: unknown): TenantWijziging {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Verwacht een JSON-object.');
  }

  const invoer = body as Record<string, unknown>;

  return {
    naam: verplichteTekst(invoer.naam, 'naam', MAX_NAAM),
    antwoordEmail: optioneelEmail(invoer.antwoordEmail, 'antwoordEmail'),
  };
}

/**
 * Het antwoordadres van de tenant — optioneel (migratie 0025).
 *
 * Leeg of afwezig is een geldige keuze en geen halve invoer: niet elke klant
 * heeft een gedeeld postvak, en de berichttekst vangt dat af met een andere
 * zin. Een lege string wordt daarom `undefined` en geen `''` — dat laatste zou
 * als "wel ingevuld" door de keten reizen en in de mail een leeg Reply-To
 * opleveren.
 */
function optioneelEmail(waarde: unknown, veld: string): string | undefined {
  if (waarde === undefined || waarde === null) {
    return undefined;
  }

  if (typeof waarde !== 'string') {
    throw new InvoerFout(veld, `${veld} moet tekst zijn.`);
  }

  if (waarde.trim() === '') {
    return undefined;
  }

  return email(waarde, veld);
}

/**
 * De reden bij support-toegang.
 *
 * Verplicht, en dat is geen formaliteit: SOC 2 CC6.3 vraagt een justification
 * bij elke elevation, en een reden die achteraf niets zegt maakt de audit trail
 * waardeloos. Vandaar ook een ondergrens — "test" of "x" is geen reden.
 */
export function leesSupportReden(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Verwacht een JSON-object.');
  }

  const reden = verplichteTekst(
    (body as Record<string, unknown>).reden,
    'reden',
    500,
  );

  if (reden.length < 10) {
    throw new InvoerFout(
      'reden',
      'Geef een reden van minstens tien tekens. Deze komt in de audit trail en moet later nog te begrijpen zijn.',
    );
  }

  return reden;
}
