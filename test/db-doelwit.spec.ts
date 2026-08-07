// Tests voor scripts/db-doelwit.js — de poort uit Issue #86.
//
// Wat hier bewezen moet worden is niet "de functie doet iets", maar precies de
// twee dingen die op 2026-08-06 misgingen:
//   1. een niet-lokaal doelwit wordt herkend als niet-lokaal;
//   2. het wachtwoord staat in geen enkele melding.
//
// Het tweede is de reden dat er assertions op de úítvoer staan en niet alleen
// op de retourwaarde: een script dat zijn doelwit afdrukt, drukt af in CI-logs
// en schermafdrukken (MCM2-CLAUDE.md §6).

/* eslint-disable @typescript-eslint/no-require-imports,
                  @typescript-eslint/no-unsafe-assignment,
                  @typescript-eslint/no-unsafe-call,
                  @typescript-eslint/no-unsafe-member-access */
const {
  ontleed,
  meldDoelwit,
  eisToestemmingBuitenLokaal,
} = require('../scripts/db-doelwit.js');

// Een verzonnen wachtwoord dat nergens echt bestaat; het staat hier om te
// kunnen bewijzen dat het níét in de uitvoer terechtkomt.
const GEHEIM = 'zeer-geheim-wachtwoord-123';
const LOKAAL = `postgresql://clm_migrator:${GEHEIM}@localhost:5432/postgres`;
const EXTERN = `postgresql://clm_migrator:${GEHEIM}@db.abcdefgh.supabase.co:5432/postgres?schema=public`;

describe('ontleed', () => {
  it('leest host, poort, databasenaam en rol uit een URL', () => {
    const d = ontleed(EXTERN);
    expect(d.leesbaar).toBe(true);
    expect(d.host).toBe('db.abcdefgh.supabase.co');
    expect(d.poort).toBe('5432');
    expect(d.database).toBe('postgres');
    expect(d.rol).toBe('clm_migrator');
  });

  it('noemt het wachtwoord niet in de beschrijving', () => {
    expect(ontleed(EXTERN).beschrijving).not.toContain(GEHEIM);
  });

  it('vult de standaardpoort in als de URL er geen noemt', () => {
    expect(ontleed('postgresql://rol@host/db').poort).toBe('5432');
  });

  it.each([
    ['localhost', true],
    ['127.0.0.1', true],
    ['host.docker.internal', true],
    ['db.abcdefgh.supabase.co', false],
    // Bewust: een host die met localhost begint is niet localhost. Zou de
    // controle op "begint met" leunen, dan glipt dit erdoor.
    ['localhost.evil.example', false],
  ])('herkent %s als lokaal=%s', (host, verwacht) => {
    expect(ontleed(`postgresql://rol:pw@${host}:5432/postgres`).lokaal).toBe(
      verwacht,
    );
  });

  it('valt niet om over een onleesbare URL', () => {
    const d = ontleed('dit is geen url');
    expect(d.leesbaar).toBe(false);
    expect(d.lokaal).toBe(false);
  });

  it('behandelt een ontbrekende URL als onleesbaar en niet-lokaal', () => {
    expect(ontleed(undefined).leesbaar).toBe(false);
    expect(ontleed(undefined).lokaal).toBe(false);
  });
});

describe('meldDoelwit', () => {
  let uitvoer: string[];
  let log: jest.SpyInstance;

  beforeEach(() => {
    uitvoer = [];
    log = jest
      .spyOn(console, 'log')
      .mockImplementation((m: string) => void uitvoer.push(String(m)));
  });
  afterEach(() => log.mockRestore());

  it('noemt host, database en rol', () => {
    meldDoelwit(EXTERN, 'Migraties');
    expect(uitvoer.join('\n')).toContain(
      'db.abcdefgh.supabase.co:5432/postgres',
    );
    expect(uitvoer.join('\n')).toContain('clm_migrator');
  });

  it('markeert een niet-lokaal doelwit zichtbaar', () => {
    meldDoelwit(EXTERN, 'Migraties');
    expect(uitvoer.join('\n')).toContain('NIET-LOKAAL');
  });

  it('markeert een lokaal doelwit als lokaal', () => {
    meldDoelwit(LOKAAL, 'Migraties');
    expect(uitvoer.join('\n')).toContain('lokaal');
    expect(uitvoer.join('\n')).not.toContain('NIET-LOKAAL');
  });

  it('lekt het wachtwoord niet', () => {
    meldDoelwit(EXTERN, 'Migraties');
    expect(uitvoer.join('\n')).not.toContain(GEHEIM);
  });
});

describe('eisToestemmingBuitenLokaal', () => {
  let fouten: string[];
  let err: jest.SpyInstance;
  let log: jest.SpyInstance;
  const argv = process.argv;
  const env = process.env.MCM2_EXTERNE_DB;

  beforeEach(() => {
    fouten = [];
    err = jest
      .spyOn(console, 'error')
      .mockImplementation((m: string) => void fouten.push(String(m)));
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    process.exitCode = undefined;
    delete process.env.MCM2_EXTERNE_DB;
  });

  afterEach(() => {
    err.mockRestore();
    log.mockRestore();
    process.argv = argv;
    if (env === undefined) delete process.env.MCM2_EXTERNE_DB;
    else process.env.MCM2_EXTERNE_DB = env;
    process.exitCode = undefined;
  });

  it('laat een lokaal doelwit door zonder vlag', () => {
    process.argv = ['node', 'script.js'];
    expect(eisToestemmingBuitenLokaal(LOKAAL, { wat: 'Migraties' })).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  // Dit is de kern van Issue #86.
  it('stopt bij een niet-lokaal doelwit zonder vlag', () => {
    process.argv = ['node', 'script.js'];
    expect(eisToestemmingBuitenLokaal(EXTERN, { wat: 'Migraties' })).toBe(
      false,
    );
    expect(process.exitCode).toBe(1);
  });

  it('noemt bij weigering het doelwit, zodat je ziet wat er mis was', () => {
    process.argv = ['node', 'script.js'];
    eisToestemmingBuitenLokaal(EXTERN, { wat: 'Migraties' });
    expect(fouten.join('\n')).toContain('db.abcdefgh.supabase.co');
  });

  it('lekt bij weigering het wachtwoord niet', () => {
    process.argv = ['node', 'script.js'];
    eisToestemmingBuitenLokaal(EXTERN, { wat: 'Migraties' });
    expect(fouten.join('\n')).not.toContain(GEHEIM);
  });

  it('laat een niet-lokaal doelwit door mét de vlag', () => {
    process.argv = ['node', 'script.js', '--extern'];
    expect(eisToestemmingBuitenLokaal(EXTERN, { wat: 'Migraties' })).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('laat een niet-lokaal doelwit door via de omgevingsvariabele', () => {
    process.argv = ['node', 'script.js'];
    process.env.MCM2_EXTERNE_DB = 'ja';
    expect(eisToestemmingBuitenLokaal(EXTERN, { wat: 'Migraties' })).toBe(true);
  });

  it('accepteert alleen exact "ja" als omgevingswaarde', () => {
    process.argv = ['node', 'script.js'];
    process.env.MCM2_EXTERNE_DB = 'true';
    expect(eisToestemmingBuitenLokaal(EXTERN, { wat: 'Migraties' })).toBe(
      false,
    );
  });

  it('stopt bij een onleesbare URL in plaats van hem als lokaal te zien', () => {
    process.argv = ['node', 'script.js'];
    expect(eisToestemmingBuitenLokaal('kapot', { wat: 'Migraties' })).toBe(
      false,
    );
    expect(process.exitCode).toBe(1);
  });

  it('gebruikt de opgegeven vlagnaam in de melding', () => {
    process.argv = ['node', 'script.js'];
    eisToestemmingBuitenLokaal(EXTERN, { wat: 'Seed', vlag: '--productie' });
    expect(fouten.join('\n')).toContain('--productie');
  });
});
