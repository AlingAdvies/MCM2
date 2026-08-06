import { Module } from '@nestjs/common';

import { LogMailKanaal } from './log-mail-kanaal';
import { MailKanaal } from './mail-kanaal';

/**
 * Het mailkanaal, met één implementatie en een expliciete keuze welke.
 *
 * ── Waarom `useClass` en niet gewoon `LogMailKanaal` als provider ───────────
 *
 * De aanroeper vraagt om `MailKanaal` en krijgt wat hier gekozen is. Zonder die
 * indirectie zou elke service `LogMailKanaal` importeren, en dan is de knip uit
 * `mail-kanaal.ts` er wel op papier maar niet in de praktijk — precies de
 * situatie die de wissel van M365 naar Resend duur zou maken.
 *
 * ── De keuze staat nu vast op LogMailKanaal ─────────────────────────────────
 *
 * `ResendMailKanaal` bestaat nog niet: dat is stap 3 uit ontwerp §9 en het
 * wacht op een verzenddomein. Tot die tijd verstuurt MCM2 aantoonbaar niets —
 * en dat is de veilige toestand. Een half werkend mailkanaal dat soms wél
 * verstuurt is erger dan een kanaal dat eerlijk niets doet.
 *
 * Zodra `ResendMailKanaal` er is, wordt dit een keuze op basis van
 * configuratie: een sleutel aanwezig → Resend, geen sleutel → log. Dezelfde
 * vorm als `scripts/telegram.js`, waar ontbrekende configuratie een no-op met
 * logregel oplevert in plaats van een crash.
 *
 * Zie docs/superpowers/specs/2026-08-06-mailkanaal.md §5 en §9.
 */
@Module({
  providers: [
    LogMailKanaal,
    {
      provide: MailKanaal,
      useExisting: LogMailKanaal,
    },
  ],
  exports: [MailKanaal, LogMailKanaal],
})
export class MailModule {}
