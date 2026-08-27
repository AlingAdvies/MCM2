import { stelTenantLidUitnodigingSamen } from './tenant-lid-uitnodiging-bericht';

const BASIS = {
  ontvanger: 'collega@transdev.nl',
  tenantNaam: 'Transdev',
  rol: 'user',
  link: 'https://mcm2.example.nl/api/backend/auth/login?uitnodiging=abc123',
  verlooptOp: '2026-11-07T15:47:47.718Z',
};

describe('tenant-lid-uitnodigingsbericht', () => {
  describe('wat de ontvanger moet zien', () => {
    it('noemt de organisatie waarvoor de uitnodiging is', () => {
      const { tekst, onderwerp } = stelTenantLidUitnodigingSamen(BASIS);

      expect(tekst).toContain('Transdev');
      expect(onderwerp).toContain('Transdev');
    });

    it('noemt de toegekende rol', () => {
      expect(stelTenantLidUitnodigingSamen(BASIS).tekst).toContain(
        'contractbeheerder',
      );
    });

    it('noemt een andere rol-omschrijving voor admin', () => {
      expect(
        stelTenantLidUitnodigingSamen({ ...BASIS, rol: 'admin' }).tekst,
      ).toContain('beheerder');
    });

    it('noemt een andere rol-omschrijving voor reviewer', () => {
      expect(
        stelTenantLidUitnodigingSamen({ ...BASIS, rol: 'reviewer' }).tekst,
      ).toContain('beoordelaar');
    });

    it('schrijft de link volledig uit', () => {
      expect(stelTenantLidUitnodigingSamen(BASIS).tekst).toContain(
        BASIS.link,
      );
    });

    it('noemt de uiterste datum in leesbare vorm', () => {
      expect(stelTenantLidUitnodigingSamen(BASIS).tekst).toContain(
        '7 november 2026',
      );
    });

    it('zegt dat de link eenmalig is', () => {
      expect(stelTenantLidUitnodigingSamen(BASIS).tekst).toContain(
        'eenmalig',
      );
    });

    it('vertelt wat te doen bij een onverwachte uitnodiging', () => {
      expect(stelTenantLidUitnodigingSamen(BASIS).tekst).toContain(
        'Verwacht u deze uitnodiging niet',
      );
    });
  });

  describe('wat er bewust NIET in staat', () => {
    it('vraagt nergens om een wachtwoord', () => {
      const { tekst, onderwerp } = stelTenantLidUitnodigingSamen(BASIS);

      expect(tekst.toLowerCase()).not.toContain('wachtwoord');
      expect(onderwerp.toLowerCase()).not.toContain('wachtwoord');
    });

    it('klopt geen urgentie op', () => {
      const tekst = stelTenantLidUitnodigingSamen(BASIS).tekst.toLowerCase();

      for (const woord of ['direct', 'onmiddellijk', 'urgent', 'let op!']) {
        expect(tekst).not.toContain(woord);
      }
    });
  });

  describe('afzender', () => {
    it('is de tenant via MCM2, niet MCM2 alleen', () => {
      // Anders dan de beheerder-uitnodiging: deze mail komt van een al
      // bestaande tenant, dus die naam hoort voorop te staan — zelfde
      // patroon als de leveranciersuitnodiging.
      expect(stelTenantLidUitnodigingSamen(BASIS).afzenderNaam).toBe(
        'Transdev via MCM2',
      );
    });

    it('gaat naar het opgegeven adres', () => {
      expect(stelTenantLidUitnodigingSamen(BASIS).aan).toBe(
        'collega@transdev.nl',
      );
    });
  });

  describe('randgevallen', () => {
    it('laat een onleesbare datum staan zoals hij is', () => {
      const bericht = stelTenantLidUitnodigingSamen({
        ...BASIS,
        verlooptOp: 'geen datum',
      });

      expect(bericht.tekst).toContain('geen datum');
      expect(bericht.tekst).not.toContain('Invalid Date');
    });

    it('valt terug op de ruwe rolnaam bij een onbekende rol', () => {
      const bericht = stelTenantLidUitnodigingSamen({
        ...BASIS,
        rol: 'onbekende-rol',
      });

      expect(bericht.tekst).toContain('onbekende-rol');
    });
  });
});
