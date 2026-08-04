import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';

import { RolGuard } from '../auth/rol.guard';
import {
  TenantContextGuard,
  type RequestMetSessie,
} from '../auth/tenant-context.guard';
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
 * ── Alleen lezen ────────────────────────────────────────────────────────────
 *
 * Bewust geen POST of PATCH. Een ronde starten en deelnemers uitnodigen is
 * fase B, en dat raakt de tokenlaag die al bewezen en groen is. Die knip houdt
 * de gevoelige stap apart van het schermwerk.
 *
 * ── Waarom géén @VereistRol('admin') ────────────────────────────────────────
 *
 * `RolGuard` staat er wel, maar zonder eis: elke geldige sessie mag deze routes
 * lezen. Dat is een besluit uit het plan (fase A) — **lezen mag ook een
 * reviewer**, want resultaten inzien is precies zijn rol. Hem dat ontzeggen
 * maakt de rol betekenisloos.
 *
 * Fase B is anders: rondes starten en tokens uitgeven krijgt wél
 * `@VereistRol('admin')`. De guard staat hier alvast zodat die eis er later
 * bij kan zonder de klasse te herzien.
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
  constructor(private readonly beheer: VragenlijstBeheerService) {}

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
}
