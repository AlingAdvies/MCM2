import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Tokenformaat voor accountloze leverancierstoegang.
 *
 * Zie docs/superpowers/specs/2026-07-28-leveranciertoken-ontwerp.md §3.
 * De link in de e-mail ís de sleutel — er zit geen wachtwoord achter. Daarom
 * draagt dit bestand het volledige vertrouwensmodel voor spoor 2 van Issue #7.
 */

/** 32 bytes = 256 bits entropie. Raden is rekenkundig onhaalbaar, niet "moeilijk". */
const TOKEN_BYTES = 32;

/** base64url van 32 bytes levert altijd 43 tekens zonder padding. */
export const TOKEN_LENGTE = 43;

/** SHA-256 in hex. Gecontroleerd door een CHECK-constraint op de kolom. */
const HASH_LENGTE = 64;

const TOKEN_PATROON = new RegExp(`^[A-Za-z0-9_-]{${TOKEN_LENGTE}}$`);

/**
 * Genereert een nieuw, cryptografisch sterk leverancierstoken.
 *
 * `randomBytes` is de veilige generator van Node; `Math.random` is dat
 * uitdrukkelijk niet en mag hier nooit gebruikt worden.
 *
 * base64url (niet base64) omdat het token in een URL komt: geen `+`, `/` of
 * `=` die ge-escaped moeten worden.
 */
export function genereerToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Berekent de hash die in de database komt. Het ruwe token wordt nooit
 * opgeslagen: dat scheidt databasetoegang van surveytoegang. Wie een
 * databasedump in handen krijgt, kan daarmee geen enkele openstaande survey
 * openen.
 *
 * Bewust SHA-256 en niet bcrypt/argon2. Die zijn traag bij ontwerp omdat
 * mensen korte, raadbare wachtwoorden kiezen. Hier is de invoer 256 bits
 * willekeur — een brute-force is al onhaalbaar, dus traagheid voegt niets toe
 * en kost bij elke request tijd.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Controleert of een tokenwaarde de juiste vorm heeft, vóórdat de database
 * geraadpleegd wordt. Een verzoek met onzin in de parameter raakt de database
 * dan niet — dat beperkt de belasting bij een geautomatiseerde poging en houdt
 * de logs schoon.
 */
export function heeftGeldigeVorm(waarde: unknown): waarde is string {
  return typeof waarde === 'string' && TOKEN_PATROON.test(waarde);
}

/**
 * Vergelijkt twee hashes in constante tijd.
 *
 * Bij de gewone `===` lekt de vergelijkingsduur informatie over hoeveel tekens
 * overeenkomen. Dat is hier een klein risico — de lookup gaat via een index,
 * niet via een lus — maar de kosten van een veilige vergelijking zijn
 * verwaarloosbaar, dus er is geen reden het niet te doen.
 */
export function hashesGelijk(a: string, b: string): boolean {
  if (a.length !== HASH_LENGTE || b.length !== HASH_LENGTE) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/**
 * Vervalmoment: 30 dagen na uitgifte (OV-2, bevestigd door de klant).
 * Serverzijdig bepaald, nooit uit clientinput.
 */
export const GELDIGHEID_DAGEN = 30;

export function berekenVervalmoment(vanaf: Date = new Date()): Date {
  return new Date(vanaf.getTime() + GELDIGHEID_DAGEN * 24 * 60 * 60 * 1000);
}
