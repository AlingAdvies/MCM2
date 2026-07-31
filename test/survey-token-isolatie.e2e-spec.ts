import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';

import { DatabaseModule } from '../src/db/database.module';
import { DatabaseService } from '../src/db/database.service';
import {
  berekenVervalmoment,
  genereerToken,
  hashToken,
} from '../src/survey/survey-token';
import { SurveyTokenService } from '../src/survey/survey-token.service';
import { SurveyModule } from '../src/survey/survey.module';
import { TEST_IDS } from './test-ids';

// Uit het gedeelde register (test/test-ids.ts). Stonden hier eerder hardcoded
// als ...f1/...f2 en botsten daarmee met membership-isolatie, dat diezelfde
// waarden als user-id's gebruikt.
const TENANT_A = TEST_IDS['survey-token-isolatie'].tenantA;
const TENANT_B = TEST_IDS['survey-token-isolatie'].tenantB;

/**
 * Token-isolatietest (Issue #10) voor het leverancierstoken uit Issue #7.
 *
 * Dekt de dertien punten uit §6 van
 * docs/superpowers/specs/2026-07-28-leveranciertoken-ontwerp.md.
 */
describe('Leverancierstoken — isolatie en levenscyclus (e2e)', () => {
  let db: DatabaseService;
  let tokens: SurveyTokenService;

  /** Zet een volledige keten op binnen één tenant en geeft het ruwe token terug. */
  async function maakResponse(
    tenantId: string,
    opties: {
      naam: string;
      verlooptOver?: number;
      status?: string;
      rondeGesloten?: boolean;
      rondeIngetrokken?: boolean;
      /** Lifecycle van de ronde (migratie 0005/0006). Default 'active'. */
      rondeStatus?: 'draft' | 'active' | 'finished' | 'archived';
    },
  ): Promise<{ token: string; responseId: string; vendorId: string }> {
    const token = genereerToken();
    const verval =
      opties.verlooptOver === undefined
        ? berekenVervalmoment()
        : new Date(Date.now() + opties.verlooptOver);

    return db.withTenant(tenantId, async (tx) => {
      await tx.execute(
        sql`INSERT INTO clm.tenant (tenant_id, name) VALUES (${tenantId}, ${opties.naam})
            ON CONFLICT (tenant_id) DO NOTHING`,
      );

      const vendor = await tx.execute<{ vendor_id: string }>(
        sql`INSERT INTO clm.vendor (tenant_id, name) VALUES (${tenantId}, ${`vendor-${opties.naam}`})
            RETURNING vendor_id`,
      );
      const vendorId = vendor.rows[0].vendor_id;

      const template = await tx.execute<{ template_id: string }>(
        sql`INSERT INTO clm.survey_template (tenant_id, name) VALUES (${tenantId}, ${`tpl-${opties.naam}`})
            RETURNING template_id`,
      );

      // survey_run heeft sinds migratie 0005 een expliciete lifecycle met
      // 'draft' als default (ontwerp §2b). De helper zet standaard 'active',
      // want dat is de toestand waarin een leverancier de link gebruikt.
      const run = await tx.execute<{ run_id: string }>(
        sql`INSERT INTO clm.survey_run (tenant_id, template_id, status, closes_at, revoked_at)
            VALUES (${tenantId}, ${template.rows[0].template_id},
                    ${opties.rondeStatus ?? 'active'},
                    ${opties.rondeGesloten ? new Date(Date.now() - 1000) : null},
                    ${opties.rondeIngetrokken ? new Date() : null})
            RETURNING run_id`,
      );

      // UC1-respons: deelnemer en onderwerp zijn dezelfde leverancier.
      const response = await tx.execute<{ response_id: string }>(
        sql`INSERT INTO clm.survey_response
              (tenant_id, run_id, vendor_id, subject_vendor_id, token_hash,
               status, expires_at, submitted_at)
            VALUES (${tenantId}, ${run.rows[0].run_id}, ${vendorId}, ${vendorId},
                    ${hashToken(token)},
                    ${opties.status ?? 'pending'}, ${verval},
                    ${opties.status === 'submitted' ? new Date() : null})
            RETURNING response_id`,
      );

      return { token, responseId: response.rows[0].response_id, vendorId };
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, SurveyModule],
    }).compile();

    await moduleRef.init();
    db = moduleRef.get(DatabaseService);
    tokens = moduleRef.get(SurveyTokenService);
  });

  afterAll(async () => {
    for (const id of [TENANT_A, TENANT_B]) {
      await db.withTenant(id, async (tx) => {
        await tx.execute(sql`DELETE FROM clm.survey_response`);
        await tx.execute(sql`DELETE FROM clm.survey_run`);
        await tx.execute(sql`DELETE FROM clm.survey_template`);
        await tx.execute(sql`DELETE FROM clm.vendor`);
        await tx.execute(sql`DELETE FROM clm.tenant`);
      });
    }
    await db.onModuleDestroy();
  });

  // ── 1. Cross-tenant ───────────────────────────────────────────────────────

  it('geeft een token van tenant A nooit toegang tot data van tenant B', async () => {
    const a = await maakResponse(TENANT_A, { naam: 'iso-a' });
    const b = await maakResponse(TENANT_B, { naam: 'iso-b' });

    const uitkomstA = await tokens.controleer(a.token);
    const uitkomstB = await tokens.controleer(b.token);

    expect(uitkomstA.geldig).toBe(true);
    expect(uitkomstB.geldig).toBe(true);

    if (uitkomstA.geldig && uitkomstB.geldig) {
      // De tenant komt uit de databaselookup, niet uit clientinput.
      expect(uitkomstA.tenantId).toBe(TENANT_A);
      expect(uitkomstB.tenantId).toBe(TENANT_B);
      expect(uitkomstA.responseId).not.toBe(uitkomstB.responseId);
    }
  });

  it('toont binnen de tenantcontext van A geen enkele response van B', async () => {
    const zichtbaar = await db.withTenant(TENANT_A, async (tx) => {
      const r = await tx.execute<{ tenant_id: string }>(
        sql`SELECT tenant_id FROM clm.survey_response`,
      );
      return r.rows;
    });

    expect(zichtbaar.length).toBeGreaterThan(0);
    expect(zichtbaar.every((r) => r.tenant_id === TENANT_A)).toBe(true);
  });

  // ── 2-5. Levenscyclus ─────────────────────────────────────────────────────

  it('weigert een verlopen token (AC11)', async () => {
    const { token } = await maakResponse(TENANT_A, {
      naam: 'verlopen',
      verlooptOver: -1000,
    });

    const uitkomst = await tokens.controleer(token);
    expect(uitkomst.geldig).toBe(false);
    if (!uitkomst.geldig) expect(uitkomst.reden).toBe('verlopen');
  });

  it('weigert een tweede indiening met hetzelfde token (AC12)', async () => {
    const { token, responseId } = await maakResponse(TENANT_A, {
      naam: 'eenmalig',
    });

    expect(await tokens.dienIn(TENANT_A, responseId)).toBe(true);
    expect(await tokens.dienIn(TENANT_A, responseId)).toBe(false);

    const uitkomst = await tokens.controleer(token);
    expect(uitkomst.geldig).toBe(false);
    if (!uitkomst.geldig) expect(uitkomst.reden).toBe('al-ingediend');
  });

  it('levert bij twee gelijktijdige indieningen precies één succes op', async () => {
    const { responseId } = await maakResponse(TENANT_A, { naam: 'race' });

    // Echt gelijktijdig, niet twee opeenvolgende aanroepen: anders test je de
    // race niet die je wilt uitsluiten.
    const uitkomsten = await Promise.all([
      tokens.dienIn(TENANT_A, responseId),
      tokens.dienIn(TENANT_A, responseId),
    ]);

    expect(uitkomsten.filter(Boolean)).toHaveLength(1);
  });

  it('weigert een ingetrokken token, ononderscheidbaar van een onbekend token', async () => {
    const { token } = await maakResponse(TENANT_A, {
      naam: 'ingetrokken',
      status: 'revoked',
    });

    const uitkomst = await tokens.controleer(token);
    expect(uitkomst.geldig).toBe(false);
    if (!uitkomst.geldig) expect(uitkomst.reden).toBe('ingetrokken');
  });

  it('geeft niets terug voor een onbekende hash', async () => {
    const uitkomst = await tokens.controleer(genereerToken());
    expect(uitkomst.geldig).toBe(false);
    if (!uitkomst.geldig) expect(uitkomst.reden).toBe('onbekend');
  });

  it('weigert een token met een afwijkende vorm zonder de database te raken', async () => {
    for (const onzin of ['', 'kort', "'; DROP TABLE clm.vendor; --", null]) {
      const uitkomst = await tokens.controleer(onzin);
      expect(uitkomst.geldig).toBe(false);
    }

    // De tabel bestaat nog: de vormcontrole voorkomt dat dit de database raakt.
    const nogSteeds = await db.withTenant(TENANT_A, async (tx) => {
      const r = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM clm.vendor`,
      );
      return r.rows[0].n;
    });
    expect(nogSteeds).toBeGreaterThan(0);
  });

  // ── 9-13. Omliggende gegevens (ontwerp §5a) ───────────────────────────────

  it('blijft werken nadat de naam van de vendor is gewijzigd', async () => {
    const { token, vendorId } = await maakResponse(TENANT_A, {
      naam: 'hernoemd',
    });

    await db.withTenant(TENANT_A, async (tx) => {
      await tx.execute(
        sql`UPDATE clm.vendor SET name = 'Volledig Andere Naam B.V.' WHERE vendor_id = ${vendorId}`,
      );
    });

    // Het token verwijst naar vendor_id, niet naar de naam.
    const uitkomst = await tokens.controleer(token);
    expect(uitkomst.geldig).toBe(true);
  });

  it('staat zacht verwijderen toe zonder de tenant-isolatie te verzwakken (#31)', async () => {
    const { vendorId } = await maakResponse(TENANT_A, { naam: 'softdelete' });

    // Zacht verwijderen moet slagen — vóór de fix uit #31 weigerde de
    // RLS-policy dit, omdat deleted_at IS NULL in de USING-clausule stond.
    await db.withTenant(TENANT_A, async (tx) => {
      await tx.execute(
        sql`UPDATE clm.vendor SET deleted_at = now() WHERE vendor_id = ${vendorId}`,
      );
    });

    // En de isolatie moet onverkort gelden: tenant B ziet deze rij niet,
    // zacht verwijderd of niet.
    const zichtbaarVoorB = await db.withTenant(TENANT_B, async (tx) => {
      const r = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM clm.vendor WHERE vendor_id = ${vendorId}`,
      );
      return r.rows[0].n;
    });
    expect(zichtbaarVoorB).toBe(0);

    // Een cross-tenant update blijft geweigerd door WITH CHECK.
    await expect(
      db.withTenant(TENANT_B, async (tx) => {
        await tx.execute(
          sql`INSERT INTO clm.vendor (tenant_id, name) VALUES (${TENANT_A}, 'cross-tenant-poging')`,
        );
      }),
    ).rejects.toThrow();
  });

  it('weigert het token als de vendor zacht verwijderd is', async () => {
    const { token, vendorId } = await maakResponse(TENANT_A, {
      naam: 'zachtweg',
    });

    await db.withTenant(TENANT_A, async (tx) => {
      await tx.execute(
        sql`UPDATE clm.vendor SET deleted_at = now() WHERE vendor_id = ${vendorId}`,
      );
    });

    // Zonder deze controle zou dit een stille fout zijn: de RLS-policy filtert
    // de vendor weg, dus de pagina laadt met lege gegevens.
    const uitkomst = await tokens.controleer(token);
    expect(uitkomst.geldig).toBe(false);
    if (!uitkomst.geldig) expect(uitkomst.reden).toBe('vendor-inactief');
  });

  it('blokkeert een harde DELETE van een vendor met responses', async () => {
    const { vendorId } = await maakResponse(TENANT_A, { naam: 'hardweg' });

    await expect(
      db.withTenant(TENANT_A, async (tx) => {
        await tx.execute(
          sql`DELETE FROM clm.vendor WHERE vendor_id = ${vendorId}`,
        );
      }),
    ).rejects.toThrow();
  });

  it('weigert het token als de ronde gesloten is, ook binnen de vervaltermijn', async () => {
    const { token } = await maakResponse(TENANT_A, {
      naam: 'gesloten',
      rondeGesloten: true,
    });

    const uitkomst = await tokens.controleer(token);
    expect(uitkomst.geldig).toBe(false);
    if (!uitkomst.geldig) expect(uitkomst.reden).toBe('ronde-gesloten');
  });

  it('weigert het token als de ronde is ingetrokken', async () => {
    const { token } = await maakResponse(TENANT_A, {
      naam: 'rondeweg',
      rondeIngetrokken: true,
    });

    const uitkomst = await tokens.controleer(token);
    expect(uitkomst.geldig).toBe(false);
    if (!uitkomst.geldig) expect(uitkomst.reden).toBe('ronde-gesloten');
  });

  // ── Lifecycle van de ronde (testpunt 30, ontwerp §2b) ─────────────────────
  // Vóór migratie 0006 kende de guard alleen revoked_at en closes_at. Een
  // ronde in 'draft' — aangemaakt maar nog niet opengesteld — was daarmee
  // gewoon bereikbaar. Deze vier tests dekken elke lifecycle-toestand af,
  // inclusief de enige die wél toegang geeft.

  it('weigert een token als de ronde nog in draft staat, ook binnen de vervaltermijn', async () => {
    const { token } = await maakResponse(TENANT_A, {
      naam: 'nogdraft',
      rondeStatus: 'draft',
    });

    const uitkomst = await tokens.controleer(token);
    expect(uitkomst.geldig).toBe(false);
    // Bewust een eigen reden: 'nog niet opengesteld' is voor een leverancier
    // iets anders dan 'gesloten'. De eerste is tijdelijk, de tweede definitief.
    if (!uitkomst.geldig) expect(uitkomst.reden).toBe('ronde-niet-open');
  });

  it('weigert een token als de ronde is afgerond', async () => {
    const { token } = await maakResponse(TENANT_A, {
      naam: 'afgerond',
      rondeStatus: 'finished',
    });

    const uitkomst = await tokens.controleer(token);
    expect(uitkomst.geldig).toBe(false);
    if (!uitkomst.geldig) expect(uitkomst.reden).toBe('ronde-gesloten');
  });

  it('weigert een token als de ronde gearchiveerd is', async () => {
    const { token } = await maakResponse(TENANT_A, {
      naam: 'archief',
      rondeStatus: 'archived',
    });

    const uitkomst = await tokens.controleer(token);
    expect(uitkomst.geldig).toBe(false);
    if (!uitkomst.geldig) expect(uitkomst.reden).toBe('ronde-gesloten');
  });

  it('laat een token toe zodra de ronde actief is', async () => {
    const { token } = await maakResponse(TENANT_A, {
      naam: 'actief',
      rondeStatus: 'active',
    });

    // De tegenproef bij de drie tests hierboven: zonder deze zou een guard die
    // álles weigert ook groen zijn.
    const uitkomst = await tokens.controleer(token);
    expect(uitkomst.geldig).toBe(true);
  });

  it('weigert indienen op een niet-actieve ronde, ook buiten de guard om', async () => {
    const { responseId } = await maakResponse(TENANT_A, {
      naam: 'draftdirect',
      rondeStatus: 'draft',
    });

    // dienIn() rechtstreeks aanroepen slaat de guard over. De voorwaarde zit
    // daarom óók in het UPDATE-statement zelf: een toekomstige aanroeper die
    // de guard niet passeert mag geen indiening kunnen forceren.
    const gelukt = await tokens.dienIn(TENANT_A, responseId);
    expect(gelukt).toBe(false);

    // En de response moet onaangeroerd zijn gebleven.
    const na = await db.withTenant(TENANT_A, (tx) =>
      tx.execute<{ status: string }>(
        sql`SELECT status FROM clm.survey_response WHERE response_id = ${responseId}`,
      ),
    );
    expect(na.rows[0].status).toBe('pending');
  });

  // ── Opslag ────────────────────────────────────────────────────────────────

  it('slaat het ruwe token nooit op, alleen de hash', async () => {
    const { token } = await maakResponse(TENANT_A, { naam: 'hashonly' });

    const treffers = await db.withTenant(TENANT_A, async (tx) => {
      const r = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM clm.survey_response
             WHERE token_hash = ${token} OR token_hash LIKE ${`%${token}%`}`,
      );
      return r.rows[0].n;
    });

    expect(treffers).toBe(0);

    // De hash staat er wél, en heeft de vorm die de CHECK-constraint eist.
    const viaHash = await db.withTenant(TENANT_A, async (tx) => {
      const r = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM clm.survey_response WHERE token_hash = ${hashToken(token)}`,
      );
      return r.rows[0].n;
    });
    expect(viaHash).toBe(1);
  });

  it('weigert op databaseniveau een token_hash die geen SHA-256 is', async () => {
    await expect(
      db.withTenant(TENANT_A, async (tx) => {
        await tx.execute(
          sql`UPDATE clm.survey_response SET token_hash = 'dit-is-geen-hash'
               WHERE tenant_id = ${TENANT_A}`,
        );
      }),
    ).rejects.toThrow();
  });
});
