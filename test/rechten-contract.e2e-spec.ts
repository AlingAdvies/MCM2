import { Client } from 'pg';

import { DEFINER_FUNCTIES, TABELRECHTEN } from '../src/db/rechten-contract';
import { inventariseerSchema } from '../src/db/schema-inventory';

/**
 * Houdt het rechtencontract tegen de werkelijkheid.
 *
 * ── Waarom deze suite bestaat ────────────────────────────────────────────────
 *
 * Op 2026-08-08 strandde de eerste echte tenant op een 500: de applicatierol
 * had geen enkel recht op `clm.tenant_membership`. Migratie 0009 geeft die
 * tabel geen GRANT; lokaal werkte het toch, omdat `ALTER DEFAULT PRIVILEGES`
 * uit 0001 elke nieuwe tabel van rechten voorziet. Op Supabase is die default
 * niet geregistreerd.
 *
 * Dat verschil is precies wat `verify:volledig` níét kan zien: die bouwt een
 * verse database uit de migratieketen en meet de keten, niet de rechtenstand
 * van een bestaande omgeving.
 *
 * Deze suite dekt drie dingen af, en dat is geen willekeurige drieslag — het
 * zijn de drie plekken waar een impliciete aanname zich kan verstoppen:
 *
 *   1. tabelrechten        het gat van 2026-08-08
 *   2. search_path         goed geregeld, maar door niets bewaakt
 *   3. EXECUTE-rechten     stond alleen in tekst
 *
 * ── Wat deze suite bewust NIET doet ──────────────────────────────────────────
 *
 * Hij vergelijkt niet met "wat er toevallig staat" maar met wat het contract
 * voorschrijft. Een test die de database als waarheid neemt, keurt elke fout
 * goed die er al in zit — en dat is precies hoe dit gat maanden onopgemerkt
 * bleef.
 */

/** Rollen waarlangs de applicatie rechten krijgt: clm_api_runtime erft van clm_api. */
const APP_ROLLEN = ['clm_api', 'clm_api_runtime'];

function sorteer(rechten: readonly string[]): string[] {
  return [...rechten].sort();
}

describe('Rechtencontract (e2e)', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  describe('het contract zelf is compleet', () => {
    it('kent elke tabel uit het schema', () => {
      // Zonder deze test groeit het contract niet mee: een nieuwe tabel zou
      // stilzwijgend buiten de controle vallen, en dat is exact het gat dat
      // deze suite moet dichten.
      const ontbreekt = inventariseerSchema()
        .map((t) => t.volledigeNaam)
        .filter((naam) => !(naam in TABELRECHTEN));

      expect(ontbreekt).toEqual([]);
    });

    it('noemt geen tabellen die niet bestaan', () => {
      const bestaand = new Set(
        inventariseerSchema().map((t) => t.volledigeNaam),
      );

      const overbodig = Object.keys(TABELRECHTEN).filter(
        (naam) => !bestaand.has(naam),
      );

      expect(overbodig).toEqual([]);
    });
  });

  describe('tabelrechten', () => {
    it('geeft de applicatierol precies wat het contract voorschrijft', async () => {
      // string_agg en niet array_agg: de pg-driver levert een array uit een
      // subquery als tekst aan, en dan telt JavaScript de losse letters. Een
      // door komma's gescheiden string is hier ondubbelzinnig.
      const { rows } = await client.query<{
        volledige_naam: string;
        rechten: string | null;
      }>(
        `SELECT t.schemaname || '.' || t.tablename AS volledige_naam,
                string_agg(DISTINCT g.privilege_type, ',')
                  FILTER (WHERE g.grantee = ANY($1)) AS rechten
           FROM pg_tables t
           LEFT JOIN information_schema.role_table_grants g
             ON g.table_schema = t.schemaname AND g.table_name = t.tablename
          WHERE t.schemaname IN ('clm', 'audit', 'ref')
          GROUP BY 1`,
        [APP_ROLLEN],
      );

      const werkelijk = new Map(
        rows.map((r) => [
          r.volledige_naam,
          sorteer(r.rechten ? r.rechten.split(',') : []),
        ]),
      );

      const afwijkingen: string[] = [];

      for (const [naam, verwacht] of Object.entries(TABELRECHTEN)) {
        const gevonden = werkelijk.get(naam);

        if (gevonden === undefined) {
          afwijkingen.push(`${naam}: tabel niet gevonden in de database`);
          continue;
        }

        const verwachtGesorteerd = sorteer(verwacht);

        if (gevonden.join(',') !== verwachtGesorteerd.join(',')) {
          afwijkingen.push(
            `${naam}: verwacht [${verwachtGesorteerd.join(', ') || 'geen'}], ` +
              `gevonden [${gevonden.join(', ') || 'geen'}]`,
          );
        }
      }

      expect(afwijkingen).toEqual([]);
    });

    it('houdt de audit trail append-only', async () => {
      // Apart van de tabel hierboven, omdat dit een harde regel is (§7.7) en
      // geen contractkeuze: een audit trail die de applicatie kan wijzigen of
      // wissen bewijst niets meer.
      const { rows } = await client.query<{ privilege_type: string }>(
        `SELECT DISTINCT privilege_type
           FROM information_schema.role_table_grants
          WHERE table_schema = 'audit' AND grantee = ANY($1)`,
        [APP_ROLLEN],
      );

      const rechten = sorteer(rows.map((r) => r.privilege_type));

      expect(rechten).not.toContain('UPDATE');
      expect(rechten).not.toContain('DELETE');
      expect(rechten).not.toContain('TRUNCATE');
    });
  });

  describe('SECURITY DEFINER-functies', () => {
    it('heeft precies de functies die het contract kent', async () => {
      const { rows } = await client.query<{ proname: string }>(
        `SELECT proname FROM pg_proc
          WHERE pronamespace = 'clm'::regnamespace AND prosecdef
          ORDER BY proname`,
      );

      const gevonden = rows.map((r) => r.proname).sort();
      const verwacht = Object.keys(DEFINER_FUNCTIES).sort();

      // Een nieuwe definer-functie zonder regel in het contract hoort hier op
      // te vallen. Dat is het hele punt: search_path vergeten is stil, deze
      // test is dat niet.
      expect(gevonden).toEqual(verwacht);
    });

    it('pint search_path op elke definer-functie', async () => {
      const { rows } = await client.query<{
        proname: string;
        config: string | null;
      }>(
        `SELECT proname, array_to_string(proconfig, ', ') AS config
           FROM pg_proc
          WHERE pronamespace = 'clm'::regnamespace AND prosecdef`,
      );

      const afwijkingen = rows
        .filter((r) => {
          const contract = DEFINER_FUNCTIES[r.proname];
          return !contract || r.config !== contract.searchPath;
        })
        .map((r) => `${r.proname}: '${r.config ?? 'GEEN search_path'}'`);

      expect(afwijkingen).toEqual([]);
    });

    it('geeft PUBLIC nooit EXECUTE op een definer-functie', async () => {
      // De gevaarlijkste van de drie. Een definer-functie die iedereen mag
      // aanroepen draait met de rechten van de eigenaar — en die is eigenaar
      // van alle tabellen.
      const { rows } = await client.query<{
        proname: string;
        rechten: string | null;
      }>(
        `SELECT proname, array_to_string(proacl, ' ') AS rechten
           FROM pg_proc
          WHERE pronamespace = 'clm'::regnamespace AND prosecdef`,
      );

      const publiek = rows
        // proacl NULL betekent: de standaardrechten gelden, en die geven
        // PUBLIC uitvoerrecht. Een lege ACL is dus géén veilige stand.
        .filter((r) => r.rechten === null || /(^|\s)=X/.test(r.rechten))
        .map((r) => r.proname);

      expect(publiek).toEqual([]);
    });

    it('geeft EXECUTE aan precies de rollen uit het contract', async () => {
      // Uit proacl en niet uit information_schema.role_routine_grants: die view
      // matcht op routinenaam, en bij overloads (resolve_survey_token is drie
      // keer herzien) levert dat de rechten van meerdere signaturen door elkaar.
      // proacl hoort bij precies één functie.
      const { rows } = await client.query<{
        proname: string;
        rollen: string | null;
      }>(
        `SELECT p.proname,
                (SELECT string_agg(DISTINCT split_part(acl, '=', 1), ',')
                   FROM unnest(p.proacl::text[]) AS acl
                  WHERE split_part(acl, '=', 1) LIKE 'clm%') AS rollen
           FROM pg_proc p
          WHERE p.pronamespace = 'clm'::regnamespace AND p.prosecdef`,
      );

      const afwijkingen: string[] = [];

      for (const rij of rows) {
        const contract = DEFINER_FUNCTIES[rij.proname];
        if (!contract) continue; // gedekt door de test hierboven

        const gevonden = sorteer(rij.rollen ? rij.rollen.split(',') : []).join(
          ', ',
        );
        const verwacht = sorteer(contract.execute).join(', ');

        if (gevonden !== verwacht) {
          afwijkingen.push(
            `${rij.proname}: verwacht [${verwacht}], gevonden [${gevonden}]`,
          );
        }
      }

      expect(afwijkingen).toEqual([]);
    });
  });
});
