/**
 * De poort waar alle uitgaande mail doorheen gaat.
 *
 * ── Waarom een interface bij één implementatie ──────────────────────────────
 *
 * Dit is dezelfde knip als `haalNieuwsteBackup()` in `scripts/backup-controle.js`:
 * één smalle grens, zodat alles daarachter ongewijzigd blijft als de provider
 * wisselt. Daar was de reden een toekomstige overstap naar een managed service;
 * hier is de reden concreter.
 *
 * Het mailkanaal-ontwerp is op één dag van Microsoft 365 naar Resend gegaan.
 * Drie redenen dwongen dat af (ontwerp §1), en geen ervan was op voorhand
 * bekend. Dat die wissel goedkoop was, komt doordat de verzendcode nooit ergens
 * anders is gaan zitten dan achter deze grens.
 *
 * Verder blijft Issue #76 bestaan: vraagt een klant om eigen SMTP, dan is dat
 * een tweede implementatie hierachter — geen tweede verzendpad door de hele
 * applicatie.
 *
 * ── Wat hier NIET achter zit ────────────────────────────────────────────────
 *
 * Het invullen van de vragenlijst. Dat gaat via het token naar MCM2 zelf en
 * raakt mail niet. Mail is uitsluitend het vervoermiddel voor de link, plus de
 * afleverstatus die terugkomt. Ontwerp §4 noemt dat "drie kanalen die elkaar
 * niet raken"; deze interface is er één van, niet alledrie.
 *
 * Zie docs/superpowers/specs/2026-08-06-mailkanaal.md
 */

/** Wat er verstuurd wordt. */
export interface MailBericht {
  /** Ontvanger. Gevalideerd met `isGeldigMailadres()` vóór het hier komt. */
  readonly aan: string;

  /**
   * De naam die de leverancier in zijn inbox ziet, bijv. `Transdev via MCM2`.
   *
   * Komt per tenant uit de database (ontwerp §8). De klant is daarmee
   * herkenbaar zonder dat we zijn domein nodig hebben — het afzenderADRES
   * blijft van het platform en zegt dus de waarheid over wie verstuurt.
   */
  readonly afzenderNaam: string;

  /**
   * Waar een antwoord van de leverancier heen gaat: het contactadres van de
   * tenant.
   *
   * Dit is geen detail. Zonder `Reply-To` komen vragen als "geldt deze norm wel
   * voor ons?" bij ons terecht, en wij kunnen ze niet beantwoorden — alleen de
   * tenant weet of die leverancier nog een contract heeft. Optioneel omdat een
   * tenant het (nog) niet ingevuld kan hebben; dan vervalt de header.
   */
  readonly antwoordAan?: string;

  readonly onderwerp: string;

  /** Platte tekst. HTML komt pas bij de sjablonen, die buiten scope staan. */
  readonly tekst: string;
}

/**
 * Wat een verzending oplevert.
 *
 * `providerId` is de sleutel waarmee een latere statusmelding aan deze
 * verzending gekoppeld wordt (ontwerp §4, mechanisme 1). Zonder dat id is een
 * binnengekomen bounce niet te herleiden en belandt hij in "niet toegewezen".
 */
export interface VerzendResultaat {
  readonly providerId: string;
}

/**
 * Fout bij het versturen.
 *
 * Bestaat als eigen type omdat de aanroeper onderscheid moet kunnen maken
 * tussen "deze ene mail ging niet" en "de provider weigert alles". Dat
 * onderscheid is de kern van tegenproef 6: bij een daglimiet blijft de rest van
 * de ronde ook liggen, en dan mag de status niet op "verstuurd" blijven staan.
 */
export class MailVerzendFout extends Error {
  constructor(
    message: string,
    /**
     * Waar of de provider dit als tijdelijk aanmerkt. Bij `false` heeft opnieuw
     * proberen geen zin — dan is er een adres of een instelling fout.
     */
    readonly tijdelijk: boolean = false,
    readonly oorzaak?: unknown,
  ) {
    super(message);
    this.name = 'MailVerzendFout';
  }
}

/**
 * De grens zelf.
 *
 * Eén methode. `haalBinnengekomen()` uit het ontwerp staat hier bewust nog
 * niet: bij Resend komen statusmeldingen via een webhook binnen (ontwerp §4),
 * dus er valt niets op te halen. Die methode toevoegen vóórdat er een
 * implementatie is die hem invult, levert een interface op die liegt over wat
 * hij kan.
 */
export abstract class MailKanaal {
  abstract verstuur(bericht: MailBericht): Promise<VerzendResultaat>;
}
