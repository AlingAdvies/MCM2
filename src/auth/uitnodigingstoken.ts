import { createHash, randomBytes } from 'node:crypto';

/**
 * Het token waarmee een uitgenodigde beheerder zijn eerste login koppelt.
 *
 * ── Waarom dit bestaat naast survey-token.ts ────────────────────────────────
 *
 * Het vormmodel is identiek — 256 bits willekeur, base64url in de link, SHA-256
 * in de database — en dat is opzet: één bewezen patroon in plaats van twee
 * varianten die uit elkaar groeien.
 *
 * Toch geen hergebruik van `survey-token.ts`, om dezelfde reden als bij
 * `sessie.ts`: die module draagt het vertrouwensmodel van spoor 2
 * (accountloze leverancierstoegang, Issue #7) en heeft daar zijn eigen
 * geldigheidsduur en constraints. Een gedeelde helper zou betekenen dat een
 * wijziging voor leveranciers stilzwijgend de beheerderuitnodiging raakt.
 *
 * ── Wat dit token wél en niet doet ──────────────────────────────────────────
 *
 * Het bewijst dat de houder de uitnodiging heeft die de platformbeheerder heeft
 * uitgegeven. Het is géén authenticatie: wie op de link klikt moet daarna nog
 * gewoon inloggen bij de identity provider. Het token bepaalt aan wélke
 * gebruikersrij die login gekoppeld wordt, niet óf iemand binnenkomt.
 *
 * Zie drizzle/0024_uitnodigingstoken.sql voor de voorwaarden aan databasekant.
 */

/** 32 bytes = 256 bits entropie. Raden is rekenkundig onhaalbaar. */
const TOKEN_BYTES = 32;

/** base64url van 32 bytes levert altijd 43 tekens zonder padding. */
export const UITNODIGINGSTOKEN_LENGTE = 43;

const TOKEN_PATROON = new RegExp(
  `^[A-Za-z0-9_-]{${UITNODIGINGSTOKEN_LENGTE}}$`,
);

/**
 * Genereert een nieuw uitnodigingstoken.
 *
 * `randomBytes` is de veilige generator van Node; `Math.random` is dat
 * uitdrukkelijk niet en mag hier nooit gebruikt worden.
 */
export function genereerUitnodigingstoken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Berekent de hash die in `clm.user.uitnodiging_hash` komt.
 *
 * Het ruwe token wordt nooit opgeslagen. Wie een databasedump in handen krijgt,
 * kan daarmee geen openstaande uitnodiging opeisen.
 *
 * SHA-256 en niet bcrypt/argon2, net als bij de leverancierstokens: die zijn
 * traag bij ontwerp omdat mensen korte wachtwoorden kiezen. Hier is de invoer
 * 256 bits willekeur, dus brute-force is al onhaalbaar en traagheid voegt niets
 * toe.
 */
export function hashUitnodigingstoken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Controleert de vorm vóórdat de database geraadpleegd wordt.
 *
 * Een verzoek met onzin in de parameter raakt de database dan niet. Dat is hier
 * extra van belang omdat het token in het pogingcookie meereist: een cookie dat
 * door iets anders is gevuld hoort af te ketsen op de vorm, niet op een query.
 */
export function heeftGeldigeVorm(waarde: unknown): waarde is string {
  return typeof waarde === 'string' && TOKEN_PATROON.test(waarde);
}
