import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';

/**
 * Notities bij een inzending, voor collega's onderling (migratie 0018).
 *
 * ── Een notitie is geen oordeel ─────────────────────────────────────────────
 *
 * "Gebeld, komt volgende week" past in geen van de vier verdicts. Daarom een
 * eigen tabel: een notitie raakt de status van de inzending niet, een oordeel
 * wel. Zaten ze in één tabel, dan zou elke statusquery de notities eruit
 * moeten filteren — en die filter vergeten is een stille fout.
 *
 * ── Mag ook vóór het indienen ───────────────────────────────────────────────
 *
 * Anders dan bij beoordelen (besluit eigenaar 2026-08-07). "Gebeld, komt
 * volgende week" gaat juist over een leverancier die nog niét heeft ingediend;
 * de regel van BeoordelingService zou hier het meest bruikbare geval
 * uitsluiten.
 *
 * ── Wie en wanneer horen erbij ──────────────────────────────────────────────
 *
 * De datum staat in de tabel én in het antwoord, samen met de naam van de
 * schrijver. Een notitie zonder afzender en tijdstip is in een dossier
 * waardeloos: "gebeld" — door wie, en hoe lang geleden?
 */

export interface Notitie {
  noteId: string;
  responseId: string;
  tekst: string;
  authorUserId: string;
  /** Null wanneer de gebruiker geen naam heeft — dan toont het scherm het adres. */
  authorNaam: string | null;
  /** Wanneer de notitie is geschreven. ISO-8601, altijd gevuld. */
  createdAt: string;
}

interface NotitieRij extends Record<string, unknown> {
  note_id: string;
  response_id: string;
  tekst: string;
  author_user_id: string;
  author_naam: string | null;
  created_at: Date | string;
}

function iso(waarde: Date | string | null): string | null {
  if (waarde === null) return null;
  return waarde instanceof Date ? waarde.toISOString() : String(waarde);
}

@Injectable()
export class NotitieService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Alle notities bij één respons, nieuwste eerst.
   *
   * Ingetrokken notities blijven buiten beschouwing maar staan nog in de
   * database — wissen zou de historie kapotmaken die deze tabel bewaart.
   */
  async lijst(tenantId: string, responseId: string): Promise<Notitie[]> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        await this.eisBestaandeRespons(tx, responseId);

        const resultaat = await tx.execute<NotitieRij>(
          sql`SELECT n.note_id,
                     n.response_id,
                     n.tekst,
                     n.author_user_id,
                     u.full_name AS author_naam,
                     n.created_at
                FROM clm.response_note n
                LEFT JOIN clm."user" u ON u.user_id = n.author_user_id
               WHERE n.response_id = ${responseId}
                 AND n.deleted_at IS NULL
               ORDER BY n.created_at DESC`,
        );

        return resultaat.rows.map((r) => this.naarNotitie(r));
      },
      'medewerker',
    );
  }

  /**
   * Voegt een notitie toe.
   *
   * De schrijver komt uit de sessie, nooit uit de invoer — dezelfde regel als
   * bij een oordeel (MCM2-CLAUDE.md §6). Anders kan iemand een notitie op naam
   * van een collega achterlaten.
   */
  async voegToe(
    tenantId: string,
    responseId: string,
    authorUserId: string,
    tekst: string,
  ): Promise<Notitie> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        await this.eisBestaandeRespons(tx, responseId);

        const resultaat = await tx.execute<NotitieRij>(
          sql`WITH nieuw AS (
                INSERT INTO clm.response_note
                       (tenant_id, response_id, tekst, author_user_id)
                VALUES (${tenantId}, ${responseId}, ${tekst}, ${authorUserId})
                RETURNING note_id, response_id, tekst, author_user_id, created_at
              )
              SELECT n.note_id,
                     n.response_id,
                     n.tekst,
                     n.author_user_id,
                     u.full_name AS author_naam,
                     n.created_at
                FROM nieuw n
                LEFT JOIN clm."user" u ON u.user_id = n.author_user_id`,
        );

        const rij = resultaat.rows[0];
        if (!rij) {
          // Onbereikbaar: de INSERT gaf een rij terug of gooide. Toch
          // expliciet, want stil `undefined` teruggeven zou het scherm een
          // opgeslagen notitie laten tonen die er niet is.
          throw new BadRequestException(
            'De notitie kon niet worden opgeslagen.',
          );
        }

        return this.naarNotitie(rij);
      },
      'medewerker',
    );
  }

  /**
   * Trekt een notitie in.
   *
   * Zet `deleted_at` en verwijdert niets, net als bij een oordeel. De
   * `response_id` in de WHERE is geen overbodige controle: zonder die eis zou
   * een geldig note-id uit een ándere respons van dezelfde tenant hier
   * ingetrokken kunnen worden via een verzonnen pad.
   */
  async trekIn(
    tenantId: string,
    responseId: string,
    noteId: string,
  ): Promise<void> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        await this.eisBestaandeRespons(tx, responseId);

        const geraakt = await tx.execute(
          sql`UPDATE clm.response_note
                 SET deleted_at = now()
               WHERE note_id = ${noteId}
                 AND response_id = ${responseId}
                 AND deleted_at IS NULL`,
        );

        if (geraakt.rowCount === 0) {
          throw new NotFoundException(
            'Deze notitie bestaat niet, of is al ingetrokken.',
          );
        }
      },
      'medewerker',
    );
  }

  private async eisBestaandeRespons(
    tx: Parameters<Parameters<DatabaseService['withTenant']>[1]>[0],
    responseId: string,
  ): Promise<void> {
    const gevonden = await tx.execute(
      sql`SELECT 1 FROM clm.survey_response WHERE response_id = ${responseId}`,
    );

    if (gevonden.rows.length === 0) {
      throw new NotFoundException('Deze respons bestaat niet.');
    }
  }

  private naarNotitie(r: NotitieRij): Notitie {
    return {
      noteId: r.note_id,
      responseId: r.response_id,
      tekst: r.tekst,
      authorUserId: r.author_user_id,
      authorNaam: r.author_naam,
      createdAt: iso(r.created_at) ?? '',
    };
  }
}
