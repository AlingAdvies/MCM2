/**
 * Vaste test-UUID's, per suite uitgedeeld.
 *
 * ── Waarom dit bestand bestaat ───────────────────────────────────────────────
 *
 * Jest draait e2e-suites parallel (hier tot elf tegelijk) tegen één database.
 * Elke suite maakt zijn eigen tenants aan en ruimt ze achteraf op. Zolang twee
 * suites verschillende id's gebruiken gaat dat goed; delen ze er één, dan
 * ruimt de een de tenant van de ander op terwijl die er nog mee bezig is.
 *
 * Dat gebeurde ook. Op 2026-07-31 viel de suite onregelmatig om — één run 21
 * falende tests, dan drie runs groen, dan weer 20. De foutmeldingen wezen naar
 * `duplicate key on tenant_pkey` en naar een foreign key op `vendor`: allebei
 * gevolgen, geen oorzaken. De echte oorzaak was dat drie suites dezelfde id's
 * gebruikten:
 *
 *   ...e1        membership-isolatie  én  survey-routes
 *   ...f1, ...f2 membership-isolatie  én  survey-token-isolatie
 *
 * Een onregelmatig falende suite is de vervelendste faalvorm die er is: hij
 * ondermijnt het vertrouwen in álle tests, ook de tests die wél iets bewijzen.
 * "Even opnieuw draaien" wordt dan een gewoonte, en daarmee is elke echte
 * regressie onzichtbaar geworden.
 *
 * ── De afspraak ──────────────────────────────────────────────────────────────
 *
 * Elke suite krijgt hieronder een eigen blok. Binnen een blok mag alles, maar
 * blokken overlappen nooit. Een nieuwe suite voegt een nieuw blok toe in plaats
 * van een bestaand id te hergebruiken.
 *
 * De laatste twee tekens van de UUID zijn het blokkenmerk, zodat je in een
 * foutmelding meteen ziet van wie een rij is. `test/test-ids.spec.ts` bewaakt
 * dat er geen dubbelen ontstaan — die controle is het halve punt van dit
 * bestand, want een afspraak die niemand controleert is geen afspraak.
 */

/** Bouwt een test-UUID uit twee hex-tekens. */
function id(merk: string): string {
  return `00000000-0000-0000-0000-0000000000${merk}`;
}

/**
 * Per suite gegroepeerd. De sleutel is de bestandsnaam zonder extensie, zodat
 * de herkomst van een id te vinden is zonder te zoeken.
 */
export const TEST_IDS = {
  'actor-context': {
    tenant: id('ac'),
  },
  'antwoord-indienen': {
    tenant: id('b1'),
  },
  'bijlage-upload': {
    tenant: id('a5'),
  },
  'demo-seed': {
    // De demo-tenant zelf staat niet hier maar in scripts/seed-demo-tenant.js:
    // dat is productiecode met een eigen vast UUID (dededede-…), geen testid.
    // Dit blok bevat alleen de vreemde tenant waarmee de suite cross-tenant
    // zichtbaarheid uitlokt.
    vreemdeTenant: id('da'),
  },
  'drizzle-tenant-context': {
    tenantA: id('ca'),
    tenantB: id('cb'),
  },
  'membership-isolatie': {
    tenantA: id('e1'),
    tenantB: id('e2'),
    userA: id('f1'),
    userB: id('f2'),
  },
  sessie: {
    tenant: id('e5'),
    user: id('f5'),
    userZonderLid: id('f6'),
  },
  'survey-routes': {
    // Was ...e1 en botste daarmee met membership-isolatie.
    tenant: id('a1'),
  },
  'survey-token-isolatie': {
    // Was ...f1/...f2 en botste daarmee met membership-isolatie.
    tenantA: id('a2'),
    tenantB: id('a3'),
  },
  'sessie-route': {
    tenant: id('8a'),
    user: id('8b'),
  },
  'vendor-detail': {
    tenant: id('8c'),
    adminUser: id('8d'),
    reviewerUser: id('8e'),
    andereTenant: id('8f'),
    andereUser: id('80'),
  },
  'tenant-context-guard': {
    tenantA: id('9a'),
    tenantB: id('9b'),
    userA: id('9c'),
    userB: id('9d'),
    userZonderLid: id('9e'),
  },
  'tenant-rls-isolation': {
    tenantA: id('aa'),
    tenantB: id('bb'),
  },
  'vragenlijst-import': {
    tenantA: id('d1'),
    tenantB: id('d2'),
    extraA: '00000000-0000-0000-0000-00000000beef',
    extraB: '00000000-0000-0000-0000-00000000cafe',
  },
  'vragenlijst-ophalen': {
    tenantA: id('c1'),
    tenantB: id('c2'),
  },
  'vragenlijst-seed': {
    tenant: id('d3'),
  },
  'vendor-routes': {
    tenantA: id('7a'),
    tenantB: id('7b'),
    userA: id('7c'),
    userB: id('7d'),
  },
  'vragenlijst-beheer-routes': {
    tenantA: id('b2'),
    tenantB: id('b3'),
    userA: id('b4'),
    userB: id('b5'),
    reviewerA: id('b6'),
    templateA: '00000000-0000-0000-0000-0000000000b7',
    templateB: '00000000-0000-0000-0000-0000000000b8',
    runA: '00000000-0000-0000-0000-0000000000b9',
    vendorA: '00000000-0000-0000-0000-0000000000ba',
    responseA: '00000000-0000-0000-0000-0000000000bc',
  },
  'ronde-beheer-routes': {
    tenantA: id('c3'),
    tenantB: id('c4'),
    adminA: id('c5'),
    reviewerA: id('c6'),
    adminB: id('c7'),
    templateA: '00000000-0000-0000-0000-0000000000c8',
    templateLeeg: '00000000-0000-0000-0000-0000000000c9',
    // Niet ...ca en ...cb: die zijn al vergeven via id('ca') en id('cb') in
    // het blok 'antwoord-indienen'. De bewakingstest ving dat, en dat is
    // precies waarvoor hij bestaat — twee suites op dezelfde tenant leverden
    // op 2026-07-31 een onregelmatig falende run op.
    templateB: '00000000-0000-0000-0000-0000000000cc',
    vendor1: '00000000-0000-0000-0000-0000000000cd',
    vendor2: '00000000-0000-0000-0000-0000000000ce',
    vendor3: '00000000-0000-0000-0000-0000000000cf',
    vendorB: '00000000-0000-0000-0000-0000000000d4',
    vendorWeg: '00000000-0000-0000-0000-0000000000d5',
  },
  // Fase C2 — beoordelen. Staarten d6 t/m db; da is al vergeven, vandaar de
  // sprong. Gecontroleerd tegen alleTestIds(), niet gegokt.
  beoordeling: {
    tenantA: '00000000-0000-0000-0000-0000000000d6',
    tenantB: '00000000-0000-0000-0000-0000000000d7',
    adminA: '00000000-0000-0000-0000-0000000000d8',
    reviewerA: '00000000-0000-0000-0000-0000000000d9',
    templateA: '00000000-0000-0000-0000-0000000000db',
    runA: '00000000-0000-0000-0000-0000000000dc',
    vendorA: '00000000-0000-0000-0000-0000000000dd',
    /** Ingediend — hierop mag beoordeeld worden. */
    responseIngediend: '00000000-0000-0000-0000-0000000000de',
    /** Nog niet ingediend — hierop juist niet. */
    responseOpen: '00000000-0000-0000-0000-0000000000df',
    adminB: '00000000-0000-0000-0000-0000000000e0',
    /**
     * Tweede leverancier. Nodig omdat survey_response_run_vendor_key één
     * respons per vendor per ronde toestaat — de open en de ingediende respons
     * kunnen dus niet dezelfde vendor hebben.
     */
    vendorOpen: '00000000-0000-0000-0000-0000000000e3',
  },
} as const;

/** Alle uitgedeelde id's, plat. Gebruikt door de bewakingstest. */
export function alleTestIds(): string[] {
  return Object.values(TEST_IDS).flatMap((blok) => Object.values(blok));
}
