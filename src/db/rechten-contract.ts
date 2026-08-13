/**
 * Wat de applicatierol op elk databaseobject mag — expliciet vastgelegd.
 *
 * ── Waarom dit bestand bestaat ───────────────────────────────────────────────
 *
 * Op 2026-08-08 strandde de eerste echte tenant op een 500: `clm_api_runtime`
 * bleek geen enkel recht te hebben op `clm.tenant_membership`. Migratie 0009
 * geeft die tabel geen `GRANT`; lokaal werkte het toch, omdat
 * `ALTER DEFAULT PRIVILEGES` uit 0001 elke nieuwe tabel van rechten voorziet.
 * Op Supabase is die default niet geregistreerd, dus daar viel de tabel buiten
 * de boot — en dat viel pas op toen de eerste route hem raakte.
 *
 * De les is niet "vergeten GRANT" maar dieper: de rechtenstand was een optelsom
 * van een omgevingsafhankelijke default en losse GRANT's in migraties. Niet te
 * overzien, en dus niet te verifiëren.
 *
 * Dit bestand is de andere helft van `schema-inventory.ts`. Dat leidt af wat er
 * hoort te bestaan; dit legt vast wat er mag. Het verschil is opzet: tabellen
 * volgen uit de code, rechten zijn een besluit — en een besluit hoort
 * opgeschreven te staan, niet afgeleid.
 *
 * ── Wat de eerste run van de bijbehorende test aantoonde ─────────────────────
 *
 * Het gat in `tenant_membership` was niet het enige gevolg van die default. Hij
 * werkt namelijk twee kanten op, en de tweede is de gevaarlijkste:
 *
 *   tenant_membership   migratie zonder GRANT
 *                       → productie: geen rechten (de 500 van 2026-08-08)
 *                       → lokaal:    alles, want de default vult aan
 *
 *   omgeving,           migratie mét een beperkende GRANT
 *   survey_review,      → productie: precies wat de migratie zegt
 *   response_note,      → lokaal:    álles, want een GRANT beperkt niets —
 *   template_reviewer               hij voegt alleen toe aan wat de default
 *                                   al gaf
 *
 * Gevolg: elke lokale testrun en elke CI-run draait met **ruimere** rechten dan
 * productie. Een route die per ongeluk `DELETE FROM clm.omgeving` doet, faalt
 * in productie en slaagt in de tests. Dat is precies de verkeerde kant op: de
 * tests keuren goed wat productie weigert.
 *
 * Dit contract legt vast wat het *hoort* te zijn — de striktste van de twee
 * standen — en de migratie die erbij hoort trekt beide omgevingen daarheen.
 *
 * ── Hoe je dit onderhoudt ────────────────────────────────────────────────────
 *
 * Een nieuwe tabel of functie zonder regel hier maakt `rechten-contract.e2e`
 * rood. Dat is de bedoeling: het dwingt een besluit af op het moment dat de
 * tabel ontstaat, in plaats van bij de eerste route die erover struikelt.
 *
 * Wijzig je een regel hier, dan hoort daar een migratie bij die de database
 * meeneemt. Dit bestand beschrijft, het verandert niets.
 */

/** De rechten die één rol op één tabel heeft. `[]` betekent: geen enkel recht. */
export type Tabelrechten = readonly (
  'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'
)[];

const LEZEN_EN_SCHRIJVEN: Tabelrechten = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
];

/** Toevoegen en bijwerken mag, verwijderen niet. */
const NIET_VERWIJDEREN: Tabelrechten = ['SELECT', 'INSERT', 'UPDATE'];

const ALLEEN_LEZEN: Tabelrechten = ['SELECT'];

const GEEN: Tabelrechten = [];

/**
 * Wat `clm_api_runtime` (via `clm_api`) op elke tabel mag.
 *
 * De sleutel is de volledige naam zoals `schema-inventory.ts` die opbouwt.
 */
export const TABELRECHTEN: Readonly<Record<string, Tabelrechten>> = {
  // ── Gewone tenantdata ──────────────────────────────────────────────────────
  'clm.tenant': LEZEN_EN_SCHRIJVEN,
  'clm.user': LEZEN_EN_SCHRIJVEN,
  'clm.vendor': LEZEN_EN_SCHRIJVEN,
  'clm.vendor_contact': LEZEN_EN_SCHRIJVEN,
  'clm.vendor_tag': LEZEN_EN_SCHRIJVEN,
  'clm.survey_template': LEZEN_EN_SCHRIJVEN,
  'clm.survey_question': LEZEN_EN_SCHRIJVEN,
  'clm.survey_category': LEZEN_EN_SCHRIJVEN,
  'clm.survey_run': LEZEN_EN_SCHRIJVEN,
  'clm.survey_response': LEZEN_EN_SCHRIJVEN,
  'clm.survey_answer': LEZEN_EN_SCHRIJVEN,
  'clm.survey_attachment': LEZEN_EN_SCHRIJVEN,

  // Wie waar mag werken. Hoort bij de gewone tenantdata: de platformroute
  // maakt hier rijen aan, en support-toegang wordt hier toegekend.
  'clm.tenant_membership': LEZEN_EN_SCHRIJVEN,

  // ── Van nature append-only ─────────────────────────────────────────────────
  //
  // Een oordeel, een notitie of een koppeling verdwijnt niet: hij wordt zacht
  // verwijderd. Geen DELETE dus — niet omdat het gevaarlijk is, maar omdat een
  // route die het nodig heeft een ontwerpfout zou zijn.
  'clm.survey_review': NIET_VERWIJDEREN,
  'clm.response_note': NIET_VERWIJDEREN,
  'clm.template_reviewer': ['SELECT', 'INSERT', 'DELETE'],

  // ── Alleen lezen ───────────────────────────────────────────────────────────
  //
  // clm.omgeving (0019): zegt of dit een wegwerpdatabase is. De applicatie
  // hoeft dat te weten, niet te veranderen — anders is de bescherming die
  // hierop rust zelf te omzeilen.
  'clm.omgeving': ALLEEN_LEZEN,

  // clm.platform_admin (0020): wie het platform beheert. De guard leest dit per
  // verzoek. Schrijven gaat bewust buiten de applicatie om, via de migratierol
  // (scripts/platformbeheerder-inrichten.js) — zolang er geen scherm voor is,
  // is dat de veiligste stand.
  'clm.platform_admin': ALLEEN_LEZEN,

  // ── Volledig gesloten ──────────────────────────────────────────────────────
  //
  // clm.sessie (0010): expliciete REVOKE ALL. De sessie wordt opgezocht vóórdat
  // de tenantcontext bestaat, dus RLS kan hem niet beschermen. Alle toegang
  // loopt via SECURITY DEFINER-functies met een scherp begrensde opdracht.
  // Bewezen in test/sessie.e2e-spec.ts: een directe SELECT en INSERT geven
  // beide "permission denied".
  'clm.sessie': GEEN,

  // clm.tenant_register (0026, ADR-017): welke tenants er bestaan. Staat buiten
  // RLS omdat het bij geen enkele tenant hoort, en is daarom via GRANT dicht.
  //
  // GEEN en niet ALLEEN_LEZEN, hoewel de platformroute er straks bij moet: er
  // is vandaag nog geen `GET /platform/tenants` die opsomt. Rechten uitdelen
  // voor een route die niet bestaat is precies verkeerd om — de migratie die
  // dat endpoint begeleidt zet het GRANT erbij, samen met de verificatie dat
  // PlatformAdminGuard ervoor staat.
  'clm.tenant_register': GEEN,

  // ── Audit ──────────────────────────────────────────────────────────────────
  //
  // Append-only in de striktste zin (§7.7): schrijven mag, wijzigen en
  // verwijderen nooit. Een audit trail die de applicatie kan aanpassen is geen
  // audit trail.
  'audit.audit_event': ['SELECT', 'INSERT'],

  // ── Referentiedata ─────────────────────────────────────────────────────────
  //
  // Lookup-tabellen zonder tenant_id: categorieën, statussen, criticality.
  // Gevuld door migraties (0012 breidde ze uit), niet door de applicatie.
  //
  // Hier staat volledige schrijftoegang, en dat is de stand die er is — niet de
  // stand die je zou kiezen. De applicatie heeft geen route die deze tabellen
  // wijzigt; ALLEEN_LEZEN zou hier verdedigbaar zijn.
  //
  // Bewust niet in deze wijziging aangescherpt: dit contract legt eerst vast
  // wat er is, zodat het gat in tenant_membership zichtbaar wordt. Aanscherpen
  // is een eigen migratie met een eigen afweging — zie het openstaande punt in
  // docs/ontwerp/tenants-gebruikers-en-platformbeheer.md §6.
  'ref.business_criticality': LEZEN_EN_SCHRIJVEN,
  'ref.compliance_status': LEZEN_EN_SCHRIJVEN,
  'ref.vendor_category': LEZEN_EN_SCHRIJVEN,
};

/**
 * De SECURITY DEFINER-functies, en wat er over hun beveiliging vastligt.
 *
 * ── Waarom search_path hier staat ────────────────────────────────────────────
 *
 * Een SECURITY DEFINER-functie zonder vaste `search_path` is een bekend
 * escalatiepad: wie CREATE-recht heeft op een doorzocht schema kan een object
 * schaduwen en zo code laten draaien met de rechten van de functie-eigenaar —
 * dwars door RLS heen.
 *
 * Alle vijf functies hebben dat vandaag goed. Maar dat is een eigenschap van
 * vijf migraties die iemand bij een zesde kan vergeten, en een reviewer merkte
 * het op 2026-08-08 terecht aan als onbewaakt. Vandaar deze lijst: de zesde
 * functie zonder regel hier maakt de test rood.
 */
export interface FunctieContract {
  /** Verwachte waarde van `proconfig`, exact zoals PostgreSQL hem teruggeeft. */
  readonly searchPath: string;
  /** Rollen die EXECUTE horen te hebben. PUBLIC hoort er nooit bij. */
  readonly execute: readonly string[];
}

const DEFINER_STANDAARD: FunctieContract = {
  searchPath: 'search_path=clm, pg_temp',
  execute: ['clm_migrator', 'clm_api', 'clm_admin'],
};

export const DEFINER_FUNCTIES: Readonly<Record<string, FunctieContract>> = {
  // Identiteit vóór tenantcontext (0009).
  gebruiker_bij_subject: DEFINER_STANDAARD,

  // Sessies (0010). De tabel is dicht; deze drie zijn de enige weg naar binnen.
  sessie_aanmaken: DEFINER_STANDAARD,
  sessie_oplossen: DEFINER_STANDAARD,
  sessie_beeindigen: DEFINER_STANDAARD,

  // De leverancierstoken-lookup, spoor 2 (0003, herzien in 0006 en 0008).
  resolve_survey_token: DEFINER_STANDAARD,

  // De eerste login van een uitgenodigde beheerder (0023, herzien in 0024).
  // Koppelt een oid aan een wachtende gebruikersrij op vertoon van het
  // uitnodigingstoken.
  koppel_eerste_login: DEFINER_STANDAARD,

  // Houdt clm.tenant_register gelijk aan clm.tenant (0026, ADR-017).
  //
  // De smalste execute-lijst van alle definer-functies, en dat is opzet: dit is
  // een trigger. De database roept hem aan, geen applicatierol — clm_api en
  // clm_admin hebben hem dus niet nodig, anders dan bij DEFINER_STANDAARD.
  //
  // Alleen clm_migrator staat er, en dat is niet te vermijden: die maakt de
  // functie aan en is daarmee eigenaar. Een eigenaar houdt EXECUTE, ook na
  // `REVOKE ALL … FROM PUBLIC` — die REVOKE haalt wél het impliciete recht van
  // PUBLIC weg, wat bij een SECURITY DEFINER-functie het punt is.
  //
  // Gemeten, niet aangenomen: de eerste versie van dit contract zei `[]` en de
  // bewakingstest meldde "verwacht [], gevonden [clm_migrator]".
  //
  // SECURITY DEFINER is hier nodig omdat de schrijvende rol geen rechten op het
  // register heeft. De functie is drie regels, raakt alleen het register,
  // gebruikt geen dynamische SQL en leest niets buiten NEW.
  tenant_register_bijhouden: {
    searchPath: 'search_path=clm, pg_temp',
    execute: ['clm_migrator'],
  },
};
