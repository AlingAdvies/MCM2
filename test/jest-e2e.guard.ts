import { Client } from 'pg';

/**
 * Weigert de e2e-tests te draaien tegen een database die niet als wegwerp is
 * gemarkeerd (migratie 0019).
 *
 * ── Waarom dit bestaat ──────────────────────────────────────────────────────
 *
 * Op 2026-08-07 draaiden deze suites tegen de demo-database. Ze maakten hun
 * testtenants aan en ruimden op; de demo-tenant verdween en er bleven 400
 * testleveranciers achter. Er sloeg niets aan, want de enige bescherming die
 * dit project had (scripts/db-doelwit.js) kent één criterium — is de host
 * lokaal — en zit bovendien alleen in vier scripts, niet in de tests.
 *
 * Binnen 'localhost' was een demo-database niet te onderscheiden van een
 * wegwerpcontainer. Nu wel: de database zegt het zelf.
 *
 * ── Waarom in setupFilesAfterEnv en niet in setupFiles ──────────────────────
 *
 * `setupFiles` draait vóór het testframework: `beforeAll` bestaat daar nog
 * niet. Dat leverde bij de eerste poging een `ReferenceError` op — de suite
 * werd wel geblokkeerd, maar met een melding die niets uitlegde.
 *
 * ── Waarom dit hard faalt en niet waarschuwt ────────────────────────────────
 *
 * Een waarschuwing in een run van 27 suites leest niemand, en de schade is niet
 * terug te draaien: als `verwijderTestdata` eenmaal heeft gelopen, is de data
 * weg. De enige bruikbare bescherming komt vóór de schade.
 *
 * ── Waarom een ontbrekende tabel óók faalt ──────────────────────────────────
 *
 * Een database zonder `clm.omgeving` heeft migratie 0019 niet gehad. Dat kan
 * een oude wegwerpcontainer zijn — maar net zo goed een kopie van productie van
 * vóór die migratie. Doorgaan zou betekenen dat de bescherming zwijgt op
 * precies het moment dat je hem nodig hebt.
 *
 * ── Waarom BEIDE verbindingen worden gecontroleerd ──────────────────────────
 *
 * Toegevoegd op 2026-08-09. Tot dan keek deze poort alleen naar DATABASE_URL,
 * en dat was een gat zo groot als het probleem dat hij moest oplossen:
 * MIGRATION_DATABASE_URL staat in `.env` en wijst naar Supabase.
 *
 * Op 2026-08-08 liep een e2e-suite daar doorheen. `platformbeheer.e2e-spec.ts`
 * had de migratierol nodig om clm.platform_admin te vullen, las
 * MIGRATION_DATABASE_URL, en dotenv vulde die aan met de productie-URL. De
 * eerste query faalde toevallig op een ontbrekende tabel; anders had die test
 * rijen in de productiedatabase aangemaakt.
 *
 * Elke verbinding die een suite opent hoort door dezelfde poort. Wordt er ooit
 * een derde toegevoegd, dan hoort die hier in deze lijst — niet ernaast.
 */

const UITWEG = 'MCM2_E2E_ONBESCHERMD';

async function leesOmgevingssoort(url: string): Promise<{
  soort: string | null;
  reden: string | null;
}> {
  const client = new Client({ connectionString: url });

  try {
    await client.connect();

    const { rows } = await client.query<{ soort: string }>(
      'SELECT soort FROM clm.omgeving LIMIT 1',
    );

    if (rows.length === 0) {
      return { soort: null, reden: 'clm.omgeving is leeg' };
    }

    return { soort: rows[0].soort, reden: null };
  } catch (err) {
    const melding = err instanceof Error ? err.message : String(err);

    // Onderscheid tussen "tabel bestaat niet" en "kan niet verbinden": bij het
    // eerste is de database te oud, bij het tweede staat hij niet aan. Die twee
    // vragen om een ander antwoord van degene die dit leest.
    if (/relation .*omgeving.* does not exist/i.test(melding)) {
      return {
        soort: null,
        reden: 'clm.omgeving bestaat niet — migratie 0019 is niet toegepast',
      };
    }

    return { soort: null, reden: `verbinden mislukte: ${melding}` };
  } finally {
    await client.end().catch(() => {
      // Sluiten mag mislukken; het oordeel hierboven staat al vast.
    });
  }
}

/** Verbergt het wachtwoord, zodat de melding in een CI-log mag staan. */
function zonderWachtwoord(url: string): string {
  try {
    const ontleed = new URL(url);
    return `${ontleed.hostname}:${ontleed.port || '5432'}${ontleed.pathname}`;
  } catch {
    return '(onleesbare URL)';
  }
}

/**
 * Elke verbinding die een e2e-suite mag openen.
 *
 * Beide moeten door de poort. MIGRATION_DATABASE_URL staat in `.env` en wijst
 * naar Supabase; een suite die hem leest zonder dat hij is overschreven, praat
 * tegen productie. Zie de toelichting bovenaan.
 */
const TE_CONTROLEREN = ['DATABASE_URL', 'MIGRATION_DATABASE_URL'] as const;

function foutmelding(variabele: string, url: string, wat: string): string {
  return (
    '\n\n' +
    '  E2E GESTOPT — deze database is geen wegwerpdatabase.\n\n' +
    `  Variabele: ${variabele}\n` +
    `  Doelwit:   ${zonderWachtwoord(url)}\n` +
    `  Status:    ${wat}\n\n` +
    '  Deze suites maken tenants aan en voeren DELETE uit. Op een database\n' +
    '  die niet als wegwerp is gemarkeerd, is dat gegevensverlies.\n\n' +
    '  Dit gebeurde op 2026-08-07 met de demo-database: de demo-tenant\n' +
    '  verdween en er bleven 400 testleveranciers achter. En op 2026-08-08\n' +
    '  praatte een suite via MIGRATION_DATABASE_URL tegen productie — dotenv\n' +
    '  vult die aan wanneer je hem niet zelf meegeeft.\n\n' +
    '  Een verse wegwerpdatabase opzetten:\n' +
    '    zie docs/runbooks/commandos-en-omgeving.md\n\n' +
    '  Is dit wel een wegwerpdatabase, markeer hem dan:\n' +
    '    node scripts/markeer-wegwerp.js\n\n' +
    `  Alleen als je zeker weet wat je doet: ${UITWEG}=ja\n`
  );
}

beforeAll(async () => {
  if (process.env[UITWEG] === 'ja') {
    console.warn(`\n${UITWEG}=ja — de omgevingscontrole is overgeslagen.\n`);
    return;
  }

  for (const variabele of TE_CONTROLEREN) {
    const url = process.env[variabele];

    if (!url) {
      // Niet gezet: de suites die deze verbinding nodig hebben falen vanzelf
      // met een duidelijke fout. Hier stoppen zou de read-only controles
      // onterecht blokkeren.
      continue;
    }

    const { soort, reden } = await leesOmgevingssoort(url);

    if (soort === 'wegwerp') continue;

    throw new Error(
      foutmelding(
        variabele,
        url,
        soort ? `gemarkeerd als '${soort}'` : (reden ?? 'onbekend'),
      ),
    );
  }
}, 30000);
