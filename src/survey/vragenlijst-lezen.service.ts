import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';
import type { TenantTransaction } from '../db/database.service';
import type { AntwoordType } from './vragenlijst-schema';

/**
 * Typespecifieke instellingen zoals de leverancierskant ze ziet.
 *
 * camelCase, terwijl `config` in de database snake_case is. Die vertaling
 * gebeurt hier bewust en niet in de frontend: het is de backend die bepaalt
 * wat het contract is, en een frontend die zelf sleutels omzet gaat afwijken
 * zodra er een veld bijkomt.
 */
export interface VraagConfig {
  options?: { code: string; label: string }[];
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  minSelect?: number;
  maxSelect?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
  decimals?: number;
  comment?: string;
}

/**
 * Een eerder opgeslagen concept-antwoord op deze vraag (ontwerp §7), of
 * `null` als er nog niets staat. Dezelfde vorm als `Antwoord` uit het
 * indien-contract, zodat de frontend het rechtstreeks kan hergebruiken om het
 * formulier voor te vullen.
 */
export interface OpgeslagenAntwoord {
  answerCode: string | null;
  answerCodes: string[] | null;
  answerText: string | null;
  answerNumber: number | null;
  comment: string | null;
}

/** Een eerder geüploade bijlage bij deze vraag. */
export interface OpgeslagenBijlage {
  attachmentId: string;
  bestandsnaam: string;
  contentType: string;
}

export interface Vraag {
  questionKey: string;
  title: string;
  body: string;
  answerType: AntwoordType;
  isRequired: boolean;
  allowsUpload: boolean;
  maxFiles: number;
  config: VraagConfig;
  /**
   * Vult het formulier voor bij een herbezoek. `null` als er voor deze vraag
   * nog niets is opgeslagen — dat is iets anders dan een leeg antwoord, en de
   * frontend moet het verschil kunnen zien.
   */
  savedAnswer: OpgeslagenAntwoord | null;
  savedAttachments: OpgeslagenBijlage[];
}

export interface Categorie {
  key: string;
  name: string;
  minAnswers: number;
  questions: Vraag[];
}

export interface Vragenlijst {
  name: string;
  /** Leeg bij een platte lijst (UC1); gevuld bij een ingedeelde lijst (UC2). */
  categories: Categorie[];
  /** Vragen zonder categorie. Bij UC1 staat hier alles in. */
  questions: Vraag[];
  closesAt: string | null;
}

interface VraagRij extends Record<string, unknown> {
  question_key: string;
  title: string;
  body: string;
  answer_type: string;
  is_required: boolean;
  allows_upload: boolean;
  max_files: number;
  config: Record<string, unknown> | null;
  category_id: string | null;
  category_name: string | null;
  category_position: number | null;
  category_min_answers: number | null;
  template_name: string;
  closes_at: Date | string | null;
}

/** Maakt van 'Duidelijkheid & Kosten' → 'duidelijkheid-kosten'. */
function maakSleutel(naam: string): string {
  const sleutel = naam
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return sleutel.length > 0 ? sleutel : 'categorie';
}

/**
 * Vertaalt de `config`-jsonb naar het contract van de leverancierskant.
 *
 * Alleen bekende sleutels gaan mee. Dat is geen netheid maar een grens: `config`
 * is een vrij JSONB-veld dat de database niet inhoudelijk bewaakt (ontwerp §2a),
 * en alles klakkeloos doorgeven zou betekenen dat wat daar ooit in belandt
 * automatisch bij de leverancier terechtkomt.
 */
function vertaalConfig(config: Record<string, unknown> | null): VraagConfig {
  if (!config) return {};

  const uit: VraagConfig = {};

  if (Array.isArray(config.options)) {
    uit.options = config.options
      .filter(
        (optie): optie is { code: string; label: string } =>
          typeof optie === 'object' &&
          optie !== null &&
          typeof (optie as { code?: unknown }).code === 'string' &&
          typeof (optie as { label?: unknown }).label === 'string',
      )
      .map((optie) => ({ code: optie.code, label: optie.label }));
  }

  const getal = (waarde: unknown): number | undefined =>
    typeof waarde === 'number' ? waarde : undefined;
  const tekst = (waarde: unknown): string | undefined =>
    typeof waarde === 'string' ? waarde : undefined;

  uit.min = getal(config.min);
  uit.max = getal(config.max);
  uit.minLabel = tekst(config.min_label);
  uit.maxLabel = tekst(config.max_label);
  uit.minSelect = getal(config.min_select);
  uit.maxSelect = getal(config.max_select);
  uit.minLength = getal(config.min_length);
  uit.maxLength = getal(config.max_length);
  uit.format = tekst(config.format);
  uit.decimals = getal(config.decimals);
  uit.comment = tekst(config.comment);

  // Ongedefinieerde sleutels weglaten in plaats van als null meesturen: het
  // verschil tussen "niet ingesteld" en "op null gezet" hoort niet te bestaan
  // in een contract dat een formulier beschrijft.
  for (const sleutel of Object.keys(uit) as (keyof VraagConfig)[]) {
    if (uit[sleutel] === undefined) delete uit[sleutel];
  }

  return uit;
}

/**
 * Leest de vragenlijst die bij een response hoort.
 *
 * Kernregel, en de reden dat deze service zo klein is: er wordt uitsluitend
 * gezocht vanaf de `response_id` die de guard heeft vastgesteld — nooit vanaf
 * een vendor, een template of een run die de client benoemt. Dat is testpunt
 * 39: een leverancier bereikt langs deze route alleen zijn eigen respons, en
 * een interne beoordeling over dezelfde `subject_vendor_id` is er niet mee te
 * vinden.
 *
 * De query filtert daarom op `response_id` en niet op `subject_vendor_id`.
 * Zodra iemand dat omdraait, ontstaat het lek dat er nu niet is.
 *
 * Dat is geen theorie: het lek is tijdens het bouwen daadwerkelijk ingebouwd om
 * te toetsen of de tests het merken. Ze deden dat pas nadat de test twee
 * responses over DEZELFDE leverancier gebruikte — met twee verschillende
 * leveranciers bleef alles groen. Wie deze query aanpast, moet dus ook
 * controleren dat de test in `vragenlijst-ophalen.e2e-spec.ts` nog steeds één
 * gedeelde `vendorId` gebruikt.
 */
@Injectable()
export class VragenlijstLeesService {
  constructor(private readonly db: DatabaseService) {}

  async haalVragenlijst(
    tenantId: string,
    responseId: string,
  ): Promise<Vragenlijst | null> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const resultaat = await tx.execute<VraagRij>(
          // De keten response → run → template → vragen. Elke stap zit binnen de
          // tenantcontext, dus RLS beschermt tegen een andere tenant; de
          // response_id-voorwaarde beschermt tegen een andere respons binnen
          // dezelfde tenant.
          sql`SELECT q.question_key,
                   q.title,
                   q.body,
                   q.answer_type,
                   q.is_required,
                   q.allows_upload,
                   q.max_files,
                   q.config,
                   c.category_id,
                   c.name        AS category_name,
                   c.position    AS category_position,
                   c.min_answers AS category_min_answers,
                   t.name        AS template_name,
                   run.closes_at
              FROM clm.survey_response r
              JOIN clm.survey_run      run ON run.run_id      = r.run_id
              JOIN clm.survey_template t   ON t.template_id   = run.template_id
              JOIN clm.survey_question q   ON q.template_id   = t.template_id
              LEFT JOIN clm.survey_category c ON c.category_id = q.category_id
             WHERE r.response_id = ${responseId}
             ORDER BY c.position NULLS FIRST, q.position`,
        );

        const rijen = resultaat.rows;

        // Geen rijen betekent: de respons bestaat niet in deze tenant, of de
        // template heeft nog geen vragen. Voor de aanroeper is dat hetzelfde —
        // er valt niets te tonen.
        if (rijen.length === 0) {
          return null;
        }

        // Twee losse queries in plaats van meejoinen op de hoofdset: een
        // JOIN met survey_attachment zou de vragenrijen vermenigvuldigen
        // zodra een vraag meer dan één bijlage heeft, en dat is precies de
        // fout die de vormconstraint in de andere richting (§4) probeert te
        // voorkomen. Bij een vragenlijst van hooguit enkele tientallen vragen
        // wegen twee extra queries niet op tegen die complexiteit.
        const antwoorden = await this.haalOpgeslagenAntwoorden(tx, responseId);
        const bijlagen = await this.haalOpgeslagenBijlagen(tx, responseId);

        const categorieen = new Map<string, Categorie>();
        const losseVragen: Vraag[] = [];

        for (const rij of rijen) {
          const vraag: Vraag = {
            questionKey: rij.question_key,
            title: rij.title,
            body: rij.body,
            answerType: rij.answer_type as AntwoordType,
            isRequired: rij.is_required,
            allowsUpload: rij.allows_upload,
            maxFiles: rij.max_files,
            config: vertaalConfig(rij.config),
            savedAnswer: antwoorden.get(rij.question_key) ?? null,
            savedAttachments: bijlagen.get(rij.question_key) ?? [],
          };

          if (rij.category_id === null || rij.category_name === null) {
            losseVragen.push(vraag);
            continue;
          }

          let categorie = categorieen.get(rij.category_id);

          if (!categorie) {
            categorie = {
              key: maakSleutel(rij.category_name),
              name: rij.category_name,
              minAnswers: rij.category_min_answers ?? 0,
              questions: [],
            };
            categorieen.set(rij.category_id, categorie);
          }

          categorie.questions.push(vraag);
        }

        const eerste = rijen[0];
        const sluit = eerste.closes_at;

        return {
          name: eerste.template_name,
          categories: [...categorieen.values()],
          questions: losseVragen,
          // Tijdstippen komen bij ruwe SQL als string terug wanneer ze uit een
          // JOIN komen; vandaar de dubbele behandeling. Zelfde patroon als
          // alsDatum() in survey-token.service.ts.
          closesAt:
            sluit === null
              ? null
              : sluit instanceof Date
                ? sluit.toISOString()
                : new Date(sluit).toISOString(),
        };
      },
      'leverancier',
    );
  }

  /**
   * Eerder opgeslagen antwoorden voor deze response (ontwerp §7), per
   * question_key. Geldt zowel voor een echt concept als voor een respons die
   * al ingediend is — in beide gevallen staan de antwoorden in dezelfde
   * tabel, en de guard bepaalt al of deze route bereikbaar is.
   */
  private async haalOpgeslagenAntwoorden(
    tx: TenantTransaction,
    responseId: string,
  ): Promise<Map<string, OpgeslagenAntwoord>> {
    const resultaat = await tx.execute<{
      question_key: string;
      answer_code: string | null;
      answer_codes: string[] | null;
      answer_text: string | null;
      answer_number: string | null;
      comment: string | null;
    }>(
      sql`SELECT q.question_key, a.answer_code, a.answer_codes,
                 a.answer_text, a.answer_number, a.comment
            FROM clm.survey_answer a
            JOIN clm.survey_question q ON q.question_id = a.question_id
           WHERE a.response_id = ${responseId}`,
    );

    return new Map(
      resultaat.rows.map((rij) => [
        rij.question_key,
        {
          answerCode: rij.answer_code,
          answerCodes: rij.answer_codes,
          answerText: rij.answer_text,
          // NUMERIC komt via de driver als string terug.
          answerNumber:
            rij.answer_number === null ? null : Number(rij.answer_number),
          comment: rij.comment,
        },
      ]),
    );
  }

  /** Eerder geüploade bijlagen voor deze response, per question_key. */
  private async haalOpgeslagenBijlagen(
    tx: TenantTransaction,
    responseId: string,
  ): Promise<Map<string, OpgeslagenBijlage[]>> {
    const resultaat = await tx.execute<{
      question_key: string;
      attachment_id: string;
      original_name: string;
      content_type: string;
    }>(
      sql`SELECT q.question_key, a.attachment_id, a.original_name, a.content_type
            FROM clm.survey_attachment a
            JOIN clm.survey_question q ON q.question_id = a.question_id
           WHERE a.response_id = ${responseId}
           ORDER BY a.created_at`,
    );

    const perVraag = new Map<string, OpgeslagenBijlage[]>();

    for (const rij of resultaat.rows) {
      const lijst = perVraag.get(rij.question_key) ?? [];
      lijst.push({
        attachmentId: rij.attachment_id,
        bestandsnaam: rij.original_name,
        contentType: rij.content_type,
      });
      perVraag.set(rij.question_key, lijst);
    }

    return perVraag;
  }
}
