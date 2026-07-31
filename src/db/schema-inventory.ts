import { getTableConfig } from 'drizzle-orm/pg-core';

import * as schema from './schema';

export interface KolomInventaris {
  naam: string;
  /** Verwacht het schema een DEFAULT-clausule op deze kolom in de database? */
  heeftDefault: boolean;
}

export interface TabelInventaris {
  /** Volledige naam, bijv. 'clm.vendor'. */
  volledigeNaam: string;
  schema: string;
  naam: string;
  /** Heeft deze tabel een tenant_id-kolom? Bepaalt of RLS verplicht is. */
  tenantgebonden: boolean;
  kolommen: KolomInventaris[];
}

/**
 * Leidt af welke tabellen er horen te bestaan, rechtstreeks uit het
 * Drizzle-schema. Bewust geen hardgecodeerde lijst: die veroudert zodra er een
 * tabel bijkomt, en een verificatie die alleen controleert wat hij toevallig
 * kent stelt gerust zonder iets te bewijzen.
 *
 * 'tenantgebonden' wordt afgeleid uit de aanwezigheid van een tenant_id-kolom.
 * Dat is dezelfde regel die MCM2-CLAUDE.md §7 hanteert: iedere tabel met
 * tenant_id heeft RLS en policies met zowel USING als WITH CHECK nodig.
 */
export function inventariseerSchema(): TabelInventaris[] {
  const tabellen: TabelInventaris[] = [];

  for (const exportwaarde of Object.values(schema)) {
    let config: ReturnType<typeof getTableConfig>;

    try {
      config = getTableConfig(exportwaarde as never);
    } catch {
      // Geen tabel (relatie-definitie, helper, pgSchema-object) — overslaan.
      continue;
    }

    const schemaNaam = config.schema ?? 'public';

    tabellen.push({
      volledigeNaam: `${schemaNaam}.${config.name}`,
      schema: schemaNaam,
      naam: config.name,
      tenantgebonden: config.columns.some((k) => k.name === 'tenant_id'),
      // hasDefault dekt zowel SQL-expressies (gen_random_uuid(), now()) als
      // vaste waarden ('NL'). Beide horen als DEFAULT-clausule in de database
      // te staan — dat is het verschil met Prisma, dat defaults in de
      // applicatielaag afhandelde. Zie Issue #29.
      kolommen: config.columns.map((k) => ({
        naam: k.name,
        heeftDefault: k.hasDefault === true,
      })),
    });
  }

  return tabellen.sort((a, b) =>
    a.volledigeNaam.localeCompare(b.volledigeNaam),
  );
}

/**
 * Schema's waarin tenantgebonden tabellen kunnen staan. `ref` valt hier bewust
 * buiten: dat bevat tenant-agnostische lookup-data zonder RLS.
 */
export const TENANT_SCHEMAS = ['clm', 'audit'] as const;

/**
 * Tabellen met een `tenant_id` die bewust géén RLS hebben.
 *
 * Deze lijst hoort kort te blijven en groeit alleen met een expliciete
 * motivatie hieronder. Een tabel hier neerzetten omdat een test rood staat, is
 * de poort omzeilen in plaats van hem te gebruiken — §7.4 is niet vrijblijvend.
 *
 * `clm.sessie` (migratie 0010): de sessie wordt opgezocht vóórdat de
 * tenantcontext bestaat — de tenant vólgt immers uit de sessie. Een policy op
 * `current_tenant_id()` zou hier structureel nul rijen opleveren en daarmee
 * elke login onmogelijk maken. Hetzelfde kip-ei-probleem als bij
 * `clm.gebruiker_bij_subject()` in migratie 0009.
 *
 * De bescherming is daarom niet zwakker maar anders: de tabel is voor de
 * runtime-rol volledig ontoegankelijk (`REVOKE ALL`), en alle toegang loopt via
 * drie SECURITY DEFINER-functies met een scherp begrensde opdracht. Dat de deur
 * echt dicht zit, wordt bewezen in `test/sessie.e2e-spec.ts` — de eerste twee
 * tests daar lokken een directe SELECT en INSERT uit en verwachten
 * "permission denied".
 */
export const RLS_UITZONDERINGEN: ReadonlySet<string> = new Set(['clm.sessie']);

/**
 * Tabellen met RLS maar bewust ZONDER `FORCE ROW LEVEL SECURITY`
 * (migratie 0011).
 *
 * Een aparte lijst, niet samengevoegd met `RLS_UITZONDERINGEN`: dit is een
 * andere en veel smallere uitzondering. Deze tabellen hébben RLS en policies;
 * alleen de eigenaar van de tabel wordt er niet aan onderworpen.
 *
 * ── Waarom deze vijf ─────────────────────────────────────────────────────────
 *
 * De vijf SECURITY DEFINER-functies zijn eigendom van `clm_migrator`. Met FORCE
 * op deze tabellen vallen díé functies óók onder RLS — en zij draaien juist
 * vóórdat er tenantcontext bestaat, want de tenant volgt uit wat ze opzoeken.
 * Gemeten gevolg: eerst 90, daarna 77 falende e2e-tests. In productie zou het
 * betekenen: geen login, en geen surveylink die nog opent.
 *
 * Welke functie welke tabel leest, afgeleid uit `pg_proc`:
 *
 *   resolve_survey_token()   survey_response, survey_run, vendor
 *   gebruiker_bij_subject()  user, tenant_membership
 *   sessie_aanmaken()        user, tenant_membership
 *
 * Dat het juist deze vijf zijn, is geen toeval: het zijn de tabellen rond
 * identiteit en toegang, en precies die moeten vóór de tenantcontext leesbaar
 * zijn.
 *
 * ── Wat het restrisico is, en waar het wordt afgedekt ────────────────────────
 *
 * De bescherming voor de runtime-rol blijft volledig intact: `clm_api_runtime`
 * is geen eigenaar en valt dus gewoon onder de policies. Wat blijft bestaan is
 * dat een verbinding als `clm_migrator` deze vijf tabellen ongefilterd ziet.
 *
 * Dat wordt afgedekt door de test "draait niet als de rol die eigenaar is van
 * de tabellen" in `test/schema-conformiteit.e2e-spec.ts`. Die valt om zodra de
 * applicatie op de migratierol draait — precies de situatie waarin dit gat pas
 * schadelijk wordt.
 *
 * Volledig sluiten vraagt een aparte eigenaarsrol voor de functies. Dat werkt,
 * maar raakt het rollenmodel uit ADR-008 en hoort bij een eigen afweging.
 */
export const FORCE_RLS_UITZONDERINGEN: ReadonlySet<string> = new Set([
  'clm.user',
  'clm.tenant_membership',
  'clm.survey_response',
  'clm.survey_run',
  'clm.vendor',
]);
