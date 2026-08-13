import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  TenantContextGuard,
  type RequestMetSessie,
} from '../auth/tenant-context.guard';
import { UitnodigingVerzender } from '../mail/uitnodiging-verzender.service';
import { InvoerFout } from '../vendor/vendor-invoer';
import { PlatformAdminGuard } from './platform-admin.guard';
import { leesNieuweTenant, leesSupportReden } from './platform-invoer';
import { PlatformService } from './platform.service';

/**
 * Platformbeheer: een tenant aanmaken, en tijdelijk meekijken (ADR-015).
 *
 * Twee guards op klasseniveau, in deze volgorde: TenantContextGuard stelt de
 * sessie vast, PlatformAdminGuard kijkt of die persoon platformbeheerder is.
 * Op klasseniveau en niet per methode — een nieuwe route hier zou de guard
 * anders kunnen missen, en dan staat platformbeheer open zonder dat iets rood
 * wordt. Zelfde afweging als in VendorController.
 *
 * ── De enige plek waar een tenant uit de invoer komt ─────────────────────────
 *
 * MCM2-CLAUDE.md §6 verbiedt een tenant in een header of URL, en
 * TenantContextGuard dwingt dat af voor de hele applicatie. Deze controller is
 * de uitzondering, en dat kan alleen omdat PlatformAdminGuard ervoor staat:
 * de tenant in het pad is niet wíé je bent, maar wáár je iets aan doet.
 *
 * Dat verschil is precies waarom platformbeheer een aparte tabel heeft en geen
 * rol binnen een tenant.
 */
@Controller('platform')
@UseGuards(TenantContextGuard, PlatformAdminGuard)
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly uitnodigingen: UitnodigingVerzender,
  ) {}

  @Post('tenants')
  async tenantAanmaken(@Body() body: unknown) {
    try {
      const invoer = leesNieuweTenant(body);
      const tenant = await this.platform.tenantAanmaken(invoer);

      const link = this.uitnodigingsLink(tenant.uitnodigingstoken);

      // Versturen ná het aanmaken, nooit erin.
      //
      // Een verstuurde mail is niet terug te draaien. Zat de verzending in de
      // transactie en faalde er daarna iets, dan bestond de tenant niet maar
      // was de uitnodiging wél de deur uit — een link naar niets. Zelfde
      // volgorde en zelfde reden als bij de leveranciersuitnodigingen.
      const verzending = await this.uitnodigingen.verstuurAanBeheerder({
        ontvanger: invoer.adminEmail,
        beheerderNaam: invoer.adminNaam,
        tenantNaam: invoer.naam,
        link,
        verlooptOp: tenant.uitnodigingVerlooptOp.toISOString(),
      });

      return {
        ...tenant,
        // Het token blijft in het antwoord staan, óók als de mail geslaagd is.
        // Dit is het enige moment waarop het bestaat; er is geen route die het
        // opnieuw kan tonen. Gaat de mail alsnog verloren, dan is dit de
        // laatste kans om de link handmatig door te geven. Zelfde afweging als
        // bij de leverancierstokens.
        uitnodigingslink: link,
        // `echtVerstuurd` en niet `verstuurd` (Issue #131).
        //
        // Draait het logkanaal — geen RESEND_API_KEY — dan is `verstuurd`
        // true (er ging niets mis) maar `echtVerstuurd` false (er ging ook
        // niets uit). Op acceptatie stond hier `"mailVerstuurd": true` en
        // "heeft een uitnodiging ontvangen", terwijl het log in dezelfde
        // seconde `[niet echt verstuurd]` zei. Dat is precies de faalvorm
        // die dit project elders bestrijdt.
        mailVerstuurd: verzending.echtVerstuurd,
        mailFout: verzending.fout,
        melding: this.meldingOverVerzending(
          verzending,
          invoer.adminNaam,
          invoer.adminEmail,
        ),
      };
    } catch (fout) {
      if (fout instanceof InvoerFout) {
        throw new BadRequestException({
          veld: fout.veld,
          melding: fout.message,
        });
      }
      throw fout;
    }
  }

  /**
   * De zin die de platformbeheerder op zijn scherm krijgt.
   *
   * ── Drie uitkomsten, geen twee (Issue #131) ───────────────────────────────
   *
   * Hier stond een ternary op `verstuurd`: gelukt of mislukt. Die derde
   * uitkomst — niets misgegaan, maar er is ook niets verstuurd — viel daardoor
   * onder "gelukt" en leverde de zin "heeft een uitnodiging ontvangen" op voor
   * een mail die nooit bestond.
   *
   * De middelste zin noemt de oorzaak (geen mailkanaal) én de handeling (geef
   * de link door). Zonder die twee is "niet verstuurd" een mededeling waar de
   * lezer niets mee kan.
   */
  private meldingOverVerzending(
    verzending: { verstuurd: boolean; echtVerstuurd: boolean; fout?: string },
    adminNaam: string,
    adminEmail: string,
  ): string {
    if (verzending.echtVerstuurd) {
      return (
        `Tenant aangemaakt. ${adminNaam} heeft een uitnodiging ` +
        `ontvangen op ${adminEmail}.`
      );
    }

    if (verzending.verstuurd) {
      return (
        'Tenant aangemaakt, maar er is GEEN mail verstuurd: deze omgeving ' +
        'heeft geen mailkanaal ingesteld. Geef de link hierboven handmatig ' +
        `door aan ${adminNaam}.`
      );
    }

    return (
      `Tenant aangemaakt, maar de uitnodiging kon niet verstuurd worden ` +
      `(${verzending.fout ?? 'onbekende fout'}). Geef de link hierboven ` +
      'handmatig door.'
    );
  }

  /**
   * De URL die de nieuwe beheerder in de mail krijgt.
   *
   * Wijst naar `/auth/login` en niet naar het portaal: die route zet het token
   * in het pogingcookie en stuurt door naar de identity provider. Het portaal
   * is de leverancierskant en heeft met deze stroom niets te maken.
   *
   * ── Sinds Issue #51 loopt dat via de frontend (Issue #132) ────────────────
   *
   * Hier stond `API_BASIS_URL`, met het adres van de backend. Dat klopte zolang
   * de browser daar rechtstreeks mee praatte; sinds het doorgeefluik doet hij
   * dat niet meer. Een link naar de backend-poort zou het pogingcookie op de
   * verkeerde herkomst zetten, en dan is het bij de callback niet meer te
   * lezen — dezelfde valkuil als bij `OIDC_REDIRECT_URI`.
   *
   * `UITNODIGING_BASIS_URL` is daarom het adres van de **frontend**. Het pad
   * `/api/backend` ervoor is het doorgeefluik.
   *
   * ── Waarom de terugval blijft, en waarom hij localhost is ─────────────────
   *
   * Ontbreekt de variabele, dan valt dit terug op de lokale frontend. Dat is
   * zichtbaar fout in een mail naar een klant, in plaats van een lege link waar
   * niemand iets van merkt. Op 2026-08-10 was dat precies wat er gebeurde: de
   * variabele bestond nergens, de tenant werd aangemaakt, en de beheerder kreeg
   * een link naar een adres dat op die server niet bestaat.
   *
   * Dat de terugval bestaat is dus geen vangnet maar een leesbare fout. De
   * echte oplossing is dat `deploy-inrichten.js` deze variabele per omgeving
   * neerzet — daar volgt hij uit het poortnummer.
   */
  private uitnodigingsLink(token: string): string {
    const basis = (
      process.env.UITNODIGING_BASIS_URL ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');

    return `${basis}/api/backend/auth/login?uitnodiging=${encodeURIComponent(token)}`;
  }

  /**
   * Welke tenants er bestaan (ADR-017).
   *
   * Moet vóór `@Get('tenants/:id')` staan: Nest kiest de eerste route die past,
   * en `:id` zou een pad zonder id niet vangen — maar de volgorde is hier hoe
   * dan ook de leesbare: eerst de lijst, dan het detail.
   *
   * Geeft id, naam en aanmaakdatum. Geen ledenaantal en geen klantgegevens —
   * zie `TenantRegel`. Wie in de gegevens van een tenant moet zijn, vraagt
   * support-toegang aan via `POST tenants/:id/toegang` (ADR-015).
   */
  @Get('tenants')
  async tenantsLijst(@Req() request: RequestMetSessie) {
    // De sessie is gegarandeerd aanwezig: beide guards hebben gedraaid.
    const sessie = request.sessie!;

    const tenants = await this.platform.tenantsLijst(sessie.tenantId);

    return { tenants };
  }

  @Get('tenants/:id')
  async tenantLezen(@Param('id') id: string) {
    const tenant = await this.platform.tenantLezen(id);

    if (!tenant) {
      throw new NotFoundException('Onbekende tenant.');
    }

    return tenant;
  }

  /**
   * Tijdelijke support-toegang tot één tenant.
   *
   * Geen impersonatie: de beheerder komt binnen als zichzelf, in de rol
   * `support`, en blijft daarmee te onderscheiden van een medewerker van de
   * klant (Issue #57).
   */
  @Post('tenants/:id/toegang')
  async supportToegang(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: RequestMetSessie,
  ) {
    try {
      const reden = leesSupportReden(body);
      const bestaat = await this.platform.tenantLezen(id);

      if (!bestaat) {
        throw new NotFoundException('Onbekende tenant.');
      }

      // De sessie is gegarandeerd aanwezig: beide guards hebben gedraaid.
      const sessie = request.sessie!;

      return await this.platform.supportToegangGeven(id, sessie.userId, reden);
    } catch (fout) {
      if (fout instanceof InvoerFout) {
        throw new BadRequestException({
          veld: fout.veld,
          melding: fout.message,
        });
      }
      throw fout;
    }
  }
}
