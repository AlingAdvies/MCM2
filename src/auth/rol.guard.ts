import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { RequestMetSessie } from './tenant-context.guard';

/**
 * Rolcontrole: wat mag de ingelogde gebruiker doen.
 *
 * ── Waarom dit een aparte guard is ────────────────────────────────────────
 * `TenantContextGuard` stelt vast **wie** er is en **bij welke tenant**. Wat
 * die persoon vervolgens mag, is een andere vraag met een ander antwoord. Ze
 * samenvoegen zou betekenen dat elke route die authenticatie nodig heeft ook
 * een rolbesluit meekrijgt dat niemand expliciet nam — precies wat het
 * commentaar in tenant-context.guard.ts als valkuil benoemt.
 *
 * ── Waarom de controle hier staat en niet alleen in het scherm ────────────
 * Een verborgen knop is geen beveiliging: wie het adres kent, roept de route
 * rechtstreeks aan. Zolang `POST /vendors` openstond voor elke geldige sessie
 * was `reviewer` een rol zonder betekenis — een label in de sidebar.
 *
 * Dat was een bewust openstaand punt (rechten-ontwerp §6, 2026-08-03): ofwel
 * de route krijgt de controle, ofwel de knop blijft zichtbaar. De tussenvorm
 * — knop verborgen, route open — is de gevaarlijkste, want die wekt de indruk
 * dat er iets geregeld is.
 *
 * ── 403 en niet 404 ───────────────────────────────────────────────────────
 * Bij een tokenroute verbergen we het bestaan van een respons (404 bij een
 * onbekend token), want daar is het bestaan zelf informatie. Hier niet: de
 * gebruiker is geverifieerd, hoort bij deze tenant, en weet dat de leverancier
 * bestaat — hij ziet hem in de lijst. Een 404 zou hem laten zoeken naar een
 * probleem dat er niet is. 403 zegt wat er aan de hand is: u mag dit niet.
 */

export const VEREISTE_ROL = 'vereisteRol';

/** Markeert een route of controller als "alleen voor deze rol". */
export const VereistRol = (rol: string) => SetMetadata(VEREISTE_ROL, rol);

@Injectable()
export class RolGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const vereist = this.reflector.getAllAndOverride<string | undefined>(
      VEREISTE_ROL,
      [context.getHandler(), context.getClass()],
    );

    // Geen eis op deze route: iedereen met een geldige sessie mag door. De
    // authenticatie is dan al gedaan door TenantContextGuard.
    if (!vereist) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestMetSessie>();
    const sessie = request.sessie;

    // Geen sessie betekent dat TenantContextGuard niet gedraaid heeft — een
    // programmeerfout, geen gebruikersfout. Weigeren in plaats van doorlaten:
    // een guard die bij twijfel toestaat, is geen guard.
    if (!sessie) {
      throw new ForbiddenException('Geen sessie.');
    }

    if (sessie.role !== vereist) {
      throw new ForbiddenException(
        'U heeft geen rechten voor deze handeling. Neem contact op met uw beheerder.',
      );
    }

    return true;
  }
}
