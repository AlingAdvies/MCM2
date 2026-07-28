/**
 * Maskeert leverancierstokens in tekst die gelogd of naar buiten gestuurd wordt.
 *
 * Zie ontwerp §7. Het ruwe token is de volledige sleutel tot een survey-response:
 * er zit geen wachtwoord achter. Een token dat in een logregel belandt, is
 * daarmee net zo gevoelig als een wachtwoord in platte tekst — en logs worden
 * doorgaans breder gedeeld en langer bewaard dan de database zelf.
 *
 * NestJS logt bij een onafgevangen fout de volledige URL, inclusief
 * query-parameters. Zonder deze maskering staat elk geweigerd token in de
 * serverlog.
 */

/**
 * Vervangt de waarde van een `t`-queryparameter door een onherkenbare
 * placeholder, met behoud van de rest van de tekst.
 *
 * Werkt op losse URL's én op tekst waarin een URL voorkomt (zoals een
 * foutmelding of stacktrace).
 */
export function maskeerToken(tekst: string): string {
  return tekst.replace(
    /([?&]t=)[A-Za-z0-9_-]{8,}/g,
    (_, prefix: string) => `${prefix}[GEMASKEERD]`,
  );
}

/**
 * Maskeert recursief alle stringwaarden in een object. Bedoeld voor
 * logcontext-objecten waarin een URL of tokenwaarde kan zitten.
 *
 * De diepte is begrensd omdat logcontext soms circulaire verwijzingen bevat;
 * een onbegrensde recursie zou daarop vastlopen.
 */
export function maskeerDiep(waarde: unknown, diepte = 0): unknown {
  if (diepte > 5) return waarde;

  if (typeof waarde === 'string') {
    return maskeerToken(waarde);
  }

  if (Array.isArray(waarde)) {
    return waarde.map((item) => maskeerDiep(item, diepte + 1));
  }

  if (waarde !== null && typeof waarde === 'object') {
    const resultaat: Record<string, unknown> = {};
    for (const [sleutel, item] of Object.entries(waarde)) {
      // Een veld dat letterlijk 'token' heet krijgt hoe dan ook een masker:
      // dat is nooit iets dat in een log thuishoort.
      resultaat[sleutel] = /token/i.test(sleutel)
        ? '[GEMASKEERD]'
        : maskeerDiep(item, diepte + 1);
    }
    return resultaat;
  }

  return waarde;
}
