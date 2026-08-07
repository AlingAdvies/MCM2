/**
 * De status van één inzending — de centrale waarheid per leverancier.
 *
 * Zie docs/superpowers/plans/2026-08-07-statuswaarheid-per-vendor.md §3.
 *
 * ── Waarom dit één bestand is ───────────────────────────────────────────────
 *
 * De eigenaar vroeg om één plek waar staat hoe elke leverancier ervoor staat.
 * Zou elk scherm en elke route zijn eigen versie van "wanneer is iets
 * beoordeeld" berekenen, dan zijn er binnen een sprint twee waarheden — en
 * dan is het geen centrale waarheid meer.
 *
 * ── Berekend, niet opgeslagen ───────────────────────────────────────────────
 *
 * Er is bewust geen statuskolom. Een opgeslagen status loopt onvermijdelijk
 * uit de pas met de onderliggende feiten: dan staat er "beoordeeld" terwijl er
 * geen oordeel is, en dan liegt juist het veld waar iedereen op vaart.
 *
 * Alles hieronder is af te leiden uit gegevens die er al zijn: submitted_at,
 * closes_at, de ronde-status en het laatste oordeel.
 */

/** De vier statussen die de eigenaar noemde, plus 'te_laat'. */
export const RESPONS_STATUSSEN = [
  'opgestuurd',
  'te_laat',
  'terug',
  'beoordeeld',
  'goedgekeurd',
] as const;

export type ResponsStatus = (typeof RESPONS_STATUSSEN)[number];

/** Wat het scherm toont. Nederlands, want dit is wat de gebruiker leest. */
export const STATUS_LABEL: Record<ResponsStatus, string> = {
  opgestuurd: 'Opgestuurd, nog niet terug',
  te_laat: 'Te laat',
  terug: 'Terug, nog niet beoordeeld',
  beoordeeld: 'Beoordeeld, nog niet goedgekeurd',
  goedgekeurd: 'Beoordeeld en goedgekeurd',
};

/** De feiten waaruit de status volgt. Alles wat de query oplevert. */
export interface StatusFeiten {
  /** Null zolang de leverancier niet heeft ingediend. */
  submittedAt: Date | string | null;
  /** Sluitdatum van de ronde. Null betekent: geen deadline. */
  closesAt: Date | string | null;
  /** Status van de ronde: alleen bij 'active' telt een overschrijding. */
  rondeStatus: string;
  /** Het laatste niet-ingetrokken oordeel, of null wanneer er geen is. */
  laatsteOordeel: string | null;
}

function tijd(waarde: Date | string | null): number | null {
  if (waarde === null) return null;
  const d = waarde instanceof Date ? waarde : new Date(waarde);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/**
 * Bepaalt de status van één inzending.
 *
 * ── De volgorde van de vragen is het ontwerp ────────────────────────────────
 *
 * Eerst indienen, dan pas oordelen. Een respons die nog niet terug is kán geen
 * oordeel hebben (BeoordelingService weigert dat), dus die tak komt eerst en
 * hoeft daarna niet meer gecontroleerd te worden.
 *
 * ── 'te_laat' is geen aparte kolom maar een rekensom ────────────────────────
 *
 * `closes_at < now()` bij een `active` ronde (plan §2b). De eigenaar noemde
 * deze status niet, maar zonder hem verdwijnt een overschrijding in
 * "opgestuurd, nog niet terug" — en dat is juist wat je wél wilt zien.
 *
 * Alleen bij `active`: een ronde in `draft` is nog niet uitgestuurd, en bij
 * `finished` of `archived` is de deadline niet meer interessant.
 *
 * ── Het laatste oordeel telt, ook als dat een goedkeuring ongedaan maakt ────
 *
 * Besluit eigenaar 2026-08-07 (V3, en de vervolgvraag daarop). Schrijft iemand
 * na een goedkeuring alsnog 'niet_goed', dan staat de inzending weer op
 * 'beoordeeld'. Dat is zichtbaar en herstelbaar; een goedkeuring die blijft
 * staan terwijl er een afwijzing onder hangt, is dat niet.
 *
 * Het aantal oordelen hoort daarnaast in het scherm — anders verdwijnt een
 * meningsverschil uit beeld.
 */
export function bepaalStatus(feiten: StatusFeiten): ResponsStatus {
  const ingediend = tijd(feiten.submittedAt);

  if (ingediend === null) {
    const sluit = tijd(feiten.closesAt);

    if (
      feiten.rondeStatus === 'active' &&
      sluit !== null &&
      sluit < Date.now()
    ) {
      return 'te_laat';
    }

    return 'opgestuurd';
  }

  if (feiten.laatsteOordeel === null) {
    return 'terug';
  }

  // Alleen een goedkeuring als LAATSTE oordeel sluit de inzending af. Een
  // eerdere goedkeuring met daarna een inhoudelijk oordeel telt niet meer.
  if (feiten.laatsteOordeel === 'goedgekeurd') {
    return 'goedgekeurd';
  }

  return 'beoordeeld';
}

/**
 * Het SQL-fragment dat het laatste oordeel oplevert.
 *
 * Hier neergezet zodat elke query die de status nodig heeft dezelfde definitie
 * gebruikt van "het laatste oordeel": nieuwste eerst, ingetrokken oordelen
 * buiten beschouwing. Twee queries met een net iets andere ORDER BY leveren
 * twee waarheden op.
 */
export const LAATSTE_OORDEEL_SQL = `
  (SELECT rv.verdict
     FROM clm.survey_review rv
    WHERE rv.response_id = s.response_id
      AND rv.deleted_at IS NULL
    ORDER BY rv.created_at DESC
    LIMIT 1)`;
