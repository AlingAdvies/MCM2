import { isGeldigMailadres } from './mail-adres';

/**
 * Configuratie van het mailkanaal.
 *
 * Anders dan `auth.config.ts` faalt dit **niet** hard bij ontbrekende
 * variabelen. Zonder sleutel draait MCM2 met `LogMailKanaal`: er gaat dan
 * aantoonbaar niets de deur uit, en dat is de veilige toestand. Zelfde keuze
 * als in `scripts/telegram.js` — ontbrekende configuratie is een no-op met een
 * logregel, geen crash. Zo blijft de applicatie bruikbaar in CI, in de demo, en
 * op een machine zonder sleutel.
 *
 * Wat wél hard faalt: een configuratie die er half is. Een sleutel zonder
 * afzenderadres betekent dat iemand het bedoelde in te stellen en halverwege
 * is gestopt — dan is stil doorgaan met loggen erger dan opstarten weigeren,
 * want de beheerder denkt dat er mail uitgaat.
 *
 * Zie docs/superpowers/specs/2026-08-06-mailkanaal.md §6.
 */

export interface MailConfig {
  /** De Resend API-sleutel. Nooit loggen — zie MCM2-CLAUDE.md §6. */
  readonly apiSleutel: string;
  /**
   * Het adres waarvandaan alles verstuurd wordt, bijv. `uitvraag@mcm2mail.nl`.
   *
   * Moet op een in Resend geverifieerd domein staan. Dit is het platformadres;
   * de klantnaam zit in de display name die per bericht wordt meegegeven
   * (ontwerp §3).
   */
  readonly afzenderAdres: string;
}

export class MailConfigFout extends Error {
  constructor(melding: string) {
    super(melding);
    this.name = 'MailConfigFout';
  }
}

const SLEUTEL = 'RESEND_API_KEY';
const AFZENDER = 'MAIL_AFZENDER_ADRES';

function leeg(waarde: string | undefined): boolean {
  return waarde === undefined || waarde.trim() === '';
}

/**
 * Leest de configuratie, of geeft `null` als er niets is ingesteld.
 *
 * `null` betekent: draai met `LogMailKanaal`. Dat is geen fout.
 */
export function leesMailConfig(
  env: NodeJS.ProcessEnv = process.env,
): MailConfig | null {
  const apiSleutel = env[SLEUTEL];
  const afzenderAdres = env[AFZENDER];

  // Allebei leeg: bewust niet geconfigureerd.
  if (leeg(apiSleutel) && leeg(afzenderAdres)) {
    return null;
  }

  // Eén van beide: half ingesteld. Dat is een fout, geen keuze.
  if (leeg(apiSleutel)) {
    throw new MailConfigFout(
      `${AFZENDER} is ingesteld maar ${SLEUTEL} ontbreekt. ` +
        `Zonder sleutel kan er niets verstuurd worden; laat beide leeg om met het logkanaal te draaien.`,
    );
  }
  if (leeg(afzenderAdres)) {
    throw new MailConfigFout(
      `${SLEUTEL} is ingesteld maar ${AFZENDER} ontbreekt. ` +
        `Resend weigert een verzending zonder geverifieerd afzenderadres.`,
    );
  }

  const adres = afzenderAdres!.trim();

  // Een fout afzenderadres levert bij Resend `invalid_from_address` op — pas
  // bij de eerste verzending, en dan is de ronde al gestart. Hier vangen is
  // het verschil tussen "opstarten mislukt" en "zeventien leveranciers kregen
  // niets".
  if (!isGeldigMailadres(adres)) {
    throw new MailConfigFout(
      `${AFZENDER} is geen geldig e-mailadres: ${adres}`,
    );
  }

  return {
    apiSleutel: apiSleutel!.trim(),
    afzenderAdres: adres,
  };
}
