import { bepaalScheidingsteken, leesCsv } from '../vendor/csv-lezer';

/**
 * Een contract-CSV inlezen, herkennen en beoordelen — zonder iets weg te
 * schrijven. Zelfde opzet als `vendor/leverancier-import-schema.ts` (pure
 * functie, geen database, geen NestJS, geen tenant), maar een ander
 * kolommencontract: negen kolommen verspreid over `contract`, `vendor` en
 * `vendor_contact` (#198).
 *
 * ── Waarom dit GEEN hergebruik is van leverancier-import-schema.ts ─────────
 * Die module is gebouwd voor een rijke vendor-only-import (KvK, land, stad,
 * website, jaarbedrag, impact...). Geen van die velden komt voor in deze
 * negen kolommen — alleen `vendor.name`, `vendor.category_code` en
 * `vendor.coupa_supplier_number` zijn gedeeld, en die spelen hier een andere
 * rol: matchcontext voor een find-or-create, niet velden om rijkelijk te
 * vullen. Zie docs/superpowers/specs/2026-08-31-contract-import-design.md §0.
 *
 * De CSV-lezer zelf (`csv-lezer.ts`) is wel hergebruikt — dat stuk is
 * generiek (RFC4180) en heeft niets met vendors of contracten te maken.
 */

/** De velden die MCM2 uit een contract-importbestand haalt. */
export interface ContractImportInvoer {
  contractName: string;
  contractNumber: string | null;
  contractType: string | null;
  /** ISO-vorm (JJJJ-MM-DD) ná omzetting, ongeacht bronformaat. */
  startDate: string | null;
  endDate: string | null;
  note: string | null;
  vendorName: string;
  vendorCategoryCode: string | null;
  vendorCoupaSupplierNumber: string | null;
  contactEmail: string | null;
  contactFullName: string | null;
  /** Elke kolom uit het bestand, ongewijzigd, op de originele kopnaam. */
  rawAttributes: Record<string, string>;
}

/** Waarom een rij niet gebruikt kan worden, of aandacht vraagt. */
export type ContractBevindingCode =
  | 'contract_naam_ontbreekt'
  | 'vendor_naam_ontbreekt'
  | 'datum_ongeldig'
  | 'datum_volgorde_ongeldig'
  | 'email_ongeldig'
  | 'vendor_geen_matchsleutel'
  | 'vendor_afwijkt'
  | 'categorie_onbekend'
  | 'contactgegevens_onvolledig';

/** Blokkerend = deze rij kan niet geïmporteerd worden. */
const BLOKKEREND: ReadonlySet<ContractBevindingCode> =
  new Set<ContractBevindingCode>([
    'contract_naam_ontbreekt',
    'vendor_naam_ontbreekt',
    'datum_volgorde_ongeldig',
  ]);

export interface ContractBevinding {
  code: ContractBevindingCode;
  /** Voor een mens leesbaar, in het Nederlands. */
  melding: string;
  blokkerend: boolean;
}

export interface BeoordeeldeContractRij {
  /** Regelnummer in het bestand, koprij meegeteld. */
  regel: number;
  invoer: ContractImportInvoer;
  bevindingen: ContractBevinding[];
  importeerbaar: boolean;
}

export interface ContractImportBeoordeling {
  koppen: string[];
  herkendeKolommen: Record<string, string>;
  onbekendeKolommen: string[];
  scheidingsteken: string;
  rijen: BeoordeeldeContractRij[];
  samenvatting: {
    totaal: number;
    importeerbaar: number;
    geblokkeerd: number;
    metWaarschuwing: number;
    perCode: Record<string, number>;
  };
}

/**
 * Kopnaam → veld. Nederlandse namen plus de vorm die de gap-analyse-export
 * gebruikt (punt-notatie zoals `contract.name`). Kleine letters, want
 * kopteksten variëren in schrijfwijze.
 */
const KOLOM_ALIASSEN: Record<
  string,
  keyof Omit<ContractImportInvoer, 'rawAttributes'>
> = {
  'contract.name': 'contractName',
  contractnaam: 'contractName',
  'naam contract': 'contractName',

  'contract.contract_number': 'contractNumber',
  contractnummer: 'contractNumber',

  'contract.contract_type': 'contractType',
  contracttype: 'contractType',

  'contract.start_date': 'startDate',
  startdatum: 'startDate',

  'contract.end_date': 'endDate',
  einddatum: 'endDate',

  'contract.note': 'note',
  notitie: 'note',
  toelichting: 'note',

  'vendor.name': 'vendorName',
  leverancier: 'vendorName',
  leveranciersnaam: 'vendorName',

  'vendor.category_code': 'vendorCategoryCode',
  categorie: 'vendorCategoryCode',

  'vendor.coupa_supplier_number': 'vendorCoupaSupplierNumber',
  'coupa supplier number': 'vendorCoupaSupplierNumber',
  coupanummer: 'vendorCoupaSupplierNumber',

  'vendor_contact.email': 'contactEmail',
  'contact email': 'contactEmail',
  contactpersoon_email: 'contactEmail',

  'vendor_contact.full_name': 'contactFullName',
  'contact naam': 'contactFullName',
  contactpersoon_naam: 'contactFullName',
};

/**
 * Grove vormcontrole op een e-mailadres. Zelfde regel als
 * `leverancier-import-schema.ts`.
 */
export function emailGeldig(ruw: string | null): boolean {
  if (ruw === null || ruw.trim() === '') return true;
  const t = ruw.trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t);
}

/**
 * Zet een `DD-MM-YYYY`-datum (het bronformaat van deze CSV, besluit
 * eigenaar 2026-08-31) om naar ISO (`JJJJ-MM-DD`), zoals de rest van de
 * applicatie verwacht (`contract-invoer.ts`'s `optioneleDatum`).
 *
 * Geeft `null` bij een leeg veld, en `{ geldig: false }` bij een niet te
 * herkennen formaat — nooit een gok naar een andere datum.
 */
export function leesContractDatum(ruw: string | null): {
  waarde: string | null;
  geldig: boolean;
} {
  if (ruw === null) return { waarde: null, geldig: true };

  const schoon = ruw.trim();
  if (schoon === '') return { waarde: null, geldig: true };

  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(schoon);
  if (!match) {
    return { waarde: null, geldig: false };
  }

  const [, dag, maand, jaar] = match;
  const iso = `${jaar}-${maand}-${dag}`;

  // Bouw de datum terug en vergelijk: verwerpt 31-02-2026, niet alleen de
  // vorm. new Date met een month-index (maand - 1) rondt anders stilzwijgend
  // af naar de eerstvolgende geldige datum.
  const dagGetal = Number(dag);
  const maandGetal = Number(maand);
  const jaarGetal = Number(jaar);
  const gecontroleerd = new Date(Date.UTC(jaarGetal, maandGetal - 1, dagGetal));

  const geldig =
    gecontroleerd.getUTCFullYear() === jaarGetal &&
    gecontroleerd.getUTCMonth() === maandGetal - 1 &&
    gecontroleerd.getUTCDate() === dagGetal;

  return geldig
    ? { waarde: iso, geldig: true }
    : { waarde: null, geldig: false };
}

/** Alleen voor tests en foutmeldingen: welke bevindingcodes blokkeren. */
export function isBlokkerend(code: ContractBevindingCode): boolean {
  return BLOKKEREND.has(code);
}

/**
 * Leest de tekst in en beoordeelt elke rij. Schrijft niets weg, doet geen
 * databasequery — vendor/contact-matching gebeurt pas bij het bevestigen
 * (`contract-import.service.ts`), binnen de tenanttransactie. Deze functie
 * kan daarom niet de `vendor_afwijkt`/`categorie_onbekend`-bevindingen
 * vaststellen (die vragen een databaseraadpleging) — die worden tijdens het
 * bevestigen toegevoegd aan het resultaat, niet hier tijdens de preview.
 */
export function beoordeelContractImportbestand(
  tekst: string,
): ContractImportBeoordeling {
  const inhoud = leesCsv(tekst);

  const herkendeKolommen: Record<string, string> = {};
  const onbekendeKolommen: string[] = [];

  const veldPerIndex: (
    keyof Omit<ContractImportInvoer, 'rawAttributes'> | null
  )[] = inhoud.koppen.map((kop) => {
    const veld = KOLOM_ALIASSEN[kop.toLowerCase()] ?? null;
    if (veld) herkendeKolommen[kop] = veld;
    else if (kop.trim() !== '') onbekendeKolommen.push(kop);
    return veld;
  });

  const rijen: BeoordeeldeContractRij[] = inhoud.rijen.map((cellen, index) => {
    const regel = index + 2; // koprij is regel 1
    const invoer = maakInvoer(cellen, inhoud.koppen, veldPerIndex);
    const bevindingen: ContractBevinding[] = [];

    if (invoer.contractName.trim() === '') {
      bevindingen.push({
        code: 'contract_naam_ontbreekt',
        melding: 'Deze rij heeft geen contractnaam.',
        blokkerend: true,
      });
    }

    if (invoer.vendorName.trim() === '') {
      bevindingen.push({
        code: 'vendor_naam_ontbreekt',
        melding: 'Deze rij heeft geen leveranciersnaam.',
        blokkerend: true,
      });
    }

    if (
      invoer.vendorCoupaSupplierNumber === null ||
      invoer.vendorCoupaSupplierNumber.trim() === ''
    ) {
      bevindingen.push({
        code: 'vendor_geen_matchsleutel',
        melding:
          'Geen Coupa-leveranciersnummer: deze rij maakt altijd een nieuwe leverancier aan, ook als er al een leverancier met deze naam bestaat.',
        blokkerend: false,
      });
    }

    const startResultaat = leesContractDatum(invoer.startDate);
    if (!startResultaat.geldig) {
      bevindingen.push({
        code: 'datum_ongeldig',
        melding: `'${invoer.startDate}' is geen geldige datum (verwacht DD-MM-JJJJ).`,
        blokkerend: false,
      });
    }

    const eindResultaat = leesContractDatum(invoer.endDate);
    if (!eindResultaat.geldig) {
      bevindingen.push({
        code: 'datum_ongeldig',
        melding: `'${invoer.endDate}' is geen geldige datum (verwacht DD-MM-JJJJ).`,
        blokkerend: false,
      });
    }

    if (
      startResultaat.geldig &&
      eindResultaat.geldig &&
      startResultaat.waarde &&
      eindResultaat.waarde &&
      startResultaat.waarde > eindResultaat.waarde
    ) {
      bevindingen.push({
        code: 'datum_volgorde_ongeldig',
        melding: 'De einddatum ligt vóór de begindatum.',
        blokkerend: true,
      });
    }

    if (!emailGeldig(invoer.contactEmail)) {
      bevindingen.push({
        code: 'email_ongeldig',
        melding: `'${invoer.contactEmail}' lijkt geen e-mailadres.`,
        blokkerend: false,
      });
    }

    const heeftEmail =
      invoer.contactEmail !== null && invoer.contactEmail.trim() !== '';
    const heeftNaam =
      invoer.contactFullName !== null && invoer.contactFullName.trim() !== '';

    if (heeftEmail !== heeftNaam) {
      bevindingen.push({
        code: 'contactgegevens_onvolledig',
        melding:
          'Alleen e-mailadres of alleen naam ingevuld: dit contract wordt aangemaakt zonder contactpersoon.',
        blokkerend: false,
      });
    }

    // Genormaliseerde datums teruggeven in ISO, ongeacht of ze geldig waren
    // (bij ongeldig blijft de waarde null — de bevinding hierboven maakt
    // duidelijk waarom).
    invoer.startDate = startResultaat.waarde;
    invoer.endDate = eindResultaat.waarde;

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

function maakInvoer(
  cellen: string[],
  koppen: string[],
  veldPerIndex: (keyof Omit<ContractImportInvoer, 'rawAttributes'> | null)[],
): ContractImportInvoer {
  const invoer: ContractImportInvoer = {
    contractName: '',
    contractNumber: null,
    contractType: null,
    startDate: null,
    endDate: null,
    note: null,
    vendorName: '',
    vendorCategoryCode: null,
    vendorCoupaSupplierNumber: null,
    contactEmail: null,
    contactFullName: null,
    rawAttributes: {},
  };

  cellen.forEach((cel, i) => {
    const waarde = cel.trim();

    const kop = koppen[i];
    if (kop !== undefined && kop.trim() !== '') {
      invoer.rawAttributes[kop] = waarde;
    }

    const veld = veldPerIndex[i];
    if (!veld) return;

    if (veld === 'contractName' || veld === 'vendorName') {
      invoer[veld] = waarde;
    } else {
      invoer[veld] = waarde === '' ? null : waarde;
    }
  });

  return invoer;
}

export { bepaalScheidingsteken, leesCsv };
