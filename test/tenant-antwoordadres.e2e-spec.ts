import { Client } from 'pg';

import { verwijderTestdata } from './opruimen';
import { TEST_IDS } from './test-ids';

/**
 * Het antwoordadres van de tenant (migratie 0025).
 *
 * ── Waarom deze suite bestaat ────────────────────────────────────────────────
 *
 * `antwoordAan` bestond al door de hele mailketen — in `UitnodigingGegevens`,
 * in `MailBericht`, en als `replyTo` in het Resend-kanaal. Alleen: het werd
 * nergens gevuld. `UitnodigingContext` kende enkel `tenantNaam` en
 * `vragenlijstNaam`.
 *
 * Elke laag afzonderlijk was getest en groen. De keten als geheel was stuk, en
 * het gevolg was zichtbaar noch rood: een leverancier die op "Beantwoorden"
 * drukte kwam bij het platform terecht in plaats van bij de opdrachtgever.
 *
 * Dat is precies het soort gat dat unittests niet vinden — ze toetsen elke
 * schakel, niet of de schakels aan elkaar zitten. Vandaar dat deze suite de
 * kolom in de database toetst en niet de doorgifte in TypeScript.
 *
 * ── Wat hier NIET getest wordt ───────────────────────────────────────────────
 *
 * Of de mail werkelijk verstuurd wordt. Dat doet
 * `uitnodiging-verzender.service.spec.ts` met een testkanaal. Hier gaat het om
 * de vraag die daar niet gesteld kan worden: staat de waarde in de database, en
 * komt hij eruit zoals de applicatie hem verwacht.
 */

const { tenantMet: TENANT_MET, tenantZonder: TENANT_ZONDER } =
  TEST_IDS['tenant-antwoordadres'];

const ANTWOORDADRES = `contractmanagement+${Date.now()}@voorbeeld.nl`;

describe('Antwoordadres per tenant (e2e, migratie 0025)', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${TENANT_MET}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name, antwoord_email) VALUES ($1, $2, $3)',
      [TENANT_MET, `antwoordadres-met-${Date.now()}`, ANTWOORDADRES],
    );
    await client.query('COMMIT');

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${TENANT_ZONDER}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [TENANT_ZONDER, `antwoordadres-zonder-${Date.now()}`],
    );
    await client.query('COMMIT');
  }, 30000);

  afterAll(async () => {
    await verwijderTestdata(TENANT_MET, TENANT_ZONDER);
    await client.end();
  }, 30000);

  /** Leest de kolom binnen de tenantcontext, zoals de applicatie dat doet. */
  async function leesAntwoordadres(tenantId: string): Promise<string | null> {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    const { rows } = await client.query<{ antwoord_email: string | null }>(
      'SELECT antwoord_email FROM clm.tenant WHERE tenant_id = $1',
      [tenantId],
    );
    await client.query('COMMIT');

    return rows[0]?.antwoord_email ?? null;
  }

  describe('de kolom', () => {
    it('bewaart het adres van de tenant', async () => {
      expect(await leesAntwoordadres(TENANT_MET)).toBe(ANTWOORDADRES);
    });

    it('staat leeg toe — niet elke klant heeft een gedeeld postvak', async () => {
      expect(await leesAntwoordadres(TENANT_ZONDER)).toBeNull();
    });
  });

  describe('de vormcontrole', () => {
    it('staat plusadressering toe', async () => {
      // Hierop leunt de testopzet van het mailkanaal. Een constraint die '+'
      // weigert blokkeert niet een randgeval maar de manier waarop we het
      // systeem aantoonbaar maken.
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${TENANT_MET}'`);

      await expect(
        client.query(
          'UPDATE clm.tenant SET antwoord_email = $1 WHERE tenant_id = $2',
          ['beheer+mcm2@voorbeeld.nl', TENANT_MET],
        ),
      ).resolves.toBeDefined();

      await client.query('ROLLBACK');
    });

    it.each([
      ['zonder apenstaartje', 'geen-adres'],
      ['zonder punt in het domein', 'iemand@localhost'],
      ['met een spatie', 'ie mand@voorbeeld.nl'],
      ['leeg maar niet NULL', ''],
    ])('weigert een adres %s', async (_omschrijving, waarde) => {
      // De constraint hoort hetzelfde toe te staan als isGeldigMailadres() in
      // de applicatie. Zou de database ruimer zijn, dan kan er een waarde in
      // staan die de mailketen later weigert — en dan faalt de verzending pas
      // bij de eerste uitvraag.
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${TENANT_MET}'`);

      await expect(
        client.query(
          'UPDATE clm.tenant SET antwoord_email = $1 WHERE tenant_id = $2',
          [waarde, TENANT_MET],
        ),
      ).rejects.toThrow(/tenant_antwoord_email_format_check/);

      await client.query('ROLLBACK');
    });

    it('weigert een adres langer dan 254 tekens', async () => {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${TENANT_MET}'`);

      await expect(
        client.query(
          'UPDATE clm.tenant SET antwoord_email = $1 WHERE tenant_id = $2',
          [`${'a'.repeat(250)}@voorbeeld.nl`, TENANT_MET],
        ),
      ).rejects.toThrow(/tenant_antwoord_email_format_check/);

      await client.query('ROLLBACK');
    });
  });

  describe('de tenantgrens', () => {
    it('toont het adres van een andere tenant niet', async () => {
      // Het antwoordadres is gewone tenantdata en valt onder dezelfde policy
      // als de rest van clm.tenant. Deze tegenproef legt vast dat de nieuwe
      // kolom daar geen uitzondering op is.
      await client.query('BEGIN');
      await client.query(
        `SET LOCAL app.current_tenant_id = '${TENANT_ZONDER}'`,
      );
      const { rows } = await client.query(
        'SELECT antwoord_email FROM clm.tenant WHERE tenant_id = $1',
        [TENANT_MET],
      );
      await client.query('COMMIT');

      expect(rows).toHaveLength(0);
    });
  });
});
