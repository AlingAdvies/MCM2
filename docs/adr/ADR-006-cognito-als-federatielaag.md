# ADR-006 — AWS Cognito als federatielaag vóór Entra ID

- Status: **Accepted als architectuurprincipe. Spoor A technisch haalbaar bevestigd op 2026-07-27** (zie hieronder) — de daadwerkelijke Cognito+EntraID-implementatie tegen een voorbeeldtenant moet nog gebouwd worden.
- Datum: oorspronkelijk besluit 2026-07-24, haalbaarheid bevestigd 2026-07-27
- Context: authenticatie voor interne gebruikers (Transdev-beheerders) moet uiteindelijk tegen Microsoft Entra ID werken (Transdev is een Microsoft-tenant-organisatie). Rechtstreeks tegen Entra ID/MSAL bouwen en er later een federatiebroker voor zetten zou een herbouw zijn.
- Besluit: authenticatie wordt gebouwd tegen AWS Cognito als federatielaag, niet rechtstreeks tegen Entra ID. Cognito routeert Microsoft-login (SAML/OIDC) door en geeft zelf het JWT uit — dit vervangt Entra ID niet, het maakt Entra ID één geconfigureerde koppeling in plaats van hardgecodeerd de enige optie.
- Alternatieven: rechtstreeks tegen Entra ID/MSAL bouwen (verworpen — herbouw nodig zodra een tweede identity-provider ooit nodig is); een tijdelijk vereenvoudigd mechanisme permanent aanhouden (verworpen als structurele oplossing — wel acceptabel als **tijdelijke, gedateerde** pilot-uitzondering, zie hieronder).

## Haalbaarheidscheck Spoor A — uitkomst (2026-07-27)

Uitgevoerd als onderdeel van Issue #4. Bevindingen:

- Het Microsoft-account `kees@alingadvies.nl` heeft de Entra ID-rol **Global Administrator** in de tenant `alingadvies.nl` (bevestigd via Entra admin center → gebruikersprofiel → Assigned roles). Dat is ruim voldoende voor het aanmaken van app-registraties (minimaal vereist: Application Administrator).
- De `alingadvies.nl`-tenant heeft **geen gekoppelde Azure-subscription** ("No subscriptions in Aling Advies directory"). Dit blokkeert de haalbaarheid niet: Entra ID-app-registraties en de federatieconfiguratie zelf vereisen geen Azure-subscription, alleen voldoende Entra ID-rol.
- **Belangrijke nuance:** deze rechtencheck is uitgevoerd tegen `alingadvies.nl`, niet tegen een Transdev-tenant. De eigenaar heeft geen toegang of rechten in een Transdev Entra ID-omgeving. `alingadvies.nl` dient daarom als **voorbeeld-/testtenant** om het Cognito+EntraID-federatiepatroon technisch te bewijzen — dit is een generiek OIDC/SAML-mechanisme, niet Transdev-specifieke code (zie MCM2-CLAUDE.md §8: "bouw tegen een generieke identity-/claimsinterface").
- Of Transdev's eigen IT-afdeling bereid en in staat is om in hún tenant een vergelijkbare app-registratie te doen, is met deze check **niet** bevestigd en blijft een aparte, latere afhankelijkheid — te bevestigen in overleg met Transdev, geen technische spike.

**Conclusie: Spoor A is technisch haalbaar.** Besluit: Spoor A wordt uitgevoerd, met `alingadvies.nl` als voorbeeldtenant voor de proof-of-concept. Spoor B (tijdelijk vereenvoudigd mechanisme) is niet nodig.

## Actuele uitvoeringsstatus (2026-07-27) — proof-of-concept nog te bouwen

- **Spoor A (gekozen):** Cognito User Pool + Entra ID-federatie bouwen tegen `alingadvies.nl` als voorbeeldtenant. Haalbaarheid technisch bevestigd (zie hierboven); implementatie nog niet gestart.
- **Spoor B:** niet nodig gebleken, vervalt als actieve optie tenzij Spoor A tijdens de bouw alsnog vastloopt.
- Vervolgens, als aparte stap: bevestigen met Transdev of een equivalente app-registratie in hún tenant mogelijk is, vóór de pilot live gaat met echte Transdev-beheerders.

Dit ADR legt vast **dát** Cognito het architectuurprincipe is en dat Spoor A haalbaar is — het legt niet vast dat de federatie al werkt. Zie `docs/STATUS.md` voor de actuele voortgang.

- Gevolgen: de proof-of-concept (Cognito User Pool + app-registratie in `alingadvies.nl`) moet nog gebouwd worden voordat de vraag "hoe authenticeert de Transdev-beheerder daadwerkelijk" volledig is beantwoord (zie ook P0-restpunt in `docs/STATUS.md`/Issue #7 over tenantcontext-verificatie in het algemeen — dit ADR gaat over de identity-provider-keuze, Issue #7 gaat over hoe de tenantcontext daaruit wordt afgeleid).
- Reviewmoment: zodra de proof-of-concept werkt, en opnieuw vóór een tweede tenant/klant wordt aangesloten of vóór de daadwerkelijke Transdev-tenant gekoppeld wordt.
- Bronnen: `docs/architecture-review/2026-07-24/08-transdev-mvp-scope.md` (OV-1 en het tweesporenontwerp), `docs/archive/06-prioritized-roadmap-2026-07-24-pre-issues.md` (BP0/BP3), `docs/context/PROJECT-HISTORY-2026-07-24.md`, GitHub Issue #4.
