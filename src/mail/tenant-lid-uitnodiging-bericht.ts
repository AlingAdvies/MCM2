import type { MailBericht } from './mail-kanaal';

/**
 * Stelt de mail samen waarmee een tenant-admin een collega uitnodigt om lid
 * te worden van zijn eigen, al bestaande tenant (issue #75).
 *
 * ── Waarom dit niet beheerder-uitnodiging-bericht.ts hergebruikt ────────────
 *
 * Die mail komt van het platform namens een organisatie die nog geen
 * omgeving heeft — er is nog geen "namens" om te spreken. Deze mail komt
 * vanuit een al bestaande tenant, dus de afzendernaam hoort de tenantnaam
 * voorop te hebben, zelfde patroon als de leveranciersuitnodiging
 * (`Van: Transdev via MCM2`). Verder verschilt de rol die wordt toegekend —
 * die hoort er expliciet in te staan, zodat de ontvanger weet wat hij straks
 * wel en niet kan.
 *
 * Platte tekst, geen HTML, en geen "wachtwoord" — zelfde reden als bij de
 * andere twee uitnodigingsmails: phishing-signalen vermijden.
 */

export interface TenantLidUitnodigingGegevens {
  /** Het adres van de nieuwe collega. */
  readonly ontvanger: string;
  /** De tenant waarvoor wordt uitgenodigd. */
  readonly tenantNaam: string;
  /** De rol die de collega krijgt: admin, user of reviewer. */
  readonly rol: string;
  /** De volledige uitnodigingslink inclusief token. */
  readonly link: string;
  /** Tot wanneer de link werkt (ISO-datum). */
  readonly verlooptOp: string;
}

const ROL_OMSCHRIJVING: Record<string, string> = {
  admin: 'beheerder',
  user: 'contractbeheerder',
  reviewer: 'beoordelaar',
};

/**
 * Datum in de vorm die een Nederlandse lezer verwacht: `7 november 2026`.
 *
 * Zelfde als in beheerder-uitnodiging-bericht.ts — geen `07-11-2026`, want
 * bij een uiterste datum is een misgelezen dag/maand het verschil tussen op
 * tijd en te laat.
 */
function leesbareDatum(iso: string): string {
  const datum = new Date(iso);

  if (Number.isNaN(datum.getTime())) {
    return iso;
  }

  return datum.toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function stelTenantLidUitnodigingSamen(
  gegevens: TenantLidUitnodigingGegevens,
): MailBericht {
  const uiterlijk = leesbareDatum(gegevens.verlooptOp);
  const rolOmschrijving = ROL_OMSCHRIJVING[gegevens.rol] ?? gegevens.rol;

  const tekst = [
    `Hallo,`,
    ``,
    `U bent uitgenodigd voor de MCM2-omgeving van ${gegevens.tenantNaam}, als`,
    `${rolOmschrijving}.`,
    ``,
    `Klik op onderstaande link om uw account te activeren:`,
    gegevens.link,
    ``,
    `U logt daarbij in met uw eigen zakelijke account. De link werkt eenmalig`,
    `en is geldig tot en met ${uiterlijk}.`,
    ``,
    `Verwacht u deze uitnodiging niet? Dan kunt u dit bericht negeren; zonder`,
    `de link gebeurt er niets.`,
    ``,
    `Met vriendelijke groet,`,
    `${gegevens.tenantNaam}`,
  ].join('\n');

  return {
    aan: gegevens.ontvanger,
    afzenderNaam: `${gegevens.tenantNaam} via MCM2`,
    onderwerp: `Uitnodiging: MCM2-omgeving van ${gegevens.tenantNaam}`,
    tekst,
  };
}
