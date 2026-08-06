import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

import { isGeldigMailadres } from './mail-adres';
import {
  MailBericht,
  MailKanaal,
  MailVerzendFout,
  VerzendResultaat,
} from './mail-kanaal';
import type { MailConfig } from './mail.config';

/**
 * Verstuurt via Resend — de platformverstuurder uit ontwerp §1.
 *
 * ── De afzenderconstructie ──────────────────────────────────────────────────
 *
 * Wat een leverancier ziet:
 *
 *   Van:      Transdev via MCM2 <uitvraag@mcm2mail.nl>
 *   Reply-To: contractmanagement@transdev.nl
 *
 * De klantnaam zit in de display name, het adres blijft van het platform. Zo is
 * de klant herkenbaar (Issue #13) zonder dat we zijn domein nodig hebben — en
 * het adres zegt de waarheid over wie er verstuurt. `Reply-To` zorgt dat
 * antwoorden bij de klant terechtkomen; wij kunnen ze toch niet beantwoorden.
 *
 * ── Waarom foutafhandeling hier het echte werk is ───────────────────────────
 *
 * Resend werpt niet, maar geeft `{ data, error }` terug. Wie alleen naar `data`
 * kijkt, mist elke fout — en dat is precies de stille faalvorm die dit project
 * elders bestrijdt. Vandaar dat elke uitkomst hier expliciet wordt vertaald
 * naar ofwel een `providerId` ofwel een `MailVerzendFout`.
 *
 * Het gratis plan stopt hard bij 100 mails per dag zonder iets bij te rekenen.
 * Bij een bulkronde van vijfhonderd worden er vierhonderd geweigerd, en dat mag
 * niet als "verstuurd" in de ronde belanden (ontwerp §3b, tegenproef 6).
 *
 * Zie docs/superpowers/specs/2026-08-06-mailkanaal.md
 */

/**
 * Foutcodes waarbij opnieuw proberen zin heeft.
 *
 * De quota-fouten staan hier bewust bij: die lossen zichzelf op als de dag- of
 * maandgrens verstrijkt. Dat maakt ze *tijdelijk*, maar niet onschuldig — de
 * aanroeper moet ze nog steeds als mislukt vastleggen, want zonder ingrijpen
 * krijgt die leverancier vandaag geen uitnodiging.
 */
const TIJDELIJK = new Set([
  'rate_limit_exceeded',
  'daily_quota_exceeded',
  'monthly_quota_exceeded',
  'internal_server_error',
  'application_error',
  'concurrent_idempotent_requests',
]);

@Injectable()
export class ResendMailKanaal extends MailKanaal {
  private readonly logger = new Logger(ResendMailKanaal.name);
  private readonly resend: Resend;

  constructor(private readonly config: MailConfig) {
    super();
    this.resend = new Resend(config.apiSleutel);
  }

  async verstuur(bericht: MailBericht): Promise<VerzendResultaat> {
    if (!isGeldigMailadres(bericht.aan)) {
      throw new MailVerzendFout(
        `Ongeldig ontvangeradres: ${bericht.aan}`,
        false,
      );
    }

    const { data, error } = await this.resend.emails.send({
      from: this.afzender(bericht.afzenderNaam),
      to: bericht.aan,
      subject: bericht.onderwerp,
      text: bericht.tekst,
      // Alleen meesturen als de tenant het heeft ingevuld. Een lege replyTo
      // levert bij Resend een validatiefout op, en dan gaat er niets uit omdat
      // één instelling ontbreekt.
      ...(bericht.antwoordAan ? { replyTo: bericht.antwoordAan } : {}),
    });

    if (error) {
      const tijdelijk = TIJDELIJK.has(error.name);

      // Het adres staat er bewust niet in: dit draait in productie en een
      // logregel is de klassieke plek waar persoonsgegevens weglekken.
      // MCM2-CLAUDE.md §6 en `maskerende-logger.ts`.
      this.logger.error(
        `Verzenden mislukt (${error.name}${tijdelijk ? ', tijdelijk' : ''}).`,
      );

      throw new MailVerzendFout(
        `Resend weigerde de verzending: ${error.name} — ${error.message}`,
        tijdelijk,
        error,
      );
    }

    // Kan in theorie niet samen met een lege `error`, maar de types van de SDK
    // staan het toe. Zonder providerId is een latere bounce niet te koppelen
    // (ontwerp §4), dus stil doorgaan zou een gat in de keten opleveren dat pas
    // weken later opvalt.
    if (!data?.id) {
      throw new MailVerzendFout(
        'Resend gaf geen bericht-id terug; de verzending is niet te volgen.',
        true,
      );
    }

    return { providerId: data.id };
  }

  /**
   * Bouwt `Naam <adres>`.
   *
   * De display name wordt tussen aanhalingstekens gezet en interne
   * aanhalingstekens worden verwijderd. Zonder dat kan een tenantnaam met een
   * `"` of een `<` erin de header breken — of erger, een tweede adres
   * binnensmokkelen. De naam komt uit de database en is dus door een
   * tenantbeheerder in te vullen; hem hier niet vertrouwen is de goedkoopste
   * plek om dat af te vangen.
   */
  private afzender(naam: string): string {
    const schoon = naam.replace(/["\r\n<>]/g, '').trim();

    return schoon.length > 0
      ? `"${schoon}" <${this.config.afzenderAdres}>`
      : this.config.afzenderAdres;
  }
}
