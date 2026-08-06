import { Injectable, Logger } from '@nestjs/common';

import { MailKanaal, MailVerzendFout } from './mail-kanaal';
import { stelUitnodigingSamen } from './uitnodiging-bericht';

/**
 * Verstuurt de uitnodigingen van een ronde.
 *
 * ── De kernvraag: wat als er één van de vijf faalt? ─────────────────────────
 *
 * Niet alles terugdraaien. De tokens staan dan al in de database en zijn
 * geldig; ze weggooien omdat een mailserver hikte, betekent dat vier
 * leveranciers die de uitnodiging wél kregen op een dode link klikken.
 *
 * Niet stil doorgaan ook. Dat is precies de faalvorm die dit project elders
 * bestrijdt: de beheerder ziet "verstuurd", en dat één leverancier niets kreeg
 * blijkt pas als de deadline verstrijkt.
 *
 * Dus: **doorgaan met de rest, en per deelnemer teruggeven wat er gebeurd is.**
 * De aanroeper krijgt een lijst waarin elke uitnodiging ofwel een providerId
 * heeft ofwel een foutmelding. Het scherm kan dan tonen "4 verstuurd, 1
 * mislukt" met de reden erbij, en de beheerder kan gericht ingrijpen.
 *
 * Dat is dezelfde keuze als in `backup-controle.js`, waar elk probleem apart
 * gemeld wordt in plaats van bij de eerste te stoppen.
 *
 * ── Waarom dit niet in de transactie zit ────────────────────────────────────
 *
 * `RondeBeheerService.uitnodigen()` maakt de tokens in één transactie: faalt
 * één invoeging, dan rolt alles terug. Mail versturen hoort daar niet in.
 *
 * Een verstuurde mail is niet terug te draaien. Zou de verzending binnen de
 * transactie zitten en de laatste invoeging faalt, dan zijn de tokens weg maar
 * de uitnodigingen verstuurd — leveranciers met een link naar niets. Eerst
 * vastleggen, dan versturen, is de enige volgorde die dat uitsluit.
 *
 * Zie docs/superpowers/specs/2026-08-06-mailkanaal.md
 */

export interface TeVersturenUitnodiging {
  readonly responseId: string;
  readonly vendorNaam: string;
  /** Kan ontbreken: niet elke leverancier heeft een contactpersoon met adres. */
  readonly ontvanger?: string;
  readonly link: string;
  readonly verlooptOp: string;
}

export interface VerzendUitkomst {
  readonly responseId: string;
  readonly vendorNaam: string;
  readonly ontvanger?: string;
  /** Waar of de mail bij de provider is aangenomen. */
  readonly verstuurd: boolean;
  /** Alleen bij succes: de sleutel voor een latere statusmelding. */
  readonly providerId?: string;
  /** Alleen bij mislukking: wat er misging, in lezersvorm. */
  readonly fout?: string;
  /** Alleen bij mislukking: of opnieuw proberen zin heeft. */
  readonly tijdelijk?: boolean;
}

@Injectable()
export class UitnodigingVerzender {
  private readonly logger = new Logger(UitnodigingVerzender.name);

  constructor(private readonly mail: MailKanaal) {}

  async verstuurAllemaal(
    uitnodigingen: readonly TeVersturenUitnodiging[],
    context: {
      tenantNaam: string;
      vragenlijstNaam: string;
      antwoordAan?: string;
    },
  ): Promise<VerzendUitkomst[]> {
    const uitkomsten: VerzendUitkomst[] = [];

    // Bewust één voor één en niet met Promise.all: bij de daglimiet van Resend
    // (100 per dag, ontwerp §3b) levert parallel versturen een onvoorspelbaar
    // deel geweigerde berichten op. Serieel blijft de volgorde bepaald, en dan
    // weet je precies vanaf welke leverancier het misging.
    for (const uitnodiging of uitnodigingen) {
      uitkomsten.push(await this.verstuurEen(uitnodiging, context));
    }

    const mislukt = uitkomsten.filter((u) => !u.verstuurd).length;

    if (mislukt > 0) {
      this.logger.warn(
        `${uitkomsten.length - mislukt} van de ${uitkomsten.length} uitnodigingen verstuurd; ${mislukt} mislukt.`,
      );
    } else {
      this.logger.log(`${uitkomsten.length} uitnodiging(en) verstuurd.`);
    }

    return uitkomsten;
  }

  private async verstuurEen(
    uitnodiging: TeVersturenUitnodiging,
    context: {
      tenantNaam: string;
      vragenlijstNaam: string;
      antwoordAan?: string;
    },
  ): Promise<VerzendUitkomst> {
    const basis = {
      responseId: uitnodiging.responseId,
      vendorNaam: uitnodiging.vendorNaam,
      ontvanger: uitnodiging.ontvanger,
    };

    // Geen contactpersoon met e-mailadres. Dat is geen technische fout maar
    // ontbrekende stamdata, en het hoort net zo zichtbaar te zijn als een
    // geweigerde verzending — anders is de leverancier stilzwijgend overgeslagen.
    if (!uitnodiging.ontvanger) {
      return {
        ...basis,
        verstuurd: false,
        fout: 'Geen e-mailadres bekend bij deze leverancier.',
        tijdelijk: false,
      };
    }

    try {
      const { providerId } = await this.mail.verstuur(
        stelUitnodigingSamen({
          ontvanger: uitnodiging.ontvanger,
          vendorNaam: uitnodiging.vendorNaam,
          tenantNaam: context.tenantNaam,
          vragenlijstNaam: context.vragenlijstNaam,
          link: uitnodiging.link,
          verlooptOp: uitnodiging.verlooptOp,
          antwoordAan: context.antwoordAan,
        }),
      );

      return { ...basis, verstuurd: true, providerId };
    } catch (err) {
      const fout = err instanceof MailVerzendFout;

      // Het adres staat bewust niet in de logregel — MCM2-CLAUDE.md §6.
      this.logger.error(
        `Uitnodiging voor ${uitnodiging.vendorNaam} niet verstuurd: ` +
          (err instanceof Error ? err.message : 'onbekende fout'),
      );

      return {
        ...basis,
        verstuurd: false,
        fout:
          err instanceof Error ? err.message : 'Onbekende fout bij versturen.',
        tijdelijk: fout ? err.tijdelijk : false,
      };
    }
  }
}
