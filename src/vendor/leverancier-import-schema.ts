import { bepaalScheidingsteken, leesCsv } from './csv-lezer';

/**
 * Een leveranciersbestand inlezen, herkennen en beoordelen — zonder iets weg
 * te schrijven.
 *
 * Dit is de eerste helft van de import: vertel wat er in het bestand staat en
 * wat er mis is, zodat een mens kan besluiten. De tweede helft (wegschrijven)
 * wacht op de geverifieerde tenantcontext uit Issue #7 — zonder die context
 * weet een schrijfroute niet namens wie hij schrijft.
 *
 * GEEN database, GEEN NestJS, GEEN tenant. Dezelfde opzet als
 * `survey/vragenlijst-schema.ts`: een pure functie die los te testen is. Dat
 * was ook de aanbeveling uit de architectuurreview (Issue #54).
 *
 * ── Wat hiervan uit MVM_V2 komt ────────────────────────────────────────────
 * De kolomaliassen en de ene ontwerpkeuze die het overnemen waard is: alleen
 * de kernvelden mappen, en **élke overige kolom onaangeroerd bewaren**. Later
 * verrijken (SBI, rechtsvorm, adres) vraagt dan geen herimport — de gegevens
 * zijn al binnen, alleen de mapping volgt later.
 *
 * Wat er NIET uit MVM_V2 komt: daar wordt niets gevalideerd. `parseCoupaCsv`
 * levert rijen, `mapCoupaRowToVendor` maakt er leveranciers van, en dat gaat
 * rechtstreeks de opslag in. Klopt de koprij niet, dan krijg je 142
 * leveranciers zonder naam. Dat is precies wat deze laag voorkomt.
 */

/** De velden die MCM2 uit een importbestand haalt. */
export interface LeverancierInvoer {
  /** Bronsleutel uit het systeem van herkomst (Coupa `Supplier ID`). */
  externalCode: string | null;
  name: string;
  kvkNumber: string | null;
  country: string | null;
  city: string | null;
  website: string | null;
  annualSpendEur: number | null;
  /** Ruwe impactwaarde uit de bron, nog niet omgezet. */
  impactRuw: string | null;
  contactNaam: string | null;
  contactEmail: string | null;
  /**
   * Elke kolom uit het bestand, ongewijzigd, op de originele kopnaam.
   *
   * Hier staat óók wat wél gemapt is. Dat is bewust: bij een vraag over de
   * herkomst van een waarde is de ruwe rij het antwoord, en dan wil je niet
   * hoeven weten welke kolommen destijds gemapt waren.
   */
  rawAttributes: Record<string, string>;
}

/** Waarom een rij niet gebruikt kan worden, of aandacht vraagt. */
export type BevindingCode =
  | 'naam_ontbreekt'
  | 'dubbel_in_bestand'
  | 'kvk_ongeldig'
  | 'email_ongeldig'
  | 'impact_onbekend'
  | 'bedrag_ongeldig';

/** Blokkerend = deze rij kan niet geïmporteerd worden. */
const BLOKKEREND: ReadonlySet<BevindingCode> = new Set<BevindingCode>([
  'naam_ontbreekt',
  'dubbel_in_bestand',
]);

export interface Bevinding {
  code: BevindingCode;
  /** Voor een mens leesbaar, in het Nederlands. */
  melding: string;
  blokkerend: boolean;
}

export interface BeoordeeldeRij {
  /** Regelnummer in het bestand, koprij meegeteld. Zo verwijst het naar wat de gebruiker in Excel ziet. */
  regel: number;
  invoer: LeverancierInvoer;
  bevindingen: Bevinding[];
  /** Geen blokkerende bevinding: deze rij zou geïmporteerd worden. */
  importeerbaar: boolean;
}

export interface ImportBeoordeling {
  /** Kolomkoppen zoals ze in het bestand staan. */
  koppen: string[];
  /** Welke kopnaam op welk MCM2-veld is uitgekomen. */
  herkendeKolommen: Record<string, string>;
  /** Koppen die op geen enkel bekend veld uitkwamen. Blijven in `rawAttributes`. */
  onbekendeKolommen: string[];
  scheidingsteken: string;
  rijen: BeoordeeldeRij[];
  samenvatting: {
    totaal: number;
    importeerbaar: number;
    geblokkeerd: number;
    metWaarschuwing: number;
    perCode: Record<string, number>;
  };
}

/**
 * Kopnaam → veld. Kleine letters, want kopteksten variëren in schrijfwijze.
 *
 * Zowel de Coupa-namen (uit MVM_V2) als de Nederlandse varianten, omdat een
 * export uit een Nederlands systeem er anders uitziet dan één uit Coupa. Dit
 * is de tabel die je aanpast als het echte bestand andere koppen blijkt te
 * hebben — niet de code eromheen.
 */
const KOLOM_ALIASSEN: Record<
  string,
  keyof Omit<LeverancierInvoer, 'rawAttributes'>
> = {
  // Bronsleutel
  'supplier id': 'externalCode',
  'supplier number': 'externalCode',
  leveranciersnummer: 'externalCode',
  crediteurnummer: 'externalCode',
  // Naam
  'supplier name': 'name',
  leverancier: 'name',
  leveranciersnaam: 'name',
  naam: 'name',
  bedrijfsnaam: 'name',
  // KvK
  'kvk number': 'kvkNumber',
  kvknummer: 'kvkNumber',
  'kvk-nummer': 'kvkNumber',
  kvk: 'kvkNumber',
  // Land en plaats
  country: 'country',
  land: 'country',
  city: 'city',
  plaats: 'city',
  stad: 'city',
  vestigingsplaats: 'city',
  website: 'website',
  // Bedrag
  'annual spend': 'annualSpendEur',
  'annual spend eur': 'annualSpendEur',
  jaarbedrag: 'annualSpendEur',
  jaaromzet: 'annualSpendEur',
  // Impact
  'impact classification': 'impactRuw',
  'impact tier': 'impactRuw',
  impact: 'impactRuw',
  // Contactpersoon
  'primary contact name': 'contactNaam',
  'contact name': 'contactNaam',
  contactpersoon: 'contactNaam',
  'primary contact email': 'contactEmail',
  'contact email': 'contactEmail',
  'e-mail': 'contactEmail',
  email: 'contactEmail',
  emailadres: 'contactEmail',
};

/** De impactwaarden die de bron kan leveren. `null` = niet herkend. */
export function duidImpact(
  ruw: string | null,
): 'high' | 'medium' | 'low' | null {
  if (ruw === null) return null;
  const genormaliseerd = ruw.trim().toLowerCase();
  if (genormaliseerd === '') return null;
  if (genormaliseerd.startsWith('high') || genormaliseerd.startsWith('hoog'))
    return 'high';
  if (
    genormaliseerd.startsWith('medium') ||
    genormaliseerd.startsWith('midden')
  )
    return 'medium';
  if (genormaliseerd.startsWith('low') || genormaliseerd.startsWith('laag'))
    return 'low';
  return null;
}

/**
 * Leest een bedrag uit een tekstveld.
 *
 * Zowel `4800000` als `4.800.000,00` als `€ 4,800,000.00` komen voor. De
 * laatste twee zijn niet met één regel te onderscheiden — `1.234` is duizend
 * tweehonderdvierendertig in Nederland en één-komma-tweehonderdvierendertig
 * elders. De regel hier: het laatste scheidingsteken met precies twee cijfers
 * erachter is de decimaalkomma; al het andere is duizendtalscheiding.
 */
export function leesBedrag(ruw: string | null): {
  waarde: number | null;
  geldig: boolean;
} {
  if (ruw === null) return { waarde: null, geldig: true };

  const schoon = ruw.replace(/[€$\s]/g, '').trim();
  if (schoon === '') return { waarde: null, geldig: true };

  const laatsteKomma = schoon.lastIndexOf(',');
  const laatstePunt = schoon.lastIndexOf('.');
  const laatste = Math.max(laatsteKomma, laatstePunt);

  let genormaliseerd: string;
  if (laatste !== -1 && schoon.length - laatste - 1 === 2) {
    // Twee cijfers achter het laatste scheidingsteken: decimalen.
    genormaliseerd =
      schoon.slice(0, laatste).replace(/[.,]/g, '') +
      '.' +
      schoon.slice(laatste + 1);
  } else {
    genormaliseerd = schoon.replace(/[.,]/g, '');
  }

  if (!/^-?\d+(\.\d+)?$/.test(genormaliseerd)) {
    return { waarde: null, geldig: false };
  }

  const getal = Number(genormaliseerd);
  return Number.isFinite(getal)
    ? { waarde: getal, geldig: true }
    : { waarde: null, geldig: false };
}

/**
 * Een KvK-nummer is acht cijfers.
 *
 * Alleen de vorm, niet het bestaan — dat vraagt de KvK-API en dat is een
 * aparte beslissing. Leeg is geldig: niet elke leverancier is Nederlands.
 */
export function kvkGeldig(ruw: string | null): boolean {
  if (ruw === null || ruw.trim() === '') return true;
  return /^\d{8}$/.test(ruw.trim());
}

/**
 * Grove vormcontrole op een e-mailadres.
 *
 * Bewust grof: een sluitende controle bestaat niet, en het adres wordt hier
 * niet gebruikt om iets te versturen. Het doel is een typefout opmerken —
 * een ontbrekend apenstaartje — niet RFC 5322 nabouwen.
 */
export function emailGeldig(ruw: string | null): boolean {
  if (ruw === null || ruw.trim() === '') return true;
  const t = ruw.trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t);
}

/** Leest de tekst in en beoordeelt elke rij. Schrijft niets weg. */
export function beoordeelImportbestand(tekst: string): ImportBeoordeling {
  const inhoud = leesCsv(tekst);

  const herkendeKolommen: Record<string, string> = {};
  const onbekendeKolommen: string[] = [];

  // Kop-index → veldnaam, zodat elke cel weet waar hij hoort.
  const veldPerIndex: (
    keyof Omit<LeverancierInvoer, 'rawAttributes'> | null
  )[] = inhoud.koppen.map((kop) => {
    const veld = KOLOM_ALIASSEN[kop.toLowerCase()] ?? null;
    if (veld) herkendeKolommen[kop] = veld;
    else if (kop.trim() !== '') onbekendeKolommen.push(kop);
    return veld;
  });

  // Dubbele leveranciers opsporen. Sleutel: KvK-nummer als dat er is, anders
  // de naam in kleine letters. Op KvK vóór naam, want twee vestigingen van
  // dezelfde holding kunnen dezelfde naam hebben en een ander KvK-nummer —
  // dat zijn twee leveranciers, geen duplicaat.
  const eerderGezien = new Map<string, number>();

  const rijen: BeoordeeldeRij[] = inhoud.rijen.map((cellen, index) => {
    const regel = index + 2; // koprij is regel 1
    const invoer = maakInvoer(cellen, inhoud.koppen, veldPerIndex);
    const bevindingen: Bevinding[] = [];

    if (invoer.name.trim() === '') {
      bevindingen.push({
        code: 'naam_ontbreekt',
        melding: 'Deze rij heeft geen leveranciersnaam.',
        blokkerend: true,
      });
    }

    const sleutel =
      invoer.kvkNumber && invoer.kvkNumber.trim() !== ''
        ? `kvk:${invoer.kvkNumber.trim()}`
        : `naam:${invoer.name.trim().toLowerCase()}`;

    if (invoer.name.trim() !== '') {
      const eerder = eerderGezien.get(sleutel);
      if (eerder !== undefined) {
        bevindingen.push({
          code: 'dubbel_in_bestand',
          melding: `Deze leverancier staat ook op regel ${eerder}.`,
          blokkerend: true,
        });
      } else {
        eerderGezien.set(sleutel, regel);
      }
    }

    if (!kvkGeldig(invoer.kvkNumber)) {
      bevindingen.push({
        code: 'kvk_ongeldig',
        melding: `'${invoer.kvkNumber}' is geen KvK-nummer van acht cijfers.`,
        blokkerend: false,
      });
    }

    if (!emailGeldig(invoer.contactEmail)) {
      bevindingen.push({
        code: 'email_ongeldig',
        melding: `'${invoer.contactEmail}' lijkt geen e-mailadres.`,
        blokkerend: false,
      });
    }

    if (invoer.impactRuw !== null && invoer.impactRuw.trim() !== '') {
      if (duidImpact(invoer.impactRuw) === null) {
        bevindingen.push({
          code: 'impact_onbekend',
          melding: `Impactwaarde '${invoer.impactRuw}' is niet herkend.`,
          blokkerend: false,
        });
      }
    }

    const bedrag = leesBedrag(
      rauweWaarde(cellen, veldPerIndex, 'annualSpendEur'),
    );
    if (!bedrag.geldig) {
      bevindingen.push({
        code: 'bedrag_ongeldig',
        melding: 'Het jaarbedrag is geen getal.',
        blokkerend: false,
      });
    }

    return {
      regel,
      invoer,
      bevindingen,
      importeerbaar: !bevindingen.some((b) => b.blokkerend),
    };
  });

  const perCode: Record<string, number> = {};
  for (const rij of rijen) {
    for (const b of rij.bevindingen) {
      perCode[b.code] = (perCode[b.code] ?? 0) + 1;
    }
  }

  return {
    koppen: inhoud.koppen,
    herkendeKolommen,
    onbekendeKolommen,
    scheidingsteken: inhoud.scheidingsteken,
    rijen,
    samenvatting: {
      totaal: rijen.length,
      importeerbaar: rijen.filter((r) => r.importeerbaar).length,
      geblokkeerd: rijen.filter((r) => !r.importeerbaar).length,
      metWaarschuwing: rijen.filter(
        (r) => r.importeerbaar && r.bevindingen.length > 0,
      ).length,
      perCode,
    },
  };
}

/** Haalt de ruwe waarde van één veld uit een rij, vóór omzetting. */
function rauweWaarde(
  cellen: string[],
  veldPerIndex: (keyof Omit<LeverancierInvoer, 'rawAttributes'> | null)[],
  veld: keyof Omit<LeverancierInvoer, 'rawAttributes'>,
): string | null {
  const index = veldPerIndex.indexOf(veld);
  if (index === -1) return null;
  const waarde = cellen[index];
  return waarde === undefined ? null : waarde;
}

function maakInvoer(
  cellen: string[],
  koppen: string[],
  veldPerIndex: (keyof Omit<LeverancierInvoer, 'rawAttributes'> | null)[],
): LeverancierInvoer {
  const invoer: LeverancierInvoer = {
    externalCode: null,
    name: '',
    kvkNumber: null,
    country: null,
    city: null,
    website: null,
    annualSpendEur: null,
    impactRuw: null,
    contactNaam: null,
    contactEmail: null,
    rawAttributes: {},
  };

  cellen.forEach((cel, i) => {
    const waarde = cel.trim();

    // Élke kolom bewaren, ook de gemapte. Zie de toelichting bij
    // `rawAttributes`.
    const kop = koppen[i];
    if (kop !== undefined && kop.trim() !== '') {
      invoer.rawAttributes[kop] = waarde;
    }

    const veld = veldPerIndex[i];
    if (!veld) return;

    if (veld === 'name') {
      invoer.name = waarde;
    } else if (veld === 'annualSpendEur') {
      invoer.annualSpendEur = leesBedrag(waarde).waarde;
    } else {
      invoer[veld] = waarde === '' ? null : waarde;
    }
  });

  return invoer;
}

/** Alleen voor tests en foutmeldingen: welke bevindingcodes blokkeren. */
export function isBlokkerend(code: BevindingCode): boolean {
  return BLOKKEREND.has(code);
}

export { bepaalScheidingsteken, leesCsv };
