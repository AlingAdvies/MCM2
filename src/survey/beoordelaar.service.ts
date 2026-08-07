import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';

/**
 * Beoordelaars koppelen aan een vragenlijst (ADR-013, besluit 2 en 3).
 *
 * ── Wat deze koppeling wél en niet doet ─────────────────────────────────────
 *
 * Wél: bepalen wat iemand standaard in zijn werkvoorraad ziet.
 * Niet: bepalen wat iemand mág.
 *
 * Dat onderscheid is besluit 3 uit ADR-013 en het minst vanzelfsprekende deel
 * ervan. Elke reviewer binnen de tenant mag elke inzending beoordelen. Deze
 * service kent daarom geen enkele methode die iets weigert — er is niets in dit
 * bestand dat toegang controleert, en dat is opzet.
 *
 * **Voor wie hier later iets bouwt:** gebruik `template_reviewer` nooit om een
 * beoordeling te blokkeren. Een harde grens legt het proces stil zodra de
 * gekoppelde beoordelaar ziek is, en dan wijzigt iemand met databasetoegang de
 * koppeling — een noodgreep buiten de app om, zonder spoor.
 *
 * De fallback is de contractmanager, die intern regelt dat een bevoegd persoon
 * beoordeelt. Dat werkt alleen als de app het niet blokkeert. Verdedigbaar
 * omdat elk oordeel met naam en datum vastligt (migratie 0015): wie buiten zijn
 * vakgebied beoordeelt, doet dat zichtbaar.
 */

export interface Beoordelaar {
  userId: string;
  naam: string;
  email: string;
  createdAt: string;
}

/** Eén inzending die op deze beoordelaar wacht. */
export interface WerkvoorraadItem {
  responseId: string;
  runId: string;
  templateId: string;
  templateNaam: string;
  vendorId: string | null;
  vendorNaam: string | null;
  submittedAt: string | null;
  /** Het laatste oordeel, of null wanneer er nog geen is. */
  laatsteOordeel: string | null;
  aantalOordelen: number;
}

interface BeoordelaarRij extends Record<string, unknown> {
  user_id: string;
  naam: string;
  email: string;
  created_at: Date | string;
}

interface WerkvoorraadRij extends Record<string, unknown> {
  response_id: string;
  run_id: string;
  template_id: string;
  template_naam: string;
  vendor_id: string | null;
  vendor_naam: string | null;
  submitted_at: Date | string | null;
  laatste_oordeel: string | null;
  aantal_oordelen: string | number;
}

function iso(waarde: Date | string | null): string | null {
  if (waarde === null) return null;
  return waarde instanceof Date ? waarde.toISOString() : String(waarde);
}

@Injectable()
export class BeoordelaarService {
  constructor(private readonly db: DatabaseService) {}

  /** Wie er aan deze vragenlijst gekoppeld zijn. */
  async lijst(tenantId: string, templateId: string): Promise<Beoordelaar[]> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        await this.eisBestaandeVragenlijst(tx, templateId);

        const resultaat = await tx.execute<BeoordelaarRij>(
          sql`SELECT tr.user_id,
                     u.full_name AS naam,
                     u.email,
                     tr.created_at
                FROM clm.template_reviewer tr
                JOIN clm."user" u ON u.user_id = tr.user_id
               WHERE tr.template_id = ${templateId}
               ORDER BY u.full_name`,
        );

        return resultaat.rows.map((r) => ({
          userId: r.user_id,
          naam: r.naam,
          email: r.email,
          createdAt: iso(r.created_at) ?? '',
        }));
      },
      'medewerker',
    );
  }

  /**
   * Koppelt een gebruiker aan een vragenlijst.
   *
   * Idempotent: twee keer koppelen levert geen fout op. De samengestelde
   * primaire sleutel zou een 23505 geven, en dat is een databasefoutmelding
   * waar een beheerder niets aan heeft voor iets dat feitelijk al klopt.
   */
  async koppel(
    tenantId: string,
    templateId: string,
    userId: string,
    doorUserId: string,
  ): Promise<void> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        await this.eisBestaandeVragenlijst(tx, templateId);

        // Binnen deze tenant, anders koppel je iemand van een andere
        // organisatie. RLS dekt dat al af voor het lezen, maar een verzonnen
        // user_id zou hier op een foreign key stuklopen met een 500.
        const gebruiker = await tx.execute(
          sql`SELECT 1 FROM clm."user" WHERE user_id = ${userId}`,
        );

        if (gebruiker.rows.length === 0) {
          throw new NotFoundException('Deze gebruiker bestaat niet.');
        }

        await tx.execute(
          sql`INSERT INTO clm.template_reviewer
                     (tenant_id, template_id, user_id, created_by)
              VALUES (${tenantId}, ${templateId}, ${userId}, ${doorUserId})
              ON CONFLICT (template_id, user_id) DO NOTHING`,
        );
      },
      'medewerker',
    );
  }

  /**
   * Haalt een koppeling weg.
   *
   * Hard verwijderen en geen `deleted_at`: dit is administratie, geen
   * geschiedenis. Wie ooit gekoppeld was doet er niet toe — wie beoordeeld
   * heeft wél, en dat staat in `survey_review` en blijft daar staan.
   */
  async ontkoppel(
    tenantId: string,
    templateId: string,
    userId: string,
  ): Promise<void> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        await this.eisBestaandeVragenlijst(tx, templateId);

        await tx.execute(
          sql`DELETE FROM clm.template_reviewer
               WHERE template_id = ${templateId} AND user_id = ${userId}`,
        );
      },
      'medewerker',
    );
  }

  /**
   * Wat er op deze beoordelaar wacht: ingediende responses op vragenlijsten
   * waaraan hij gekoppeld is.
   *
   * ── Waarom dit een eigen lijst is en geen filter ────────────────────────────
   *
   * ADR-013: "wat wacht er op mij" betekent voor de twee rollen iets wezenlijk
   * anders. De CISO wil niet zien wie er nog moet invullen — daar gaat hij niet
   * over. De contractmanager wil niet de beoordeelstapel van de hele
   * organisatie. Eén lijst met een filter bedient allebei half.
   *
   * ── Alleen ingediend ────────────────────────────────────────────────────────
   *
   * Een respons die nog openstaat valt niet te beoordelen (migratie 0015-logica
   * in BeoordelingService). Hem hier tonen zou een werkvoorraad opleveren waar
   * je niets mee kunt.
   */
  async werkvoorraad(
    tenantId: string,
    userId: string,
  ): Promise<WerkvoorraadItem[]> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const resultaat = await tx.execute<WerkvoorraadRij>(
          sql`SELECT s.response_id,
                     s.run_id,
                     r.template_id,
                     t.name AS template_naam,
                     s.vendor_id,
                     v.name AS vendor_naam,
                     s.submitted_at,
                     (SELECT rv.verdict
                        FROM clm.survey_review rv
                       WHERE rv.response_id = s.response_id
                         AND rv.deleted_at IS NULL
                       ORDER BY rv.created_at DESC
                       LIMIT 1)                       AS laatste_oordeel,
                     (SELECT count(*)
                        FROM clm.survey_review rv
                       WHERE rv.response_id = s.response_id
                         AND rv.deleted_at IS NULL)   AS aantal_oordelen
                FROM clm.survey_response s
                JOIN clm.survey_run r      ON r.run_id = s.run_id
                JOIN clm.survey_template t ON t.template_id = r.template_id
                JOIN clm.template_reviewer tr
                       ON tr.template_id = t.template_id
                      AND tr.user_id = ${userId}
                LEFT JOIN clm.vendor v     ON v.vendor_id = s.vendor_id
               WHERE s.submitted_at IS NOT NULL
               ORDER BY s.submitted_at DESC`,
        );

        return resultaat.rows.map((r) => ({
          responseId: r.response_id,
          runId: r.run_id,
          templateId: r.template_id,
          templateNaam: r.template_naam,
          vendorId: r.vendor_id,
          vendorNaam: r.vendor_naam,
          submittedAt: iso(r.submitted_at),
          laatsteOordeel: r.laatste_oordeel,
          aantalOordelen: Number(r.aantal_oordelen),
        }));
      },
      'medewerker',
    );
  }

  private async eisBestaandeVragenlijst(
    tx: Parameters<Parameters<DatabaseService['withTenant']>[1]>[0],
    templateId: string,
  ): Promise<void> {
    const gevonden = await tx.execute(
      sql`SELECT 1 FROM clm.survey_template WHERE template_id = ${templateId}`,
    );

    if (gevonden.rows.length === 0) {
      throw new NotFoundException('Deze vragenlijst bestaat niet.');
    }
  }
}
