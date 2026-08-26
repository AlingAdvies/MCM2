import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';
import { bepaalStatus, type ResponsStatus } from './respons-status';

/**
 * De werkvoorraad van de contractmanager, en het statusoverzicht per vendor.
 *
 * Zie docs/superpowers/plans/2026-08-07-statuswaarheid-per-vendor.md §4.1 (B4,
 * B5). Dit is de tegenhanger van BeoordelaarService.werkvoorraad().
 *
 * ── Waarom twee lijsten en niet één met een filter ──────────────────────────
 *
 * ADR-013: "wat wacht er op mij" betekent voor de twee rollen iets wezenlijk
 * anders. De CISO wil niet zien wie er nog moet invullen — daar gaat hij niet
 * over. De contractmanager wil niet de beoordeelstapel van de hele
 * organisatie. Eén lijst met een filter bedient allebei half.
 *
 * ── De koppeling is een hulpmiddel, geen grens ──────────────────────────────
 *
 * `vendor.owner_user_id` bepaalt wat je standaard ziet, niet wat je mag. Deze
 * service kent daarom geen enkele methode die iets weigert: `alles()` toont de
 * hele organisatie, en dat is opzet (ADR-013 besluit 3). Wie hier later iets
 * bouwt dat op eigenaarschap wéigert, gaat daartegen in — en legt het proces
 * stil zodra een contractmanager op vakantie is.
 *
 * ── owner_user_id mag leeg zijn ─────────────────────────────────────────────
 *
 * De kolom is nullable met ON DELETE set null: een vendor zonder
 * contractmanager is geldig, en na het vertrek van een collega ontstaat die
 * situatie vanzelf. Zulke vendors horen in het organisatiebrede overzicht
 * zichtbaar te blijven — anders verdwijnt precies datgene waar niemand naar
 * omkijkt.
 */

/**
 * Eén respons in het statusoverzicht — of, sinds 2026-08-25, één relevante
 * leverancier zonder respons (status 'gepland').
 *
 * De eerste vier velden zijn nullable geworden omdat een 'gepland'-item nog
 * geen response/run/template heeft. Zie
 * docs/superpowers/specs/2026-08-25-audit-bewijsvoering-design.md, Deel 2.
 */
export interface StatusItem {
  /** Null voor een 'gepland'-item: er is nog geen response om naar te verwijzen. */
  responseId: string | null;
  /** Null voor een 'gepland'-item. */
  runId: string | null;
  /** Null voor een 'gepland'-item. */
  templateId: string | null;
  /** Null voor een 'gepland'-item — er is nog geen vragenlijst gekoppeld. */
  templateNaam: string | null;
  vendorId: string | null;
  vendorNaam: string | null;
  /** De contractmanager van deze vendor; null wanneer er geen is. */
  eigenaarUserId: string | null;
  eigenaarNaam: string | null;
  /**
   * Wanneer de uitnodiging is uitgegeven.
   *
   * Hoort naast `submittedAt` in beeld: een leverancier die nog niet heeft
   * ingediend zegt weinig, tenzij je weet of de uitnodiging drie dagen of zes
   * weken oud is (besluit eigenaar 2026-08-07).
   */
  uitgestuurdOp: string | null;
  /** Wanneer de leverancier heeft ingediend. Daarna staat zijn antwoord vast. */
  submittedAt: string | null;
  closesAt: string | null;
  /** De berekende status — de centrale waarheid uit respons-status.ts. */
  status: ResponsStatus;
  /** Het laatste oordeel, of null wanneer er nog geen is. */
  laatsteOordeel: string | null;
  /**
   * Hoeveel oordelen er staan. Hoort in het scherm: bij tegenstrijdige
   * oordelen telt het laatste voor de status, maar dan moet wél zichtbaar
   * blijven dát er meer zijn (besluit eigenaar 2026-08-07, V3).
   */
  aantalOordelen: number;
  /** Hoeveel notities erbij staan. Nul is een geldige uitkomst. */
  aantalNotities: number;
  /** Toegekende compliance-thema's. Leeg array wanneer er geen zijn. */
  themaCodes: string[];
}

interface StatusRij extends Record<string, unknown> {
  response_id: string;
  run_id: string;
  template_id: string;
  template_naam: string;
  vendor_id: string | null;
  vendor_naam: string | null;
  eigenaar_user_id: string | null;
  eigenaar_naam: string | null;
  uitgestuurd_op: Date | string | null;
  submitted_at: Date | string | null;
  closes_at: Date | string | null;
  ronde_status: string;
  laatste_oordeel: string | null;
  aantal_oordelen: string | number;
  aantal_notities: string | number;
  thema_codes: string[] | null;
}

function iso(waarde: Date | string | null): string | null {
  if (waarde === null) return null;
  return waarde instanceof Date ? waarde.toISOString() : String(waarde);
}

@Injectable()
export class ContractmanagerService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Rondes op vendors die deze gebruiker beheert.
   *
   * Anders dan de beoordeelstapel bevat deze lijst óók responses die nog niet
   * zijn ingediend — dat is juist wat een contractmanager wil weten: wie moet
   * er nog invullen, en wie is te laat.
   */
  async vanMij(
    tenantId: string,
    userId: string,
    themaCodes: string[] = [],
  ): Promise<StatusItem[]> {
    return this.haal(tenantId, userId, themaCodes);
  }

  /**
   * Alles binnen de tenant, ongeacht wie de vendor beheert.
   *
   * De schakelaar "van mij / hele organisatie" uit het plan. Standaard toont
   * het scherm de eigen lijst, maar de rest blijft één klik weg: de koppeling
   * is een hulpmiddel en geen grens (ADR-013 besluit 3).
   */
  async alles(
    tenantId: string,
    themaCodes: string[] = [],
  ): Promise<StatusItem[]> {
    return this.haal(tenantId, null, themaCodes);
  }

  /**
   * @param eigenaarUserId Beperk tot vendors van deze gebruiker, of null voor
   *   de hele tenant.
   */
  private async haal(
    tenantId: string,
    eigenaarUserId: string | null,
    themaCodes: string[],
  ): Promise<StatusItem[]> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        // LEFT JOIN op vendor: bij UC2 is vendor_id leeg (dan vult een collega
        // in over een leverancier). Een INNER JOIN zou die responses stil laten
        // verdwijnen uit het overzicht dat de centrale waarheid moet zijn.
        const resultaat = await tx.execute<StatusRij>(
          sql`SELECT s.response_id,
                     s.run_id,
                     r.template_id,
                     t.name          AS template_naam,
                     s.vendor_id,
                     v.name          AS vendor_naam,
                     v.owner_user_id AS eigenaar_user_id,
                     o.full_name     AS eigenaar_naam,
                     -- Het moment waarop het token is uitgegeven; dat is wat
                     -- de leverancier als uitnodiging in zijn mailbox kreeg.
                     s.created_at    AS uitgestuurd_op,
                     s.submitted_at,
                     r.closes_at,
                     r.status        AS ronde_status,
                     (SELECT rv.verdict
                        FROM clm.survey_review rv
                       WHERE rv.response_id = s.response_id
                         AND rv.deleted_at IS NULL
                       ORDER BY rv.created_at DESC
                       LIMIT 1)                       AS laatste_oordeel,
                     (SELECT count(*)
                        FROM clm.survey_review rv
                       WHERE rv.response_id = s.response_id
                         AND rv.deleted_at IS NULL)   AS aantal_oordelen,
                     (SELECT count(*)
                        FROM clm.response_note n
                       WHERE n.response_id = s.response_id
                         AND n.deleted_at IS NULL)    AS aantal_notities,
                     (SELECT array_agg(vct.thema_code ORDER BY vct.thema_code)
                        FROM clm.vendor_compliance_thema vct
                       WHERE vct.vendor_id = s.vendor_id)  AS thema_codes
                FROM clm.survey_response s
                JOIN clm.survey_run r      ON r.run_id = s.run_id
                JOIN clm.survey_template t ON t.template_id = r.template_id
                LEFT JOIN clm.vendor v     ON v.vendor_id = s.vendor_id
                LEFT JOIN clm."user" o     ON o.user_id = v.owner_user_id
               WHERE (${eigenaarUserId}::uuid IS NULL
                      OR v.owner_user_id = ${eigenaarUserId}::uuid)
                 AND (${sql.param(themaCodes)}::text[] = '{}'
                      OR EXISTS (
                        SELECT 1 FROM clm.vendor_compliance_thema vct
                         WHERE vct.vendor_id = s.vendor_id
                           AND vct.thema_code = ANY(${sql.param(themaCodes)}::text[])
                      ))
               ORDER BY s.submitted_at DESC NULLS FIRST, v.name`,
        );

        return resultaat.rows.map((r) => ({
          responseId: r.response_id,
          runId: r.run_id,
          templateId: r.template_id,
          templateNaam: r.template_naam,
          vendorId: r.vendor_id,
          vendorNaam: r.vendor_naam,
          eigenaarUserId: r.eigenaar_user_id,
          eigenaarNaam: r.eigenaar_naam,
          uitgestuurdOp: iso(r.uitgestuurd_op),
          submittedAt: iso(r.submitted_at),
          closesAt: iso(r.closes_at),
          // Eén plek waar de status wordt bepaald: dezelfde functie die de
          // unittests toetsen. Zou deze query zijn eigen CASE-expressie
          // hebben, dan zijn er binnen een sprint twee waarheden.
          status: bepaalStatus({
            submittedAt: r.submitted_at,
            closesAt: r.closes_at,
            rondeStatus: r.ronde_status,
            laatsteOordeel: r.laatste_oordeel,
          }),
          laatsteOordeel: r.laatste_oordeel,
          aantalOordelen: Number(r.aantal_oordelen),
          aantalNotities: Number(r.aantal_notities),
          themaCodes: r.thema_codes ?? [],
        }));
      },
      'medewerker',
    );
  }

  /**
   * Relevante leveranciers zonder enige survey_response — status 'gepland'.
   *
   * "Relevant" = business_criticality medium/high/critical, plus (indien
   * themaCodes niet leeg is) minstens één van de gefilterde thema's. Zie
   * docs/superpowers/specs/2026-08-25-audit-bewijsvoering-design.md, Deel 2.
   *
   * Bewuste beperking: "zonder enige response ooit", niet "zonder response in
   * de actuele ronde". Een leverancier die al eens beoordeeld is en op de
   * volgende ronde wacht, verschijnt hier niet — zie de spec voor de
   * toelichting.
   */
  async haalGeplandeVendors(
    tenantId: string,
    eigenaarUserId: string | null,
    themaCodes: string[],
  ): Promise<StatusItem[]> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const resultaat = await tx.execute<{
          vendor_id: string;
          vendor_naam: string;
          eigenaar_user_id: string | null;
          eigenaar_naam: string | null;
          thema_codes: string[] | null;
        }>(
          sql`SELECT v.vendor_id,
                     v.name AS vendor_naam,
                     v.owner_user_id AS eigenaar_user_id,
                     o.full_name AS eigenaar_naam,
                     (SELECT array_agg(vct.thema_code ORDER BY vct.thema_code)
                        FROM clm.vendor_compliance_thema vct
                       WHERE vct.vendor_id = v.vendor_id) AS thema_codes
                FROM clm.vendor v
                LEFT JOIN clm."user" o ON o.user_id = v.owner_user_id
               WHERE v.deleted_at IS NULL
                 AND v.business_criticality_code IN ('medium', 'high', 'critical')
                 AND (${eigenaarUserId}::uuid IS NULL
                      OR v.owner_user_id = ${eigenaarUserId}::uuid)
                 AND (${sql.param(themaCodes)}::text[] = '{}'
                      OR EXISTS (
                        SELECT 1 FROM clm.vendor_compliance_thema vct
                         WHERE vct.vendor_id = v.vendor_id
                           AND vct.thema_code = ANY(${sql.param(themaCodes)}::text[])
                      ))
                 AND NOT EXISTS (
                       SELECT 1 FROM clm.survey_response s
                        WHERE s.vendor_id = v.vendor_id
                     )
               ORDER BY v.name`,
        );

        return resultaat.rows.map((r) => ({
          responseId: null,
          runId: null,
          templateId: null,
          templateNaam: null,
          vendorId: r.vendor_id,
          vendorNaam: r.vendor_naam,
          eigenaarUserId: r.eigenaar_user_id,
          eigenaarNaam: r.eigenaar_naam,
          uitgestuurdOp: null,
          submittedAt: null,
          closesAt: null,
          status: 'gepland' as const,
          laatsteOordeel: null,
          aantalOordelen: 0,
          aantalNotities: 0,
          themaCodes: r.thema_codes ?? [],
        }));
      },
      'medewerker',
    );
  }

  /**
   * Het volledige overzicht: bestaande responsen + relevante vendors zonder
   * respons ('gepland'). Dit is wat het statusoverzicht-scherm aanroept.
   */
  async volledigOverzicht(
    tenantId: string,
    eigenaarUserId: string | null,
    themaCodes: string[],
  ): Promise<StatusItem[]> {
    const [bestaand, gepland] = await Promise.all([
      this.haal(tenantId, eigenaarUserId, themaCodes),
      this.haalGeplandeVendors(tenantId, eigenaarUserId, themaCodes),
    ]);

    return [...bestaand, ...gepland];
  }
}
