import { Client } from 'pg';

/**
 * Testdata opruimen — één plek, voor alle suites.
 *
 * ── Waarom dit bestaat ───────────────────────────────────────────────────────
 *
 * Vijf suites hadden elk een eigen `verwijderTestdata`, vrijwel identiek maar
 * net niet. Twee ervan ruimden `clm.response_note` niet op, en dat is precies
 * hoe een berg testdata ontstaat: niet met een grote fout, maar met vijf kopieën
 * die uit elkaar groeien.
 *
 * ── Waarom via de migratierol ────────────────────────────────────────────────
 *
 * Sinds migratie 0022 heeft de applicatierol geen `DELETE` op `survey_review`
 * en `response_note`: een oordeel of notitie wordt zacht verwijderd. Dat is de
 * stand op productie, en de tests horen die te delen — anders bewijzen ze niet
 * wat ze lijken te bewijzen.
 *
 * Opruimen is dan ook geen applicatiehandeling meer maar een beheerhandeling,
 * en die hoort bij de migratierol. Dat is geen omweg om de beperking heen: de
 * applicatie kán het niet, en dat is het punt.
 *
 * ── Waarom dat veilig is ─────────────────────────────────────────────────────
 *
 * Sinds 2026-08-09 controleert `jest-e2e.guard.ts` **beide** verbindingen op de
 * wegwerpmarkering. Een suite die deze helper gebruikt kan dus per constructie
 * niet tegen productie of tegen de demo-database draaien — ongeacht wat er in
 * `.env` staat. Zonder die poort zou deze helper een achterdeur zijn.
 */

/**
 * De volgorde waarin tabellen leeg moeten, en waarom die vastligt.
 *
 * Van blad naar wortel: elke tabel verwijst naar iets dat verderop in deze
 * lijst staat. `clm.tenant` moet als laatste, want `clm."user"` heeft er een
 * `ON DELETE RESTRICT` naartoe — omgekeerd stuit het opruimen op een
 * foreign-keyfout die naar de verkeerde oorzaak wijst.
 *
 * Alle tenantgebonden tabellen staan hier, ook als een suite ze niet gebruikt.
 * Een `DELETE` op een lege tabel kost niets; een vergeten tabel kost een
 * volgende testrun.
 */
const TABELLEN_IN_VOLGORDE = [
  'clm.response_note',
  'clm.survey_review',
  'clm.template_reviewer',
  'clm.survey_answer',
  'clm.survey_attachment',
  'clm.survey_response',
  'clm.survey_run',
  'clm.survey_question',
  'clm.survey_category',
  'clm.survey_template',
  'clm.vendor_tag',
  'clm.vendor_contact',
  'clm.vendor',
  'clm.tenant_membership',
  'clm."user"',
  'clm.tenant',
] as const;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * De verbinding als migratierol, altijd naar dezelfde database als de tests.
 *
 * Leest MIGRATION_DATABASE_URL alleen als die op dezelfde database uitkomt als
 * DATABASE_URL. Wijst hij ergens anders heen, dan is dat vrijwel zeker de
 * productie-URL uit `.env` die dotenv heeft aangevuld — en dan negeren we hem
 * en leiden we de verbinding af.
 *
 * Dat is een tweede slot naast de wegwerppoort. Die zou hier al ingrijpen; deze
 * controle zorgt dat het niet eens zover komt.
 */
function migratieUrl(): string {
  const runtime = process.env.DATABASE_URL;

  if (!runtime) {
    throw new Error('DATABASE_URL ontbreekt — opruimen kan niet.');
  }

  const doel = new URL(runtime);
  const expliciet = process.env.MIGRATION_DATABASE_URL;

  if (expliciet) {
    const gegeven = new URL(expliciet);

    if (gegeven.host === doel.host && gegeven.pathname === doel.pathname) {
      return expliciet;
    }
  }

  doel.username = 'clm_migrator';
  return doel.toString();
}

/**
 * Verwijdert alle data van de opgegeven tenants.
 *
 * Opent een eigen verbinding als migratierol en sluit die weer. Dat is bewust:
 * een suite die deze helper aanroept hoeft niets te weten over rollen, en er
 * blijft geen verbinding open na afloop.
 *
 * @param tenantIds De tenants die opgeruimd moeten worden.
 */
export async function verwijderTestdata(
  ...tenantIds: readonly string[]
): Promise<void> {
  for (const id of tenantIds) {
    if (!UUID_REGEX.test(id)) {
      throw new Error(`Ongeldige tenant-id bij opruimen: '${id}'`);
    }
  }

  const client = new Client({ connectionString: migratieUrl() });
  await client.connect();

  try {
    for (const tenantId of tenantIds) {
      await client.query('BEGIN');

      // SET LOCAL accepteert geen parameters — vandaar de UUID-controle
      // hierboven, vóór de verbinding.
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`);

      // Zonder 'medewerker' weigert de policy op survey_review élke rij, ook
      // bij het opruimen. Dat is precies wat die policy hoort te doen.
      await client.query(`SET LOCAL app.current_actor = 'medewerker'`);

      for (const tabel of TABELLEN_IN_VOLGORDE) {
        await client.query(`DELETE FROM ${tabel} WHERE tenant_id = $1`, [
          tenantId,
        ]);
      }

      await client.query('COMMIT');
    }

    // De audit trail staat buiten de lus: audit.audit_event heeft geen policy
    // die tenantcontext nodig heeft, en de runtime-rol mag er sowieso niet uit
    // verwijderen (§7.7 — append-only).
    for (const tenantId of tenantIds) {
      await client.query('DELETE FROM audit.audit_event WHERE tenant_id = $1', [
        tenantId,
      ]);
    }
  } finally {
    await client.end().catch(() => {
      // Sluiten mag mislukken; het opruimen is dan al gebeurd.
    });
  }
}
