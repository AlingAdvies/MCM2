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

/** Eén respons in het statusoverzicht. */
export interface StatusItem {
  responseId: string;
  runId: string;
  templateId: string;
  templateNaam: string;
  vendorId: string | null;
  vendorNaam: string | null;
  /** De contractmanager van deze vendor; null wanneer er geen is. */
  eigenaarUserId: string | null;
  eigenaarNaam: string | null;
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
  submitted_at: Date | string | null;
  closes_at: Date | string | null;
  ronde_status: string;
  laatste_oordeel: string | null;
  aantal_oordelen: string | number;
  aantal_notities: string | number;
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
  async vanMij(tenantId: string, userId: string): Promise<StatusItem[]> {
    return this.haal(tenantId, userId);
  }

  /**
   * Alles binnen de tenant, ongeacht wie de vendor beheert.
   *
   * De schakelaar "van mij / hele organisatie" uit het plan. Standaard toont
   * het scherm de eigen lijst, maar de rest blijft één klik weg: de koppeling
   * is een hulpmiddel en geen grens (ADR-013 besluit 3).
   */
  async alles(tenantId: string): Promise<StatusItem[]> {
    return this.haal(tenantId, null);
  }

  /**
   * @param eigenaarUserId Beperk tot vendors van deze gebruiker, of null voor
   *   de hele tenant.
   */
  private async haal(
    tenantId: string,
    eigenaarUserId: string | null,
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
                         AND n.deleted_at IS NULL)    AS aantal_notities
                FROM clm.survey_response s
                JOIN clm.survey_run r      ON r.run_id = s.run_id
                JOIN clm.survey_template t ON t.template_id = r.template_id
                LEFT JOIN clm.vendor v     ON v.vendor_id = s.vendor_id
                LEFT JOIN clm."user" o     ON o.user_id = v.owner_user_id
               WHERE (${eigenaarUserId}::uuid IS NULL
                      OR v.owner_user_id = ${eigenaarUserId}::uuid)
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
        }));
      },
      'medewerker',
    );
  }
}
