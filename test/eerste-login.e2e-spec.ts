import { Client } from 'pg';

import { verwijderTestdata } from './opruimen';
import { TEST_IDS } from './test-ids';

/**
 * De eerste login van een uitgenodigde beheerder (migratie 0023).
 *
 * ── Waarom deze suite zwaarder weegt dan hij lijkt ───────────────────────────
 *
 * `clm.koppel_eerste_login()` is de enige plek in het systeem waar een
 * Entra-identiteit aan een bestaande gebruikersrij wordt gehecht. Gaat daar
 * iets mis, dan is het gevolg niet "een test faalt" maar een account-overname:
 * iemand anders komt binnen als de beheerder van een klant.
 *
 * De functie kent vijf voorwaarden. Deze suite lokt ze alle vijf uit — niet
 * omdat de code er onbetrouwbaar uitziet, maar omdat een voorwaarde die niet
 * getest is er net zo goed niet kan zijn (§15b).
 *
 * ── Wat er NIET getest wordt, en waarom ──────────────────────────────────────
 *
 * De echte Entra-flow. Die is op 2026-08-08 handmatig doorlopen en bewezen
 * (claims-meten.js); hem hier nabootsen zou een mock testen in plaats van de
 * database. Wat hier telt is wat de functie doet met de claims die binnenkomen.
 */

const {
  tenant: TENANT,
  tenantTweede: TENANT_TWEEDE,
  uitgenodigd: USER_UITGENODIGD,
  bestaand: USER_BESTAAND,
} = TEST_IDS['eerste-login'];

// Uniek per run: external_subject heeft een globale unieke index zonder
// tenant_id erin. Zie het runbook, "Een nieuwe e2e-suite schrijven".
const OID_NIEUW = `oid-eerste-login-${Date.now()}`;
const OID_BESTAAND = `oid-bestaand-${Date.now()}`;
const EMAIL_UITGENODIGD = `uitgenodigd-${Date.now()}@voorbeeld.nl`;
const EMAIL_BESTAAND = `bestaand-${Date.now()}@voorbeeld.nl`;

/** Een geloofwaardige idp-claim, zoals Entra hem bij federatie levert. */
const IDP =
  'https://login.microsoftonline.com/3ce5523c-cc8b-4422-a310-8bdfa3715168/v2.0';

interface Koppeling {
  user_id: string;
  tenant_id: string;
}

describe('Eerste login koppelen (e2e, migratie 0023)', () => {
  let client: Client;

  /** Roept de functie aan zoals de applicatie dat doet. */
  async function koppel(
    oid: string,
    email: string | null,
    idp: string | null = IDP,
  ): Promise<Koppeling[]> {
    const { rows } = await client.query<Koppeling>(
      'SELECT * FROM clm.koppel_eerste_login($1, $2, $3)',
      [oid, email, idp],
    );
    return rows;
  }

  /** Zet de uitnodiging terug in de wachtende stand. */
  async function herstelUitnodiging(dagen = 90): Promise<void> {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
    await client.query(
      `UPDATE clm."user"
          SET external_subject = NULL,
              koppelbaar_tot = now() + ($1 || ' days')::interval
        WHERE user_id = $2`,
      [String(dagen), USER_UITGENODIGD],
    );
    await client.query('COMMIT');
  }

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [TENANT, `eerste-login-${Date.now()}`],
    );

    // De uitgenodigde: e-mailadres bekend, oid nog niet.
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, email, koppelbaar_tot)
       VALUES ($1, $2, 'Uitgenodigde Admin', $3, now() + interval '90 days')`,
      [USER_UITGENODIGD, TENANT, EMAIL_UITGENODIGD],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [USER_UITGENODIGD, TENANT],
    );

    // Iemand die al is ingelogd: heeft een oid, geen uitnodiging.
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, email, external_subject)
       VALUES ($1, $2, 'Bestaande Gebruiker', $3, $4)`,
      [USER_BESTAAND, TENANT, EMAIL_BESTAAND, OID_BESTAAND],
    );
    await client.query('COMMIT');
  }, 30000);

  afterAll(async () => {
    await verwijderTestdata(TENANT, TENANT_TWEEDE);
    await client.end();
  }, 30000);

  describe('de gelukkige weg', () => {
    it('koppelt de oid aan de wachtende rij en geeft de tenant terug', async () => {
      const rijen = await koppel(OID_NIEUW, EMAIL_UITGENODIGD);

      expect(rijen).toHaveLength(1);
      expect(rijen[0].user_id).toBe(USER_UITGENODIGD);
      expect(rijen[0].tenant_id).toBe(TENANT);
    });

    it('sluit de uitnodiging na gebruik', async () => {
      // koppelbaar_tot op NULL: de rij is niet nóg een keer koppelbaar. Zonder
      // dit zou een tweede persoon met hetzelfde e-mailadres later alsnog
      // kunnen proberen.
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
      const { rows } = await client.query<{
        external_subject: string;
        koppelbaar_tot: Date | null;
      }>(
        'SELECT external_subject, koppelbaar_tot FROM clm."user" WHERE user_id = $1',
        [USER_UITGENODIGD],
      );
      await client.query('COMMIT');

      expect(rows[0].external_subject).toBe(OID_NIEUW);
      expect(rows[0].koppelbaar_tot).toBeNull();
    });

    it('legt de koppeling vast in de audit trail', async () => {
      // Op entity_id filteren en niet op tenant_id alleen: de suite koppelt in
      // latere tests nog een paar keer, en de audit trail is append-only — die
      // regels blijven dus staan. Precies wat een audit trail hoort te doen,
      // maar het maakt "er is er één" een verkeerde verwachting.
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
      const { rows } = await client.query<{
        new_values: Record<string, unknown>;
      }>(
        `SELECT new_values FROM audit.audit_event
          WHERE tenant_id = $1
            AND action_type = 'eerste_login_gekoppeld'
            AND entity_id = $2
          ORDER BY created_at DESC
          LIMIT 1`,
        [TENANT, USER_UITGENODIGD],
      );
      await client.query('COMMIT');

      expect(rows).toHaveLength(1);
      expect(rows[0].new_values.identity_provider).toBe(IDP);
    });

    it('laat de gekoppelde gebruiker daarna gewoon inloggen', async () => {
      // De hele reden dat deze functie bestaat: sessie_aanmaken() zoekt op
      // external_subject, en die is nu gevuld.
      const { rows } = await client.query<{ tenant_id: string; role: string }>(
        `SELECT tenant_id, role
           FROM clm.sessie_aanmaken($1, $2, '8 hours'::interval)`,
        [`${'a'.repeat(48)}7e7e7e7e7e7e7e7e`, OID_NIEUW],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].tenant_id).toBe(TENANT);
      expect(rows[0].role).toBe('admin');
    });
  });

  describe('de vijf voorwaarden', () => {
    beforeEach(async () => {
      await herstelUitnodiging();
    });

    it('weigert wanneer de oid al aan iemand anders hangt', async () => {
      // Voorwaarde 2, en de gevaarlijkste van de vijf: dit zou een bestaande
      // gebruiker overschrijven met de identiteit van een ander.
      const rijen = await koppel(OID_BESTAAND, EMAIL_UITGENODIGD);

      expect(rijen).toHaveLength(0);
    });

    it('weigert wanneer twee rijen hetzelfde e-mailadres hebben', async () => {
      // Voorwaarde 1. Gokken zou betekenen dat de uitkomst van volgorde
      // afhangt — en dan bepaalt toeval wie er binnenkomt.
      await client.query('BEGIN');
      await client.query(
        `SET LOCAL app.current_tenant_id = '${TENANT_TWEEDE}'`,
      );
      await client.query(
        'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
        [TENANT_TWEEDE, `eerste-login-tweede-${Date.now()}`],
      );
      await client.query(
        `INSERT INTO clm."user" (tenant_id, full_name, email, koppelbaar_tot)
         VALUES ($1, 'Dubbel Adres', $2, now() + interval '90 days')`,
        [TENANT_TWEEDE, EMAIL_UITGENODIGD],
      );
      await client.query('COMMIT');

      const rijen = await koppel(`${OID_NIEUW}-tweede`, EMAIL_UITGENODIGD);

      expect(rijen).toHaveLength(0);

      // Opruimen zodat de volgende test weer één kandidaat heeft.
      await client.query('BEGIN');
      await client.query(
        `SET LOCAL app.current_tenant_id = '${TENANT_TWEEDE}'`,
      );
      await client.query('DELETE FROM clm."user" WHERE tenant_id = $1', [
        TENANT_TWEEDE,
      ]);
      await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [
        TENANT_TWEEDE,
      ]);
      await client.query('COMMIT');
    });

    it('weigert een verlopen uitnodiging', async () => {
      // Voorwaarde 3. Zonder deze grens blijft elke ooit aangemaakte rij
      // eeuwig koppelbaar.
      await herstelUitnodiging(-1);

      const rijen = await koppel(`${OID_NIEUW}-verlopen`, EMAIL_UITGENODIGD);

      expect(rijen).toHaveLength(0);
    });

    it('weigert een rij zonder uitnodiging', async () => {
      // Voorwaarde 3, andere kant: koppelbaar_tot NULL is de veilige stand.
      // Elke bestaande gebruiker in de database staat zo.
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
      await client.query(
        `UPDATE clm."user" SET external_subject = NULL, koppelbaar_tot = NULL
          WHERE user_id = $1`,
        [USER_UITGENODIGD],
      );
      await client.query('COMMIT');

      const rijen = await koppel(`${OID_NIEUW}-zonder`, EMAIL_UITGENODIGD);

      expect(rijen).toHaveLength(0);
    });

    it('weigert een onbekend e-mailadres', async () => {
      // Voorwaarde 4.
      const rijen = await koppel(
        `${OID_NIEUW}-onbekend`,
        `niemand-${Date.now()}@voorbeeld.nl`,
      );

      expect(rijen).toHaveLength(0);
    });

    it('weigert een login zonder federatieve provider', async () => {
      // Voorwaarde 5. Entra levert geen email_verified; de idp-claim is wat er
      // wél is, en die zegt dat de gebruiker bij zijn eigen organisatie is
      // geauthenticeerd.
      const rijen = await koppel(
        `${OID_NIEUW}-geen-idp`,
        EMAIL_UITGENODIGD,
        null,
      );

      expect(rijen).toHaveLength(0);
    });

    it('weigert een leeg e-mailadres', async () => {
      const rijen = await koppel(`${OID_NIEUW}-leeg`, null);

      expect(rijen).toHaveLength(0);
    });
  });

  describe('hoofdletters', () => {
    beforeEach(async () => {
      await herstelUitnodiging();
    });

    it('koppelt ongeacht de schrijfwijze van het e-mailadres', async () => {
      // Een identity provider mag het adres anders teruggeven dan het is
      // ingevoerd. Zou dat niet matchen, dan strandt een geldige uitnodiging op
      // een hoofdletter — met een foutmelding die nergens naar wijst.
      const rijen = await koppel(
        `${OID_NIEUW}-hoofdletters`,
        EMAIL_UITGENODIGD.toUpperCase(),
      );

      expect(rijen).toHaveLength(1);
      expect(rijen[0].user_id).toBe(USER_UITGENODIGD);
    });
  });
});
