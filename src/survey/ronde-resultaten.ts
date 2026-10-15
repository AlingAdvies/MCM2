import { Optie, optiesUit } from './antwoord-opties';

/**
 * Het resultaat van één ronde: per vraag hoe vaak elke optie gekozen is, en
 * per leverancier wat hij koos (NIS2-doorsnede, ADR 0006 stap 5).
 *
 * Bewust géén score en geen oordeel: dat is blok 7 (scoring) en komt pas na
 * de doorsnede, in eigen tabellen. Dit telt alleen wat er is.
 *
 * Los van de service zodat de rekenregels zonder database te testen zijn.
 */

export interface ResultaatVraagInvoer {
  questionKey: string;
  title: string;
  answerType: string;
  categorieNaam: string | null;
  config: unknown;
}

export interface ResultaatLeverancier {
  responseId: string;
  vendorNaam: string | null;
  ingediend: boolean;
  /** question_key → gekozen code. Leeg zolang er niet is ingediend. */
  antwoorden: Record<string, string>;
}

export interface ResultaatVraag {
  questionKey: string;
  title: string;
  answerType: string;
  categorieNaam: string | null;
  opties: Optie[] | null;
  /** code → aantal ingediende antwoorden met die code. */
  verdeling: Record<string, number>;
}

export interface RondeResultaten {
  aantalDeelnemers: number;
  aantalIngediend: number;
  vragen: ResultaatVraag[];
  leveranciers: ResultaatLeverancier[];
}

export function bouwResultaten(
  vragen: ResultaatVraagInvoer[],
  deelnemers: ResultaatLeverancier[],
): RondeResultaten {
  // Een concept kan nog veranderen en hoort niet in een resultaat. Zonder
  // deze regel telt een half ingevulde lijst mee alsof hij af is.
  const leveranciers = deelnemers.map((d) =>
    d.ingediend ? d : { ...d, antwoorden: {} },
  );

  const resultaatVragen = vragen
    .filter((v) => v.answerType !== 'instruction')
    .map((v) => {
      const verdeling: Record<string, number> = {};
      for (const l of leveranciers) {
        const code = l.antwoorden[v.questionKey];
        if (code !== undefined) verdeling[code] = (verdeling[code] ?? 0) + 1;
      }
      return {
        questionKey: v.questionKey,
        title: v.title,
        answerType: v.answerType,
        categorieNaam: v.categorieNaam,
        opties: optiesUit(v.answerType, v.config),
        verdeling,
      };
    });

  return {
    aantalDeelnemers: leveranciers.length,
    aantalIngediend: leveranciers.filter((l) => l.ingediend).length,
    vragen: resultaatVragen,
    leveranciers,
  };
}
