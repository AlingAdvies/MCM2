import { Client } from 'pg';

import {
  genereerUitnodigingstoken,
  hashUitnodigingstoken,
} from '../src/auth/uitnodigingstoken';
import { verwijderTestdata } from './opruimen';
import { TEST_IDS } from './test-ids';

/**
 * De eerste login van een uitgenodigde beheerder (migratie 0024).
 *
 * ── Waarom deze suite zwaarder weegt dan hij lijkt ───────────────────────────
 *
 * `clm.koppel_eerste_login()` is de enige plek in het systeem waar een
 * Entra-identiteit aan een bestaande gebruikersrij wordt gehecht. Gaat daar
 * iets mis, dan is het gevolg niet "een test faalt" maar een account-overname:
 * iemand anders komt binnen als de beheerder van een klant.
 *
 * Elke voorwaarde wordt hier apart uitgelokt — niet omdat de code er
 * onbetrouwbaar uitziet, maar omdat een voorwaarde die niet getest is er net zo
 * goed niet kan zijn (§15b).
 *
 * ── Wat er veranderde in 0024 ────────────────────────────────────────────────
 *
 * De koppeling rustte in 0023 op het kennen van een e-mailadres, met een
 * idp-claim als waarborg. Die claim toetste de *vorm* van de login en niet wie
 * er inlogde, en sloot tegelijk elke niet-federatieve inlogmethode uit. Nu is
 * het uitnodigingstoken de waarborg: het bewijst dat deze toegang is toegekend.
 *
 * ── Wat er NIET getest wordt, en waarom ──────────────────────────────────────
 *
 * De echte Entra-flow. Die is op 2026-08-08 handmatig doorlopen en bewezen
 * (claims-meten.js); hem hier nabootsen zou een mock testen in plaats van de
 * database. Wat hier telt is wat de functie doet met wat er binnenkomt.
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

/** Het token uit de uitnodigingslink. De database kent alleen de hash. */
const TOKEN = genereerUitnodigingstoken();

interface Koppeling {
  user_id: string;
  tenant_id: string;
}

describe('Eerste login koppelen (e2e, migratie 0024)', () => {
  let client: Client;

  /** Roept de functie aan zoals de applicatie dat doet: met de hash. */
  async function koppel(
    oid: string,
    email: string | null,
    token: string | null = TOKEN,
  ): Promise<Koppeling[]> {
    const { rows } = await client.query<Koppeling>(
      'SELECT * FROM clm.koppel_eerste_login($1, $2, $3)',
      [oid, email, token === null ? null : hashUitnodigingstoken(token)],
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
              uitnodiging_hash = $1,
              koppelbaar_tot = now() + ($2 || ' days')::interval
        WHERE user_id = $3`,
      [hashUitnodigingstoken(TOKEN), String(dagen), USER_UITGENODIGD],
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

    // De uitgenodigde: e-mailadres en tokenhash bekend, oid nog niet.
    await client.query(
      `INSERT INTO clm."user"
         (user_id, tenant_id, full_name, email, uitnodiging_hash, koppelbaar_tot)
       VALUES ($1, $2, 'Uitgenodigde Admin', $3, $4,
               now() + interval '90 days')`,
      [
        USER_UITGENODIGD,
        TENANT,
        EMAIL_UITGENODIGD,
        hashUitnodigingstoken(TOKEN),
      ],
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

    it('sluit de uitnodiging na gebruik — beide sporen tegelijk', async () => {
      // Hash én vervaldatum op NULL. Alleen de datum wissen zou niet genoeg
      // zijn: dan blijft er een geldige hash in de database staan, en die is
      // precies wat een tweede poging nodig heeft.
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
      const { rows } = await client.query<{
        external_subject: string;
        uitnodiging_hash: string | null;
        koppelbaar_tot: Date | null;
      }>(
        `SELECT external_subject, uitnodiging_hash, koppelbaar_tot
           FROM clm."user" WHERE user_id = $1`,
        [USER_UITGENODIGD],
      );
      await client.query('COMMIT');

      expect(rows[0].external_subject).toBe(OID_NIEUW);
      expect(rows[0].uitnodiging_hash).toBeNull();
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
      expect(rows[0].new_values.via).toBe('uitnodigingstoken');
    });

    it('bewaart geen sleutelmateriaal in de audit trail', async () => {
      // De audit trail is voor de tenant leesbaar. Het token hoort daar niet
      // in, ook niet gehasht: een audit trail hoort te vertellen wát er
      // gebeurde, niet de sleutel te bewaren waarmee het kon.
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
      const { rows } = await client.query<{ regel: string }>(
        `SELECT new_values::text AS regel FROM audit.audit_event
          WHERE tenant_id = $1
            AND action_type = 'eerste_login_gekoppeld'
            AND entity_id = $2
          ORDER BY created_at DESC
          LIMIT 1`,
        [TENANT, USER_UITGENODIGD],
      );
      await client.query('COMMIT');

      expect(rows[0].regel).not.toContain(TOKEN);
      expect(rows[0].regel).not.toContain(hashUitnodigingstoken(TOKEN));
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

    it('koppelt de juiste rij wanneer twee tenants hetzelfde e-mailadres kennen', async () => {
      // Dit is de situatie die op productie ontstond: één persoon met één
      // e-mailadres, uitgenodigd in twee tenants. In 0023 was dat een
      // patstelling — twee kandidaten, dus weigeren — en kwam die persoon
      // nergens binnen.
      //
      // Met een token per uitnodiging is het geen patstelling meer maar een
      // keuze: het token wijst één rij aan. Dat is niet alleen veiliger, het is
      // ook het enige dat een platformbeheerder die zelf klant is werkbaar
      // maakt.
      const tokenTweede = genereerUitnodigingstoken();

      await client.query('BEGIN');
      await client.query(
        `SET LOCAL app.current_tenant_id = '${TENANT_TWEEDE}'`,
      );
      await client.query(
        'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
        [TENANT_TWEEDE, `eerste-login-tweede-${Date.now()}`],
      );
      const { rows: nieuw } = await client.query<{ user_id: string }>(
        `INSERT INTO clm."user"
           (tenant_id, full_name, email, uitnodiging_hash, koppelbaar_tot)
         VALUES ($1, 'Zelfde Adres', $2, $3, now() + interval '90 days')
         RETURNING user_id`,
        [TENANT_TWEEDE, EMAIL_UITGENODIGD, hashUitnodigingstoken(tokenTweede)],
      );
      await client.query('COMMIT');

      // Het token van de tweede tenant wijst de tweede rij aan, niet de eerste.
      const rijen = await koppel(
        `${OID_NIEUW}-tweede`,
        EMAIL_UITGENODIGD,
        tokenTweede,
      );

      expect(rijen).toHaveLength(1);
      expect(rijen[0].user_id).toBe(nieuw[0].user_id);
      expect(rijen[0].tenant_id).toBe(TENANT_TWEEDE);

      // Opruimen zodat de volgende test weer een schone stand heeft.
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

    it('laat twee openstaande uitnodigingen niet dezelfde hash delen', async () => {
      // De unieke index is wat "precies één kandidaat" van een telling in code
      // naar een eigenschap van de database verplaatst. Deze tegenproef legt
      // vast dat hij er is: zonder index zou dit slagen en zou één token naar
      // twee gebruikers wijzen.
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${TENANT}'`);

      await expect(
        client.query(
          `INSERT INTO clm."user"
             (tenant_id, full_name, email, uitnodiging_hash, koppelbaar_tot)
           VALUES ($1, 'Zelfde Token', $2, $3, now() + interval '90 days')`,
          [
            TENANT,
            `dubbel-token-${Date.now()}@voorbeeld.nl`,
            hashUitnodigingstoken(TOKEN),
          ],
        ),
      ).rejects.toThrow(/user_uitnodiging_hash_key/);

      await client.query('ROLLBACK');
    });

    it('weigert een hash die niet de vorm van een hash heeft', async () => {
      // De CHECK-constraint vangt af wat het meest waarschijnlijke ongeluk is:
      // het ruwe token opslaan in plaats van de hash.
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${TENANT}'`);

      await expect(
        client.query(
          `INSERT INTO clm."user"
             (tenant_id, full_name, email, uitnodiging_hash, koppelbaar_tot)
           VALUES ($1, 'Ruw Token', $2, $3, now() + interval '90 days')`,
          [TENANT, `ruw-${Date.now()}@voorbeeld.nl`, TOKEN],
        ),
      ).rejects.toThrow(/user_uitnodiging_hash_format_check/);

      await client.query('ROLLBACK');
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

    it('weigert een login zonder token', async () => {
      // De kern van 0024: het e-mailadres alleen is niet genoeg meer. Dit is de
      // aanval die 0023 als aanvaard restrisico opschreef — wie het adres kent,
      // komt binnen — en die hier nu op afketst.
      const rijen = await koppel(
        `${OID_NIEUW}-geen-token`,
        EMAIL_UITGENODIGD,
        null,
      );

      expect(rijen).toHaveLength(0);
    });

    it('weigert een token dat bij niemand hoort', async () => {
      const rijen = await koppel(
        `${OID_NIEUW}-vals-token`,
        EMAIL_UITGENODIGD,
        genereerUitnodigingstoken(),
      );

      expect(rijen).toHaveLength(0);
    });

    it('weigert een geldig token bij het verkeerde e-mailadres', async () => {
      // Beide moeten kloppen. Een link die bij de verkeerde persoon belandt is
      // daarmee waardeloos, ook als die persoon hem eerder opent dan de
      // geadresseerde.
      const rijen = await koppel(
        `${OID_NIEUW}-ander-adres`,
        `iemand-anders-${Date.now()}@voorbeeld.nl`,
      );

      expect(rijen).toHaveLength(0);
    });

    it('werkt precies één keer — na koppelen vindt een tweede poging niets', async () => {
      // De tegenproef bij "sluit de uitnodiging na gebruik": zonder deze zou
      // dat een bewering over een kolom blijven in plaats van over gedrag.
      const eerste = await koppel(`${OID_NIEUW}-eenmalig`, EMAIL_UITGENODIGD);
      expect(eerste).toHaveLength(1);

      const tweede = await koppel(`${OID_NIEUW}-eenmalig-2`, EMAIL_UITGENODIGD);
      expect(tweede).toHaveLength(0);
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
