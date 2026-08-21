import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';
import { SurveyAuditService } from './survey-audit.service';
import { valideerAntwoorden } from './antwoord-validatie';
import type { AntwoordFout } from './antwoord-validatie';
import { schrijfAntwoorden } from './antwoord-wegschrijven';
import { haalVragen, naarValidatievraag, telBestanden } from './vraag-opzoeken';

/** Waarom een indiening niet is doorgegaan. Bepaalt de HTTP-status. */
export type IndienUitkomst =
  | { status: 'ingediend' }
  | { status: 'ongeldig'; fouten: AntwoordFout[] }
  | { status: 'niet-meer-open' };

/**
 * Neemt een volledige indiening aan: valideren, wegschrijven, afsluiten.
 *
 * De volgorde uit ontwerp §5 is niet vrijblijvend. **Eerst alles valideren, dan
 * pas de status op `submitted` zetten.** Faalt de validatie halverwege, dan mag
 * de response niet half ingediend achterblijven — de link is dan verbruikt
 * terwijl er niets bruikbaars staat, en dat is onherstelbaar omdat het token
 * gehasht is en niet opnieuw te versturen.
 *
 * Alles gebeurt in één transactie: antwoorden, statuswijziging en auditregel.
 * Faalt er iets, dan blijft de link gewoon werken.
 */
@Injectable()
export class AntwoordIndienService {
  private readonly logger = new Logger(AntwoordIndienService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: SurveyAuditService,
  ) {}

  async dienIn(
    tenantId: string,
    responseId: string,
    invoer: unknown,
  ): Promise<IndienUitkomst> {
    return this.db
      .withTenant<IndienUitkomst>(
        tenantId,
        async (tx) => {
          const vragen = await haalVragen(tx, responseId);

          // Geen vragen betekent: er valt niets in te dienen. Behandeld als
          // "niet meer open" in plaats van als lege geldige indiening — anders
          // zou een lege template een response kunnen afsluiten zonder inhoud.
          if (vragen.length === 0) {
            return { status: 'niet-meer-open' };
          }

          const bestanden = await telBestanden(tx, responseId);

          const uitkomst = valideerAntwoorden(
            vragen.map(naarValidatievraag),
            invoer,
            bestanden,
          );

          if (!uitkomst.geldig) {
            // Bewust vóór elke schrijfactie. De transactie heeft nog niets
            // gewijzigd, dus er valt niets terug te draaien en de link blijft
            // bruikbaar (testpunt 25).
            return { status: 'ongeldig', fouten: uitkomst.fouten };
          }

          const idPerSleutel = new Map(
            vragen.map((v) => [v.question_key, v.question_id]),
          );

          await schrijfAntwoorden(
            tx,
            tenantId,
            responseId,
            uitkomst.antwoorden,
            idPerSleutel,
          );

          // Pas hierna afsluiten. Eén atomair statement met de status als
          // voorwaarde, net als in SurveyTokenService.dienIn(): de database
          // beslist wie wint bij gelijktijdige verzoeken, niet de volgorde waarin
          // ze toevallig aankomen.
          const afgesloten = await tx.execute<{ response_id: string }>(
            sql`UPDATE clm.survey_response AS r
               SET status = 'submitted', submitted_at = now()
             WHERE r.response_id = ${responseId}
               AND r.status = 'pending'
               AND r.expires_at > now()
               AND EXISTS (
                     SELECT 1 FROM clm.survey_run run
                      WHERE run.run_id = r.run_id
                        AND run.status = 'active'
                   )
         RETURNING r.response_id`,
          );

          if (afgesloten.rows.length !== 1) {
            // Iemand was eerder, of de ronde is inmiddels dicht. De transactie
            // rolt terug door de fout hieronder niet te gooien maar de uitkomst
            // te melden — Drizzle commit anders de zojuist geschreven antwoorden.
            throw new NietMeerOpenError();
          }

          await this.audit.leg(tx, {
            tenantId,
            actie: 'survey_response_ingediend',
            responseId,
            details: { aantalAntwoorden: uitkomst.antwoorden.length },
          });

          this.logger.log(
            `Response ${responseId} ingediend met ${uitkomst.antwoorden.length} antwoorden.`,
          );

          return { status: 'ingediend' };
        },
        'leverancier',
      )
      .catch((fout: unknown) => {
        // NietMeerOpenError is geen storing maar het verwachte gedrag bij een
        // tweede poging. Door hem als fout te gooien rolt de transactie terug;
        // hier wordt hij weer een gewone uitkomst.
        if (fout instanceof NietMeerOpenError) {
          this.logger.warn(
            `Indienen geweigerd voor response ${responseId}: al ingediend, verlopen of ronde gesloten.`,
          );
          return { status: 'niet-meer-open' };
        }
        throw fout;
      });
  }
}

/**
 * Intern signaal dat de response niet meer openstond.
 *
 * Als fout gegooid en niet als returnwaarde, omdat alleen een fout de
 * transactie terugdraait. Zonder dat zouden de zojuist geschreven antwoorden
 * blijven staan bij een response die iemand anders al had ingediend.
 */
class NietMeerOpenError extends Error {
  constructor() {
    super('De response stond niet meer open.');
    this.name = 'NietMeerOpenError';
  }
}
