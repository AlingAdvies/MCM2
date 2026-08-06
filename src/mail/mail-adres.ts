/**
 * Validatie van e-mailadressen voor het mailkanaal.
 *
 * Bewust een eigen functie en niet `class-validator`'s `@IsEmail()`: die
 * weigert in sommige configuraties plusadressering, en juist daarop leunt de
 * hele testopzet uit het mailkanaal-ontwerp §6 (`naam+demo-vendor1@gmail.com`
 * als vijf onderscheidbare leveranciers).
 *
 * Een validator die `+` weigert, blokkeert dus niet een randgeval maar de
 * manier waarop we het systeem aantoonbaar maken. Vandaar tegenproef 9 in het
 * ontwerp: dit is de eerste test die moet draaien.
 *
 * Zie docs/superpowers/specs/2026-08-06-mailkanaal.md
 */

/**
 * Minimale, bewust ruime controle: iets vóór de @, iets erna, een punt in het
 * domein, en geen witruimte.
 *
 * Waarom niet strenger? Omdat een afgewezen geldig adres erger is dan een
 * doorgelaten ongeldig adres. Het eerste betekent dat een leverancier geen
 * uitnodiging krijgt en niemand weet waarom; het tweede levert een bounce op,
 * en bounces vangen we op (ontwerp §4). De echte controle is de aflevering,
 * niet de reguliere expressie.
 *
 * RFC 5322 volledig implementeren is een bekende valkuil — die expressie is
 * berucht lang en weigert alsnog adressen die in de praktijk werken.
 */
const ADRES = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isGeldigMailadres(waarde: string): boolean {
  if (typeof waarde !== 'string') return false;

  const adres = waarde.trim();
  if (adres.length === 0 || adres.length > 254) return false;

  return ADRES.test(adres);
}
