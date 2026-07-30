import { Client } from 'pg';

/**
 * Sessies: onthouden wie er ingelogd is (migratie 0010, Issue #7).
 *
 * De sessietabel is de enige tenantgebonden tabel zónder RLS, en dat is een
 * bewuste uitzondering op §7.4. Reden: de sessie wordt opgezocht vóórdat de
 * tenantcontext bestaat — de tenant vólgt immers uit de sessie. Een policy op
 * current_tenant_id() zou hier altijd nul rijen opleveren.
 *
 * In plaats daarvan is de tabel volledig dicht voor de runtime-rol en loopt
 * alle toegang via drie SECURITY DEFINER-functies. De eerste twee tests
 * hieronder bewijzen dat die deur ook echt op slot zit — zonder die twee is de
 * rest van deze suite betekenisloos.
 */

const TENANT_ID = '00000000-0000-0000-0000-0000000000e5';
const USER_ID = '00000000-0000-0000-0000-0000000000f5';
const USER_ZONDER_LID_ID = '00000000-0000-0000-0000-0000000000f6';

const SUBJECT = `oid-sessie-${Date.now()}`;
const SUBJECT_ZONDER_LID = `oid-geen-lid-${Date.now()}`;

/** 64 hex-tekens, zoals de CHECK-constraint eist. */
function hash(zaad: string): string {
  return zaad.repeat(64).slice(0, 64);
}

interface SessieRij {
  sessie_id: string;
  user_id: string;
  tenant_id: string;
  role: string;
}

/**
 * Ruimt de testdata op. Draait zowel vóór als ná de suite, zodat een
 * afgebroken run de volgende niet blokkeert.
 *
 * De sessietabel staat niet onder RLS en is los te legen; user, membership en
 * tenant wél, dus die gaan binnen een tenantcontext. Volgorde is niet vrij:
 * membership en user vóór tenant (ON DELETE RESTRICT op user.tenant_id).
 */
async function verwijderTestdata(client: Client): Promise<void> {
  // Sessies verwijderen kan alleen via de functie of als eigenaar; de
  // runtime-rol mag niet rechtstreeks bij de tabel. Vandaar beeindigen() per
  // gebruikte hash — een DELETE zou hier op "permission denied" stuiten, en
  // dát die permissie ontbreekt is precies wat de eerste twee tests bewijzen.
  for (const zaad of ['a', 'b', 'c', 'd', 'e', '1', '2', '3', '4', '5', '6']) {
    await client.query('SELECT clm.sessie_beeindigen($1)', [hash(zaad)]);
  }

  await client.query('BEGIN');
  await client.query(`SET LOCAL app.current_tenant_id = '${TENANT_ID}'`);
  await client.query('DELETE FROM clm.tenant_membership WHERE tenant_id = $1', [
    TENANT_ID,
  ]);
  await client.query('DELETE FROM clm."user" WHERE tenant_id = $1', [
    TENANT_ID,
  ]);
  await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [
    TENANT_ID,
  ]);
  await client.query('COMMIT');
}

describe('Sessies (e2e, migratie 0010)', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    // Opruimen vóór opzetten: een afgebroken vorige run laat rijen achter, en
    // dan faalt deze suite op een duplicate key in plaats van op wat hij
    // hoort te testen. Zelf tegengekomen op 2026-07-30.
    await verwijderTestdata(client);

    // Opzet via de tenantcontext: user en membership staan wél onder RLS.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${TENANT_ID}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [TENANT_ID, 'sessie-test'],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
       VALUES ($1, $2, $3, $4), ($5, $2, $6, $7)`,
      [
        USER_ID,
        TENANT_ID,
        'Anna Admin',
        SUBJECT,
        USER_ZONDER_LID_ID,
        'Bob Buitenstaander',
        SUBJECT_ZONDER_LID,
      ],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [USER_ID, TENANT_ID],
    );
    await client.query('COMMIT');
  });

  afterAll(async () => {
    await verwijderTestdata(client);
    await client.end();
  });

  describe('de tabel is dicht voor de runtime-rol', () => {
    // Zonder deze twee tests bewijst de rest niets: dan zou de tabel net zo
    // goed open kunnen staan en zouden de functies een formaliteit zijn.

    it('weigert een directe SELECT op clm.sessie', async () => {
      await expect(
        client.query('SELECT count(*) FROM clm.sessie'),
      ).rejects.toThrow(/permission denied/i);
    });

    it('weigert een directe INSERT in clm.sessie', async () => {
      await expect(
        client.query(
          `INSERT INTO clm.sessie (token_hash, user_id, tenant_id, role, external_subject, verloopt_op)
           VALUES ($1, $2, $3, 'admin', 'x', now() + interval '1 hour')`,
          [hash('a'), USER_ID, TENANT_ID],
        ),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  describe('sessie_aanmaken()', () => {
    it('maakt een sessie voor een gebruiker met membership', async () => {
      const res = await client.query<SessieRij>(
        'SELECT * FROM clm.sessie_aanmaken($1, $2, $3)',
        [hash('b'), SUBJECT, '8 hours'],
      );

      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].user_id).toBe(USER_ID);
      expect(res.rows[0].tenant_id).toBe(TENANT_ID);
      expect(res.rows[0].role).toBe('admin');
    });

    it('weigert een gebruiker zonder membership', async () => {
      // Membership is de autorisatie. Een gebruiker die wel bestaat maar
      // nergens lid van is, hoort geen sessie te krijgen — ook niet als de
      // applicatielaag dat per ongeluk zou proberen.
      const res = await client.query(
        'SELECT * FROM clm.sessie_aanmaken($1, $2, $3)',
        [hash('c'), SUBJECT_ZONDER_LID, '8 hours'],
      );

      expect(res.rows).toHaveLength(0);
    });

    it('weigert een onbekend subject', async () => {
      const res = await client.query(
        'SELECT * FROM clm.sessie_aanmaken($1, $2, $3)',
        [hash('d'), 'bestaat-echt-niet', '8 hours'],
      );

      expect(res.rows).toHaveLength(0);
    });

    it('weigert een token_hash die geen SHA-256-afdruk is', async () => {
      // De CHECK-constraint vangt een bug af die het ruwe token zou
      // wegschrijven in plaats van de afdruk.
      await expect(
        client.query('SELECT * FROM clm.sessie_aanmaken($1, $2, $3)', [
          'dit-is-geen-hash',
          SUBJECT,
          '8 hours',
        ]),
      ).rejects.toThrow(/sessie_token_hash_format_check/);
    });
  });

  describe('sessie_oplossen()', () => {
    it('vindt een geldige sessie en geeft de tenantcontext terug', async () => {
      await client.query('SELECT * FROM clm.sessie_aanmaken($1, $2, $3)', [
        hash('e'),
        SUBJECT,
        '8 hours',
      ]);

      const res = await client.query<SessieRij>(
        'SELECT * FROM clm.sessie_oplossen($1, $2)',
        [hash('e'), '8 hours'],
      );

      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].tenant_id).toBe(TENANT_ID);
      expect(res.rows[0].role).toBe('admin');
    });

    it('geeft niets terug bij een onbekende hash', async () => {
      const res = await client.query(
        'SELECT * FROM clm.sessie_oplossen($1, $2)',
        [hash('9'), '8 hours'],
      );

      expect(res.rows).toHaveLength(0);
    });

    it('geeft niets terug bij NULL', async () => {
      const res = await client.query(
        'SELECT * FROM clm.sessie_oplossen($1, $2)',
        [null, '8 hours'],
      );

      expect(res.rows).toHaveLength(0);
    });

    it('schuift het venster op bij gebruik', async () => {
      // Glijdend venster van 8 uur (besluit eigenaar 2026-07-30): wie actief
      // is, blijft ingelogd.
      //
      // Gemeten zonder in de tabel te kijken — dat mag de runtime-rol niet, en
      // dat is precies het punt van deze migratie. In plaats daarvan: een
      // sessie met een kórte geldigheid aanmaken, hem oplossen met een lange
      // geldigheid, en vaststellen dat hij daarna nog leeft op een moment
      // waarop de oorspronkelijke termijn allang verstreken zou zijn.
      await client.query('SELECT * FROM clm.sessie_aanmaken($1, $2, $3)', [
        hash('1'),
        SUBJECT,
        '2 seconds',
      ]);

      // Verlengen naar 8 uur.
      const verlengd = await client.query(
        'SELECT * FROM clm.sessie_oplossen($1, $2)',
        [hash('1'), '8 hours'],
      );
      expect(verlengd.rows).toHaveLength(1);

      // Voorbij de oorspronkelijke 2 seconden.
      await new Promise((klaar) => setTimeout(klaar, 2500));

      const naWachten = await client.query(
        'SELECT * FROM clm.sessie_oplossen($1, $2)',
        [hash('1'), '8 hours'],
      );

      // Zonder verlenging was deze sessie nu verlopen geweest.
      expect(naWachten.rows).toHaveLength(1);
    });

    it('weigert een verlopen sessie', async () => {
      // Twee seconden geldig, dan wachten. Dat is trager dan een UPDATE op
      // verloopt_op, maar dat kán niet: de runtime-rol mag niet bij de tabel.
      await client.query('SELECT * FROM clm.sessie_aanmaken($1, $2, $3)', [
        hash('2'),
        SUBJECT,
        '2 seconds',
      ]);

      await new Promise((klaar) => setTimeout(klaar, 2500));

      const res = await client.query(
        'SELECT * FROM clm.sessie_oplossen($1, $2)',
        [hash('2'), '8 hours'],
      );

      expect(res.rows).toHaveLength(0);
    });
  });

  describe('sessie_beeindigen()', () => {
    it('maakt de sessie onbruikbaar', async () => {
      await client.query('SELECT * FROM clm.sessie_aanmaken($1, $2, $3)', [
        hash('3'),
        SUBJECT,
        '8 hours',
      ]);

      await client.query('SELECT clm.sessie_beeindigen($1)', [hash('3')]);

      const res = await client.query(
        'SELECT * FROM clm.sessie_oplossen($1, $2)',
        [hash('3'), '8 hours'],
      );

      expect(res.rows).toHaveLength(0);
    });

    it('maakt de sessie ook onbruikbaar bij een tweede poging', async () => {
      // Besluit eigenaar 2026-07-30: uitloggen gooit de rij weg. Dat de rij
      // écht verdwijnt en niet alleen gemarkeerd wordt, is van buitenaf niet
      // te zien — de runtime-rol mag niet in de tabel kijken. Wat wél te
      // bewijzen is: het token blijft onbruikbaar, hoe vaak je het ook
      // probeert.
      await client.query('SELECT * FROM clm.sessie_aanmaken($1, $2, $3)', [
        hash('4'),
        SUBJECT,
        '8 hours',
      ]);
      await client.query('SELECT clm.sessie_beeindigen($1)', [hash('4')]);

      for (let poging = 0; poging < 3; poging++) {
        const res = await client.query(
          'SELECT * FROM clm.sessie_oplossen($1, $2)',
          [hash('4'), '8 hours'],
        );
        expect(res.rows).toHaveLength(0);
      }
    });

    it('kan een token na uitloggen opnieuw uitgeven', async () => {
      // Dit bewijst indirect dát de rij verdwijnt: token_hash heeft een UNIQUE
      // constraint. Was de rij blijven staan met een markering, dan zou deze
      // tweede sessie_aanmaken() stuiten op een dubbele sleutel.
      await client.query('SELECT * FROM clm.sessie_aanmaken($1, $2, $3)', [
        hash('5'),
        SUBJECT,
        '8 hours',
      ]);
      await client.query('SELECT clm.sessie_beeindigen($1)', [hash('5')]);

      const opnieuw = await client.query<SessieRij>(
        'SELECT * FROM clm.sessie_aanmaken($1, $2, $3)',
        [hash('5'), SUBJECT, '8 hours'],
      );

      expect(opnieuw.rows).toHaveLength(1);
      expect(opnieuw.rows[0].tenant_id).toBe(TENANT_ID);
    });
  });
});
