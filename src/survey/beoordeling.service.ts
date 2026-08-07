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

/** De drie toegestane oordelen. Gelijk aan de CHECK uit migratie 0015. */
export const OORDELEN = ['goed', 'nadere_vragen', 'niet_goed'] as const;
export type Oordeel = (typeof OORDELEN)[number];

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
