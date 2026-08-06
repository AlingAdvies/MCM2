import { Logger, Module } from '@nestjs/common';

import { LogMailKanaal } from './log-mail-kanaal';
import { MailKanaal } from './mail-kanaal';
import { leesMailConfig } from './mail.config';
import { ResendMailKanaal } from './resend-mail-kanaal';

/**
 * Het mailkanaal, met een keuze op basis van configuratie.
 *
 * ── Waarom een factory en niet gewoon een klasse als provider ───────────────
 *
 * De aanroeper vraagt om `MailKanaal` en krijgt wat hier gekozen is. Zonder die
 * indirectie zou elke service een concrete implementatie importeren, en dan is
 * de knip uit `mail-kanaal.ts` er wel op papier maar niet in de praktijk —
 * precies de situatie die de wissel van M365 naar Resend duur zou maken.
 *
 * ── De keuze ────────────────────────────────────────────────────────────────
 *
 *   sleutel + afzenderadres ingesteld  → ResendMailKanaal, er gaat echt mail uit
 *   geen van beide ingesteld           → LogMailKanaal, er gaat aantoonbaar niets uit
 *   één van beide ingesteld            → opstarten faalt (zie mail.config.ts)
 *
 * Dezelfde vorm als `scripts/telegram.js`: ontbrekende configuratie is een
 * no-op met een logregel, geen crash. Zo blijft MCM2 bruikbaar in CI, in de
 * demo, en op een machine zonder sleutel.
 *
 * ── De opstartregel is geen decoratie ───────────────────────────────────────
 *
 * Bij het kiezen wordt gelogd wát er gekozen is en vanaf welk adres. Het
 * verschil tussen "er gaat mail uit" en "er gaat niets uit" mag niet af te
 * leiden zijn uit het uitblijven van klachten — dat is dezelfde stille faalvorm
 * als de backup die vier dagen stillag (Issue #86, STATUS.md).
 *
 * Zie docs/superpowers/specs/2026-08-06-mailkanaal.md §5 en §9.
 */
@Module({
  providers: [
    LogMailKanaal,
    {
      provide: MailKanaal,
      inject: [LogMailKanaal],
      useFactory: (log: LogMailKanaal): MailKanaal => {
        const logger = new Logger('MailModule');
        const config = leesMailConfig();

        if (!config) {
          logger.warn(
            'Geen RESEND_API_KEY ingesteld — er wordt GEEN mail verstuurd. ' +
              'Uitnodigingen belanden alleen in het log.',
          );
          return log;
        }

        // De sleutel staat er bewust niet in, het afzenderadres wel: dat is
        // geen geheim en het is precies wat je wilt kunnen controleren.
        logger.log(
          `Mail wordt verstuurd via Resend vanaf ${config.afzenderAdres}.`,
        );
        return new ResendMailKanaal(config);
      },
    },
  ],
  exports: [MailKanaal, LogMailKanaal],
})
export class MailModule {}
