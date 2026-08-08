import { Client } from 'pg';

import { TEST_IDS } from './test-ids';

/**
 * Platformbeheer en tijdelijke support-toegang (migratie 0020, ADR-015).
 *
 * Deze suite bewaakt het besluit uit Issue #57: platformbeheer krijgt géén
 * leesrecht over tenants heen, maar wordt tijdelijk lid van díé ene tenant, in
 * een eigen rol. De tenantgrens blijft daarmee intact.
 *
 * Wat hier bewezen moet worden is niet dat de tabellen bestaan — dat doet
 * schema-conformiteit al — maar dat de versoepeling die 0020 aanbrengt precies
 * zo nauw is als bedoeld:
 *
 *   - een gewone gebruiker houdt de bescherming van 0009 volledig;
 *   - alleen 'support' mag daarnaast staan, en alleen tijdelijk;
 *   - RLS geldt ook voor support — een supportsessie ziet niet meer dan de
 *     tenant waarin hij te gast is.
 *
 * Die laatste is de kern. Een alziende platformrol zou hem niet halen, en dat
 * is precies waarom dat ontwerp is verworpen.
 */

const {
  tenantKlant: TENANT_KLANT_ID,
  tenantAnder: TENANT_ANDER_ID,
  beheerder: USER_BEHEERDER_ID,
  klantmedewerker: USER_KLANT_ID,
} = TEST_IDS.platformbeheer;

// Uniek per testrun: external_subject heeft een globale unieke index zónder
// tenant_id erin, dus een vaste waarde laat een tweede run falen op een rij van
// de vorige. Zie het runbook, "Een nieuwe e2e-suite schrijven".
const SUBJECT_BEHEERDER = `oid-platform-${Date.now()}`;
const SUBJECT_KLANT = `oid-klant-${Date.now()}`;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * De verbinding als migratierol, altijd naar dezelfde database als de tests.
 *
 * Deze suite heeft naast de runtime-rol ook de migratierol nodig, omdat
 * clm.platform_admin bewust buiten het bereik van de applicatie ligt.
 *
 * ── Waarom hier NIET simpelweg MIGRATION_DATABASE_URL wordt gelezen ──────────
 *
 * Omdat die variabele in `.env` staat en naar productie wijst. `npm run verify`
 * zet alleen DATABASE_URL; dotenv vult MIGRATION_DATABASE_URL dan stilzwijgend
 * aan met de Supabase-URL, en dan praat een e2e-suite tegen de
 * productiedatabase. Dat gebeurde op 2026-08-08 bij het schrijven van deze
 * suite: de eerste query faalde toevallig, anders had de test daar tenants
 * aangemaakt.
 *
 * Dat is dezelfde klasse fout als Issue #86 en als het incident van 2026-08-07.
 * Vandaar: de migratie-URL wordt *afgeleid* uit DATABASE_URL — dezelfde host,
 * dezelfde poort, dezelfde database, alleen een andere rol. Een expliciete
 * MIGRATION_DATABASE_URL wordt alleen gebruikt als hij op diezelfde database
 * uitkomt.
 */
function migratieUrl(): string {
  const runtime = process.env.DATABASE_URL;

  if (!runtime) {
    throw new Error('DATABASE_URL ontbreekt.');
  }

  const doel = new URL(runtime);
  const expliciet = process.env.MIGRATION_DATABASE_URL;

  if (expliciet) {
    const gegeven = new URL(expliciet);

    if (gegeven.host === doel.host && gegeven.pathname === doel.pathname) {
      return expliciet;
    }
    // Anders: bewust negeren. Hij wijst ergens anders heen dan de tests, en
    // dat is vrijwel zeker de productiedatabase uit .env.
  }

  doel.username = 'clm_migrator';
  return doel.toString();
}

// SET LOCAL accepteert geen query-parameters — PostgreSQL-restrictie, geen
// keuze. Vandaar expliciete UUID-validatie vooraf.
async function withTenantContext<T>(
  client: Client,
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!UUID_REGEX.test(tenantId)) {
    throw new Error(`Ongeldige tenant-id: '${tenantId}'`);
  }

  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    const resultaat = await fn();
    await client.query('COMMIT');
    return resultaat;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

describe('Platformbeheer (e2e, migratie 0020)', () => {
  let client: Client;
  let migratieClient: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    await withTenantContext(client, TENANT_KLANT_ID, async () => {
      await client.query(
        'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
        [TENANT_KLANT_ID, 'platform-test-klant'],
      );
      await client.query(
        `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
         VALUES ($1, $2, $3, $4)`,
        [
          USER_BEHEERDER_ID,
          TENANT_KLANT_ID,
          'Platformbeheerder',
          SUBJECT_BEHEERDER,
        ],
      );
      await client.query(
        `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
         VALUES ($1, $2, $3)`,
        [USER_BEHEERDER_ID, TENANT_KLANT_ID, 'admin'],
      );
    });

    // Platformbeheerder aanwijzen kan de runtime-rol niet — 0020 trekt die
    // rechten expliciet in. Dat is het punt van deze tabel, en de test moet
    // dus dezelfde weg nemen als de werkelijkheid: via de migratierol.
    migratieClient = new Client({ connectionString: migratieUrl() });
    await migratieClient.connect();
    await migratieClient.query(
      `INSERT INTO clm.platform_admin (user_id, toelichting)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [USER_BEHEERDER_ID, 'eigenaar van het platform'],
    );

    await withTenantContext(client, TENANT_ANDER_ID, async () => {
      await client.query(
        'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
        [TENANT_ANDER_ID, 'platform-test-ander'],
      );
      await client.query(
        `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
         VALUES ($1, $2, $3, $4)`,
        [USER_KLANT_ID, TENANT_ANDER_ID, 'Klantmedewerker', SUBJECT_KLANT],
      );
      await client.query(
        `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
         VALUES ($1, $2, $3)`,
        [USER_KLANT_ID, TENANT_ANDER_ID, 'admin'],
      );
    });
  });

  afterAll(async () => {
    // Volgorde telt: membership en user vóór tenant (ON DELETE RESTRICT op
    // user.tenant_id). platform_admin gaat mee via CASCADE op user_id, maar
    // die rij is via de migratierol gezet en gaat daar ook weer weg — de
    // runtime-rol mag hem niet verwijderen.
    await migratieClient.query(
      'DELETE FROM clm.platform_admin WHERE user_id = $1',
      [USER_BEHEERDER_ID],
    );
    await migratieClient.end();

    await withTenantContext(client, TENANT_ANDER_ID, async () => {
      await client.query(
        'DELETE FROM clm.tenant_membership WHERE tenant_id = $1',
        [TENANT_ANDER_ID],
      );
      await client.query('DELETE FROM clm."user" WHERE tenant_id = $1', [
        TENANT_ANDER_ID,
      ]);
      await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [
        TENANT_ANDER_ID,
      ]);
    });

    await withTenantContext(client, TENANT_KLANT_ID, async () => {
      await client.query(
        'DELETE FROM clm.tenant_membership WHERE tenant_id = $1',
        [TENANT_KLANT_ID],
      );
      await client.query('DELETE FROM clm."user" WHERE tenant_id = $1', [
        TENANT_KLANT_ID,
      ]);
      await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [
        TENANT_KLANT_ID,
      ]);
    });

    await client.end();
  });

  it('weigert een tweede actief membership voor een gewone gebruiker', async () => {
    // De bescherming uit 0009, ongewijzigd. 0020 maakte de index nauwer in
    // plaats van hem weg te halen; deze test is het bewijs dat de versoepeling
    // niet is doorgelekt naar admin en reviewer.
    await expect(
      withTenantContext(client, TENANT_ANDER_ID, async () => {
        await client.query(
          `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
           VALUES ($1, $2, $3)`,
          [USER_BEHEERDER_ID, TENANT_ANDER_ID, 'admin'],
        );
      }),
    ).rejects.toThrow(/tenant_membership_een_actief_per_gebruiker/);
  });

  it('staat een tijdelijk support-membership naast het eigen membership toe', async () => {
    await withTenantContext(client, TENANT_ANDER_ID, async () => {
      await client.query(
        `INSERT INTO clm.tenant_membership
           (user_id, tenant_id, role, verloopt_op, reden, toegekend_door)
         VALUES ($1, $2, 'support', now() + interval '8 hours', $3, $4)`,
        [
          USER_BEHEERDER_ID,
          TENANT_ANDER_ID,
          'Supportvraag over ronde 3',
          USER_BEHEERDER_ID,
        ],
      );
    });

    const { rows } = await withTenantContext(
      client,
      TENANT_ANDER_ID,
      async () =>
        client.query<{ role: string; reden: string; nog_geldig: boolean }>(
          `SELECT role, reden, (verloopt_op > now()) AS nog_geldig
             FROM clm.tenant_membership
            WHERE user_id = $1 AND tenant_id = $2`,
          [USER_BEHEERDER_ID, TENANT_ANDER_ID],
        ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('support');
    expect(rows[0].reden).toBe('Supportvraag over ronde 3');
    expect(rows[0].nog_geldig).toBe(true);
  });

  it('houdt RLS overeind voor een support-membership', async () => {
    // De kern van ADR-015. De beheerder is nu te gast in TENANT_ANDER, maar dat
    // geeft hem geen blik op zijn eigen tenant vanuit die context — laat staan
    // op een derde. Een alziende platformrol zou hier zakken.
    const { rows } = await withTenantContext(
      client,
      TENANT_ANDER_ID,
      async () =>
        client.query<{ tenant_id: string }>(
          'SELECT tenant_id FROM clm.tenant_membership',
        ),
    );

    expect(rows.every((r) => r.tenant_id === TENANT_ANDER_ID)).toBe(true);
    expect(rows.some((r) => r.tenant_id === TENANT_KLANT_ID)).toBe(false);
  });

  it('maakt verlopen support-toegang herkenbaar', async () => {
    await withTenantContext(client, TENANT_ANDER_ID, async () => {
      await client.query(
        `UPDATE clm.tenant_membership
            SET verloopt_op = now() - interval '1 minute'
          WHERE user_id = $1 AND tenant_id = $2 AND role = 'support'`,
        [USER_BEHEERDER_ID, TENANT_ANDER_ID],
      );
    });

    const { rows } = await withTenantContext(
      client,
      TENANT_ANDER_ID,
      async () =>
        client.query<{ telt_mee: boolean }>(
          `SELECT (verloopt_op IS NULL OR verloopt_op > now()) AS telt_mee
             FROM clm.tenant_membership
            WHERE user_id = $1 AND tenant_id = $2`,
          [USER_BEHEERDER_ID, TENANT_ANDER_ID],
        ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].telt_mee).toBe(false);

    // De rij blijft staan: wie wanneer waar mocht kijken is auditinformatie.
    // Opruimen zou het spoor wissen dat we juist willen houden.
  });

  it('weigert een rol die niet bestaat', async () => {
    await expect(
      withTenantContext(client, TENANT_ANDER_ID, async () => {
        await client.query(
          `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
           VALUES ($1, $2, 'superuser')`,
          [USER_KLANT_ID, TENANT_ANDER_ID],
        );
      }),
    ).rejects.toThrow(/tenant_membership_role_check/);
  });

  it('geeft de runtime-rol geen schrijfrecht op platform_admin', async () => {
    // Een platformbeheerder erbij zetten is een handeling van de migratierol,
    // bewust buiten de applicatie om. Zolang er geen scherm voor is, is dat de
    // veiligste stand — en deze test bewaakt dat de GRANT niet stilletjes
    // ruimer wordt.
    await expect(
      client.query(`INSERT INTO clm.platform_admin (user_id) VALUES ($1)`, [
        USER_KLANT_ID,
      ]),
    ).rejects.toThrow(/permission denied/i);
  });

  it('laat de runtime-rol wél lezen wie platformbeheerder is', async () => {
    // De guard moet die vraag per verzoek kunnen stellen.
    const { rows } = await client.query<{ user_id: string }>(
      'SELECT user_id FROM clm.platform_admin WHERE deleted_at IS NULL',
    );

    expect(rows.some((r) => r.user_id === USER_BEHEERDER_ID)).toBe(true);
  });
});
