import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { isGeldigMailadres } from './mail-adres';
import {
  MailBericht,
  MailKanaal,
  MailVerzendFout,
  VerzendResultaat,
} from './mail-kanaal';

/**
 * Verstuurt niets; schrijft naar het log en onthoudt wat er "verstuurd" is.
 *
 * ── Waarom dit geen testhulpje is maar productiecode ────────────────────────
 *
 * Zonder deze implementatie draaien de tests tegen een echte mailserver, of ze
 * draaien niet. Dat is dezelfde keuze als in `scripts/telegram.js`: ontbreekt de
 * configuratie, dan is versturen een no-op met een logregel in plaats van een
 * crash. Zo blijft het bruikbaar op een machine zonder bot — en hier: in CI,
 * in de demo, en op de laptop van iemand die geen sleutel heeft.
 *
 * Het alternatief — `ResendMailKanaal` met een neppe sleutel — test de
 * netwerklaag van een externe dienst, niet onze code. En het faalt op een
 * vliegtuig.
 *
 * ── De verzendlijst ─────────────────────────────────────────────────────────
 *
 * `verzonden` maakt dit ook bruikbaar als testdubbel: een e2e-test kan straks
 * vaststellen dat een ronde precies vijf uitnodigingen heeft opgeleverd, met de
 * juiste afzendernaam en het juiste `Reply-To`, zonder één byte over het
 * netwerk.
 *
 * Zie docs/superpowers/specs/2026-08-06-mailkanaal.md
 */
@Injectable()
export class LogMailKanaal extends MailKanaal {
  private readonly logger = new Logger(LogMailKanaal.name);
  private readonly berichten: Array<MailBericht & { providerId: string }> = [];

  /**
   * Geeft een Promise terug zonder zelf te wachten — vandaar geen `async`.
   *
   * De interface is asynchroon omdat een echte verzending een netwerkaanroep
   * is. Dat deze implementatie niets hoeft af te wachten, mag de vorm van de
   * grens niet veranderen: zou `verstuur()` hier synchroon zijn, dan werkt code
   * die de Promise negeert wél met dit kanaal en niet met `ResendMailKanaal` —
   * een fout die pas in productie zichtbaar wordt.
   */
  verstuur(bericht: MailBericht): Promise<VerzendResultaat> {
    // Dezelfde controle als de echte implementatie moet doen. Zonder dit zou
    // een ongeldig adres pas in productie opvallen — en dan is de testdubbel
    // toegeeflijker dan het echte kanaal, wat de tests waardeloos maakt.
    if (!isGeldigMailadres(bericht.aan)) {
      return Promise.reject(
        new MailVerzendFout(`Ongeldig ontvangeradres: ${bericht.aan}`, false),
      );
    }

    const providerId = `log-${randomUUID()}`;
    this.berichten.push({ ...bericht, providerId });

    // Het adres staat er bewust in: dit kanaal draait alleen lokaal en in
    // tests, en juist daar wil je kunnen zien wáár de uitnodiging heen zou
    // gaan. In productie draait `ResendMailKanaal`, en daar geldt de
    // maskering uit `maskerende-logger.ts`.
    this.logger.log(
      `[niet echt verstuurd] aan=${bericht.aan} ` +
        `afzender="${bericht.afzenderNaam}" ` +
        `antwoordAan=${bericht.antwoordAan ?? '(geen)'} ` +
        `onderwerp="${bericht.onderwerp}"`,
    );

    return Promise.resolve({ providerId });
  }

  /** Alles wat dit kanaal heeft "verstuurd", in volgorde. */
  get verzonden(): ReadonlyArray<MailBericht & { providerId: string }> {
    return this.berichten;
  }

  /** Het laatste bericht, of `undefined` als er niets verstuurd is. */
  get laatste(): (MailBericht & { providerId: string }) | undefined {
    return this.berichten.at(-1);
  }

  /** Leegt de lijst. Voor `beforeEach()` in tests. */
  leeg(): void {
    this.berichten.length = 0;
  }
}
