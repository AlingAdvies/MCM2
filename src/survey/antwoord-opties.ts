/**
 * De keuzeopties van een vraag, voor het beoordelingsscherm.
 *
 * Zonder deze opties ziet de beoordelaar bij een single_choice-vraag alleen
 * de code (`ja`), niet wat de leverancier op het scherm aanklikte ("Ja, en
 * ik kan het aantonen"). Bij confirmation liggen de opties vast in de code
 * en staan ze niet in de config — dan `null`.
 *
 * Los van de service zodat het zonder database te testen is: `config` is
 * JSONB, en de database bewaakt de inhoud daarvan niet.
 */
export interface Optie {
  code: string;
  label: string;
}

const TYPEN_MET_OPTIES = new Set(['single_choice', 'multi_choice']);

export function optiesUit(answerType: string, config: unknown): Optie[] | null {
  if (!TYPEN_MET_OPTIES.has(answerType)) return null;

  const ruw =
    typeof config === 'object' && config !== null
      ? (config as Record<string, unknown>).options
      : undefined;

  if (!Array.isArray(ruw)) return [];

  return ruw.flatMap((optie) => {
    if (typeof optie !== 'object' || optie === null) return [];
    const { code, label } = optie as Record<string, unknown>;
    return typeof code === 'string' && typeof label === 'string'
      ? [{ code, label }]
      : [];
  });
}
