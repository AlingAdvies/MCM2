/**
 * Het JSON-uitwisselformaat van een vragenlijst-template (ontwerp §2d).
 *
 * Dit bestand bevat uitsluitend vorm en validatie — geen database, geen NestJS.
 * Dat is bewust: het importpad is de plek waar client-invoer het datamodel
 * binnenkomt, en die controle moet los te testen zijn van een draaiende
 * applicatie.
 *
 * De belangrijkste regel staat niet in een functie maar in wat er ontbreekt:
 * er is geen `tenant_id` in dit formaat. Een importbestand mag geen tenantgrens
 * kunnen oversteken (Issue #7, testpunt 31). Zou het veld hier bestaan, dan zou
 * iemand het ooit "voor het gemak" gaan gebruiken.
 */

/** De acht antwoordtypen uit ontwerp §2a. */
export const ANTWOORDTYPEN = [
  'instruction',
  'confirmation',
  'open_text',
  'yes_no',
  'single_choice',
  'multi_choice',
  'rating',
  'number',
  'file_upload',
] as const;

export type AntwoordType = (typeof ANTWOORDTYPEN)[number];

/** Getalnotaties voor `number` (ontwerp §2a). */
const GETALNOTATIES = ['plain', 'eur', 'usd', 'pct'] as const;

/** Toelichtingsplicht bij de zeven niet-`confirmation`-typen (ontwerp §3a). */
const COMMENTWAARDEN = ['none', 'optional', 'required'] as const;

/**
 * De versie van dít formaat, niet van de vragenlijst.
 *
 * Een later formaat moet herkenbaar weigeren in plaats van half inlezen: een
 * bestand met onbekende velden dat "grotendeels goed gaat" levert een template
 * op die stilzwijgend afwijkt van wat de opsteller bedoelde.
 */
export const SCHEMA_VERSIE = 1;

export interface CategorieInvoer {
  key: string;
  position: number;
  name: string;
  min_answers?: number;
}

export interface VraagInvoer {
  question_key: string;
  category_key?: string | null;
  position: number;
  title: string;
  body: string;
  answer_type: AntwoordType;
  is_required?: boolean;
  allows_upload?: boolean;
  max_files?: number;
  config?: Record<string, unknown>;
}

export interface VragenlijstInvoer {
  schema_version: number;
  name: string;
  version: number;
  categories: CategorieInvoer[];
  questions: VraagInvoer[];
}

/**
 * Eén afgekeurd punt. Het pad wijst de opsteller naar de plek in het bestand:
 * bij acht vragen met elk een config is "ongeldige waarde" zonder plaats
 * onbruikbaar.
 */
export interface Bezwaar {
  pad: string;
  melding: string;
}

export class VragenlijstOngeldigError extends Error {
  constructor(readonly bezwaren: Bezwaar[]) {
    super(
      `Vragenlijst afgekeurd (${bezwaren.length} ${
        bezwaren.length === 1 ? 'bezwaar' : 'bezwaren'
      }): ${bezwaren.map((b) => `${b.pad}: ${b.melding}`).join('; ')}`,
    );
    this.name = 'VragenlijstOngeldigError';
  }
}

function isObject(waarde: unknown): waarde is Record<string, unknown> {
  return (
    typeof waarde === 'object' && waarde !== null && !Array.isArray(waarde)
  );
}

function isGeheelGetal(waarde: unknown): waarde is number {
  return typeof waarde === 'number' && Number.isInteger(waarde);
}

function isGevuldeTekst(waarde: unknown): waarde is string {
  return typeof waarde === 'string' && waarde.trim().length > 0;
}

/**
 * Valideert `config` voor één vraag.
 *
 * Dit is testpunt 29 en het sluit een gat dat de database bewust openlaat:
 * `config` is JSONB en Postgres bewaakt de inhoud niet, dus een `rating` met
 * `min = 5` en `max = 1` is daar een geldige rij (ontwerp §2a). Zonder deze
 * controle merkt niemand dat tot een leverancier een onbruikbare vraag ziet.
 */
function controleerConfig(
  type: AntwoordType,
  config: Record<string, unknown>,
  pad: string,
  bezwaren: Bezwaar[],
): void {
  const meld = (veld: string, melding: string) =>
    bezwaren.push({ pad: `${pad}.config.${veld}`, melding });

  // Geldt voor alle typen behalve confirmation: daar is de toelichtingsplicht
  // inhoudelijk bepaald en niet instelbaar (ontwerp §3 vs. §3a).
  if (config.comment !== undefined) {
    if (
      typeof config.comment !== 'string' ||
      !(COMMENTWAARDEN as readonly string[]).includes(config.comment)
    ) {
      meld('comment', `moet een van ${COMMENTWAARDEN.join(', ')} zijn`);
    } else if (type === 'confirmation' && config.comment !== 'required') {
      // Bij confirmation is een niet-bevestiging altijd toelichtingsplichtig en
      // dwingt de database dat af (CHECK in migratie 0005). Een config die iets
      // anders belooft, zou liegen over wat er gebeurt.
      meld(
        'comment',
        "geldt niet bij 'confirmation': de toelichtingsplicht ligt daar vast in de database",
      );
    }
  }

  const opties = config.options;
  if (type === 'single_choice' || type === 'multi_choice') {
    if (!Array.isArray(opties) || opties.length < 1) {
      meld(
        'options',
        'is verplicht bij dit type en moet minstens één optie bevatten',
      );
    } else {
      const codes = new Set<string>();
      opties.forEach((optie, i) => {
        if (!isObject(optie) || !isGevuldeTekst(optie.code)) {
          meld(`options[${i}].code`, 'ontbreekt of is leeg');
          return;
        }
        if (codes.has(optie.code)) {
          meld(`options[${i}].code`, `'${optie.code}' komt dubbel voor`);
        }
        codes.add(optie.code);
        if (!isGevuldeTekst(optie.label)) {
          meld(`options[${i}].label`, 'ontbreekt of is leeg');
        }
      });

      if (type === 'multi_choice') {
        const min = config.min_select;
        const max = config.max_select;
        if (min !== undefined && (!isGeheelGetal(min) || min < 0)) {
          meld('min_select', 'moet een geheel getal ≥ 0 zijn');
        }
        if (max !== undefined && (!isGeheelGetal(max) || max < 1)) {
          meld('max_select', 'moet een geheel getal ≥ 1 zijn');
        }
        if (isGeheelGetal(min) && isGeheelGetal(max) && min > max) {
          meld('min_select', `(${min}) is groter dan max_select (${max})`);
        }
        if (isGeheelGetal(max) && max > opties.length) {
          meld(
            'max_select',
            `(${max}) is groter dan het aantal opties (${opties.length})`,
          );
        }
      }
    }
  } else if (opties !== undefined) {
    meld('options', `hoort niet bij antwoordtype '${type}'`);
  }

  if (type === 'rating') {
    const min = config.min;
    const max = config.max;
    if (!isGeheelGetal(min)) {
      meld('min', 'is verplicht bij een rating en moet een geheel getal zijn');
    }
    if (!isGeheelGetal(max)) {
      meld('max', 'is verplicht bij een rating en moet een geheel getal zijn');
    }
    // Testpunt 29 in één regel.
    if (isGeheelGetal(min) && isGeheelGetal(max) && min >= max) {
      meld('min', `(${min}) moet kleiner zijn dan max (${max})`);
    }
  }

  if (type === 'number') {
    const notatie = config.format;
    if (
      notatie !== undefined &&
      (typeof notatie !== 'string' ||
        !(GETALNOTATIES as readonly string[]).includes(notatie))
    ) {
      meld('format', `moet een van ${GETALNOTATIES.join(', ')} zijn`);
    }
    const decimalen = config.decimals;
    if (
      decimalen !== undefined &&
      (!isGeheelGetal(decimalen) || decimalen < 0 || decimalen > 6)
    ) {
      meld('decimals', 'moet een geheel getal tussen 0 en 6 zijn');
    }
    const min = config.min;
    const max = config.max;
    if (min !== undefined && typeof min !== 'number') {
      meld('min', 'moet een getal zijn');
    }
    if (max !== undefined && typeof max !== 'number') {
      meld('max', 'moet een getal zijn');
    }
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      meld('min', `(${min}) is groter dan max (${max})`);
    }
    if (notatie === 'pct') {
      if (typeof min === 'number' && min < 0) {
        meld('min', "moet ≥ 0 zijn bij format 'pct'");
      }
      if (typeof max === 'number' && max > 100) {
        meld('max', "moet ≤ 100 zijn bij format 'pct'");
      }
    }
  }

  if (type === 'open_text') {
    const min = config.min_length;
    const max = config.max_length;
    if (min !== undefined && (!isGeheelGetal(min) || min < 0)) {
      meld('min_length', 'moet een geheel getal ≥ 0 zijn');
    }
    if (max !== undefined && (!isGeheelGetal(max) || max < 1)) {
      meld('max_length', 'moet een geheel getal ≥ 1 zijn');
    }
    if (isGeheelGetal(min) && isGeheelGetal(max) && min > max) {
      meld('min_length', `(${min}) is groter dan max_length (${max})`);
    }
  }
}

function controleerVraag(
  vraag: unknown,
  index: number,
  categoriesleutels: Set<string>,
  bezwaren: Bezwaar[],
): void {
  const pad = `questions[${index}]`;

  if (!isObject(vraag)) {
    bezwaren.push({ pad, melding: 'is geen object' });
    return;
  }

  if (!isGevuldeTekst(vraag.question_key)) {
    bezwaren.push({
      pad: `${pad}.question_key`,
      melding: 'ontbreekt of is leeg',
    });
  }
  if (!isGevuldeTekst(vraag.title)) {
    bezwaren.push({ pad: `${pad}.title`, melding: 'ontbreekt of is leeg' });
  }
  if (!isGevuldeTekst(vraag.body)) {
    bezwaren.push({ pad: `${pad}.body`, melding: 'ontbreekt of is leeg' });
  }
  if (!isGeheelGetal(vraag.position) || vraag.position < 1) {
    bezwaren.push({
      pad: `${pad}.position`,
      melding: 'moet een geheel getal ≥ 1 zijn',
    });
  }

  const type = vraag.answer_type;
  const typeGeldig =
    typeof type === 'string' &&
    (ANTWOORDTYPEN as readonly string[]).includes(type);

  if (!typeGeldig) {
    bezwaren.push({
      pad: `${pad}.answer_type`,
      melding: `moet een van ${ANTWOORDTYPEN.join(', ')} zijn`,
    });
  }

  // De koppeling loopt via category_key, niet via een UUID (ontwerp §2d):
  // een UUID uit een bestand zou naar andermans rij kunnen wijzen. Leeg of
  // afwezig betekent: vraag zonder categorie.
  const categorieSleutel = vraag.category_key;
  if (
    categorieSleutel !== undefined &&
    categorieSleutel !== null &&
    categorieSleutel !== ''
  ) {
    if (typeof categorieSleutel !== 'string') {
      bezwaren.push({
        pad: `${pad}.category_key`,
        melding: 'moet een tekst zijn',
      });
    } else if (!categoriesleutels.has(categorieSleutel)) {
      bezwaren.push({
        pad: `${pad}.category_key`,
        melding: `verwijst naar categorie '${categorieSleutel}', die niet in dit bestand staat`,
      });
    }
  }

  const verplicht = vraag.is_required ?? true;
  if (typeof verplicht !== 'boolean') {
    bezwaren.push({
      pad: `${pad}.is_required`,
      melding: 'moet true of false zijn',
    });
  }

  const magUploaden = vraag.allows_upload ?? false;
  if (typeof magUploaden !== 'boolean') {
    bezwaren.push({
      pad: `${pad}.allows_upload`,
      melding: 'moet true of false zijn',
    });
  }

  const maxBestanden = vraag.max_files ?? 0;
  if (!isGeheelGetal(maxBestanden) || maxBestanden < 0) {
    bezwaren.push({
      pad: `${pad}.max_files`,
      melding: 'moet een geheel getal ≥ 0 zijn',
    });
  } else if (magUploaden === true) {
    // Spiegelt de CHECK-constraints uit migratie 0005. Hier afvangen levert een
    // bruikbare melding op in plaats van een databasefout op regel 6 van 8.
    if (maxBestanden < 1 || maxBestanden > 5) {
      bezwaren.push({
        pad: `${pad}.max_files`,
        melding: 'moet tussen 1 en 5 liggen wanneer allows_upload true is',
      });
    }
  } else if (maxBestanden !== 0) {
    bezwaren.push({
      pad: `${pad}.max_files`,
      melding: 'moet 0 zijn wanneer allows_upload false is',
    });
  }

  // Een leesblok kan niet verplicht zijn: er valt niets te beantwoorden, dus
  // een vragenlijst met een verplicht instruction-blok zou nooit compleet zijn.
  if (type === 'instruction' && verplicht === true) {
    bezwaren.push({
      pad: `${pad}.is_required`,
      melding: "moet false zijn bij answer_type 'instruction'",
    });
  }

  const config = vraag.config ?? {};
  if (!isObject(config)) {
    bezwaren.push({ pad: `${pad}.config`, melding: 'moet een object zijn' });
  } else if (typeGeldig) {
    controleerConfig(type as AntwoordType, config, pad, bezwaren);
  }
}

/**
 * Controleert een geparsed JSON-document en levert het getypeerd op.
 *
 * Verzamelt álle bezwaren in plaats van bij de eerste te stoppen: wie een
 * vragenlijst van 29 vragen importeert wil niet 29 keer opnieuw proberen.
 *
 * @throws VragenlijstOngeldigError zodra er één bezwaar is
 */
export function valideerVragenlijst(invoer: unknown): VragenlijstInvoer {
  const bezwaren: Bezwaar[] = [];

  if (!isObject(invoer)) {
    throw new VragenlijstOngeldigError([
      { pad: '(document)', melding: 'is geen JSON-object' },
    ]);
  }

  // Vóór alle andere controles: een onbekende formaatversie moet weigeren, niet
  // half inlezen. De meldingen hieronder zouden bij een ander formaat namelijk
  // misleidend zijn — ze beschrijven versie 1.
  if (invoer.schema_version !== SCHEMA_VERSIE) {
    throw new VragenlijstOngeldigError([
      {
        pad: 'schema_version',
        melding: `moet ${SCHEMA_VERSIE} zijn, kreeg ${JSON.stringify(
          invoer.schema_version,
        )}`,
      },
    ]);
  }

  // Expliciet weigeren in plaats van stil negeren. Een bestand met tenant_id
  // erin is opgesteld met een verwachting die dit systeem niet inwilligt; die
  // verwachting hoort hardop weersproken te worden (Issue #7, testpunt 31).
  if ('tenant_id' in invoer) {
    bezwaren.push({
      pad: 'tenant_id',
      melding:
        'hoort niet in een importbestand: de tenant komt altijd uit de sessiecontext',
    });
  }

  // Idem voor UUID's: die worden bij import nieuw gegenereerd (ontwerp §2d).
  for (const veld of ['template_id', 'question_id', 'category_id']) {
    if (veld in invoer) {
      bezwaren.push({
        pad: veld,
        melding:
          'hoort niet in een importbestand: UUIDs worden bij import gegenereerd',
      });
    }
  }

  if (!isGevuldeTekst(invoer.name)) {
    bezwaren.push({ pad: 'name', melding: 'ontbreekt of is leeg' });
  }
  if (!isGeheelGetal(invoer.version) || invoer.version < 1) {
    bezwaren.push({
      pad: 'version',
      melding: 'moet een geheel getal ≥ 1 zijn',
    });
  }

  const categorieen = invoer.categories ?? [];
  const categoriesleutels = new Set<string>();

  if (!Array.isArray(categorieen)) {
    bezwaren.push({ pad: 'categories', melding: 'moet een lijst zijn' });
  } else {
    const posities = new Set<number>();
    const namen = new Set<string>();

    categorieen.forEach((categorie, i) => {
      const pad = `categories[${i}]`;
      if (!isObject(categorie)) {
        bezwaren.push({ pad, melding: 'is geen object' });
        return;
      }
      if (!isGevuldeTekst(categorie.key)) {
        bezwaren.push({ pad: `${pad}.key`, melding: 'ontbreekt of is leeg' });
      } else if (categoriesleutels.has(categorie.key)) {
        bezwaren.push({
          pad: `${pad}.key`,
          melding: `'${categorie.key}' komt dubbel voor`,
        });
      } else {
        categoriesleutels.add(categorie.key);
      }

      if (!isGevuldeTekst(categorie.name)) {
        bezwaren.push({ pad: `${pad}.name`, melding: 'ontbreekt of is leeg' });
      } else if (namen.has(categorie.name)) {
        // Spiegelt UNIQUE (template_id, name).
        bezwaren.push({
          pad: `${pad}.name`,
          melding: `'${categorie.name}' komt dubbel voor`,
        });
      } else {
        namen.add(categorie.name);
      }

      if (!isGeheelGetal(categorie.position) || categorie.position < 1) {
        bezwaren.push({
          pad: `${pad}.position`,
          melding: 'moet een geheel getal ≥ 1 zijn',
        });
      } else if (posities.has(categorie.position)) {
        bezwaren.push({
          pad: `${pad}.position`,
          melding: `positie ${categorie.position} komt dubbel voor`,
        });
      } else {
        posities.add(categorie.position);
      }

      const drempel = categorie.min_answers ?? 0;
      if (!isGeheelGetal(drempel) || drempel < 0) {
        bezwaren.push({
          pad: `${pad}.min_answers`,
          melding: 'moet een geheel getal ≥ 0 zijn',
        });
      }
    });
  }

  const vragen = invoer.questions;

  if (!Array.isArray(vragen) || vragen.length === 0) {
    bezwaren.push({
      pad: 'questions',
      melding: 'moet een lijst met minstens één vraag zijn',
    });
  } else {
    const sleutels = new Set<string>();
    const posities = new Set<number>();

    vragen.forEach((vraag, i) => {
      controleerVraag(vraag, i, categoriesleutels, bezwaren);

      if (!isObject(vraag)) return;

      // Deze twee spiegelen UNIQUE (template_id, question_key) en
      // UNIQUE (template_id, position). De database vangt ze ook af, maar dan
      // als constraintfout zonder aanwijzing wélke twee vragen botsen.
      if (typeof vraag.question_key === 'string') {
        if (sleutels.has(vraag.question_key)) {
          bezwaren.push({
            pad: `questions[${i}].question_key`,
            melding: `'${vraag.question_key}' komt dubbel voor`,
          });
        }
        sleutels.add(vraag.question_key);
      }
      if (isGeheelGetal(vraag.position)) {
        if (posities.has(vraag.position)) {
          bezwaren.push({
            pad: `questions[${i}].position`,
            melding: `positie ${vraag.position} komt dubbel voor`,
          });
        }
        posities.add(vraag.position);
      }
    });
  }

  if (bezwaren.length > 0) {
    throw new VragenlijstOngeldigError(bezwaren);
  }

  return invoer as unknown as VragenlijstInvoer;
}
