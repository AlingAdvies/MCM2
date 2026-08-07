import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Bewaakt dat de omgevingsguard aan blijft staan.
 *
 * Een unittest, geen e2e: hij leest bestanden en heeft geen database nodig.
 * Dat is met opzet — een guard die alleen door een e2e-test bewaakt wordt, is
 * uitgeschakeld op precies het moment dat die e2e-test niet draait.
 *
 * ── Waarom dit bestaat ──────────────────────────────────────────────────────
 *
 * Op 2026-08-07 wisten de e2e-suites de demo-database leeg. De guard die dat
 * voortaan voorkomt hangt aan drie dingen: het bestand zelf, de registratie in
 * jest-e2e.json, en de markeerstap in verify-volledig.js. Valt er één weg, dan
 * is de bescherming stil verdwenen — en dat merk je pas als er weer data weg
 * is.
 */

const WORTEL = join(__dirname, '..');

function lees(pad: string): string {
  return readFileSync(join(WORTEL, pad), 'utf8');
}

describe('omgevingsmarkering: de guard staat aan', () => {
  it('registreert de guard in de e2e-configuratie', () => {
    const config = JSON.parse(lees('test/jest-e2e.json')) as {
      setupFilesAfterEnv?: string[];
    };

    // setupFilesAfterEnv en niet setupFiles: het laatste draait vóór het
    // testframework, en dan bestaat `beforeAll` nog niet.
    expect(config.setupFilesAfterEnv).toContain('<rootDir>/jest-e2e.guard.ts');
  });

  it('laat de guard hard falen in plaats van waarschuwen', () => {
    const guard = lees('test/jest-e2e.guard.ts');

    // Een waarschuwing in een run van 27 suites leest niemand, en de schade is
    // niet terug te draaien.
    expect(guard).toContain('throw new Error');
    expect(guard).toContain('E2E GESTOPT');
  });

  it('accepteert alleen de soort "wegwerp"', () => {
    const guard = lees('test/jest-e2e.guard.ts');

    // De vergelijking moet op de wáárde staan, niet op het bestaan van een
    // rij. `soort !== null` zou elke gemarkeerde database doorlaten, ook een
    // beschermde.
    expect(guard).toMatch(/soort === 'wegwerp'/);
  });

  it('markeert de wegwerpcontainer in verify:volledig', () => {
    const script = lees('scripts/verify-volledig.js');

    // Zonder deze stap weigert de guard de eigen doorloop, en dan wordt hij
    // uit frustratie uitgezet in plaats van gerepareerd.
    expect(script).toContain('markeer-wegwerp.js');
  });

  it('markeert de service-container in CI', () => {
    const workflow = lees('.github/workflows/ci.yml');

    expect(workflow).toContain('markeer-wegwerp.js');
  });

  it('zet de migratie standaard op beschermd', () => {
    const migratie = lees('drizzle/0019_omgevingsmarkering.sql');

    // De veilige kant: een database die zich niet meldt, wordt behandeld als
    // productie. Zou hier 'wegwerp' staan, dan is elke nieuwe database
    // vogelvrij.
    expect(migratie).toMatch(/INSERT INTO "clm"\."omgeving"[\s\S]*'beschermd'/);
  });

  it('eist een wegwerpdatabase voordat de demo-seed opruimt', () => {
    const seed = lees('scripts/seed-demo-tenant.js');

    // 13 DELETE-statements. De hostcontrole kent 'localhost' als veilig, en
    // juist daar draait de demo-database.
    expect(seed).toContain('eisWegwerpdatabase');
  });

  it('biedt eisWegwerpdatabase aan vanuit db-doelwit', () => {
    const doelwit = lees('scripts/db-doelwit.js');

    // Eén plek waar de controle staat: elk schrijvend script hoort dezelfde
    // te gebruiken, niet zijn eigen variant.
    expect(doelwit).toContain('async function eisWegwerpdatabase');
    expect(doelwit).toMatch(/module\.exports[\s\S]*eisWegwerpdatabase/);
  });

  it('staat de migratie in het journal', () => {
    const journal = JSON.parse(lees('drizzle/meta/_journal.json')) as {
      entries: { tag: string }[];
    };

    // Drizzle leest het journal, niet de map: een .sql zonder entry wordt
    // stilzwijgend overgeslagen terwijl migrate:deploy "voltooid" meldt.
    expect(journal.entries.map((e) => e.tag)).toContain(
      '0019_omgevingsmarkering',
    );
  });
});
