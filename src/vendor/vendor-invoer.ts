import { isGeldigMailadres } from '../mail/mail-adres';
import type {
  ContactInvoer,
  NieuweVendor,
  VendorWijziging,
} from './vendor.service';

/**
 * Validatie van wat een browser opstuurt bij het aanmaken van een leverancier.
 *
 * Bewust hier en niet in de service: de service werkt met een getypeerd
 * object, de buitenwereld met `unknown`. Die grens hoort op één plek te liggen.
 *
 * Bewust ook géén class-validator, hoewel dat als dependency aanwezig is. De
 * bestaande controller valideert op dezelfde manier — handmatig, met `unknown`
 * als invoer — en een tweede stijl ernaast maakt het geheel ongelijkmatig
 * zonder iets op te lossen. Zie MCM2-CLAUDE.md over eenduidige werkwijze.
 *
 * De regels hier zijn bewust ruim. Streng valideren op een leveranciersnaam
 * of een adres levert vooral valse afwijzingen op: een naam mag cijfers en
 * leestekens bevatten, en een buitenlandse plaatsnaam ziet er anders uit dan
 * een Nederlandse. Wat hier wordt tegengehouden is het soort invoer dat op een
 * vergissing of een aanval wijst — lege verplichte velden, absurde lengtes,
 * een verkeerd type.
 */

/** Bovengrenzen. Ruim genoeg voor echte waarden, krap genoeg om onzin te weren. */
const MAX_NAAM = 200;
const MAX_KORT = 100;
const MAX_URL = 500;
const MAX_NOTITIE = 2000;

export class InvoerFout extends Error {
  constructor(
    readonly veld: string,
    melding: string,
  ) {
    super(melding);
    this.name = 'InvoerFout';
  }
}

/** Leest een verplicht tekstveld. */
function verplichteTekst(
  waarde: unknown,
  veld: string,
  maxLengte: number,
): string {
  if (typeof waarde !== 'string' || waarde.trim() === '') {
    throw new InvoerFout(veld, `${veld} is verplicht.`);
  }

  const geknipt = waarde.trim();

  if (geknipt.length > maxLengte) {
    throw new InvoerFout(
      veld,
      `${veld} mag maximaal ${maxLengte} tekens bevatten.`,
    );
  }

  return geknipt;
}

/** Leest een optioneel tekstveld; leeg en ontbrekend zijn hetzelfde. */
function optioneleTekst(
  waarde: unknown,
  veld: string,
  maxLengte: number,
): string | null {
  if (waarde === undefined || waarde === null || waarde === '') {
    return null;
  }

  if (typeof waarde !== 'string') {
    throw new InvoerFout(veld, `${veld} moet tekst zijn.`);
  }

  const geknipt = waarde.trim();

  if (geknipt === '') {
    return null;
  }

  if (geknipt.length > maxLengte) {
    throw new InvoerFout(
      veld,
      `${veld} mag maximaal ${maxLengte} tekens bevatten.`,
    );
  }

  return geknipt;
}

/**
 * Een KvK-nummer is acht cijfers.
 *
 * Bij de CSV-import is dit een *waarschuwing* en geen blokkade: een fout
 * nummer in een bestand van 200 rijen mag de hele import niet tegenhouden, en
 * is achteraf te corrigeren. Hier is het wél een fout — iemand typt één
 * leverancier in en kan het meteen verbeteren. Verschillende situatie,
 * verschillende strengheid; dat verschil is bewust.
 */
function kvkNummer(waarde: unknown): string | null {
  const tekst = optioneleTekst(waarde, 'KvK-nummer', 20);

  if (tekst === null) {
    return null;
  }

  // Spaties en punten eruit: mensen typen 1234 5678.
  const cijfers = tekst.replace(/[\s.]/g, '');

  if (!/^\d{8}$/.test(cijfers)) {
    throw new InvoerFout(
      'kvkNumber',
      'Een KvK-nummer bestaat uit acht cijfers.',
    );
  }

  return cijfers;
}

/**
 * Een topleveldomein van één teken bestaat niet ('transdev.n' i.p.v.
 * 'transdev.nl') en een domein dat op een streepje of punt eindigt is altijd
 * een afgekapte invoer. Dit is geen RFC-controle maar een gerichte vangst op
 * de vergissing die bij overtypen/plakken uit een spreadsheet het vaakst
 * voorkomt: het laatste stukje van het adres ontbreekt of is half getypt.
 */
const VERDACHT_DOMEIN = /\.[a-z]$|[-.]$/i;

/**
 * Een e-mailadres moet er plausibel uitzien.
 *
 * Bewust geen strenge RFC-controle: die is berucht om geldige adressen af te
 * wijzen, en de echte controle is toch of er een e-mail aankomt. Wat hier
 * wordt gevangen is de vergissing — een naam in het e-mailveld, een ontbrekend
 * apenstaartje, of een afgekapt domein.
 *
 * Hergebruikt `isGeldigMailadres` (ook gebruikt door het mailkanaal en de
 * tenant-instellingen) zodat één adres niet op het ene scherm wordt geweigerd
 * en op het andere doorgelaten. De extra domeincontrole hier is bewust niet in
 * die gedeelde functie gezet: die moet ruim blijven voor het mailkanaal zelf
 * (aflevering is daar de echte controle, zie mail-adres.ts), terwijl
 * leveranciersinvoer — vaak handmatig getypt of uit een lijst geplakt — baat
 * heeft bij het vangen van een overduidelijke tikfout vóórdat de uitnodiging
 * de deur uitgaat.
 */
function emailAdres(waarde: unknown): string | null {
  const tekst = optioneleTekst(waarde, 'E-mailadres', MAX_KORT);

  if (tekst === null) {
    return null;
  }

  if (!isGeldigMailadres(tekst) || VERDACHT_DOMEIN.test(tekst)) {
    throw new InvoerFout('contact.email', 'Dit lijkt geen geldig e-mailadres.');
  }

  return tekst;
}

/**
 * Leest en valideert de body van POST /vendors.
 *
 * Werpt `InvoerFout` bij de eerste fout, met het veld erbij zodat het scherm
 * de melding naast het juiste invoerveld kan zetten.
 */
export function leesNieuweVendor(body: unknown): NieuweVendor {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Er is geen leverancier meegestuurd.');
  }

  const ruw = body as Record<string, unknown>;

  const invoer: NieuweVendor = {
    name: verplichteTekst(ruw.name, 'Naam', MAX_NAAM),
    kvkNumber: kvkNummer(ruw.kvkNumber),
    city: optioneleTekst(ruw.city, 'Plaats', MAX_KORT),
    country: optioneleTekst(ruw.country, 'Land', MAX_KORT),
    website: optioneleTekst(ruw.website, 'Website', MAX_URL),
  };

  const contact = ruw.contact;

  if (contact !== undefined && contact !== null) {
    if (typeof contact !== 'object') {
      throw new InvoerFout('contact', 'Contactpersoon is niet goed ingevuld.');
    }

    const ruwContact = contact as Record<string, unknown>;
    const naam = optioneleTekst(ruwContact.fullName, 'Naam', MAX_NAAM);

    // Een contactpersoon zonder naam is geen contactpersoon. Wél een e-mail
    // zonder naam invullen wijst op een half ingevuld formulier, en dat hoort
    // gemeld te worden in plaats van stilzwijgend genegeerd.
    if (naam === null) {
      const heeftIetsAnders =
        ruwContact.email || ruwContact.phone || ruwContact.jobTitle;

      if (heeftIetsAnders) {
        throw new InvoerFout(
          'contact.fullName',
          'Vul ook de naam van de contactpersoon in.',
        );
      }
    } else {
      invoer.contact = {
        fullName: naam,
        email: emailAdres(ruwContact.email),
        phone: optioneleTekst(ruwContact.phone, 'Telefoonnummer', MAX_KORT),
        jobTitle: optioneleTekst(ruwContact.jobTitle, 'Functie', MAX_KORT),
      };
    }
  }

  return invoer;
}

/**
 * Leest de body van PATCH /vendors/:id.
 *
 * Anders dan bij aanmaken: hier telt het verschil tussen "niet meegestuurd" en
 * "leeggemaakt". Een veld dat ontbreekt blijft staan; een veld met `null` of
 * een lege tekst wordt gewist. Zonder dat onderscheid zou elk formulier dat
 * niet álle velden kent, stilzwijgend gegevens wissen.
 *
 * Vandaar `if (veld in ruw)` en niet `if (ruw.veld)`.
 */
export function leesVendorWijziging(body: unknown): VendorWijziging {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Er is geen wijziging meegestuurd.');
  }

  const ruw = body as Record<string, unknown>;
  const wijziging: VendorWijziging = {};

  if ('name' in ruw) {
    wijziging.name = verplichteTekst(ruw.name, 'Naam', MAX_NAAM);
  }
  if ('kvkNumber' in ruw) {
    wijziging.kvkNumber = kvkNummer(ruw.kvkNumber);
  }
  if ('vestigingsnummer' in ruw) {
    wijziging.vestigingsnummer = optioneleTekst(
      ruw.vestigingsnummer,
      'Vestigingsnummer',
      MAX_KORT,
    );
  }
  if ('statutoryName' in ruw) {
    wijziging.statutoryName = optioneleTekst(
      ruw.statutoryName,
      'Statutaire naam',
      MAX_NAAM,
    );
  }
  if ('city' in ruw) {
    wijziging.city = optioneleTekst(ruw.city, 'Plaats', MAX_KORT);
  }
  if ('country' in ruw) {
    wijziging.country = optioneleTekst(ruw.country, 'Land', MAX_KORT);
  }
  if ('website' in ruw) {
    wijziging.website = optioneleTekst(ruw.website, 'Website', MAX_URL);
  }

  // De drie classificatievelden hebben een foreign key naar een ref-tabel. Een
  // onbekende code levert daar een databasefout op; die wordt in de controller
  // omgezet naar een leesbare melding. Hier alleen de vorm controleren — welke
  // codes bestaan, weet de database beter dan dit bestand.
  if ('categoryCode' in ruw) {
    wijziging.categoryCode = optioneleTekst(
      ruw.categoryCode,
      'Categorie',
      MAX_KORT,
    );
  }
  if ('businessCriticalityCode' in ruw) {
    wijziging.businessCriticalityCode = optioneleTekst(
      ruw.businessCriticalityCode,
      'Bedrijfskritiek',
      MAX_KORT,
    );
  }
  if ('complianceStatusCode' in ruw) {
    wijziging.complianceStatusCode = optioneleTekst(
      ruw.complianceStatusCode,
      'Compliancestatus',
      MAX_KORT,
    );
  }

  return wijziging;
}

/**
 * Leest de body van POST/PATCH op een contactpersoon.
 *
 * `naamVerplicht` verschilt per gebruik: bij toevoegen moet er een naam zijn,
 * bij wijzigen mag je alleen een e-mailadres corrigeren.
 */
export function leesContact(
  body: unknown,
  naamVerplicht: boolean,
): ContactInvoer {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Er is geen contactpersoon meegestuurd.');
  }

  const ruw = body as Record<string, unknown>;
  const invoer: ContactInvoer = {};

  if (naamVerplicht) {
    invoer.fullName = verplichteTekst(ruw.fullName, 'Naam', MAX_NAAM);
  } else if ('fullName' in ruw) {
    invoer.fullName = verplichteTekst(ruw.fullName, 'Naam', MAX_NAAM);
  }

  if ('email' in ruw) {
    invoer.email = emailAdres(ruw.email);
  }
  if ('phone' in ruw) {
    invoer.phone = optioneleTekst(ruw.phone, 'Telefoonnummer', MAX_KORT);
  }
  if ('jobTitle' in ruw) {
    invoer.jobTitle = optioneleTekst(ruw.jobTitle, 'Functie', MAX_KORT);
  }
  if ('roleDescription' in ruw) {
    invoer.roleDescription = optioneleTekst(
      ruw.roleDescription,
      'Notitie',
      MAX_NOTITIE,
    );
  }

  if ('isPrimary' in ruw) {
    if (typeof ruw.isPrimary !== 'boolean') {
      throw new InvoerFout('isPrimary', 'isPrimary moet true of false zijn.');
    }
    invoer.isPrimary = ruw.isPrimary;
  }

  return invoer;
}

/**
 * Leest de gewenste compliance-thema's uit een PUT-body.
 *
 * Verwacht `{ themaCodes: string[] }`. Een leeg array is geldig — dat
 * betekent "geen thema's meer", niet "niet aangeraakt". Duplicaten worden
 * stilzwijgend genegeerd (de primary key zou ze toch weigeren); dat is geen
 * invoerfout, want de UI stuurt de complete gewenste set en kan zelf geen
 * duplicaten produceren via de checkbox-interactie.
 */
export function leesThemaCodes(body: unknown): string[] {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('themaCodes' in body) ||
    !Array.isArray((body as { themaCodes: unknown }).themaCodes)
  ) {
    throw new InvoerFout(
      'themaCodes',
      'themaCodes moet een lijst van codes zijn.',
    );
  }

  const codes = (body as { themaCodes: unknown[] }).themaCodes;

  if (!codes.every((c) => typeof c === 'string' && c.trim().length > 0)) {
    throw new InvoerFout(
      'themaCodes',
      'Elke themaCode moet een niet-lege tekst zijn.',
    );
  }

  return [...new Set(codes as string[])];
}
