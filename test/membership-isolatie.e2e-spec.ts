import { Client } from 'pg';

/**
 * Tenant-isolatie en garanties op clm.tenant_membership (migratie 0009).
 *
 * Deze tabel is de basis onder Issue #7: de guard leidt de tenantcontext af uit
 * membership in plaats van uit een ongeverifieerde header. Een lek hier is geen
 * gewone bug maar een omzeiling van de tenantgrens zelf — vandaar dat zowel
 * lezen als schrijven cross-tenant wordt uitgelokt (MCM2-CLAUDE.md §7.4).
 *
 * De kern van deze suite is de combinatie van twee tests die tegenstrijdig
 * lijken:
 *   - "toont geen memberships zonder tenantcontext" (RLS doet zijn werk)
 *   - "gebruiker_bij_subject vindt de gebruiker WEL zonder tenantcontext"
 *
 * Dat is precies het kip-ei-probleem dat 0009 oplost. De guard moet de tenant
 * vaststellen vóórdat er tenantcontext is — anders zijn de enige uitwegen een
 * BYPASSRLS-rol (verboden, §6) of de client laten vertellen welke tenant hij
 * wil (de header die we juist afschaffen).
 */

const TENANT_A_ID = '00000000-0000-0000-0000-0000000000e1';
const TENANT_B_ID = '00000000-0000-0000-0000-0000000000e2';

const USER_A_ID = '00000000-0000-0000-0000-0000000000f1';
const USER_B_ID = '00000000-0000-0000-0000-0000000000f2';

// Uniek per testrun: external_subject heeft een globale unieke index, dus een
// vaste waarde zou een tweede run laten falen op een rij van de vorige.
const SUBJECT_A = `oid-test-a-${Date.now()}`;
const SUBJECT_B = `oid-test-b-${Date.now()}`;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MembershipRow {
  user_id: string;
  tenant_id: string;
  role: string;
}

// SET LOCAL accepteert geen query-parameters ($1) — PostgreSQL-restrictie,
// geen keuze. Vandaar expliciete UUID-validatie vooraf.
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
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

describe('Membership-isolatie (e2e, migratie 0009)', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    // Twee tenants met elk één gebruiker en één membership.
    await withTenantContext(client, TENANT_A_ID, async () => {
      await client.query(
        'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
        [TENANT_A_ID, 'membership-test-a'],
      );
      await client.query(
        `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
         VALUES ($1, $2, $3, $4)`,
        [USER_A_ID, TENANT_A_ID, 'Anna Admin', SUBJECT_A],
      );
      await client.query(
        `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
         VALUES ($1, $2, $3)`,
        [USER_A_ID, TENANT_A_ID, 'admin'],
      );
    });

    await withTenantContext(client, TENANT_B_ID, async () => {
      await client.query(
        'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
        [TENANT_B_ID, 'membership-test-b'],
      );
      await client.query(
        `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
         VALUES ($1, $2, $3, $4)`,
        [USER_B_ID, TENANT_B_ID, 'Bob Beoordelaar', SUBJECT_B],
      );
      await client.query(
        `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
         VALUES ($1, $2, $3)`,
        [USER_B_ID, TENANT_B_ID, 'reviewer'],
      );
    });
  });

  afterAll(async () => {
    // Volgorde telt: membership en user vóór tenant (ON DELETE RESTRICT op
    // user.tenant_id). Membership zelf gaat mee via CASCADE op user_id, maar
    // expliciet opruimen maakt de bedoeling zichtbaar.
    for (const [tenantId, userId] of [
      [TENANT_A_ID, USER_A_ID],
      [TENANT_B_ID, USER_B_ID],
    ]) {
      await withTenantContext(client, tenantId, async () => {
        await client.query(
          'DELETE FROM clm.tenant_membership WHERE user_id = $1',
          [userId],
        );
        await client.query('DELETE FROM clm."user" WHERE user_id = $1', [
          userId,
        ]);
        await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [
          tenantId,
        ]);
      });
    }

    await client.end();
  });

  it('gebruikt geen BYPASSRLS-rol', async () => {
    const res = await client.query<{ rolbypassrls: boolean }>(
      'SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(res.rows[0].rolbypassrls).toBe(false);
  });

  it('toont geen memberships zonder tenantcontext', async () => {
    const res = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM clm.tenant_membership',
    );
    expect(res.rows[0].count).toBe(0);
  });

  it('toont binnen een tenantcontext uitsluitend de eigen memberships', async () => {
    await withTenantContext(client, TENANT_A_ID, async () => {
      const res = await client.query<MembershipRow>(
        'SELECT user_id, tenant_id, role FROM clm.tenant_membership',
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].user_id).toBe(USER_A_ID);
      expect(res.rows[0].role).toBe('admin');
    });
  });

  it('weigert cross-tenant lezen (context A ziet membership van B niet)', async () => {
    await withTenantContext(client, TENANT_A_ID, async () => {
      const res = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM clm.tenant_membership WHERE tenant_id = $1',
        [TENANT_B_ID],
      );
      expect(res.rows[0].count).toBe(0);
    });
  });

  // Tegenproef uitgevoerd op 2026-07-30, en die leverde een verrassing op.
  //
  // Eerste poging: WITH CHECK uit de policy halen. Alle 13 tests bleven groen.
  // Reden: PostgreSQL valt bij een ontbrekende WITH CHECK terug op de
  // USING-expressie om schrijfacties te toetsen. De bescherming bleef dus
  // bestaan — maar niet door de clausule die deze test denkt te bewaken.
  //
  // Tweede poging, wél scherp: USING (true) met een strenge WITH CHECK. Toen
  // vielen precies de vier leestests om en bleef déze groen. Daarmee is
  // aangetoond dat elke clausule zijn eigen test heeft:
  //   USING      → de vier leestests hierboven
  //   WITH CHECK → deze test
  it('weigert cross-tenant schrijven (WITH CHECK op de policy)', async () => {
    await expect(
      withTenantContext(client, TENANT_A_ID, async () => {
        await client.query(
          `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
           VALUES ($1, $2, $3)`,
          [USER_B_ID, TENANT_B_ID, 'admin'],
        );
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('raakt met een cross-tenant UPDATE geen enkele rij', async () => {
    await withTenantContext(client, TENANT_A_ID, async () => {
      const res = await client.query(
        `UPDATE clm.tenant_membership SET role = 'admin' WHERE tenant_id = $1`,
        [TENANT_B_ID],
      );
      expect(res.rowCount).toBe(0);
    });

    // En het membership van B is inderdaad onveranderd.
    await withTenantContext(client, TENANT_B_ID, async () => {
      const res = await client.query<MembershipRow>(
        'SELECT role FROM clm.tenant_membership WHERE user_id = $1',
        [USER_B_ID],
      );
      expect(res.rows[0].role).toBe('reviewer');
    });
  });

  describe('clm.gebruiker_bij_subject()', () => {
    it('vindt de gebruiker ZONDER tenantcontext — dit lost het kip-ei-probleem op', async () => {
      // Geen withTenantContext: dit is exact de situatie van de guard, die de
      // tenant nog moet vaststellen. Zou dit niets teruggeven, dan was de enige
      // uitweg een BYPASSRLS-rol of een client-opgegeven tenant.
      const res = await client.query<MembershipRow>(
        'SELECT user_id, tenant_id, role FROM clm.gebruiker_bij_subject($1)',
        [SUBJECT_B],
      );

      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].user_id).toBe(USER_B_ID);
      expect(res.rows[0].tenant_id).toBe(TENANT_B_ID);
      expect(res.rows[0].role).toBe('reviewer');
    });

    it('geeft niets terug voor een onbekend subject', async () => {
      const res = await client.query(
        'SELECT * FROM clm.gebruiker_bij_subject($1)',
        ['bestaat-echt-niet'],
      );
      expect(res.rows).toHaveLength(0);
    });

    it('geeft niets terug voor NULL', async () => {
      // Zonder de expliciete NULL-controle in de functie zou dit alle rijen
      // met external_subject IS NULL kunnen matchen.
      const res = await client.query(
        'SELECT * FROM clm.gebruiker_bij_subject($1)',
        [null],
      );
      expect(res.rows).toHaveLength(0);
    });

    it('geeft een zacht verwijderd membership niet terug', async () => {
      await withTenantContext(client, TENANT_A_ID, async () => {
        await client.query(
          'UPDATE clm.tenant_membership SET deleted_at = now() WHERE user_id = $1',
          [USER_A_ID],
        );
      });

      const res = await client.query(
        'SELECT * FROM clm.gebruiker_bij_subject($1)',
        [SUBJECT_A],
      );
      expect(res.rows).toHaveLength(0);

      // Terugdraaien: de overige tests en de teardown rekenen op de actieve rij.
      await withTenantContext(client, TENANT_A_ID, async () => {
        await client.query(
          'UPDATE clm.tenant_membership SET deleted_at = NULL WHERE user_id = $1',
          [USER_A_ID],
        );
      });
    });
  });

  describe('garanties uit de constraints', () => {
    it('weigert een tweede actief membership voor dezelfde gebruiker', async () => {
      // Alleen platformbeheer heeft meerdere tenants nodig, en dat vraagt een
      // eigen auditbaar mechanisme (Issue #57). Tot dat besluit is dit de
      // strengste stand.
      await expect(
        withTenantContext(client, TENANT_A_ID, async () => {
          await client.query(
            `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
             VALUES ($1, $2, $3)`,
            [USER_A_ID, TENANT_A_ID, 'reviewer'],
          );
        }),
      ).rejects.toThrow();
    });

    it('weigert een onbekende rol', async () => {
      await expect(
        withTenantContext(client, TENANT_A_ID, async () => {
          await client.query(
            `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
             VALUES ($1, $2, $3)`,
            [USER_A_ID, TENANT_A_ID, 'superuser'],
          );
        }),
      ).rejects.toThrow(/tenant_membership_role_check/);
    });

    it('weigert twee gebruikers met hetzelfde external_subject', async () => {
      await expect(
        withTenantContext(client, TENANT_B_ID, async () => {
          await client.query(
            `INSERT INTO clm."user" (tenant_id, full_name, external_subject)
             VALUES ($1, $2, $3)`,
            [TENANT_B_ID, 'Nep-Anna', SUBJECT_A],
          );
        }),
      ).rejects.toThrow(/user_external_subject_key/);
    });
  });
});
