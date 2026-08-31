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
  /** Null wanneer deze ronde bij het starten niet aan een contract gekoppeld is. */
  contractId: string | null;
  contractNaam: string | null;
  /** Hoeveel deelnemers er zijn uitgenodigd. */
  aantalDeelnemers: number;
  /** Hoeveel daarvan hebben ingediend. */
  aantalIngediend: number;
}

/**
 * Eén uitvraag zoals hij op de leverancierspagina getoond wordt.
 *
 * Bewust vanuit de leverancier gezien en niet vanuit de ronde: wat een
 * contractmanager wil weten is "wat loopt er bij Siemens", niet "wie zat er in
 * ronde 3". Vandaar dat de respons hier de hoofdzaak is en de ronde de context.
 */
export interface VendorUitvraag {
  responseId: string;
  runId: string;
  templateNaam: string;
  /** `pending`, `submitted` of `revoked`. */
  status: string;
  isTest: boolean;
  startedAt: string | null;
  verlooptOp: string | null;
  ingediendOp: string | null;
  /** Waar de hele ronde is ingetrokken; dan telt deze uitvraag niet meer. */
  rondeIngetrokken: boolean;
  aantalBeoordelingen: number;
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

/** Eén bijlage bij een antwoord. */
export interface BijlageSamenvatting {
  attachmentId: string;
  /** Zoals de leverancier hem aanleverde — nooit als pad gebruiken. */
  originalName: string;
  contentType: string;
  byteSize: number;
  createdAt: string;
}

/**
 * Eén vraag met het antwoord dat erop gegeven is.
 *
 * De vraag staat er altijd, het antwoord kan ontbreken. Dat onderscheid is het
 * hele punt van dit scherm: een niet-beantwoorde vraag is informatie, en die
 * zou verdwijnen als we alleen de rijen uit `survey_answer` zouden tonen.
 *
 * De waarde staat in aparte velden per soort, precies zoals de database hem
 * bewaart (schema.ts regel 480 e.v.). Ze hier samenvoegen tot één `waarde`-veld
 * zou de beheerkant laten gokken wat er in staat, en een rating die als tekst
 * aankomt is niet meer te sorteren.
 */
export interface AntwoordDetail {
  questionId: string;
  questionKey: string;
  position: number;
  title: string;
  body: string;
  answerType: string;
  isRequired: boolean;
  categoryId: string | null;
  categorieNaam: string | null;
  /** Null wanneer deze vraag niet is beantwoord. */
  antwoord: {
    answerId: string;
    answerCode: string | null;
    answerCodes: string[] | null;
    answerText: string | null;
    /** NUMERIC komt als string uit pg; hier als getal, of null. */
    answerNumber: number | null;
    comment: string | null;
    createdAt: string;
    updatedAt: string | null;
  } | null;
  bijlagen: BijlageSamenvatting[];
}

/** Alle antwoorden van één respons, in de volgorde van de vragenlijst. */
export interface AntwoordenDetail {
  responseId: string;
  runId: string;
  templateId: string;
  templateNaam: string;
  vendorId: string | null;
  vendorNaam: string | null;
  status: string;
  submittedAt: string | null;
  expiresAt: string | null;
  /** Echte vragen, dus zonder `instruction`. */
  aantalVragen: number;
  aantalBeantwoord: number;
  antwoorden: AntwoordDetail[];
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
  contract_id: string | null;
  contract_naam: string | null;
  aantal_deelnemers: string | number;
  aantal_ingediend: string | number;
}

interface AntwoordRij extends Record<string, unknown> {
  question_id: string;
  question_key: string;
  position: number;
  title: string;
  body: string;
  answer_type: string;
  is_required: boolean;
  category_id: string | null;
  categorie_naam: string | null;
  answer_id: string | null;
  answer_code: string | null;
  answer_codes: string[] | null;
  answer_text: string | null;
  answer_number: string | number | null;
  comment: string | null;
  antwoord_created_at: Date | string | null;
  antwoord_updated_at: Date | string | null;
}

interface BijlageRij extends Record<string, unknown> {
  attachment_id: string;
  question_id: string;
  original_name: string;
  content_type: string;
  byte_size: number;
  created_at: Date | string;
}

interface ResponsRij extends Record<string, unknown> {
  response_id: string;
  run_id: string;
  template_id: string;
  template_naam: string;
  vendor_id: string | null;
  vendor_naam: string | null;
  status: string;
  submitted_at: Date | string | null;
  expires_at: Date | string | null;
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
                     r.contract_id,
                     c.name AS contract_naam,
                     (SELECT count(*) FROM clm.survey_response s
                       WHERE s.run_id = r.run_id)              AS aantal_deelnemers,
                     (SELECT count(*) FROM clm.survey_response s
                       WHERE s.run_id = r.run_id
                         AND s.submitted_at IS NOT NULL)       AS aantal_ingediend
                FROM clm.survey_run r
                JOIN clm.survey_template t ON t.template_id = r.template_id
                LEFT JOIN clm.contract c ON c.contract_id = r.contract_id
               ORDER BY r.started_at DESC NULLS FIRST, t.name`,
        );

        return resultaat.rows.map((r) => this.naarRonde(r));
      },
      'medewerker',
    );
  }

  /**
   * De uitvragen van één leverancier, nieuwste eerst.
   *
   * ── Waarom deze route bestaat ───────────────────────────────────────────────
   *
   * Op 2026-08-09 nodigde de eigenaar een leverancier uit, kreeg de mail,
   * vulde de vragenlijst in en diende hem in — en kon in de app nergens
   * terugvinden dát hij hem had uitgestuurd, laat staan dat er antwoord was.
   *
   * De data stond er wel. Alleen: wie wil weten hoe het met één leverancier
   * staat, moet bij Rondes zijn en daar de juiste ronde zoeken. Dat is de
   * omgekeerde vraag van wat een contractmanager stelt — die kijkt naar de
   * leverancier, niet naar de ronde.
   *
   * MVM_V2 lost dat op met een `VendorSurveyPanel` op de leverancierspagina
   * (src/shared/components/VendorSurveyPanel.tsx). Deze methode is de
   * databron daarvoor.
   *
   * ── Wat er bewust niet in zit ───────────────────────────────────────────────
   *
   * Scores. MVM_V2 toont er een (`4.2 / 5` met een trendpijl), maar dat vraagt
   * een scoreberekening die MCM2 niet heeft. Liever tonen wat er is —
   * uitgenodigd, ingediend, beoordeeld — dan een getal dat nergens op rust.
   */
  async uitvragenVanVendor(
    tenantId: string,
    vendorId: string,
  ): Promise<VendorUitvraag[]> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const { rows } = await tx.execute<{
          response_id: string;
          run_id: string;
          template_naam: string;
          status: string;
          is_test: boolean;
          started_at: Date | null;
          expires_at: Date | null;
          submitted_at: Date | null;
          run_status: string;
          revoked_at: Date | null;
          aantal_beoordelingen: string;
        }>(
          sql`SELECT resp.response_id,
                     run.run_id,
                     t.name          AS template_naam,
                     resp.status,
                     run.is_test,
                     run.started_at,
                     resp.expires_at,
                     resp.submitted_at,
                     run.status      AS run_status,
                     run.revoked_at,
                     (SELECT count(*) FROM clm.survey_review rev
                       WHERE rev.response_id = resp.response_id
                         AND rev.deleted_at IS NULL) AS aantal_beoordelingen
                FROM clm.survey_response resp
                JOIN clm.survey_run run ON run.run_id = resp.run_id
                JOIN clm.survey_template t ON t.template_id = run.template_id
               WHERE resp.vendor_id = ${vendorId}
               ORDER BY run.started_at DESC NULLS LAST, t.name`,
        );

        return rows.map((r) => ({
          responseId: r.response_id,
          runId: r.run_id,
          templateNaam: r.template_naam,
          status: r.status,
          isTest: r.is_test,
          startedAt: iso(r.started_at),
          verlooptOp: iso(r.expires_at),
          ingediendOp: iso(r.submitted_at),
          rondeIngetrokken: r.revoked_at !== null,
          aantalBeoordelingen: getal(r.aantal_beoordelingen),
        }));
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
                     r.contract_id,
                     c.name AS contract_naam,
                     (SELECT count(*) FROM clm.survey_response s
                       WHERE s.run_id = r.run_id)              AS aantal_deelnemers,
                     (SELECT count(*) FROM clm.survey_response s
                       WHERE s.run_id = r.run_id
                         AND s.submitted_at IS NOT NULL)       AS aantal_ingediend
                FROM clm.survey_run r
                JOIN clm.survey_template t ON t.template_id = r.template_id
                LEFT JOIN clm.contract c ON c.contract_id = r.contract_id
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

  /**
   * De antwoorden van één respons, in de volgorde van de vragenlijst.
   *
   * ── Waarom een LEFT JOIN vanaf de vraag ────────────────────────────────────
   *
   * De vragen zijn leidend, niet de antwoorden. Een respons die half is
   * ingevuld hoort de openstaande vragen te tonen, niet weg te laten: "vraag 7
   * is niet beantwoord" is precies wat een beoordelaar moet zien. Zouden we
   * vanaf `survey_answer` joinen, dan verdwijnt die informatie stilzwijgend en
   * lijkt een halve respons compleet.
   *
   * `instruction`-items blijven staan. Ze horen bij de lijst zoals de
   * leverancier hem zag, en zonder die schermen loopt de nummering niet meer
   * gelijk met wat hij voor zich had.
   *
   * ── Bijlagen apart ─────────────────────────────────────────────────────────
   *
   * Eén vraag kan meerdere bijlagen hebben (`max_files`). In dezelfde query
   * zouden de antwoordvelden zich per bijlage herhalen, en dan moet de
   * aanroeper gaan ontdubbelen. Twee queries binnen dezelfde transactie is hier
   * eenvoudiger dan één slimme.
   *
   * Nadrukkelijk géén `storage_key`: dat is een intern pad. Downloaden loopt
   * via een eigen route met eigen controle, niet via dit overzicht.
   */
  async antwoorden(
    tenantId: string,
    responseId: string,
  ): Promise<AntwoordenDetail> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const responses = await tx.execute<ResponsRij>(
          sql`SELECT s.response_id,
                     s.run_id,
                     r.template_id,
                     t.name AS template_naam,
                     s.vendor_id,
                     v.name AS vendor_naam,
                     s.status,
                     s.submitted_at,
                     s.expires_at
                FROM clm.survey_response s
                JOIN clm.survey_run r      ON r.run_id = s.run_id
                JOIN clm.survey_template t ON t.template_id = r.template_id
                LEFT JOIN clm.vendor v     ON v.vendor_id = s.vendor_id
               WHERE s.response_id = ${responseId}`,
        );

        const respons = responses.rows[0];
        if (!respons) {
          throw new NotFoundException('Deze respons bestaat niet.');
        }

        const rijen = await tx.execute<AntwoordRij>(
          sql`SELECT q.question_id,
                     q.question_key,
                     q.position,
                     q.title,
                     q.body,
                     q.answer_type,
                     q.is_required,
                     q.category_id,
                     c.name AS categorie_naam,
                     a.answer_id,
                     a.answer_code,
                     a.answer_codes,
                     a.answer_text,
                     a.answer_number,
                     a.comment,
                     a.created_at AS antwoord_created_at,
                     a.updated_at AS antwoord_updated_at
                FROM clm.survey_question q
                LEFT JOIN clm.survey_category c ON c.category_id = q.category_id
                LEFT JOIN clm.survey_answer a
                       ON a.question_id = q.question_id
                      AND a.response_id = ${responseId}
               WHERE q.template_id = ${respons.template_id}
               ORDER BY q.position`,
        );

        const bijlagen = await tx.execute<BijlageRij>(
          sql`SELECT attachment_id,
                     question_id,
                     original_name,
                     content_type,
                     byte_size,
                     created_at
                FROM clm.survey_attachment
               WHERE response_id = ${responseId}
               ORDER BY created_at`,
        );

        const perVraag = new Map<string, BijlageSamenvatting[]>();
        for (const b of bijlagen.rows) {
          const lijst = perVraag.get(b.question_id) ?? [];
          lijst.push({
            attachmentId: b.attachment_id,
            originalName: b.original_name,
            contentType: b.content_type,
            byteSize: b.byte_size,
            createdAt: iso(b.created_at) ?? '',
          });
          perVraag.set(b.question_id, lijst);
        }

        const antwoorden = rijen.rows.map((r) => ({
          questionId: r.question_id,
          questionKey: r.question_key,
          position: r.position,
          title: r.title,
          body: r.body,
          answerType: r.answer_type,
          isRequired: r.is_required,
          categoryId: r.category_id,
          categorieNaam: r.categorie_naam,
          antwoord: r.answer_id
            ? {
                answerId: r.answer_id,
                answerCode: r.answer_code,
                answerCodes: r.answer_codes,
                answerText: r.answer_text,
                // NUMERIC komt als string uit de pg-driver; Number(null) is 0
                // en dat zou een leeg antwoord als een nul tonen.
                answerNumber:
                  r.answer_number === null ? null : Number(r.answer_number),
                comment: r.comment,
                createdAt: iso(r.antwoord_created_at) ?? '',
                updatedAt: iso(r.antwoord_updated_at),
              }
            : null,
          bijlagen: perVraag.get(r.question_id) ?? [],
        }));

        // Instructieschermen tellen niet mee: daar valt niets te beantwoorden.
        // Dezelfde afbakening als aantalVragen in lijst() en detail().
        const echteVragen = antwoorden.filter(
          (a) => a.answerType !== 'instruction',
        );

        return {
          responseId: respons.response_id,
          runId: respons.run_id,
          templateId: respons.template_id,
          templateNaam: respons.template_naam,
          vendorId: respons.vendor_id,
          vendorNaam: respons.vendor_naam,
          status: respons.status,
          submittedAt: iso(respons.submitted_at),
          expiresAt: iso(respons.expires_at),
          aantalVragen: echteVragen.length,
          aantalBeantwoord: echteVragen.filter((a) => a.antwoord !== null)
            .length,
          antwoorden,
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
      contractId: r.contract_id,
      contractNaam: r.contract_naam,
      aantalDeelnemers: getal(r.aantal_deelnemers),
      aantalIngediend: getal(r.aantal_ingediend),
    };
  }
}
