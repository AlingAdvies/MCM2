import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { UitnodigingVerzender } from '../mail/uitnodiging-verzender.service';
import { RolGuard, VereistRol } from '../auth/rol.guard';
import {
  TenantContextGuard,
  type RequestMetSessie,
} from '../auth/tenant-context.guard';
import { ContractService } from '../contract/contract.service';
import { BestandOpslagService } from './bestand-opslag.service';
import { BijlageBeheerService } from './bijlage-beheer.service';
import { MAX_BESTANDSGROOTTE } from './bestand-validatie';
import { ContractmanagerService } from './contractmanager.service';
import { NotitieService } from './notitie.service';
import { RondeBeheerService } from './ronde-beheer.service';
import {
  InvoerFout,
  leesBeoordelaar,
  leesNieuweBeoordeling,
  leesNotitie,
  type NieuweBeoordelingInvoer,
  leesNieuweRonde,
  leesStatus,
  leesUitnodigingen,
} from './ronde-invoer';
import { BeoordelaarService } from './beoordelaar.service';
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
    private readonly beoordelaars: BeoordelaarService,
    // Onderstreept om dezelfde reden als beoordelingen_.
    private readonly notities_: NotitieService,
    private readonly contractmanagers: ContractmanagerService,
    private readonly contracten: ContractService,
    private readonly opslag: BestandOpslagService,
    private readonly bijlagenBeheer: BijlageBeheerService,
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

  /** Leveranciers die op de wachtlijst staan voor de volgende ronde. */
  @Get('templates/:id/wachtlijst')
  async wachtlijst(@Req() request: RequestMetSessie, @Param('id') id: string) {
    const sessie = request.sessie!;

    const leveranciers = await this.contracten.wachtlijstVoorTemplate(
      sessie.tenantId,
      id,
    );

    return { leveranciers };
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

  /**
   * Downloadt één bijlage bij een antwoord.
   *
   * Geen `@VereistRol`: zelfde regel als `antwoorden()` hierboven — een
   * reviewer moet een geüpload certificaat kunnen openen om te kunnen
   * beoordelen.
   *
   * `storage_key` verlaat de service nooit naar de client (zie de toelichting
   * bij `VragenlijstBeheerService.bijlageOpzoeken()`) — deze route leest hem
   * op, geeft hem meteen door aan `BestandOpslagService.lees()`, en stuurt
   * alleen de bytes terug.
   */
  @Get('attachments/:id')
  async bijlageDownloaden(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const sessie = request.sessie!;

    const bijlage = await this.beheer.bijlageOpzoeken(sessie.tenantId, id);
    const inhoud = await this.opslag.lees(bijlage.storageKey);

    res.set({
      'Content-Type': bijlage.contentType,
      // 'attachment' i.p.v. 'inline': een geüpload PDF/afbeelding hoort
      // gedownload te worden, niet in de browser te renderen naast de
      // beheerinterface. encodeURIComponent voorkomt problemen met
      // aanhalingstekens of niet-ASCII-tekens in de oorspronkelijke naam.
      'Content-Disposition': `attachment; filename="${encodeURIComponent(bijlage.originalName)}"`,
      'Content-Length': String(inhoud.length),
    });
    res.send(inhoud);
  }

  /**
   * Voegt een bijlage toe namens de leverancier (besluit van de eigenaar,
   * 01-09): een leverancier publiceert een certificaat soms op zijn eigen
   * website in plaats van het te uploaden, en de contractbeheerder wil dat
   * bewijs dan zelf ophalen en vastleggen bij de vraag.
   *
   * `@VereistRol('admin')`: bewust strenger dan de leesroutes hierboven
   * (waar een reviewer ook mag) — dit is een schrijfactie die de
   * leverancier normaal zelf doet, en die bevoegdheid hoort bij dezelfde rol
   * die ook contracten en leveranciers beheert.
   *
   * Geen `niet-meer-open`-status zoals bij het leverancierspad: dit mag
   * juist ook ná indienen, dat is het hele scenario.
   */
  @Post('responses/:id/attachments')
  @VereistRol('admin')
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_BESTANDSGROOTTE, files: 1 },
    }),
  )
  async bijlageToevoegen(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Query('question') questionKey: string | undefined,
    @UploadedFile()
    bestand:
      { originalname: string; mimetype?: string; buffer: Buffer } | undefined,
  ) {
    const sessie = request.sessie!;

    if (!questionKey) {
      throw new BadRequestException(
        'Geef met de parameter `question` aan bij welke vraag dit bestand hoort.',
      );
    }

    if (!bestand) {
      throw new BadRequestException('Er is geen bestand meegestuurd.');
    }

    const uitkomst = await this.bijlagenBeheer.voegToeAlsBeheer(
      sessie.tenantId,
      id,
      questionKey,
      sessie.userId,
      bestand,
    );

    switch (uitkomst.status) {
      case 'opgeslagen':
        return {
          status: 'opgeslagen' as const,
          attachmentId: uitkomst.attachmentId,
          contentType: uitkomst.contentType,
        };

      case 'afgekeurd':
        if (uitkomst.reden === 'te-groot') {
          throw new PayloadTooLargeException('Dit bestand is groter dan 5 MB.');
        }
        throw new UnprocessableEntityException({
          status: 'invalid_file',
          reason: uitkomst.reden,
        });

      case 'onbekende-vraag':
        throw new NotFoundException('Deze vraag hoort niet bij deze respons.');

      case 'geen-upload-vraag':
        throw new UnprocessableEntityException({
          status: 'invalid_file',
          reason: 'question_accepts_no_files',
        });

      case 'te-veel-bestanden':
        throw new UnprocessableEntityException({
          status: 'invalid_file',
          reason: 'too_many_files',
          maximum: uitkomst.maximum,
        });
    }
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

  /**
   * Trekt een oordeel in.
   *
   * Zet `deleted_at`; de rij blijft staan (besluit eigenaar 2026-08-07, V2).
   * Een goedkeuring die spoorloos kan verdampen maakt de status onbetrouwbaar,
   * en dit is juist de tabel waar "wat vond men er eerder van" de vraag is die
   * je later stelt.
   *
   * **Geen `@VereistRol('admin')`, consequent met beoordelen zelf.** Elke
   * handeling ligt met naam en datum vast; niemand kan iets stilletjes doen.
   *
   * 204 bij succes. 404 als de respons of het oordeel niet bestaat binnen deze
   * tenant, of als het oordeel al is ingetrokken.
   */
  @Delete('responses/:id/reviews/:reviewId')
  @HttpCode(204)
  async trekBeoordelingIn(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Param('reviewId') reviewId: string,
  ): Promise<void> {
    const sessie = request.sessie!;

    await this.beoordelingen_.trekIn(sessie.tenantId, id, reviewId);
  }

  /** Alle notities bij één respons, nieuwste eerst. */
  @Get('responses/:id/notes')
  async notities(@Req() request: RequestMetSessie, @Param('id') id: string) {
    const sessie = request.sessie!;

    const notities = await this.notities_.lijst(sessie.tenantId, id);

    return { notities };
  }

  /**
   * Plaatst een notitie bij een respons.
   *
   * **Ook vóór het indienen toegestaan**, anders dan bij beoordelen (besluit
   * eigenaar 2026-08-07). "Gebeld, komt volgende week" gaat juist over een
   * leverancier die nog niet heeft ingediend.
   *
   * De schrijver komt uit de sessie, nooit uit de body (§6). 201 met de
   * notitie erbij, inclusief naam en datum — een notitie zonder afzender en
   * tijdstip is in een dossier waardeloos.
   */
  @Post('responses/:id/notes')
  async plaatsNotitie(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let invoer: ReturnType<typeof leesNotitie>;
    try {
      invoer = leesNotitie(body);
    } catch (err) {
      throw this.naarHttpFout(err);
    }

    const notitie = await this.notities_.voegToe(
      sessie.tenantId,
      id,
      sessie.userId,
      invoer.tekst,
      invoer.soort,
    );

    return { notitie };
  }

  /**
   * Trekt een notitie in.
   *
   * Zet `deleted_at`; de rij blijft staan, net als bij een oordeel. 204 bij
   * succes, 404 als de notitie niet bestaat binnen deze tenant of al is
   * ingetrokken.
   */
  @Delete('responses/:id/notes/:noteId')
  @HttpCode(204)
  async trekNotitieIn(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Param('noteId') noteId: string,
  ): Promise<void> {
    const sessie = request.sessie!;

    await this.notities_.trekIn(sessie.tenantId, id, noteId);
  }

  /**
   * Wat er op de ingelogde gebruiker wacht: ingediende responses op
   * vragenlijsten waaraan hij als beoordelaar gekoppeld is.
   *
   * Bewust een eigen route en geen filter op de rondelijst (ADR-013). "Wat
   * wacht er op mij" betekent voor een contractmanager iets wezenlijk anders
   * dan voor een beoordelaar: de CISO wil niet zien wie er nog moet invullen,
   * de contractmanager niet de beoordeelstapel van de hele organisatie.
   *
   * Geen `@VereistRol`: iedereen mag zijn eigen werkvoorraad zien. Is hij
   * nergens aan gekoppeld, dan is de lijst leeg — dat is een geldig antwoord,
   * geen fout.
   */
  @Get('mijn-beoordelingen')
  async mijnBeoordelingen(@Req() request: RequestMetSessie) {
    const sessie = request.sessie!;

    const werkvoorraad = await this.beoordelaars.werkvoorraad(
      sessie.tenantId,
      sessie.userId,
    );

    return { werkvoorraad };
  }

  /**
   * De werkvoorraad van de contractmanager: rondes op vendors die hij beheert.
   *
   * Bewust een andere lijst dan `mijn-beoordelingen` en geen filter erop
   * (ADR-013). De contractmanager wil weten wie er nog moet invullen en wie te
   * laat is; de beoordelaar wil dat juist niet zien. Deze lijst bevat daarom
   * óók responses die nog niet zijn ingediend.
   *
   * `?scope=organisatie` toont alles binnen de tenant. Dat is de schakelaar
   * "van mij / hele organisatie": de koppeling stuurt wat je standaard ziet,
   * niet wat je mag (ADR-013 besluit 3). Zonder die uitweg ligt het proces
   * stil zodra een contractmanager op vakantie is.
   *
   * Geen `@VereistRol`: iedereen mag zijn eigen werkvoorraad zien, en beheert
   * hij geen enkele vendor dan is de lijst leeg — een geldig antwoord, geen
   * fout.
   */
  @Get('mijn-vendors')
  async mijnVendors(
    @Req() request: RequestMetSessie,
    @Query('scope') scope?: string,
    @Query('thema') thema?: string,
  ) {
    const sessie = request.sessie!;

    const heleOrganisatie = scope === 'organisatie';
    const themaCodes = thema ? thema.split(',').filter(Boolean) : [];

    const werkvoorraad = heleOrganisatie
      ? await this.contractmanagers.volledigOverzicht(
          sessie.tenantId,
          null,
          themaCodes,
        )
      : await this.contractmanagers.volledigOverzicht(
          sessie.tenantId,
          sessie.userId,
          themaCodes,
        );

    return { werkvoorraad, scope: heleOrganisatie ? 'organisatie' : 'mij' };
  }

  /**
   * De uitvragen van één leverancier — de databron voor het paneel op zijn
   * detailpagina.
   *
   * Geen `@VereistRol`: dit is lezen, en een beoordelaar mag zien wat er bij
   * een leverancier loopt. Dezelfde afweging als bij `runs` en `templates`.
   *
   * De vendorId komt uit het pad, de tenant uit de sessie. RLS zorgt dat een
   * vendorId uit een andere tenant hier niets oplevert — geen 403 maar een lege
   * lijst, want het bestaan van die leverancier is zelf al informatie.
   */
  @Get('vendors/:id/uitvragen')
  async uitvragenVanVendor(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
  ) {
    const sessie = request.sessie!;

    const uitvragen = await this.beheer.uitvragenVanVendor(sessie.tenantId, id);

    return { uitvragen };
  }

  /** Wie er aan deze vragenlijst gekoppeld zijn als beoordelaar. */
  @Get('templates/:id/reviewers')
  async reviewers(@Req() request: RequestMetSessie, @Param('id') id: string) {
    const sessie = request.sessie!;

    const beoordelaars = await this.beoordelaars.lijst(sessie.tenantId, id);

    return { beoordelaars };
  }

  /**
   * Koppelt een beoordelaar aan een vragenlijst.
   *
   * **`@VereistRol('admin')`, anders dan bij beoordelen zelf.** Beoordelen is
   * de rol van een reviewer; bepalen wíé er beoordeelt is beheer. Zonder die
   * grens kan een reviewer zichzelf aan elke lijst hangen, en dan zegt de
   * koppeling niets meer over hoe de organisatie het bedoeld heeft.
   *
   * Let op: dit beperkt níét wie er mag beoordelen (ADR-013 besluit 3). Elke
   * reviewer mag elke inzending beoordelen; deze koppeling bepaalt alleen wat
   * er in iemands werkvoorraad verschijnt.
   *
   * Idempotent: twee keer koppelen is geen fout.
   */
  @Post('templates/:id/reviewers')
  @VereistRol('admin')
  @HttpCode(204)
  async koppelReviewer(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let userId: string;
    try {
      userId = leesBeoordelaar(body);
    } catch (err) {
      throw this.naarHttpFout(err);
    }

    await this.beoordelaars.koppel(sessie.tenantId, id, userId, sessie.userId);
  }

  /** Haalt een koppeling weg. 204 ook als hij er niet was. */
  @Delete('templates/:id/reviewers/:userId')
  @VereistRol('admin')
  @HttpCode(204)
  async ontkoppelReviewer(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    const sessie = request.sessie!;

    await this.beoordelaars.ontkoppel(sessie.tenantId, id, userId);
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
   * Archiveert een ronde in één actie, ongeacht de huidige status
   * (issue #205) — doorloopt zelf de tussenstappen van de overgangstabel.
   *
   * @VereistRol('admin'): zelfde grens als wijzigStatus() hierboven.
   */
  @Post('runs/:id/archiveer')
  @VereistRol('admin')
  @HttpCode(200)
  async archiveerRonde(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
  ) {
    const sessie = request.sessie!;

    return this.rondes.archiveer(sessie.tenantId, id);
  }

  /**
   * Trekt de uitnodiging van één deelnemer binnen een ronde in — een
   * vergissing bij één leverancier, in tegenstelling tot `archiveerRonde()`
   * hierboven (de hele ronde). Zie de toelichting bij
   * `RondeBeheerService.trekDeelnemerIn()`.
   *
   * @VereistRol('admin'): zelfde grens als de andere schrijfroutes hier.
   */
  @Post('runs/:id/participants/:responseId/intrekken')
  @VereistRol('admin')
  @HttpCode(200)
  async trekDeelnemerIn(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Param('responseId') responseId: string,
  ) {
    const sessie = request.sessie!;

    return this.rondes.trekDeelnemerIn(sessie.tenantId, id, responseId);
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
          // `echtVerstuurd` en niet `verstuurd` — zelfde reden als bij
          // `PlatformController` (Issue #131). Zonder mailkanaal ging er niets
          // uit, en dan mag hier geen vinkje staan dat zegt van wel.
          verstuurd: uitkomst?.echtVerstuurd ?? false,
          verzendFout: uitkomst?.fout,
        };
      }),
      verzonden: verzending.filter((v) => v.echtVerstuurd).length,
      mislukt: verzending.filter((v) => !v.verstuurd).length,
      // Staat dit op `true`, dan is `verzonden` nul zonder dat er iets fout is:
      // de tokens zijn geldig, maar de links moeten met de hand doorgegeven
      // worden. Het scherm kan dat dan zeggen in plaats van "0 verstuurd" te
      // tonen bij een ronde waar niets mis mee is.
      //
      // De toets is *geslaagd maar niet echt verstuurd*. Zou hier
      // `every(v => !v.echtVerstuurd)` staan, dan is dit ook `true` wanneer de
      // provider álles weigerde — en dan wijst het scherm naar een ontbrekend
      // mailkanaal terwijl er een heel ander probleem is.
      geenMailkanaal: verzending.some((v) => v.verstuurd && !v.echtVerstuurd),
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
