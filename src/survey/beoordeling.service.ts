import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';

/**
 * Oordelen over ingediende responses (fase C van
 * docs/superpowers/plans/2026-08-03-surveybeheer.md, §2a).
 *
 * ── Beoordelen is niet UC2 ───────────────────────────────────────────────────
 *
 * UC2 is een tweede vragenlijst met eigen vragen, en die is uitgesteld. Dit is
 * één oordeel over één bestaande respons. Het verschil bepaalt de bouw: UC2
 * vraagt een schermflow, deelnemersbeheer en een scoreberekening; dit vraagt
 * één tabel en twee routes.
 *
 * ── Toevoegen, nooit overschrijven ───────────────────────────────────────────
 *
 * Er is geen update en geen delete. Een herzien oordeel komt eronder te staan,
 * niet eroverheen. Dat is precies waarom een reviewer dit mag zonder admin te
 * zijn (plan §2a): hij kan niets stilletjes wijzigen, alleen iets toevoegen dat
 * zichtbaar van hem is. Zonder die historie zou hier admin nodig zijn.
 *
 * ── Wat `nadere_vragen` níét doet ────────────────────────────────────────────
 *
 * Het stuurt de vragenlijst niet terug naar de leverancier (besluit eigenaar
 * 2026-08-03). Het oordeel wordt vastgelegd, de respons blijft dicht, en de
 * beheerder neemt zelf contact op. Terugsturen zou vier bewezen onderdelen
 * raken: de bevriezingstrigger, de SurveyTokenGuard, de verlooplogica en de
 * audittrail.
 *
 * De leverancier merkt hier dus niets van. Het scherm moet dat zeggen — een
 * knop die suggereert dat er iets verstuurd wordt terwijl dat niet gebeurt, is
 * erger dan geen knop.
 */

/**
 * De vier toegestane oordelen. Gelijk aan de CHECK uit migratie 0017.
 *
 * De eerste drie zijn inhoudelijk: wat vindt de beoordelaar van de inzending.
 * `goedgekeurd` is een processtap die de inzending afsluit — dezelfde vorm
 * (naam, datum, nooit overschreven), maar een andere betekenis. Het scherm zet
 * ze daarom niet als vier gelijkwaardige knoppen naast elkaar.
 */
export const OORDELEN = [
  'goed',
  'nadere_vragen',
  'niet_goed',
  'goedgekeurd',
] as const;
export type Oordeel = (typeof OORDELEN)[number];

/**
 * Oordelen die een onderbouwing vereisen.
 *
 * `goed` en `goedgekeurd` niet: bij een goedkeuring is de handtekening de
 * inhoud — wie en wanneer, en dat legt de tabel zelf vast. De eis bestaat
 * omdat "niet goed" zonder reden later niet te herleiden is.
 */
export const OORDELEN_MET_TOELICHTING: readonly Oordeel[] = [
  'nadere_vragen',
  'niet_goed',
];

export interface NieuweBeoordeling {
  verdict: Oordeel;
  toelichting: string;
}

export interface Beoordeling {
  reviewId: string;
  responseId: string;
  verdict: string;
  toelichting: string;
  reviewerUserId: string;
  /** Null wanneer de gebruiker geen naam heeft — dan toont het scherm het adres. */
  reviewerNaam: string | null;
  createdAt: string;
}

interface BeoordelingRij extends Record<string, unknown> {
  review_id: string;
  response_id: string;
  verdict: string;
  toelichting: string;
  reviewer_user_id: string;
  reviewer_naam: string | null;
  created_at: Date | string;
}

function iso(waarde: Date | string | null): string | null {
  if (waarde === null) return null;
  return waarde instanceof Date ? waarde.toISOString() : String(waarde);
}

@Injectable()
export class BeoordelingService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Alle oordelen over één respons, nieuwste eerst.
   *
   * Ingetrokken oordelen (`deleted_at`) blijven buiten beschouwing, maar staan
   * nog wel in de database — wissen zou de historie kapotmaken die deze tabel
   * juist bewaart.
   */
  async lijst(tenantId: string, responseId: string): Promise<Beoordeling[]> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        await this.eisBestaandeRespons(tx, responseId);

        const resultaat = await tx.execute<BeoordelingRij>(
          sql`SELECT r.review_id,
                     r.response_id,
                     r.verdict,
                     r.toelichting,
                     r.reviewer_user_id,
                     u.full_name AS reviewer_naam,
                     r.created_at
                FROM clm.survey_review r
                LEFT JOIN clm."user" u ON u.user_id = r.reviewer_user_id
               WHERE r.response_id = ${responseId}
                 AND r.deleted_at IS NULL
               ORDER BY r.created_at DESC`,
        );

        return resultaat.rows.map((r) => this.naarBeoordeling(r));
      },
      'medewerker',
    );
  }

  /**
   * Legt een nieuw oordeel vast.
   *
   * ── Alleen op een ingediende respons ──────────────────────────────────────
   *
   * Bewust een controle hier en geen CHECK-constraint: de melding moet
   * uitleggen wáárom het niet kan ("deze leverancier heeft nog niet
   * ingediend"), en een constraint levert alleen een constraintnaam op.
   *
   * ── De reviewer komt uit de sessie, nooit uit de invoer ───────────────────
   *
   * Zou `reviewerUserId` uit de request komen, dan kan iemand een oordeel op
   * naam van een collega vastleggen. In een compliance-dossier is dat precies
   * de handtekening die moet kloppen (MCM2-CLAUDE.md §6: de identiteit komt uit
   * de geverifieerde context).
   */
  async voegToe(
    tenantId: string,
    responseId: string,
    reviewerUserId: string,
    invoer: NieuweBeoordeling,
  ): Promise<Beoordeling> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const respons = await this.eisBestaandeRespons(tx, responseId);

        if (!respons.submitted_at) {
          throw new BadRequestException(
            'Deze respons is nog niet ingediend. Er valt pas iets te beoordelen zodra de leverancier heeft ingediend.',
          );
        }

        const resultaat = await tx.execute<BeoordelingRij>(
          sql`WITH nieuw AS (
                INSERT INTO clm.survey_review
                       (tenant_id, response_id, verdict, toelichting, reviewer_user_id)
                VALUES (${tenantId}, ${responseId}, ${invoer.verdict},
                        ${invoer.toelichting}, ${reviewerUserId})
                RETURNING review_id, response_id, verdict, toelichting,
                          reviewer_user_id, created_at
              )
              SELECT n.review_id,
                     n.response_id,
                     n.verdict,
                     n.toelichting,
                     n.reviewer_user_id,
                     u.full_name AS reviewer_naam,
                     n.created_at
                FROM nieuw n
                LEFT JOIN clm."user" u ON u.user_id = n.reviewer_user_id`,
        );

        const rij = resultaat.rows[0];
        if (!rij) {
          // Onbereikbaar in de praktijk: de INSERT gaf een rij terug of gooide.
          // Toch expliciet, want stil `undefined` teruggeven zou het scherm een
          // geslaagde beoordeling laten tonen die er niet is.
          throw new BadRequestException(
            'Het oordeel kon niet worden opgeslagen.',
          );
        }

        return this.naarBeoordeling(rij);
      },
      'medewerker',
    );
  }

  /**
   * Trekt een oordeel in.
   *
   * Zet `deleted_at` en verwijdert niets. De tabel is append-only: wissen zou
   * de historie kapotmaken die deze tabel juist bewaart, en een goedkeuring die
   * spoorloos kan verdampen maakt de status onbetrouwbaar (besluit eigenaar
   * 2026-08-07, V2).
   *
   * Wie mag intrekken is niet beperkt, consequent met beoordelen zelf: elke
   * handeling ligt met naam en datum vast, dus niemand kan iets stilletjes
   * doen. Wél zichtbaar in het scherm dát er is ingetrokken.
   *
   * De `response_id` in de WHERE is geen overbodige controle: zonder die eis
   * zou een geldig review-id uit een ándere respons van dezelfde tenant hier
   * ingetrokken kunnen worden via een verzonnen pad.
   */
  async trekIn(
    tenantId: string,
    responseId: string,
    reviewId: string,
  ): Promise<void> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        await this.eisBestaandeRespons(tx, responseId);

        const geraakt = await tx.execute(
          sql`UPDATE clm.survey_review
                 SET deleted_at = now()
               WHERE review_id = ${reviewId}
                 AND response_id = ${responseId}
                 AND deleted_at IS NULL`,
        );

        if (geraakt.rowCount === 0) {
          throw new NotFoundException(
            'Dit oordeel bestaat niet, of is al ingetrokken.',
          );
        }
      },
      'medewerker',
    );
  }

  /**
   * Controleert dat de respons bestaat binnen deze tenant.
   *
   * Zonder deze controle zou een oordeel op een verzonnen response_id een
   * foreign-key-fout geven — een 500 met een constraintnaam in plaats van een
   * 404 die zegt wat er aan de hand is.
   */
  private async eisBestaandeRespons(
    tx: Parameters<Parameters<DatabaseService['withTenant']>[1]>[0],
    responseId: string,
  ): Promise<{ submitted_at: Date | string | null }> {
    const gevonden = await tx.execute<{ submitted_at: Date | string | null }>(
      sql`SELECT submitted_at FROM clm.survey_response
           WHERE response_id = ${responseId}`,
    );

    const rij = gevonden.rows[0];
    if (!rij) {
      throw new NotFoundException('Deze respons bestaat niet.');
    }

    return rij;
  }

  private naarBeoordeling(r: BeoordelingRij): Beoordeling {
    return {
      reviewId: r.review_id,
      responseId: r.response_id,
      verdict: r.verdict,
      toelichting: r.toelichting,
      reviewerUserId: r.reviewer_user_id,
      reviewerNaam: r.reviewer_naam,
      createdAt: iso(r.created_at) ?? '',
    };
  }
}
