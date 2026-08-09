import type { MailBericht } from './mail-kanaal';

/**
 * Stelt de mail samen waarmee een nieuwe tenantbeheerder wordt uitgenodigd.
 *
 * ── Waarom dit niet `uitnodiging-bericht.ts` hergebruikt ────────────────────
 *
 * Beide sturen een link met een token, en daar houdt de overeenkomst op.
 *
 * De leveranciersmail gaat naar iemand die MCM2 niet kent, niets heeft
 * afgesproken en niets hoeft te doen behalve een vragenlijst invullen. Hij moet
 * vooral overtuigen dat het bericht legitiem is: de opdrachtgever voorop, geen
 * urgentie, de URL volledig uitgeschreven.
 *
 * Deze mail gaat naar iemand die wéét dat hij hem krijgt — de platformbeheerder
 * heeft met hem afgesproken dat zijn organisatie MCM2 gaat gebruiken. Wat hij
 * nodig heeft is niet overtuiging maar duidelijkheid: wat is dit, wat moet ik
 * doen, en wat gebeurt er als ik wacht.
 *
 * Eén sjabloon voor beide zou betekenen dat elke wijziging aan de ene tekst de
 * andere raakt, terwijl ze een verschillend publiek en een verschillend doel
 * hebben.
 *
 * ── Wat deze tekst bewust wél en niet doet ──────────────────────────────────
 *
 * Wél: benoemen wie de uitnodiging stuurt en voor welke organisatie, de link
 * volledig uitschrijven, en zeggen tot wanneer hij werkt.
 *
 * Niet: het woord "wachtwoord" gebruiken, of vragen om gegevens in te vullen in
 * een antwoord op deze mail. Beide zijn phishing-signalen, en juist bij een mail
 * die tot een inlog leidt is dat het verschil tussen vertrouwd en verdacht.
 *
 * Platte tekst, geen HTML — zelfde keuze en zelfde reden als bij de
 * leveranciersmail.
 */

export interface BeheerderUitnodigingGegevens {
  /** Het adres van de nieuwe beheerder. */
  readonly ontvanger: string;
  /** Zijn naam, zoals de platformbeheerder die heeft ingevoerd. */
  readonly beheerderNaam: string;
  /** De organisatie waarvoor de omgeving is aangemaakt. */
  readonly tenantNaam: string;
  /** De volledige uitnodigingslink inclusief token. */
  readonly link: string;
  /** Tot wanneer de link werkt (ISO-datum). */
  readonly verlooptOp: string;
}

/**
 * Datum in de vorm die een Nederlandse lezer verwacht: `7 november 2026`.
 *
 * Bewust niet `07-11-2026`: bij een uiterste datum is een misgelezen dag/maand
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

export function stelBeheerderUitnodigingSamen(
  gegevens: BeheerderUitnodigingGegevens,
): MailBericht {
  const uiterlijk = leesbareDatum(gegevens.verlooptOp);

  const tekst = [
    `Beste ${gegevens.beheerderNaam},`,
    ``,
    `Er is een MCM2-omgeving aangemaakt voor ${gegevens.tenantNaam}, en u bent`,
    `aangewezen als beheerder.`,
    ``,
    `Klik op onderstaande link om uw account te activeren:`,
    gegevens.link,
    ``,
    // Dat de link eenmalig is, staat er niet als waarschuwing maar als uitleg:
    // wie hem een tweede keer opent krijgt anders een onverklaarbare fout.
    `U logt daarbij in met uw eigen zakelijke account. De link werkt eenmalig`,
    `en is geldig tot en met ${uiterlijk}.`,
    ``,
    `Daarna beheert u zelf de leveranciers, vragenlijsten en uitvragen van`,
    `${gegevens.tenantNaam}.`,
    ``,
    // Zonder deze regel weet iemand die de mail onverwacht krijgt niet wat te
    // doen, en dat is precies het moment waarop een uitnodiging als phishing
    // wordt gemeld.
    `Verwacht u deze uitnodiging niet? Dan kunt u dit bericht negeren; zonder`,
    `de link gebeurt er niets.`,
    ``,
    `Met vriendelijke groet,`,
    `MCM2`,
  ].join('\n');

  return {
    aan: gegevens.ontvanger,
    // Geen tenantnaam voorop zoals bij de leveranciersmail: deze uitnodiging
    // komt van het platform en niet namens de klant. De klant heeft immers nog
    // geen omgeving om namens te spreken — die wordt hier juist geopend.
    afzenderNaam: 'MCM2',
    onderwerp: `Uitnodiging: beheer de MCM2-omgeving van ${gegevens.tenantNaam}`,
    tekst,
  };
}
