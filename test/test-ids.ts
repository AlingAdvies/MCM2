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
  // Fase C3 — beoordelaar koppelen. Staarten e4 t/m ec; e5 is al vergeven via
  // id(), vandaar de sprong. Gecontroleerd tegen alleTestIds().
  'beoordelaar-koppelen': {
    tenantA: '00000000-0000-0000-0000-0000000000e4',
    tenantB: '00000000-0000-0000-0000-0000000000e6',
    adminA: '00000000-0000-0000-0000-0000000000e7',
    /** Gekoppeld aan de vragenlijst — ziet hem in zijn werkvoorraad. */
    reviewerGekoppeld: '00000000-0000-0000-0000-0000000000e8',
    /** Niet gekoppeld — mag wél beoordelen, ziet hem níét in zijn voorraad. */
    reviewerLos: '00000000-0000-0000-0000-0000000000e9',
    adminB: '00000000-0000-0000-0000-0000000000ea',
    templateA: '00000000-0000-0000-0000-0000000000eb',
    templateB: '00000000-0000-0000-0000-0000000000ec',
    runA: '00000000-0000-0000-0000-0000000000ed',
    vendorA: '00000000-0000-0000-0000-0000000000ee',
    responseIngediend: '00000000-0000-0000-0000-0000000000ef',
    /**
     * Bestaat met opzet NIET in de database — voor de 404-tests.
     *
     * Staat hier omdat de bewakingstest elke letterlijke test-UUID in een
     * e2e-suite in dit register wil zien. Andere suites gebruiken dezelfde
     * waarde binnen een template-string in een URL, en die vorm herkent het
     * patroon niet; als losse waarde wordt hij wél gevangen.
     */
    bestaatNiet: '00000000-0000-0000-0000-00000000dead',
  },
  // Goedkeuren (migratie 0017). Staarten f9 t/m ff, plus 90 en 91.
  //
  // Let op bij het kiezen van vrije staarten: ze worden in dit bestand op TWEE
  // manieren uitgedeeld — letterlijk zoals hieronder, én via de id()-helper
  // bovenaan. Zoek je alleen op de letterlijke vorm, dan lijken f0-f8 vrij
  // terwijl ze via id() al vergeven zijn. Beide vormen tellen:
  //
  //   Select-String test\test-ids.ts -Pattern "id\('([0-9a-f]{2})'\)"
  //   Select-String test\test-ids.ts -Pattern "'0{20}([0-9a-f]{2})'"
  //
  // De f-reeks was bijna op (f8 was de hoogste), vandaar de sprong naar 90.
  goedkeuren: {
    tenantA: '00000000-0000-0000-0000-0000000000f9',
    tenantB: '00000000-0000-0000-0000-0000000000fa',
    adminA: '00000000-0000-0000-0000-0000000000fb',
    /**
     * Tweede medewerker in A. Bestaat alleen om te bewijzen dat een
     * reviewerUserId uit de body genegeerd wordt: zonder een tweede echte
     * gebruiker zou die test ook slagen op een niet-bestaand id, en dan
     * bewijst hij niets.
     */
    collegaA: '00000000-0000-0000-0000-0000000000fc',
    templateA: '00000000-0000-0000-0000-0000000000fd',
    runA: '00000000-0000-0000-0000-0000000000fe',
    vendorA: '00000000-0000-0000-0000-0000000000ff',
    /** Ingediend — hierop mag goedgekeurd worden. */
    responseIngediend: '00000000-0000-0000-0000-000000000090',
    adminB: '00000000-0000-0000-0000-000000000091',
    /**
     * Bestaat met opzet NIET — voor de 404 bij intrekken. Eigen waarde en niet
     * de `dead` uit beoordelaar-koppelen: twee suites die dezelfde id delen is
     * precies de faalvorm die de bewakingstest hierboven afvangt.
     */
    reviewBestaatNiet: '00000000-0000-0000-0000-000000000bad',
  },
  // Notities (migratie 0018). Staarten 92 t/m 99; de f-reeks was op.
  // Gecontroleerd tegen BEIDE uitdeelvormen — zie de opmerking bij
  // `goedkeuren` hierboven.
  notities: {
    tenantA: '00000000-0000-0000-0000-000000000092',
    tenantB: '00000000-0000-0000-0000-000000000093',
    adminA: '00000000-0000-0000-0000-000000000094',
    templateA: '00000000-0000-0000-0000-000000000095',
    runA: '00000000-0000-0000-0000-000000000096',
    vendorA: '00000000-0000-0000-0000-000000000097',
    /** Ingediend. */
    responseIngediend: '00000000-0000-0000-0000-000000000098',
    /**
     * Nog niet ingediend. Hierop mag WEL een notitie — anders dan bij
     * beoordelen (besluit eigenaar 2026-08-07): "gebeld, komt volgende week"
     * gaat juist over een leverancier die nog niet heeft ingediend.
     */
    responseOpen: '00000000-0000-0000-0000-000000000099',
    /**
     * Tweede leverancier: survey_response_run_vendor_key staat één respons per
     * vendor per ronde toe, dus de open en de ingediende respons kunnen niet
     * dezelfde vendor hebben.
     */
    vendorOpen: '00000000-0000-0000-0000-00000000009f',
    adminB: '00000000-0000-0000-0000-0000000000a0',
    /** Bestaat met opzet NIET — voor de 404 bij intrekken. */
    notitieBestaatNiet: '00000000-0000-0000-0000-000000000fee',
  },
  // Werkvoorraad contractmanager. Staarten 10 t/m 1b, aaneengesloten.
  //
  // Bewust laag in het bereik: de a0–bf-zone is grotendeels vergeven, en een
  // eerste poging daar leverde drie botsingen op (ac, b1, b2) die de
  // bewakingstest hieronder ving. Onder 0x20 is nog alles vrij.
  //
  // Zie docs/runbooks/commandos-en-omgeving.md, §"Een nieuwe e2e-suite
  // schrijven" — en let op dat staarten op TWEE manieren worden uitgedeeld:
  // letterlijk zoals hier, én via de id()-helper bovenaan.
  'werkvoorraad-contractmanager': {
    tenantA: '00000000-0000-0000-0000-000000000010',
    tenantB: '00000000-0000-0000-0000-000000000011',
    /** Contractmanager van vendorVanMij. */
    managerA: '00000000-0000-0000-0000-000000000012',
    /** Collega-contractmanager: beheert een andere vendor. */
    collegaA: '00000000-0000-0000-0000-000000000013',
    templateA: '00000000-0000-0000-0000-000000000014',
    runA: '00000000-0000-0000-0000-000000000015',
    /** Vendor van managerA — ingediend. */
    vendorVanMij: '00000000-0000-0000-0000-000000000016',
    /** Vendor van collegaA — hoort niet in 'van mij'. */
    vendorVanCollega: '00000000-0000-0000-0000-000000000017',
    /**
     * Vendor zónder contractmanager. owner_user_id is nullable met ON DELETE
     * set null, dus die situatie ontstaat vanzelf na het vertrek van een
     * collega — en dan moet hij juist zichtbaar blijven in het organisatiebrede
     * overzicht.
     */
    vendorZonderEigenaar: '00000000-0000-0000-0000-000000000018',
    responseVanMij: '00000000-0000-0000-0000-000000000019',
    responseVanCollega: '00000000-0000-0000-0000-00000000001a',
    responseZonderEigenaar: '00000000-0000-0000-0000-00000000001b',
    adminB: '00000000-0000-0000-0000-00000000001c',
  },
} as const;

/** Alle uitgedeelde id's, plat. Gebruikt door de bewakingstest. */
export function alleTestIds(): string[] {
  return Object.values(TEST_IDS).flatMap((blok) => Object.values(blok));
}
