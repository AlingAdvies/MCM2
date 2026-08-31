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

/**
 * Een extra contactkanaal naast het primaire paar — uit een genummerde
 * kolom (`vendor_contact.email_2`, `vendor_contact.full_name_2`, ...). Zie
 * design-document §10.3: bewust geen vendor_contact-rij, alleen een
 * hulplijst om na de import handmatig te verwerken.
 */
export interface ExtraContactInvoer {
  volgnummer: number;
  email: string | null;
  fullName: string | null;
}

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
  /** Geduid tegen de vaste, platform-brede waardenlijst (ref.business_criticality). */
  vendorBusinessCriticalityCode: string | null;
  /** Geduid tegen de vaste, platform-brede waardenlijst (ref.business_risk_tier). */
  contractBusinessRiskTierCode: string | null;
  contactEmail: string | null;
  contactFullName: string | null;
  extraContacten: ExtraContactInvoer[];
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
  | 'categorie_wordt_aangemaakt'
  | 'business_criticality_onbekend'
  | 'business_risk_tier_onbekend'
  | 'extra_contactgegevens_gevonden';

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
  keyof Omit<ContractImportInvoer, 'rawAttributes' | 'extraContacten'>
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

  'vendor.business_criticality_code': 'vendorBusinessCriticalityCode',
  criticaliteit: 'vendorBusinessCriticalityCode',
  'cyber criticaliteit': 'vendorBusinessCriticalityCode',

  'contract.business_risk_tier_code': 'contractBusinessRiskTierCode',
  'business risk tier': 'contractBusinessRiskTierCode',
  risicoclassificatie: 'contractBusinessRiskTierCode',

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
 * Duidt `vendor.business_criticality_code` tegen de vaste, platform-brede
 * waardenlijst (`ref.business_criticality`: critical/high/medium/low).
 * Anders dan vendor-categorie mag dit veld GEEN nieuwe waarden aanmaken —
 * het is platform-breed, niet tenant-eigen. `null` bij een niet-herkende
 * tekst; de rij blokkeert daar niet op, het veld blijft dan leeg.
 */
export function duidBusinessCriticality(
  ruw: string | null,
): 'critical' | 'high' | 'medium' | 'low' | null {
  if (ruw === null) return null;
  const t = ruw.trim().toLowerCase();
  if (t === '') return null;
  if (t.startsWith('krit') || t.startsWith('critical')) return 'critical';
  if (t.startsWith('hoog') || t.startsWith('high')) return 'high';
  if (
    t.startsWith('gemidd') ||
    t.startsWith('midden') ||
    t.startsWith('medium')
  )
    return 'medium';
  if (t.startsWith('laag') || t.startsWith('low')) return 'low';
  return null;
}

/**
 * Duidt `contract.business_risk_tier_code` tegen de vaste, platform-brede
 * waardenlijst (`ref.business_risk_tier`: tier_1/tier_2/tier_3). Een echte
 * export schrijft de rest van de tekst erbij ('Tier 2  Medium impact') —
 * alleen het cijfer bepaalt de match, de rest van de tekst wordt genegeerd.
 */
export function duidBusinessRiskTier(
  ruw: string | null,
): 'tier_1' | 'tier_2' | 'tier_3' | null {
  if (ruw === null) return null;
  const match = /tier\s*([123])/i.exec(ruw);
  if (!match) return null;
  return `tier_${match[1]}` as const as 'tier_1' | 'tier_2' | 'tier_3';
}

/**
 * Zet een `D(D)-M(M)-YYYY`-datum (het bronformaat van deze CSV, besluit
 * eigenaar 2026-08-31) om naar ISO (`JJJJ-MM-DD`), zoals de rest van de
 * applicatie verwacht (`contract-invoer.ts`'s `optioneleDatum`).
 *
 * Dag en maand mogen zowel `1` als `01` zijn: een échte Transdev-export
 * (Coupa/Excel) schrijft standaard zonder voorloopnul (`1-4-2019`), en een
 * regex die alleen `\d{2}` toestond wees zulke — geldige — datums af als
 * "onbekend formaat" (gevonden bij het eerste gebruik van deze import,
 * 2026-08-31).
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

  const match = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(schoon);
  if (!match) {
    return { waarde: null, geldig: false };
  }

  const [, dag, maand, jaar] = match;
  const iso = `${jaar}-${maand.padStart(2, '0')}-${dag.padStart(2, '0')}`;

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
const UUID_REGEX_LOKAAL =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Kopnaam van een kolom die `contract.vendor_contact_id` (of een schrijfvariant
 * daarvan) heet. Een echte Transdev-export vult deze kolom in de praktijk met
 * een NAAM ("Bart Philips") in plaats van een ID — de kolom is voor een
 * toekomstige, correcte koppeling naar een bestaand contactpersoon-ID bedoeld,
 * maar wordt in de praktijk als naamveld gebruikt (gevonden 31-08, besluit
 * eigenaar: alleen gebruiken als `vendor_contact.full_name` zelf leeg is, en
 * alleen als de waarde geen geldig UUID is — anders zou het een echte
 * ID-verwijzing kunnen zijn).
 */
function isVendorContactIdKolom(kopKleineLetters: string): boolean {
  return (
    kopKleineLetters === 'contract.vendor_contact_id' ||
    kopKleineLetters === 'vendor_contact_id'
  );
}

/**
 * Herkent `vendor_contact.email_2`, `vendor_contact.full_name_3`, enz. —
 * genummerde kolommen voor extra contactkanalen naast het primaire paar
 * (design-document §10.3). `null` als de kop geen genummerde
 * contact-kolom is.
 */
function herkenExtraContactKolom(
  kopKleineLetters: string,
): { soort: 'email' | 'fullName'; volgnummer: number } | null {
  const match = /^vendor_contact\.(email|full_name)_(\d+)$/.exec(
    kopKleineLetters,
  );
  if (!match) return null;

  const [, soort, volgnummerRuw] = match;
  const volgnummer = Number(volgnummerRuw);

  // _1 zou het primaire paar dupliceren (dat heeft al geen suffix) — niet
  // als extra kolom behandelen, gewoon als onbekende kolom laten vallen.
  if (volgnummer < 2) return null;

  return { soort: soort === 'email' ? 'email' : 'fullName', volgnummer };
}

export function beoordeelContractImportbestand(
  tekst: string,
): ContractImportBeoordeling {
  const inhoud = leesCsv(tekst);

  const herkendeKolommen: Record<string, string> = {};
  const onbekendeKolommen: string[] = [];

  // Index -> extra-contact-plek, apart van veldPerIndex: een genummerde
  // kolom hoort niet bij een vast ContractImportInvoer-veld maar bij een
  // dynamische lijst (extraContacten).
  const extraContactPerIndex: ReturnType<typeof herkenExtraContactKolom>[] = [];
  const veldPerIndex: (
    keyof Omit<ContractImportInvoer, 'rawAttributes' | 'extraContacten'> | null
  )[] = [];

  // Index van de 'contract.vendor_contact_id'-kolom, indien aanwezig — apart
  // van veldPerIndex omdat de conditie (leeg + geen UUID) pas ná de volledige
  // rij bekend is, zie maakInvoer().
  let vendorContactIdKolomIndex: number | null = null;

  // Meerdere kolommen met dezelfde kopnaam voor het PRIMAIRE contactpaar
  // (`vendor_contact.email` twee keer, zoals een echt Transdev-testbestand
  // had) mogen het primaire veld niet stilzwijgend overschrijven. Besluit
  // eigenaar 31-08: het LAATSTE voorkomen is primair (in de praktijk staat
  // het echte adres/de echte naam vaak in de laatste van zulke kolommen,
  // de eerdere zijn leeg of bevatten een compliance-URL) — alle eerdere
  // voorkomens worden genummerde extra contacten. Daarom eerst alle indexen
  // per veld verzamelen (pass 1), dan pas toewijzen (pass 2).
  const indexenPerContactVeld: Record<
    'contactEmail' | 'contactFullName',
    number[]
  > = { contactEmail: [], contactFullName: [] };

  inhoud.koppen.forEach((kop, index) => {
    const kopKleineLetters = kop.toLowerCase();
    if (isVendorContactIdKolom(kopKleineLetters)) return;
    const veld = KOLOM_ALIASSEN[kopKleineLetters] ?? null;
    if (veld === 'contactEmail' || veld === 'contactFullName') {
      indexenPerContactVeld[veld].push(index);
    }
  });

  let volgendVrijVolgnummer = 2;

  inhoud.koppen.forEach((kop, index) => {
    const kopKleineLetters = kop.toLowerCase();

    if (isVendorContactIdKolom(kopKleineLetters)) {
      herkendeKolommen[kop] = 'contactFullName (indien geen UUID)';
      vendorContactIdKolomIndex = index;
      extraContactPerIndex.push(null);
      veldPerIndex.push(null);
      return;
    }

    const veld = KOLOM_ALIASSEN[kopKleineLetters] ?? null;

    if (veld === 'contactEmail' || veld === 'contactFullName') {
      const indexen = indexenPerContactVeld[veld];
      const primaireIndex = indexen[indexen.length - 1];

      if (index !== primaireIndex) {
        // Niet het laatste (= primaire) voorkomen: naar extraContacten.
        // Elke zo'n kolom krijgt een eigen volgnummer — twee dubbele
        // kolommen (email + naam) in hetzelfde bestand komen dus in APARTE
        // extra contacten terecht, niet per se bij elkaar. Bewuste,
        // eenvoudige keuze: zonder een suffix in de kopnaam is er geen
        // manier om vast te stellen dat twee dubbele kolommen bij dezelfde
        // extra persoon horen.
        const soort = veld === 'contactEmail' ? 'email' : 'fullName';
        const eigenVolgnummer = volgendVrijVolgnummer++;
        herkendeKolommen[kop] = `extraContact.${soort}_${eigenVolgnummer}`;
        extraContactPerIndex.push({ soort, volgnummer: eigenVolgnummer });
        veldPerIndex.push(null);
        return;
      }
    }

    if (veld) {
      herkendeKolommen[kop] = veld;
      extraContactPerIndex.push(null);
      veldPerIndex.push(veld);
      return;
    }

    const extraContact = herkenExtraContactKolom(kopKleineLetters);
    if (extraContact) {
      herkendeKolommen[kop] =
        `extraContact.${extraContact.soort}_${extraContact.volgnummer}`;
      extraContactPerIndex.push(extraContact);
      veldPerIndex.push(null);
      volgendVrijVolgnummer = Math.max(
        volgendVrijVolgnummer,
        extraContact.volgnummer + 1,
      );
      return;
    }

    extraContactPerIndex.push(null);
    veldPerIndex.push(null);
    if (kop.trim() !== '') onbekendeKolommen.push(kop);
  });

  const rijen: BeoordeeldeContractRij[] = inhoud.rijen.map((cellen, index) => {
    const regel = index + 2; // koprij is regel 1
    const invoer = maakInvoer(
      cellen,
      inhoud.koppen,
      veldPerIndex,
      extraContactPerIndex,
      vendorContactIdKolomIndex,
    );
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

    if (invoer.extraContacten.length > 0) {
      bevindingen.push({
        code: 'extra_contactgegevens_gevonden',
        melding: `${invoer.extraContacten.length} extra contactgegeven(s) gevonden — worden niet automatisch verwerkt, zie de lijst na bevestigen.`,
        blokkerend: false,
      });
    }

    // Duiding tegen de vaste, platform-brede waardenlijsten. Kan hier al
    // gebeuren (geen databasequery nodig, anders dan vendor-categorie) —
    // een niet-herkende tekst wordt gemeld en het veld blijft leeg, in
    // plaats van te blokkeren.
    const ruweBusinessCriticality = invoer.vendorBusinessCriticalityCode;
    const geduideCriticality = duidBusinessCriticality(ruweBusinessCriticality);
    if (
      ruweBusinessCriticality !== null &&
      ruweBusinessCriticality.trim() !== '' &&
      geduideCriticality === null
    ) {
      bevindingen.push({
        code: 'business_criticality_onbekend',
        melding: `'${ruweBusinessCriticality}' is geen herkende cyber-criticaliteit (verwacht Hoog/Gemiddeld/Laag/Kritiek).`,
        blokkerend: false,
      });
    }
    invoer.vendorBusinessCriticalityCode = geduideCriticality;

    const ruweRiskTier = invoer.contractBusinessRiskTierCode;
    const geduideRiskTier = duidBusinessRiskTier(ruweRiskTier);
    if (
      ruweRiskTier !== null &&
      ruweRiskTier.trim() !== '' &&
      geduideRiskTier === null
    ) {
      bevindingen.push({
        code: 'business_risk_tier_onbekend',
        melding: `'${ruweRiskTier}' is geen herkende risicoclassificatie (verwacht Tier 1/2/3).`,
        blokkerend: false,
      });
    }
    invoer.contractBusinessRiskTierCode = geduideRiskTier;

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
  veldPerIndex: (
    keyof Omit<ContractImportInvoer, 'rawAttributes' | 'extraContacten'> | null
  )[],
  extraContactPerIndex: ReturnType<typeof herkenExtraContactKolom>[],
  vendorContactIdKolomIndex: number | null,
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
    vendorBusinessCriticalityCode: null,
    contractBusinessRiskTierCode: null,
    contactEmail: null,
    contactFullName: null,
    extraContacten: [],
    rawAttributes: {},
  };

  // volgnummer -> plek in extraContacten, zodat email_2 en full_name_2 in
  // hetzelfde ExtraContactInvoer-object landen, ook als ze niet naast
  // elkaar in de koprij staan.
  const extraPerVolgnummer = new Map<number, ExtraContactInvoer>();

  cellen.forEach((cel, i) => {
    const waarde = cel.trim();

    const kop = koppen[i];
    if (kop !== undefined && kop.trim() !== '') {
      invoer.rawAttributes[kop] = waarde;
    }

    const extraContact = extraContactPerIndex[i];
    if (extraContact) {
      let plek = extraPerVolgnummer.get(extraContact.volgnummer);
      if (!plek) {
        plek = {
          volgnummer: extraContact.volgnummer,
          email: null,
          fullName: null,
        };
        extraPerVolgnummer.set(extraContact.volgnummer, plek);
      }
      if (waarde !== '') {
        plek[extraContact.soort] = waarde;
      }
      return;
    }

    const veld = veldPerIndex[i];
    if (!veld) return;

    if (veld === 'contractName' || veld === 'vendorName') {
      invoer[veld] = waarde;
    } else {
      invoer[veld] = waarde === '' ? null : waarde;
    }
  });

  // Alleen volgnummers met minstens één ingevuld veld meenemen — een lege
  // email_3/full_name_3-combinatie is geen extra contactgegeven, gewoon een
  // lege kolom.
  invoer.extraContacten = Array.from(extraPerVolgnummer.values())
    .filter((c) => c.email !== null || c.fullName !== null)
    .sort((a, b) => a.volgnummer - b.volgnummer);

  // 'contract.vendor_contact_id' als naam gebruiken: alleen als
  // vendor_contact.full_name zelf leeg bleef, én de waarde geen geldig UUID
  // is (anders is het mogelijk een echte ID-verwijzing). Besluit eigenaar
  // 31-08, zie isVendorContactIdKolom().
  if (vendorContactIdKolomIndex !== null && invoer.contactFullName === null) {
    const ruweWaarde = cellen[vendorContactIdKolomIndex]?.trim();
    if (ruweWaarde && !UUID_REGEX_LOKAAL.test(ruweWaarde)) {
      invoer.contactFullName = ruweWaarde;
    }
  }

  return invoer;
}

export { bepaalScheidingsteken, leesCsv };
