import { isGeldigMailadres } from '../mail/mail-adres';
import { InvoerFout } from '../vendor/vendor-invoer';

import type { TenantWijziging } from './tenant.service';

/**
 * Validatie van wat het beheerscherm opstuurt bij het wijzigen van de eigen
 * tenantinstellingen.
 *
 * Zelfde stijl en dezelfde `InvoerFout` als `vendor-invoer.ts` en
 * `platform-invoer.ts`: handmatig, met `unknown` als invoer.
 *
 * ── Waarom hier isGeldigMailadres() en niet een eigen expressie ─────────────
 *
 * `platform-invoer.ts` heeft zijn eigen e-mailcontrole, en dat is nu een
 * verschil te veel: de database (CHECK-constraint uit 0025), het mailkanaal en
 * dit scherm horen hetzelfde toe te staan. Wijkt er één af, dan is er een adres
 * dat het ene niveau doorlaat en het andere weigert — en dat blijkt pas bij de
 * eerste uitvraag.
 *
 * `isGeldigMailadres()` is de vorm waar de constraint uit 0025 op is gemodelleerd.
 */

/** RFC 5321: 64 lokaal + @ + 255 domein. De constraint uit 0025 gebruikt 254. */
const MAX_EMAIL = 254;

/**
 * Leest een gedeeltelijke wijziging.
 *
 * Drie uitkomsten per veld, en het onderscheid tussen de laatste twee is
 * wezenlijk:
 *
 *   veld ontbreekt        → undefined  → niet aanraken
 *   veld is leeg of null  → null       → wissen
 *   veld heeft een waarde → de waarde  → instellen
 *
 * Zonder dat onderscheid zou een scherm dat alleen de tenantnaam wijzigt het
 * antwoordadres stilzwijgend wissen — precies het soort stille bijwerking dat
 * pas opvalt als een leverancier antwoordt en niemand het leest.
 */
export function leesTenantWijziging(body: unknown): TenantWijziging {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Verwacht een JSON-object.');
  }

  const invoer = body as Record<string, unknown>;

  if (!('antwoordEmail' in invoer)) {
    return {};
  }

  return { antwoordEmail: leesAntwoordEmail(invoer.antwoordEmail) };
}

function leesAntwoordEmail(waarde: unknown): string | null {
  const veld = 'antwoordEmail';

  // Bewust wissen: het veld is meegestuurd, maar leeg. Een tenant die zijn
  // antwoordadres intrekt hoort dat te kunnen — de berichttekst vangt het af
  // met een andere zin.
  if (waarde === null || waarde === '') {
    return null;
  }

  if (typeof waarde !== 'string') {
    throw new InvoerFout(veld, 'Het antwoordadres moet tekst zijn.');
  }

  const schoon = waarde.trim();

  if (schoon === '') {
    return null;
  }

  if (schoon.length > MAX_EMAIL) {
    throw new InvoerFout(
      veld,
      `Het antwoordadres mag hoogstens ${MAX_EMAIL} tekens zijn.`,
    );
  }

  if (!isGeldigMailadres(schoon)) {
    throw new InvoerFout(veld, 'Dit is geen geldig e-mailadres.');
  }

  return schoon;
}
