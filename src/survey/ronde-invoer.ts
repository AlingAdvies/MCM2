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
  /** Op welk contract deze ronde betrekking heeft. Optioneel — zie migratie 0007. */
  contractId: string | null;
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
    contractId:
      invoer.contractId === undefined || invoer.contractId === null
        ? null
        : leesUuid(invoer.contractId, 'contractId'),
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

/**
 * De vier oordelen uit migratie 0017.
 *
 * Bewust hier herhaald en niet geïmporteerd: dit bestand valideert wat een
 * browser opstuurt en staat daarvoor los van de servicelaag, net als
 * `vendor-invoer.ts`. De koppeling met `beoordeling.service.ts` is een
 * typecontrole verderop in dit bestand — lopen de twee lijsten uiteen, dan
 * faalt de build en niet pas een test.
 */
const OORDELEN = ['goed', 'nadere_vragen', 'niet_goed', 'goedgekeurd'] as const;

/**
 * Oordelen die een onderbouwing vereisen.
 *
 * Expliciet opgesomd en niet als "alles behalve goed": bij het toevoegen van
 * `goedgekeurd` (migratie 0017) zou die uitzonderingsvorm er stilzwijgend een
 * verplichte toelichting van hebben gemaakt.
 */
const VEREIST_TOELICHTING: readonly (typeof OORDELEN)[number][] = [
  'nadere_vragen',
  'niet_goed',
];

export interface NieuweBeoordelingInvoer {
  verdict: (typeof OORDELEN)[number];
  toelichting: string;
}

/**
 * Leest de invoer voor een nieuw oordeel (fase C).
 *
 * De toelichting is verplicht bij `nadere_vragen` en `niet_goed`: zonder reden
 * is zo'n oordeel voor de leverancier én voor een latere lezer onbruikbaar, en
 * juist in een compliance-dossier is de onderbouwing het punt.
 *
 * Bij `goed` valt er vaak niets toe te lichten, en bij `goedgekeurd` is de
 * handtekening de inhoud — wie en wanneer, en dat legt de tabel zelf vast.
 */
export function leesNieuweBeoordeling(body: unknown): NieuweBeoordelingInvoer {
  const invoer = leesObject(body);

  if (
    typeof invoer.verdict !== 'string' ||
    !(OORDELEN as readonly string[]).includes(invoer.verdict)
  ) {
    throw new InvoerFout(
      'verdict',
      `Onbekend oordeel. Toegestaan: ${OORDELEN.join(', ')}.`,
    );
  }

  const verdict = invoer.verdict as (typeof OORDELEN)[number];

  if (
    invoer.toelichting !== undefined &&
    typeof invoer.toelichting !== 'string'
  ) {
    throw new InvoerFout('toelichting', 'De toelichting moet tekst zijn.');
  }

  const toelichting = (invoer.toelichting ?? '').trim();

  // Alleen de inhoudelijke afwijzingen. Zou hier `verdict !== 'goed'` staan,
  // dan zou een goedkeuring een verplichte onderbouwing krijgen — en dat is
  // precies de reden dat deze lijst expliciet is en niet als uitzondering
  // geschreven.
  if (VEREIST_TOELICHTING.includes(verdict) && toelichting === '') {
    throw new InvoerFout(
      'toelichting',
      'Licht toe waarom. Zonder onderbouwing is dit oordeel later niet te herleiden.',
    );
  }

  return { verdict, toelichting };
}

/**
 * Leest wie er als beoordelaar gekoppeld wordt (fase C3).
 *
 * Alleen een user-id. De vragenlijst komt uit het pad en de tenant uit de
 * sessie — die horen niet in een body waar een client ze kan verzinnen.
 */
export function leesBeoordelaar(body: unknown): string {
  const invoer = leesObject(body);

  return leesUuid(invoer.userId, 'userId');
}

/**
 * Hoe lang een notitie mag zijn.
 *
 * Ruim: het gaat om "gebeld, komt volgende week", niet om een rapport. De
 * grens bestaat om te voorkomen dat iemand per ongeluk een heel document in
 * een notitieveld plakt — dan is de lijst onleesbaar en hoort de inhoud
 * ergens anders thuis.
 */
export const NOTITIE_MAX_TEKENS = 4000;

export interface NotitieInvoer {
  tekst: string;
  soort: 'werk' | 'vastgesteld';
}

/**
 * Leest de tekst en het soort van een notitie (migratie 0018, soort sinds
 * migratie 0030).
 *
 * Alleen tekst en soort. De schrijver komt uit de sessie en de respons uit
 * het pad — die horen niet in een body waar een client ze kan verzinnen (§6).
 *
 * `soort` is optioneel in de invoer en valt terug op 'werk': bestaande
 * clients die het veld niet meesturen blijven werken zoals voorheen.
 */
export function leesNotitie(body: unknown): NotitieInvoer {
  const invoer = leesObject(body);

  if (typeof invoer.tekst !== 'string') {
    throw new InvoerFout('tekst', 'De notitie moet tekst zijn.');
  }

  const tekst = invoer.tekst.trim();

  if (tekst === '') {
    throw new InvoerFout('tekst', 'Een lege notitie heeft geen zin.');
  }

  if (tekst.length > NOTITIE_MAX_TEKENS) {
    throw new InvoerFout(
      'tekst',
      `Een notitie is maximaal ${NOTITIE_MAX_TEKENS} tekens. Hoort dit ergens anders thuis?`,
    );
  }

  let soort: 'werk' | 'vastgesteld' = 'werk';
  if (invoer.soort !== undefined && invoer.soort !== null) {
    if (invoer.soort !== 'werk' && invoer.soort !== 'vastgesteld') {
      throw new InvoerFout(
        'soort',
        "Het soort moet 'werk' of 'vastgesteld' zijn.",
      );
    }
    soort = invoer.soort;
  }

  return { tekst, soort };
}
