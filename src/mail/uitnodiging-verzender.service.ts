import { Injectable, Logger } from '@nestjs/common';

import {
  stelBeheerderUitnodigingSamen,
  type BeheerderUitnodigingGegevens,
} from './beheerder-uitnodiging-bericht';
import { MailKanaal, MailVerzendFout } from './mail-kanaal';
import {
  stelTenantLidUitnodigingSamen,
  type TenantLidUitnodigingGegevens,
} from './tenant-lid-uitnodiging-bericht';
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
  /**
   * Waar of de verzending is gelukt — dus: er is niets misgegaan.
   *
   * Let op het verschil met `echtVerstuurd`. Draait het logkanaal, dan is dit
   * `true` en `echtVerstuurd` `false`: er is niets fout gegaan, maar er is ook
   * niets aangekomen. Wie een mens iets wil melden moet naar `echtVerstuurd`
   * kijken; wie wil weten of er ingegrepen moet worden, naar `fout`.
   */
  readonly verstuurd: boolean;
  /**
   * Waar of er werkelijk mail is uitgegaan (Issue #131).
   *
   * `false` bij het logkanaal — dan is er geen sleutel ingesteld en belandt de
   * uitnodiging alleen in het log. De link moet dan met de hand doorgegeven
   * worden, en dat moet de aanroeper kunnen zien zonder het log te lezen.
   */
  readonly echtVerstuurd: boolean;
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

    // "verstuurd" alleen zeggen als er ook werkelijk iets uit is gegaan
    // (Issue #131). Zonder mailkanaal was deze regel de laatste plek waar het
    // nog geruststellend klonk.
    //
    // De toets is *geslaagd maar niet echt verstuurd*, niet simpelweg "nul
    // echte verzendingen". Dat laatste is óók waar als álles mislukte, en dan
    // wijst deze regel de lezer naar een ontbrekend mailkanaal terwijl de
    // provider gewoon weigerde — dezelfde soort misleiding als de fout die
    // deze wijziging repareert.
    const geslaagdMaarStil = uitkomsten.some(
      (u) => u.verstuurd && !u.echtVerstuurd,
    );
    const staart = geslaagdMaarStil
      ? ' Let op: er is geen mailkanaal ingesteld, er ging niets de deur uit.'
      : '';

    if (mislukt > 0) {
      this.logger.warn(
        `${uitkomsten.length - mislukt} van de ${uitkomsten.length} uitnodigingen verstuurd; ${mislukt} mislukt.${staart}`,
      );
    } else {
      this.logger.log(
        `${uitkomsten.length} uitnodiging(en) verstuurd.${staart}`,
      );
    }

    return uitkomsten;
  }

  /**
   * Verstuurt de uitnodiging aan de eerste beheerder van een nieuwe tenant.
   *
   * Anders dan `verstuurAllemaal()` is dit er altijd precies één, en is de
   * uitkomst rechtstreeks van belang voor de aanroeper: mislukt hij, dan moet
   * de platformbeheerder de link met de hand doorgeven. Vandaar één
   * `VerzendUitkomst` in plaats van een lijst.
   *
   * Werpt niet. Een tenant die is aangemaakt blijft aangemaakt, ook als de mail
   * strandt — hem alsnog laten falen zou betekenen dat een hikkende mailserver
   * een geslaagde databasehandeling ongedaan lijkt te maken, terwijl hij dat
   * niet is.
   */
  async verstuurAanBeheerder(gegevens: BeheerderUitnodigingGegevens): Promise<{
    verstuurd: boolean;
    echtVerstuurd: boolean;
    providerId?: string;
    fout?: string;
    tijdelijk?: boolean;
  }> {
    try {
      const { providerId, echtVerstuurd } = await this.mail.verstuur(
        stelBeheerderUitnodigingSamen(gegevens),
      );

      // De logregel zegt nu wát er gebeurd is. Vóór Issue #131 stond hier
      // "verstuurd" ook als het logkanaal draaide — en dat is precies de
      // geruststellende melding waar het misging.
      this.logger.log(
        echtVerstuurd
          ? `Uitnodiging voor de beheerder van ${gegevens.tenantNaam} verstuurd.`
          : `Uitnodiging voor de beheerder van ${gegevens.tenantNaam} NIET verstuurd: ` +
              'er is geen mailkanaal ingesteld. Geef de link handmatig door.',
      );

      return { verstuurd: true, echtVerstuurd, providerId };
    } catch (err) {
      const fout = err instanceof MailVerzendFout;

      // Het adres staat bewust niet in de logregel — MCM2-CLAUDE.md §6.
      this.logger.error(
        `Uitnodiging voor de beheerder van ${gegevens.tenantNaam} niet verstuurd: ` +
          (err instanceof Error ? err.message : 'onbekende fout'),
      );

      return {
        verstuurd: false,
        echtVerstuurd: false,
        fout:
          err instanceof Error ? err.message : 'Onbekende fout bij versturen.',
        tijdelijk: fout ? err.tijdelijk : false,
      };
    }
  }

  /**
   * Verstuurt de uitnodiging waarmee een tenant-admin een collega uitnodigt
   * voor zijn eigen tenant (issue #75). Zelfde patroon en zelfde
   * echtVerstuurd/verstuurd-onderscheid als `verstuurAanBeheerder` hierboven
   * (Issue #131).
   */
  async verstuurAanTenantLid(gegevens: TenantLidUitnodigingGegevens): Promise<{
    verstuurd: boolean;
    echtVerstuurd: boolean;
    providerId?: string;
    fout?: string;
    tijdelijk?: boolean;
  }> {
    try {
      const { providerId, echtVerstuurd } = await this.mail.verstuur(
        stelTenantLidUitnodigingSamen(gegevens),
      );

      this.logger.log(
        echtVerstuurd
          ? `Uitnodiging voor een lid van ${gegevens.tenantNaam} verstuurd.`
          : `Uitnodiging voor een lid van ${gegevens.tenantNaam} NIET verstuurd: ` +
              'er is geen mailkanaal ingesteld. Geef de link handmatig door.',
      );

      return { verstuurd: true, echtVerstuurd, providerId };
    } catch (err) {
      const fout = err instanceof MailVerzendFout;

      // Het adres staat bewust niet in de logregel — MCM2-CLAUDE.md §6.
      this.logger.error(
        `Uitnodiging voor een lid van ${gegevens.tenantNaam} niet verstuurd: ` +
          (err instanceof Error ? err.message : 'onbekende fout'),
      );

      return {
        verstuurd: false,
        echtVerstuurd: false,
        fout:
          err instanceof Error ? err.message : 'Onbekende fout bij versturen.',
        tijdelijk: fout ? err.tijdelijk : false,
      };
    }
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
        echtVerstuurd: false,
        fout: 'Geen e-mailadres bekend bij deze leverancier.',
        tijdelijk: false,
      };
    }

    try {
      const { providerId, echtVerstuurd } = await this.mail.verstuur(
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

      return { ...basis, verstuurd: true, echtVerstuurd, providerId };
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
        echtVerstuurd: false,
        fout:
          err instanceof Error ? err.message : 'Onbekende fout bij versturen.',
        tijdelijk: fout ? err.tijdelijk : false,
      };
    }
  }
}
