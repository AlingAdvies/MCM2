import { Injectable, Logger } from '@nestjs/common';

import { DatabaseService } from '../db/database.service';
import { valideerConcept } from './antwoord-validatie';
import type { AntwoordFout } from './antwoord-validatie';
import { schrijfAntwoorden } from './antwoord-wegschrijven';
import { haalVragen, naarValidatievraag, telBestanden } from './vraag-opzoeken';

/**
 * Uitkomst van een poging tot concept opslaan. Bepaalt de HTTP-status.
 *
 * Geen `'ingediend'`-variant: dat is precies het punt van een concept — er
 * verandert niets aan de status van de response. `'niet-meer-open'` dekt
 * hetzelfde als bij indienen (al ingediend, verlopen, ronde gesloten), al
 * komt die uitkomst hier in de praktijk zelden voor: `SurveyTokenGuard` heeft
 * die gevallen meestal al afgevangen vóórdat deze service iets probeert. De
 * RLS-policy op `survey_answer` (migratie 0005) is de laatste horde — een
 * bug die de guard passeert, kan hier alsnog niet schrijven.
 */
export type ConceptUitkomst =
  | { status: 'opgeslagen' }
  | { status: 'ongeldig'; fouten: AntwoordFout[] }
  | { status: 'niet-meer-open' };

/**
 * Slaat een gedeeltelijke set antwoorden op vóórdat de leverancier indient
 * (vragenlijst-ontwerp §7, "Concept opslaan — expliciet, niet automatisch").
 *
 * Acht vragen met verplichte toelichtingen vul je niet in één sessie. Zonder
 * dit pad verliest iemand die tussentijds stopt alles, onherstelbaar: het
 * token is gehasht en dus niet opnieuw te versturen, en de tokentermijn (30
 * dagen, `GELDIGHEID_DAGEN`) is het enige venster dat er is — er bestaat geen
 * apart "tijd om te openen" versus "tijd om in te dienen".
 *
 * Bewust géén auto-save: de leverancier roept dit expliciet aan, met een
 * eigen knop. Zie ontwerp §1b — dat scheelt debounce-logica en houdt het
 * aantal schrijfacties laag, en het is een bestaand besluit van de
 * opdrachtgever, niet een keuze van deze implementatie.
 *
 * Bewust géén auditregel: dit is geen bewijsmoment zoals indienen, en
 * `updated_at` op de antwoordrijen zelf legt al vast wanneer er voor het
 * laatst opgeslagen is. Een auditregel per tussentijdse opslag zou de trail
 * vullen met iets dat geen mutatie van betekenis is.
 */
@Injectable()
export class AntwoordConceptService {
  private readonly logger = new Logger(AntwoordConceptService.name);

  constructor(private readonly db: DatabaseService) {}

  async bewaar(
    tenantId: string,
    responseId: string,
    invoer: unknown,
  ): Promise<ConceptUitkomst> {
    return this.db.withTenant<ConceptUitkomst>(
      tenantId,
      async (tx) => {
        const vragen = await haalVragen(tx, responseId);

        if (vragen.length === 0) {
          return { status: 'niet-meer-open' };
        }

        const bestanden = await telBestanden(tx, responseId);

        const uitkomst = valideerConcept(
          vragen.map(naarValidatievraag),
          invoer,
          bestanden,
        );

        if (!uitkomst.geldig) {
          return { status: 'ongeldig', fouten: uitkomst.fouten };
        }

        // Niets te bewaren is geen fout — een leverancier die op "opslaan"
        // klikt zonder iets ingevuld te hebben, krijgt gewoon een bevestiging
        // dat er (terecht) niets is weggeschreven.
        if (uitkomst.antwoorden.length > 0) {
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
        }

        this.logger.log(
          `Concept opgeslagen voor response ${responseId}: ${uitkomst.antwoorden.length} antwoorden.`,
        );

        return { status: 'opgeslagen' };
      },
      'leverancier',
    );
  }
}
