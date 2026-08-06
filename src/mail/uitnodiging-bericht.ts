import type { MailBericht } from './mail-kanaal';

/**
 * Stelt de uitnodigingsmail samen die een leverancier ontvangt.
 *
 * ── Waarom dit een eigen bestand is ─────────────────────────────────────────
 *
 * De tekst van deze mail is het enige wat een leverancier van MCM2 ziet vóór
 * hij besluit te klikken. Dat maakt hem belangrijker dan zijn omvang
 * suggereert: een bericht dat leest als phishing wordt niet aangeklikt, en dan
 * komt de vragenlijst niet binnen.
 *
 * Los van de verzendcode zodat de tekst te lezen en te testen is zonder een
 * mailkanaal, een database of een netwerkverbinding.
 *
 * ── Wat deze tekst bewust wél en niet doet ──────────────────────────────────
 *
 * Wél: de opdrachtgever bij naam noemen, zeggen waarom de leverancier dit
 * krijgt, en de link volledig uitschrijven. Een leverancier die de afzender
 * niet vertrouwt, moet de URL kunnen bekijken zonder te klikken.
 *
 * Niet: urgentie opkloppen, of doen alsof het bericht persoonlijk getypt is.
 * Beide zijn phishing-signalen — voor de ontvanger én voor spamfilters.
 *
 * Platte tekst en geen HTML. Sjablonen staan buiten scope (beheermenu-spec
 * §3b), en een kale tekstmail komt door filters waar opgemaakte mail op
 * struikelt.
 *
 * Zie docs/superpowers/specs/2026-08-06-mailkanaal.md
 */

export interface UitnodigingGegevens {
  /** Het adres van de contactpersoon bij de leverancier. */
  readonly ontvanger: string;
  /** Naam van de leverancier, zoals die in de tenant bekendstaat. */
  readonly vendorNaam: string;
  /** Naam van de opdrachtgever — dit is wat de ontvanger moet herkennen. */
  readonly tenantNaam: string;
  /** Naam van de vragenlijst, bijv. "Jaarlijkse IT-risicovragenlijst". */
  readonly vragenlijstNaam: string;
  /** De volledige portaal-URL inclusief token. */
  readonly link: string;
  /** Tot wanneer de link werkt (ISO-datum). */
  readonly verlooptOp: string;
  /** Waar een antwoord van de leverancier heen gaat. */
  readonly antwoordAan?: string;
}

/**
 * Datum in de vorm die een Nederlandse lezer verwacht: `12 augustus 2026`.
 *
 * Bewust niet `12-08-2026`: bij een uiterste datum is een misgelezen dag/maand
 * het verschil tussen op tijd en te laat.
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

export function stelUitnodigingSamen(
  gegevens: UitnodigingGegevens,
): MailBericht {
  const uiterlijk = leesbareDatum(gegevens.verlooptOp);

  const tekst = [
    `Beste contactpersoon van ${gegevens.vendorNaam},`,
    ``,
    `${gegevens.tenantNaam} vraagt u de vragenlijst "${gegevens.vragenlijstNaam}" in te vullen.`,
    `U ontvangt dit bericht omdat u als leverancier bij ${gegevens.tenantNaam} bekendstaat.`,
    ``,
    `Vul de vragenlijst in via deze link:`,
    gegevens.link,
    ``,
    `De link is persoonlijk en werkt tot en met ${uiterlijk}.`,
    `Na het indienen kan de vragenlijst niet meer gewijzigd worden.`,
    ``,
    // Deze regel voorkomt de mail die anders bij ons terechtkomt en die wij
    // niet kunnen beantwoorden: alleen de opdrachtgever weet of een
    // leverancier nog een contract heeft (ontwerp §4).
    gegevens.antwoordAan
      ? `Vragen over deze uitvraag? Beantwoord dit bericht, dan komt het bij ${gegevens.tenantNaam} terecht.`
      : `Vragen over deze uitvraag? Neem contact op met uw contactpersoon bij ${gegevens.tenantNaam}.`,
    ``,
    `Met vriendelijke groet,`,
    gegevens.tenantNaam,
    ``,
    `---`,
    `Dit bericht is verstuurd via MCM2, het contractmanagementsysteem van ${gegevens.tenantNaam}.`,
  ].join('\n');

  return {
    aan: gegevens.ontvanger,
    // De opdrachtgever voorop: dat is wat de ontvanger in zijn inbox ziet en
    // waaraan hij herkent dat dit legitiem is (Issue #13, ontwerp §3).
    afzenderNaam: `${gegevens.tenantNaam} via MCM2`,
    antwoordAan: gegevens.antwoordAan,
    onderwerp: `${gegevens.tenantNaam} vraagt om ingevulde vragenlijst: ${gegevens.vragenlijstNaam}`,
    tekst,
  };
}
