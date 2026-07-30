/**
 * CSV inlezen — één taak, geen kennis van leveranciers.
 *
 * Bewust een eigen lezer en geen bibliotheek: het formaat is klein en scherp
 * begrensd (RFC 4180), en dit vermijdt een afhankelijkheid in een project dat
 * er nu tien heeft. Zodra er iets bijkomt wat hier niet in past —
 * meerdere bladen, formules, opmaak — is dat het signaal om naar een echte
 * bibliotheek te gaan, niet om deze te laten uitgroeien.
 *
 * WAAROM NIET DE VERSIE UIT MVM_V2 (`coupa-field-mapping.ts`):
 * die wisselt `inQuotes` bij élk aanhalingsteken, dus een ontsnapt
 * aanhalingsteken (`""` binnen een veld) leest hij verkeerd. Een leverancier
 * als `Jansen "De Bouwer" B.V.` — die bestaat in het voorbeeldbestand — wordt
 * dan afgekapt. Voor een demo onzichtbaar, bij 142 echte rijen niet.
 *
 * Wat deze lezer WEL doet:
 *   - velden tussen dubbele aanhalingstekens, met `""` als ontsnapt teken
 *   - regeleinden binnen een veld tussen aanhalingstekens
 *   - CRLF en LF door elkaar
 *   - een UTF-8 BOM aan het begin (Excel zet die er standaard voor)
 *
 * Wat deze lezer NIET doet: een ander scheidingsteken dan de komma raden.
 * Zie `bepaalScheidingsteken` — dat is een aparte, expliciete stap.
 */

/** Een ingelezen bestand: koppen plus de rijen eronder. */
export interface CsvInhoud {
  koppen: string[];
  /** Eén array per rij, in kolomvolgorde. Niet uitgelijnd op `koppen`. */
  rijen: string[][];
  /** Het teken dat als scheiding is gebruikt. */
  scheidingsteken: string;
}

/**
 * Raadt het scheidingsteken uit de eerste regel.
 *
 * Nederlandse Excel-installaties schrijven puntkomma's in plaats van komma's —
 * de Transdev-specificaties in MVM_V2 gebruiken alle vier puntkomma's. Zonder
 * deze stap leest zo'n bestand als één kolom, en dan is de melding "geen
 * kolom 'Supplier Name' gevonden" terwijl het bestand op zich klopt.
 *
 * Het teken dat buiten aanhalingstekens het vaakst voorkomt wint. Bij een
 * gelijkspel of nul treffers valt het terug op de komma.
 */
export function bepaalScheidingsteken(eersteRegel: string): string {
  const kandidaten = [',', ';', '\t', '|'];
  let beste = ',';
  let hoogste = 0;

  for (const teken of kandidaten) {
    let aantal = 0;
    let inAanhaling = false;

    for (const char of eersteRegel) {
      if (char === '"') inAanhaling = !inAanhaling;
      else if (char === teken && !inAanhaling) aantal++;
    }

    if (aantal > hoogste) {
      hoogste = aantal;
      beste = teken;
    }
  }

  return beste;
}

/**
 * Leest een CSV-tekst in.
 *
 * Verwacht een koprij. Een bestand zonder koprij is niet te onderscheiden van
 * een bestand waarvan de eerste leverancier per ongeluk als kop wordt gelezen,
 * dus dat raden we niet — de koppen zijn nodig om kolommen te herkennen.
 */
export function leesCsv(tekst: string): CsvInhoud {
  // GEEN losse BOM-verwijdering hier, en dat is een gemeten keuze.
  //
  // Excel zet bij "CSV UTF-8" een BOM (U+FEFF) voor de eerste kop. Ik had daar
  // een losse `replace` op U+FEFF voor staan, tot bleek dat die regel met geen
  // enkele test rood te krijgen was: `.trim()` op de koppen hieronder haalt
  // U+FEFF in JavaScript óók weg, en `bepaalScheidingsteken` telt alleen
  // scheidingstekens en struikelt er niet over.
  //
  // Twee tests geschreven om het mechanisme aan te tonen, beide bleven groen
  // met de regel eruit. Toen was de conclusie dat de regel niets deed wat de
  // trim niet al doet — en een regel die niets doet is erger dan geen regel,
  // want de volgende lezer denkt dat de BOM hier wordt afgehandeld.
  //
  // De BOM wordt dus verwijderd door de `.trim()` onderaan deze functie. Zie
  // de test 'verwijdert de UTF-8 BOM die Excel voor de eerste kop zet'.
  const eersteRegeleinde = tekst.search(/\r?\n/);
  const eersteRegel =
    eersteRegeleinde === -1 ? tekst : tekst.slice(0, eersteRegeleinde);
  const scheidingsteken = bepaalScheidingsteken(eersteRegel);

  const alleRijen = splitsRijen(tekst, scheidingsteken);

  // Volledig lege rijen weglaten. Een bestand eindigt vaak op een regeleinde,
  // en een laatste rij met één leeg veld is geen leverancier.
  const gevuld = alleRijen.filter(
    (rij) => rij.length > 0 && rij.some((cel) => cel.trim().length > 0),
  );

  if (gevuld.length === 0) {
    return { koppen: [], rijen: [], scheidingsteken };
  }

  return {
    koppen: gevuld[0].map((k) => k.trim()),
    rijen: gevuld.slice(1),
    scheidingsteken,
  };
}

/**
 * Splitst de volledige tekst in rijen en velden, in één doorloop.
 *
 * In één keer en niet eerst op regels splitsen: een veld tussen
 * aanhalingstekens mag een regeleinde bevatten, en dan is "een regel" niet
 * hetzelfde als "een rij". De Transdev-specificaties in MVM_V2 doen dit
 * daadwerkelijk — meerregelige beschrijvingen binnen één cel.
 */
function splitsRijen(tekst: string, scheidingsteken: string): string[][] {
  const rijen: string[][] = [];
  let rij: string[] = [];
  let veld = '';
  let inAanhaling = false;

  for (let i = 0; i < tekst.length; i++) {
    const char = tekst[i];

    if (inAanhaling) {
      if (char === '"') {
        // Twee aanhalingstekens op een rij: één ontsnapt teken in de waarde.
        // Dít is wat de MVM_V2-versie mist.
        if (tekst[i + 1] === '"') {
          veld += '"';
          i++;
        } else {
          inAanhaling = false;
        }
      } else {
        veld += char;
      }
      continue;
    }

    if (char === '"') {
      inAanhaling = true;
    } else if (char === scheidingsteken) {
      rij.push(veld);
      veld = '';
    } else if (char === '\n') {
      rij.push(veld);
      rijen.push(rij);
      rij = [];
      veld = '';
    } else if (char === '\r') {
      // Deel van een CRLF; het regeleinde volgt op de \n.
    } else {
      veld += char;
    }
  }

  // Wat er na het laatste regeleinde nog staat.
  if (veld.length > 0 || rij.length > 0) {
    rij.push(veld);
    rijen.push(rij);
  }

  return rijen;
}
