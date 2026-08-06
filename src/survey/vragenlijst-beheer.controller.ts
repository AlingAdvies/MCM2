import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { UitnodigingVerzender } from '../mail/uitnodiging-verzender.service';
import { RolGuard, VereistRol } from '../auth/rol.guard';
import {
  TenantContextGuard,
  type RequestMetSessie,
} from '../auth/tenant-context.guard';
import { RondeBeheerService } from './ronde-beheer.service';
import {
  InvoerFout,
  leesNieuweBeoordeling,
  type NieuweBeoordelingInvoer,
  leesNieuweRonde,
  leesStatus,
  leesUitnodigingen,
} from './ronde-invoer';
import { BeoordelingService } from './beoordeling.service';
import { VragenlijstBeheerService } from './vragenlijst-beheer.service';

/**
 * De beheerkant van de vragenlijsten — fase A van
 * docs/superpowers/plans/2026-08-03-surveybeheer.md.
 *
 * ── Waarom deze routes er zijn ──────────────────────────────────────────────
 *
 * MCM2 kon een leverancier een vragenlijst laten invullen, maar de tenant kon
 * er zelf niets mee: geen scherm om een vragenlijst te bekijken, geen manier om
 * te zien welke rondes er lopen. De demo-tenant leek gevuld, maar dat kwam
 * doordat een seed-script rechtstreeks in de database schrijft.
 *
 * Dit zijn de eerste routes waarmee de beheerkant iets van de survey ziet.
 *
 * ── Lezen mag iedereen, schrijven alleen een admin ──────────────────────────
 *
 * De GET-routes hebben géén `@VereistRol`: elke geldige sessie mag ze lezen.
 * Dat is een besluit uit het plan (fase A) — **lezen mag ook een reviewer**,
 * want resultaten inzien is precies zijn rol. Hem dat ontzeggen maakt de rol
 * betekenisloos.
 *
 * De schrijfroutes van fase B hebben die eis wél. Een ronde uitzetten geeft
 * tokens uit aan externe partijen; dat is een andere bevoegdheid dan meekijken.
 *
 * ── Fase B zit in een eigen service ─────────────────────────────────────────
 *
 * `VragenlijstBeheerService` blijft uitsluitend lezen; `RondeBeheerService`
 * schrijft. Die knip is er omdat de schrijfkant `genereerToken()` aanroept —
 * de eerste productiecode die dat doet — en dat raakt de tokenlaag die al
 * bewezen en groen is. Eén klasse die beide doet zou die grens onzichtbaar
 * maken.
 *
 * ── Het pad ─────────────────────────────────────────────────────────────────
 *
 * `admin/survey/...` en niet `survey/...`: de leverancierskant zit al op
 * `survey/respond` en draait onder een tokenguard. Dat verschil hoort zichtbaar
 * te zijn in het adres, zodat niemand per ongeluk een beheerroute achter de
 * verkeerde guard hangt.
 */
@Controller('admin/survey')
@UseGuards(TenantContextGuard, RolGuard)
export class VragenlijstBeheerController {
  constructor(
    private readonly beheer: VragenlijstBeheerService,
    private readonly rondes: RondeBeheerService,
    private readonly verzender: UitnodigingVerzender,
    // Onderstreept omdat `beoordelingen` al de naam van een routemethode is.
    private readonly beoordelingen_: BeoordelingService,
  ) {}

  /** Alle vragenlijsten van deze tenant, met aantallen vragen en rondes. */
  @Get('templates')
  async templates(@Req() request: RequestMetSessie) {
    // Het uitroepteken is veilig: zonder sessie is TenantContextGuard nooit
    // voorbijgekomen. Zelfde patroon als VendorController.
    const sessie = request.sessie!;

    const vragenlijsten = await this.beheer.lijst(sessie.tenantId);

    return { vragenlijsten };
  }

  /** Eén vragenlijst met haar categorieën en vragen, in leveranciersvolgorde. */
  @Get('templates/:id')
  async template(@Req() request: RequestMetSessie, @Param('id') id: string) {
    const sessie = request.sessie!;

    return this.beheer.detail(sessie.tenantId, id);
  }

  /** Alle rondes van deze tenant, met voortgang per ronde. */
  @Get('runs')
  async runs(@Req() request: RequestMetSessie) {
    const sessie = request.sessie!;

    const rondes = await this.beheer.rondes(sessie.tenantId);

    return { rondes };
  }

  /** Eén ronde met haar deelnemers en wie er heeft ingediend. */
  @Get('runs/:id')
  async run(@Req() request: RequestMetSessie, @Param('id') id: string) {
    const sessie = request.sessie!;

    return this.beheer.ronde(sessie.tenantId, id);
  }

  /**
   * De antwoorden van één respons — wat de leverancier feitelijk heeft
   * ingevuld, in de volgorde van de vragenlijst.
   *
   * Geen `@VereistRol`: lezen mag ook een reviewer, net als de andere
   * GET-routes hierboven. Voor hem is dit zelfs de kernroute — beoordelen kan
   * niet zonder de antwoorden te zien.
   *
   * 404 als de respons niet bestaat binnen deze tenant. Dat "binnen deze
   * tenant" doet RLS, niet deze route: een respons van een andere tenant is
   * onzichtbaar en levert dezelfde 404 op als een verzonnen id. Het verschil
   * tussen "bestaat niet" en "mag je niet zien" hoort niet naar buiten te
   * lekken.
   */
  @Get('responses/:id/answers')
  async antwoorden(@Req() request: RequestMetSessie, @Param('id') id: string) {
    const sessie = request.sessie!;

    return this.beheer.antwoorden(sessie.tenantId, id);
  }

  /** Alle oordelen over één respons, nieuwste eerst. */
  @Get('responses/:id/reviews')
  async beoordelingen(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
  ) {
    const sessie = request.sessie!;

    const beoordelingen = await this.beoordelingen_.lijst(sessie.tenantId, id);

    return { beoordelingen };
  }

  /**
   * Legt een nieuw oordeel vast over een ingediende respons.
   *
   * **Geen `@VereistRol('admin')`, en dat is een besluit** (plan §2a, eigenaar
   * 2026-08-03). Beoordelen ís de rol van een reviewer; hem dat ontzeggen maakt
   * de rol betekenisloos en de admin een flessenhals.
   *
   * Dat dit verantwoord is hangt aan één ding: elk oordeel staat met naam en
   * datum vast en wordt nooit overschreven. Een reviewer kan dus niets
   * stilletjes veranderen — alleen iets toevoegen dat zichtbaar van hem is.
   * Zou de tabel updates toestaan, dan hoorde hier admin te staan.
   *
   * 201 met het oordeel erbij. 404 als de respons niet bestaat binnen deze
   * tenant, 400 als er nog niet is ingediend of de invoer niet deugt.
   */
  @Post('responses/:id/reviews')
  async beoordeel(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let invoer: NieuweBeoordelingInvoer;
    try {
      invoer = leesNieuweBeoordeling(body);
    } catch (err) {
      throw this.naarHttpFout(err);
    }

    // De reviewer komt uit de sessie, nooit uit de body: anders kan iemand een
    // oordeel op naam van een collega vastleggen (§6).
    const beoordeling = await this.beoordelingen_.voegToe(
      sessie.tenantId,
      id,
      sessie.userId,
      invoer,
    );

    return { beoordeling };
  }

  // ── Fase B: schrijven ──────────────────────────────────────────────────────
  //
  // Vanaf hier staat op elke route `@VereistRol('admin')`. Een reviewer mag
  // lezen — resultaten inzien ís zijn rol — maar een ronde uitzetten geeft
  // tokens uit aan externe partijen, en dat is een andere bevoegdheid.

  /**
   * Maakt een nieuwe ronde aan, in status `draft`.
   *
   * 201 met de ronde erbij. 404 als de vragenlijst niet bestaat binnen deze
   * tenant, 400 bij ongeldige invoer (met het veld erbij, zodat het scherm de
   * melding op de juiste plek kan tonen).
   */
  @Post('runs')
  @VereistRol('admin')
  @HttpCode(201)
  async maakRonde(@Req() request: RequestMetSessie, @Body() body: unknown) {
    const sessie = request.sessie!;

    return this.rondes.maakRonde(sessie.tenantId, this.leesRonde(body));
  }

  /**
   * Verandert de status van een ronde: draft → active → finished → archived.
   *
   * 409 bij een overgang die niet mag, met erbij wat er wél kan.
   */
  @Patch('runs/:id/status')
  @VereistRol('admin')
  async wijzigStatus(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let status: string;

    try {
      status = leesStatus(body);
    } catch (err) {
      throw this.naarHttpFout(err);
    }

    return this.rondes.wijzigStatus(sessie.tenantId, id, status);
  }

  /**
   * Nodigt leveranciers uit en geeft de tokenlinks terug.
   *
   * ── Waarom dit antwoord bijzonder is ────────────────────────────────────────
   *
   * Dit is het enige moment waarop de ruwe tokens bestaan. De database bewaart
   * alleen een hash; er is geen route die ze opnieuw kan tonen, en die komt er
   * ook niet. Het scherm moet de beheerder daarop wijzen vóórdat hij wegklikt.
   *
   * 201 met de uitnodigingen. 400 wanneer een gekozen leverancier niet bestaat
   * — dan wordt het hele verzoek afgewezen, niet een deel uitgevoerd.
   */
  @Post('runs/:id/participants')
  @VereistRol('admin')
  @HttpCode(201)
  async uitnodigen(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let invoer: ReturnType<typeof leesUitnodigingen>;

    try {
      invoer = leesUitnodigingen(body);
    } catch (err) {
      throw this.naarHttpFout(err);
    }

    const { uitnodigingen, context } = await this.rondes.uitnodigen(
      sessie.tenantId,
      id,
      invoer,
    );

    // Versturen gebeurt ná de transactie, nooit erin.
    //
    // Een verstuurde mail is niet terug te draaien. Zat de verzending in de
    // transactie en faalde de laatste invoeging, dan waren de tokens weg maar
    // de uitnodigingen verstuurd — leveranciers met een link naar niets. Eerst
    // vastleggen, dan versturen, is de enige volgorde die dat uitsluit.
    const verzending = await this.verzender.verstuurAllemaal(
      uitnodigingen.map((u) => ({
        responseId: u.responseId,
        vendorNaam: u.vendorNaam,
        ontvanger: u.contactEmail,
        link: this.portaalLink(u.token),
        verlooptOp: u.expiresAt,
      })),
      context,
    );

    const perResponse = new Map(verzending.map((v) => [v.responseId, v]));

    return {
      // De tokens blijven in het antwoord staan, óók als de mail geslaagd is.
      // Dit is het enige moment waarop ze bestaan; er is geen route die ze
      // opnieuw kan tonen. Gaat de mail alsnog verloren, dan is dit de laatste
      // kans om de link handmatig door te geven.
      uitnodigingen: uitnodigingen.map((u) => {
        const uitkomst = perResponse.get(u.responseId);
        return {
          ...u,
          verstuurd: uitkomst?.verstuurd ?? false,
          verzendFout: uitkomst?.fout,
        };
      }),
      verzonden: verzending.filter((v) => v.verstuurd).length,
      mislukt: verzending.filter((v) => !v.verstuurd).length,
    };
  }

  /**
   * De URL die de leverancier in de mail krijgt.
   *
   * `PORTAAL_BASIS_URL` en niet de API-URL: het portaal is een pagina in de
   * frontend, niet een route op deze backend. Ontbreekt de variabele, dan valt
   * dit terug op de lokale ontwikkelpoort — zichtbaar fout in een mail, in
   * plaats van een lege link waar niemand iets van merkt.
   */
  private portaalLink(token: string): string {
    const basis = (
      process.env.PORTAAL_BASIS_URL ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');

    return `${basis}/portal/survey/${token}`;
  }

  private leesRonde(body: unknown) {
    try {
      return leesNieuweRonde(body);
    } catch (err) {
      throw this.naarHttpFout(err);
    }
  }

  /**
   * Zet een InvoerFout om in een 400 met het veld erbij.
   *
   * Zelfde patroon als VendorController: het scherm kan de melding dan naast
   * het juiste invoerveld tonen in plaats van bovenaan de pagina — dezelfde
   * les als bij Issue #42.
   */
  private naarHttpFout(err: unknown): Error {
    if (err instanceof InvoerFout) {
      return new BadRequestException({
        message: err.message,
        veld: err.veld,
      });
    }

    return err as Error;
  }
}
