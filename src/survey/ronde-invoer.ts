/**
 * Validatie van wat een browser opstuurt bij het starten van een ronde en het
 * uitnodigen van leveranciers (fase B van het surveybeheerplan).
 *
 * Zelfde stijl als `vendor-invoer.ts`: handmatig, met `unknown` als invoer, en
 * een `InvoerFout` die het veld meedraagt zodat het scherm de melding naast het
 * juiste invoerveld kan tonen. Bewust geen class-validator ernaast — zie de
 * uitleg daar.
 *
 * ── Waarom de validatie hier strenger is dan bij een leverancier ─────────────
 *
 * Bij een leverancier zijn de regels ruim: een naam mag van alles bevatten, en
 * te streng valideren levert vooral valse afwijzingen op.
 *
 * Hier ligt dat anders. Elke waarde die hier doorheen komt leidt tot het
 * uitgeven van tokens aan externe partijen. Een vergissing in het aantal dagen
 * of in de lijst leveranciers is niet terug te draaien: de tokens zijn dan al
 * uitgegeven, en het ruwe token bestaat maar één keer.
 */

export class InvoerFout extends Error {
  constructor(
    readonly veld: string,
    melding: string,
  ) {
    super(melding);
    this.name = 'InvoerFout';
  }
}

/**
 * Hoe lang een uitnodigingslink geldig is.
 *
 * De standaard van 30 dagen komt uit het tokenontwerp (OV-2) en is wat de
 * demo-seed gebruikt. Instelbaar op verzoek van de eigenaar (2026-08-04), met
 * grenzen eromheen:
 *
 * - **Minimaal 1 dag.** Een link die dezelfde dag verloopt is geen uitnodiging
 *   maar een valstrik — de leverancier heeft geen gelegenheid om te antwoorden.
 * - **Maximaal 180 dagen.** Een half jaar is ruim voor elke jaarcyclus. Langer
 *   maakt van een uitnodiging een permanente toegangssleutel, en dat is precies
 *   wat het tokenontwerp wil vermijden: de link ís de sleutel, er zit geen
 *   wachtwoord achter.
 */
export const GELDIGHEID_STANDAARD_DAGEN = 30;
export const GELDIGHEID_MIN_DAGEN = 1;
export const GELDIGHEID_MAX_DAGEN = 180;

/**
 * Hoeveel leveranciers er in één keer uitgenodigd mogen worden.
 *
 * Niet omdat het datamodel het niet aankan, maar omdat één verzoek één
 * transactie is: bij 500 deelnemers duurt die lang genoeg om een time-out te
 * riskeren, en dan is onduidelijk welke tokens wél zijn uitgegeven. Bij dit
 * aantal is dat geen risico.
 *
 * Loopt een tenant hier tegenaan, dan is dat een aanleiding om over
 * achtergrondverwerking na te denken — niet om deze grens stilletjes te
 * verhogen.
 */
export const MAX_DEELNEMERS_PER_VERZOEK = 200;

/** De soorten ronde die het datamodel kent (CHECK op survey_run, migratie 0003). */
const SOORTEN = ['vendor_compliance', 'internal_review'] as const;

export type RondeSoort = (typeof SOORTEN)[number];

export interface NieuweRonde {
  templateId: string;
  surveyKind: RondeSoort;
  /** Wanneer de ronde sluit. Null betekent: geen sluitdatum. */
  closesAt: Date | null;
  isTest: boolean;
}

export interface Uitnodigingen {
  vendorIds: string[];
  geldigheidDagen: number;
}

/** UUID's zoals Postgres ze uitgeeft. Niet-hoofdlettergevoelig. */
const UUID_PATROON =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function leesUuid(waarde: unknown, veld: string): string {
  if (typeof waarde !== 'string' || !UUID_PATROON.test(waarde)) {
    throw new InvoerFout(veld, `${veld} is geen geldige verwijzing.`);
  }

  return waarde;
}

function leesObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvoerFout('body', 'Er is geen geldige invoer meegestuurd.');
  }

  return body as Record<string, unknown>;
}

/**
 * Leest de invoer voor een nieuwe ronde.
 *
 * `surveyKind` mag ontbreken en wordt dan `vendor_compliance` — de
 * leveranciersuitvraag (UC1), en de enige soort waarvoor in deze fase een
 * scherm bestaat. Het datamodel kent `internal_review` al, dus de route
 * accepteert hem, maar er is geen weg in de frontend die hem stuurt.
 */
export function leesNieuweRonde(body: unknown): NieuweRonde {
  const invoer = leesObject(body);

  const templateId = leesUuid(invoer.templateId, 'templateId');

  const soort = invoer.surveyKind ?? 'vendor_compliance';

  if (!SOORTEN.includes(soort as RondeSoort)) {
    throw new InvoerFout(
      'surveyKind',
      `Onbekende soort ronde. Toegestaan: ${SOORTEN.join(', ')}.`,
    );
  }

  return {
    templateId,
    surveyKind: soort as RondeSoort,
    closesAt: leesSluitdatum(invoer.closesAt),
    // Alleen expliciet `true` telt. Een ronde die per ongeluk als test wordt
    // gemarkeerd valt buiten de rapportage, en dat hoort een bewuste keuze te
    // zijn — niet het gevolg van een meegestuurde string "false".
    isTest: invoer.isTest === true,
  };
}

/**
 * Leest de sluitdatum.
 *
 * Mag ontbreken: een ronde zonder sluitdatum is geldig in het datamodel
 * (`closes_at` is nullable). Wél afgewezen wordt een datum in het verleden —
 * dat is altijd een vergissing, en het levert een ronde op die sluit voordat
 * iemand hem kan invullen.
 */
function leesSluitdatum(waarde: unknown): Date | null {
  if (waarde === undefined || waarde === null || waarde === '') {
    return null;
  }

  if (typeof waarde !== 'string') {
    throw new InvoerFout('closesAt', 'De sluitdatum moet een datum zijn.');
  }

  const datum = new Date(waarde);

  if (Number.isNaN(datum.getTime())) {
    throw new InvoerFout('closesAt', 'Dit is geen geldige datum.');
  }

  if (datum.getTime() <= Date.now()) {
    throw new InvoerFout(
      'closesAt',
      'De sluitdatum ligt in het verleden. Kies een datum in de toekomst.',
    );
  }

  return datum;
}

/**
 * Leest de lijst leveranciers die uitgenodigd worden, plus hoe lang hun link
 * geldig is.
 *
 * ── Waarom dubbele id's hier stranden en niet in de database ────────────────
 *
 * Op `survey_response` ligt een unieke index over (run_id, vendor_id). Twee keer
 * dezelfde leverancier zou daar dus alsnog op een 23505 vastlopen — maar dan
 * midden in een transactie waarin al tokens gegenereerd zijn, met een
 * databasefoutmelding die de beheerder niets zegt.
 *
 * Hier afvangen levert een bruikbare melding op vóórdat er iets gebeurt.
 */
export function leesUitnodigingen(body: unknown): Uitnodigingen {
  const invoer = leesObject(body);

  if (!Array.isArray(invoer.vendorIds) || invoer.vendorIds.length === 0) {
    throw new InvoerFout(
      'vendorIds',
      'Kies minstens één leverancier om uit te nodigen.',
    );
  }

  if (invoer.vendorIds.length > MAX_DEELNEMERS_PER_VERZOEK) {
    throw new InvoerFout(
      'vendorIds',
      `Maximaal ${MAX_DEELNEMERS_PER_VERZOEK} leveranciers per keer.`,
    );
  }

  const vendorIds = invoer.vendorIds.map((id, index) =>
    leesUuid(id, `vendorIds[${index}]`),
  );

  const uniek = new Set(vendorIds.map((id) => id.toLowerCase()));

  if (uniek.size !== vendorIds.length) {
    throw new InvoerFout(
      'vendorIds',
      'Dezelfde leverancier staat er meer dan één keer in.',
    );
  }

  return {
    vendorIds,
    geldigheidDagen: leesGeldigheid(invoer.geldigheidDagen),
  };
}

function leesGeldigheid(waarde: unknown): number {
  if (waarde === undefined || waarde === null || waarde === '') {
    return GELDIGHEID_STANDAARD_DAGEN;
  }

  const dagen = typeof waarde === 'number' ? waarde : Number(waarde);

  if (!Number.isInteger(dagen)) {
    throw new InvoerFout(
      'geldigheidDagen',
      'Het aantal dagen moet een heel getal zijn.',
    );
  }

  if (dagen < GELDIGHEID_MIN_DAGEN || dagen > GELDIGHEID_MAX_DAGEN) {
    throw new InvoerFout(
      'geldigheidDagen',
      `Kies tussen ${GELDIGHEID_MIN_DAGEN} en ${GELDIGHEID_MAX_DAGEN} dagen.`,
    );
  }

  return dagen;
}

/**
 * De statusovergangen die een ronde mag maken.
 *
 * ── Waarom dit een lijst is en geen vrije keuze ─────────────────────────────
 *
 * De CHECK-constraint op `survey_run.status` bewaakt welke waarden bestaan,
 * niet welke volgorde geldig is. Zonder deze tabel kan een afgeronde ronde
 * terug naar `draft` — en dan zou de vragenlijst ontdooien terwijl er al
 * antwoorden op binnen zijn.
 *
 * `archived` is een eindpunt: er gaat geen pijl uit weg.
 */
const OVERGANGEN: Record<string, readonly string[]> = {
  draft: ['active'],
  active: ['finished'],
  finished: ['archived', 'active'],
  archived: [],
};

export function magOvergaan(van: string, naar: string): boolean {
  return (OVERGANGEN[van] ?? []).includes(naar);
}

export function leesStatus(body: unknown): string {
  const invoer = leesObject(body);

  if (typeof invoer.status !== 'string' || !(invoer.status in OVERGANGEN)) {
    throw new InvoerFout(
      'status',
      `Onbekende status. Toegestaan: ${Object.keys(OVERGANGEN).join(', ')}.`,
    );
  }

  return invoer.status;
}

/** Wat er vanuit een status nog mogelijk is — voor een bruikbare foutmelding. */
export function mogelijkeOvergangen(van: string): readonly string[] {
  return OVERGANGEN[van] ?? [];
}
