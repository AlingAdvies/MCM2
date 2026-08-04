import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';

/**
 * Vragenlijsten en rondes lezen voor de beheerkant (fase A van
 * docs/superpowers/plans/2026-08-03-surveybeheer.md).
 *
 * ── Wat dit is, en wat het niet is ──────────────────────────────────────────
 *
 * Uitsluitend lezen. Er wordt hier niets aangemaakt, gewijzigd of gestart —
 * dat is fase B. De reden om die knip te maken is dat fase B `genereerToken()`
 * voor het eerst in productiecode aanroept, en dat raakt de tokenlaag die al
 * bewezen en groen is. Lezen kan daar los van.
 *
 * ── Alles via withTenant, met de actor erbij ────────────────────────────────
 *
 * Elke query loopt door `withTenant()` met actor `medewerker`. Dat is niet
 * decoratief: sinds migratie 0013 kan de database onderscheid maken tussen een
 * medewerker en een leverancier van dezelfde tenant, en fase C leunt daarop
 * voor `survey_review`. Een leespad dat de actor vergeet, krijgt straks
 * stilzwijgend nul rijen op tabellen die dat wél eisen — dus zetten we hem nu
 * al goed, niet pas wanneer de eerste policy erop leunt.
 *
 * ── Een instructie is geen vraag ────────────────────────────────────────────
 *
 * De Transdev-vragenlijst heeft 9 items waarvan er één `answer_type =
 * 'instruction'` is: een introductiescherm zonder antwoord. Wie "9 vragen"
 * toont, telt iets dat de leverancier niet als vraag ervaart. De lijst geeft
 * daarom beide getallen terug — `aantalVragen` (8) en `aantalItems` (9) — en
 * laat het scherm kiezen wat het toont.
 */

/** Een vragenlijst zoals het overzicht hem toont. */
export interface VragenlijstSamenvatting {
  templateId: string;
  name: string;
  version: number;
  /** Echte vragen: alles behalve `instruction`. Dit is wat de leverancier invult. */
  aantalVragen: number;
  /** Alle items inclusief instructieschermen — wat er feitelijk in de lijst staat. */
  aantalItems: number;
  aantalCategorieen: number;
  aantalRondes: number;
  createdAt: string;
}

/** Eén vraag, zoals de leverancier hem te zien krijgt. */
export interface VraagDetail {
  questionId: string;
  questionKey: string;
  position: number;
  title: string;
  /** NOT NULL in de database (migratie 0005) — een lege toelichting is ''. */
  body: string;
  answerType: string;
  isRequired: boolean;
  allowsUpload: boolean;
  maxFiles: number;
  config: unknown;
  categoryId: string | null;
  categorieNaam: string | null;
}

/** Een vragenlijst met alles erin. */
export interface VragenlijstDetail extends VragenlijstSamenvatting {
  categorieen: {
    categoryId: string;
    name: string;
    position: number;
    minAnswers: number | null;
  }[];
  vragen: VraagDetail[];
}

/** Een ronde zoals het overzicht hem toont. */
export interface RondeSamenvatting {
  runId: string;
  templateId: string;
  templateNaam: string;
  status: string;
  surveyKind: string;
  isTest: boolean;
  startedAt: string | null;
  closesAt: string | null;
  revokedAt: string | null;
  /** Hoeveel deelnemers er zijn uitgenodigd. */
  aantalDeelnemers: number;
  /** Hoeveel daarvan hebben ingediend. */
  aantalIngediend: number;
}

/** Eén deelnemer aan een ronde. */
export interface DeelnemerSamenvatting {
  responseId: string;
  vendorId: string | null;
  vendorNaam: string | null;
  status: string;
  expiresAt: string | null;
  submittedAt: string | null;
}

export interface RondeDetail extends RondeSamenvatting {
  deelnemers: DeelnemerSamenvatting[];
}

interface TemplateRij extends Record<string, unknown> {
  template_id: string;
  name: string;
  version: number;
  created_at: Date | string;
  aantal_vragen: string | number;
  aantal_items: string | number;
  aantal_categorieen: string | number;
  aantal_rondes: string | number;
}

interface CategorieRij extends Record<string, unknown> {
  category_id: string;
  name: string;
  position: number;
  min_answers: number | null;
}

interface VraagRij extends Record<string, unknown> {
  question_id: string;
  question_key: string;
  position: number;
  title: string;
  body: string;
  answer_type: string;
  is_required: boolean;
  allows_upload: boolean;
  max_files: number;
  config: unknown;
  category_id: string | null;
  categorie_naam: string | null;
}

interface RondeRij extends Record<string, unknown> {
  run_id: string;
  template_id: string;
  template_naam: string;
  status: string;
  survey_kind: string;
  is_test: boolean;
  started_at: Date | string | null;
  closes_at: Date | string | null;
  revoked_at: Date | string | null;
  aantal_deelnemers: string | number;
  aantal_ingediend: string | number;
}

interface DeelnemerRij extends Record<string, unknown> {
  response_id: string;
  vendor_id: string | null;
  vendor_naam: string | null;
  status: string;
  expires_at: Date | string | null;
  submitted_at: Date | string | null;
}

/** Datums als ISO-tekst, of null. Voorkomt dat elke aanroeper dat zelf doet. */
function iso(waarde: Date | string | null): string | null {
  if (waarde === null || waarde === undefined) return null;
  return waarde instanceof Date ? waarde.toISOString() : String(waarde);
}

function getal(waarde: string | number): number {
  return typeof waarde === 'number' ? waarde : Number(waarde);
}

@Injectable()
export class VragenlijstBeheerService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Alle vragenlijsten van deze tenant, met hun aantallen.
   *
   * De subquery's tellen per template. Dat is bij deze aantallen (twee
   * vragenlijsten) ruimschoots snel genoeg, en het houdt de query leesbaar —
   * een JOIN met drie GROUP BY's zou hier meer kosten dan opleveren.
   */
  async lijst(tenantId: string): Promise<VragenlijstSamenvatting[]> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const resultaat = await tx.execute<TemplateRij>(
          sql`SELECT t.template_id,
                     t.name,
                     t.version,
                     t.created_at,
                     (SELECT count(*) FROM clm.survey_question q
                       WHERE q.template_id = t.template_id
                         AND q.answer_type <> 'instruction')   AS aantal_vragen,
                     (SELECT count(*) FROM clm.survey_question q
                       WHERE q.template_id = t.template_id)    AS aantal_items,
                     (SELECT count(*) FROM clm.survey_category c
                       WHERE c.template_id = t.template_id)    AS aantal_categorieen,
                     (SELECT count(*) FROM clm.survey_run r
                       WHERE r.template_id = t.template_id)    AS aantal_rondes
                FROM clm.survey_template t
               ORDER BY t.name, t.version DESC`,
        );

        return resultaat.rows.map((r) => ({
          templateId: r.template_id,
          name: r.name,
          version: r.version,
          aantalVragen: getal(r.aantal_vragen),
          aantalItems: getal(r.aantal_items),
          aantalCategorieen: getal(r.aantal_categorieen),
          aantalRondes: getal(r.aantal_rondes),
          createdAt: iso(r.created_at)!,
        }));
      },
      'medewerker',
    );
  }

  /**
   * Eén vragenlijst met haar categorieën en vragen.
   *
   * De vragen komen in dezelfde volgorde als de leverancier ze ziet
   * (`position`), inclusief het instructie-item. Dat is opzet: dit scherm moet
   * laten zien wát er uitgestuurd wordt, en de introductie hoort daarbij.
   */
  async detail(
    tenantId: string,
    templateId: string,
  ): Promise<VragenlijstDetail> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const templates = await tx.execute<TemplateRij>(
          sql`SELECT t.template_id,
                     t.name,
                     t.version,
                     t.created_at,
                     (SELECT count(*) FROM clm.survey_question q
                       WHERE q.template_id = t.template_id
                         AND q.answer_type <> 'instruction')   AS aantal_vragen,
                     (SELECT count(*) FROM clm.survey_question q
                       WHERE q.template_id = t.template_id)    AS aantal_items,
                     (SELECT count(*) FROM clm.survey_category c
                       WHERE c.template_id = t.template_id)    AS aantal_categorieen,
                     (SELECT count(*) FROM clm.survey_run r
                       WHERE r.template_id = t.template_id)    AS aantal_rondes
                FROM clm.survey_template t
               WHERE t.template_id = ${templateId}`,
        );

        // Nul rijen betekent hier twee dingen tegelijk: hij bestaat niet, óf
        // hij hoort bij een andere tenant en RLS filtert hem weg. Beide geven
        // 404 — de beheerder mag niet kunnen afleiden dat een vragenlijst van
        // een andere tenant bestaat.
        const t = templates.rows[0];
        if (!t) {
          throw new NotFoundException('Deze vragenlijst bestaat niet.');
        }

        const categorieen = await tx.execute<CategorieRij>(
          sql`SELECT category_id, name, position, min_answers
                FROM clm.survey_category
               WHERE template_id = ${templateId}
               ORDER BY position`,
        );

        const vragen = await tx.execute<VraagRij>(
          sql`SELECT q.question_id,
                     q.question_key,
                     q.position,
                     q.title,
                     q.body,
                     q.answer_type,
                     q.is_required,
                     q.allows_upload,
                     q.max_files,
                     q.config,
                     q.category_id,
                     c.name AS categorie_naam
                FROM clm.survey_question q
                LEFT JOIN clm.survey_category c ON c.category_id = q.category_id
               WHERE q.template_id = ${templateId}
               ORDER BY q.position`,
        );

        return {
          templateId: t.template_id,
          name: t.name,
          version: t.version,
          aantalVragen: getal(t.aantal_vragen),
          aantalItems: getal(t.aantal_items),
          aantalCategorieen: getal(t.aantal_categorieen),
          aantalRondes: getal(t.aantal_rondes),
          createdAt: iso(t.created_at)!,
          categorieen: categorieen.rows.map((c) => ({
            categoryId: c.category_id,
            name: c.name,
            position: c.position,
            minAnswers: c.min_answers,
          })),
          vragen: vragen.rows.map((q) => ({
            questionId: q.question_id,
            questionKey: q.question_key,
            position: q.position,
            title: q.title,
            body: q.body,
            answerType: q.answer_type,
            isRequired: q.is_required,
            allowsUpload: q.allows_upload,
            maxFiles: q.max_files,
            config: q.config,
            categoryId: q.category_id,
            categorieNaam: q.categorie_naam,
          })),
        };
      },
      'medewerker',
    );
  }

  /** Alle rondes van deze tenant, nieuwste eerst. */
  async rondes(tenantId: string): Promise<RondeSamenvatting[]> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const resultaat = await tx.execute<RondeRij>(
          sql`SELECT r.run_id,
                     r.template_id,
                     t.name AS template_naam,
                     r.status,
                     r.survey_kind,
                     r.is_test,
                     r.started_at,
                     r.closes_at,
                     r.revoked_at,
                     (SELECT count(*) FROM clm.survey_response s
                       WHERE s.run_id = r.run_id)              AS aantal_deelnemers,
                     (SELECT count(*) FROM clm.survey_response s
                       WHERE s.run_id = r.run_id
                         AND s.submitted_at IS NOT NULL)       AS aantal_ingediend
                FROM clm.survey_run r
                JOIN clm.survey_template t ON t.template_id = r.template_id
               ORDER BY r.started_at DESC NULLS FIRST, t.name`,
        );

        return resultaat.rows.map((r) => this.naarRonde(r));
      },
      'medewerker',
    );
  }

  /** Eén ronde met haar deelnemers. */
  async ronde(tenantId: string, runId: string): Promise<RondeDetail> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const rondes = await tx.execute<RondeRij>(
          sql`SELECT r.run_id,
                     r.template_id,
                     t.name AS template_naam,
                     r.status,
                     r.survey_kind,
                     r.is_test,
                     r.started_at,
                     r.closes_at,
                     r.revoked_at,
                     (SELECT count(*) FROM clm.survey_response s
                       WHERE s.run_id = r.run_id)              AS aantal_deelnemers,
                     (SELECT count(*) FROM clm.survey_response s
                       WHERE s.run_id = r.run_id
                         AND s.submitted_at IS NOT NULL)       AS aantal_ingediend
                FROM clm.survey_run r
                JOIN clm.survey_template t ON t.template_id = r.template_id
               WHERE r.run_id = ${runId}`,
        );

        const r = rondes.rows[0];
        if (!r) {
          throw new NotFoundException('Deze ronde bestaat niet.');
        }

        // Nadrukkelijk géén token_hash in de selectie. Die hoort nergens uit
        // een route te komen — het ruwe token bestaat één keer, bij uitgifte
        // (fase B), en daarna alleen de hash. Een lijst die de hash meestuurt
        // geeft een aanvaller de helft van het werk.
        const deelnemers = await tx.execute<DeelnemerRij>(
          sql`SELECT s.response_id,
                     s.vendor_id,
                     v.name AS vendor_naam,
                     s.status,
                     s.expires_at,
                     s.submitted_at
                FROM clm.survey_response s
                LEFT JOIN clm.vendor v ON v.vendor_id = s.vendor_id
               WHERE s.run_id = ${runId}
               ORDER BY v.name NULLS LAST, s.created_at`,
        );

        return {
          ...this.naarRonde(r),
          deelnemers: deelnemers.rows.map((d) => ({
            responseId: d.response_id,
            vendorId: d.vendor_id,
            vendorNaam: d.vendor_naam,
            status: d.status,
            expiresAt: iso(d.expires_at),
            submittedAt: iso(d.submitted_at),
          })),
        };
      },
      'medewerker',
    );
  }

  private naarRonde(r: RondeRij): RondeSamenvatting {
    return {
      runId: r.run_id,
      templateId: r.template_id,
      templateNaam: r.template_naam,
      status: r.status,
      surveyKind: r.survey_kind,
      isTest: r.is_test,
      startedAt: iso(r.started_at),
      closesAt: iso(r.closes_at),
      revokedAt: iso(r.revoked_at),
      aantalDeelnemers: getal(r.aantal_deelnemers),
      aantalIngediend: getal(r.aantal_ingediend),
    };
  }
}
