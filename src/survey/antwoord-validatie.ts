/**
 * De regelset die bepaalt of een set antwoorden ingediend mag worden
 * (vragenlijst-ontwerp §5, stap 2 t/m 10).
 *
 * Bevat geen database en geen NestJS: het is pure logica over vragen en
 * antwoorden. Dat is bewust — dit is de laag waar de beslissing valt, en die
 * moet los te toetsen zijn van een draaiende applicatie.
 *
 * De browserlaag telt niet mee als beveiliging (§5): een leverancier kan de
 * POST direct sturen. De database is het vangnet eronder; deze laag levert de
 * leesbare fout.
 */

import type { AntwoordType } from './vragenlijst-schema';

/** De vier opties bij een confirmation-vraag (ontwerp §3). */
const BEVESTIGINGSCODES = [
  'confirmed',
  'not_confirmed',
  'not_applicable',
  'cannot_upload',
] as const;

/** Minimale lengte van een verplichte toelichting, na wegstrepen van spaties. */
export const TOELICHTING_MINIMUM = 10;

/** Bovengrens, gelijk aan de CHECK-constraint in migratie 0005. */
export const TOELICHTING_MAXIMUM = 2000;

/** Eén vraag zoals de validatie hem nodig heeft. */
export interface VraagVoorValidatie {
  questionKey: string;
  answerType: AntwoordType;
  isRequired: boolean;
  allowsUpload: boolean;
  maxFiles: number;
  config: Record<string, unknown>;
}

/** Eén antwoord zoals de leverancier het instuurt. */
export interface AntwoordInvoer {
  questionKey?: unknown;
  answerType?: unknown;
  answerCode?: unknown;
  answerCodes?: unknown;
  answerText?: unknown;
  answerNumber?: unknown;
  comment?: unknown;
}

/**
 * Eén afgekeurd punt.
 *
 * `question` is de question_key en niet de UUID: leesbaar voor een mens en het
 * lekt geen intern ID (ontwerp §5).
 */
export interface AntwoordFout {
  question: string;
  reason: string;
}

/** Een gevalideerd antwoord, klaar om weggeschreven te worden. */
export interface GeldigAntwoord {
  questionKey: string;
  answerType: AntwoordType;
  answerCode: string | null;
  answerCodes: string[] | null;
  answerText: string | null;
  answerNumber: number | null;
  comment: string | null;
}

export type ValidatieUitkomst =
  | { geldig: true; antwoorden: GeldigAntwoord[] }
  | { geldig: false; fouten: AntwoordFout[] };

function isObject(waarde: unknown): waarde is Record<string, unknown> {
  return (
    typeof waarde === 'object' && waarde !== null && !Array.isArray(waarde)
  );
}

function getal(waarde: unknown): number | undefined {
  return typeof waarde === 'number' && Number.isFinite(waarde)
    ? waarde
    : undefined;
}

/** Aantal decimalen in een getal, zonder afrondingsruis van toFixed. */
function decimalen(waarde: number): number {
  const tekst = String(waarde);
  const punt = tekst.indexOf('.');
  return punt === -1 ? 0 : tekst.length - punt - 1;
}

/**
 * Toetst één antwoord tegen zijn vraag.
 *
 * Vult `doel` met een schrijfbare rij wanneer alles klopt, en `fouten` met de
 * reden wanneer niet. Geeft de eerste fout per vraag — meer dan één reden per
 * vraag helpt de leverancier niet en maakt de melding onleesbaar.
 */
function toetsAntwoord(
  vraag: VraagVoorValidatie,
  antwoord: AntwoordInvoer,
  aantalBestanden: number,
  fouten: AntwoordFout[],
  doel: GeldigAntwoord[],
): void {
  const meld = (reden: string) =>
    fouten.push({ question: vraag.questionKey, reason: reden });

  // Stap 5: het type in het antwoord moet overeenkomen met dat van de vraag.
  // De samengestelde foreign key uit §4 vangt dit ook af, maar dan als
  // databasefout in plaats van een leesbare 422.
  if (
    antwoord.answerType !== undefined &&
    antwoord.answerType !== vraag.answerType
  ) {
    meld('answer_type_mismatch');
    return;
  }

  const config = vraag.config ?? {};
  const rij: GeldigAntwoord = {
    questionKey: vraag.questionKey,
    answerType: vraag.answerType,
    answerCode: null,
    answerCodes: null,
    answerText: null,
    answerNumber: null,
    comment: null,
  };

  // Stap 6: waarde geldig voor dít type (§3a-tabel).
  switch (vraag.answerType) {
    case 'confirmation': {
      const code = antwoord.answerCode;
      if (
        typeof code !== 'string' ||
        !(BEVESTIGINGSCODES as readonly string[]).includes(code)
      ) {
        meld('invalid_code');
        return;
      }
      // De vierde optie hoort alleen bij een vraag die een upload vraagt.
      // Zonder deze controle kan iemand "ik kan niet uploaden" antwoorden op
      // een vraag waar niets te uploaden viel.
      if (code === 'cannot_upload' && !vraag.allowsUpload) {
        meld('upload_option_not_available');
        return;
      }
      rij.answerCode = code;
      break;
    }

    case 'yes_no': {
      const code = antwoord.answerCode;
      if (code !== 'yes' && code !== 'no') {
        meld('invalid_code');
        return;
      }
      rij.answerCode = code;
      break;
    }

    case 'single_choice': {
      const code = antwoord.answerCode;
      if (typeof code !== 'string' || code.length === 0) {
        meld('invalid_code');
        return;
      }
      // Testpunt 33. Dit kan een CHECK niet: de toegestane codes staan in de
      // config van de vraag, en een CHECK mag geen andere tabel raadplegen.
      if (!kentCode(config, code)) {
        meld('unknown_option');
        return;
      }
      rij.answerCode = code;
      break;
    }

    case 'multi_choice': {
      const codes = antwoord.answerCodes;
      if (!Array.isArray(codes) || codes.some((c) => typeof c !== 'string')) {
        meld('invalid_codes');
        return;
      }
      if (codes.length === 0) {
        // Alleen een probleem als de vraag verplicht is; dat wordt hieronder
        // afgehandeld door de aanwezigheidscontrole.
        meld('invalid_codes');
        return;
      }
      // Testpunt 35: duplicaten en de min/max-grenzen.
      if (new Set(codes).size !== codes.length) {
        meld('duplicate_options');
        return;
      }
      const onbekend = (codes as string[]).find((c) => !kentCode(config, c));
      if (onbekend !== undefined) {
        meld('unknown_option');
        return;
      }
      const minSelect = getal(config.min_select);
      const maxSelect = getal(config.max_select);
      if (minSelect !== undefined && codes.length < minSelect) {
        meld('too_few_options');
        return;
      }
      if (maxSelect !== undefined && codes.length > maxSelect) {
        meld('too_many_options');
        return;
      }
      rij.answerCodes = codes as string[];
      break;
    }

    case 'open_text': {
      const tekst = antwoord.answerText;
      if (typeof tekst !== 'string' || tekst.trim().length === 0) {
        meld('empty_text');
        return;
      }
      const minLengte = getal(config.min_length) ?? 1;
      const maxLengte = getal(config.max_length);
      if (tekst.trim().length < minLengte) {
        meld('text_too_short');
        return;
      }
      if (maxLengte !== undefined && tekst.length > maxLengte) {
        meld('text_too_long');
        return;
      }
      rij.answerText = tekst;
      break;
    }

    case 'rating': {
      const waarde = getal(antwoord.answerNumber);
      if (waarde === undefined) {
        meld('invalid_number');
        return;
      }
      // Testpunt 34: geheel getal binnen min…max.
      if (!Number.isInteger(waarde)) {
        meld('not_an_integer');
        return;
      }
      const min = getal(config.min);
      const max = getal(config.max);
      if (
        (min !== undefined && waarde < min) ||
        (max !== undefined && waarde > max)
      ) {
        meld('out_of_range');
        return;
      }
      rij.answerNumber = waarde;
      break;
    }

    case 'number': {
      const waarde = getal(antwoord.answerNumber);
      if (waarde === undefined) {
        meld('invalid_number');
        return;
      }
      const min = getal(config.min);
      const max = getal(config.max);
      if (
        (min !== undefined && waarde < min) ||
        (max !== undefined && waarde > max)
      ) {
        meld('out_of_range');
        return;
      }
      const toegestaneDecimalen = getal(config.decimals);
      if (
        toegestaneDecimalen !== undefined &&
        decimalen(waarde) > toegestaneDecimalen
      ) {
        meld('too_many_decimals');
        return;
      }
      // Een percentage buiten 0–100 is onzin, ook zonder expliciete min/max.
      if (config.format === 'pct' && (waarde < 0 || waarde > 100)) {
        meld('out_of_range');
        return;
      }
      rij.answerNumber = waarde;
      break;
    }

    case 'file_upload': {
      // Geen waarde, alleen bijlagen (ontwerp §2a). Stap 9b.
      if (aantalBestanden < 1) {
        meld('file_required');
        return;
      }
      break;
    }

    case 'instruction':
      // Een leesblok levert geen antwoordrij op. Wie er toch een instuurt,
      // krijgt dat expliciet terug in plaats van een stilzwijgend genegeerde
      // waarde.
      meld('instruction_has_no_answer');
      return;
  }

  // Stap 7 en 8: de toelichting.
  const toelichting =
    typeof antwoord.comment === 'string' ? antwoord.comment : null;
  const verplicht = toelichtingVerplicht(vraag, rij);

  if (toelichting !== null && toelichting.length > TOELICHTING_MAXIMUM) {
    meld('comment_too_long');
    return;
  }

  if (verplicht) {
    if (toelichting === null || toelichting.trim().length === 0) {
      meld('comment_required');
      return;
    }
    // De ondergrens houdt "n/a" en "-" tegen: die maken het veld formeel
    // gevuld en inhoudelijk leeg, en zijn daarmee erger dan een leeg veld —
    // in een overzicht zien ze eruit als een antwoord.
    if (toelichting.trim().length < TOELICHTING_MINIMUM) {
      meld('comment_too_short');
      return;
    }
  }

  if (
    toelichting !== null &&
    toelichting.trim().length > 0 &&
    config.comment !== 'none'
  ) {
    rij.comment = toelichting;
  }

  // Stap 9: een bevestiging op een uploadvraag vraagt om het bewijsstuk.
  if (
    vraag.allowsUpload &&
    rij.answerCode === 'confirmed' &&
    aantalBestanden < 1
  ) {
    meld('file_required');
    return;
  }

  // Stap 10: nooit meer bestanden dan de vraag toestaat.
  if (aantalBestanden > vraag.maxFiles) {
    meld('too_many_files');
    return;
  }

  doel.push(rij);
}

function kentCode(config: Record<string, unknown>, code: string): boolean {
  const opties = config.options;
  if (!Array.isArray(opties)) return false;
  return opties.some(
    (optie) =>
      isObject(optie) && typeof optie.code === 'string' && optie.code === code,
  );
}

/**
 * Bepaalt of een toelichting verplicht is.
 *
 * Bij `confirmation` is dat inhoudelijk bepaald en niet instelbaar: alles
 * behalve een bevestiging vereist uitleg (ontwerp §3, bevestigd 2026-07-29).
 * Diezelfde regel staat als CHECK-constraint in migratie 0005, dus de database
 * weigert het ook als deze functie zou falen.
 *
 * Bij de andere zeven typen is het per vraag instelbaar via `config.comment`
 * en staat het standaard op optioneel (§3a).
 */
function toelichtingVerplicht(
  vraag: VraagVoorValidatie,
  rij: GeldigAntwoord,
): boolean {
  if (vraag.answerType === 'confirmation') {
    return rij.answerCode !== 'confirmed';
  }
  return vraag.config?.comment === 'required';
}

/**
 * Valideert een volledige indiening.
 *
 * Verzamelt álle fouten in plaats van bij de eerste te stoppen: wie acht vragen
 * invult wil niet acht keer opnieuw proberen.
 *
 * @param vragen alle vragen van de template, in volgorde
 * @param invoer wat de leverancier instuurde
 * @param bestandenPerVraag aantal reeds geüploade bijlagen per question_key
 */
export function valideerAntwoorden(
  vragen: VraagVoorValidatie[],
  invoer: unknown,
  bestandenPerVraag: Map<string, number> = new Map(),
): ValidatieUitkomst {
  const fouten: AntwoordFout[] = [];

  if (!Array.isArray(invoer)) {
    return {
      geldig: false,
      fouten: [{ question: '(body)', reason: 'answers_must_be_a_list' }],
    };
  }

  const perSleutel = new Map<string, AntwoordInvoer>();

  for (const item of invoer) {
    if (!isObject(item) || typeof item.questionKey !== 'string') {
      fouten.push({ question: '(body)', reason: 'invalid_answer_entry' });
      continue;
    }
    if (perSleutel.has(item.questionKey)) {
      fouten.push({ question: item.questionKey, reason: 'duplicate_answer' });
      continue;
    }
    perSleutel.set(item.questionKey, item);
  }

  const bekend = new Map(vragen.map((v) => [v.questionKey, v]));

  // Stap 3 en 4: een sleutel die niet bij deze vragenlijst hoort. Stap 4 uit
  // het ontwerp — hoort de vraag bij de template van déze run — valt hier
  // samen met stap 3, omdat `vragen` al uitsluitend de vragen van deze run
  // bevat. RLS beschermt tegen een andere tenant, dit tegen een andere
  // template binnen dezelfde tenant.
  for (const sleutel of perSleutel.keys()) {
    if (!bekend.has(sleutel)) {
      fouten.push({ question: sleutel, reason: 'unknown_question' });
    }
  }

  const antwoorden: GeldigAntwoord[] = [];

  for (const vraag of vragen) {
    const antwoord = perSleutel.get(vraag.questionKey);
    const bestanden = bestandenPerVraag.get(vraag.questionKey) ?? 0;

    // Stap 2, met de twee uitzonderingen die makkelijk vergeten worden: een
    // instruction is een leesblok en levert nooit een antwoord op, en een
    // vraag met is_required = false mag leeg blijven. Wie beide vergeet, bouwt
    // een vragenlijst die met een inleidend tekstblok nooit in te dienen is
    // (testpunt 32).
    if (vraag.answerType === 'instruction') {
      if (antwoord !== undefined) {
        fouten.push({
          question: vraag.questionKey,
          reason: 'instruction_has_no_answer',
        });
      }
      continue;
    }

    if (antwoord === undefined) {
      if (vraag.isRequired) {
        fouten.push({ question: vraag.questionKey, reason: 'answer_required' });
      }
      continue;
    }

    toetsAntwoord(vraag, antwoord, bestanden, fouten, antwoorden);
  }

  if (fouten.length > 0) {
    return { geldig: false, fouten };
  }

  return { geldig: true, antwoorden };
}

/**
 * Valideert een concept: een gedeeltelijke set antwoorden, opgeslagen vóórdat
 * de leverancier indient (ontwerp §7).
 *
 * Het verschil met `valideerAntwoorden()` is precies één regel: een
 * ontbrekende verplichte vraag is hier geen fout. Iemand vult vraag 1 t/m 3
 * in, slaat op, en gaat later verder met 4 t/m 8 — dat mag een concept niet
 * blokkeren, anders is "gedeeltelijk opslaan" een lege belofte.
 *
 * Wat wél ongewijzigd geldt: elke *aangeleverde* vraag moet volledig geldig
 * zijn, met dezelfde regels als bij indienen (toelichtingsplicht, geldige
 * codes, bestandsgrenzen). Ontwerp §7 is daar expliciet over: "een concept
 * bevat alleen volledig ingevulde antwoorden — een vraag is af of hij staat
 * er niet in." Dat is ook waarom deze functie dezelfde `toetsAntwoord()`
 * hergebruikt in plaats van een losse, lichtere regelset: de RLS-policy op
 * `survey_answer` (migratie 0005) staat toe dat een concept dezelfde rij-vorm
 * heeft als een ingediend antwoord, en dat blijft alleen waar als beide paden
 * door dezelfde validatie gaan.
 *
 * Een `instruction`-vraag die wél wordt meegestuurd is nog steeds een fout
 * (er bestaat geen antwoordrij voor een leesblok, concept of niet), en een
 * onbekende `question_key` ook — beide zijn vormfouten, geen kwestie van
 * volledigheid.
 */
export function valideerConcept(
  vragen: VraagVoorValidatie[],
  invoer: unknown,
  bestandenPerVraag: Map<string, number> = new Map(),
): ValidatieUitkomst {
  const fouten: AntwoordFout[] = [];

  if (!Array.isArray(invoer)) {
    return {
      geldig: false,
      fouten: [{ question: '(body)', reason: 'answers_must_be_a_list' }],
    };
  }

  const perSleutel = new Map<string, AntwoordInvoer>();

  for (const item of invoer) {
    if (!isObject(item) || typeof item.questionKey !== 'string') {
      fouten.push({ question: '(body)', reason: 'invalid_answer_entry' });
      continue;
    }
    if (perSleutel.has(item.questionKey)) {
      fouten.push({ question: item.questionKey, reason: 'duplicate_answer' });
      continue;
    }
    perSleutel.set(item.questionKey, item);
  }

  const bekend = new Map(vragen.map((v) => [v.questionKey, v]));

  for (const sleutel of perSleutel.keys()) {
    if (!bekend.has(sleutel)) {
      fouten.push({ question: sleutel, reason: 'unknown_question' });
    }
  }

  const antwoorden: GeldigAntwoord[] = [];

  for (const vraag of vragen) {
    const antwoord = perSleutel.get(vraag.questionKey);

    if (vraag.answerType === 'instruction') {
      if (antwoord !== undefined) {
        fouten.push({
          question: vraag.questionKey,
          reason: 'instruction_has_no_answer',
        });
      }
      continue;
    }

    // Het enige echte verschil met valideerAntwoorden(): geen antwoord is bij
    // een concept nooit een fout, ongeacht is_required. Onvolledig is precies
    // wat een concept per definitie is.
    if (antwoord === undefined) {
      continue;
    }

    const bestanden = bestandenPerVraag.get(vraag.questionKey) ?? 0;
    toetsAntwoord(vraag, antwoord, bestanden, fouten, antwoorden);
  }

  if (fouten.length > 0) {
    return { geldig: false, fouten };
  }

  return { geldig: true, antwoorden };
}
